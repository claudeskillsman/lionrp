import type { CatConfig, LifeStage } from '../cat/catConfig';

export interface AiCatSave { config: CatConfig; x: number; z: number; ageDays: number; role: string; bornDay?: number; }
export interface JournalEntry { day: number; hour: number; text: string; kind: 'goal' | 'pride' | 'world' | 'note'; }
export interface SoloSave {
  version: 1;
  charId: string;
  x: number; z: number; yaw: number;
  hour: number; day: number;
  hunger: number; thirst: number;
  prideName: string; prideColor: string; prideEmblem: string;
  pride: AiCatSave[];
  journal: JournalEntry[];
  goals: Record<string, number>; // progress / completion flags
  claimedDens: string[];
  drought: { active: boolean; startDay: number; survived: boolean };
  timeSpeed: number;
  lastCubDay: number;
  savedAt: number;
}

const K_CHARS = 'goldgrass.characters.v1';
const K_SEL = 'goldgrass.selected.v1';
const K_SOLO = 'goldgrass.solo.v1.';

function read<T>(k: string, def: T): T { try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as T) : def; } catch { return def; } }
function write(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } }

export const Saves = {
  characters(): CatConfig[] { return read<CatConfig[]>(K_CHARS, []); },
  saveCharacter(c: CatConfig) {
    const list = Saves.characters();
    const i = list.findIndex((x) => x.id === c.id);
    if (i >= 0) list[i] = c; else list.push(c);
    write(K_CHARS, list);
  },
  setCharacters(list: CatConfig[]) { write(K_CHARS, list); },
  deleteCharacter(id: string) { write(K_CHARS, Saves.characters().filter((c) => c.id !== id)); try { localStorage.removeItem(K_SOLO + id); } catch { /* */ } },
  selected(): string | null { return read<string | null>(K_SEL, null); },
  select(id: string) { write(K_SEL, id); },
  solo(id: string): SoloSave | null { return read<SoloSave | null>(K_SOLO + id, null); },
  saveSolo(s: SoloSave) { s.savedAt = Date.now(); write(K_SOLO + s.charId, s); },
};
export type { LifeStage };
