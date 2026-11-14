import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

/** RGBA image in memory (straight alpha). */
export interface Img {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function createImg(width: number, height: number): Img {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export async function readPng(file: string): Promise<Img> {
  const img = await loadImage(await readFile(file));
  const c = createCanvas(img.width, img.height);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height);
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(d.data) };
}

export function encodePng(img: Img): Buffer {
  const c = createCanvas(img.width, img.height);
  const g = c.getContext("2d");
  const id = g.createImageData(img.width, img.height);
  id.data.set(img.data);
  g.putImageData(id, 0, 0);
  return c.toBuffer("image/png");
}

export async function writePng(file: string, img: Img): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, encodePng(img));
}

export function crop(img: Img, x: number, y: number, w: number, h: number): Img {
  const out = createImg(w, h);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const sx = x + xx;
      const sy = y + yy;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const si = (sy * img.width + sx) * 4;
      out.data.set(img.data.subarray(si, si + 4), (yy * w + xx) * 4);
    }
  }
  return out;
}

export function upscale(img: Img, n: number): Img {
  const out = createImg(img.width * n, img.height * n);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const si = (Math.floor(y / n) * img.width + Math.floor(x / n)) * 4;
      out.data.set(img.data.subarray(si, si + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}

export function alphaAt(img: Img, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 0;
  return img.data[(y * img.width + x) * 4 + 3]!;
}

export function setPx(img: Img, x: number, y: number, rgba: readonly number[]): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  img.data.set(rgba, (y * img.width + x) * 4);
}

export function bbox(img: Img): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (alphaAt(img, x, y) > 0) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

export function hex(rgb: string, a = 255): [number, number, number, number] {
  let h = rgb.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), a];
}
