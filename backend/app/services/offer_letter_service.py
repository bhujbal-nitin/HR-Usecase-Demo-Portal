"""Offer-letter PDF generation and e-mail dispatch."""

import logging
import time
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.core.config import Settings
from app.integrations.mailer import Mailer
from app.schemas.employee import Employee
from app.utils.formatting import format_inr, format_lpa, safe_filename

logger = logging.getLogger(__name__)

_PRIMARY = colors.HexColor("#ea580c")
_DARK = colors.HexColor("#1c1917")
_MUTED = colors.HexColor("#78716c")
_LIGHT_BG = colors.HexColor("#fffaf5")
_BORDER = colors.HexColor("#fed7aa")

# Share of CTC shown as fixed base vs. variable bonus in the compensation table.
_BASE_SHARE = 0.85


class OfferLetterService:
    def __init__(self, settings: Settings, mailer: Mailer):
        self._s = settings
        self._mailer = mailer
        self._s.offers_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------- pdf
    def pdf_path_for(self, emp: Employee) -> Path:
        return self._s.offers_dir / f"Offer_Letter_{safe_filename(emp.full_name)}_{safe_filename(emp.id)}.pdf"

    def generate_pdf(self, emp: Employee) -> Path:
        path = self.pdf_path_for(emp)
        ctc = emp.annual_ctc
        base = round(ctc * _BASE_SHARE)
        bonus = ctc - base
        money = lambda v: format_inr(v, "INR ")  # noqa: E731 - PDF base fonts have no rupee glyph
        e = lambda v: escape(str(v))  # noqa: E731 - Paragraph parses XML-ish markup

        styles = getSampleStyleSheet()
        body = ParagraphStyle("Body", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5, leading=14,
                              textColor=_DARK, alignment=TA_JUSTIFY, spaceAfter=6)
        bold = ParagraphStyle("Bold", parent=body, fontName="Helvetica-Bold")
        heading = ParagraphStyle("Heading", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12,
                                 leading=16, textColor=_DARK, spaceBefore=8, spaceAfter=4)
        right = ParagraphStyle("Right", parent=styles["Normal"], alignment=TA_RIGHT)
        subject = ParagraphStyle("Subject", parent=bold, fontSize=10.5, textColor=_PRIMARY, alignment=TA_LEFT)

        story: list = []
        letterhead = Table(
            [[
                Paragraph(f"<b>{e(self._s.company_name)}</b><br/><font size=8 color='#78716c'>"
                          f"{e(self._s.company_address)}</font>", styles["Normal"]),
                Paragraph(f"<b>CONFIDENTIAL OFFER</b><br/><font size=8 color='#78716c'>Ref: <b>OFR-{e(emp.id)}</b>"
                          f"<br/>Date: {time.strftime('%B %d, %Y')}</font>", right),
            ]],
            colWidths=[320, 200],
        )
        letterhead.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
        story += [letterhead, Spacer(1, 8), HRFlowable(width="100%", thickness=2, color=_PRIMARY, spaceBefore=4, spaceAfter=12)]

        story += [
            Paragraph(f"<b>To:</b> {e(emp.full_name)}", bold),
            Paragraph(f"<b>Email:</b> {e(emp.email)}", body),
            Paragraph(f"<b>Subject: Formal Employment Offer for the Position of {e(emp.job_title)}</b>", subject),
            Spacer(1, 8),
            Paragraph(f"Dear <b>{e(emp.full_name)}</b>,", body),
            Paragraph(
                f"On behalf of <b>{e(self._s.company_name)}</b>, we are pleased to formally offer you the position of "
                f"<b>{e(emp.job_title)}</b> in our <b>{e(emp.department)}</b> Department. We look forward to your "
                "contributions as we grow our enterprise innovation programme.", body),
            Spacer(1, 6),
            Paragraph("1. Position & Employment Terms", heading),
        ]

        def grid(rows, widths, header_bg=None, footer_bg=None) -> Table:
            table = Table(rows, colWidths=widths)
            style = [("GRID", (0, 0), (-1, -1), 0.5, _BORDER), ("TOPPADDING", (0, 0), (-1, -1), 4),
                     ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("LEFTPADDING", (0, 0), (-1, -1), 6)]
            style.append(("BACKGROUND", (0, 0), (-1, -1), _LIGHT_BG) if not header_bg else ("BACKGROUND", (0, 0), (-1, 0), header_bg))
            if footer_bg:
                style.append(("BACKGROUND", (0, -1), (-1, -1), footer_bg))
            table.setStyle(TableStyle(style))
            return table

        story.append(grid(
            [[Paragraph(f"<b>{k}</b>", body), Paragraph(e(v), body)] for k, v in [
                ("Job Title / Role:", emp.job_title),
                ("Department:", emp.department),
                ("Reporting Manager:", emp.manager),
                ("Proposed Joining Date:", emp.start_date.strftime("%B %d, %Y")),
                ("Work Location Model:", emp.work_location),
                ("Employment Status:", "Full-Time Permanent"),
            ]],
            [160, 360],
        ))
        story += [Spacer(1, 8), Paragraph("2. Total Compensation Structure (INR)", heading)]
        story.append(grid(
            [
                [Paragraph("<b>Component</b>", bold), Paragraph("<b>Annual Value</b>", bold), Paragraph("<b>Details</b>", bold)],
                [Paragraph("Base Salary", body), Paragraph(f"<b>{money(base)}</b>", body), Paragraph("Paid monthly by bank transfer", body)],
                [Paragraph("Target Performance Bonus", body), Paragraph(f"<b>{money(bonus)}</b>", body), Paragraph("Annual KPI evaluation", body)],
                [Paragraph("Provident Fund & Gratuity", body), Paragraph("Statutory", body), Paragraph("As per applicable law", body)],
                [Paragraph("<b>Total Annual CTC</b>", bold),
                 Paragraph(f"<b><font color='#ea580c'>{money(ctc)}</font></b>", bold),
                 Paragraph(f"<b>{format_lpa(ctc)}</b>", bold)],
            ],
            [150, 150, 220], header_bg=colors.HexColor("#ffedd5"), footer_bg=colors.HexColor("#fff7ed"),
        ))
        story += [
            Spacer(1, 8),
            Paragraph("3. Equipment & Onboarding Formalities", heading),
            Paragraph(f"&bull; <b>IT Workstation:</b> You will be provisioned with a <b>{e(emp.hardware)}</b>.<br/>"
                      "&bull; <b>Digital workspace:</b> corporate e-mail, directory access and HR profile are set up "
                      "as part of onboarding.", body),
            Spacer(1, 10),
        ]
        story.append(KeepTogether([
            Paragraph("<b>Acceptance & Acknowledgement:</b>", bold),
            Paragraph("To confirm your acceptance, please sign and date below and return a copy to HR before your start date.", body),
            Spacer(1, 14),
            Table(
                [[
                    Paragraph(f"<b>For {e(self._s.company_name)}:</b><br/><br/>_______________________________<br/>"
                              f"<b>{e(self._s.offer_signatory_name)}</b><br/>{e(self._s.offer_signatory_title)}", body),
                    Paragraph(f"<b>Accepted and Agreed By:</b><br/><br/>_______________________________<br/>"
                              f"<b>{e(emp.full_name)}</b><br/>Date: ________________________", body),
                ]],
                colWidths=[260, 260],
                style=[("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEABOVE", (0, 0), (-1, -1), 0.5, _BORDER),
                       ("TOPPADDING", (0, 0), (-1, -1), 8)],
            ),
        ]))

        SimpleDocTemplate(str(path), pagesize=letter, rightMargin=45, leftMargin=45, topMargin=40, bottomMargin=40,
                          title=f"Offer Letter - {emp.full_name}").build(story)
        logger.info("Offer letter generated: %s", path.name)
        return path

    # ----------------------------------------------------------------- email
    def recipient_for(self, emp: Employee) -> str:
        return self._s.hr_notification_recipient or emp.email

    def send_email(self, emp: Employee, pdf_path: Path) -> str:
        """E-mail the offer letter and return the recipient. Raises IntegrationError on failure."""
        recipient = self.recipient_for(emp)
        e = lambda v: escape(str(v))  # noqa: E731
        html = f"""<html><body style="font-family:Arial,Helvetica,sans-serif;color:#1c1917;padding:24px;">
<div style="max-width:600px;margin:0 auto;border:1px solid #fed7aa;border-radius:10px;padding:24px;">
<h2 style="color:#ea580c;margin:0 0 12px;border-bottom:2px solid #ea580c;padding-bottom:10px;">Offer of Employment</h2>
<p>Dear <strong>{e(emp.full_name)}</strong>,</p>
<p>Welcome to <strong>{e(self._s.company_name)}</strong>. We are delighted to offer you the position of
<strong>{e(emp.job_title)}</strong> in the <strong>{e(emp.department)}</strong> department.</p>
<table style="width:100%;border-collapse:collapse;background:#fff7ed;border-radius:8px;" cellpadding="6">
<tr><td style="color:#78716c;">Annual compensation</td><td><strong>{e(format_inr(emp.annual_ctc))} ({e(format_lpa(emp.annual_ctc))})</strong></td></tr>
<tr><td style="color:#78716c;">Joining date</td><td><strong>{e(emp.start_date.strftime('%B %d, %Y'))}</strong></td></tr>
<tr><td style="color:#78716c;">Workstation</td><td><strong>{e(emp.hardware)}</strong></td></tr>
</table>
<p>Your official offer letter is attached as a PDF.</p>
<p style="font-size:12px;color:#78716c;border-top:1px solid #e8ded4;padding-top:10px;">Sent by the HR onboarding system.</p>
</div></body></html>"""
        self._mailer.send(recipient, f"Offer of Employment - {emp.full_name} ({emp.job_title})", html, pdf_path)
        return recipient
