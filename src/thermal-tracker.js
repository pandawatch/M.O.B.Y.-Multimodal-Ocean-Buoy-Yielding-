const THERMAL_STOPS = [
  [0, 5, 9, 20],
  [51, 20, 35, 57],
  [102, 72, 19, 27],
  [133, 179, 34, 20],
  [158, 255, 84, 28],
  [194, 255, 207, 42],
  [235, 255, 246, 224],
  [255, 255, 255, 255],
];

const THERMAL_PALETTE = new Uint8Array(256 * 3);
let thermalStop = 0;
for (let luminance = 0; luminance < 256; luminance += 1) {
  while (thermalStop < THERMAL_STOPS.length - 2 && luminance > THERMAL_STOPS[thermalStop + 1][0]) {
    thermalStop += 1;
  }
  const start = THERMAL_STOPS[thermalStop];
  const end = THERMAL_STOPS[thermalStop + 1];
  const amount = Math.min(1, (luminance - start[0]) / (end[0] - start[0]));
  const offset = luminance * 3;
  THERMAL_PALETTE[offset] = start[1] + (end[1] - start[1]) * amount;
  THERMAL_PALETTE[offset + 1] = start[2] + (end[2] - start[2]) * amount;
  THERMAL_PALETTE[offset + 2] = start[3] + (end[3] - start[3]) * amount;
}

/**
 * Lightweight false-color thermal signature tracker.
 * This detects palette-colored regions; it does not determine whether a region
 * is a person, animal, or otherwise alive.
 */
export class ThermalTracker {
  constructor({
    video,
    overlayCanvas,
    displayCanvas = null,
    analysisWidth = 160,
    analysisHeight = 120,
    targetFps = 24,
    minComponentPixels = 8,
    maxComponents = 32,
    label = 'Living Entity Detected',
    onDetections = () => {},
    onError = (error) => console.error(error),
  }) {
    if (!video || !overlayCanvas) {
      throw new TypeError('Provide a video element and an overlay canvas.');
    }

    this.video = video;
    this.overlayCanvas = overlayCanvas;
    this.displayCanvas = displayCanvas;
    this.analysisWidth = analysisWidth;
    this.analysisHeight = analysisHeight;
    this.frameInterval = 1000 / Math.min(30, Math.max(24, targetFps));
    this.lastFrameTime = 0;
    this.minComponentPixels = minComponentPixels;
    this.maxComponents = maxComponents;
    this.label = label;
    this.onDetections = onDetections;
    this.onError = onError;

    this.analysisCanvas = document.createElement('canvas');
    this.analysisCanvas.width = analysisWidth;
    this.analysisCanvas.height = analysisHeight;
    this.analysisContext = this.analysisCanvas.getContext('2d', {
      willReadFrequently: true,
    });
    this.overlayContext = overlayCanvas.getContext('2d');
    this.displayContext = displayCanvas?.getContext('2d') || null;

    if (!this.analysisContext || !this.overlayContext || (displayCanvas && !this.displayContext)) {
      throw new Error('Canvas 2D is not available in this browser.');
    }

    const pixelCount = analysisWidth * analysisHeight;
    this.hotMask = new Uint8Array(pixelCount);
    this.visited = new Uint8Array(pixelCount);
    this.queue = new Uint32Array(pixelCount);
    this.boxes = Array.from({ length: maxComponents }, () => ({
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      pixelCount: 0,
    }));

    // These values target common red/yellow/white false-color thermal palettes.
    // Tune them to the camera's palette or use radiometric temperature data.
    this.thresholds = {
      redR: 190,
      redG: 70,
      redBMax: 140,
      redDominance: 25,
      yellowR: 210,
      yellowG: 150,
      yellowBMax: 145,
      whiteMin: 225,
    };

    this.running = false;
    this.frameId = 0;
    this.mockFrameId = 0;
    this.stream = null;
    this.mockCanvas = null;
    this.mockContext = null;
    this.boxCount = 0;
    this.colorizeLuminance = false;
    this._boundProcessFrame = (time) => this.processThermalFrame(time);
    this._boundDrawMockFrame = (time) => this.drawMockFrame(time);
  }

  async initCamera(constraints = {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30, max: 30 },
    },
    audio: false,
  }) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access requires HTTPS (or localhost) and getUserMedia support.');
    }

    this.stopStream();
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    await this.attachStream(this.stream);
    return this.stream;
  }

  async initMockStream() {
    this.stopStream();
    this.mockCanvas = document.createElement('canvas');
    this.mockCanvas.width = 320;
    this.mockCanvas.height = 240;
    this.mockContext = this.mockCanvas.getContext('2d');

    if (!this.mockCanvas.captureStream || !this.mockContext) {
      throw new Error('Canvas captureStream is not supported in this browser.');
    }

    this.mockFrameId = requestAnimationFrame(this._boundDrawMockFrame);
    this.stream = this.mockCanvas.captureStream(30);
    await this.attachStream(this.stream);
    return this.stream;
  }

  async attachStream(stream) {
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;
    await this.video.play();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = 0;
    this.frameId = requestAnimationFrame(this._boundProcessFrame);
  }

  stop() {
    this.pause();
    cancelAnimationFrame(this.mockFrameId);
    this.stopStream();
    this.clearOverlay();
  }

  pause() {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.clearOverlay();
    this.onDetections(this.boxes, 0);
  }

  stopStream() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
    cancelAnimationFrame(this.mockFrameId);
    this.mockFrameId = 0;
  }

  processThermalFrame(time = 0) {
    if (!this.running) return;

    if (this.lastFrameTime && time - this.lastFrameTime < this.frameInterval) {
      this.frameId = requestAnimationFrame(this._boundProcessFrame);
      return;
    }
    this.lastFrameTime = time;

    try {
      const { videoWidth, videoHeight } = this.video;
      if (videoWidth > 0 && videoHeight > 0) {
        this.analysisContext.drawImage(
          this.video,
          0,
          0,
          this.analysisWidth,
          this.analysisHeight,
        );

        const frame = this.analysisContext.getImageData(
          0,
          0,
          this.analysisWidth,
          this.analysisHeight,
        );
        if (this.colorizeLuminance) {
          this.colorizeFrame(frame.data);
          this.analysisContext.putImageData(frame, 0, 0);
        }
        this.findHotComponents(frame.data);
        if (this.displayContext) {
          this.displayContext.drawImage(
            this.analysisCanvas,
            0,
            0,
            this.displayCanvas.width,
            this.displayCanvas.height,
          );
        }
        this.drawBoundingBoxes();
        this.onDetections(this.boxes, this.boxCount);
      } else {
        this.clearOverlay();
      }
    } catch (error) {
      this.running = false;
      this.clearOverlay();
      this.onError(error);
      return;
    }

    if (this.running) {
      this.frameId = requestAnimationFrame(this._boundProcessFrame);
    }
  }

  colorizeFrame(rgba) {
    for (let offset = 0; offset < rgba.length; offset += 4) {
      const luminance = (rgba[offset] * 54 + rgba[offset + 1] * 183 + rgba[offset + 2] * 19) >> 8;
      const paletteOffset = luminance * 3;
      rgba[offset] = THERMAL_PALETTE[paletteOffset];
      rgba[offset + 1] = THERMAL_PALETTE[paletteOffset + 1];
      rgba[offset + 2] = THERMAL_PALETTE[paletteOffset + 2];
    }
  }

  findHotComponents(rgba) {
    const pixelCount = this.hotMask.length;
    const { redR, redG, redBMax, redDominance, yellowR, yellowG, yellowBMax, whiteMin } = this.thresholds;

    // Convert the small analysis frame to a binary mask without allocating per pixel.
    for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 4) {
      const red = rgba[offset];
      const green = rgba[offset + 1];
      const blue = rgba[offset + 2];
      const redHeat = red >= redR && green >= redG && blue <= redBMax && red - green >= redDominance;
      const yellowHeat = red >= yellowR && green >= yellowG && blue <= yellowBMax;
      const whiteHeat = red >= whiteMin && green >= whiteMin && blue >= whiteMin;
      this.hotMask[pixel] = redHeat || yellowHeat || whiteHeat ? 1 : 0;
    }

    this.visited.fill(0);
    this.boxCount = 0;
    const width = this.analysisWidth;
    const height = this.analysisHeight;

    // Flood-fill each 4-connected hot region using one reusable queue.
    for (let start = 0; start < pixelCount; start += 1) {
      if (!this.hotMask[start] || this.visited[start]) continue;

      let head = 0;
      let tail = 0;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      this.queue[tail++] = start;
      this.visited[start] = 1;

      while (head < tail) {
        const pixel = this.queue[head++];
        const x = pixel % width;
        const y = (pixel / width) | 0;

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        const left = pixel - 1;
        const right = pixel + 1;
        const above = pixel - width;
        const below = pixel + width;

        if (x > 0 && this.hotMask[left] && !this.visited[left]) {
          this.visited[left] = 1;
          this.queue[tail++] = left;
        }
        if (x + 1 < width && this.hotMask[right] && !this.visited[right]) {
          this.visited[right] = 1;
          this.queue[tail++] = right;
        }
        if (y > 0 && this.hotMask[above] && !this.visited[above]) {
          this.visited[above] = 1;
          this.queue[tail++] = above;
        }
        if (y + 1 < height && this.hotMask[below] && !this.visited[below]) {
          this.visited[below] = 1;
          this.queue[tail++] = below;
        }
      }

      if (tail < this.minComponentPixels || this.boxCount >= this.maxComponents) continue;
      const box = this.boxes[this.boxCount++];
      box.minX = minX;
      box.maxX = maxX;
      box.minY = minY;
      box.maxY = maxY;
      box.pixelCount = tail;
    }
  }

  drawBoundingBoxes() {
    const context = this.overlayContext;
    const canvas = this.overlayCanvas;
    const scaleX = canvas.width / this.analysisWidth;
    const scaleY = canvas.height / this.analysisHeight;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 2;
    context.font = '14px sans-serif';
    context.textBaseline = 'bottom';

    for (let index = 0; index < this.boxCount; index += 1) {
      const box = this.boxes[index];
      const x = box.minX * scaleX;
      const y = box.minY * scaleY;
      const width = (box.maxX - box.minX + 1) * scaleX;
      const height = (box.maxY - box.minY + 1) * scaleY;
      const textY = Math.max(16, y - 3);

      context.strokeStyle = '#39ff88';
      context.strokeRect(x, y, width, height);
      context.fillStyle = '#39ff88';
      context.fillText(this.label, x, textY);
    }
  }

  clearOverlay() {
    this.overlayContext.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
  }

  drawMockFrame(time) {
    if (!this.mockContext || !this.stream) return;

    const context = this.mockContext;
    const width = this.mockCanvas.width;
    const height = this.mockCanvas.height;
    context.fillStyle = '#080808';
    context.fillRect(0, 0, width, height);

    // Nested colors form connected, moving blobs in a common false-color palette.
    for (let entity = 0; entity < 2; entity += 1) {
      const phase = time / 850 + entity * 2.4;
      const centerX = width * (0.36 + entity * 0.3) + Math.sin(phase) * 28;
      const centerY = height * (0.5 + Math.cos(phase * 0.8) * 0.14);
      context.beginPath();
      context.ellipse(centerX, centerY, 36, 48, 0, 0, Math.PI * 2);
      context.fillStyle = '#ff3000';
      context.fill();
      context.beginPath();
      context.ellipse(centerX, centerY, 24, 34, 0, 0, Math.PI * 2);
      context.fillStyle = '#ffd000';
      context.fill();
      context.beginPath();
      context.ellipse(centerX, centerY, 10, 17, 0, 0, Math.PI * 2);
      context.fillStyle = '#fff5dd';
      context.fill();
    }

    this.mockFrameId = requestAnimationFrame(this._boundDrawMockFrame);
  }
}