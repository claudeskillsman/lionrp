import type { App } from '../ui/app';
import type { CatConfig } from '../cat/catConfig';
import { el } from '../ui/style';
import { api, ServerInfo, Friend } from './api';
import { Saves } from '../game/save';
import { saveSettings, loadSettings } from '../engine/settings';

let lobbyTab: 'servers' | 'friends' | 'account' = 'servers';

/** Online entry: make sure we have an account (guest by default), then the server browser. */
export async function startOnline(app: App, cfg: CatConfig) {
  const wait = el('div', { class: 'gg-select' }, el('div', { class: 'gg-title', style: { fontSize: '26px' } }, 'Finding the herd…'));
  app.show(wait);
  try {
    await api.ensure();
    await api.syncCharacters();
    // pull account settings in
    Object.assign(app.game.settings, { ...loadSettings(), quality: app.game.settings.quality });
  } catch (e) {
    app.menu(); app.toast('Could not reach the servers', (e as Error).message); return;
  }
  if (api.account?.banned) { app.menu(); app.toast('This account is banned', 'Contact the moderators'); return; }
  lobby(app, cfg);
}

export function lobby(app: App, cfg: CatConfig) {
  const body = el('div', { class: 'gg-scroll', style: { minHeight: '260px', maxHeight: '52vh' } });
  const tabs = el('div', { class: 'gg-tabs' });
  const acct = api.account!;
  const draw = () => {
    tabs.innerHTML = '';
    for (const [id, l] of [['servers', 'Servers'], ['friends', 'Friends'], ['account', acct.guest ? 'Guest account' : 'Account']] as const) tabs.append(el('button', { class: 'gg-tab' + (lobbyTab === id ? ' on' : ''), onclick: () => { lobbyTab = id; draw(); } }, l));
    body.innerHTML = '';
    if (lobbyTab === 'servers') serversTab(app, cfg, body);
    else if (lobbyTab === 'friends') friendsTab(app, cfg, body);
    else accountTab(app, cfg, body, draw);
  };
  draw();
  const s = el('div', { class: 'gg-select' },
    el('div', { class: 'gg-panel', style: { width: 'min(720px, calc(100% - 24px))', padding: '24px' } },
      el('div', { class: 'gg-row', style: { justifyContent: 'space-between', marginBottom: '6px' } },
        el('div', {}, el('div', { class: 'gg-title', style: { fontSize: '30px' } }, 'Play Online'),
          el('div', { style: { fontSize: '13px', color: 'var(--gg-cream-dim)', marginTop: '6px' } }, `as ${cfg.name} · ${acct.guest ? 'guest' : acct.username}`)),
        el('div', { class: 'gg-row' },
          el('button', { class: 'gg-btn small ghost', onclick: () => app.select((c) => lobby(app, c)) }, 'Change cat'),
          el('button', { class: 'gg-btn small ghost', onclick: () => app.menu() }, 'Back'))),
      tabs, body));
  app.show(s);
}

async function enter(app: App, cfg: CatConfig, how: { server?: string; code?: string; friend?: string }) {
  try {
    const name = cfg.name;
    await api.saveCharacter(cfg).catch(() => {});
    const r = how.friend ? await api.joinFriend(how.friend, name) : await api.join(how.server ?? null, how.code ?? null, name);
    const { OnlineMode } = await import('./onlineMode');
    const hud = app.enterPlay(cfg);
    const mode = new OnlineMode(app, hud, cfg, r);
    app.game.mode = mode;
    await mode.connect();
  } catch (e) {
    app.toast('Could not join', (e as Error).message);
  }
}

async function serversTab(app: App, cfg: CatConfig, body: HTMLElement) {
  body.append(el('div', { style: { padding: '20px 4px', color: 'var(--gg-cream-dim)' } }, 'Loading servers…'));
  let list: ServerInfo[] = [];
  try { list = await api.servers(); } catch (e) { body.innerHTML = ''; body.append(el('div', { style: { padding: '20px 4px' } }, 'Could not load servers: ' + (e as Error).message)); return; }
  body.innerHTML = '';
  const best = [...list].filter((s) => !s.private && s.players < s.max).sort((a, b) => b.players - a.players)[0];
  body.append(el('div', { class: 'gg-row', style: { margin: '14px 0', flexWrap: 'wrap' } },
    el('button', { class: 'gg-btn primary', onclick: () => best && enter(app, cfg, { server: best.id }) }, 'Quick join'),
    el('div', { style: { flex: '1' } }),
    (() => { const i = el('input', { class: 'gg-input', placeholder: 'Invite code', style: { width: '150px', textTransform: 'uppercase' } }) as HTMLInputElement; const b = el('button', { class: 'gg-btn small', onclick: () => i.value.trim() && enter(app, cfg, { code: i.value.trim() }) }, 'Join code'); return el('div', { class: 'gg-row' }, i, b); })()));
  for (const s of list) {
    body.append(el('div', { class: 'gg-card', style: { display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '8px' }, onclick: () => enter(app, cfg, { server: s.id }) },
      el('div', { style: { flex: '1' } },
        el('div', { style: { font: '600 16px var(--gg-ui)' } }, s.name, s.private ? el('span', { class: 'gg-chip', style: { marginLeft: '10px', padding: '3px 8px', fontSize: '11px' } }, 'Private') : null),
        s.code ? el('div', { style: { fontSize: '12px', color: 'var(--gg-gold)', marginTop: '4px', userSelect: 'all' } }, `Invite code ${s.code}`) : null),
      el('div', { style: { fontSize: '13px', color: 'var(--gg-cream-dim)' } }, `${s.players} / ${s.max}`),
      el('div', { style: { width: '60px', height: '4px', borderRadius: '3px', background: 'rgba(246,234,210,.14)' } }, el('div', { style: { width: (s.players / s.max) * 100 + '%', height: '100%', borderRadius: '3px', background: 'var(--gg-gold)' } }))));
  }
  const nm = el('input', { class: 'gg-input', placeholder: 'Private server name', maxlength: 32, style: { flex: '1' } }) as HTMLInputElement;
  body.append(el('div', { class: 'gg-label', style: { margin: '20px 0 8px' } }, 'Make a private, invite-only server'),
    el('div', { class: 'gg-row' }, nm, el('button', { class: 'gg-btn small', onclick: async () => {
      try { const s = await api.createServer(nm.value || `${cfg.name}'s den`, true); app.toast('Private server ready', `Invite code ${s.code}`); enter(app, cfg, { server: s.id }); } catch (e) { app.toast('Could not create', (e as Error).message); }
    } }, 'Create')));
}

async function friendsTab(app: App, cfg: CatConfig, body: HTMLElement) {
  const acct = api.account!;
  if (acct.guest) body.append(el('div', { style: { fontSize: '13px', color: 'var(--gg-cream-dim)', margin: '14px 0' } }, 'Friends find you by username, so make an account first (Guest account tab).'));
  const nm = el('input', { class: 'gg-input', placeholder: 'Friend’s username', style: { flex: '1' } }) as HTMLInputElement;
  body.append(el('div', { class: 'gg-row', style: { margin: '14px 0' } }, nm, el('button', { class: 'gg-btn small', onclick: async () => {
    try { await api.friendRequest(nm.value, null); app.toast('Friend request sent'); nm.value = ''; refresh(); } catch (e) { app.toast('Could not add', (e as Error).message); }
  } }, 'Add friend')));
  const list = el('div', { class: 'gg-col', style: { gap: '8px' } });
  body.append(list);
  const refresh = async () => {
    let fl: Friend[] = [];
    try { fl = await api.friends(); } catch { return; }
    list.innerHTML = '';
    if (!fl.length) list.append(el('div', { style: { color: 'var(--gg-cream-dim)', fontSize: '13px' } }, 'No friends yet.'));
    for (const f of fl) {
      const right = el('div', { class: 'gg-row' });
      if (f.status === 'incoming') right.append(el('button', { class: 'gg-btn small primary', onclick: async () => { await api.friendRespond(f.id, true); refresh(); } }, 'Accept'), el('button', { class: 'gg-btn small ghost', onclick: async () => { await api.friendRespond(f.id, false); refresh(); } }, 'Decline'));
      else if (f.status === 'sent') right.append(el('span', { style: { fontSize: '12px', color: 'var(--gg-cream-dim)' } }, 'Request sent'));
      else if (f.serverName) right.append(el('button', { class: 'gg-btn small', onclick: () => enter(app, cfg, { friend: f.id }) }, `Join · ${f.serverName}`));
      else right.append(el('span', { style: { fontSize: '12px', color: 'var(--gg-cream-dim)' } }, 'Offline'));
      list.append(el('div', { class: 'gg-row', style: { justifyContent: 'space-between', padding: '10px 4px', borderBottom: '1px solid var(--gg-line)' } },
        el('div', {}, el('div', { style: { fontWeight: '600' } }, f.username ?? f.name), f.char && f.serverName ? el('div', { style: { fontSize: '12px', color: 'var(--gg-cream-dim)' } }, `playing ${f.char}`) : null), right));
    }
  };
  refresh();
}

function accountTab(app: App, cfg: CatConfig, body: HTMLElement, redraw: () => void) {
  const acct = api.account!;
  const u = el('input', { class: 'gg-input', placeholder: 'Username', autocomplete: 'username', maxlength: 20 }) as HTMLInputElement;
  const p = el('input', { class: 'gg-input', placeholder: 'Password', type: 'password', autocomplete: acct.guest ? 'new-password' : 'current-password' }) as HTMLInputElement;
  const msg = el('div', { style: { fontSize: '13px', color: 'var(--gg-cream-dim)', minHeight: '18px', marginTop: '8px' } });
  const run = async (fn: () => Promise<unknown>, ok: string) => { msg.textContent = '…'; try { await fn(); msg.textContent = ok; app.game.settings = Object.assign(app.game.settings, loadSettings()); setTimeout(redraw, 700); } catch (e) { msg.textContent = (e as Error).message; } };
  if (acct.guest) {
    body.append(el('div', { style: { fontSize: '14px', lineHeight: '1.55', margin: '14px 0' } }, 'You are playing as a guest on this device. Make an account to keep your cats, pride and settings on any device, and to add friends.'),
      el('div', { class: 'gg-col' }, u, p,
        el('div', { class: 'gg-row' },
          el('button', { class: 'gg-btn primary small', onclick: () => run(() => api.register(u.value, p.value), 'Account created. Your cats are saved to it.') }, 'Create account'),
          el('button', { class: 'gg-btn small', onclick: () => run(() => api.login(u.value, p.value), 'Signed in.') }, 'Sign in instead'))), msg);
  } else {
    body.append(el('div', { style: { fontSize: '14px', margin: '14px 0' } }, `Signed in as ${acct.username}. Your cats, pride and settings are saved to this account.`),
      el('div', { class: 'gg-row' },
        el('button', { class: 'gg-btn small', onclick: async () => { saveSettings(app.game.settings); await api.saveSettings(app.game.settings).catch(() => {}); for (const c of Saves.characters()) await api.saveCharacter(c).catch(() => {}); app.toast('Saved to your account'); } }, 'Save everything now'),
        el('button', { class: 'gg-btn small ghost', onclick: async () => { await api.logout(); await api.ensure(); redraw(); } }, 'Sign out')),
      acct.admin ? el('a', { href: '?admin', target: '_blank', class: 'gg-btn small', style: { display: 'inline-block', marginTop: '14px', textDecoration: 'none' } }, 'Open moderation view') : '');
  }
  void cfg;
}
