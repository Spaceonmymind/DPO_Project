from decimal import Decimal
from types import SimpleNamespace
import pytest

from app.calculations import CalculationEngine, CalculationError, ValueFormatter

def field(key, calculated=False, expression=None, kind='DECIMAL', precision=2):
    return SimpleNamespace(field_key=key,label=key,field_type=kind,config={'calculated':calculated,'expression':expression,'precision':precision,'rounding':'HALF_UP','output_format':'RAW'})

def group(key, fields):
    return SimpleNamespace(group_key=key,name=key,fields=fields)

def const(value): return {'source':'CONSTANT','value':str(value)}
def op(name,*args): return {'operation':name,'operands':list(args)}

@pytest.mark.parametrize(('operation','expected'),[
 ('ADD','13'),('SUBTRACT','7'),('MULTIPLY','30'),('DIVIDE','3.333333333333333333333333333333333333333')])
def test_arithmetic_decimal_and_percent(operation,expected):
    assert CalculationEngine.evaluate(op(operation,const(10),const(3)),{}, {}) == Decimal(expected)

@pytest.mark.parametrize(('operation','expected'),[
 ('PERCENT_OF','3'),('ADD_PERCENT','13'),('EXTRACT_PERCENT','2.307692307692307692307692307692307692308'),('REMOVE_PERCENT','7.692307692307692307692307692307692307692')])
def test_percent_and_vat_models(operation,expected):
    assert CalculationEngine.evaluate(op(operation,const(10),const(30)),{}, {}) == Decimal(expected)

def test_rounding_negative_empty_and_zero_division():
    assert CalculationEngine.quantize(Decimal('-1.235'),2,'HALF_UP') == Decimal('-1.24')
    assert CalculationEngine.evaluate(op('ADD',{'source':'FIELD','field_key':'empty'},const(2)),{'empty':None}, {}) == 2
    with pytest.raises(CalculationError,match='Деление на ноль'): CalculationEngine.evaluate(op('DIVIDE',const(1),const(0)),{}, {})

def test_row_calculations_aggregates_changes_and_empty_group():
    quantity=field('quantity'); price=field('price'); total=field('row_total',True,op('MULTIPLY',{'source':'ROW_FIELD','field_key':'quantity'},{'source':'ROW_FIELD','field_key':'price'}))
    services=group('services',[quantity,price,total]); grand=field('grand_total',True,{'operation':'SUM','group_key':'services','field_key':'row_total'})
    count=field('count',True,{'operation':'COUNT','group_key':'services'},kind='INTEGER',precision=0)
    CalculationEngine.validate([grand,count],[services])
    answers={'services':[{'_id':'1','quantity':'2','price':'5000'},{'_id':'2','quantity':'3','price':'5000'}]}
    values,groups=CalculationEngine.calculate([grand,count],[services],answers,{'grand_total','count'},{'services'})
    assert [x['row_total'] for x in groups['services']] == [Decimal('10000.00'),Decimal('15000.00')]
    assert values['grand_total']==Decimal('25000.00') and values['count']==Decimal('2')
    answers['services'][1]['price']='6000'; answers['services'].pop(0)
    values,_=CalculationEngine.calculate([grand,count],[services],answers,{'grand_total','count'},{'services'})
    assert values['grand_total']==Decimal('18000.00')
    empty,_=CalculationEngine.calculate([grand,count],[services],{'services':[]},{'grand_total','count'},{'services'})
    assert empty['grand_total']==empty['count']==0
    inactive,_=CalculationEngine.calculate([grand,count],[services],answers,{'grand_total','count'},set())
    assert inactive['grand_total']==0

def test_dependencies_invalid_reference_and_cycle():
    a=field('a',True,{'source':'CALCULATED','field_key':'b'}); b=field('b',True,{'source':'CALCULATED','field_key':'a'})
    with pytest.raises(CalculationError,match='цикл'): CalculationEngine.validate([a,b],[])
    bad=field('bad',True,{'source':'FIELD','field_key':'missing'})
    with pytest.raises(CalculationError,match='не найдено'): CalculationEngine.validate([bad],[])

def test_active_calculation_rejects_inactive_source_instead_of_using_hidden_answer():
    amount=field('amount')
    total=field('total',True,op('ADD',{'source':'FIELD','field_key':'amount'},const(1)))
    with pytest.raises(CalculationError,match='неактивно'):
        CalculationEngine.calculate([amount,total],[],{'amount':'999'},{'total'},set())

def test_if_reuses_condition_engine():
    expression={'operation':'IF','condition':{'operator':'GREATER_THAN','field_key':'amount','value':100},'then':const(20),'else':const(10)}
    assert CalculationEngine.evaluate(expression,{'amount':101},{})==20
    assert CalculationEngine.evaluate(expression,{'amount':99},{})==10

def test_formatting_money_words_dates_and_multiple_formats():
    assert ValueFormatter.format('12500','MONEY')=='12 500,00'
    assert ValueFormatter.format('12500','MONEY_WITH_CURRENCY')=='12 500,00 руб.'
    assert ValueFormatter.format('12500','MONEY_WORDS_RUB')=='Двенадцать тысяч пятьсот рублей 00 копеек'
    assert ValueFormatter.format('21.01','MONEY_WORDS_RUB')=='Двадцать один рубль 01 копейка'
    assert ValueFormatter.format('2026-11-05','DATE')=='05.11.2026'
    assert ValueFormatter.format('2026-11-05','DATE_WORDS')=='5 ноября 2026 года'
    with pytest.raises(CalculationError,match='Точность'): ValueFormatter.format('1','MONEY',{'precision':99})

def test_round_expression_configuration_is_bounded():
    invalid={'operation':'ROUND','operands':[const(1)],'precision':13,'rounding':'HALF_UP'}
    with pytest.raises(CalculationError,match='точность'): CalculationEngine.validate([field('rounded',True,invalid)],[])
