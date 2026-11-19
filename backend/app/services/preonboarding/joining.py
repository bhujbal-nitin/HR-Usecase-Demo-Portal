"""The joining-instructions letter: a one-page PDF in the same theme as the offer letter (company logo, name and address, blue title band)."""

from datetime import date
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen.canvas import Canvas

from app.schemas.preonboarding import PreCandidate
from app.services.hr_letters import DATE_FORMAT
from app.services.payroll.pdf import BAND, INK, LEFT, LINE, LOGO, LOGO_HEIGHT, LOGO_WIDTH, RIGHT, TOP, WIDTH
from app.services.payroll.slips import ADDRESS, COMPANY

BODY = 10.5
LEADING = 15
REPORTING_TIME = "10:00 AM"
BRING = [
    "Your original documents (10th and 12th marksheets, degree certificate, Aadhaar and PAN) for verification.",
    "Two passport-size photographs.",
    "A printed copy of this letter.",
    "A cancelled cheque or a bank passbook page (for your salary account).",
]


def make_joining_letter(candidate: PreCandidate, today: date) -> bytes:
    name = candidate.full_name
    buffer = BytesIO()
    c = Canvas(buffer, pagesize=A4, pageCompression=0)
    c.setTitle(f"Joining instructions - {name}")
    c.setAuthor(COMPANY)
    centre = (LEFT + RIGHT) / 2

    def text(x: float, y: float, value: str, size: float = BODY, bold: bool = False, align: str = "left") -> None:
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        {"left": c.drawString, "right": c.drawRightString, "center": c.drawCentredString}[align](x, y, value)

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
    text(centre, top - 99, "JOINING INSTRUCTIONS", 11, True, "center")

    y = top - 132
    text(LEFT, y, f"Ref: {candidate.id}", BODY, True)
    text(RIGHT, y, f"Date: {today.strftime(DATE_FORMAT)}", BODY, True, "right")
    y -= 30
    text(LEFT, y, name, BODY, True)
    y -= LEADING
    text(LEFT, y, "Dear " + name.split()[0] + ",")
    y -= 28

    def paragraph(value: str, gap: float = 10) -> None:
        nonlocal y
        for line in simpleSplit(value, "Helvetica", BODY, WIDTH):
            text(LEFT, y, line)
            y -= LEADING
        y -= gap

    joining = candidate.joining_date.strftime(DATE_FORMAT)
    paragraph(f"Your pre-onboarding with {COMPANY} is complete and your joining is confirmed. We look forward to welcoming you on {joining}.")
    paragraph("Please note the details below.", 6)

    rows = [
        ("Position", candidate.designation),
        ("Department", candidate.department),
        ("Reporting to", candidate.manager),
        ("Date of joining", joining),
        ("Reporting time", REPORTING_TIME),
        ("Work location", candidate.location),
        ("Reporting address", ADDRESS.removeprefix("Office Address: ")),
    ]
    split, row_height = LEFT + 160, 22
    c.setLineWidth(0.8)
    for label, value in rows:
        c.setFillColor(BAND)
        c.rect(LEFT, y - row_height, split - LEFT, row_height, stroke=0, fill=1)
        c.rect(LEFT, y - row_height, split - LEFT, row_height, stroke=1, fill=0)
        c.rect(split, y - row_height, RIGHT - split, row_height, stroke=1, fill=0)
        text(LEFT + 6, y - 14.5, label, 9.5, True)
        size = 9.5
        while size > 6.5 and c.stringWidth(value, "Helvetica", size) > RIGHT - split - 12:
            size -= 0.5
        text(split + 6, y - 14.5, value, size)
        y -= row_height
    y -= 22

    text(LEFT, y, "Please bring", BODY, True)
    y -= LEADING + 2
    for item in BRING:
        lines = simpleSplit(item, "Helvetica", BODY, WIDTH - 16)
        text(LEFT + 4, y, "-")
        for line in lines:
            text(LEFT + 16, y, line)
            y -= LEADING
    y -= 8
    paragraph("If you have any question before you join, please reply to the e-mail that brought you this letter.", 22)

    text(LEFT, y, f"For {COMPANY}", BODY, True)
    y -= 52
    c.line(LEFT, y, LEFT + 150, y)
    text(LEFT, y - 15, "Authorised Signatory", BODY, True)
    text(LEFT, y - 30, "Human Resources", BODY)

    c.line(LEFT, 58, RIGHT, 58)
    text(centre, 44, COMPANY, 8, True, "center")
    text(centre, 33, ADDRESS, 7.5, False, "center")

    c.showPage()
    c.save()
    return buffer.getvalue()
