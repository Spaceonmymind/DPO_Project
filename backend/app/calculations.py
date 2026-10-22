from __future__ import annotations
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, ROUND_HALF_EVEN, ROUND_DOWN, ROUND_UP, localcontext
from typing import Any

from app.conditions import ConditionEngine, ConditionConfigurationError

CALC_OPERATIONS={'ADD','SUBTRACT','MULTIPLY','DIVIDE','SUM','COUNT','MIN','MAX','ROUND','PERCENT_OF','ADD_PERCENT','EXTRACT_PERCENT','REMOVE_PERCENT','IF'}
ROUNDING={'HALF_UP':ROUND_HALF_UP,'HALF_EVEN':ROUND_HALF_EVEN,'DOWN':ROUND_DOWN,'UP':ROUND_UP}
FORMATS={'RAW','NUMBER','DECIMAL','MONEY','MONEY_WITH_CURRENCY','DATE','DATE_WORDS','PERCENT','MONEY_WORDS_RUB'}
NUMERIC_TYPES={'INTEGER','DECIMAL','MONEY'}

class CalculationError(ValueError): pass

def decimal_value(value:Any,empty_zero=True)->Decimal:
 if value in (None,''):
  if empty_zero:return Decimal(0)
  raise CalculationError('Значение не заполнено')
 if isinstance(value,bool): raise CalculationError('Логическое значение нельзя использовать как число')
 try:return Decimal(str(value).replace(',','.'))
 except (InvalidOperation,ValueError):raise CalculationError('Ожидалось числовое значение')

class CalculationEngine:
 MAX_DEPTH=12; MAX_NODES=100; MAX_ABS=Decimal('1e24')
 @classmethod
 def validate(cls,regular_fields,row_groups):
  regular={x.field_key:x for x in regular_fields}; groups={g.group_key:g for g in row_groups}; row_fields={g.group_key:{x.field_key:x for x in g.fields} for g in row_groups}
  calculated={k:v for k,v in regular.items() if (v.config or {}).get('calculated')}; deps={k:set() for k in calculated}
  for key,field in calculated.items(): cls._validate_expr((field.config or {}).get('expression'),regular,groups,row_fields,None,deps[key],0,[0])
  cls._acyclic(deps,'вычисляемых полей анкеты')
  for group in row_groups:
   computed={k:v for k,v in row_fields[group.group_key].items() if (v.config or {}).get('calculated')}; graph={k:set() for k in computed}
   for key,field in computed.items(): cls._validate_expr((field.config or {}).get('expression'),regular,groups,row_fields,group.group_key,graph[key],0,[0])
   cls._acyclic(graph,f'полей группы «{group.name}»')
  for field in [*regular.values(),*(x for values in row_fields.values() for x in values.values())]:
   cfg=field.config or {}
   if cfg.get('calculated'):
    precision=cfg.get('precision',2); rounding=cfg.get('rounding','HALF_UP')
    if not isinstance(precision,int) or precision<0 or precision>12: raise CalculationError(f'Поле «{field.label}»: точность должна быть от 0 до 12')
    if rounding not in ROUNDING: raise CalculationError(f'Поле «{field.label}»: неизвестный режим округления')
   ValueFormatter.validate(cfg.get('output_format','RAW'))
 @classmethod
 def _validate_expr(cls,e,regular,groups,row_fields,row_group,deps,depth,count):
  count[0]+=1
  if count[0]>cls.MAX_NODES or depth>cls.MAX_DEPTH: raise CalculationError('Формула слишком сложная')
  if not isinstance(e,dict): raise CalculationError('Формула не задана')
  source=e.get('source')
  if source:
   if source=='CONSTANT': decimal_value(e.get('value')); return
   key=e.get('field_key')
   if source in {'FIELD','CALCULATED'}:
    if key not in regular: raise CalculationError(f'Поле-источник «{key}» не найдено')
    if regular[key].field_type not in NUMERIC_TYPES: raise CalculationError(f'Поле «{regular[key].label}» не является числовым')
    if (regular[key].config or {}).get('calculated'): deps.add(key)
    return
   if source in {'ROW_FIELD','ROW_CALCULATED'}:
    if not row_group or key not in row_fields[row_group]: raise CalculationError(f'Поле строки «{key}» не найдено')
    if row_fields[row_group][key].field_type not in NUMERIC_TYPES: raise CalculationError(f'Поле строки «{row_fields[row_group][key].label}» не является числовым')
    if (row_fields[row_group][key].config or {}).get('calculated'): deps.add(key)
    return
   raise CalculationError('Неизвестный источник значения')
  op=e.get('operation')
  if op not in CALC_OPERATIONS: raise CalculationError(f'Операция «{op}» не поддерживается')
  if op in {'SUM','COUNT','MIN','MAX'}:
   group_key=e.get('group_key'); field_key=e.get('field_key')
   if group_key not in groups: raise CalculationError(f'Группа «{group_key}» не найдена')
   if op!='COUNT':
    field=row_fields[group_key].get(field_key)
    if not field: raise CalculationError(f'Поле агрегирования «{field_key}» не найдено')
    if field.field_type not in NUMERIC_TYPES: raise CalculationError(f'Поле «{field.label}» не является числовым')
   return
  if op=='IF':
   try:ConditionEngine.validate_condition(e.get('condition'),list(regular.values()))
   except ConditionConfigurationError as exc:raise CalculationError(f'Некорректное условие IF: {exc}')
   cls._validate_expr(e.get('then'),regular,groups,row_fields,row_group,deps,depth+1,count);cls._validate_expr(e.get('else'),regular,groups,row_fields,row_group,deps,depth+1,count);return
  operands=e.get('operands',[])
  required=1 if op=='ROUND' else 2
  if not isinstance(operands,list) or len(operands)<required: raise CalculationError(f'Операции {op} не хватает аргументов')
  if op in {'SUBTRACT','DIVIDE','PERCENT_OF','ADD_PERCENT','EXTRACT_PERCENT','REMOVE_PERCENT'} and len(operands)!=2: raise CalculationError(f'Операция {op} требует два аргумента')
  for item in operands:cls._validate_expr(item,regular,groups,row_fields,row_group,deps,depth+1,count)
 @staticmethod
 def _acyclic(graph,label):
  visiting=set();done=set()
  def visit(node):
   if node in visiting:raise CalculationError(f'Обнаружен цикл зависимостей {label}')
   if node in done:return
   visiting.add(node)
   for dep in graph[node]:visit(dep)
   visiting.remove(node);done.add(node)
  for node in graph:visit(node)
 @classmethod
 def calculate(cls,regular_fields,row_groups,answers,active_keys,active_groups):
  values={k:v for k,v in answers.items() if k in active_keys}; group_values={}
  for group in row_groups:
   rows=[dict(x) for x in answers.get(group.group_key,[])] if group.group_key in active_groups else []
   fields={x.field_key:x for x in group.fields}; pending={k:v for k,v in fields.items() if (v.config or {}).get('calculated')}
   for row in rows: cls._resolve_fields(pending,row,values,group_values,row)
   group_values[group.group_key]=rows
  pending={x.field_key:x for x in regular_fields if (x.config or {}).get('calculated') and x.field_key in active_keys}
  cls._resolve_fields(pending,values,values,group_values,None)
  return values,group_values
 @classmethod
 def _resolve_fields(cls,pending,target,values,groups,row):
  left=dict(pending)
  while left:
   progress=False
   for key,field in list(left.items()):
    try:value=cls.evaluate((field.config or {})['expression'],values,groups,row)
    except KeyError:continue
    precision=(field.config or {}).get('precision',2);value=cls.quantize(value,precision,(field.config or {}).get('rounding','HALF_UP'));target[key]=value;del left[key];progress=True
   if not progress:raise CalculationError('Не удалось определить порядок вычислений')
 @classmethod
 def evaluate(cls,e,values,groups,row=None):
  if 'source' in e:
   source=e['source'];key=e.get('field_key')
   if source=='CONSTANT':return decimal_value(e.get('value'))
   if source=='ROW_FIELD':return decimal_value((row or {}).get(key))
   if source=='ROW_CALCULATED':
    if key not in (row or {}):raise KeyError(key)
    return decimal_value(row[key])
   if source=='FIELD':return decimal_value(values.get(key))
   if key not in values:raise KeyError(key)
   return decimal_value(values[key])
  op=e['operation']
  if op in {'SUM','COUNT','MIN','MAX'}:
   rows=groups.get(e['group_key'],[])
   if op=='COUNT':return Decimal(len(rows))
   numbers=[decimal_value(x.get(e['field_key'])) for x in rows]
   if op=='SUM':return sum(numbers,Decimal(0))
   if not numbers:return Decimal(0)
   return min(numbers) if op=='MIN' else max(numbers)
  if op=='IF':return cls.evaluate(e['then'] if ConditionEngine.evaluate(e['condition'],values) else e['else'],values,groups,row)
  args=[cls.evaluate(x,values,groups,row) for x in e.get('operands',[])]
  with localcontext() as ctx:
   ctx.prec=40
   if op=='ADD':result=sum(args,Decimal(0))
   elif op=='SUBTRACT':result=args[0]-args[1]
   elif op=='MULTIPLY':
    result=Decimal(1)
    for x in args:result*=x
   elif op=='DIVIDE':
    if args[1]==0:raise CalculationError('Деление на ноль')
    result=args[0]/args[1]
   elif op=='ROUND':result=cls.quantize(args[0],int(e.get('precision',2)),e.get('rounding','HALF_UP'))
   elif op=='PERCENT_OF':result=args[0]*args[1]/Decimal(100)
   elif op=='ADD_PERCENT':result=args[0]*(Decimal(1)+args[1]/Decimal(100))
   elif op=='EXTRACT_PERCENT':
    if Decimal(100)+args[1]==0:raise CalculationError('Процентная ставка приводит к делению на ноль')
    result=args[0]*args[1]/(Decimal(100)+args[1])
   elif op=='REMOVE_PERCENT':
    if Decimal(100)+args[1]==0:raise CalculationError('Процентная ставка приводит к делению на ноль')
    result=args[0]*Decimal(100)/(Decimal(100)+args[1])
   else:raise CalculationError(f'Операция «{op}» не поддерживается')
  if abs(result)>cls.MAX_ABS:raise CalculationError('Результат вычисления выходит за допустимый диапазон')
  return result
 @staticmethod
 def quantize(value,precision,rounding):return value.quantize(Decimal(1).scaleb(-precision),rounding=ROUNDING.get(rounding,ROUND_HALF_UP))

class ValueFormatter:
 MONTHS=('января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря')
 @staticmethod
 def validate(name):
  if name not in FORMATS:raise CalculationError(f'Формат «{name}» не поддерживается')
 @classmethod
 def format(cls,value,name='RAW',options=None):
  cls.validate(name);options=options or {}
  if value in (None,''):return ''
  if name=='RAW':return str(value)
  if name in {'DATE','DATE_WORDS'}:
   parsed=date.fromisoformat(str(value));return parsed.strftime('%d.%m.%Y') if name=='DATE' else f'{parsed.day} {cls.MONTHS[parsed.month-1]} {parsed.year} года'
  number=decimal_value(value);precision=int(options.get('precision',0 if name in {'NUMBER','PERCENT'} else 2));number=CalculationEngine.quantize(number,precision,options.get('rounding','HALF_UP'))
  if name=='MONEY_WORDS_RUB':return cls.money_words(number)
  text=f'{number:,.{precision}f}'.replace(',',' ').replace('.',',')
  if name=='MONEY_WITH_CURRENCY':return text+' руб.'
  if name=='PERCENT':return text+' %'
  return text
 @classmethod
 def money_words(cls,value):
  value=CalculationEngine.quantize(value,2,'HALF_UP');negative=value<0;value=abs(value);rubles=int(value);kopecks=int((value-rubles)*100)
  words=cls._integer_words(rubles);rub_form=cls._form(rubles,'рубль','рубля','рублей');kop_form=cls._form(kopecks,'копейка','копейки','копеек');result=f'{words} {rub_form} {kopecks:02d} {kop_form}'
  return ('Минус ' if negative else '')+result[:1].upper()+result[1:]
 @staticmethod
 def _form(n,one,few,many):
  n%=100
  if 11<=n<=19:return many
  return one if n%10==1 else few if 2<=n%10<=4 else many
 @classmethod
 def _integer_words(cls,n):
  if n==0:return 'ноль'
  if n>999_999_999_999_999:raise CalculationError('Сумма слишком велика для вывода прописью')
  ones=('','один','два','три','четыре','пять','шесть','семь','восемь','девять');female=('','одна','две','три','четыре','пять','шесть','семь','восемь','девять');teens=('десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать');tens=('','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто');hundreds=('','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот');scales=((1,'','',''),(1000,'тысяча','тысячи','тысяч'),(1_000_000,'миллион','миллиона','миллионов'),(1_000_000_000,'миллиард','миллиарда','миллиардов'),(1_000_000_000_000,'триллион','триллиона','триллионов'));out=[]
  for scale,one,few,many in reversed(scales):
   part=n//scale%1000
   if not part:continue
   h=part//100;rest=part%100;out.append(hundreds[h]) if h else None
   if 10<=rest<=19:out.append(teens[rest-10])
   else:
    if rest//10:out.append(tens[rest//10])
    if rest%10:out.append((female if scale==1000 else ones)[rest%10])
   if scale>1:out.append(cls._form(part,one,few,many))
  return ' '.join(out)
