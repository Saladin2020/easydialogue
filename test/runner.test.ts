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

const salam = async () => {
  const src = await readFile(path.join(import.meta.dirname, "../samples/dialogues/salam_neighbours.ezd"), "utf8");
  const res = compileScript(src, { id: "salam_neighbours" });
  expect(res.errors).toEqual([]);
  expect(res.warnings).toEqual([]);
  return res.doc!;
};

describe("salam_neighbours (multicultural demo)", () => {
  it("salam route: greeting is answered, both the Tadika and the temple get help", async () => {
    const r = autoplay(await salam(), [0, 0, 0, 0]);
    expect(r.vars).toEqual({ greeted_salam: true, helped_tadika: true, helped_temple: true, roti: 2 });
    const text = r.transcript.join("\n");
    for (const phrase of ["อัสสะลามุอะลัยกุม", "วะอะลัยกุมุสสะลาม", "อินชาอัลลอฮ์", "ขอบคุณ"]) expect(text).toContain(phrase);
    expect(r.events).toEqual(expect.arrayContaining(["camera market", "camera tadika", "camera temple"]));
  });

  it("temple-first route still visits the Tadika and reaches the shared ending", async () => {
    const r = autoplay(await salam(), [1, 1, 1, 1]);
    expect(r.vars.helped_tadika && r.vars.helped_temple).toBe(true);
    expect(r.transcript.at(-1)).toMatch(/ทุกศาสนาช่วยกัน/);
  });

  it("can say no without penalty", async () => {
    const r = autoplay(await salam(), [0, 2]);
    expect(r.vars.helped_tadika).toBe(false);
  });
});

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

  it("can show failed-condition choices greyed out (global, per-choice, and a hide override)", () => {
    const src = `@choices grey
@var coins = 2
=== a
* [if coins > 5] rich -> END
* [if coins > 5] [hide] secret -> END
* [if coins > 5] [grey] also-rich -> END
* poor -> END
`;
    const { doc, errors } = compileScript(src);
    expect(errors).toEqual([]);
    expect(doc!.disabledChoices).toBe("grey");
    const secret = doc!.nodes.a!.body[0] as { t: string; options: Array<{ text: string; disabled?: string }> };
    expect(secret.options.find((o) => o.text === "secret")?.disabled).toBe("hide");
    expect(secret.options.find((o) => o.text === "also-rich")?.disabled).toBe("grey");

    // A runner/global "hide" still honours a per-choice [grey] override.
    const hidden = new DialogueRunner(doc!, { disabledChoices: "hide" }).start().next();
    expect(hidden.type).toBe("choices");
    if (hidden.type === "choices") {
      expect(hidden.options.map((o) => ({ text: o.text, disabled: Boolean(o.disabled) }))).toEqual([
        { text: "also-rich", disabled: true },
        { text: "poor", disabled: false },
      ]);
    }

    const r = new DialogueRunner(doc!).start();
    const ev = r.next();
    expect(ev.type).toBe("choices");
    if (ev.type !== "choices") return;
    expect(ev.options.map((o) => ({ text: o.text, disabled: Boolean(o.disabled) }))).toEqual([
      { text: "rich", disabled: true },
      { text: "also-rich", disabled: true },
      { text: "poor", disabled: false },
    ]);
    expect(() => r.choose(ev.options[0]!.index)).toThrow(/disabled/);
    r.choose(ev.options[2]!.index);
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
