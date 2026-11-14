/**
 * Rebuild the bundled sample portraits from the Easy Sprite Thai town cast.
 *   npx tsx scripts/build-samples.mts [castDir]
 * castDir defaults to the studio demo cast (town_*.png + .json, Easy Sprite native side-view sheets).
 * Backgrounds in samples/backgrounds are Easy Scene renders of thai_village_cast (camera 0 and 300, scale 1).
 */
import path from "node:path";
import { rm } from "node:fs/promises";
import { makePortraits } from "../src/lib/portraits.js";

const cast = process.argv[2] ?? "/workspace/indie-studio/projects/_easyscene-demo/v2-cast";
const out = path.resolve("samples/portraits");
await rm(out, { recursive: true, force: true });
for (const n of ["kid", "vendor", "monk", "farmer", "student", "elder"]) {
  const r = await makePortraits({ sheet: path.join(cast, `town_${n}.png`), outDir: out });
  console.log(r.id, Object.keys(r.files).join(","), r.faceSwap ? "face-swap" : "overlay-only", r.warnings.join("; "));
}
