import type { DialogueDoc, Expr, Value } from "../../src/shared/types.js";

export interface LineEvent {
  type: "line";
  id: string;
  speaker: string | null;
  name: string;
  emotion: string;
  portrait: string | null;
  color: string | null;
  side: "left" | "right";
  voice: string | null;
  text: string;
  tags: string[];
  src: number;
  node: string | null;
}
export interface ChoicesEvent {
  type: "choices";
  options: { index: number; id: string; text: string; disabled?: boolean }[];
  src: number;
}
export type RunnerEvent = LineEvent | ChoicesEvent | { type: "end" };

export declare function graphemes(text: string): string[];
export declare function wordSegments(text: string, lang?: string): string[];
export declare function wrapText(text: string, maxWidth: number, measure: (s: string) => number, lang?: string): string[];
export declare function formatValue(v: unknown): string;
export declare function evaluate(e: Expr, vars: Record<string, Value>): Value;
export declare function interpolate(text: string, vars: Record<string, Value>): string;

export declare class DialogueRunner {
  constructor(doc: DialogueDoc, opts?: { variables?: Record<string, Value>; disabledChoices?: "hide" | "grey"; onEvent?: (name: string, args: string[], runner: DialogueRunner) => void });
  disabledChoices: "hide" | "grey";
  doc: DialogueDoc;
  vars: Record<string, Value>;
  node: string | null;
  ended: boolean;
  visited: Record<string, number>;
  start(node?: string): this;
  jump(id: string): void;
  next(): RunnerEvent;
  choose(index: number): unknown;
}

export declare function autoplay(
  doc: DialogueDoc,
  picks?: number[],
  opts?: { variables?: Record<string, Value>; node?: string },
): { transcript: string[]; vars: Record<string, Value>; events: string[] };
