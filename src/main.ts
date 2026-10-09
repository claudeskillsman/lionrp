import { injectStyle } from './ui/style';
import { loadSettings } from './engine/settings';
import { loadWorld } from './world/loadWorld';

const params = new URLSearchParams(location.search);

async function boot() {
  const test = params.get('test');
  if (test === 'cat') { (await import('./test/cattest')).runCatTest(params); return; }
  if (test === 'world') { (await import('./test/worldtest')).runWorldTest(params); return; }
  if (params.has('admin')) { (await import('./ui/admin')).runAdmin(); return; }
  injectStyle();
  const loading = document.createElement('div');
  loading.className = 'gg-loading';
  loading.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#120c07;color:#f6ead2;font-family:Fraunces,Georgia,serif;z-index:20;transition:opacity .8s';
  loading.innerHTML = `<div style="font-size:clamp(44px,8vw,84px);letter-spacing:.04em;font-weight:500">Goldgrass</div>
    <div style="margin-top:22px;width:200px;height:2px;background:rgba(246,234,210,.15);border-radius:2px;overflow:hidden"><div id="gg-prog" style="height:100%;width:4%;background:#e7b766;transition:width .3s"></div></div>
    <div id="gg-ltext" style="margin-top:14px;font:500 11px Inter,system-ui,sans-serif;letter-spacing:.3em;text-transform:uppercase;color:rgba(246,234,210,.6)">Growing the grass</div>`;
  document.body.append(loading);
  const prog = loading.querySelector('#gg-prog') as HTMLElement;
  const text = loading.querySelector('#gg-ltext') as HTMLElement;
  const settings = loadSettings();
  if (params.get('q')) settings.quality = params.get('q') as typeof settings.quality;
  const [world, { Game }, { App }] = await Promise.all([
    loadWorld((f) => (prog.style.width = 4 + f * 66 + '%')),
    import('./game/game'),
    import('./ui/app'),
  ]);
  prog.style.width = '75%'; text.textContent = 'Waking the pride';
  await new Promise((r) => setTimeout(r, 30));
  const game = new Game(world, settings, document.body);
  (window as any).__game = game;
  const app = new App(game);
  (window as any).__app = app;
  if (params.has('keyart')) app.keyArt(params); else app.menu();
  // compile shaders before revealing so the first frames are smooth
  game.renderer.compile(game.gw.scene, game.camera);
  prog.style.width = '100%';
  game.start();
  const online = params.get('offline') ? null : import('./net/online').then((m) => app.setOnline(m.startOnline)).catch((e) => console.warn('online unavailable', e));
  void online;
  setTimeout(() => { loading.style.opacity = '0'; setTimeout(() => loading.remove(), 900); }, 250);
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
