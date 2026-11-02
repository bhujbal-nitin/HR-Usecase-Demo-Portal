# HR Demo Portal

React front end + FastAPI back end.

- **UI** follows the `Piraji` reference portal: the six-agent catalog, chat demos, wizard and theme switcher use its stylesheets unchanged.
- **Back end** is a clean rewrite of the onboarding logic from the `Abhishekh` project: ServiceNow → AutomationEdge → Active Directory → Microsoft 365 → OrangeHRM → laptop.
- **Scope:** **Onboarding**, **Offboarding**, **Leave & Attendance**, **Payroll & Salary** and **Reimbursement & Benefits** and **HR Policy & Document** have a back end. Nothing is a canned front-end demo any more, exactly as in the reference.

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
│   │   ├── services/        onboarding use-cases, autofill, health, approval poller
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
- **Simulated** = scripted, because nothing in this project connects to WhatsApp or a vision/OCR model.

Choose *Run live* or *Simulated only* when it starts. Live mode creates a real record and ServiceNow request immediately and never
creates accounts until you approve. The candidate comes from `/api/autofill`; sample PDFs (stamped SAMPLE) are generated in the browser.

## Configuration

Everything comes from `backend/.env` (template: `backend/.env.example`). No credentials are hard-coded.
A system whose credentials are blank is reported as **Not configured** in the header banner, and its pipeline step is
shown as **Skipped**. Nothing is simulated or faked, so a demo without credentials still runs the intake and the review
screens.

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
3. **Attendance request**: the employee gives the day (any day in the last 30 days), the time they came in and the time they left; the
   manager approves; then the day is written to OrangeHRM as a punch-in and a punch-out. If OrangeHRM already holds a punch record for that
   day it is **replaced**.

The chat shows the same three suggestion chips in every mode: Manual waits for you to tap one, Auto-play taps them in turn.

*Simulated* saves nothing. *Live* works in OrangeHRM only (Microsoft 365 is not involved):

| Step | System | Call |
|---|---|---|
| Standard leave types (**Casual Leave, Sick Leave, Privilege Leave**): any missing is created | OrangeHRM | `GET` / `POST leave/leave-types` |
| A default quota (Casual 12, Sick 12, Privilege 15 days) for an employee who has none | OrangeHRM | `leave/leave-periods`, `POST leave/leave-entitlements` |
| Balances, holidays, work week, overlapping leave | OrangeHRM | `leave/leave-types`, `leave/employees/leave-balances`, `leave/holidays`, `leave/workweek`, `leave/overlap-leaves` |
| Punch log | OrangeHRM | `attendance/employees/{empNumber}/records` |
| After approval: book the leave | OrangeHRM | `POST leave/employees/leave-requests` ("Assign Leave") |
| After approval: record the day (delete what the day held, then punch in and punch out) | OrangeHRM | `DELETE` / `POST` / `PUT attendance/employees/{empNumber}/records` |

Each step above is preceded by a **showcase AutomationEdge workflow** that must reach *Complete* before the chat goes on (the backend's own
calls still do the real work; the workflows take no inputs and return nothing): `HR Demo Get Leave Balance`, `HR Demo Check Leave Request`,
`HR Demo Assign Leave OrangeHRM`, `HR Demo Get Attendance Records`, `HR Demo Add Punch In OrangeHRM` and
`HR Demo Punch Out OrangeHRM` (the last two run before an approved attendance request is recorded). Their names come from the `AE_WORKFLOW_*` lines in `.env`;
`POST /api/leave/workflows/{balance|check|assign-leave|attendance|punch-in|punch-out}` runs one. Without AutomationEdge
credentials the step fails with Rerun / Skip. Simulated mode plays the same steps with a pretend workflow run.

The portal keeps only the **approval record** (`data/leave_requests.json`): the manager decides on **Approvals → Leave & Attendance**. Days
asked for, but not yet booked in OrangeHRM, are held off the balance shown in the chat. Approving does not touch OrangeHRM by itself: the running
demo records it as its next step, or the **Record in OrangeHRM** button on that page does (repeating it never books twice). A system that is not
configured, or a call it refuses, fails that step with its real message and offers Rerun / Skip. Employees need an OrangeHRM profile (recorded at
onboarding, or found by name) and a leave entitlement there.

Punches are written with the time zone from `ORANGEHRM_TIMEZONE_NAME` / `ORANGEHRM_TIMEZONE_OFFSET`. Recording an attendance request first deletes
the day's existing records, so repeating a failed recording never leaves duplicates. **Clear history** removes decided requests from the portal
only; what OrangeHRM recorded stays there.

API: `GET /leave/options`, `/lookup?ref=`, `/balances?ref=`, `/holidays`, `/attendance?ref=&date=`, `POST /leave/check`,
`POST /leave/requests/leave|regularization`, `GET /leave/requests`, `/leave/requests/{id}`,
`POST /leave/requests/{id}/approve|reject|apply`, `DELETE /leave/requests`.

## Payroll & Salary

The employee downloads three documents, and the chat shows nothing but the download (no breakdown, no tables): **Payslip** (asks which month first),
**CTC statement** and **Form 16**. All three are **PDFs the portal draws itself** (`backend/app/services/payroll/pdf.py`): the payslip and the CTC statement in the
layout of the company salary slip, Form 16 in the layout of the Form 16 you supplied (logo, Part A with the deductor and deductee, the quarterly TDS summary,
Part B with the salary and tax computation, the declaration and the signature box). There are no Word templates to keep up; the logo is
`backend/app/services/payroll/logo.png`. Same three modes as Leave: *Auto-play · Simulated* (nothing contacted; the same PDFs are built in the browser for the demo
employee, Aditi Rao, with fictional figures), *Auto-play · Live* (pick an employee) and *Manual · Live*. Nothing is written to OrangeHRM and there is no approval
step. The employee's annual **CTC** is read from OrangeHRM (PIM → employee → Salary, the `CTC` component that onboarding records,
`GET pim/employees/{empNumber}/salary-components`); the rest is worked out by the backend.

| Document | Endpoint |
|---|---|
| **Payslip** (one month) | `GET /api/payroll/payslip/download?ref=&month=YYYY-MM` |
| **CTC statement** | `GET /api/payroll/ctc/download?ref=` |
| **Form 16** (last completed financial year, e.g. FY 2025-26 in October 2026) | `GET /api/payroll/form16/download?ref=` |

The files are named `Payslip_October_2026_<Name>.pdf`, `CTC_Statement_<Name>.pdf` and `Form16_<Name>.pdf`.

**The salary structure** (`app/services/payroll/policy.py`): basic 40% of CTC, HRA 50% of basic, conveyance allowance 1,600 a month, special allowance the rest; PF 12%
of basic; professional tax 200 a month; income tax (TDS) by the new-regime slabs (standard deduction 75,000, no tax up to 12 lakh taxable, 4% cess), spread equally
over 12 months. The payslip lists Basic, Conveyance Allowance, HRA and Special Allowance against PROV.FUND, P.Tax and Income Tax (TDS). The PAN, UAN, provident fund
number, NPS and ESIC are not known to the portal and show a dash.

**Form 16** is the same over the full year of the last completed financial year (the CTC is treated as the whole year's pay, from 1 April to 31 March). The new regime
has no exempt allowances or Chapter VI-A deductions (shown as 0.00); the tax deducted is split equally over the four quarters (three months of TDS each). The
employee's address comes from their onboarding record. The company's and the employee's PAN, the company's TAN and the quarterly receipt numbers are not known
to the portal and show a dash in the live run (the simulated run shows made-up values). The declaration is unsigned: it carries a blank signature box titled
Authorised Signatory under the company name.

**AutomationEdge workflows** (dummy showcase runs, no inputs, nothing returned; the portal's backend still does all the real work). Before **every** document `HR Demo Fetch Salary Details` runs, then the document's own workflow: `HR Demo Generate Payslip`, `HR Demo Generate CTC Statement` or `HR Demo Generate Form 16`. The chat goes on only when a workflow is Complete (otherwise the step offers Rerun / Skip). `POST /api/payroll/workflows/{fetch-salary|generate-payslip|generate-ctc|generate-form16}` runs one; without AutomationEdge credentials it answers 502. The names are the settings `AE_WORKFLOW_FETCH_SALARY`, `AE_WORKFLOW_GENERATE_PAYSLIP`, `AE_WORKFLOW_GENERATE_CTC`, `AE_WORKFLOW_GENERATE_FORM16`.

## Reimbursement & Benefits

The employee uploads expense **bills of any kind** (a PDF or a photo: PNG, JPG, WEBP), one after another. Each bill is read with **OpenAI**
(the same `OPENAI_API_KEY` and model as the document checks): its category (Travel, Food, Mobile, Stay, Medical or Others), the printed date,
the final amount and the vendor. The chat shows the bills in two tables, **Within the policy** (Travel and Food) and **Outside the policy**,
each with its total. This is only a hint: the employee sends **all** the bills to the manager, who approves or rejects **each bill** on
**Approvals → Reimbursement** (the bills within the policy start ticked, any bill can be approved). The approved bills are then recorded in
OrangeHRM as a claim, and the chat tells the employee which bills were approved. Same three modes as Leave: *Auto-play · Simulated*,
*Auto-play · Live* (three sample bills: Food, Travel and a hotel stay; the simulated manager approves the first two and rejects the third) and
*Manual · Live* (your own bills).

| What | Where it happens |
|---|---|
| Reading a bill (category, date, amount, vendor) | OpenAI, `POST /api/reimbursement/bills/read` (nothing is saved; the files are not kept) |
| The Travel / Food policy hint and the totals | the portal's backend (`app/services/reimbursement/policy.py`), applied again on the server whatever the chat sends |
| The claim waiting for the manager | the portal (`reimbursement_claims.json`), `POST /api/reimbursement/claims`; `POST /claims/{id}/approve` (body `{"approvedBills": [0, 2]}`, the positions of the approved bills; no body approves all) or `/reject`, then `/apply` |
| After approval: the claim | OrangeHRM Claim: `claim/events`, `claim/expenses/types` (the event "Employee Expense Reimbursement" and an expense type for each category of the approved bills are created if missing), `POST claim/employees/{empNumber}/requests` (Assign Claim), `POST claim/requests/{id}/expenses` for each approved bill (INR), `PUT claim/requests/{id}/action` (submit) |

Only the approved bills are recorded in OrangeHRM; at least one bill must be approved (otherwise the claim is rejected). Without
`OPENAI_API_KEY` reading a bill fails with a clear message (Rerun / Skip). Recording is safe to repeat: it carries on from the expenses already
added and never creates a second claim. Where to see it in OrangeHRM: **Claim → Employee Claims** (`/web/index.php/claim/viewAssignClaim`);
one claim opens at `/web/index.php/claim/assignClaim/id/{id}`. OrangeHRM's API cannot delete a claim, and it shows a claim that was assigned
and submitted by an admin with the status **Paid**.

Four AutomationEdge **showcase workflows** run in the chat, each right **after** the step it stands for, and the chat goes on once it is
*Complete* (the portal's own calls still do the real work; the workflows take no inputs and return nothing): `HR Demo Read Bill` and
`HR Demo Check Reimbursement Policy` (each once, after all the bills are read), `HR Demo Submit Expense Claim` (after the claim is saved for the
manager) and `HR Demo Create Claim OrangeHRM` (after the approved bills are recorded in OrangeHRM). Their names come from the `AE_WORKFLOW_*`
lines in `.env`; `POST /api/reimbursement/workflows/{read-bill|check-policy|submit-claim|create-claim}` runs one. Without AutomationEdge
credentials the step fails with Rerun / Skip. Simulated mode plays the same steps with a pretend workflow run.

## HR Policy & Document

Three parts: Policy search, Q&A and Documents. Same three modes as Leave: *Auto-play · Simulated*, *Auto-play · Live* and *Manual · Live*. The
employee is recognised first (ID or e-mail), so names can be filled into the letters later.

| Part | How it works |
|---|---|
| **Policy search** | Tapping "Policy search" shows a **dropdown with every policy PDF** in `backend/hr_documents/Policies/` (the title is the file name without `.pdf`, e.g. `AE Leave Policy.pdf` is "AE Leave Policy"); the employee selects one, taps Submit and downloads the PDF as it is. Afterwards the chat offers "Another policy" or "That's all". New PDFs you drop in the folder appear at once (no restart). `GET /api/hr-policy/policies`, `GET /api/hr-policy/policies/{key}/download` (the policies endpoint also takes `?query=` to match words in the names; the chat does not use it) |
| **Q&A** | The question goes to the **knowledge base** (the AutomationEdge KM API, `KM_BASE_URL`), together with the earlier questions and answers of the chat so a follow-up works. The answer is shown with the policy documents it came from. `POST /api/hr-policy/ask` |
| **Documents** | The employee asks for the **address proof (bonafide) letter** or the **bank account opening letter** and gets a **Word file made for them**: the template with their name, employee code, designation and dates filled in. `GET /api/hr-policy/letters[?ref=]`, `GET /api/hr-policy/letters/{address-proof\|bank-account}/download?ref=` |

**The knowledge base.** Set `KM_PROJECT_ID` and `KM_PROJECT_SECRET` in `backend/.env` (`KM_BASE_URL` defaults to
`https://ac2.automationedge.com/km/api`). The backend calls `GET /token` with them, keeps the token until it is about to expire and then asks for
a new one; `POST /query` takes `{history, filters, overrides}` and answers `{answer, data_points}`. Without the two values a question fails with
"Knowledge base: not configured" (Rerun / Skip in the chat). The answers are only as good as the documents loaded in the knowledge base.

**The policies.** Keep the policy PDFs in **`backend/hr_documents/Policies/`**; the title shown in the chat is the file name without `.pdf` (so `AE Leave Policy.pdf` is "AE Leave Policy"). 
**The letters.** You keep two Word templates in **`backend/hr_documents/`** (setting `HR_DOCUMENTS_DIR`):

```
backend/hr_documents/Address_Proof_bonafide_letter.docx          (the address proof / bonafide letter)
backend/hr_documents/Salary_Account_Opening_Template.docx        (the bank account opening letter)
```

Only `.docx` is used. A field is written between double angle brackets, e.g. `<<First Name>>`; when an employee asks for the letter the backend
copies the template, fills the fields from the employee's record and returns the copy (`Address_Proof_Letter_<Name>.docx`). The template is never
changed, the folder is read on every request (no restart), and no library is needed: Word splits text over several runs, so the filler joins each
paragraph before replacing (`app/services/hr_letters.py`). The fields: `<<Employee Name>>` / `<<Full Name>>`, `<<First Name>>`, `<<Last Name>>`,
`<<Designation>>` (job title), `<<Function>>` (department), `<<Employee Code>>` and `<<Ref No>>` (**AE** + the employee ID shown in OrangeHRM, e.g.
AE373242), `<<Date>>` / `<<Today's date>>` (today, `30-10-2026`) and `<<Joining Date>>`. A field with any other name, or a template with no
field, stops the letter with a clear message instead of giving out a half-filled one. "His employee code" is made neutral ("The employee
code"), because the portal does not store gender. Everything that is not a field (company address, footer, images) stays as it is. See
`backend/hr_documents/README.txt`.

Five AutomationEdge **showcase workflows** run in the chat, each right **after** the step it stands for, and the chat goes on once it is *Complete*
(the portal's own calls still do the real work; the workflows take no inputs and return nothing): `HR Demo Search Policy` (after a policy search),
`HR Demo Get Policy Document` (after a policy is taken from the folder), `HR Demo Ask Policy Question` (after **every** answer of the knowledge
base, so a follow-up runs it again), and `HR Demo Generate Address Proof Letter` / `HR Demo Generate Bank Account Opening Letter` (after the
matching letter is made; a letter whose template is missing runs no workflow). Their names come from the `AE_WORKFLOW_*` lines in `.env`;
`POST /api/hr-policy/workflows/{search-policy|get-policy|ask-question|address-proof-letter|bank-account-letter}` runs one. Without AutomationEdge
credentials the step fails with Rerun / Skip. Simulated mode plays the same steps with a pretend workflow run.

## How onboarding works

1. **Wizard** (`/onboarding`): personal + employment details, three documents (Aadhaar, latest salary slip, EPFO/UAN;
   PDF or Word, ≤ 10 MB) and a drawn e-signature → `POST /api/employees` (multipart).
2. **Background sync**: a ServiceNow request (REQ + RITM + approval task, documents attached) is created and the AE
   workflow *HR Demo Get Employee Details* runs. The wizard does not wait for this.
3. **Approvals** (`/approvals`): HR opens the candidate, downloads the documents, then approves or rejects. Approval
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
- **Wizard** also collects department, job title, manager, joining date, CTC and workstation - the pipeline needs them and the Piraji wizard hard-coded them.
- **Onboarding chat agent** answers from live data and opens the wizard / approvals; its Day-1 schedule and buddy canned answers were dropped because nothing real backs them.
- **Sidebar** gains an *Onboarding* section (Wizard, Approvals); Piraji had only the catalog tab.
- **AES login for AutomationEdge** is done in Python (`cryptography`), verified byte-for-byte against the original Node helper, so Node is no longer required.

## Known limitations

- **No authentication or roles.** Anyone who can reach the API can approve candidates and download documents. Put it behind your network/SSO or add auth before real use.
- **Storage is a JSON file** (`backend/data/`, includes candidate PII and uploads). Fine for a demo; use the repository interface to move to a database.
- **The task queue is in-process.** A restart during provisioning marks the run *completed with errors* (it is not re-run, to avoid duplicate accounts); finished steps are preserved.
- **Live integrations were not exercised** (no credentials available here). The clients are covered by tests against scripted HTTP responses, and the ServiceNow / AutomationEdge / Microsoft Graph / OrangeHRM call shapes were ported from the working reference code - expect to validate each against your tenants.
