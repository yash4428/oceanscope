# OceanScope product film

Renders the full OceanScope demo video straight from the live app, frame by frame, with an original score and narration.

## Render

```bash
cd video
npm install
node record.js
```

Output, written to the repository root (one folder up from `video/`):

- `OceanScope_Demo.mp4` – 1920×1080, 60 fps, narrated, with music.
- `OceanScope_Demo_music.mp4` – same picture, music only.
- `OceanScope_Demo_poster.jpg` – a still from the Cyclone Amphan shot, for thumbnails.

A full render takes about 10 minutes on an Apple M4 Pro. It needs Google Chrome, ffmpeg and macOS `say` for the narration.

## Options

| Flag | Default | What it does |
|---|---|---|
| `--voice NAME` | `Samantha` | Any voice from `say -v '?'`, for example `Rishi`, `Tara` or `Daniel`. |
| `--rate N` | `168` | Speaking rate in words per minute. |
| `--fps N` | `60` | Frame rate. `30` halves the render time. |
| `--test N` | off | Render only the first N seconds to `OceanScope_Demo_TEST.mp4`. |
| `--dry` | off | Play the whole show without capturing, print the timeline, save a snapshot every 15 s to `work/frames/`. |
| `--director FILE` | `director.js` | Which show to perform. `director_first_cut.js` reproduces the first cut. |

## How it works

- `vt.js` is injected before the app loads. It replaces timers, `requestAnimationFrame`, `performance.now` and every CSS animation with a virtual clock, so each video frame advances exactly 1/60 s however long it takes to draw. Nothing stutters or drops.
- `director.js` runs inside the page and performs the show: the cinematic Film mode opening, then seven chapters (Ocean Slicer, Truth Meter, Cyclone Lab, Search & Rescue, Sonar, Learn, Copilot) with an on-screen cursor that clicks the real controls, chapter cards, and a Film mode outro.
- `record.js` serves the app, generates the narration with macOS `say`, drives headless Chrome on the Metal GPU, pipes frames into ffmpeg, then mixes the audio.
- `music.js` synthesises the score in code: pad chords, sub bass, ocean wash, bells, a light arpeggio pulse during the product chapters, and whooshes, impacts and UI ticks placed from the director's event log. The music ducks under the narration.
- `script.json` holds the narration. The `say` field is the phonetic spelling the voice reads; `text` is the real spelling.

To change the story, edit `script.json` and `director.js`, run `node record.js --dry` to check timing, then render.
