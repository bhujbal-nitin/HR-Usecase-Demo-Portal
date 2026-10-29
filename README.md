# HR Demo Portal

React front end + FastAPI back end.

- **UI** follows the `Piraji` reference portal: the six-agent catalog, chat demos, wizard and theme switcher use its stylesheets unchanged.
- **Back end** is a clean rewrite of the onboarding logic from the `Abhishekh` project: ServiceNow → AutomationEdge → Active Directory → Microsoft 365 → OrangeHRM → laptop → offer letter.
- **Scope:** **Onboarding**, **Offboarding** and **Leave & Attendance** have a back end. The other three agents (Payroll & Salary, HR Policy, Reimbursement & Benefits) are front-end demos with canned answers, exactly as in the reference.

```
HR_Demo_Portal/
├── backend/                 FastAPI service
│   ├── app/
│   │   ├── main.py          app factory, error handlers, serves frontend/dist if built
│   │   ├── container.py     composition root (wires clients, services, queue, poller)
│   │   ├── core/            settings (.env), exceptions, logging
│   │   ├── schemas/         Pydantic models (camelCase on the wire)
│   │   ├── repositories/    JSON-file store (atomic writes, swap-able for a DB)
│   │   ├── integrations/    one client per system: servicenow, automationedge, office365, orangehrm, mailer
│   │   ├── services/        onboarding use-cases, offer letter, autofill, health, approval poller
│   │   │   └── pipeline/    the 7 provisioning steps + runner (persists progress after each step)
│   │   ├── api/routes/      HTTP endpoints
│   │   └── utils/           retry, in-process task queue, formatting
│   └── tests/               32 tests (API, pipeline with fakes, integration clients with a scripted session)
└── frontend/                React 19 + Vite
    └── src/
        ├── api/             fetch client + endpoint modules
        ├── context/         toast, theme, employees (shared, polling)
        ├── components/      layout (sidebar/header/banner) and common (modal, badge, confirm)
        ├── features/
        │   ├── agents/      catalog, chat modal, one data file per agent (data/*.jsx)
        │   ├── onboarding/  2-step wizard, drop zones, signature pad, validation
        │   └── approvals/   HR review table, candidate detail, live pipeline tracker
        └── styles/          Piraji CSS (unchanged) + app.css (small additions)
```

## Running it

Prerequisites: Python 3.11+ (developed on 3.12) and Node 18+.

```bash
# 1. Back end
cd backend
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env            # then fill in the credentials you have
python run.py                     # http://127.0.0.1:8080  (interactive API docs at /docs)

# 2. Front end (second terminal)
cd frontend
npm install
npm run dev                       # http://localhost:3000  (proxies /api to :8080)
```

**Single process:** `npm run build` in `frontend/`, then `python run.py` serves the built app and the API together on `:8080`.

**Tests / lint:** `cd backend && pytest` · `cd frontend && npm test && npm run lint`.

## Agent demo page (`/agent-demo/:agentId`)

**Live Demo** on any catalog card, and the header's **Auto-Fill Demo** (Onboarding), open a full two-screen page: a WhatsApp-style
chat on the left and the agent timeline on the right. Payroll, HR Policy and Reimbursement replay their quick prompts as a scripted
conversation; every card is **Simulated** and nothing real is contacted. Onboarding, Offboarding and Leave & Attendance each offer three
modes (Auto-play · Simulated, Auto-play · Live, Manual · Live) that run one and the same conversation. The Onboarding journey is described below.

### Onboarding journey

Plays a fictional candidate through a WhatsApp-style chat (left) while the agent timeline (right) shows each step.
Every card is tagged **Live** or **Simulated**:

- **Live** = really executed: your backend (candidate record, ServiceNow request, AutomationEdge workflow, and - after you click
  *Approve & provision* - the whole provisioning pipeline), or real code in the browser (form validation, Aadhaar Verhoeff checksum,
  PAN format, name similarity, UAN format).
- **Simulated** = scripted, because nothing in this project connects to WhatsApp, a vision/OCR model, an e-KYC provider or the tax database.

Choose *Run live* or *Simulated only* when it starts. Live mode creates a real record and ServiceNow request immediately and never
creates accounts until you approve. The candidate comes from `/api/autofill`; sample PDFs (stamped SAMPLE) are generated in the browser.

## Configuration

Everything comes from `backend/.env` (template: `backend/.env.example`). No credentials are hard-coded.
A system whose credentials are blank is reported as **Not configured** in the header banner, and its pipeline step is
shown as **Skipped**. Nothing is simulated or faked, so a demo without credentials still runs the intake, the review
screens and offer-letter PDF generation.

### Document verification (OpenAI)

Set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`, default `gpt-4o`) in `backend/.env`. In the agent demo's **Manual · Live** mode
the candidate then uploads the Aadhaar card, the PAN card and the latest salary slip, and each file is read by the model:

- it must be the right kind of document and be readable;
- the name on it must match the joining-form name (case, order, titles and a missing middle name are tolerated;
  `DOCUMENT_NAME_MATCH_THRESHOLD`);
- the PAN date of birth must equal the Aadhaar date of birth.

A document that fails is rejected in the chat and asked for again; the record is only created once all three pass. Without a key
files are just attached. If OpenAI cannot be reached the file is accepted and flagged for HR. Files are sent to OpenAI; only masked
numbers (`XXXX XXXX 1234`) are returned to the browser or logged. Accepted formats: PDF and `.docx`.

## Offboarding

**Agent demo → Offboarding → Manual · Live** is a real resignation flow. The employee gives their employee ID or work e-mail (it must belong to
someone onboarded through this portal and approved), fills in the resignation form, and the backend raises a ServiceNow ticket. **HR approves** in
the chat or on the **HR Offboarding** page (`/offboarding`), and the backend then runs, one step after another, using its own API calls (no
AutomationEdge workflows):

1. Active Directory disabled: **shown only (tagged Simulated)**, not connected yet
2. Microsoft 365: sign-in blocked, sessions revoked, licences removed (account kept)
3. OrangeHRM: employment ended on the last working day
4. ServiceNow: asset-return ticket, then one clearance ticket (IT, Finance, Admin)
5. Final settlement calculated from the CTC (rules are stored with the step; no tax or statutory deductions)
6. Relieving letter PDF generated and e-mailed
7. The umbrella ServiceNow ticket resolved

A step whose system has no credentials is skipped; the chain stops at the first real failure and offers Rerun (it resumes from the failed step).
`OFFBOARDING_NOTICE_PERIOD_DAYS` and `OFFBOARDING_BASIC_SHARE` in `.env` tune the notice period and the leave-encashment rate.
API: `GET /offboardings`, `/options`, `/lookup?ref=`, `POST /offboardings`, `POST /offboardings/{id}/approve|reject|retry|retry-intake`,
`GET /offboardings/{id}/relieving-letter`, `DELETE /offboardings` (clear finished ones).

## Leave & Attendance

**Agent demo → Leave & Attendance** covers three requests in one chat, and the three modes (**Auto-play · Simulated**, **Auto-play · Live**,
**Manual · Live**) run exactly the same conversation, so only what is behind the chat differs:

1. **Leave balance and holidays**: the balance of every leave type and the next company holidays.
2. **Apply for leave**: an in-chat form, then checks (balance and rules), then the request goes to the manager. After approval the
   leave is booked and the balance read again.
3. **Regularize a missed punch**: the agent finds a day with a punch-in but no punch-out, the employee gives the time they left, the manager
   approves, and the employee is punched out.

*Simulated* saves nothing. *Live* works in OrangeHRM only (Microsoft 365 is not involved):

| Step | System | Call |
|---|---|---|
| Standard leave types (**Casual Leave, Sick Leave, Privilege Leave**): any missing is created | OrangeHRM | `GET` / `POST leave/leave-types` |
| A default quota (Casual 12, Sick 12, Privilege 15 days) for an employee who has none | OrangeHRM | `leave/leave-periods`, `POST leave/leave-entitlements` |
| Balances, holidays, work week, overlapping leave | OrangeHRM | `leave/leave-types`, `leave/employees/leave-balances`, `leave/holidays`, `leave/workweek`, `leave/overlap-leaves` |
| Punch log | OrangeHRM | `attendance/employees/{empNumber}/records` |
| After approval: book the leave | OrangeHRM | `POST leave/employees/leave-requests` ("Assign Leave") |
| After approval: correct the punch | OrangeHRM | `PUT attendance/employees/{empNumber}/records` (punch-out) |

Each step above is preceded by a **showcase AutomationEdge workflow** that must reach *Complete* before the chat goes on (the backend's own
calls still do the real work; the workflows take no inputs and return nothing): `HR Demo Get Leave Balance`, `HR Demo Check Leave Request`,
`HR Demo Assign Leave OrangeHRM`, `HR Demo Get Attendance Records`, `HR Demo Add Punch In OrangeHRM` (only when
the sample punch has to be added) and `HR Demo Punch Out OrangeHRM`. Their names come from the `AE_WORKFLOW_*` lines in `.env`;
`POST /api/leave/workflows/{balance|check|assign-leave|attendance|punch-in|punch-out}` runs one. Without AutomationEdge
credentials the step fails with Rerun / Skip. Simulated mode plays the same steps with a pretend workflow run.

The portal keeps only the **approval record** (`data/leave_requests.json`): the manager decides on **HR Approvals → Leave & Attendance**. Days
asked for, but not yet booked in OrangeHRM, are held off the balance shown in the chat. Approving does not touch OrangeHRM by itself: the running
demo records it as its next step, or the **Record in OrangeHRM** button on that page does (repeating it never books twice). A system that is not
configured, or a call it refuses, fails that step with its real message and offers Rerun / Skip. Employees need an OrangeHRM profile (recorded at
onboarding, or found by name) and a leave entitlement there.

For the missed-punch scenario the demo adds a **sample punch-in without an out-punch** in OrangeHRM (time zone from `ORANGEHRM_TIMEZONE_NAME` /
`ORANGEHRM_TIMEZONE_OFFSET`) when the employee has none; OrangeHRM closes the latest open punch, so one is kept open at a time. **Clear history**
removes decided requests from the portal only; what OrangeHRM recorded stays there.

API: `GET /leave/options`, `/lookup?ref=`, `/balances?ref=`, `/holidays`, `/attendance?ref=`, `POST /leave/check`,
`/leave/attendance/demo-punch?ref=`, `POST /leave/requests/leave|regularization`, `GET /leave/requests`, `/leave/requests/{id}`,
`POST /leave/requests/{id}/approve|reject|apply`, `DELETE /leave/requests`.

## How onboarding works

1. **Wizard** (`/onboarding`): personal + employment details, three documents (Aadhaar, latest salary slip, EPFO/UAN;
   PDF or Word, ≤ 10 MB) and a drawn e-signature → `POST /api/employees` (multipart).
2. **Background sync**: a ServiceNow request (REQ + RITM + approval task, documents attached) is created and the AE
   workflow *HR Demo Get Employee Details* runs. The wizard does not wait for this.
3. **HR Approvals** (`/approvals`): HR opens the candidate, downloads the documents, then approves or rejects. Approval
   can also happen *inside ServiceNow*, which a poller (every 25 s) or the **Sync ServiceNow** button detects.
4. **Provisioning pipeline**, run in the background with live per-step status:

   | # | Step | Systems |
   |---|------|---------|
   | 1 | Approve the ServiceNow request | ServiceNow |
   | 2 | Management approval workflow | AutomationEdge |
   | 3 | Active Directory account | AutomationEdge |
   | 4 | Microsoft 365 account | AutomationEdge + Microsoft Graph |
   | 5 | OrangeHRM profile (uses the M365 address as work e-mail, attaches documents) | AutomationEdge + OrangeHRM |
   | 6 | Laptop request + hardware incident | AutomationEdge + ServiceNow |
   | 7 | Offer letter PDF → e-mail → attached to the ServiceNow request | SMTP, ServiceNow, AutomationEdge |

   A failing step is recorded and the pipeline continues; the candidate ends **Approved** with *completed with errors*
   if any step failed. Sub-actions inside a step are independent (e.g. the AE workflow failing does not skip the Graph call).

## API (all under `/api`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/employees` · `/employees/{id}` | list / fetch records (includes `pipeline`, `workflowRuns`, results) |
| POST | `/employees` | submit a candidate (multipart: fields + `idDoc`, `panDoc`, `salaryDoc`, optional `uanDoc`, `signature`) |
| POST | `/employees/{id}/approve` → **202** | start provisioning (409 if not *Pending Review*) |
| POST | `/employees/{id}/reject` | reject + close the ServiceNow request |
| POST | `/employees/sync-servicenow` | pick up requests approved inside ServiceNow |
| GET | `/employees/{id}/documents/{idDoc\|panDoc\|uanDoc\|salaryDoc}` | download an uploaded document |
| GET / POST | `/employees/{id}/offer-letter` | download PDF / regenerate and e-mail |
| DELETE | `/employees?scope=processed\|all` | clear history (never removes in-flight records) |
| GET | `/documents/verification` | whether `OPENAI_API_KEY` is set (document checks on/off) |
| POST | `/documents/verify` | read one document with OpenAI and check it against the form (multipart: `docKey`, `file`, `fullName`, `referenceDob`) |
| GET | `/autofill` | unique sample candidate for the demo Auto-Fill button |
| GET | `/integrations/health` | live connectivity of the four systems |
| GET | `/tasks`, `/tasks/{id}` | background-job status and metrics |
| GET | `/health` | liveness |

## Differences from the reference projects

Deliberate changes - tell me if you want any reverted:

- **Approval is asynchronous.** `Abhishekh` blocked the HTTP request for minutes; here approve returns immediately and the UI polls the live pipeline.
- **No built-in secrets.** The references shipped default usernames, passwords and an Azure client secret in code; those are gone (they should be rotated if they were real).
- **Not carried over** (they put credentials in the browser or are out of scope): the ServiceNow / AutomationEdge / OrangeHRM "direct-login" bridge pages, the `config` endpoints that returned passwords, the APK download, recruitment, leave, exit, payslip and relieving-letter code.
- **No fabricated data.** Uploaded files are attached as-is (the reference generated placeholder PDFs when none was uploaded); OrangeHRM no longer gets an invented gender / marital status or a guessed city; M365 temporary passwords are random per user instead of one shared default; an existing M365 user's password is not reported.
- **Offer letter** uses `INR 32,00,000` formatting (the PDF base fonts have no ₹ glyph), splits CTC 85 / 15 base / bonus, and drops the hard-coded policy claims (PTO days, insurance cover, learning budget). Company name, address and signatory are settings.
- **Wizard** also collects department, job title, manager, joining date, CTC and workstation - the pipeline needs them and the Piraji wizard hard-coded them.
- **Onboarding chat agent** answers from live data and opens the wizard / approvals; its Day-1 schedule and buddy canned answers were dropped because nothing real backs them.
- **Sidebar** gains an *Onboarding* section (Wizard, HR Approvals); Piraji had only the catalog tab.
- **AES login for AutomationEdge** is done in Python (`cryptography`), verified byte-for-byte against the original Node helper, so Node is no longer required.

## Known limitations

- **No authentication or roles.** Anyone who can reach the API can approve candidates and download documents. Put it behind your network/SSO or add auth before real use.
- **Storage is a JSON file** (`backend/data/`, includes candidate PII and uploads). Fine for a demo; use the repository interface to move to a database.
- **The task queue is in-process.** A restart during provisioning marks the run *completed with errors* (it is not re-run, to avoid duplicate accounts); finished steps are preserved.
- **Live integrations were not exercised** (no credentials available here). The clients are covered by tests against scripted HTTP responses, and the ServiceNow / AutomationEdge / Microsoft Graph / OrangeHRM call shapes were ported from the working reference code - expect to validate each against your tenants.
