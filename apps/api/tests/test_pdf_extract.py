from __future__ import annotations

import pytest

from fountain.pdf_extract import PdfExtractError, extract_pdf, text_layer_usable


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
