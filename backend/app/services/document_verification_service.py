"""Checks an uploaded document with OpenAI: right type, name matches the form, Aadhaar and PAN dates of birth agree."""

import logging
import re
from dataclasses import dataclass, field
from datetime import date
from difflib import SequenceMatcher

from app.core.config import Settings
from app.core.exceptions import ValidationFailedError
from app.integrations.openai_documents import OpenAIDocumentReader, clean_digits

logger = logging.getLogger(__name__)

EXPECTED_TYPE = {"idDoc": "aadhaar", "panDoc": "pan", "salaryDoc": "salary_slip"}
TYPE_LABEL = {"aadhaar": "Aadhaar card", "pan": "PAN card", "salary_slip": "salary slip", "other": "different kind of document"}
_TITLES = {"mr", "mrs", "ms", "miss", "shri", "smt", "dr", "sri", "kumari"}


@dataclass
class Check:
    id: str
    label: str
    passed: bool
    detail: str = ""


@dataclass
class VerificationResult:
    doc_key: str
    detected_type: str
    holder_name: str | None
    date_of_birth: str | None
    id_number_masked: str | None
    checks: list[Check] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(check.passed for check in self.checks)


def _a(label: str) -> str:
    return f"an {label}" if label[0].lower() in "aeiou" else f"a {label}"


def _name_tokens(name: str) -> list[str]:
    words = re.sub(r"[^a-z\s]", " ", name.lower()).split()
    return [w for w in words if w not in _TITLES]


def name_similarity(a: str, b: str) -> float:
    """0-1. Order, case, punctuation and titles do not matter; a missing middle name still counts as a match."""
    ta, tb = _name_tokens(a), _name_tokens(b)
    if not ta or not tb:
        return 0.0
    ratio = SequenceMatcher(None, " ".join(sorted(ta)), " ".join(sorted(tb))).ratio()
    shorter, longer = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    if len(shorter) >= 2 and all(token in longer for token in shorter):
        ratio = max(ratio, 0.95)
    return round(ratio, 3)


def _iso(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


def _mask(doc_type: str, number: str | None) -> str | None:
    """Only a masked form of the number ever leaves this service."""
    if not number:
        return None
    if doc_type == "aadhaar":
        digits = clean_digits(number)
        return f"XXXX XXXX {digits[-4:]}" if len(digits) >= 4 else None
    text = re.sub(r"\s", "", str(number)).upper()
    return f"{text[:2]}XXXXXX{text[-2:]}" if doc_type == "pan" and len(text) == 10 else None


class DocumentVerificationService:
    def __init__(self, settings: Settings, reader: OpenAIDocumentReader):
        self._threshold = settings.document_name_match_threshold
        self._reader = reader
        self._model = settings.openai_model

    @property
    def enabled(self) -> bool:
        return self._reader.is_configured()

    @property
    def model(self) -> str:
        return self._model

    def verify(
        self,
        doc_key: str,
        filename: str,
        content: bytes,
        content_type: str | None,
        form_name: str,
        reference_dob: str | None = None,
    ) -> VerificationResult:
        expected = EXPECTED_TYPE.get(doc_key)
        if expected is None:
            raise ValidationFailedError("This document type is not verified.")
        if not form_name.strip():
            raise ValidationFailedError("The name from the joining form is required.")

        read = self._reader.read(filename, content, content_type)
        detected = read.get("documentType") if read.get("documentType") in TYPE_LABEL else "other"
        holder = (read.get("holderName") or "").strip() or None
        dob = read.get("dateOfBirth") if _iso(read.get("dateOfBirth")) else None
        result = VerificationResult(doc_key, detected, holder, dob, _mask(detected, read.get("idNumber")))
        label = TYPE_LABEL[expected]

        right_type = detected == expected
        clear = bool(read.get("readable", True)) and bool(read.get("looksGenuine", True))
        issues = "; ".join(str(i) for i in (read.get("issues") or [])[:3])
        if right_type and clear:
            detail = ""
        elif not right_type:
            detail = f"This looks like {_a(TYPE_LABEL[detected])}, not {_a(label)}."
        else:
            detail = f"The {label} is not clear or does not look genuine. {issues}".strip()
        result.checks.append(Check("type", f"Is {_a(label)}", right_type and clear, detail))

        if right_type:
            similarity = name_similarity(form_name, holder) if holder else 0.0
            ok = similarity >= self._threshold
            if ok:
                detail = ""
            elif holder:
                detail = f"The {label} shows “{holder}”, the form says “{form_name.strip()}”."
            else:
                detail = f"No name could be read on the {label}."
            result.checks.append(Check("name", "Name matches the joining form", ok, detail))

        if right_type and expected == "pan" and reference_dob:
            ref, mine = _iso(reference_dob), _iso(dob)
            same = bool(ref and mine and ref == mine)
            if same:
                detail = ""
            elif mine and ref:
                detail = f"The PAN shows {mine.strftime('%d/%m/%Y')}, the Aadhaar shows {ref.strftime('%d/%m/%Y')}."
            else:
                detail = "A date of birth could not be read on one of the two cards."
            result.checks.append(Check("dob", "Date of birth matches the Aadhaar card", same, detail))

        logger.info("Document check %s: type=%s passed=%s", doc_key, detected, result.passed)  # never log names or numbers
        return result
