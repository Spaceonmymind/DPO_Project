"""Record approved pilot-only exceptions after independent source/matrix checks."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from docx import Document

from app.binding_materialization import candidate_is_resolved, verified_training_exception
from app.contract_platform import adapter, safe_source
from app.db import SessionLocal, TemplateAuditEvent, TemplateVersion, User, settings


VERSIONS = {
    "INDIVIDUAL_ENTREPRENEUR": "4eff6663-f03e-4858-bb2a-6dc39b4b1b95",
    "PHYSICAL_PERSON": "3dbdc61e-953b-49ce-a5c7-57df2613e454",
}


def run(apply: bool = False) -> list[dict]:
    session = SessionLocal()
    results = []
    try:
        matrix = Path(settings.contract_templates_path) / "training" / "Матрица_применимости_LLM_v2.xlsx"
        matrix_sha = hashlib.sha256(matrix.read_bytes()).hexdigest()
        for variant, version_id in VERSIONS.items():
            version = session.get(TemplateVersion, version_id)
            if not version or version.status != "DRAFT":
                raise ValueError(f"Нет черновой версии {variant}")
            source = safe_source(version)
            preview = adapter.preview(source)
            if preview["structure_fingerprint"] != version.structure_fingerprint:
                raise ValueError(f"Изменилась структура {variant}")
            nodes = {n["locator"]: n["text"] for n in preview["nodes"]}
            metadata = copy.deepcopy(version.preview_metadata or {})
            candidates = metadata.get("binding_candidates") or []
            for rf, occurrence in (("RF011", "O014"), ("RF012", "O015"), *(((("RF013", "O016"),) if variant == "INDIVIDUAL_ENTREPRENEUR" else ()))):
                candidate_id = f"{occurrence}:{variant}"
                candidate = next(c for c in candidates if c["candidate_id"] == candidate_id)
                desired = "SOURCE_PRESERVED" if rf == "RF013" else "NOT_APPLICABLE"
                proof = {
                    "decision": "PILOT_SOURCE_PRESERVED" if rf == "RF013" else "PILOT_NOT_APPLICABLE",
                    "source_sha256": version.source_sha256,
                    "matrix_sha256": matrix_sha,
                    "structure_fingerprint": version.structure_fingerprint,
                }
                if rf == "RF013":
                    locators = [f"word/document.xml#/p[{i}]" for i in range(119, 128)]
                    proof["locators"] = locators
                    proof["node_sha256"] = {loc: hashlib.sha256(nodes[loc].encode()).hexdigest() for loc in locators}
                    proof["diagnostic_sha256"] = {}
                    for name in ("ip-guarantee-0.docx", "ip-guarantee-1.docx"):
                        diagnostic = Path(settings.storage) / "training-combined-diagnostics" / name
                        paragraphs = {p.text for p in Document(diagnostic).paragraphs}
                        if any(nodes[loc] not in paragraphs for loc in locators):
                            raise ValueError(f"Гарантии ИП отсутствуют в диагностическом DOCX: {name}")
                        proof["diagnostic_sha256"][name] = hashlib.sha256(diagnostic.read_bytes()).hexdigest()
                old_status = candidate["status"]
                previous_proof = candidate.get("resolution_proof")
                candidate["status"] = desired
                candidate["resolution_proof"] = proof
                if not verified_training_exception(version, candidate):
                    raise ValueError(f"Проверка применимости не прошла: {candidate_id}")
                if not apply:
                    candidate["status"] = old_status
                    candidate.pop("resolution_proof")
                elif old_status != desired or previous_proof != proof:
                    session.add(TemplateAuditEvent(
                        template_id=version.template_id, template_version_id=version.id,
                        actor_id=version.created_by_id, event_type="TRAINING_PILOT_EXCEPTION_CONFIRMED",
                        metadata_json={"candidate_id": candidate_id, "status": desired, "proof": proof},
                    ))
                results.append({"candidate_id": candidate_id, "result": desired, "verified": True})
            if apply:
                metadata["binding_candidates"] = candidates
                version.preview_metadata = metadata
                session.commit()
                if not all(candidate_is_resolved(session, version, c, candidates) for c in candidates if c["status"] in {"SOURCE_PRESERVED", "NOT_APPLICABLE"}):
                    raise ValueError(f"Повторная проверка не прошла: {variant}")
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
