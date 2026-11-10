import { ThermalTracker } from './thermal-tracker.js';

const video = document.querySelector('#thermal-video');
const display = document.querySelector('#thermal-display');
const overlay = document.querySelector('#thermal-overlay');
const viewport = document.querySelector('#monitor-viewport');
const sessionState = document.querySelector('#session-state');
const sessionStateText = document.querySelector('#session-state-text');
const detectionCount = document.querySelector('#detection-count');
const largeCount = document.querySelector('#large-count');
const feedName = document.querySelector('#feed-name');
const sourceState = document.querySelector('#source-state');
const noSignal = document.querySelector('#no-signal');
const cameraButton = document.querySelector('#camera-button');
const demoButton = document.querySelector('#demo-button');
const pauseButton = document.querySelector('#pause-button');
const pauseLabel = document.querySelector('#pause-label');
const endButton = document.querySelector('#end-button');
const regionSize = document.querySelector('#region-size');
const regionSizeOutput = document.querySelector('#region-size-output');
const regionSizeReadout = document.querySelector('#region-size-readout');
const readingRuleFill = document.querySelector('#reading-rule-fill');
const frameRate = document.querySelector('#frame-rate');
const rateReadout = document.querySelector('#rate-readout');
const elapsedTime = document.querySelector('#elapsed-time');
const permissionNote = document.querySelector('#permission-note');
const connectionState = document.querySelector('#connection-state');
const toast = document.querySelector('#toast');
const installButton = document.querySelector('#install-button');

let activeSource = null;
let paused = false;
let sessionStartedAt = 0;
let toastTimer = 0;
let installPrompt = null;
let lastCount = -1;

const tracker = new ThermalTracker({
  video,
  displayCanvas: display,
  overlayCanvas: overlay,
  minComponentPixels: Number(regionSize.value),
  targetFps: Number(frameRate.value),
  onDetections: (_boxes, count) => {
    if (count === lastCount) return;
    lastCount = count;
    const formattedCount = String(count).padStart(2, '0');
    detectionCount.textContent = String(count);
    largeCount.textContent = formattedCount;
    readingRuleFill.style.transform = `scaleX(${Math.min(count / 5, 1)})`;
  },
  onError: (error) => {
    activeSource = null;
    paused = false;
    tracker.stop();
    noSignal.hidden = false;
    setSessionState('error', 'FEED ERROR');
    connectionState.textContent = 'OFFLINE READY';
    showToast(error.message || 'The video feed could not be processed.');
    setControls(false);
  },
});

function setSessionState(state, label) {
  sessionState.dataset.state = state;
  sessionStateText.textContent = label;
}

function setControls(isActive) {
  pauseButton.disabled = !isActive;
  endButton.disabled = !isActive;
  cameraButton.disabled = isActive && activeSource === 'camera';
  demoButton.disabled = isActive && activeSource === 'demo';
  cameraButton.classList.toggle('is-selected', activeSource === 'camera');
  demoButton.classList.toggle('is-selected', activeSource === 'demo');
  cameraButton.setAttribute('aria-pressed', String(activeSource === 'camera'));
  demoButton.setAttribute('aria-pressed', String(activeSource === 'demo'));
  pauseLabel.textContent = paused ? 'Resume' : 'Pause';
}

function resizeOverlay() {
  const bounds = viewport.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.round(bounds.width * pixelRatio);
  const height = Math.round(bounds.height * pixelRatio);
  if (display.width !== width) display.width = width;
  if (display.height !== height) display.height = height;
  if (overlay.width !== width) overlay.width = width;
  if (overlay.height !== height) overlay.height = height;
}

async function startSource(source) {
  setSessionState('loading', source === 'camera' ? 'REQUESTING CAMERA' : 'LOADING DEMO');
  cameraButton.disabled = true;
  demoButton.disabled = true;
  tracker.stop();
  activeSource = null;
  paused = false;

  try {
    if (source === 'camera') {
      await tracker.initCamera();
      tracker.colorizeLuminance = true;
      permissionNote.textContent = 'Camera brightness is converted to pseudo-color on this device. It is not a temperature measurement.';
      feedName.textContent = 'CAMERA / PSEUDO-COLOR';
      sourceState.textContent = 'LOCAL CAMERA';
    } else {
      await tracker.initMockStream();
      tracker.colorizeLuminance = false;
      permissionNote.textContent = 'Simulated false-color signal. Switch to Camera to use a device camera.';
      feedName.textContent = 'DEMO FEED';
      sourceState.textContent = 'SIMULATED SOURCE';
    }

    activeSource = source;
    paused = false;
    elapsedMilliseconds = 0;
    elapsedTime.textContent = '00:00';
    sessionStartedAt = performance.now();
    viewport.style.aspectRatio = `${video.videoWidth || 4} / ${video.videoHeight || 3}`;
    noSignal.hidden = true;
    resizeOverlay();
    tracker.start();
    setSessionState('active', source === 'camera' ? 'CAMERA ACTIVE' : 'DEMO ACTIVE');
    connectionState.textContent = source === 'camera' ? 'CAMERA CONNECTED' : 'DEMO CONNECTED';
    setControls(true);
  } catch (error) {
    tracker.stop();
    activeSource = null;
    noSignal.hidden = false;
    setSessionState('error', 'SOURCE UNAVAILABLE');
    connectionState.textContent = 'OFFLINE READY';
    permissionNote.textContent = source === 'camera'
      ? 'Allow camera access in your browser, or select Demo feed.'
      : 'Canvas video is unavailable in this browser.';
    setControls(false);
    showToast(error.message || 'Could not start the selected source.');
  }
}

function endSession() {
  tracker.stop();
  activeSource = null;
  paused = false;
  elapsedMilliseconds = 0;
  elapsedTime.textContent = '00:00';
  noSignal.hidden = false;
  setSessionState('idle', 'STANDING BY');
  connectionState.textContent = 'OFFLINE READY';
  feedName.textContent = 'NO SOURCE';
  sourceState.textContent = 'AWAITING SOURCE';
  permissionNote.textContent = 'Camera brightness is shown as pseudo-color, not measured temperature. Video stays on this device.';
  setControls(false);
}

function togglePause() {
  if (!activeSource) return;
  paused = !paused;
  if (paused) {
    tracker.pause();
    setSessionState('paused', 'ANALYSIS PAUSED');
  } else {
    tracker.start();
    sessionStartedAt = performance.now() - elapsedMilliseconds;
    setSessionState('active', activeSource === 'camera' ? 'CAMERA ACTIVE' : 'DEMO ACTIVE');
  }
  setControls(true);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 4200);
}

let elapsedMilliseconds = 0;
function updateElapsedTime() {
  if (activeSource && !paused) {
    elapsedMilliseconds = performance.now() - sessionStartedAt;
  }
  const totalSeconds = Math.floor(elapsedMilliseconds / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  elapsedTime.textContent = `${minutes}:${seconds}`;
}

cameraButton.addEventListener('click', () => startSource('camera'));
demoButton.addEventListener('click', () => startSource('demo'));
pauseButton.addEventListener('click', togglePause);
endButton.addEventListener('click', endSession);

regionSize.addEventListener('input', () => {
  const value = Number(regionSize.value);
  tracker.minComponentPixels = value;
  regionSizeOutput.value = `${value} px`;
  regionSizeReadout.textContent = `${value} PX`;
});

frameRate.addEventListener('change', () => {
  const value = Number(frameRate.value);
  tracker.frameInterval = 1000 / value;
  rateReadout.textContent = `${value} FPS`;
});

new ResizeObserver(resizeOverlay).observe(viewport);
window.addEventListener('orientationchange', resizeOverlay);
window.setInterval(updateElapsedTime, 1000);

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  installButton.hidden = true;
});

window.addEventListener('appinstalled', () => {
  installButton.hidden = true;
  showToast('M.O.B.Y. is installed.');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(() => {
      connectionState.textContent = 'OFFLINE READY';
    }).catch(() => {
      connectionState.textContent = 'LOCAL SESSION';
    });
  });
}

startSource('camera');