"""The AutomationEdge Knowledge Management (KM) API that answers HR policy questions.

``GET /token`` (headers ``Project-Id`` and ``Project-Secret``) returns a bearer token; ``POST /query`` takes the chat history and answers
from the policy documents, with the source documents it used (``data_points``). The token is kept until shortly before it expires.
"""

import base64
import json
import logging
import re
import threading
import time

import requests

from app.core.config import Settings
from app.core.exceptions import IntegrationError, IntegrationNotConfiguredError
from app.integrations.http import build_session, error_text

logger = logging.getLogger(__name__)
SYSTEM = "Knowledge base"

_RENEW_EARLY_SECONDS = 60
_DEFAULT_TOKEN_SECONDS = 600  # when the token does not say when it expires
_CITATION = re.compile(r"\s*\[S\d+\]")  # the answer cites its sources as [S1], [S2] ...

# What the KM search is asked to do (the same settings as the Postman collection the API came with).
_OVERRIDES = {"retrieval_mode": "hybrid", "semantic_ranker": True, "semantic_captions": False, "top": 3, "suggest_followup_questions": False}


def _token_expiry(token: str) -> float:
    """When a JWT expires (its ``exp`` claim), or a short default if it cannot be read."""
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return float(claims["exp"])
    except (IndexError, KeyError, ValueError, TypeError):
        return time.time() + _DEFAULT_TOKEN_SECONDS


class KnowledgeBaseClient:
    def __init__(self, settings: Settings):
        self._s = settings
        self._session = build_session(settings.verify_ssl)
        self._lock = threading.Lock()
        self._token: str | None = None
        self._token_expiry = 0.0

    def is_configured(self) -> bool:
        return bool(self._s.km_project_id.strip() and self._s.km_project_secret.get_secret_value().strip())

    def _base(self) -> str:
        return self._s.km_base_url.rstrip("/")

    def _authorization(self) -> str:
        """The bearer token, fetched with the project id and secret and reused until it is about to expire."""
        if not self.is_configured():
            raise IntegrationNotConfiguredError(SYSTEM)
        with self._lock:
            if self._token and time.time() < self._token_expiry - _RENEW_EARLY_SECONDS:
                return self._token
            headers = {"Project-Id": self._s.km_project_id.strip(), "Project-Secret": self._s.km_project_secret.get_secret_value().strip()}
            try:
                response = self._session.get(f"{self._base()}/token", headers=headers, timeout=self._s.km_timeout_seconds)
            except requests.RequestException as exc:
                raise IntegrationError(SYSTEM, f"could not be reached: {exc}") from exc
            if response.status_code in (401, 403):
                raise IntegrationError(SYSTEM, "the project id or secret was rejected. Check KM_PROJECT_ID and KM_PROJECT_SECRET in .env.")
            if not response.ok:
                raise IntegrationError(SYSTEM, f"could not give a token ({error_text(response)})")
            token = self._read_token(response)
            self._token, self._token_expiry = token, _token_expiry(token)
            return token

    @staticmethod
    def _read_token(response: requests.Response) -> str:
        try:
            body = response.json()
        except ValueError:
            body = response.text
        token = body if isinstance(body, str) else (body.get("token") or body.get("access_token") or body.get("jwt")) if isinstance(body, dict) else None
        token = (token or "").strip().strip('"')
        if not token:
            raise IntegrationError(SYSTEM, "did not return a token.")
        return token

    def ask(self, question: str, history: list[tuple[str, str]]) -> dict:
        """Ask a question. ``history`` is the earlier (question, answer) pairs of this chat. Returns {answer, sources: [file names]}."""
        turns = [{"user": q, "bot": a} for q, a in history] + [{"user": question}]
        body = {"history": turns, "filters": [], "overrides": _OVERRIDES}
        token = self._authorization()
        try:
            response = self._session.post(f"{self._base()}/query", json=body, headers={"Authorization": f"Bearer {token}"}, timeout=self._s.km_timeout_seconds)
        except requests.RequestException as exc:
            raise IntegrationError(SYSTEM, f"could not be reached: {exc}") from exc
        if response.status_code in (401, 403):
            with self._lock:
                self._token = None  # the token was refused: get a new one next time
            raise IntegrationError(SYSTEM, "refused the token. Try again.")
        if not response.ok:
            raise IntegrationError(SYSTEM, f"could not answer ({error_text(response)})")
        try:
            data = response.json()
        except ValueError as exc:
            raise IntegrationError(SYSTEM, "returned an answer that could not be understood.") from exc
        answer = _CITATION.sub("", str(data.get("answer") or "")).strip()
        if not answer:
            raise IntegrationError(SYSTEM, "did not return an answer.")
        sources: list[str] = []
        for point in data.get("data_points") or []:
            name = str(point.get("filename") or point.get("sourcepage") or "").strip()
            if name and name not in sources:
                sources.append(name)
        logger.info("Knowledge base answered a question with %d source(s)", len(sources))  # never log the question or the answer
        return {"answer": answer, "sources": sources}
