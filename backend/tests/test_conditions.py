from types import SimpleNamespace
import pytest

from app.conditions import ConditionConfigurationError,ConditionEngine


def field(key,kind='TEXT',options=None,visible=None,required=None):
    return SimpleNamespace(field_key=key,field_type=kind,required=False,config={
        'options':options or [],'visible_when':visible,'required_when':required,
    })


@pytest.mark.parametrize(('operator','actual','expected','result'),[
    ('EQUALS','x','x',True),('NOT_EQUALS','x','y',True),
    ('IN','x',['x','y'],True),('NOT_IN','z',['x','y'],True),
    ('GREATER_THAN',11,10,True),('LESS_THAN',9,10,True),
    ('GREATER_OR_EQUAL',10,10,True),('LESS_OR_EQUAL',10,10,True),
])
def test_condition_engine_comparison_operators(operator,actual,expected,result):
    condition={'operator':operator,'field_key':'source','value':expected}
    assert ConditionEngine.evaluate(condition,{'source':actual}) is result


def test_condition_engine_empty_and_nested_groups():
    answers={'kind':'MIXED','percent':30,'note':''}
    condition={'operator':'AND','conditions':[
        {'operator':'OR','conditions':[
            {'operator':'EQUALS','field_key':'kind','value':'PREPAY'},
            {'operator':'EQUALS','field_key':'kind','value':'MIXED'},
        ]},
        {'operator':'NOT','condition':{'operator':'LESS_THAN','field_key':'percent','value':10}},
        {'operator':'IS_EMPTY','field_key':'note'},
    ]}
    assert ConditionEngine.evaluate(condition,answers)
    assert ConditionEngine.evaluate({'operator':'IS_NOT_EMPTY','field_key':'kind'},answers)


def test_condition_schema_rejects_unknown_fields_wrong_types_and_cycles():
    unknown=field('target',visible={'operator':'EQUALS','field_key':'missing','value':'x'})
    with pytest.raises(ConditionConfigurationError,match='не найдено'): ConditionEngine.validate_schema([unknown])
    wrong=field('target',visible={'operator':'GREATER_THAN','field_key':'name','value':'x'})
    with pytest.raises(ConditionConfigurationError,match='несовместим'): ConditionEngine.validate_schema([field('name'),wrong])
    a=field('a',visible={'operator':'EQUALS','field_key':'b','value':'x'})
    b=field('b',visible={'operator':'EQUALS','field_key':'a','value':'x'})
    with pytest.raises(ConditionConfigurationError,match='циклическая'): ConditionEngine.validate_schema([a,b])


def test_condition_schema_rejects_bad_values_depth_and_size():
    select=field('choice','SINGLE_SELECT',['A','B'])
    target=field('target',visible={'operator':'EQUALS','field_key':'choice','value':'C'})
    with pytest.raises(ConditionConfigurationError,match='несовместимо'): ConditionEngine.validate_schema([select,target])
    node={'operator':'EQUALS','field_key':'choice','value':'A'}
    for _ in range(ConditionEngine.MAX_DEPTH): node={'operator':'NOT','condition':node}
    deep=field('deep',visible=node)
    with pytest.raises(ConditionConfigurationError,match='Глубина'): ConditionEngine.validate_schema([select,deep])
    too_large={'operator':'OR','conditions':[{'operator':'EQUALS','field_key':'choice','value':'A'} for _ in range(ConditionEngine.MAX_NODES)]}
    large=field('large',visible=too_large)
    with pytest.raises(ConditionConfigurationError,match='больше'): ConditionEngine.validate_schema([select,large])


def test_field_state_keeps_static_fields_compatible():
    regular=field('regular'); regular.required=True
    assert ConditionEngine.field_state(regular,{})=={'visible':True,'required':True}
    hidden=field('hidden',visible={'operator':'EQUALS','field_key':'switch','value':True},required={'operator':'IS_NOT_EMPTY','field_key':'switch'})
    assert ConditionEngine.field_state(hidden,{'switch':False})=={'visible':False,'required':False}
