// Fullscreen: a corner button, Alt+Enter and a switch in the settings. Where the browser allows
// it (Keyboard Lock, Chrome and Edge), Escape stays a game key in fullscreen and leaving takes a
// long press of Escape instead.

export const canFullscreen = document.fullscreenEnabled;

export function isFullscreen(): boolean {
  return !!document.fullscreenElement;
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) return await document.exitFullscreen();
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const keyboard = (navigator as { keyboard?: { lock?: (keys: string[]) => Promise<void> } }).keyboard;
    await keyboard?.lock?.(['Escape']);
  } catch { /* refused, or Keyboard Lock unsupported: Escape then leaves fullscreen as usual */ }
}

const ICON_ENTER = '<svg viewBox="0 0 20 20"><path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5"/></svg>';
const ICON_LEAVE = '<svg viewBox="0 0 20 20"><path d="M8 3v5H3M17 8h-5V3M12 17v-5h5M3 12h5v5"/></svg>';

/** The fullscreen button (top right in the menu, beside the gear in a match) and Alt+Enter. */
export function createFullscreenButton(): HTMLButtonElement | undefined {
  if (!canFullscreen) return undefined;
  const button = Object.assign(document.body.appendChild(document.createElement('button')), { className: 'fullscreen' });
  const render = () => {
    button.innerHTML = isFullscreen() ? ICON_LEAVE : ICON_ENTER;
    button.title = `${isFullscreen() ? '退出全屏' : '全屏'} (Alt+Enter)`;
  };
  render();
  button.addEventListener('click', () => void toggleFullscreen());
  document.addEventListener('fullscreenchange', render);
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'Enter') { e.preventDefault(); void toggleFullscreen(); }
  });
  return button;
}
