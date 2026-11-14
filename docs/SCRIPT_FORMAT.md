# Easy Dialogue script format (`.ezd`) → `easydialogue/1`

`.ezd` is a small line-based language for branching game dialogue. It is UTF-8, Thai-first and meant to be
written by hand or by an AI agent. `easydialogue check` (or the editor, or the MCP `write_dialogue` tool)
reports every problem with a **1-based line number**, e.g. `village.ezd:31:1 error: Jump to unknown node "tempel" (did you mean "temple"?)`.

```ezd
// comments start with //
@title ต้นส่งของรอบหมู่บ้าน
@start market
@box teak
@var coins = 0
@var mango = false
@char kid    "ต้น"    portrait=town_kid    color=#f4ae3d voice=th_boy
@char vendor "ป้าแดง" portrait=town_vendor color=#e5806c side=right voice=th_auntie

=== market #intro
> เช้าวันเสาร์ ตลาดหน้าหมู่บ้านคึกคัก
vendor [happy]: ต้นจ๋า ช่วยป้าส่งของหน่อยได้ไหม #line:ask
* ได้เลยครับ!
    ~ coins += 10
    -> temple
* [if coins >= 5] ขอซื้อขนมก่อน -> shop
* ไม่ว่างครับ -> END

=== temple
kid: มีเงิน {coins} บาทแล้ว
if mango:
    kid [ดีใจ]: มีมะม่วงด้วย
else:
    kid [sad]: ไม่มีมะม่วง
@sfx fanfare
-> END
```

## Headers (above the first node, not indented)

| Header | Meaning |
| --- | --- |
| `@title text` | Display title (Thai welcome). |
| `@id name` | Doc id (`a-z 0-9 _ -`). Default: the file name. |
| `@start node` | First node. Default: the first `===` node. |
| `@lang th` | Language tag for word wrapping (`Intl.Segmenter`). Default `th`. |
| `@box style` | Default box style: `teak`, `lantern`, `paper`, `night`. |
| `@var name = value` | Variable with an initial number, `true`/`false` or `"text"`. |
| `@char id "Name" key=value…` | Character. Keys: `portrait=<set>` (folder in `portraits/`), `color=#hex` (name plate), `side=left\|right` (portrait side, default left), `voice=<id>` (copied to the voice manifest). |

## Nodes

`=== node_id #tag #tag` starts a node. Ids may use Thai letters, digits, `_` and `-`. A node runs top to
bottom; when it reaches its end without a jump, the dialogue **ends** (nodes never fall into the next node).

## Statements inside a node

| Form | Meaning |
| --- | --- |
| `speaker: text` | Spoken line. `speaker` is a `@char` id **or** display name (`ป้าแดง: …` works). |
| `speaker [emotion]: text` | Line with an emotion → portrait `portraits/<set>/<emotion>.png` (falls back to `neutral`). |
| `> text` or plain `text` | Narration (no name plate, no portrait). |
| `text #line:my_id #tag` | Stable line id (voice files, localisation) and free tags. Auto ids are `<node>_<n>`, choices `<node>_c<n>`. |
| `* text -> node` | Choice. Consecutive `*` lines at the same indent form one choice screen. |
| `* [if cond] text` | Choice shown only when `cond` is true (hidden otherwise; a screen with no visible option is skipped). |
| indented lines under `*` | Choice body. Without a jump, play continues after the whole choice group. |
| `if cond:` / `elif cond:` / `else:` | Branches with indented bodies. |
| `~ var = expr` (`+=`, `-=`, `*=`, `/=`) | Set a variable. Assigning an undeclared variable declares it (starting at 0). `+=` on text concatenates. |
| `-> node` / `-> END` | Jump / finish. |
| `@name args…` | Event, e.g. `@sfx fanfare`, `@camera temple`. Delivered to `onEvent` (JS), `event_fired` (Godot). |

Emotions: `neutral happy sad surprised angry thinking shy`, with Thai aliases
(`ปกติ เฉย ดีใจ ยิ้ม เศร้า เสียใจ ตกใจ โกรธ คิด สงสัย เขิน อาย`) and English ones (`smile joy surprise mad think blush`). Other names are allowed but warn, and use `neutral.png` unless that file exists.

### Text

* `{var}` interpolates a variable (`true/false`, numbers without trailing `.0`).
* Escapes: `\:` `\#` `\{` `\}` `\*` `\>` `\~` `\@` `\-` `\[` `\]` `\\`. A line whose text has a colon early
  on is read as `speaker: text` — write `\:` if you mean a literal colon.
* Thai needs no spaces between words: wrapping uses `Intl.Segmenter` word boundaries (ICU in Godot), the
  typewriter reveals whole grapheme clusters so tone marks and vowels never appear on their own.

### Expressions

Numbers, `"text"`, `true`, `false`, variables (an optional `$` prefix is ignored), `+ - * / %`,
`== != < <= > >=`, `and or not` (also `&& || !`) and parentheses. Unknown variables read as `0`.

## Diagnostics

Errors stop compilation (`doc: null`); warnings do not.

* **Errors:** unknown jump target (with a "did you mean"), duplicate node or line id, missing `@start` node,
  bad header / expression / `~` syntax, unexpected indentation, empty line or choice text, headers inside
  nodes, `elif`/`else` without `if`.
* **Warnings:** unknown speaker, non-standard emotion, variable read but never declared or set, node never
  reached from `@start`, empty node, duplicate `@var`.

## Compiled JSON: `easydialogue/1`

```jsonc
{
  "format": "easydialogue/1",
  "id": "village_delivery", "title": "…", "start": "market", "lang": "th", "box": "teak",
  "variables": { "coins": 0, "mango": false },
  "characters": { "kid": { "id": "kid", "name": "ต้น", "portrait": "town_kid", "color": "#f4ae3d", "voice": "th_boy" } },
  "nodes": {
    "market": { "id": "market", "tags": ["intro"], "src": 18, "body": [
      { "t": "event", "name": "camera", "args": ["market"], "src": 19 },
      { "t": "line", "id": "market_1", "text": "เช้าวันเสาร์…", "src": 20 },
      { "t": "line", "id": "ask", "speaker": "vendor", "emotion": "happy", "text": "…", "src": 21 },
      { "t": "choice", "src": 22, "options": [
        { "id": "market_c2", "text": "ได้เลยครับ!", "body": [ { "t": "set", "var": "coins", "op": "+=", "value": { "k": "num", "v": 10 } }, { "t": "jump", "target": "temple" } ] },
        { "id": "market_c3", "text": "…", "cond": { "k": "bin", "op": ">=", "a": { "k": "var", "n": "coins" }, "b": { "k": "num", "v": 5 } }, "body": [ … ] }
      ] },
      { "t": "if", "branches": [ { "cond": { … }, "body": [ … ] }, { "body": [ … ] } ] },
      { "t": "event", "name": "sfx", "args": ["fanfare"] },
      { "t": "end" }
    ] }
  },
  "meta": { "lines": 24, "choices": 2, "generator": "easydialogue 0.1.0" }
}
```

Expression nodes: `{k:"num",v}`, `{k:"str",v}`, `{k:"bool",v}`, `{k:"var",n}`, `{k:"un",op:"not"|"-",a}`,
`{k:"bin",op,a,b}`. Every statement keeps `src` (the source line) for tooling.

The `pixi` and `godot` exports wrap the doc with `ui` (layout, colours, 9-slice margins, font names) and
`assets` (relative paths to frames, portraits per emotion actually used, fonts, background).

## Running it

All runtimes implement the same semantics (checked by tests and the Godot parity test):

* JS: `runtime/pixi/easydialogue-runner.js` — `new DialogueRunner(doc).start()`, `next()` → `{type:"line"|"choices"|"end"}`, `choose(option.index)`, `autoplay(doc, picks)`.
* Godot: `runtime/godot/dialogue_runner.gd` (same API) and the `DialogueBox` scene.
