import { SAMPLE_CANDIDATES, sampleDetails, samplePersonal, sampleFiles } from '../agentDemo/lib/preOnboarding';
import { formatDate, formatInr } from '../../utils/format';
import { DownloadButton, SampleHero, saveBlob, textBlob } from './downloads';

const personalLines = (candidate) => {
  const p = samplePersonal(candidate);
  return [
    `Date of birth: ${formatDate(p.dateOfBirth)}`, `Gender: ${p.gender}`, `Marital status: ${p.maritalStatus}`, `Current address: ${p.currentAddress}`, `Permanent address: ${p.permanentAddress}`,
    `Emergency contact name: ${p.emergencyName}`, `Relationship: ${p.emergencyRelation}`, `Emergency contact phone: ${p.emergencyPhone}`,
  ];
};

/** The joining details as one "Field: value" line each, so they can be copied into the details form (the joining date is always ahead of today). */
function detailsText(candidate) {
  const d = sampleDetails('', candidate);
  return [
    `PRE-ONBOARDING DETAILS - ${d.fullName}`,
    'Copy each value into the matching box of the candidate details form (Manual · Live pre-onboarding demo).',
    '',
    `Full name: ${d.fullName}`,
    'E-mail address: (use your own: the offer letter is really e-mailed to it)',
    `Phone number: ${d.phone}`,
    `Job title offered: ${d.designation}`,
    `Department: ${d.department}`,
    `Reporting manager: ${d.manager}`,
    `Work location: ${d.location}`,
    `Yearly pay (CTC) in rupees: ${d.annualCtc}   (${formatInr(Number(d.annualCtc))})`,
    `Joining date: ${formatDate(d.joiningDate)}   (pick this date in the date box)`,
    '',
    'PERSONAL INFORMATION (step 4 of the demo)',
    ...personalLines(candidate),
    '',
    'DOCUMENTS TO SEND (download them from this page)',
    ...sampleFiles(candidate).map((file) => `${file.title}: ${file.filename}`),
    '',
  ].join('\r\n');
}

/** Sample files for the Pre-Onboarding Manual · Live demo: three candidates, each with all seven documents and the details to copy into the forms. */
export default function PreOnboardingSamplesPage() {
  return (
    <section className="view-section active">
      <SampleHero title="Pre-onboarding sample files">
        Three sample candidates, each with the seven documents the pre-onboarding asks for. Every document of a candidate carries that candidate’s name, so the names match. Pick one candidate, enter their details in the forms (the text file lists every value) and send their documents one by one in the chat. Do not mix documents of different candidates: the name check would stop it.
      </SampleHero>
      <div className="agent-catalog-grid">
        {SAMPLE_CANDIDATES.map((candidate) => (
          <div className="agent-catalog-card sample-person-card" key={candidate.file}>
            <h3 className="agent-card-title">{candidate.fullName}</h3>
            <p className="sample-person-summary">{candidate.location} · joins {candidate.department}</p>
            <div className="sample-downloads">
              {sampleFiles(candidate).map((file) => <DownloadButton key={file.key} icon={file.icon} title={file.title} href={file.href} filename={file.filename} />)}
              <DownloadButton icon="fa-file-lines" title="Candidate details (text)" onClick={() => saveBlob(textBlob(detailsText(candidate)), `Details_${candidate.file}.txt`)} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
