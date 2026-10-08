/* Dry-run the show to a given second and dump state. node debug.js 70 */
const fs = require('fs'), path = require('path'), http = require('http');
const puppeteer = require('puppeteer-core');
const STOP = +process.argv[2] || 70, ROOT = path.resolve(__dirname, '../oceanscope');
(async () => {
  const srv = http.createServer((req, rsp) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f)) { rsp.writeHead(404); rsp.end(); return; } rsp.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(rsp); }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, defaultViewport: { width: 1920, height: 1080 }, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(fs.readFileSync(path.join(__dirname, 'vt.js'), 'utf8'));
  await page.goto(`http://127.0.0.1:${srv.address().port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.OS && OS.Scene && OS.Scene.ready && OS.FX && OS.FX.ready);
  await new Promise((r) => setTimeout(r, 4500));
  await page.addScriptTag({ path: path.join(__dirname, 'director.js') });
  const vo = {}; JSON.parse(fs.readFileSync('script.json')).lines.forEach((l) => { const f = path.join('work', l.id + '.wav'); vo[l.id] = Math.round((fs.statSync(f).size - 44) / 96); });
  await page.evaluate((v) => { window.__VO_DUR = v; __VT.start(); window.__T0 = performance.now(); __runShow(); }, vo);
  for (let k = 0; k < STOP * 60; k++) await page.evaluate(() => __VT.advance(1000 / 60));
  const st = await page.evaluate(() => { const d = document.getElementById('dossier'); if (!d) return 'no dossier'; const cs = getComputedStyle(d); return { hidden: d.hidden, open: OS.Dossier.isOpen(), opacity: cs.opacity, vis: cs.visibility, display: cs.display, filter: cs.filter, transform: cs.transform, rect: d.getBoundingClientRect().toJSON(), anims: d.getAnimations().map((a) => ({ name: a.animationName, t: a.currentTime, state: a.playState, dur: a.effect.getTiming().duration })), body: document.body.className }; });
  console.log(JSON.stringify(st, null, 1));
  await page.screenshot({ path: 'work/frames/debug.jpg', type: 'jpeg', quality: 70 });
  await browser.close(); srv.close();
})();
