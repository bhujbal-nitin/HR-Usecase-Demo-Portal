import { useEffect, useMemo, useRef } from 'react';
import Icon from './Icon';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HOP_MS = 700;
const LOOP_GAP_MS = 250;

function pathFor(nodes, from, to) {
  const a = nodes[from];
  const b = nodes[to];
  if (Math.abs(b.x - a.x) < 5) { // two systems in the same column: swing out to the left and back in
    const edge = a.x - 19;
    return `M${edge},${a.y} C${edge - 34},${a.y} ${edge - 34},${b.y} ${edge},${b.y}`;
  }
  const sign = b.x - a.x >= 0 ? 1 : -1;
  const sx = a.x + sign * 19;
  const ex = b.x - sign * 19;
  const mx = (sx + ex) / 2;
  return `M${sx},${a.y} C${mx},${a.y} ${mx},${b.y} ${ex},${b.y}`;
}

/** Where the AutomationEdge tag sits: on the first link of the step, or above the agent when the workflow touches no system. */
function aeTag(nodes, hops, ae) {
  const width = Math.round(ae.label.length * 4.9 + 30);
  const [from, to] = hops[0] ?? [];
  const a = nodes[from];
  const b = nodes[to];
  const anchor = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 17 } : (nodes[ae.agent] && { x: nodes[ae.agent].x, y: nodes[ae.agent].y - 32 });
  if (!anchor) return null;
  return { width, x: Math.min(Math.max(anchor.x, width / 2 + 4), 756 - width / 2), y: Math.max(anchor.y, 12) };
}

const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Who talks to whom. The nodes of the current step glow, and a dot travels along each hop of the step.
 * `hops` is the list of [from, to] edges of the step on stage; `animateKey` changes whenever a new step starts. `ae` ({ label, agent }) is set when that step is an
 * AutomationEdge workflow: its links are drawn in AutomationEdge orange and tagged with the workflow's name.
 */
export default function SystemMap({ config, activeNodes, usedNodes, hops, ae = null, animateKey, flowing }) {
  const svg = useRef(null);
  const { nodes, edges } = config;
  const hopsRef = useRef(hops);
  const aeRef = useRef(ae);
  aeRef.current = ae;
  const flowingRef = useRef(flowing);
  flowingRef.current = flowing; // while a step is still running its flow keeps repeating; it stops after the current pass
  hopsRef.current = hops; // read when a new step starts; a new array each render must not restart the animation
  const edgeEls = useRef({});

  const staticMarkup = useMemo(() => edges.filter(([a, b]) => nodes[a] && nodes[b]), [edges, nodes]);

  // Travelling dots: one hop after another, then the edge stops pulsing.
  useEffect(() => {
    const stepHops = hopsRef.current;
    if (!stepHops?.length || !svg.current) return undefined;
    let cancelled = false;
    const created = [];
    let frame = 0;

    const pass = async () => {
      for (const [from, to] of stepHops) {
        if (cancelled || !nodes[from] || !nodes[to]) continue;
        await new Promise((resolve) => {
          const d = pathFor(nodes, from, to);
          const path = document.createElementNS(SVG_NS, 'path');
          path.setAttribute('d', d);
          path.setAttribute('fill', 'none');
          const dot = document.createElementNS(SVG_NS, 'circle');
          dot.setAttribute('r', '5.5');
          dot.setAttribute('class', aeRef.current ? 'ad-dotpulse ae' : 'ad-dotpulse');
          svg.current.append(path, dot);
          created.push(path, dot);
          const edge = edgeEls.current[edgeKey(from, to)];
          edge?.classList.add('live');
          if (aeRef.current) edge?.classList.add('ae');
          const length = path.getTotalLength();
          const start = performance.now();
          const tick = (now) => {
            const k = Math.min(1, (now - start) / HOP_MS);
            const eased = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
            const point = path.getPointAtLength(length * eased);
            dot.setAttribute('cx', point.x);
            dot.setAttribute('cy', point.y);
            if (k < 1 && !cancelled) frame = requestAnimationFrame(tick);
            else { path.remove(); dot.remove(); edge?.classList.remove('live', 'ae'); resolve(); }
          };
          frame = requestAnimationFrame(tick);
        });
      }
    };
    const run = async () => {
      do {
        await pass();
        if (cancelled || !flowingRef.current) return;
        await new Promise((resolve) => { setTimeout(resolve, LOOP_GAP_MS); });
      } while (!cancelled && flowingRef.current);
    };
    run();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      created.forEach((el) => el.remove());
      Object.values(edgeEls.current).forEach((el) => el?.classList.remove('live', 'ae'));
    };
  }, [animateKey, nodes]);

  const tag = ae ? aeTag(nodes, hops, ae) : null;

  return (
    <div className="ad-mapwrap">
      <svg ref={svg} className="ad-map" viewBox="0 0 760 240" role="img" aria-label="Map of the agents and the systems they call">
        <text className="ad-zone" x="20" y="14">Channel</text>
        <text className="ad-zone" x="150" y="14">Orchestration</text>
        <text className="ad-zone" x="330" y="14">Agents</text>
        <text className="ad-zone" x="650" y="11">Target Systems</text>
        {staticMarkup.map(([a, b]) => (
          <path key={`${a}-${b}`} ref={(el) => { edgeEls.current[edgeKey(a, b)] = el; }} className="ad-edge" d={pathFor(nodes, a, b)} />
        ))}
        {Object.entries(nodes).map(([id, node]) => {
          const system = node.t === 'system';
          const state = `${activeNodes.has(id) ? ' on' : ''}${usedNodes.has(id) ? ' used' : ''}`;
          return (
            <g key={id} className={`ad-node ${node.t}${state}`}>
              {system ? <rect className="halo" x={node.x - 17} y={node.y - 17} width="34" height="34" rx="9" /> : <circle className="halo" cx={node.x} cy={node.y} r="19" />}
              {system ? <rect className="shape" x={node.x - 17} y={node.y - 17} width="34" height="34" rx="9" /> : <circle className="shape" cx={node.x} cy={node.y} r="19" />}
              <g transform={`translate(${node.x - 9},${node.y - 9}) scale(.75)`}><Icon name={node.icon} size={24} /></g>
              {system ? (
                <text className="nl" x={node.x + 26} y={node.y + 4}>{node.label}</text>
              ) : (
                <>
                  <text className="nl" x={node.x} y={node.y + 35} textAnchor="middle">{node.label}</text>
                  {node.sub && <text className="ns" x={node.x} y={node.y + 46} textAnchor="middle">{node.sub}</text>}
                </>
              )}
            </g>
          );
        })}
        {tag && (
          <g className="ad-aetag" transform={`translate(${tag.x},${tag.y})`}>
            <rect x={-tag.width / 2} y="-9" width={tag.width} height="18" rx="9" />
            <g transform={`translate(${-tag.width / 2 + 5},-7) scale(.58)`}><Icon name="bolt" size={24} /></g>
            <text x={6} y="3.5" textAnchor="middle">{ae.label}</text>
          </g>
        )}
      </svg>
    </div>
  );
}
