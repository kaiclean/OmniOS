import { chromium } from 'playwright';
const out='/tmp/claude-0/-home-user/93b6cff1-8815-560b-80b3-eeb686028a4a/scratchpad';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:1680,height:1050} });
p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0,200)));
await p.goto('http://localhost:3111/', { waitUntil:'networkidle' });

// click the first suggestion
await p.click('text=What should I do today?');
// the seam must signal work in progress
await p.waitForTimeout(120);
const thinking = await p.getAttribute('.seam', 'data-thinking');
await p.waitForSelector('.msg--assistant', { timeout: 60000 });
await p.waitForTimeout(800);
const after = await p.getAttribute('.seam', 'data-thinking');

const reply = await p.evaluate(() => {
  const m = document.querySelector('.msg--assistant');
  return {
    text: m?.querySelector('.msg-body')?.textContent?.slice(0, 400),
    planSummary: m?.querySelector('.plan > summary')?.textContent?.trim(),
    steps: [...m.querySelectorAll('.plan-step-name')].map(e => e.textContent),
    simulated: m?.querySelector('.sim-mark')?.textContent?.trim(),
  };
});
console.log('seam while working:', thinking, '| after:', after);
console.log(JSON.stringify(reply, null, 2));
await p.screenshot({ path: `${out}/assistant-reply.png` });
await b.close();
