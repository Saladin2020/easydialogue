import type { BoxStyle } from "./types.js";

/**
 * Dialogue box layout in game pixels for a 480×270 viewport (Easy Scene's default).
 * Exported into every compiled bundle so the PixiJS and Godot runtimes draw the same box.
 */
export interface UiLayout {
  viewport: { width: number; height: number };
  box: { x: number; y: number; w: number; h: number };
  frameMargin: number;
  plateMargin: number;
  wellMargin: number;
  portrait: { size: number; pad: number };
  text: { padX: number; padY: number; fontSize: number; lineHeight: number; maxLines: number };
  plate: { h: number; padX: number; fontSize: number; offsetY: number };
  choices: { rowH: number; padX: number; padY: number; gap: number; fontSize: number; minW: number };
  typewriter: { cps: number };
}

export const DEFAULT_LAYOUT: UiLayout = {
  viewport: { width: 480, height: 270 },
  box: { x: 8, y: 186, w: 464, h: 78 },
  frameMargin: 8,
  plateMargin: 5,
  wellMargin: 4,
  portrait: { size: 64, pad: 7 },
  text: { padX: 10, padY: 9, fontSize: 11, lineHeight: 17, maxLines: 3 },
  plate: { h: 19, padX: 9, fontSize: 10, offsetY: -12 },
  choices: { rowH: 18, padX: 22, padY: 8, gap: 6, fontSize: 11, minW: 150 },
  typewriter: { cps: 40 },
};

export interface StyleColors {
  text: string;
  name: string;
  plateText: string;
  choice: string;
  choiceHi: string;
  choiceDim: string;
  accent: string;
  shadow: string | null;
}

export const STYLE_COLORS: Record<BoxStyle, StyleColors> = {
  teak: { text: "#f7ebd3", name: "#ffd27a", plateText: "#1a120b", choice: "#f7ebd3", choiceHi: "#ffd27a", choiceDim: "#97805f", accent: "#f4ae3d", shadow: "#0d0906" },
  lantern: { text: "#fff1dc", name: "#ffe2a0", plateText: "#2a0f08", choice: "#fff1dc", choiceHi: "#ffd27a", choiceDim: "#c48a7a", accent: "#f4ae3d", shadow: "#1a0705" },
  paper: { text: "#3a2819", name: "#8a3a22", plateText: "#fff6dc", choice: "#3a2819", choiceHi: "#b9411f", choiceDim: "#a08a6a", accent: "#b9741f", shadow: null },
  night: { text: "#e8eefc", name: "#a9e0ff", plateText: "#0b0f1e", choice: "#e8eefc", choiceHi: "#a9e0ff", choiceDim: "#6a7aa8", accent: "#8fc7e8", shadow: "#05070f" },
};

export const STYLE_LABELS: Record<BoxStyle, string> = {
  teak: "Teak wood (ไม้สัก)",
  lantern: "Red lantern (โคมแดง)",
  paper: "Rice paper (กระดาษสา)",
  night: "Night market (ตลาดกลางคืน)",
};
