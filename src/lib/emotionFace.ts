/**
 * Procedural per-emotion face variants painted onto an Easy Sprite front idle frame.
 * Keeps non-generic features (lashes, glasses, beard, mustache, elder wrinkles) and only
 * redraws eyes / brows / mouth / blush — used when swapping the whole face part would
 * drop those features.
 */
import { alphaAt, setPx, type Img } from "./raster.js";

export const EYE: readonly number[] = [34, 24, 22, 255];
export const WHITE: readonly number[] = [250, 248, 242, 255];
export const MOUTH: readonly number[] = [150, 70, 62, 255];
export const LIPS: readonly number[] = [200, 82, 96, 255];
export const BLUSH: readonly number[] = [236, 146, 136, 200];

export type EyeBox = { x0: number; y0: number; x1: number; y1: number };

export function faceStyleOf(faceId: string | undefined): string {
  const id = (faceId ?? "").replace(/^side_/, "");
  const m = /face_([a-z_]+)$/.exec(id);
  return m?.[1] ?? "neutral";
}

export function isGenericFace(faceId: string | undefined): boolean {
  return /(?:^|_)face_(neutral|smile|blink|frown|surprise|wink)$/.test(faceId ?? "");
}

export function cloneImg(img: Img): Img {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

function px(img: Img, x: number, y: number): number[] {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return [0, 0, 0, 0];
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!];
}

function luma(p: readonly number[]): number {
  return (p[0]! + p[1]! + p[2]!) / 3;
}

function chroma(p: readonly number[]): number {
  return Math.max(p[0]!, p[1]!, p[2]!) - Math.min(p[0]!, p[1]!, p[2]!);
}

/** Hair, beard, eyes, wrinkles, outlines — never overwrite these with "skin". */
export function isHairOrLine(p: readonly number[]): boolean {
  return p[3]! > 80 && luma(p) < 85 && chroma(p) < 45;
}

/** Reddish mouth / lip pixels we may erase when redrawing a mouth. */
function isMouthColor(p: readonly number[]): boolean {
  return p[3]! > 80 && p[0]! > p[1]! + 18 && p[0]! > p[2]! + 18 && luma(p) < 190 && p[0]! < 230;
}

/**
 * Warm flesh tones, including darker brown skin. Rejects hair, blush highlights and saturated clothes.
 */
export function isSkinLike(p: readonly number[]): boolean {
  if (p[3]! < 200) return false;
  const l = luma(p);
  if (l < 50 || l > 230) return false;
  if (isHairOrLine(p)) return false;
  if (p[0]! + 8 < p[2]!) return false; // cooler than skin
  if (p[0]! - p[1]! > 75 && p[1]! < 130) return false; // red shirt
  if (p[0]! > 220 && p[1]! < 165 && p[2]! < 165) return false; // baked-in blush
  return p[0]! > 70;
}

function sampleSkin(img: Img, eyes: EyeBox): readonly number[] {
  const cx = Math.round((eyes.x0 + eyes.x1) / 2);
  const found: number[][] = [];
  const y0 = eyes.y1 + 1;
  const y1 = eyes.y1 + 5;
  const x0 = cx - 4;
  const x1 = cx + 4;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = px(img, x, y);
      if (isSkinLike(p)) found.push(p);
    }
  }
  if (found.length) {
    found.sort((a, b) => luma(a) - luma(b));
    return found[Math.floor(found.length / 2)]!;
  }
  return [201, 156, 112, 255];
}

/** Guess an eye box when Easy Sprite re-compose is unavailable. */
export function inferEyes(img: Img): EyeBox | null {
  const darks: Array<[number, number]> = [];
  const y0 = Math.floor(img.height * 0.28);
  const y1 = Math.floor(img.height * 0.52);
  const x0 = Math.floor(img.width * 0.28);
  const x1 = Math.ceil(img.width * 0.72);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (isHairOrLine(px(img, x, y))) darks.push([x, y]);
  }
  if (darks.length < 4) return null;
  const xs = darks.map((p) => p[0]);
  const ys = darks.map((p) => p[1]);
  // prefer the tighter upper cluster (eyes sit above the mouth)
  const midY = ys.reduce((a, b) => a + b, 0) / ys.length;
  const upper = darks.filter((p) => p[1] <= midY + 1);
  const use = upper.length >= 4 ? upper : darks;
  return {
    x0: Math.min(...use.map((p) => p[0])),
    y0: Math.min(...use.map((p) => p[1])),
    x1: Math.max(...use.map((p) => p[0])),
    y1: Math.max(...use.map((p) => p[1])),
  };
}

function clearBand(img: Img, x0: number, y0: number, x1: number, y1: number, skin: readonly number[], keepGlasses: boolean) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = px(img, x, y);
      if (p[3]! === 0) continue;
      if (keepGlasses && p[0]! < 70 && p[2]! < 80 && p[1]! < 70) continue; // frames
      if (isHairOrLine(p)) continue; // keep hair, beard, eye dots, wrinkles
      if (isSkinLike(p) || isMouthColor(p)) setPx(img, x, y, skin);
    }
  }
}

function smile(img: Img, mx: number, my: number, col: readonly number[]) {
  setPx(img, mx - 1, my - 1, col);
  setPx(img, mx, my, col);
  setPx(img, mx + 1, my, col);
  setPx(img, mx + 2, my - 1, col);
}

function frown(img: Img, mx: number, my: number, col: readonly number[]) {
  setPx(img, mx - 1, my, col);
  setPx(img, mx, my - 1, col);
  setPx(img, mx + 1, my - 1, col);
  setPx(img, mx + 2, my, col);
}

function openMouth(img: Img, mx: number, my: number, col: readonly number[], round = false) {
  setPx(img, mx, my - 1, EYE);
  setPx(img, mx + 1, my - 1, EYE);
  setPx(img, mx, my, EYE);
  setPx(img, mx + 1, my, EYE);
  if (round) {
    setPx(img, mx - 1, my, col);
    setPx(img, mx + 2, my, col);
  }
}

function brow(img: Img, ex: number, ey: number, slant: "angry" | "sad") {
  if (slant === "angry") {
    setPx(img, ex, ey - 1, EYE);
    setPx(img, ex + 1, ey - 2, EYE);
  } else {
    setPx(img, ex, ey - 2, EYE);
    setPx(img, ex + 1, ey - 1, EYE);
  }
}

function blush(img: Img, eyes: EyeBox) {
  const y = eyes.y1 + 2;
  for (const x of [eyes.x0 - 2, eyes.x0 - 1, eyes.x1 + 1, eyes.x1 + 2]) {
    const p = px(img, x, y);
    if (p[3]! === 0) continue;
    const a = 0.55;
    setPx(img, x, y, [
      Math.round(p[0]! * (1 - a) + BLUSH[0]! * a),
      Math.round(p[1]! * (1 - a) + BLUSH[1]! * a),
      Math.round(p[2]! * (1 - a) + BLUSH[2]! * a),
      255,
    ]);
  }
}

function lid(img: Img, x0: number, x1: number, y: number) {
  for (let x = x0; x <= x1; x++) setPx(img, x, y, EYE);
}

/**
 * Return a copy of `src` with the given emotion painted on. Neutral is returned unchanged.
 * `eyes` is in source-image coordinates (the Easy Sprite front idle frame, or the 32×32 crop).
 */
export function paintEmotion(src: Img, emotion: string, eyes: EyeBox | null, style = "neutral"): Img {
  if (emotion === "neutral") return src;
  const box = eyes ?? inferEyes(src);
  const img = cloneImg(src);
  if (!box) return img;
  const skin = sampleSkin(img, box);
  const lip = style === "lashes" ? LIPS : MOUTH;
  const mx = Math.round((box.x0 + box.x1) / 2) - 1;
  const my = box.y1 + 4;
  const glasses = style === "glasses";
  const mid = Math.round((box.x0 + box.x1) / 2);
  const left = { x0: box.x0, x1: Math.min(box.x0 + 2, mid - 1), y0: box.y0, y1: box.y1 };
  const right = { x0: Math.max(mid + 1, box.x1 - 2), x1: box.x1, y0: box.y0, y1: box.y1 };

  // Narrow mouth slot only — never a wide wipe that would eat a beard or hanging hair.
  clearBand(img, mx - 2, my - 1, mx + 3, my + 1, skin, false);

  switch (emotion) {
    case "happy":
      smile(img, mx, my, lip);
      break;
    case "sad":
      frown(img, mx, my, lip);
      if (!glasses) {
        brow(img, left.x0, box.y0, "sad");
        brow(img, right.x0, box.y0, "angry"); // outer-high / inner-low on the right
      }
      break;
    case "surprised":
      openMouth(img, mx, my, lip, true);
      if (!glasses) {
        setPx(img, left.x0, box.y0 - 1, WHITE);
        setPx(img, right.x0, box.y0 - 1, WHITE);
      }
      break;
    case "angry":
      // Draw brows on top; do not fill a forehead band (that would replace hair with "skin").
      setPx(img, mx, my, lip);
      setPx(img, mx + 1, my, lip);
      if (!glasses) {
        brow(img, left.x0, box.y0, "angry");
        // right brow mirrors: outer high, inner low
        setPx(img, right.x1, box.y0 - 1, EYE);
        setPx(img, right.x1 - 1, box.y0 - 2, EYE);
      }
      break;
    case "thinking":
      lid(img, left.x0, left.x1, box.y0);
      lid(img, right.x0, right.x1, box.y0);
      setPx(img, mx, my, lip);
      setPx(img, mx + 1, my, lip);
      break;
    case "shy":
      smile(img, mx, my, lip);
      blush(img, box);
      break;
    default:
      break;
  }
  return img;
}
