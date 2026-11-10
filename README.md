# M.O.B.Y.-Multimodal-Ocean-Buoy-Yielding-

## Run Locally

Serve the project root over HTTP:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. The app requests the environment-facing camera on launch; allow camera access in the browser prompt. If no camera is available or permission is denied, select **Demo feed**. Video is processed locally and is not uploaded. Use **Pause**, **End session**, minimum region size, and analysis rate controls while tracking.

## Install And Offline Use

The app includes a web manifest and service worker. After loading it once, the app shell is cached for offline use. For phone installation, deploy it over HTTPS and use the browser's install or add-to-home-screen action. Camera access requires HTTPS or localhost and explicit browser permission.

## Detection Notes

The app downsamples video frames to 160 x 120. Camera RGB is mapped through a brightness-based false-color palette for display and detection; the demo retains its synthetic palette. 4-connected hot pixels are grouped and boxed on an overlay canvas. Analysis defaults to 24 FPS and can be set to 30 FPS. Pseudo-color from an ordinary RGB camera is not a temperature map and cannot identify living subjects; use a calibrated thermal sensor for temperature measurements.

For standalone use, `src/thermal-tracker.js` exports the `ThermalTracker` ES module. `index.html` and `src/app.js` provide the complete browser application.