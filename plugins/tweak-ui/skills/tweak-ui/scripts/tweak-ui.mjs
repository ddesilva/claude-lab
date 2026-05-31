#!/usr/bin/env node
/* tweak-ui driver — launches a real Chromium via Playwright, injects the overlay,
 * and writes the user's tweaks (session.json / instructions.md / DONE) to --out. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--'));
const outArg = (() => { const i = argv.indexOf('--out'); return i >= 0 ? argv[i + 1] : null; })();
const outDir = path.resolve(outArg || path.join(process.cwd(), '.tweak-ui'));

if (!url) {
  console.error('Usage: node tweak-ui.mjs <url> [--out <dir>]');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
for (const f of ['DONE', 'instructions.md', 'session.json']) {
  try { fs.rmSync(path.join(outDir, f)); } catch {}
}

const overlaySource = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8');

console.log('[tweak-ui] launching browser →', url);
const browser = await chromium.launch({
  headless: false,
  args: ['--start-maximized', '--no-default-browser-check', '--no-first-run']
});
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();

let latest = null;
let finished = false;

function writeSession(p) {
  fs.writeFileSync(path.join(outDir, 'session.json'), JSON.stringify(p, null, 2));
}

async function shutdown(p) {
  if (finished) return;
  finished = true;
  const data = p || latest;
  if (data) {
    writeSession(data);
    fs.writeFileSync(path.join(outDir, 'instructions.md'), data.instructions || '(no changes captured)');
  } else {
    fs.writeFileSync(path.join(outDir, 'instructions.md'), '(no changes captured)');
  }
  fs.writeFileSync(path.join(outDir, 'DONE'), new Date().toISOString());
  console.log('[tweak-ui] session complete →', outDir);
  try { await browser.close(); } catch {}
  process.exit(0);
}

await context.exposeFunction('__tweakUiSend', (msg) => {
  if (!msg || !msg.payload) return;
  if (msg.type === 'update') { latest = msg.payload; writeSession(msg.payload); }
  else if (msg.type === 'finish') { latest = msg.payload; shutdown(msg.payload); }
});

await context.addInitScript(overlaySource);

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
} catch (e) {
  console.error('[tweak-ui] could not fully load', url, '-', e.message);
}
try { await page.evaluate(overlaySource); } catch {}

console.log('[tweak-ui] overlay ready. Click elements, tweak them, then press');
console.log('[tweak-ui] "✓ Apply & Finish" (or just close the window) when done.');

browser.on('disconnected', () => shutdown(latest));
process.on('SIGINT', () => shutdown(latest));
process.on('SIGTERM', () => shutdown(latest));
