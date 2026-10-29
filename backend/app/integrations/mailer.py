"""Outbound e-mail over SMTP (STARTTLS)."""

import logging
import smtplib
from email.message import EmailMessage
from pathlib import Path

from app.core.config import Settings
from app.core.exceptions import IntegrationError, IntegrationNotConfiguredError

logger = logging.getLogger(__name__)
SYSTEM = "SMTP"


class Mailer:
    def __init__(self, settings: Settings):
        self._s = settings

    def is_configured(self) -> bool:
        return bool(self._s.smtp_server and self._s.smtp_username and self._s.smtp_password.get_secret_value())

    def send(self, to: str, subject: str, html_body: str, attachment: Path | None = None) -> None:
        if not self.is_configured():
            raise IntegrationNotConfiguredError(SYSTEM)

        message = EmailMessage()
        message["From"] = f"{self._s.smtp_sender_name} <{self._s.smtp_username}>"
        message["To"] = to
        message["Subject"] = subject
        message.set_content("This message requires an HTML-capable mail client.")
        message.add_alternative(html_body, subtype="html")
        if attachment and attachment.exists():
            message.add_attachment(
                attachment.read_bytes(), maintype="application", subtype="pdf", filename=attachment.name
            )

        try:
            # Port 465 is implicit TLS; every other port (587, 25) upgrades with STARTTLS.
            if self._s.smtp_port == 465:
                server = smtplib.SMTP_SSL(self._s.smtp_server, self._s.smtp_port, timeout=20)
            else:
                server = smtplib.SMTP(self._s.smtp_server, self._s.smtp_port, timeout=20)
            with server:
                if self._s.smtp_port != 465:
                    server.starttls()
                # Provider app-passwords are often displayed with spaces; they are not part of the secret.
                server.login(self._s.smtp_username, self._s.smtp_password.get_secret_value().replace(" ", ""))
                server.send_message(message)
        except (smtplib.SMTPException, OSError) as exc:
            raise IntegrationError(SYSTEM, f"could not send to {to}: {exc}") from exc
        logger.info("E-mail '%s' sent to %s", subject, to)
