const CSS = /* css */ `
:root{
  --gg-cream:#f6ead2; --gg-cream-dim:rgba(246,234,210,.72); --gg-gold:#e7b766; --gg-amber:#d9893a; --gg-ink:#1b130c;
  --gg-glass:rgba(24,16,10,.42); --gg-glass-strong:rgba(20,13,8,.72); --gg-line:rgba(246,234,210,.16);
  --gg-display: 'Fraunces', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
  --gg-ui: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
#gg-ui{position:fixed;inset:0;pointer-events:none;font-family:var(--gg-ui);color:var(--gg-cream);user-select:none;-webkit-user-select:none;z-index:10}
#gg-ui *{box-sizing:border-box}
#gg-ui .interactive, #gg-ui button, #gg-ui input, #gg-ui select, #gg-ui textarea{pointer-events:auto}
.gg-screen{position:absolute;inset:0;display:flex;opacity:0;transition:opacity .6s ease;pointer-events:none}
.gg-screen.show{opacity:1}
.gg-screen.show > *{pointer-events:auto}
.gg-title{font-family:var(--gg-display);font-weight:500;letter-spacing:.06em;line-height:1;text-shadow:0 2px 30px rgba(60,20,0,.45)}
.gg-btn{appearance:none;border:1px solid var(--gg-line);background:var(--gg-glass);color:var(--gg-cream);font:500 15px/1 var(--gg-ui);letter-spacing:.06em;
  padding:14px 22px;border-radius:999px;cursor:pointer;backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2);transition:background .2s, border-color .2s, transform .15s}
.gg-btn:hover{background:rgba(60,38,20,.55);border-color:rgba(231,183,102,.6)}
.gg-btn:active{transform:scale(.97)}
.gg-btn.primary{background:linear-gradient(180deg,#f0c77c,#d4924a);color:#24150a;border-color:transparent;font-weight:650;box-shadow:0 6px 30px rgba(217,137,58,.35)}
.gg-btn.primary:hover{filter:brightness(1.07)}
.gg-btn.small{padding:9px 14px;font-size:13px}
.gg-btn.ghost{background:transparent;backdrop-filter:none}
.gg-btn[disabled]{opacity:.4;pointer-events:none}
.gg-panel{background:var(--gg-glass-strong);border:1px solid var(--gg-line);border-radius:22px;backdrop-filter:blur(22px) saturate(1.25);-webkit-backdrop-filter:blur(22px) saturate(1.25);box-shadow:0 20px 60px rgba(0,0,0,.35)}
.gg-label{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--gg-cream-dim)}
.gg-row{display:flex;gap:10px;align-items:center}
.gg-col{display:flex;flex-direction:column;gap:10px}
.gg-chip{border:1px solid var(--gg-line);background:rgba(255,255,255,.04);color:var(--gg-cream);border-radius:999px;padding:8px 13px;font:500 13px var(--gg-ui);cursor:pointer;transition:all .15s}
.gg-chip:hover{border-color:rgba(231,183,102,.5)}
.gg-chip.on{background:rgba(231,183,102,.22);border-color:var(--gg-gold);color:#fff3dc}
.gg-swatch{width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,.18);cursor:pointer;transition:transform .15s, border-color .15s;flex:none}
.gg-swatch:hover{transform:scale(1.1)}
.gg-swatch.on{border-color:#fff;box-shadow:0 0 0 2px var(--gg-gold)}
.gg-slider{width:100%;accent-color:var(--gg-gold)}
.gg-input{background:rgba(255,255,255,.06);border:1px solid var(--gg-line);border-radius:12px;color:var(--gg-cream);font:500 16px var(--gg-ui);padding:12px 14px;outline:none;width:100%}
.gg-input:focus{border-color:var(--gg-gold)}
.gg-fade{transition:opacity 1.2s ease}
.gg-toast{position:absolute;left:50%;top:9%;transform:translateX(-50%);text-align:center;opacity:0;transition:opacity 1.2s ease, transform 1.2s ease;pointer-events:none}
.gg-toast.show{opacity:1}
.gg-toast .t1{font-family:var(--gg-display);font-size:clamp(26px,4vw,44px);letter-spacing:.08em}
.gg-toast .t2{margin-top:8px;font-size:12px;letter-spacing:.3em;text-transform:uppercase;color:var(--gg-cream-dim)}
.gg-scroll{overflow:auto;scrollbar-width:thin;scrollbar-color:rgba(246,234,210,.25) transparent}
.gg-kbd{display:inline-block;min-width:22px;padding:3px 7px;border-radius:6px;border:1px solid var(--gg-line);background:rgba(255,255,255,.06);font:600 11px var(--gg-ui);text-align:center;margin-right:6px}
.gg-tabs{display:flex;gap:4px;flex-wrap:wrap}
.gg-tab{background:transparent;border:none;color:var(--gg-cream-dim);font:600 12px var(--gg-ui);letter-spacing:.12em;text-transform:uppercase;padding:10px 12px;border-radius:10px;cursor:pointer}
.gg-tab.on{color:#fff3dc;background:rgba(231,183,102,.16)}
@media (max-width: 760px){ .gg-btn{padding:12px 18px;font-size:14px} }
`;
export function injectStyle() {
  if (document.getElementById('gg-style')) return;
  const s = document.createElement('style'); s.id = 'gg-style'; s.textContent = CSS; document.head.appendChild(s);
  // display font (falls back gracefully offline)
  const l = document.createElement('link'); l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap';
  document.head.appendChild(l);
}
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}
export const ICON = {
  paw: '<svg viewBox="0 0 24 24" fill="currentColor"><ellipse cx="12" cy="16" rx="5" ry="4.2"/><ellipse cx="6" cy="10" rx="2" ry="2.6"/><ellipse cx="18" cy="10" rx="2" ry="2.6"/><ellipse cx="9.3" cy="6.2" rx="2" ry="2.6"/><ellipse cx="14.7" cy="6.2" rx="2" ry="2.6"/></svg>',
  drop: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5C9 7 6 10.6 6 14.3A6 6 0 0 0 18 14.3C18 10.6 15 7 12 2.5z"/></svg>',
  meat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 3.5c3 0 5 2.3 5 5.2 0 4.8-6.4 9.8-10.6 9.8-1 0-1.8-.3-2.5-.8l-2.2 2.2a1.6 1.6 0 1 1-2.2-2.2l2.2-2.2c-.5-.7-.8-1.5-.8-2.5 0-4.2 5-9.5 11.1-9.5z"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.6"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1z"/><path d="M12 6v14"/></svg>',
  pride: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="9" r="3"/><circle cx="16.5" cy="10" r="2.5"/><path d="M3 19c.5-3.5 2.8-5 5-5s4.5 1.5 5 5M13 18.5c.4-2.6 2-3.8 3.5-3.8S20 16 20.5 18.5"/></svg>',
  smile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 14c1 1.4 2.2 2 3.5 2s2.5-.6 3.5-2"/><circle cx="9" cy="10" r=".8" fill="currentColor"/><circle cx="15" cy="10" r=".8" fill="currentColor"/></svg>',
  jump: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/></svg>',
  run: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h9M10 7l5 5-5 5M17 6v12"/></svg>',
  crouch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 16c4-1 6-5 10-5 3 0 5 2 6 5"/><path d="M4 19h16"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};
export function icon(name: keyof typeof ICON, size = 20) {
  const s = document.createElement('span');
  s.innerHTML = ICON[name];
  s.style.cssText = `display:inline-flex;width:${size}px;height:${size}px`;
  (s.firstChild as SVGElement).setAttribute('width', String(size)); (s.firstChild as SVGElement).setAttribute('height', String(size));
  return s;
}
