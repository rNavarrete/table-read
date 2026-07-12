# PDF Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let writers upload a `.pdf`, extract plain text on the server with pypdf + Tesseract (no LLM tokens), edit/confirm the text, then run the existing Create & analyze import path.

**Architecture:** New `POST /projects/import/extract-pdf` returns `PdfExtractResult`. Extract module tries pypdf text-layer first; if density fails, rasterize with pypdfium2 and OCR via pytesseract/Tesseract. Import wizard gains a confirm-source step; analyze still uses `POST /projects/import` with `format: "text"`.

**Tech Stack:** FastAPI multipart, `pypdf`, `pypdfium2`, `pytesseract`, system `tesseract` + `eng`; React ImportWizard; Zod/Pydantic contract. Spec: `docs/superpowers/specs/2026-07-12-pdf-import-design.md`.

## Global Constraints

- No LLM / Anthropic calls in the extract path (or its tests).
- Writer must edit/confirm extracted text before Create & analyze (trust promise).
- No AGPL (no PyMuPDF).
- Caps: **20 MiB**, **150 pages**, OCR wall budget **120s**.
- Rule 5: log pageCount/method/bytes/duration/warning codes — never script text.
- Schema changes: Zod + Pydantic + data-contract; `make check-contract` green.
- Flag new deps in PR description with one-line justification each.
- Mock OCR/text engines on PR path so CI does not require Tesseract.
- Commit style: `area: imperative summary`.

---

## File map

| Area | Files |
|---|---|
| Contract | `packages/contract/src/index.ts`, `apps/api/schemas.py`, `docs/tableread-data-contract.md` |
| Extract | `apps/api/fountain/pdf_extract.py` (new), `apps/api/tests/test_pdf_extract.py` |
| API | `apps/api/routes.py`, `apps/api/tests/test_pdf_extract_route.py` |
| Deps | `apps/api/requirements.txt`, README or Makefile note for Tesseract |
| Web | `apps/web/src/api/client.ts`, `ImportWizard.tsx`, tests |
| Docs | design-doc §4.8, UI spec, test plan, build plan |

---

### Task 1: Contract + extract module (injectable engines)

**Files:**
- Modify: `packages/contract/src/index.ts` — add `PdfExtractMethod`, `PdfExtractResult`
- Modify: `apps/api/schemas.py` — Pydantic mirrors
- Modify: `docs/tableread-data-contract.md` — types + endpoint stub section
- Create: `apps/api/fountain/pdf_extract.py`
- Create: `apps/api/tests/test_pdf_extract.py`
- Modify: `apps/api/requirements.txt` — `pypdf`, `pypdfium2`, `pytesseract` (pin versions)

**Interfaces:**
- Produces:
```python
MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_PDF_PAGES = 150
OCR_TIMEOUT_SECONDS = 120

@dataclass(frozen=True)
class PdfExtractResult:
    text: str
    method: Literal["text_layer", "ocr"]
    page_count: int
    warnings: list[str]

class PdfExtractError(Exception):
    def __init__(self, code: str, message: str): ...

def text_layer_usable(texts_by_page: list[str]) -> bool: ...

def extract_pdf(
    data: bytes,
    *,
    text_extractor=None,  # (data) -> list[str] page texts
    ocr_engine=None,      # (data) -> list[str] page texts
    clock=time.monotonic,
) -> PdfExtractResult: ...
```
- Zod:
```ts
export const PdfExtractMethod = z.enum(['text_layer', 'ocr'])
export const PdfExtractResult = z.object({
  text: z.string(),
  method: PdfExtractMethod,
  pageCount: z.number().int().positive(),
  warnings: z.array(z.string()),
})
```

- [ ] **Step 1: Add failing unit tests for usability + extract orchestration**

```python
# apps/api/tests/test_pdf_extract.py
from fountain.pdf_extract import extract_pdf, text_layer_usable, PdfExtractError

def test_text_layer_usable_enough_chars():
    pages = ["x" * 50, "y" * 50]
    assert text_layer_usable(pages) is True

def test_text_layer_rejects_mostly_empty():
    assert text_layer_usable(["", "   ", "hi"]) is False

def test_extract_uses_text_layer_when_usable():
    def fake_text(_data: bytes) -> list[str]:
        return ["INT. BAR - NIGHT\n\nDAN\nHello.\n" * 20]

    result = extract_pdf(b"%PDF-fake", text_extractor=fake_text, ocr_engine=lambda d: (_ for _ in ()).throw(AssertionError("ocr")))
    assert result.method == "text_layer"
    assert "DAN" in result.text

def test_extract_falls_back_to_ocr():
    def fake_text(_data: bytes) -> list[str]:
        return ["", ""]

    def fake_ocr(_data: bytes) -> list[str]:
        return ["OCR LINE ONE", "OCR LINE TWO"]

    result = extract_pdf(b"%PDF-fake", text_extractor=fake_text, ocr_engine=fake_ocr)
    assert result.method == "ocr"
    assert "OCR LINE ONE" in result.text
    assert "ocr_used" in result.warnings

def test_extract_rejects_oversize():
    with pytest.raises(PdfExtractError) as ei:
        extract_pdf(b"x" * (20 * 1024 * 1024 + 1), text_extractor=lambda d: [], ocr_engine=lambda d: [])
    assert ei.value.code == "VALIDATION"
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd apps/api && .venv/bin/pytest tests/test_pdf_extract.py -v
```

- [ ] **Step 3: Implement contract + `pdf_extract.py` + pin deps**

Default `text_extractor` uses pypdf; default `ocr_engine` uses pypdfium2 render + pytesseract. If Tesseract missing when OCR needed, raise `PdfExtractError("UNAVAILABLE", ...)`.

Usability (spec): usable if `len(stripped) >= max(200, 40 * pageCount)` OR ≥50% of pages have ≥20 non-whitespace chars.

- [ ] **Step 4: `make check-contract` + tests PASS; commit**

```bash
git add packages/contract apps/api/schemas.py apps/api/fountain/pdf_extract.py \
  apps/api/tests/test_pdf_extract.py apps/api/requirements.txt docs/tableread-data-contract.md
git commit -m "$(cat <<'EOF'
import: add PdfExtractResult and pypdf/tesseract extract module

EOF
)"
```

---

### Task 2: Extract HTTP route

**Files:**
- Modify: `apps/api/routes.py` — `POST /import/extract-pdf` before `/{pid}` catch-alls
- Create: `apps/api/tests/test_pdf_extract_route.py`
- Modify: `docs/tableread-data-contract.md` — full endpoint docs

**Interfaces:**
- `POST /api/v1/projects/import/extract-pdf` multipart field `file` → `PdfExtractResult`
- Map `PdfExtractError` → existing `ApiError` envelope (`VALIDATION` / `UNAVAILABLE`)

- [ ] **Step 1: Failing API tests**

```python
def test_extract_pdf_route_happy(client, monkeypatch):
    monkeypatch.setattr(
        "fountain.pdf_extract.extract_pdf",
        lambda data, **kw: PdfExtractResult(text="HELLO", method="text_layer", page_count=1, warnings=[]),
    )
    r = client.post(
        "/api/v1/projects/import/extract-pdf",
        files={"file": ("s.pdf", b"%PDF-1.4 ...", "application/pdf")},
    )
    assert r.status_code == 200
    assert r.json()["method"] == "text_layer"
    assert r.json()["text"] == "HELLO"

def test_extract_pdf_rejects_non_pdf(client):
    r = client.post(
        "/api/v1/projects/import/extract-pdf",
        files={"file": ("x.txt", b"not pdf", "text/plain")},
    )
    assert r.status_code == 400
```

- [ ] **Step 2: Implement route; tests PASS; commit**

```bash
git commit -m "$(cat <<'EOF'
api: POST /projects/import/extract-pdf

EOF
)"
```

---

### Task 3: Import wizard — `.pdf` + confirm-source step

**Files:**
- Modify: `apps/web/src/api/client.ts` — `extractPdf(file: File): Promise<PdfExtractResult>`
- Modify: `apps/web/src/projects/wizard/ImportWizard.tsx` — accept `.pdf`; extract on select; confirm-source UI
- Modify: `apps/web/src/projects/wizard/ImportWizard.test.tsx`
- Modify: `apps/web/src/projects/wizard/importSourceStats.ts` if needed

**Interfaces:**
- `ACCEPTED_EXTENSIONS = ['.fountain', '.txt', '.pdf']`
- On PDF file: `POST` extract → set `source`, `sourceFormat: 'text'`, show method badge + warnings; enable editing before analyze
- Create & analyze body unchanged: `{ format: 'text', content: source, ... }`

- [ ] **Step 1: Failing component tests**

- PDF file triggers extract client and fills textarea  
- Edited text is what analyze would send  
- Non-pdf still rejected locally  

- [ ] **Step 2: Implement UI + client; tests PASS**

Wizard copy: after PDF extract, a **Confirm source** section (textarea) before project basics / Create & analyze. Show `Text layer` vs `OCR` muted badge.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
web: PDF upload with confirm-source before analyze

EOF
)"
```

---

### Task 4: Docs + Tesseract bootstrap + optional e2e

**Files:**
- Modify: `docs/narrative-sidekick-design-doc.md` §4.8  
- Modify: `docs/tableread-ui-spec.md` import section  
- Modify: `docs/tableread-test-plan.md`  
- Modify: `docs/tableread-build-plan.md`  
- Modify: `docs/superpowers/specs/2026-07-10-new-project-flow-design.md` non-goal (PDF exception)  
- Modify: `docs/superpowers/specs/2026-07-12-pdf-import-design.md` — Status → `approved`  
- Modify: root `README.md` or `Makefile` / `apps/api/README` — install `tesseract` + eng for OCR  
- Optional: `apps/web/e2e/` PDF path with mocked extract if easier than real PDF

- [ ] **Step 1: Doc edits reflecting extract→confirm→analyze**

- [ ] **Step 2: Bootstrap note** (macOS `brew install tesseract`; Debian `tesseract-ocr tesseract-ocr-eng`)

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: PDF import extract-confirm path and Tesseract bootstrap

EOF
)"
```

---

## Spec coverage

| Spec § | Task |
|---|---|
| pypdf + Tesseract, no LLM extract | 1 |
| Caps / usability / errors | 1–2 |
| Extract endpoint | 2 |
| Confirm-source wizard + `.pdf` | 3 |
| Docs / bootstrap | 4 |
| Non-goals (FDX, AGPL, cloud OCR) | honored |

## Self-review

- No TBD placeholders.  
- Analyze path unchanged (`format: "text"`).  
- PR CI never requires Tesseract (injection).  

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-12-pdf-import.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task + review  

**2. Inline Execution** — this session with checkpoints  

Which approach?
