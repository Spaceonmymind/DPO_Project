from pathlib import Path

from app.training_contract_import import build_plan
from app.training_resolver_import import parse_matrix_condition
from app.training_structural_config import _region_spec, _review_reason


def test_r361_plan_is_fail_closed_and_complete_about_sources():
    root = Path(__file__).parents[2] / "contract_templates" / "training"
    plan = build_plan(root)
    assert plan["source_counts"] == {"facts": 40, "rf_fields": 25, "occurrences": 74, "physical_occurrences": 140, "scenarios": 120}
    assert len(plan["candidates"]) == 140
    assert {item["status"] for item in plan["candidates"]} <= {"CANDIDATE_FOUND", "REVIEW_REQUIRED", "BLOCKED"}
    assert len(plan["fields"]) == 37
    assert {x["key"] for x in plan["unsupported_facts"]} == {"appendices.other", "schedule.months", "schedule.entries"}
    assert {x["severity"] for x in plan["blockers"]} == {"P0"}
    assert plan["audit"]["integrity"]["all_files_match"]


def test_matrix_rule_parser_builds_allowlisted_condition_ast():
    assert parse_matrix_condition("contractor.status IN [NPD_PHYSICAL, IP_NPD]") == {"operator":"IN","field_key":"contractor.status","value":["NPD_PHYSICAL","IP_NPD"]}
    tree=parse_matrix_condition("performance.personal == false OR performance.third_parties == true")
    assert tree["operator"]=="OR" and tree["conditions"][0]["value"] is False and tree["conditions"][1]["value"] is True


def test_exact_training_operations_choose_structural_mechanisms_fail_closed():
    payment={"occurrence_id":"O009","rf_id":"RF007","locator":"word/document.xml#/p[60]","status":"CANDIDATE_FOUND"}
    assert _region_spec(payment) == ("CONDITIONAL_PARAGRAPH_GROUP","word/document.xml#/p[60]","word/document.xml#/p[62]",{"operator":"EQUALS","field_key":"payment.model","value":"MIXED"})
    column={"occurrence_id":"O023","rf_id":"RF020","locator":"word/document.xml#/tbl[2]/tr[1]/tc[7]/p[1]","status":"CANDIDATE_FOUND"}
    assert _region_spec(column)[0] == "CONDITIONAL_TABLE_COLUMN"
    repeating={"occurrence_id":"O024","rf_id":"RF021","locator":"x","status":"CANDIDATE_FOUND"}
    assert _region_spec(repeating) is None and _review_reason(repeating)[0] == "MULTI_ROW_REPEAT"


def test_ordered_matrix_decision_rule_selects_draft_variant_deterministically():
    from types import SimpleNamespace
    from app.contract_products import ContractVariantResolver
    field=SimpleNamespace(field_key="contractor.status",field_type="SINGLE_SELECT",required=True,config={"options":["PERSON","IP"]})
    condition={"operator":"EQUALS","field_key":"contractor.status","value":"IP"}
    version=SimpleNamespace(rules={"decision_rules":[{"rule_id":"D016","priority":16,"state":"SELECTED","variant_code":"INDIVIDUAL_ENTREPRENEUR","condition":condition}]})
    variant=SimpleNamespace(id="ip",code="INDIVIDUAL_ENTREPRENEUR",name="ИП",template_version_id="draft-ip",status="ACTIVE",selection_condition=condition)
    result=ContractVariantResolver.resolve(version,[field],[variant],{"contractor.status":"IP"})
    assert result["state"] == "SELECTED" and result["variant_id"] == "ip" and result["rule_id"] == "D016"
