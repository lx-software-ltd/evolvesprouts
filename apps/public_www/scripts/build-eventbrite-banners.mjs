import { readdir, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const LANDING_DIR = path.join(APP_ROOT, 'src', 'content', 'landing-pages');
const BANNER_DIR = path.join(APP_ROOT, 'src', 'content', 'eventbrite-banners');
const LOGO_PATH = path.join(PUBLIC_DIR, 'images', 'evolvesprouts-logo.svg');

const CANVAS_WIDTH = 1456;
const CANVAS_HEIGHT = 728;
const MAX_BYTES = 2 * 1024 * 1024;
// The logo SVG is a 2048 square. The wordmark sits between the ground
// swoosh (ends near y=1368) and the roots (start near y=1496). Cover that
// band so the letters do not peek out beside the photo. The tree, swoosh,
// and roots stay where the public site draws them.
const LOGO_VIEW_SIZE = 2048;
const LOGO_WORDMARK_TOP = 1376;
const LOGO_WORDMARK_BOTTOM = 1472;

function photoPath(imageSrc) {
  if (typeof imageSrc !== 'string' || !imageSrc.startsWith('/images/')) {
    throw new Error(`Hero imageSrc must start with /images/: ${imageSrc}`);
  }
  const resolved = path.resolve(PUBLIC_DIR, `.${imageSrc}`);
  const relative = path.relative(PUBLIC_DIR, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Hero imageSrc escapes public/: ${imageSrc}`);
  }
  return resolved;
}

export async function composeBanner(imageSrc) {
  const source = photoPath(imageSrc);
  const photo = sharp(source);
  const meta = await photo.metadata();
  const photoWidth = meta.width ?? 0;
  const photoHeight = meta.height ?? 0;
  if (photoWidth < 1 || photoHeight < 1) {
    throw new Error(`Hero image has no size: ${imageSrc}`);
  }

  const treeSize = photoWidth;
  const wordmarkTop = Math.round((treeSize * LOGO_WORDMARK_TOP) / LOGO_VIEW_SIZE);
  const wordmarkBottom = Math.round((treeSize * LOGO_WORDMARK_BOTTOM) / LOGO_VIEW_SIZE);
  const wordmarkCover = await sharp({
    create: {
      width: treeSize,
      height: Math.max(1, wordmarkBottom - wordmarkTop),
      channels: 4,
      background: '#ffffff',
    },
  })
    .png()
    .toBuffer();
  const [logo, photoBuffer] = await Promise.all([
    sharp(LOGO_PATH)
      .resize(treeSize, treeSize, { fit: 'fill' })
      .composite([{ input: wordmarkCover, left: 0, top: wordmarkTop }])
      .png()
      .toBuffer(),
    photo.toBuffer(),
  ]);
  const groupWidth = Math.max(photoWidth, treeSize);
  const groupHeight = Math.max(photoHeight, treeSize);
  const group = await sharp({
    create: {
      width: groupWidth,
      height: groupHeight,
      channels: 4,
      background: '#ffffff',
    },
  })
    .composite([
      {
        input: logo,
        left: Math.round((groupWidth - treeSize) / 2),
        top: Math.round((groupHeight - treeSize) / 2),
      },
      {
        input: photoBuffer,
        left: Math.round((groupWidth - photoWidth) / 2),
        top: Math.round((groupHeight - photoHeight) / 2),
      },
    ])
    .png()
    .toBuffer();

  const scale = Math.min(1, CANVAS_WIDTH / groupWidth, CANVAS_HEIGHT / groupHeight);
  const layer =
    scale < 1
      ? await sharp(group)
          .resize(
            Math.max(1, Math.round(groupWidth * scale)),
            Math.max(1, Math.round(groupHeight * scale)),
            { kernel: 'lanczos3' },
          )
          .png()
          .toBuffer()
      : group;
  const fitted = await sharp(layer).metadata();
  const width = fitted.width ?? 0;
  const height = fitted.height ?? 0;
  const banner = await sharp({
    create: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      channels: 4,
      background: '#ffffff',
    },
  })
    .composite([
      {
        input: layer,
        left: Math.round((CANVAS_WIDTH - width) / 2),
        top: Math.round((CANVAS_HEIGHT - height) / 2),
      },
    ])
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9 })
    .toBuffer();

  if (banner.length > MAX_BYTES) {
    throw new Error(`Banner is ${banner.length} bytes, above ${MAX_BYTES}`);
  }
  return banner;
}

async function main() {
  await mkdir(BANNER_DIR, { recursive: true });
  const filenames = (await readdir(LANDING_DIR)).filter((name) => name.endsWith('.json'));
  if (filenames.length === 0) {
    throw new Error(`No landing pages in ${LANDING_DIR}`);
  }
  for (const filename of filenames) {
    const page = JSON.parse(await readFile(path.join(LANDING_DIR, filename), 'utf8'));
    const imageSrc = page?.en?.hero?.imageSrc;
    const banner = await composeBanner(imageSrc);
    const slug = filename.slice(0, -'.json'.length);
    await writeFile(path.join(BANNER_DIR, `${slug}.png`), banner);
    console.log(`${slug}.png ${banner.length} bytes`);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
