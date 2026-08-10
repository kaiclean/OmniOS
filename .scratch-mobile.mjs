import { chromium } from 'playwright';

const out = '/tmp/claude-0/-home-user/93b6cff1-8815-560b-80b3-eeb686028a4a/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({
  viewport: { width: 402, height: 874 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});

// 1. Protected page → login with next param.
await page.goto('http://127.0.0.1:3000/security', { waitUntil: 'networkidle', timeout: 60000 });
console.log('landed on:', page.url());
await page.screenshot({ path: `${out}/m1-login.png` });

// 2. Wrong key → error, no session.
await page.fill('input[name="key"]', 'wrong-key');
await page.click('button:has-text("Unlock")');
await page.waitForTimeout(1500);
console.log('wrong-key error shown:', (await page.locator('[role="alert"]').count()) > 0);

// 3. Right key → back to /security.
await page.fill('input[name="key"]', 'test-access-key-12345');
await page.click('button:has-text("Unlock")');
await page.waitForURL('**/security', { timeout: 30000 });
console.log('after login:', page.url());
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/m2-security.png` });

// 4. Rail drawer.
await page.click('button[aria-label="Open navigation"]');
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/m3-rail.png` });
await page.click('button.scrim');
await page.waitForTimeout(400);

// 5. Copilot sheet: open via toggle, close via the NEW close button.
await page.click('button[aria-label="Toggle assistant"]');
await page.waitForTimeout(700);
const sheetOpen1 = await page.getAttribute('.os', 'data-sheet');
await page.screenshot({ path: `${out}/m4-copilot.png` });
await page.click('button[aria-label="Close assistant"]:visible');
await page.waitForTimeout(500);
const sheetOpen2 = await page.getAttribute('.os', 'data-sheet');
console.log('sheet open→close via button:', sheetOpen1, '→', sheetOpen2);

// 6. Sheet again, dismissed via scrim this time.
await page.click('button[aria-label="Toggle assistant"]');
await page.waitForTimeout(500);
await page.click('button.scrim');
await page.waitForTimeout(400);
console.log('sheet closed via scrim:', await page.getAttribute('.os', 'data-sheet'));

await browser.close();
