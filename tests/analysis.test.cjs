const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../analysis-core.js');

function config(overrides = {}) {
  return { width: 320, height: 180, fps: 10, threshold: 22, minArea: 12, maxArea: 1500, expected: 5, orientation: 'vertical', position: 0.5, deadband: 0.015, roi: { x: 0, y: 0, w: 1, h: 1 }, exclusions: [], ...overrides };
}
const box = (x, y = 30) => ({ x, y, w: 12, h: 4, cx: x + 6, cy: y + 2, area: 48 });
function follow(tracker, xs, offset = 0, y = 30) {
  return xs.flatMap((x, i) => tracker.update(x === null ? [] : [box(x, y)], offset + i / 10).events);
}
function gray(shapes = []) {
  const a = new Uint8Array(320 * 180).fill(200);
  for (const s of shapes) for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) a[y * 320 + x] = 50;
  return a;
}
function detector(overrides = {}, background = gray()) {
  const d = new A.Detector(config(overrides));
  for (let i = 0; i < 9; i++) d.addBackground(background.slice());
  d.finishBackground(); return d;
}

test('全身横断を両方向に1回ずつ、線上の揺れ・片側への接近は加算しない', () => {
  const t = new A.Tracker(config());
  const xs = [115, 120, 125, 135, 145, 150, 153, 148, 154, 151, 158, 166, 170, 175, 175, 170, 163, 155, 150, 145, 138, 130, 125];
  const events = follow(t, xs);
  assert.deepEqual(events.map(e => e.direction), ['positive', 'negative']);
  assert.equal(events.every(e => e.status === 'pending' && e.source === 'auto'), true);
  assert.equal(A.totals(events).confirmed, 0);
  assert.equal(follow(new A.Tracker(config()), [120, 125, 130, 140, 145, 149, 145, 140, 130]).length, 0);
});
test('初めから線上にいる個体・追跡切れ・観測できなかった高速横断を推測で数えない', () => {
  assert.equal(follow(new A.Tracker(config()), [151, 155, 160, 170, 175, 180]).length, 0);
  assert.equal(follow(new A.Tracker(config()), [110, 115, 120, 130, 145, null, 170, 175, 180, 185]).length, 0);
  const t = new A.Tracker(config());
  follow(t, [115, 120, 125]);
  const result = t.update([box(170)], 0.3);
  assert.equal(result.events.length, 0);
});
test('横線では上→下・下→上を記録し、同じ側での検出が続いても二重に数えない', () => {
  const t = new A.Tracker(config({ orientation: 'horizontal' }));
  const events = [];
  [55, 60, 65, 73, 82, 88, 94, 100, 105, 105, 105, 100, 94, 86, 80, 73, 65, 60].forEach((y, i) => { events.push(...t.update([box(100, y)], i / 10).events); });
  assert.deepEqual(events.map(e => e.direction), ['positive', 'negative']);
  assert.deepEqual(A.directions('horizontal'), ['上→下', '下→上']);
});
test('5匹を別々に追跡し、候補IDを維持する', () => {
  const t = new A.Tracker(config()); let result;
  for (let i = 0; i < 10; i++) result = t.update(Array.from({ length: 5 }, (_, j) => box(80 + i * 2, 15 + j * 30)), i / 10);
  assert.equal(result.tracks.length, 5);
  assert.deepEqual(result.tracks.map(tr => tr.id), [1, 2, 3, 4, 5]);
  assert.equal(result.tracks.every(tr => tr.confirmed), true);
});
test('重なり・候補の競合を不確かとし、照明変化で追跡を切る', () => {
  const t = new A.Tracker(config());
  for (let i = 0; i < 3; i++) t.update([box(125 + i * 2, 30), box(130 + i * 2, 40)], i / 10);
  const r = t.update([box(140, 34), box(142, 38)], 0.3);
  assert.equal(r.events.length, 0); assert.ok(r.ambiguous > 0);
  assert.equal(t.update([], 0.4, true).tracks.length, 0);
});
test('静止器具を背景で抑え、動く細長い候補を検出し、範囲除外・面積・円形状で抑制', () => {
  const staticTool = { x: 280, y: 30, w: 15, h: 100 };
  const bg = gray([staticTool]);
  const d = detector({}, bg);
  assert.equal(d.detect(bg).detections.length, 0);
  const moving = gray([staticTool, { x: 100, y: 60, w: 16, h: 5 }]);
  assert.equal(d.detect(moving).detections.length, 1);
  const excluded = detector({ exclusions: [{ x: 0.25, y: 0.25, w: 0.2, h: 0.2 }] }, bg);
  assert.equal(excluded.detect(moving).detections.length, 0);
  assert.equal(detector().detect(gray([{ x: 100, y: 60, w: 4, h: 4 }])).detections.length, 0);
  assert.equal(detector().detect(gray([{ x: 100, y: 60, w: 2, h: 1 }])).detections.length, 0);
});
test('明るさの急変を品質警告にし、検出0を追跡成功扱いにしない', () => {
  const d = detector();
  assert.equal(d.detect(new Uint8Array(320 * 180).fill(255)).sceneChange, true);
  const engine = new A.Engine(config());
  for (let i = 0; i < 9; i++) engine.detector.addBackground(gray());
  engine.detector.finishBackground();
  const r = engine.process(gray(), 0);
  assert.equal(r.quality.good, false);
  assert.match(r.quality.reasons.join(), /連続追跡/);
  assert.equal(engine.detector.calibration.length, 0);
});
test('設定異常を拒否し、最小総コストで割り当てる', () => {
  assert.throws(() => A.validateConfig(config({ position: 0 })), /内側/);
  assert.throws(() => A.validateConfig(config({ minArea: 1501 })), /最大/);
  assert.throws(() => A.validateConfig(config({ roi: { x: 0, y: 0, w: -1, h: 1 } })), /範囲/);
  assert.deepEqual(A.assign([[0.1, 0.2, 1.1, 1.1], [0.15, 0.9, 1.1, 1.1]]), [1, 0]);
});
test('CSVは確認状態・中断範囲・修正前値・条件を残し、数式・改行・引用符を無害化する', () => {
  const run = { state: 'interrupted', target: 180, processedUntil: 8.2, config: config(), fileName: '=evil.mp4', conditions: { title: '+SUM(1,2)', memo: '一行目\n"二行目"', tankId: 'A', lightHours: '8' }, frames: 82, goodFrames: 10, issues: [], events: [
    { id: 1, time: 3.2, originalTime: 3.1, direction: 'negative', originalDirection: 'positive', trackId: 1, source: 'auto', status: 'confirmed', note: '@test' },
    { id: 2, time: 4.2, originalTime: 4.2, direction: 'positive', originalDirection: 'positive', source: 'auto', status: 'pending', note: '' },
    { id: 3, time: 5.2, source: 'manual', direction: 'positive', status: 'excluded', note: '' }
  ] };
  const csv = A.makeCsv(run);
  assert.equal(csv[0], '\uFEFF'); assert.match(csv, /"interrupted"/); assert.match(csv, /"8.200"/);
  assert.match(csv, /"'=evil.mp4"/); assert.match(csv, /"'\+SUM\(1,2\)"/); assert.match(csv, /"'@test"/);
  assert.match(csv, /一行目\n""二行目""/);
  assert.deepEqual(A.totals(run.events), { positive: 0, negative: 1, confirmed: 1, pending: 1, excluded: 1, auto: 2 });
  assert.equal(A.makeCsv({ ...run, events: [] }).includes('"summary"'), true);
});
test('独立手動カウントと修正前候補を比較し、手動0の誤差率を捏造しない', () => {
  const events = [{ source: 'auto', direction: 'negative', originalDirection: 'positive', status: 'excluded' }];
  assert.deepEqual(A.compareCounts(events, 1, 0), { positiveDelta: 0, negativeDelta: 0, delta: 0, errorPercent: 0 });
  assert.equal(A.compareCounts(events, 0, 0).errorPercent, null);
  assert.equal(A.compareCounts(events, -1, 0), null);
});
