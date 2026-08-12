from __future__ import annotations

import sys
import time
import types
from io import BytesIO

import pytest
from pypdf import PdfWriter

import fountain.pdf_extract as pdf_extract
from fountain.pdf_extract import (
    MAX_PDF_PAGES,
    PdfExtractError,
    extract_pdf,
    text_layer_usable,
)


def _encrypted_pdf_bytes(*, user_password: str) -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    plain = BytesIO()
    writer.write(plain)
    locked = PdfWriter(clone_from=BytesIO(plain.getvalue()))
    locked.encrypt(user_password=user_password, owner_password="owner")
    out = BytesIO()
    locked.write(out)
    return out.getvalue()


def test_text_layer_usable_enough_chars():
    pages = ["x" * 50, "y" * 50]
    assert text_layer_usable(pages) is True


def test_text_layer_rejects_mostly_empty():
    assert text_layer_usable(["", "   ", "hi"]) is False


def test_extract_uses_text_layer_when_usable():
    def fake_text(_data: bytes) -> list[str]:
        return ["INT. BAR - NIGHT\n\nDAN\nHello.\n" * 20]

    result = extract_pdf(
        b"%PDF-fake",
        text_extractor=fake_text,
        ocr_engine=lambda d: (_ for _ in ()).throw(AssertionError("ocr")),
    )
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
        extract_pdf(
            b"x" * (20 * 1024 * 1024 + 1),
            text_extractor=lambda d: [],
            ocr_engine=lambda d: [],
        )
    assert ei.value.code == "VALIDATION"


def test_text_layer_unlocks_empty_user_password_pdf():
    # Owner-restricted exports often keep is_encrypted True after decrypt("").
    pages = pdf_extract._extract_text_layer_with_pypdf(
        _encrypted_pdf_bytes(user_password="")
    )
    assert len(pages) == 1


def test_text_layer_rejects_password_required_pdf():
    with pytest.raises(PdfExtractError) as ei:
        pdf_extract._extract_text_layer_with_pypdf(
            _encrypted_pdf_bytes(user_password="secret")
        )
    assert ei.value.code == "VALIDATION"
    assert "Encrypted" in ei.value.message


def test_extract_rejects_max_pdf_pages_plus_one():
    pages = ["x" * 50] * (MAX_PDF_PAGES + 1)

    with pytest.raises(PdfExtractError) as ei:
        extract_pdf(
            b"%PDF-fake",
            text_extractor=lambda _data: pages,
            ocr_engine=lambda _data: [],
        )

    assert ei.value.code == "VALIDATION"


def test_default_ocr_times_out_blocking_page_work(monkeypatch):
    class FakeRenderedPage:
        def to_pil(self):
            return object()

    class FakePage:
        def render(self, *, scale: int):
            assert scale == 2
            return FakeRenderedPage()

        def close(self):
            pass

    class FakePdf:
        def __init__(self, _data: bytes):
            pass

        def __len__(self):
            return 1

        def __getitem__(self, _index: int):
            return FakePage()

        def close(self):
            pass

    def slow_image_to_string(_image: object, *, lang: str):
        assert lang == "eng"
        time.sleep(0.05)
        return "OCR text"

    monkeypatch.setitem(sys.modules, "pypdfium2", types.SimpleNamespace(PdfDocument=FakePdf))
    monkeypatch.setitem(
        sys.modules,
        "pytesseract",
        types.SimpleNamespace(
            TesseractNotFoundError=RuntimeError,
            image_to_string=slow_image_to_string,
        ),
    )
    monkeypatch.setattr(pdf_extract, "OCR_TIMEOUT_SECONDS", 0.01)

    ocr = pdf_extract._extract_ocr_with_tesseract(clock=time.monotonic)

    with pytest.raises(PdfExtractError) as ei:
        ocr(b"%PDF-fake")

    assert ei.value.code == "UNAVAILABLE"


def test_an_overrunning_ocr_render_is_abandoned_without_freeing_its_pdfium_memory(
    monkeypatch,
):
    """Two hazards on the OCR timeout path, both invisible to the caller.

    The stranded render must run on a daemon thread: a `ThreadPoolExecutor`
    worker is joined by the interpreter at exit, so `shutdown(wait=False)` only
    deferred the wait to process teardown. And it ran per page, so a 150-page
    scan could strand 150 of them.

    Worse, the old code closed the page in a `finally` and the document right
    after, while that render was still inside native pdfium memory. Freeing a
    buffer under a live reader is a segfault, not an exception -- so on this
    path nothing may be closed, and the objects are quarantined instead.
    """
    import threading

    started = threading.Event()
    release = threading.Event()
    closed: list[str] = []
    worker: dict[str, threading.Thread] = {}

    class FakeRenderedPage:
        def to_pil(self):
            return object()

    class FakePage:
        def render(self, *, scale: int):
            worker["thread"] = threading.current_thread()
            started.set()
            release.wait(10)  # still rendering when the deadline passes
            return FakeRenderedPage()

        def close(self):
            closed.append("page")

    class FakePdf:
        def __init__(self, _data: bytes):
            pass

        def __len__(self):
            return 1

        def __getitem__(self, _index: int):
            return FakePage()

        def close(self):
            closed.append("document")

    monkeypatch.setitem(sys.modules, "pypdfium2", types.SimpleNamespace(PdfDocument=FakePdf))
    monkeypatch.setitem(
        sys.modules,
        "pytesseract",
        types.SimpleNamespace(
            TesseractNotFoundError=RuntimeError,
            image_to_string=lambda _image, *, lang: "OCR text",
        ),
    )
    monkeypatch.setattr(pdf_extract, "OCR_TIMEOUT_SECONDS", 0.05)
    quarantined = len(pdf_extract._ABANDONED_PDF_OBJECTS)

    ocr = pdf_extract._extract_ocr_with_tesseract(clock=time.monotonic)
    with pytest.raises(PdfExtractError) as ei:
        ocr(b"%PDF-fake")

    assert ei.value.code == "UNAVAILABLE"
    assert started.wait(1), "the render really started, so there is live work to strand"
    assert worker["thread"].daemon, (
        "the stranded render must be a daemon thread; a non-daemon worker is joined "
        "by the interpreter at exit, which is the hang this guards"
    )
    assert closed == [], "nothing may be freed while the render still holds it"
    assert len(pdf_extract._ABANDONED_PDF_OBJECTS) == quarantined + 2, (
        "page and document are both kept alive, so finalizers cannot free them either"
    )
    release.set()
