// One floating tooltip for the whole UI. Elements opt in with data-tip="<kind>:<id>[:<extra>]";
// the resolver turns that into HTML each time the pointer moves, so cooldowns stay current.
// The 3D view sets its own content through `hover` (units under the cursor).
export type TipResolver = (key: string) => string;

export class Tooltip {
  private readonly el: HTMLElement;
  private key: string | undefined;
  private canvasHtml: string | undefined;
  private x = 0;
  private y = 0;
  private readonly resolve: TipResolver;

  constructor(resolve: TipResolver) {
    this.resolve = resolve;
    this.el = Object.assign(document.body.appendChild(document.createElement('div')), { className: 'tooltip' });
    document.addEventListener('pointermove', (e) => {
      this.x = e.clientX;
      this.y = e.clientY;
      const target = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
      this.key = target?.dataset.tip;
      this.render();
    });
    document.addEventListener('pointerleave', () => { this.key = undefined; this.canvasHtml = undefined; this.render(); });
  }

  /** Content for whatever the 3D view has under the cursor, or undefined. */
  hover(html: string | undefined): void {
    if (html === this.canvasHtml) return;
    this.canvasHtml = html;
    this.render();
  }

  /** Re-resolves the current key, e.g. once per frame while a cooldown counts down. */
  refresh(): void {
    if (!this.key) return;
    // Panels redraw under a still pointer: look again at what is there now.
    const target = document.elementFromPoint(this.x, this.y)?.closest('[data-tip]') as HTMLElement | null;
    this.key = target?.dataset.tip;
    this.render();
  }

  private render(): void {
    const html = this.key ? this.resolve(this.key) : this.canvasHtml;
    if (!html) { this.el.classList.remove('show'); return; }
    if (this.el.innerHTML !== html) this.el.innerHTML = html;
    this.el.classList.add('show');
    // Prefer above-right of the pointer, flipping to stay on screen.
    const w = this.el.offsetWidth, h = this.el.offsetHeight, pad = 14;
    let left = this.x + pad, top = this.y - h - pad;
    if (left + w > innerWidth - 4) left = this.x - w - pad;
    if (top < 4) top = this.y + pad;
    this.el.style.transform = `translate(${Math.max(4, left)}px, ${Math.min(innerHeight - h - 4, top)}px)`;
  }
}

/** NPC fleet variants (I/II/III 型) use their class's icon, like they share its model. */
const ICON_ALIASES: Record<string, string> = { h00E: 'h00I', h01M: 'h00I', h00F: 'h00B', h013: 'h00B', h00G: 'h00H', h017: 'h00H', h010: 'h00H' };

/** An icon tile: the picture when it exists, its name underneath as the fallback. */
export function icon(kind: 'ship' | 'weapon' | 'item' | 'skill' | 'unit', id: string, name: string, cls = ''): string {
  id = ICON_ALIASES[id] ?? id;
  return `<span class="icon ${cls}"><em>${name.slice(0, 4)}</em><i style="background-image:url(${import.meta.env.BASE_URL}icons/${kind}/${id}.jpg)"></i></span>`;
}
