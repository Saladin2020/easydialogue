import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compileScript, nodeEdges } from "../../src/shared/parser";
import { BOX_STYLES, EMOTIONS, type BoxStyle, type Value } from "../../src/shared/types";
import { STYLE_LABELS } from "../../src/shared/ui";
import { exportDialogue, fetchScript, fetchWorkspace, makePortraits, portraitUrl, saveScript, type WorkspaceSummary } from "./api";
import { NodeGraph } from "./components/NodeGraph";
import { PlayPreview } from "./components/PlayPreview";
import { ScriptEditor } from "./components/ScriptEditor";

const LS_SCRIPT = "easydialogue.script";
const PRESETS = [
  { id: "godot", label: "Godot 4.3+", hint: "runner .gd + DialogueBox .tscn" },
  { id: "pixi", label: "PixiJS v8", hint: "runtime JS + demo html" },
  { id: "json", label: "JSON", hint: "easydialogue/1" },
  { id: "voice", label: "Voice manifest", hint: "ElevenLabs-ready, no API calls" },
  { id: "all", label: "All", hint: "everything above" },
] as const;

const TEMPLATE = (title: string) => `// ${title}
@title ${title}
@var friendship = 0
@char kid "ต้น" portrait=town_kid color=#f4ae3d
@char vendor "ป้าแดง" portrait=town_vendor color=#e5806c side=right

=== start
vendor [happy]: สวัสดีจ้ะต้น วันนี้จะช่วยป้าไหม
* ช่วยสิครับ!
    ~ friendship += 1
    vendor [happy]: น่ารักจริง
* ไม่ว่างครับ
    vendor [sad]: ไม่เป็นไรจ้ะ
-> END
`;

function readLs(k: string) {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
}
function writeLs(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

export function App() {
  const [ws, setWs] = useState<WorkspaceSummary | null>(null);
  const [id, setId] = useState("");
  const [source, setSource] = useState("");
  const [saved, setSaved] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err" | ""; text: string }>({ kind: "", text: "" });
  const [jump, setJump] = useState<{ line: number; nonce: number }>();
  const [style, setStyle] = useState<BoxStyle | "">("");
  const [background, setBackground] = useState<string>("");
  const [startNode, setStartNode] = useState("");
  const [play, setPlay] = useState<{ node: string | null; vars: Record<string, Value>; log: string[]; visited: Record<string, number> }>({ node: null, vars: {}, log: [], visited: {} });
  const [exportRes, setExportRes] = useState<{ dirs: string[]; files: number; warnings: string[] } | null>(null);
  const [sheet, setSheet] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [portraitsVersion, setPortraitsVersion] = useState(0);
  const [newId, setNewId] = useState("");
  const logRef = useRef<HTMLOListElement>(null);

  const compiled = useMemo(() => compileScript(source, { id: id || "draft" }), [source, id]);
  // keep the last good doc so the preview/graph survive while typing
  const lastGood = useRef(compiled.doc);
  if (compiled.doc) lastGood.current = compiled.doc;
  const doc = compiled.doc ?? lastGood.current;
  const edges = useMemo(() => (doc ? nodeEdges(doc) : []), [doc]);
  const diagnostics = useMemo(() => [...compiled.errors, ...compiled.warnings].sort((a, b) => a.line - b.line), [compiled]);
  const dirty = source !== saved;
  const effStyle: BoxStyle = (style || (doc?.box as BoxStyle) || (ws?.config.style as BoxStyle) || "teak") as BoxStyle;
  const effBg = background === "" ? (ws?.config.background.replace(/^backgrounds\//, "") ?? null) : background === "none" ? null : background;

  const refreshWs = useCallback(async () => {
    const w = await fetchWorkspace();
    setWs(w);
    return w;
  }, []);

  const open = useCallback(async (sid: string) => {
    try {
      const s = await fetchScript(sid);
      setId(sid);
      setSource(s.source);
      setSaved(s.source);
      setStartNode("");
      setExportRes(null);
      writeLs(LS_SCRIPT, sid);
      setLoadErr("");
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refreshWs()
      .then((w) => {
        const want = readLs(LS_SCRIPT);
        const pick = w.scripts.find((s) => s.id === want)?.id ?? w.scripts.find((s) => s.id === "village_delivery")?.id ?? w.scripts[0]?.id;
        if (pick) void open(pick);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : String(e)));
  }, [refreshWs, open]);

  const onSave = useCallback(async () => {
    if (!id) return;
    setBusy("save");
    try {
      const r = await saveScript(id, source, compiled.errors.length > 0);
      setSaved(source);
      setStatus({ kind: compiled.errors.length ? "err" : "ok", text: compiled.errors.length ? `Saved with ${compiled.errors.length} error(s) — exports need a clean script` : `Saved ${r.file.split(/[\\/]/).pop()}` });
      void refreshWs();
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("");
    }
  }, [id, source, compiled.errors.length, refreshWs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave]);

  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [play.log.length]);

  const onExport = async (preset: string) => {
    if (!id) return;
    if (compiled.errors.length) {
      setStatus({ kind: "err", text: "Fix the errors before exporting" });
      return;
    }
    setBusy(`export-${preset}`);
    try {
      if (dirty) {
        await saveScript(id, source);
        setSaved(source);
      }
      const r = await exportDialogue(id, preset, effStyle, effBg === null ? null : `backgrounds/${effBg}`);
      setExportRes(r);
      setStatus({ kind: "ok", text: `Exported ${preset} · ${r.files} files` });
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("");
    }
  };

  const onNew = async () => {
    const nid = newId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
    if (!nid) return;
    if (ws?.scripts.some((s) => s.id === nid)) return void open(nid);
    const src = TEMPLATE(nid);
    await saveScript(nid, src);
    setNewId("");
    await refreshWs();
    await open(nid);
  };

  const onPortraits = async () => {
    setBusy("portraits");
    try {
      const r = await makePortraits(sheet, sheetId);
      setStatus({ kind: "ok", text: `Portraits ${r.id}: ${r.emotions.length} emotions${r.faceSwap ? " · Easy Sprite faces" : ""}` });
      setPortraitsVersion((v) => v + 1);
      await refreshWs();
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("");
    }
  };

  const castPortraits = useMemo(() => {
    if (!doc) return [];
    return Object.values(doc.characters).map((c) => ({ c, set: ws?.portraits.find((p) => p.id === c.portrait) }));
  }, [doc, ws]);

  if (loadErr && !ws) {
    return (
      <div className="app">
        <div className="panel">
          <h2>Easy Dialogue</h2>
          <p className="hint err">{loadErr}</p>
          <p className="hint">Start the API with <code>npx easydialogue serve</code> (or <code>npm run dev</code>).</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden />
          <div>
            <h1 className="brand">
              Easy <span>Dialogue</span>
            </h1>
            <p className="brand-th">บทสนทนาเกม · ตัวเลือก · ตัวแปร · ภาษาไทยสวยถูกต้อง</p>
            <div className="sub">
              <span className="tag tag-sky">.ezd script</span>
              <span className="tag">Kanit · Thai shaping</span>
              <span className="tag">{ws?.portraits.length ?? 0} portrait sets</span>
              <span className="tag tag-leaf">Godot · PixiJS</span>
            </div>
          </div>
        </div>
        <div className="toolbar">
          <div className="tool-group">
            <label className="field-label" htmlFor="script-pick">Dialogue</label>
            <div className="row nowrap">
              <select id="script-pick" value={id} onChange={(e) => void open(e.target.value)}>
                {ws?.scripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({s.id})
                  </option>
                ))}
              </select>
              <button type="button" className={`save-btn${dirty ? " is-dirty" : ""}`} disabled={busy === "save" || !id} title="Save (Ctrl/⌘+S)" onClick={() => void onSave()}>
                <span className="dot" aria-hidden />
                {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
              </button>
            </div>
          </div>
          <form
            className="tool-group"
            onSubmit={(e) => {
              e.preventDefault();
              void onNew();
            }}
          >
            <label className="field-label" htmlFor="new-id">New dialogue</label>
            <div className="row nowrap">
              <input id="new-id" value={newId} placeholder="market_day" onChange={(e) => setNewId(e.target.value)} />
              <button type="submit">+ New</button>
            </div>
          </form>
        </div>
      </header>

      <main className="layout-dlg">
        <section className="panel panel-script">
          <h2>
            <span className="step">1</span> Script <small>{id}.ezd</small>
            {dirty && <span className="badge-dirty">unsaved</span>}
          </h2>
          <ScriptEditor value={source} onChange={setSource} diagnostics={diagnostics} jump={jump} />
          <div className={`diag ${compiled.errors.length ? "diag-err" : "diag-ok"}`}>
            {compiled.errors.length === 0 ? (
              <p className="hint ok">
                ✓ {doc ? `${Object.keys(doc.nodes).length} nodes · ${doc.meta.lines} lines · ${doc.meta.choices} choices` : ""}
                {compiled.warnings.length ? ` · ${compiled.warnings.length} warning(s)` : " · no warnings"}
              </p>
            ) : (
              <p className="hint err">✗ {compiled.errors.length} error(s) — preview shows the last good version</p>
            )}
            <ul className="diag-list">
              {diagnostics.map((d, i) => (
                <li key={i} className={`diag-${d.severity}`}>
                  <button type="button" className="diag-line" onClick={() => setJump({ line: d.line, nonce: Date.now() })}>
                    L{d.line}
                  </button>
                  <span>{d.message}</span>
                </li>
              ))}
            </ul>
          </div>
          <details className="cheat">
            <summary>Syntax cheat sheet</summary>
            <pre>{`@char kid "ต้น" portrait=town_kid color=#f4ae3d side=left
@var delivered = 0
=== node_name
kid [happy]: ข้อความ {delivered}      > narration
* ตัวเลือก -> node
* [if delivered >= 2] อีกตัวเลือก
    ~ delivered += 1
if delivered >= 3:
    ...
else:
    ...
@camera market      -> END
emotions: ${EMOTIONS.join(" ")}`}</pre>
          </details>
        </section>

        <div className="col-right">
          <section className="panel panel-play">
            <h2>
              <span className="step">2</span> Play <small>{play.node ? `node ${play.node}` : ""}</small>
            </h2>
            <PlayPreview doc={doc} style={effStyle} background={effBg} startNode={startNode} portraitsVersion={portraitsVersion} onState={setPlay} />
            <div className="row play-opts">
              <label className="tool-group">
                <span className="field-label">Box style</span>
                <select value={style} onChange={(e) => setStyle(e.target.value as BoxStyle | "")}>
                  <option value="">Script default ({(doc?.box as string) || ws?.config.style || "teak"})</option>
                  {BOX_STYLES.map((s) => (
                    <option key={s} value={s}>
                      {STYLE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="tool-group">
                <span className="field-label">Background</span>
                <select value={background} onChange={(e) => setBackground(e.target.value)}>
                  <option value="">Workspace default</option>
                  {ws?.backgrounds.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                  <option value="none">None</option>
                </select>
              </label>
              <label className="tool-group">
                <span className="field-label">Start at</span>
                <select value={startNode} onChange={(e) => setStartNode(e.target.value)}>
                  <option value="">@start ({doc?.start})</option>
                  {doc &&
                    Object.keys(doc.nodes).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </section>

          <div className="row-2">
            <section className="panel panel-graph">
              <h2>
                <span className="step step-leaf">3</span> Story graph <small>click a node to jump</small>
              </h2>
              <NodeGraph doc={doc} edges={edges} current={play.node} visited={play.visited} onPick={(line) => setJump({ line, nonce: Date.now() })} />
            </section>
            <section className="panel panel-state">
              <h2>
                <span className="step step-leaf">◆</span> State
              </h2>
              <table className="vars">
                <tbody>
                  {Object.entries(play.vars).map(([k, v]) => (
                    <tr key={k}>
                      <th className="mono">{k}</th>
                      <td className="mono">{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ol className="log" ref={logRef}>
                {play.log.map((l, i) => (
                  <li key={i} className={l.startsWith(">") ? "log-choice" : l.startsWith("@") ? "log-event" : ""}>
                    {l}
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <div className="row-2">
            <section className="panel panel-export">
              <h2>
                <span className="step">4</span> Export
              </h2>
              <div className="export-grid">
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" className={p.id === "all" ? "primary" : ""} disabled={!!busy || !id} onClick={() => void onExport(p.id)}>
                    <span>{busy === `export-${p.id}` ? "Exporting…" : p.label}</span>
                    <small>{p.hint}</small>
                  </button>
                ))}
              </div>
              {exportRes && (
                <ul className="export-list">
                  {exportRes.dirs.map((d) => (
                    <li key={d} className="mono">
                      {d}
                    </li>
                  ))}
                  {exportRes.warnings.map((w) => (
                    <li key={w} className="hint err">
                      {w}
                    </li>
                  ))}
                </ul>
              )}
              <p className="hint">Voice manifest lists every line id → speaker/text for ElevenLabs; Easy Dialogue never calls the API.</p>
            </section>
            <section className="panel panel-portraits">
              <h2>
                <span className="step">☺</span> Cast & portraits
              </h2>
              <div className="cast">
                {castPortraits.map(({ c, set }) => (
                  <div key={c.id} className="cast-card" style={{ ["--c" as string]: c.color ?? "#f4ae3d" }}>
                    {set ? <img src={`${portraitUrl(set.id, "neutral")}?v=${portraitsVersion}`} alt="" width={64} height={64} /> : <div className="cast-missing">?</div>}
                    <div>
                      <b>{c.name}</b>
                      <span className="mono">{c.id}</span>
                      <span className="emos">{set ? `${set.emotions.length} emotions` : c.portrait ? `missing ${c.portrait}` : "no portrait"}</span>
                    </div>
                  </div>
                ))}
              </div>
              <form
                className="portrait-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void onPortraits();
                }}
              >
                <label className="field-label" htmlFor="sheet">From an Easy Sprite sheet (inside the workspace)</label>
                <div className="row nowrap">
                  <input id="sheet" className="grow" value={sheet} placeholder="sheets/town_kid.png" onChange={(e) => setSheet(e.target.value)} />
                  <input value={sheetId} placeholder="id" style={{ width: "7rem" }} onChange={(e) => setSheetId(e.target.value)} />
                  <button type="submit" disabled={!sheet || busy === "portraits"}>
                    {busy === "portraits" ? "…" : "Make"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        </div>
      </main>
      <footer className={`statusbar ${status.kind}`}>{status.text || `Workspace ${ws?.root ?? ""}`}</footer>
    </div>
  );
}
