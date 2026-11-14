/**
 * Rebuild the bundled sample portraits from the Easy Sprite Thai town cast.
 *   npx tsx scripts/build-samples.mts [castDir]
 * castDir defaults to the studio demo cast (town_*.png + .json, Easy Sprite native side-view sheets).
 * Backgrounds in samples/backgrounds are Easy Scene renders of thai_village_cast (camera 0 and 300, scale 1);
 * kampung_mosque.png is harmony_town at camera 560.
 * The Muslim neighbours (town_hijab_teacher, town_kopiah_boy, town_pak_cik, town_roti_seller, town_tadika_girl)
 * come from Easy Sprite's hijab_teacher, kopiah_boy, pak_cik_jubah, roti_seller and tadika_girl demos in side view;
 * pass their folder as the second argument.
 */
import path from "node:path";
import { rm } from "node:fs/promises";
import { makePortraits } from "../src/lib/portraits.js";

const cast = process.argv[2] ?? "/workspace/indie-studio/projects/_easyscene-demo/v2-cast";
const muslimCast = process.argv[3];
const out = path.resolve("samples/portraits");
for (const n of ["kid", "vendor", "monk", "farmer", "student", "elder"]) {
  await rm(path.join(out, `town_${n}`), { recursive: true, force: true });
  const r = await makePortraits({ sheet: path.join(cast, `town_${n}.png`), outDir: out });
  console.log(r.id, Object.keys(r.files).join(","), r.faceSwap ? "face-swap" : "overlay-only", r.warnings.join("; "));
}
for (const n of muslimCast ? ["hijab_teacher", "kopiah_boy", "pak_cik", "roti_seller", "tadika_girl"] : []) {
  await rm(path.join(out, `town_${n}`), { recursive: true, force: true });
  const r = await makePortraits({ sheet: path.join(muslimCast!, `town_${n}.png`), outDir: out });
  console.log(r.id, Object.keys(r.files).join(","), r.faceSwap ? "face-swap" : "overlay-only", r.warnings.join("; "));
}
