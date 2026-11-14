import { FRAME_FILES, type Pixels } from "../../src/shared/frames";
import type { BoxStyle } from "../../src/shared/types";
import kanitRegular from "../../assets/fonts/Kanit-Regular.ttf?url";
import kanitMedium from "../../assets/fonts/Kanit-Medium.ttf?url";

export function pixelsToCanvas(p: Pixels): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = p.width;
  c.height = p.height;
  const g = c.getContext("2d")!;
  const img = g.createImageData(p.width, p.height);
  img.data.set(p.data);
  g.putImageData(img, 0, 0);
  return c;
}

export type FrameSet = Record<keyof typeof FRAME_FILES, HTMLCanvasElement>;
const cache = new Map<BoxStyle, FrameSet>();

export function frameSet(style: BoxStyle): FrameSet {
  let s = cache.get(style);
  if (!s) {
    s = Object.fromEntries(Object.entries(FRAME_FILES).map(([k, def]) => [k, pixelsToCanvas(def.make(style))])) as FrameSet;
    cache.set(style, s);
  }
  return s;
}

let fontsReady: Promise<void> | null = null;
/** Kanit (OFL) from the repo, so the browser shapes Thai exactly like the exports. */
export function loadFonts(): Promise<void> {
  fontsReady ??= (async () => {
    for (const [family, url] of [["Kanit", kanitRegular], ["Kanit Medium", kanitMedium]] as const) {
      const f = new FontFace(family, `url(${url})`);
      await f.load();
      document.fonts.add(f);
    }
  })();
  return fontsReady;
}

const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadImg(url: string): Promise<HTMLImageElement | null> {
  let p = imgCache.get(url);
  if (!p) {
    p = new Promise((ok) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => ok(null);
      i.src = url;
    });
    imgCache.set(url, p);
  }
  return p;
}
export function forgetImages(prefix: string) {
  for (const k of imgCache.keys()) if (k.startsWith(prefix)) imgCache.delete(k);
}
