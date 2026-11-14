/** Line-based syntax highlighting for .ezd scripts → HTML (escaped). */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const span = (cls: string, s: string) => `<span class="hl-${cls}">${esc(s)}</span>`;

function inline(text: string): string {
  // {interpolation}, #tags, -> jumps at the end
  let out = "";
  const re = /(\{[^}]*\})|((?:^|\s)#[^\s#]+)|(->\s*[\p{L}\p{N}_-]+\s*$)/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    if (m[1]) out += span("interp", m[1]);
    else if (m[2]) out += span("tag", m[2]);
    else if (m[3]) out += span("jump", m[3]);
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

export function highlightLine(raw: string, inNode: boolean): string {
  const ci = raw.search(/(?<!:)\/\//);
  const code = ci >= 0 ? raw.slice(0, ci) : raw;
  const comment = ci >= 0 ? span("comment", raw.slice(ci)) : "";
  const indent = /^\s*/.exec(code)![0];
  const t = code.slice(indent.length);
  let body: string;
  if (!t) body = "";
  else if (/^===/.test(t)) body = span("node", t);
  else if (/^@/.test(t)) {
    const m = /^(@\w+)(.*)$/.exec(t)!;
    body = span(inNode ? "event" : "header", m[1]!) + inline(m[2] ?? "");
  } else if (/^\*/.test(t)) {
    const m = /^(\*\s*)(\[if[^\]]*\])?(.*)$/.exec(t)!;
    body = span("choice", m[1]!) + (m[2] ? span("cond", m[2]) : "") + inline(m[3] ?? "");
  } else if (/^(if|elif)\s.*:$|^else\s*:$/.test(t)) {
    const m = /^(if|elif|else)(.*)$/.exec(t)!;
    body = span("kw", m[1]!) + span("cond", m[2] ?? "");
  } else if (/^~/.test(t)) body = span("set", t);
  else if (/^->/.test(t)) body = span("jump", t);
  else if (/^>/.test(t)) body = span("narr", ">") + inline(t.slice(1));
  else {
    const m = /^([^:[\]{}#*~@>\\]+?)(\s*\[[^\]]*\])?(\s*:)(\s.*|$)/u.exec(t);
    body = m && m[1]!.length <= 32 ? span("speaker", m[1]!) + (m[2] ? span("emotion", m[2]) : "") + esc(m[3]!) + inline(m[4] ?? "") : inline(t);
  }
  return esc(indent) + body + comment;
}

export function highlight(source: string): string {
  let inNode = false;
  return source
    .split("\n")
    .map((l) => {
      if (/^===/.test(l)) inNode = true;
      return highlightLine(l, inNode);
    })
    .join("\n");
}
