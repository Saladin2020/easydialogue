import { useCallback, useEffect, useRef, useState } from "react";
import { drawDialogue, type Ctx, type DrawResult } from "../../../src/shared/draw";
import { DialogueRunner, type ChoicesEvent, type LineEvent } from "../../../src/shared/runner";
import { DEFAULT_LAYOUT } from "../../../src/shared/ui";
import type { BoxStyle, DialogueDoc, Value } from "../../../src/shared/types";
import { backgroundUrl, portraitUrl } from "../api";
import { frameSet, loadFonts, loadImg } from "../frames";

interface Props {
  doc: DialogueDoc | null;
  style: BoxStyle;
  background: string | null;
  startNode: string;
  /** Bump to reload portrait images. */
  portraitsVersion: number;
  onState?: (s: { node: string | null; vars: Record<string, Value>; log: string[]; visited: Record<string, number> }) => void;
}

const S = 2;
const W = DEFAULT_LAYOUT.viewport.width;
const H = DEFAULT_LAYOUT.viewport.height;

export function PlayPreview({ doc, style, background, startNode, portraitsVersion, onState }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const st = useRef({
    runner: null as DialogueRunner | null,
    line: null as LineEvent | null,
    choices: null as ChoicesEvent | null,
    selected: 0,
    reveal: 1,
    clusters: 1,
    ended: false,
    bg: null as HTMLImageElement | null,
    portrait: null as HTMLImageElement | null,
    log: [] as string[],
    last: null as DrawResult | null,
    t0: 0,
  });
  const [ended, setEnded] = useState(false);
  const [fontsOk, setFontsOk] = useState(false);
  const [cps, setCps] = useState(DEFAULT_LAYOUT.typewriter.cps);

  useEffect(() => {
    void loadFonts().then(() => setFontsOk(true));
  }, []);

  useEffect(() => {
    st.current.bg = null;
    if (background) void loadImg(backgroundUrl(background)).then((i) => (st.current.bg = i));
  }, [background]);

  const report = useCallback(() => {
    const r = st.current.runner;
    onState?.({ node: r?.node ?? null, vars: { ...(r?.vars ?? {}) }, log: [...st.current.log], visited: { ...(r?.visited ?? {}) } });
  }, [onState]);

  const showLine = useCallback(
    async (ev: LineEvent) => {
      const s = st.current;
      const portrait = ev.portrait ? await loadImg(`${portraitUrl(ev.portrait, ev.emotion)}?v=${portraitsVersion}`) : null;
      s.line = ev;
      s.choices = null;
      s.reveal = 0;
      s.portrait = portrait;
      s.log.push(`${ev.name ? `${ev.name}: ` : ""}${ev.text}`);
      report();
    },
    [portraitsVersion, report],
  );

  const step = useCallback(() => {
    const s = st.current;
    if (!s.runner || s.ended) return;
    if (s.line && s.reveal < 1 && !s.choices) {
      s.reveal = 1;
      return;
    }
    if (s.choices) return;
    const ev = s.runner.next();
    if (ev.type === "end") {
      s.ended = true;
      s.log.push("— END —");
      setEnded(true);
      report();
      return;
    }
    if (ev.type === "choices") {
      s.choices = ev;
      s.selected = 0;
      report();
      return;
    }
    void showLine(ev);
  }, [report, showLine]);

  const choose = useCallback(
    (i: number) => {
      const s = st.current;
      if (!s.choices || !s.runner) return;
      const opt = s.choices.options[i];
      if (!opt) return;
      s.runner.choose(opt.index);
      s.log.push(`> ${opt.text}`);
      s.choices = null;
      s.reveal = 1;
      step(); // straight on to the next line
    },
    [step],
  );

  const restart = useCallback(() => {
    const s = st.current;
    s.line = null;
    s.choices = null;
    s.ended = false;
    s.log = [];
    setEnded(false);
    if (!doc) {
      s.runner = null;
      report();
      return;
    }
    s.runner = new DialogueRunner(doc, { onEvent: (n, a) => s.log.push(`@${[n, ...a].join(" ")}`) });
    try {
      s.runner.start(startNode && doc.nodes[startNode] ? startNode : undefined);
      step();
    } catch (e) {
      s.log.push(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
    report();
  }, [doc, startNode, step, report]);

  useEffect(() => {
    restart();
  }, [restart]);

  // render loop
  useEffect(() => {
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      const s = st.current;
      if (s.line && s.reveal < 1) s.reveal = Math.min(1, s.reveal + (dt * cps) / Math.max(1, s.clusters));
      const c = canvas.current;
      const g = c?.getContext("2d");
      if (c && g && fontsOk) {
        const f = frameSet(style);
        s.last = drawDialogue(g as unknown as Ctx, { background: s.bg, box: f.box, plate: f.plate, well: f.well, next: f.next, cursor: f.cursor, portrait: s.portrait }, {
          line: s.line,
          choices: s.choices,
          selected: s.selected,
          style,
          scale: S,
          reveal: s.reveal,
          bob: Math.floor(now / 330) % 2,
        });
        s.clusters = s.last.clusters || 1;
        if (s.ended) {
          g.fillStyle = "rgba(13,9,6,0.55)";
          g.fillRect(0, 0, W * S, H * S);
          g.font = `${14 * S}px "Kanit Medium", Kanit`;
          g.fillStyle = "#ffd27a";
          g.textAlign = "center";
          g.fillText("จบบทสนทนา · คลิกเพื่อเริ่มใหม่", (W / 2) * S, (H / 2) * S);
          g.textAlign = "left";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [style, fontsOk, cps]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = st.current;
    if (s.ended) return restart();
    const r = e.currentTarget.getBoundingClientRect();
    const gx = ((e.clientX - r.left) / r.width) * W;
    const gy = ((e.clientY - r.top) / r.height) * H;
    if (s.choices && s.last) {
      const i = s.last.choiceRects.findIndex((q) => gx >= q.x && gx < q.x + q.w && gy >= q.y && gy < q.y + q.h);
      if (i >= 0) choose(i);
      return;
    }
    step();
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = st.current;
    if (!s.choices || !s.last) return;
    const r = e.currentTarget.getBoundingClientRect();
    const gx = ((e.clientX - r.left) / r.width) * W;
    const gy = ((e.clientY - r.top) / r.height) * H;
    const i = s.last.choiceRects.findIndex((q) => gx >= q.x && gx < q.x + q.w && gy >= q.y && gy < q.y + q.h);
    if (i >= 0) s.selected = i;
  };

  const onKey = (e: React.KeyboardEvent) => {
    const s = st.current;
    if (s.choices) {
      const n = s.choices.options.length;
      if (e.key === "ArrowDown") s.selected = (s.selected + 1) % n;
      else if (e.key === "ArrowUp") s.selected = (s.selected + n - 1) % n;
      else if (e.key === "Enter" || e.key === " ") choose(s.selected);
      else if (/^[1-9]$/.test(e.key)) choose(Number(e.key) - 1);
      else return;
    } else if (e.key === "Enter" || e.key === " ") {
      if (s.ended) restart();
      else step();
    } else if (e.key === "r") restart();
    else return;
    e.preventDefault();
  };

  return (
    <div className="play">
      <canvas
        ref={canvas}
        className="play-canvas"
        width={W * S}
        height={H * S}
        tabIndex={0}
        onClick={onClick}
        onMouseMove={onMove}
        onKeyDown={onKey}
        aria-label="Dialogue preview — click or press Enter to continue"
      />
      <div className="play-bar">
        <button type="button" onClick={restart} title="Restart (R)">
          ↺ Restart
        </button>
        <button type="button" className="primary" onClick={() => (st.current.choices ? choose(st.current.selected) : st.current.ended ? restart() : step())}>
          {ended ? "Play again" : "Next ▸"}
        </button>
        <label className="speed">
          <span className="field-label">Typewriter</span>
          <input type="range" min={10} max={120} value={cps} onChange={(e) => setCps(Number(e.target.value))} />
          <span className="mono">{cps}/s</span>
        </label>
      </div>
    </div>
  );
}
