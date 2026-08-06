import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const out='/tmp/claude-0/-home-user/93b6cff1-8815-560b-80b3-eeb686028a4a/scratchpad';
for (const [name,w,h] of [['phone',430,900],['tablet',1100,820]]) {
  const p = await b.newPage({ viewport:{width:w,height:h} });
  await p.goto('http://localhost:3111/companies',{waitUntil:'networkidle'});
  await p.waitForTimeout(600);
  const st = await p.evaluate(()=>{ const c=document.querySelector('.copilot').getBoundingClientRect();
    return { copilotLeft: Math.round(c.left), innerW: window.innerWidth, offscreen: c.left >= window.innerWidth - 2 }; });
  console.log(name, JSON.stringify(st));
  await p.screenshot({ path:`${out}/${name}.png` });
  // open the sheet
  await p.click('button[aria-label="Toggle assistant"]');
  await p.waitForTimeout(600);
  const open = await p.evaluate(()=>Math.round(document.querySelector('.copilot').getBoundingClientRect().left));
  console.log(name,'after toggle, copilot left =',open);
  await p.close();
}
await b.close();
