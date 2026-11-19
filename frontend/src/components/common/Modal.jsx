import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Overlay dialog using the Piraji `.modal-overlay` / `.modal-content` styles. Render it only while open.
 * It is portalled to <body>: the page-transition `transform` on `.view-section` would otherwise become the
 * containing block of this `position: fixed` overlay and stop it covering the sidebar and header.
 */
export default function Modal({ title, icon, onClose, children, footer, maxWidth = 650, titleColor }) {
  const dialogRef = useRef(null);

  // The latest onClose is kept in a ref so the effects below run once: a parent that passes a new onClose on every render (every keystroke in a field
  // inside the dialog) must not re-run them, as focusing the dialog again would take the focus out of the text box being typed in.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const onKeyDown = (event) => event.key === 'Escape' && onCloseRef.current();
    document.addEventListener('keydown', onKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return createPortal(
    <div className="modal-overlay active" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal-content"
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="modal-head">
          <h3 style={titleColor ? { color: titleColor } : undefined}>
            {icon && <i className={`fa-solid ${icon} text-accent`} aria-hidden="true"></i>} {title}
          </h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
