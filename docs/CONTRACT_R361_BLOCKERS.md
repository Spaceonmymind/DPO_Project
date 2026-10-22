# R3.6.1 blockers

## P0

- Both real `TemplateVersion` records are DRAFT. Product variants cannot legally reference them and the task forbids automatic publication.
- RF003, RF004, RF006, RF009, RF015, RF017, RF018, and RF019 need allowlisted declarative text expressions. The calculation engine currently supports numeric results only.
- RF020 requires a structural whole-table-column include/exclude operation that preserves merged cells and widths.
- RF002 and RF021 require collection semantics; RF024 requires composite output. Converting these to scalar text would lose legal semantics.
- O001-O074 do not yet have non-overlapping structural locators proven by generation against both real files.
- Because the variants and bindings are absent, no real control DOCX exists and no RF item can have `GENERATED_AND_VERIFIED` status.

## P1

- The 120 prompt fixtures contain natural-language inputs. They still need a deterministic fact fixture layer before comparison with `ContractVariantResolver`; the LLM prompt cannot be used at runtime.
- Cross-field payment validation and date-derived `term.more_than_one_year` need universal declarative validation/boolean derivation.
- Manual Microsoft Word inspection remains required after automated OOXML acceptance.

## Minimum universal extensions

1. Allowlisted string templates/conditional text expressions with typed inputs and output limits.
2. Collection and composite questionnaire values with a visual R4 editor.
3. Structural table-column region operation with merged-cell validation.
4. Cross-field validation and boolean/date expressions.
5. Import support for exact adapter locators plus overlap/fingerprint validation before commit.

No blocker should be resolved with global search-and-replace or a training-contract-specific renderer.
