"""Relieving-letter PDF generation and e-mail dispatch."""

import logging
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.core.config import Settings
from app.integrations.mailer import Mailer
from app.schemas.offboarding import Offboarding
from app.utils.formatting import format_inr, safe_filename

logger = logging.getLogger(__name__)

_PRIMARY = colors.HexColor("#ea580c")
_DARK = colors.HexColor("#1c1917")
_BORDER = colors.HexColor("#fed7aa")


class RelievingLetterService:
    def __init__(self, settings: Settings, mailer: Mailer):
        self._s = settings
        self._mailer = mailer
        self._dir = settings.offers_dir
        self._dir.mkdir(parents=True, exist_ok=True)

    def path_for(self, record: Offboarding) -> Path:
        return self._dir / f"Relieving_Letter_{safe_filename(record.full_name)}_{safe_filename(record.id)}.pdf"

    def generate_pdf(self, record: Offboarding, settlement: dict) -> Path:
        path = self.path_for(record)
        e = lambda v: escape(str(v))  # noqa: E731 - Paragraph parses XML-ish markup
        money = lambda v: format_inr(int(v), "INR ")  # noqa: E731 - PDF base fonts have no rupee glyph
        styles = getSampleStyleSheet()
        body = ParagraphStyle("Body", parent=styles["Normal"], fontName="Helvetica", fontSize=10, leading=15, textColor=_DARK, spaceAfter=8)
        title = ParagraphStyle("Title", parent=body, fontName="Helvetica-Bold", fontSize=16, textColor=_PRIMARY, spaceAfter=4)
        small = ParagraphStyle("Small", parent=body, fontSize=8.5, leading=12, textColor=colors.HexColor("#78716c"))

        rows = [
            ["Salary for the final month", money(settlement["salaryPayable"])],
            [f"Leave encashment ({settlement['leaveDays']} day(s))", money(settlement["leaveEncashment"])],
            [f"Notice recovery ({settlement['noticeShortfallDays']} day(s) short)", f"- {money(settlement['noticeRecovery'])}"],
            ["Net amount payable", money(settlement["netPayable"])],
        ]
        table = Table(rows, colWidths=[340, 150])
        table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica"), ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"), ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("LINEBELOW", (0, 0), (-1, -2), 0.4, _BORDER), ("LINEABOVE", (0, -1), (-1, -1), 1, _PRIMARY),
            ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))

        story = [
            Paragraph(e(self._s.company_name), title),
            Paragraph(e(self._s.company_address), small),
            HRFlowable(width="100%", thickness=1.5, color=_PRIMARY, spaceBefore=6, spaceAfter=14),
            Paragraph("RELIEVING LETTER", ParagraphStyle("H", parent=body, fontName="Helvetica-Bold", fontSize=12)),
            Paragraph(f"Employee ID: {e(record.employee_id)} &nbsp;&nbsp; Reference: {e(record.id)}", small),
            Spacer(1, 10),
            Paragraph(f"Dear <b>{e(record.full_name)}</b>,", body),
            Paragraph(
                f"This is to confirm that your resignation from the position of <b>{e(record.job_title)}</b> in the "
                f"<b>{e(record.department)}</b> department was accepted, and that you are relieved from the services of "
                f"{e(self._s.company_name)} with effect from the close of business on <b>{record.last_working_day.strftime('%B %d, %Y')}</b>.",
                body,
            ),
            Paragraph("Your system access has been withdrawn, your company assets are being recovered and your records have been closed. Your final settlement is summarised below.", body),
            Spacer(1, 4), table, Spacer(1, 6),
            Paragraph("The amount is before tax and statutory deductions and will be released with the next payroll after all clearances.", small),
            Spacer(1, 14),
            Paragraph("We thank you for your contribution and wish you every success.", body),
            Spacer(1, 18),
            Paragraph(f"<b>{e(self._s.offer_signatory_name)}</b><br/>{e(self._s.offer_signatory_title)}<br/>{e(self._s.company_name)}", body),
        ]
        SimpleDocTemplate(str(path), pagesize=letter, rightMargin=50, leftMargin=50, topMargin=45, bottomMargin=45,
                          title=f"Relieving Letter - {record.full_name}").build(story)
        logger.info("Relieving letter generated: %s", path.name)
        return path

    def recipient_for(self, record: Offboarding) -> str:
        return self._s.hr_notification_recipient or record.personal_email

    def send_email(self, record: Offboarding, pdf_path: Path) -> str:
        """E-mail the letter and return the recipient. Raises IntegrationError on failure."""
        recipient = self.recipient_for(record)
        e = lambda v: escape(str(v))  # noqa: E731
        html = f"""<html><body style="font-family:Arial,Helvetica,sans-serif;color:#1c1917;padding:24px;">
<div style="max-width:600px;margin:0 auto;border:1px solid #fed7aa;border-radius:10px;padding:24px;">
<h2 style="color:#ea580c;margin:0 0 12px;border-bottom:2px solid #ea580c;padding-bottom:10px;">Relieving letter</h2>
<p>Dear <strong>{e(record.full_name)}</strong>,</p>
<p>Your offboarding with <strong>{e(self._s.company_name)}</strong> is complete. Your last working day was
<strong>{e(record.last_working_day.strftime('%B %d, %Y'))}</strong>. Your relieving letter and final-settlement summary are attached.</p>
<p style="font-size:12px;color:#78716c;border-top:1px solid #e8ded4;padding-top:10px;">Sent by the HR offboarding system.</p>
</div></body></html>"""
        self._mailer.send(recipient, f"Relieving letter - {record.full_name}", html, pdf_path)
        return recipient
