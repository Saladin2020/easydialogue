# Credits

## Fonts

* **Kanit** (Regular, Medium) — Copyright 2020 The Kanit Project Authors (https://github.com/cadsondemak/kanit).
  Licensed under the SIL Open Font License 1.1, see `assets/fonts/OFL.txt`. Bundled unmodified in
  `assets/fonts/` and copied into Pixi / Godot exports.

## Art made for Easy Dialogue (CC0 1.0)

* Dialogue box, name plate, portrait well, next arrow and choice cursor frames for the `teak`, `lantern`,
  `paper` and `night` styles are drawn procedurally in `src/shared/frames.ts`.
* Emotion overlays on portraits (sparkle, tear, `!`, anger vein, `...`, blush + heart) are drawn in
  `src/lib/portraits.ts`.
* App icons (`scripts/write-icons.mjs`).

These are dedicated to the public domain (CC0 1.0): use them in any project, no attribution required.

## Sample content

* **Thai town cast** (`samples/portraits/town_*`): cropped from 48px side-view sheets composed with
  [Easy Sprite](https://github.com/Saladin2020/easysprite) (kid, vendor, monk, farmer, student, elder), from
  the Easy Sprite demo cast. Same licence as Easy Sprite's parts.
* **Backgrounds** (`samples/backgrounds/thai_village_*.png`): rendered from the
  [Easy Scene](https://github.com/Saladin2020/easyscene) `thai_village_cast` demo scene.
* Demo script `village_delivery.ezd` (Thai village delivery) — MIT, like the code.

## Runtimes

* PixiJS v8 is **not** bundled: the exported `index.html` loads `./pixi.min.js` if you drop it next to the
  file, otherwise the jsDelivr CDN (`pixi.js@8`, MIT).
