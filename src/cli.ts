#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { serve } from "@hono/node-server";
import { Command } from "commander";
import open from "open";
import { createApp, defaultWebRoot } from "./server/app.js";
import { resolveToken } from "./shared/requestGuard.js";
import { compileScript, nodeEdges } from "./shared/parser.js";
import { findMoment } from "./shared/moment.js";
import { DialogueRunner, autoplay } from "./shared/runner.js";
import { BOX_STYLES, EMOTIONS, type BoxStyle, type CompileResult, type Diagnostic } from "./shared/types.js";
import { EXPORT_PRESETS, exportDialogue, type ExportPreset } from "./lib/export.js";
import { makePortraits } from "./lib/portraits.js";
import { renderDialogue } from "./lib/render.js";
import { assertStyle, dirs, initWorkspace, listPortraits, listScripts, loadConfig, resolveWorkspace, scriptPath, SCRIPT_EXT, workspaceSummary } from "./lib/workspace.js";

const program = new Command();

function workspaceOf(cli?: string): string {
  const v = cli?.trim() || process.env.EASYDIALOGUE_HOME?.trim() || process.env.EASYDIALOGUE_WORKSPACE?.trim() || process.cwd();
  return resolveWorkspace(v);
}

/** A script argument is either a path to a .ezd file or a dialogue id in the workspace. */
async function loadSource(arg: string, root: string): Promise<{ id: string; file: string; source: string }> {
  const asPath = path.resolve(arg);
  if (arg.endsWith(SCRIPT_EXT) || arg.includes("/") || arg.includes("\\")) {
    if (!existsSync(asPath)) throw new Error(`No such file ${arg}`);
    const id = path.basename(asPath, SCRIPT_EXT).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    return { id, file: asPath, source: await readFile(asPath, "utf8") };
  }
  const file = scriptPath(root, arg);
  if (!existsSync(file)) throw new Error(`Dialogue "${arg}" not found in ${dirs(root).dialogues} (try: easydialogue list)`);
  return { id: arg, file, source: await readFile(file, "utf8") };
}

function printDiagnostics(file: string, res: CompileResult) {
  const show = (d: Diagnostic) => console.error(`${file}:${d.line}:${d.col} ${d.severity}: ${d.message}`);
  res.errors.forEach(show);
  res.warnings.forEach(show);
}

const picksOf = (s?: string) => (s ? s.split(",").map((n) => Number(n.trim())).filter((n) => Number.isFinite(n)) : []);
const fail = (e: unknown) => {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
};

program.name("easydialogue").description("Write branching Thai-friendly game dialogue; preview and export for Godot / PixiJS").version("0.1.0");

program
  .command("init")
  .description("Create dialogues/ portraits/ backgrounds/ exports/ with the Thai village demo")
  .option("--force", "Overwrite samples and config")
  .option("--workspace <path>", "Workspace directory")
  .action(async (o: { force?: boolean; workspace?: string }) => {
    const root = await initWorkspace(workspaceOf(o.workspace), { force: o.force });
    console.log(`Initialized Easy Dialogue workspace at ${root}`);
    console.log("  dialogues/    .ezd scripts (village_delivery.ezd, salam_neighbours.ezd, hello.ezd)");
    console.log("  portraits/    <set>/<emotion>.png (Thai town cast from Easy Sprite)");
    console.log("  backgrounds/  preview backgrounds (Easy Scene thai_village_street)");
    console.log("  exports/      Godot / PixiJS / JSON / voice manifest exports");
  });

program
  .command("info")
  .description("Workspace summary")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { workspace?: string; json?: boolean }) => {
    const s = await workspaceSummary(workspaceOf(o.workspace));
    if (o.json) return console.log(JSON.stringify(s, null, 2));
    console.log(`Easy Dialogue workspace ${s.root}`);
    console.log(`  style ${s.config.style} · viewport ${s.config.viewport.width}x${s.config.viewport.height} · portraits ×${s.config.portraitScale}`);
    console.log(`  dialogues: ${s.scripts.map((x) => x.id).join(", ") || "(none)"}`);
    console.log(`  portraits: ${s.portraits.map((p) => p.id).join(", ") || "(none)"}`);
    console.log(`  backgrounds: ${s.backgrounds.join(", ") || "(none)"}`);
    console.log(`  box styles: ${BOX_STYLES.join(", ")} · emotions: ${EMOTIONS.join(", ")} · presets: ${EXPORT_PRESETS.join(", ")}`);
  });

program
  .command("list")
  .description("List dialogue scripts with node/line counts and error status")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { workspace?: string; json?: boolean }) => {
    const list = await listScripts(workspaceOf(o.workspace));
    if (o.json) return console.log(JSON.stringify(list, null, 2));
    for (const s of list) console.log(`${s.id.padEnd(22)} ${s.nodes} nodes · ${s.lines} lines · ${s.choices} choices · ${s.errors ? `${s.errors} errors` : "ok"}${s.warnings ? ` · ${s.warnings} warnings` : ""}  ${s.title}`);
    if (!list.length) console.log("(no dialogues — run easydialogue init)");
  });

program
  .command("check")
  .description("Validate a script (id or path). Exit code 1 when there are errors")
  .argument("<script>")
  .option("--workspace <path>")
  .option("--json")
  .option("--strict", "Treat warnings as errors")
  .action(async (arg: string, o: { workspace?: string; json?: boolean; strict?: boolean }) => {
    try {
      const { id, file, source } = await loadSource(arg, workspaceOf(o.workspace));
      const res = compileScript(source, { id });
      if (o.json) console.log(JSON.stringify({ file, errors: res.errors, warnings: res.warnings, nodes: res.doc ? Object.keys(res.doc.nodes) : [], edges: res.doc ? nodeEdges(res.doc) : [] }, null, 2));
      else {
        printDiagnostics(path.relative(process.cwd(), file) || file, res);
        if (res.doc) console.log(`ok  ${Object.keys(res.doc.nodes).length} nodes · ${res.doc.meta.lines} lines · ${res.doc.meta.choices} choices · ${res.warnings.length} warnings`);
      }
      if (res.errors.length || (o.strict && res.warnings.length)) process.exit(1);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("compile")
  .description("Compile to easydialogue/1 JSON (stdout or --out)")
  .argument("<script>")
  .option("--out <file>")
  .option("--workspace <path>")
  .action(async (arg: string, o: { out?: string; workspace?: string }) => {
    try {
      const { id, file, source } = await loadSource(arg, workspaceOf(o.workspace));
      const res = compileScript(source, { id });
      printDiagnostics(file, res);
      if (!res.doc) process.exit(1);
      const json = `${JSON.stringify(res.doc, null, 2)}\n`;
      if (o.out) {
        await mkdir(path.dirname(path.resolve(o.out)), { recursive: true });
        await writeFile(o.out, json);
        console.error(`wrote ${o.out}`);
      } else process.stdout.write(json);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("play")
  .description("Play in the terminal. With --picks it runs non-interactively (CI-friendly)")
  .argument("<script>")
  .option("--picks <list>", "Choice positions, e.g. 0,1,0 (0-based within the visible options)")
  .option("--node <id>", "Start node")
  .option("--vars", "Print variables at the end")
  .option("--workspace <path>")
  .action(async (arg: string, o: { picks?: string; node?: string; vars?: boolean; workspace?: string }) => {
    try {
      const { id, source, file } = await loadSource(arg, workspaceOf(o.workspace));
      const res = compileScript(source, { id });
      if (!res.doc) {
        printDiagnostics(file, res);
        process.exit(1);
      }
      const interactive = !o.picks && process.stdin.isTTY;
      if (!interactive) {
        const out = autoplay(res.doc, picksOf(o.picks), { node: o.node });
        out.events.forEach((e) => console.log(`@${e}`));
        out.transcript.forEach((l) => console.log(l));
        if (o.vars) console.log(`vars ${JSON.stringify(out.vars)}`);
        return;
      }
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const r = new DialogueRunner(res.doc, { onEvent: (n, a) => console.log(`  @${[n, ...a].join(" ")}`) }).start(o.node);
      for (;;) {
        const ev = r.next();
        if (ev.type === "end") break;
        if (ev.type === "line") {
          console.log(`${ev.name ? `${ev.name}${ev.emotion !== "neutral" ? ` (${ev.emotion})` : ""}: ` : ""}${ev.text}`);
          await rl.question("");
          continue;
        }
        ev.options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt.text}`));
        let pick = NaN;
        while (!(pick >= 1 && pick <= ev.options.length)) pick = Number(await rl.question("> "));
        r.choose(ev.options[pick - 1]!.index);
      }
      rl.close();
      if (o.vars) console.log(`vars ${JSON.stringify(r.vars)}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("portraits")
  .description("Make portrait crops + emotion variants from an Easy Sprite sheet")
  .requiredOption("--sheet <png>", "Easy Sprite native sheet (sibling .json recommended)")
  .option("--id <id>", "Portrait set id (default: sheet name)")
  .option("--emotions <list>", `Comma list (default: ${EMOTIONS.join(",")})`)
  .option("--scale <n>", "Nearest-neighbour scale for the 32px crop (default from config, 2)")
  .option("--out <dir>", "Output folder (default: workspace portraits/)")
  .option("--easysprite <cli>", "Path to easysprite-cli.mjs for face re-compose")
  .option("--no-faces", "Overlays only; never re-compose with Easy Sprite")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { sheet: string; id?: string; emotions?: string; scale?: string; out?: string; easysprite?: string; faces: boolean; workspace?: string; json?: boolean }) => {
    try {
      const root = workspaceOf(o.workspace);
      const cfg = await loadConfig(root);
      const res = await makePortraits({
        sheet: path.resolve(o.sheet),
        id: o.id,
        emotions: o.emotions?.split(",").map((s) => s.trim()).filter(Boolean),
        scale: o.scale ? Number(o.scale) : cfg.portraitScale,
        outDir: o.out ? path.resolve(o.out) : dirs(root).portraits,
        easysprite: o.faces === false ? false : (o.easysprite ?? cfg.easysprite),
      });
      if (o.json) return console.log(JSON.stringify(res, null, 2));
      console.log(`portraits ${res.id} → ${res.dir}`);
      console.log(`  ${Object.keys(res.files).join(", ")} · ${res.size}px · ${res.faceSwap ? "Easy Sprite face re-compose" : "overlays only"}`);
      res.warnings.forEach((w) => console.log(`  warning: ${w}`));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("render")
  .description("PNG preview of a line or choice screen over a background")
  .argument("<script>")
  .requiredOption("--out <png>")
  .option("--line <n>", "N-th line on the path (1-based, default 1)")
  .option("--line-id <id>", "Stop at this line id")
  .option("--choice <k>", "K-th choice screen (1-based)")
  .option("--selected <i>", "Highlighted option on a choice screen", "0")
  .option("--picks <list>", "Choice picks on the way")
  .option("--style <style>", BOX_STYLES.join(" | "))
  .option("--background <png>", "Background (default: config background); 'none' for a plain gradient")
  .option("--scale <n>", "Pixel scale (default 3 → 1440×810)", "3")
  .option("--reveal <f>", "Typewriter progress 0..1", "1")
  .option("--caption <text>")
  .option("--workspace <path>")
  .action(async (arg: string, o: { out: string; line?: string; lineId?: string; choice?: string; selected: string; picks?: string; style?: string; background?: string; scale: string; reveal: string; caption?: string; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      const cfg = await loadConfig(root);
      const { id, source, file } = await loadSource(arg, root);
      const res = compileScript(source, { id });
      if (!res.doc) {
        printDiagnostics(file, res);
        process.exit(1);
      }
      const m = findMoment(res.doc, { picks: picksOf(o.picks), line: o.line ? Number(o.line) : undefined, lineId: o.lineId, choice: o.choice ? Number(o.choice) : undefined });
      const bgArg = o.background ?? cfg.background;
      const bg = bgArg === "none" ? null : path.resolve(root, bgArg);
      const buf = await renderDialogue({
        line: m.line,
        choices: m.choices,
        selected: Number(o.selected),
        style: assertStyle((o.style ?? res.doc.box ?? cfg.style) as BoxStyle),
        background: bg && existsSync(bg) ? bg : null,
        portraitsDir: dirs(root).portraits,
        scale: Number(o.scale),
        reveal: Number(o.reveal),
        caption: o.caption,
      });
      await mkdir(path.dirname(path.resolve(o.out)), { recursive: true });
      await writeFile(o.out, buf);
      console.log(`wrote ${o.out}${m.line ? ` · ${m.line.id} ${m.line.name}` : ""}${m.choices ? ` · ${m.choices.options.length} choices` : ""}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("export")
  .description("Export a dialogue: json | pixi | godot | voice | all")
  .argument("<id>")
  .option("--preset <preset>", EXPORT_PRESETS.join(" | "), "all")
  .option("--out <dir>", "Output folder (default exports/<id>-<preset>)")
  .option("--style <style>", BOX_STYLES.join(" | "))
  .option("--background <png>", "Background for the demo scene; 'none' to skip")
  .option("--workspace <path>")
  .option("--json")
  .action(async (id: string, o: { preset: string; out?: string; style?: string; background?: string; workspace?: string; json?: boolean }) => {
    try {
      const root = workspaceOf(o.workspace);
      const res = await exportDialogue(root, {
        id,
        preset: o.preset as ExportPreset,
        out: o.out,
        style: o.style as BoxStyle | undefined,
        background: o.background === "none" ? null : o.background,
        trustedPaths: true,
      });
      if (o.json) return console.log(JSON.stringify(res, null, 2));
      for (const d of res.dirs) console.log(`exported ${d}`);
      console.log(`  ${res.files.length} files`);
      res.warnings.forEach((w) => console.log(`  warning: ${w}`));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("portraits-list")
  .description("List portrait sets in the workspace")
  .option("--workspace <path>")
  .action(async (o: { workspace?: string }) => {
    for (const p of await listPortraits(workspaceOf(o.workspace))) console.log(`${p.id.padEnd(18)} ${p.emotions.join(", ")}`);
  });

program
  .command("serve")
  .description("Web editor + API (default http://127.0.0.1:8798)")
  .option("--port <port>", "Port", "8798")
  .option("--host <host>", "Interface (non-loopback requires the printed token)", "127.0.0.1")
  .option("--dev", "API only; use the Vite UI on :5175")
  .option("--open", "Open the browser")
  .option("--workspace <path>")
  .action(async (o: { port: string; host: string; dev?: boolean; open?: boolean; workspace?: string }) => {
    const root = workspaceOf(o.workspace);
    if (!existsSync(dirs(root).dialogues)) await initWorkspace(root);
    const token = resolveToken(o.host);
    const app = createApp({ workspaceRoot: root, webRoot: defaultWebRoot(), dev: o.dev, host: o.host, token });
    const port = Number(o.port);
    serve({ fetch: app.fetch, port, hostname: o.host }, () => {
      const url = `http://${o.host === "0.0.0.0" ? "127.0.0.1" : o.host}:${port}/`;
      console.log(`Easy Dialogue ${o.dev ? "API (dev)" : "editor"} → ${url}`);
      console.log(`Workspace ${root}`);
      if (token) console.log(`Token (needed off-loopback): ${url}?token=${token}`);
      if (o.dev) {
        // Vite runs separately: npm run dev:web  (proxy /api → this server)
        console.log("Run the UI with: npx vite --config web/vite.config.ts");
      }
      if (o.open) void open(o.dev ? "http://127.0.0.1:5175" : url);
    });
  });

program.parseAsync(process.argv).catch(fail);
