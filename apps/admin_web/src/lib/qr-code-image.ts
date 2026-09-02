import QRCode from 'qrcode';
import type { QRCode as QrModel } from 'qrcode';

/** Matches public site `--es-color-brand-orange` (`shared/styles/base.css`). */
const PUBLIC_SITE_PRIMARY_ORANGE = '#C84A16';

/** Input for branded public-site QR PNG generation (referral links, marketing page URLs, etc.). */
export interface GeneratePublicSiteQrPngDataUrlInput {
  url: string;
  size: number;
  /** When omitted or empty, the QR is generated without a centered logo. */
  logoSrc?: string;
  /** When true, modules use brand orange and rounded module corners. Default true. */
  applyBranding?: boolean;
}

/** @deprecated Use `GeneratePublicSiteQrPngDataUrlInput`. */

function parseHexRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.trim().replace(/^#/, '');
  if (normalized.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

const FINDER_PATTERN_GRID: number[][] = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

const ALIGNMENT_PATTERN_GRID: number[][] = [
  [0, 0, 1, 0, 0],
  [0, 1, 1, 1, 0],
  [1, 1, 1, 1, 1],
  [0, 1, 1, 1, 0],
  [0, 0, 1, 0, 0],
];

function drawFinderBlock(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  modulePx: number,
  dark: string,
  light: string,
): void {
  for (let r = 0; r < 7; r += 1) {
    for (let c = 0; c < 7; c += 1) {
      const v = FINDER_PATTERN_GRID[r]?.[c] ?? 0;
      if (!v) {
        continue;
      }
      const x = originX + c * modulePx;
      const y = originY + r * modulePx;
      const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
      const isInnerEye = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      ctx.fillStyle = isOuter || isInnerEye ? dark : light;
      const cornerR = modulePx * 0.35;
      fillRoundedRect(ctx, x, y, modulePx, modulePx, cornerR);
    }
  }
}

function drawAlignmentBlock(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  modulePx: number,
  dark: string,
  light: string,
): void {
  for (let r = 0; r < 5; r += 1) {
    for (let c = 0; c < 5; c += 1) {
      const v = ALIGNMENT_PATTERN_GRID[r]?.[c] ?? 0;
      if (!v) {
        continue;
      }
      const x = originX + c * modulePx;
      const y = originY + r * modulePx;
      const isCenterCross = r === 2 || c === 2;
      ctx.fillStyle = isCenterCross ? dark : light;
      const cornerR = modulePx * 0.35;
      fillRoundedRect(ctx, x, y, modulePx, modulePx, cornerR);
    }
  }
}

function getSymbolSize(version: number): number {
  return version * 4 + 17;
}

function getFinderPatternPositions(version: number): [number, number][] {
  const size = getSymbolSize(version);
  const finderSize = 7;
  return [
    [0, 0],
    [size - finderSize, 0],
    [0, size - finderSize],
  ];
}

function getAlignmentRowColCoords(version: number): number[] {
  if (version === 1) {
    return [];
  }
  const posCount = Math.floor(version / 7) + 2;
  const size = getSymbolSize(version);
  const intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
  const positions: number[] = [size - 7];
  for (let i = 1; i < posCount - 1; i += 1) {
    positions[i] = positions[i - 1]! - intervals;
  }
  positions.push(6);
  return positions.reverse();
}

/** Each entry is `[row, col]` — indices for `qr.modules.get(row, col)` (row first). */
function getAlignmentPatternCenters(version: number): [number, number][] {
  const centers: [number, number][] = [];
  const pos = getAlignmentRowColCoords(version);
  const posLength = pos.length;
  for (let i = 0; i < posLength; i += 1) {
    for (let j = 0; j < posLength; j += 1) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === posLength - 1) ||
        (i === posLength - 1 && j === 0)
      ) {
        continue;
      }
      centers.push([pos[i]!, pos[j]!]);
    }
  }
  return centers;
}

function drawBrandedQrModules(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  qr: QrModel,
  size: number,
  darkHex: string,
): void {
  const n = qr.modules.size;
  const margin = 2;
  const innerModules = n + margin * 2;
  const modulePx = size / innerModules;
  const light = '#ffffff';
  const dark = darkHex;

  ctx.fillStyle = light;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const finderPositions = getFinderPatternPositions(qr.version);
  const alignmentCenters = getAlignmentPatternCenters(qr.version);

  const finderOrigin = new Set<string>();
  for (const [fr, fc] of finderPositions) {
    for (let dr = 0; dr < 7; dr += 1) {
      for (let dc = 0; dc < 7; dc += 1) {
        finderOrigin.add(`${fr + dr},${fc + dc}`);
      }
    }
  }

  const alignmentOrigin = new Set<string>();
  for (const [row, col] of alignmentCenters) {
    for (let dr = -2; dr <= 2; dr += 1) {
      for (let dc = -2; dc <= 2; dc += 1) {
        alignmentOrigin.add(`${row + dr},${col + dc}`);
      }
    }
  }

  const moduleCornerR = modulePx * 0.42;

  for (const [fr, fc] of finderPositions) {
    const px = (fc + margin) * modulePx;
    const py = (fr + margin) * modulePx;
    drawFinderBlock(ctx, px, py, modulePx, dark, light);
  }

  for (const [row, col] of alignmentCenters) {
    const px = (col - 2 + margin) * modulePx;
    const py = (row - 2 + margin) * modulePx;
    drawAlignmentBlock(ctx, px, py, modulePx, dark, light);
  }

  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      const key = `${row},${col}`;
      if (finderOrigin.has(key) || alignmentOrigin.has(key)) {
        continue;
      }
      if (!qr.modules.get(row, col)) {
        continue;
      }
      const x = (col + margin) * modulePx;
      const y = (row + margin) * modulePx;
      ctx.fillStyle = dark;
      fillRoundedRect(ctx, x, y, modulePx, modulePx, moduleCornerR);
    }
  }
}

function canvasToPngDataUrl(canvas: HTMLCanvasElement): string {
  try {
    return canvas.toDataURL('image/png');
  } catch {
    throw new Error(
      'Could not export QR image. If the logo loads from another origin, enable CORS or use a same-origin asset.',
    );
  }
}

async function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error('Failed to load logo image'));
    };
    image.src = src;
  });
}

/**
 * Crop uniform transparent (or near-white) margins from an image by sampling edges.
 */
function drawLogoTrimmedToCanvas(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  destX: number,
  destY: number,
  destSize: number,
): void {
  const probe = document.createElement('canvas');
  const maxProbe = 256;
  const scale = Math.min(1, maxProbe / Math.max(sourceWidth, sourceHeight));
  const w = Math.max(1, Math.round(sourceWidth * scale));
  const h = Math.max(1, Math.round(sourceHeight * scale));
  probe.width = w;
  probe.height = h;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  if (!pctx) {
    ctx.drawImage(image, destX, destY, destSize, destSize);
    return;
  }
  pctx.drawImage(image, 0, 0, sourceWidth, sourceHeight, 0, 0, w, h);
  let data: ImageData;
  try {
    data = pctx.getImageData(0, 0, w, h);
  } catch {
    ctx.drawImage(image, destX, destY, destSize, destSize);
    return;
  }

  const pixels = data.data;
  const isBackground = (idx: number) => {
    const a = pixels[idx + 3] ?? 255;
    if (a < 12) {
      return true;
    }
    const r = pixels[idx] ?? 255;
    const g = pixels[idx + 1] ?? 255;
    const b = pixels[idx + 2] ?? 255;
    return r > 245 && g > 245 && b > 245;
  };

  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;

  rowScan: for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!isBackground((y * w + x) * 4)) {
        top = y;
        break rowScan;
      }
    }
  }

  rowScan2: for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = 0; x < w; x += 1) {
      if (!isBackground((y * w + x) * 4)) {
        bottom = y;
        break rowScan2;
      }
    }
  }

  colScan: for (let x = 0; x < w; x += 1) {
    for (let y = top; y <= bottom; y += 1) {
      if (!isBackground((y * w + x) * 4)) {
        left = x;
        break colScan;
      }
    }
  }

  colScan2: for (let x = w - 1; x >= 0; x -= 1) {
    for (let y = top; y <= bottom; y += 1) {
      if (!isBackground((y * w + x) * 4)) {
        right = x;
        break colScan2;
      }
    }
  }

  if (left > right || top > bottom) {
    ctx.drawImage(image, destX, destY, destSize, destSize);
    return;
  }

  const sx0 = left / scale;
  const sy0 = top / scale;
  const sw = Math.max(1, (right - left + 1) / scale);
  const sh = Math.max(1, (bottom - top + 1) / scale);
  ctx.drawImage(image, sx0, sy0, sw, sh, destX, destY, destSize, destSize);
}

/**
 * Draw a QR code, optionally with a centered logo overlay (error correction H).
 * Returns a PNG data URL suitable for download.
 */
export async function generatePublicSiteQrPngDataUrl(
  input: GeneratePublicSiteQrPngDataUrlInput,
): Promise<string> {
  const applyBranding = input.applyBranding !== false;
  const canvas = document.createElement('canvas');
  canvas.width = input.size;
  canvas.height = input.size;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is not available');
  }

  if (applyBranding) {
    const qr = QRCode.create(input.url, { errorCorrectionLevel: 'H' });
    const darkRgb = parseHexRgb(PUBLIC_SITE_PRIMARY_ORANGE);
    const darkCss = `rgb(${darkRgb.r},${darkRgb.g},${darkRgb.b})`;
    drawBrandedQrModules(ctx, canvas, qr, input.size, darkCss);
  } else {
    await QRCode.toCanvas(canvas, input.url, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: input.size,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });
  }

  const logoSrc = input.logoSrc?.trim() ?? '';
  if (!logoSrc) {
    return canvasToPngDataUrl(canvas);
  }

  const logoSize = Math.round(input.size * 0.2);
  const pad = 4;
  const centerX = Math.floor((input.size - logoSize) / 2);
  const centerY = Math.floor((input.size - logoSize) / 2);
  const padX = Math.round(pad);
  const padY = Math.round(pad);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(centerX - padX, centerY - padY, logoSize + padX * 2, logoSize + padY * 2);

  const image = await loadImageElement(logoSrc);
  const naturalW =
    'naturalWidth' in image && typeof image.naturalWidth === 'number' ? image.naturalWidth : image.width;
  const naturalH =
    'naturalHeight' in image && typeof image.naturalHeight === 'number' ? image.naturalHeight : image.height;
  drawLogoTrimmedToCanvas(ctx, image, naturalW, naturalH, centerX, centerY, logoSize);

  return canvasToPngDataUrl(canvas);
}
