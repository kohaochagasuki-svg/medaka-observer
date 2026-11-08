const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests', testMatch: 'browser.spec.cjs', workers: 1, timeout: 240000,
  use: { baseURL: 'http://127.0.0.1:8765', viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true,
    launchOptions: { executablePath: process.env.MEDAKA_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] } },
  webServer: { command: 'python3 -m http.server 8765 --bind 127.0.0.1', url: 'http://127.0.0.1:8765', reuseExistingServer: false },
  reporter: 'list', outputDir: 'test-results'
});
