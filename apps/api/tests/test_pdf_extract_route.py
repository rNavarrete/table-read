from __future__ import annotations

from fastapi.testclient import TestClient

import fountain.pdf_extract as pdf_extract
from fountain.pdf_extract import PdfExtractError
from main import app
from schemas import PdfExtractResult

URL = "/api/v1/projects/import/extract-pdf"

client = TestClient(app)


def test_extract_pdf_route_happy(monkeypatch):
    def fake_extract(data: bytes) -> PdfExtractResult:
        assert data.startswith(b"%PDF")
        return PdfExtractResult(
            text="HELLO",
            method="text_layer",
            page_count=1,
            warnings=[],
        )

    monkeypatch.setattr(pdf_extract, "extract_pdf", fake_extract)

    response = client.post(
        URL,
        files={"file": ("s.pdf", b"%PDF-1.4 ...", "application/pdf")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "text": "HELLO",
        "method": "text_layer",
        "pageCount": 1,
        "warnings": [],
    }


def test_extract_pdf_rejects_non_pdf(monkeypatch):
    def fail_if_called(_data: bytes) -> PdfExtractResult:
        raise AssertionError("extract_pdf should not run for non-PDF uploads")

    monkeypatch.setattr(pdf_extract, "extract_pdf", fail_if_called)

    response = client.post(
        URL,
        files={"file": ("x.txt", b"not pdf", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION"


def test_extract_pdf_maps_unavailable_error(monkeypatch):
    def fake_extract(_data: bytes) -> PdfExtractResult:
        raise PdfExtractError("UNAVAILABLE", "Install/configure Tesseract for PDF OCR")

    monkeypatch.setattr(pdf_extract, "extract_pdf", fake_extract)

    response = client.post(
        URL,
        files={"file": ("scan.pdf", b"%PDF-1.4 ...", "application/pdf")},
    )

    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "UNAVAILABLE",
            "message": "Install/configure Tesseract for PDF OCR",
        }
    }
