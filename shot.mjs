import { chromium } from 'playwright';
const base = 'http://localhost:3111';
const shots = [
  ['home', '/'],
  ['company', '/companies/meridian-build-b3o5'],
  ['life', '/life'],
  ['upgrades', '/intelligence/upgrades'],
];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 });
for (const [name, path] of shots) {
  await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `/tmp/claude-0/-home-user/93b6cff1-8815-560b-80b3-eeb686028a4a/scratchpad/${name}.png` });
  console.log('shot', name);
}
await browser.close();
