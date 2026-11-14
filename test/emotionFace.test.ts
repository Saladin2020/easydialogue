import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { faceStyleOf, inferEyes, isGenericFace, isHairOrLine, isSkinLike, paintEmotion, EYE, MOUTH, BLUSH } from "../src/lib/emotionFace.js";
import { makePortraits } from "../src/lib/portraits.js";
import { createImg, setPx, type Img } from "../src/lib/raster.js";

const SKIN: readonly number[] = [201, 156, 112, 255];
const FRAME: readonly number[] = [40, 28, 22, 255]; // dark glasses frame
const LASH: readonly number[] = [20, 12, 10, 255];

function px(img: Img, x: number, y: number): number[] {
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!];
}

function same(a: number[], b: readonly number[]): boolean {
  return a.every((v, i) => v === b[i]);
}

/** 48×48 front idle with skin, two eyes, lashes above, and a glasses frame. */
function fakeFace(): Img {
  const img = createImg(48, 48);
  for (let y = 8; y < 40; y++) for (let x = 12; x < 36; x++) setPx(img, x, y, SKIN);
  // eyes
  for (let y = 16; y <= 18; y++) {
    for (let x = 18; x <= 20; x++) setPx(img, x, y, EYE);
    for (let x = 26; x <= 28; x++) setPx(img, x, y, EYE);
  }
  // lashes just above the eyes (outside the mouth band)
  setPx(img, 17, 15, LASH);
  setPx(img, 21, 15, LASH);
  setPx(img, 25, 15, LASH);
  setPx(img, 29, 15, LASH);
  // glasses frame around the eyes
  for (const x of [17, 21, 25, 29]) for (const y of [15, 19]) setPx(img, x, y, FRAME);
  for (const y of [16, 17, 18]) {
    setPx(img, 16, y, FRAME);
    setPx(img, 22, y, FRAME);
    setPx(img, 24, y, FRAME);
    setPx(img, 30, y, FRAME);
  }
  // closed mouth
  setPx(img, 22, 22, MOUTH);
  setPx(img, 23, 22, MOUTH);
  setPx(img, 24, 22, MOUTH);
  return img;
}

function diffCount(a: Img, b: Img): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 4; k++) d += Math.abs(a.data[i + k]! - b.data[i + k]!);
    if (d > 8) n++;
  }
  return n;
}

describe("emotion face helpers", () => {
  it("classifies generic vs feature faces", () => {
    expect(isGenericFace("side_face_neutral")).toBe(true);
    expect(isGenericFace("face_smile")).toBe(true);
    expect(isGenericFace("face_frown")).toBe(true);
    expect(isGenericFace("face_surprise")).toBe(true);
    expect(isGenericFace("side_face_wink")).toBe(true);
    expect(isGenericFace("side_face_lashes")).toBe(false);
    expect(isGenericFace("face_elder")).toBe(false);
    expect(isGenericFace("face_glasses")).toBe(false);
    expect(faceStyleOf("side_face_lashes")).toBe("lashes");
    expect(faceStyleOf("face_elder")).toBe("elder");
  });

  it("paints distinct mouths / brows per emotion and keeps lashes + glasses frames", () => {
    const base = fakeFace();
    const eyes = inferEyes(base);
    expect(eyes).not.toBeNull();
    expect(eyes!.y0).toBeLessThanOrEqual(16);
    expect(eyes!.y1).toBeGreaterThanOrEqual(18);

    const happy = paintEmotion(base, "happy", eyes, "lashes");
    const sad = paintEmotion(base, "sad", eyes, "lashes");
    const surprised = paintEmotion(base, "surprised", eyes, "lashes");
    const angry = paintEmotion(base, "angry", eyes, "lashes");
    const shy = paintEmotion(base, "shy", eyes, "lashes");
    const thinking = paintEmotion(base, "thinking", eyes, "lashes");
    const glassesHappy = paintEmotion(base, "happy", eyes, "glasses");
    const glassesAngry = paintEmotion(base, "angry", eyes, "glasses");

    expect(paintEmotion(base, "neutral", eyes)).toBe(base);
    expect(diffCount(happy, sad)).toBeGreaterThan(2);
    expect(diffCount(happy, surprised)).toBeGreaterThan(2);
    expect(diffCount(angry, sad)).toBeGreaterThan(2);
    expect(diffCount(shy, base)).toBeGreaterThan(2);
    expect(diffCount(thinking, base)).toBeGreaterThan(2);

    // lashes above the eyes survive a mouth/emotion paint
    for (const img of [happy, sad, surprised, shy]) {
      expect(same(px(img, 17, 15), LASH) || same(px(img, 17, 15), FRAME)).toBe(true);
      expect(same(px(img, 29, 15), LASH) || same(px(img, 29, 15), FRAME)).toBe(true);
    }
    // glasses frames are kept when style is glasses (including angry brow clear)
    expect(same(px(glassesHappy, 16, 17), FRAME)).toBe(true);
    expect(same(px(glassesAngry, 16, 17), FRAME)).toBe(true);
    expect(same(px(glassesAngry, 30, 17), FRAME)).toBe(true);
  });

  it("does not flood hair, beards or blush with a skin rectangle", () => {
    const skin: readonly number[] = [122, 90, 72, 255]; // brown monk-like skin
    const hair: readonly number[] = [42, 24, 16, 255];
    const beard: readonly number[] = [48, 36, 28, 255];
    const shirt: readonly number[] = [210, 74, 74, 255];
    const img = createImg(48, 48);
    for (let y = 8; y < 32; y++) for (let x = 12; x < 36; x++) setPx(img, x, y, skin);
    for (let y = 6; y < 14; y++) for (let x = 12; x < 36; x++) setPx(img, x, y, hair); // bangs
    for (let y = 24; y < 30; y++) for (let x = 18; x < 30; x++) setPx(img, x, y, beard);
    for (let y = 32; y < 44; y++) for (let x = 10; x < 38; x++) setPx(img, x, y, shirt);
    // baked-in cheeks
    setPx(img, 16, 20, BLUSH);
    setPx(img, 17, 20, BLUSH);
    setPx(img, 30, 20, BLUSH);
    setPx(img, 31, 20, BLUSH);
    // eyes
    for (let y = 16; y <= 18; y++) {
      for (let x = 18; x <= 20; x++) setPx(img, x, y, EYE);
      for (let x = 26; x <= 28; x++) setPx(img, x, y, EYE);
    }
    setPx(img, 22, 22, MOUTH);
    setPx(img, 23, 22, MOUTH);
    expect(isSkinLike(skin as number[])).toBe(true);
    expect(isSkinLike(shirt as number[])).toBe(false);
    expect(isSkinLike(BLUSH as number[])).toBe(false);
    expect(isHairOrLine(hair as number[])).toBe(true);
    expect(isHairOrLine(beard as number[])).toBe(true);

    const eyes = { x0: 18, y0: 16, x1: 28, y1: 18 };
    const angry = paintEmotion(img, "angry", eyes, "elder");
    const sad = paintEmotion(img, "sad", eyes, "elder");
    // bangs and beard stay
    expect(same(px(angry, 20, 10), hair)).toBe(true);
    expect(same(px(sad, 20, 10), hair)).toBe(true);
    expect(same(px(angry, 22, 26), beard)).toBe(true);
    expect(same(px(sad, 22, 26), beard)).toBe(true);
    // no shirt-red or blush flood on the forehead or cheeks
    for (const face of [angry, sad]) {
      for (let y = 8; y < 15; y++) {
        for (let x = 12; x < 36; x++) {
          const p = px(face, x, y);
          expect(p[0]! - p[1]!, `forehead ${x},${y}`).toBeLessThan(70);
        }
      }
    }
    expect(diffCount(angry, img)).toBeGreaterThan(1);
    expect(diffCount(angry, sad)).toBeGreaterThan(1);
  });
});

describe("makePortraits procedural faces", () => {
  it("varies non-generic faces without a whole-face swap and keeps dark feature pixels", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ed-port-"));
    try {
      const { createCanvas } = await import("@napi-rs/canvas");
      const c = createCanvas(48 * 30, 48 * 3);
      const g = c.getContext("2d");
      // front idle = row 2, col 0
      const y = 96;
      g.fillStyle = "#c99c70";
      g.fillRect(14, y + 6, 20, 40);
      // eyes
      g.fillStyle = "#22180c";
      g.fillRect(19, y + 16, 3, 3);
      g.fillRect(27, y + 16, 3, 3);
      // lashes
      g.fillRect(18, y + 15, 1, 1);
      g.fillRect(22, y + 15, 1, 1);
      g.fillRect(26, y + 15, 1, 1);
      g.fillRect(30, y + 15, 1, 1);
      // mouth
      g.fillStyle = "#96463e";
      g.fillRect(22, y + 22, 4, 1);
      const sheet = path.join(dir, "town_vendor.png");
      await writeFile(sheet, c.toBuffer("image/png"));
      await writeFile(
        path.join(dir, "town_vendor.json"),
        JSON.stringify({
          format: "easysprite-sheet/1",
          frameSize: 48,
          view: "side",
          directions: ["right", "left", "front"],
          frames: ["idle"],
          project: { view: "side", selections: { body: "body_average", face: "side_face_lashes" } },
        }),
      );
      const set = await makePortraits({ sheet, id: "town_vendor", outDir: path.join(dir, "out"), scale: 2, easysprite: false });
      expect(Object.keys(set.files).sort()).toEqual(["angry", "happy", "neutral", "sad", "shy", "surprised", "thinking"].sort());
      expect(set.faceSwap).toBe(true);

      const { loadImage } = await import("@napi-rs/canvas");
      const { readFile } = await import("node:fs/promises");
      const buffers = await Promise.all(["neutral", "happy", "sad", "angry", "surprised"].map(async (e) => {
        const img = await loadImage(await readFile(set.files[e]!));
        const cv = createCanvas(img.width, img.height);
        const ctx = cv.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      }));
      const [neutral, happy, sad, angry, surprised] = buffers as Uint8ClampedArray[];
      const differ = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
        let n = 0;
        for (let i = 0; i < a.length; i += 4) {
          let d = 0;
          for (let k = 0; k < 4; k++) d += Math.abs(a[i + k]! - b[i + k]!);
          if (d > 8) n++;
        }
        return n;
      };
      expect(differ(neutral!, happy!)).toBeGreaterThan(4);
      expect(differ(happy!, sad!)).toBeGreaterThan(4);
      expect(differ(sad!, angry!)).toBeGreaterThan(2);
      expect(differ(happy!, surprised!)).toBeGreaterThan(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
