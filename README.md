# Goldgrass

A browser multiplayer big-cat roleplay game: lions, lionesses, cheetahs, leopards, snow leopards, tigers and jaguars in one open savanna with seven biomes.

This `main` branch is the source backup. The playable build lives on the `deploy` branch (a single self-contained `index.html`).

## Run locally

```
npm install
npm run dev            # dev server
SINGLE=1 npx vite build   # single-file build in dist-single/
```

## Stack

Vite + TypeScript, three.js, postprocessing, n8ao, supabase-js. All art and audio are procedural; there are no external assets.

## Online backend

Online mode uses a Supabase project. All tables and RPCs are prefixed `gg_`, RLS is on with no policies, and the client only calls security-definer RPCs with a session token. Realtime broadcast and presence carry movement and chat. The moderator view is at `?admin`.
