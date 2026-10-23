from pathlib import Path

from app.training_mapping import discover_candidates, matrix_locator


ROOT = Path(__file__).parents[2] / "contract_templates" / "training"


def test_matrix_locations_are_converted_without_text_search():
    assert matrix_locator("P15") == "word/document.xml#/p[16]"
    assert matrix_locator("T1R0C6P0") == "word/document.xml#/tbl[2]/tr[1]/tc[7]/p[1]"
    assert matrix_locator("unknown") is None


def test_real_matrix_discovery_is_complete_and_fail_closed():
    candidates = discover_candidates(ROOT)
    assert len(candidates) == 140
    assert {item["variant"] for item in candidates} == {"PHYSICAL_PERSON", "INDIVIDUAL_ENTREPRENEUR"}
    assert {item["status"] for item in candidates} <= {"CANDIDATE_FOUND", "REVIEW_REQUIRED", "NOT_FOUND"}
    assert all(item["structure_fingerprint"] for item in candidates)
    assert all(item["candidate_id"] and item["rf_id"] for item in candidates)
    # Discovery may propose a node, but never promotes it to a configured binding.
    assert "CONFIGURED" not in {item["status"] for item in candidates}
