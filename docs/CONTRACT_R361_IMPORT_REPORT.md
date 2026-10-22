# R3.6.1 training contract import report

## Result

The safe draft portion was imported for owner `ivanov`. Product `TRAINING_CONTRACT` and draft version 1 were created with 37 scalar facts from the matrix. A second identical import created no product, version, or field duplicates. Nothing was published.

## Imported data

| Object | Result |
| --- | ---: |
| Draft contract products | 1 |
| Draft product versions | 1 |
| Scalar common fields | 37 |
| Variants | 0 |
| RF fields verified by generation | 0/25 |
| Structural occurrences verified by generation | 0/74 |
| Matrix scenarios executed against complete resolver | 0/120 |

Three collection facts (`appendices.other`, `schedule.months`, `schedule.entries`) were rejected instead of being converted to misleading text fields. The draft and its scalar questions are editable through the existing R4 product-management interface.

## Import behavior

`python scripts/import_training_contracts.py` performs a dry run. `--apply --owner <external_id>` writes only the safe draft subset. The source hash plus product code forms an import signature. Existing published versions are never selected for mutation, existing fields are retained, and the second local run reported `created_product=false` and `created_fields=0`.

The importer validates the pinned source hashes and inventory before a write. It uses the universal `ContractProduct`, `ContractProductVersion`, and `ContractProductField` models; it introduces no training-specific rendering path.

## Why variants were not imported

The universal API requires a variant to reference a published template version. Both real template versions are DRAFT. Publishing them automatically would bypass the required legal/configuration review, so the importer fails closed at this boundary.
