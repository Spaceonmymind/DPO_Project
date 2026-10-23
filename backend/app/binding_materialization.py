"""Fail-closed materialization of reviewed structural candidates."""
from __future__ import annotations

import copy
from datetime import datetime, timezone

from app.contract_platform import adapter, safe_source
from app.db import (
    ConditionalDocumentRegion, DocumentBinding, QuestionnaireField,
    QuestionnaireSchema, RepeatingGroup, TemplateAuditEvent, TemplateVersion,
)


class MaterializationError(ValueError):
    pass


DIRECT_BINDING_OPERATIONS = {"REPLACE"}


def _overlaps(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    return max(a_start, b_start) < min(a_end, b_end)


class BindingMaterializationService:
    def __init__(self, session, actor):
        self.session = session
        self.actor = actor

    def _candidate(self, version: TemplateVersion, candidate_id: str):
        metadata = copy.deepcopy(version.preview_metadata or {})
        candidates = metadata.get("binding_candidates", [])
        candidate = next((item for item in candidates if item.get("candidate_id") == candidate_id), None)
        if candidate is None:
            raise MaterializationError("Кандидат разметки не найден")
        return metadata, candidates, candidate

    def _validate(self, version: TemplateVersion, candidate: dict, manual: bool):
        if version.status != "DRAFT":
            raise MaterializationError("Материализация разрешена только в черновой версии")
        if candidate.get("operation") not in DIRECT_BINDING_OPERATIONS:
            raise MaterializationError("Для этой операции требуется conditional/repeating configuration")
        if manual:
            if candidate.get("review_decision") != "CONFIRMED":
                raise MaterializationError("Кандидат должен быть явно подтверждён специалистом")
        elif candidate.get("status") != "CANDIDATE_FOUND" or candidate.get("review_decision") == "REJECTED":
            raise MaterializationError("Автоматически материализуются только точные кандидаты")
        preview = adapter.preview(safe_source(version))
        if preview["structure_fingerprint"] != version.structure_fingerprint:
            raise MaterializationError("Структурный locator устарел")
        if candidate.get("structure_fingerprint") != version.structure_fingerprint:
            raise MaterializationError("Fingerprint кандидата не соответствует версии")
        try:
            selection = adapter.select_range(
                safe_source(version), candidate["locator"], int(candidate["start"]),
                int(candidate["end"]), candidate.get("selected_text") or "",
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise MaterializationError(f"Диапазон кандидата не подтверждён: {exc}") from exc
        schema = self.session.query(QuestionnaireSchema).filter_by(template_version_id=version.id).first()
        field = self.session.query(QuestionnaireField).filter_by(schema_id=schema.id, field_key=candidate["field_path"]).first() if schema else None
        if field is None:
            raise MaterializationError("Поле анкеты для кандидата не настроено")
        locator = adapter.get_structural_locator(safe_source(version), selection)
        for binding in self.session.query(DocumentBinding).filter_by(template_version_id=version.id, status="ACTIVE"):
            existing = binding.locator or {}
            if existing.get("part") == locator.get("part") and existing.get("node") == locator.get("node"):
                if _overlaps(existing.get("text_start", 0), existing.get("text_end", 0), locator["text_start"], locator["text_end"]):
                    if candidate.get("materialized_id") == binding.id:
                        return field, locator, binding
                    raise MaterializationError("Диапазон пересекается с существующей привязкой")
        region_nodes = {
            node for region in self.session.query(ConditionalDocumentRegion).filter_by(template_version_id=version.id, status="ACTIVE")
            for node in (region.locator or {}).get("nodes", [(region.locator or {}).get("node")]) if node
        }
        if locator["node"] in region_nodes:
            raise MaterializationError("Узел уже используется условной областью")
        for group in self.session.query(RepeatingGroup).filter_by(template_version_id=version.id, status="ACTIVE"):
            if (group.locator or {}).get("table") == selection["node"].get("metadata", {}).get("table") and (group.locator or {}).get("row") == selection["node"].get("metadata", {}).get("row"):
                raise MaterializationError("Узел уже используется повторяемой группой")
        return field, locator, None

    def materialize(self, version: TemplateVersion, candidate_id: str, *, manual: bool = False) -> dict:
        metadata, candidates, candidate = self._candidate(version, candidate_id)
        field, locator, existing = self._validate(version, candidate, manual)
        if existing is None:
            binding = DocumentBinding(
                template_version_id=version.id, field_id=field.id, binding_key=field.field_key,
                occurrence_index=int(str(candidate["occurrence_id"])[1:]), locator=locator,
                selected_text=candidate.get("selected_text") or "", format_config={}, created_by_id=self.actor.id,
            )
            self.session.add(binding); self.session.flush()
        else:
            binding = existing
        candidate.update({
            "status": "CONFIGURED", "materialized_type": "DOCUMENT_BINDING",
            "materialized_id": binding.id, "materialization_source": "MANUAL_REVIEW" if manual else "AUTO_EXACT",
            "materialized_at": datetime.now(timezone.utc).isoformat(),
        })
        metadata["binding_candidates"] = candidates; version.preview_metadata = metadata
        self.session.add(TemplateAuditEvent(
            template_id=version.template_id, template_version_id=version.id, actor_id=self.actor.id,
            event_type="BINDING_CANDIDATE_MATERIALIZED",
            metadata_json={"candidate_id": candidate_id, "binding_id": binding.id, "source": candidate["materialization_source"]},
        ))
        self.session.commit()
        return candidate

    def rollback(self, version: TemplateVersion, candidate_id: str) -> dict:
        metadata, candidates, candidate = self._candidate(version, candidate_id)
        if version.status != "DRAFT":
            raise MaterializationError("Откат разрешён только в черновой версии")
        binding_id = candidate.get("materialized_id")
        binding = self.session.get(DocumentBinding, binding_id) if binding_id else None
        if binding and binding.template_version_id == version.id:
            self.session.delete(binding)
        candidate.pop("materialized_id", None); candidate.pop("materialized_type", None)
        candidate.pop("materialization_source", None); candidate.pop("materialized_at", None)
        candidate["status"] = "CANDIDATE_FOUND" if candidate.get("selected_text") else "REVIEW_REQUIRED"
        metadata["binding_candidates"] = candidates; version.preview_metadata = metadata
        self.session.add(TemplateAuditEvent(template_id=version.template_id, template_version_id=version.id, actor_id=self.actor.id, event_type="BINDING_CANDIDATE_ROLLED_BACK", metadata_json={"candidate_id": candidate_id}))
        self.session.commit()
        return candidate
