from pathlib import Path
from docx import Document
from docx.shared import Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
import fitz, openpyxl
LABELS={'subject':'Предмет закупки','purpose':'Цель закупки','scope':'Объём работ / поставки','functional_requirements':'Функциональные требования','nonfunctional_requirements':'Нефункциональные требования','deadline':'Срок выполнения','acceptance_criteria':'Критерии приёмки','other_conditions':'Прочие условия'}
ORDER=list(LABELS)
def extract(path:Path,ext:str):
 if ext=='.docx': return '\n'.join(p.text for p in Document(path).paragraphs)
 if ext=='.pdf': return ''.join(p.get_text() for p in fitz.open(path))
 if ext=='.xlsx': return '\n'.join(' '.join(str(c.value or '') for c in row) for row in openpyxl.load_workbook(path).active.iter_rows())
 raise ValueError('Unsupported document type')
def _base(d):
 sec=d.sections[0]; sec.top_margin=Cm(2); sec.bottom_margin=Cm(2); sec.left_margin=Cm(2.5); sec.right_margin=Cm(2)
 st=d.styles['Normal']; st.font.name='Arial'; st.font.size=Pt(11); st.paragraph_format.space_after=Pt(7)
def generate_spec(data,path):
 d=Document(); _base(d); p=d.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; r=p.add_run('ТЕХНИЧЕСКОЕ ЗАДАНИЕ'); r.bold=True; r.font.size=Pt(16)
 p=d.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.add_run('на закупку').font.size=Pt(12)
 for i,key in enumerate(ORDER,1):
  if not data.get(key): continue
  p=d.add_paragraph(); r=p.add_run(f'{i}. {LABELS[key]}'); r.bold=True; r.font.size=Pt(12); d.add_paragraph(data[key])
 d.save(path)
def generate_contract(name,path):
 d=Document(); _base(d); p=d.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; r=p.add_run(name.upper()); r.bold=True; r.font.size=Pt(15)
 d.add_paragraph('г. Москва                                                   «__» ______ 20__ г.')
 for n,title in enumerate(['Предмет договора','Права и обязанности сторон','Стоимость и порядок расчётов','Порядок сдачи и приёмки','Ответственность сторон','Срок действия договора','Реквизиты сторон'],1):
  p=d.add_paragraph(); p.add_run(f'{n}. {title}').bold=True; d.add_paragraph('Условия определяются сторонами в соответствии с предметом договора.')
 d.save(path)
