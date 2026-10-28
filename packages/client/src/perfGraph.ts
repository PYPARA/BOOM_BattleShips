// Frame-time graph (F9): the last 150 frames as bars, a line at 60 fps, hitches in red, plus how
// many frames took over 50 ms since the graph was opened. For finding stutter while playing.
const FRAMES = 150;
const STORAGE_KEY = 'boom.perf';

export class PerfGraph {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly times = new Float32Array(FRAMES);
  private head = 0;
  private hitches = 0;
  private shown = false;

  constructor() {
    this.canvas = Object.assign(document.body.appendChild(document.createElement('canvas')), { className: 'perf-graph', width: FRAMES * 2, height: 80 });
    this.ctx = this.canvas.getContext('2d')!;
    try { this.shown = localStorage.getItem(STORAGE_KEY) === 'on'; } catch { /* storage blocked */ }
    this.canvas.style.display = this.shown ? 'block' : 'none';
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'F9') return;
      e.preventDefault();
      this.shown = !this.shown;
      this.hitches = 0;
      this.canvas.style.display = this.shown ? 'block' : 'none';
      try { localStorage.setItem(STORAGE_KEY, this.shown ? 'on' : 'off'); } catch { /* storage blocked */ }
    });
  }

  /** Records one frame's duration in milliseconds. */
  frame(ms: number): void {
    this.times[this.head] = ms;
    this.head = (this.head + 1) % FRAMES;
    if (!this.shown) return;
    if (ms > 50) this.hitches++;
    const { ctx, canvas } = this;
    const h = canvas.height, scale = h / 50; // 50 ms fills the graph
    ctx.clearRect(0, 0, canvas.width, h);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, h);
    let max = 0;
    for (let i = 0; i < FRAMES; i++) {
      const t = this.times[(this.head + i) % FRAMES]!;
      max = Math.max(max, t);
      ctx.fillStyle = t > 33 ? '#ff5a46' : t > 17.5 ? '#ffc04d' : '#6ff0de';
      const bar = Math.min(h, t * scale);
      ctx.fillRect(i * 2, h - bar, 2, bar);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.moveTo(0, h - 16.7 * scale); ctx.lineTo(canvas.width, h - 16.7 * scale); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(`最近最长 ${max.toFixed(0)} ms · 卡顿(>50ms) ${this.hitches} 次`, 6, 13);
  }
}
