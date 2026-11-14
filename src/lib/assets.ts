import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts } from "@napi-rs/canvas";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Package root, whether running from src/lib (tsx), dist/ (built) or a test. */
export const pkgRoot = [path.resolve(here, "../.."), path.resolve(here, "..")].find((p) => existsSync(path.join(p, "assets", "fonts"))) ?? path.resolve(here, "../..");

export const FONT_DIR = path.join(pkgRoot, "assets", "fonts");
export const RUNTIME_DIR = path.join(pkgRoot, "runtime");
export const FONT_REGULAR = path.join(FONT_DIR, "Kanit-Regular.ttf");
export const FONT_MEDIUM = path.join(FONT_DIR, "Kanit-Medium.ttf");

let registered = false;
/** Register Kanit with Skia (HarfBuzz shaping → Thai vowels and tone marks stack correctly). */
export function registerFonts(): void {
  if (registered) return;
  GlobalFonts.registerFromPath(FONT_REGULAR, "Kanit");
  GlobalFonts.registerFromPath(FONT_MEDIUM, "Kanit Medium");
  registered = true;
}
