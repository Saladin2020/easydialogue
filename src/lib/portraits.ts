import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EMOTIONS } from "../shared/types.js";
import { paintEmotion, faceStyleOf, isGenericFace, type EyeBox } from "./emotionFace.js";
import { alphaAt, bbox, crop, readPng, setPx, upscale, writePng, type Img } from "./raster.js";

/**
 * Portraits from Easy Sprite sheets: crop the head of the front-facing idle frame, upscale with
 * nearest-neighbour, and build emotion variants. When the Easy Sprite CLI is reachable and the
 * sheet has its sibling project JSON, generic faces re-compose with the matching Easy Sprite face
 * part (smile, blink, frown, surprise, wink). Non-generic faces (lashes, elder, glasses, beard…)
 * get procedural per-emotion eye/mouth variants so those features are kept. A small CC0 overlay
 * (tear, "!", blush…) is still stamped as an accent.
 */

export interface PortraitOptions {
  /** Easy Sprite native sheet (.png); a sibling .json supplies view, rows and the project selections. */
  sheet: string;
  /** Portrait set id (default: sheet file name). */
  id?: string;
  /** Output folder (the set is written to `<outDir>/<id>/`). */
  outDir: string;
  emotions?: string[];
  /** Nearest-neighbour factor for the 32×32 crop (default 2 → 64×64). */
  scale?: number;
  /** Path to easysprite-cli.mjs, or false to never re-compose faces. Default: env / studio path. */
  easysprite?: string | false;
}

export interface PortraitResult {
  id: string;
  dir: string;
  files: Record<string, string>;
  size: number;
  faceSwap: boolean;
  eyes: { x: number; y: number; w: number } | null;
  warnings: string[];
}

export const CROP = 32;

const DEFAULT_ES_CLI = "/workspace/indie-studio/tools/easysprite-cli.mjs";

export function findEasySpriteCli(explicit?: string | false): string | null {
  if (explicit === false) return null;
  const candidates = [explicit, process.env.EASYDIALOGUE_EASYSPRITE_CLI, DEFAULT_ES_CLI].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

interface SheetMeta {
  frameSize: number;
  directions: string[];
  frames: string[];
  view?: string;
  project?: { id?: string; view?: string; selections?: Record<string, string>; colors?: Record<string, string> };
}

async function sheetMeta(sheet: string): Promise<SheetMeta | null> {
  const json = sheet.replace(/\.png$/i, ".json");
  if (!existsSync(json)) return null;
  try {
    return JSON.parse(await readFile(json, "utf8")) as SheetMeta;
  } catch {
    return null;
  }
}

function frontFrame(sheet: Img, meta: SheetMeta | null): Img {
  const fs = meta?.frameSize ?? 48;
  const dirs = meta?.directions ?? (sheet.height / fs === 3 ? ["right", "left", "front"] : ["front", "right", "back", "left"]);
  const row = Math.max(0, dirs.indexOf("front"));
  const col = Math.max(0, (meta?.frames ?? ["idle"]).indexOf("idle"));
  return crop(sheet, col * fs, row * fs, fs, fs);
}

function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cmd, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) => resolve({ code: code ?? 1, out }));
    child.on("error", () => resolve({ code: 1, out }));
  });
}

/** Re-compose the sheet's character with another face part; returns its front idle frame. */
async function recomposeFace(cli: string, meta: SheetMeta, face: string, tmp: string): Promise<Img | null> {
  const sel = meta.project?.selections;
  if (!sel?.body) return null;
  const side = (meta.project?.view ?? meta.view) === "side";
  const faceId = side ? `side_${face}` : face;
  const id = `ed_face_${face}`.replace(/[^a-z0-9_-]/g, "_");
  const args = ["compose", "--id", id, "--name", id, "--body", sel.body];
  if (side) args.push("--view", "side");
  for (const [slot, part] of Object.entries(sel)) if (slot !== "body" && slot !== "face" && part) args.push("--select", `${slot}=${part}`);
  args.push("--select", `face=${faceId}`);
  if (meta.project?.colors && Object.keys(meta.project.colors).length) args.push("--colors", JSON.stringify(meta.project.colors));
  args.push("--save-dir", tmp, "--export", "--preset", "native", "--out", path.join(tmp, "native"));
  const res = await run(cli, args);
  const png = path.join(tmp, "native", `${id}.png`);
  if (res.code !== 0 || !existsSync(png)) return null;
  const sheet = await readPng(png);
  return frontFrame(sheet, (await sheetMeta(png)) ?? meta);
}

/** Pixels that differ between two frames (eyes when diffing against the blink face). */
function diffBox(a: Img, b: Img, maxY: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < Math.min(a.height, maxY); y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      let d = 0;
      for (let k = 0; k < 4; k++) d += Math.abs(a.data[i + k]! - b.data[i + k]!);
      if (d > 24) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

// ---- tiny CC0 overlay icons (drawn in 32×32 crop space) -----------------------------------------
const ICON_PAL: Record<string, number[]> = {
  k: [26, 18, 12, 255],
  w: [255, 248, 230, 255],
  y: [255, 214, 90, 255],
  o: [244, 174, 61, 255],
  b: [120, 190, 240, 255],
  B: [64, 120, 200, 255],
  r: [229, 70, 60, 255],
  R: [160, 30, 30, 255],
  p: [245, 140, 150, 210],
  g: [150, 140, 200, 255],
};
const ICONS: Record<string, string[]> = {
  sparkle: ["..k..", ".kyk.", "kywyk", ".kyk.", "..k.."],
  bang: [".kkk.", ".kwk.", ".kwk.", ".kwk.", ".kkk.", ".kwk.", ".kkk."],
  vein: ["r.r.r", ".R.R.", "rR.Rr", ".R.R.", "r.r.r"],
  dots: ["kkkkkkkkk", "kwkkwkkwk", "kkkkkkkkk"],
  drop: ["..k..", ".kbk.", "kbbBk", "kbBBk", ".kkk."],
  heart: [".kk.kk.", "kppkppk", "kpppppk", ".kpppk.", "..kpk..", "...k..."],
  gloom: ["g.g.g", "g.g.g", "g...g"],
};

function stamp(img: Img, icon: string, x: number, y: number) {
  ICONS[icon]!.forEach((row, yy) =>
    [...row].forEach((ch, xx) => {
      if (ch !== ".") setPx(img, x + xx, y + yy, ICON_PAL[ch]!);
    }),
  );
}

function blend(img: Img, x: number, y: number, rgba: number[]) {
  if (alphaAt(img, x, y) === 0) return;
  const i = (y * img.width + x) * 4;
  const a = rgba[3]! / 255;
  for (let k = 0; k < 3; k++) img.data[i + k] = Math.round(img.data[i + k]! * (1 - a) + rgba[k]! * a);
}

function decorate(img: Img, emotion: string, eyes: { x0: number; y0: number; x1: number; y1: number } | null): void {
  const right = img.width - 1;
  switch (emotion) {
    case "happy":
      stamp(img, "sparkle", right - 5, 1);
      break;
    case "surprised":
      stamp(img, "bang", right - 5, 0);
      break;
    case "angry":
      stamp(img, "vein", right - 6, 2);
      break;
    case "thinking":
      stamp(img, "dots", right - 9, 2);
      break;
    case "sad":
      stamp(img, "gloom", 1, 1);
      if (eyes) {
        setPx(img, eyes.x0, eyes.y1 + 1, ICON_PAL.b!);
        setPx(img, eyes.x0, eyes.y1 + 2, ICON_PAL.b!);
        setPx(img, eyes.x0, eyes.y1 + 3, ICON_PAL.B!);
      } else stamp(img, "drop", right - 5, 1);
      break;
    case "shy":
      if (eyes) {
        for (const x of [eyes.x0 - 1, eyes.x0, eyes.x1, eyes.x1 + 1]) blend(img, x, eyes.y1 + 2, [240, 110, 120, 170]);
      }
      stamp(img, "heart", right - 7, 1);
      break;
  }
}

export async function makePortraits(opts: PortraitOptions): Promise<PortraitResult> {
  const warnings: string[] = [];
  const id = (opts.id ?? path.basename(opts.sheet).replace(/\.png$/i, "")).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const scale = Math.max(1, Math.min(8, Math.round(opts.scale ?? 2)));
  const emotions = opts.emotions?.length ? opts.emotions : [...EMOTIONS];
  const sheet = await readPng(opts.sheet);
  const meta = await sheetMeta(opts.sheet);
  if (!meta) warnings.push("No sibling Easy Sprite .json — assuming 48px frames; faces are not re-composed");
  const base = frontFrame(sheet, meta);
  const fb = bbox(base);
  if (!fb) throw new Error(`Front idle frame of ${opts.sheet} is empty`);

  const cli = meta?.project?.selections ? findEasySpriteCli(opts.easysprite) : null;
  if (meta?.project?.selections && !cli && opts.easysprite !== false) warnings.push("Easy Sprite CLI not found — emotions use procedural faces (set EASYDIALOGUE_EASYSPRITE_CLI)");
  const faceId = meta?.project?.selections?.face ?? "";
  const generic = isGenericFace(faceId);
  const style = faceStyleOf(faceId);
  const variants: Record<string, Img> = {};
  let eyes: EyeBox | null = null;
  const FACE_FOR: Record<string, string> = {
    happy: "face_smile",
    thinking: "face_blink",
    sad: "face_frown",
    surprised: "face_surprise",
    shy: "face_wink",
  };
  if (cli) {
    const tmpRoot = path.join(os.tmpdir(), "easydialogue-faces");
    await mkdir(tmpRoot, { recursive: true });
    const tmp = await mkdtemp(path.join(tmpRoot, `${id}-`));
    // Easy Sprite only writes inside allowed folders; this temp dir is ours for one run.
    const prevAllowed = process.env.EASYSPRITE_ALLOWED_DIRS;
    process.env.EASYSPRITE_ALLOWED_DIRS = [prevAllowed, tmp].filter(Boolean).join(path.delimiter);
    try {
      const blinkFace = /blink$/.test(faceId) ? "face_neutral" : "face_blink";
      const blink = await recomposeFace(cli, meta!, blinkFace, path.join(tmp, "b"));
      if (blink) {
        eyes = diffBox(base, blink, fb.y0 + 26);
        if (generic && !/blink$/.test(faceId)) variants.thinking = blink;
        else if (generic && /blink$/.test(faceId)) variants.thinking = base;
      } else warnings.push("Easy Sprite re-compose failed — emotions use procedural faces");
      if (generic) {
        await Promise.all(
          Object.entries(FACE_FOR).map(async ([emotion, face]) => {
            if (variants[emotion] || face === blinkFace) return;
            const framed = await recomposeFace(cli, meta!, face, path.join(tmp, emotion));
            if (framed) variants[emotion] = framed;
          }),
        );
      }
    } finally {
      if (prevAllowed === undefined) delete process.env.EASYSPRITE_ALLOWED_DIRS;
      else process.env.EASYSPRITE_ALLOWED_DIRS = prevAllowed;
      await rm(tmp, { recursive: true, force: true });
    }
  }
  // Procedural variants for every missing emotion (and all emotions on non-generic faces).
  for (const emotion of emotions.filter((e) => e !== "neutral")) {
    if (!generic || !variants[emotion]) variants[emotion] = paintEmotion(base, emotion, eyes, style);
  }

  // crop window: centre on the eyes (or the head's top rows), keep hats in view
  let cx: number;
  if (eyes) cx = Math.round((eyes.x0 + eyes.x1 + 1) / 2);
  else {
    let minX = Infinity;
    let maxX = -1;
    for (let y = fb.y0; y < fb.y0 + 14; y++) for (let x = 0; x < base.width; x++) if (alphaAt(base, x, y)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    cx = Math.round((minX + maxX + 1) / 2);
  }
  let y0 = fb.y0 - 1;
  if (eyes && eyes.y0 - y0 > 17) y0 = eyes.y0 - 17;
  const x0 = cx - CROP / 2;
  const local = eyes ? { x0: eyes.x0 - x0, y0: eyes.y0 - y0, x1: eyes.x1 - x0, y1: eyes.y1 - y0 } : null;

  const dir = path.join(opts.outDir, id);
  await mkdir(dir, { recursive: true });
  const files: Record<string, string> = {};
  for (const emotion of ["neutral", ...emotions.filter((e) => e !== "neutral")]) {
    const src = variants[emotion] ?? base;
    const c = crop(src, x0, y0, CROP, CROP);
    if (emotion !== "neutral") decorate(c, emotion, local);
    const file = path.join(dir, `${emotion}.png`);
    await writePng(file, upscale(c, scale));
    files[emotion] = file;
  }
  const result: PortraitResult = {
    id,
    dir,
    files,
    size: CROP * scale,
    faceSwap: Object.keys(variants).length > 0,
    eyes: local ? { x: local.x0, y: local.y0, w: local.x1 - local.x0 + 1 } : null,
    warnings,
  };
  await writeFile(
    path.join(dir, "portrait.json"),
    `${JSON.stringify({ format: "easydialogue-portrait/1", id, source: path.basename(opts.sheet), size: result.size, crop: { x: x0, y: y0, w: CROP, h: CROP, scale }, emotions: Object.keys(files), faceSwap: Object.keys(variants), eyes: result.eyes }, null, 2)}\n`,
  );
  return result;
}
