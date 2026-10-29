const TONES = {
  'Pending Review': { className: 'badge-pending', icon: 'fa-hourglass-half' },
  'Pending Approval': { className: 'badge-pending', icon: 'fa-hourglass-half' },
  'Processing Approval': { className: 'badge-verified', icon: 'fa-gear fa-spin' },
  Approved: { className: 'badge-approved', icon: 'fa-circle-check' },
  Rejected: { className: 'badge-rejected', icon: 'fa-circle-xmark' },
  Processing: { className: 'badge-verified', icon: 'fa-gear fa-spin' },
  Completed: { className: 'badge-approved', icon: 'fa-circle-check' },
  'Offboarding Failed': { className: 'badge-rejected', icon: 'fa-triangle-exclamation' },
  'Provisioning Failed': { className: 'badge-rejected', icon: 'fa-triangle-exclamation' },
};

export default function StatusBadge({ status }) {
  const tone = TONES[status] ?? { className: 'badge-draft', icon: 'fa-circle' };
  return (
    <span className={`badge ${tone.className}`}>
      <i className={`fa-solid ${tone.icon}`} aria-hidden="true"></i> {status}
    </span>
  );
}
