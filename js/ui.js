// ui.js — DOM adapter for web-mlr
// 16×8 grid mirroring OG MLR layout

import { MODE_NAMES, MODE_LABELS } from './mlr-core.js';

export class UI {
  constructor() {
    this.grid = document.getElementById('grid');
    this.tracks = document.getElementById('tracks');
    this.makeGrid();
    this.makeTracks();
  }

  makeGrid() {
    this.grid.innerHTML = '';
    this.grid.style.setProperty('--grid-cols', '16');
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 16; x++) {
        const b = document.createElement('button');
        b.className = 'pad';
        if (y === 0) b.classList.add('nav');
        if (y === 7) b.classList.add('fn');
        b.dataset.x = x;
        b.dataset.y = y;
        b.ariaLabel = `pad ${x},${y}`;
        this.grid.appendChild(b);
      }
    }
  }

  makeTracks() {
    this.tracks.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const d = document.createElement('div');
      d.className = 'track';
      d.dataset.track = i;
      d.innerHTML = `
        <div class="track-header">
          <span class="track-num">${i + 1}</span>
          <span class="track-mode" id="track-mode-${i}"></span>
        </div>
        <span class="track-clip" id="clip-${i}">drop audio or click to pick</span>
        <div class="track-meter"><span id="meter-${i}"></span></div>
      `;
      d.addEventListener('dragover', e => { e.preventDefault(); d.classList.add('drop-hover'); });
      d.addEventListener('dragleave', () => d.classList.remove('drop-hover'));
      d.addEventListener('drop', e => {
        e.preventDefault();
        d.classList.remove('drop-hover');
        if (this.onDropFiles) this.onDropFiles(e.dataTransfer.files, i);
      });
      d.addEventListener('click', e => {
        if (e.target.tagName !== 'BUTTON') this.onFilePick?.(i);
      });
      this.tracks.appendChild(d);
    }
  }

  onPad(fn) {
    this.grid.addEventListener('pointerdown', e => {
      const p = e.target.closest('.pad');
      if (p) fn({ x: +p.dataset.x, y: +p.dataset.y, state: true });
    });
    this.grid.addEventListener('pointerup', e => {
      const p = e.target.closest('.pad');
      if (p) fn({ x: +p.dataset.x, y: +p.dataset.y, state: false });
    });
    this.grid.addEventListener('pointerleave', e => {
      const p = e.target.closest('.pad');
      if (p) fn({ x: +p.dataset.x, y: +p.dataset.y, state: false });
    });
  }

  render(frame) {
    if (!frame) return;
    const children = [...this.grid.children];
    for (const el of children) {
      const x = +el.dataset.x;
      const y = +el.dataset.y;
      const l = frame[y]?.[x] ?? 0;
      el.classList.toggle('on', l >= 12);
      el.classList.toggle('dim', l > 0 && l < 12);
    }
  }

  renderPatterns(patterns = []) {
    patterns.forEach((pattern, i) => {
      const rec = document.querySelector(`[data-pattern-action="record"][data-pattern-slot="${i}"]`);
      const play = document.querySelector(`[data-pattern-action="play"][data-pattern-slot="${i}"]`);
      const status = document.getElementById(`pattern-${i}-status`);
      if (rec) rec.classList.toggle('recording', !!pattern.recording);
      if (play) play.classList.toggle('playing', !!pattern.playing);
      if (play) play.toggleAttribute('disabled', !pattern.count);
      if (status) {
        const len = pattern.time?.length ? `${pattern.time.length} events` : 'empty';
        status.textContent = pattern.recording
          ? `recording ${pattern.count}`
          : pattern.playing
            ? `playing ${pattern.count}`
            : `${pattern.count} / ${len}`;
      }
    });
  }

  setClipNames(clips) {
    clips.slice(0, 6).forEach((clip, i) => {
      const el = document.getElementById(`clip-${i}`);
      if (el) el.textContent = clip.name;
    });
  }

  updateNav(state) {
    if (!state) return;
    document.getElementById('fn-rec')?.classList.toggle('active', state.view === 1);
    document.getElementById('fn-cut')?.classList.toggle('active', state.view === 2);
    document.getElementById('fn-clip')?.classList.toggle('active', state.view === 3);
    document.getElementById('fn-quantize')?.classList.toggle('active', state.quantize);

    (state.patterns || []).forEach((p, i) => {
      const playBtn = document.getElementById(`fn-p${i + 1}-play`);
      const recBtn = document.getElementById(`fn-p${i + 1}-rec`);
      if (playBtn) playBtn.classList.toggle('active', p.playing);
      if (recBtn) recBtn.classList.toggle('recording', p.recording);
    });
  }

  updateTrackModes(tracks) {
    if (!tracks) return;
    for (let i = 0; i < tracks.length; i++) {
      const el = document.getElementById(`track-mode-${i}`);
      if (!el) continue;
      const t = tracks[i];
      const modeLabel = MODE_LABELS[t.mode] || 'C';
      let cls = 'track-mode';
      if (t.mode === 1) cls += ' mode-solo';
      else if (t.mode === 2) cls += ' mode-mute';
      else if (t.mode === 3) cls += ' mode-once';
      if (t.rec) cls += ' mode-rec';
      el.textContent = modeLabel;
      el.className = cls;
    }
  }

  updatePendingMode(pendingMode) {
    // Highlight the pending mode indicator in the UI
    const indicator = document.getElementById('pending-mode-indicator');
    if (indicator) {
      if (pendingMode !== null) {
        indicator.textContent = `Mode: ${MODE_NAMES[pendingMode]} — press a track to apply`;
        indicator.style.display = 'block';
      } else {
        indicator.style.display = 'none';
      }
    }
  }
}

export function setPill(id, text, mode = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `pill ${mode}`.trim();
}
