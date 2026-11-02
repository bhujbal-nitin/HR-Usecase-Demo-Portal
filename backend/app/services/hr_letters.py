"""Filling a Word letter (.docx) with an employee's details, without any library.

A letter template holds fields written between double angle brackets, such as ``<<First Name>>``. Word often splits such text over several
runs (``<<First Name>`` + ``>  <`` + ``<Last Name>>``), so the text of each paragraph is joined, the fields are replaced, and the new text is
put back into the runs the field started in. Formatting, images and everything that is not a field stay exactly as they are.
"""

import io
import re
import zipfile
from collections.abc import Callable
from datetime import date
from xml.sax.saxutils import escape, unescape

from app.core.exceptions import ConflictError
from app.schemas.employee import Employee
from app.utils.formatting import split_name

_PARTS = re.compile(r"^word/(document|header\d*|footer\d*)\.xml$")
_PARAGRAPH = re.compile(r"<w:p[ >].*?</w:p>", re.S)  # "<w:pPr" is not a paragraph; a self-closing "<w:p/>" has no text
_TEXT = re.compile(r"(<w:t(?:\s[^>]*)?>)(.*?)(</w:t>)", re.S)
_FIELD = re.compile(r"<<\s*([^<>]+?)\s*>>")

DATE_FORMAT = "%d-%m-%Y"  # 25-03-2026, as in the bonafide letter

# Wording that names a gender, made neutral (the portal does not store gender).
NEUTRAL_WORDING = (("His employee code", "The employee code"),)


def field_key(name: str) -> str:
    """A field name as it is matched: case, spacing and the kind of apostrophe do not matter."""
    return re.sub(r"\s+", " ", name.replace("’", "'").replace("‘", "'")).strip().lower()


def values_for(employee: Employee, today: date) -> dict[str, str]:
    """What each field of a letter is filled with (the keys are ``field_key`` names)."""
    first, middle, last = split_name(employee.full_name)
    code_number = employee.orange_hrm.employee_id if employee.orange_hrm and employee.orange_hrm.employee_id else re.sub(r"\D", "", employee.id)
    code = f"AE{code_number}"  # "AE" + the employee ID shown in OrangeHRM (the number in the portal ID if there is no OrangeHRM profile)
    shown_today = today.strftime(DATE_FORMAT)
    return {
        "first name": f"{first} {middle}".strip(),
        "last name": last,
        "employee name": employee.full_name,
        "full name": employee.full_name,
        "designation": employee.job_title,
        "function": employee.department,
        "employee code": code,
        "ref no": code,
        "date": shown_today,
        "today's date": shown_today,
        "joining date": employee.start_date.strftime(DATE_FORMAT),
    }


# ----------------------------------------------------------------------------------------------------- paragraphs
def _rewrite(paragraph: str, find: Callable[[str], list[tuple[int, int, str]]]) -> str:
    """Replace spans of the paragraph's joined text. ``find`` gets that text and returns sorted, separate (start, end, new text) spans."""
    matches = list(_TEXT.finditer(paragraph))
    texts = [unescape(m.group(2)) for m in matches]
    spans = find("".join(texts))
    if not spans:
        return paragraph
    starts = [sum(len(t) for t in texts[:i]) for i in range(len(texts))]
    new = texts[:]
    for start, end, replacement in reversed(spans):
        first = max(i for i, s in enumerate(starts) if s <= start)
        last = max(i for i, s in enumerate(starts) if s < end)
        if first == last:
            new[first] = new[first][: start - starts[first]] + replacement + new[first][end - starts[first]:]
        else:
            new[first] = new[first][: start - starts[first]] + replacement
            for i in range(first + 1, last):
                new[i] = ""
            new[last] = new[last][end - starts[last]:]
    pieces, cursor = [], 0
    for match, text in zip(matches, new, strict=True):
        opening = match.group(1)
        if text != text.strip() and "xml:space" not in opening:
            opening = opening[:-1] + ' xml:space="preserve">'
        pieces.append(paragraph[cursor: match.start()] + opening + escape(text) + match.group(3))
        cursor = match.end()
    return "".join(pieces) + paragraph[cursor:]


def _map_parts(data: bytes, change: Callable[[str], str]) -> bytes:
    """A copy of the .docx whose text parts went through ``change``; every other part is copied byte for byte."""
    try:
        source = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ConflictError("The letter template is not a valid Word (.docx) file.") from exc
    out = io.BytesIO()
    with source, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            content = source.read(info.filename)
            if _PARTS.match(info.filename):
                content = change(content.decode("utf-8")).encode("utf-8")
            target.writestr(info, content)
    return out.getvalue()


# ----------------------------------------------------------------------------------------------------------- public
def fill_letter(template: bytes, values: dict[str, str]) -> bytes:
    """The letter with every ``<<field>>`` replaced by its value. A field with no value is an error (a half-filled letter must not go out)."""
    def find_fields(text: str) -> list[tuple[int, int, str]]:
        spans = []
        for literal, neutral in NEUTRAL_WORDING:
            spans += [(m.start(), m.end(), neutral) for m in re.finditer(re.escape(literal), text)]
        for field in _FIELD.finditer(text):
            key = field_key(field.group(1))
            if key not in values:
                raise ConflictError(f"The letter template has a field <<{field.group(1)}>> that the portal does not know. Ask HR to correct the template.")
            spans.append((field.start(), field.end(), values[key]))
        return sorted(spans)

    filled = _map_parts(template, lambda xml: _PARAGRAPH.sub(lambda m: _rewrite(m.group(0), find_fields), xml))
    if not fields_in(template):
        raise ConflictError("The letter template has no <<fields>> to fill in with the employee's details. Ask HR to correct the template.")
    return filled


def replace_in_letter(template: bytes, rules: list[tuple[str, str, str]]) -> bytes:
    """Replace words in the paragraphs that contain a given text: each rule is (the paragraph contains, old text, new text). Used to turn sample values into fields."""
    def apply(paragraph: str) -> str:
        for contains, old, new in rules:
            def find(text: str, contains=contains, old=old, new=new) -> list[tuple[int, int, str]]:
                at = text.find(old)
                return [(at, at + len(old), new)] if contains in text and at >= 0 else []
            paragraph = _rewrite(paragraph, find)
        return paragraph

    return _map_parts(template, lambda xml: _PARAGRAPH.sub(lambda m: apply(m.group(0)), xml))


def fields_in(template: bytes) -> list[str]:
    """The field names a template uses, in the order they appear (for checking a template)."""
    found: list[str] = []

    def collect(xml: str) -> str:
        for paragraph in _PARAGRAPH.findall(xml):
            text = "".join(unescape(m.group(2)) for m in _TEXT.finditer(paragraph))
            found.extend(f.group(1) for f in _FIELD.finditer(text))
        return xml

    _map_parts(template, collect)
    return found
