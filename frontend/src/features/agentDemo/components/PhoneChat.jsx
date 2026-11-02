import { useEffect, useRef, useState } from 'react';
import { FORM_FIELDS } from '../engine/phases/intake.jsx';
import { formatFileSize } from '../../../utils/format';
import ChatForm from './ChatForm';
import ManualForm from './ManualForm';
import ResignationForm from './ResignationForm';
import ReadOnlyWidget from './ReadOnlyWidget';
import UploadCard from './UploadCard';

function JoiningForm({ form }) {
  const entries = Object.keys(form.values);
  const last = entries[entries.length - 1];
  return (
    <div className="ad-flow">
      <h5>Joining details</h5>
      <p>Enter the name exactly as it appears on your Aadhaar.</p>
      {FORM_FIELDS.map(([id, label]) => (
        <div key={id}>
          <label>{label}</label>
          <div className={`ad-input${form.values[id] ? ' filled' : ''}${!form.submitted && id === last ? ' typing' : ''}`}>{form.values[id] ?? ''}</div>
        </div>
      ))}
      <div className="ad-flow-row">
        <span className={`ad-go${form.submitted ? ' done' : ''}`}>{form.submitted ? '✓ Submitted' : 'Submit'}</span>
      </div>
    </div>
  );
}

function hintFor(state) {
  const waiting = state.awaiting?.kind;
  if (waiting === 'text') return state.manual ? 'Your turn: type a message, or tap a suggestion.' : '';
  if (waiting === 'form') return 'Fill in the form above and tap Submit.';
  if (waiting === 'attach') return `Use “Choose file” above (or the paperclip) to attach your ${state.awaiting.label}.`;
  if (state.error) return state.busy ? 'A step failed. Choose Rerun or Stop on the right screen.' : 'The run stopped. See the message on the right.';
  if (state.busy) return state.stage === 'review' ? 'Waiting for approval on the Approvals page.' : 'The agents are working. Watch the right screen.';
  if (state.stage === 'idle') return 'Press “Auto-fill demo” to start.';
  return 'Journey complete. Restart to run it again.';
}

function FileBubble({ file }) {
  return (
    <div className="ad-file">
      <i className="fa-solid fa-file-pdf"></i>
      <div><b>{file.name}</b><span>{formatFileSize(file.size)}</span></div>
    </div>
  );
}

/** Screen 1: what the candidate sees, as a WhatsApp-style chat. In manual mode the composer is live. */
export default function PhoneChat({ state, title = 'HR Assistant', initial = 'H', onRespond }) {
  const endRef = useRef(null);
  const fileInput = useRef(null);
  const [draft, setDraft] = useState('');
  const awaiting = state.awaiting;
  const canType = state.manual && awaiting?.kind === 'text';
  const canAttach = state.manual && awaiting?.kind === 'attach';

  useEffect(() => {
    const box = endRef.current?.parentElement;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  }, [state.chat.length, state.typing, state.chat.at(-1)?.form?.submitted, awaiting?.kind]);

  const send = (text) => {
    const value = text.trim();
    if (!value || !canType) return;
    setDraft('');
    onRespond({ text: value });
  };

  const renderBody = (m) => {
    switch (m.kind) {
      case 'form': return <JoiningForm form={m.form} />;
      case 'manualForm': return <ManualForm form={m.form} active={awaiting?.kind === 'form'} onSubmit={(values) => onRespond({ values })} />;
      case 'resignationForm': return <ResignationForm form={m.form} active={awaiting?.kind === 'form'} onSubmit={(values) => onRespond({ values })} />;
      case 'chatForm': return <ChatForm form={m.form} active={awaiting?.kind === 'form'} onSubmit={(values) => onRespond({ values })} />;
      case 'file': return <FileBubble file={m.file} />;
      case 'upload': {
        const waiting = state.manual && awaiting?.kind === 'attach' && awaiting.docKey === m.upload.docKey;
        return <UploadCard upload={m.upload} onPick={waiting ? (file) => onRespond({ file }) : undefined} />;
      }
      case 'widget': return <ReadOnlyWidget widget={m.widget} onAction={state.manual && canType ? (action) => onRespond({ action }) : undefined} />;
      default: return m.body;
    }
  };

  return (
    <div className="ad-phone">
      <div className="ad-wa-head">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        <div className="ad-avatar">{initial}</div>
        <div className="ad-wa-title">
          <b>{title} <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#25d366" /><path d="M7 12.5l3.3 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></b>
          <small>{state.typing ? 'typing…' : 'Business account'}</small>
        </div>
      </div>

      <div className="ad-chat" aria-live="polite">
        <div className="ad-chip-date">Today</div>
        {state.chat.map((m) => (
          m.side === 'sys' ? (
            <div key={m.id} className="ad-sys">{m.body}</div>
          ) : (
            <div key={m.id} className={`ad-msg ${m.side}${m.wide ? ' wide' : ''}`}>
              <div className="ad-bubble">
                {renderBody(m)}
                <span className="ad-meta">{m.time}{m.side === 'out' && <span className="ad-ticks"> ✓✓</span>}</span>
              </div>
            </div>
          )
        ))}
        {state.typing && <div className="ad-msg in typing"><div className="ad-bubble"><i></i><i></i><i></i></div></div>}
        <div ref={endRef}></div>
      </div>

      <div className="ad-bar">
        {canType && awaiting.suggestions?.length > 0 && (
          <div className="ad-suggest" aria-label="Suggestions">
            {awaiting.suggestions.map((text) => <button key={text} type="button" onClick={() => send(text)}>{text}</button>)}
          </div>
        )}
        {!state.manual && state.chips && (
          <div className="ad-suggest" aria-label="Suggestions">
            {state.chips.list.map((text) => <button key={text} type="button" className={text === state.chips.picked ? 'picked' : undefined} disabled>{text}</button>)}
          </div>
        )}
        <div className="ad-hint">{hintFor(state)}</div>
        <form className="ad-compose" onSubmit={(event) => { event.preventDefault(); send(draft); }}>
          <button type="button" className={`ad-round${canAttach ? ' pulse' : ''}`} disabled={!canAttach} onClick={() => fileInput.current?.click()} aria-label="Attach a document">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4L15 7.5" /></svg>
          </button>
          <input ref={fileInput} type="file" hidden accept={awaiting?.accept ?? '.pdf,.doc,.docx'} onChange={(event) => { const file = event.target.files[0]; event.target.value = ''; if (file) onRespond({ file }); }} />
          {state.manual ? (
            <input className="ad-compose-input ad-compose-real" type="text" value={draft} disabled={!canType} placeholder={canType ? 'Type a message' : 'Waiting…'} onChange={(event) => setDraft(event.target.value)} aria-label="Message" />
          ) : (
            <div className="ad-compose-input" aria-hidden="true">{state.draft || <span>Type a message</span>}</div>
          )}
          <button type="submit" className="ad-round send" disabled={state.manual && !canType} aria-label="Send">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 20.5l18-8.5L3 3.5v6.6l11 1.9-11 1.9z" /></svg>
          </button>
        </form>
      </div>
    </div>
  );
}
