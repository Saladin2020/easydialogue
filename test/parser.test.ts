import { describe, expect, it } from "vitest";
import { ExprError, exprToString, exprVars, parseExpr } from "../src/shared/expr.js";
import { collectLines, compileScript, nodeEdges } from "../src/shared/parser.js";
import { normalizeEmotion } from "../src/shared/types.js";

const HEAD = `@title Test
@var coins = 0
@var flag = false
@char kid "ต้น" portrait=town_kid color=#f4ae3d voice=th_boy
@char vendor "ป้าแดง" side=left
`;

describe("expressions", () => {
  it("respects precedence and boolean words", () => {
    expect(exprToString(parseExpr("1 + 2 * 3 >= 7 and not flag"))).toBe("(((1 + (2 * 3)) >= 7) and not flag)");
    expect(exprToString(parseExpr("$coins > 3 || flag && x"))).toBe("((coins > 3) or (flag and x))");
    expect([...exprVars(parseExpr("a + b * (c - 1) == \"ok\""))].sort()).toEqual(["a", "b", "c"]);
  });
  it("throws on bad input", () => {
    expect(() => parseExpr("1 +")).toThrow(ExprError);
    expect(() => parseExpr("(a")).toThrow(ExprError);
  });
});

describe("compileScript", () => {
  it("compiles headers, characters, lines, choices and conditions", () => {
    const src = `${HEAD}
=== start #intro
> ตลาดเช้าคึกคัก
kid [ดีใจ]: สวัสดีครับ {coins} บาท #line:hello #loud
vendor: จ้ะ\\: ว่าไง
* ช่วยป้า -> help
    ~ coins += 10
* [if coins > 5] ซื้อขนม
    vendor [happy]: ได้เลย
* ไม่ล่ะ -> END
kid: ต่อไป
if flag:
    kid: จริง
elif coins >= 10:
    kid [sad]: เกือบ
else:
    -> END
@sfx ding 2
-> help

=== help
~ flag = true
vendor: ขอบใจ
`;
    const { doc, errors, warnings } = compileScript(src, { id: "t" });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(doc!.format).toBe("easydialogue/1");
    expect(doc!.title).toBe("Test");
    expect(doc!.start).toBe("start");
    expect(doc!.variables).toEqual({ coins: 0, flag: false });
    expect(doc!.characters.kid).toMatchObject({ name: "ต้น", portrait: "town_kid", color: "#f4ae3d", voice: "th_boy" });
    expect(doc!.characters.vendor!.side).toBe("left");
    const lines = collectLines(doc!);
    const hello = lines.find((l) => l.id === "hello")!;
    expect(hello).toMatchObject({ speaker: "kid", emotion: "happy", text: "สวัสดีครับ {coins} บาท", src: 9 });
    expect(lines.find((l) => l.text.startsWith("จ้ะ"))!.text).toBe("จ้ะ: ว่าไง");
    expect(nodeEdges(doc!).map((e) => `${e.from}->${e.to}`)).toContain("start->help");
  });

  it("reports line-numbered errors with suggestions", () => {
    const src = `${HEAD}
=== start
kid: ไปกัน -> nowhere
-> hepl
=== help
kid: x
=== help
kid: y
`;
    const { doc, errors } = compileScript(src);
    expect(doc).toBeNull();
    const jump = errors.find((e) => /hepl/.test(e.message))!;
    expect(jump.line).toBe(9);
    expect(jump.message).toMatch(/did you mean "help"/i);
    expect(errors.some((e) => e.line === 12 && /duplicate/i.test(e.message))).toBe(true);
  });

  it("flags bad expressions, missing start and stray indentation", () => {
    expect(compileScript(`@start nope\n=== a\nkid: x\n`).errors.some((e) => /nope/.test(e.message) && e.line === 1)).toBe(true);
    const bad = compileScript(`${HEAD}=== a\nif coins >:\n    kid: x\n`);
    expect(bad.errors.some((e) => e.line === 7)).toBe(true);
    const indent = compileScript(`${HEAD}=== a\nkid: x\n        kid: y\n`);
    expect(indent.errors.some((e) => e.line === 8)).toBe(true);
  });

  it("warns about unknown speakers/emotions, undeclared vars and unreachable nodes", () => {
    const { doc, warnings } = compileScript(`${HEAD}=== a\nghost: boo\nkid [furious]: x\n~ secret = 1\nkid: {other}\n-> END\n=== island\nkid: alone\n`);
    expect(doc).not.toBeNull();
    const msgs = warnings.map((w) => `${w.line}:${w.message}`).join("\n");
    expect(msgs).toMatch(/7:.*ghost/);
    expect(msgs).toMatch(/8:.*furious/);
    expect(msgs).toMatch(/10:.*other/);
    expect(msgs).toMatch(/9:.*secret/);
    expect(doc!.variables.secret).toBe(0);
    expect(msgs).toMatch(/island/);
  });

  it("normalizes Thai emotion aliases", () => {
    expect(normalizeEmotion("ดีใจ")).toBe("happy");
    expect(normalizeEmotion("Happy")).toBe("happy");
  });
});
