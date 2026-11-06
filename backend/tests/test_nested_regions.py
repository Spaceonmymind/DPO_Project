from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import zipfile
from xml.etree import ElementTree as ET

import pytest
from docx import Document

from app.contract_platform import _regions_overlap, render_docx


PART = 'word/document.xml'


def region(key, kind, **locator):
    return SimpleNamespace(id=key, region_key=key, region_type=kind, locator={'part': PART, **locator})


def render(source: Path, target: Path, regions, included):
    with patch('app.contract_platform.safe_source', return_value=source):
        render_docx(SimpleNamespace(), [], {}, target, regions, included)
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        for name in archive.namelist():
            if name.endswith('.xml'):
                ET.fromstring(archive.read(name))
    return Document(target)


@pytest.mark.parametrize('included,expected', [
    (set(), []),
    ({'outer'}, ['OUTER START', 'OUTER END']),
    ({'outer', 'inner'}, ['OUTER START', 'INNER', 'OUTER END']),
    ({'inner'}, []),
])
def test_nested_paragraph_regions(tmp_path, included, expected):
    source=tmp_path/'source.docx';target=tmp_path/'result.docx'
    doc=Document()
    for text in ('OUTER START','INNER','OUTER END','UNRELATED'): doc.add_paragraph(text)
    doc.save(source); original=source.read_bytes()
    outer=region('outer','CONDITIONAL_PARAGRAPH_GROUP',nodes=[f'{PART}#/p[{n}]' for n in (1,2,3)])
    inner=region('inner','CONDITIONAL_PARAGRAPH',node=f'{PART}#/p[2]',nodes=[f'{PART}#/p[2]'])
    assert not _regions_overlap(outer,inner)
    result=render(source,target,[outer,inner],included)
    assert [p.text for p in result.paragraphs]==expected+['UNRELATED']
    assert source.read_bytes()==original


def test_multiple_levels_and_crossing_ranges(tmp_path):
    source=tmp_path/'source.docx';target=tmp_path/'result.docx'
    doc=Document()
    for text in ('ONE','TWO','THREE','FOUR','FIVE'): doc.add_paragraph(text)
    doc.save(source)
    outer=region('outer','CONDITIONAL_PARAGRAPH_GROUP',nodes=[f'{PART}#/p[{n}]' for n in (1,2,3,4)])
    middle=region('middle','CONDITIONAL_PARAGRAPH_GROUP',nodes=[f'{PART}#/p[{n}]' for n in (2,3)])
    inner=region('inner','CONDITIONAL_PARAGRAPH',node=f'{PART}#/p[2]',nodes=[f'{PART}#/p[2]'])
    crossing=region('crossing','CONDITIONAL_PARAGRAPH_GROUP',nodes=[f'{PART}#/p[{n}]' for n in (3,4,5)])
    unrelated=region('unrelated','CONDITIONAL_PARAGRAPH',node=f'{PART}#/p[5]',nodes=[f'{PART}#/p[5]'])
    assert not _regions_overlap(outer,middle)
    assert not _regions_overlap(middle,inner)
    assert not _regions_overlap(middle,unrelated)
    assert _regions_overlap(outer,crossing)
    result=render(source,target,[outer,middle,inner],{'outer','middle'})
    assert [p.text for p in result.paragraphs]==['ONE','THREE','FOUR','FIVE']


def test_row_contains_run_without_removing_parent_when_run_false(tmp_path):
    source=tmp_path/'source.docx';target=tmp_path/'result.docx'
    doc=Document();table=doc.add_table(rows=1,cols=1);table.cell(0,0).text='Keep HIDE end';doc.save(source)
    node=f'{PART}#/tbl[1]/tr[1]/tc[1]/p[1]'
    row=region('row','CONDITIONAL_TABLE_ROW',table=1,row=1)
    run=region('run','CONDITIONAL_RUN',node=node,text_start=5,text_end=9)
    assert not _regions_overlap(row,run)
    kept=render(source,target,[row,run],{'row'})
    assert kept.tables[0].cell(0,0).text=='Keep  end'
    removed=render(source,target,[row,run],{'run'})
    assert len(removed.tables[0].rows)==0


def test_paragraph_contains_run_and_disjoint_region(tmp_path):
    source=tmp_path/'source.docx';target=tmp_path/'result.docx'
    doc=Document();doc.add_paragraph('Keep HIDE end');doc.add_paragraph('SECOND');doc.save(source)
    paragraph=region('paragraph','CONDITIONAL_PARAGRAPH',node=f'{PART}#/p[1]',nodes=[f'{PART}#/p[1]'])
    run=region('run','CONDITIONAL_RUN',node=f'{PART}#/p[1]',text_start=5,text_end=9)
    separate=region('separate','CONDITIONAL_PARAGRAPH',node=f'{PART}#/p[2]',nodes=[f'{PART}#/p[2]'])
    assert not _regions_overlap(paragraph,run)
    assert not _regions_overlap(paragraph,separate)
    assert _regions_overlap(run,region('crossing','CONDITIONAL_RUN',node=f'{PART}#/p[1]',text_start=7,text_end=11))
    result=render(source,target,[paragraph,run,separate],{'paragraph','separate'})
    assert [p.text for p in result.paragraphs]==['Keep  end','SECOND']
