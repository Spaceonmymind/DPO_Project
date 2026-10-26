"""Fail-closed checks for pilot-only source-preserved and inapplicable clauses."""
import hashlib
from pathlib import Path
from types import SimpleNamespace

import pytest
from docx import Document

from app import binding_materialization as materialization
from app.contract_platform import adapter
from app.contract_platform import render_value, validate_answer
from app.conditions import ConditionEngine


ROOT = Path(__file__).resolve().parents[2] / "contract_templates" / "training"
SOURCE = ROOT / "Шаблон_тренировки_ИП.docx"


def _case(monkeypatch, tmp_path, status, rf_id, occurrence, operation):
    monkeypatch.setattr(materialization, "safe_source", lambda _version: SOURCE)
    monkeypatch.setattr(materialization.settings, "contract_templates_path", str(ROOT.parent))
    preview = adapter.preview(SOURCE)
    version = SimpleNamespace(
        status="DRAFT", source_sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        structure_fingerprint=preview["structure_fingerprint"],
    )
    proof = {
        "decision": "PILOT_SOURCE_PRESERVED" if status == "SOURCE_PRESERVED" else "PILOT_NOT_APPLICABLE",
        "source_sha256": version.source_sha256,
        "matrix_sha256": hashlib.sha256((ROOT / "Матрица_применимости_LLM_v2.xlsx").read_bytes()).hexdigest(),
        "structure_fingerprint": version.structure_fingerprint,
    }
    if status == "SOURCE_PRESERVED":
        nodes = {n["locator"]: n["text"] for n in preview["nodes"]}
        proof["locators"] = [f"word/document.xml#/p[{i}]" for i in range(119, 128)]
        proof["node_sha256"] = {loc: hashlib.sha256(nodes[loc].encode()).hexdigest() for loc in proof["locators"]}
        folder = tmp_path / "training-combined-diagnostics"
        folder.mkdir()
        monkeypatch.setattr(materialization.settings, "storage", str(tmp_path))
        proof["diagnostic_sha256"] = {}
        for name in ("ip-guarantee-0.docx", "ip-guarantee-1.docx"):
            doc = Document()
            for loc in proof["locators"]:
                doc.add_paragraph(nodes[loc])
            path = folder / name
            doc.save(path)
            proof["diagnostic_sha256"][name] = hashlib.sha256(path.read_bytes()).hexdigest()
    candidate = {
        "status": status, "rf_id": rf_id, "occurrence_id": occurrence,
        "operation": operation, "variant": "INDIVIDUAL_ENTREPRENEUR",
        "structure_fingerprint": version.structure_fingerprint, "resolution_proof": proof,
    }
    return version, candidate


def test_absent_npd_clause_is_verified_without_deletion(monkeypatch, tmp_path):
    version, candidate = _case(monkeypatch, tmp_path, "NOT_APPLICABLE", "RF011", "O014", "DELETE")
    assert materialization.verified_training_exception(version, candidate)
    candidate["rf_id"] = "RF013"
    assert not materialization.verified_training_exception(version, candidate)


def test_applicable_clause_cannot_be_marked_inapplicable(monkeypatch, tmp_path):
    version, candidate = _case(monkeypatch, tmp_path, "NOT_APPLICABLE", "RF013", "O016", "INCLUDE")
    assert not materialization.verified_training_exception(version, candidate)


def test_preserved_warranties_require_every_original_paragraph(monkeypatch, tmp_path):
    version, candidate = _case(monkeypatch, tmp_path, "SOURCE_PRESERVED", "RF013", "O016", "INCLUDE")
    assert materialization.verified_training_exception(version, candidate)
    candidate["resolution_proof"]["node_sha256"].pop("word/document.xml#/p[127]")
    assert not materialization.verified_training_exception(version, candidate)


def test_exception_proof_is_pinned_to_matrix_and_source(monkeypatch, tmp_path):
    version, candidate = _case(monkeypatch, tmp_path, "NOT_APPLICABLE", "RF012", "O015", "DELETE")
    assert materialization.verified_training_exception(version, candidate)
    candidate["resolution_proof"]["matrix_sha256"] = "0" * 64
    assert not materialization.verified_training_exception(version, candidate)
    candidate["resolution_proof"]["matrix_sha256"] = hashlib.sha256((ROOT / "Матрица_применимости_LLM_v2.xlsx").read_bytes()).hexdigest()
    version.source_sha256 = "0" * 64
    assert not materialization.verified_training_exception(version, candidate)


def test_optional_appendices_preserve_order_and_start_at_three():
    field = SimpleNamespace(field_type="LIST", required=False, config={
        "separator": "; ",
        "item_config": {"min_items": 0, "max_items": 50, "max_length": 500},
        "numbering": {"start": 3, "item_prefix": "Приложение № ", "name_separator": " — ", "prefix": ": "},
    })
    condition = {"operator": "IS_NOT_EMPTY", "field_key": "appendices.other"}
    assert not ConditionEngine.evaluate(condition, {"appendices.other": []})
    assert render_value(field, []) == ""
    values = ["План", "Смета"]
    assert validate_answer(field, values) is None
    assert ConditionEngine.evaluate(condition, {"appendices.other": values})
    assert render_value(field, values) == ": Приложение № 3 — План; Приложение № 4 — Смета"


def test_composite_component_validation_rejects_bad_date():
    field = SimpleNamespace(field_type="COMPOSITE", required=True, config={
        "components": [
            {"key": "issuer", "label": "Орган выдачи", "type": "TEXT", "required": True},
            {"key": "issued_on", "label": "Дата выдачи", "type": "DATE", "required": True},
        ],
    })
    assert validate_answer(field, {"issuer": "МВД", "issued_on": "не дата"})
    assert validate_answer(field, {"issuer": "МВД", "issued_on": "2025-01-31"}) is None
