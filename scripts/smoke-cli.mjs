/** CLI smoke test: init a temp workspace, check, play, render and export through the real CLI. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ws = mkdtempSync(path.join(os.tmpdir(), "easydialogue-cli-"));
const cli = (...args) => execFileSync("npx", ["tsx", "src/cli.ts", ...args, "--workspace", ws], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
let failed = false;
const ok = (cond, label) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  if (!cond) failed = true;
};

cli("init");
ok(existsSync(path.join(ws, "dialogues", "village_delivery.ezd")), "init copies the demo");
const check = JSON.parse(cli("check", "village_delivery", "--json"));
ok(check.errors.length === 0 && check.warnings.length === 0, "check: demo is clean");
const play = cli("play", "village_delivery", "--picks", "0,0", "--vars");
ok(/coins.*15/.test(play) && /พรุ่งนี้ผมมาช่วยอีก/.test(play), "play --picks 0,0 reaches the 15-baht ending");

writeFileSync(path.join(ws, "dialogues", "broken.ezd"), "=== a\nkid: hi\n-> nowhre\n=== nowhere\n> x\n");
let out = "";
try {
  cli("check", "broken");
} catch (e) {
  out = String(e.stdout) + String(e.stderr);
}
ok(/broken\.ezd:3/.test(out) && /did you mean "nowhere"/.test(out), "check reports file:line and a suggestion");

const png = path.join(ws, "line.png");
cli("render", "village_delivery", "--line", "2", "--scale", "3", "--out", png);
const b = readFileSync(png);
ok(b.readUInt32BE(16) === 1440 && b.readUInt32BE(20) === 810, "render --scale 3 → 1440×810 PNG");
cli("render", "village_delivery", "--choice", "1", "--selected", "1", "--style", "lantern", "--out", path.join(ws, "choice.png"));
ok(existsSync(path.join(ws, "choice.png")), "render --choice 1");

cli("export", "village_delivery", "--preset", "all");
for (const f of ["exports/village_delivery-pixi/index.html", "exports/village_delivery-godot/project.godot", "exports/village_delivery-voice/village_delivery.voice.csv"]) {
  ok(existsSync(path.join(ws, f)), `export → ${f}`);
}

rmSync(ws, { recursive: true, force: true });
console.log(failed ? "CLI smoke FAILED" : "CLI smoke OK");
process.exit(failed ? 1 : 0);
