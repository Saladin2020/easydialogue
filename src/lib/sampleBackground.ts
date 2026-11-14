import { createImg, hex, setPx, writePng } from "./raster.js";

/** CC0 procedural 480×270 dusk village (fallback preview background when no Easy Scene render exists). */
export async function writeSampleBackground(file: string): Promise<void> {
  const W = 480;
  const H = 270;
  const img = createImg(W, H);
  const sky = ["#2a2448", "#3b2d5c", "#5a3a6a", "#8a4a6a", "#c4626a", "#e98a5c", "#f4ae3d"].map((c) => hex(c));
  for (let y = 0; y < H; y++) {
    const band = Math.min(sky.length - 1, Math.floor((y / 170) * sky.length));
    for (let x = 0; x < W; x++) setPx(img, x, y, sky[band]!);
  }
  // sun
  for (let y = -18; y <= 18; y++) for (let x = -18; x <= 18; x++) if (x * x + y * y <= 324) setPx(img, 360 + x, 150 + y, hex("#ffe2a0"));
  const ridge = (base: number, amp: number, freq: number, color: string) => {
    const c = hex(color);
    for (let x = 0; x < W; x++) {
      const top = Math.round(base - amp * (0.5 + 0.5 * Math.sin(x * freq) * Math.cos(x * freq * 0.37)));
      for (let y = top; y < H; y++) setPx(img, x, y, c);
    }
  };
  ridge(170, 30, 0.021, "#5b4a78");
  ridge(190, 22, 0.034, "#3f3560");
  // stilt houses
  const house = (x0: number, w: number, h: number) => {
    const wall = hex("#2a1d2e");
    const roof = hex("#1a1220");
    const lamp = hex("#ffd27a");
    for (let y = 205 - h; y < 205; y++) for (let x = x0; x < x0 + w; x++) setPx(img, x, y, wall);
    for (let i = 0; i < w / 2 + 6; i++) for (let x = x0 - 6 + i; x < x0 + w + 6 - i; x++) setPx(img, x, 205 - h - i, roof);
    for (let y = 205 - h + 8; y < 205 - h + 14; y++) for (let x = x0 + 6; x < x0 + 12; x++) setPx(img, x, y, lamp);
  };
  house(40, 60, 34);
  house(150, 44, 28);
  house(250, 70, 40);
  ridge(214, 4, 0.05, "#1e150e");
  for (let x = 0; x < W; x += 2) setPx(img, x, 214, hex("#3a2819"));
  await writePng(file, img);
}
