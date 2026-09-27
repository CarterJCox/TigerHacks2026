# Spotter

A lifting safety web app.

You record or upload a set, and Spotter checks every rep two ways. First against fixed form standards for the exercise, so bad form gets caught even on rep 1. Then against your own first reps, so you can see exactly when your form started slipping and by how much. Everything runs in the browser.

## What it does

- **Live stop signal.** Record in the browser and Spotter tracks you as you lift. If you cross into injury-risk territory, the app warns you in the moment.
- **Rep-by-rep breakdown.** After the set, you get your video with the skeleton overlay, a form gauge (green, yellow, red), and a strip of every rep so you can jump to the moment of interest.
- **Side-by-side comparison.** Put your best early rep next to any later rep and watch them in sync.
- **Real numbers.** Every piece of feedback comes with the measurement behind it.

Supported exercises: dumbbell bicep curl, dumbbell shoulder press, seated cable row, and squat.

## Running it locally

Use Node 20.12 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

### Claude-written reports (optional)

Spotter works fully without an API key and writes its reports from templates. If you add a key, Claude writes the summary instead, based only on the measurements:

```bash
cp .env.example .env
# add your ANTHROPIC_API_KEY, then restart the dev server
```

Claude never sees your video, just the numbers. Its responses are checked before they're shown, and anything that recommends a weight, names a diagnosis, or makes up a number gets thrown out in favor of the template.

## How it works

1. Your video is decoded in the browser. iPhone videos the browser can't play get converted on the fly with ffmpeg.wasm.
2. MediaPipe Pose finds your joints in each frame, and the results are smoothed so jitter doesn't turn into fake form problems.
3. Spotter checks the video is usable: right camera angle, whole body in frame, no cuts or zooming. If it isn't, it tells you what to fix.
4. Reps are found from your main joint angle as it moves up and down.
5. Each rep is measured (range of motion, joint angles, swing, tempo, left/right differences) and checked against both the form standards and your first reps.
6. Red means injury risk. Yellow means the rep is safe but less effective for building muscle. Green means you're good.

When Spotter isn't confident enough in what it sees, it skips the check instead of guessing.

## Project layout

```
api/               Vercel functions
server/            report service and a self-hosted Node server
src/config/        per-exercise thresholds and text
src/lib/video/     video loading and conversion
src/lib/pose/      pose detection
src/lib/analysis/  rep detection, measurements, scoring
src/lib/live/      live recording and the stop signal
src/lib/report/    report text and safety checks
src/components/    UI
tests/             test suites
```

---
