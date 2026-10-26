"""Read-only diagnostic inventory for the two approved training DOCX drafts."""
from __future__ import annotations

import argparse
import json
from collections import Counter

from app.contract_platform import adapter, safe_source
from app.db import DocumentBinding, QuestionnaireField, QuestionnaireSchema, SessionLocal, TemplateVersion


parser = argparse.ArgumentParser()
parser.add_argument("--details", action="store_true")
args = parser.parse_args()
session = SessionLocal()
try:
    for version_id in (
        "4eff6663-f03e-4858-bb2a-6dc39b4b1b95",
        "3dbdc61e-953b-49ce-a5c7-57df2613e454",
    ):
        version = session.get(TemplateVersion, version_id)
        if version is None:
            print(json.dumps({"version_id": version_id, "error": "missing"}))
            continue
        candidates = (version.preview_metadata or {}).get("binding_candidates", [])
        preview = adapter.preview(safe_source(version))
        nodes = {node["locator"]: node["text"] for node in preview["nodes"]}
        schema = session.query(QuestionnaireSchema).filter_by(template_version_id=version.id).first()
        fields = {field.field_key: field for field in session.query(QuestionnaireField).filter_by(schema_id=schema.id)} if schema else {}
        bindings = session.query(DocumentBinding).filter_by(template_version_id=version.id).all()
        print(json.dumps({"version_id": version_id, "status": version.status, "counts": dict(Counter(item.get("status") for item in candidates)), "bindings": len(bindings)}, ensure_ascii=False))
        if args.details:
            for candidate in candidates:
                if candidate.get("status") not in {"BLOCKED", "REVIEW_REQUIRED"}:
                    continue
                field = fields.get(candidate.get("field_path"))
                print(json.dumps({
                    "candidate_id": candidate["candidate_id"], "rf_id": candidate["rf_id"],
                    "operation": candidate["operation"], "status": candidate["status"],
                    "review_decision": candidate.get("review_decision"),
                    "field_path": candidate.get("field_path"), "field_type": field.field_type if field else None,
                    "field_config": field.config if field else None,
                    "locator": candidate.get("locator"), "node_text": nodes.get(candidate.get("locator")),
                    "selected_text": candidate.get("selected_text"),
                    "action": candidate.get("required_specialist_action"),
                }, ensure_ascii=False))
finally:
    session.close()
