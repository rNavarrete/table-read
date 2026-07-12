# PDF import (extract → confirm → analyze) — design spec

**Date:** 2026-07-12  
**Status:** approved
**Authority after merge:** this spec updates product behavior in `docs/narrative-sidekick-design-doc.md` §4.8 (PDF brought forward from v2 for single-episode import), `docs/tableread-data-contract.md` (extract endpoint + types), `docs/tableread-ui-spec.md` (Import wizard), and `docs/tableread-test-plan.md`. Executable schemas remain authoritative in `packages/contract`. Existing create-and-import SSE (`POST /projects/import`) stays the analyze path; PDF never bypasses writer confirmation.

## 1. Goal

Writers can upload a **`.pdf`** teleplay in the Import wizard. Table Read converts it to **editable plain text without LLM tokens**, the writer reviews/edits that text, then **Create & analyze** runs the existing import pipeline (`format: "text"`).

Trust promise (unchanged):

> **Every AI step is explicit, reviewable, and begins only after you confirm the source material.**

PDF extraction is **not** an AI step. Analyze remains the explicit AI gesture.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Scope | Text-layer PDFs **and** scanned/image PDFs |
| Where extraction runs | Server-only |
| Text extract | **pypdf** (permissive license) |
| OCR | **Tesseract** (open source; system package + `eng` data) |
| Rasterize for OCR | **pypdfium2** (permissive; avoid Poppler install when possible) |
| LLM for extract | **Never** — no Anthropic/token spend for PDF→text |
| Writer confirm | **Required** — editable extracted text before Create & analyze |
| Analyze path | Unchanged SSE create-and-import with `format: "text"` |
| PyMuPDF / AGPL | **Out** for MVP |
| FDX / Word / multi-episode PDF | **Out** |

## 3. Non-goals

- Reconstructing perfect Fountain (slugline heuristics beyond plain text)
- Cloud OCR vendors
- Client-side PDF parsing
- Multi-episode / bible PDF import
- Changing lock, snapshot, or pending_review import guarantees
- Bundling Tesseract into the Python wheel (system install / docs for `make` bootstrap)

## 4. Wizard flow

Import wizard steps become:

1. **Add the script** — Upload (`.fountain` / `.txt` / `.pdf`) or Paste  
2. **Confirm source** (new for PDF; also fine to show for upload/paste when useful) — editable textarea with extracted or pasted text; show `method` badge (`Text layer` / `OCR`) and any warnings  
3. **Confirm basics** — title + format preset (unchanged)
4. **Review source** — source type, filename when available, source counts, deterministic detected-scene count, and the trust note
5. **Analyze** — existing SSE path with named stages; terminal success opens Plan with imported scenes/beats and Ledger pending-review badge

Rules:

- Selecting a PDF never analyzes or creates a project.
- On PDF select: client uploads bytes to extract endpoint; on success fills the confirm-source textarea (`sourceFormat: "text"`).
- Writer may edit freely before analyze.
- Unsupported / failed extract: plain-language error; file retained for retry; no project row created.
- `.fountain` / `.txt` keep today’s path (read locally); optional: still land on confirm-source for consistency.

## 5. Extract API

### 5.1 Endpoint

`POST /api/v1/projects/import/extract-pdf`

- **Request:** `multipart/form-data` with field `file` (application/pdf).  
- **Auth / project:** none (pre-project, same as create-and-import).  
- **Does not** create projects, snapshots, or ledger rows.  
- **Does not** call the LLM.

### 5.2 Response (`PdfExtractResult`)

```ts
{
  text: string
  method: "text_layer" | "ocr"
  pageCount: number
  warnings: string[]  // machine-stable codes or short operator messages; no script body in logs
}
```

Wire: camelCase. Add Zod + Pydantic + data-contract §4/§9.

### 5.3 Errors

| Condition | HTTP | code |
|---|---|---|
| Missing/non-PDF | 400 | `VALIDATION` |
| Over size/page cap | 400 | `VALIDATION` |
| Encrypted/unreadable PDF | 422 | `VALIDATION` (or dedicated code if contract already has one — prefer existing) |
| OCR unavailable (Tesseract missing) when OCR required | 503 | `UNAVAILABLE` or existing infra code — message: install/configure Tesseract |
| Extracted text empty after both paths | 422 | `VALIDATION` |

### 5.4 Caps (MVP)

| Cap | Value |
|---|---|
| Max upload size | **20 MiB** |
| Max pages | **150** |
| OCR page time budget (soft) | Fail whole extract with clear error if OCR exceeds **120s** wall clock |

Exact constants live in one server module; UI may mirror size hint in copy.

## 6. Extract algorithm

Module: e.g. `apps/api/fountain/pdf_extract.py` (or `apps/api/pdf/extract.py`).

1. Validate content-type / magic `%PDF` and caps.  
2. **Text layer:** `pypdf` — concatenate `page.extract_text()` for all pages (preserve page breaks as `\n\n`).  
3. **Usability check:** treat as usable text_layer if  
   - total stripped length ≥ `max(200, 40 * pageCount)` characters, **or**  
   - ≥ 50% of pages have ≥ 20 non-whitespace chars.  
   (Tune in implementation; unit-test the predicate.)  
4. If usable → return `method: "text_layer"`.  
5. Else **OCR:** for each page, render via pypdfium2 → PNG/JPEG → Tesseract `eng` → join with `\n\n`. Return `method: "ocr"`.  
6. If still empty → error.  
7. Warnings examples: `ocr_used`, `low_confidence_length`, `truncated_pages` (if we ever truncate — MVP should reject over cap instead).

**Logging (rule 5):** log pageCount, method, byte size, duration, warning codes — never extracted script text.

**Test seam:** inject fake `text_extractor` / `ocr_engine` so PR-path tests never need Tesseract. Optional CI job with Tesseract for one golden scanned fixture.

## 7. Dependencies

| Dep | Role | Notes |
|---|---|---|
| `pypdf` | Text-layer extract | Flag in PR |
| `pypdfium2` | Page raster for OCR | Flag in PR |
| `pytesseract` | Python wrapper | Flag in PR |
| System `tesseract` + `tessdata-eng` | OCR engine | Document in README / `make` bootstrap; fail soft with 503 if missing when OCR needed |

No AGPL packages in this path.

## 8. Docs touchpoints

- `narrative-sidekick-design-doc.md` §4.8 — PDF single-episode import via extract→confirm (still not FDX/bible/multi-ep).  
- `tableread-data-contract.md` — endpoint + `PdfExtractResult`.  
- `tableread-ui-spec.md` — accept `.pdf`; confirm-source step.  
- `tableread-test-plan.md` — extract unit + wizard e2e.  
- `tableread-build-plan.md` — task entry for PDF import MVP.  
- New-project design spec non-goal list — amend PDF exception.

## 9. Testing

- Unit: text PDF fixture → `text_layer`; image-only/scanned fixture with mocked OCR → `ocr`; oversize/page → 400; empty → 422.  
- Unit: usability predicate edge cases.  
- API: multipart happy path; non-PDF rejected.  
- Web: accept attribute includes `.pdf`; after extract, textarea editable; Create & analyze sends `format: "text"` with edited content.  
- E2E (optional in first PR if fixture heavy): PDF → edit one line → analyze completes (MockLlmClient).  
- Never call Anthropic in extract tests.

## 10. Success criteria

- Writer uploads a text-layer PDF, sees editable text, analyzes successfully.  
- Writer uploads a scan; OCR path runs **without** Anthropic; sees editable text; analyzes successfully (dev machine with Tesseract).  
- PR CI green without requiring Tesseract (mocks).  
- No PDF bytes and no raw extract text in application logs.

## 11. Rollout

1. Contract + extract module + API + unit tests.  
2. Import wizard confirm-source + `.pdf` accept.  
3. Docs + bootstrap note for Tesseract.  
4. Optional: CI job with Tesseract + one scanned fixture.
