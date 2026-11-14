// Easy Dialogue — PixiJS v8 dialogue box (9-slice pixel frame, name plate, portrait, typewriter, choices).
// Usage:
//   import { loadDialogue, DialogueBox } from "./easydialogue-pixi.js";
//   const bundle = await loadDialogue(PIXI, "./village_delivery.dialogue.json");
//   const box = new DialogueBox(PIXI, bundle, { onEvent: (name, args) => console.log(name, args) });
//   app.stage.addChild(box.view); app.ticker.add((t) => box.update(t.deltaMS / 1000)); box.bindKeys(window); box.start();
// Thai text is shaped by the browser (Kanit, OFL). Lines wrap between Intl.Segmenter words so Thai
// syllables never split, and the typewriter reveals whole grapheme clusters (tone marks never pop in late).
// MIT License. https://github.com/Saladin2020/easydialogue
import { DialogueRunner, graphemes, wrapText } from "./easydialogue-runner.js";

/** Load the exported bundle, its frames, portraits and the Kanit font. */
export async function loadDialogue(PIXI, url) {
  const base = new URL(url, document.baseURI);
  const doc = await (await fetch(base)).json();
  const rel = (p) => new URL(p, base).href;
  const fonts = doc.assets?.fonts ?? {};
  if (typeof FontFace !== "undefined") {
    for (const [family, file] of Object.entries(fonts)) {
      const face = new FontFace(family, `url(${rel(file)})`);
      await face.load();
      document.fonts.add(face);
    }
  }
  const load = async (p) => {
    const tex = await PIXI.Assets.load(rel(p));
    tex.source.scaleMode = "nearest";
    return tex;
  };
  const frames = {};
  for (const [k, p] of Object.entries(doc.assets?.frames ?? {})) frames[k] = await load(p);
  const portraits = {};
  for (const [id, set] of Object.entries(doc.assets?.portraits ?? {})) {
    portraits[id] = {};
    for (const [emo, p] of Object.entries(set)) portraits[id][emo] = await load(p);
  }
  const background = doc.assets?.background ? await load(doc.assets.background) : null;
  return { doc, frames, portraits, background };
}

export class DialogueBox {
  constructor(PIXI, bundle, opts = {}) {
    this.PIXI = PIXI;
    this.bundle = bundle;
    this.doc = bundle.doc;
    this.L = this.doc.ui.layout;
    this.C = this.doc.ui.colors;
    this.opts = opts;
    this.runner = new DialogueRunner(this.doc, { variables: opts.variables, onEvent: (n, a, r) => opts.onEvent?.(n, a, r) });
    this.view = new PIXI.Container();
    this.view.label = "EasyDialogue";
    this.state = "idle";
    this.line = null;
    this.choices = null;
    this.selected = 0;
    this.revealed = 0;
    this.total = 0;
    this.blink = 0;
    this.build();
    this.view.visible = false;
  }

  textStyle(size, fill, family = this.doc.ui.font ?? "Kanit") {
    const s = { fontFamily: family, fontSize: size, fill, lineHeight: this.L.text.lineHeight, padding: 4 };
    if (this.C.shadow) s.dropShadow = { color: this.C.shadow, distance: 0.7, angle: Math.PI / 4, blur: 0, alpha: 1 };
    return new this.PIXI.TextStyle(s);
  }

  /** Put the first line's baseline at `y` (matches the PNG previews and the Godot box). */
  baselineTo(t, x, y) {
    const st = t.style;
    const font = this.PIXI.fontStringFromTextStyle ? this.PIXI.fontStringFromTextStyle(st) : `${st.fontSize}px "${st.fontFamily}"`;
    const fp = this.PIXI.CanvasTextMetrics.measureFont(font);
    const lh = st.lineHeight || fp.fontSize;
    t.position.set(x, y - (st.padding + fp.ascent + (lh - fp.fontSize) / 2));
  }

  nine(tex, m) {
    const n = new this.PIXI.NineSliceSprite({ texture: tex, leftWidth: m, topWidth: m, rightWidth: m, bottomWidth: m });
    n.roundPixels = true;
    return n;
  }

  build() {
    const { PIXI, L, bundle } = this;
    const f = bundle.frames;
    const m = this.doc.ui.margins;
    this.box = this.nine(f.box, m.box);
    this.box.position.set(L.box.x, L.box.y);
    this.box.width = L.box.w;
    this.box.height = L.box.h;
    this.well = this.nine(f.well, m.well);
    this.portrait = new PIXI.Sprite();
    this.portrait.roundPixels = true;
    this.plate = this.nine(f.plate, m.plate);
    this.plateBar = new PIXI.Graphics();
    this.nameText = new PIXI.Text({ text: "", style: this.textStyle(L.plate.fontSize, this.C.plateText, this.doc.ui.fontName ?? "Kanit Medium") });
    this.nameText.style.dropShadow = false;
    this.body = new PIXI.Text({ text: "", style: this.textStyle(L.text.fontSize, this.C.text) });
    this.next = new PIXI.Sprite(f.next);
    this.choicePanel = new PIXI.Container();
    this.view.addChild(this.box, this.well, this.portrait, this.plate, this.plateBar, this.nameText, this.body, this.next, this.choicePanel);
  }

  start(node) {
    this.runner.start(node);
    this.view.visible = true;
    this.advance();
  }

  /** Space / click: finish the typewriter, else go to the next line. */
  advance() {
    if (this.state === "typing") {
      this.revealed = this.total;
      return;
    }
    if (this.state === "choices" || this.state === "end") return;
    const ev = this.runner.next();
    if (ev.type === "end") return this.finish();
    if (ev.type === "choices") return this.showChoices(ev);
    this.showLine(ev);
  }

  choose(i = this.selected) {
    if (this.state !== "choices") return;
    const opt = this.choices.options[i];
    if (!opt) return;
    this.runner.choose(opt.index);
    this.choices = null;
    this.choicePanel.removeChildren();
    this.state = "ready";
    this.opts.onChoice?.(opt);
    this.advance();
  }

  finish() {
    this.state = "end";
    this.view.visible = false;
    this.opts.onEnd?.(this.runner.vars);
  }

  showLine(ev) {
    const { L, bundle } = this;
    this.line = ev;
    this.state = "typing";
    const set = ev.portrait ? bundle.portraits[ev.portrait] : null;
    const tex = set ? set[ev.emotion] ?? set.neutral : null;
    const right = ev.side === "right";
    const ps = L.portrait.size;
    const pad = L.portrait.pad;
    let textX = L.box.x + L.text.padX;
    let textW = L.box.w - L.text.padX * 2;
    this.well.visible = this.portrait.visible = !!tex;
    if (tex) {
      const px = right ? L.box.x + L.box.w - pad - ps : L.box.x + pad;
      const py = L.box.y + (L.box.h - ps) / 2;
      this.well.position.set(px - 1, py - 1);
      this.well.width = this.well.height = ps + 2;
      this.portrait.texture = tex;
      this.portrait.position.set(px, py);
      this.portrait.width = this.portrait.height = ps;
      if (!right) textX = px + ps + pad + 3;
      textW = L.box.w - (ps + pad * 2 + 3) - L.text.padX;
    }
    const hasName = !!ev.name;
    this.plate.visible = this.nameText.visible = this.plateBar.visible = hasName;
    if (hasName) {
      this.nameText.text = ev.name;
      const pw = Math.ceil(this.nameText.width + L.plate.padX * 2);
      const px = right && tex ? L.box.x + L.box.w - (ps + pad * 2 + 3) - pw + 4 : textX - 4;
      const py = L.box.y + L.plate.offsetY;
      this.plate.position.set(px, py);
      this.plate.width = pw;
      this.plate.height = L.plate.h;
      this.baselineTo(this.nameText, px + L.plate.padX, py + L.plate.h - 5.5);
      this.plateBar.clear();
      if (ev.color) this.plateBar.rect(px + 3, py + L.plate.h - 4, pw - 6, 1).fill(ev.color);
    }
    const measure = (s) => this.PIXI.CanvasTextMetrics.measureText(s || " ", this.body.style).width;
    const lines = wrapText(ev.text, textW, measure, this.doc.lang).slice(0, L.text.maxLines);
    this.fullText = lines.join("\n");
    this.clusters = graphemes(this.fullText);
    this.total = this.clusters.length;
    this.revealed = 0;
    this.body.text = "";
    this.body.text = "ก";
    this.baselineTo(this.body, textX, L.box.y + L.text.padY + (hasName ? 4 : 0) + L.text.fontSize);
    this.body.text = "";
    this.next.position.set(tex && right ? L.box.x + L.box.w - (ps + pad * 2 + 3) - 10 : L.box.x + L.box.w - 16, L.box.y + L.box.h - 12);
    this.next.visible = false;
    this.opts.onLine?.(ev);
  }

  showChoices(ev) {
    const { PIXI, L, bundle } = this;
    this.state = "choices";
    this.choices = ev;
    this.selected = 0;
    this.next.visible = false;
    if (!this.line) {
      this.box.visible = false;
    }
    const C2 = L.choices;
    const style = this.textStyle(C2.fontSize, this.C.choice);
    const widest = Math.max(...ev.options.map((o) => PIXI.CanvasTextMetrics.measureText(o.text, style).width));
    const w = Math.ceil(Math.max(C2.minW, widest + C2.padX + 14));
    const h = C2.padY * 2 + ev.options.length * C2.rowH;
    const x = L.box.x + L.box.w - w;
    const y = (this.line ? L.box.y + L.plate.offsetY : L.box.y + L.box.h) - C2.gap - h;
    this.choicePanel.removeChildren();
    this.choicePanel.position.set(x, y);
    const frame = this.nine(bundle.frames.box, this.doc.ui.margins.box);
    frame.width = w;
    frame.height = h;
    this.choicePanel.addChild(frame);
    this.hi = new PIXI.Graphics();
    this.cursor = new PIXI.Sprite(bundle.frames.cursor);
    this.choicePanel.addChild(this.hi, this.cursor);
    this.rows = ev.options.map((o, i) => {
      const t = new PIXI.Text({ text: o.text, style: this.textStyle(C2.fontSize, this.C.choice) });
      this.baselineTo(t, C2.padX, C2.padY + i * C2.rowH + C2.fontSize + 2.5);
      t.eventMode = "static";
      t.cursor = "pointer";
      t.on("pointerover", () => this.select(i));
      t.on("pointertap", () => this.choose(i));
      this.choicePanel.addChild(t);
      return t;
    });
    this.choiceW = w;
    this.select(0);
  }

  select(i) {
    if (!this.choices) return;
    const n = this.choices.options.length;
    this.selected = ((i % n) + n) % n;
    const C2 = this.L.choices;
    const ry = C2.padY + this.selected * C2.rowH;
    this.hi.clear().rect(6, ry + 1, this.choiceW - 12, C2.rowH - 2).fill({ color: this.C.accent, alpha: 0.16 });
    this.cursor.position.set(9, ry + 5);
    this.rows.forEach((t, k) => (t.style.fill = k === this.selected ? this.C.choiceHi : this.C.choice));
  }

  update(dt) {
    if (this.state === "typing") {
      this.revealed = Math.min(this.total, this.revealed + dt * (this.opts.cps ?? this.L.typewriter.cps));
      const n = Math.floor(this.revealed);
      this.body.text = this.clusters.slice(0, n).join("");
      if (n >= this.total) {
        this.body.text = this.fullText;
        this.state = "ready";
      }
    }
    this.blink += dt;
    this.next.visible = this.state === "ready";
    if (this.next.visible) this.next.y = this.L.box.y + this.L.box.h - 12 + (Math.floor(this.blink * 3) % 2);
  }

  /** Space/Enter/Z advance or pick; ↑/↓ move the cursor; click anywhere advances. */
  bindKeys(target = window, canvas) {
    target.addEventListener("keydown", (e) => {
      if (this.state === "choices") {
        if (e.key === "ArrowUp" || e.key === "w") this.select(this.selected - 1);
        else if (e.key === "ArrowDown" || e.key === "s") this.select(this.selected + 1);
        else if (e.key === "Enter" || e.key === " " || e.key === "z") this.choose();
        else if (/^[1-9]$/.test(e.key)) this.choose(Number(e.key) - 1);
        else return;
      } else if (e.key === "Enter" || e.key === " " || e.key === "z") this.advance();
      else return;
      e.preventDefault();
    });
    canvas?.addEventListener("pointerdown", () => {
      if (this.state !== "choices") this.advance();
    });
  }
}
