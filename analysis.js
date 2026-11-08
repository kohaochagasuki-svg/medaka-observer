'use strict';
(() => {
  const A = window.MedakaAnalysis, observation = window.medakaObservation;
  const $ = id => document.getElementById(id);
  if (!A || !observation) return;
  const video = $('video'), stage = $('video-stage'), overlay = $('tracking-overlay');
  let run = null, controller = null, exclusions = [], page = 0, cache = null, liveFrame = null, overlayGeneration = 0;
  let workerClient = null;
  const MAX_EVENTS = 30000;
  const aborted = () => new DOMException('解析を中断しました。', 'AbortError');
  const value = id => Number($(id).value);
  const busy = () => controller !== null;
  const stamp = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  const editableEnd = () => !run ? Math.min(observation.getState().duration || 0, value('analysis-limit')) : run.state === 'manual' ? run.target : run.processedUntil;

  function getConfig() {
    const state = observation.getState();
    const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
    const config = {
      width: Math.max(32, Math.round(video.videoWidth * scale)), height: Math.max(18, Math.round(video.videoHeight * scale)),
      fps: value('analysis-fps'), threshold: value('detection-threshold'), minArea: value('min-area'), maxArea: value('max-area'),
      expected: state.conditions.fishCount === '' ? 5 : Number(state.conditions.fishCount), orientation: state.orientation, position: state.position, deadband: value('crossing-band') / 100,
      roi: { x: value('roi-left') / 100, y: value('roi-top') / 100, w: (value('roi-right') - value('roi-left')) / 100, h: (value('roi-bottom') - value('roi-top')) / 100 },
      exclusions: exclusions.map(e => ({ ...e }))
    };
    if (!Number.isInteger(config.expected)) throw new Error('匹数は1〜10の整数で入力してください。');
    return A.validateConfig(config);
  }
  function createRun() {
    const state = observation.getState();
    if (!state.loaded || !Number.isFinite(state.duration) || state.duration <= 0) throw new Error('再生時間を取得できる動画を読み込んでください。');
    if (!$('conditions-form').checkValidity()) { $('conditions-form').reportValidity(); throw new Error('観察条件の入力値を確認してください。匹数は1〜10、照射時間は0〜24時間です。'); }
    return { id: crypto.randomUUID(), config: getConfig(), fileName: state.fileName, conditions: { ...state.conditions }, target: Math.min(state.duration, value('analysis-limit')), processedUntil: 0, state: 'preparing', events: [], issues: [], frames: 0, goodFrames: 0, store: null };
  }
  function setBusy(active) {
    observation.setBusy(active);
    $('analysis-fieldset').disabled = active;
    $('stop-analysis').disabled = !active;
    for (const id of ['add-manual-event', 'use-current-time', 'compare-counts']) $(id).disabled = active || !observation.getState().loaded;
    $('export-csv').disabled = active || !run;
    refreshStart();
  }
  function refreshStart() {
    const state = observation.getState();
    $('start-analysis').disabled = busy() || !state.loaded || !Number.isFinite(state.duration) || !window.Worker || !window.indexedDB;
    for (const id of ['add-manual-event', 'use-current-time']) $(id).disabled = busy() || !state.loaded;
    if (!window.Worker || !window.indexedDB) $('analysis-status').textContent = '自動解析にはWorkerと端末保存が必要です。通常の動画観察は利用できます。ChromeでHTTPのURLから開いてください。';
  }
  function setStatus(message) { $('analysis-status').textContent = message; }
  function updateSummary() {
    const dirs = A.directions(run?.config.orientation || observation.getState().orientation);
    ['positive-label', 'manual-positive-label'].forEach(id => { $(id).textContent = dirs[0]; });
    ['negative-label', 'manual-negative-label'].forEach(id => { $(id).textContent = dirs[1]; });
    [...$('manual-direction').options].forEach((option, i) => { option.textContent = dirs[i]; });
    const totals = run ? A.totals(run.events) : null;
    $('count-confirmed').textContent = totals ? totals.confirmed : '—';
    $('count-positive').textContent = totals ? totals.positive : '—';
    $('count-negative').textContent = totals ? totals.negative : '—';
    const pendingPositive = run?.events.filter(e => e.status === 'pending' && e.direction === 'positive').length || 0;
    const pendingNegative = run?.events.filter(e => e.status === 'pending' && e.direction === 'negative').length || 0;
    $('candidate-counts').textContent = totals ? `未確認 ${totals.pending}件（${dirs[0]} ${pendingPositive}件・${dirs[1]} ${pendingNegative}件）／ 除外 ${totals.excluded}件 ／ 修正前の自動候補 ${totals.auto}件。確認済み合計も実際の全横断数を保証しません。` : '自動候補はまだありません。';
    $('tracking-quality').textContent = run?.frames ? `${run.config.expected}候補を連続追跡できたフレーム率 ${(100 * run.goodFrames / run.frames).toFixed(1)}%（検出精度ではありません）。要確認区間 ${run.issues.length}件。` : '';
    $('run-info').textContent = run ? `今回の設定：水槽 ${run.conditions.tankId || '未入力'} ／ 照射 ${run.conditions.lightHours || '未入力'}時間/日 ／ ${run.config.expected}匹 ／ ${run.config.width}×${run.config.height}px・${run.config.fps}枚/秒 ／ 対象 0〜${stamp(run.target)}。条件や設定を編集してもこの結果には反映しません。変更を使う場合は再解析してください。` : '';
    $('manual-time').max = editableEnd().toFixed(3);
    $('export-csv').disabled = busy() || !run;
    $('compare-counts').disabled = busy() || !run;
  }
  function renderEvents() {
    const tbody = $('event-rows'); tbody.replaceChildren();
    const sorted = run ? [...run.events].sort((a, b) => a.time - b.time || a.id - b.id) : [];
    page = Math.max(0, Math.min(page, Math.ceil(sorted.length / 20) - 1));
    const subset = sorted.slice(page * 20, (page + 1) * 20);
    $('event-page-label').textContent = sorted.length ? `${page * 20 + 1}〜${page * 20 + subset.length} / ${sorted.length}件` : '0件';
    $('events-prev').disabled = page === 0 || busy();
    $('events-next').disabled = (page + 1) * 20 >= sorted.length || busy();
    if (!subset.length) { const row = tbody.insertRow(); row.insertCell().textContent = run ? '横断候補はありません。未追跡区間も確認してください。' : '動画を解析すると、横断候補が表示されます。'; row.firstChild.colSpan = 6; }
    for (const event of subset) {
      const row = tbody.insertRow(); row.dataset.eventId = event.id;
      const jump = document.createElement('button'); jump.type = 'button'; jump.className = 'secondary-button'; jump.textContent = '映像へ'; jump.disabled = busy();
      jump.addEventListener('click', () => seekForReview(Math.max(0, event.time - 1)));
      row.insertCell().append(jump);
      const time = document.createElement('input'); time.type = 'number'; time.min = 0; time.max = editableEnd(); time.step = '0.01'; time.value = event.time.toFixed(3); time.disabled = busy(); time.setAttribute('aria-label', `候補${event.id}の横断時刻`);
      time.addEventListener('change', () => { if (!time.value || !Number.isFinite(Number(time.value)) || Number(time.value) < 0 || Number(time.value) > editableEnd()) { time.value = event.time; $('review-status').textContent = '時刻は処理済み区間の範囲内で入力してください。'; return; } event.time = Number(time.value); updatedEvent(); });
      row.insertCell().append(time);
      const dir = document.createElement('select'); A.directions(run.config.orientation).forEach((label, i) => dir.add(new Option(label, i ? 'negative' : 'positive'))); dir.value = event.direction; dir.disabled = busy(); dir.setAttribute('aria-label', `候補${event.id}の方向`);
      dir.addEventListener('change', () => { event.direction = dir.value; updatedEvent(); }); row.insertCell().append(dir);
      row.insertCell().textContent = event.trackId == null ? '手動' : `#${event.trackId}`;
      const status = document.createElement('select'); for (const [key, label] of [['pending', '未確認'], ['confirmed', '確認済み'], ['excluded', '除外']]) status.add(new Option(label, key)); status.value = event.status; status.disabled = busy(); status.setAttribute('aria-label', `候補${event.id}の確認状態`);
      status.addEventListener('change', () => { event.status = status.value; updatedEvent(); }); row.insertCell().append(status);
      const note = document.createElement('input'); note.type = 'text'; note.maxLength = 500; note.value = event.note; note.disabled = busy(); note.setAttribute('aria-label', `候補${event.id}の確認メモ`);
      note.addEventListener('change', () => { event.note = note.value; updatedEvent(); }); row.insertCell().append(note);
    }
  }
  function updatedEvent() { updateSummary(); $('review-status').textContent = '修正を反映しました。保存するにはCSVをダウンロードしてください。'; }
  function addIssue(active, time, reasons) {
    if (!reasons.length) return;
    const bin = Math.floor(time / 5);
    let issue = active.issues.at(-1);
    if (!issue || issue.bin !== bin) { issue = { bin, start: bin * 5, end: Math.min(active.target, (bin + 1) * 5), reasons: [] }; active.issues.push(issue); }
    for (const reason of reasons) if (!issue.reasons.includes(reason)) issue.reasons.push(reason);
  }
  function renderIssues() {
    const select = $('review-issue'); select.replaceChildren();
    if (!run?.issues.length) select.add(new Option(run ? '記録された要確認区間はありません（精度保証ではありません）' : '解析後に表示します', ''));
    else run.issues.forEach((issue, i) => select.add(new Option(`${stamp(issue.start)}〜${stamp(issue.end)}：${issue.reasons.join('・')}`, String(i))));
    select.disabled = busy() || !run?.issues.length;
    $('jump-issue').disabled = select.disabled;
  }

  class WorkerClient {
    constructor(signal) {
      this.signal = signal; this.sequence = 0; this.pending = new Map(); this.worker = new Worker('analysis-worker.js');
      this.worker.onmessage = ({ data }) => { const item = this.pending.get(data.id); if (!item) return; this.pending.delete(data.id); clearTimeout(item.timer); data.error ? item.reject(new Error(data.error)) : item.resolve(data.result); };
      this.worker.onerror = event => { event.preventDefault(); this.close(new Error('解析Workerを実行できませんでした。ページの再読み込みとChromeの対応状況を確認してください。')); };
      this.cancel = () => this.close(aborted()); signal.addEventListener('abort', this.cancel, { once: true });
    }
    request(type, data = {}, transfers = []) {
      if (this.signal.aborted) return Promise.reject(aborted());
      return new Promise((resolve, reject) => {
        const id = ++this.sequence;
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('解析処理が応答しません。処理を中断しました。')); }, 15000);
        this.pending.set(id, { resolve, reject, timer });
        try { this.worker.postMessage({ id, type, ...data }, transfers); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
      });
    }
    close(error = aborted()) {
      this.worker.terminate();
      this.signal.removeEventListener('abort', this.cancel);
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
      this.pending.clear();
    }
  }
  function seekFrame(time, signal) {
    if (signal.aborted) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      const clean = () => { clearTimeout(timer); for (const name of ['seeked', 'loadeddata', 'canplay']) video.removeEventListener(name, check); video.removeEventListener('error', error); signal.removeEventListener('abort', cancel); };
      const cancel = () => { clean(); reject(aborted()); };
      const error = () => { clean(); reject(new Error('動画をデコードできませんでした。処理済みの範囲を確認してください。')); };
      const check = () => { if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.03) { clean(); resolve(); } };
      const timer = setTimeout(() => { clean(); reject(new Error('動画の読み出しが15秒以内に完了しませんでした。別の形式や低い解像度の動画で試してください。')); }, 15000);
      for (const name of ['seeked', 'loadeddata', 'canplay']) video.addEventListener(name, check);
      video.addEventListener('error', error); signal.addEventListener('abort', cancel, { once: true });
      try { if (Math.abs(video.currentTime - time) > 0.001) video.currentTime = time; check(); } catch (e) { clean(); reject(e); }
    });
  }
  async function start(event) {
    event.preventDefault();
    if (busy()) return;
    let active;
    try { active = createRun(); } catch (e) { setStatus(e.message); return; }
    const previous = run;
    run = active; page = 0; cache = null; liveFrame = null;
    if (previous?.store) void previous.store.dispose();
    controller = new AbortController(); const ownController = controller, signal = controller.signal;
    const canvas = document.createElement('canvas'); canvas.width = active.config.width; canvas.height = active.config.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    let chunk = [], chunkIndex = 0, client;
    $('analysis-progress').value = 0; $('review-status').textContent = ''; $('comparison-result').textContent = '';
    $('reference-positive').value = ''; $('reference-negative').value = '';
    setBusy(true); updateSummary(); renderEvents(); renderIssues();
    try {
      if (!context) throw new Error('動画を解析するCanvasを作成できません。');
      active.store = new window.MedakaFrameStore(active.id);
      await active.store.open(signal);
      if (signal.aborted) throw aborted();
      client = new WorkerClient(signal); workerClient = client;
      await client.request('init', { config: active.config });
      const sendFrame = async (time, type) => {
        await seekFrame(time, signal);
        if (signal.aborted) throw aborted();
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        return client.request(type, { rgba: image.data.buffer, time: video.currentTime }, [image.data.buffer]);
      };
      for (let i = 0; i < 9; i++) {
        setStatus(`背景を推定中 ${i + 1}/9枚（まだ計数していません）`);
        await sendFrame(i / 8 * Math.min(3, Math.max(0, active.target - 0.05)), 'background');
      }
      await client.request('ready'); active.state = 'running';
      const frames = Math.ceil(active.target * active.config.fps);
      let lastUi = -Infinity;
      for (let i = 0; i < frames; i++) {
        if (signal.aborted) throw aborted();
        const time = Math.min(i / active.config.fps, Math.max(0, active.target - 0.01));
        const result = await sendFrame(time, 'frame');
        active.frames++; if (result.quality.good) active.goodFrames++;
        active.processedUntil = Math.min(active.target, time + 1 / active.config.fps);
        addIssue(active, time, result.quality.reasons);
        active.events.push(...result.events);
        if (active.events.length >= MAX_EVENTS) throw new Error('記録数の上限に達しました。途中結果を保存し、区間を短くして確認してください。');
        const index = Math.floor(time / 10);
        if (index !== chunkIndex) { await active.store.put(chunkIndex, chunk); chunk = []; chunkIndex = index; }
        const frame = { time, tracks: result.tracks.map(tr => [tr.id, tr.x, tr.y, tr.w, tr.h, tr.uncertain ? 2 : tr.confirmed ? 1 : 0]) };
        chunk.push(frame); liveFrame = frame; drawOverlay(frame, chunk.slice(-8));
        $('analysis-progress').value = Math.min(99.9, 100 * active.processedUntil / active.target);
        if (time - lastUi >= 0.5) { setStatus(`解析中 ${(100 * active.processedUntil / active.target).toFixed(1)}% · ${stamp(active.processedUntil)} / ${stamp(active.target)}`); updateSummary(); lastUi = time; }
      }
      active.state = 'completed';
    } catch (e) {
      active.state = e.name === 'AbortError' ? 'interrupted' : 'error'; active.error = e.message;
    } finally {
      client?.close(); if (workerClient === client) workerClient = null;
      canvas.width = 0; canvas.height = 0;
      if (run === active && chunk.length && active.store?.db) {
        try { await active.store.put(chunkIndex, chunk); } catch (e) { active.state = 'error'; active.error = e.message; }
      }
      chunk = [];
      liveFrame = null;
      if (run !== active) void active.store?.dispose();
      if (controller === ownController) { controller = null; setBusy(false); }
      if (run === active) {
        if (active.state === 'completed') { $('analysis-progress').value = 100; setStatus(`解析処理が完了しました。対象 0〜${stamp(active.target)}。未確認の候補と要確認区間を見直してください。`); }
        else { setStatus(`${active.state === 'interrupted' ? '解析を中断しました' : '解析に失敗しました'}。処理済み 0〜${stamp(active.processedUntil)} / ${stamp(active.target)}。全時間の測定値ではありません。${active.error || ''}`); }
        $('start-analysis').textContent = '再解析（今の結果を置換）';
        updateSummary(); renderEvents(); renderIssues(); void renderOverlay();
      }
    }
  }

  function layoutOverlay() {
    if (!run) return;
    const scale = Math.min(stage.clientWidth / video.videoWidth, stage.clientHeight / video.videoHeight);
    const width = video.videoWidth * scale, height = video.videoHeight * scale;
    Object.assign(overlay.style, { width: `${width}px`, height: `${height}px`, left: `${(stage.clientWidth - width) / 2}px`, top: `${(stage.clientHeight - height) / 2}px` });
  }
  function drawOverlay(frame, nearby = []) {
    if (!run || !$('show-tracks').checked || !frame) { overlay.hidden = true; return; }
    const c = run.config;
    if (overlay.width !== c.width) overlay.width = c.width;
    if (overlay.height !== c.height) overlay.height = c.height;
    layoutOverlay(); overlay.hidden = false;
    const ctx = overlay.getContext('2d'); ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.strokeStyle = '#70d9e5'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.strokeRect(c.roi.x * c.width, c.roi.y * c.height, c.roi.w * c.width, c.roi.h * c.height);
    ctx.fillStyle = '#f3526440'; ctx.strokeStyle = '#ff7887';
    for (const e of c.exclusions) { ctx.fillRect(e.x * c.width, e.y * c.height, e.w * c.width, e.h * c.height); ctx.strokeRect(e.x * c.width, e.y * c.height, e.w * c.width, e.h * c.height); }
    ctx.strokeStyle = '#d09dff'; ctx.fillStyle = '#b37dff20';
    const center = c.position * (c.orientation === 'vertical' ? c.width : c.height), band = c.deadband * (c.orientation === 'vertical' ? c.width : c.height);
    ctx.beginPath();
    if (c.orientation === 'vertical') { ctx.fillRect(center - band, 0, band * 2, c.height); ctx.moveTo(center, 0); ctx.lineTo(center, c.height); }
    else { ctx.fillRect(0, center - band, c.width, band * 2); ctx.moveTo(0, center); ctx.lineTo(c.width, center); }
    ctx.stroke(); ctx.setLineDash([]); ctx.font = '11px sans-serif';
    for (const tr of frame.tracks) {
      const [id, x, y, w, h, flag] = tr;
      ctx.strokeStyle = flag === 1 ? '#57efc4' : '#ffc46b'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
      ctx.beginPath(); let started = false;
      for (const past of nearby) { const p = past.tracks.find(item => item[0] === id); if (!p || p[6] === 2) { started = false; continue; } const px = p[1] + p[3] / 2, py = p[2] + p[4] / 2; started ? ctx.lineTo(px, py) : ctx.moveTo(px, py); started = true; }
      ctx.stroke(); ctx.fillStyle = '#14352ee6'; ctx.fillRect(x, Math.max(0, y - 14), 47, 14); ctx.fillStyle = flag === 1 ? '#57efc4' : '#ffc46b'; ctx.fillText(`#${id}${flag === 1 ? '' : ' ?'}`, x + 2, Math.max(11, y - 3));
    }
    const state = observation.getState();
    const changed = state.orientation !== c.orientation || Math.abs(state.position - c.position) > 0.0001;
    $('overlay-status').textContent = `記録 ${stamp(frame.time)}：候補${frame.tracks.length}個。緑＝連続追跡、橙＝不確か／追跡開始、紫＝解析時の線。${changed ? '中央線が解析後に変更されています。結果は解析時の線に対するものです。' : 'IDは個体の識別を保証しません。'}`;
  }
  async function renderOverlay() {
    const generation = ++overlayGeneration, active = run;
    if (!active || !$('show-tracks').checked) { overlay.hidden = true; return; }
    const time = video.currentTime;
    if (liveFrame && Math.abs(time - liveFrame.time) <= 0.04) { drawOverlay(liveFrame, [liveFrame]); return; }
    if (!active.store?.db || time > active.processedUntil || active.state === 'manual') { overlay.hidden = true; $('overlay-status').textContent = 'この時刻には追跡記録がありません。'; return; }
    try {
      const index = Math.floor(time / 10);
      if (!cache || cache.index !== index) { const frames = await active.store.get(index); if (generation !== overlayGeneration || run !== active) return; cache = { index, frames }; }
      if (generation !== overlayGeneration || run !== active) return;
      const frameIndex = cache.frames.findLastIndex(f => f.time <= time + 0.02);
      const frame = cache.frames[frameIndex];
      if (!frame || time - frame.time > 1.6 / active.config.fps) { overlay.hidden = true; $('overlay-status').textContent = 'この時刻には追跡記録がありません。'; return; }
      drawOverlay(frame, cache.frames.slice(Math.max(0, frameIndex - 7), frameIndex + 1));
    } catch (e) { overlay.hidden = true; $('overlay-status').textContent = e.message; }
  }
  function seekForReview(time) { if (busy()) return; video.pause(); video.currentTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.01)); $('video-stage').scrollIntoView({ behavior: 'smooth', block: 'center' }); }

  $('analysis-settings').addEventListener('submit', start);
  $('stop-analysis').addEventListener('click', () => { setStatus('中断しています。処理済みの結果を残します。'); controller?.abort(); });
  $('show-tracks').addEventListener('change', () => void renderOverlay());
  $('events-prev').addEventListener('click', () => { page--; renderEvents(); });
  $('events-next').addEventListener('click', () => { page++; renderEvents(); });
  $('jump-issue').addEventListener('click', () => { const issue = run?.issues[Number($('review-issue').value)]; if (issue) seekForReview(issue.start); });
  $('use-current-time').addEventListener('click', () => { $('manual-time').value = video.currentTime.toFixed(2); });
  $('manual-event-form').addEventListener('submit', event => {
    event.preventDefault(); if (busy()) return;
    try {
      if (!run) { run = createRun(); run.state = 'manual'; }
      const time = value('manual-time');
      if (!Number.isFinite(time) || time < 0 || time > editableEnd()) throw new Error('横断時刻は対象区間（中断時は処理済み区間）の範囲内で指定してください。');
      if (run.events.length >= MAX_EVENTS) throw new Error('記録数の上限です。');
      const id = run.events.reduce((max, e) => Math.max(max, e.id), 0) + 1;
      run.events.push({ id, time, direction: $('manual-direction').value, source: 'manual', status: 'confirmed', trackId: null, note: $('manual-note').value });
      updateSummary(); renderEvents(); $('review-status').textContent = '手動で1件追加しました。CSVを保存してください。';
    } catch (e) { $('review-status').textContent = e.message; }
  });
  $('comparison-form').addEventListener('submit', event => {
    event.preventDefault(); if (!run || busy()) return;
    const result = A.compareCounts(run.events, value('reference-positive'), value('reference-negative'));
    if (!result) { $('comparison-result').textContent = '手動カウントは0以上の整数で入力してください。'; return; }
    run.manualPositive = value('reference-positive'); run.manualNegative = value('reference-negative');
    const dirs = A.directions(run.config.orientation), sign = n => n > 0 ? `+${n}` : String(n);
    $('comparison-result').textContent = `区間 0〜${stamp(editableEnd())}：自動候補 − 手動 は ${dirs[0]} ${sign(result.positiveDelta)}件、${dirs[1]} ${sign(result.negativeDelta)}件、合計 ${sign(result.delta)}件。${result.errorPercent == null ? '手動合計0件のため誤差率は算出しません。' : `合計の絶対誤差率 ${result.errorPercent.toFixed(1)}%。`} 検出の適合率・再現率を示すものではありません。`;
  });
  $('export-csv').addEventListener('click', () => {
    if (!run || busy()) return;
    try {
      const blob = new Blob([A.makeCsv(run)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `medaka-results-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('review-status').textContent = 'CSVの保存を開始しました。ダウンロード先を確認してください。';
    } catch (e) { $('review-status').textContent = `CSVを作成できませんでした。${e.message}`; }
  });
  $('add-exclusion').addEventListener('click', () => {
    if (busy()) return;
    const e = { x: value('exclude-x') / 100, y: value('exclude-y') / 100, w: value('exclude-w') / 100, h: value('exclude-h') / 100 };
    if (exclusions.length >= 8 || ![e.x, e.y, e.w, e.h].every(Number.isFinite) || e.x < 0 || e.y < 0 || e.w <= 0 || e.h <= 0 || e.x + e.w > 1.00001 || e.y + e.h > 1.00001) { setStatus('除外範囲は映像内に収まるよう指定してください（最大8件）。'); return; }
    exclusions.push(e); renderExclusions();
  });
  function renderExclusions() {
    $('exclusion-list').replaceChildren();
    exclusions.forEach((e, index) => { const li = document.createElement('li'); li.textContent = `左${Math.round(e.x * 100)}%・上${Math.round(e.y * 100)}%・幅${Math.round(e.w * 100)}%・高${Math.round(e.h * 100)}% `; const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.textContent = '削除'; button.addEventListener('click', () => { exclusions.splice(index, 1); renderExclusions(); }); li.append(button); $('exclusion-list').append(li); });
  }
  video.addEventListener('loadedmetadata', () => { refreshStart(); if (!busy()) { setStatus('先頭3分で試し、検出の設定と手動カウントを比較してください。'); updateSummary(); } });
  video.addEventListener('emptied', refreshStart);
  for (const event of ['timeupdate', 'seeked']) video.addEventListener(event, () => { if (!busy()) void renderOverlay(); });
  window.addEventListener('resize', () => void renderOverlay());
  window.addEventListener('medaka:line', () => { if (!busy()) { updateSummary(); void renderOverlay(); } });
  window.addEventListener('medaka:release', () => {
    controller?.abort(); workerClient?.close();
    const old = run; run = null; cache = null; liveFrame = null; overlayGeneration++;
    if (old?.store) void old.store.dispose();
    overlay.hidden = true; $('analysis-progress').value = 0; $('start-analysis').textContent = '自動計測を開始';
    setStatus('動画を読み込むと解析できます。'); updateSummary(); renderEvents(); renderIssues(); refreshStart();
    queueMicrotask(refreshStart);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && busy()) { controller.abort(); } });
  window.addEventListener('pagehide', () => { controller?.abort(); workerClient?.close(); void run?.store?.dispose(); });
  try { if (window.indexedDB) window.MedakaFrameStore.cleanupExpired(); } catch { /* Start reports unavailable storage; observation still works. */ }
  refreshStart(); updateSummary();
})();
