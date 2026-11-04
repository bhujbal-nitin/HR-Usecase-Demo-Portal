/** Saves a Blob as a file with this name. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const textBlob = (text) => new Blob([text], { type: 'text/plain;charset=utf-8' });

/** A download button; `href` downloads a file that is kept in the portal, `onClick` makes the file when it is clicked. */
export function DownloadButton({ icon, title, href, filename, onClick }) {
  const content = (
    <>
      <i className={`fa-solid ${icon}`}></i>
      <span>{title}</span>
      <i className="fa-solid fa-download sample-download-icon"></i>
    </>
  );
  return href
    ? <a className="sample-download" href={href} download={filename}>{content}</a>
    : <button type="button" className="sample-download" onClick={onClick}>{content}</button>;
}

/** The banner at the top of a sample files page. */
export function SampleHero({ title, children }) {
  return (
    <div className="agent-hero-banner">
      <div className="agent-hero-title-group">
        <h1 className="agent-hero-title">{title}</h1>
        <p className="agent-hero-desc">{children}</p>
      </div>
    </div>
  );
}
