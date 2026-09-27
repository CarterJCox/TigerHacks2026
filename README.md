# Spotter

Spotter compares every rep in a set against your own first reps and shows where, and by how much, your form changed. It reports what happened in the set. It does not prescribe weights, reps or load changes.

Video analysis runs entirely in the browser. The video never leaves your machine. Only rounded measurements (no video, images or pose landmarks, and not the weight value) are sent to the optional report endpoint.

## Run it

Requires Node 20.12 or newer (developed on Node 24).

```bash
npm install
npm run dev
```

Open http://localhost:5173. `npm install` also copies the MediaPipe wasm runtime into `public/mediapipe/` (the pose model is already in `public/models/`).

### Claude-written reports (optional)

Without a key, reports are generated from templates and every feature works. To have Claude write the headline, summary and cues from the measurements:

```bash
cp .env.example .env
# then set ANTHROPIC_API_KEY=... in .env and restart the dev server
```

`SPOTTER_MODEL` overrides the model (default `claude-opus-5`). Every Claude response is checked before it is shown: it is rejected, and the template text is used instead, if it recommends a weight, load, rep or set change, names a diagnosis, or quotes a number that is not in the measurements.

### Production build

```bash
npm run build
npm start          # serves dist/ and the report endpoint on http://localhost:8787
```

### Tests

```bash
npm test
```

Covers rep detection, metrics, the breakdown point, quality gates (wrong angle, missing person, cuts, zoom), template wording, the LLM safety checks, the report endpoint against a mock Anthropic API, and the MP4/MOV rotation probe.

## Using it

- **Try a sample** on the first screen runs the full analysis on a bundled clip (`public/demo/seated-row.mp4`, a side-view seated row with a resistance band from Pexels). Sample runs are not saved to history. To use your own demo clip, replace the file and update `src/config/sample.js`.
- **Trim** appears after you upload. Drag the start and end handles to cut dead time; only the kept range is analyzed. Videos up to 10 minutes can be loaded; the analyzed range must be 3 minutes or less.
- **Results** fit on one screen. The tracked video is the main view; **Full set / Compare** switches between the whole set and your most typical baseline rep side by side with any other rep (both cropped to the joints being measured and started together). The rep strip under the video is the navigation: click a rep to jump to it, or in Compare to put it on the right. Speed (1×, 0.5×, 0.25×), Loop and Skeleton sit with the play controls. <kbd>Space</kbd> plays or pauses; <kbd>←</kbd>/<kbd>→</kbd> move between reps (ignored while typing).
- The **side panel** shows the rep in focus (the one you picked, else the breakdown rep, else the last scored rep): its score, the 2–3 measures that moved most against baseline, and a cue or risk factor only when that rep triggered one. Hover a measure to highlight the joints it tracks on the video.
- **Details** (next to the controls) opens a drawer with the written summary, the rep-by-rep table, the per-metric chart and how everything was measured.
- The header has **Copy report** (plain text) and **Download image** (PNG summary).
- The last exercise and the last weight used for each exercise are remembered in this browser.

## How it works

1. **Upload.** The file is opened with the browser's own decoder. If that fails or produces blank frames (commonly iPhone HEVC or ProRes in browsers without support), it is converted in the tab with ffmpeg.wasm. Rotation metadata is read from the MP4/MOV track header and applied if the browser didn't already. A Rotate button covers anything else.
2. **Pose.** Frames are sampled at 15 fps, downscaled to 640 px on the long side, and run through MediaPipe Pose Landmarker (full model, GPU with CPU fallback).
3. **Cleanup.** Landmarks below 0.5 visibility are dropped, gaps up to 0.4 s are interpolated, then a 5-frame median and a visibility-weighted Gaussian smooth remove spikes and jitter.
4. **Quality gates.** The video is rejected, with the measured numbers, if the person is missing from too many frames, key joints are hidden, the person is too small, the camera angle is wrong for the exercise, the clip cuts between shots, or the camera zooms or moves.
5. **Reps.** Detected from the main joint-angle signal using peak prominence, so pauses and small wobbles don't create reps. Pauses are excluded from tempo. Partial reps and reps cut off by the start or end of the clip are marked.
6. **Metrics and breakdown.** Each rep is measured (range of motion, joint angles, drift, swing, tempo, left/right gaps where visible) and compared with the range covered by the baseline reps (the first 2–3 clean reps). The breakdown point is the first rep where a change persists into the next rep, or a clearly failed final rep. One-off reps are reported separately.
7. **Scores.** Each rep's 0–100 score drops in proportion to how far each measure moved from the baseline average in the worse direction, relative to that measure's "major" threshold plus the range the baseline reps covered, so small real differences cost a few points. Rep colours (green/yellow/red) and the breakdown point use the stricter threshold levels, measured beyond the baseline range.
8. **Reps that aren't scored** are still counted and say why on the strip and in the panel: cut off by the start or end of the video, a tracking gap longer than 0.4 s, or unclear tracking. Short tracking gaps (up to 1.5 s) are bridged when finding reps, so a joint hidden for a moment at the top of a rep doesn't erase the rep.

## Tuning

All thresholds live in one commented config file per exercise:

- `src/config/exercises/curl.js`
- `src/config/exercises/press.js`
- `src/config/exercises/row.js`
- `src/config/exercises/squat.js`

`curl.js` has the fullest comments explaining each field.

## Project layout

```
server/            report endpoint (Claude + validation) and production server
src/config/        per-exercise thresholds, text, cues, risk factors
src/lib/video/     container probe, decode checks, ffmpeg.wasm fallback
src/lib/pose/      MediaPipe frame sampling
src/lib/analysis/  smoothing, quality gates, rep detection, metrics, scoring
src/lib/report/    template report, LLM payload, safety checks
src/components/    UI
tests/             vitest suites with synthetic pose tracks
```

History is stored in this browser's localStorage, per exercise.

Spotter measures movement from video. It is not medical advice and cannot diagnose injuries.
