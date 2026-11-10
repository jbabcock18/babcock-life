#!/usr/bin/env node
// Photo pipeline: reads every JPEG the site uses and writes
//
//   content/photos.json   size, capture time, camera and GPS for each photo
//   assets/img/<set>/     WebP copies with the metadata stripped
//
// Run it after adding or replacing photos:   node tools/photos.mjs
// Needs `cwebp` and `dwebp` (libwebp) on the PATH. Existing WebP files are
// reused unless the source JPEG is newer; pass --force to redo all of them.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJpegMeta } from './lib/exif.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const SMALL_WIDTH = 480;

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const site = readJson('content/site.json');
const albums = readJson('content/albums.json');

// Each set is a folder of source JPEGs: the home page portraits plus one per album.
const sets = [
  { id: 'about', dir: site.portraits.dir },
  ...albums.filter((album) => album.photos).map((album) => ({ id: album.id, dir: album.photos })),
];

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'photos-'));
const run = (bin, args) => execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });

function isStale(target, source) {
  return force || !fs.existsSync(target) || fs.statSync(target).mtimeMs < fs.statSync(source).mtimeMs;
}

/** Average colour of the photo, shown behind the image while it loads. */
function averageColor(source) {
  const tiny = path.join(scratch, 'tiny.webp');
  const ppm = path.join(scratch, 'tiny.ppm');
  run('cwebp', ['-quiet', '-q', '60', '-resize', '8', '0', source, '-o', tiny]);
  run('dwebp', ['-quiet', tiny, '-ppm', '-o', ppm]);
  const data = fs.readFileSync(ppm);
  // Binary PPM: "P6\n<width> <height>\n255\n" then RGB triples.
  const header = /^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(data.toString('latin1', 0, 32));
  const pixels = data.subarray(header[0].length);
  const sum = [0, 0, 0];
  for (let i = 0; i + 2 < pixels.length; i += 3) {
    sum[0] += pixels[i];
    sum[1] += pixels[i + 1];
    sum[2] += pixels[i + 2];
  }
  const count = Math.floor(pixels.length / 3) || 1;
  return `#${sum.map((v) => Math.round(v / count).toString(16).padStart(2, '0')).join('')}`;
}

const round = (value, places) => (value === null ? null : Number(value.toFixed(places)));

const photos = [];
let converted = 0;

for (const set of sets) {
  const dir = path.join(root, set.dir);
  const outDir = path.join(root, 'assets/img', set.id);
  fs.mkdirSync(outDir, { recursive: true });
  const files = fs
    .readdirSync(dir)
    .filter((name) => /\.jpe?g$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  for (const file of files) {
    const source = path.join(dir, file);
    const name = file.replace(/\.jpe?g$/i, '');
    const meta = readJpegMeta(fs.readFileSync(source));
    if (meta.orientation !== 1) {
      console.warn(`! ${set.dir}/${file} has EXIF orientation ${meta.orientation}; cwebp ignores it, so re-export the photo upright.`);
    }

    const full = path.join(outDir, `${name}.webp`);
    const small = path.join(outDir, `${name}-${SMALL_WIDTH}.webp`);
    if (isStale(full, source)) {
      run('cwebp', ['-quiet', '-q', '80', '-m', '6', source, '-o', full]);
      converted += 1;
    }
    if (isStale(small, source)) {
      run('cwebp', ['-quiet', '-q', '76', '-m', '6', '-resize', String(SMALL_WIDTH), '0', source, '-o', small]);
    }

    const { gps } = meta;
    photos.push({
      id: `${set.id}/${name}`,
      set: set.id,
      name,
      source: `${set.dir}/${file}`,
      width: meta.width,
      height: meta.height,
      color: averageColor(source),
      taken: meta.taken,
      camera: meta.camera,
      // Four decimal places is about eleven metres: enough to place a photo on a trail.
      gps: gps && {
        lat: round(gps.lat, 4),
        lon: round(gps.lon, 4),
        altitude: round(gps.altitude, 0),
        heading: round(gps.heading, 0),
        speed: round(gps.speed, 1),
        accuracy: round(gps.accuracy, 0),
      },
    });
  }
}

fs.rmSync(scratch, { recursive: true, force: true });
fs.writeFileSync(path.join(root, 'content/photos.json'), `${JSON.stringify(photos, null, 2)}\n`);

const located = photos.filter((photo) => photo.gps).length;
console.log(`${photos.length} photos · ${located} with a GPS fix · ${converted} converted to WebP`);
