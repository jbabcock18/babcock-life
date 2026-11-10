#!/usr/bin/env node
// Builds the site: content/ (Markdown and JSON) + src/ (templates) -> static HTML.
//
//   node build.mjs            write every page
//   node tools/photos.mjs     first, if photos were added or replaced
//
// No dependencies. The pages are written in place (index.html, notes/<slug>/index.html, ...)
// so the folder can be served as it is, opened from disk, or hosted under any path.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from './src/content.mjs';
import { renderPage } from './src/layout.mjs';
import { albumsIndexPage, journeyPage, specimensPage, wallPage } from './src/pages/albums.mjs';
import { colophonPage } from './src/pages/colophon.mjs';
import { homePage } from './src/pages/home.mjs';
import { notePage, notesIndexPage, quotesPage } from './src/pages/notes.mjs';
import { projectPage, projectsIndexPage } from './src/pages/projects.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const model = loadContent(root);

// Search index: every page, note paragraph, quote and place, loaded when search is first opened.
function searchIndex() {
  const entries = [];
  const add = (entry) => entries.push(entry);

  for (const item of model.site.nav) add({ kind: 'Page', title: item.label, url: item.url });
  add({ kind: 'Page', title: 'colophon', url: 'colophon.html' });

  for (const note of model.notes) {
    add({
      kind: 'Note',
      title: note.title,
      sub: [note.author, note.subtitle].filter(Boolean).join(' · '),
      url: note.page,
      body: note.blocks.map((block) => [block.id, block.text]),
    });
  }
  add({ kind: 'Note', title: model.quotes.title, sub: `${model.quotes.items.length} quotes`, url: model.quotes.page });
  for (const quote of model.quotes.items) {
    add({ kind: 'Quote', title: quote.text, sub: quote.cite, url: `${model.quotes.page}#${quote.id}` });
  }

  for (const project of model.projects) add({ kind: 'Project', title: project.title, sub: project.summary, url: project.page });
  for (const album of model.albums) add({ kind: 'Album', title: album.title, sub: album.description, url: album.page });

  // One entry per named place on the route, pointing at its first photo.
  const seen = new Set();
  for (const frame of model.journey.frames) {
    const place = frame.photo.place;
    if (!place || seen.has(place.id)) continue;
    seen.add(place.id);
    const count = model.journey.frames.filter((other) => other.photo.place === place).length;
    add({
      kind: 'Place',
      title: place.name,
      sub: [place.area, place.country].filter((part) => part && part !== place.name).join(', ') + ` · ${count} photo${count === 1 ? '' : 's'}`,
      url: `${model.journey.album.page}#${frame.anchor}`,
    });
  }
  return `window.BL_SEARCH=${JSON.stringify(entries)};\n`;
}

function write(file, contents) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

write('assets/search-index.js', searchIndex());

// One version stamp for all assets, so a deploy never serves stale CSS or scripts.
const assetFiles = ['assets/site.css', 'assets/site.js', 'assets/chart.js', 'assets/chart/base.js', 'assets/chart/detail.js', 'assets/search-index.js'];
const sizeOf = (file) => (fs.existsSync(path.join(root, file)) ? fs.statSync(path.join(root, file)).size : 0);
const hash = createHash('sha1');
for (const file of assetFiles) if (sizeOf(file)) hash.update(fs.readFileSync(path.join(root, file)));
const version = hash.digest('hex').slice(0, 8);

const albumPage = { journey: journeyPage, specimens: specimensPage, wall: wallPage };
const pages = [
  homePage(model),
  projectsIndexPage(model),
  ...model.projects.map((project) => projectPage(model, project)),
  notesIndexPage(model),
  ...model.notes.map((note) => notePage(model, note)),
  quotesPage(model),
  albumsIndexPage(model),
  ...model.albums.map((album) => albumPage[album.layout](model, album)),
];
pages.push(
  colophonPage(model, {
    pages: pages.length + 1,
    css: sizeOf('assets/site.css'),
    js: sizeOf('assets/site.js'),
    chart: sizeOf('assets/chart.js'),
  }),
);

for (const page of pages) write(page.page, renderPage({ model, version, ...page }));

// Every local link, image and script in the output must point at a file that exists.
const broken = [];
for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page.page), 'utf8');
  const dir = path.dirname(path.join(root, page.page));
  const targets = new Set();
  for (const match of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) targets.add(match[1]);
  for (const match of html.matchAll(/\ssrcset="([^"]+)"/g)) {
    for (const candidate of match[1].split(',')) targets.add(candidate.trim().split(/\s+/)[0]);
  }
  for (const target of targets) {
    if (/^(https?:|mailto:|#|data:)/.test(target)) continue;
    const file = decodeURIComponent(target.split(/[?#]/)[0]);
    if (!fs.existsSync(path.resolve(dir, file))) broken.push(`${page.page} -> ${target}`);
  }
}

for (const warning of model.warnings) console.warn(`! ${warning}`);
for (const link of broken) console.error(`✗ broken link: ${link}`);
console.log(`${pages.length} pages · ${model.notes.length} notes · ${model.totals.photos} photos · assets ${version}`);
if (broken.length) process.exitCode = 1;
