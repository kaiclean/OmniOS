import { chromium } from 'playwright';
const out='/tmp/claude-0/-home-user/93b6cff1-8815-560b-80b3-eeb686028a4a/scratchpad';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:1680,height:1050} });
for (const [n,path] of [['finance','/finance'],['studio','/studio'],['automations','/automations']]) {
  await p.goto('http://localhost:3111'+path,{waitUntil:'networkidle',timeout:120000});
  await p.waitForTimeout(700);
  await p.screenshot({ path:`${out}/${n}.png` });
  console.log('shot',n);
}
await b.close();
