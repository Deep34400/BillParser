# Invoice compare

Pure diff on `ParsedInvoiceData`. No OCR unless the caller sent two files.

## Inputs

| Mode | Request | First step |
|------|---------|------------|
| ids | `{ id1, id2 }` or `GET ?id1=&id2=` | Load `parsed_data` |
| json | `{ mode: "json", left, right }` | Coerce JSON |
| files | multipart `fileA` + `fileB` | Upload + OCR, then compare by ids |

## Matching

1. Exact part / labour code, then exact name
2. Fuzzy token overlap if amounts are within 15%
3. Optional AI on leftovers only (`brake pad` vs `pads`) — Settings **Compare model**, Gemini by default
4. Deterministic validation drops weak AI pairs (low confidence, reused index, amount Δ &gt; 40% with almost no name overlap)
5. A **separate** summary prompt writes the reviewer note; invented names are flagged
6. Unmatched → missing in B / extra in B
7. `mismatches[]` is the user checklist

Totals always stay rule-based. AI never changes money.

Request body can override the Settings model: `{ compareProvider, compareModel }`.
