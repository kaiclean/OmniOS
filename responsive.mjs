import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const out = '/tmp/claude-0/-home-user/93b6cff1-8815-560b-80b3-eeb686028a4a/scratchpad';

// light theme
const light = await b.newPage({ viewport: { width: 1440, height: 900 } });
await light.goto('http://localhost:3111/', { waitUntil: 'networkidle' });
await light.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
await light.waitForTimeout(500);
await light.screenshot({ path: `${out}/light.png` });
const contrast = await light.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  return { canvas: cs.getPropertyValue('--canvas').trim(), text1: cs.getPropertyValue('--text-1').trim(),
           accent: getComputedStyle(document.querySelector('.rail-mark')).backgroundColor };
});
console.log('light tokens', JSON.stringify(contrast));

// narrow: tablet + phone
for (const [name, w, h] of [['tablet', 1100, 820], ['phone', 430, 900]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('http://localhost:3111/companies', { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  const overflow = await p.evaluate(() => ({
    bodyScrollW: document.body.scrollWidth, innerW: window.innerWidth,
    railToggle: getComputedStyle(document.querySelector('.rail-toggle')).display,
    copilot: getComputedStyle(document.querySelector('.copilot')).position,
  }));
  console.log(name, JSON.stringify(overflow));
  await p.screenshot({ path: `${out}/${name}.png` });
}
await b.close();
