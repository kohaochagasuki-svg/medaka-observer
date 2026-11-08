const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
const fixture = path.join(__dirname, 'fixtures/five-fish-3min.mp4');
async function load(page) {
  await page.goto('/');
  await page.locator('#video-file').setInputFiles(fixture);
  await expect(page.locator('#start-analysis')).toBeEnabled();
}

test('3分動画を端末内でデコード・Worker解析し、60横断の候補を確認・修正・CSV保存できる', async ({ page }) => {
  const errors = [], external = [], posts = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:8765/')) external.push(request.url()); if (request.method() !== 'GET') posts.push(request.method()); });
  await load(page);
  await page.locator('#tank-id').fill('A水槽'); await page.locator('#light-hours').fill('8');
  await page.locator('#start-analysis').click();
  await expect(page.locator('#stop-analysis')).toBeEnabled();
  await expect(page.locator('#line-position')).toBeDisabled();
  await expect(page.locator('#change-video')).toBeDisabled();
  await expect(page.locator('#analysis-status')).toContainText('解析処理が完了', { timeout: 220000 });
  await expect(page.locator('#analysis-progress')).toHaveJSProperty('value', 100);
  await expect(page.locator('#candidate-counts')).toContainText('修正前の自動候補 60件');
  await expect(page.locator('#candidate-counts')).toContainText('左→右 30件・右→左 30件');
  await expect(page.locator('#count-confirmed')).toHaveText('0');
  await expect(page.locator('#event-page-label')).toHaveText('1〜20 / 60件');
  await expect(page.locator('#tracking-overlay')).toBeVisible();
  await expect(page.locator('#line-position')).toBeEnabled();
  const records = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('medaka-lab.frames.v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
    const chunks = await new Promise((resolve, reject) => { const r = db.transaction('chunks').objectStore('chunks').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
    db.close(); return { chunks: chunks.length, frames: chunks.reduce((n, c) => n + c.frames.length, 0), maxChunk: Math.max(...chunks.map(c => c.frames.length)) };
  });
  expect(records).toEqual({ chunks: 18, frames: 1800, maxChunk: 100 });
  const first = page.locator('#event-rows tr').first();
  await first.locator('select').nth(1).selectOption('confirmed');
  await first.locator('select').nth(0).selectOption('negative');
  await first.locator('input[type=number]').fill('3.25'); await first.locator('input[type=number]').blur();
  await expect(page.locator('#count-confirmed')).toHaveText('1');
  await expect(page.locator('#count-negative')).toHaveText('1');
  await page.locator('#event-rows tr').nth(1).locator('select').nth(1).selectOption('excluded');
  await page.locator('#manual-time').fill('2.50'); await page.locator('#manual-note').fill('重なりを確認');
  await page.locator('#add-manual-event').click();
  await expect(page.locator('#count-confirmed')).toHaveText('2');
  await page.locator('#reference-positive').fill('30'); await page.locator('#reference-negative').fill('30'); await page.locator('#compare-counts').click();
  await expect(page.locator('#comparison-result')).toContainText('合計 0件');
  const download = page.waitForEvent('download'); await page.locator('#export-csv').click();
  const csv = await fs.readFile(await (await download).path(), 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff); expect(csv).toContain('"completed"'); expect(csv).toContain('"A水槽"'); expect(csv).toContain('"3.250"'); expect(csv).toContain('"手動追加"'); expect(csv).toContain('"除外"');
  await page.locator('#events-next').click(); await expect(page.locator('#event-page-label')).toHaveText('21〜40 / 61件');
  await page.locator('#events-prev').click(); await page.locator('#event-rows tr').first().locator('button').click();
  await expect(page.locator('#overlay-status')).toContainText('記録');
  await page.locator('#horizontal').click(); await expect(page.locator('#overlay-status')).toContainText('中央線が解析後に変更');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-analysis.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 }); await page.screenshot({ path: 'test-results/desktop-analysis.png', fullPage: true });
  expect(external).toEqual([]); expect(posts).toEqual([]); expect(errors).toEqual([]);
});

test('中断は100%や完了と表示せず、Workerを終了し、途中CSVと通常操作を残す', async ({ page }) => {
  await load(page); await page.locator('#start-analysis').click();
  await expect(page.locator('#analysis-status')).toContainText('解析中', { timeout: 20000 });
  await page.locator('#stop-analysis').click();
  await expect(page.locator('#analysis-status')).toContainText('解析を中断しました');
  expect(await page.locator('#analysis-progress').evaluate(e => e.value)).toBeLessThan(100);
  await expect(page.locator('#play-pause')).toBeEnabled(); await expect(page.locator('#vertical')).toBeEnabled();
  await expect.poll(() => page.workers().length).toBe(0);
  const download = page.waitForEvent('download'); await page.locator('#export-csv').click();
  const csv = await fs.readFile(await (await download).path(), 'utf8'); expect(csv).toContain('"interrupted"');
  await page.locator('#video-file').setInputFiles(fixture);
  await expect(page.locator('#count-confirmed')).toHaveText('—'); await expect(page.locator('#start-analysis')).toBeEnabled();
  await expect(page.locator('#tracking-overlay')).toBeHidden();
});

test('背景推定中も中断でき、再解析と通常の再生・条件保存を維持する', async ({ page }) => {
  await load(page); await page.locator('#start-analysis').click();
  await expect(page.locator('#analysis-status')).toContainText('背景を推定中');
  await page.locator('#stop-analysis').click();
  await expect(page.locator('#analysis-status')).toContainText('解析を中断しました');
  await expect(page.locator('#start-analysis')).toBeEnabled();
  await page.locator('#analysis-limit').selectOption('10'); await page.locator('#start-analysis').click();
  await expect(page.locator('#analysis-status')).toContainText('解析処理が完了', { timeout: 30000 });
  await page.locator('#play-pause').click(); await expect(page.locator('#play-label')).toHaveText('一時停止');
  await page.locator('#play-pause').click();
  await page.locator('#tank-id').fill('B'); await page.locator('#light-hours').fill('12'); await page.locator('#memo').fill('保存テスト');
  await page.locator('#conditions-form button[type=submit]').click(); await page.reload();
  await expect(page.locator('#tank-id')).toHaveValue('B'); await expect(page.locator('#light-hours')).toHaveValue('12'); await expect(page.locator('#memo')).toHaveValue('保存テスト');
  await expect(page.locator('#start-analysis')).toBeDisabled();
});

test('Workerなしでも既存の動画操作・中央線・手動追加を利用できる', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'Worker', { value: undefined }));
  await page.goto('/'); await page.locator('#video-file').setInputFiles(fixture);
  await expect(page.locator('#play-pause')).toBeEnabled(); await expect(page.locator('#start-analysis')).toBeDisabled();
  await page.locator('#horizontal').click(); await page.locator('#manual-time').fill('2'); await page.locator('#add-manual-event').click();
  await expect(page.locator('#count-confirmed')).toHaveText('1'); await expect(page.locator('#positive-label')).toHaveText('上→下');
});

test('端末保存が拒否された場合は失敗として終了し、元の観察機能を復帰させる', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(IDBFactory.prototype, 'open', { value() { throw new DOMException('保存不可', 'SecurityError'); } }); });
  await load(page); await page.locator('#start-analysis').click();
  await expect(page.locator('#analysis-status')).toContainText('解析に失敗しました');
  await expect(page.locator('#play-pause')).toBeEnabled(); await expect(page.locator('#change-video')).toBeEnabled(); await expect(page.locator('#stop-analysis')).toBeDisabled();
});

test('無効な解析範囲を拒否し、動画の読み込み失敗でも解析を開始させない', async ({ page }) => {
  await load(page); await page.locator('#analysis-settings details').evaluate(e => e.open = true);
  await page.locator('#roi-left').fill('80'); await page.locator('#roi-right').fill('20'); await page.locator('#start-analysis').click();
  await expect(page.locator('#analysis-status')).toContainText('解析範囲'); await expect(page.locator('#play-pause')).toBeEnabled();
  await page.locator('#roi-left').fill('0'); await page.locator('#roi-right').fill('100');
  await page.locator('#fish-count').fill('0'); await page.locator('#start-analysis').click();
  await expect(page.locator('#analysis-status')).toContainText('観察条件の入力値');
  await page.locator('#video-file').setInputFiles({ name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('invalid mp4') });
  await expect(page.locator('#video-message')).toContainText('読み込み・再生できません'); await expect(page.locator('#start-analysis')).toBeDisabled();
});

test('最後の座標保存が容量不足でも完了100%とせず、通常操作へ戻る', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(IDBObjectStore.prototype, 'put', { value() { throw new DOMException('模擬容量不足', 'QuotaExceededError'); } }); });
  await load(page); await page.locator('#analysis-limit').selectOption('10'); await page.locator('#start-analysis').click();
  await expect(page.locator('#analysis-status')).toContainText('解析に失敗しました', { timeout: 30000 });
  expect(await page.locator('#analysis-progress').evaluate(e => e.value)).toBeLessThan(100);
  await expect(page.locator('#play-pause')).toBeEnabled();
  await expect(page.locator('#start-analysis')).toBeEnabled();
});

test('320px・360px・横画面で設定と確認画面が画面幅に収まる', async ({ page }) => {
  await page.goto('/');
  for (const width of [320, 360, 760]) {
    await page.setViewportSize({ width, height: 915 });
    await page.locator('#analysis-settings details').evaluate(e => e.open = true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('座標保存の解放処理は中断とページ終了から重複して呼んでも安全', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const store = new window.MedakaFrameStore('teardown-test');
    await store.open(); await store.put(0, [{ time: 0, tracks: [] }]);
    await Promise.all([store.dispose(), store.dispose()]);
    return store.db;
  });
  expect(result).toBeNull();
});
