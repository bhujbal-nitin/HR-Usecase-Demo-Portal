import { useEffect, useState } from 'react';
import Icon from './Icon';

// The animated "what is happening right now" pictures. Each one draws the step's real data (its `payload`);
// nothing here changes the flow. Simulated steps get the same pictures, the stage header tags them Simulated.

const delay = (seconds) => ({ '--d': `${seconds}s` });
const primitive = (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value);
const show = (value) => (value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value));
const entriesOf = (object = {}) => Object.entries(object).filter(([, value]) => primitive(value));
const pretty = (key) => key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function Tick({ tone }) {
  return <span className={`ad-tick ${tone ?? ''}`}><Icon name={tone === 'warn' ? 'alert' : 'check'} size={11} /></span>;
}
const Dots = () => <span className="ad-dots"><i></i><i></i><i></i></span>;
const Arrow = ({ d = 0.5 }) => <span className="ad-v-ar rv" style={delay(d)}><Icon name="arrow" size={22} /></span>;

function Kvs({ rows }) {
  return (
    <div className="ad-v-kvs">
      {rows.filter(([, v]) => v !== undefined && v !== null).map(([k, v], i) => (
        <span key={k} className="ad-v-kv rv" style={delay(0.8 + i * 0.3)}><i>{k}</i>{show(v)}</span>
      ))}
    </div>
  );
}

function useElapsed(active) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, [active]);
  return seconds;
}

/** Nothing to draw yet (the step has just started and has no data). */
export function Working({ step }) {
  const seconds = useElapsed(true);
  return (
    <div className="ad-vz">
      <div className="ad-v-think"><span className="bob"><Icon name="sparkle" size={30} /></span><span>Working on it<Dots /></span></div>
      <div className="ad-v-kvs"><span className="ad-v-kv"><i>step</i>{step.title}</span><span className="ad-v-kv"><i>elapsed</i>{seconds}s</span></div>
    </div>
  );
}

export function Inbound({ step }) {
  const p = step.payload ?? {};
  if (p.text) {
    return (
      <div className="ad-vz">
        <div className="ad-v-bub rv">{p.text.body}<small>{p.from ?? 'Candidate'}</small></div><Arrow />
        <Kvs rows={[['channel', 'WhatsApp'], ['type', 'text'], ['thread', 'new']]} />
      </div>
    );
  }
  if (p.image || p.document) {
    const name = p.document?.filename ?? 'IMG_2041.jpg';
    return (
      <div className="ad-vz">
        <div className="ad-v-file rv"><Icon name={p.document ? 'file' : 'image'} size={28} /><div><b>{name}</b><small>{p.size_kb ? `${p.size_kb} KB` : ''} · {p.document?.mime_type ?? p.image?.mime_type}</small></div></div><Arrow />
        <Kvs rows={[['from', 'Candidate'], ['routed to', 'Document Agent'], ['status', 'queued for scan']]} />
      </div>
    );
  }
  const form = p.nfm_reply?.response_json;
  return <Record title={form ? 'Form submission' : step.title} icon="clipboard" rows={entriesOf(form ?? p)} stamp={form ? 'Received' : undefined} />;
}

export function Intent({ step }) {
  const p = step.payload ?? {};
  const win = Math.round((p.confidence ?? 0.95) * 100);
  const rest = 100 - win;
  const rows = [[p.intent ?? 'start_onboarding', win, true], ['other_intent', Math.round(rest * 0.65)], ['unknown', Math.max(0, rest - Math.round(rest * 0.65))]];
  return (
    <div className="ad-vz">
      <div className="ad-v-think rv"><span className="bob"><Icon name="sparkle" size={30} /></span><span>Reading the message<Dots /></span></div>
      <div className="ad-v-ibars">
        {rows.map(([label, pct, winner], i) => (
          <div key={label} className={`ad-v-ib rv${winner ? ' win' : ''}`} style={delay(0.7 + i * 0.35)}>
            <span>{label}</span><div className="ad-meter"><i style={{ '--w': `${pct}%`, ...delay(0.9 + i * 0.35) }}></i></div><em>{pct}%</em>
          </div>
        ))}
        {p.workflow && <div className="ad-v-note rv" style={delay(2.1)}><Icon name="check" size={14} /> Workflow selected: {p.workflow}</div>}
      </div>
    </div>
  );
}

const PLAN_ICONS = ['clipboard', 'file', 'shield', 'db', 'send'];
export function Plan({ step }) {
  const plan = step.payload?.plan ?? [];
  if (!plan.length) return <Record title={step.title} icon="sparkle" rows={entriesOf(step.payload)} />;
  return <Pipe items={plan.map((item, i) => ({ icon: PLAN_ICONS[i % PLAN_ICONS.length], label: pretty(item), sub: `step ${i + 1}` }))} />;
}

export function Pipe({ items }) {
  return (
    <div className="ad-vz ad-v-pipe">
      {items.map((item, i) => (
        <span key={item.label} className="ad-v-pipe-cell">
          {i > 0 && <span className="ad-v-link" style={delay(i * 0.6 + 0.1)}></span>}
          <div className="ad-v-step rv" style={delay(i * 0.6)}>
            <span className="ad-v-pi" style={delay(i * 0.6)}><Icon name={item.icon} size={22} /></span>
            <b>{item.label}</b><small>{item.sub}</small>
          </div>
        </span>
      ))}
    </div>
  );
}

export function Record({ title, icon = 'db', rows, stamp, tone }) {
  return (
    <div className="ad-vz">
      <div className="ad-v-rec rv">
        <div className="ad-v-rh"><Icon name={icon} size={16} /><b>{title}</b>{stamp && <span className={`ad-v-stamp rv ${tone ?? ''}`} style={delay(0.9 + rows.length * 0.25)}>{stamp}</span>}</div>
        {rows.slice(0, 7).map(([k, v], i) => (
          <div key={k} className="ad-v-rr rv" style={delay(0.5 + i * 0.25)}><span>{pretty(k)}</span><b>{show(v)}</b></div>
        ))}
      </div>
    </div>
  );
}

export function RecordViz({ step }) {
  const p = step.payload ?? {};
  const rows = entriesOf(p.response && typeof p.response === 'object' ? p.response : p);
  const stamp = p.response?.found ? 'Found' : step.status === 'done' ? 'Done' : undefined;
  return <Record title={step.title} icon="db" rows={rows.length ? rows : entriesOf(p)} stamp={stamp} />;
}

export function Sent({ step }) {
  const p = step.payload ?? {};
  return (
    <div className="ad-vz">
      <div className="ad-v-bub out rv">{step.title}<small>Sent just now · ✓✓</small></div><Arrow />
      <Kvs rows={[['channel', 'WhatsApp'], ['status', 'delivered'], ...entriesOf(p).slice(0, 2).map(([k, v]) => [k, v])]} />
    </div>
  );
}

const GOOD = new Set(['ok', 'valid', 'accepted', 'clean', 'match', 'plausible', 'true', 'pass']);
export function Checks({ step }) {
  const rows = entriesOf(step.payload).slice(0, 8);
  return (
    <div className="ad-vz">
      <div className="ad-v-checks">
        {rows.map(([k, v], i) => {
          const good = v === true || GOOD.has(String(v).toLowerCase().split(' ')[0]);
          const d = 0.6 + i * 0.32;
          return (
            <div key={k} className="ad-v-ck rv" style={delay(i * 0.12)}>
              <span className="ad-v-slot"><i className="ad-v-spin" style={delay(d)}></i><span className="rv" style={delay(d)}><Tick tone={good ? '' : 'warn'} /></span></span>
              <b>{pretty(k)}</b><em>{show(v)}</em>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Storage({ step }) {
  const p = step.payload ?? {};
  return (
    <Pipe items={[
      { icon: 'cloud', label: 'Download', sub: p.content_type ?? 'file' },
      { icon: 'shield', label: 'Virus scan', sub: p.antivirus ?? 'clean' },
      { icon: 'lock', label: 'Encrypt & store', sub: p.encryption ?? 'encrypted' },
    ]}
    />
  );
}

function ScanDoc({ highlight }) {
  return (
    <div className="ad-v-scan">
      <i className="ad-v-line"></i><b className="c1"></b><b className="c2"></b><b className="c3"></b><b className="c4"></b>
      <div className="ad-v-doc"><div className="dh"></div><div className="db"><div className="ph"></div><div className="ls"><i></i><i className={highlight ? 'h' : ''}></i><i></i><i className={highlight ? 'h h2' : ''}></i></div></div></div>
    </div>
  );
}

export function Classify({ step }) {
  const p = step.payload ?? {};
  const label = p.label ? pretty(p.label) : 'Document';
  const quality = p.quality ? Object.entries(p.quality).map(([k, v]) => `${pretty(k)}: ${v === true ? 'yes' : v}`) : [];
  return (
    <div className="ad-vz">
      <ScanDoc />
      <div className="ad-v-side">
        <div className="ad-v-tag rv" style={delay(2.6)}><Icon name="check" size={14} />{label}{p.confidence ? ` · ${Math.round(p.confidence * 100)}% sure` : ''}</div>
        <div className="ad-v-chips">{quality.slice(0, 3).map((q, i) => <span key={q} className="ad-v-chip rv" style={delay(3 + i * 0.3)}><Icon name="check" size={12} />{q}</span>)}</div>
      </div>
    </div>
  );
}

export function Ocr({ step }) {
  const p = step.payload ?? {};
  const conf = p.field_confidence ?? {};
  const fields = Object.entries(p).filter(([k, v]) => primitive(v) && !['field_confidence'].includes(k)).slice(0, 5);
  return (
    <div className="ad-vz">
      <ScanDoc highlight />
      <div className="ad-v-fields">
        {fields.map(([k, v], i) => (
          <div key={k} className="ad-v-f rv" style={delay(0.8 + i * 0.5)}><span>{pretty(k)}</span><b>{show(v)}</b><em>{conf[k] ? `${Math.round(conf[k] * 100)}%` : ''}</em></div>
        ))}
      </div>
    </div>
  );
}

export function Checksum({ step }) {
  const p = step.payload ?? {};
  const raw = (p.number ?? 'XXXX XXXX XXXX').replace(/\s/g, '').padEnd(12, 'X').slice(0, 12);
  const groups = [0, 4, 8].map((s) => raw.slice(s, s + 4).split(''));
  let index = 0;
  return (
    <div className="ad-vz">
      <div>
        <div className="ad-v-digits">
          {groups.map((group, g) => (
            <div key={g} className="ad-v-grp">
              {group.map((char) => { const i = index++; return <span key={i} className={`ad-v-cell${i === 11 ? ' chk' : ''}`} style={delay(0.5 + i * 0.13)}>{char === 'X' ? '•' : char}</span>; })}
            </div>
          ))}
        </div>
        <div className="ad-v-note rv" style={{ ...delay(2.4), color: 'var(--k-api)', marginTop: 8 }}><Icon name="key" size={14} />Last digit is a check digit, calculated from the other 11</div>
      </div>
      <div className="ad-v-side">
        <div className={`ad-v-tag rv${p.check_digit_valid === false ? ' warn' : ''}`} style={delay(2.4)}><Icon name={p.check_digit_valid === false ? 'alert' : 'check'} size={14} />{p.check_digit_valid === false ? 'Invalid number' : 'Valid number'}</div>
        <span className="ad-v-chip rv" style={delay(2.7)}>{p.algorithm ?? 'Verhoeff'} algorithm, no outside check needed</span>
      </div>
    </div>
  );
}

export function Compare({ step }) {
  const p = step.payload ?? {};
  let rows;
  let score;
  let threshold = p.threshold ?? 0.9;
  if (p.aadhaar_name) { rows = [['Name', p.aadhaar_name, p.pan_name, p.similarity >= threshold]]; score = p.similarity; }
  else {
    rows = [['Name', p.name?.form, p.name?.document, (p.name?.similarity ?? 1) >= threshold], ['Date of birth', p.dob?.form, p.dob?.document, p.dob?.match !== false]];
    score = p.name?.similarity ?? 1;
  }
  const warn = score < threshold;
  const labels = p.aadhaar_name ? ['Aadhaar', 'PAN card'] : ['Form', 'Document'];
  return (
    <div className="ad-vz">
      <div className="ad-v-cmp">
        <div className="ad-v-ch head"><span></span><span>{labels[0]}</span><span>{labels[1]}</span><span></span></div>
        {rows.map((r, i) => (
          <div key={r[0]} className="ad-v-ch rv" style={delay(0.5 + i * 0.6)}><span>{r[0]}</span><b>{show(r[1])}</b><b>{show(r[2])}</b><Tick tone={r[3] ? '' : 'warn'} /></div>
        ))}
        <div className="ad-v-sim rv" style={delay(0.7 + rows.length * 0.6)}>
          <div className={`ad-meter ${warn ? 'warn' : 'ok'}`}><i style={{ '--w': `${score * 100}%`, ...delay(0.7 + rows.length * 0.6) }}></i><u style={{ '--t': `${threshold * 100}%` }}></u></div>
          <span>Similarity <strong>{Number(score).toFixed(2)}</strong> · needs {Number(threshold).toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

const PROVIDER = { 'kyc.offline_verify()': ['Identity provider', 'idcard'], 'pan.verify()': ['Tax database', 'bank'], 'epfo.lookup()': ['EPFO', 'bank'], 'POST /api/employees': ['HR system', 'db'], 'servicenow.create_request()': ['ServiceNow', 'ticket'],
  'orangehrm.assign_leave()': ['OrangeHRM', 'db'], 'orangehrm.punch_out()': ['OrangeHRM', 'db'] };
export function External({ step }) {
  const [label, icon] = PROVIDER[step.name] ?? [step.title, 'cloud'];
  const p = step.payload ?? {};
  const r = p.response && typeof p.response === 'object' ? p.response : p;
  const status = r.status ?? r.number ?? r.id ?? (step.status === 'done' ? 'OK' : '…');
  const chips = (r.matched ?? Object.entries(r).filter(([k, v]) => primitive(v) && k !== 'status').slice(0, 3).map(([k, v]) => `${pretty(k)}: ${show(v)}`));
  const warn = /fail|error|invalid/i.test(String(status)) || step.status === 'failed';
  const waiting = step.status === 'running'; // the request is out: keep it travelling until the answer is back
  return (
    <div className="ad-vz ad-v-api">
      <div className="ad-v-box rv"><Icon name="sparkle" size={22} /><b>Agent</b><small>sends request</small></div>
      <div className="ad-v-wire"><i className={`ad-v-pk out${waiting ? ' loop' : ''}`}></i><i className={`ad-v-pk back${waiting ? ' loop' : ''}`}></i></div>
      <div className="ad-v-box srv rv" style={delay(0.2)}><Icon name={icon} size={22} /><b>{label}</b><small>{waiting ? 'working on it' : 'checks records'}</small></div>
      {waiting ? (
        <div className="ad-v-res"><span className="ad-v-big wait"><span className="ad-spinner"></span>WAITING FOR REPLY</span></div>
      ) : (
      <div className="ad-v-res rv" style={delay(2.5)}>
        <span className={`ad-v-big${warn ? ' warn' : ''}`}><Icon name={warn ? 'alert' : 'check'} size={18} />{String(status).toUpperCase()}</span>
        <div className="ad-v-chips">{chips.slice(0, 3).map((c) => <span key={c} className="ad-v-chip">{c}</span>)}</div>
      </div>
      )}
    </div>
  );
}

export function Range({ step }) {
  const p = step.payload ?? {};
  const [lo, hi] = p.plausible_range ?? [0, 1];
  const span = (hi - lo) * 2 || 1;
  const pos = (v) => `${Math.min(100, Math.max(0, ((v - lo + (hi - lo) / 2) / span) * 100))}%`;
  return (
    <div className="ad-vz">
      <div className="ad-v-ibars" style={{ maxWidth: 520 }}>
        <div className="ad-v-ib win rv"><span>Offered / month</span><div className="ad-meter ok"><i style={{ '--w': pos(p.offered_monthly_ctc ?? lo) }}></i></div><em>{show(p.offered_monthly_ctc)}</em></div>
        <div className="ad-v-ib win rv" style={delay(0.4)}><span>Previous / month</span><div className="ad-meter ok"><i style={{ '--w': pos(p.previous_monthly_gross ?? lo), ...delay(0.6) }}></i></div><em>{show(p.previous_monthly_gross)}</em></div>
        <div className="ad-v-note rv" style={delay(1.6)}><Icon name={p.result === 'plausible' ? 'check' : 'alert'} size={14} /> {show(lo)} – {show(hi)} is the plausible range · {show(p.result)}</div>
      </div>
    </div>
  );
}

export function Package({ step }) {
  const p = step.payload ?? {};
  const docs = Object.keys(p.documents ?? {});
  return (
    <Pipe items={[
      { icon: 'clipboard', label: 'Details', sub: `${p.fields ?? '—'} fields` },
      { icon: 'file', label: 'Documents', sub: docs.length ? `${docs.length} files` : 'attached' },
      { icon: 'cloud', label: 'Package', sub: 'ready to submit' },
    ]}
    />
  );
}

export function Gauge({ step }) {
  const p = step.payload ?? {};
  const risk = Math.min(0.49, p.risk_score ?? 0.04);
  const thr = p.auto_approve_below ?? 0.15;
  const point = (v, r) => { const a = Math.PI * (1 - v / 0.5); return `${(100 + r * Math.cos(a)).toFixed(1)},${(100 - r * Math.sin(a)).toFixed(1)}`; };
  const arc = (v0, v1, color) => <path d={`M${point(v0, 78)} A78,78 0 0,1 ${point(v1, 78)}`} fill="none" stroke={color} strokeWidth="14" />;
  const decision = String(p.decision ?? '').replace(/_/g, ' ').toLowerCase();
  return (
    <div className="ad-vz">
      <svg className="ad-v-gauge rv" viewBox="0 0 200 128" aria-hidden="true">
        {arc(0.001, thr, 'var(--ok)')}{arc(thr, 0.3, 'var(--warn)')}{arc(0.3, 0.499, '#d1342f')}
        <g className="ad-v-needle" style={{ '--a': `${(risk / 0.5) * 180 - 90}deg` }}><line x1="100" y1="100" x2="100" y2="34" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" /><circle cx="100" cy="100" r="7" fill="var(--ink)" /></g>
        <text x="100" y="124" textAnchor="middle" style={{ font: '700 15px var(--font-mono)', fill: 'var(--ink)' }}>{risk.toFixed(2)}</text>
      </svg>
      <div className="ad-v-side">
        <div className="ad-v-tag rv" style={delay(2.1)}><Icon name="check" size={14} />{decision ? decision.replace(/^./, (c) => c.toUpperCase()) : 'Decision made'}</div>
        <span className="ad-v-chip rv" style={delay(2.4)}>Policy: auto-approve below {thr.toFixed(2)}</span>
        {(p.failed_checks ?? []).length === 0 && <span className="ad-v-chip rv" style={delay(2.7)}>No failed checks</span>}
      </div>
    </div>
  );
}

const INITIALS = ['RM', 'AK', 'SP', 'NJ', 'VT', 'LG', 'MD', 'PS', 'TB', 'KR', 'DA', 'HN', 'JC', 'OW'];
export function Buddy({ step }) {
  const p = step.payload ?? {};
  return (
    <div className="ad-vz">
      <div className="ad-v-buddy rv">{INITIALS.map((x, i) => <span key={x} className={`ad-v-av${i === 0 ? ' me' : ''}`} style={{ '--i': i }}>{x}</span>)}</div>
      <div className="ad-v-side">
        <div className="ad-v-tag rv" style={delay(2.4)}><Icon name="users" size={14} />{p.picked ?? 'Buddy matched'}</div>
        <div className="ad-v-chips">{(p.reasons ?? []).slice(0, 3).map((x, i) => <span key={x} className="ad-v-chip rv" style={delay(2.7 + i * 0.3)}>{x}</span>)}</div>
      </div>
    </div>
  );
}

/** Real AutomationEdge workflow / pipeline step: waits visibly while it runs, then shows what it returned. */
export function Workflow({ step }) {
  const seconds = useElapsed(step.status === 'running');
  const p = step.payload ?? {};
  const run = p.automationEdge?.[0] ?? (p.workflow ? { workflowName: p.workflow, status: p.status, message: p.message } : null);

  if (step.status === 'running' || step.status === 'queued') {
    return (
      <div className="ad-vz ad-v-api">
        <div className="ad-v-box"><Icon name="sparkle" size={22} /><b>Orchestrator</b><small>dispatched the step</small></div>
        <div className="ad-v-wire"><i className="ad-v-pk out loop"></i></div>
        <div className="ad-v-box srv"><Icon name="bolt" size={22} /><b>{run?.workflowName ?? step.title}</b><small>waiting to complete</small></div>
        <div className="ad-v-res"><span className="ad-v-big wait"><span className="ad-spinner"></span>RUNNING · {seconds}s</span><div className="ad-v-chips"><span className="ad-v-chip">Next step starts when this one succeeds</span></div></div>
      </div>
    );
  }

  const failed = step.status === 'failed';
  const skipped = step.status === 'skipped';
  const extra = entriesOf(p).filter(([k]) => !['status', 'message'].includes(k));
  const rows = [
    ...(run ? [['Workflow', run.workflowName], ['Request', run.requestId ? `#${run.requestId}` : '—'], ['Status', run.status], ['Agent', run.agent]] : []),
    ...extra.slice(0, 3),
    ['Result', run?.message ?? p.message],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '');
  return <Record title={step.title} icon="bolt" rows={rows} stamp={skipped ? 'Skipped' : failed ? 'Failed' : 'Complete'} tone={failed || skipped ? 'warn' : ''} />;
}
