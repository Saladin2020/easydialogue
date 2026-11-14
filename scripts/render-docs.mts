/**
 * README / demo images: npx tsx scripts/render-docs.mts [outDir=docs/assets]
 * Renders from the shipped samples (no workspace needed).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { registerFonts, pkgRoot } from "../src/lib/assets.js";
import { renderDialogue } from "../src/lib/render.js";
import { findMoment } from "../src/shared/moment.js";
import { compileScript } from "../src/shared/parser.js";
import { BOX_STYLES, EMOTIONS } from "../src/shared/types.js";
import { STYLE_LABELS } from "../src/shared/ui.js";
import { readFile } from "node:fs/promises";

const out = path.resolve(process.argv[2] ?? "docs/assets");
await mkdir(out, { recursive: true });
const samples = path.join(pkgRoot, "samples");
const portraitsDir = path.join(samples, "portraits");
const street = path.join(samples, "backgrounds", "thai_village_street.png");
const shops = path.join(samples, "backgrounds", "thai_village_shops.png");
const { doc } = compileScript(await readFile(path.join(samples, "dialogues", "village_delivery.ezd"), "utf8"), { id: "village_delivery" });
if (!doc) throw new Error("demo script has errors");
registerFonts();

const save = async (name: string, buf: Buffer) => {
  await writeFile(path.join(out, name), buf);
  console.log("wrote", path.join(out, name));
};

// 1) line @3x on the street, 2) choice screen, 3) a mid-type frame
await save("dialogue-line.png", await renderDialogue({ line: findMoment(doc, { line: 2 }).line, style: "teak", scale: 3, portraitsDir, background: street }));
const ch = findMoment(doc, { choice: 1 });
await save("dialogue-choices.png", await renderDialogue({ line: ch.line, choices: ch.choices, selected: 1, style: "teak", scale: 3, portraitsDir, background: street }));
await save("dialogue-typing.png", await renderDialogue({ line: findMoment(doc, { line: 3 }).line, style: "lantern", scale: 3, portraitsDir, background: shops, reveal: 0.55 }));
await save("dialogue-ending.png", await renderDialogue({ line: findMoment(doc, { picks: [0, 0], lineId: undefined, line: 17 }).line, style: "night", scale: 3, portraitsDir, background: shops }));

// 4) four box styles, 2×2 at 2x
{
  const S = 2;
  const W = 480 * S;
  const H = 270 * S;
  const c = createCanvas(W * 2 + 12, H * 2 + 12);
  const g = c.getContext("2d");
  g.fillStyle = "#1a1410";
  g.fillRect(0, 0, c.width, c.height);
  const m = findMoment(doc, { line: 9, picks: [0] });
  for (const [i, style] of BOX_STYLES.entries()) {
    const img = await loadImage(await renderDialogue({ line: m.line, style, scale: S, portraitsDir, background: i % 2 ? shops : street, caption: STYLE_LABELS[style] }));
    g.drawImage(img, (i % 2) * (W + 12), Math.floor(i / 2) * (H + 12));
  }
  await save("box-styles.png", c.toBuffer("image/png"));
}

// 5) portraits lineup: 6 characters × 7 emotions
{
  const cast = Object.values(doc.characters);
  const P = 96;
  const pad = 14;
  const labelW = 120;
  const headH = 34;
  const c = createCanvas(labelW + EMOTIONS.length * (P + pad) + pad, headH + cast.length * (P + pad) + pad);
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#211a14";
  g.fillRect(0, 0, c.width, c.height);
  g.font = "16px 'Kanit Medium'";
  g.fillStyle = "#f2c66d";
  g.textBaseline = "middle";
  EMOTIONS.forEach((e, j) => {
    g.textAlign = "center";
    g.fillText(e, labelW + pad + j * (P + pad) + P / 2, headH / 2 + 4);
  });
  for (const [i, ch] of cast.entries()) {
    const y = headH + pad + i * (P + pad);
    g.textAlign = "left";
    g.fillStyle = ch.color ?? "#f3e7d3";
    g.font = "22px 'Kanit Medium'";
    g.fillText(ch.name, pad, y + P / 2 - 10);
    g.fillStyle = "#a8957c";
    g.font = "13px Kanit";
    g.fillText(ch.portrait ?? "", pad, y + P / 2 + 16);
    for (const [j, e] of EMOTIONS.entries()) {
      const x = labelW + pad + j * (P + pad);
      g.fillStyle = "#3a2c20";
      g.fillRect(x - 3, y - 3, P + 6, P + 6);
      g.fillStyle = "#151009";
      g.fillRect(x, y, P, P);
      const img = await loadImage(path.join(portraitsDir, ch.portrait!, `${e}.png`));
      g.drawImage(img, x, y, P, P);
    }
  }
  await save("portraits-lineup.png", c.toBuffer("image/png"));
}
