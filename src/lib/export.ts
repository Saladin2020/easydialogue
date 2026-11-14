import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FRAME_FILES } from "../shared/frames.js";
import { collectLines } from "../shared/parser.js";
import { DEFAULT_LAYOUT, STYLE_COLORS } from "../shared/ui.js";
import type { BoxStyle, DialogueDoc, Stmt } from "../shared/types.js";
import { FONT_DIR, RUNTIME_DIR } from "./assets.js";
import { encodePng } from "./raster.js";
import { assertSafeId, assertStyle, compileById, dirs, loadConfig, resolveInside } from "./workspace.js";
import { portraitFile } from "./render.js";

export const EXPORT_PRESETS = ["json", "pixi", "godot", "voice", "all"] as const;
export type ExportPreset = (typeof EXPORT_PRESETS)[number];

export interface ExportOptions {
  id: string;
  preset?: ExportPreset;
  /** Output folder (default `exports/<id>-<preset>`). Relative paths resolve inside the workspace. */
  out?: string;
  style?: BoxStyle;
  /** Background PNG for the demo scene (workspace-relative or absolute); null = none. */
  background?: string | null;
  /** CLI callers may write anywhere they named; API/MCP stay inside the workspace. */
  trustedPaths?: boolean;
}

export interface ExportResult {
  preset: ExportPreset;
  dirs: string[];
  files: string[];
  warnings: string[];
}

export const MARGINS = { box: FRAME_FILES.box.margin, plate: FRAME_FILES.plate.margin, well: FRAME_FILES.well.margin };

/** Emotions each portrait set actually needs (always including neutral). */
export function portraitUsage(doc: DialogueDoc): Map<string, Set<string>> {
  const need = new Map<string, Set<string>>();
  for (const c of Object.values(doc.characters)) if (c.portrait) need.set(c.portrait, new Set(["neutral"]));
  const walk = (body: Stmt[]) => {
    for (const s of body) {
      if (s.t === "line" && s.speaker) {
        const p = doc.characters[s.speaker]?.portrait;
        if (p) need.get(p)!.add(s.emotion ?? "neutral");
      } else if (s.t === "choice") s.options.forEach((o) => walk(o.body));
      else if (s.t === "if") s.branches.forEach((b) => walk(b.body));
    }
  };
  for (const n of Object.values(doc.nodes)) walk(n.body);
  return need;
}

class Writer {
  files: string[] = [];
  constructor(public root: string) {}
  async text(rel: string, body: string) {
    const f = path.join(this.root, rel);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body);
    this.files.push(f);
  }
  async bin(rel: string, body: Buffer) {
    const f = path.join(this.root, rel);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body);
    this.files.push(f);
  }
  async copy(src: string, rel: string) {
    const f = path.join(this.root, rel);
    await mkdir(path.dirname(f), { recursive: true });
    await copyFile(src, f);
    this.files.push(f);
  }
}

interface BundleCtx {
  doc: DialogueDoc;
  style: BoxStyle;
  portraitsDir: string;
  background: string | null;
  warnings: string[];
}

/** Write frames, portraits, fonts and background; return the asset map (paths relative to `prefix`). */
async function writeAssets(w: Writer, ctx: BundleCtx, prefix: string) {
  const frames: Record<string, string> = {};
  for (const [k, def] of Object.entries(FRAME_FILES)) {
    const rel = `frames/${ctx.style}/${k}.png`;
    const px = def.make(ctx.style);
    await w.bin(rel, encodePng(px));
    frames[k] = prefix + rel;
  }
  const portraits: Record<string, Record<string, string>> = {};
  for (const [pid, emos] of portraitUsage(ctx.doc)) {
    for (const emo of emos) {
      const src = portraitFile(ctx.portraitsDir, pid, emo);
      if (!src) {
        if (emo === "neutral") ctx.warnings.push(`Portrait "${pid}" not found in portraits/ (run: easydialogue portraits --sheet <easysprite.png> --id ${pid})`);
        continue;
      }
      const rel = `portraits/${pid}/${path.basename(src)}`;
      if (!w.files.includes(path.join(w.root, rel))) await w.copy(src, rel);
      (portraits[pid] ??= {})[emo] = prefix + rel;
    }
  }
  await w.copy(path.join(FONT_DIR, "Kanit-Regular.ttf"), "fonts/Kanit-Regular.ttf");
  await w.copy(path.join(FONT_DIR, "Kanit-Medium.ttf"), "fonts/Kanit-Medium.ttf");
  await w.copy(path.join(FONT_DIR, "OFL.txt"), "fonts/OFL.txt");
  let background: string | undefined;
  if (ctx.background) {
    if (existsSync(ctx.background)) {
      await w.copy(ctx.background, "background.png");
      background = `${prefix}background.png`;
    } else ctx.warnings.push(`Background ${ctx.background} not found — exported without one`);
  }
  return {
    frames,
    portraits,
    fonts: { Kanit: `${prefix}fonts/Kanit-Regular.ttf`, "Kanit Medium": `${prefix}fonts/Kanit-Medium.ttf` },
    fontFiles: { body: `${prefix}fonts/Kanit-Regular.ttf`, name: `${prefix}fonts/Kanit-Medium.ttf` },
    ...(background ? { background } : {}),
  };
}

export function bundleUi(style: BoxStyle) {
  return { style, layout: DEFAULT_LAYOUT, colors: STYLE_COLORS[style], margins: MARGINS, font: "Kanit", fontName: "Kanit Medium" };
}

export function voiceManifest(doc: DialogueDoc) {
  const lines = collectLines(doc).filter((l) => l.kind === "line");
  return {
    format: "easydialogue-voice/1",
    dialogue: doc.id,
    title: doc.title,
    lang: doc.lang,
    provider: "elevenlabs",
    note: "Manifest only. Easy Dialogue never calls ElevenLabs. Generate each line yourself (e.g. text-to-speech with the character's voice) and save it as `file`.",
    characters: Object.fromEntries(Object.values(doc.characters).map((c) => [c.id, { name: c.name, voice: c.voice ?? null }])),
    lines: lines.map((l) => {
      const c = l.speaker ? doc.characters[l.speaker] : undefined;
      return {
        id: l.id,
        node: l.node,
        speaker: l.speaker ?? null,
        name: c?.name ?? l.speaker ?? "",
        voice: c?.voice ?? null,
        emotion: l.emotion ?? "neutral",
        text: l.text,
        dynamic: /(?<!\\)\{[^}]+\}/.test(l.text),
        file: `voice/${l.id}.mp3`,
      };
    }),
  };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportDialogue(root: string, opts: ExportOptions): Promise<ExportResult> {
  const id = assertSafeId(opts.id);
  const preset = opts.preset ?? "all";
  if (!(EXPORT_PRESETS as readonly string[]).includes(preset)) throw new Error(`Unknown preset ${preset} (${EXPORT_PRESETS.join(", ")})`);
  const cfg = await loadConfig(root);
  const doc = await compileById(root, id);
  const style = assertStyle(opts.style ?? doc.box ?? cfg.style);
  const warnings: string[] = [];
  const bgOpt = opts.background === undefined ? cfg.background : opts.background;
  const background = bgOpt ? (opts.trustedPaths ? path.resolve(root, bgOpt) : resolveInside(root, bgOpt)) : null;
  const ctx: BundleCtx = { doc, style, portraitsDir: dirs(root).portraits, background, warnings };
  const outFor = (p: string) => {
    if (opts.out) {
      const base = opts.trustedPaths ? path.resolve(root, opts.out) : resolveInside(root, opts.out);
      return preset === "all" ? path.join(base, `${id}-${p}`) : base;
    }
    return path.join(dirs(root).exports, `${id}-${p}`);
  };
  const res: ExportResult = { preset, dirs: [], files: [], warnings };
  const presets: ExportPreset[] = preset === "all" ? ["json", "pixi", "godot", "voice"] : [preset];
  for (const p of presets) {
    const w = new Writer(outFor(p));
    await mkdir(w.root, { recursive: true });
    if (p === "json") await w.text(`${id}.dialogue.json`, `${JSON.stringify(doc, null, 2)}\n`);
    if (p === "voice") await writeVoice(w, doc);
    if (p === "pixi") await writePixi(w, ctx);
    if (p === "godot") await writeGodot(w, ctx);
    res.dirs.push(w.root);
    res.files.push(...w.files);
  }
  res.warnings = [...new Set(warnings)];
  return res;
}

async function writeVoice(w: Writer, doc: DialogueDoc) {
  const m = voiceManifest(doc);
  await w.text(`${doc.id}.voice.json`, `${JSON.stringify(m, null, 2)}\n`);
  const head = ["id", "node", "speaker", "name", "voice", "emotion", "text", "dynamic", "file"];
  const rows = m.lines.map((l) => head.map((k) => csvCell((l as Record<string, unknown>)[k])).join(","));
  await w.text(`${doc.id}.voice.csv`, `\uFEFF${head.join(",")}\n${rows.join("\n")}\n`);
}

async function writePixi(w: Writer, ctx: BundleCtx) {
  const { doc } = ctx;
  const assets = await writeAssets(w, ctx, "");
  const bundle = { ...doc, ui: bundleUi(ctx.style), assets };
  await w.text(`${doc.id}.dialogue.json`, `${JSON.stringify(bundle, null, 2)}\n`);
  await w.copy(path.join(RUNTIME_DIR, "pixi", "easydialogue-runner.js"), "easydialogue-runner.js");
  await w.copy(path.join(RUNTIME_DIR, "pixi", "easydialogue-pixi.js"), "easydialogue-pixi.js");
  await w.text("index.html", pixiHtml(doc, !!assets.background));
  await w.text(
    "README.txt",
    `Easy Dialogue — PixiJS v8 export of "${doc.title}" (${doc.id})

Serve this folder over HTTP (fonts and JSON are fetched):  npx serve .   or   python3 -m http.server
Open index.html. Enter / Space / click = next line, ↑ ↓ + Enter (or 1-9) = choose.

Files
  ${doc.id}.dialogue.json   compiled easydialogue/1 + ui layout + asset paths
  easydialogue-runner.js    dialogue runner (no dependencies) — DialogueRunner, autoplay, wrapText
  easydialogue-pixi.js      DialogueBox for PixiJS v8 (NineSliceSprite frame, portrait, typewriter, choices)
  frames/ portraits/ fonts/ background.png

index.html loads ./pixi.min.js when present, else PixiJS v8 from jsDelivr.
Kanit is SIL OFL 1.1 (fonts/OFL.txt). Frames are CC0. Generated by Easy Dialogue (MIT).
`,
  );
}

function pixiHtml(doc: DialogueDoc, hasBg: boolean): string {
  const title = doc.title.replace(/</g, "&lt;");
  return `<!doctype html>
<html lang="${doc.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Easy Dialogue (PixiJS v8)</title>
  <link rel="icon" href="data:,">
  <style>
    html, body { margin: 0; min-height: 100vh; background: #140e0a; color: #f7ebd3; font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    canvas { image-rendering: pixelated; width: min(1440px, 96vw); aspect-ratio: 16 / 9; height: auto; }
    p { opacity: .7; font-size: 13px; margin: 10px; }
  </style>
</head>
<body>
  <p>Enter / Space / click: next · ↑ ↓ + Enter or 1-9: choose · R: restart</p>
  <script>
    // Local pixi.min.js if you dropped one next to this file, else the CDN build.
    window.__pixiReady = new Promise((ok, fail) => {
      const tryLoad = (src, next) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = next; document.head.appendChild(s); };
      tryLoad("./pixi.min.js", () => tryLoad("https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js", () => fail(new Error("PixiJS not found"))));
    });
  </script>
  <script type="module">
    import { loadDialogue, DialogueBox } from "./easydialogue-pixi.js";
    await window.__pixiReady;
    const app = new PIXI.Application();
    await app.init({ width: 480, height: 270, resolution: 3, antialias: false, background: "#241d18", roundPixels: true });
    app.canvas.style.width = "";
    document.body.prepend(app.canvas);
    const bundle = await loadDialogue(PIXI, "./${doc.id}.dialogue.json");
    ${hasBg ? `const bg = new PIXI.Sprite(bundle.background);
    const k = Math.max(480 / bg.texture.width, 270 / bg.texture.height);
    bg.scale.set(k); bg.position.set((480 - bg.texture.width * k) / 2, 270 - bg.texture.height * k);
    app.stage.addChild(bg);` : ""}
    const log = [];
    const box = new DialogueBox(PIXI, bundle, {
      onLine: (ev) => log.push(\`\${ev.name ? ev.name + ": " : ""}\${ev.text}\`),
      onChoice: (o) => log.push("> " + o.text),
      onEvent: (name, args) => log.push("@" + [name, ...args].join(" ")),
      onEnd: (vars) => log.push("END " + JSON.stringify(vars)),
    });
    app.stage.addChild(box.view);
    app.ticker.add((t) => box.update(t.deltaMS / 1000));
    box.bindKeys(window, app.canvas);
    addEventListener("keydown", (e) => { if (e.key === "r" || e.key === "R") { log.length = 0; box.start(); } });
    box.start();
    // hooks for automated checks
    window.__ed = { box, log, app, state: () => ({ state: box.state, line: box.line && box.line.text, choices: box.choices && box.choices.options.map((o) => o.text), vars: box.runner.vars }) };
    window.__ready = true;
  </script>
</body>
</html>
`;
}

async function writeGodot(w: Writer, ctx: BundleCtx) {
  const { doc } = ctx;
  const assets = await writeAssets(w, ctx, "res://");
  const bundle = { ...doc, ui: bundleUi(ctx.style), assets };
  const jsonRel = `dialogue/${doc.id}.dialogue.json`;
  await w.text(jsonRel, `${JSON.stringify(bundle, null, 2)}\n`);
  for (const f of ["dialogue_runner.gd", "dialogue_box.gd", "dialogue_box.tscn"]) await w.copy(path.join(RUNTIME_DIR, "godot", f), `addons/easydialogue/${f}`);
  await w.text("addons/easydialogue/LICENSE.txt", "Easy Dialogue runtime — MIT License. Copyright (c) 2026 Salahuddin Benno.\nKanit font: SIL Open Font License 1.1 (see fonts/OFL.txt).\n");
  const hasBg = !!assets.background;
  await w.text(
    "project.godot",
    `; Engine configuration file — generated by Easy Dialogue.
config_version=5

[application]

config/name="${doc.title.replace(/"/g, "'")} (Easy Dialogue)"
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.3")

[display]

window/size/viewport_width=480
window/size/viewport_height=270
window/size/window_width_override=1440
window/size/window_height_override=810
window/stretch/mode="canvas_items"
window/stretch/scale_mode="integer"

[rendering]

textures/canvas_textures/default_texture_filter=0
renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"
`,
  );
  await w.text(
    "main.tscn",
    `[gd_scene load_steps=${hasBg ? 4 : 3} format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]
[ext_resource type="PackedScene" path="res://addons/easydialogue/dialogue_box.tscn" id="2_box"]
${hasBg ? '[ext_resource type="Texture2D" path="res://background.png" id="3_bg"]\n' : ""}
[node name="Main" type="Control"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2
script = ExtResource("1_main")

[node name="Background" type="${hasBg ? "TextureRect" : "ColorRect"}" parent="."]
layout_mode = 1
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2
mouse_filter = 2
${hasBg ? 'texture = ExtResource("3_bg")\nexpand_mode = 1\nstretch_mode = 6' : "color = Color(0.14, 0.11, 0.09, 1)"}

[node name="DialogueBox" parent="." instance=ExtResource("2_box")]
layout_mode = 1
dialogue_path = "res://${jsonRel}"
`,
  );
  await w.text(
    "main.gd",
    `extends Control
## Demo: plays the dialogue over the background. Enter / Space / click = next, ↑ ↓ = choose, R = restart.

@onready var box = $DialogueBox


func _ready() -> void:
	box.line_started.connect(func(ev): print("%s: %s" % [ev["name"], ev["text"]]) if ev["name"] != "" else print(ev["text"]))
	box.choice_made.connect(func(o): print("> ", o["text"]))
	box.event_fired.connect(func(n, a): print("@", n, " ", a))
	box.dialogue_finished.connect(func(vars): print("END ", vars))


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_R:
		box.start()
`,
  );
  await w.text(
    "test_runner.gd",
    `extends SceneTree
## Headless check (no window needed):
##   godot --headless --path . --script res://test_runner.gd -- picks=0,0
## Prints the transcript for the given choice picks, then drives the DialogueBox UI to the end.
## With a display (or xvfb-run) add  shot=/abs/path/line.png  to save the 2nd line and the first choice screen.

const DIALOGUE := "res://${jsonRel}"


func _initialize() -> void:
	_run.call_deferred()


func _arg(name: String) -> String:
	for a in OS.get_cmdline_user_args():
		if a.begins_with(name + "="):
			return a.substr(name.length() + 1)
	return ""


func _save(path: String) -> void:
	for i in 4:
		await process_frame
	var img := root.get_texture().get_image()
	if img == null or img.is_empty():
		print("SHOT| skipped (no renderer — run without --headless under xvfb-run)")
		return
	img.save_png(path)
	print("SHOT| ", path, " ", img.get_size())


func _run() -> void:
	var picks: Array = []
	for p in _arg("picks").split(",", false):
		picks.append(int(p))
	var shot := _arg("shot")
	var Runner = load("res://addons/easydialogue/dialogue_runner.gd")
	var r = Runner.new()
	if not r.load_file(DIALOGUE):
		print("FAIL load")
		quit(1)
		return
	for line in r.autoplay(picks):
		print("T| ", line)
	print("VARS| ", JSON.stringify(r.vars))
	var main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	var box = main.get_node("DialogueBox")
	print("UI| clusters(ผู้ใหญ่บ้าน)=", box._cluster_bounds("ผู้ใหญ่บ้าน"))
	if shot == "":
		box.chars_per_second = 2000.0
	await process_frame
	await process_frame
	var steps := 0
	var lines := 0
	var choice_shot := false
	while box.state != "end" and steps < 600:
		steps += 1
		if box.state == "choices":
			print("UI| choices=", box.current_choices["options"].size(), " panel=", box.choices.size)
			if shot != "" and not choice_shot:
				choice_shot = true
				await _save(shot.get_basename() + "-choices.png")
			box.choose(0)
		elif box.state == "typing":
			var seen_partial := false
			var guard := 0
			while box.state == "typing" and guard < 900:
				if box.body.visible_characters > 0:
					seen_partial = true
				await process_frame
				guard += 1
			lines += 1
			print("UI| line name=", box.name_label.text, " typed=", seen_partial, " portrait=", box.portrait.visible, " plate=", box.plate.size)
			if shot != "" and lines == 2:
				await _save(shot)
		else:
			box.advance()
	print("UI| final state=", box.state, " lines=", lines, " steps=", steps)
	print("OK")
	quit(0)
`,
  );
  await w.text(
    "README.txt",
    `Easy Dialogue — Godot 4.3+ export of "${doc.title}" (${doc.id})

Open this folder as a project (project.godot) and press F5. Enter / Space / click = next line,
↑ ↓ + Enter (or 1-9) = choose, R = restart.

Use it in your own game:
  1. Copy addons/easydialogue, fonts/, frames/, portraits/ and dialogue/ to your project root
     (asset paths in the JSON are res://… — keep the folders at the root or edit "assets").
  2. Instance addons/easydialogue/dialogue_box.tscn in a CanvasLayer, set dialogue_path
     (or call load_dialogue(path) then start()).
  3. Signals: line_started(ev), choice_made(option), event_fired(name, args), dialogue_finished(vars).
     "@camera market" lines in the script arrive as event_fired("camera", ["market"]).
  4. Logic only: var r = preload("res://addons/easydialogue/dialogue_runner.gd").new(); r.load_file(path); r.start(); r.next() / r.choose(i).

Headless check:  godot --headless --path . --script res://test_runner.gd -- picks=0,0
The project uses viewport 480×270 (canvas_items stretch, integer scale) and Nearest texture filtering;
text stays sharp because fonts are oversampled. Kanit: SIL OFL 1.1 (fonts/OFL.txt). Frames: CC0.
`,
  );
}
