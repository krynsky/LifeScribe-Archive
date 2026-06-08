from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from lifescribe.ingest.extractors.base import ExtractionResult
from lifescribe.ingest.extractors.registry import ExtractorRegistry
from lifescribe.ingest.extractors.router import RoutedExtractor
from lifescribe.ingest.registry_default import default_registry


class _FakeTxt:
    mimes: ClassVar[tuple[str, ...]] = ("text/plain",)
    NAME: ClassVar[str] = "fake_txt"
    VERSION: ClassVar[str] = "0.1.0"

    def extract(self, path: Path) -> ExtractionResult:
        return ExtractionResult(
            body_markdown="x", extractor=f"{self.NAME}@{self.VERSION}", confidence=1.0
        )


def test_find_returns_registered_extractor() -> None:
    reg = ExtractorRegistry()
    reg.register(_FakeTxt())
    assert reg.find("text/plain") is not None


def test_find_returns_none_for_unknown_mime() -> None:
    reg = ExtractorRegistry()
    reg.register(_FakeTxt())
    assert reg.find("application/zip") is None


def test_multiple_mimes_per_extractor() -> None:
    class _Multi:
        mimes: ClassVar[tuple[str, ...]] = ("text/plain", "text/markdown")
        NAME: ClassVar[str] = "m"
        VERSION: ClassVar[str] = "0.1.0"

        def extract(self, path: Path) -> ExtractionResult:
            return ExtractionResult(body_markdown="", extractor="m@0.1.0", confidence=1.0)

    reg = ExtractorRegistry()
    reg.register(_Multi())
    assert reg.find("text/plain") is not None
    assert reg.find("text/markdown") is not None


def test_default_registry_routes_pdf_through_docling_only() -> None:
    extractor = default_registry().find("application/pdf")

    assert isinstance(extractor, RoutedExtractor)
    child_ids = [f"{child.NAME}@{child.VERSION}" for child in extractor.extractors_for_tests()]
    assert child_ids == ["docling@0.1.0"]


def test_default_registry_routes_docx_docling_then_native() -> None:
    extractor = default_registry().find(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )

    assert isinstance(extractor, RoutedExtractor)
    child_ids = [f"{child.NAME}@{child.VERSION}" for child in extractor.extractors_for_tests()]
    assert child_ids == ["docling@0.1.0", "docx@0.1.0"]


def test_default_registry_routes_xlsx_docling_then_native() -> None:
    extractor = default_registry().find(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

    assert isinstance(extractor, RoutedExtractor)
    child_ids = [f"{child.NAME}@{child.VERSION}" for child in extractor.extractors_for_tests()]
    assert child_ids == ["docling@0.1.0", "xlsx@0.1.0"]


def test_default_registry_routes_pptx_epub_through_docling_only() -> None:
    reg = default_registry()

    pptx = reg.find("application/vnd.openxmlformats-officedocument.presentationml.presentation")
    epub = reg.find("application/epub+zip")

    assert isinstance(pptx, RoutedExtractor)
    assert isinstance(epub, RoutedExtractor)

    for extractor in (pptx, epub):
        child_ids = [f"{child.NAME}@{child.VERSION}" for child in extractor.extractors_for_tests()]
        assert child_ids == ["docling@0.1.0"]
