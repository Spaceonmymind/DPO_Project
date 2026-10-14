import hashlib
from copy import deepcopy
from pathlib import Path

import openpyxl
import pytest
from docx import Document

from app.documents.service import generate_xlsx
from app.training_contracts import RED_FIELD_REGISTRY, apply_training_defaults, clarification_for, decide_training, empty_facts, extract_training_facts, load_occurrences, merge_facts, parse_pending_red_answer, red_field_values, render_training_contract, resolve_contextual_answer


_repository_templates=Path('/app/contract_templates') if Path('/app/contract_templates/training').is_dir() else Path(__file__).resolve().parents[2]/'contract_templates'
CONTRACT_ROOT=_repository_templates
TRAINING=CONTRACT_ROOT/'training'


def complete_facts(status='PHYSICAL_NO_IP_NO_NPD'):
    facts=empty_facts()
    facts.update(subject={'type':'TRAINING_SERVICE','paid':True},contractor={'status':status,'citizenship':'RU','age_18_plus':True},performance={'personal':True,'third_parties':False})
    facts['contract']['form_label']='TYPICAL_FORM'; facts['service']['name']='Проведение тренировок'
    facts['price']['total']=100000; facts['term'].update(start='2026-11-01',end='2027-01-31',more_than_one_year=False)
    facts['payment'].update(model='POSTPAY',postpay_percent=100,postpay_days=10,bank_guarantee=False)
    facts['schedule'].update(months=['2026-11'],entries=[{'date':'2026-11-10','weekday':'вторник','time':'10:00','count':1,'unit_price':100000,'place':'Москва'}])
    facts['places']['multiple_or_not_in_contract']=True; facts['extra_option']['enabled']=False
    if status=='PHYSICAL_NO_IP_NO_NPD':
        facts['tax'].update(ndfl_rate=13,ndfl_amount=13000); facts['physical'].update(passport='45 01 123456',snils='123-456-789 00')
    else:
        facts['tax'].update(vat_status='NO_VAT',no_vat_basis='УСН'); facts['ip']['ogrnip']='123456789012345'
    return facts


def test_decision_priority_and_readiness():
    assert extract_training_facts('Обычное физлицо без ИП')['contractor']['status']=='PHYSICAL_NO_IP_NO_NPD'
    assert extract_training_facts('Физлицо, не ИП и не самозанятый')['contractor']['status']=='PHYSICAL_NO_IP_NO_NPD'
    scenarios=[
        ('LEGAL_ENTITY','D004'),('NPD_PHYSICAL','D005'),('IP_NPD','D005'),('FOREIGN_PHYSICAL','D006'),('MINOR','D007'),
    ]
    for status,rule in scenarios:
        facts=complete_facts(); facts['contractor']['status']=status
        assert decide_training(facts).matched_rule_id==rule
    facts=complete_facts(); facts['performance']['third_parties']=True; assert decide_training(facts).matched_rule_id=='D008'
    facts=complete_facts(); facts['labor']['fixed_workday']=True; assert decide_training(facts).matched_rule_id=='D009'
    for status,template,rule in [('PHYSICAL_NO_IP_NO_NPD','PHYSICAL_PERSON','D030'),('IP_NO_NPD','INDIVIDUAL_ENTREPRENEUR','D031')]:
        decision=decide_training(complete_facts(status))
        assert (decision.template,decision.matched_rule_id,decision.render_status)==(template,rule,'READY')
        assert len(decision.red_fields)==25 and not decision.missing_field_ids
    incomplete=complete_facts(); incomplete['schedule']['entries']=None
    assert decide_training(incomplete).render_status=='NEEDS_INPUT' and 'RF021' in decide_training(incomplete).missing_field_ids


def test_contextual_composite_answers_and_partial_free_text():
    facts=empty_facts(); facts['subject'].update(type='TRAINING_SERVICE',paid=True); facts['contractor']['status']='PHYSICAL_NO_IP_NO_NPD'
    decision=decide_training(facts); pending=clarification_for(decision,facts)
    assert pending['target_fields']==['performance.personal','performance.third_parties']
    for answer in ('Да','ДА','Верно','Подтверждаю'):
        patch,kind,forced=resolve_contextual_answer(answer,pending); merged=merge_facts(facts,patch)
        assert kind=='contextual_yes' and forced is None and merged['performance']=={'personal':True,'third_parties':False}
        assert clarification_for(decide_training(merged),merged)['question_id']!='TRAINING_PERFORMANCE_COMPOSITE'
    patch,_,forced=resolve_contextual_answer('Нет',pending)
    assert patch=={} and 'Уточните' in forced
    direct=extract_training_facts('Лично без привлечения других лиц')
    assert direct['performance']=={'personal':True,'third_parties':False}
    direct=extract_training_facts('Сам проводит, никого не привлекает')
    assert direct['performance']=={'personal':True,'third_parties':False}
    personal=merge_facts(facts,extract_training_facts('Лично'))
    assert personal['performance']=={'personal':True,'third_parties':None}
    assert clarification_for(decide_training(personal),personal)['target_fields']==['performance.third_parties']
    third=merge_facts(facts,extract_training_facts('Без привлечения других лиц'))
    assert third['performance']=={'personal':None,'third_parties':False}
    assert clarification_for(decide_training(third),third)['target_fields']==['performance.personal']
    blocked=merge_facts(facts,extract_training_facts('Будут ещё другие тренеры'))
    assert blocked['performance']['third_parties'] is True and decide_training(blocked).matched_rule_id=='D008'


def test_repeated_composite_clarification_rephrases_then_splits():
    facts=empty_facts(); facts['subject'].update(type='TRAINING_SERVICE',paid=True); facts['contractor']['status']='PHYSICAL_NO_IP_NO_NPD'
    decision=decide_training(facts)
    first=clarification_for(decision,facts)
    second=clarification_for(decision,facts,first)
    third=clarification_for(decision,facts,second)
    assert second['question_id']=='TRAINING_PERFORMANCE_COMPOSITE'
    assert second['question']!=first['question'] and second['repeat_count']==1
    assert third['question_id']=='TRAINING_PERFORMANCE_THIRD_PARTIES'
    assert third['target_fields']==['performance.third_parties']


def test_all_25_red_fields_are_registered_and_have_explicit_states():
    assert list(RED_FIELD_REGISTRY)==[f'RF{i:03d}' for i in range(1,26)]
    for template in ('PHYSICAL_PERSON','INDIVIDUAL_ENTREPRENEUR'):
        facts=apply_training_defaults(empty_facts(),template)
        states={item['field_id']:item for item in red_field_values(facts,template)}
        assert len(states)==25
        for field_id,definition in RED_FIELD_REGISTRY.items():
            assert states[field_id]['status'] in {'MISSING','FILLED','NOT_APPLICABLE'}
            applicable=definition.scope in {'BOTH',template}
            if not applicable: assert states[field_id]['status']=='NOT_APPLICABLE'
            if definition.acquisition in {'DERIVED','DEFAULT','NOT_APPLICABLE'}:
                assert definition.acquisition!='USER_INPUT'
    defaults={item['field_id']:item for item in red_field_values(apply_training_defaults(empty_facts(),'PHYSICAL_PERSON'),'PHYSICAL_PERSON')}
    assert defaults['RF001']=={'field_id':'RF001','status':'FILLED','value':'TYPICAL_FORM','source':'DEFAULT'}
    assert defaults['RF002']['source']=='DEFAULT'


@pytest.mark.parametrize('field_id',[f'RF{i:03d}' for i in range(1,26)])
def test_each_canonical_red_field_has_template_applicability_and_state(field_id):
    definition=RED_FIELD_REGISTRY[field_id]
    for template in ('PHYSICAL_PERSON','INDIVIDUAL_ENTREPRENEUR'):
        states={item['field_id']:item for item in red_field_values(apply_training_defaults(empty_facts(),template),template)}
        state=states[field_id]
        assert state['field_id']==field_id and state['status'] in {'MISSING','FILLED','NOT_APPLICABLE'}
        if definition.scope not in {'BOTH',template}: assert state['status']=='NOT_APPLICABLE'
        if state['status']=='FILLED': assert state['source'] in {'USER','DERIVED','DEFAULT'}
        else: assert state['source']=='NONE'


def test_universal_red_parser_types_normalize_valid_and_reject_invalid_input():
    cases=[
      ('BOOLEAN','Да',True),('BOOLEAN','не требуется',False),('MONEY','100 тыс. руб.',100000.0),
      ('PERCENT','20 процентов',20.0),('INTEGER','10 дней',10),('DATE','31.10.2026','2026-10-31'),
      ('LIST','2026-10 и 2026-11',['2026-10','2026-11']),('OGRNIP','123456789012345','123456789012345'),
      ('STRING','Проведение тренировок по плаванию','Проведение тренировок по плаванию'),
    ]
    for parser,text,expected in cases:
        pending={'phase':'RED_FIELDS','parser_type':parser,'target_paths':['value'],'question':'Укажите значение','answer_mapping':{}}
        patch,used,error=parse_pending_red_answer(text,pending)
        assert error is None and patch['value']==expected and used
    pending={'phase':'RED_FIELDS','parser_type':'PERCENT','target_paths':['value'],'question':'Укажите процент','answer_mapping':{}}
    assert parse_pending_red_answer('150%',pending)[0]=={} and parse_pending_red_answer('150%',pending)[2]


def test_general_extractor_closes_multiple_red_dependencies_in_one_message():
    patch=extract_training_facts('Исполнитель ИП Иванов Иван Иванович, ОГРНИП 123456789012345, НДС не облагается, стоимость договора 120 000 рублей, оплата после оказания услуг в течение 10 дней.')
    assert patch['contractor']['status']=='IP_NO_NPD'
    assert patch['ip']['ogrnip']=='123456789012345'
    assert patch['tax']['vat_status']=='NO_VAT'
    assert patch['price']['total']==120000
    assert patch['payment']['model']=='POSTPAY' and patch['payment']['postpay_days']==10
    payment=extract_training_facts('30% авансом за 5 дней, остаток 70% после оказания услуг за 10 дней')
    assert payment['payment']=={'advance_percent':30.0,'advance_days':5,'postpay_percent':70.0,'postpay_days':10,'model':'MIXED'}


def test_matrix_and_both_renderers_preserve_sources(tmp_path):
    assert len(load_occurrences(CONTRACT_ROOT))==74
    for status in ('PHYSICAL_NO_IP_NO_NPD','IP_NO_NPD'):
        decision=decide_training(complete_facts(status)); source_name='Шаблон_тренировки_физлицо.docx' if status.startswith('PHYSICAL') else 'Шаблон_тренировки_ИП.docx'
        source=TRAINING/source_name; digest=hashlib.sha256(source.read_bytes()).hexdigest(); output=tmp_path/f'{status}.docx'
        result=render_training_contract(CONTRACT_ROOT,complete_facts(status),decision,output)
        assert result['occurrences']==74 and not result['mapping_errors'] and output.stat().st_size>1000
        assert hashlib.sha256(source.read_bytes()).hexdigest()==digest
        document=Document(output); text='\n'.join(p.text for p in document.paragraphs)+'\n'+'\n'.join(c.text for t in document.tables for r in t.rows for c in r.cells)
        assert 'Проведение тренировок' in text and 'красным' not in text.lower()


def test_xlsx_export_contains_summary_items_and_requirements(tmp_path):
    path=tmp_path/'spec.xlsx'
    data={'subject':'Поставка ноутбуков','purpose':'Оснащение','scope':'2 штуки','deadline':'2026-12-01','acceptance_criteria':'По количеству и характеристикам','items':[{'name':'MacBook Pro','characteristics':'M4, 24 ГБ','quantity':2,'unit':'шт.','warranty':'12 месяцев','delivery_address':'Екатеринбург'}],'blocking_requirements':['Только новое оборудование']}
    generate_xlsx(data,path); sheet=openpyxl.load_workbook(path).active
    assert sheet['B3'].value=='Поставка ноутбуков' and sheet['B6'].value=='2026-12-01' and sheet['B7'].value=='По количеству и характеристикам'
    assert sheet['B11'].value=='MacBook Pro' and sheet['C11'].value=='M4, 24 ГБ' and sheet['D11'].value==2
    assert sheet['G11'].value=='12 месяцев' and sheet['I11'].value=='Екатеринбург' and 'Только новое' in sheet['B12'].value
