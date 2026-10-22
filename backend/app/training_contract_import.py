"""Idempotent, fail-closed R3.6.1 import of the training-product draft."""
from __future__ import annotations

import hashlib
from pathlib import Path

from openpyxl import load_workbook

from app.db import (
    ContractProduct, ContractProductAuditEvent, ContractProductField,
    ContractProductVersion, DocumentTemplate, SessionLocal, TemplateVersion,
)
from app.training_contract_audit import EXPECTED, audit_training_sources

PRODUCT_CODE = "TRAINING_CONTRACT"
PRODUCT_NAME = "Договор на проведение тренировок"
UNSUPPORTED_FACT_TYPES = {"ARRAY_STRING", "ARRAY_OBJECT"}
TYPE_MAP = {"ENUM": "SINGLE_SELECT", "BOOLEAN": "BOOLEAN", "STRING": "TEXT", "DECIMAL": "DECIMAL", "INTEGER": "INTEGER", "DATE": "DATE"}


def _options(raw):
    values = [x.strip() for x in str(raw or "").split("|")]
    return [x for x in values if x and x not in {"true", "false", "null"}]


def build_plan(root: Path) -> dict:
    audit = audit_training_sources(root)
    workbook = load_workbook(root / "Матрица_применимости_LLM_v2.xlsx", data_only=True)
    fields = []
    blocked = []
    for position, row in enumerate(workbook["FACT_SCHEMA"].iter_rows(min_row=2, values_only=True), 1):
        key, source_type, requirement, allowed, meaning, question, default = row
        if source_type in UNSUPPORTED_FACT_TYPES:
            blocked.append({"key": key, "reason": f"Тип {source_type} не поддержан универсальным полем"})
            continue
        kind = TYPE_MAP[source_type]
        config = {"group": "Применимость" if position <= 12 else "Условия договора", "description": meaning or "", "source_requirement": requirement}
        if kind == "SINGLE_SELECT": config["options"] = _options(allowed)
        if key == "ip.ogrnip": config["validation"] = {"regex": "^[0-9]{15}$"}
        fields.append({"field_key": key, "label": question if question and question != "—" else meaning or key, "field_type": kind, "required": requirement in {"CRITICAL", "REQUIRED_TO_RENDER"}, "position": position, "config": config})
    blockers = [
        {"code": "DRAFT_TEMPLATE_VERSIONS", "severity": "P0", "detail": "Оба реальных TemplateVersion не опубликованы; варианты продукта создавать нельзя"},
        {"code": "TEXT_DERIVATION", "severity": "P0", "detail": "Нет декларативных текстовых expressions для RF003/004/006/009/015/017/018/019"},
        {"code": "TABLE_COLUMN_OPERATION", "severity": "P0", "detail": "Нет безопасной операции целой колонки для RF020"},
        {"code": "COMPOSITE_AND_ARRAY", "severity": "P0", "detail": "Нет composite/array полей для RF002/RF021/RF024"},
        {"code": "REAL_BINDINGS_MISSING", "severity": "P0", "detail": "74 occurrence не имеют проверенных structural bindings"},
    ]
    signature = hashlib.sha256((audit["files"]["Матрица_применимости_LLM_v2.xlsx"]["sha256"] + PRODUCT_CODE).encode()).hexdigest()
    return {"signature": signature, "audit": audit, "fields": fields, "unsupported_facts": blocked, "blockers": blockers, "source_counts": {"facts": 40, "rf_fields": 25, "occurrences": 74, "scenarios": 120}}


def apply_plan(plan: dict, owner, session=None) -> dict:
    own_session = session is None
    session = session or SessionLocal()
    try:
        product = session.query(ContractProduct).filter_by(owner_id=owner.id, code=PRODUCT_CODE).first()
        created_product = product is None
        if product is None:
            product = ContractProduct(owner_id=owner.id, code=PRODUCT_CODE, name=PRODUCT_NAME, category="Усуги", description="Черновой пилот по матрице R3.6.1")
            session.add(product); session.flush()
            version = ContractProductVersion(product_id=product.id, version_number=1, created_by_id=owner.id, rules={"import_signature": plan["signature"], "blocking_rules": [], "manual_review_rules": [], "test_scenarios": []})
            session.add(version); session.flush()
        else:
            version = session.query(ContractProductVersion).filter_by(product_id=product.id, status="DRAFT").order_by(ContractProductVersion.version_number.desc()).first()
            if version is None:
                raise ValueError("У продукта нет черновой версии; опубликованные версии не изменяются")
        existing = {x.field_key for x in session.query(ContractProductField).filter_by(product_version_id=version.id)}
        created = 0
        for item in plan["fields"]:
            if item["field_key"] in existing: continue
            session.add(ContractProductField(product_version_id=version.id, **item)); created += 1
        if created_product:
            session.add(ContractProductAuditEvent(product_id=product.id, product_version_id=version.id, actor_id=owner.id, event_type="R361_DRAFT_IMPORTED", metadata_json={"signature": plan["signature"]}))
        session.commit()
        return {"product_id": product.id, "version_id": version.id, "created_product": created_product, "created_fields": created, "total_fields": session.query(ContractProductField).filter_by(product_version_id=version.id).count(), "variants_created": 0, "published": False}
    except Exception:
        session.rollback(); raise
    finally:
        if own_session: session.close()
