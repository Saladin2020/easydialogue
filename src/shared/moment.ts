import { DialogueRunner, type ChoicesEvent, type LineEvent } from "./runner.js";
import type { DialogueDoc } from "./types.js";

export interface MomentQuery {
  /** Choice picks (positions in the visible list) used on the way. */
  picks?: number[];
  /** Stop at the N-th line shown (1-based). */
  line?: number;
  /** Stop at the line with this id. */
  lineId?: string;
  /** Stop at the K-th choice screen (1-based). */
  choice?: number;
  /** Start node (default @start). */
  node?: string;
}

export interface Moment {
  line: LineEvent | null;
  choices: ChoicesEvent | null;
  /** Lines seen so far, including `line`. */
  lineCount: number;
  vars: Record<string, unknown>;
}

/** Play to a moment (a line or a choice screen) for previews. Defaults to the first line. */
export function findMoment(doc: DialogueDoc, q: MomentQuery = {}): Moment {
  const r = new DialogueRunner(doc).start(q.node);
  const picks = q.picks ?? [];
  let pick = 0;
  let lines = 0;
  let choiceScreens = 0;
  let last: LineEvent | null = null;
  const wantLine = q.lineId ? undefined : q.choice ? undefined : q.line ?? 1;
  for (let guard = 0; guard < 10000; guard++) {
    const ev = r.next();
    if (ev.type === "end") break;
    if (ev.type === "line") {
      lines++;
      last = ev;
      if ((wantLine && lines === wantLine) || (q.lineId && ev.id === q.lineId)) return { line: ev, choices: null, lineCount: lines, vars: { ...r.vars } };
      continue;
    }
    choiceScreens++;
    if (q.choice && choiceScreens === q.choice) return { line: last, choices: ev, lineCount: lines, vars: { ...r.vars } };
    const want = picks[pick++] ?? 0;
    r.choose(ev.options[Math.min(want, ev.options.length - 1)]!.index);
  }
  if (q.lineId) throw new Error(`Line "${q.lineId}" is not reached with picks [${picks.join(",")}]`);
  if (q.choice) throw new Error(`Only ${choiceScreens} choice screen(s) on this path`);
  if (wantLine) throw new Error(`Only ${lines} line(s) on this path`);
  return { line: last, choices: null, lineCount: lines, vars: { ...r.vars } };
}
