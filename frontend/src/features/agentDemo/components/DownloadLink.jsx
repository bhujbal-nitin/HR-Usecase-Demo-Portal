/**
 * The "download this file" attachment shown in the chat (a payslip, a letter, a policy): an icon, "Download" and the file name, in the
 * same look as the answer cards. It is a real link, so the browser saves the file.
 */
export default function DownloadLink({ href, filename, icon = 'fa-file-arrow-down' }) {
  return (
    <a className="ad-download" href={href} download={filename} target="_blank" rel="noreferrer">
      <span className="ad-download-icon"><i className={`fa-solid ${icon}`}></i></span>
      <span className="ad-download-text"><b>Download</b><small>{filename}</small></span>
    </a>
  );
}
