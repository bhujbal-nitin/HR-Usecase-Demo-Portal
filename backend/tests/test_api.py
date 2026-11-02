from tests.conftest import wait_for


def _submit(client, form, files):
    response = client.post(
        "/api/employees",
        data=form,
        files={key: value for key, value in files.items()},
    )
    return response


def test_liveness(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_integrations_report_not_configured(client):
    body = client.get("/api/integrations/health").json()
    assert set(body) == {"servicenow", "automationedge", "office365", "orangehrm"}
    assert all(item["configured"] is False and item["ok"] is False for item in body.values())


def test_autofill_returns_valid_profile(client, candidate_form, candidate_files):
    profile = client.get("/api/autofill").json()
    assert profile["fullName"] and len(profile["aadhaar"]) == 12 and profile["annualCtc"] > 0

    # The generated profile must itself be accepted by the submit endpoint.
    form = {**candidate_form, **{k: str(v) for k, v in profile.items()}}
    assert _submit(client, form, candidate_files).status_code == 201


def test_submit_candidate_creates_pending_record(client, candidate_form, candidate_files):
    response = _submit(client, candidate_form, candidate_files)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["id"].startswith("AE-")
    assert body["status"] == "Pending Review"
    assert body["aadhaar"] == "234567890123"  # digits only
    assert set(body["documents"]) == {"idDoc", "panDoc", "uanDoc", "salaryDoc"}

    listed = client.get("/api/employees").json()
    assert [e["id"] for e in listed] == [body["id"]]

    # Background sync runs; with ServiceNow unconfigured it records why instead of failing the submit.
    wait_for(lambda: client.get(f"/api/employees/{body['id']}").json()["serviceNow"]["syncError"])
    assert client.get(f"/api/employees/{body['id']}").json()["serviceNow"]["approvalStatus"] == "Not Synced"


def test_submit_rejects_non_pdf_document(client, candidate_form, candidate_files):
    candidate_files["idDoc"] = ("aadhaar.png", b"\x89PNG", "image/png")
    response = _submit(client, candidate_form, candidate_files)
    assert response.status_code == 422
    assert "only PDF" in response.json()["detail"]
    assert client.get("/api/employees").json() == []


def test_submit_requires_aadhaar_and_salary_slip(client, candidate_form, candidate_files):
    del candidate_files["salaryDoc"]
    response = _submit(client, candidate_form, candidate_files)
    assert response.status_code == 422
    assert "Latest Salary Slip" in response.json()["detail"]


def test_epfo_uan_card_and_number_are_optional(client, candidate_form, candidate_files):
    del candidate_files["uanDoc"]
    candidate_form["uan"] = ""
    response = _submit(client, candidate_form, candidate_files)
    assert response.status_code == 201, response.text
    body = response.json()
    assert set(body["documents"]) == {"idDoc", "panDoc", "salaryDoc"} and body["uan"] == ""
    assert client.get(f"/api/employees/{body['id']}/documents/uanDoc").status_code == 404


def test_a_provided_uan_must_still_be_valid(client, candidate_form, candidate_files):
    candidate_form["uan"] = "123"
    assert _submit(client, candidate_form, candidate_files).status_code == 422


def test_submit_validates_fields(client, candidate_form, candidate_files):
    candidate_form["aadhaar"] = "123"
    candidate_form["email"] = "not-an-email"
    response = _submit(client, candidate_form, candidate_files)
    assert response.status_code == 422
    fields = response.json()["fields"]
    assert "aadhaar" in fields and "email" in fields


def test_approve_runs_pipeline_and_blocks_duplicates(client, candidate_form, candidate_files):
    employee_id = _submit(client, candidate_form, candidate_files).json()["id"]
    wait_for(lambda: client.get(f"/api/employees/{employee_id}").json()["intakeStatus"] == "completed")

    response = client.post(f"/api/employees/{employee_id}/approve")
    assert response.status_code == 202
    assert response.json()["status"] == "Processing Approval"

    done = wait_for(
        lambda: (e := client.get(f"/api/employees/{employee_id}").json())["status"] == "Approved" and e
    )
    steps = {s["key"]: s for s in done["pipeline"]}
    assert list(steps) == [
        "servicenow_approval", "management_approval", "active_directory",
        "office365", "orangehrm", "laptop",
    ]
    # No credentials in the test environment: external systems are skipped, never faked.
    assert steps["active_directory"]["status"] == "skipped"
    assert client.post(f"/api/employees/{employee_id}/approve").status_code == 409
    assert client.post(f"/api/employees/{employee_id}/reject").status_code == 409


def test_reject_candidate(client, candidate_form, candidate_files):
    employee_id = _submit(client, candidate_form, candidate_files).json()["id"]
    response = client.post(f"/api/employees/{employee_id}/reject")
    assert response.status_code == 200
    assert response.json()["status"] == "Rejected"
    assert client.post(f"/api/employees/{employee_id}/approve").status_code == 409


def test_download_uploaded_document(client, candidate_form, candidate_files):
    employee_id = _submit(client, candidate_form, candidate_files).json()["id"]
    response = client.get(f"/api/employees/{employee_id}/documents/idDoc")
    assert response.status_code == 200 and response.content.startswith(b"%PDF")
    assert client.get(f"/api/employees/{employee_id}/documents/passwd").status_code == 404


def test_unknown_employee_is_404(client):
    assert client.get("/api/employees/AE-000000").status_code == 404
    assert client.post("/api/employees/AE-000000/approve").status_code == 404


def test_clear_keeps_pending_records_by_default(client, candidate_form, candidate_files):
    pending = _submit(client, candidate_form, candidate_files).json()["id"]
    rejected = _submit(client, candidate_form, candidate_files).json()["id"]
    client.post(f"/api/employees/{rejected}/reject")

    assert client.delete("/api/employees").json() == {"removed": 1}
    assert [e["id"] for e in client.get("/api/employees").json()] == [pending]
    assert client.delete("/api/employees?scope=all").json() == {"removed": 1}


def test_tasks_endpoint(client):
    body = client.get("/api/tasks").json()
    assert "metrics" in body and isinstance(body["tasks"], list)
    assert client.get("/api/tasks/task-missing").status_code == 404


def test_signature_is_optional(client, candidate_form, candidate_files):
    fields = {k: v for k, v in candidate_form.items() if k != "signature"}
    response = client.post("/api/employees", data=fields, files=candidate_files)
    assert response.status_code == 201 and response.json()["signatureFile"] is None
