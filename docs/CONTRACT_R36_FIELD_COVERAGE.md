# R3.6 Coverage of training contracts

## Verified source inventory

The immutable source matrix contains 40 facts, 19 decision rules, 25 canonical red fields, 74 red occurrences, and 120 prompt fixtures. Both DOCX files contain 18 tables. SHA-256 checks and these counts are executable through `python scripts/audit_training_contracts.py`.

## Coverage rule

A field is **covered** only when it has a real questionnaire definition, every applicable occurrence has a structural binding or conditional/repeating region, both variants generate successfully, and output OOXML assertions pass. A row in the spreadsheet alone is not coverage.

| Scope | Source | Configured and generated | Status |
| --- | ---: | ---: | --- |
| Facts | 40 | 0 | BLOCKED |
| Canonical red fields RF001-RF025 | 25 | 0 | BLOCKED |
| Red occurrences O001-O074 | 74 | 0 | BLOCKED |
| Prompt fixtures | 120 | 0 | BLOCKED |
| Physical-person template | 1 | draft upload only | BLOCKED |
| Individual-entrepreneur template | 1 | draft upload only | BLOCKED |

The database inspected during R3.6 had two separate draft template versions with the expected source hashes and no `ContractProduct`. It therefore cannot support an end-to-end acceptance claim.

## Capability gaps found

- `ARRAY` replacement for RF002 is not represented by a universal scalar/repeating binding policy.
- Derived legal clauses RF003, RF004, RF006, RF009, RF015, RF017-RF019 require declarative expressions capable of producing text; current calculations are numeric.
- RF007 needs mutually exclusive block selection across three paragraphs. Conditional regions can express this, but no source configuration exists.
- RF020 needs optional schedule-place column handling; the current repeating-row mechanism does not add/remove a table column.
- RF021 has 36 occurrences and requires a matrix-specific schedule model to be expressed as a reusable repeating group configuration.
- RF024 is an object; the current field type allowlist has no generic object editor/mapping.

These are P0 acceptance defects, not documentation omissions.
