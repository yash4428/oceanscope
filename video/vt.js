/* Virtual time for deterministic capture. Injected before any page script.
   Real mode: everything behaves normally. After __VT.start(), time only moves when __VT.advance(ms) is called:
   timers fire in order, rAF callbacks run once per advance, and every CSS animation/transition is paused
   and scrubbed to the virtual clock. */
(() => {
  const nPerf = performance.now.bind(performance), nDate = Date.now, nRAF = window.requestAnimationFrame.bind(window);
  const nST = window.setTimeout.bind(window), nCT = window.clearTimeout.bind(window);
  const V = { on: false, t: 0, base: 0, dateBase: 0, seq: 1, timers: new Map(), rafs: new Map(), anims: new WeakMap() };
  const now = () => (V.on ? V.t : nPerf());
  performance.now = now;
  Date.now = () => (V.on ? V.dateBase + (V.t - V.base) : nDate());

  window.requestAnimationFrame = (cb) => {
    const id = V.seq++; V.rafs.set(id, cb);
    if (!V.on) nRAF(() => { if (V.on || !V.rafs.has(id)) return; V.rafs.delete(id); cb(now()); });
    return id;
  };
  window.cancelAnimationFrame = (id) => { V.rafs.delete(id); };

  const addTimer = (cb, ms, args, every) => {
    const id = V.seq++, delay = Math.max(0, +ms || 0);
    const tm = { cb, args, due: now() + delay, every: every ? Math.max(1, delay) : 0 };
    V.timers.set(id, tm);
    if (!V.on) {
      const fire = () => {
        if (V.on || !V.timers.has(id)) return;
        if (tm.every) { tm.due = now() + tm.every; nST(fire, tm.every); } else V.timers.delete(id);
        if (typeof cb === 'function') cb(...args);
      };
      nST(fire, delay);
    }
    return id;
  };
  window.setTimeout = (cb, ms, ...args) => addTimer(cb, ms, args, false);
  window.setInterval = (cb, ms, ...args) => addTimer(cb, ms, args, true);
  window.clearTimeout = window.clearInterval = (id) => { V.timers.delete(id); };

  function syncAnimations() {
    for (const a of document.getAnimations()) {
      let st = V.anims.get(a);
      if (st === undefined) { st = V.t - (a.currentTime || 0); V.anims.set(a, st); try { a.pause(); } catch (e) {} }
      try { a.currentTime = V.t - st; } catch (e) {}
    }
  }
  window.__VT = {
    start() { V.base = nPerf(); V.t = V.base; V.dateBase = nDate(); V.on = true; syncAnimations(); },
    now,
    advance(ms) {
      const target = V.t + ms;
      for (let guard = 0; guard < 10000; guard++) {
        let best = null, bestId = 0;
        for (const [id, tm] of V.timers) if (tm.due <= target && (!best || tm.due < best.due)) { best = tm; bestId = id; }
        if (!best) break;
        V.t = Math.max(V.t, best.due);
        if (best.every) best.due += best.every; else V.timers.delete(bestId);
        try { if (typeof best.cb === 'function') best.cb(...best.args); } catch (e) { console.error(e); }
      }
      V.t = target;
      const cbs = [...V.rafs.values()]; V.rafs.clear();
      for (const cb of cbs) { try { cb(V.t); } catch (e) { console.error(e); } }
      syncAnimations();
    }
  };
})();
