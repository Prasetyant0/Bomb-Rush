// Playwright config — static frontend only, no backend required.
//
// The app is plain ES modules served from apps/web; there is no build step and
// no bundler, so a static file server is the correct harness.
const { defineConfig, devices } = require("@playwright/test");

const PORT = 4173;

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // `serve` keeps directory semantics (index.html per path) intact; a bare
    // http-server would rewrite /app.js incorrectly on some versions.
    command: `npx --yes serve apps/web -l ${PORT} --no-clipboard`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
