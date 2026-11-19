"""HRMS: the portal's built-in replica of HRMS 5 (web-session login + /web/index.php/api/v2 JSON API).

The portal's own HRMS client and AutomationEdge workflows talk to it exactly as they talk to a real HRMS.
Layout: ``store`` (persistence), ``auth`` (login/session), ``pim`` / ``leave`` / ``attendance`` / ``claim`` (the rules),
``seed`` (first-start data); the HTTP routes are in ``app/api/routes/hrms.py``.
"""
