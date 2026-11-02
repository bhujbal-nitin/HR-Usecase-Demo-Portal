"""The letters an employee can ask for (address proof / bonafide, bank account opening) and how they are made.

Each letter is a Word template (.docx) that you keep in the HR documents folder (``Settings.hr_documents_dir``, ``backend/hr_documents``).
The template holds fields written between double angle brackets (``<<Employee Name>>``, ``<<First Name>>``, ``<<Date>>`` ...); when an
employee asks for the letter, a copy is made with the fields filled in from their record (see ``hr_letters``). The template itself is never
changed.
"""

import re
from pathlib import Path

from app.core.exceptions import NotFoundError
from app.schemas.hr_policy import Letter, Policy
from app.utils.formatting import safe_filename

EXTENSION = ".docx"
POLICIES_FOLDER = "Policies"  # the policy PDFs, inside the HR documents folder
POLICY_EXTENSION = ".pdf"

# Words that say nothing about which policy is meant ("AE" is in every title).
_STOP_WORDS = {
    "a", "about", "all", "an", "and", "ae", "any", "are", "available", "can", "do", "download", "every", "find", "for", "get", "give", "have", "i", "is", "list",
    "look", "me", "my", "need", "of", "on", "open", "our", "please", "policies", "policy", "search", "see", "show", "tell", "the", "to", "view", "want", "what", "which", "you",
}

# letter key -> (title, template file name without the extension, start of the name of the file the employee gets)
LETTERS = {
    "address-proof": ("Address proof letter", "address_proof_bonafide_letter", "Address_Proof_Letter"),
    "bank-account": ("Bank account opening letter", "salary_account_opening_template", "Bank_Account_Opening_Letter"),
}


class HrDocuments:
    def __init__(self, folder: Path):
        self._folder = folder
        self._folder.mkdir(parents=True, exist_ok=True)

    @property
    def folder(self) -> Path:
        return self._folder

    # ---------------------------------------------------------------------------------------------- policies
    @property
    def policies_folder(self) -> Path:
        return self._folder / POLICIES_FOLDER

    @staticmethod
    def _words(text: str) -> list[str]:
        """The meaningful words of a text, lower case, with a plural 's' dropped (so "leaves" finds "Leave")."""
        words = re.findall(r"[a-z0-9]+", text.lower())
        return [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in words if w not in _STOP_WORDS]

    def policies(self) -> list[Policy]:
        """Every policy PDF in the policies folder, by title."""
        folder = self.policies_folder
        files = [p for p in folder.glob(f"*{POLICY_EXTENSION}") if p.is_file() and not p.name.startswith("~$")] if folder.is_dir() else []
        policies = [Policy(key=re.sub(r"[^a-z0-9]+", "-", p.stem.lower()).strip("-"), title=p.stem, file_name=p.name) for p in files]
        return sorted(policies, key=lambda p: p.title.lower())

    def search_policies(self, query: str) -> list[Policy]:
        """The policies whose title has any word of the query, the best match first. A query with no meaningful word lists them all."""
        wanted = set(self._words(query))
        everything = self.policies()
        if not wanted:
            return everything
        scored = [(len(wanted & set(self._words(p.title))), p) for p in everything]
        return [p for score, p in sorted(((s, p) for s, p in scored if s), key=lambda pair: -pair[0])]

    def policy_path(self, key: str) -> Path:
        """The policy's PDF. Raises NotFoundError for one that is not in the folder."""
        found = next((p for p in self.policies() if p.key == key), None)
        if found is None:
            raise NotFoundError("That policy is not in the policies folder.")
        return self.policies_folder / found.file_name

    def _find(self, stem: str) -> Path | None:
        """The template file: the name is matched without regard to case; Word's temporary ``~$`` files are never matched."""
        return next((p for p in self._folder.glob(f"*{EXTENSION}") if p.stem.lower() == stem and p.is_file()), None)

    @staticmethod
    def download_name(key: str, employee_name: str) -> str:
        """The name of the file an employee gets, e.g. Address_Proof_Letter_Varun_Chopra.docx."""
        return f"{LETTERS[key][2]}_{safe_filename(employee_name)}{EXTENSION}"

    def letters(self, employee_name: str | None = None) -> list[Letter]:
        """The letters on offer. ``file_name`` is the name the employee's copy will have (the template's name when no employee is given)."""
        found = []
        for key, (title, stem, _) in LETTERS.items():
            path = self._find(stem)
            name = (self.download_name(key, employee_name) if employee_name else path.name) if path else None
            found.append(Letter(key=key, title=title, available=path is not None, file_name=name))
        return found

    def template_of(self, key: str) -> Path:
        """The letter's template. Raises NotFoundError for an unknown letter or one whose template has not been placed in the folder yet."""
        if key not in LETTERS:
            raise NotFoundError("That letter is not offered.")
        title, stem, _ = LETTERS[key]
        path = self._find(stem)
        if path is None:
            raise NotFoundError(f"The {title.lower()} is not available yet: place {stem}{EXTENSION} in the HR documents folder.")
        return path

