import { SAMPLE_PEOPLE, documentsOf, formDetailsText } from './samplePeople';
import { DownloadButton, SampleHero, saveBlob, textBlob } from './downloads';

function PersonCard({ person }) {
  return (
    <div className="agent-catalog-card sample-person-card">
      <h3 className="agent-card-title">{person.name}</h3>
      <p className="sample-person-summary">{person.summary}</p>
      <div className="sample-downloads">
        {documentsOf(person).map((doc) => <DownloadButton key={doc.key} icon={doc.icon} title={doc.title} href={doc.href} filename={doc.filename} />)}
        {/* The text is made when clicked, so its joining date is always ahead of today. */}
        <DownloadButton icon="fa-file-lines" title="Form details (text)" onClick={() => saveBlob(textBlob(formDetailsText(person)), `Form_Details_${person.file}.txt`)} />
      </div>
    </div>
  );
}

/** Sample files for the Onboarding Manual · Live demo: three people, each with an Aadhaar card, a PAN card, a salary slip and the joining form details to copy. */
export default function OnboardingSamplesPage() {
  return (
    <section className="view-section active">
      <SampleHero title="Onboarding sample files">
        Pick a person, download the three documents to attach and the text file to copy the joining form details from.
      </SampleHero>
      <div className="agent-catalog-grid">
        {SAMPLE_PEOPLE.map((person) => <PersonCard key={person.id} person={person} />)}
      </div>
    </section>
  );
}
