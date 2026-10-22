#!/usr/bin/env python
import argparse, json
from pathlib import Path

from app.db import SessionLocal, User, settings
from app.training_contract_import import apply_plan, build_plan

parser = argparse.ArgumentParser(description="Безопасный R3.6.1 import черновика")
parser.add_argument("--apply", action="store_true", help="создать только безопасную черновую часть")
parser.add_argument("--owner", help="external_id специалиста ДПО/администратора")
args = parser.parse_args()
plan = build_plan(Path(settings.contract_templates_path) / "training")
result = {"mode": "apply" if args.apply else "dry-run", "plan": plan}
if args.apply:
    db = SessionLocal()
    try:
        owner = db.query(User).filter_by(external_id=args.owner).first() if args.owner else next(
            (user for user in db.query(User).all() if set(user.roles or []) & {"dpo_specialist", "administrator"}), None
        )
        if not owner or not set(owner.roles or []) & {"dpo_specialist", "administrator"}: raise SystemExit("Не найден подходящий owner")
        result["applied"] = apply_plan(plan, owner, db)
    finally: db.close()
print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
