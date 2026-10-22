# R3.6 manual acceptance plan

## Preconditions

- Pilot product and both template versions remain DRAFT until automated acceptance is green and publication is explicitly approved.
- Record source and generated SHA-256 values before opening files.
- Use desktop Microsoft Word for the final visual check; LibreOffice screenshots are supporting evidence only.

## Product scenarios

1. Select a Russian adult physical person and verify the physical-person variant.
2. Select an individual entrepreneur and verify the entrepreneur variant.
3. Verify foreign individual, minor, legal entity, NPD, unpaid service, and third-party performance are blocked with the matrix reason code.
4. Verify incomplete facts remain `NEED_MORE_INFORMATION`, never silently select a variant.
5. Switch variants in one draft and verify answers for each variant are retained separately.

## Document scenarios

For each variant generate documents for PREPAY, MIXED, and POSTPAY. Check that exactly one payment clause remains. Test bank guarantee on/off, extra option on/off and its limit, VAT payer/non-payer where applicable, and long-term resources on/off.

For schedules test 0, 1, 3, and maximum rows; with and without place. Verify order, month names, dates, merged cells, table borders, widths, page breaks, numbering, headers, footers, signatures, and requisites. Search for every source red instruction and confirm that none remains unintentionally.

## Automated evidence required before manual sign-off

- 25/25 RF fields and 74/74 occurrences reported as configured and generated.
- 120/120 matrix fixtures pass.
- Generated files open as valid ZIP/OOXML and contain no broken relationships.
- All expected clauses are present and all excluded clauses are absent.
- Source hashes are unchanged after generation.
- Generated-document history points to pinned product, variant, and template versions.

Record every failure with variant, scenario, generated document ID, field/occurrence ID, expected result, actual result, and severity.
