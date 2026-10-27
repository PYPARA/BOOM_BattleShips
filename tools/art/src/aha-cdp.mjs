// Minimal Chrome DevTools Protocol driver for the Aha desktop window. Aha must be started with
// a local debug port: open <Aha.app> --args --remote-debugging-port=9333
// (see docs/art/batch-modeling.md). Faster and more exact than clicking screen pixels.
// node cdp.mjs eval '<js expression>'      → prints the JSON value
// node cdp.mjs shot <file.png> [scale]       → screenshot
// node cdp.mjs click <x> <y>                 → mouse click at CSS pixels
// node cdp.mjs type '<text>'                 → insert text at the focus
// node cdp.mjs key <Enter|Escape|Tab|...>    → key press
// node cdp.mjs files '<css selector>' <path...> → set files on an <input type=file>
import { writeFileSync } from 'node:fs';

const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'eval') {
    const r = await send('Runtime.evaluate', { expression: args[0], returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    console.log(JSON.stringify(r.result.value, null, 1));
  } else if (cmd === 'shot') {
    const scale = Number(args[1] ?? 0.6);
    const metrics = await send('Page.getLayoutMetrics');
    const { clientWidth: w, clientHeight: h } = metrics.cssLayoutViewport;
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale } });
    writeFileSync(args[0], Buffer.from(r.data, 'base64'));
    console.log(`saved ${args[0]} (${w}x${h} css px, scale ${scale})`);
  } else if (cmd === 'click') {
    const [x, y] = args.map(Number);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
    }
    console.log('clicked', x, y);
  } else if (cmd === 'type') {
    await send('Input.insertText', { text: args[0] });
    console.log('typed', args[0].length, 'chars');
  } else if (cmd === 'key') {
    const key = args[0];
    const code = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8 }[key] ?? 0;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, text: key === 'Enter' ? '\r' : undefined });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
    console.log('key', key);
  } else if (cmd === 'files') {
    const [selector, ...paths] = args;
    const { root } = await send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`No element for ${selector}`);
    await send('DOM.setFileInputFiles', { nodeId, files: paths });
    console.log('set', paths.length, 'files on', selector);
  } else {
    throw new Error(`Unknown command ${cmd}`);
  }
} finally {
  ws.close();
}
