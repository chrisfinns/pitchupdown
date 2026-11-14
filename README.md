# Pitch Up Down

Ear-training web app: two piano notes play, you say whether the second went **up** or **down**.

- **Levels:** half step (100¢) → quarter tone (50¢) → eighth tone (25¢) → 1/16 tone (12.5¢) → 1/32 tone (6.25¢)
- **Auto level:** 50 progress to move up (+1 per correct, −1 per miss, so guessing never levels you up; saved between sessions); 5 misses in a row drops back a level
- **Random start pitch** between A2 and E5, with occasional low notes down to C2. Half steps start on real piano keys; finer levels start anywhere between keys (note names show the cents offset)
- **Random velocity** per note (loudness + brightness), so volume can't give the answer away
- **Random timing** per trial: note lengths 0.5–1.4 s and a pause from near-legato (0.05 s) to a long silence (2.5 s); Replay keeps the same timing. Turn off with *Vary timing* for a fixed 1 s / 0.3 s
- Real piano: Salamander Grand Piano V3, 4 velocity layers, a sample every 3 semitones (C2–D♯5), ~2 MB
- Exact microtonal pitch: each sample's tuning was measured (`tools/build_samples.py`) and is corrected at playback; both notes of a pair come from the same sample key
- Falls back to a synthesized piano if samples can't load
- **Mistake log** (`L` or the Log button): every answer is saved in the browser; shows trouble notes (clearly below your usual accuracy at the same levels), accuracy per starting note, patterns (up vs down, register, louder vs softer 2nd note, short vs long pause, level) and recent answers; filter by level/period; export CSV

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
