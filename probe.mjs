import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1680, height: 1050 } });
await p.goto('http://localhost:3111/', { waitUntil: 'networkidle' });
const r = await p.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const box = (s) => { const e = q(s); if (!e) return 'missing'; const b = e.getBoundingClientRect();
    return { top: +b.top.toFixed(1), h: +b.height.toFixed(1), display: getComputedStyle(e).display }; };
  const strip = q('.strip'), cell = q('.strip-cell');
  return {
    strip: box('.strip'), scroll: box('.strip-scroll'), cell: box('.strip-cell'),
    label: box('.strip-label'), value: box('.strip-value'),
    railToggle: box('.rail-toggle'),
    cellAlign: cell ? getComputedStyle(cell).justifyContent : null,
    scrollAlign: q('.strip-scroll') ? getComputedStyle(q('.strip-scroll')).alignItems : null,
    stripScrollTop: strip ? strip.scrollTop : null,
    docOverflow: document.documentElement.scrollHeight > window.innerHeight,
  };
});
console.log(JSON.stringify(r, null, 2));
await b.close();
