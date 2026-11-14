import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage, type Canvas, type Image } from "@napi-rs/canvas";
import { drawDialogue, type Ctx } from "../shared/draw.js";
import { FRAME_FILES, type Pixels } from "../shared/frames.js";
import type { ChoicesEvent, LineEvent } from "../shared/runner.js";
import { DEFAULT_LAYOUT, type UiLayout } from "../shared/ui.js";
import type { BoxStyle } from "../shared/types.js";
import { registerFonts } from "./assets.js";

/**
 * PNG preview of a dialogue moment (Skia + Kanit with HarfBuzz shaping) at an integer pixel scale.
 * Pixel art is scaled nearest-neighbour; text is drawn at full resolution, like the runtimes do.
 */

export interface RenderOptions {
  line?: LineEvent | null;
  choices?: ChoicesEvent | null;
  selected?: number;
  style?: BoxStyle;
  scale?: number;
  layout?: UiLayout;
  background?: string | null;
  portraitsDir?: string;
  reveal?: number;
  caption?: string;
}

function pixelsCanvas(p: Pixels): Canvas {
  const c = createCanvas(p.width, p.height);
  const g = c.getContext("2d");
  const id = g.createImageData(p.width, p.height);
  id.data.set(p.data);
  g.putImageData(id, 0, 0);
  return c;
}

const imgCache = new Map<string, Promise<Image | null>>();
function loadCached(file: string): Promise<Image | null> {
  let p = imgCache.get(file);
  if (!p) {
    p = existsSync(file) ? readFile(file).then((b) => loadImage(b)).catch(() => null) : Promise.resolve(null);
    imgCache.set(file, p);
  }
  return p;
}

export function portraitFile(dir: string, portrait: string, emotion: string): string | null {
  for (const e of [emotion, "neutral"]) {
    const f = path.join(dir, portrait, `${e}.png`);
    if (existsSync(f)) return f;
  }
  return null;
}

export async function renderDialogue(opts: RenderOptions): Promise<Buffer> {
  registerFonts();
  const L = opts.layout ?? DEFAULT_LAYOUT;
  const S = Math.max(1, Math.min(6, Math.round(opts.scale ?? 3)));
  const style = opts.style ?? "teak";
  const canvas = createCanvas(L.viewport.width * S, L.viewport.height * S);
  const g = canvas.getContext("2d");
  const line = opts.line;
  const pf = line?.portrait && opts.portraitsDir ? portraitFile(opts.portraitsDir, line.portrait, line.emotion) : null;
  drawDialogue(
    g as unknown as Ctx,
    {
      background: opts.background ? await loadCached(opts.background) : null,
      box: pixelsCanvas(FRAME_FILES.box.make(style)),
      plate: pixelsCanvas(FRAME_FILES.plate.make(style)),
      well: pixelsCanvas(FRAME_FILES.well.make(style)),
      next: pixelsCanvas(FRAME_FILES.next.make(style)),
      cursor: pixelsCanvas(FRAME_FILES.cursor.make(style)),
      portrait: pf ? await loadCached(pf) : null,
    },
    { line, choices: opts.choices, selected: opts.selected, style, scale: S, layout: L, reveal: opts.reveal, caption: opts.caption },
  );
  return canvas.toBuffer("image/png");
}
