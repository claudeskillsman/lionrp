export type QualityName = 'low' | 'medium' | 'high' | 'ultra';
export interface Quality {
  name: QualityName; pixelRatio: number; msaa: number; ao: false | 'half' | 'full'; bloom: boolean;
  shadowSize: number; cascades: number; shadowFar: number; grass: QualityName; furShells: number; lodBias: number; godrays: boolean; trees: number;
}
export const QUALITY: Record<QualityName, Quality> = {
  low: { name: 'low', pixelRatio: 0.8, msaa: 0, ao: false, bloom: false, shadowSize: 1024, cascades: 1, shadowFar: 60, grass: 'low', furShells: 6, lodBias: 0.6, godrays: false, trees: 0.5 },
  medium: { name: 'medium', pixelRatio: 1, msaa: 2, ao: 'half', bloom: true, shadowSize: 2048, cascades: 2, shadowFar: 140, grass: 'medium', furShells: 10, lodBias: 0.85, godrays: false, trees: 0.8 },
  high: { name: 'high', pixelRatio: 1.25, msaa: 4, ao: 'half', bloom: true, shadowSize: 2048, cascades: 3, shadowFar: 240, grass: 'high', furShells: 16, lodBias: 1, godrays: true, trees: 1 },
  ultra: { name: 'ultra', pixelRatio: 2, msaa: 4, ao: 'full', bloom: true, shadowSize: 4096, cascades: 4, shadowFar: 400, grass: 'ultra', furShells: 24, lodBias: 1.5, godrays: true, trees: 1 },
};
export interface Settings {
  quality: QualityName; masterVolume: number; musicVolume: number; ambienceVolume: number; sfxVolume: number;
  survival: boolean; invertY: boolean; mouseSens: number; keybinds: Record<string, string>; showNames: boolean;
}
export const DEFAULT_KEYS: Record<string, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', sprint: 'ShiftLeft', crouch: 'KeyC', jump: 'Space', walk: 'AltLeft',
  emote: 'KeyE', interact: 'KeyF', photo: 'KeyP', chat: 'Enter', journal: 'KeyJ', pride: 'KeyR', map: 'KeyM', hideUi: 'KeyH',
};
export function detectQuality(): QualityName {
  const mobile = /Android|iPhone|iPad|iPod|Mobile|CrOS/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
  if (mobile) return 'low';
  const mem = (navigator as any).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mem <= 4 || cores <= 4) return 'medium';
  return 'high';
}
const KEY = 'goldgrass.settings.v1';
export function loadSettings(): Settings {
  let s: Partial<Settings> = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* ignore */ }
  return {
    quality: s.quality ?? detectQuality(), masterVolume: s.masterVolume ?? 0.8, musicVolume: s.musicVolume ?? 0.5, ambienceVolume: s.ambienceVolume ?? 0.8,
    sfxVolume: s.sfxVolume ?? 0.8, survival: s.survival ?? true, invertY: s.invertY ?? false, mouseSens: s.mouseSens ?? 1, keybinds: { ...DEFAULT_KEYS, ...(s.keybinds || {}) }, showNames: s.showNames ?? true,
  };
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }
// Debug: ?qo=msaa:0,godrays:0 patches the active presets (for isolating render issues).
{
  const qo = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('qo') : null;
  if (qo) for (const kv of qo.split(',')) {
    const [k, v] = kv.split(':');
    const val = v === 'true' ? true : v === 'false' || v === '0' && (k === 'godrays' || k === 'bloom' || k === 'ao') ? false : isNaN(+v) ? v : +v;
    for (const p of Object.values(QUALITY)) (p as any)[k] = val;
  }
}
