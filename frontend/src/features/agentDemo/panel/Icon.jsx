// Line icons for the system map and the stage (ported from the reference demo).
const ICONS = {
  chat: <path d="M21 12a8 8 0 01-11.8 7L4 20l1.1-4.2A8 8 0 1121 12z" />,
  sparkle: (<><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" /></>),
  db: (<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>),
  shield: (<><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z" /><path d="M8.5 12l2.5 2.5L15.5 10" /></>),
  idcard: (<><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M6 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M14 10h4M14 14h4" /></>),
  scan: (<><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3" /><path d="M4 12h16" /></>),
  lock: (<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>),
  cloud: <path d="M7 18a4.5 4.5 0 01-.5-9A6 6 0 0118 10a4 4 0 01-1 8z" />,
  mail: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>),
  laptop: (<><rect x="5" y="5" width="14" height="10" rx="1.5" /><path d="M2 19h20" /></>),
  users: (<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.5-3.3 3-5 6-5s5.5 1.7 6 5" /><circle cx="17.5" cy="9" r="2.5" /><path d="M17 14.5c2.2.2 3.6 1.7 4 4.5" /></>),
  send: (<><path d="M21 3L3 10.5l7 2.5 2.5 7z" /><path d="M10 13l11-10" /></>),
  user: (<><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-3.8 3.5-6 7-6s6.3 2.2 7 6" /></>),
  gauge: (<><path d="M4 16a8 8 0 1116 0" /><path d="M12 16l4-5" /></>),
  search: (<><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>),
  clipboard: (<><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9zM9 13l2 2 4-4" /></>),
  server: (<><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></>),
  bank: <path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  alert: (<><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17h.01" /></>),
  file: (<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></>),
  key: (<><circle cx="8" cy="15" r="3.5" /><path d="M10.5 12.5L20 3M16 7l3 3" /></>),
  ticket: <path d="M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 100 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 100-4z" />,
  eye: (<><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></>),
  compare: <path d="M7 4L3 8l4 4M3 8h11a4 4 0 014 4M17 20l4-4-4-4M21 16H10a4 4 0 01-4-4" />,
  phone: (<><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  image: (<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M4 18l5-5 4 4 3-3 4 4" /></>),
  bolt: <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
  windows: <path d="M3 5l8-1v7H3zM13 4l8-1v8h-8zM3 13h8v7l-8-1zM13 13h8v8l-8-1z" />,
  pen: <path d="M4 20l1-4L16 5a2.1 2.1 0 013 3L8 19z" />,
};

export default function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name] ?? ICONS.sparkle}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(ICONS);
