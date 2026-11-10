import {
  capitalize,
  compassPoint,
  formatCoordinate,
  formatDate,
  formatDateRange,
  formatNumber,
  formatTime,
  plural,
  roman,
  spellNumber,
} from '../format.mjs';
import { esc, image, linker, pageHead, zoomable } from '../layout.mjs';

export const jsonScript = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

/** "Manarola" + "Cinque Terre, Italy" */
function placeLines(place) {
  if (!place) return { name: 'Somewhere', area: '' };
  const area = [place.area, place.name === place.country ? '' : place.country].filter(Boolean).join(', ');
  return { name: place.name, area };
}

const when = (photo) => [formatDate(photo.taken), formatTime(photo.taken)].filter(Boolean).join(' · ') || 'Undated';

const zoomCaption = (photo) => {
  const { name, area } = placeLines(photo.place);
  return [[name, area].filter(Boolean).join(', '), when(photo)].join(' · ');
};

const position = (gps) => (gps ? `${formatCoordinate(gps.lat, 'lat')} ${formatCoordinate(gps.lon, 'lon')}` : 'No GPS fix');
const altitude = (gps) => (gps && gps.altitude !== null ? `${gps.altitude} m` : '\u2014');
const facing = (gps) => (gps && gps.heading !== null ? `${gps.heading}\u00b0 ${compassPoint(gps.heading)}` : '\u2014');

/** What the chart needs to know about each frame of the route. The text is formatted here, once. */
export function chartFrames(journey, to) {
  const chapterTitle = new Map(journey.chapters.map((chapter) => [chapter.id, chapter.title]));
  return journey.frames.map((frame) => {
    const { photo } = frame;
    const { gps } = photo;
    const { name, area } = placeLines(photo.place);
    return {
      n: frame.number,
      anchor: frame.anchor,
      fix: gps ? [gps.lat, gps.lon] : null,
      hdg: gps ? gps.heading : null,
      acc: gps ? gps.accuracy : null,
      chapter: chapterTitle.get(frame.chapterId) || '',
      place: name,
      area,
      date: formatDate(photo.taken),
      when: when(photo),
      pos: position(gps),
      alt: altitude(gps),
      facing: facing(gps),
    };
  });
}

// ---- Albums index ------------------------------------------------------------

export function albumsIndexPage(model) {
  const page = 'albums.html';
  const to = linker(page);
  const { albums, journey, photos } = model;

  const tiles = albums
    .map((album) => {
      let meta = plural(album.photos.length, 'photo');
      if (album.layout === 'journey') meta += ` · ${formatDateRange(journey.first, journey.last)}`;
      if (album.layout === 'wall') meta = `${plural(photos.length, 'photo')} · animated`;
      return `<li class="tile tile--${album.layout}">
            <a class="tile__link" href="${to(album.page)}">
              <div class="tile__cover">${image(album.cover, to, { sizes: '(max-width: 720px) 92vw, 30vw', eager: true })}</div>
              <h2 class="tile__title">${esc(album.title)}</h2>
              <p class="tile__desc">${esc(album.description)}</p>
              <p class="label tile__meta">${esc(meta)}</p>
            </a>
          </li>`;
    })
    .join('\n          ');

  const body = `      <div class="wrap">
        ${pageHead({ title: 'Albums', lede: 'Photo albums.', label: `${plural(albums.length, 'album')} · ${plural(photos.length, 'photo')}` })}
        <ol class="tiles">
          ${tiles}
        </ol>
      </div>`;

  return { page, section: 'albums', kind: 'albums', title: 'Albums', description: 'Photo albums by Jack Babcock.', body };
}

// ---- 3rd Person: the route -----------------------------------------------------

function frameFigure(frame, to) {
  const { photo } = frame;
  const { name } = placeLines(photo.place);
  const shape = photo.width > photo.height ? 'landscape' : photo.height / photo.width > 1.5 ? 'tall' : 'portrait';
  const noFix = photo.gps ? '' : '<span class="frame__flag">no GPS fix</span>';
  return `<figure class="frame frame--${shape}" id="${frame.anchor}" data-frame="${frame.index}">
                ${zoomable(photo, to, { caption: zoomCaption(photo), group: 'route', sizes: '(max-width: 900px) 92vw, 44vw', eager: frame.index < 2 })}
                <figcaption class="frame__cap">
                  <span class="frame__no">${String(frame.number).padStart(2, '0')}</span>
                  <span class="frame__place">${esc(name)}</span>
                  <span class="frame__when">${esc(when(photo))}</span>${noFix}
                </figcaption>
              </figure>`;
}

function hud(journey) {
  const { frames, stats } = journey;
  const first = frames[0].photo;
  const { name, area } = placeLines(first.place);

  // Altitude profile: one bar per frame, a short tick where there is no fix.
  const step = 6;
  const height = 34;
  const bars = frames
    .map((frame) => {
      const altitude = frame.photo.gps ? frame.photo.gps.altitude : null;
      const h = altitude === null ? 1 : Math.max(2, (altitude / stats.highest) * height);
      return `<rect class="${altitude === null ? 'is-blind' : ''}" data-bar="${frame.index}" x="${frame.index * step + 1}" y="${(height - h).toFixed(1)}" width="${step - 2}" height="${h.toFixed(1)}"/>`;
    })
    .join('');

  return `<aside class="hud" data-chart="journey" aria-label="Chart and readings for the current photo">
          <div class="hud__chart">
            <canvas class="chart" aria-hidden="true"></canvas>
            <button class="hud__mode" type="button" data-chart-mode aria-pressed="false">Whole route</button>
          </div>
          <div class="hud__panel">
            <p class="hud__count label"><span data-hud="index">01</span> / ${String(frames.length).padStart(2, '0')}</p>
            <p class="hud__place" data-hud="place">${esc(name)}</p>
            <p class="hud__area" data-hud="area">${esc(area)}</p>
            <dl class="hud__data">
              <div><dt>Time</dt><dd data-hud="time">${esc(when(first))}</dd></div>
              <div><dt>Position</dt><dd data-hud="pos">${position(first.gps)}</dd></div>
              <div><dt>Altitude</dt><dd data-hud="alt">${altitude(first.gps)}</dd></div>
              <div><dt>Facing</dt><dd data-hud="hdg">${facing(first.gps)}</dd></div>
            </dl>
            <figure class="hud__profile">
              <svg viewBox="0 0 ${frames.length * step} ${height}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>
              <figcaption class="label">Altitude, ${stats.lowest}\u2013${stats.highest} m</figcaption>
            </figure>
          </div>
        </aside>`;
}

export function journeyPage(model, album) {
  const page = album.page;
  const to = linker(page);
  const { journey } = model;
  const { stats } = journey;

  let solo = 0;
  const chapters = journey.chapters
    .map((chapter, i) => {
      const groups = chapter.groups
        .map((group) => {
          if (group.length > 1) {
            return `<div class="frames__pair">
              ${group.map((frame) => frameFigure(frame, to)).join('\n              ')}
            </div>`;
          }
          const side = (solo += 1) % 2 ? 'left' : 'right';
          return `<div class="frames__solo frames__solo--${side}">
              ${frameFigure(group[0], to)}
            </div>`;
        })
        .join('\n            ');
      const dates = chapter.first ? formatDateRange(chapter.first, chapter.last) : 'Undated';
      return `<section class="chapter" id="ch-${chapter.id}" aria-labelledby="ch-${chapter.id}-title">
            <header class="chapter__head">
              <span class="chapter__no" aria-hidden="true">${roman(i + 1)}</span>
              <h2 class="chapter__title" id="ch-${chapter.id}-title">${esc(chapter.title)}</h2>
              <p class="label">${esc(dates)} · ${plural(chapter.frames.length, 'photo')}</p>
            </header>
            ${groups}
          </section>`;
    })
    .join('\n          ');

  const intro = `${capitalize(spellNumber(stats.frames))} photos, in the order they were taken. ${capitalize(spellNumber(stats.fixes))} of them still carry a GPS fix, an altitude and the compass bearing of the lens, so the chart keeps up as you scroll.`;

  const body = `      <div class="wrap">
        ${pageHead({
          back: { href: to('albums.html'), label: 'albums' },
          label: `Album · ${plural(stats.frames, 'photo')} · ${esc(formatDateRange(journey.first, journey.last))}`,
          title: esc(album.heading),
          lede: esc(album.description),
          wide: true,
        })}
        <div class="route">
          <div class="route__stream">
            <p class="route__intro">${esc(intro)}</p>
            <dl class="figures figures--inline">
              <div><dt>Countries</dt><dd>${stats.countries}</dd></div>
              <div><dt>Days</dt><dd>${stats.days}</dd></div>
              <div><dt>Km between fixes</dt><dd>${formatNumber(stats.km)}</dd></div>
              <div><dt>Highest</dt><dd>${stats.highest} m</dd></div>
            </dl>
          ${chapters}
          </div>
          ${hud(journey)}
        </div>
        <script type="application/json" data-chart-frames>${jsonScript(chartFrames(journey, to))}</script>
      </div>`;

  return {
    page,
    section: 'albums',
    kind: 'route',
    title: album.heading,
    description: 'Third-person photos by Jack Babcock.',
    body,
    scripts: ['assets/chart.js'],
  };
}

// ---- Cats ----------------------------------------------------------------------

export function specimensPage(model, album) {
  const page = album.page;
  const to = linker(page);

  const cards = album.photos
    .map((photo, i) => {
      const { name, area } = placeLines(photo.place);
      const position = photo.gps
        ? `${formatCoordinate(photo.gps.lat, 'lat', 2)} ${formatCoordinate(photo.gps.lon, 'lon', 2)}`
        : 'No GPS fix';
      return `<li class="specimen">
            <figure>
              ${zoomable(photo, to, { caption: zoomCaption(photo), group: 'cats', sizes: '(max-width: 720px) 92vw, 22vw', eager: i < 2 })}
              <figcaption>
                <p class="label">Sighting Nº ${i + 1}</p>
                <p class="specimen__place">${esc(photo.label || name)}</p>
                <p class="specimen__area">${esc(photo.label ? [name, area].filter(Boolean).join(', ') : area)}</p>
                <dl class="specimen__data">
                  <div><dt>Date</dt><dd>${esc(formatDate(photo.taken))}</dd></div>
                  <div><dt>Time</dt><dd>${esc(formatTime(photo.taken))}</dd></div>
                  <div><dt>Position</dt><dd>${position}</dd></div>
                </dl>
              </figcaption>
            </figure>
          </li>`;
    })
    .join('\n          ');

  const body = `      <div class="wrap">
        ${pageHead({
          back: { href: to('albums.html'), label: 'albums' },
          label: `Album · ${plural(album.photos.length, 'photo')}`,
          title: esc(album.heading),
          lede: esc(album.description),
        })}
        <ol class="specimens">
          ${cards}
        </ol>
      </div>`;

  return { page, section: 'albums', kind: 'specimens', title: album.heading, description: 'Cat photos by Jack Babcock.', body };
}

// ---- Moving wall ---------------------------------------------------------------

/** A stable shuffle so the wall mixes the albums but never changes between builds. */
function shuffled(photos) {
  const hash = (text) => {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  return [...photos].sort((a, b) => hash(a.id) - hash(b.id));
}

export function wallPage(model, album) {
  const page = album.page;
  const to = linker(page);

  const tiles = shuffled(model.photos)
    .map(
      (photo) =>
        `<li class="wall__tile">${zoomable(photo, to, { caption: zoomCaption(photo), group: 'wall', sizes: '(max-width: 720px) 46vw, 24vw' })}</li>`,
    )
    .join('\n            ');

  const body = `      <div class="wrap wall-head">
        ${pageHead({
          back: { href: to('albums.html'), label: 'albums' },
          label: `Album · ${plural(model.photos.length, 'photo')} · animated`,
          title: esc(album.heading),
          lede: esc(album.description),
        })}
        <button class="text-button wall__pause" type="button" data-wall-toggle aria-pressed="false" hidden>Pause</button>
      </div>
      <section class="wall" data-wall aria-label="Moving wall of photos">
        <ol class="wall__list">
            ${tiles}
        </ol>
      </section>`;

  return { page, section: 'albums', kind: 'wall', title: album.heading, description: 'A moving wall of photos by Jack Babcock.', body };
}
