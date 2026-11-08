/* Shared by the browser, Worker and Node tests. No network or DOM dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MedakaAnalysis = api;
})(typeof self === 'undefined' ? globalThis : self, function () {
  'use strict';
  const VERSION = 'motion-0.2.0';
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const directions = (orientation) => orientation === 'horizontal' ? ['上→下', '下→上'] : ['左→右', '右→左'];

  function validateConfig(c) {
    const limits = { width: [32, 640], height: [18, 640], fps: [2, 15], threshold: [5, 100], minArea: [3, 2000], maxArea: [4, 20000], expected: [1, 10], deadband: [0, 0.1], position: [0, 1] };
    for (const [key, [lo, hi]] of Object.entries(limits)) {
      if (!Number.isFinite(c[key]) || c[key] < lo || c[key] > hi) throw new Error(`設定値が範囲外です: ${key}`);
    }
    if (c.minArea >= c.maxArea) throw new Error('最小面積は最大面積より小さくしてください。');
    if (!['vertical', 'horizontal'].includes(c.orientation)) throw new Error('線の向きが不正です。');
    const r = c.roi;
    if (!r || ![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.x < 0 || r.y < 0 || r.w <= 0 || r.h <= 0 || r.x + r.w > 1.00001 || r.y + r.h > 1.00001) throw new Error('解析範囲を映像内に設定してください。');
    const axisStart = c.orientation === 'vertical' ? r.x : r.y;
    const axisEnd = axisStart + (c.orientation === 'vertical' ? r.w : r.h);
    if (c.position <= axisStart + c.deadband || c.position >= axisEnd - c.deadband) throw new Error('中央線と判定帯を解析範囲の内側に置いてください。');
    if (!Array.isArray(c.exclusions) || c.exclusions.length > 8) throw new Error('除外範囲は8件以内にしてください。');
    for (const e of c.exclusions) {
      if (![e.x, e.y, e.w, e.h].every(Number.isFinite) || e.x < 0 || e.y < 0 || e.w <= 0 || e.h <= 0 || e.x + e.w > 1.00001 || e.y + e.h > 1.00001) throw new Error('除外範囲を映像内に設定してください。');
    }
    return c;
  }

  function grayscale(rgba, width, height) {
    const gray = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
    return gray;
  }

  class Detector {
    constructor(config) {
      this.c = validateConfig(config);
      this.n = config.width * config.height;
      this.background = new Float32Array(this.n);
      this.mask = new Uint8Array(this.n);
      this.clean = new Uint8Array(this.n);
      this.queue = new Int32Array(this.n);
      this.allowed = new Uint8Array(this.n);
      const { width, height, roi, exclusions } = config;
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const nx = x / width, ny = y / height;
        if (nx >= roi.x && nx <= roi.x + roi.w && ny >= roi.y && ny <= roi.y + roi.h && !exclusions.some(e => nx >= e.x && nx <= e.x + e.w && ny >= e.y && ny <= e.y + e.h)) this.allowed[y * width + x] = 1;
      }
      this.calibration = [];
    }
    addBackground(gray) {
      if (gray.length !== this.n || this.calibration.length >= 9) throw new Error('背景フレームが不正です。');
      this.calibration.push(gray);
    }
    finishBackground() {
      if (this.calibration.length < 3) throw new Error('背景推定には3枚以上が必要です。');
      const values = new Uint8Array(this.calibration.length);
      for (let i = 0; i < this.n; i++) {
        for (let j = 0; j < values.length; j++) values[j] = this.calibration[j][i];
        values.sort();
        this.background[i] = values[Math.floor(values.length / 2)];
      }
      this.calibration = []; // At most nine grayscale frames; never keep video frames.
    }
    detect(gray) {
      if (gray.length !== this.n) throw new Error('解析フレームの大きさが変わりました。');
      const { width: w, height: h, threshold, minArea, maxArea, expected } = this.c;
      // Estimate a global exposure offset without allocating a full second frame.
      const histogram = new Uint32Array(511);
      let samples = 0;
      for (let i = 0; i < this.n; i += 19) if (this.allowed[i]) { histogram[clamp(Math.round(gray[i] - this.background[i]) + 255, 0, 510)]++; samples++; }
      let sum = 0, offset = 0;
      for (let i = 0; i < 511; i++) { sum += histogram[i]; if (sum >= samples / 2) { offset = i - 255; break; } }
      let foreground = 0, allowedCount = 0;
      for (let i = 0; i < this.n; i++) {
        const moving = this.allowed[i] && Math.abs(gray[i] - this.background[i] - offset) >= threshold;
        this.mask[i] = moving ? 1 : 0;
        foreground += this.mask[i]; allowedCount += this.allowed[i];
        // Slow adaptation for foreground avoids immediately absorbing a paused fish.
        this.background[i] += (gray[i] - offset - this.background[i]) * (moving ? 0.001 : 0.03);
      }
      const sceneChange = Math.abs(offset) > 35 || foreground / Math.max(1, allowedCount) > 0.3;
      if (sceneChange) return { detections: [], sceneChange: true, rejected: 0, overflow: false };
      this.clean.fill(0);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!this.mask[i]) continue;
        const neighbors = this.mask[i - w - 1] + this.mask[i - w] + this.mask[i - w + 1] + this.mask[i - 1] + this.mask[i + 1] + this.mask[i + w - 1] + this.mask[i + w] + this.mask[i + w + 1];
        if (neighbors >= 3) this.clean[i] = 1;
      }
      const detections = [];
      let rejected = 0;
      for (let seed = 0; seed < this.n; seed++) {
        if (!this.clean[seed]) continue;
        let head = 0, tail = 1, count = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
        let x0 = w, y0 = h, x1 = 0, y1 = 0;
        this.queue[0] = seed; this.clean[seed] = 0;
        while (head < tail) {
          const i = this.queue[head++], x = i % w, y = Math.floor(i / w);
          count++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy, ni = ny * w + nx;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && this.clean[ni]) { this.clean[ni] = 0; this.queue[tail++] = ni; }
          }
        }
        const vx = sxx / count - (sx / count) ** 2, vy = syy / count - (sy / count) ** 2, cov = sxy / count - sx * sy / count ** 2;
        const delta = Math.sqrt((vx - vy) ** 2 + 4 * cov ** 2);
        const elongation = Math.sqrt((vx + vy + delta + 0.01) / (vx + vy - delta + 0.01));
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        if (count < minArea || count > maxArea || elongation < 1.3 || count / (bw * bh) < 0.18) { rejected++; continue; }
        detections.push({ x: x0, y: y0, w: bw, h: bh, cx: sx / count, cy: sy / count, area: count });
      }
      // More objects than the configured fish count are a quality problem, not proof of fish.
      const overflow = detections.length > expected * 3;
      detections.sort((a, b) => b.area - a.area);
      return { detections: detections.slice(0, expected * 3), sceneChange: false, rejected, overflow };
    }
  }

  // Rectangular Hungarian assignment, with one dummy column per live track.
  function assign(costs) {
    const n = costs.length;
    if (!n) return [];
    const m = costs[0].length, u = new Float64Array(n + 1), v = new Float64Array(m + 1), p = new Int32Array(m + 1), way = new Int32Array(m + 1);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Float64Array(m + 1).fill(Infinity), used = new Uint8Array(m + 1);
      do {
        used[j0] = 1;
        const i0 = p[j0]; let delta = Infinity, j1 = 0;
        for (let j = 1; j <= m; j++) if (!used[j]) {
          const current = costs[i0 - 1][j - 1] - u[i0] - v[j];
          if (current < minv[j]) { minv[j] = current; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const result = Array(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j]) result[p[j] - 1] = j - 1;
    return result;
  }

  class Tracker {
    constructor(config) { this.c = validateConfig(config); this.tracks = []; this.nextId = 1; this.eventId = 1; }
    breakContinuity(track) { track.side = 0; track.stable = 0; track.pendingSide = 0; track.inBand = false; track.hits = 0; }
    sideOf(d) {
      const vertical = this.c.orientation === 'vertical', size = vertical ? this.c.width : this.c.height;
      const lo = vertical ? d.x : d.y, hi = lo + (vertical ? d.w : d.h);
      const center = this.c.position * size, band = this.c.deadband * size;
      return hi < center - band ? -1 : lo > center + band ? 1 : 0;
    }
    crossing(track, d, t) {
      const side = this.sideOf(d);
      if (!side) { track.inBand = true; track.pendingSide = 0; track.stable = 0; return null; }
      if (side !== track.pendingSide) { track.pendingSide = side; track.stable = 1; track.sideTime = t; } else track.stable++;
      if (track.stable < 2 || track.hits < 3) return null;
      let event = null;
      if (track.side && track.side !== side && track.inBand) {
        event = { id: this.eventId++, time: track.sideTime, originalTime: track.sideTime, direction: side === 1 ? 'positive' : 'negative', originalDirection: side === 1 ? 'positive' : 'negative', trackId: track.id, source: 'auto', status: 'pending', note: '動体候補。個体・全身横断を目視確認してください。' };
      }
      const skippedBand = !!(track.side && track.side !== side && !track.inBand);
      track.side = side; track.inBand = false;
      if (skippedBand) track.skippedBand = true;
      return event;
    }
    update(detections, time, sceneChange = false) {
      const { width, height, expected, fps } = this.c;
      const events = [], visible = [];
      let lost = 0, ambiguous = 0, skippedBand = 0;
      if (sceneChange) { this.tracks = []; return { tracks: [], events, lost: expected, ambiguous: 0, skippedBand: 0 }; }
      this.tracks = this.tracks.filter(tr => time - tr.time <= 0.5);
      const costs = this.tracks.map(tr => {
        const dt = Math.max(1 / fps, time - tr.time);
        const px = tr.cx + tr.vx * dt, py = tr.cy + tr.vy * dt;
        const gate = Math.hypot(width, height) * 0.55 * dt + Math.max(tr.w, tr.h);
        return [...detections.map(d => {
          const distance = Math.hypot(px - d.cx, py - d.cy) / gate;
          const ratio = d.area / tr.area;
          return distance > 1 || ratio < 0.4 || ratio > 2.5 ? 1000 : distance ** 2 + 0.15 * Math.abs(Math.log(ratio));
        }), ...this.tracks.map(() => 1.1)];
      });
      const matches = assign(costs), used = new Set();
      for (let i = 0; i < this.tracks.length; i++) {
        const tr = this.tracks[i], j = matches[i];
        if (j < 0 || j >= detections.length || costs[i][j] >= 1.1) { this.breakContinuity(tr); lost++; continue; }
        const d = detections[j]; used.add(j);
        const rowAlternative = costs[i].slice(0, detections.length).some((cost, k) => k !== j && cost < costs[i][j] + 0.12);
        const columnAlternative = costs.some((row, k) => k !== i && row[j] < costs[i][j] + 0.12);
        const touching = detections.some((other, k) => k !== j && Math.hypot(other.cx - d.cx, other.cy - d.cy) < (Math.max(other.w, other.h) + Math.max(d.w, d.h)) * 0.65);
        const uncertain = rowAlternative || columnAlternative || touching || time - tr.time > 1.6 / fps;
        if (uncertain) { this.breakContinuity(tr); ambiguous++; }
        const dt = Math.max(1 / fps, time - tr.time);
        tr.vx = 0.5 * tr.vx + 0.5 * (d.cx - tr.cx) / dt;
        tr.vy = 0.5 * tr.vy + 0.5 * (d.cy - tr.cy) / dt;
        Object.assign(tr, d, { time, hits: tr.hits + 1, uncertain });
        if (!uncertain) {
          const event = this.crossing(tr, d, time);
          if (event) events.push(event);
          if (tr.skippedBand) { skippedBand++; tr.skippedBand = false; }
        }
        visible.push(this.snapshot(tr));
      }
      for (let j = 0; j < detections.length && this.tracks.length < expected; j++) {
        if (used.has(j)) continue;
        const tr = { ...detections[j], id: this.nextId++, time, vx: 0, vy: 0, hits: 1, side: 0, pendingSide: 0, stable: 0, inBand: false, uncertain: false };
        this.tracks.push(tr); this.crossing(tr, tr, time); visible.push(this.snapshot(tr));
      }
      return { tracks: visible, events, lost, ambiguous, skippedBand };
    }
    snapshot(tr) { return { id: tr.id, x: tr.x, y: tr.y, w: tr.w, h: tr.h, confirmed: tr.hits >= 3, uncertain: tr.uncertain }; }
  }

  class Engine {
    constructor(c) { this.detector = new Detector(c); this.tracker = new Tracker(c); this.c = c; }
    process(gray, time) {
      const detected = this.detector.detect(gray);
      const tracked = this.tracker.update(detected.detections, time, detected.sceneChange || detected.overflow);
      const reasons = [];
      if (detected.sceneChange) reasons.push('照明変化・大きな動き');
      if (detected.overflow || detected.detections.length > this.c.expected) reasons.push('候補数超過・反射の可能性');
      if (tracked.lost) reasons.push('追跡切れ');
      if (tracked.ambiguous) reasons.push('個体の重なり・対応が不確か');
      if (tracked.skippedBand) reasons.push('速い移動・判定帯の通過未観測');
      const confirmedCount = tracked.tracks.filter(tr => tr.confirmed && !tr.uncertain).length;
      if (confirmedCount !== this.c.expected) reasons.push('設定匹数を連続追跡できない');
      return { ...tracked, quality: { detections: detected.detections.length, confirmedCount, reasons, good: reasons.length === 0 } };
    }
  }

  function totals(events) {
    const result = { positive: 0, negative: 0, confirmed: 0, pending: 0, excluded: 0, auto: 0 };
    for (const e of events) {
      if (e.source === 'auto') result.auto++;
      if (e.status === 'confirmed') { result.confirmed++; result[e.direction]++; }
      else if (e.status === 'excluded') result.excluded++;
      else result.pending++;
    }
    return result;
  }
  function compareCounts(events, positive, negative) {
    if (![positive, negative].every(n => Number.isInteger(n) && n >= 0)) return null;
    const rawPositive = events.filter(e => e.source === 'auto' && e.originalDirection === 'positive').length;
    const rawNegative = events.filter(e => e.source === 'auto' && e.originalDirection === 'negative').length;
    const manual = positive + negative, delta = rawPositive + rawNegative - manual;
    return { positiveDelta: rawPositive - positive, negativeDelta: rawNegative - negative, delta, errorPercent: manual ? Math.abs(delta) / manual * 100 : null };
  }
  function csvCell(value) {
    let s = String(value ?? '');
    // Protect spreadsheet cells containing untrusted observation text / filenames.
    if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function makeCsv(run) {
    const counts = totals(run.events), c = run.config, dirs = directions(c.orientation);
    const label = d => d === 'positive' ? dirs[0] : dirs[1];
    const meta = [VERSION, run.state, run.target.toFixed(3), run.processedUntil.toFixed(3), counts.confirmed, counts.positive, counts.negative, counts.pending, counts.excluded, run.fileName, run.conditions.title, run.conditions.date, run.conditions.tankId, run.conditions.lightHours, run.conditions.temperature, c.expected, run.conditions.lighting, run.conditions.otherConditions, run.conditions.memo, c.orientation, c.position, c.deadband, c.fps, c.width, c.height, c.threshold, c.minArea, c.maxArea, JSON.stringify(c.roi), JSON.stringify(c.exclusions), run.manualPositive ?? '', run.manualNegative ?? '', run.frames ? (100 * run.goodFrames / run.frames).toFixed(1) : '', JSON.stringify(run.issues)];
    const headers = ['行種別', 'イベントID', '横断時刻_秒', '方向', '候補ID', '確認状態', '由来', '修正前時刻_秒', '修正前方向', '確認メモ', '方式バージョン', '解析状態', '対象時間_秒', '処理済み時間_秒', '確認済み合計', '確認済み正方向', '確認済み逆方向', '未確認候補', '除外件数', '動画名', '観察タイトル', '観察日', '水槽ID', '光照射時間_時間', '水温_℃', '設定匹数', '明るさ', 'その他条件', '観察メモ', '線の向き', '線の位置_比率', '判定帯_比率', 'サンプリング_fps', '解析幅_px', '解析高さ_px', '検出閾値', '最小面積_px', '最大面積_px', '解析範囲', '除外範囲', '独立手動_正方向', '独立手動_逆方向', '全候補連続追跡フレーム率_精度ではない', '要確認区間'];
    const rows = [headers, ['summary', '', '', '', '', '', '', '', '', '未確認候補は確認済み合計に含めない。途中結果は全時間の計測値ではない。', ...meta]];
    for (const e of [...run.events].sort((a, b) => a.time - b.time || a.id - b.id)) {
      rows.push(['event', e.id, e.time.toFixed(3), label(e.direction), e.trackId ?? '', { pending: '未確認', confirmed: '確認済み', excluded: '除外' }[e.status], e.source === 'auto' ? '自動候補' : '手動追加', e.originalTime == null ? '' : e.originalTime.toFixed(3), e.originalDirection ? label(e.originalDirection) : '', e.note, ...Array(meta.length).fill('')]);
    }
    return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  return { VERSION, validateConfig, grayscale, Detector, Tracker, Engine, assign, totals, compareCounts, makeCsv, directions };
});
