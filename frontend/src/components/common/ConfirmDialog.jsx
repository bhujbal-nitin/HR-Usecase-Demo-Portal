import Modal from './Modal';

export default function ConfirmDialog({ title, icon, children, confirmLabel, confirmClass = 'btn-primary', busy, onConfirm, onCancel }) {
  return (
    <Modal
      title={title}
      icon={icon}
      onClose={busy ? () => {} : onCancel}
      maxWidth={520}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={`btn ${confirmClass}`} onClick={onConfirm} disabled={busy}>
            {busy && <i className="fa-solid fa-spinner fa-spin"></i>} {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>{children}</div>
    </Modal>
  );
}
