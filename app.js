'use strict';

// The video remains a browser-managed File / blob URL. Never read it into an
// ArrayBuffer, encode it as base64, or retain decoded frames in JavaScript.
(() => {
  const $ = (id) => document.getElementById(id);
  const video = $('video');
  const stage = $('video-stage');
  const overlay = $('line-overlay');
  const line = $('center-line');
  const fileInput = $('video-file');
  const seek = $('seek');
  const form = $('conditions-form');
  const positionInput = $('line-position');
  const showLine = $('show-line');
  const storageKey = 'medaka-lab.observation.v1';
  const fieldNames = ['title', 'date', 'temperature', 'fishCount', 'lighting', 'otherConditions', 'memo', 'tankId', 'lightHours'];
  const playbackControls = ['play-pause', 'back', 'forward', 'seek', 'speed'];
  let objectUrl = null;
  let orientation = 'vertical';
  let position = 50;
  let loaded = false;
  let saveTimer;
  let dragging = false;
  let analysisBusy = false;
  let fileName = '';

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const validDuration = () => Number.isFinite(video.duration) && video.duration > 0;
  const timeText = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    const whole = Math.floor(seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor(whole / 60) % 60;
    const rest = String(whole % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${String(minutes).padStart(2, '0')}:${rest}`;
  };
  function setControls(enabled) {
    playbackControls.forEach((id) => { $(id).disabled = !enabled || analysisBusy; });
  }
  function syncPlayback() {
    $('play-icon').textContent = video.paused ? '▶' : 'Ⅱ';
    $('play-label').textContent = video.paused ? '再生' : '一時停止';
    if (loaded) $('video-state').textContent = video.ended ? '再生終了' : video.paused ? '一時停止中' : '再生中';
  }
  function syncTime() {
    $('current-time').textContent = loaded ? timeText(video.currentTime) : '00:00';
    $('duration').textContent = loaded && validDuration() ? timeText(video.duration) : '--:--';
    seek.disabled = analysisBusy || !loaded || !validDuration();
    seek.value = loaded && validDuration() ? clamp(video.currentTime / video.duration * 100, 0, 100) : 0;
    seek.setAttribute('aria-valuetext', `${timeText(video.currentTime)} / ${validDuration() ? timeText(video.duration) : '--:--'}`);
  }
  function drawLine() {
    overlay.hidden = !loaded || !showLine.checked;
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    if (loaded && video.videoWidth && video.videoHeight && stageWidth && stageHeight) {
      // Match only the visible video pixels, excluding object-fit letterboxing.
      const scale = Math.min(stageWidth / video.videoWidth, stageHeight / video.videoHeight);
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      Object.assign(overlay.style, {
        width: `${width}px`, height: `${height}px`,
        left: `${(stageWidth - width) / 2}px`, top: `${(stageHeight - height) / 2}px`
      });
    }
    line.classList.toggle('horizontal', orientation === 'horizontal');
    line.style.left = orientation === 'vertical' ? `${position}%` : '0';
    line.style.top = orientation === 'horizontal' ? `${position}%` : '0';
    line.setAttribute('aria-orientation', orientation === 'vertical' ? 'horizontal' : 'vertical');
    line.setAttribute('aria-valuenow', position.toFixed(1));
    line.setAttribute('aria-valuetext', `${orientation === 'vertical' ? '左' : '上'}から${position.toFixed(1)}パーセント`);
    positionInput.value = position;
    $('position-value').textContent = `${Number(position.toFixed(1))}%`;
    $('vertical').setAttribute('aria-pressed', String(orientation === 'vertical'));
    $('horizontal').setAttribute('aria-pressed', String(orientation === 'horizontal'));
    $('start-label').textContent = orientation === 'vertical' ? '左' : '上';
    $('end-label').textContent = orientation === 'vertical' ? '右' : '下';
    window.dispatchEvent(new CustomEvent('medaka:line'));
  }
  function save() {
    clearTimeout(saveTimer);
    const conditions = Object.fromEntries(fieldNames.map((name) => [name, form.elements.namedItem(name)?.value || '']));
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, conditions, line: { orientation, position, visible: showLine.checked } }));
      $('save-status').textContent = `このブラウザに保存しました · ${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      $('save-status').textContent = '端末に保存できません。必要な記録を別のメモに控えてください。';
    }
  }
  function scheduleSave() {
    $('save-status').textContent = '保存中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }
  function restore() {
    // Use local calendar date, including on phones outside UTC.
    const today = new Date();
    $('observation-date').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (!saved || saved.version !== 1) return;
      for (const name of fieldNames) {
        const value = saved.conditions?.[name];
        const field = form.elements.namedItem(name);
        if (!field) continue;
        if (typeof value === 'string') field.value = value.slice(0, field.maxLength > 0 ? field.maxLength : 5000);
      }
      if (saved.line?.orientation === 'horizontal') orientation = 'horizontal';
      if (typeof saved.line?.position === 'number' && Number.isFinite(saved.line.position)) position = clamp(saved.line.position, 0, 100);
      if (typeof saved.line?.visible === 'boolean') showLine.checked = saved.line.visible;
      $('save-status').textContent = 'このブラウザに保存した観察条件を復元しました。';
    } catch {
      $('save-status').textContent = '保存済みの記録を読み込めませんでした。入力内容はこの画面で確認してください。';
    }
  }
  function releaseVideo() {
    window.dispatchEvent(new CustomEvent('medaka:release'));
    loaded = false;
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    setControls(false);
    syncPlayback();
    syncTime();
    drawLine();
  }
  function loadFile(file) {
    if (!file) return;
    if (!file.size) {
      $('video-message').textContent = '空のファイルです。別の動画を選んでください。';
      return;
    }
    if (file.type && !file.type.startsWith('video/')) {
      $('video-message').textContent = '動画ファイルを選んでください。MP4形式をおすすめします。';
      return;
    }
    releaseVideo();
    fileName = file.name;
    $('video-message').textContent = '';
    $('empty-state').hidden = true;
    video.hidden = false;
    stage.classList.add('has-video');
    $('file-info').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    $('change-video').textContent = '動画を変更 ↗';
    $('video-state').textContent = '読み込み中…';
    objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.load();
  }
  ['choose-video', 'change-video'].forEach((id) => $(id).addEventListener('click', () => fileInput.click()));
  fileInput.addEventListener('change', () => {
    loadFile(fileInput.files?.[0]);
    // Selecting the same video again should also trigger change.
    fileInput.value = '';
  });
  video.addEventListener('loadedmetadata', () => {
    if (!objectUrl) return;
    loaded = true;
    video.playbackRate = Number($('speed').value);
    setControls(true);
    syncPlayback(); syncTime(); drawLine();
  });
  video.addEventListener('error', () => {
    if (!objectUrl) return;
    const interrupted = video.error?.code === 1;
    releaseVideo();
    video.hidden = true;
    stage.classList.remove('has-video');
    $('empty-state').hidden = false;
    $('video-state').textContent = '読み込みエラー';
    $('file-info').textContent = '動画を再度選択してください';
    $('video-message').textContent = interrupted ? '動画の読み込みが中断されました。もう一度選択してください。' : 'この動画を読み込み・再生できません。Chromeで再生できるMP4（H.264）などの動画を選んでください。';
  });
  ['play', 'pause', 'ended'].forEach((event) => video.addEventListener(event, syncPlayback));
  ['timeupdate', 'durationchange', 'seeked'].forEach((event) => video.addEventListener(event, syncTime));
  $('play-pause').addEventListener('click', async () => {
    if (!loaded || analysisBusy) return;
    if (!video.paused) { video.pause(); return; }
    const playingUrl = objectUrl;
    try {
      if (video.ended) video.currentTime = 0;
      await video.play();
      if (objectUrl === playingUrl) $('video-message').textContent = '';
    } catch {
      if (objectUrl === playingUrl) $('video-message').textContent = '再生できませんでした。再生ボタンをもう一度押すか、別の動画を選んでください。';
    }
  });
  seek.addEventListener('input', () => { if (loaded && validDuration()) video.currentTime = Number(seek.value) / 100 * video.duration; });
  function jump(seconds) {
    if (loaded && validDuration()) { video.currentTime = clamp(video.currentTime + seconds, 0, video.duration); syncTime(); }
  }
  $('back').addEventListener('click', () => jump(-5));
  $('forward').addEventListener('click', () => jump(5));
  $('speed').addEventListener('change', () => { video.playbackRate = Number($('speed').value); });
  function setPosition(value) { if (analysisBusy) return; position = clamp(value, 0, 100); drawLine(); scheduleSave(); }
  positionInput.addEventListener('input', () => setPosition(Number(positionInput.value)));
  $('reset-line').addEventListener('click', () => setPosition(50));
  ['vertical', 'horizontal'].forEach((value) => $(value).addEventListener('click', () => { if (analysisBusy) return; orientation = value; drawLine(); scheduleSave(); }));
  showLine.addEventListener('change', () => { drawLine(); scheduleSave(); });
  function moveLine(event) {
    const rect = overlay.getBoundingClientRect();
    const size = orientation === 'vertical' ? rect.width : rect.height;
    if (!size) return;
    const offset = orientation === 'vertical' ? event.clientX - rect.left : event.clientY - rect.top;
    setPosition(offset / size * 100);
  }
  line.addEventListener('pointerdown', (event) => {
    if (!loaded || analysisBusy || event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
    dragging = true;
    line.setPointerCapture(event.pointerId);
    moveLine(event);
  });
  line.addEventListener('pointermove', (event) => { if (dragging && line.hasPointerCapture(event.pointerId)) moveLine(event); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((event) => line.addEventListener(event, () => { dragging = false; }));
  line.addEventListener('keydown', (event) => {
    if (analysisBusy) return;
    const directions = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
    if (event.key in directions) { event.preventDefault(); setPosition(position + directions[event.key] * (event.shiftKey ? 10 : 1)); }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setPosition(event.key === 'Home' ? 0 : 100); }
  });
  form.addEventListener('input', scheduleSave);
  form.addEventListener('change', scheduleSave);
  form.addEventListener('submit', (event) => { event.preventDefault(); save(); });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(drawLine).observe(stage);
  window.addEventListener('resize', drawLine);
  video.addEventListener('resize', drawLine);
  window.addEventListener('pagehide', (event) => { if (saveTimer) save(); if (!event.persisted) releaseVideo(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (saveTimer) save(); video.pause(); } });
  // Small integration surface; the original observation app works without analysis.js.
  window.medakaObservation = {
    getState: () => ({ loaded, fileName, duration: video.duration, orientation, position: position / 100, conditions: Object.fromEntries(fieldNames.map(name => [name, form.elements.namedItem(name)?.value || ''])) }),
    setBusy(value) {
      analysisBusy = value;
      if (value) video.pause();
      setControls(loaded);
      syncTime();
      ['choose-video', 'change-video', 'video-file', 'line-position', 'reset-line', 'vertical', 'horizontal'].forEach(id => { $(id).disabled = value; });
      line.setAttribute('aria-disabled', String(value));
      line.tabIndex = value ? -1 : 0;
    }
  };
  restore();
  drawLine();
})();
