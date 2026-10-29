"""Reads identity and salary documents with an OpenAI vision model and returns what is printed on them."""

import base64
import json
import logging
import mimetypes
import re
import zipfile
from io import BytesIO
from xml.etree import ElementTree

from app.core.config import Settings
from app.core.exceptions import IntegrationError, IntegrationNotConfiguredError, ValidationFailedError
from app.integrations.http import build_session, error_text

logger = logging.getLogger(__name__)
SYSTEM = "OpenAI"

_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
_WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

_PROMPT = """You are a document-verification assistant for an Indian HR onboarding system.
Look at the attached document and answer ONLY with a JSON object with exactly these keys:
{
  "documentType": one of "aadhaar", "pan", "salary_slip", "other",
  "readable": true if the text is clear enough to read reliably, otherwise false,
  "looksGenuine": false if it is clearly a blank page, a template, a screenshot of something else or obviously not a real document of that type, otherwise true,
  "holderName": the person's full name exactly as printed (for a salary slip: the employee name), or null,
  "dateOfBirth": the date of birth as YYYY-MM-DD, or null if the document shows none,
  "idNumber": the Aadhaar number (12 digits) or PAN (10 characters) printed on it, or null,
  "issues": a list of short plain-English problems you noticed (blurry, cropped, wrong document, ...), empty if none
}
Rules: never guess a value that is not printed; use null instead. Aadhaar cards may be masked (XXXX XXXX 1234): copy what is shown.
A PAN card shows a 10-character number such as ABCDE1234F. A salary slip shows an employer, an employee name and pay amounts.
Dates on Indian documents are usually DD/MM/YYYY: convert them to YYYY-MM-DD."""


def _docx_text(content: bytes) -> str:
    try:
        with zipfile.ZipFile(BytesIO(content)) as archive:
            root = ElementTree.fromstring(archive.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError) as exc:
        raise ValidationFailedError("That Word file could not be opened. Please upload a PDF or a .docx file.") from exc
    paragraphs = ("".join(t.text or "" for t in p.iter(f"{_WORD_NS}t")) for p in root.iter(f"{_WORD_NS}p"))
    return "\n".join(line for line in paragraphs if line.strip())


class OpenAIDocumentReader:
    def __init__(self, settings: Settings):
        self._s = settings
        self._session = build_session()

    def is_configured(self) -> bool:
        return bool(self._s.openai_api_key.get_secret_value().strip())

    def read(self, filename: str, content: bytes, content_type: str | None) -> dict:
        """Returns the model's JSON answer (see the prompt). Raises IntegrationError if OpenAI cannot be reached."""
        if not self.is_configured():
            raise IntegrationNotConfiguredError(SYSTEM)

        mime = (content_type or "").split(";")[0].strip().lower()
        if not mime or mime == "application/octet-stream":
            mime = mimetypes.guess_type(filename)[0] or ""
        parts: list[dict] = [{"type": "text", "text": _PROMPT}]
        encoded = base64.b64encode(content).decode("ascii")
        if mime in _IMAGE_TYPES:
            parts.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}", "detail": "high"}})
        elif mime == "application/pdf" or filename.lower().endswith(".pdf"):
            parts.append({
                "type": "file",
                "file": {"filename": filename or "document.pdf", "file_data": f"data:application/pdf;base64,{encoded}"},
            })
        elif filename.lower().endswith(".docx"):
            text = _docx_text(content)
            if not text.strip():
                raise ValidationFailedError("That Word file has no readable text. Please upload a PDF or a scan.")
            parts.append({"type": "text", "text": f"Document text:\n{text[:12000]}"})
        else:
            raise ValidationFailedError("Only PDF, image or .docx files can be read. Please upload a PDF.")

        body = {
            "model": self._s.openai_model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": parts}],
        }
        url = f"{self._s.openai_base_url.rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {self._s.openai_api_key.get_secret_value().strip()}"}
        try:
            response = self._session.post(url, json=body, headers=headers, timeout=self._s.openai_timeout_seconds)
        except Exception as exc:  # noqa: BLE001 - network errors of any kind
            raise IntegrationError(SYSTEM, f"could not be reached: {exc}") from exc
        if response.status_code == 401:
            raise IntegrationError(SYSTEM, "the API key was rejected. Check OPENAI_API_KEY in .env.")
        if response.status_code >= 400:
            raise IntegrationError(SYSTEM, error_text(response))
        try:
            answer = response.json()["choices"][0]["message"]["content"]
            return json.loads(answer)
        except (KeyError, IndexError, ValueError, TypeError) as exc:
            raise IntegrationError(SYSTEM, "returned an answer that could not be understood.") from exc


def clean_digits(value: object) -> str:
    return re.sub(r"\D", "", str(value or ""))
