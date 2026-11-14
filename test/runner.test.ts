import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findMoment } from "../src/shared/moment.js";
import { compileScript } from "../src/shared/parser.js";
import { DialogueRunner, autoplay, graphemes, interpolate, wordSegments, wrapText } from "../src/shared/runner.js";

const demo = async () => {
  const src = await readFile(path.join(import.meta.dirname, "../samples/dialogues/village_delivery.ezd"), "utf8");
  const res = compileScript(src, { id: "village_delivery" });
  expect(res.errors).toEqual([]);
  expect(res.warnings).toEqual([]);
  return res.doc!;
};

describe("runner", () => {
  it("plays the village demo: help everyone → 15 baht ending", async () => {
    const r = autoplay(await demo(), [0, 0]);
    expect(r.vars).toEqual({ delivered: 3, coins: 15, mango: true });
    expect(r.transcript.at(-1)).toMatch(/พรุ่งนี้ผมมาช่วยอีก/);
    expect(r.events).toContain("sfx fanfare");
  });

  it("takes the refuse branch", async () => {
    const r = autoplay(await demo(), [2]);
    expect(r.vars.delivered).toBe(0);
  });

  it("hides choices whose condition fails and evaluates assignments", () => {
    const { doc } = compileScript(`@var coins = 2\n=== a\n* [if coins > 5] rich -> END\n* poor\n    ~ coins *= 3\n> you have {coins}\n`);
    const r = new DialogueRunner(doc!).start();
    const ev = r.next();
    expect(ev.type).toBe("choices");
    if (ev.type !== "choices") return;
    expect(ev.options.map((o) => o.text)).toEqual(["poor"]);
    r.choose(ev.options[0]!.index); // choose() takes the option's script index
    expect(ev.options[0]!.index).toBe(1);
    const line = r.next();
    expect(line.type === "line" && line.text).toBe("you have 6");
    expect(r.next().type).toBe("end");
  });

  it("finds moments for previews", async () => {
    const doc = await demo();
    expect(findMoment(doc, { line: 2 }).line!.name).toBe("ป้าแดง");
    const c = findMoment(doc, { choice: 1 });
    expect(c.choices!.options).toHaveLength(3);
    expect(c.line).not.toBeNull();
  });
});

describe("Thai text helpers", () => {
  it("keeps combining marks inside grapheme clusters", () => {
    expect(graphemes("น้ำ")).toEqual(["น้ำ"]);
    expect(graphemes("ที่นี่")).toEqual(["ที่", "นี่"]);
    expect(graphemes("ผู้ใหญ่").join("")).toBe("ผู้ใหญ่");
    expect(graphemes("ผู้ใหญ่").every((g) => !/^[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e]/.test(g))).toBe(true);
  });
  it("wraps Thai on word boundaries", () => {
    const words = wordSegments("ข้าวเหนียวมะม่วงถวายหลวงพี่", "th");
    expect(words.length).toBeGreaterThan(2);
    const lines = wrapText("ข้าวเหนียวมะม่วงถวายหลวงพี่ ผักบุ้งให้ลุงมี", 12, (s) => [...s].length, "th");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("").replace(/\s/g, "")).toBe("ข้าวเหนียวมะม่วงถวายหลวงพี่ผักบุ้งให้ลุงมี");
    for (const l of lines) expect(l).not.toMatch(/^[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e]/);
  });
  it("interpolates variables", () => {
    expect(interpolate("{coins} บาท {flag}", { coins: 15, flag: true })).toBe("15 บาท true");
  });
});
