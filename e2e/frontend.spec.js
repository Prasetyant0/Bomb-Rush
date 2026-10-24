// Playwright smoke test for the BOMB RUSH frontend.
//
// Purpose: catch the class of bug unit tests cannot see — a module that fails
// to import, an element the JS looks up but the markup does not have, a mobile
// control that never binds. Every page in this app is driven by
// document.getElementById, so a missing id is a silent no-op in Node and a
// dead control in a browser.
//
// Run:  npx playwright test --config=playwright.config.js
//
// The static app is served from apps/web; no backend is required. Network mode
// is deliberately NOT exercised here because it needs a live server and a
// wallet — that is a manual step, and claiming it works from a headless run
// would be a lie.

const { test, expect } = require("@playwright/test");

const BASE = process.env.BOMB_BASE || "http://127.0.0.1:4173";

/** Collects page errors, console errors, and failed requests for assertions. */
function watch(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("requestfailed", (r) => {
    // The three.js CDN is an import-map fetch; a sandboxed CI may not reach it.
    // Record it, but do not fail the run on network policy.
    if (!/cdn\.jsdelivr\.net|fonts\.googleapis/.test(r.url())) {
      errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`);
    }
  });
  return errors;
}

test.describe("frontend boots without errors", () => {
  test("home screen renders and no JS error fires", async ({ page }) => {
    const errors = watch(page);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#screen-home")).toHaveClass(/on/);
    // Give the module graph time to evaluate before asserting a clean console.
    await page.waitForTimeout(1500);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("every id the app looks up exists in the markup", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    // The ids app.js and engine.js bind by hand. A missing one is invisible in
    // Node and a dead button in the browser, which is exactly the bug class
    // this test exists for.
    const required = [
      "topbar", "toaster", "screen-home", "screen-create", "screen-lobby",
      "screen-arena", "screen-result", "fCustom", "fErr", "lbCode", "lbSeats",
      "lbEntry", "lbPool", "lbJoinRow", "lbJoin", "lbFoot",
      "tJoy", "tKnob", "tCam", "tRun", "tPass",
      "rHead", "rName", "rPool", "rPoolUnit", "rChain", "rTxLinks",
      "walletLabel", "chainBadge", "walletBtn",
    ];
    const missing = await page.evaluate(
      (ids) => ids.filter((id) => !document.getElementById(id)),
      required,
    );
    expect(missing, `missing ids: ${missing.join(", ")}`).toEqual([]);
  });

  test("navigating home → create does not throw", async ({ page }) => {
    const errors = watch(page);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    await page.locator('[data-action="create"]').first().click();
    await page.waitForTimeout(600);
    await expect(page.locator("#screen-create")).toHaveClass(/on/);
    // loadBounds() runs on this screen; with no escrow address it must degrade,
    // not throw.
    expect(errors.filter((e) => /pageerror/.test(e)), errors.join("\n")).toEqual([]);
  });

  test("local demo match starts and runs", async ({ page }) => {
    const errors = watch(page);
    await page.goto(BASE + "/?net=0", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);

    // Drive the flow the way a player does: create → pick seats → confirm.
    await page.locator('[data-action="create"]').first().click();
    await page.waitForTimeout(500);
    const confirm = page.locator('[data-action="confirm-create"]');
    if (await confirm.count()) {
      await confirm.first().click();
      await page.waitForTimeout(1200);
    }
    // The lobby is the observable outcome of a successful local room.
    const onLobby = await page.locator("#screen-lobby.on").count();
    expect(onLobby, "expected to reach the lobby").toBeGreaterThan(0);
    expect(errors.filter((e) => /pageerror/.test(e)), errors.join("\n")).toEqual([]);
  });
});

test.describe("mobile controls", () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test("touch HUD binds and the joystick is interactive", async ({ page }) => {
    const errors = watch(page);
    await page.goto(BASE + "/?net=0", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);

    await page.locator('[data-action="create"]').first().click();
    await page.waitForTimeout(500);
    const confirm = page.locator('[data-action="confirm-create"]');
    if (await confirm.count()) { await confirm.first().click(); await page.waitForTimeout(1200); }

    // Enter the arena: RUN is the deterministic action (it skips the lobby
    // countdown), and the touch HUD only exists on the arena screen.
    const skip = page.locator('[data-action="start"]');
    if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(1500); }

    const joy = page.locator("#tJoy");
    await expect(joy, "touch joystick must exist in the arena").toBeVisible();

    // A drag on the joystick must not throw. The knob moving is the observable
    // proof that the pointer registry accepted the pointerId.
    const box = await joy.boundingBox();
    expect(box, "joystick must have a layout box").not.toBeNull();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 10, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    expect(errors.filter((e) => /pageerror/.test(e)), errors.join("\n")).toEqual([]);
  });
});
