from pathlib import Path

from app.training_contract_audit import audit_training_sources


def test_r36_source_inventory_and_immutable_hashes():
    root = Path(__file__).parents[2] / "contract_templates" / "training"
    result = audit_training_sources(root)
    assert result["integrity"]["all_files_match"]
    assert result["inventory"]["facts"] == 40
    assert result["inventory"]["red_fields"] == 25
    assert result["inventory"]["red_occurrences"] == 74
    assert result["inventory"]["decision_rules"] == 19
    assert result["inventory"]["prompt_tests"] == 120
    assert {x["tables"] for x in result["inventory"]["docx"].values()} == {18}
    assert result["integrity"]["unique_field_ids"]
    assert result["integrity"]["all_occurrences_reference_fields"]
