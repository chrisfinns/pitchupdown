# Pitch Up Down

Ear-training web app: two piano notes play, you say whether the second went **up** or **down**.

- **Levels:** half step (100¢) → quarter tone (50¢) → eighth tone (25¢) → 1/16 tone (12.5¢) → 1/32 tone (6.25¢)
- **Auto level:** 5 correct in a row moves up, 3 misses in a row moves down
- **Random start pitch** anywhere between A2 and E5 (off the keyboard grid), with occasional low notes down to C2
- **Random velocity** per note (loudness + brightness), so volume can't give the answer away
- Synthesized piano (Web Audio) — no audio files, exact microtonal pitch

Keys: `Space` play/next · `↑` `↓` answer · `R` replay · `1`–`5` level

## Run locally

Any static server works:

```bash
python3 -m http.server 8000
```

## Deploy to Vercel

No build step. In Vercel: **Add New → Project → import this GitHub repo**, framework preset **Other**, leave build/output settings empty, **Deploy**.

Or with the CLI from the repo folder:

```bash
npx vercel --prod
```
