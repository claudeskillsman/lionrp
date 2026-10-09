export type Species = 'lion' | 'lioness' | 'cheetah' | 'leopard' | 'snowleopard' | 'tiger' | 'jaguar';
export type LifeStage = 'cub' | 'adolescent' | 'adult' | 'elder';
export type Pattern = 'none' | 'spots' | 'stripes' | 'rosettes';
export type ManeStyle = 'none' | 'short' | 'full' | 'wild' | 'swept';

export interface CatConfig {
  id: string;
  name: string;
  species: Species;
  lifeStage: LifeStage;
  size: number;      // 0.85 .. 1.15
  build: number;     // 0 lean .. 1 heavy
  coat: string;
  under: string;     // belly / muzzle light colour
  pattern: Pattern;
  patternColor: string;
  patternScale: number; // 0.6 .. 1.6
  mane: ManeStyle;
  maneColor: string;
  maneLength: number; // 0..1
  eyeColor: string;
  scars: string[];
  markings: string[];
  accessories: string[];
  created: number;
}

export interface SpeciesDef {
  label: string;
  scale: number; legs: number; body: number; head: number; neck: number; tail: number; tailThick: number; chest: number; waist: number;
  ears: number; earPoint: number; muzzle: number; fur: number; tuft: boolean;
  coat: string; under: string; pattern: Pattern; patternColor: string; mane: ManeStyle; maneColor: string; eye: string;
  // palette suggestions shown in the creator
  coats: string[];
}

export const SPECIES: Record<Species, SpeciesDef> = {
  lion: { label: 'Lion', scale: 1.0, legs: 1.06, body: 0.92, head: 1.2, neck: 1.1, tail: 1.0, tailThick: 1.0, chest: 1.05, waist: 0.95, ears: 0.9, earPoint: 0.1, muzzle: 1.05, fur: 1.0, tuft: true,
    coat: '#c8964f', under: '#ead2a6', pattern: 'none', patternColor: '#7a5530', mane: 'full', maneColor: '#6b3c1c', eye: '#c88a2c',
    coats: ['#c8964f', '#d9ad6a', '#b07a3e', '#e3c38e', '#9a6a3a', '#efe2c6', '#a8865e'] },
  lioness: { label: 'Lioness', scale: 0.9, legs: 1.04, body: 0.92, head: 1.08, neck: 0.95, tail: 1.0, tailThick: 0.9, chest: 0.95, waist: 0.88, ears: 0.95, earPoint: 0.1, muzzle: 1.0, fur: 0.9, tuft: true,
    coat: '#cfa264', under: '#eedbb4', pattern: 'none', patternColor: '#8a6038', mane: 'none', maneColor: '#7a4a24', eye: '#c9952f',
    coats: ['#cfa264', '#ddb77a', '#b98848', '#e8cf9e', '#a87a48', '#f0e6d0', '#b29470'] },
  cheetah: { label: 'Cheetah', scale: 0.8, legs: 1.2, body: 0.95, head: 0.86, neck: 0.85, tail: 1.15, tailThick: 0.75, chest: 1.0, waist: 0.62, ears: 0.8, earPoint: 0.0, muzzle: 0.85, fur: 0.8, tuft: false,
    coat: '#d9b06a', under: '#f3e6cc', pattern: 'spots', patternColor: '#1e150e', mane: 'none', maneColor: '#c09050', eye: '#b8862a',
    coats: ['#d9b06a', '#e6c48a', '#c99a50', '#eed8a8', '#b88c4c', '#f2ead8'] },
  leopard: { label: 'Leopard', scale: 0.74, legs: 0.9, body: 1.0, head: 0.98, neck: 0.95, tail: 1.2, tailThick: 0.85, chest: 1.0, waist: 0.82, ears: 0.85, earPoint: 0.05, muzzle: 0.9, fur: 0.85, tuft: false,
    coat: '#d4a256', under: '#f2e3c4', pattern: 'rosettes', patternColor: '#24170c', mane: 'none', maneColor: '#a07040', eye: '#a8b040',
    coats: ['#d4a256', '#e2b56a', '#c08a40', '#2a1e14', '#ecd2a0', '#b48a5a'] },
  snowleopard: { label: 'Snow Leopard', scale: 0.7, legs: 0.9, body: 0.97, head: 0.95, neck: 0.95, tail: 1.35, tailThick: 1.7, chest: 1.05, waist: 0.9, ears: 0.72, earPoint: 0.0, muzzle: 0.85, fur: 1.9, tuft: false,
    coat: '#cfcac0', under: '#f4f2ec', pattern: 'rosettes', patternColor: '#3a3a3c', mane: 'none', maneColor: '#d8d4cc', eye: '#8aa8a0',
    coats: ['#cfcac0', '#e2ddd2', '#b8b0a2', '#d8cdb4', '#a8a8a8', '#efe9de'] },
  tiger: { label: 'Tiger', scale: 1.08, legs: 1.0, body: 0.98, head: 1.18, neck: 1.0, tail: 1.0, tailThick: 1.0, chest: 1.08, waist: 0.95, ears: 0.85, earPoint: 0.0, muzzle: 1.0, fur: 1.1, tuft: false,
    coat: '#d9782e', under: '#f6efe2', pattern: 'stripes', patternColor: '#17100c', mane: 'none', maneColor: '#e8dccb', eye: '#d9a02c',
    coats: ['#d9782e', '#e68a3a', '#c4692a', '#f0ece2', '#e0a868', '#c9a070'] },
  jaguar: { label: 'Jaguar', scale: 0.84, legs: 0.88, body: 0.95, head: 1.1, neck: 1.0, tail: 0.8, tailThick: 1.05, chest: 1.12, waist: 0.95, ears: 0.8, earPoint: 0.0, muzzle: 0.95, fur: 0.85, tuft: false,
    coat: '#cf9a48', under: '#f0dfbe', pattern: 'rosettes', patternColor: '#1e140c', mane: 'none', maneColor: '#a07040', eye: '#c8a830',
    coats: ['#cf9a48', '#dcae5e', '#b88238', '#1c1612', '#e8c890', '#a87a40'] },
};

export const LIFE_STAGES: Record<LifeStage, { label: string; scale: number; head: number; legs: number; paws: number; ears: number; energy: number; grey: number; fur: number }> = {
  cub: { label: 'Cub', scale: 0.42, head: 1.38, legs: 0.92, paws: 1.3, ears: 1.35, energy: 1.4, grey: 0, fur: 1.4 },
  adolescent: { label: 'Adolescent', scale: 0.72, head: 1.1, legs: 1.04, paws: 1.12, ears: 1.1, energy: 1.15, grey: 0, fur: 1.0 },
  adult: { label: 'Adult', scale: 1.0, head: 1.0, legs: 1.0, paws: 1.0, ears: 1.0, energy: 1.0, grey: 0, fur: 1.0 },
  elder: { label: 'Elder', scale: 0.98, head: 1.0, legs: 0.98, paws: 1.0, ears: 1.0, energy: 0.7, grey: 0.6, fur: 1.05 },
};

export const SCARS = [
  { id: 'eye', label: 'Eye scar' }, { id: 'muzzle', label: 'Muzzle scar' }, { id: 'shoulder', label: 'Shoulder claws' },
  { id: 'flank', label: 'Flank scar' }, { id: 'ear', label: 'Torn ear' },
];
export const MARKINGS = [
  { id: 'socks', label: 'White socks' }, { id: 'blaze', label: 'Face blaze' }, { id: 'tailtip', label: 'Dark tail tip' },
  { id: 'mask', label: 'Dark mask' }, { id: 'dapple', label: 'Faint dapples' }, { id: 'tearmarks', label: 'Tear marks' },
];
export const ACCESSORIES = [
  { id: 'flowers', label: 'Flower crown' }, { id: 'bones', label: 'Bone necklace' }, { id: 'feather', label: 'Ear feather' },
  { id: 'beads', label: 'Bead strand' },
];
export const EYE_COLORS = ['#c88a2c', '#d9b03a', '#a8b040', '#7fa850', '#8aa8a0', '#5d8fb8', '#b8682a', '#e0c070'];
export const MANE_COLORS = ['#6b3c1c', '#3a2214', '#8a5428', '#b07a40', '#1e1410', '#d6b47a', '#e8dccb', '#5a4a40'];

let counter = 0;
export function newId() { return Date.now().toString(36) + (counter++).toString(36) + Math.random().toString(36).slice(2, 7); }

export function defaultCat(species: Species = 'lion', name = ''): CatConfig {
  const d = SPECIES[species];
  return {
    id: newId(), name, species, lifeStage: 'adult', size: 1, build: species === 'lion' || species === 'tiger' || species === 'jaguar' ? 0.6 : 0.4,
    coat: d.coat, under: d.under, pattern: d.pattern, patternColor: d.patternColor, patternScale: 1, mane: d.mane, maneColor: d.maneColor, maneLength: 0.7,
    eyeColor: d.eye, scars: [], markings: species === 'cheetah' ? ['tearmarks'] : [], accessories: [], created: Date.now(),
  };
}

const NAME_A = ['Asha', 'Bako', 'Doru', 'Ember', 'Fahari', 'Ikoyo', 'Juno', 'Kesi', 'Lumo', 'Moyo', 'Nuru', 'Oba', 'Penda', 'Rafi', 'Sefu', 'Tamu', 'Umi', 'Vela', 'Wren', 'Zuri', 'Ochre', 'Sable', 'Rook', 'Thistle', 'Marrow', 'Saffron', 'Cinder', 'Dusk', 'Hollow', 'Tansy', 'Kito', 'Amara', 'Baruti', 'Imani', 'Jabari', 'Kali', 'Nia', 'Sana', 'Tau', 'Yara'];
export function randomName(rnd = Math.random) { return NAME_A[Math.floor(rnd() * NAME_A.length)]; }

export function randomCat(rnd = Math.random, species?: Species): CatConfig {
  const keys = Object.keys(SPECIES) as Species[];
  const sp = species ?? keys[Math.floor(rnd() * keys.length)];
  const d = SPECIES[sp];
  const c = defaultCat(sp, randomName(rnd));
  c.size = 0.9 + rnd() * 0.2; c.build = 0.25 + rnd() * 0.6;
  c.coat = d.coats[Math.floor(rnd() * Math.min(3, d.coats.length))];
  c.eyeColor = EYE_COLORS[Math.floor(rnd() * EYE_COLORS.length)];
  if (sp === 'lion') { c.maneColor = MANE_COLORS[Math.floor(rnd() * 5)]; c.mane = (['full', 'wild', 'swept', 'short'] as ManeStyle[])[Math.floor(rnd() * 4)]; c.maneLength = 0.4 + rnd() * 0.6; }
  if (rnd() < 0.2) c.scars.push(SCARS[Math.floor(rnd() * SCARS.length)].id);
  return c;
}
