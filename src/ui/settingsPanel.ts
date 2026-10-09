import { el } from './style';
import type { Game } from '../game/game';
import { QualityName, saveSettings, DEFAULT_KEYS } from '../engine/settings';

const KEY_LABELS: Record<string, string> = {
  forward: 'Forward', back: 'Back', left: 'Left', right: 'Right', sprint: 'Sprint', crouch: 'Crouch / stalk', jump: 'Jump / climb', walk: 'Walk',
  emote: 'Emote wheel', interact: 'Interact', photo: 'Photo mode', chat: 'Chat', journal: 'Journal', pride: 'Pride', map: 'Map', hideUi: 'Hide UI',
};
function keyName(code: string) { return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R'); }

/** Settings: graphics, audio, controls (with rebinding), gameplay. */
export function settingsPanel(game: Game, onChange?: () => void) {
  const s = game.settings;
  let tab = 'graphics';
  const body = el('div', { class: 'gg-scroll', style: { flex: '1', minHeight: '0', padding: '4px 22px 22px' } });
  const tabs = el('div', { class: 'gg-tabs', style: { padding: '0 16px 6px' } });
  const save = () => { saveSettings(s); onChange?.(); game.onSettings?.(); };
  const row = (label: string, ctl: HTMLElement, hint?: string) => el('div', { style: { margin: '16px 0' } },
    el('div', { class: 'gg-row', style: { justifyContent: 'space-between', marginBottom: '8px' } }, el('div', { class: 'gg-label' }, label), hint ? el('div', { style: { fontSize: '12px', color: 'var(--gg-cream-dim)' } }, hint) : null), ctl);
  const slider = (v: number, set: (n: number) => void, min = 0, max = 1, step = 0.01) => {
    const i = el('input', { type: 'range', class: 'gg-slider', min, max, step, value: v }) as HTMLInputElement;
    i.addEventListener('input', () => { set(parseFloat(i.value)); save(); });
    return i;
  };
  const toggle = (v: boolean, set: (b: boolean) => void, on = 'On', off = 'Off') => {
    const wrap = el('div', { class: 'gg-row' });
    const draw = (cur: boolean) => { wrap.innerHTML = ''; wrap.append(el('button', { class: 'gg-chip' + (cur ? ' on' : ''), onclick: () => { set(true); save(); draw(true); } }, on), el('button', { class: 'gg-chip' + (!cur ? ' on' : ''), onclick: () => { set(false); save(); draw(false); } }, off)); };
    draw(v); return wrap;
  };
  const render = () => {
    body.innerHTML = '';
    if (tab === 'graphics') {
      const q = el('div', { class: 'gg-row', style: { flexWrap: 'wrap' } });
      const draw = () => { q.innerHTML = ''; for (const n of ['low', 'medium', 'high', 'ultra'] as QualityName[]) q.append(el('button', { class: 'gg-chip' + (s.quality === n ? ' on' : ''), onclick: () => { s.quality = n; draw(); game.applyQuality(); save(); } }, n[0].toUpperCase() + n.slice(1))); };
      draw();
      body.append(row('Quality preset', q, `${Math.round(game.fps)} fps now`));
      body.append(el('div', { style: { fontSize: '13px', color: 'var(--gg-cream-dim)', lineHeight: '1.5' } }, 'Low keeps phones and Chromebooks smooth. Ultra adds full-resolution ambient occlusion, longer grass, thicker fur and sharper shadows.'));
      body.append(row('Name tags', toggle(s.showNames, (b) => (s.showNames = b), 'Show', 'Hide')));
    } else if (tab === 'audio') {
      body.append(row('Master', slider(s.masterVolume, (v) => { s.masterVolume = v; game.audio.setVolumes(s); })));
      body.append(row('Ambience', slider(s.ambienceVolume, (v) => { s.ambienceVolume = v; game.audio.setVolumes(s); })));
      body.append(row('Effects', slider(s.sfxVolume, (v) => { s.sfxVolume = v; game.audio.setVolumes(s); })));
      body.append(row('Music', slider(s.musicVolume, (v) => { s.musicVolume = v; game.audio.setVolumes(s); })));
    } else if (tab === 'controls') {
      body.append(row('Camera sensitivity', slider(s.mouseSens, (v) => (s.mouseSens = v), 0.3, 2.5)));
      body.append(row('Invert camera Y', toggle(s.invertY, (b) => (s.invertY = b))));
      const list = el('div', { class: 'gg-col', style: { gap: '6px', marginTop: '10px' } });
      for (const action of Object.keys(DEFAULT_KEYS)) {
        const b = el('button', { class: 'gg-chip', style: { minWidth: '90px' } }, keyName(s.keybinds[action] ?? DEFAULT_KEYS[action]));
        b.addEventListener('click', () => {
          b.textContent = 'Press a key…'; b.classList.add('on');
          const h = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); removeEventListener('keydown', h, true); if (e.code !== 'Escape') s.keybinds[action] = e.code; save(); render(); };
          addEventListener('keydown', h, true);
        });
        list.append(el('div', { class: 'gg-row', style: { justifyContent: 'space-between' } }, el('span', { style: { fontSize: '14px' } }, KEY_LABELS[action] ?? action), b));
      }
      body.append(el('div', { class: 'gg-label', style: { marginTop: '18px' } }, 'Keybinds'), list,
        el('button', { class: 'gg-btn small ghost', style: { marginTop: '12px' }, onclick: () => { s.keybinds = { ...DEFAULT_KEYS }; save(); render(); } }, 'Reset keys'),
        el('div', { style: { fontSize: '13px', color: 'var(--gg-cream-dim)', marginTop: '10px', lineHeight: '1.5' } }, 'Emotes also have number keys 1 to 9. Drag with the mouse (or click the game for pointer lock) to turn the camera.'));
    } else {
      body.append(row('Hunger and thirst', toggle(s.survival, (b) => (s.survival = b)), 'Hunt and drink to refill'));
    }
  };
  for (const [id, l] of [['graphics', 'Graphics'], ['audio', 'Audio'], ['controls', 'Controls'], ['gameplay', 'Gameplay']]) {
    tabs.append(el('button', { class: 'gg-tab' + (id === tab ? ' on' : ''), 'data-t': id, onclick: () => { tab = id; tabs.querySelectorAll('.gg-tab').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === id)); render(); } }, l));
  }
  render();
  return el('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
    el('div', { class: 'gg-title', style: { fontSize: '26px', padding: '20px 22px 10px' } }, 'Settings'), tabs, body);
}
