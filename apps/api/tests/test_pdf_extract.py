from __future__ import annotations

import sys
import time
import types

import pytest

import fountain.pdf_extract as pdf_extract
from fountain.pdf_extract import (
    MAX_PDF_PAGES,
    PdfExtractError,
    extract_pdf,
    text_layer_usable,
)


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
