import { graphemes, wrapText, type ChoicesEvent, type LineEvent } from "./runner.js";
import { DEFAULT_LAYOUT, STYLE_COLORS, type UiLayout } from "./ui.js";
import type { BoxStyle } from "./types.js";

/**
 * Draw one dialogue moment on a 2D canvas context. Shared by the CLI/MCP PNG previews
 * (@napi-rs/canvas, Skia + HarfBuzz) and the web editor's live preview (browser canvas),
 * so both look identical to the PixiJS and Godot runtimes.
 */

/** Anything drawImage accepts with width/height (HTMLImageElement, canvas, Skia Image). */
export interface Drawable {
  width: number;
  height: number;
}

/** The subset of CanvasRenderingContext2D we use (works for browser canvas and @napi-rs/canvas). */
export interface Ctx {
  imageSmoothingEnabled: boolean;
  font: string;
  fillStyle: unknown;
  textAlign: string;
  textBaseline: string;
  drawImage(img: never, sx: number, sy: number, sw?: number, sh?: number, dx?: number, dy?: number, dw?: number, dh?: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void;
  measureText(t: string): { width: number };
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(o: number, c: string): void };
}

export interface DrawAssets {
  background?: Drawable | null;
  box: Drawable;
  plate: Drawable;
  well: Drawable;
  next: Drawable;
  cursor: Drawable;
  /** Portrait for the current line (already resolved for emotion). */
  portrait?: Drawable | null;
}

export interface DrawOptions {
  line?: LineEvent | null;
  choices?: ChoicesEvent | null;
  selected?: number;
  style?: BoxStyle;
  scale: number;
  layout?: UiLayout;
  reveal?: number;
  /** Bob offset for the "next" arrow (0/1) when animating. */
  bob?: number;
  caption?: string;
  margins?: { box: number; plate: number; well: number };
}

export interface DrawResult {
  /** Choice rows in game pixels (for hit-testing clicks). */
  choiceRects: { x: number; y: number; w: number; h: number }[];
  /** Grapheme clusters in the wrapped line (typewriter length). */
  clusters: number;
}

const di = (g: Ctx, img: Drawable, ...a: number[]) => (g.drawImage as (...args: unknown[]) => void)(img, ...a);

export function drawNine(g: Ctx, src: Drawable, m: number, x: number, y: number, w: number, h: number, S: number) {
  const sw = src.width;
  const sh = src.height;
  const M = m * S;
  const cols = [
    [0, m, x, M],
    [m, sw - 2 * m, x + M, w - 2 * M],
    [sw - m, m, x + w - M, M],
  ] as const;
  const rows = [
    [0, m, y, M],
    [m, sh - 2 * m, y + M, h - 2 * M],
    [sh - m, m, y + h - M, M],
  ] as const;
  for (const [sx, sW, dx, dW] of cols) for (const [sy, sH, dy, dH] of rows) if (dW > 0 && dH > 0) di(g, src, sx, sy, sW, sH, dx, dy, dW, dH);
}

export function drawDialogue(g: Ctx, A: DrawAssets, opts: DrawOptions): DrawResult {
  const L = opts.layout ?? DEFAULT_LAYOUT;
  const S = opts.scale;
  const style = opts.style ?? "teak";
  const C = STYLE_COLORS[style];
  const M = opts.margins ?? { box: 8, plate: 5, well: 4 };
  const W = L.viewport.width * S;
  const H = L.viewport.height * S;
  g.imageSmoothingEnabled = false;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  const out: DrawResult = { choiceRects: [], clusters: 0 };

  if (A.background) {
    const bg = A.background;
    const k = Math.max(W / bg.width, H / bg.height);
    di(g, bg, (W - bg.width * k) / 2, H - bg.height * k, bg.width * k, bg.height * k);
  } else {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#2a2140");
    grad.addColorStop(0.6, "#4a3550");
    grad.addColorStop(1, "#1e150e");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }

  const textShadow = (txt: string, x: number, y: number, color: string) => {
    if (C.shadow) {
      g.fillStyle = C.shadow;
      g.fillText(txt, x + S * 0.67, y + S * 0.67);
    }
    g.fillStyle = color;
    g.fillText(txt, x, y);
  };

  const line = opts.line;
  const b = L.box;
  if (line) {
    drawNine(g, A.box, M.box, b.x * S, b.y * S, b.w * S, b.h * S, S);
    const hasPortrait = !!line.portrait;
    const right = line.side === "right";
    const ps = L.portrait.size;
    const pad = L.portrait.pad;
    let textX = b.x + L.text.padX;
    let textW = b.w - L.text.padX * 2;
    if (hasPortrait) {
      const px = right ? b.x + b.w - pad - ps : b.x + pad;
      const py = b.y + (b.h - ps) / 2;
      drawNine(g, A.well, M.well, (px - 1) * S, (py - 1) * S, (ps + 2) * S, (ps + 2) * S, S);
      if (A.portrait) di(g, A.portrait, px * S, py * S, ps * S, ps * S);
      else {
        g.font = `${24 * S}px "Kanit Medium", Kanit, sans-serif`;
        g.textAlign = "center";
        textShadow(graphemes(line.name)[0] ?? "?", (px + ps / 2) * S, (py + ps / 2 + 9) * S, C.name);
        g.textAlign = "left";
      }
      if (!right) textX = px + ps + pad + 3;
      textW = b.w - (ps + pad * 2 + 3) - L.text.padX;
    }
    if (line.name) {
      g.font = `${L.plate.fontSize * S}px "Kanit Medium", Kanit, sans-serif`;
      const nw = g.measureText(line.name).width / S;
      const pw = Math.ceil(nw + L.plate.padX * 2);
      const px = right && hasPortrait ? b.x + b.w - (ps + pad * 2 + 3) - pw + 4 : textX - 4;
      const py = b.y + L.plate.offsetY;
      drawNine(g, A.plate, M.plate, px * S, py * S, pw * S, L.plate.h * S, S);
      g.fillStyle = C.plateText;
      g.fillText(line.name, (px + L.plate.padX) * S, (py + L.plate.h - 5.5) * S);
      if (line.color) {
        g.fillStyle = line.color;
        g.fillRect((px + 3) * S, (py + L.plate.h - 4) * S, (pw - 6) * S, S);
      }
    }
    g.font = `${L.text.fontSize * S}px Kanit, sans-serif`;
    const lines = wrapText(line.text, textW * S, (s) => g.measureText(s).width, "th").slice(0, L.text.maxLines);
    const total = graphemes(lines.join("")).length;
    out.clusters = total;
    let budget = Math.round(total * Math.max(0, Math.min(1, opts.reveal ?? 1)));
    const ty = b.y + L.text.padY + (line.name ? 4 : 0);
    lines.forEach((ln, i) => {
      const gs = graphemes(ln);
      const shown = gs.slice(0, Math.max(0, budget)).join("");
      budget -= gs.length;
      if (shown) textShadow(shown, textX * S, (ty + L.text.fontSize + i * L.text.lineHeight) * S, C.text);
    });
    if ((opts.reveal ?? 1) >= 1 && !opts.choices) {
      const nx = hasPortrait && right ? b.x + b.w - (ps + pad * 2 + 3) - 10 : b.x + b.w - 16;
      di(g, A.next, nx * S, (b.y + b.h - 12 + (opts.bob ?? 0)) * S, 7 * S, 5 * S);
    }
  }

  const ch = opts.choices;
  if (ch) {
    const L2 = L.choices;
    g.font = `${L2.fontSize * S}px Kanit, sans-serif`;
    const widest = Math.max(...ch.options.map((o) => g.measureText(o.text).width / S));
    const w = Math.ceil(Math.max(L2.minW, widest + L2.padX + 14));
    const h = L2.padY * 2 + ch.options.length * L2.rowH;
    const x = b.x + b.w - w;
    const y = (line ? b.y + L.plate.offsetY : b.y + b.h) - L2.gap - h;
    drawNine(g, A.box, M.box, x * S, y * S, w * S, h * S, S);
    const sel = opts.selected ?? 0;
    ch.options.forEach((o, i) => {
      const ry = y + L2.padY + i * L2.rowH;
      out.choiceRects.push({ x, y: ry, w, h: L2.rowH });
      if (i === sel) {
        g.fillStyle = `${C.accent}29`;
        g.fillRect((x + 6) * S, (ry + 1) * S, (w - 12) * S, (L2.rowH - 2) * S);
        di(g, A.cursor, (x + 9) * S, (ry + 5) * S, 6 * S, 7 * S);
      }
      textShadow(o.text, (x + L2.padX) * S, (ry + L2.fontSize + 2.5) * S, i === sel ? C.choiceHi : C.choice);
    });
  }

  if (opts.caption) {
    g.font = `${9 * S}px "Kanit Medium", Kanit, sans-serif`;
    const cw = g.measureText(opts.caption).width;
    g.fillStyle = "rgba(13,9,6,0.72)";
    g.fillRect(6 * S, 6 * S, cw + 10 * S, 15 * S);
    g.fillStyle = "#ffd27a";
    g.fillText(opts.caption, 11 * S, 17 * S);
  }
  return out;
}
