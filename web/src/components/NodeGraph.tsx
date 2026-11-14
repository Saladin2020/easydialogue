import { useMemo } from "react";
import type { DialogueDoc } from "../../../src/shared/types";

interface Edge {
  from: string;
  to: string;
  label?: string;
  line: number;
}

interface Props {
  doc: DialogueDoc | null;
  edges: Edge[];
  current?: string | null;
  visited?: Record<string, number>;
  onPick: (line: number) => void;
}

const NW = 128;
const NH = 44;
const GX = 54;
const GY = 18;

function short(s: string, n = 16) {
  const g = Array.from(new Intl.Segmenter("th", { granularity: "grapheme" }).segment(s), (x) => x.segment);
  return g.length > n ? `${g.slice(0, n).join("")}…` : s;
}

/** Column per BFS depth from @start; unreachable nodes go in a last, dimmed column. */
export function NodeGraph({ doc, edges, current, visited, onPick }: Props) {
  const layout = useMemo(() => {
    if (!doc) return null;
    const ids = Object.keys(doc.nodes);
    const depth = new Map<string, number>([[doc.start, 0]]);
    const q = [doc.start];
    while (q.length) {
      const id = q.shift()!;
      for (const e of edges) if (e.from === id && e.to !== "END" && !depth.has(e.to)) {
        depth.set(e.to, depth.get(id)! + 1);
        q.push(e.to);
      }
    }
    const maxD = Math.max(0, ...depth.values());
    const cols: string[][] = [];
    for (const id of ids) {
      const d = depth.get(id) ?? maxD + 1;
      (cols[d] ??= []).push(id);
    }
    const hasEnd = edges.some((e) => e.to === "END");
    if (hasEnd) cols.push(["END"]);
    const pos = new Map<string, { x: number; y: number; col: number }>();
    const rows = Math.max(...cols.map((c) => c?.length ?? 0));
    cols.forEach((c, ci) =>
      (c ?? []).forEach((id, ri) => {
        const off = ((rows - c.length) * (NH + GY)) / 2;
        pos.set(id, { x: 12 + ci * (NW + GX), y: 12 + off + ri * (NH + GY), col: ci });
      }),
    );
    return { pos, w: 24 + cols.length * (NW + GX) - GX, h: 24 + rows * (NH + GY) - GY, depth };
  }, [doc, edges]);

  if (!doc || !layout) return <p className="empty">Fix the errors to see the graph.</p>;
  const { pos, w, h, depth } = layout;
  const seen = new Set<string>();
  return (
    <div className="graph-wrap">
      <svg className="graph" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="Node graph">
        <defs>
          <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#f4ae3d" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const key = `${e.from}>${e.to}>${e.label ?? ""}`;
          if (seen.has(key)) return null;
          seen.add(key);
          const back = b.col <= a.col;
          const x1 = a.x + NW;
          const y1 = a.y + NH / 2;
          const x2 = back ? b.x + NW / 2 : b.x;
          const y2 = back ? b.y + NH : b.y + NH / 2;
          const mx = (x1 + x2) / 2;
          const d = back ? `M${x1},${y1} C${x1 + 40},${y1 + 60} ${x2},${y2 + 50} ${x2},${y2}` : `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
          return (
            <g key={i} className={e.label ? "edge edge-choice" : "edge"}>
              <path d={d} markerEnd="url(#arr)" />
              {e.label && (
                <text x={mx} y={(y1 + y2) / 2 - 4} textAnchor="middle">
                  {short(e.label, 14)}
                </text>
              )}
            </g>
          );
        })}
        {[...pos.entries()].map(([id, p]) => {
          const n = id === "END" ? null : doc.nodes[id]!;
          const lines = n ? countLines(n.body) : 0;
          const cls = ["node", id === "END" ? "node-end" : "", id === doc.start ? "node-start" : "", id === current ? "node-current" : "", n && !depth.has(id) ? "node-orphan" : "", visited?.[id] ? "node-visited" : ""].join(" ");
          return (
            <g key={id} className={cls} transform={`translate(${p.x},${p.y})`} onClick={() => n && onPick(n.src)} role={n ? "button" : undefined}>
              <rect width={NW} height={NH} rx={3} />
              <text x={10} y={18} className="node-title">
                {id === doc.start ? "▶ " : ""}
                {id}
              </text>
              <text x={10} y={34} className="node-meta">
                {n ? `${lines} lines · L${n.src}` : "end of dialogue"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function countLines(body: DialogueDoc["nodes"][string]["body"]): number {
  let n = 0;
  for (const s of body) {
    if (s.t === "line") n++;
    else if (s.t === "choice") s.options.forEach((o) => (n += countLines(o.body)));
    else if (s.t === "if") s.branches.forEach((b) => (n += countLines(b.body)));
  }
  return n;
}
