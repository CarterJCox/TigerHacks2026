# Spotter: Project Walkthrough

This guide follows the checked-in implementation, not just the README. It is intended as a first-pass map for developers and as technical briefing material for a demo or judge Q&A.

## 1. Big Picture

### What Spotter does

Spotter analyzes a video of one strength-training set. It finds repetitions, measures visible movement features, and compares later repetitions with the lifter's own early repetitions. The useful question is not "does this match an ideal form template?" but "where did this set change compared with how this person started?"

It supports side-view dumbbell curls, seated cable rows, and squats, plus front-view dumbbell shoulder presses. It is aimed at lifters who want a visual, rep-by-rep account of a set. It describes measured movement changes; it does not prescribe weight or rep changes, diagnose injuries, or replace a coach or clinician.

### Technology

Versions below are the semver ranges declared in [package.json](package.json), not a claim that these are exact installed versions. `package-lock.json` is intentionally excluded from this guide.

| Technology | Declared version | Why it is here |
| --- | --- | --- |
| Node.js | `>=20.12` | Runs Vite, the setup script, tests, and the small production HTTP server. |
| React / React DOM | `^19.3.0` | Component UI and browser-side state/rendering. |
| Vite | `^8.3.1` | Development server and static production build. |
| `@vitejs/plugin-react` | `^6.1.1` | JSX/React transform and Vite integration. |
| Vitest | `^5.0.2` | Unit and server-handler tests. |
| MediaPipe Tasks Vision | `^1.0.1` | On-device Pose Landmarker model/runtime, using GPU where available and CPU fallback otherwise. |
| `@ffmpeg/ffmpeg`, `@ffmpeg/core`, `@ffmpeg/util` | `^0.12.15`, `^0.12.10`, `^0.12.2` | Optional in-tab video conversion to H.264 when native browser decoding fails. |
| Anthropic SDK | `^0.128.0` | Server-side call to Claude for optional wording of report text. |
| Bricolage Grotesque Variable, Instrument Sans Variable, IBM Plex Mono | `^5.3.0` each | Display, body, and numeric typography. |

The core pose analysis runs in the browser. A video file, decoded frames, and pose landmarks are not sent to the report server. If an Anthropic key is configured, the browser can send a derived JSON payload containing rounded measurements and report metadata; it excludes the video and the entered weight. Local history does store the set's weight in that browser's `localStorage`.

### End-to-end data flow

```text
User selects exercise + set details + local video
        |
        v
SetupView -> probe MP4/MOV metadata -> browser decode check
        |                                  |
        | native decode works              | fails or blank frame
        |                                  v
        |                           ffmpeg.wasm -> H.264 Blob
        +--------------------------+-------+
                                   |
                                   v
                         preview / optional trim / rotate
                                   |
                                   v
App -> runAnalysis -> extractPose (15 fps, max side 640, MediaPipe)
                                   |
                                   v
          normalize coordinates -> smoothTrack -> exercise context
                                   |
                                   v
             quality gates -> rep signal -> reps and phases
                                   |
                                   v
       exercise metrics -> baseline deviations -> score/breakdown
                                   |
                    +--------------+------------------+
                    |                                 |
                    v                                 v
       template report immediately          rounded metrics payload
       (always available)                    -> optional /api/report
                    |                                 |
                    +---------------+-----------------+
                                    v
                  ResultsView: player, skeleton, comparison,
                  charts, table, risks/cues, exports
                                    |
                                    v
                  per-exercise summary in localStorage
```

## 2. Full Pipeline Walkthrough

1. **Intake and input validation.** [SetupView.jsx](src/components/SetupView.jsx) owns the exercise form, weight/unit, planned reps, pain toggle, notes, upload, trim, and manual rotation. A pain/injury keyword in the notes also sets the pain flag using `mentionsPain` from [safety.js](src/lib/report/safety.js). The notes themselves are not included in the report payload. Long files may be opened up to 10 minutes, but the analyzed range is limited to 180 seconds; the trim control also enforces a 2-second minimum.

2. **Probe and decode.** `prepareVideo` in [load.js](src/lib/video/load.js) checks the selected file, calls `probeContainer` in [probe.js](src/lib/video/probe.js), then tries the browser's `<video>` decoder. The probe reads MP4/MOV ISO-BMFF boxes to obtain the first video track's codec, coded dimensions, duration, and rotation matrix. A real frame is drawn to a small canvas because some browsers report metadata and play audio while yielding blank HEVC frames. If native playback fails or that frame looks blank, `transcodeToH264` in [transcode.js](src/lib/video/transcode.js) converts it in memory using ffmpeg.wasm. `frame.js` owns seeking, rotated dimensions, and consistent frame drawing. A manual Rotate control handles residual orientation problems.

3. **Pose inference.** `runAnalysis` in [pipeline.js](src/lib/pipeline.js) calls `extractPose` in [extract.js](src/lib/pose/extract.js). The extractor samples the trimmed range at 15 fps, scales the long image side to at most 640 pixels, seeks the video, and calls MediaPipe `detectForVideo` once per frame. It stores 33 landmarks per frame as normalized x/y, z, and visibility, plus times and a `hasPose` flag. The full model and WASM runtime are served locally from `public/models/` and `public/mediapipe/wasm/`. GPU creation is tried first; any GPU creation error falls back to CPU. An `AbortSignal` cancels the loop and the landmarker is closed in `finally`.

4. **Coordinate cleanup.** `smoothTrack` in [smooth.js](src/lib/analysis/smooth.js) converts normalized x/y into analysis-image pixels. It discards landmarks below the exercise visibility cutoff, linearly fills only short gaps, applies a five-frame median filter, then a visibility-weighted Gaussian smoother. A filled point is given weight 0.05, so interpolated estimates do not outweigh real observations. Longer gaps stay missing. Pixel coordinates keep x and y in the same scale for angle and distance calculations.

5. **Choose the measured side and orientation.** `buildContext` in [context.js](src/lib/analysis/context.js) selects the nearer side for side-view lifts using average landmark visibility, then average MediaPipe z as a tie-breaker (smaller z is assumed nearer). It estimates whether the person faces left or right from nose-vs-ear and toe-vs-heel offsets. Front-view press uses both sides. The result tells measure functions which landmarks to use and makes signed forward-lean angles consistent.

6. **Quality gates.** `assessQuality` in [quality.js](src/lib/analysis/quality.js) runs before rep scoring. It checks pose presence, simultaneous visibility of exercise-required joints, each required joint's visible fraction, torso size in frame, camera stability/cuts, and camera angle. Failure returns explanatory issues and measured quality stats rather than a potentially misleading score. A rep can separately be marked low-confidence if its required landmarks are not jointly clear in enough of its frames.

7. **Exercise signal and rep detection.** The selected module in `src/lib/analysis/measure/` builds one main 1-D signal. Curl, row, and squat use flexion (`180 degrees - elbow/knee angle`); press uses average wrist height above the shoulders as a percentage of torso length. `detectReps` in [reps.js](src/lib/analysis/reps.js) smooths that signal slightly, locates peaks by prominence, finds valleys, and determines rep boundaries. It reports partial/truncated flags and top/bottom phase times.

8. **Per-rep measurements and scoring.** `analyzeTrack` in [analyze.js](src/lib/analysis/analyze.js) dispatches to the exercise's `repMetrics`, then adds lift/lower/hold timing, tracking confidence, and scorable state. `scoreSet` in [scoring.js](src/lib/analysis/scoring.js) selects baseline reps, calculates baseline stats and per-metric deviations, assigns rep scores/status, identifies breakdown or isolated changes, then derives configured risk factors and at most two cues.

9. **Report generation and display.** `buildTemplateReport` in [template.js](src/lib/report/template.js) immediately produces a deterministic report. The app saves summary history for non-sample runs, asks `/api/health` whether Claude is configured, shows results, and then optionally requests a replacement report through `fetchLlmReport` in [client.js](src/lib/report/client.js). The endpoint lives in [report.js](server/report.js). Both browser and server validate the response with [safety.js](src/lib/report/safety.js); invalid or unavailable LLM output leaves the template in place. [ResultsView.jsx](src/components/ResultsView.jsx) presents playback, rep detail, baseline comparison, charts, table, risks, cues, method notes, and exports.

## 3. File-by-File Breakdown

### Root, setup, and static assets

| File | Role, key behavior, imports, and consumers |
| --- | --- |
| [index.html](index.html) | Vite HTML shell: `#root`, page metadata, icon, and module entry to `src/main.jsx`. It imports no app module itself beyond that entry script. |
| [package.json](package.json) | Package metadata, dependencies, and scripts: `dev`, `build`, `preview`, `start`, `test`, and `postinstall`. `postinstall` runs the asset setup script. |
| [vite.config.js](vite.config.js) | Configures React, Vite build target ES2022, worker format, and an `/api` middleware mounted for dev and preview. Loads server-side env without exposing non-`VITE_` variables to browser code. Excludes ffmpeg worker packages from dependency prebundling. Imports `server/report.js`. |
| [.env.example](.env.example) | Documents optional `ANTHROPIC_API_KEY`, `SPOTTER_MODEL`, and production `PORT`; it contains placeholders, not real secrets. Read by deployment/server setup, not browser code. |
| [.gitignore](.gitignore) | Excludes `node_modules`, `dist`, `.env`, local samples, public copied MediaPipe runtime, and logs. It has no runtime imports. |
| [.claude/launch.json](.claude/launch.json) | Editor launch configuration for running Vite on strict port 5173. Tooling only. |
| [README.md](README.md) | User-facing setup, feature, privacy, tuning, and test overview. Documentation; not imported by the application. |
| [scripts/setup-assets.mjs](scripts/setup-assets.mjs) | Post-install copies MediaPipe WASM from `node_modules` into `public/mediapipe/wasm/` and downloads the full pose task model if absent. This makes inference assets available without a runtime CDN request. |
| [samples/helpers.js](samples/helpers.js) | Gitignored manual browser-testing helper. `run()` fills the UI, uploads a local sample URL through `File`/`DataTransfer`, and starts analysis; `wait()` returns result/rejection text. It is not imported by production code. The rest of `samples/` is video/image investigation material and is excluded as binary assets. |
| [public/favicon.svg](public/favicon.svg) | Static Spotter mark displayed by the browser tab. Not imported by app code. |
| `public/demo/seated-row.mp4` | Bundled binary sample video fetched by the sample flow; the exercise/input metadata is in `src/config/sample.js`. |
| `public/models/pose_landmarker_full.task` | Binary MediaPipe model loaded by `extract.js`. |
| `public/mediapipe/wasm/*` | Generated MediaPipe runtime: three JS wrappers and corresponding WASM binaries (SIMD, module, and no-SIMD variants). They are packaged runtime dependencies copied by `setup-assets.mjs`, not Spotter's analysis logic. |

### Application entry and global UI

| File | Role, imports, and consumers |
| --- | --- |
| [src/main.jsx](src/main.jsx) | Browser entry: imports React root, font CSS, global `styles.css`, and `App`; mounts `<App />` inside `StrictMode`. |
| [src/App.jsx](src/App.jsx) | Main state machine (`setup`, `analyzing`, `rejected`, `results`, `history`). Calls `runAnalysis`, template/payload/report client, and history/prefs helpers; passes state and callbacks to all screen components. Handles cancellation, object URL release, retry-as-another-exercise, sample exclusion from history, and dev-only `window.__spotter` / `__spotterShow` hooks. |
| [src/styles.css](src/styles.css) | Global visual system: CSS variables, typography, responsive layouts, state colors, player/chart/table styling, focus styles, reduced-motion support, and screen transitions. Imported only by `main.jsx`; no JS exports. |

### Exercise configuration

| File | Role, imports, and consumers |
| --- | --- |
| [src/config/exercises/index.js](src/config/exercises/index.js) | Imports the four exercise objects, exports `EXERCISES`, display order, and `getExercise(id)` (throws for unknown ids). Used across forms, pipeline, analysis, and results. |
| [src/config/exercises/curl.js](src/config/exercises/curl.js) | Side-view dumbbell curl instructions, required pose thresholds, rep detection values, baseline/scoring policy, five metric definitions, risk text, cues, limitations, and overlay series. Imported by the exercise index. |
| [src/config/exercises/press.js](src/config/exercises/press.js) | Front-view dumbbell shoulder press configuration, including both-arm asymmetry metrics, leg drive proxy, risks/cues/limitations, and overlay series. Imported by the exercise index. |
| [src/config/exercises/row.js](src/config/exercises/row.js) | Side-view seated cable row configuration, including torso motion, lean-back, shrug, tempo, risks/cues/limitations, and overlay series. Imported by the exercise index. |
| [src/config/exercises/squat.js](src/config/exercises/squat.js) | Side-view squat configuration, including knee-flexion depth, torso lean, hips-first proxy, heel-lift proxy, tempo, risks/cues/limitations, and overlay series. Imported by the exercise index. |
| [src/config/sample.js](src/config/sample.js) | Defines sample URL/title and fake set metadata for the bundled row video. Used by `SetupView`; sample runs are not saved to user history. |

### `src/lib/video/` and `src/lib/pose/`

| File | Role, key functions, imports, and consumers |
| --- | --- |
| [src/lib/video/load.js](src/lib/video/load.js) | `prepareVideo(file)` probes metadata, opens/checks a native `<video>`, optionally transcodes, enforces 600-second max, and returns video URL, rotation, duration, probe, and transcode flag. Imports `probe.js` and `frame.js`; called by `SetupView`. |
| [src/lib/video/probe.js](src/lib/video/probe.js) | Minimal MP4/MOV box parser. `probeContainer()` returns codec/dimensions/rotation/duration or `null`; `describeCodec()` makes codec names readable. Imported by `load.js`; tested by `probe.test.js`. It reads `moov`, not media samples. |
| [src/lib/video/transcode.js](src/lib/video/transcode.js) | Lazy-loads ffmpeg.wasm and exports `transcodeToH264(file, progress)`. Produces in-memory, no-audio H.264 MP4 scaled to 720 pixels/30 fps max; rejects files over 700 MiB. Imported lazily by `load.js`, not eagerly loaded for every user. |
| [src/lib/video/frame.js](src/lib/video/frame.js) | `rotatedSize`, `drawVideoFrame`, and `seekVideo` centralize canvas rotation/drawing and guarded seeking. Used by decode checks, pose extraction, trim previews, and playback/overlays. |
| [src/lib/pose/landmarks.js](src/lib/pose/landmarks.js) | MediaPipe's 33-point index map, `sided()`, skeleton connections, and body-point list. Imported by pose cleanup, geometry/context/measurements, and rendering. |
| [src/lib/pose/extract.js](src/lib/pose/extract.js) | `extractPose()` performs frame sampling and MediaPipe inference; caches the WASM fileset, tries GPU then CPU, reports progress, and throws `AnalysisCancelled` on abort. Imports MediaPipe and shared video/landmark helpers; called by `pipeline.js`. |

### `src/lib/analysis/`

| File | Role, key functions, imports, and consumers |
| --- | --- |
| [src/lib/pipeline.js](src/lib/pipeline.js) | `runAnalysis()` is the async handoff: pose extraction, progress stages, then `analyzeTrack()`. Adds selected delegate and dev-only raw `_track`; imported by `App.jsx`. |
| [src/lib/analysis/analyze.js](src/lib/analysis/analyze.js) | `analyzeTrack()` is the analysis orchestrator. Smooths, builds context, assesses quality, creates signal, detects reps, measures/filters reps, and calls `scoreSet`. Returns either structured rejection or full successful analysis. Also tests same-view alternative exercises when no reps match. Imports exercise registry, measure registry, and the analysis helpers; called by pipeline and tests. |
| [src/lib/analysis/smooth.js](src/lib/analysis/smooth.js) | `smoothTrack()` handles visibility, short gap interpolation, median and Gaussian cleanup; `pointAt()` safely reads a trusted point; `smoothSeries()` smooths a NaN-aware scalar. Imported by analyzer, rep detector, and measure modules. |
| [src/lib/analysis/context.js](src/lib/analysis/context.js) | `chooseSide()`, `chooseFacing()`, `buildContext()` infer near side and image direction for side-view exercises. Imports landmark indices and median; called by analyzer. |
| [src/lib/analysis/geometry.js](src/lib/analysis/geometry.js) | Reusable 2-D joint angles, lean/orientation angles, distances, ranges, nearest valid values, percentiles, median, mean, and sample standard deviation. Imported throughout measurement, quality, rep detection, and scoring. |
| [src/lib/analysis/quality.js](src/lib/analysis/quality.js) | `assessQuality()` implements video-level gates and returns issue list/stats; `repConfidence()` and `worstLandmarkInRep()` support per-rep scoring/explanations. Imports landmarks, geometry, and messages; called by analyzer. |
| [src/lib/analysis/messages.js](src/lib/analysis/messages.js) | Formatting and explanation helpers for time/pct/joint names, missing-joint reason, contiguous problem intervals, and filming fixes. Used by quality and analyzer. |
| [src/lib/analysis/reps.js](src/lib/analysis/reps.js) | `detectReps()` finds peaks/prominence, valleys, boundaries, partials and truncations; `phaseTimes()` returns first phase, second phase and top hold, assigned to lift/lower according to exercise. Imports smoothing and statistics; called by analyzer. |
| [src/lib/analysis/scoring.js](src/lib/analysis/scoring.js) | `selectBaseline`, `baselineStats`, `deviation`, `scoreSet`, breakdown/risk/cue helpers. Mutates each rep with baseline/deviation/score/status; analyzer consumes returned set summary. Imports mean/stdev. |
| [src/lib/analysis/measure/index.js](src/lib/analysis/measure/index.js) | Imports and exports the per-exercise measurement implementations as `MEASURES`; analyzer selects one by exercise id. |
| [src/lib/analysis/measure/common.js](src/lib/analysis/measure/common.js) | Shared side/front landmark lookup, median torso length, NaN series creation, and required landmark lists. Imported by exercise measure modules. |
| [src/lib/analysis/measure/curl.js](src/lib/analysis/measure/curl.js) | Required side landmarks; builds elbow-angle/flexion, upper-arm-relative-to-torso and torso-lean series; per rep returns elbow ROM, elbow drift and torso swing. Imported by measure index. |
| [src/lib/analysis/measure/row.js](src/lib/analysis/measure/row.js) | Builds elbow flexion, torso lean and ear/shoulder gap; per rep returns ROM, torso swing, lean-back and shrug proxy. Imported by measure index. |
| [src/lib/analysis/measure/press.js](src/lib/analysis/measure/press.js) | Uses both arms; builds average wrist-height signal, elbow angles, lateral torso lean and hip height; rep metrics include range, left/right height and elbow gaps, lean and hip-motion/leg-drive proxy. Imported by measure index. |
| [src/lib/analysis/measure/squat.js](src/lib/analysis/measure/squat.js) | Builds knee-flexion, torso-lean and heel-relative-to-foot series; returns knee ROM/depth, forward lean, hips-rise-first proxy and heel lift. Imported by measure index. |

### `src/lib/report/`, persistence, and preferences

| File | Role, key functions, imports, and consumers |
| --- | --- |
| [src/lib/report/format.js](src/lib/report/format.js) | Common rounding, unit/range/delta formatting, rep-list joining, and config phrase filling. Imported by template, export, components, payload consumers, and analysis messages. |
| [src/lib/report/template.js](src/lib/report/template.js) | `buildHeadline`, `buildSummary`, and `buildTemplateReport` create local deterministic narrative from analysis; `painNotice()` supplies the pain-specific warning. Used by App and results. |
| [src/lib/report/payload.js](src/lib/report/payload.js) | `buildPayload()` constructs optional server JSON: rounded metric/deviation values plus counts, statuses, reliability labels, candidate cues, and breakdown/risk metadata. Does not include weight, video, images, landmarks, or free-text notes. Used by App before the report request. |
| [src/lib/report/safety.js](src/lib/report/safety.js) | `mentionsPain()` keyword check; prescription/diagnosis matchers; numeric allow-list; and `validateLlmReport()` shape/length/content checks. Shared by setup, browser client and server endpoint. Pattern checks reduce risk but cannot semantically guarantee safe language. |
| [src/lib/report/client.js](src/lib/report/client.js) | `fetchReportStatus()` caches `/api/health`; `fetchLlmReport()` POSTs the payload with abort/75-second timeout and returns validated report or `null`. Imported by App. |
| [src/lib/report/export.js](src/lib/report/export.js) | Builds plain-text report and key findings/numbers; `copyText()` has clipboard fallback; `renderSummaryImage()` draws PNG with canvas; `downloadBlob()` saves it; `reportFileName()` builds date-stamped name. Used by ExportBar. |
| [src/lib/history.js](src/lib/history.js) | Browser-local per-exercise history. Reads/writes guarded `localStorage`; stores at most 200 set summaries per exercise; supports deletion/clear/unit conversion. `sessionFromAnalysis()` intentionally persists summary numbers/headline, not video or pose track. Used by App and HistoryView. |
| [src/lib/prefs.js](src/lib/prefs.js) | Remembers last exercise and per-exercise weight/unit/bodyweight in browser `localStorage`; exports `weightFor`, `rememberInput`, and `initialInput`. Used by App and SetupView. |

### `src/components/`

| File | Role, imports, and consumers |
| --- | --- |
| [src/components/SetupView.jsx](src/components/SetupView.jsx) | Form, file drop/select, sample load, video preview/rotation, trim, and validation. Imports exercise/sample/preferences, `prepareVideo`, trim control, and pain matcher. Rendered by App. |
| [src/components/CameraGuide.jsx](src/components/CameraGuide.jsx) | Camera placement instructions and a top-down SVG diagram based on exercise view/distance. Uses exercise config only. Used by SetupView and RejectedView. |
| [src/components/TrimControl.jsx](src/components/TrimControl.jsx) | Filmstrip and accessible start/end sliders; serializes shared video seeks to prevent preview conflicts; exposes 180-second max and 2-second minimum. Imports frame helpers/status clock; used by SetupView. |
| [src/components/AnalyzingView.jsx](src/components/AnalyzingView.jsx) | Progress stages, frame count, ETA and cancel action. Uses exercise labels; rendered by App. |
| [src/components/RejectedView.jsx](src/components/RejectedView.jsx) | Renders measured quality issues, fixes, facts, camera guide, retry and suggested alternative-exercise action. Uses exercise config and CameraGuide; rendered by App. |
| [src/components/ResultsView.jsx](src/components/ResultsView.jsx) | Main results composition and local `RepDetail`/`RiskList` subcomponents; owns selected rep, shared player settings and highlighted metric. Composes VideoPlayer, charts, table, compare, exports and report formatters. Rendered by App. |
| [src/components/VideoPlayer.jsx](src/components/VideoPlayer.jsx) | Main canvas/video player, keyboard shortcuts, rep-window replay/loop, synchronized timeline and skeleton. Exposes `playRep`, `seek`, `togglePlay` by ref. Imports Timeline, PlaybackControls, frame and overlay helpers; used by ResultsView. |
| [src/components/overlay.js](src/components/overlay.js) | Draws smoothed skeleton and selected-joint highlights on canvas; maps metric `body` config to landmarks and video time to analysis frame. Used by VideoPlayer and CompareView. |
| [src/components/highlight.js](src/components/highlight.js) | React context and `useMetricHover()` connect metric hover/focus to skeleton highlight state. Used by ResultsView, charts, table, risks, compare. |
| [src/components/status.js](src/components/status.js) | Human labels/colors for statuses, `repAt()` time lookup, and `fmtClock()`. Used by player, timeline, charts, compare, table, and trim. |
| [src/components/PlaybackControls.jsx](src/components/PlaybackControls.jsx) | Shared 1x/0.5x/0.25x, loop, skeleton controls. Used by main player and compare view. |
| [src/components/Timeline.jsx](src/components/Timeline.jsx) | Timeline with rep buttons, status/selection, baseline band, breakdown marker, playhead and seeking. Used by VideoPlayer. |
| [src/components/RepChart.jsx](src/components/RepChart.jsx) | Responsive SVG score bars or a selected metric line against baseline mean/range and notable allowance; supports keyboard/pointer rep selection. Uses width, status, hover and format helpers; used by ResultsView. |
| [src/components/RepTable.jsx](src/components/RepTable.jsx) | Baseline mean/range row plus per-rep status, score, metrics and deltas; clicking selects playback and metric cells highlight joints. Used by ResultsView. |
| [src/components/CompareView.jsx](src/components/CompareView.jsx) | `typicalBaselineRep()` picks the baseline rep nearest its baseline means; `comparisonPair()` pairs it with breakdown or last scored rep. Two video/canvas panes play in sync with shared controls. Used by ResultsView. |
| [src/components/ExportBar.jsx](src/components/ExportBar.jsx) | Copy-text and download-PNG actions/status. Imports `export.js`; used by ResultsView. |
| [src/components/EmptyState.jsx](src/components/EmptyState.jsx) | Small reusable empty-state renderer with optional action/compact mode. Used by history, risk list, and compare. |
| [src/components/HistoryView.jsx](src/components/HistoryView.jsx) | Per-exercise local set history, trend chart, unit display, row deletion and clear confirmation. Imports history APIs, config, TrendChart, EmptyState; rendered by App. |
| [src/components/TrendChart.jsx](src/components/TrendChart.jsx) | Two vertically separate SVG trends for weight and score, with hover crosshair/tooltip; avoids a misleading shared dual axis. Uses `useWidth`; used by HistoryView. |
| [src/components/useWidth.js](src/components/useWidth.js) | `ResizeObserver` hook returning a DOM ref and measured width. Used by RepChart and TrendChart. |

### `server/` and `tests/`

| File | Role, imports, and consumers |
| --- | --- |
| [server/report.js](server/report.js) | `createReportHandler()` handles health and report routes, caps request body at 256 KiB, rejects obvious media-like payloads, optionally calls Anthropic, validates response, and returns template-source fallback on missing key/API/validation failure. Default model is `claude-opus-5`, override `SPOTTER_MODEL`. Imported by Vite plugin and production server. |
| [server/index.js](server/index.js) | Production Node HTTP server: loads `.env`, serves `dist`, routes `/api/*` to report handler, sets content types/cache, and falls back to SPA `index.html`. Imports `report.js`; run by `npm start`. |
| [tests/synth.js](tests/synth.js) | Builds deterministic synthetic side/front pose tracks by forward kinematics, piecewise cosine-eased motion, seeded noise and optional dropped frames. Supplies `timeline`, `sideTrack`, `frontTrack`, and `curlSet` to analysis tests. |
| [tests/analysis.test.js](tests/analysis.test.js) | End-to-end analysis of synthetic curls, squats and presses: reps/tempo, pauses, partials, breakdown, side/facing, camera angle/cuts/zoom, missing person, and explanatory issues. Imports analyzer and synthetic builders. |
| [tests/probe.test.js](tests/probe.test.js) | Builds minimal MP4/MOV boxes to test rotation/codec/duration parsing and non-MP4 rejection. Imports `probeContainer`. |
| [tests/report.test.js](tests/report.test.js) | Tests template wording, isolated/final changes, pain cue suppression, payload privacy, LLM response safety, formatting, and plain-text export. Uses synthetic analysis and report modules. |
| [tests/server.test.js](tests/server.test.js) | Runs the report handler with a mock Anthropic Messages API; tests no-key mode, valid JSON-schema request/model, validation fallback, beta retry, and obvious media rejection. Imports server handler and payload builder. |

## 4. Deep Dives on Core Logic

### Rep detection

The signal is smoothed by a one-frame Gaussian. A local maximum is accepted only if its **prominence** passes a threshold. Prominence is the peak height above the higher of the lowest valleys on its left and right, searching until a higher peak or missing-data boundary. This filters small wobbles even if they are local maxima. The required prominence is `max(minAbsProminence, minProminenceFrac * (p95(signal) - p05(signal)))`, so it has both an exercise-unit floor and a set-relative floor.

Each peak is surrounded by valleys. The median of the detected valley levels estimates typical rest; unusually deep excursions (for example, picking up or racking equipment) are clamped to that level. Start/end are threshold crossings near rest (`restTolFrac` of amplitude); top reach/leave use a separate threshold near the peak (`peakTolFrac`). Crossings are interpolated between sampled frames. A long pause while resting is outside the rep interval; time at the top is recorded as hold. Very short/long intervals are discarded. If the signal segment ends before returning to rest, the rep is truncated and unscored. A rep whose amplitude is below `partialFrac` times the 75th-percentile amplitude of full reps is partial. Partials can still be scored but cannot normally be chosen as baseline; if otherwise green and later than baseline, they are raised to at least yellow.

### Baseline, deviations, score, and breakdown

- Baseline candidates are scorable reps. For sets with at least 6 scorable reps, use up to the first 3 full reps; for 3-5, use 2; for fewer, use 1. If there are not enough full reps, fill from the first remaining scorable reps. This adapts baseline size to set length, but it is still a self-baseline, not an ideal-form reference.
- Per metric, baseline stats include mean, sample standard deviation, min and max. The deviation threshold is measured **beyond the baseline range**, not merely from its mean. A measured value already seen on any baseline rep is not counted as change. `minAbsChange` suppresses small absolute movement as likely noise. Relative metrics then normalize the excess by `max(abs(baseline mean), minAbsChange)`; absolute metrics keep the measurement unit.
- `direction` defines which movement direction is adverse (`increase`, `decrease`, or either). Thresholds assign `ok`, `notable`, or `major`; reliability is explanatory metadata, not a multiplier in the formula.
- Rep penalty is approximately `weight * 30 * min(severity, 1.5)` per metric, subtracted from 100 and rounded. A major metric marks red unless that metric has `maxStatus: 'yellow'`; a score below 60 also marks red. Otherwise a notable metric or score below 85 marks yellow; green is the remainder. `maxStatus: 'yellow'` prevents that metric alone from forcing red, but multiple penalties can still push the total score below the red cutoff.
- Breakdown is the first off-baseline rep after the baseline whose change persists into the following off-baseline rep (`sustainReps: 2`). A one-rep anomaly that returns to green is isolated. A red final rep counts even with no following rep; a lone yellow final rep does not. `kind` is `breakdown` if the sustained run contains red, otherwise `change`. If no breakdown exists, off-baseline non-green reps populate `isolated`.
- Risk factors are configured metric thresholds applied to scorable non-baseline reps. Each factor reports its first and worst qualifying rep; these labels are movement patterns, explicitly not diagnoses. Cue priority is breakdown causes, then strongest risks, then strongest other notable metrics, de-duplicated to two; pain suppresses all cues. If none qualify, a default movement cue is used.

### Exercise threshold map

Common values for all four configs unless noted: visibility cutoff `0.5`; fill gaps up to `0.4 s`; Gaussian keypoint sigma `0.07 s`; person and all-required-joint frame fractions each `0.60`; per-rep confidence `0.70`; side-view shoulder/torso ratio max `0.50`; camera jump threshold `0.60` torso lengths; torso-size spread max `1.28` (28%); prominence fraction `0.35`; partial cutoff `0.65`; rest/top tolerances `0.12`/`0.10`; rep duration `0.6-12 s`; minimum reps `2`; baseline max `3`, with 3 only for sets of 6+; score penalty `30`, yellow/red cutoffs `85`/`60`, persistence `2` reps. Lowering visibility/quality thresholds admits more marginal video; raising them rejects more. Raising prominence/minimum range misses smaller reps; lowering them risks counting noise. Lowering the partial cutoff calls more short reps complete. Increasing sustain count delays or suppresses breakdown detection.

| Exercise | Signal and special gates | Metrics (notable / major; min absolute change; weight; direction) |
| --- | --- | --- |
| Curl | Elbow flexion; min prominence 30 degrees; minimum torso size 10%; side view. | ROM: relative 12% / 25%, 8 degrees, 1, decrease. Elbow drift: 10 / 20 degrees, 6, 1, increase. Torso swing: 5 / 10 degrees, 3, 1, increase. Lowering time: relative 30% / 50%, 0.25 s, 0.6, decrease. Lift time: relative 40% / 80%, 0.3 s, 0.4, increase, capped to yellow as a sole major metric. |
| Row | Elbow flexion; min prominence 25 degrees; minimum torso size 10%; side view. | ROM: relative 12% / 25%, 8 degrees, 1, decrease. Torso swing: 6 / 12 degrees, 3, 1, increase. Lean-back: 5 / 10 degrees, 3, 0.8, increase. Shrug proxy: 4 / 8 `% torso`, 2.5, 0.6, increase, low reliability. Return time: relative 30% / 50%, 0.25 s, 0.6, decrease. Pull time: relative 40% / 80%, 0.3 s, 0.4, increase, yellow-capped as a sole major metric. |
| Squat | Knee flexion; min prominence 30 degrees; minimum torso size 8%; side view; lowering is first phase. | Depth/ROM: relative 10% / 20%, 8 degrees, 1, decrease. Forward lean: 6 / 12 degrees, 3, 1, increase. Hips-rise-first proxy: 5 / 10 degrees, 3, 1, increase. Heel lift: 8 / 15 `% foot`, 5, 0.6, increase, low reliability. Descent time: relative 30% / 50%, 0.25 s, 0.6, decrease. Ascent time: relative 40% / 80%, 0.3 s, 0.4, increase, yellow-capped as a sole major metric. |
| Press | Average wrist height as `% torso`; min prominence 20; front view and shoulder/torso ratio at least `0.45`. | Press range: relative 12% / 25%, 6 `% torso`, 1, decrease. Height asymmetry: 7 / 14 `% torso`, 4, 1, increase. Elbow asymmetry: 10 / 20 degrees, 6, 0.7, increase, low reliability. Lateral lean: 4 / 8 degrees, 2.5, 1, increase. Leg-drive proxy: 5 / 10 `% torso`, 3, 0.8, increase. Lowering time: relative 30% / 50%, 0.25 s, 0.6, decrease. Press time: relative 40% / 80%, 0.3 s, 0.4, increase, yellow-capped as a sole major metric. |

The configs also contain user-facing camera guides, metric descriptions/phrases, risk text, cues and limitations. Those strings define the product's explanation layer; changing a threshold changes classification, while changing a phrase changes how a classified deviation is described.

### Video handling details

`probeContainer()` is a purpose-built ISO-BMFF reader rather than a general media parser. It walks top-level box headers to find `moov`, then parses track headers/handler/sample description/movie header. It only reads metadata, not media samples. Unknown/non-MP4/MOV files return `null`; the browser's native decoder can still accept them. Rotation is read from the track matrix. For 90/270-degree video, `residualRotation()` compares coded dimensions with `videoWidth`/`videoHeight` to avoid applying rotation twice if the browser already honored it. User rotation is added after that. Converted output uses ffmpeg's autorotation and therefore returns residual rotation zero.

Native open waits up to 12 seconds for first data, checks dimensions, seeks, and checks a 48x48 pixel sample for nontrivial luminance mean/variance. This catches blank decodes but is a heuristic, not codec certification. ffmpeg conversion is lazy, memory-resident, no audio, H.264/yuv420p, 720px long side, up to 30 fps, ultrafast preset, CRF 24, and `faststart`. Files above 700 MiB cannot use this fallback.

### Report endpoint and LLM safety

`buildPayload()` sends exercise name/view; planned and counted reps, partial/unscored rep indices, score; pain boolean; baseline indices; metric definitions and rounded baseline means; per-rep states/scores and only notable/major changes; breakdown, isolated reps, risk metadata, candidate cues and template headline. It omits video, still images, landmarks, raw pose data, weight and free-text notes. Some report metadata and counts are integers, so the payload is not exclusively metric values.

The endpoint in [server/report.js](server/report.js) calls Anthropic's Messages API with model `claude-opus-5` by default (`SPOTTER_MODEL` overrides), `max_tokens: 4000`, low effort, and a JSON-schema object requiring `headline`, `summary`, and string-array `cues`. The system prompt requests short descriptive text, no weight/reps/sets prescription, diagnosis, or invented numbers; pain mode requests a professional-care notice and no cues. It asks low-reliability metrics to be described as approximate. The request first uses the server-side fallback beta; a `BadRequestError` retries without it.

The response is parsed and validated on the server, then validated again in the browser. Validation checks required fields/lengths, limits cues to two, empties cues on pain, regex-checks prescription/diagnosis language, and checks every numeral against numbers in the payload (plus rounded forms and small rep-count digits). On missing key, request failure, refusal, malformed output, or validation failure, the server returns `source: template`; the browser retains its already-built deterministic template report. Server input validation caps JSON at 256 KiB, checks for expected high-level fields, and rejects obvious `data:video/image` or long base64-looking content. That media check is heuristic and not a strict schema for every nested payload field.

### Safety handling

Pain mode is triggered by the explicit form toggle or a keyword regex over notes (for example pain, hurt, injury, ache, sharp, pinch, strain, numb, tingling, swelling, or tendon terms). It does not send the note itself. The app still measures and displays movement but suppresses configured cues; the template adds a doctor/physical-therapist notice; the LLM payload carries only `painReported: true` and asks for no cues plus the same professional-care advice. Regex matching does not understand negation, so text such as "no pain" can trigger the mode. Risk-factor wording is configured as general movement association and the UI/template disclaim diagnosis. This is application-level language filtering, not clinical safety certification.

## 5. Tests

The suite currently has 4 test files and 36 passing tests (`npm test` was run while preparing this guide).

- `tests/synth.js` creates 640x640 synthetic bodies in pixel space, computes joint positions from segment lengths/angles, converts them into MediaPipe-normalized x/y/z/visibility arrays, and uses seeded jitter for repeatability. Motion is a list of phases interpolated with cosine easing. Side and front builders make exercise movement parameters directly controllable.
- `analysis.test.js` checks core movement behavior and quality gates for curl, squat and press, including pause handling, rep duration/tempo, partial reps, left-facing side selection, wrong view, cuts, zoom, no person, missing joints, and alternative exercise suggestion.
- `probe.test.js` constructs MP4-like boxes and checks a portrait-style 90-degree rotated MOV, codec/duration extraction and unsupported-container null result.
- `report.test.js` checks templates, isolated and final-red behavior, pain cue suppression, no weight in the report payload, response acceptance/rejection, pain keyword patterns and plain-text export.
- `server.test.js` supplies a local mock Anthropic API and checks no-key fallback, model/schema/beta request, valid response, prescription rejection, beta retry and obvious media rejection.

Not covered by these tests: real MediaPipe inference on browser frames; browser-native decode and blank-frame heuristics; actual ffmpeg.wasm conversion; GPU-to-CPU behavior; UI interactions/accessibility and responsive rendering; localStorage failure/limits; real network/API integration; and comprehensive adversarial testing of the heuristic report safety filter. Synthetic tests validate algorithmic mechanics but cannot establish real-world pose-estimation accuracy.

## 6. Weak Spots and Judge Questions

### Reliability and unfinished edges

- **2-D pose is a proxy.** Camera-plane angles/distances can be wrong when movement comes toward/away from the camera. The configs acknowledge unmeasured features: grip/wrist rotation, squat knee cave from the side, back rounding, and only one side for side-view lifts. The press front-view elbow angle is explicitly low reliability; row shrug and squat heel landmarks are also low reliability.
- **One detected person.** MediaPipe is configured for one pose. A second person or a visually dominant bystander can be selected; there is no identity tracking or user selection of a detected body.
- **Self-baseline can be bad.** The first one to three selected clean reps are assumed to be the user's reference, so warm-up, rushed first reps, or already-compensated movement can normalize a poor pattern. This is a deliberate relative-comparison design, not an ideal-form score.
- **Sampling and threshold heuristics.** Analysis uses fixed 15 fps, image-size, visibility, prominence and camera thresholds. Fast reps, dropped frames, tracking swaps, or unusual execution can evade or split rep boundaries. Thresholds are config-tuned and some docs cite test-clip observations, but synthetic tests do not calibrate every real user/camera/exercise.
- **Camera gates use approximations.** Torso-size spread treats zoom/movement as a camera issue; hip displacement over several frames approximates cuts. Genuine body movement, occlusion, or unstable tracking can look like camera motion. Some quality geometry comes from raw landmarks and can be affected by poorly visible points.
- **Exercise coverage is narrow.** Four patterns and prescribed views are implemented. The metric names "leg drive", "hips rise first", "heel lift", etc. are geometric proxies; they do not measure load, force, muscle activation, or injury.
- **Report validation is regex-based.** It blocks known unsafe phrasings and invented numbers it can detect, but a paraphrased prescription/diagnosis or a number embedded in allowed text may bypass/mis-trigger checks. Payload media detection is also heuristic. The deterministic template is the fallback, not a guarantee that arbitrary language is safe.
- **Operational API boundary.** Production serves `/api/report` without an app-level user auth/rate limit in this code. The request size cap and media heuristic help constrain the endpoint, but operators should consider rate limiting and stricter payload validation before exposing a keyed deployment publicly.
- **Minimal browser validation.** Video loading, MediaPipe WASM, canvases, ResizeObserver, and local storage depend on browser behavior. Vitest tests cover pure logic/server handler, not a full browser E2E path. ffmpeg can be memory-heavy despite the 700 MiB input guard.
- **Small consistency details.** History is saved with a template headline before any Claude response returns, and the history view stores no replayable video. The dev raw pose track exists only on the in-memory analysis object in development; it is not persisted or sent to Claude.

### Likely judge questions

1. **Does the video go to Claude or your server?** No. Pose inference and scoring run in-browser. Optional report generation sends only derived JSON measurements/labels/counts to the configured server and Anthropic; no video, frame, landmark array, entered weight or free-text note is in the payload.
2. **What does "breakdown" mean in this product?** It is the earliest scored post-baseline rep whose yellow/red change persists into the next scored rep, or a red final rep. A one-off off-baseline rep is called isolated.
3. **How do you avoid declaring every small difference a change?** Compare against the baseline min/max range, require excess beyond that range, ignore changes below a metric-specific absolute noise floor, then apply relative/absolute notable and major thresholds.
4. **How do you count reps?** Use an exercise-specific motion signal and prominence-based peaks; use adjacent valleys and rest/top tolerances for boundaries. That makes the method less sensitive to tiny local wobbles and keeps long bottom pauses outside tempo.
5. **Why not use a generic ideal-form model?** The product is intentionally comparing the person to their own initial set reps. It reports change, not universal correctness or clinical advice.
6. **What happens with iPhone HEVC/rotated videos?** Probe MP4/MOV metadata and rotation; try native decoding and verify a real frame; if unsupported/blank, convert locally with ffmpeg.wasm to H.264, applying rotation. A manual rotate control covers residual cases.
7. **What if Claude gives unsafe advice or fails?** Validate on the server and again in the browser for shape, lengths, prescription/diagnosis patterns and unmeasured numbers. Keep the deterministic template report if any check or request fails; pain mode removes cues.
8. **Can you trust every metric equally?** No. Reliability labels and exercise limitations are shown in the method details. Some measures are explicit geometric proxies, and 2-D viewpoint/occlusion can hide important movement.
9. **How was the analysis tested without relying on video clips?** Synthetic pose tracks are generated with forward kinematics and known movement parameters, seeded noise and controlled camera/tracking failures. Separate tests construct a minimal MP4 box structure and mock the Anthropic endpoint.
10. **What would you improve next?** Add browser E2E tests over actual sample clips and multiple browsers, evaluate precision/recall of rep detection and quality gates against labeled footage, harden endpoint schema/rate limiting, and test the safety filter adversarially. Then tune per-exercise thresholds against a broader real-world dataset.