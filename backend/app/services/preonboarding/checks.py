"""What the seven pre-onboarding documents are, how Gemini is asked about each, and how the name on one is matched to the candidate's."""

import re
from difflib import SequenceMatcher

from app.integrations.gemini_documents import GeminiDocumentReader
from app.schemas.preonboarding import DOCUMENT_LABELS, DocumentCheck

# What the reader must answer for a document of this key (the "documentType" value that fits it).
EXPECTED_TYPE = {
    "tenth": "tenth_marksheet",
    "twelfth": "twelfth_marksheet",
    "degree": "degree_certificate",
    "aadhaar": "aadhaar",
    "pan": "pan",
    "photo": "photo",
    "resume": "resume",
}
_ALL_TYPES = [*EXPECTED_TYPE.values(), "other"]
NO_NAME = {"photo"}  # a photo shows nobody's printed name
_TITLES = {"mr", "mrs", "ms", "miss", "shri", "smt", "dr", "sri", "kumari"}

_DESCRIBE = {
    "tenth": "a 10th standard (SSC / secondary school) marksheet or certificate. holderName is the student's name.",
    "twelfth": "a 12th standard (HSC / higher secondary) marksheet or certificate. holderName is the student's name.",
    "degree": "a final degree or graduation certificate or marksheet from a university or college. holderName is the graduate's name.",
    "aadhaar": "an Aadhaar card. holderName is the name printed on it; idNumber is the 12-digit number (it may be masked, copy what is shown).",
    "pan": "a PAN card. holderName is the name printed on it; idNumber is the 10-character PAN.",
    "photo": "a passport-style head-and-shoulders portrait of ONE person facing the camera on a plain background. A real photograph or an illustrated / avatar portrait that is marked as a sample or fictional counts as a valid photo for this check (the sample mark is expected). holderName must be null; it is fine that it has no text.",
    "resume": "a resume / CV. holderName is the candidate's name at the top of it.",
}


def prompt_for(key: str) -> str:
    return f"""You are a document-verification assistant for an Indian HR pre-onboarding system.
The attached file should be {_DESCRIBE[key]}
Answer ONLY with a JSON object with exactly these keys:
{{
  "documentType": one of {", ".join(f'"{t}"' for t in _ALL_TYPES)} (the type of document you actually see),
  "readable": true if it is clear enough to read reliably (for a photo: one head-and-shoulders portrait is clearly visible), otherwise false,
  "looksGenuine": false if it is clearly a blank page, an empty template, a screenshot of something else or obviously not a document of that type, otherwise true. A document that is openly marked as a demo, sample or specimen with fictional data (for example "HR portal demo - fictional data") but has the layout and fields of the stated document type counts as genuine for this check: that mark is expected and is not a problem,
  "holderName": the person's full name exactly as printed, or null,
  "idNumber": the number printed on it if the type has one, or null,
  "issues": a list of short plain-English problems you noticed (blurry, cropped, wrong document, ...), empty if none
}}
Rules: never list a demo, sample or "fictional data" mark under issues. Never guess a value that is not printed; use null instead."""


# ------------------------------------------------------------------------------------------------------------ names
def _tokens(name: str) -> list[str]:
    return [w for w in re.sub(r"[^a-z\s]", " ", name.lower()).split() if w not in _TITLES]


def _token_fits(a: str, b: str) -> bool:
    """Two name words are the same, or one is just the other's initial (S. = Sarah)."""
    return a == b or (len(a) == 1 and b.startswith(a)) or (len(b) == 1 and a.startswith(b))


def names_match(expected: str, found: str | None, threshold: float = 0.85) -> bool:
    """Case, punctuation, word order and titles do not matter; a missing middle name or an initial instead of a name still matches."""
    if not found:
        return False
    a, b = _tokens(expected), _tokens(found)
    if not a or not b:
        return False
    if sorted(a) == sorted(b):
        return True
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    if len(shorter) >= 2 or (len(shorter) == 1 and len(longer) == 1):
        remaining = list(longer)
        fits = True
        for word in shorter:
            hit = next((w for w in remaining if _token_fits(word, w)), None)
            if hit is None:
                fits = False
                break
            remaining.remove(hit)
        if fits:
            return True
    return SequenceMatcher(None, " ".join(sorted(a)), " ".join(sorted(b))).ratio() >= threshold


def check_document(reader: GeminiDocumentReader, key: str, filename: str, content: bytes, content_type: str | None, candidate_name: str, threshold: float) -> DocumentCheck:
    """Read one document with Gemini and say whether it is the right, readable, genuine document and whose name it carries."""
    read = reader.read(filename, content, content_type, prompt_for(key))
    detected = read.get("documentType") if read.get("documentType") in _ALL_TYPES else "other"
    readable = bool(read.get("readable", True))
    genuine = bool(read.get("looksGenuine", True))
    right_type = detected == EXPECTED_TYPE[key]
    issues = [str(i).strip() for i in (read.get("issues") or []) if str(i).strip()][:3]
    holder = (read.get("holderName") or "").strip() or None if key not in NO_NAME else None

    label = DOCUMENT_LABELS[key].lower()
    if not right_type:
        issues.insert(0, f"This does not look like a {label}.")
    elif not readable:
        issues.insert(0, f"The {label} is not clear enough to read.")
    elif not genuine:
        issues.insert(0, f"The {label} does not look genuine.")
    passed = right_type and readable and genuine
    return DocumentCheck(
        passed=passed, readable=readable, document_type=detected, name_on_document=holder,
        name_matches=None if key in NO_NAME else names_match(candidate_name, holder, threshold), issues=issues if not passed else [],
    )
