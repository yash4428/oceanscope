/* App shell: navigation, view switching, explore mode, boot */
(function (OS) {
'use strict';
const U = OS.U, { $, el } = U, S = OS.Scene, Store = OS.Store, UI = OS.UI;
const App = {};
const ORDER = ['slicer', 'truth', 'cyclone', 'sar', 'sonar', 'learn'];
let current = null, switching = false;

function buildNav() {
  const nav = $('nav');
  ORDER.forEach((id) => {
    const v = OS.Views[id];
    const b = el(`<button type="button" data-view="${id}" aria-current="false" aria-label="${v.title}"><svg viewBox="0 0 24 24" aria-hidden="true">${v.icon}</svg><span>${v.title}</span></button>`);
    b.addEventListener('click', () => App.go(id)); nav.appendChild(b);
  });
  nav.appendChild(el(`<div class="spacer"></div>`));
}
App.go = function (id) {
  if (id === current || !OS.Views[id] || !S.ready) return Promise.resolve();
  return new Promise((resolve) => {
  const inner = $('panel-inner');
  const prev = current; current = id;
  document.querySelectorAll('#nav button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === id)));
  if (prev) { OS.Views[prev].leave(); S.deselect(); }
  Store.set({ currentView: id });
  const mountNew = () => {
    inner.classList.remove('leaving'); inner.innerHTML = '';
    OS.Views[id].mount(inner); OS.Views[id].enter();
    if (OS.FX) { OS.FX.setWeather(id === 'slicer' && Store.get('weather') !== false); OS.FX.setDataMix(id === 'truth' ? 0.9 : (id === 'slicer' && Store.get('surfaceData')) ? 0.85 : 0); }
    UI.applyExplore(Store.get('exploreMode'));
    inner.classList.add('entering'); setTimeout(() => inner.classList.remove('entering'), 350);
    $('panel').scrollTop = 0; resolve();
  };
  if (prev && !U.reduceMotion) { inner.classList.add('leaving'); setTimeout(mountNew, 170); } else mountNew();
  });
};
App.setExplore = function (on) { $('explore').checked = on; Store.set({ exploreMode: on }); UI.applyExplore(on); };

/* top-bar context stat: links Cyclone Lab's day to the rest of the app */
function ctxStat() {
  const d = Store.get('day') || 1, e = $('ctx-stat');
  if (d >= 3.9) { e.hidden = false; e.innerHTML = `Amphan · <b>${OS.Views.cyclone.STAGE[Math.round(d) - 1]}</b> · quiet zone shifted ~${d < 4.9 ? '1.2' : '1.6'} km`; }
  else e.hidden = true;
}

function boot() {
  buildNav();
  $('explore').addEventListener('change', (e) => App.setExplore(e.target.checked));
  $('cine').addEventListener('change', (e) => { if (OS.FX) OS.FX.setCine(e.target.checked); });
  Store.on('day', ctxStat);
  S.init($('stage'), () => {
    OS.Copilot.init();
    if (OS.Film) OS.Film.init();
    $('p-sonar').addEventListener('click', () => { const i = S.selectedFloat(); if (i < 0) return; const f = S.floats[i]; Store.set({ sonarSite: { lon: f.lon, lat: f.lat, label: `Argo float ${f.id}` } }); App.go('sonar'); });
    App.go('slicer');
    const loading = $('loading'); loading.classList.add('out'); setTimeout(() => { loading.hidden = true; }, 600);
    S.establish(); S.showSheet('d26', !(OS.FX && OS.FX.on)); S.showSheet('bathy', true);
    setTimeout(() => S.animateKnife([75, 12, 1200], 1800), 900);
  });
}
OS.App = App;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.OS);
