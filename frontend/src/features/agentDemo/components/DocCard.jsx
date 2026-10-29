/** Fictional sample ID-card thumbnails shown in the chat when the candidate "attaches" a document. */
export default function DocCard({ kind, D }) {
  const rows = {
    aadhaar: { cls: 'aad', head: ['Aadhaar', 'Identity card'], dl: [['Name', D.fullName], ['DOB', D.dobDisplay], ['Address', D.address.split(',').slice(-2).join(',').trim()]], num: `XXXX XXXX ${D.aadhaar.slice(-4)}` },
    pan: { cls: 'pan', head: ['Permanent Account Number', 'Income Tax'], dl: [['Name', D.panName], ['Father', D.fatherName], ['DOB', D.dobDisplay]], num: D.pan },
    payslips: { cls: 'pay', head: ['Salary slip', 'Latest month'], dl: [['Employee', D.fullName], ['Month', 'September']], num: `Gross ₹${D.previousMonthlyGross.toLocaleString('en-IN')} / month` },
  }[kind];

  return (
    <div className={`doc ${rows.cls}`}>
      <div className="dh"><span>{rows.head[0]}</span><span>{rows.head[1]}</span></div>
      <div className="db">
        <div className="ph"></div>
        <dl>{rows.dl.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </div>
      <div className="num">{rows.num}</div>
      <div className="smp">SAMPLE IMAGE · fictional data</div>
    </div>
  );
}
