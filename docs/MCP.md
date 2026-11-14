# Easy Dialogue MCP

MCP tools so an AI agent (Cursor, Claude Desktop, Grok bot, the Indie Studio team, …) can **write, validate,
preview and export** branching dialogue without opening the web UI. The agent writes `.ezd` text; Easy
Dialogue checks it (line-numbered errors), plays it, renders the dialogue box and exports it.
It never generates art or audio, and it **never calls ElevenLabs**: the `voice` export is a manifest.

## Transports

| Mode | When to use | Start |
|---|---|---|
| **stdio** (default) | Cursor, Claude Desktop, local agents | `npm run mcp` or `npx tsx src/mcp/server.ts --workspace <dir>` |
| **Streamable HTTP** | Remote / HTTP MCP clients | `npm run mcp:http` → `http://127.0.0.1:8799/mcp` · any port: `npx tsx src/mcp/server.ts --http --port 18799` |

Workspace root: `EASYDIALOGUE_WORKSPACE` or `--workspace <path>` (default: cwd). Create one with
`npx tsx src/cli.ts init --workspace <dir>`.
HTTP on a non-loopback `--host` requires `Authorization: Bearer <token>` (printed once at startup, or fixed via `EASYDIALOGUE_TOKEN`).
Files outside the workspace (e.g. Easy Sprite sheets for `make_portraits`) must be listed in `EASYDIALOGUE_ALLOWED_DIRS`.

Cursor `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "easydialogue": {
      "command": "npx",
      "args": ["tsx", "/path/to/easydialogue/src/mcp/server.ts"],
      "env": { "EASYDIALOGUE_WORKSPACE": "/path/to/my-game-dialogue" }
    }
  }
}
```

## Tools (7)

| Tool | What it does |
|---|---|
| `workspace_info` | dialogues (with error counts), portrait sets + emotions, backgrounds, box styles, emotions, export presets and the `.ezd` cheat sheet. Call first. |
| `list_dialogues` | scripts with node / line / choice / error / warning counts |
| `get_dialogue` | source, line-numbered errors + warnings, characters, variables, nodes + jump edges, every spoken line with its id; pass `picks: [0,1]` for a play-through transcript and final variables |
| `write_dialogue` | validate and save `dialogues/<id>.ezd`; refuses to save when there are errors unless `force`; `dryRun` only validates |
| `make_portraits` | crop 32×32 portraits (×`scale`) + emotion variants from an Easy Sprite native sheet (`.png` with its `.json`) into `portraits/<id>/` |
| `render_preview` | PNG of the N-th line (`line`), a line id (`lineId`) or the K-th choice screen (`choice`) after `picks`, in a box `style`, over a background — returned inline and saved in `exports/previews/` |
| `export_dialogue` | `json` · `pixi` · `godot` · `voice` · `all` into `exports/<id>-<preset>/` |

## Recommended flow

```text
workspace_info → write_dialogue (dryRun) → fix errors by line → write_dialogue
→ get_dialogue {picks} (check the branches) → render_preview (look at Thai text + portraits) → export_dialogue
```

Example `write_dialogue` arguments:

```json
{
  "id": "market_day",
  "source": "@char kid \"ต้น\" portrait=town_kid\n@char vendor \"ป้าแดง\" portrait=town_vendor side=right\n=== start\nvendor [happy]: มาแล้วเหรอต้น\n* ช่วยป้าขายของ -> help\n* ไปเล่นก่อนนะ -> END\n=== help\nkid: ได้เลยครับ\n",
  "dryRun": true
}
```

Errors come back as `{ "line": 5, "col": 1, "severity": "error", "message": "Jump to unknown node \"hlep\" (did you mean \"help\"?)" }`.
