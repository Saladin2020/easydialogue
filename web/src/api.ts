import type { CompileResult } from "../../src/shared/types";

export interface WorkspaceSummary {
  root: string;
  config: { name: string; style: string; background: string; portraitScale: number };
  scripts: { id: string; title: string; nodes: number; lines: number; choices: number; errors: number; warnings: number }[];
  portraits: { id: string; emotions: string[] }[];
  backgrounds: string[];
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const fetchWorkspace = () => fetch("/api/workspace").then((r) => json<WorkspaceSummary>(r));
export const fetchScript = (id: string) => fetch(`/api/scripts/${id}`).then((r) => json<CompileResult & { id: string; source: string }>(r));
export const saveScript = (id: string, source: string, force = false) =>
  post(`/api/scripts/${id}`, { source, force }).then((r) => json<{ ok: boolean; file: string; errors: unknown[]; warnings: unknown[] }>(r));
export const exportDialogue = (id: string, preset: string, style?: string, background?: string | null) =>
  post("/api/export", { id, preset, style, background }).then((r) => json<{ ok: boolean; dirs: string[]; files: number; warnings: string[] }>(r));
export const makePortraits = (sheet: string, id?: string) =>
  post("/api/portraits", { sheet, id: id || undefined }).then((r) => json<{ ok: boolean; id: string; emotions: string[]; faceSwap: boolean; warnings: string[] }>(r));
export const portraitUrl = (id: string, emotion: string) => `/api/portraits/${encodeURIComponent(id)}/${encodeURIComponent(emotion)}.png`;
export const backgroundUrl = (file: string) => `/api/backgrounds/${encodeURIComponent(file)}`;
