// Reads everything under content/ and shapes it into one model for the templates.

import fs from 'node:fs';
import path from 'node:path';
import { epochSeconds, haversineKm, parseStamp } from './format.mjs';
import { parseBlocks, parseFrontMatter, parseQuotes } from './markdown.mjs';

const READING_SPEED = 230; // words per minute
const BURST_SECONDS = 30; // photos this close together are shown side by side

export function loadContent(root) {
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const readJson = (file) => JSON.parse(read(file));
  const warnings = [];

  const site = readJson('content/site.json');
  const gazetteer = readJson('content/places.json');
  const captions = readJson('content/captions.json');
  const placeById = new Map(gazetteer.places.map((place) => [place.id, place]));

  // ---- Photos ---------------------------------------------------------------
  const nearestPlace = (gps) => {
    let best = null;
    for (const place of gazetteer.places) {
      if (place.lat === undefined) continue;
      const km = haversineKm(gps, place);
      if (km <= place.radius && (!best || km < best.km)) best = { place, km };
    }
    return best && best.place;
  };

  const photos = readJson('content/photos.json').map((photo) => {
    const note = captions[photo.id] || {};
    let place = null;
    if (photo.gps) {
      place = nearestPlace(photo.gps);
      if (!place) warnings.push(`${photo.id} has a GPS fix that matches no entry in content/places.json`);
    } else if (note.place) {
      place = placeById.get(note.place) || null;
      if (!place) warnings.push(`${photo.id} is pinned to unknown place "${note.place}"`);
    }
    if (!note.alt) warnings.push(`${photo.id} has no alt text in content/captions.json`);
    return {
      ...photo,
      alt: note.alt || '',
      label: note.label || '',
      focus: note.focus || '',
      place,
      small: `assets/img/${photo.set}/${photo.name}-480.webp`,
      full: `assets/img/${photo.set}/${photo.name}.webp`,
      seconds: epochSeconds(photo.taken),
    };
  });

  // Some photos record a local time but no UTC offset (the ones without a GPS fix, mostly).
  // Read on its own such a time would be taken for UTC and sort hours late, so each borrows
  // the offset of the photo in its set that was taken nearest to it on the wall clock.
  const OFFSET = /[+-]\d{2}:\d{2}$/;
  const wallClock = (photo) => epochSeconds(photo.taken.replace(OFFSET, ''));
  for (const photo of photos) {
    if (!photo.taken || OFFSET.test(photo.taken)) continue;
    let nearest = null;
    for (const other of photos) {
      if (other.set !== photo.set || !other.taken || !OFFSET.test(other.taken)) continue;
      const gap = Math.abs(wallClock(other) - wallClock(photo));
      if (!nearest || gap < nearest.gap) nearest = { gap, offset: OFFSET.exec(other.taken)[0] };
    }
    if (nearest) photo.seconds = epochSeconds(photo.taken + nearest.offset);
  }

  const photoById = new Map(photos.map((photo) => [photo.id, photo]));
  const byTime = (a, b) => (a.seconds ?? -Infinity) - (b.seconds ?? -Infinity) || a.name.localeCompare(b.name);

  // ---- Albums ---------------------------------------------------------------
  const albums = readJson('content/albums.json').map((album) => {
    const own = photos.filter((photo) => photo.set === album.id).sort(byTime);
    const cover = photoById.get(album.cover.includes('/') ? album.cover : `${album.id}/${album.cover}`);
    if (!cover) warnings.push(`album "${album.id}" has no cover photo "${album.cover}"`);
    return { ...album, page: `${album.url}/index.html`, photos: own, cover };
  });

  const portraits = site.portraits.order.map((name) => photoById.get(`about/${name}`)).filter(Boolean);

  // ---- The third-person route -----------------------------------------------
  const journeyAlbum = albums.find((album) => album.layout === 'journey');
  const journey = journeyAlbum ? buildJourney(journeyAlbum, gazetteer) : null;

  // ---- Notes ----------------------------------------------------------------
  const notes = fs
    .readdirSync(path.join(root, 'content/notes'))
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const slug = file.replace(/\.md$/, '');
      const { data, body } = parseFrontMatter(read(`content/notes/${file}`));
      const blocks = parseBlocks(body);
      let paragraph = 0;
      for (const block of blocks) if (block.type === 'paragraph') block.id = `p${(paragraph += 1)}`;
      const words = blocks.reduce((sum, block) => sum + (block.type === 'paragraph' ? countWords(block.text) : 0), 0);
      return {
        kind: 'note',
        slug,
        page: `notes/${slug}/index.html`,
        ...data,
        blocks,
        sections: blocks.filter((block) => block.type === 'heading'),
        words,
        minutes: Math.max(1, Math.round(words / READING_SPEED)),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

  // ---- Quotes ---------------------------------------------------------------
  const quoteFile = parseFrontMatter(read('content/quotes.md'));
  const quotes = {
    kind: 'quotes',
    slug: 'quotes',
    page: 'notes/quotes/index.html',
    ...quoteFile.data,
    items: parseQuotes(quoteFile.body).map((quote, index) => ({ ...quote, id: `q${index + 1}`, number: index + 1 })),
  };

  // The notes index lists the quote collection alongside the books, newest first.
  const library = [...notes, quotes].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

  // ---- Projects -------------------------------------------------------------
  const projects = fs
    .readdirSync(path.join(root, 'content/projects'))
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const slug = file.replace(/\.md$/, '');
      const { data, body } = parseFrontMatter(read(`content/projects/${file}`));
      return { slug, page: `projects/${slug}/index.html`, ...data, blocks: parseBlocks(body) };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  // ---- Site-wide facts ------------------------------------------------------
  const located = photos.filter((photo) => photo.gps && photo.place && photo.seconds !== null);
  const lastSeen = located.sort((a, b) => b.seconds - a.seconds)[0] || null;

  return {
    site,
    photos,
    photoById,
    albums,
    portraits,
    journey,
    notes,
    quotes,
    library,
    projects,
    lastSeen,
    totals: {
      photos: photos.length,
      notes: notes.length,
      words: notes.reduce((sum, note) => sum + note.words, 0),
      minutes: notes.reduce((sum, note) => sum + note.minutes, 0),
      quotes: quotes.items.length,
      projects: projects.length,
    },
    warnings,
  };
}

const countWords = (text) => (text.match(/\S+/g) || []).length;

/** Order the album by capture time, group it into chapters, and measure it. */
function buildJourney(album, gazetteer) {
  const chapterTitle = new Map(gazetteer.chapters.map((chapter) => [chapter.id, chapter.title]));
  const frames = album.photos.map((photo, index) => ({
    photo,
    index,
    number: index + 1,
    anchor: `f-${photo.name}`,
    chapterId: (photo.place && photo.place.chapter) || null,
  }));

  // A photo with no known place stays in the chapter of the photo before it.
  frames.forEach((frame, i) => {
    if (!frame.chapterId) frame.chapterId = i > 0 ? frames[i - 1].chapterId : 'unplaced';
  });

  const chapters = [];
  for (const frame of frames) {
    let chapter = chapters[chapters.length - 1];
    if (!chapter || chapter.id !== frame.chapterId) {
      chapter = { id: frame.chapterId, title: chapterTitle.get(frame.chapterId) || 'Elsewhere', frames: [] };
      chapters.push(chapter);
    }
    chapter.frames.push(frame);
  }

  for (const chapter of chapters) {
    const dated = chapter.frames.filter((frame) => frame.photo.taken);
    chapter.first = dated.length ? dated[0].photo.taken : null;
    chapter.last = dated.length ? dated[dated.length - 1].photo.taken : null;

    // Group photos taken within a few seconds of each other.
    chapter.groups = [];
    for (const frame of chapter.frames) {
      const group = chapter.groups[chapter.groups.length - 1];
      const previous = group && group[group.length - 1];
      const close =
        previous &&
        group.length < 2 &&
        frame.photo.seconds !== null &&
        previous.photo.seconds !== null &&
        frame.photo.seconds - previous.photo.seconds <= BURST_SECONDS;
      if (close) group.push(frame);
      else chapter.groups.push([frame]);
    }
  }

  const fixes = frames.filter((frame) => frame.photo.gps);
  let km = 0;
  for (let i = 1; i < fixes.length; i += 1) km += haversineKm(fixes[i - 1].photo.gps, fixes[i].photo.gps);

  const dated = frames.filter((frame) => frame.photo.taken);
  const first = dated[0].photo.taken;
  const last = dated[dated.length - 1].photo.taken;
  const dayNumber = (stamp) => {
    const t = parseStamp(stamp);
    return Date.UTC(t.year, t.month - 1, t.day) / 86400000;
  };
  const altitudes = fixes.map((frame) => frame.photo.gps.altitude).filter((v) => v !== null);

  return {
    album,
    frames,
    chapters,
    first,
    last,
    stats: {
      frames: frames.length,
      fixes: fixes.length,
      countries: new Set(fixes.map((frame) => frame.photo.place && frame.photo.place.country).filter(Boolean)).size,
      days: dayNumber(last) - dayNumber(first) + 1,
      km,
      lowest: Math.min(...altitudes),
      highest: Math.max(...altitudes),
    },
  };
}
