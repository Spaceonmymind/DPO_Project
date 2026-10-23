from pathlib import Path

from app.training_contract_import import build_plan


def test_r361_plan_is_fail_closed_and_complete_about_sources():
    root = Path(__file__).parents[2] / "contract_templates" / "training"
    plan = build_plan(root)
    assert plan["source_counts"] == {"facts": 40, "rf_fields": 25, "occurrences": 74, "physical_occurrences": 140, "scenarios": 120}
    assert len(plan["candidates"]) == 140
    assert {item["status"] for item in plan["candidates"]} <= {"CANDIDATE_FOUND", "REVIEW_REQUIRED", "NOT_FOUND"}
    assert len(plan["fields"]) == 37
    assert {x["key"] for x in plan["unsupported_facts"]} == {"appendices.other", "schedule.months", "schedule.entries"}
    assert {x["severity"] for x in plan["blockers"]} == {"P0"}
    assert plan["audit"]["integrity"]["all_files_match"]
