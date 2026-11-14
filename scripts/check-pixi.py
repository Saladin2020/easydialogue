"""Headless Chrome check of a PixiJS export: no console errors, Thai box renders, choices work.

  python3 scripts/check-pixi.py <pixi-export-dir> [shots-prefix]

Serves the folder on 127.0.0.1:8977, plays the dialogue with picks 0,0 via the page hooks
(window.__ed), saves screenshots of the 2nd line and the first choice screen, prints the log.
"""
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright

DIR = sys.argv[1]
PREFIX = sys.argv[2] if len(sys.argv) > 2 else "/tmp/pixi"
PORT = 8977
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME_PATH", "/usr/bin/google-chrome"), args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        pg = await b.new_page(viewport={"width": 1500, "height": 900})
        errs = []
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(f"http://127.0.0.1:{PORT}/index.html")
        await pg.wait_for_function("window.__ready === true", timeout=30000)
        state = lambda: pg.evaluate("window.__ed.state()")
        lines = 0
        shot_choice = False
        for _ in range(80):
            s = await state()
            if s["state"] == "end":
                break
            if s["state"] == "choices":
                if not shot_choice:
                    await pg.wait_for_timeout(300)
                    await pg.locator("canvas").screenshot(path=f"{PREFIX}-choices.png")
                    shot_choice = True
                await pg.keyboard.press("Enter")
            elif s["state"] == "typing":
                await pg.wait_for_function("window.__ed.state().state !== 'typing'", timeout=10000)
                lines += 1
                if lines == 2:
                    await pg.wait_for_timeout(200)
                    await pg.locator("canvas").screenshot(path=f"{PREFIX}-line.png")
            else:
                await pg.keyboard.press("Space")
            await pg.wait_for_timeout(30)
        log = await pg.evaluate("window.__ed.log")
        real = [e for e in errs if "GL Driver Message" not in e]  # swiftshader ReadPixels perf notes from screenshots
        print(json.dumps({"lines": lines, "log": log, "final": await state(), "errors": real, "ignoredGlNotes": len(errs) - len(real)}, ensure_ascii=False, indent=1))
        if real:
            sys.exit(1)
        await b.close()


try:
    asyncio.run(main())
finally:
    srv.terminate()
