import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportDialogue, voiceManifest } from "../src/lib/export.js";
import { makePortraits } from "../src/lib/portraits.js";
import { renderDialogue } from "../src/lib/render.js";
import { compileById, listPortraits, listScripts, readScript, resolveInside, saveScript } from "../src/lib/workspace.js";
import { findMoment } from "../src/shared/moment.js";
import { FRAME_FILES, boxFrame } from "../src/shared/frames.js";
import { BOX_STYLES, EMOTIONS } from "../src/shared/types.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ root, cleanup } = await tempWorkspace());
});
afterAll(() => cleanup());

const pngSize = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

describe("workspace", () => {
  it("ships the demo scripts, the Thai town cast and the Muslim neighbours", async () => {
    const scripts = await listScripts(root);
    expect(scripts.map((s) => s.id).sort()).toEqual(["hello", "salam_neighbours", "village_delivery"]);
    expect(scripts.every((s) => s.errors === 0)).toBe(true);
    const sets = await listPortraits(root);
    expect(sets.map((s) => s.id).sort()).toEqual([
      "town_elder", "town_farmer", "town_hijab_teacher", "town_kid", "town_kopiah_boy", "town_monk",
      "town_pak_cik", "town_roti_seller", "town_student", "town_tadika_girl", "town_vendor",
    ]);
    for (const s of sets) expect(s.emotions.sort()).toEqual([...EMOTIONS].sort());
  });

  it("refuses to save broken scripts unless forced, and keeps paths inside", async () => {
    const bad = await saveScript(root, "broken", "=== a\n-> nowhere\n");
    expect(bad.saved).toBe(false);
    expect(bad.result.errors[0]!.line).toBe(2);
    expect((await saveScript(root, "broken", "=== a\n-> nowhere\n", { force: true })).saved).toBe(true);
    const dry = await saveScript(root, "dry", "=== a\n> hi\n", { dryRun: true });
    expect(dry.saved).toBe(false);
    await expect(access(path.join(root, "dialogues", "dry.ezd"))).rejects.toThrow();
    expect(() => resolveInside(root, "../../etc/passwd")).toThrow();
    await expect(readScript(root, "../x")).rejects.toThrow();
  });
});

describe("frames", () => {
  it("builds square stretch-safe frames for every style", () => {
    for (const style of BOX_STYLES) {
      const f = boxFrame(style);
      expect(f.width).toBe(24);
      expect(f.height).toBe(24);
      expect(f.data.length).toBe(24 * 24 * 4);
    }
    expect(FRAME_FILES.box.margin).toBe(8);
  });
});

describe("render", () => {
  it("renders a line and a choice screen at 3x with portrait", async () => {
    const doc = await compileById(root, "village_delivery");
    const line = findMoment(doc, { line: 2 });
    const buf = await renderDialogue({ line: line.line, style: "teak", scale: 3, portraitsDir: path.join(root, "portraits"), background: path.join(root, "backgrounds/thai_village_street.png") });
    expect(pngSize(buf)).toEqual({ w: 1440, h: 810 });
    // portrait well (right side) is not empty: sample a pixel inside the portrait area
    const img = await loadImage(buf);
    const c = createCanvas(img.width, img.height);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const px = g.getImageData(1300, 700, 1, 1).data;
    expect(px[3]).toBe(255);
    const ch = findMoment(doc, { choice: 1 });
    const buf2 = await renderDialogue({ line: ch.line, choices: ch.choices, selected: 1, style: "night", scale: 1 });
    expect(pngSize(buf2)).toEqual({ w: 480, h: 270 });
  });
});

describe("portraits", () => {
  it("crops a 32px portrait set from an Easy Sprite style sheet", async () => {
    const out = path.join(root, "portraits");
    const res = await makePortraits({ sheet: path.join(root, "..", path.basename(root), "backgrounds", "missing.png"), outDir: out }).catch((e: Error) => e);
    expect(res).toBeInstanceOf(Error);
    // build a tiny fake side sheet (3 rows × 30 cols of 48px; front idle = row 2, col 0)
    const c = createCanvas(48 * 30, 48 * 3);
    const g = c.getContext("2d");
    g.fillStyle = "#c08050";
    g.fillRect(14, 96 + 6, 20, 40);
    g.fillStyle = "#222";
    g.fillRect(19, 96 + 16, 3, 3);
    g.fillRect(27, 96 + 16, 3, 3);
    const sheet = path.join(root, "fake_sheet.png");
    await (await import("node:fs/promises")).writeFile(sheet, c.toBuffer("image/png"));
    const set = await makePortraits({ sheet, id: "fake", outDir: out, scale: 2, easysprite: false });
    expect(Object.keys(set.files).sort()).toEqual([...EMOTIONS].sort());
    expect(set.size).toBe(64);
    const files = await readdir(path.join(out, "fake"));
    expect(files).toContain("portrait.json");
    expect(pngSize(await readFile(set.files.happy!))).toEqual({ w: 64, h: 64 });
  });
});

describe("export", () => {
  it("writes json, pixi, godot and voice bundles", async () => {
    const res = await exportDialogue(root, { id: "village_delivery", preset: "all" });
    const all = res.files.map((f) => path.relative(root, f).split(path.sep).join("/"));
    const has = (re: RegExp) => expect(all.some((f) => re.test(f)), String(re)).toBe(true);
    has(/village_delivery\.dialogue\.json$/);
    has(/easydialogue-pixi\.js$/);
    has(/easydialogue-runner\.js$/);
    has(/index\.html$/);
    has(/project\.godot$/);
    has(/dialogue_runner\.gd$/);
    has(/dialogue_box\.tscn$/);
    has(/village_delivery\.voice\.json$/);
    has(/village_delivery\.voice\.csv$/);
    has(/Kanit-Regular\.ttf$/);
    has(/town_kid\/happy\.png$/);
    const docFile = res.files.find((f) => f.endsWith(".dialogue.json") && f.includes("-json"))!;
    expect(JSON.parse(await readFile(docFile, "utf8")).format).toBe("easydialogue/1");
    const json = JSON.parse(await readFile(res.files.find((f) => f.endsWith(".dialogue.json") && f.includes("-pixi"))!, "utf8"));
    expect(json.format).toBe("easydialogue/1");
    expect(json.ui.layout.viewport).toMatchObject({ width: 480, height: 270 });
    expect(json.assets.portraits.town_kid.happy).toMatch(/town_kid\/happy\.png$/);
  });

  it("voice manifest lists every spoken line with voice ids and never a key", async () => {
    const doc = await compileById(root, "village_delivery");
    const m = voiceManifest(doc);
    const text = JSON.stringify(m);
    expect(text).not.toMatch(/api[_-]?key|xi-api/i);
    const rows = (m as { lines: Array<{ id: string; voice: string | null; text: string }> }).lines;
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.find((r) => r.text.startsWith("ต้นจ๋า"))!.voice).toBe("th_auntie");
  });
});
