import { money, sampleBills, totals } from './sampleBills';
import { billPdf } from './billPdf';
import { DownloadButton, SampleHero, saveBlob } from './downloads';

const BILL_ICON = { Travel: 'fa-route', Food: 'fa-utensils', Stay: 'fa-hotel', Mobile: 'fa-mobile-screen', Medical: 'fa-notes-medical', Others: 'fa-receipt' };

/** Sample bills for the Reimbursement Manual · Live demo: nine separate bills, each dated in the month before the day it is downloaded. */
export default function ReimbursementSamplesPage() {
  const bills = sampleBills();
  return (
    <section className="view-section active">
      <SampleHero title="Reimbursement sample bills">
        Nine bills to upload in the claim chat, in any combination. Each one is dated in the month before the day you download it.
      </SampleHero>
      <div className="agent-catalog-grid">
        {bills.map((bill) => (
          <div key={bill.file} className="agent-catalog-card sample-person-card">
            <h3 className="agent-card-title">{bill.vendor}</h3>
            <p className="sample-person-summary">{bill.kind} · INR {money(totals(bill.items, bill.gst).total)}</p>
            <div className="sample-downloads">
              {/* The bill is drawn when clicked, so its dates follow the day of the download. */}
              <DownloadButton icon={BILL_ICON[bill.kind]} title="Download bill (PDF)" onClick={() => saveBlob(billPdf(sampleBills().find((b) => b.file === bill.file)), bill.file)} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
