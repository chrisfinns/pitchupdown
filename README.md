# Pitch Up Down

Ear-training web app: two piano notes play, you say whether the second went **up** or **down**.

- **Levels:** half step (100¢) → quarter tone (50¢) → eighth tone (25¢) → 1/16 tone (12.5¢) → 1/32 tone (6.25¢)
- **Auto level:** 5 correct in a row moves up, 3 misses in a row moves down
- **Random start pitch** anywhere between A2 and E5 (off the keyboard grid), with occasional low notes down to C2
- **Random velocity** per note (loudness + brightness), so volume can't give the answer away
- Real piano: Salamander Grand Piano V3, 4 velocity layers, a sample every 3 semitones (C2–D♯5), ~2 MB
- Exact microtonal pitch: each sample's tuning was measured (`tools/build_samples.py`) and is corrected at playback; both notes of a pair come from the same sample key
- Falls back to a synthesized piano if samples can't load
- **Mistake log** (`L` or the Log button): every answer is saved in the browser; shows trouble notes (clearly below your usual accuracy at the same levels), accuracy per starting note, patterns (up vs down, register, louder vs softer 2nd note, level) and recent answers; filter by level/period; export CSV

Keys: `Space` play/next · `↑` `↓` answer · `R` replay · `1`–`5` level · `L` log

## Credits

Piano samples: [Salamander Grand Piano V3](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm, licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Trimmed, shortened and re-encoded for this app (via the [@audio-samples](https://github.com/darosh/samples-piano-mp3) npm packages). Rebuild with `python3 tools/build_samples.py <download-dir>`.

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
