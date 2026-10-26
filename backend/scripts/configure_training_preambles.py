"""Configure exact performer placeholders in approved training drafts."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import datetime, timezone

from app.binding_materialization import verified_binding_coverage
from app.contract_platform import adapter, safe_source
from app.db import DocumentBinding, QuestionnaireField, QuestionnaireSchema, SessionLocal, TemplateAuditEvent, TemplateVersion


VERSIONS = {
    "INDIVIDUAL_ENTREPRENEUR": ("4eff6663-f03e-4858-bb2a-6dc39b4b1b95", 47, 294),
    "PHYSICAL_PERSON": ("3dbdc61e-953b-49ce-a5c7-57df2613e454", 47, 286),
}
NAME_PLACEHOLDER = "[Ф.И.О. Исполнителя]"
OGRNIP_PLACEHOLDER = "[__________]"


def run(apply=False):
    session = SessionLocal()
    results = []
    try:
        for variant, (version_id, contract_p, act_p) in VERSIONS.items():
            version = session.get(TemplateVersion, version_id)
            if not version or version.status != "DRAFT":
                raise ValueError(f"Версия {variant} не DRAFT")
            source = safe_source(version)
            if hashlib.sha256(source.read_bytes()).hexdigest() != version.source_sha256:
                raise ValueError("Исходный DOCX изменился")
            preview = adapter.preview(source)
            if preview["structure_fingerprint"] != version.structure_fingerprint:
                raise ValueError("Структура исходного DOCX изменилась")
            nodes = {node["locator"]: node["text"] for node in preview["nodes"]}
            schema = session.query(QuestionnaireSchema).filter_by(template_version_id=version.id).one()
            fields = {f.field_key: f for f in session.query(QuestionnaireField).filter_by(schema_id=schema.id)}
            performer = fields.get("party.performer_name")
            if not performer and apply:
                performer = QuestionnaireField(
                    schema_id=schema.id, field_key="party.performer_name", label="ФИО исполнителя",
                    field_type="TEXT", required=True,
                    position=max((f.position for f in fields.values()), default=0) + 1,
                    config={"group": "Сведения об исполнителе", "description": "Одно ФИО для договора и акта", "max_length": 200},
                )
                session.add(performer)
                session.flush()
                fields[performer.field_key] = performer
            if performer and not performer.required:
                raise ValueError("ФИО исполнителя должно быть обязательным")
            if variant == "INDIVIDUAL_ENTREPRENEUR":
                ogrnip = fields.get("ip.ogrnip")
                if not ogrnip or not ogrnip.required:
                    raise ValueError("ОГРНИП должен быть обязательным полем")
            metadata = copy.deepcopy(version.preview_metadata or {})
            candidates = metadata.get("binding_candidates") or []
            for rf, occurrence, paragraph in (("RF004", "O004", contract_p), ("RF017", "O020", act_p)):
                node = f"word/document.xml#/p[{paragraph}]"
                text = nodes.get(node)
                if not text or text.count(NAME_PLACEHOLDER) != 1:
                    raise ValueError(f"ФИО не найдено ровно один раз в {node}")
                placeholders = [("party.performer_name", NAME_PLACEHOLDER)]
                if variant == "INDIVIDUAL_ENTREPRENEUR":
                    if text.count(OGRNIP_PLACEHOLDER) != 1 or f"ОГРНИП {OGRNIP_PLACEHOLDER}" not in text:
                        raise ValueError(f"ОГРНИП не найден ровно один раз в {node}")
                    placeholders.append(("ip.ogrnip", OGRNIP_PLACEHOLDER))
                candidate = next(c for c in candidates if c["candidate_id"] == f"{occurrence}:{variant}")
                if candidate["rf_id"] != rf or candidate["operation"] != "DERIVED" or candidate["structure_fingerprint"] != version.structure_fingerprint:
                    raise ValueError(f"Несоответствие кандидата {occurrence}:{variant}")
                entries = []
                for key, placeholder in placeholders:
                    start = text.index(placeholder)
                    selected = adapter.select_range(source, node, start, start + len(placeholder), placeholder)
                    locator = adapter.get_structural_locator(source, selected)
                    existing = [b for b in session.query(DocumentBinding).filter_by(template_version_id=version.id, status="ACTIVE") if (b.locator or {}).get("node") == node and b.selected_text == placeholder]
                    if len(existing) > 1:
                        raise ValueError(f"Дублирующие привязки в {node}")
                    binding = existing[0] if existing else None
                    if binding and binding.binding_key != key:
                        raise ValueError(f"Плейсхолдер {node} привязан к другому полю")
                    if not binding and apply:
                        binding = DocumentBinding(
                            template_version_id=version.id, field_id=fields[key].id, binding_key=key,
                            occurrence_index=int(occurrence[1:]), locator=locator,
                            selected_text=placeholder, format_config={}, created_by_id=version.created_by_id,
                        )
                        session.add(binding)
                        session.flush()
                    entries.append({"id": binding.id if binding else None, "binding_key": key, "selected_text": placeholder})
                proof = {
                    "source_sha256": version.source_sha256,
                    "structure_fingerprint": version.structure_fingerprint,
                    "bindings": entries,
                }
                if apply:
                    candidate["status"] = "BINDING_COVERAGE"
                    candidate["coverage_proof"] = proof
                    if not verified_binding_coverage(session, version, candidate):
                        raise ValueError(f"Покрытие {occurrence}:{variant} не подтверждено")
                    session.add(TemplateAuditEvent(
                        template_id=version.template_id, template_version_id=version.id,
                        actor_id=version.created_by_id, event_type="TRAINING_PREAMBLE_BINDINGS_VERIFIED",
                        metadata_json={"candidate_id": candidate["candidate_id"], "proof": proof},
                    ))
                results.append({"candidate_id": candidate["candidate_id"], "bindings": entries, "verified": apply})
            if apply:
                metadata["binding_candidates"] = candidates
                version.preview_metadata = metadata
                session.commit()
        return results
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    arguments = parser.parse_args()
    print(json.dumps(run(arguments.apply), ensure_ascii=False, indent=2))
