import { injectStyle, el } from './style';
import { api } from '../net/api';

/** Moderation view (?admin): reports, who is online, bans; kick and ban players. */
export async function runAdmin() {
  injectStyle();
  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'auto';
  const root = el('div', { style: { maxWidth: '1100px', margin: '0 auto', padding: '32px 18px 80px', fontFamily: 'var(--gg-ui)', color: 'var(--gg-cream)' } });
  document.body.append(root);
  const head = (sub: string) => el('div', { style: { marginBottom: '24px' } }, el('div', { class: 'gg-title', style: { fontSize: '40px' } }, 'Goldgrass moderation'), el('div', { style: { color: 'var(--gg-cream-dim)', marginTop: '8px' } }, sub));
  try { await api.ensure(); } catch (e) { root.append(head('Could not reach the server: ' + (e as Error).message)); return; }
  if (!api.account?.admin) {
    root.innerHTML = '';
    const u = el('input', { class: 'gg-input', placeholder: 'Admin username', autocomplete: 'username' }) as HTMLInputElement;
    const p = el('input', { class: 'gg-input', placeholder: 'Password', type: 'password', autocomplete: 'current-password' }) as HTMLInputElement;
    const msg = el('div', { style: { minHeight: '20px', color: 'var(--gg-cream-dim)' } });
    root.append(head('Sign in with a moderator account.'), el('div', { class: 'gg-panel gg-col', style: { padding: '22px', maxWidth: '380px' } }, u, p,
      el('button', { class: 'gg-btn primary', onclick: async () => { try { await api.login(u.value, p.value); if (!api.account?.admin) { msg.textContent = 'That account is not a moderator.'; return; } runAdmin(); root.remove(); } catch (e) { msg.textContent = (e as Error).message; } } }, 'Sign in'), msg));
    return;
  }
  const body = el('div');
  root.append(head(`Signed in as ${api.account.username}. Refreshes every 20 seconds.`), body);
  const btn = (label: string, fn: () => Promise<unknown>, primary = false) => el('button', { class: 'gg-btn small' + (primary ? ' primary' : ''), style: { padding: '6px 11px', fontSize: '12px' }, onclick: async () => { try { await fn(); load(); } catch (e) { alert((e as Error).message); } } }, label);
  const ban = (id: string, name: string) => async () => { const hours = prompt(`Ban ${name} for how many hours? (0 = permanent)`, '24'); if (hours === null) return; const reason = prompt('Reason', 'Breaking the rules') ?? ''; await api.adminBan(id, reason, parseInt(hours) || 0); };
  const section = (title: string, ...kids: (HTMLElement | string)[]) => el('div', { class: 'gg-panel', style: { padding: '18px 20px', marginBottom: '18px' } }, el('div', { class: 'gg-label', style: { marginBottom: '12px' } }, title), ...kids);
  const load = async () => {
    let d;
    try { d = await api.adminOverview(); } catch (e) { body.innerHTML = ''; body.append((e as Error).message); return; }
    body.innerHTML = '';
    const open = d.reports.filter((r: any) => r.status === 'open');
    body.append(section(`Reports (${open.length} open)`, ...(d.reports.length ? d.reports.map((r: any) => el('div', { style: { padding: '12px 0', borderBottom: '1px solid var(--gg-line)', opacity: r.status === 'open' ? '1' : '.5' } },
      el('div', { class: 'gg-row', style: { justifyContent: 'space-between', flexWrap: 'wrap' } },
        el('div', {}, el('b', {}, r.targetName ?? 'Unknown'), el('span', { style: { color: 'var(--gg-cream-dim)', fontSize: '12px', marginLeft: '10px' } }, `reported by ${r.reporter ?? '?'} · ${r.server ?? ''} · ${new Date(r.at).toLocaleString()} · ${r.status}`)),
        el('div', { class: 'gg-row', style: { gap: '6px' } }, btn('Kick', () => api.adminKick(r.target)), btn('Ban', ban(r.target, r.targetName)), r.status === 'open' ? btn('Resolve', () => api.adminResolve(r.id, 'resolved'), true) : btn('Reopen', () => api.adminResolve(r.id, 'open')))),
      el('div', { style: { marginTop: '6px', fontSize: '14px' } }, r.reason),
      ...(r.context ?? []).map((c: any) => el('div', { style: { fontSize: '12px', color: 'var(--gg-cream-dim)', marginLeft: '12px' } }, `“${c.text}”`)))) : ['No reports.'])));
    body.append(section(`Online now (${d.online.length})`, ...(d.online.length ? d.online.map((o: any) => el('div', { class: 'gg-row', style: { justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--gg-line)' } },
      el('div', {}, el('b', {}, o.char ?? '?'), el('span', { style: { color: 'var(--gg-cream-dim)', fontSize: '12px', marginLeft: '10px' } }, `${o.name} · ${o.server ?? ''}`)),
      el('div', { class: 'gg-row', style: { gap: '6px' } }, btn('Kick', () => api.adminKick(o.id)), btn('Ban', ban(o.id, o.char))))) : ['Nobody online.'])));
    body.append(section(`Active bans (${d.bans.length})`, ...(d.bans.length ? d.bans.map((b: any) => el('div', { class: 'gg-row', style: { justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--gg-line)' } },
      el('div', {}, el('b', {}, b.name), el('span', { style: { color: 'var(--gg-cream-dim)', fontSize: '12px', marginLeft: '10px' } }, `${b.reason ?? ''} · ${b.until ? 'until ' + new Date(b.until).toLocaleString() : 'permanent'}`)),
      btn('Unban', () => api.adminUnban(b.id)))) : ['No bans.'])));
  };
  load();
  setInterval(load, 20000);
}
