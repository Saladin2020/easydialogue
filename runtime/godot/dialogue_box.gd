extends Control
## Easy Dialogue box for Godot 4.3+: 9-slice pixel frame, name plate, portrait, typewriter and choices.
## Layout, colours and asset paths come from the exported `.dialogue.json` (`ui` + `assets`).
## Thai: Kanit (OFL) is shaped by Godot's TextServerAdvanced (HarfBuzz + ICU line breaking), and the
## typewriter reveals whole clusters so tone marks never appear one frame late.
##
## Controls: Enter / Space / click advance · ↑/↓ + Enter or click to choose · 1-9 pick directly.
## MIT License. https://github.com/Saladin2020/easydialogue

signal line_started(ev: Dictionary)
signal choice_made(option: Dictionary)
signal dialogue_finished(vars: Dictionary)
signal event_fired(name: String, args: Array)

const Runner = preload("dialogue_runner.gd")

@export_file("*.json") var dialogue_path := ""
@export var autostart := true
## Characters per second (0 = value from the file).
@export var chars_per_second := 0.0

var runner
var ui: Dictionary = {}
var L: Dictionary = {}
var C: Dictionary = {}
var state := "idle"
var selected := 0
var current_line = null
var current_choices = null

var _tex := {}
var _portraits := {}
var _font_body: Font
var _font_name: Font
var _bounds: PackedInt32Array = PackedInt32Array()
var _revealed := 0.0
var _rows: Array = []
var _blink := 0.0
var _next_base_y := 0.0
var _choice_w := 0.0

@onready var box: NinePatchRect = $Box
@onready var well: NinePatchRect = $Well
@onready var portrait: TextureRect = $Portrait
@onready var plate: NinePatchRect = $Plate
@onready var plate_bar: ColorRect = $PlateBar
@onready var name_label: Label = $NameLabel
@onready var body: Label = $Body
@onready var next_icon: TextureRect = $Next
@onready var choices: NinePatchRect = $Choices
@onready var highlight: ColorRect = $Choices/Highlight
@onready var cursor: TextureRect = $Choices/Cursor
@onready var rows_root: Control = $Choices/Rows


func _ready() -> void:
	visible = false
	if dialogue_path != "" and load_dialogue(dialogue_path) and autostart:
		start.call_deferred()  # deferred so the parent can connect signals first


func load_dialogue(path: String, initial: Dictionary = {}) -> bool:
	runner = Runner.new()
	if not runner.load_file(path, initial):
		return false
	runner.event_fired.connect(func(n, a): event_fired.emit(n, a))
	ui = runner.doc.get("ui", {})
	L = ui.get("layout", {})
	C = ui.get("colors", {})
	var assets: Dictionary = runner.doc.get("assets", {})
	for k in assets.get("frames", {}):
		_tex[k] = load(assets["frames"][k])
	_portraits.clear()
	var ps: Dictionary = assets.get("portraits", {})
	for id in ps:
		_portraits[id] = {}
		for emo in ps[id]:
			_portraits[id][emo] = load(ps[id][emo])
	var fonts: Dictionary = assets.get("fontFiles", {})
	_font_body = load(fonts.get("body", "res://fonts/Kanit-Regular.ttf"))
	_font_name = load(fonts.get("name", "res://fonts/Kanit-Medium.ttf"))
	_setup_nodes()
	return true


func _setup_nodes() -> void:
	var m: Dictionary = ui.get("margins", {})
	_nine(box, _tex.get("box"), int(m.get("box", 8)))
	_nine(choices, _tex.get("box"), int(m.get("box", 8)))
	_nine(plate, _tex.get("plate"), int(m.get("plate", 5)))
	_nine(well, _tex.get("well"), int(m.get("well", 4)))
	next_icon.texture = _tex.get("next")
	cursor.texture = _tex.get("cursor")
	var b: Dictionary = L["box"]
	box.position = Vector2(b["x"], b["y"])
	box.size = Vector2(b["w"], b["h"])
	_style_label(body, _font_body, int(L["text"]["fontSize"]), C["text"], true)
	body.add_theme_constant_override("line_spacing", int(round(float(L["text"]["lineHeight"]) - _font_body.get_height(int(L["text"]["fontSize"])))))
	body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.max_lines_visible = int(L["text"]["maxLines"])
	body.visible_characters_behavior = TextServer.VC_CHARS_AFTER_SHAPING
	_style_label(name_label, _font_name, int(L["plate"]["fontSize"]), C["plateText"], false)
	highlight.color = Color(C["accent"], 0.16)


func _nine(n: NinePatchRect, t: Texture2D, margin: int) -> void:
	n.texture = t
	n.patch_margin_left = margin
	n.patch_margin_top = margin
	n.patch_margin_right = margin
	n.patch_margin_bottom = margin


func _style_label(l: Label, f: Font, size: int, color: String, shadow: bool) -> void:
	l.add_theme_font_override("font", f)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", Color(color))
	if shadow and C.get("shadow") != null:
		l.add_theme_color_override("font_shadow_color", Color(str(C["shadow"])))
		l.add_theme_constant_override("shadow_offset_x", 1)
		l.add_theme_constant_override("shadow_offset_y", 1)
		l.add_theme_constant_override("shadow_outline_size", 0)
	l.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR


## Label top so the first baseline lands at `baseline`.
func _top_for(f: Font, size: int, baseline: float) -> float:
	return baseline - f.get_ascent(size)


func start(node: String = "") -> void:
	if runner == null:
		push_error("Easy Dialogue: call load_dialogue() first")
		return
	runner.start(node)
	visible = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	state = "ready"
	current_line = null
	advance()


## Enter/Space/click: finish the typewriter, else go to the next line.
func advance() -> void:
	if state == "typing":
		_revealed = float(_bounds.size())
		return
	if state == "choices" or state == "end" or state == "idle":
		return
	var ev: Dictionary = runner.next()
	match str(ev["type"]):
		"end":
			_finish()
		"choices":
			_show_choices(ev)
		_:
			_show_line(ev)


func choose(i: int = -1) -> void:
	if state != "choices":
		return
	if i < 0:
		i = selected
	var opts: Array = current_choices["options"]
	if i >= opts.size():
		return
	var opt: Dictionary = opts[i]
	if opt.get("disabled", false):
		return
	runner.choose(int(opt["index"]))
	current_choices = null
	choices.visible = false
	state = "ready"
	choice_made.emit(opt)
	advance()


func _finish() -> void:
	state = "end"
	visible = false
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	dialogue_finished.emit(runner.vars)


func _show_line(ev: Dictionary) -> void:
	current_line = ev
	state = "typing"
	box.visible = true
	choices.visible = false
	var b: Dictionary = L["box"]
	var ps := float(L["portrait"]["size"])
	var pad := float(L["portrait"]["pad"])
	var right: bool = str(ev.get("side", "left")) == "right"
	var tex: Texture2D = null
	if ev.get("portrait") != null and _portraits.has(ev["portrait"]):
		var pset: Dictionary = _portraits[ev["portrait"]]
		tex = pset.get(ev["emotion"], pset.get("neutral"))
	var text_x := float(b["x"]) + float(L["text"]["padX"])
	var text_w := float(b["w"]) - float(L["text"]["padX"]) * 2.0
	well.visible = tex != null
	portrait.visible = tex != null
	if tex != null:
		var px := float(b["x"]) + float(b["w"]) - pad - ps if right else float(b["x"]) + pad
		var py := float(b["y"]) + (float(b["h"]) - ps) / 2.0
		well.position = Vector2(px - 1, py - 1)
		well.size = Vector2(ps + 2, ps + 2)
		portrait.texture = tex
		portrait.position = Vector2(px, py)
		portrait.size = Vector2(ps, ps)
		if not right:
			text_x = px + ps + pad + 3
		text_w = float(b["w"]) - (ps + pad * 2 + 3) - float(L["text"]["padX"])
	var nm := str(ev.get("name", ""))
	var has_name := nm != ""
	plate.visible = has_name
	name_label.visible = has_name
	plate_bar.visible = has_name and ev.get("color") != null
	name_label.text = nm
	if has_name:
		var fs := int(L["plate"]["fontSize"])
		name_label.text = nm
		var pw: float = ceil(_font_name.get_string_size(nm, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x + float(L["plate"]["padX"]) * 2.0)
		var px2: float = float(b["x"]) + float(b["w"]) - (ps + pad * 2 + 3) - pw + 4 if (right and tex != null) else text_x - 4
		var py2 := float(b["y"]) + float(L["plate"]["offsetY"])
		plate.position = Vector2(px2, py2)
		plate.size = Vector2(pw, float(L["plate"]["h"]))
		name_label.position = Vector2(px2 + float(L["plate"]["padX"]), _top_for(_font_name, fs, py2 + float(L["plate"]["h"]) - 5.5))
		name_label.size = Vector2(pw, fs * 2)
		if ev.get("color") != null:
			plate_bar.color = Color(str(ev["color"]))
			plate_bar.position = Vector2(px2 + 3, py2 + float(L["plate"]["h"]) - 4)
			plate_bar.size = Vector2(pw - 6, 1)
	var tfs := int(L["text"]["fontSize"])
	var baseline := float(b["y"]) + float(L["text"]["padY"]) + (4.0 if has_name else 0.0) + tfs
	body.position = Vector2(text_x, _top_for(_font_body, tfs, baseline))
	body.size = Vector2(text_w, float(L["text"]["lineHeight"]) * float(L["text"]["maxLines"]) + 6)
	body.text = str(ev["text"])
	_bounds = _cluster_bounds(body.text)
	_revealed = 0.0
	body.visible_characters = 0
	var nx: float = float(b["x"]) + float(b["w"]) - (ps + pad * 2 + 3) - 10 if (right and tex != null) else float(b["x"]) + float(b["w"]) - 16
	_next_base_y = float(b["y"]) + float(b["h"]) - 12
	next_icon.position = Vector2(nx, _next_base_y)
	next_icon.size = Vector2(7, 5)
	next_icon.visible = false
	line_started.emit(ev)


## Character counts at the end of each grapheme cluster (Thai marks stay with their base letter).
static func _cluster_bounds(text: String) -> PackedInt32Array:
	var out := PackedInt32Array()
	var n := text.length()
	for i in n:
		if i + 1 < n and _is_combining(text.unicode_at(i + 1)):
			continue
		out.append(i + 1)
	return out


static func _is_combining(c: int) -> bool:
	return c == 0x0E31 or (c >= 0x0E34 and c <= 0x0E3A) or (c >= 0x0E47 and c <= 0x0E4E)


func _show_choices(ev: Dictionary) -> void:
	state = "choices"
	current_choices = ev
	next_icon.visible = false
	if current_line == null:
		box.visible = false
		well.visible = false
		portrait.visible = false
		plate.visible = false
		name_label.visible = false
		plate_bar.visible = false
	var c2: Dictionary = L["choices"]
	var fs := int(c2["fontSize"])
	var opts: Array = ev["options"]
	var widest := 0.0
	for o in opts:
		widest = max(widest, _font_body.get_string_size(str(o["text"]), HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x)
	var w: float = ceil(max(float(c2["minW"]), widest + float(c2["padX"]) + 14))
	var h := float(c2["padY"]) * 2 + opts.size() * float(c2["rowH"])
	var b: Dictionary = L["box"]
	var top := float(b["y"]) + float(L["plate"]["offsetY"]) if current_line != null else float(b["y"]) + float(b["h"])
	choices.position = Vector2(float(b["x"]) + float(b["w"]) - w, top - float(c2["gap"]) - h)
	choices.size = Vector2(w, h)
	choices.visible = true
	_choice_w = w
	for r in _rows:
		r.queue_free()
	_rows.clear()
	for i in opts.size():
		var l := Label.new()
		var dim: bool = bool(opts[i].get("disabled", false))
		_style_label(l, _font_body, fs, C["choiceDim"] if dim else C["choice"], true)
		l.text = str(opts[i]["text"])
		l.position = Vector2(float(c2["padX"]), _top_for(_font_body, fs, float(c2["padY"]) + i * float(c2["rowH"]) + fs + 2.5))
		l.mouse_filter = Control.MOUSE_FILTER_STOP
		var idx := i
		l.mouse_entered.connect(func(): if not _option_disabled(idx): _select(idx))
		l.gui_input.connect(func(e): if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT: choose(idx))
		rows_root.add_child(l)
		_rows.append(l)
	_select(0)


func _option_disabled(i: int) -> bool:
	if current_choices == null:
		return true
	var opts: Array = current_choices["options"]
	if i < 0 or i >= opts.size():
		return true
	return bool(opts[i].get("disabled", false))


func _select(i: int, dir: int = 1) -> void:
	if current_choices == null:
		return
	var n: int = (current_choices["options"] as Array).size()
	if n == 0:
		return
	var idx := ((i % n) + n) % n
	for _k in n:
		if not _option_disabled(idx):
			break
		idx = ((idx + dir) % n + n) % n
	selected = idx
	var dim := _option_disabled(selected)
	var c2: Dictionary = L["choices"]
	var ry := float(c2["padY"]) + selected * float(c2["rowH"])
	highlight.position = Vector2(6, ry + 1)
	highlight.size = Vector2(_choice_w - 12, float(c2["rowH"]) - 2)
	cursor.position = Vector2(9, ry + 5)
	cursor.size = Vector2(6, 7)
	highlight.visible = not dim
	cursor.visible = not dim
	for k in _rows.size():
		var col: String = C["choiceDim"] if _option_disabled(k) else (C["choiceHi"] if k == selected else C["choice"])
		_rows[k].add_theme_color_override("font_color", Color(col))


func _process(delta: float) -> void:
	if state == "typing":
		var cps := chars_per_second if chars_per_second > 0.0 else float(L["typewriter"]["cps"])
		_revealed = min(float(_bounds.size()), _revealed + delta * cps)
		var k := int(_revealed)
		body.visible_characters = _bounds[k - 1] if k > 0 else 0
		if k >= _bounds.size():
			body.visible_characters = -1
			state = "ready"
	_blink += delta
	next_icon.visible = state == "ready" and visible
	if next_icon.visible:
		next_icon.position.y = _next_base_y + float(int(_blink * 3.0) % 2)


func _unhandled_input(event: InputEvent) -> void:
	if not visible:
		return
	if state == "choices":
		if event.is_action_pressed("ui_up"):
			_select(selected - 1, -1)
		elif event.is_action_pressed("ui_down"):
			_select(selected + 1, 1)
		elif event.is_action_pressed("ui_accept"):
			choose()
		elif event is InputEventKey and event.pressed and event.keycode >= KEY_1 and event.keycode <= KEY_9:
			choose(event.keycode - KEY_1)
		else:
			return
	elif event.is_action_pressed("ui_accept"):
		advance()
	else:
		return
	get_viewport().set_input_as_handled()


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT and state != "choices":
		advance()
		accept_event()
