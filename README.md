# Spotter

Spotter checks every rep in a set two ways: against fixed form standards for the exercise (so bad form from rep 1 is still caught), and against your own first reps (to show where, and by how much, your form changed). It reports what happened in the set. It does not prescribe weights, reps or load changes.

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

`SPOTTER_MODEL` overrides the model (default `claude-sonnet-5`; `claude-haiku-4-5-20251001` is faster and cheaper). Every Claude response is checked before it is shown: it is rejected, and the template text is used instead, if it recommends a weight, load, rep or set change, names a diagnosis, says harm is certain, or quotes a number that is not in the measurements.

### Production build

```bash
npm run build
npm start          # serves dist/ and the report endpoint on http://localhost:8787
```

### Tests

```bash
npm test
```

Covers the live stop signal on synthetic pose streams (sustained patterns, single-frame spikes, cooldown, low confidence, wrong view, no sound for yellow), rep detection, metrics, every form standard (clean, red, yellow and low-confidence synthetic sets per exercise), the gauge mapping, the breakdown point, quality gates (wrong angle, missing person, cuts, zoom), template wording, the LLM safety checks, the report endpoint against a mock Anthropic API, and the MP4/MOV and WebM probes (with a real MediaRecorder recording as a fixture).

`tests/browser/recorded-webm.js` checks the full recording path in a real browser (vitest can't decode video): with `npm run dev` running, open the app and run `(await import('/tests/browser/recorded-webm.js')).run()` in the console. It re-records the sample through MediaRecorder and analyzes the WebM.

## Using it

- The **home screen** is one screen: pick the exercise, fill in weight, planned reps and the pain question in one row, then **Record** or **Upload video** (or drop a file on the drop zone). The line under it says how to film the chosen exercise.
- **Record** opens a full-screen camera. A faint outline shows where to stand and three checks turn green (whole body in frame, the right camera view, light and tracking). Hold still for 2 seconds and a 3-second countdown starts recording hands-free (or press Start now). While recording you see the time and a live rep count. Recording stops with the Stop button, Space, walking toward the camera, leaving the frame, or 4 seconds without rep movement, and the clip opens in the trim preview.
- **The live stop signal**: while recording, if a red (injury-risk) form limit is crossed and held for about a third of a second, the screen border pulses red, the body segment turns red, a large message names the issue, and a calm tone plus "Ease off. Set it down." plays (mute with Sound on/off; remembered). It never stops the recording. Each signal is marked on the results rep strip and in Details, and included in the exports.
- **Try a sample** in the header runs the full analysis on a bundled clip (`public/demo/seated-row.mp4`, a side-view seated row with a resistance band from Pexels). Sample runs are not saved to history. To use your own demo clip, put it in `public/demo/` and follow the steps at the top of `src/config/sample.js`.
- **Trim** appears after you upload. Drag the start and end handles to cut dead time; only the kept range is analyzed. Videos up to 10 minutes can be loaded; the analyzed range must be 3 minutes or less.
- **Results** fit on one screen. The tracked video is the main view; **Full set / Compare** switches between the whole set and your most typical first rep side by side with any other rep (both cropped to the joints being measured and started together). The rep strip under the video is the navigation: click a rep to jump to it, or in Compare to put it on the right. Speed (1×, 0.5×, 0.25×), Loop and Skeleton sit with the play controls. <kbd>Space</kbd> plays or pauses; <kbd>←</kbd>/<kbd>→</kbd> move between reps (ignored while typing).
- The **form gauge** at the top of the side panel reads green (good form), yellow (less effective for building muscle) or red (injury risk), with one line naming the main reason. It shows the whole set until you pick a rep on the strip (<kbd>Esc</kbd> or **Whole set** goes back). Rep colours on the strip match the gauge, and while a form issue is happening the offending skeleton segment is tinted.
- Below the gauge, the side panel shows the rep in focus (the one you picked, else the breakdown rep, else the last scored rep): the 2–3 measures that moved most against your first reps, and a cue. Hover a measure to highlight the joints it tracks on the video.
- **Details** (next to the controls) opens a drawer with the written summary, the form standards (each rule, its limits and every rep's value), the rep-by-rep table, the per-metric chart and how everything was measured.
- The header has **Copy report** (plain text) and **Download image** (PNG summary).
- The last exercise and the last weight used for each exercise are remembered in this browser.

## How it works

1. **Upload or record.** Recordings are made with MediaRecorder (WebM, or MP4 in Safari); their missing duration is resolved before loading. The file is opened with the browser's own decoder. If that fails or produces blank frames (commonly iPhone HEVC or ProRes in browsers without support), it is converted in the tab with ffmpeg.wasm. Rotation metadata is read from the MP4/MOV track header and applied if the browser didn't already. A Rotate button covers anything else.
2. **Pose.** Frames are sampled at 15 fps, downscaled to 640 px on the long side, and run through MediaPipe Pose Landmarker (full model, GPU with CPU fallback).
3. **Cleanup.** Landmarks below 0.5 visibility are dropped, gaps up to 0.4 s are interpolated, then a 5-frame median and a visibility-weighted Gaussian smooth remove spikes and jitter.
4. **Quality gates.** The video is rejected, with the measured numbers, if the person is missing from too many frames, key joints are hidden, the person is too small, the camera angle is wrong for the exercise, the clip cuts between shots, or the camera zooms or moves.
5. **Reps.** Detected from the main joint-angle signal using peak prominence, so pauses and small wobbles don't create reps. Pauses are excluded from tempo. Partial reps and reps cut off by the start or end of the clip are marked.
6. **Form standards.** Every scored rep, first reps included, is checked against fixed per-exercise limits (for example torso swing in a curl, depth in a squat). A value has to hold for 0.2 s to count, and a rule is skipped for a rep when its joints aren't clearly visible, so a false red flag is less likely than a missed one. Rules that 2-D pose can't measure reliably from the required view are left out and listed in the Details drawer.
7. **Metrics and breakdown.** Each rep is measured (range of motion, joint angles, drift, swing, tempo, left/right gaps where visible) and compared with the range covered by your first reps (the first 2–3 clean reps, not assumed to be good form). The breakdown point is the first rep where a change persists into the next rep, or a clearly failed final rep. One-off reps are reported separately.
8. **Severity and scores.** A rep's colour is its most serious flag: red for a red form limit (injury risk), yellow for a yellow limit or any change against your first reps (less effective), otherwise green. The gauge maps that severity plus how far past the limit the worst measure is onto 0–100 (see `gaugeValue` in `src/lib/analysis/standards.js`). Separately, each rep's 0–100 consistency score drops in proportion to how far each measure moved from your first reps' average in the worse direction.
9. **Reps that aren't scored** are still counted and say why on the strip and in the panel: cut off by the start or end of the video, a tracking gap longer than 0.4 s, or unclear tracking. Short tracking gaps (up to 1.5 s) are bridged when finding reps, so a joint hidden for a moment at the top of a rep doesn't erase the rep.

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
