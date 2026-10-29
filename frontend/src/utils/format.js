const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const rupees = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function formatDateTime(value) {
  return value ? dateTime.format(new Date(value)) : '—';
}

export function formatDate(value) {
  if (!value) return '—';
  // Plain "YYYY-MM-DD" must be read as a local date, otherwise timezones shift it by a day.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return dateOnly.format(date);
}

export function formatInr(amount) {
  return `₹${rupees.format(amount)}`;
}

export function formatLpa(amount) {
  return `${(amount / 100000).toFixed(1)} LPA`;
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function timeLabel(date = new Date()) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
