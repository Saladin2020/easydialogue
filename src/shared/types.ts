/** Compiled dialogue document — `easydialogue/1`. Shared by the CLI, API, web editor and runtimes. */

export const FORMAT = "easydialogue/1" as const;

/** Expression AST (conditions, `~ set` values). Runtimes evaluate this tree; they never parse strings. */
export type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "var"; n: string }
  | { k: "un"; op: "not" | "-"; a: Expr }
  | { k: "bin"; op: BinOp; a: Expr; b: Expr };

export type BinOp = "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "and" | "or";

export type Value = number | string | boolean;

export interface LineStmt {
  t: "line";
  /** Stable line id (`node_N` or explicit `#line:id`) — used by voice manifests and translations. */
  id: string;
  /** Character id (or a raw name when undeclared); omitted for narration. */
  speaker?: string;
  emotion?: string;
  /** Text; may contain `{variable}` interpolations. */
  text: string;
  tags?: string[];
  src: number;
}

export type DisabledChoice = "hide" | "grey";

export interface ChoiceOption {
  id: string;
  text: string;
  cond?: Expr;
  /** When the condition fails: hide (default) or show the choice greyed out. Overrides the document default. */
  disabled?: DisabledChoice;
  body: Stmt[];
  src: number;
}

export interface ChoiceStmt {
  t: "choice";
  options: ChoiceOption[];
  src: number;
}

export interface IfStmt {
  t: "if";
  branches: { cond?: Expr; body: Stmt[] }[];
  src: number;
}

export interface SetStmt {
  t: "set";
  var: string;
  op: "=" | "+=" | "-=" | "*=" | "/=";
  value: Expr;
  src: number;
}

export interface JumpStmt {
  t: "jump";
  target: string;
  src: number;
}

export interface EndStmt {
  t: "end";
  src: number;
}

/** `@ command args` — free-form game event (camera, sfx, give item…) surfaced to the game. */
export interface EventStmt {
  t: "event";
  name: string;
  args: string[];
  src: number;
}

export type Stmt = LineStmt | ChoiceStmt | IfStmt | SetStmt | JumpStmt | EndStmt | EventStmt;

export interface CharacterDef {
  id: string;
  name: string;
  /** Portrait set id → `portraits/<portrait>/<emotion>.png`. */
  portrait?: string;
  color?: string;
  /** ElevenLabs voice id / name (manifest only — Easy Dialogue never calls the API). */
  voice?: string;
  /** Portrait side in the box. */
  side?: "left" | "right";
}

export interface DialogueNode {
  id: string;
  tags: string[];
  body: Stmt[];
  src: number;
}

export interface DialogueDoc {
  format: typeof FORMAT;
  id: string;
  title: string;
  start: string;
  lang: string;
  variables: Record<string, Value>;
  characters: Record<string, CharacterDef>;
  nodes: Record<string, DialogueNode>;
  /** Box style id used by previews/exports (overridable at export). */
  box?: string;
  /** Failed-condition choices: hide them (default, backward compatible) or show them greyed out. */
  disabledChoices?: DisabledChoice;
  meta: { lines: number; choices: number; generator: string };
}

export interface Diagnostic {
  line: number;
  col: number;
  severity: "error" | "warning";
  message: string;
}

export interface CompileResult {
  doc: DialogueDoc | null;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

export const EMOTIONS = ["neutral", "happy", "sad", "surprised", "angry", "thinking", "shy"] as const;
export type Emotion = (typeof EMOTIONS)[number];

/** Thai aliases accepted in `[emotion]` tags. */
export const EMOTION_ALIASES: Record<string, Emotion> = {
  ปกติ: "neutral",
  เฉย: "neutral",
  ดีใจ: "happy",
  ยิ้ม: "happy",
  เศร้า: "sad",
  เสียใจ: "sad",
  ตกใจ: "surprised",
  โกรธ: "angry",
  คิด: "thinking",
  สงสัย: "thinking",
  เขิน: "shy",
  อาย: "shy",
  smile: "happy",
  joy: "happy",
  surprise: "surprised",
  mad: "angry",
  think: "thinking",
  blush: "shy",
};

export function normalizeEmotion(raw: string): string {
  const k = raw.trim().toLowerCase();
  return (EMOTION_ALIASES[k] ?? EMOTION_ALIASES[raw.trim()] ?? k) as string;
}

export const BOX_STYLES = ["teak", "lantern", "paper", "night"] as const;
export type BoxStyle = (typeof BOX_STYLES)[number];
