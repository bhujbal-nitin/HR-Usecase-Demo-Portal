"""Validated storage for candidate-uploaded documents and the e-signature."""

import base64
import binascii
import mimetypes
import re
import shutil
from pathlib import Path

from app.core.exceptions import NotFoundError, ValidationFailedError
from app.schemas.employee import DOCUMENT_LABELS, StoredDocument
from app.utils.formatting import safe_filename

ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx"}
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_DATA_URL = re.compile(r"^data:image/png;base64,(?P<data>[A-Za-z0-9+/=\s]+)$")
MAX_SIGNATURE_BYTES = 1_000_000


class DocumentStore:
    def __init__(self, root: Path, max_upload_bytes: int):
        self._root = root
        self._max_bytes = max_upload_bytes
        self._root.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ write
    def save_document(self, employee_id: str, key: str, filename: str, data: bytes) -> StoredDocument:
        label = DOCUMENT_LABELS[key]
        extension = Path(filename or "").suffix.lower()
        if extension not in ALLOWED_EXTENSIONS:
            raise ValidationFailedError(
                f"{label}: only PDF (.pdf) and Word (.doc, .docx) files are accepted; '{filename}' was rejected."
            )
        if not data:
            raise ValidationFailedError(f"{label}: the uploaded file is empty.")
        if len(data) > self._max_bytes:
            raise ValidationFailedError(f"{label}: file exceeds the {self._max_bytes // (1024 * 1024)} MB limit.")
        if extension == ".pdf" and not data.lstrip().startswith(b"%PDF"):
            raise ValidationFailedError(f"{label}: '{filename}' is not a valid PDF file.")

        stored_name = f"{key}{extension}"
        folder = self._folder(employee_id)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / stored_name).write_bytes(data)
        content_type = mimetypes.guess_type(stored_name)[0] or "application/octet-stream"
        return StoredDocument(
            key=key,
            label=label,
            filename=safe_filename(Path(filename).name),
            stored_name=stored_name,
            content_type=content_type,
            size=len(data),
        )

    def save_signature(self, employee_id: str, data_url: str) -> str:
        match = _DATA_URL.match((data_url or "").strip())
        if not match:
            raise ValidationFailedError("Signature must be a PNG image data URL.")
        try:
            raw = base64.b64decode(match.group("data"), validate=False)
        except (binascii.Error, ValueError) as exc:
            raise ValidationFailedError("Signature image could not be decoded.") from exc
        if not raw.startswith(_PNG_MAGIC) or len(raw) > MAX_SIGNATURE_BYTES:
            raise ValidationFailedError("Signature image is invalid or too large.")
        folder = self._folder(employee_id)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "signature.png").write_bytes(raw)
        return "signature.png"

    # ------------------------------------------------------------------- read
    def read(self, employee_id: str, document: StoredDocument) -> bytes:
        path = self._folder(employee_id) / document.stored_name
        if not path.is_file():
            raise NotFoundError(f"{document.label} is no longer available on the server.")
        return path.read_bytes()

    def path_of(self, employee_id: str, document: StoredDocument) -> Path:
        path = self._folder(employee_id) / document.stored_name
        if not path.is_file():
            raise NotFoundError(f"{document.label} is no longer available on the server.")
        return path

    # ----------------------------------------------------------------- delete
    def delete_all(self, employee_id: str) -> None:
        shutil.rmtree(self._folder(employee_id), ignore_errors=True)

    def _folder(self, employee_id: str) -> Path:
        # employee ids are server-generated ("AE-123456"); sanitise anyway so a bad id can't escape the root.
        return self._root / safe_filename(employee_id)
