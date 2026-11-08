const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const key = 'medaka-lab.observation.v1';

function setup(t, stored) {
  const dom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  const d = w.document;
  const $ = (id) => d.getElementById(id);
  let paused = true;
  let duration = 1800;
  let currentTime = 0;
  let captures = new Set();
  const revoked = [];
  let urlCount = 0;
  w.URL.createObjectURL = () => `blob:test-${++urlCount}`;
  w.URL.revokeObjectURL = (url) => revoked.push(url);
  w.HTMLMediaElement.prototype.load = function () {};
  w.HTMLMediaElement.prototype.pause = function () { paused = true; this.dispatchEvent(new w.Event('pause')); };
  w.HTMLMediaElement.prototype.play = function () { paused = false; this.dispatchEvent(new w.Event('play')); return Promise.resolve(); };
  Object.defineProperties($('video'), {
    paused: { get: () => paused }, ended: { get: () => currentTime >= duration },
    duration: { get: () => duration }, currentTime: { get: () => currentTime, set: (v) => { currentTime = v; } },
    videoWidth: { configurable: true, value: 1920 }, videoHeight: { configurable: true, value: 1080 }
  });
  Object.defineProperties($('video-stage'), { clientWidth: { value: 640 }, clientHeight: { value: 360 } });
  $('center-line').setPointerCapture = (id) => captures.add(id);
  $('center-line').hasPointerCapture = (id) => captures.has(id);
  if (stored !== undefined) w.localStorage.setItem(key, stored);
  w.eval(script);
  const fire = (id, name) => $(id).dispatchEvent(new w.Event(name, { bubbles: true, cancelable: true }));
  const file = (name = '観察.mp4', type = 'video/mp4', size = 128) => {
    const f = new w.File([new Uint8Array(size)], name, { type });
    Object.defineProperty($('video-file'), 'files', { configurable: true, value: [f] });
    fire('video-file', 'change');
  };
  const metadata = () => fire('video', 'loadedmetadata');
  return { w, $, fire, file, metadata, revoked, setDuration: (v) => { duration = v; } };
}

test('30分の動画: blob URL・再生・停止・シーク・速度・差し替え時の解放', async (t) => {
  const { $, fire, file, metadata, revoked } = setup(t);
  assert.equal($('play-pause').disabled, true);
  file();
  assert.equal($('video').getAttribute('src'), 'blob:test-1');
  assert.equal($('play-pause').disabled, true);
  metadata();
  assert.equal($('duration').textContent, '30:00');
  assert.equal($('play-pause').disabled, false);
  $('play-pause').click();
  await Promise.resolve();
  assert.equal($('video').paused, false);
  assert.equal($('play-label').textContent, '一時停止');
  $('play-pause').click();
  assert.equal($('video').paused, true);
  $('seek').value = 50; fire('seek', 'input'); fire('video', 'timeupdate');
  assert.equal($('video').currentTime, 900);
  assert.equal($('current-time').textContent, '15:00');
  $('back').click(); assert.equal($('video').currentTime, 895);
  $('forward').click(); assert.equal($('video').currentTime, 900);
  $('speed').value = '2'; fire('speed', 'change');
  assert.equal($('video').playbackRate, 2);
  file('次の動画.mp4');
  assert.deepEqual(revoked, ['blob:test-1']);
  assert.equal($('video').getAttribute('src'), 'blob:test-2');
  assert.equal($('line-overlay').hidden, true);
});

test('中央線: 縦長動画の余白を除外し、指操作・向き・表示・リセット・キーボードを反映', (t) => {
  const { w, $, file, metadata, fire } = setup(t);
  Object.defineProperties($('video'), { videoWidth: { value: 1080 }, videoHeight: { value: 1920 } });
  file(); metadata();
  assert.equal($('line-overlay').style.width, '202.5px');
  assert.equal($('line-overlay').style.left, '218.75px');
  assert.equal($('line-overlay').style.height, '360px');
  $('line-overlay').getBoundingClientRect = () => ({ left: 218.75, top: 0, width: 202.5, height: 360 });
  const pointer = (type, x, y) => {
    const e = new w.Event(type);
    Object.assign(e, { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true });
    $('center-line').dispatchEvent(e);
  };
  pointer('pointerdown', 370.625, 0);
  assert.equal($('line-position').value, '75');
  pointer('pointermove', 1000, 0);
  assert.equal($('line-position').value, '100');
  pointer('pointerup', 1000, 0);
  $('horizontal').click();
  assert.equal($('center-line').classList.contains('horizontal'), true);
  assert.equal($('start-label').textContent, '上');
  pointer('pointerdown', 300, 90);
  assert.equal($('line-position').value, '25');
  $('reset-line').click(); assert.equal($('line-position').value, '50');
  $('center-line').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown' }));
  assert.equal($('line-position').value, '51');
  $('show-line').checked = false; fire('show-line', 'change');
  assert.equal($('line-overlay').hidden, true);
});

test('観察条件・メモ・中央線を端末に保存して復元（動画自体は保存しない）', (t) => {
  const a = setup(t);
  a.$('observation-title').value = '水温の比較';
  a.$('memo').value = '<script>文字列として保存</script>';
  a.$('line-position').value = 65;
  a.fire('line-position', 'input');
  a.$('horizontal').click();
  a.fire('conditions-form', 'submit');
  const stored = a.w.localStorage.getItem(key);
  assert.equal(JSON.parse(stored).conditions.title, '水温の比較');
  assert.equal(stored.includes('blob:'), false);
  const b = setup(t, stored);
  assert.equal(b.$('observation-title').value, '水温の比較');
  assert.equal(b.$('memo').value, '<script>文字列として保存</script>');
  assert.equal(b.$('line-position').value, '65');
  assert.equal(b.$('horizontal').getAttribute('aria-pressed'), 'true');
  assert.equal(b.$('video').hasAttribute('src'), false);
});

test('自動保存・読み込み失敗・破損した記録・容量不足を扱う', async (t) => {
  const { w, $, fire, file, metadata, revoked } = setup(t, '{broken');
  assert.match($('save-status').textContent, /読み込めません/);
  $('memo').value = '自動保存'; fire('memo', 'input');
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(JSON.parse(w.localStorage.getItem(key)).conditions.memo, '自動保存');
  file('メモ.txt', 'text/plain');
  assert.match($('video-message').textContent, /動画ファイル/);
  file('空.mp4', 'video/mp4', 0);
  assert.match($('video-message').textContent, /空のファイル/);
  file(); metadata(); fire('video', 'error');
  assert.equal($('play-pause').disabled, true);
  assert.equal($('empty-state').hidden, false);
  assert.equal($('line-overlay').hidden, true);
  assert.deepEqual(revoked, ['blob:test-1']);
  assert.match($('video-message').textContent, /再生できません/);
  Object.defineProperty(w.Storage.prototype, 'setItem', { value: () => { throw new Error('quota'); } });
  fire('conditions-form', 'submit');
  assert.match($('save-status').textContent, /保存できません/);
});

test('不明な再生時間ではシークを無効化し、非表示時は動画を停止', (t) => {
  const { $, w, file, metadata, setDuration, fire } = setup(t);
  file(); setDuration(Infinity); metadata();
  assert.equal($('seek').disabled, true);
  assert.equal($('duration').textContent, '--:--');
  $('play-pause').click();
  Object.defineProperty(w.document, 'hidden', { value: true });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  assert.equal($('video').paused, true);
  setDuration(1800); fire('video', 'durationchange');
  assert.equal($('seek').disabled, false);
});

test('外部送信を防ぐCSP、外部依存のない本番ファイル、試験版の明示', () => {
  const dom = new JSDOM(html);
  const d = dom.window.document;
  const csp = d.querySelector('[http-equiv="Content-Security-Policy"]').content;
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /media-src blob:/);
  for (const el of d.querySelectorAll('[src],link[href]')) assert.equal(/^https?:/.test(el.getAttribute('src') || el.getAttribute('href')), false);
  assert.match(csp, /worker-src 'self'/);
  assert.equal(d.querySelector('.future-tag').textContent, '試験版');
  assert.match(d.querySelector('.analysis-caution').textContent, /未確認/);
  assert.equal(/\b(fetch|XMLHttpRequest|FileReader|readAsDataURL|arrayBuffer)\s*\(/.test(script), false);
  dom.window.close();
});
