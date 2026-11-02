"""Draws the payslip and the CTC statement as one-page PDFs, in the layout of the company's salary slip (logo, company, employee block, table),
and Form 16 as a one-page PDF.

The pages come from the models of ``payroll.slips``; nothing here knows about employees. Amounts show "Rs." because the standard PDF fonts have no
rupee sign.
"""

from io import BytesIO
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas

LOGO = Path(__file__).with_name("logo.png")
LOGO_WIDTH, LOGO_HEIGHT = 150, 24.6

LEFT, RIGHT = 40, 555  # the frame
WIDTH = RIGHT - LEFT
TOP = A4[1] - 40
INK, LINE, BAND = HexColor("#0F2A6B"), HexColor("#1F2F7A"), HexColor("#D9E1F4")
PAD = 5
LINE_HEIGHT = 12.5
ROW = 19


class _Page:
    """A page drawn top-down: ``y`` is the top edge of whatever is drawn next."""

    def __init__(self) -> None:
        self.buffer = BytesIO()
        self.c = Canvas(self.buffer, pagesize=A4, pageCompression=0)
        self.y = TOP
        self.c.setStrokeColor(LINE)
        self.c.setLineWidth(0.8)

    def text(self, x: float, baseline: float, text: str, size: float = 8.5, bold: bool = False, align: str = "left") -> None:
        c = self.c
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        {"left": c.drawString, "right": c.drawRightString, "center": c.drawCentredString}[align](x, baseline, text)

    def rule(self) -> None:
        self.c.line(LEFT, self.y, RIGHT, self.y)

    def cell(self, x0: float, x1: float, height: float, text: str = "", *, bold: bool = False, align: str = "left", fill=None, size: float = 8.5) -> None:
        c = self.c
        if fill is not None:
            c.setFillColor(fill)
            c.rect(x0, self.y - height, x1 - x0, height, stroke=0, fill=1)
        c.rect(x0, self.y - height, x1 - x0, height, stroke=1, fill=0)
        if text:
            x = {"left": x0 + PAD, "right": x1 - PAD, "center": (x0 + x1) / 2}[align]
            self.text(x, self.y - height / 2 - size * 0.35, text, size, bold, align)

    def header(self, model: dict, band: str) -> float:
        """The logo, the company, the title band and the employee block. Returns the top of the frame."""
        top = self.y
        c = self.c
        if LOGO.is_file():
            c.drawImage(str(LOGO), (LEFT + RIGHT) / 2 - LOGO_WIDTH / 2, top - 14 - LOGO_HEIGHT, LOGO_WIDTH, LOGO_HEIGHT)
        self.text((LEFT + RIGHT) / 2, top - 62, model["company"], 12, True, "center")
        self.text((LEFT + RIGHT) / 2, top - 76, model["address"], 8, False, "center")
        self.y = top - 84
        self.rule()
        self.cell(LEFT, RIGHT, 20, band, bold=True, align="center", fill=BAND, size=9.5)
        self.y -= 20
        lines = max(len(model["left"]), len(model["right"]))
        for i in range(lines):
            baseline = self.y - 15 - i * LINE_HEIGHT
            if i < len(model["left"]) and model["left"][i]:
                self.text(LEFT + PAD, baseline, model["left"][i])
            if i < len(model["right"]) and model["right"][i]:
                self.text(LEFT + WIDTH / 2 + PAD, baseline, model["right"][i])
        self.y -= 15 + lines * LINE_HEIGHT
        self.rule()
        return top

    def frame(self, top: float) -> None:
        self.c.rect(LEFT, self.y, WIDTH, top - self.y, stroke=1, fill=0)

    def finish(self) -> bytes:
        self.c.showPage()
        self.c.save()
        return self.buffer.getvalue()


def payslip_pdf(model: dict) -> bytes:
    page = _Page()
    top = page.header(model, model["title"])
    cols = [LEFT, LEFT + 130, LEFT + 258, LEFT + 388, RIGHT]
    heads = ["Gross Earnings", "Amount (Rs.)", "Deductions", "Amount (Rs.)"]
    for i, head in enumerate(heads):
        page.cell(cols[i], cols[i + 1], ROW - 1, head, bold=True, align="center", fill=BAND)
    page.y -= ROW - 1

    def line(left: tuple[str, str], right: tuple[str, str], *, bold: bool = False) -> None:
        for i, (text, align) in enumerate(((left[0], "left"), (left[1], "right"), (right[0], "left"), (right[1], "right"))):
            page.cell(cols[i], cols[i + 1], ROW, text, bold=bold, align=align)
        page.y -= ROW

    blank = ("", "")
    line(blank, blank)
    count = max(len(model["earnings"]), len(model["deductions"]))
    for i in range(count):
        line(model["earnings"][i] if i < len(model["earnings"]) else blank, model["deductions"][i] if i < len(model["deductions"]) else blank)
    line(blank, blank)
    line(("Amount Total:", f"Rs. {model['total_earnings']}"), ("Amount Total:", f"Rs. {model['total_deductions']}"), bold=True)
    page.cell(cols[0], cols[3], ROW, "Net Pay", bold=True, align="right")
    page.cell(cols[3], cols[4], ROW, f"Rs. {model['net']}", bold=True, align="center", fill=BAND)
    page.y -= ROW
    page.cell(LEFT, RIGHT, ROW, model["words"], bold=True)
    page.y -= ROW
    page.frame(top)
    return page.finish()


def ctc_pdf(model: dict) -> bytes:
    page = _Page()
    top = page.header(model, model["title"])
    cols = [LEFT, LEFT + 235, LEFT + 375, RIGHT]

    def line(cells: tuple[str, str, str], *, bold: bool = False, fill=None) -> None:
        for i, (text, align) in enumerate(zip(cells, ("left", "right", "right"))):
            page.cell(cols[i], cols[i + 1], ROW, text, bold=bold, align=align, fill=fill)
        page.y -= ROW

    for i, head in enumerate(model["head"]):
        page.cell(cols[i], cols[i + 1], ROW - 1, head, bold=True, align="center", fill=BAND)
    page.y -= ROW - 1
    gross, take_home = model["totals"]
    for name, rows in model["sections"]:
        line((name, "", ""), bold=True)
        for cells in rows:
            line(cells)
        if name == "Earnings":
            line(gross, bold=True)
    line(take_home, bold=True, fill=BAND)
    page.cell(LEFT, RIGHT, ROW, model["words"], bold=True)
    page.y -= ROW
    page.frame(top)
    return page.finish()


# ----------------------------------------------------------------------------------------------------------------- Form 16
NAVY = HexColor("#1F3864")
HEADING = HexColor("#2F5496")
GREY = HexColor("#7F7F7F")
WHITE = HexColor("#FFFFFF")
SMALL = 8


def _wrap(text: str, width: float, size: float, bold: bool = False) -> list[str]:
    """The text broken into lines that fit the width."""
    font = "Helvetica-Bold" if bold else "Helvetica"
    lines, line = [], ""
    for word in str(text).split():
        trial = f"{line} {word}".strip()
        if line and stringWidth(trial, font, size) > width - 2 * PAD:
            lines.append(line)
            line = word
        else:
            line = trial
    return lines + [line] if line or not lines else lines


class _Form16Page(_Page):
    def row(self, cols: list[float], cells: list[str], aligns: list[str], *, bold: bool = False, head: bool = False) -> None:
        """One table row; a cell whose text is too long for its column is wrapped and the row grows."""
        c = self.c
        wrapped = [_wrap(text, cols[i + 1] - cols[i], SMALL, bold or head) for i, text in enumerate(cells)]
        height = max(14, max(len(w) for w in wrapped) * 10.5 + 5)
        for i, lines in enumerate(wrapped):
            x0, x1 = cols[i], cols[i + 1]
            c.setStrokeColor(GREY)
            c.setLineWidth(0.5)
            if head:
                c.setFillColor(NAVY)
                c.rect(x0, self.y - height, x1 - x0, height, stroke=1, fill=1)
            else:
                c.rect(x0, self.y - height, x1 - x0, height, stroke=1, fill=0)
            c.setFillColor(WHITE if head else INK)
            c.setFont("Helvetica-Bold" if bold or head else "Helvetica", SMALL)
            for n, text in enumerate(lines):
                x = {"left": x0 + PAD, "right": x1 - PAD}[aligns[i]]
                (c.drawRightString if aligns[i] == "right" else c.drawString)(x, self.y - 11 - n * 10.5, text)
        self.y -= height

    def heading(self, text: str) -> None:
        self.y -= 8
        self.c.setFillColor(HEADING)
        self.c.setFont("Helvetica-Bold", 11)
        self.c.drawString(LEFT, self.y - 11, text)
        self.y -= 20


def form16_pdf(model: dict) -> bytes:
    page = _Form16Page()
    c = page.c
    if LOGO.is_file():
        c.drawImage(str(LOGO), LEFT, page.y - LOGO_HEIGHT, LOGO_WIDTH, LOGO_HEIGHT)
    page.y -= LOGO_HEIGHT + 14
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 22)
    c.drawCentredString((LEFT + RIGHT) / 2, page.y - 22, "FORM NO. 16")
    c.setFont("Helvetica-Oblique", 8.5)
    c.drawCentredString((LEFT + RIGHT) / 2, page.y - 38, "[See rule 31(1)(a)]")
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString((LEFT + RIGHT) / 2, page.y - 54, "Certificate under section 203 of the Income-tax Act, 1961")
    c.drawCentredString((LEFT + RIGHT) / 2, page.y - 67, "for tax deducted at source from salary")
    page.y -= 76

    page.heading("PART A - Details of tax deducted and deposited")
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", SMALL)
    c.drawString(LEFT, page.y - 8, f"Certificate period: Financial Year {model['year']}  |  Assessment Year {model['assessment']}")
    page.y -= 16
    cols = [LEFT, LEFT + 130, LEFT + 322, RIGHT]
    page.row(cols, ["Particulars", "Deductor (Employer)", "Deductee (Employee)"], ["left"] * 3, head=True)
    for row in model["parties"]:
        page.row(cols, list(row), ["left"] * 3)

    page.heading("Summary of tax deducted and deposited")
    cols = [LEFT, LEFT + 130, LEFT + 295, LEFT + 405, RIGHT]
    page.row(cols, ["Quarter", "Receipt / acknowledgement reference", "Tax deducted (Rs.)", "Tax deposited (Rs.)"], ["left", "left", "right", "right"], head=True)
    for i, row in enumerate(model["quarters"]):
        page.row(cols, list(row), ["left", "left", "right", "right"], bold=i == len(model["quarters"]) - 1)

    page.heading("PART B - Details of salary paid and other income / tax computation")
    cols = [LEFT, LEFT + 385, RIGHT]
    page.row(cols, ["Salary / income particulars", "Amount (Rs.)"], ["left", "right"], head=True)
    for label, amount, bold in model["computation"]:
        page.row(cols, [label, amount], ["left", "right"], bold=bold)

    page.heading("Declaration / certification")
    c.setFillColor(INK)
    c.setFont("Helvetica", SMALL)
    for line in _wrap(model["certificate"], WIDTH, SMALL):
        c.drawString(LEFT, page.y - 9, line)
        page.y -= 10.5
    page.y -= 14
    cols = [LEFT, LEFT + 130, LEFT + 260, RIGHT]
    page.row(cols, ["Place", "Date", "Authorised signatory"], ["left"] * 3, head=True)
    box = 54
    for i, text in enumerate((model["place"], model["date"], "")):
        c.setStrokeColor(GREY)
        c.rect(cols[i], page.y - box, cols[i + 1] - cols[i], box, stroke=1, fill=0)
        c.setFillColor(INK)
        c.setFont("Helvetica", SMALL)
        c.drawString(cols[i] + PAD, page.y - 12, text)
    c.setFont("Helvetica", SMALL)
    c.drawString(cols[2] + PAD, page.y - 12, model["signatory_for"])
    c.setFont("Helvetica-Bold", SMALL)
    c.drawString(cols[2] + PAD, page.y - box + 7, "Authorised Signatory")
    return page.finish()
