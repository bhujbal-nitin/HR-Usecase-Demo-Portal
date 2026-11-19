"""Reads identity and salary documents and bills with Google Gemini (on Vertex AI, signed in with a service account)."""

import base64
import json
import logging
import mimetypes
import re
import threading
import zipfile
from io import BytesIO
from xml.etree import ElementTree

from app.core.config import Settings
from app.core.exceptions import IntegrationError, IntegrationNotConfiguredError, ValidationFailedError
from app.integrations.http import build_session, error_text
from app.services.usage_service import UsageService

logger = logging.getLogger(__name__)
SYSTEM = "Document scanning"
_SCOPE = "https://www.googleapis.com/auth/cloud-platform"

_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
_WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

_PROMPT = """You are a document-verification assistant for an Indian HR onboarding system.
Look at the attached document and answer ONLY with a JSON object with exactly these keys:
{
  "documentType": one of "aadhaar", "pan", "salary_slip", "other",
  "readable": true if the text is clear enough to read reliably, otherwise false,
  "looksGenuine": false if it is clearly a blank page, an empty template, a screenshot of something else or obviously not a document of that type, otherwise true. A document that is openly marked as a demo, sample or specimen with fictional data (for example "HR portal demo - fictional data") but has the layout and fields of the stated document type counts as genuine for this check: that mark is expected and is not a problem,
  "holderName": the person's full name exactly as printed (for a salary slip: the employee name), or null,
  "dateOfBirth": the date of birth as YYYY-MM-DD, or null if the document shows none,
  "idNumber": the Aadhaar number (12 digits) or PAN (10 characters) printed on it, or null,
  "issues": a list of short plain-English problems you noticed (blurry, cropped, wrong document, ...), empty if none
}
Rules: never list a demo, sample or "fictional data" mark under issues. Never guess a value that is not printed; use null instead. Aadhaar cards may be masked (XXXX XXXX 1234): copy what is shown.
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


class GeminiDocumentReader:
    def __init__(self, settings: Settings, usage: UsageService | None = None):
        self._s = settings
        self._usage = usage
        self._session = build_session()
        self._credentials = None
        self._project: str | None = None
        self._auth_lock = threading.Lock()

    @property
    def model(self) -> str:
        return self._s.gemini_model

    def is_configured(self) -> bool:
        return self._s.google_credentials_file.is_file()

    def check_connection(self) -> str:
        _, project = self._token_and_project()
        return f"Ready (Project: {project}, Model: {self.model})"

    # ----------------------------------------------------------- sign-in
    def _token_and_project(self) -> tuple[str, str]:
        """A current access token for the service account, and the Google Cloud project to bill."""
        try:
            from google.auth.transport.requests import Request
            from google.oauth2 import service_account

            with self._auth_lock:
                if self._credentials is None:
                    self._credentials = service_account.Credentials.from_service_account_file(
                        str(self._s.google_credentials_file), scopes=[_SCOPE]
                    )
                    self._project = self._s.google_project_id.strip() or self._credentials.project_id
                if not self._credentials.valid:
                    self._credentials.refresh(Request())
                token = self._credentials.token
        except (OSError, ValueError, KeyError) as exc:
            raise IntegrationError(SYSTEM, f"its Google service-account file could not be read: {exc}") from exc
        except Exception as exc:  # noqa: BLE001 - google-auth raises its own error types (revoked key, no network...)
            raise IntegrationError(SYSTEM, f"could not sign in to Google: {exc}") from exc
        if not self._project:
            raise IntegrationError(SYSTEM, "has no Google Cloud project. Set GOOGLE_PROJECT_ID in .env.")
        return token, self._project

    def _url(self, project: str) -> str:
        location = self._s.google_location.strip() or "us-central1"
        host = "aiplatform.googleapis.com" if location == "global" else f"{location}-aiplatform.googleapis.com"
        return (
            f"https://{host}/v1/projects/{project}/locations/{location}/publishers/google/models/{self._s.gemini_model}:generateContent"
        )

    # -------------------------------------------------------------- read
    def read(self, filename: str, content: bytes, content_type: str | None, prompt: str = _PROMPT) -> dict:
        """Returns the model's JSON answer to ``prompt`` about the file (default: the identity-document prompt).

        Raises IntegrationError if Google cannot be reached."""
        if not self.is_configured():
            raise IntegrationNotConfiguredError(SYSTEM)

        mime = (content_type or "").split(";")[0].strip().lower()
        if not mime or mime == "application/octet-stream":
            mime = mimetypes.guess_type(filename)[0] or ""
        parts: list[dict] = [{"text": prompt}]
        encoded = base64.b64encode(content).decode("ascii")
        if mime in _IMAGE_TYPES:
            parts.append({"inlineData": {"mimeType": mime, "data": encoded}})
        elif mime == "application/pdf" or filename.lower().endswith(".pdf"):
            parts.append({"inlineData": {"mimeType": "application/pdf", "data": encoded}})
        elif filename.lower().endswith(".docx"):
            text = _docx_text(content)
            if not text.strip():
                raise ValidationFailedError("That Word file has no readable text. Please upload a PDF or a scan.")
            parts.append({"text": f"Document text:\n{text[:12000]}"})
        else:
            raise ValidationFailedError("Only PDF, image or .docx files can be read. Please upload a PDF.")

        body = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
        }
        token, project = self._token_and_project()
        try:
            response = self._session.post(
                self._url(project), json=body, headers={"Authorization": f"Bearer {token}"}, timeout=self._s.gemini_timeout_seconds
            )
        except Exception as exc:  # noqa: BLE001 - network errors of any kind
            raise IntegrationError(SYSTEM, f"could not be reached: {exc}") from exc
        if response.status_code in (401, 403):
            raise IntegrationError(SYSTEM, "was refused by Google. Check that the service account may use Vertex AI in this project.")
        if response.status_code >= 400:
            raise IntegrationError(SYSTEM, error_text(response))
        try:
            answer = response.json()
            text = "".join(p.get("text", "") for p in answer["candidates"][0]["content"]["parts"])
            result = json.loads(text)
        except (KeyError, IndexError, ValueError, TypeError) as exc:
            raise IntegrationError(SYSTEM, "returned an answer that could not be understood.") from exc
        self._track(answer.get("usageMetadata") or {})
        return result

    def _track(self, usage: dict) -> None:
        if self._usage is None:
            return
        prompt = int(usage.get("promptTokenCount") or 0)
        total = int(usage.get("totalTokenCount") or 0)
        # Everything after the prompt is billed as output, including the model's own "thinking" tokens.
        self._usage.record(self._s.gemini_model, prompt, max(total - prompt, 0), total or None)


def clean_digits(value: object) -> str:
    return re.sub(r"\D", "", str(value or ""))
