#!/usr/bin/env python
import json
from pathlib import Path

from app.db import settings
from app.training_contract_audit import audit_training_sources

if __name__ == "__main__":
    root = Path(settings.contract_templates_path) / "training"
    print(json.dumps(audit_training_sources(root), ensure_ascii=False, indent=2))
