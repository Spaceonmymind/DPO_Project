"""Apply only structurally verified training draft corrections; never publish."""
from __future__ import annotations

import argparse
import copy
import json
from app.binding_materialization import BindingMaterializationService, candidate_is_resolved
from app.contract_platform import RegionPayload, _resolve_region, adapter, safe_source
from app.db import ConditionalDocumentRegion, QuestionnaireField, QuestionnaireSchema, SessionLocal, TemplateAuditEvent, TemplateVersion, User


IP_VERSION = "4eff6663-f03e-4858-bb2a-6dc39b4b1b95"
PHYSICAL_VERSION = "3dbdc61e-953b-49ce-a5c7-57df2613e454"
INVOICE_SOURCE = (
    "Счета-фактуры выставляются Исполнителем в соответствии с требованиями "
    "законодательства Российской Федерации. Если Исполнитель не является "
    "плательщиком НДС, счет-фактура не выставляется."
)


def configure_invoice(session, actor, apply):
    version = session.get(TemplateVersion, IP_VERSION)
    if not version or version.status != "DRAFT":
        raise ValueError("Черновая версия ИП не найдена")
    candidate_id = "O013:INDIVIDUAL_ENTREPRENEUR"
    candidates = copy.deepcopy((version.preview_metadata or {}).get("binding_candidates", []))
    candidate = next(item for item in candidates if item["candidate_id"] == candidate_id)
    if candidate["operation"] != "DERIVED" or candidate.get("review_decision") != "CONFIRMED":
        raise ValueError("RF010 не подтверждён как DERIVED")
    locator = "word/document.xml#/p[77]"
    selected = adapter.select_range(safe_source(version), locator, 0, 185, INVOICE_SOURCE)
    if selected["preview"]["structure_fingerprint"] != version.structure_fingerprint:
        raise ValueError("RF010: структура DOCX изменилась")
    if candidate.get("status") == "CONFIGURED":
        if not candidate_is_resolved(session, version, candidate, candidates):
            raise ValueError("RF010 помечен готовым без рабочей привязки")
        return {"candidate_id": candidate_id, "result": "existing", "locator": locator}
    if not apply:
        return {"candidate_id": candidate_id, "result": "validated", "locator": locator, "length": len(INVOICE_SOURCE)}
    candidate.update({
        "locator": locator, "part": selected["node"]["part"], "start": 0,
        "end": 185, "selected_text": INVOICE_SOURCE, "context": INVOICE_SOURCE,
        "diagnostics": {
            "strategy": "MANUAL_EXACT_STRUCTURAL_RANGE",
            "previous_locator": "word/document.xml#/p[78]",
            "source_operation": "DERIVED",
            "technical_status": "EXACT_RANGE_VERIFIED",
            "legal_status": "PENDING_LEGAL_APPROVAL",
        },
        "review_reason": "LEGAL_WORDING_PENDING",
        "required_specialist_action": "Согласовать с юристом обе отдельные редакции пункта о счетах-фактурах.",
    })
    metadata = copy.deepcopy(version.preview_metadata or {})
    metadata["binding_candidates"] = candidates
    version.preview_metadata = metadata
    session.flush()
    result = BindingMaterializationService(session, actor).materialize(version, candidate_id, manual=True)
    return {"candidate_id": candidate_id, "result": "materialized", "binding_id": result["materialized_id"], "locator": locator}


def configure_row_aliases(session, actor, apply):
    results = []
    for version_id, variant in ((IP_VERSION, "INDIVIDUAL_ENTREPRENEUR"), (PHYSICAL_VERSION, "PHYSICAL_PERSON")):
        version = session.get(TemplateVersion, version_id)
        if not version or version.status != "DRAFT":
            raise ValueError(f"Черновая версия {variant} не найдена")
        metadata = copy.deepcopy(version.preview_metadata or {})
        candidates = metadata.get("binding_candidates", [])
        for alias_occurrence, anchor_occurrence in (("O049", "O048"), ("O070", "O069")):
            alias = next(item for item in candidates if item["candidate_id"] == f"{alias_occurrence}:{variant}")
            anchor = next(item for item in candidates if item["candidate_id"] == f"{anchor_occurrence}:{variant}")
            region = session.get(ConditionalDocumentRegion, anchor.get("materialized_id"))
            if not region or region.status != "ACTIVE" or region.template_version_id != version.id:
                raise ValueError(f"{anchor_occurrence}: активная условная строка не найдена")
            if alias["rf_id"] != anchor["rf_id"] or alias["field_path"] != anchor["field_path"]:
                raise ValueError(f"{alias_occurrence}: RF или field_key отличаются")
            checked = adapter.select_range(safe_source(version), alias["locator"], alias["start"], alias["end"], alias["selected_text"])
            if checked["preview"]["structure_fingerprint"] != version.structure_fingerprint:
                raise ValueError("Структурный fingerprint изменился")
            if alias.get("status") != "STRUCTURAL_ALIAS" and apply:
                alias.update({
                    "status": "STRUCTURAL_ALIAS", "alias_of_candidate_id": anchor["candidate_id"],
                    "diagnostics": {**(alias.get("diagnostics") or {}), "strategy": "SAME_CONDITIONAL_TABLE_ROW", "canonical_region_id": region.id},
                    "required_specialist_action": "Технический алиас той же условной строки; отдельная область не создаётся.",
                })
                session.add(TemplateAuditEvent(template_id=version.template_id, template_version_id=version.id, actor_id=actor.id,
                    event_type="BINDING_CANDIDATE_STRUCTURAL_ALIAS", metadata_json={"candidate_id": alias["candidate_id"], "anchor": anchor["candidate_id"], "region_id": region.id}))
            results.append({"candidate_id": alias["candidate_id"], "anchor": anchor["candidate_id"], "region_id": region.id})
        if apply:
            metadata["binding_candidates"] = candidates
            version.preview_metadata = metadata
            session.commit()
            if not all(candidate_is_resolved(session, version, next(item for item in candidates if item["candidate_id"] == result["candidate_id"]), candidates) for result in results if result["candidate_id"].endswith(variant)):
                raise ValueError(f"{variant}: алиас не проходит fail-closed проверку")
    return results


def configure_ogrnip(session, actor, apply):
    version = session.get(TemplateVersion, IP_VERSION)
    metadata = copy.deepcopy(version.preview_metadata or {})
    candidates = metadata.get("binding_candidates", [])
    candidate = next(item for item in candidates if item["candidate_id"] == "O055:INDIVIDUAL_ENTREPRENEUR")
    if candidate["operation"] != "REPLACE" or candidate["field_path"] != "ip.ogrnip":
        raise ValueError("RF025: неожиданная операция или поле")
    node = "word/document.xml#/tbl[3]/tr[2]/tc[2]/p[8]"
    text = "ОГРНИП ______________"
    selected = adapter.select_range(safe_source(version), node, 7, len(text), "______________")
    if selected["node"]["text"] != text or selected["preview"]["structure_fingerprint"] != version.structure_fingerprint:
        raise ValueError("RF025: исходный диапазон изменился")
    schema = session.query(QuestionnaireSchema).filter_by(template_version_id=version.id).first()
    field = session.query(QuestionnaireField).filter_by(schema_id=schema.id, field_key="ip.ogrnip").one()
    if candidate.get("status") == "CONFIGURED":
        return {"candidate_id": candidate["candidate_id"], "result": "existing"}
    if not apply:
        return {"candidate_id": candidate["candidate_id"], "result": "validated", "locator": node, "span": [7, len(text)]}
    config = copy.deepcopy(field.config or {})
    config["validation"] = {"regex": "^[0-9]{15}$"}
    field.config = config
    candidate.update({
        "review_decision": "CONFIRMED", "start": 7, "end": len(text),
        "selected_text": "______________", "context": text,
        "diagnostics": {"strategy": "MANUAL_EXACT_PLACEHOLDER", "preserved_prefix": "ОГРНИП ", "validation": "15_DIGITS"},
        "required_specialist_action": "Проверить заполненный 15-значный ОГРНИП в контрольном документе.",
    })
    metadata["binding_candidates"] = candidates
    version.preview_metadata = metadata
    session.flush()
    result = BindingMaterializationService(session, actor).materialize(version, candidate["candidate_id"], manual=True)
    return {"candidate_id": candidate["candidate_id"], "result": "materialized", "binding_id": result["materialized_id"]}


def configure_variant_labels(session, actor, apply):
    results = []
    variants = (
        (IP_VERSION, "INDIVIDUAL_ENTREPRENEUR", "с индивидуальным предпринимателем"),
        (PHYSICAL_VERSION, "PHYSICAL_PERSON", "с физическим лицом"),
    )
    for version_id, variant, approved_text in variants:
        version = session.get(TemplateVersion, version_id)
        metadata = copy.deepcopy(version.preview_metadata or {})
        candidates = metadata.get("binding_candidates", [])
        candidate = next(item for item in candidates if item["candidate_id"] == f"O003:{variant}")
        if candidate["operation"] != "DERIVED" or candidate["selected_text"] != approved_text:
            raise ValueError(f"RF003: текст варианта {variant} не совпал с источником")
        adapter.select_range(safe_source(version), candidate["locator"], candidate["start"], candidate["end"], approved_text)
        schema = session.query(QuestionnaireSchema).filter_by(template_version_id=version.id).first()
        field = session.query(QuestionnaireField).filter_by(schema_id=schema.id, field_key="contractor.variant_label").one()
        if candidate.get("status") == "CONFIGURED":
            results.append({"candidate_id": candidate["candidate_id"], "result": "existing"})
            continue
        if not apply:
            results.append({"candidate_id": candidate["candidate_id"], "result": "validated"})
            continue
        field.field_type = "TEXT"
        field.required = False
        field.config = {**(field.config or {}), "calculated": True, "text_expression": {"literal": approved_text}, "options": []}
        candidate.update({
            "review_decision": "CONFIRMED",
            "diagnostics": {"strategy": "EXACT_IMMUTABLE_VARIANT_TEXT", "source_operation": "DERIVED", "template_variant": variant},
            "required_specialist_action": "Не требуется: утверждённый текст варианта сохранён без изменений.",
        })
        metadata["binding_candidates"] = candidates
        version.preview_metadata = metadata
        session.flush()
        result = BindingMaterializationService(session, actor).materialize(version, candidate["candidate_id"], manual=True)
        results.append({"candidate_id": candidate["candidate_id"], "result": "materialized", "binding_id": result["materialized_id"]})
    return results


def configure_dispute_forum(session, actor, apply):
    results = []
    for version_id, variant, locator, marker in (
        (IP_VERSION, "INDIVIDUAL_ENTREPRENEUR", "word/document.xml#/p[168]", "в Арбитражном суде"),
        (PHYSICAL_VERSION, "PHYSICAL_PERSON", "word/document.xml#/p[161]", "в суде"),
    ):
        version = session.get(TemplateVersion, version_id)
        node = next(item for item in adapter.preview(safe_source(version))["nodes"] if item["locator"] == locator)
        original = node["text"]
        if marker not in original or not original.startswith("Если Стороны не смогут прийти к соглашению"):
            raise ValueError(f"RF015: не найдено утверждённое условие подсудности {variant}")
        adapter.select_range(safe_source(version), locator, 0, len(original), original)
        metadata = copy.deepcopy(version.preview_metadata or {})
        candidates = metadata.get("binding_candidates", [])
        candidate = next(item for item in candidates if item["candidate_id"] == f"O018:{variant}")
        if candidate["operation"] != "DERIVED" or candidate["field_path"] != "dispute.forum":
            raise ValueError("RF015: несовместимая операция")
        if candidate.get("status") == "CONFIGURED":
            results.append({"candidate_id": candidate["candidate_id"], "result": "existing"})
            continue
        if not apply:
            results.append({"candidate_id": candidate["candidate_id"], "result": "validated", "locator": locator})
            continue
        schema = session.query(QuestionnaireSchema).filter_by(template_version_id=version.id).first()
        field = session.query(QuestionnaireField).filter_by(schema_id=schema.id, field_key="dispute.forum").one()
        field.required = False
        field.config = {**(field.config or {}), "calculated": True, "text_expression": {"literal": original}}
        candidate.update({
            "review_decision": "CONFIRMED", "locator": locator, "part": node["part"], "start": 0,
            "end": len(original), "selected_text": original, "context": original,
            "diagnostics": {"strategy": "EXACT_IMMUTABLE_VARIANT_TEXT", "previous_locator": candidate.get("locator"), "source_operation": "DERIVED"},
            "review_reason": "APPROVED_SOURCE_PRESERVED",
            "required_specialist_action": "Не требуется: пункт подсудности сохранён из утверждённого шаблона без редакции.",
        })
        metadata["binding_candidates"] = candidates
        version.preview_metadata = metadata
        session.flush()
        result = BindingMaterializationService(session, actor).materialize(version, candidate["candidate_id"], manual=True)
        results.append({"candidate_id": candidate["candidate_id"], "result": "materialized", "binding_id": result["materialized_id"]})
    return results


def configure_vat_penalty(session, actor, apply):
    version = session.get(TemplateVersion, IP_VERSION)
    metadata = copy.deepcopy(version.preview_metadata or {})
    candidates = metadata.get("binding_candidates", [])
    candidate = next(item for item in candidates if item["candidate_id"] == "O017:INDIVIDUAL_ENTREPRENEUR")
    source_locator = "word/document.xml#/p[135]"
    source = next(item["text"] for item in adapter.preview(safe_source(version))["nodes"] if item["locator"] == source_locator)
    if candidate["operation"] != "INCLUDE_EXCLUDE" or "ст. 168 НК РФ" not in source or "1%" not in source:
        raise ValueError("RF014: не найден утверждённый пункт о пене")
    condition = {"operator": "EQUALS", "field_key": "tax.vat_status", "value": "VAT_PAYER"}
    payload = RegionPayload(region_key="training.rf014.vat_penalty", region_type="CONDITIONAL_PARAGRAPH", start_locator=source_locator, include_when=condition)
    locator, original = _resolve_region(safe_source(version), payload, version.structure_fingerprint)
    if original != source:
        raise ValueError("RF014: граница абзаца изменилась")
    region = session.query(ConditionalDocumentRegion).filter_by(template_version_id=version.id, region_key=payload.region_key).first()
    if candidate.get("status") == "CONFIGURED":
        if not region or region.id != candidate.get("materialized_id") or region.include_when != condition:
            raise ValueError("RF014 помечен готовым без согласованной области")
        return {"candidate_id": candidate["candidate_id"], "result": "existing", "region_id": region.id}
    if not apply:
        return {"candidate_id": candidate["candidate_id"], "result": "validated", "locator": source_locator}
    if region is not None:
        raise ValueError("RF014: область уже существует, но кандидат не связан с ней")
    region = ConditionalDocumentRegion(template_version_id=version.id, region_key=payload.region_key, region_type=payload.region_type,
        locator=locator, include_when=condition, original_text=original, created_by_id=actor.id)
    session.add(region)
    session.flush()
    schema = session.query(QuestionnaireSchema).filter_by(template_version_id=version.id).first()
    field = session.query(QuestionnaireField).filter_by(schema_id=schema.id, field_key="ip.vat_penalty").one()
    field.required = False
    field.config = {**(field.config or {}), "derived_from": "tax.vat_status", "document_condition": condition}
    candidate.update({"status": "CONFIGURED", "materialized_type": "CONDITIONAL_DOCUMENT_REGION", "materialized_id": region.id,
        "materialization_source": "MANUAL_EXACT_STRUCTURAL_REVIEW", "locator": source_locator, "part": "word/document.xml",
        "start": 0, "end": len(source), "selected_text": source, "context": source[:500],
        "diagnostics": {"strategy": "EXACT_PARAGRAPH_BY_TAX_STATUS", "condition": condition, "source_operation": "INCLUDE_EXCLUDE"},
        "required_specialist_action": "Проверить с юристом применимость утверждённого пункта только для ИП — плательщика НДС."})
    metadata["binding_candidates"] = candidates
    version.preview_metadata = metadata
    session.add(TemplateAuditEvent(template_id=version.template_id, template_version_id=version.id, actor_id=actor.id,
        event_type="TRAINING_VAT_PENALTY_CONFIGURED", metadata_json={"candidate_id": candidate["candidate_id"], "region_id": region.id, "condition": condition}))
    session.commit()
    return {"candidate_id": candidate["candidate_id"], "result": "materialized", "region_id": region.id}


def configure_bank_guarantee_runs(session, actor, apply):
    results = []
    opening = " и предоставления Исполнителем банковской гарантии"
    closing = "(если применимо)"
    condition = {"operator": "EQUALS", "field_key": "payment.bank_guarantee_clause", "value": True}
    for version_id, variant in ((IP_VERSION, "INDIVIDUAL_ENTREPRENEUR"), (PHYSICAL_VERSION, "PHYSICAL_PERSON")):
        version = session.get(TemplateVersion, version_id)
        metadata = copy.deepcopy(version.preview_metadata or {})
        candidates = metadata.get("binding_candidates", [])
        nodes = {node["locator"]: node["text"] for node in adapter.preview(safe_source(version))["nodes"]}
        for occurrence, paragraph in (("O008", 59), ("O010", 61)):
            candidate = next(item for item in candidates if item["candidate_id"] == f"{occurrence}:{variant}")
            source_locator = f"word/document.xml#/p[{paragraph}]"
            source = nodes[source_locator]
            if candidate["operation"] != "INCLUDE_EXCLUDE" or source.count(opening) != 1 or source.count(closing) != 1:
                raise ValueError(f"RF008 {variant} {paragraph}: неоднозначная оговорка")
            start = source.index(opening)
            end = source.index(closing, start) + len(closing)
            selected = source[start:end]
            adapter.select_range(safe_source(version), source_locator, start, end, selected)
            payload = RegionPayload(region_key=f"training.rf008.{occurrence.lower()}", region_type="CONDITIONAL_RUN",
                start_locator=source_locator, start=start, end=end, selected_text=selected, include_when=condition)
            locator, original = _resolve_region(safe_source(version), payload, version.structure_fingerprint)
            if original != source:
                raise ValueError("RF008: исходный абзац изменился")
            region = session.query(ConditionalDocumentRegion).filter_by(template_version_id=version.id, region_key=payload.region_key).first()
            if candidate.get("status") == "CONFIGURED":
                if not region or region.id != candidate.get("materialized_id") or region.include_when != condition:
                    raise ValueError("RF008 помечен готовым без точной области")
                results.append({"candidate_id": candidate["candidate_id"], "result": "existing"})
                continue
            if not apply:
                results.append({"candidate_id": candidate["candidate_id"], "result": "validated", "start": start, "end": end})
                continue
            if region is not None:
                raise ValueError("RF008: область уже существует без связи с кандидатом")
            region = ConditionalDocumentRegion(template_version_id=version.id, region_key=payload.region_key, region_type=payload.region_type,
                locator=locator, include_when=condition, original_text=original, created_by_id=actor.id)
            session.add(region)
            session.flush()
            candidate.update({"status": "CONFIGURED", "materialized_type": "CONDITIONAL_DOCUMENT_REGION", "materialized_id": region.id,
                "materialization_source": "MANUAL_EXACT_NESTED_RUN", "locator": source_locator, "part": "word/document.xml",
                "start": start, "end": end, "selected_text": selected, "context": source[:500],
                "diagnostics": {"strategy": "EXACT_NESTED_RUN", "condition": condition, "parent_payment_region": f"r363.{('o007' if occurrence == 'O008' else 'o009')}"},
                "required_specialist_action": "Проверить оба режима оплаты с гарантией и без неё в контрольном документе."})
            session.add(TemplateAuditEvent(template_id=version.template_id, template_version_id=version.id, actor_id=actor.id,
                event_type="TRAINING_GUARANTEE_RUN_CONFIGURED", metadata_json={"candidate_id": candidate["candidate_id"], "region_id": region.id, "locator": source_locator, "start": start, "end": end}))
            results.append({"candidate_id": candidate["candidate_id"], "result": "materialized", "region_id": region.id})
        if apply:
            metadata["binding_candidates"] = candidates
            version.preview_metadata = metadata
            session.commit()
    return results


REVIEW_TARGETS = {
    "O004": ("word/document.xml#/p[47]", "Исполнитель", "PREAMBLE_COMPOSITE", "Преамбула содержит ФИО, статус и для ИП ОГРНИП. Согласовать структуру реквизитов и точные заполняемые фрагменты; весь абзац одной строкой не заменять."),
    "O006": ("word/document.xml#/p[57]", "Общая стоимость услуг", "TAX_EXPRESSION_PENDING", "Согласовать зависимость суммы и налогового режима; заполнить только утверждённые налоговые фрагменты и сохранить остальной абзац."),
    "O008": ("word/document.xml#/p[59]", "банковской гарантии", "NESTED_CONDITIONAL_RUN", "Оговорка о гарантии вложена в уже условный абзац PREPAY. Требуется безопасная вложенная область для точного фрагмента без удаления условий оплаты."),
    "O010": ("word/document.xml#/p[61]", "банковской гарантии", "NESTED_CONDITIONAL_RUN", "Оговорка о гарантии вложена в уже условный абзац MIXED. Требуется безопасная вложенная область для точного фрагмента без удаления условий оплаты."),
    "O012": ("word/document.xml#/p[72]", "НДФЛ", "NDFL_FORMAT_PENDING", "Точный пункт удержания найден. Согласовать источник ставки и формат рублей/копеек, затем связать вычисляемые значения с утверждённым текстом."),
    "O017": ("word/document.xml#/p[135]", "ст. 168 НК РФ", "VAT_PENALTY_CONDITION", "Штрафной пункт найден. Подтвердить, что он включается только для плательщика НДС, и настроить условную область по tax.vat_status."),
    "O019": ("word/document.xml#/p[205]", "Опционально", "LONG_TERM_OPTION", "Пункт найден. Уточнить условие срока более года и убрать только редакторскую помету, сохранив утверждённый текст."),
    "O020": (None, "Исполнитель", "ACT_PREAMBLE_COMPOSITE", "Преамбула акта содержит реквизиты исполнителя. Нужны точные компонентные привязки без замены всего юридического абзаца."),
    "O021": (None, "Стоимость вышеуказанных услуг", "ACT_TAX_EXPRESSION_PENDING", "Налоговый пункт акта найден. Согласовать тот же источник ставки/суммы, что в договоре, и точные границы подстановок."),
    "O022": ("word/document.xml#/p[290]", "НДФЛ", "ACT_NDFL_FORMAT_PENDING", "Точный пункт НДФЛ в акте найден. Требуется общий с договором расчёт и формат рублей/копеек."),
}


def annotate_remaining(session, actor, apply):
    changed = []
    for version_id, variant in ((IP_VERSION, "INDIVIDUAL_ENTREPRENEUR"), (PHYSICAL_VERSION, "PHYSICAL_PERSON")):
        version = session.get(TemplateVersion, version_id)
        preview = adapter.preview(safe_source(version))
        nodes = {item["locator"]: item["text"] for item in preview["nodes"]}
        metadata = copy.deepcopy(version.preview_metadata or {})
        candidates = metadata.get("binding_candidates", [])
        original_candidates = copy.deepcopy(candidates)
        for candidate in candidates:
            if candidate.get("status") not in {"REVIEW_REQUIRED", "BLOCKED"}:
                continue
            occurrence = candidate["occurrence_id"]
            if occurrence in {"O014", "O015"}:
                if any("НПД" in text or "профессиональный доход" in text.lower() for text in nodes.values()):
                    raise ValueError("RF011/RF012: найден непроверенный текст НПД")
                locator = None
                marker = None
                reason = "NPD_CLAUSE_ABSENT"
                action = "Пункт НПД отсутствует в утверждённом DOCX. Подтвердить, что удаление не требуется; текущий locator указывает на другое юридическое положение."
            elif occurrence == "O016":
                locator = "word/document.xml#/p[119]"
                marker = "гарантирует"
                reason = "MULTI_PARAGRAPH_WARRANTIES"
                action = "Определить точные границы гарантий ИП: вводный p[119] и относящиеся к нему пункты p[120]–p[127]. Подтвердить, какие из них включать."
            elif occurrence == "O002":
                locator = "word/document.xml#/p[17]"
                marker = "иные Приложения"
                reason = "APPENDIX_LINE_BOUNDARY"
                action = "Подтвердить поведение при пустом списке: удалять весь p[17] или оставлять строку; при непустом списке согласовать формат перечисления."
            elif occurrence == "O054":
                locator = candidate["locator"]
                marker = "Паспорт серия"
                reason = "COMPOSITE_FORMAT_PENDING"
                action = "Паспорт и СНИЛС уже типизированы; согласовать формат вывода, сохраняющий подписи и порядок в исходном p[6]."
            else:
                spec = REVIEW_TARGETS.get(occurrence)
                if not spec:
                    continue
                locator, marker, reason, action = spec
                if occurrence == "O020":
                    locator = "word/document.xml#/p[294]" if variant == "INDIVIDUAL_ENTREPRENEUR" else "word/document.xml#/p[286]"
                elif occurrence == "O021":
                    locator = "word/document.xml#/p[297]" if variant == "INDIVIDUAL_ENTREPRENEUR" else "word/document.xml#/p[289]"
                elif occurrence == "O022" and variant != "PHYSICAL_PERSON":
                    continue
                elif occurrence in {"O012", "O017", "O019"} and variant != ("PHYSICAL_PERSON" if occurrence == "O012" else "INDIVIDUAL_ENTREPRENEUR"):
                    continue
            if locator and marker not in nodes.get(locator, ""):
                raise ValueError(f"{candidate['candidate_id']}: ожидаемый текст не найден в {locator}")
            if not apply:
                changed.append({"candidate_id": candidate["candidate_id"], "reason": reason, "target": locator})
                continue
            diagnostics = copy.deepcopy(candidate.get("diagnostics") or {})
            if locator and candidate.get("locator") != locator:
                diagnostics.setdefault("previous_locator", candidate.get("locator"))
                candidate["locator"] = locator
                candidate["part"] = "word/document.xml"
                candidate["start"] = 0
                candidate["end"] = len(nodes[locator])
                candidate["selected_text"] = nodes[locator]
                candidate["context"] = nodes[locator][:500]
            diagnostics["verified_review_target"] = locator
            diagnostics["review_reason"] = reason
            candidate["diagnostics"] = diagnostics
            candidate["review_reason"] = reason
            candidate["required_specialist_action"] = action
            if occurrence in {"O014", "O015"}:
                candidate["review_decision"] = None
            changed.append({"candidate_id": candidate["candidate_id"], "reason": reason, "target": locator})
        if apply and candidates != original_candidates:
            metadata["binding_candidates"] = candidates
            version.preview_metadata = metadata
            session.add(TemplateAuditEvent(template_id=version.template_id, template_version_id=version.id, actor_id=actor.id,
                event_type="TRAINING_CANDIDATE_TARGETS_AUDITED", metadata_json={"candidate_ids": [item["candidate_id"] for item in changed if item["candidate_id"].endswith(variant)]}))
            session.commit()
    return changed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--owner", default="ivanov")
    args = parser.parse_args()
    session = SessionLocal()
    try:
        actor = session.query(User).filter_by(external_id=args.owner).first()
        if not actor or not set(actor.roles or []) & {"dpo_specialist", "administrator"}:
            raise ValueError("Специалист ДПО не найден")
        invoice = configure_invoice(session, actor, args.apply)
        aliases = configure_row_aliases(session, actor, args.apply)
        ogrnip = configure_ogrnip(session, actor, args.apply)
        variant_labels = configure_variant_labels(session, actor, args.apply)
        dispute_forum = configure_dispute_forum(session, actor, args.apply)
        vat_penalty = configure_vat_penalty(session, actor, args.apply)
        bank_guarantee = configure_bank_guarantee_runs(session, actor, args.apply)
        review = annotate_remaining(session, actor, args.apply)
        print(json.dumps({"mode": "apply" if args.apply else "dry-run", "invoice": invoice, "row_aliases": aliases, "ogrnip": ogrnip, "variant_labels": variant_labels, "dispute_forum": dispute_forum, "vat_penalty": vat_penalty, "bank_guarantee": bank_guarantee, "review": review}, ensure_ascii=False, indent=2))
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()
