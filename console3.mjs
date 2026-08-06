import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:1680,height:1050} });
p.on('requestfailed', r => console.log('FAILED', r.url(), r.failure()?.errorText));
p.on('response', async r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
await p.goto('http://localhost:3111/', { waitUntil:'networkidle' });
await p.waitForTimeout(1500);
await b.close();
