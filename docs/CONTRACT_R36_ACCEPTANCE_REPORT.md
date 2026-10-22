# R3.6 acceptance report for training contracts

## Result

**NOT ACCEPTED.** R3.6 is intentionally left unpublished. The current platform mechanisms from R3.1-R3.5 are present, but the two real training contracts are not configured as a single pilot product and no generated control DOCX can yet be attributed to complete RF001-RF025 / O001-O074 coverage.

## Evidence

- Baseline inspected: `9944fff568fb77ae1a62e2fbe30b21b2b68825c5`.
- Original hashes match the pinned audit hashes and the source files remain outside Git.
- Matrix inventory: 40 facts, 19 deterministic decision rules, 25 red fields, 74 occurrences and 120 test prompts.
- Both source documents have 18 tables.
- Database: two independent draft `TemplateVersion` records, zero contract products, zero published pilot variants.

## Implemented in this increment

A read-only, deterministic source audit was added. It validates immutable hashes, workbook counts, unique RF identifiers, occurrence references, prompt count, and DOCX table counts. It neither changes the source files nor writes application data.

## Acceptance defects

- **P0:** no draft contract product with two real variants and complete mappings.
- **P0:** zero verified bindings against 74 real occurrences.
- **P0:** unsupported or unconfigured array, object, derived-clause, mutually-exclusive block, optional-column, and schedule semantics.
- **P0:** no control DOCX for either variant; therefore no automated OOXML/content acceptance evidence.
- **P1:** 120 matrix scenarios have not been translated into executable resolver fixtures.
- **P1:** employee history/version-retention scenarios have not been exercised on the real product.
- **P1:** no manual Microsoft Word visual inspection has been performed.

## Safe next implementation slice

1. Add universal declarative text expressions and composite/object field support.
2. Add a reusable table-column visibility operation or redesign RF020 as a stable-column rendering rule approved by DPO.
3. Build an idempotent dry-run importer that resolves every occurrence to a structural locator and refuses ambiguous matches.
4. Prepare both template versions and the product in DRAFT, run all 120 fixtures, then request explicit publication approval.
5. Generate both control documents, run OOXML assertions, and complete the manual plan.

No migration was needed for this audit-only increment. Existing data and volumes were not reset.
