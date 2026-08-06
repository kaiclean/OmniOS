import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:1680,height:1050} });
const msgs = [];
p.on('console', m => msgs.push(`${m.type()}: ${m.text().slice(0,300)}`));
p.on('pageerror', e => msgs.push('pageerror: ' + String(e).slice(0,300)));
for (const path of ['/', '/companies', '/life', '/intelligence/upgrades', '/studio', '/factory']) {
  await p.goto('http://localhost:3111'+path, { waitUntil:'networkidle' });
  await p.waitForTimeout(500);
}
console.log(msgs.length ? [...new Set(msgs)].join('\n') : 'NO CONSOLE OUTPUT');
await b.close();
