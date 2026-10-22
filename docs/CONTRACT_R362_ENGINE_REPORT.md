# R3.6.2 universal engine report

## Result

The universal constructor now supports deterministic text expressions, standalone collections, nested composite values, and conditional DOCX table columns. No training-contract-specific renderer was added and no real RF configuration was imported in this stage.

## Closed P0 capability gaps

- Text values use an allowlisted AST: literal, field reference with an existing formatter, `CONCAT`, and conditional `IF`. Depth, node count, literal length, output length, field references, formats, and conditions are validated server-side. There is no `eval`, executable template language, or LLM.
- `LIST` answers support ordered string items, min/max limits, per-item length/regex validation, draft persistence, conditional visibility through `ConditionEngine`, and configurable DOCX separators.
- `COMPOSITE` answers retain typed keyed components, required-component validation, nesting up to four levels, deterministic formatting, and JSON draft persistence. Values are not logged by the new code.
- `CONDITIONAL_TABLE_COLUMN` reuses `ConditionalDocumentRegion`. It validates `tblGrid`, logical column coverage, `gridSpan`, and vertical merges; it updates spans, removes the matching cells, and transfers the removed grid width to an adjacent column. Unsafe layouts fail closed.

## R4 configuration

Specialists can select “Повторяемый список” or “Составное значение”, configure limits/components and nesting, assemble text from approved literal and field parts or choose two literal alternatives through a visual condition, and select a DOCX cell followed by “Колонка”. No JSON editing is required. Employee questionnaires provide add/remove/reorder controls for lists and structured component inputs.

## Real schedule-table check

Matrix locations T1 and T6 are zero-based and correspond to adapter tables 2 and 7. The target logical column 7 in both schedule tables of both immutable training DOCX files passed `tblGrid`, row coverage, `gridSpan`, and vertical-merge checks. This establishes structural feasibility, not RF020 generation acceptance; R3.6.3 must create actual regions and generate both variants.

## Compatibility and safety

Existing condition, region, repeating-row, numeric calculation, product, pinning, immutable-version, storage, and rendering paths remain in use. Migration `014_table_column_regions` only extends the conditional-region type constraint. Draft-only mutation checks remain unchanged.

## Remaining blockers for R3.6.3

- Create the actual fields, expressions, composite/list definitions, regions, repeaters, mappings, and 74 structural bindings.
- Publish reviewed template versions explicitly before product variants can be attached.
- Execute the 120 deterministic fact fixtures and generate/control both real DOCX variants.
- Complete automated OOXML assertions and manual Microsoft Word visual acceptance.

## Verification

The final commit hash and exact test totals are recorded in the delivery summary after the complete regression, Docker build, migration, and health checks.
