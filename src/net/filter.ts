/** Chat filter: masks profanity and slurs, and strips personal info (emails, phone numbers, addresses, links, handles). */
const WORDS = [
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'asshole', 'bastard', 'whore', 'slut', 'fag', 'faggot', 'nigger', 'nigga', 'retard',
  'kys', 'rape', 'rapist', 'porn', 'nude', 'nudes', 'sex', 'sexy', 'horny', 'penis', 'vagina', 'boobs', 'tits', 'dildo', 'cum', 'jizz', 'twat', 'wank', 'motherfucker', 'chink', 'spic', 'kike', 'tranny',
];
// letters people swap in to dodge filters
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b' };
function norm(w: string) { return w.toLowerCase().split('').map((c) => LEET[c] ?? c).join('').replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1'); }
const NORM_WORDS = WORDS.map((w) => w.replace(/(.)\1+/g, '$1'));
// words that are blocked even inside longer words (others must match whole)
const SUBSTR = ['fuck', 'shit', 'bitch', 'cunt', 'niger', 'niga', 'fagot', 'whore', 'slut', 'motherfucker', 'ashole', 'dildo', 'rapist'];

const PII: [RegExp, string][] = [
  [/[\w.+-]+\s*(@|\(at\)|\[at\])\s*[\w-]+\s*(\.|\(dot\)|\[dot\])\s*[a-z]{2,}/gi, '[email removed]'],
  [/(\+?\d[\s\-.()]*){7,}/g, '[number removed]'],
  [/\b(https?:\/\/|www\.)\S+/gi, '[link removed]'],
  [/\b[\w-]+\.(com|net|org|io|gg|tv|me|co|xyz|app|ly|uk|us|ca|de)\b(\/\S*)?/gi, '[link removed]'],
  [/\b\d{1,5}\s+\w+(\s\w+)?\s+(street|st|avenue|ave|road|rd|lane|ln|drive|dr|court|ct|boulevard|blvd|way)\b/gi, '[address removed]'],
  [/\b(snap(chat)?|insta(gram)?|discord|tiktok|whats\s?app|telegram|kik)\s*[:\-]?\s*@?[\w.#]{3,}/gi, '[handle removed]'],
  [/\b(my|i\s*live\s*(in|at|on)|i'?m\s*from)\s+(address|school)\b/gi, '[personal info removed]'],
];

export function filterChat(text: string): string {
  let t = text.replace(/[\u0000-\u001f​-‏‪-‮]/g, '').trim().slice(0, 160);
  for (const [re, rep] of PII) t = t.replace(re, rep);
  t = t.replace(/[^\s]+/g, (w) => {
    const n = norm(w);
    if (!n) return w;
    if (NORM_WORDS.includes(n) || SUBSTR.some((b) => n.includes(b))) return '✦'.repeat(Math.min(6, w.length));
    return w;
  });
  return t;
}
export function filterName(name: string) { const f = filterChat(name); return f.includes('✦') || f.includes('removed') ? 'Cat' : f.slice(0, 20); }
