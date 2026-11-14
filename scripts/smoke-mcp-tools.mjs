/** MCP smoke test: start the server over stdio and over HTTP like a client would and call tools. */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ws = mkdtempSync(path.join(os.tmpdir(), "easydialogue-smoke-"));
execFileSync("npx", ["tsx", "src/cli.ts", "init", "--workspace", ws], { stdio: "ignore" });
const fail = (m) => {
  console.error("FAIL", m);
  process.exitCode = 1;
};
const body = (r) => JSON.parse(r.content?.[0]?.text ?? "{}");

async function exercise(client, label) {
  const tools = (await client.listTools()).tools.map((t) => t.name);
  console.log(`[${label}] tools (${tools.length}):`, tools.join(", "));
  if (tools.length !== 7) fail(`${label}: expected 7 tools`);
  const info = body(await client.callTool({ name: "workspace_info", arguments: {} }));
  if (!info.dialogues?.length) fail(`${label}: workspace_info`);
  console.log(`[${label}] dialogues:`, info.dialogues?.map((s) => s.id).join(", "));
  const got = body(await client.callTool({ name: "get_dialogue", arguments: { id: "village_delivery", picks: [0, 0], includeSource: false } }));
  console.log(`[${label}] errors=${got.errors?.length} nodes=${got.nodes?.length} vars=${JSON.stringify(got.playthrough?.vars)}`);
  if (got.playthrough?.vars?.coins !== 15) fail(`${label}: playthrough`);
  const bad = body(await client.callTool({ name: "write_dialogue", arguments: { id: "smoke_bad", source: "=== a\n-> nope\n", dryRun: true } }));
  console.log(`[${label}] dry-run error:`, bad.errors?.[0] && `line ${bad.errors[0].line}: ${bad.errors[0].message}`);
  const prev = await client.callTool({ name: "render_preview", arguments: { id: "village_delivery", choice: 1, scale: 1 } });
  const img = prev.content?.find((c) => c.type === "image");
  console.log(`[${label}] preview image bytes:`, img ? Buffer.from(img.data, "base64").length : 0);
  if (!img) fail(`${label}: preview`);
}

// stdio
{
  const client = new Client({ name: "smoke", version: "0.0.1" });
  await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/mcp/server.ts", "--workspace", ws], cwd: process.cwd(), env: { ...process.env }, stderr: "ignore" }));
  await exercise(client, "stdio");
  const exp = body(await client.callTool({ name: "export_dialogue", arguments: { id: "village_delivery", preset: "voice" } }));
  console.log("[stdio] export voice:", exp.dirs?.map((d) => path.relative(ws, d)).join(", "), "files", exp.files);
  await client.close();
}

// HTTP (Streamable HTTP on a spare port)
{
  const port = 18799 + Math.floor(Math.random() * 500);
  const proc = spawn("npx", ["tsx", "src/mcp/server.ts", "--http", "--port", String(port), "--workspace", ws], { stdio: ["ignore", "ignore", "pipe"] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("MCP HTTP did not start")), 20000);
    proc.stderr.on("data", (d) => {
      if (/listening|http:\/\//i.test(String(d))) {
        clearTimeout(t);
        resolve();
      }
    });
  });
  const client = new Client({ name: "smoke-http", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  await exercise(client, "http");
  await client.close();
  proc.kill();
}

rmSync(ws, { recursive: true, force: true });
console.log(process.exitCode ? "MCP smoke FAILED" : "MCP smoke OK");
process.exit(process.exitCode ?? 0);
