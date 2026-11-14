import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { serveStatic } from "@hono/node-server/serve-static";
import { DEV_UI_ORIGINS, checkRequest } from "../shared/requestGuard.js";
import { compileScript, nodeEdges } from "../shared/parser.js";
import { findMoment, type MomentQuery } from "../shared/moment.js";
import type { BoxStyle } from "../shared/types.js";
import { exportDialogue, type ExportPreset } from "../lib/export.js";
import { makePortraits } from "../lib/portraits.js";
import { renderDialogue } from "../lib/render.js";
import {
  assertSafeId,
  assertStyle,
  dirs,
  loadConfig,
  readScript,
  resolveInside,
  saveScript,
  listScripts,
  workspaceSummary,
} from "../lib/workspace.js";

export interface CreateAppOptions {
  workspaceRoot: string;
  webRoot?: string;
  dev?: boolean;
  host?: string;
  token?: string;
}

const TOKEN_COOKIE = "easydialogue_token";
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

function tokenPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>Easy Dialogue</title>
<body style="font-family:system-ui;background:#1a1410;color:#f3e7d3;padding:2rem">
<h1>Easy Dialogue token required</h1>
<p>Paste the token printed in the terminal that started Easy Dialogue.</p>
<form method="get"><input name="token" autocomplete="off" style="width:22rem"> <button>Open</button></form>
</body>`;
}

const png = (buf: Buffer) => new Uint8Array(buf);

export function createApp(options: CreateAppOptions): Hono {
  const app = new Hono();
  const { workspaceRoot: root, webRoot, dev, host = "127.0.0.1", token } = options;
  const guard = { bindHost: host, token, extraOrigins: dev ? DEV_UI_ORIGINS : [] };

  app.use("*", async (c, next) => {
    const queryToken = c.req.query("token");
    const provided = c.req.header("x-easydialogue-token") ?? queryToken ?? getCookie(c, TOKEN_COOKIE);
    const denied = checkRequest(guard, { method: c.req.method, host: c.req.header("host"), origin: c.req.header("origin"), token: provided });
    if (denied) {
      if (denied.status === 401 && c.req.method === "GET" && !c.req.path.startsWith("/api/")) return c.html(tokenPage(), 401);
      return c.json({ error: denied.error }, denied.status);
    }
    if (token && queryToken) setCookie(c, TOKEN_COOKIE, queryToken, { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 60 * 60 * 24 * 365 });
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, workspaceRoot: root }));
  app.get("/api/workspace", async (c) => c.json(await workspaceSummary(root)));
  app.get("/api/scripts", async (c) => c.json({ scripts: await listScripts(root) }));

  app.get("/api/scripts/:id", async (c) => {
    try {
      const s = await readScript(root, c.req.param("id"));
      return c.json({ id: s.id, source: s.source, ...s.result, edges: s.result.doc ? nodeEdges(s.result.doc) : [] });
    } catch (e) {
      return c.json({ error: fail(e) }, 404);
    }
  });

  app.post("/api/scripts/:id", async (c) => {
    try {
      const body = (await c.req.json()) as { source: string; force?: boolean };
      const res = await saveScript(root, c.req.param("id"), String(body.source ?? ""), { force: body.force });
      return c.json({ ok: res.saved, file: res.file, errors: res.result.errors, warnings: res.result.warnings });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  app.post("/api/compile", async (c) => {
    try {
      const body = (await c.req.json()) as { source: string; id?: string };
      const res = compileScript(String(body.source ?? ""), { id: body.id });
      return c.json({ ...res, edges: res.doc ? nodeEdges(res.doc) : [] });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  app.get("/api/portraits/:id/:file", async (c) => {
    try {
      const id = assertSafeId(c.req.param("id"), "portrait id");
      const emo = c.req.param("file").replace(/\.png$/, "");
      if (!/^[a-z0-9_-]+$/.test(emo)) throw new Error("bad emotion");
      let f = path.join(dirs(root).portraits, id, `${emo}.png`);
      if (!existsSync(f)) f = path.join(dirs(root).portraits, id, "neutral.png");
      return c.body(png(await readFile(f)), 200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
    } catch (e) {
      return c.json({ error: fail(e) }, 404);
    }
  });

  app.get("/api/backgrounds/:file", async (c) => {
    try {
      const name = c.req.param("file");
      if (!/^[A-Za-z0-9_.-]+\.png$/.test(name)) throw new Error("bad file");
      return c.body(png(await readFile(path.join(dirs(root).backgrounds, name))), 200, { "Content-Type": "image/png" });
    } catch (e) {
      return c.json({ error: fail(e) }, 404);
    }
  });

  app.post("/api/render", async (c) => {
    try {
      const body = (await c.req.json()) as { id?: string; source?: string; moment?: MomentQuery; style?: BoxStyle; background?: string | null; scale?: number };
      const cfg = await loadConfig(root);
      const result = body.source !== undefined ? compileScript(body.source, { id: body.id }) : (await readScript(root, assertSafeId(body.id))).result;
      if (!result.doc) return c.json({ error: "Script has errors", errors: result.errors }, 400);
      const m = findMoment(result.doc, body.moment ?? {});
      const bg = body.background === null ? null : resolveInside(root, body.background ?? cfg.background);
      const buf = await renderDialogue({
        line: m.line,
        choices: m.choices,
        style: assertStyle(body.style ?? result.doc.box ?? cfg.style),
        background: bg && existsSync(bg) ? bg : null,
        portraitsDir: dirs(root).portraits,
        scale: body.scale ?? 3,
      });
      return c.body(png(buf), 200, { "Content-Type": "image/png" });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  app.post("/api/export", async (c) => {
    try {
      const body = (await c.req.json()) as { id: string; preset?: ExportPreset; style?: BoxStyle; background?: string | null; out?: string };
      const res = await exportDialogue(root, { id: assertSafeId(body.id), preset: body.preset, style: body.style, background: body.background, out: body.out });
      return c.json({ ok: true, ...res, files: res.files.length });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  app.post("/api/portraits", async (c) => {
    try {
      const body = (await c.req.json()) as { sheet: string; id?: string; emotions?: string[]; scale?: number };
      const sheet = resolveInside(root, body.sheet);
      const cfg = await loadConfig(root);
      const res = await makePortraits({ sheet, id: body.id, emotions: body.emotions, scale: body.scale ?? cfg.portraitScale, outDir: dirs(root).portraits, easysprite: cfg.easysprite });
      return c.json({ ok: true, id: res.id, emotions: Object.keys(res.files), faceSwap: res.faceSwap, warnings: res.warnings });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  if (!dev && webRoot) {
    app.use("/*", serveStatic({ root: webRoot }));
    app.get("*", async (c) => {
      try {
        return c.html((await readFile(path.join(webRoot, "index.html"))).toString("utf8"));
      } catch {
        return c.text("Web UI not built yet. Run npm run build:web or start with --dev.", 503);
      }
    });
  } else if (dev) {
    app.get("/", (c) =>
      c.html(`<!doctype html><meta charset="utf-8"><title>Easy Dialogue (dev)</title>
<body style="font-family:system-ui;background:#1a1410;color:#f3e7d3;padding:2rem">
<h1>Easy Dialogue API is running</h1><p>Workspace: <code>${root}</code></p>
<p>Open the Vite UI at <a href="http://127.0.0.1:5175" style="color:#f0c36a">http://127.0.0.1:5175</a></p></body>`),
    );
  }
  return app;
}

export function defaultWebRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, "../web/dist"), path.resolve(here, "../../web/dist")];
  return candidates.find((p) => existsSync(path.join(p, "index.html"))) ?? candidates[1]!;
}
