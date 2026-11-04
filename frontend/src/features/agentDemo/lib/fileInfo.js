/** What the chat keeps of a sent file: its name and size for display, and the file itself so that it can be opened. */
export const fileInfo = (file) => ({ name: file.name, size: file.size, blob: file });

/** Opens the file in a new browser tab (nothing happens for a file that has no content to open). */
export function openFile(info) {
  if (!info?.blob) return;
  const url = URL.createObjectURL(info.blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Props that make a sent file open in a new tab when it is clicked (or activated with the keyboard). */
export const openProps = (file) => (file.blob ? {
  role: 'button', tabIndex: 0, title: 'Open the document', onClick: () => openFile(file),
  onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFile(file); } },
} : {});
