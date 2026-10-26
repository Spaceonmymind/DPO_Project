"""Pilot configuration of ordered optional appendices in both DRAFT templates."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json

from app.binding_materialization import verified_list_region_coverage
from app.contract_platform import RegionPayload, _resolve_region, adapter, safe_source
from app.db import ConditionalDocumentRegion, DocumentBinding, QuestionnaireField, QuestionnaireSchema, SessionLocal, TemplateAuditEvent, TemplateVersion


VERSIONS = {
    "INDIVIDUAL_ENTREPRENEUR": "4eff6663-f03e-4858-bb2a-6dc39b4b1b95",
    "PHYSICAL_PERSON": "3dbdc61e-953b-49ce-a5c7-57df2613e454",
}
NODE = "word/document.xml#/p[17]"
TEXT = "- иные Приложения (указываются при наличии)"
PLACEHOLDER = " (указываются при наличии)"


def run(apply=False):
    session = SessionLocal()
    results = []
    try:
        for variant, version_id in VERSIONS.items():
            version = session.get(TemplateVersion, version_id)
            if not version or version.status != "DRAFT":
                raise ValueError("Версия не DRAFT")
            path = safe_source(version)
            if hashlib.sha256(path.read_bytes()).hexdigest() != version.source_sha256:
                raise ValueError("DOCX изменился")
            preview = adapter.preview(path)
            if preview["structure_fingerprint"] != version.structure_fingerprint or {n["locator"]: n["text"] for n in preview["nodes"]}.get(NODE) != TEXT:
                raise ValueError("Абзац приложений или структура DOCX изменились")
            schema = session.query(QuestionnaireSchema).filter_by(template_version_id=version.id).one()
            field = session.query(QuestionnaireField).filter_by(schema_id=schema.id, field_key="appendices.other").one()
            if field.field_type != "LIST" or field.required:
                raise ValueError("RF002 должен быть необязательным LIST")
            candidate_id = f"O002:{variant}"
            metadata = copy.deepcopy(version.preview_metadata or {})
            candidates = metadata.get("binding_candidates") or []
            candidate = next(c for c in candidates if c["candidate_id"] == candidate_id)
            if candidate["rf_id"] != "RF002" or candidate["operation"] != "REPLACE_OR_DELETE":
                raise ValueError("RF002 не совпадает с матрицей")
            region_locator, region_text = _resolve_region(path, RegionPayload(
                region_key="training_other_appendices", region_type="CONDITIONAL_PARAGRAPH",
                start_locator=NODE, include_when={"operator": "IS_NOT_EMPTY", "field_key": "appendices.other"},
            ), version.structure_fingerprint)
            selected = adapter.select_range(path, NODE, len("- иные Приложения"), len(TEXT), PLACEHOLDER)
            binding_locator = adapter.get_structural_locator(path, selected)
            region = session.query(ConditionalDocumentRegion).filter_by(template_version_id=version.id, region_key="training_other_appendices").first()
            binding = session.query(DocumentBinding).filter_by(template_version_id=version.id, binding_key="appendices.other", occurrence_index=2).first()
            if apply:
                config = copy.deepcopy(field.config or {})
                config["numbering"] = {"start": 3, "item_prefix": "Приложение № ", "name_separator": " — ", "prefix": ": "}
                config["separator"] = "; "
                field.config = config
                if region is None:
                    region = ConditionalDocumentRegion(
                        template_version_id=version.id, region_key="training_other_appendices",
                        region_type="CONDITIONAL_PARAGRAPH", locator=region_locator,
                        include_when={"operator": "IS_NOT_EMPTY", "field_key": "appendices.other"},
                        original_text=region_text, created_by_id=version.created_by_id,
                    )
                    session.add(region)
                    session.flush()
                if binding is None:
                    binding = DocumentBinding(
                        template_version_id=version.id, field_id=field.id,
                        binding_key="appendices.other", occurrence_index=2,
                        locator=binding_locator, selected_text=PLACEHOLDER,
                        format_config={"render_list": True}, created_by_id=version.created_by_id,
                    )
                    session.add(binding)
                    session.flush()
                candidate["status"] = "REGION_BINDING_COVERAGE"
                candidate["coverage_proof"] = {
                    "source_sha256": version.source_sha256,
                    "structure_fingerprint": version.structure_fingerprint,
                    "region_id": region.id,
                    "binding_id": binding.id,
                }
                if not verified_list_region_coverage(session, version, candidate):
                    raise ValueError("RF002: конфигурация не прошла проверку")
                metadata["binding_candidates"] = candidates
                version.preview_metadata = metadata
                session.add(TemplateAuditEvent(
                    template_id=version.template_id, template_version_id=version.id,
                    actor_id=version.created_by_id, event_type="TRAINING_APPENDICES_VERIFIED",
                    metadata_json={"candidate_id": candidate_id, "region_id": region.id, "binding_id": binding.id},
                ))
                session.commit()
            results.append({"candidate_id": candidate_id, "validated": True, "applied": apply})
        return results
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run(args.apply), ensure_ascii=False, indent=2))
