import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { access } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MCP_TOOL_NAMES, createEasyDialogueMcp } from "../src/mcp/server.js";
import { createApp } from "../src/server/app.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
let client: Client;
beforeAll(async () => {
  ({ root, cleanup } = await tempWorkspace());
  const server = createEasyDialogueMcp(root);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(b);
});
afterAll(async () => {
  await client.close();
  await cleanup();
});

const body = (res: unknown) => JSON.parse(((res as { content: Array<{ text: string }> }).content[0]!).text);

describe("MCP server", () => {
  it("lists the seven tools", async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([...MCP_TOOL_NAMES].sort());
    expect(tools).toHaveLength(7);
  });

  it("writes, validates, previews and exports a script end to end", async () => {
    const info = body(await client.callTool({ name: "workspace_info", arguments: {} }));
    expect(info.dialogues.map((d: { id: string }) => d.id)).toContain("village_delivery");
    expect(info.syntax).toMatch(/===/);

    const bad = body(await client.callTool({ name: "write_dialogue", arguments: { id: "mcp_test", source: "=== a\n-> b\n" } }));
    expect(bad.saved).toBe(false);
    expect(bad.errors[0].line).toBe(2);

    const src = `@char kid "ต้น" portrait=town_kid\n=== a\nkid [happy]: สวัสดีครับ\n* ไปตลาด -> b\n* กลับบ้าน -> END\n=== b\nkid: ถึงแล้ว\n`;
    const good = body(await client.callTool({ name: "write_dialogue", arguments: { id: "mcp_test", source: src } }));
    expect(good.saved).toBe(true);
    const got = body(await client.callTool({ name: "get_dialogue", arguments: { id: "mcp_test", picks: [0] } }));
    expect(got.playthrough.transcript.at(-1)).toBe("ต้น: ถึงแล้ว");

    const preview = await client.callTool({ name: "render_preview", arguments: { id: "mcp_test", choice: 1, scale: 1 } });
    const content = preview.content as Array<{ type: string; mimeType?: string }>;
    expect(content.some((c) => c.type === "image" && c.mimeType === "image/png")).toBe(true);

    const exported = body(await client.callTool({ name: "export_dialogue", arguments: { id: "mcp_test", preset: "godot" } }));
    for (const d of exported.dirs) await access(d);
    const escape = await client.callTool({ name: "export_dialogue", arguments: { id: "mcp_test", preset: "json", out: "../../outside" } });
    expect((escape as { isError?: boolean }).isError).toBe(true);
  });
});

describe("HTTP API", () => {
  it("serves scripts, compile and render", async () => {
    const app = createApp({ workspaceRoot: root, webRoot: "/nonexistent" });
    const h = { host: "127.0.0.1:8798" };
    const health = await app.request("/api/health", { headers: h });
    expect(health.status).toBe(200);
    const list = await (await app.request("/api/scripts", { headers: h })).json();
    expect(JSON.stringify(list)).toMatch(/village_delivery/);
    const comp = await app.request("/api/compile", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ source: "=== a\n-> zz\n" }) });
    const cj = (await comp.json()) as { errors: { line: number }[] };
    expect(cj.errors[0].line).toBe(2);
    const cross = await app.request("/api/scripts/x", { method: "POST", headers: { ...h, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    expect(cross.status).toBe(403);
  });
});
