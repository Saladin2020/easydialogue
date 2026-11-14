/**
 * Optional Godot parity check: GODOT=/path/to/godot npx vitest run test/godot.test.ts
 * Exports the demo, imports it headless and compares the GDScript runner transcript with the JS runner.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportDialogue } from "../src/lib/export.js";
import { compileById } from "../src/lib/workspace.js";
import { autoplay } from "../src/shared/runner.js";
import { tempWorkspace } from "./helpers.js";

const GODOT = process.env.GODOT;
let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  if (GODOT) ({ root, cleanup } = await tempWorkspace());
});
afterAll(() => cleanup?.());

describe.skipIf(!GODOT)("Godot export parity", () => {
  it.each([[[0, 0]], [[1, 1]], [[2]]])("picks %j match the JS runner", async (picks) => {
    const out = path.join(root, "exports", `godot-${picks.join("-")}`);
    await exportDialogue(root, { id: "village_delivery", preset: "godot", out });
    // Godot 4.3 has no --import flag; one editor pass imports the assets (it may crash on quit — ignored).
    spawnSync(GODOT!, ["--headless", "--editor", "--quit", "--path", out], { encoding: "utf8", timeout: 120_000 });
    const run = spawnSync(GODOT!, ["--headless", "--path", out, "--script", "res://test_runner.gd", "--", `picks=${picks.join(",")}`], { encoding: "utf8", timeout: 120_000 });
    const stdout = run.stdout;
    expect(stdout).toMatch(/^OK$/m);
    const gd = stdout.split("\n").filter((l) => l.startsWith("T| ")).map((l) => l.slice(3));
    const js = autoplay(await compileById(root, "village_delivery"), picks);
    expect(gd).toEqual(js.transcript);
    const vars = JSON.parse(stdout.match(/^VARS\| (.*)$/m)![1]!);
    expect(vars).toEqual(js.vars);
  }, 300_000);
});
