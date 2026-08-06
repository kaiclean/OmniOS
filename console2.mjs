import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:1680,height:1050} });
p.on('console', m => { const t=m.text(); if (m.type()==='error') console.log('--- ERROR ---\n'+t+'\n'); });
p.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
await p.goto('http://localhost:3111/', { waitUntil:'networkidle' });
await p.waitForTimeout(1200);
await b.close();
