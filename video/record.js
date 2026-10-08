/* Renders the OceanScope product film frame by frame and encodes it.
   Usage: node record.js [--fps 60] [--test 5] [--voice Samantha] [--rate 168]
   Output (in ../): OceanScope_Demo.mp4 (narrated), OceanScope_Demo_music.mp4 (music only) */
const fs = require('fs'), path = require('path'), http = require('http'), { spawn, execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const { renderMusic } = require('./music');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const DRY = process.argv.includes('--dry');
const FPS = +arg('fps', 60), TEST = +arg('test', 0), VOICE = arg('voice', 'Samantha'), RATE = +arg('rate', 168);
const W = 1920, H = 1080, DT = 1000 / FPS;
const ROOT = path.resolve(__dirname, '../oceanscope'), OUT = path.resolve(__dirname, '..'), WORK = path.join(__dirname, 'work');
fs.mkdirSync(WORK, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------- narration ---------- */
const SCRIPT = JSON.parse(fs.readFileSync(path.join(__dirname, 'script.json'), 'utf8'));
function wavDuration(file) {
  const b = fs.readFileSync(file); let o = 12, rate = 48000, ch = 1, bits = 16;
  while (o < b.length - 8) { const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4); if (id === 'fmt ') { ch = b.readUInt16LE(o + 10); rate = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22); } if (id === 'data') return sz / (rate * ch * bits / 8) * 1000; o += 8 + sz + (sz % 2); }
  return 0;
}
function makeVO() {
  const dur = {};
  for (const line of SCRIPT.lines) {
    const f = path.join(WORK, `${line.id}.wav`);
    execFileSync('say', ['-v', VOICE, '-r', String(RATE), '--data-format=LEI16@48000', '-o', f, line.say || line.text]);
    dur[line.id] = Math.round(wavDuration(f));
  }
  return dur;
}

/* ---------- static server ---------- */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

(async () => {
  log(`OceanScope film · ${W}x${H} @ ${FPS} fps${TEST ? ` · test ${TEST}s` : ''}`);
  const voDur = makeVO();
  log('narration ready', Object.values(voDur).reduce((a, b) => a + b, 0) / 1000 | 0, 's of speech');

  const srv = await serve(), port = srv.address().port;
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
    args: [`--window-size=${W},${H}`, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--hide-scrollbars', '--mute-audio',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.evaluateOnNewDocument(fs.readFileSync(path.join(__dirname, 'vt.js'), 'utf8'));
  await page.goto(`http://127.0.0.1:${port}/index.html?rec=1`, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction(() => window.OS && OS.Scene && OS.Scene.ready && OS.FX && OS.FX.ready, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  log('GPU:', gpu);
  await new Promise((r) => setTimeout(r, 4500));
  await page.addScriptTag({ path: path.join(__dirname, arg('director', 'director.js')) });

  const cdp = await page.createCDPSession();
  const ffmpeg = DRY ? { stdin: { write: () => true, end() {} }, on: (e, f) => f() } : spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-maxrate', '22M', '-bufsize', '44M', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-tune', 'film', '-movflags', '+faststart', path.join(WORK, 'video.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] });
  const write = (buf) => new Promise((res) => { if (!ffmpeg.stdin.write(buf)) ffmpeg.stdin.once('drain', res); else res(); });

  await page.evaluate((vo) => { window.__VO_DUR = vo; window.__VT.start(); window.__T0 = performance.now(); window.__runShow(); }, voDur);
  const t0 = Date.now(), maxFrames = TEST ? TEST * FPS : 60 * 60 * FPS;
  let k = 0, done = false;
  while (!done && k < maxFrames) {
    if (k > 0) done = await page.evaluate((dt) => { window.__VT.advance(dt); return !!window.__showDone; }, DT);
    if (!DRY) { const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, optimizeForSpeed: true }); await write(Buffer.from(shot.data, 'base64')); }
    else if (k % (FPS * 15) === 0) { const f = path.join(WORK, 'frames', `dry_${String(k / FPS).padStart(3, '0')}.jpg`); fs.mkdirSync(path.dirname(f), { recursive: true }); const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }); fs.writeFileSync(f, Buffer.from(shot.data, 'base64')); }
    k++;
    if (k % (FPS * 10) === 0) { const el = (Date.now() - t0) / 1000; log(`${(k / FPS).toFixed(0)} s rendered · ${(el / k * 1000).toFixed(0)} ms/frame`); }
  }
  ffmpeg.stdin.end();
  await new Promise((r) => ffmpeg.on('close', r));
  const events = await page.evaluate(() => window.__events);
  const duration = k / FPS;
  fs.writeFileSync(path.join(WORK, 'events.json'), JSON.stringify({ duration, fps: FPS, events }, null, 1));
  log(`captured ${k} frames (${duration.toFixed(1)} s) in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  if (errors.length) log('page errors:', errors.slice(0, 8));
  const missing = events.filter((e) => e.type === 'missing' || e.type === 'error'); if (missing.length) log('director warnings:', missing);
  await browser.close(); srv.close();
  if (DRY) { const ch = events.filter((e) => ['chapter', 'vo', 'section', 'end'].includes(e.type)).map((e) => `${(e.t / 1000).toFixed(1)}s ${e.type} ${e.title || e.id || e.name || ''}`); console.log(ch.join('\n')); return; }

  /* ---------- sound ---------- */
  const vo = events.filter((e) => e.type === 'vo');
  renderMusic({ duration, events, duckFile: path.join(WORK, 'music_duck.wav'), plainFile: path.join(WORK, 'music.wav'), vo });
  log('score rendered');

  const inputs = ['-i', path.join(WORK, 'video.mp4'), '-i', path.join(WORK, 'music_duck.wav')];
  const parts = [];
  vo.forEach((e, i) => { inputs.push('-i', path.join(WORK, `${e.id}.wav`)); parts.push(`[${i + 2}:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=1.35,adelay=${Math.round(e.t)}|${Math.round(e.t)}[v${i}]`); });
  const mix = `${parts.length ? parts.join(';') + ';' : ''}[1:a]volume=0.95[m];[m]${vo.map((_, i) => `[v${i}]`).join('')}amix=inputs=${vo.length + 1}:normalize=0:duration=first,loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000[a]`;
  const narrated = path.join(OUT, TEST ? 'OceanScope_Demo_TEST.mp4' : 'OceanScope_Demo.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', mix, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '224k', '-shortest', '-movflags', '+faststart', narrated]);
  if (!TEST) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(WORK, 'video.mp4'), '-i', path.join(WORK, 'music.wav'), '-filter_complex', '[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '224k', '-shortest', '-movflags', '+faststart', path.join(OUT, 'OceanScope_Demo_music.mp4')]);
    const amphan = events.find((e) => e.type === 'vo' && e.id === 'v5');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(((amphan ? amphan.t : 40000) + 4000) / 1000), '-i', path.join(WORK, 'video.mp4'), '-frames:v', '1', '-q:v', '2', path.join(OUT, 'OceanScope_Demo_poster.jpg')]);
  }
  log('done →', narrated);
})().catch((e) => { console.error(e); process.exit(1); });
