import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileScript } from "../shared/parser.js";
import type { CompileResult, DialogueDoc } from "../shared/types.js";
import { BOX_STYLES, type BoxStyle } from "../shared/types.js";
import { pkgRoot } from "./assets.js";
import { writeSampleBackground } from "./sampleBackground.js";

export const CONFIG_NAME = "easydialogue.config.json";
export const SCRIPT_EXT = ".ezd";
const SAFE_ID = /^[a-z0-9_-]+$/;

export interface EasyDialogueConfig {
  name: string;
  style: BoxStyle;
  viewport: { width: number; height: number };
  portraitScale: number;
  /** Default background for previews (relative to the workspace). */
  background: string;
  /** easysprite-cli.mjs for face re-compose (optional). */
  easysprite?: string;
}

export const DEFAULT_CONFIG: EasyDialogueConfig = {
  name: "Easy Dialogue Workspace",
  style: "teak",
  viewport: { width: 480, height: 270 },
  portraitScale: 2,
  background: "backgrounds/thai_village_street.png",
};

export function assertSafeId(id: unknown, label = "dialogue id"): string {
  if (typeof id !== "string" || !SAFE_ID.test(id)) throw new Error(`Invalid ${label} ${JSON.stringify(id)} (use a-z, 0-9, _ or -)`);
  return id;
}

export function assertStyle(style: unknown): BoxStyle {
  if (style === undefined) return "teak";
  if (typeof style !== "string" || !(BOX_STYLES as readonly string[]).includes(style)) throw new Error(`Unknown box style ${JSON.stringify(style)} (${BOX_STYLES.join(", ")})`);
  return style as BoxStyle;
}

export function resolveWorkspace(dir = process.cwd()): string {
  return path.resolve(dir);
}

export const dirs = (root: string) => ({
  dialogues: path.join(root, "dialogues"),
  portraits: path.join(root, "portraits"),
  backgrounds: path.join(root, "backgrounds"),
  exports: path.join(root, "exports"),
});

/** Writes outside the workspace must be inside one of these (env, `:`-separated). */
export function allowedRoots(root: string): string[] {
  const extra = (process.env.EASYDIALOGUE_ALLOWED_DIRS ?? "").split(path.delimiter).map((s) => s.trim()).filter(Boolean).map((p) => path.resolve(p));
  return [path.resolve(root), ...extra];
}

/** Resolve a user path (relative to the workspace) and refuse anything outside the allowed roots. */
export function resolveInside(root: string, p: string): string {
  const abs = path.resolve(root, p);
  const ok = allowedRoots(root).some((r) => abs === r || abs.startsWith(r + path.sep));
  if (!ok) throw new Error(`Path ${p} is outside the workspace (allow it with EASYDIALOGUE_ALLOWED_DIRS)`);
  return abs;
}

export async function initWorkspace(dir = process.cwd(), opts: { force?: boolean } = {}): Promise<string> {
  const root = resolveWorkspace(dir);
  const d = dirs(root);
  for (const p of Object.values(d)) await mkdir(p, { recursive: true });
  const cfg = path.join(root, CONFIG_NAME);
  if (!existsSync(cfg) || opts.force) await writeFile(cfg, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  const samples = path.join(pkgRoot, "samples");
  for (const f of await readdir(path.join(samples, "dialogues"))) {
    const dest = path.join(d.dialogues, f);
    if (!existsSync(dest) || opts.force) await copyFile(path.join(samples, "dialogues", f), dest);
  }
  const sp = path.join(samples, "portraits");
  if (existsSync(sp)) {
    for (const f of await readdir(sp)) {
      const dest = path.join(d.portraits, f);
      if (!existsSync(dest) || opts.force) await cp(path.join(sp, f), dest, { recursive: true });
    }
  }
  const sb = path.join(samples, "backgrounds");
  if (existsSync(sb)) {
    for (const f of await readdir(sb)) {
      const dest = path.join(d.backgrounds, f);
      if (!existsSync(dest) || opts.force) await copyFile(path.join(sb, f), dest);
    }
  }
  const dusk = path.join(d.backgrounds, "dusk_village.png");
  if (!existsSync(dusk) || opts.force) await writeSampleBackground(dusk);
  return root;
}

export async function loadConfig(root: string): Promise<EasyDialogueConfig> {
  const f = path.join(root, CONFIG_NAME);
  if (!existsSync(f)) return DEFAULT_CONFIG;
  const parsed = JSON.parse(await readFile(f, "utf8")) as Partial<EasyDialogueConfig>;
  return { ...DEFAULT_CONFIG, ...parsed, viewport: { ...DEFAULT_CONFIG.viewport, ...parsed.viewport } };
}

export function scriptPath(root: string, id: string): string {
  return path.join(dirs(root).dialogues, `${assertSafeId(id)}${SCRIPT_EXT}`);
}

export interface ScriptSummary {
  id: string;
  title: string;
  file: string;
  nodes: number;
  lines: number;
  choices: number;
  characters: string[];
  errors: number;
  warnings: number;
  modified: string;
}

export async function listScripts(root: string): Promise<ScriptSummary[]> {
  const d = dirs(root).dialogues;
  if (!existsSync(d)) return [];
  const out: ScriptSummary[] = [];
  for (const f of (await readdir(d)).sort()) {
    if (!f.endsWith(SCRIPT_EXT)) continue;
    const id = f.slice(0, -SCRIPT_EXT.length);
    if (!SAFE_ID.test(id)) continue;
    const file = path.join(d, f);
    const res = compileScript(await readFile(file, "utf8"), { id });
    const doc = res.doc;
    out.push({
      id,
      title: doc?.title ?? id,
      file,
      nodes: doc ? Object.keys(doc.nodes).length : 0,
      lines: doc?.meta.lines ?? 0,
      choices: doc?.meta.choices ?? 0,
      characters: doc ? Object.keys(doc.characters) : [],
      errors: res.errors.length,
      warnings: res.warnings.length,
      modified: (await stat(file)).mtime.toISOString(),
    });
  }
  return out;
}

export async function readScript(root: string, id: string): Promise<{ id: string; source: string; result: CompileResult }> {
  const file = scriptPath(root, id);
  if (!existsSync(file)) throw new Error(`Dialogue "${id}" not found (list them with: easydialogue list)`);
  const source = await readFile(file, "utf8");
  return { id, source, result: compileScript(source, { id }) };
}

/** Validate then save. Refuses to overwrite with a script that has errors unless `force`. */
export async function saveScript(root: string, id: string, source: string, opts: { force?: boolean; dryRun?: boolean } = {}): Promise<{ file: string; saved: boolean; result: CompileResult }> {
  const result = compileScript(source, { id: assertSafeId(id) });
  const file = scriptPath(root, id);
  if (opts.dryRun || (result.errors.length && !opts.force)) return { file, saved: false, result };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source.endsWith("\n") ? source : `${source}\n`);
  return { file, saved: true, result };
}

export async function compileById(root: string, id: string): Promise<DialogueDoc> {
  const { result } = await readScript(root, id);
  if (!result.doc) {
    const first = result.errors.slice(0, 5).map((e) => `  line ${e.line}: ${e.message}`).join("\n");
    throw new Error(`Dialogue "${id}" has ${result.errors.length} error(s):\n${first}`);
  }
  return result.doc;
}

export async function listPortraits(root: string): Promise<{ id: string; emotions: string[] }[]> {
  const d = dirs(root).portraits;
  if (!existsSync(d)) return [];
  const out: { id: string; emotions: string[] }[] = [];
  for (const ent of await readdir(d, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const emotions = (await readdir(path.join(d, ent.name))).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)).sort();
    out.push({ id: ent.name, emotions });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function listBackgrounds(root: string): Promise<string[]> {
  const d = dirs(root).backgrounds;
  if (!existsSync(d)) return [];
  return (await readdir(d)).filter((f) => f.endsWith(".png")).sort();
}

export async function workspaceSummary(root: string) {
  return {
    root,
    config: await loadConfig(root),
    ...dirs(root),
    scripts: await listScripts(root),
    portraits: await listPortraits(root),
    backgrounds: await listBackgrounds(root),
  };
}
