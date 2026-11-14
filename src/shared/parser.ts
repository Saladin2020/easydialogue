import { ExprError, exprVars, parseExpr } from "./expr.js";
import {
  EMOTIONS,
  FORMAT,
  normalizeEmotion,
  type CharacterDef,
  type ChoiceOption,
  type CompileResult,
  type Diagnostic,
  type DialogueDoc,
  type DialogueNode,
  type Expr,
  type Stmt,
  type Value,
} from "./types.js";

/**
 * Easy Dialogue script (`.ezd`) → `easydialogue/1`.
 * See docs/SCRIPT_FORMAT.md for the language. Every error carries a 1-based line number.
 */

interface SrcLine {
  no: number;
  indent: number;
  text: string;
}

const NODE_RE = /^===\s*([\p{L}\p{N}_-]+)\s*(?:===)?\s*(.*)$/u;
const ID_RE = /^[\p{L}_][\p{L}\p{M}\p{N}_]*$/u;
const NODE_ID_RE = /^[\p{L}\p{N}_-]+$/u;
const SET_RE = /^~\s*\$?([\p{L}_][\p{L}\p{M}\p{N}_]*)\s*(=|\+=|-=|\*=|\/=)\s*(.+)$/u;
const SPEAKER_RE = /^([^:\[\]{}#*~@>\\]+?)\s*(?:\[([^\]]*)\])?\s*:(?:\s+|$)(.*)$/u;
const TAG_RE = /(?:^|\s)#([^\s#]+)/gu;

export interface ParseOptions {
  /** Doc id when the script has no `@id` (usually the file name). */
  id?: string;
}

function stripComment(raw: string): string {
  // `//` starts a comment unless escaped or inside a URL-ish `://`.
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\" && i + 1 < raw.length) {
      out += raw[i]! + raw[i + 1]!;
      i++;
      continue;
    }
    if (raw[i] === "/" && raw[i + 1] === "/" && raw[i - 1] !== ":") break;
    out += raw[i];
  }
  return out.replace(/\s+$/u, "");
}

function measureIndent(raw: string): { indent: number; rest: string } {
  let n = 0;
  let i = 0;
  for (; i < raw.length; i++) {
    if (raw[i] === " ") n++;
    else if (raw[i] === "\t") n += 4;
    else break;
  }
  return { indent: n, rest: raw.slice(i) };
}

/** Split trailing ` #tag` words off a text. `\#` stays literal. */
function splitTags(text: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  const masked = text.replace(/\\#/g, "\u0000");
  const body = masked.replace(TAG_RE, (_m, tag: string) => {
    tags.push(tag);
    return "";
  });
  return { text: body.replace(/\u0000/g, "#").trim(), tags };
}

function unescape(text: string): string {
  return text.replace(/\\([:#{}\\*>~@\-\[\]])/g, "$1");
}

function parseValue(raw: string): Value | undefined {
  const s = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === "true" || s === "false") return s === "true";
  const m = /^"(.*)"$|^'(.*)'$/.exec(s);
  if (m) return m[1] ?? m[2] ?? "";
  return undefined;
}

/** `key=value` or `key="quoted value"` pairs. */
function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_]+)\s*=\s*(?:"([^"]*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? "";
  return out;
}

export function compileScript(source: string, opts: ParseOptions = {}): CompileResult {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const err = (line: number, message: string, col = 1) => errors.push({ line, col, severity: "error", message });
  const warn = (line: number, message: string, col = 1) => warnings.push({ line, col, severity: "warning", message });

  const doc: DialogueDoc = {
    format: FORMAT,
    id: opts.id ?? "dialogue",
    title: opts.id ?? "dialogue",
    start: "",
    lang: "th",
    variables: {},
    characters: {},
    nodes: {},
    meta: { lines: 0, choices: 0, generator: "easydialogue 0.1.0" },
  };

  const rawLines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  let startLine = 0;
  const nodeOrder: string[] = [];
  const nodeLines = new Map<string, SrcLine[]>();
  let current: { id: string; lines: SrcLine[] } | null = null;
  const declaredVarsAt = new Map<string, number>();

  rawLines.forEach((raw, idx) => {
    const no = idx + 1;
    const stripped = stripComment(raw);
    if (!stripped.trim()) return;
    const { indent, rest } = measureIndent(stripped);
    const node = NODE_RE.exec(rest);
    if (node && indent === 0) {
      const id = node[1]!;
      if (nodeLines.has(id)) err(no, `Duplicate node "${id}"`);
      if (id === "END") err(no, `"END" is reserved (use -> END to finish)`);
      const { tags } = splitTags(node[2] ?? "");
      current = { id, lines: [] };
      nodeLines.set(id, current.lines);
      nodeOrder.push(id);
      doc.nodes[id] = { id, tags, body: [], src: no };
      return;
    }
    if (!current) {
      header(rest, no, indent);
      return;
    }
    (current as { lines: SrcLine[] }).lines.push({ no, indent, text: rest });
  });

  function header(text: string, no: number, indent: number) {
    if (indent > 0) return err(no, "Header lines (@title, @char, @var…) must not be indented");
    const m = /^@(\w+)\s*(.*)$/.exec(text);
    if (!m) return err(no, `Text before the first node. Start a node with "=== node_name"`);
    const [, key, value = ""] = m;
    switch (key!.toLowerCase()) {
      case "title":
        doc.title = value.trim() || doc.title;
        break;
      case "id":
        if (!/^[a-z0-9_-]+$/.test(value.trim())) err(no, "@id must use a-z, 0-9, _ or -");
        else doc.id = value.trim();
        break;
      case "start":
        doc.start = value.trim();
        startLine = no;
        break;
      case "lang":
        doc.lang = value.trim() || "th";
        break;
      case "box":
        doc.box = value.trim();
        break;
      case "var": {
        const vm = /^\$?([\p{L}_][\p{L}\p{M}\p{N}_]*)\s*=\s*(.+)$/u.exec(value.trim());
        if (!vm) return err(no, `Expected "@var name = value" (number, true/false or "text")`);
        const v = parseValue(vm[2]!);
        if (v === undefined) return err(no, `Initial value of ${vm[1]} must be a number, true/false or "text"`);
        if (declaredVarsAt.has(vm[1]!)) warn(no, `Variable ${vm[1]} declared twice (first on line ${declaredVarsAt.get(vm[1]!)})`);
        doc.variables[vm[1]!] = v;
        declaredVarsAt.set(vm[1]!, no);
        break;
      }
      case "char":
      case "character": {
        const cm = /^([\p{L}_][\p{L}\p{M}\p{N}_-]*)\s*(?:"([^"]*)")?\s*(.*)$/u.exec(value.trim());
        if (!cm) return err(no, `Expected @char id "Display name" portrait=… color=#…`);
        const id = cm[1]!;
        if (doc.characters[id]) err(no, `Character "${id}" declared twice`);
        const attrs = parseAttrs(cm[3] ?? "");
        const c: CharacterDef = { id, name: cm[2] ?? id };
        if (attrs.portrait) c.portrait = attrs.portrait;
        if (attrs.color) {
          if (!/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(attrs.color)) warn(no, `color should be a hex like #f4ae3d`);
          else c.color = attrs.color.startsWith("#") ? attrs.color : `#${attrs.color}`;
        }
        if (attrs.voice) c.voice = attrs.voice;
        if (attrs.side) {
          if (attrs.side !== "left" && attrs.side !== "right") warn(no, "side must be left or right");
          else c.side = attrs.side;
        }
        doc.characters[id] = c;
        break;
      }
      default:
        err(no, `Unknown header @${key}. Use @title, @id, @start, @lang, @box, @var or @char`);
    }
  }

  // speaker lookup by id or display name
  const speakerIndex = new Map<string, string>();
  for (const c of Object.values(doc.characters)) {
    speakerIndex.set(c.id.toLowerCase(), c.id);
    speakerIndex.set(c.name.toLowerCase(), c.id);
  }

  const jumps: { target: string; line: number }[] = [];
  const usedVars: { name: string; line: number }[] = [];
  const setVars = new Set<string>();
  const lineIds = new Map<string, number>();

  function exprAt(src: string, no: number, colBase: number): Expr | undefined {
    try {
      const e = parseExpr(src);
      for (const v of exprVars(e)) usedVars.push({ name: v, line: no });
      return e;
    } catch (e) {
      if (e instanceof ExprError) err(no, `Expression: ${e.message}`, colBase + e.col);
      else throw e;
      return undefined;
    }
  }

  function claimId(id: string, no: number) {
    if (lineIds.has(id)) err(no, `Line id "${id}" is already used on line ${lineIds.get(id)}`);
    lineIds.set(id, no);
  }

  function checkInterpolation(text: string, no: number) {
    for (const m of text.matchAll(/(?<!\\)\{\s*\$?([^}\s]+)\s*\}/gu)) usedVars.push({ name: m[1]!, line: no });
  }

  function parseNode(nodeId: string, lines: SrcLine[]): Stmt[] {
    let counter = 0;
    let p = 0;
    const nextId = (prefix = "") => `${nodeId}_${prefix}${++counter}`;

    function block(indent: number): Stmt[] {
      const out: Stmt[] = [];
      while (p < lines.length) {
        const ln = lines[p]!;
        if (ln.indent < indent) break;
        if (ln.indent > indent) {
          err(ln.no, "Unexpected indent (only choice and if/elif/else bodies are indented)");
          p++;
          continue;
        }
        const stmt = statement(ln, indent);
        if (stmt) out.push(stmt);
      }
      return out;
    }

    /** Body of a choice / if branch: lines deeper than `parentIndent`. */
    function childBlock(parentIndent: number): Stmt[] {
      const first = lines[p];
      if (!first || first.indent <= parentIndent) return [];
      return block(first.indent);
    }

    function statement(ln: SrcLine, indent: number): Stmt | null {
      const t = ln.text;
      const no = ln.no;

      // choice group
      if (t.startsWith("*")) {
        const options: ChoiceOption[] = [];
        while (p < lines.length && lines[p]!.indent === indent && lines[p]!.text.startsWith("*")) {
          const cl = lines[p]!;
          p++;
          let body = cl.text.slice(1).trim();
          let cond: Expr | undefined;
          const cm = /^\[\s*if\s+(.+?)\s*\]\s*(.*)$/u.exec(body);
          if (cm) {
            cond = exprAt(cm[1]!, cl.no, cl.indent + 1);
            body = cm[2]!;
          }
          let target: string | undefined;
          const jm = /^(.*?)\s*->\s*([\p{L}\p{N}_-]+)\s*$/u.exec(body);
          if (jm) {
            body = jm[1]!;
            target = jm[2]!;
          }
          const { text, tags } = splitTags(body);
          if (!text) err(cl.no, "Choice text is empty");
          const explicit = tags.find((g) => g.startsWith("line:"));
          const id = explicit ? explicit.slice(5) : nextId("c");
          claimId(id, cl.no);
          const inner = childBlock(cl.indent);
          if (target) {
            jumps.push({ target, line: cl.no });
            inner.push(target === "END" ? { t: "end", src: cl.no } : { t: "jump", target, src: cl.no });
          }
          checkInterpolation(text, cl.no);
          options.push({ id, text: unescape(text), ...(cond ? { cond } : {}), body: inner, src: cl.no });
        }
        doc.meta.choices++;
        return { t: "choice", options, src: no };
      }

      p++;

      // if / elif / else
      const ifm = /^if\s+(.+?)\s*:$/u.exec(t);
      if (ifm) {
        const branches: { cond?: Expr; body: Stmt[] }[] = [];
        const c = exprAt(ifm[1]!, no, indent + 4);
        branches.push({ ...(c ? { cond: c } : {}), body: childBlock(indent) });
        if (!branches[0]!.body.length) warn(no, "if has an empty body");
        while (p < lines.length && lines[p]!.indent === indent) {
          const nx = lines[p]!;
          const em = /^elif\s+(.+?)\s*:$/u.exec(nx.text);
          if (em) {
            p++;
            const ec = exprAt(em[1]!, nx.no, indent + 6);
            branches.push({ ...(ec ? { cond: ec } : {}), body: childBlock(indent) });
            continue;
          }
          if (/^else\s*:$/u.test(nx.text)) {
            p++;
            branches.push({ body: childBlock(indent) });
            break;
          }
          break;
        }
        return { t: "if", branches, src: no };
      }
      if (/^(elif\s|else\s*:)/u.test(t)) {
        err(no, `${t.split(/\s|:/)[0]} without a matching if above it`);
        childBlock(indent);
        return null;
      }
      if (/^if\b/u.test(t)) {
        err(no, `Expected "if condition:" (with a colon at the end)`);
        return null;
      }

      // jump
      if (t.startsWith("->")) {
        const target = t.slice(2).trim();
        if (!NODE_ID_RE.test(target)) {
          err(no, `Bad jump target "${target}"`);
          return null;
        }
        jumps.push({ target, line: no });
        return target === "END" ? { t: "end", src: no } : { t: "jump", target, src: no };
      }

      // set
      if (t.startsWith("~")) {
        const sm = SET_RE.exec(t);
        if (!sm) {
          err(no, `Expected "~ name = value" (or +=, -=, *=, /=)`);
          return null;
        }
        const value = exprAt(sm[3]!, no, indent + t.indexOf(sm[3]!) + 1);
        setVars.add(sm[1]!);
        if (sm[2] !== "=") usedVars.push({ name: sm[1]!, line: no });
        if (!value) return null;
        return { t: "set", var: sm[1]!, op: sm[2] as "=", value, src: no };
      }

      // event
      if (t.startsWith("@")) {
        const parts = t.slice(1).trim().split(/\s+/u).filter(Boolean);
        if (!parts.length) {
          err(no, "Empty @event");
          return null;
        }
        if (["var", "char", "title", "start"].includes(parts[0]!)) {
          err(no, `@${parts[0]} is a header — put it above the first === node`);
          return null;
        }
        return { t: "event", name: parts[0]!, args: parts.slice(1), src: no };
      }

      // speaker line or narration
      let speaker: string | undefined;
      let emotion: string | undefined;
      let body = t;
      if (t.startsWith(">")) body = t.slice(1).trim();
      else {
        const sm = SPEAKER_RE.exec(t);
        if (sm && sm[1]!.length <= 32) {
          const raw = sm[1]!.trim();
          const known = speakerIndex.get(raw.toLowerCase());
          speaker = known ?? raw;
          if (!known) warn(no, `Unknown speaker "${raw}". Declare it with @char ${/^[a-z_]/i.test(raw) ? raw : "id"} "${raw}" — or write \\: for a literal colon`);
          if (sm[2] !== undefined) {
            const em = normalizeEmotion(sm[2]);
            if (!em) warn(no, "Empty [emotion] tag");
            else {
              emotion = em;
              if (!(EMOTIONS as readonly string[]).includes(em)) warn(no, `Emotion "${sm[2]}" has no standard portrait (${EMOTIONS.join(", ")}); the neutral portrait is used if missing`);
            }
          }
          body = sm[3] ?? "";
        }
      }
      const { text, tags } = splitTags(body);
      if (!text) {
        err(no, speaker ? `Line for ${speaker} has no text` : "Empty line");
        return null;
      }
      const explicit = tags.find((g) => g.startsWith("line:"));
      const id = explicit ? explicit.slice(5) : nextId();
      claimId(id, no);
      const restTags = tags.filter((g) => !g.startsWith("line:"));
      checkInterpolation(text, no);
      doc.meta.lines++;
      return {
        t: "line",
        id,
        ...(speaker ? { speaker } : {}),
        ...(emotion ? { emotion } : {}),
        text: unescape(text),
        ...(restTags.length ? { tags: restTags } : {}),
        src: no,
      };
    }

    const out = block(lines[0]?.indent ?? 0);
    if (lines[0] && lines[0].indent !== 0) warn(lines[0].no, "Node body is indented; top-level node lines usually start at column 1");
    return out;
  }

  for (const id of nodeOrder) {
    const n = doc.nodes[id] as DialogueNode;
    n.body = parseNode(id, nodeLines.get(id)!);
    if (!n.body.length) warn(n.src, `Node "${id}" is empty`);
  }

  if (!nodeOrder.length) err(1, `No nodes. Add one with "=== start"`);
  if (!doc.start) doc.start = nodeOrder[0] ?? "";
  else if (!doc.nodes[doc.start]) err(startLine || 1, `@start node "${doc.start}" does not exist`);

  for (const j of jumps) {
    if (j.target !== "END" && !doc.nodes[j.target]) {
      const near = closest(j.target, nodeOrder);
      err(j.line, `Jump to unknown node "${j.target}"${near ? ` (did you mean "${near}"?)` : ""}`);
    }
  }

  const reported = new Set<string>();
  for (const v of usedVars) {
    if (!(v.name in doc.variables) && !setVars.has(v.name) && !reported.has(v.name)) {
      reported.add(v.name);
      warn(v.line, `Variable "${v.name}" is never declared (@var ${v.name} = 0) or set; it starts as 0`);
    }
  }
  for (const v of setVars) if (!(v in doc.variables)) {
    doc.variables[v] = 0;
  }

  // reachability
  if (doc.start && doc.nodes[doc.start]) {
    const seen = new Set<string>([doc.start]);
    const stack = [doc.start];
    const walk = (body: Stmt[], out: string[]) => {
      for (const s of body) {
        if (s.t === "jump") out.push(s.target);
        else if (s.t === "choice") s.options.forEach((o) => walk(o.body, out));
        else if (s.t === "if") s.branches.forEach((b) => walk(b.body, out));
      }
    };
    while (stack.length) {
      const id = stack.pop()!;
      const targets: string[] = [];
      walk(doc.nodes[id]!.body, targets);
      for (const t of targets) if (doc.nodes[t] && !seen.has(t)) {
        seen.add(t);
        stack.push(t);
      }
    }
    for (const id of nodeOrder) if (!seen.has(id)) warn(doc.nodes[id]!.src, `Node "${id}" is never reached from "${doc.start}"`);
  }

  for (const c of Object.values(doc.characters)) {
    if (!c.portrait) continue;
    if (!/^[a-z0-9_-]+$/.test(c.portrait)) warn(1, `Portrait id "${c.portrait}" for ${c.id} should use a-z, 0-9, _ or -`);
  }

  errors.sort((a, b) => a.line - b.line);
  warnings.sort((a, b) => a.line - b.line);
  return { doc: errors.length ? null : doc, errors, warnings };
}

/** Graph edges for the editor: node → targets (with the source line). */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length]!;
}

/** Nearest node id for "did you mean" hints (case-insensitive, ≤ 2 edits or a third of the name). */
function closest(target: string, ids: string[]): string | undefined {
  const t = target.toLowerCase();
  let best: string | undefined;
  let bestD = Infinity;
  for (const id of ids) {
    const dist = editDistance(t, id.toLowerCase());
    if (dist < bestD) [best, bestD] = [id, dist];
  }
  return best !== undefined && bestD <= Math.max(2, Math.floor(t.length / 3)) ? best : undefined;
}

export function nodeEdges(doc: DialogueDoc): { from: string; to: string; label?: string; line: number }[] {
  const edges: { from: string; to: string; label?: string; line: number }[] = [];
  const walk = (from: string, body: Stmt[], label?: string) => {
    for (const s of body) {
      if (s.t === "jump") edges.push({ from, to: s.target, ...(label ? { label } : {}), line: s.src });
      else if (s.t === "end") edges.push({ from, to: "END", ...(label ? { label } : {}), line: s.src });
      else if (s.t === "choice") s.options.forEach((o) => walk(from, o.body, o.text));
      else if (s.t === "if") s.branches.forEach((b) => walk(from, b.body, label));
    }
  };
  for (const n of Object.values(doc.nodes)) walk(n.id, n.body);
  return edges;
}

/** Every spoken line / choice text in source order (for voice manifests, translation sheets). */
export function collectLines(doc: DialogueDoc): { id: string; node: string; kind: "line" | "choice"; speaker?: string; emotion?: string; text: string; src: number }[] {
  const out: ReturnType<typeof collectLines> = [];
  const walk = (node: string, body: Stmt[]) => {
    for (const s of body) {
      if (s.t === "line") out.push({ id: s.id, node, kind: "line", ...(s.speaker ? { speaker: s.speaker } : {}), ...(s.emotion ? { emotion: s.emotion } : {}), text: s.text, src: s.src });
      else if (s.t === "choice") s.options.forEach((o) => {
        out.push({ id: o.id, node, kind: "choice", text: o.text, src: o.src });
        walk(node, o.body);
      });
      else if (s.t === "if") s.branches.forEach((b) => walk(node, b.body));
    }
  };
  for (const n of Object.values(doc.nodes)) walk(n.id, n.body);
  return out;
}
