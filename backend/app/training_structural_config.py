"""Idempotent, fail-closed materialization of unambiguous training DOCX regions."""
from __future__ import annotations

import copy
from datetime import datetime, timezone

from app.contract_platform import RegionPayload, _resolve_region, _resolve_repeating_row, adapter, safe_source, validate_repeating_groups
from app.db import (
    ConditionalDocumentRegion, DocumentTemplate, QuestionnaireSchema, RepeatingGroup,
    RepeatingGroupField, TemplateAuditEvent, TemplateVersion, User,
)


PAYMENT_BLOCKS = {
    "O007": (58, 59, "PREPAY"),
    "O009": (60, 62, "MIXED"),
    "O011": (63, 64, "POSTPAY"),
}


def _condition(field_key: str, value) -> dict:
    return {"operator": "EQUALS", "field_key": field_key, "value": value}


def _region_spec(candidate: dict) -> tuple[str, str, str | None, dict] | None:
    occurrence = candidate["occurrence_id"]
    if occurrence in PAYMENT_BLOCKS:
        start, end, value = PAYMENT_BLOCKS[occurrence]
        return (
            "CONDITIONAL_PARAGRAPH_GROUP",
            f"word/document.xml#/p[{start}]",
            f"word/document.xml#/p[{end}]",
            _condition("payment.model", value),
        )
    if candidate["rf_id"] == "RF020":
        return "CONDITIONAL_TABLE_COLUMN", candidate["locator"], None, _condition("schedule.place_column", True)
    if candidate["rf_id"] == "RF022" and candidate["status"] == "CANDIDATE_FOUND":
        return "CONDITIONAL_TABLE_ROW", candidate["locator"], None, _condition("extra_option.enabled", True)
    return None


def _review_reason(candidate: dict) -> tuple[str, str]:
    if candidate["rf_id"] == "RF002":
        return ("LEGAL_BOUNDARY", "Подтвердить, удаляется ли вся строка «иные Приложения» или только пояснение в скобках.")
    if candidate["rf_id"] == "RF008":
        return ("NESTED_CONDITION", "Подтвердить банковскую гарантию; затем вынести оговорку в непересекающийся условный фрагмент.")
    if candidate["rf_id"] == "RF021":
        return ("MULTI_ROW_REPEAT", "Выбрать строку/блок графика: утверждённый DOCX чередует объединённую строку месяца и строку занятия, а движок повторяет одну строку.")
    return ("SPECIALIST_CONFIRMATION", "Подтвердить юридический смысл и предложенную структурную область.")


def configure_training_regions(session, actor: User) -> dict:
    result = {"versions": 0, "regions_created": 0, "regions_existing": 0, "moved_to_review": 0}
    versions = session.query(TemplateVersion).filter_by(status="DRAFT").all()
    for version in versions:
        metadata = copy.deepcopy(version.preview_metadata or {})
        candidates = metadata.get("binding_candidates") or []
        if not candidates:
            continue
        schema = session.query(QuestionnaireSchema).filter_by(template_version_id=version.id).first()
        if not schema:
            continue
        changed = False
        configured = 0
        for candidate in candidates:
            if candidate.get("status") == "CONFIGURED":
                continue
            spec = _region_spec(candidate)
            if spec:
                region_type, start, end, condition = spec
                region_key = f"r363.{candidate['occurrence_id'].lower()}"
                region = session.query(ConditionalDocumentRegion).filter_by(
                    template_version_id=version.id, region_key=region_key
                ).first()
                if region is None:
                    payload = RegionPayload(
                        region_key=region_key, region_type=region_type,
                        start_locator=start, end_locator=end, include_when=condition,
                    )
                    locator, original = _resolve_region(safe_source(version), payload, version.structure_fingerprint)
                    region = ConditionalDocumentRegion(
                        template_version_id=version.id, region_key=region_key,
                        region_type=region_type, locator=locator, include_when=condition,
                        original_text=original, created_by_id=actor.id,
                    )
                    session.add(region)
                    session.flush()
                    result["regions_created"] += 1
                else:
                    result["regions_existing"] += 1
                candidate.update({
                    "status": "CONFIGURED", "materialized_type": "CONDITIONAL_DOCUMENT_REGION",
                    "materialized_id": region.id, "materialization_source": "AUTO_EXACT_STRUCTURAL",
                    "materialized_at": datetime.now(timezone.utc).isoformat(),
                })
                configured += 1
                changed = True
            elif candidate.get("status") == "CANDIDATE_FOUND":
                reason, action = _review_reason(candidate)
                candidate["status"] = "REVIEW_REQUIRED"
                candidate["review_group"] = f"{candidate['rf_id']}:{reason}"
                candidate["review_reason"] = reason
                candidate["required_specialist_action"] = action
                result["moved_to_review"] += 1
                changed = True
            elif candidate.get("status") in {"REVIEW_REQUIRED", "BLOCKED"} and not candidate.get("required_specialist_action"):
                reason, action = _review_reason(candidate)
                candidate["review_group"] = f"{candidate['rf_id']}:{candidate.get('operation')}:{reason}"
                candidate["review_reason"] = reason
                candidate["required_specialist_action"] = action
                changed = True
        if changed:
            metadata["binding_candidates"] = candidates
            metadata["r363_structural_configuration"] = {
                "configured_regions": configured,
                "configured_at": datetime.now(timezone.utc).isoformat(),
                "mode": "FAIL_CLOSED",
            }
            version.preview_metadata = metadata
            template = session.get(DocumentTemplate, version.template_id)
            session.add(TemplateAuditEvent(
                template_id=template.id, template_version_id=version.id, actor_id=actor.id,
                event_type="R363_STRUCTURAL_CONFIGURATION_APPLIED",
                metadata_json={"configured_regions": configured},
            ))
            result["versions"] += 1
    session.commit()
    return result


SCHEDULE_FIELDS = (
    ("month", "Месяц", "TEXT", True, 2, 1, False),
    ("date", "Дата", "DATE", True, 3, 1, False),
    ("weekday", "День недели", "TEXT", True, 3, 2, False),
    ("time", "Время", "TEXT", True, 3, 3, False),
    ("quantity", "Количество тренировок", "INTEGER", True, 3, 4, False),
    ("price", "Стоимость одной тренировки", "MONEY", True, 3, 5, False),
    ("total", "Стоимость строки", "MONEY", False, 3, 6, True),
    ("place", "Место проведения", "TEXT", False, 3, 7, False),
)


def configure_training_schedules(session, actor: User) -> dict:
    """Configure one logical schedule rendered into both approved tables."""
    result={"groups_created":0,"groups_existing":0,"fields_created":0,"candidates_materialized":0}
    for version in session.query(TemplateVersion).filter_by(status="DRAFT").all():
        metadata=copy.deepcopy(version.preview_metadata or {});candidates=metadata.get("binding_candidates") or []
        if not any(x.get("rf_id")=="RF021" for x in candidates):continue
        group=session.query(RepeatingGroup).filter_by(template_version_id=version.id,group_key="schedule.entries").first()
        if group is None:
            primary=_resolve_repeating_row(safe_source(version),"word/document.xml#/tbl[2]/tr[2]/tc[1]/p[1]",version.structure_fingerprint,"word/document.xml#/tbl[2]/tr[3]/tc[1]/p[1]",2,6)
            secondary=_resolve_repeating_row(safe_source(version),"word/document.xml#/tbl[7]/tr[2]/tc[1]/p[1]",version.structure_fingerprint,"word/document.xml#/tbl[7]/tr[3]/tc[1]/p[1]",2,3)
            primary["targets"]=[copy.deepcopy(primary),secondary]
            group=RepeatingGroup(template_version_id=version.id,group_key="schedule.entries",name="График тренировок",description="Добавьте тренировки в требуемом порядке",min_items=1,max_items=10,required=True,position=1,config={"visible_when":None},locator=primary,created_by_id=actor.id)
            session.add(group);session.flush();result["groups_created"]+=1
        else:result["groups_existing"]+=1
        preview={x["locator"]:x for x in adapter.preview(safe_source(version))["nodes"]}
        for position,(key,label,kind,required,row,cell,calculated) in enumerate(SCHEDULE_FIELDS,1):
            field=session.query(RepeatingGroupField).filter_by(group_id=group.id,field_key=key).first()
            if field is None:
                config={"description":"","placeholder":"","validation":{},"options":[],"calculated":calculated,"expression":{"operation":"MULTIPLY","operands":[{"source":"ROW_FIELD","field_key":"quantity"},{"source":"ROW_FIELD","field_key":"price"}]} if calculated else None,"precision":2,"rounding":"HALF_UP","output_format":"MONEY" if kind=="MONEY" else "DATE" if kind=="DATE" else "RAW"}
                field=RepeatingGroupField(group_id=group.id,field_key=key,label=label,field_type=kind,required=required,position=position,config=config);session.add(field);session.flush();result["fields_created"]+=1
            if not field.locator:
                node_locator=f"word/document.xml#/tbl[2]/tr[{row}]/tc[{cell}]/p[1]";node=preview[node_locator];selected=node["text"]
                loc=adapter.get_structural_locator(safe_source(version),adapter.select_range(safe_source(version),node_locator,0,len(selected),selected));loc["selected_text"]=selected;field.locator=loc
        now=datetime.now(timezone.utc).isoformat()
        for candidate in candidates:
            if candidate.get("rf_id")=="RF021" and candidate.get("status")!="CONFIGURED":
                candidate.update({"status":"CONFIGURED","materialized_type":"REPEATING_GROUP","materialized_id":group.id,"materialization_source":"AUTO_EXACT_MULTIROW","materialized_at":now});result["candidates_materialized"]+=1
        metadata["binding_candidates"]=candidates;metadata["r364_multirow_schedule"]={"group_id":group.id,"row_count":2,"targets":2,"configured_at":now};version.preview_metadata=metadata
        session.flush();validate_repeating_groups(version,session)
        session.add(TemplateAuditEvent(template_id=version.template_id,template_version_id=version.id,actor_id=actor.id,event_type="R364_MULTIROW_SCHEDULE_CONFIGURED",metadata_json={"group_id":group.id,"targets":2,"row_count":2}))
    session.commit();return result
