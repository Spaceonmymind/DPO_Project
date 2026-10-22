from types import SimpleNamespace
from xml.etree import ElementTree as ET

import pytest

from app.calculations import CalculationError, TextExpressionEngine
from app.contract_platform import NS, WORD_NS, _column_layout, _remove_table_column, render_value, validate_answer


def field(key, kind="TEXT", config=None):
    return SimpleNamespace(field_key=key, field_type=kind, config=config or {}, required=False, label=key)


def test_text_expression_concat_condition_and_rejects_unknown_source():
    fields=[field("kind","SINGLE_SELECT",{"options":["IP","PERSON"]}),field("name")]
    expression={"operation":"IF","condition":{"operator":"EQUALS","field_key":"kind","value":"IP"},"then":{"operation":"CONCAT","parts":[{"literal":"ИП "},{"field_key":"name"}]},"else":{"field_key":"name"}}
    TextExpressionEngine.validate(expression,fields)
    assert TextExpressionEngine.evaluate(expression,{"kind":"IP","name":"Иванов"})=="ИП Иванов"
    with pytest.raises(CalculationError):TextExpressionEngine.validate({"field_key":"missing"},fields)
    with pytest.raises(CalculationError):TextExpressionEngine.validate({"operation":"PYTHON","code":"1+1"},fields)


def test_list_and_composite_validation_and_rendering():
    listing=field("appendices","LIST",{"item_config":{"min_items":0,"max_items":2,"max_length":20},"separator":"; "})
    assert validate_answer(listing,[]) is None
    assert validate_answer(listing,["А","Б"]) is None
    assert validate_answer(listing,["А","Б","В"])
    assert render_value(listing,["А","Б"])=="А; Б"
    composite=field("passport","COMPOSITE",{"components":[{"key":"series","label":"Серия","required":True},{"key":"number","label":"Номер","required":True}],"separator":" "})
    assert validate_answer(composite,{"series":"1234"})
    assert validate_answer(composite,{"series":"1234","number":"567890"}) is None
    assert render_value(composite,{"series":"1234","number":"567890"})=="1234 567890"
    nested=field("party","COMPOSITE",{"components":[{"key":"identity","label":"Документ","required":True,"type":"COMPOSITE","components":[{"key":"number","label":"Номер","required":True,"type":"TEXT"}]}]})
    assert validate_answer(nested,{"identity":{}})
    assert validate_answer(nested,{"identity":{"number":"42"}}) is None


def table_xml(merged=False,vertical=False):
    span='<w:gridSpan w:val="2"/>' if merged else ''
    vm='<w:vMerge w:val="restart"/>' if vertical else ''
    return ET.fromstring(f'''<w:tbl xmlns:w="{WORD_NS}"><w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="200"/><w:gridCol w:w="300"/></w:tblGrid><w:tr><w:tc><w:tcPr>{span}</w:tcPr><w:p/></w:tc><w:tc><w:tcPr>{vm}</w:tcPr><w:p/></w:tc></w:tr></w:tbl>''')


def test_column_removal_updates_grid_span_and_preserves_grid_width():
    table=table_xml(merged=True)
    before=sum(int(x.get(f"{{{WORD_NS}}}w")) for x in table.findall('./w:tblGrid/w:gridCol',NS))
    _remove_table_column(table,2)
    columns=table.findall('./w:tblGrid/w:gridCol',NS)
    assert len(columns)==2 and sum(int(x.get(f"{{{WORD_NS}}}w")) for x in columns)==before
    assert table.find('.//w:gridSpan',NS) is None


def test_column_removal_rejects_vertical_merge_conflict():
    with pytest.raises(ValueError,match="вертикально"):_column_layout(table_xml(vertical=True),2)
