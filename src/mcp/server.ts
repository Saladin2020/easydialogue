#!/usr/bin/env node
/**
 * Easy Dialogue MCP server (stdio by default; optional Streamable HTTP).
 *
 *   npx tsx src/mcp/server.ts
 *   npx tsx src/mcp/server.ts --http --port 8799
 *
 * Env: EASYDIALOGUE_WORKSPACE  absolute path to the workspace (default: cwd)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { z } from "zod";
import { checkRequest, resolveToken } from "../shared/requestGuard.js";
import { collectLines, nodeEdges } from "../shared/parser.js";
import { findMoment } from "../shared/moment.js";
import { autoplay } from "../shared/runner.js";
import { BOX_STYLES, EMOTIONS, type BoxStyle } from "../shared/types.js";
import { STYLE_LABELS } from "../shared/ui.js";
import { EXPORT_PRESETS, exportDialogue } from "../lib/export.js";
import { makePortraits } from "../lib/portraits.js";
import { renderDialogue } from "../lib/render.js";
import { assertStyle, dirs, loadConfig, readScript, resolveInside, resolveWorkspace, saveScript, listScripts, workspaceSummary } from "../lib/workspace.js";

export const MCP_TOOL_NAMES = [
  "workspace_info",
  "list_dialogues",
  "get_dialogue",
  "write_dialogue",
  "make_portraits",
  "render_preview",
  "export_dialogue",
] as const;

const IdSchema = z.string().regex(/^[a-z0-9_-]+$/, "Use a-z, 0-9, _ or -");

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function err(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const SYNTAX_CHEATSHEET = `@title …  @start node  @var name = 0  @char id "ชื่อ" portrait=set color=#hex side=left|right voice=…
=== node_id
speaker [emotion]: ข้อความ {var}      (narration: plain text or "> text")
* ตัวเลือก -> node        * [if coins >= 5] ตัวเลือก     (indented body under a choice)
if cond: / elif cond: / else:   (indented)    ~ var += 1    -> node   -> END    @event args
Emotions: ${EMOTIONS.join(", ")} (Thai aliases ดีใจ เศร้า ตกใจ โกรธ คิด เขิน).`;

function parseArgs(argv: string[]) {
  const out = { http: false, port: 8799, host: "127.0.0.1", workspace: process.env.EASYDIALOGUE_WORKSPACE ?? process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--http") out.http = true;
    else if (a === "--port") out.port = Number(argv[++i] ?? out.port);
    else if (a === "--host") out.host = argv[++i] ?? out.host;
    else if (a === "--workspace") out.workspace = argv[++i] ?? out.workspace;
  }
  return out;
}

export function createEasyDialogueMcp(workspaceRoot: string): McpServer {
  const root = resolveWorkspace(workspaceRoot);
  const server = new McpServer({ name: "easydialogue", version: "0.1.0" });

  server.registerTool(
    "workspace_info",
    {
      title: "Workspace info",
      description: "Summarize the Easy Dialogue workspace (dialogues, portrait sets, backgrounds, box styles, emotions, export presets) and the .ezd script syntax. Call this first.",
      inputSchema: {},
    },
    async () => {
      const s = await workspaceSummary(root);
      return text({
        name: "easydialogue",
        root: s.root,
        config: s.config,
        dialogues: s.scripts.map((x) => ({ id: x.id, title: x.title, nodes: x.nodes, lines: x.lines, errors: x.errors })),
        portraits: s.portraits,
        backgrounds: s.backgrounds,
        boxStyles: BOX_STYLES.map((b) => ({ id: b, label: STYLE_LABELS[b] })),
        emotions: EMOTIONS,
        exportPresets: EXPORT_PRESETS,
        syntax: SYNTAX_CHEATSHEET,
      });
    },
  );

  server.registerTool(
    "list_dialogues",
    { title: "List dialogues", description: "List .ezd scripts with node/line/choice counts and error/warning counts.", inputSchema: {} },
    async () => text({ dialogues: await listScripts(root) }),
  );

  server.registerTool(
    "get_dialogue",
    {
      title: "Get dialogue",
      description: "Read a script: source, line-numbered errors/warnings, nodes + jump graph, spoken lines. Pass picks to also get a play-through transcript.",
      inputSchema: {
        id: IdSchema,
        picks: z.array(z.number().int().min(0)).optional().describe("Choice positions for a transcript, e.g. [0,1]"),
        includeSource: z.boolean().optional().describe("Default true"),
      },
    },
    async ({ id, picks, includeSource }) => {
      try {
        const s = await readScript(root, id);
        const doc = s.result.doc;
        return text({
          id,
          ...(includeSource === false ? {} : { source: s.source }),
          errors: s.result.errors,
          warnings: s.result.warnings,
          ...(doc
            ? {
                title: doc.title,
                start: doc.start,
                variables: doc.variables,
                characters: doc.characters,
                nodes: Object.keys(doc.nodes),
                edges: nodeEdges(doc),
                lines: collectLines(doc).map((l) => ({ id: l.id, kind: l.kind, speaker: l.speaker, emotion: l.emotion, text: l.text, line: l.src })),
                ...(picks ? { playthrough: autoplay(doc, picks) } : {}),
              }
            : {}),
        });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "write_dialogue",
    {
      title: "Write dialogue",
      description: `Validate and save an .ezd script (dialogues/<id>.ezd). Refuses to save when there are errors unless force; dryRun only validates. Syntax:\n${SYNTAX_CHEATSHEET}`,
      inputSchema: {
        id: IdSchema,
        source: z.string().min(1).describe("Full .ezd script text (UTF-8, Thai welcome)"),
        dryRun: z.boolean().optional(),
        force: z.boolean().optional(),
      },
    },
    async ({ id, source, dryRun, force }) => {
      try {
        const res = await saveScript(root, id, source, { dryRun, force });
        return text({ saved: res.saved, file: res.file, errors: res.result.errors, warnings: res.result.warnings, nodes: res.result.doc ? Object.keys(res.result.doc.nodes) : [] });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "make_portraits",
    {
      title: "Make portraits",
      description: "Crop dialogue portraits (+ emotion variants) from an Easy Sprite native sheet (.png with sibling .json). Writes portraits/<id>/<emotion>.png. The sheet must be inside the workspace or EASYDIALOGUE_ALLOWED_DIRS.",
      inputSchema: {
        sheet: z.string().describe("Path to the Easy Sprite sheet (.png)"),
        id: IdSchema.optional().describe("Portrait set id used by @char portrait=… (default: sheet name)"),
        emotions: z.array(z.string()).optional(),
        scale: z.number().int().min(1).max(8).optional(),
      },
    },
    async ({ sheet, id, emotions, scale }) => {
      try {
        const cfg = await loadConfig(root);
        const file = resolveInside(root, sheet);
        const res = await makePortraits({ sheet: file, id, emotions, scale: scale ?? cfg.portraitScale, outDir: dirs(root).portraits, easysprite: cfg.easysprite });
        return text({ id: res.id, dir: res.dir, emotions: Object.keys(res.files), size: res.size, faceSwap: res.faceSwap, warnings: res.warnings });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "render_preview",
    {
      title: "Render preview",
      description: "Render a PNG of one moment (the N-th line or K-th choice screen) over a background, saved under exports/previews/, and return it as an image.",
      inputSchema: {
        id: IdSchema,
        line: z.number().int().min(1).optional().describe("N-th line on the path (default 1)"),
        lineId: z.string().optional(),
        choice: z.number().int().min(1).optional().describe("K-th choice screen"),
        picks: z.array(z.number().int().min(0)).optional(),
        style: z.enum(BOX_STYLES).optional(),
        background: z.string().optional().describe("Workspace-relative PNG, or 'none'"),
        scale: z.number().int().min(1).max(4).optional().describe("Default 2"),
      },
    },
    async ({ id, line, lineId, choice, picks, style, background, scale }) => {
      try {
        const cfg = await loadConfig(root);
        const s = await readScript(root, id);
        if (!s.result.doc) return err(`Script has errors:\n${s.result.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n")}`);
        const m = findMoment(s.result.doc, { line, lineId, choice, picks });
        const bgRel = background ?? cfg.background;
        const bg = bgRel === "none" ? null : resolveInside(root, bgRel);
        const buf = await renderDialogue({
          line: m.line,
          choices: m.choices,
          style: assertStyle((style ?? s.result.doc.box ?? cfg.style) as BoxStyle),
          background: bg && existsSync(bg) ? bg : null,
          portraitsDir: dirs(root).portraits,
          scale: scale ?? 2,
        });
        const out = path.join(dirs(root).exports, "previews", `${id}-${choice ? `choice${choice}` : m.line?.id ?? "line"}.png`);
        await mkdir(path.dirname(out), { recursive: true });
        await writeFile(out, buf);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ file: out, line: m.line && { id: m.line.id, name: m.line.name, text: m.line.text }, choices: m.choices?.options.map((o) => o.text) ?? null }, null, 2) },
            { type: "image" as const, data: buf.toString("base64"), mimeType: "image/png" },
          ],
        };
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "export_dialogue",
    {
      title: "Export dialogue",
      description: "Export to json (compiled easydialogue/1), pixi (PixiJS v8 runtime + demo), godot (Godot 4.3+ project with runner + DialogueBox scene), voice (ElevenLabs-ready manifest only — never calls the API) or all.",
      inputSchema: {
        id: IdSchema,
        preset: z.enum(EXPORT_PRESETS).optional().describe("Default all"),
        style: z.enum(BOX_STYLES).optional(),
        background: z.string().optional().describe("Workspace-relative PNG for the demo, or 'none'"),
        out: z.string().optional().describe("Workspace-relative output folder"),
      },
    },
    async ({ id, preset, style, background, out }) => {
      try {
        const res = await exportDialogue(root, { id, preset, style, background: background === "none" ? null : background, out });
        return text({ dirs: res.dirs, files: res.files.length, warnings: res.warnings });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  return server;
}

async function startMcp(opts: ReturnType<typeof parseArgs>) {
  const workspace = resolveWorkspace(opts.workspace);
  if (opts.http) return startHttp(workspace, opts.host, opts.port);
  await createEasyDialogueMcp(workspace).connect(new StdioServerTransport());
}

async function startHttp(workspace: string, host: string, port: number) {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const sessions = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();
  const token = resolveToken(host);
  if (token) console.error(`Non-loopback host: send "Authorization: Bearer <token>" — token printed once: ${token}`);
  const httpServer = createServer(async (req, res) => {
    const auth = req.headers.authorization;
    const denied = checkRequest(
      { bindHost: host, token },
      { method: req.method ?? "GET", host: req.headers.host, origin: req.headers.origin, token: auth?.startsWith("Bearer ") ? auth.slice(7) : (req.headers["x-easydialogue-token"] as string | undefined) },
    );
    if (denied) {
      res.writeHead(denied.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: denied.error }));
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (url.pathname !== "/mcp") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "easydialogue", transport: "streamable-http", endpoint: `http://${host}:${port}/mcp`, workspace }));
      return;
    }
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    try {
      if (req.method === "POST") {
        let transport = sessionId ? sessions.get(sessionId) : undefined;
        if (!transport) {
          const mcp = createEasyDialogueMcp(workspace);
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id: string) => {
              sessions.set(id, transport!);
            },
          });
          transport.onclose = () => {
            const id = transport!.sessionId;
            if (id) sessions.delete(id);
          };
          await mcp.connect(transport);
        }
        await transport.handleRequest(req, res);
        return;
      }
      if (req.method === "GET" || req.method === "DELETE") {
        const transport = sessionId ? sessions.get(sessionId) : undefined;
        if (!transport) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid or missing mcp-session-id" }));
          return;
        }
        await transport.handleRequest(req, res);
        return;
      }
      res.writeHead(405).end();
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg(e) }));
      }
    }
  });
  httpServer.listen(port, host, () => {
    console.error(`Easy Dialogue MCP (HTTP) http://${host}:${port}/mcp`);
    console.error(`Workspace ${workspace}`);
  });
}

function entryIndex(): number {
  return process.argv.findIndex((arg) => /(?:^|[/\\])mcp[/\\]server\.(?:ts|js|mjs)$/i.test(arg));
}

if (entryIndex() >= 0) {
  await startMcp(parseArgs(process.argv.slice(entryIndex() + 1)));
}
