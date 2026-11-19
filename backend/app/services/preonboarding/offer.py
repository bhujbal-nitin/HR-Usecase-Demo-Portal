"""The offer letter: a one-page PDF in the portal's document theme (company logo, company name and address, blue title band), made from the candidate's details.

Amounts show "Rs." because the standard PDF fonts have no rupee sign, as in the payslip.
"""

from datetime import date
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen.canvas import Canvas

from app.schemas.preonboarding import PreCandidate
from app.services.hr_letters import DATE_FORMAT
from app.services.payroll.pdf import BAND, INK, LEFT, LINE, LOGO, LOGO_HEIGHT, LOGO_WIDTH, RIGHT, TOP, WIDTH
from app.services.payroll.slips import ADDRESS, COMPANY
from app.utils.words import rupees_in_words

BODY = 10.5
LEADING = 15


def indian_grouping(amount: int) -> str:
    """3450000 -> 34,50,000"""
    text = str(abs(int(amount)))
    if len(text) <= 3:
        return text
    head, tail = text[:-3], text[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ",".join([*groups, tail])


def offer_values(candidate: PreCandidate, letter_no: str, today: date) -> dict[str, str]:
    """What the letter says about the candidate (keys are the lower-case field names)."""
    return {
        "company name": COMPANY,
        "letter no": letter_no,
        "date": today.strftime(DATE_FORMAT),
        "candidate name": candidate.full_name,
        "designation": candidate.designation,
        "department": candidate.department,
        "manager": candidate.manager,
        "location": candidate.location,
        "joining date": candidate.joining_date.strftime(DATE_FORMAT),
        "annual ctc": indian_grouping(candidate.annual_ctc),
        "annual ctc in words": rupees_in_words(candidate.annual_ctc),
    }


def make_offer_letter(candidate: PreCandidate, letter_no: str, today: date) -> bytes:
    v = offer_values(candidate, letter_no, today)
    buffer = BytesIO()
    c = Canvas(buffer, pagesize=A4, pageCompression=0)
    c.setTitle(f"Offer letter - {v['candidate name']}")
    c.setAuthor(COMPANY)
    centre = (LEFT + RIGHT) / 2

    def text(x: float, y: float, value: str, size: float = BODY, bold: bool = False, align: str = "left") -> None:
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        {"left": c.drawString, "right": c.drawRightString, "center": c.drawCentredString}[align](x, y, value)

    # Letterhead, as on the payslip.
    top = TOP
    if LOGO.is_file():
        c.drawImage(str(LOGO), centre - LOGO_WIDTH / 2, top - 14 - LOGO_HEIGHT, LOGO_WIDTH, LOGO_HEIGHT)
    text(centre, top - 62, COMPANY, 12, True, "center")
    text(centre, top - 76, ADDRESS, 8, False, "center")
    c.setStrokeColor(LINE)
    c.setLineWidth(0.8)
    c.line(LEFT, top - 84, RIGHT, top - 84)
    c.setFillColor(BAND)
    c.rect(LEFT, top - 108, WIDTH, 24, stroke=0, fill=1)
    c.rect(LEFT, top - 108, WIDTH, 24, stroke=1, fill=0)
    text(centre, top - 99, "LETTER OF EMPLOYMENT OFFER", 11, True, "center")

    y = top - 132
    text(LEFT, y, f"Ref: {v['letter no']}", BODY, True)
    text(RIGHT, y, f"Date: {v['date']}", BODY, True, "right")
    y -= 30
    text(LEFT, y, v["candidate name"], BODY, True)
    y -= LEADING
    text(LEFT, y, "Dear " + v["candidate name"].split()[0] + ",")
    y -= 28

    def paragraph(value: str, gap: float = 10) -> None:
        nonlocal y
        for line in simpleSplit(value, "Helvetica", BODY, WIDTH):
            text(LEFT, y, line)
            y -= LEADING
        y -= gap

    paragraph(f"We are pleased to offer you the position of {v['designation']} in the {v['department']} team of {COMPANY}.")
    paragraph("The terms of your offer are given below.", 6)

    rows = [
        ("Position", v["designation"]),
        ("Department", v["department"]),
        ("Reporting to", v["manager"]),
        ("Work location", v["location"]),
        ("Date of joining", v["joining date"]),
        ("Annual cost to company (CTC)", f"Rs. {v['annual ctc']}"),
        ("CTC in words", v["annual ctc in words"]),
    ]
    split, row_height = LEFT + 190, 22
    c.setLineWidth(0.8)
    for label, value in rows:
        c.setFillColor(BAND)
        c.rect(LEFT, y - row_height, split - LEFT, row_height, stroke=0, fill=1)
        c.rect(LEFT, y - row_height, split - LEFT, row_height, stroke=1, fill=0)
        c.rect(split, y - row_height, RIGHT - split, row_height, stroke=1, fill=0)
        text(LEFT + 6, y - 14.5, label, 9.5, True)
        shown = value
        while shown and c.stringWidth(shown, "Helvetica", 9.5) > RIGHT - split - 12:
            shown = shown[:-1]
        text(split + 6, y - 14.5, shown if shown == value else shown.rstrip() + "...", 9.5)
        y -= row_height
    y -= 22

    paragraph("This offer is subject to the terms and conditions of employment of the company. Please confirm that you accept it, and confirm your date of joining, "
              "by replying to the e-mail that brought you this letter or in the portal chat.")
    paragraph("We look forward to welcoming you to the team.", 26)

    text(LEFT, y, f"For {COMPANY}", BODY, True)
    y -= 52
    c.line(LEFT, y, LEFT + 150, y)
    text(LEFT, y - 15, "Authorised Signatory", BODY, True)
    text(LEFT, y - 30, "Human Resources", BODY)

    # Footer
    c.setStrokeColor(LINE)
    c.line(LEFT, 58, RIGHT, 58)
    text(centre, 44, COMPANY, 8, True, "center")
    text(centre, 33, ADDRESS, 7.5, False, "center")

    c.showPage()
    c.save()
    return buffer.getvalue()
