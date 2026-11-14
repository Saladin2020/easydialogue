/**
 * Bake favicon / PWA icons: a tiny pixel speech bubble (teak frame, lantern-gold dots).
 * Usage: node scripts/write-icons.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "web", "public");

// 16×16 master, one char per pixel: a teak speech bubble with lantern-gold "…" over a night sky
const PAL = {
  ".": [0, 0, 0, 0],
  k: [13, 9, 6, 255],
  s: [36, 29, 71, 255],
  p: [58, 40, 90, 255],
  w: [122, 82, 48, 255],
  W: [192, 138, 82, 255],
  f: [33, 22, 14, 255],
  y: [244, 174, 61, 255],
  Y: [255, 226, 160, 255],
  r: [229, 128, 108, 255],
};
const ART = [
  "ssssssssssssssss",
  "sskkkkkkkkkkkkss",
  "skWWWWWWWWWWWWks",
  "skWffffffffffwks",
  "skWffffffffffwks",
  "skWfYyfYyfYyfwks",
  "skWfyyfyyfyyfwks",
  "skWffffffffffwks",
  "skWffffffffffwks",
  "skwwwwwwwwwwwwks",
  "sskkkkwwkkkkkkss",
  "pppppkwwkppppppp",
  "pppppkwkpppppppp",
  "pppppkkppppprppp",
  "ppppppppppprrrpp",
  "pppppppppppprppp",
];

function render(size) {
  const c = createCanvas(size, size);
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  const scale = size / 16;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const col = PAL[ART[Math.floor(y / scale)][Math.floor(x / scale)]];
      img.data.set(col, (y * size + x) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  return c.toBuffer("image/png");
}

function svg() {
  let rects = "";
  ART.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const c = PAL[ch];
      if (c[3]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="rgb(${c[0]},${c[1]},${c[2]})"/>`;
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects}</svg>\n`;
}

/** ICO container holding one PNG image (valid since Windows Vista). */
function ico(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = size >= 256 ? 0 : size;
  header[7] = size >= 256 ? 0 : size;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "favicon.svg"), svg());
await writeFile(path.join(outDir, "favicon-32.png"), render(32));
await writeFile(path.join(outDir, "favicon.ico"), ico(render(32), 32));
await writeFile(path.join(outDir, "apple-touch-icon.png"), render(180));
await writeFile(path.join(outDir, "icon-192.png"), render(192));
await writeFile(path.join(outDir, "icon-512.png"), render(512));
await mkdir(path.join(root, "docs", "assets"), { recursive: true });
await writeFile(path.join(root, "docs", "assets", "icon-512.png"), render(512));
console.log(`Icons written to ${outDir}`);
