// An in-game confirmation box, in place of the browser's confirm(): embedded browsers (the desktop
// app's preview, some in-app browsers) answer that one "no" without showing it. Enter confirms,
// Escape or a click outside cancels.

export function confirmDialog(message: string, ok = '确定', cancel = '取消'): Promise<boolean> {
  const root = Object.assign(document.body.appendChild(document.createElement('div')), { className: 'dialog' });
  root.innerHTML = `<div class="settings-card dialog-card"><p></p><div class="settings-actions">
    <button class="primary" data-answer="yes"></button><button data-answer="no"></button></div></div>`;
  root.querySelector('p')!.textContent = message;
  root.querySelector('[data-answer=yes]')!.textContent = ok;
  root.querySelector('[data-answer=no]')!.textContent = cancel;
  return new Promise((resolve) => {
    const done = (answer: boolean) => {
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      resolve(answer);
    };
    // Taken before every other key handler, so Escape closes only this box.
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
    };
    window.addEventListener('keydown', onKey, true);
    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === root) return done(false);
      const answer = t.closest('button')?.dataset.answer;
      if (answer) done(answer === 'yes');
    });
    root.querySelector<HTMLButtonElement>('[data-answer=yes]')!.focus();
  });
}
