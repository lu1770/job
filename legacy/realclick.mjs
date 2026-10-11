// Usage: node realclick.mjs <fullTabId> <x> <y>
import { connect, sleep } from './jlib.mjs';

const [tabId, xs, ys] = process.argv.slice(2);
const x = Number(xs), y = Number(ys);
const { cdp } = await connect(tabId);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
await sleep(150);
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
await sleep(80);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
console.log('clicked', x, y);
process.exit(0);