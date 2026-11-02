HR documents for the "HR Policy & Document" agent
==================================================

Policies/   the policy PDFs. "Policy search" in the chat finds them by NAME (the file name without .pdf) and
            the employee downloads the one they choose. Drop a new PDF in, and it is found at once.

The two letter templates (below) sit next to that folder.

(Payroll & Salary needs no file here: the payslip, the CTC statement and Form 16 are PDFs the portal draws itself.)

Keep the two letter TEMPLATES here, as Word (.docx) files with exactly these names
(upper or lower case does not matter):

  Address_Proof_bonafide_letter.docx        the address proof (bonafide) letter
  Salary_Account_Opening_Template.docx      the bank account opening letter

When an employee asks for a letter, the backend makes a COPY of the template with the
employee's details filled in and gives that copy as a download. The template itself is
never changed. The folder is read when a letter is asked for, so there is no need to
restart the backend. Close the files in Word before the first run (Word locks them).

Fields
------
Write a field between double angle brackets, for example <<First Name>>. Case and extra
spaces do not matter. These fields are filled:

  <<Employee Name>>, <<Full Name>>   the employee's full name
  <<First Name>>, <<Last Name>>      the name split in two (a middle name goes with the first name)
  <<Designation>>                    the job title
  <<Function>>                       the department
  <<Employee Code>>, <<Ref No>>      "AE" + the employee ID shown in OrangeHRM (e.g. AE373242)
  <<Date>>, <<Today's date>>         today, as 30-10-2026
  <<Joining Date>>                   the joining date, as 01-04-2026

A field with any other name stops the letter with a clear message (a half-filled letter is
never given out), and so does a template that has no field at all.

The words "His employee code" are made neutral ("The employee code"): the portal does not
store gender. The text that is not a field (company address, footer, images) is left as it is.

Address_Proof_bonafide_letter_backup.docx is a copy of the file as it was before the sample
values (name, date, designation, employee code) were turned into fields.
