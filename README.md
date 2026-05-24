# SnareSense

Local macOS-first prototype for real-time marching snare trigger hit detection.

## Why this version is a local web app

This first pass uses the browser Web Audio stack instead of Python because it is the fastest reliable way to:

- read your Mac microphone input with minimal setup
- enumerate input devices
- show real-time timing visualization and a metronome
- keep the app completely local with browser-vendored libraries for sheet music display

It runs from a local server and stores nothing remotely.

## Files

- `index.html`: single-window UI
- `main.js`: app wiring, microphone capture, plotting, CSV export
- `server.py`: local static server plus same-device JSON persistence API
- `detector-core.mjs`: hit detection logic and simulated trigger source
- `detector-demo.mjs`: Node demo script for the detector
- `exercise-core.mjs`: MusicXML exercise parsing, hit matching, and scoring
- `exercise-demo.mjs`: Node demo script for exercise scoring
- `exercises/`: bundled snare exercises used by Exercise Analysis
- `vendor/`: browser bundles for JSZip and OpenSheetMusicDisplay
- `styles.css`: interface styling

## Run

1. Start the local SnareSense server from this folder:

```bash
python3 server.py
```

You can also run:

```bash
npm start
```

2. Open:

```text
http://localhost:5173
```

3. Click `Start`.

4. Choose either:

- `Simulated trigger stream` to test the detector without hardware
- your GO Guitar / Mac input device for live capture

5. Allow microphone access in the browser if prompted.
6. Use the metronome controls to set tempo and compare your hits to click markers on the beat timeline.
7. Open `Exercise Analysis` to load a bundled exercise or upload a `.mxl` / `.musicxml` file.

Recommended browser: Chrome on macOS for the most predictable Web Audio input behavior.

## Detector demo

Run the offline detector sanity check:

```bash
node detector-demo.mjs
```

The script simulates trigger spikes, runs the same detector logic, and prints hit count, precision, recall, and BPM.

Run all local checks:

```bash
npm test
```

## Exercise Analysis

The exercise mode supports a first-pass single-snare workflow:

- loads MusicXML / MXL files with JSZip and OpenSheetMusicDisplay
- automatically selects the part with the most playable snare attacks
- uses the file tempo as the default, while letting the user override tempo
- renders sheet music above an exercise-specific timing timeline
- shows a Historical Performance heatmap for saved reps, with orange rushing and blue dragging markers
- plays a two-measure eighth-note tap-off followed by guide clicks for written attacks
- includes a Listen button with sheet-cursor playback for the current exercise
- matches detected hits to expected attacks and scores the rep as a percentage
- reports smart feedback by grouping timing offsets by rhythm family, stroke type, accents, post-accent notes, and rhythm transitions
- includes bundled snare exercises, plus custom MXL/XML upload
- stores recent high scores locally on this device

Current scoring is timing-only. Accents are parsed and shown on the timeline/listen playback, but dynamics/accent-quality scoring is intentionally lenient and left for a later version.

## Detection algorithm

The detector is transient-oriented rather than a plain amplitude gate:

1. Apply a simple high-pass stage to suppress slow movement and low-frequency rumble.
2. Rectify the signal with absolute value.
3. Track a fast envelope and a slower baseline envelope.
4. Compute transient strength as `fast envelope - adaptive slow baseline`.
5. Smooth the transient signal.
6. Detect a local peak above threshold instead of firing on the first threshold crossing.
7. Apply a refractory window after each hit to suppress ringing and re-triggers.

This makes it more robust to weak/strong strokes, vibrations, and short post-hit ringing than a naive threshold-only approach.

## Controls

- `Metronome enable`: arms the click track for the session
- `Tempo`: sets metronome BPM
- `Detection threshold`: base onset threshold
- `Refractory period`: minimum spacing between hits
- `Smoothing / filtering`: increases damping on the envelope and transient follower
- `Beat timeline`: scrollable session history showing metronome clicks on the upper lane and detected hits on the lower lane

Detection settings, latency compensation, exercise scores/history, and lifetime stats are saved locally and restored when the app is reopened on the same device.

When launched with `python3 server.py` or `npm start`, the app writes user data to:

```text
~/Library/Application Support/SnareSense/user-data.json
```

If you serve the files with a generic static server, the app falls back to browser `localStorage`.

The `Detection Calibration` tool in Detection Settings can suggest threshold, refractory, and smoothing values by measuring:

- quiet trigger noise
- very soft fast taps
- loud taps / accents

## Tuning notes for a marching snare trigger

- Start with threshold around `0.005`, then use Detection Calibration or adjust by ear/graph.
- Start with refractory around `20 ms` for fast passages, then raise it if ringing creates double hits.
- If you see double hits from ringing, raise refractory first.
- If quiet notes are missed, lower threshold slightly before changing smoothing.
- If vibration or stand noise causes false hits, raise threshold slightly and increase smoothing a bit.
- If hits feel late or sluggish, reduce smoothing.
- Use the debug panel:
  - if raw amplitude is high but filtered amplitude stays low, the transient filter is suppressing that event
  - if filtered amplitude repeatedly touches threshold after one stroke, refractory is too short

## Export

`Export CSV` writes:

- hit index
- elapsed session time
- hit time in seconds
- hit strength
- absolute ISO timestamp relative to the session start

## Next improvements

- dynamic thresholding with a user-exposed adaptive control
- onset strength features based on spectral flux or differentiated energy
- confidence scoring per hit
- rhythm accuracy metrics against a target grid
- per-zone trigger classification if you later add multiple sensors
- packaging as a small native desktop shell if you want one-click launching
