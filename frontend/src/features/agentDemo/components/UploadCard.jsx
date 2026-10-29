import { useRef, useState } from 'react';
import { formatFileSize } from '../../../utils/format';

/**
 * "Upload your document" card inside the chat.
 * Manual mode: `onPick` is set while the agent is waiting for this document (click or drop a file).
 * Auto-play / simulated: no `onPick`; the card just shows the request and then the file the demo "sent".
 */
export default function UploadCard({ upload, onPick }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const { label, hint, file, error } = upload;
  const interactive = Boolean(onPick) && !file;

  const choose = (picked) => picked && onPick(picked);

  return (
    <div className="ad-flow ad-upload">
      <h5><i className="fa-solid fa-file-arrow-up"></i> Upload your {label}</h5>
      <p>{hint ?? 'PDF or Word, up to 10 MB.'}</p>
      {file ? (
        <div className="ad-upload-done">
          <i className="fa-solid fa-circle-check"></i>
          <div><b>{file.name}</b>{file.size ? <span> · {formatFileSize(file.size)}</span> : null}</div>
        </div>
      ) : (
        <div
          className={`ad-drop${over ? ' over' : ''}${interactive ? ' live' : ''}`}
          onDragOver={interactive ? (e) => { e.preventDefault(); setOver(true); } : undefined}
          onDragLeave={interactive ? () => setOver(false) : undefined}
          onDrop={interactive ? (e) => { e.preventDefault(); setOver(false); choose(e.dataTransfer.files[0]); } : undefined}
        >
          <i className="fa-solid fa-cloud-arrow-up"></i>
          <span>{interactive ? 'Drag a file here, or' : 'Waiting for the document…'}</span>
          {interactive && (
            <>
              <button type="button" className="ad-go" onClick={() => input.current?.click()}>Choose file</button>
              <input ref={input} type="file" hidden accept=".pdf,.doc,.docx" onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; choose(f); }} />
            </>
          )}
        </div>
      )}
      {error && <div className="ad-err" role="alert">{error}</div>}
    </div>
  );
}
