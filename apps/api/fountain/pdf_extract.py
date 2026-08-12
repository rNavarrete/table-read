"""PDF-to-text extraction for the import wizard.

Extraction is deterministic infrastructure work, not an LLM step. The public
``extract_pdf`` seam accepts injectable engines so PR-path tests do not require
Tesseract or real PDF fixtures.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO
from typing import Literal

from deadline import DeadlineExceeded, call_within_deadline

MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_PDF_PAGES = 150
OCR_TIMEOUT_SECONDS = 120

PdfPageExtractor = Callable[[bytes], list[str]]
Clock = Callable[[], float]


@dataclass(frozen=True)
class PdfExtractResult:
    text: str
    method: Literal["text_layer", "ocr"]
    page_count: int
    warnings: list[str]


class PdfExtractError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def text_layer_usable(texts_by_page: list[str]) -> bool:
    page_count = len(texts_by_page)
    if page_count == 0:
        return False

    non_whitespace_by_page = [_non_whitespace_len(text) for text in texts_by_page]
    total_chars = sum(non_whitespace_by_page)
    if total_chars >= max(200, 40 * page_count):
        return True

    pages_with_text = sum(1 for count in non_whitespace_by_page if count >= 20)
    return pages_with_text * 2 >= page_count


def extract_pdf(
    data: bytes,
    *,
    text_extractor: PdfPageExtractor | None = None,
    ocr_engine: PdfPageExtractor | None = None,
    clock: Clock = time.monotonic,
) -> PdfExtractResult:
    _validate_pdf_bytes(data)

    extract_text_layer = text_extractor or _extract_text_layer_with_pypdf
    run_ocr = ocr_engine or _extract_ocr_with_tesseract(clock=clock)

    try:
        text_pages = extract_text_layer(data)
    except PdfExtractError:
        raise
    except Exception as exc:
        raise PdfExtractError("VALIDATION", "PDF text layer could not be read") from exc

    _validate_page_count(len(text_pages))
    if text_layer_usable(text_pages):
        return _result(text_pages, method="text_layer", warnings=[])

    try:
        ocr_pages = run_ocr(data)
    except PdfExtractError:
        raise
    except Exception as exc:
        raise PdfExtractError("UNAVAILABLE", "PDF OCR failed") from exc

    _validate_page_count(len(ocr_pages))
    if not _join_pages(ocr_pages):
        raise PdfExtractError("VALIDATION", "PDF extraction produced no text")

    return _result(ocr_pages, method="ocr", warnings=["ocr_used"])


def _validate_pdf_bytes(data: bytes) -> None:
    if len(data) > MAX_PDF_BYTES:
        raise PdfExtractError("VALIDATION", "PDF exceeds the 20 MiB upload limit")
    if not data.startswith(b"%PDF"):
        raise PdfExtractError("VALIDATION", "Uploaded file is not a PDF")


def _validate_page_count(page_count: int) -> None:
    if page_count <= 0:
        raise PdfExtractError("VALIDATION", "PDF has no readable pages")
    if page_count > MAX_PDF_PAGES:
        raise PdfExtractError("VALIDATION", "PDF exceeds the 150 page limit")


def _result(
    texts_by_page: list[str],
    *,
    method: Literal["text_layer", "ocr"],
    warnings: list[str],
) -> PdfExtractResult:
    text = _join_pages(texts_by_page)
    if not text:
        raise PdfExtractError("VALIDATION", "PDF extraction produced no text")
    return PdfExtractResult(
        text=text,
        method=method,
        page_count=len(texts_by_page),
        warnings=warnings,
    )


def _join_pages(texts_by_page: list[str]) -> str:
    return "\n\n".join(text.strip() for text in texts_by_page).strip()


def _non_whitespace_len(text: str) -> int:
    return sum(1 for char in text if not char.isspace())


def _extract_text_layer_with_pypdf(data: bytes) -> list[str]:
    from pypdf import PdfReader

    reader = PdfReader(BytesIO(data))
    if reader.is_encrypted:
        # pypdf keeps is_encrypted True after a successful unlock (common for
        # owner-restricted / empty-user-password exports). Trust decrypt()'s
        # return: 0 = failed, non-zero = unlocked.
        try:
            unlocked = reader.decrypt("")
        except Exception as exc:
            raise PdfExtractError("VALIDATION", "Encrypted PDF could not be read") from exc
        if unlocked == 0:
            raise PdfExtractError("VALIDATION", "Encrypted PDF could not be read")

    _validate_page_count(len(reader.pages))
    return [(page.extract_text() or "") for page in reader.pages]


def _extract_ocr_with_tesseract(*, clock: Clock) -> PdfPageExtractor:
    def extract(data: bytes) -> list[str]:
        try:
            import pypdfium2 as pdfium
            import pytesseract
            from pytesseract import TesseractNotFoundError
        except ImportError as exc:
            raise PdfExtractError("UNAVAILABLE", "PDF OCR dependencies are not installed") from exc

        start = clock()
        try:
            pdf = pdfium.PdfDocument(data)
        except Exception as exc:
            raise PdfExtractError("VALIDATION", "PDF could not be opened for OCR") from exc

        _validate_page_count(len(pdf))
        texts: list[str] = []
        # Set only when a render overruns its deadline and is left running. From
        # that point nothing here may free pdfium memory -- see the handler.
        abandoned = False
        try:
            for index in range(len(pdf)):
                _raise_if_ocr_timed_out(start, clock)

                page = pdf[index]
                try:
                    remaining = OCR_TIMEOUT_SECONDS - (clock() - start)
                    texts.append(
                        call_within_deadline(
                            lambda page=page: _ocr_page(page, pytesseract),
                            remaining,
                            name="pdf-ocr-page",
                        )
                    )
                    _raise_if_ocr_timed_out(start, clock)
                except DeadlineExceeded as exc:
                    # The render is still running inside native pdfium memory.
                    # Closing this page or the document now would free that memory
                    # under a live worker, which is a segfault rather than an
                    # exception -- so quarantine both and let them leak. One
                    # abandoned document per OCR timeout is a fair price for not
                    # taking the API process down, and the timeout has already
                    # failed this import.
                    abandoned = True
                    _quarantine_after_timeout(pdf, page)
                    raise PdfExtractError(
                        "UNAVAILABLE", "PDF OCR exceeded the 120s timeout"
                    ) from exc
                except TesseractNotFoundError as exc:
                    raise PdfExtractError(
                        "UNAVAILABLE", "Install/configure Tesseract for PDF OCR"
                    ) from exc
                finally:
                    if not abandoned:
                        page.close()
        finally:
            if not abandoned:
                pdf.close()

        return texts

    return extract


# Documents and pages whose render overran its deadline and was abandoned mid-
# flight. Holding a reference is the point: pypdfium2 frees native memory from
# its finalizers, so letting these be collected would pull the buffer out from
# under a worker that is still reading it. They are deliberately never emptied.
_ABANDONED_PDF_OBJECTS: list[object] = []


def _quarantine_after_timeout(*objects: object) -> None:
    """Keep abandoned pdfium objects alive so a detached render cannot crash."""
    _ABANDONED_PDF_OBJECTS.extend(objects)


def _raise_if_ocr_timed_out(start: float, clock: Clock) -> None:
    if clock() - start > OCR_TIMEOUT_SECONDS:
        raise PdfExtractError("UNAVAILABLE", "PDF OCR exceeded the 120s timeout")


def _ocr_page(page: object, pytesseract: object) -> str:
    image = page.render(scale=2).to_pil()
    return pytesseract.image_to_string(image, lang="eng") or ""
