import {
  capitalize,
  formatCoordinate,
  formatDate,
  formatDateRange,
  formatDotted,
  formatMonth,
  formatNumber,
  plural,
  spellNumber,
} from '../format.mjs';
import { esc, icon, leaders, linker, zoomable } from '../layout.mjs';
import { chartFrames, jsonScript } from './albums.mjs';

export function homePage(model) {
  const page = 'index.html';
  const to = linker(page);
  const { site, totals, lastSeen, journey, portraits, notes, quotes, albums } = model;

  // "I love life." set as three words so each can arrive on its own; the full stop is the marker.
  const words = site.tagline.replace(/\.$/, '').split(' ');
  const headline = words
    .map((word, i) => {
      const stop = i === words.length - 1 ? '<span class="hero__stop">.</span>' : '';
      return `<span class="hero__word" style="--i:${i}">${esc(word)}${stop}</span>`;
    })
    .join(' ');

  const strip = [
    lastSeen && ['Last seen', `${lastSeen.place.name}, ${lastSeen.place.area}`],
    lastSeen && ['Fix', `${formatCoordinate(lastSeen.gps.lat, 'lat', 2)} ${formatCoordinate(lastSeen.gps.lon, 'lon', 2)}`],
    lastSeen && ['Date', formatDate(lastSeen.taken)],
    ['On file', `${plural(totals.photos, 'photo')} · ${plural(totals.notes, 'book')} · ${plural(totals.quotes, 'quote')}`],
  ]
    .filter(Boolean)
    .map(([term, value]) => `<div><dt>${term}</dt><dd>${esc(value)}</dd></div>`)
    .join('\n          ');

  const triptych = portraits
    .map((photo, i) => {
      const caption = `${photo.label} · ${formatMonth(photo.taken)}`;
      return `<figure class="triptych__item triptych__item--${i + 1}">
            ${zoomable(photo, to, { caption, group: 'about', sizes: '(max-width: 720px) 92vw, 30vw', eager: true })}
            <figcaption>${esc(photo.label)} <span>${esc(formatMonth(photo.taken))}</span></figcaption>
          </figure>`;
    })
    .join('\n          ');

  const albumPhotos = albums.reduce((sum, album) => sum + album.photos.length, 0);
  const rows = [
    {
      name: 'Albums',
      href: to('albums.html'),
      desc: 'Photos from behind, stray cats, and a wall that moves.',
      meta: plural(albumPhotos, 'photo'),
    },
    {
      name: 'Notes',
      href: to('notes.html'),
      desc: 'What I kept from the books I read.',
      meta: `${plural(totals.notes, 'book')} · ${formatNumber(totals.words)} words`,
    },
    {
      name: 'Projects',
      href: to('projects.html'),
      desc: 'Selected work.',
      meta: plural(totals.projects, 'project'),
    },
    {
      name: 'Quotes',
      href: to(quotes.page),
      desc: quotes.subtitle,
      meta: plural(totals.quotes, 'quote'),
    },
  ]
    .map(
      (row, i) => `<li>
            <a class="contents__row" href="${row.href}">
              <span class="contents__no">${String(i + 1).padStart(2, '0')}</span>
              <span class="contents__name">${row.name}</span>
              <span class="contents__desc">${esc(row.desc)}</span>
              <span class="contents__meta">${esc(row.meta)}</span>
              ${icon('arrow', 'icon contents__arrow')}
            </a>
          </li>`,
    )
    .join('\n          ');

  const { stats } = journey;
  const stops = journey.chapters
    .filter((chapter) => chapter.frames.some((frame) => frame.photo.gps))
    .map((chapter) => chapter.title)
    .join(', ');
  const band = `<section class="band" aria-labelledby="band-title">
        <div class="wrap band__grid">
          <div class="band__text">
            <p class="label">Album · ${esc(journey.album.title)}</p>
            <h2 class="band__title" id="band-title">${capitalize(spellNumber(stats.frames))} photos from behind, and the map they drew.</h2>
            <p class="band__lede">Each photo still remembers where it was taken, how high up, and which way the camera was pointing. Put in order, they trace a route through ${spellNumber(stats.countries)} countries.</p>
            <dl class="figures">
              <div><dt>Frames</dt><dd>${stats.frames}</dd></div>
              <div><dt>Countries</dt><dd>${stats.countries}</dd></div>
              <div><dt>Days</dt><dd>${stats.days}</dd></div>
              <div><dt>Km between fixes</dt><dd>${formatNumber(stats.km)}</dd></div>
            </dl>
            <a class="button" href="${to(journey.album.page)}">Follow the route ${icon('arrow')}</a>
          </div>
          <div class="band__chart" data-chart="overview" data-album="${to(journey.album.page)}">
            <canvas class="chart" role="img" aria-label="Chart of the route: ${esc(stops)}."></canvas>
            <p class="band__readout label" data-chart-readout>${esc(formatDateRange(journey.first, journey.last))}</p>
            <script type="application/json" data-chart-frames>${jsonScript(chartFrames(journey, to))}</script>
          </div>
        </div>
      </section>`;

  const latest = leaders(
    notes.slice(0, 6).map((note) => ({
      href: to(note.page),
      title: esc(note.title),
      sub: note.author ? esc(note.author) : '',
      meta: formatDotted(note.date),
    })),
  );

  // Attributed quotes rotate here; the full collection lives on its own page.
  const rotation = quotes.items.filter((quote) => quote.cite && quote.text.length <= 180);
  const featured = rotation.find((quote) => quote.cite.includes('Thoreau')) || rotation[0];
  const quoteData = rotation.map((quote) => ({ html: quote.html, cite: quote.cite }));

  const body = `      <section class="hero wrap">
        <h1 class="hero__heading">
          <span class="hero__name label">${esc(site.name)}</span>
          <span class="hero__title">${headline}</span>
        </h1>
        <dl class="strip">
          ${strip}
        </dl>
      </section>

      <section class="about wrap" aria-label="About">
        <div class="about__text">
          <p class="label">About</p>
          <p class="about__bio">${esc(site.bio)}</p>
          <p class="about__links">
            ${site.links.map((link) => `<a class="link-out" href="${esc(link.url)}" target="_blank" rel="noreferrer">${esc(link.label)}${icon('arrow-out', 'icon icon--inline')}</a>`).join('\n            ')}
          </p>
        </div>
        <div class="triptych">
          ${triptych}
        </div>
      </section>

      <section class="contents wrap" aria-labelledby="contents-title">
        <h2 class="label" id="contents-title">Contents</h2>
        <ol class="contents__list">
          ${rows}
        </ol>
      </section>

      ${band}

      <section class="reading wrap">
        <div class="reading__notes">
          <h2 class="label">Latest notes</h2>
          ${latest}
          <a class="more" href="${to('notes.html')}">All ${totals.notes} notes ${icon('arrow')}</a>
        </div>
        <div class="pullquote" data-quotes>
          <p class="label">From the quote collection</p>
          <figure class="pullquote__figure">
            <blockquote class="pullquote__text" data-quote-text aria-live="polite"><p>${featured.html}</p></blockquote>
            <figcaption class="pullquote__cite" data-quote-cite>${esc(featured.cite)}</figcaption>
          </figure>
          <p class="pullquote__actions">
            <button class="text-button" type="button" data-quote-next hidden>Another</button>
            <a class="more" href="${to(quotes.page)}">All ${totals.quotes} quotes ${icon('arrow')}</a>
          </p>
          <script type="application/json" data-quote-list>${jsonScript(quoteData)}</script>
        </div>
      </section>`;

  return { page, section: 'about', kind: 'home', title: '', description: site.description, body, scripts: ['assets/chart.js'] };
}
