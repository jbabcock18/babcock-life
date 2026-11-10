import { formatNumber, plural } from '../format.mjs';
import { linker, pageHead } from '../layout.mjs';

export function colophonPage(model, facts) {
  const page = 'colophon.html';
  const to = linker(page);
  const { journey, totals } = model;
  const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
  const routeUrl = to(journey.album.page);

  const body = `      <article class="wrap colophon">
        ${pageHead({ title: 'Colophon', lede: 'How this site was made.', label: 'About the site' })}
        <div class="colophon__grid">
          <section>
            <h2>Who made what</h2>
            <p>The photos, notes, quotes and projects are Jack’s. The design, the code and the charts were made in November 2026 by Fable 5.2, an AI model working in Cursor. The brief was one sentence long: re-imagine the site to show what the model can do.</p>
            <p>It started by reading everything already here: ${plural(totals.notes, 'set')} of book notes, ${plural(totals.quotes, 'quote')}, ${plural(totals.photos, 'photo')} and a blue rosette. The rosette set the palette. The photos turned out to hold the rest.</p>
          </section>

          <section>
            <h2>The chart reads the photos</h2>
            <p>Nobody typed in where the <a href="${routeUrl}">3rd Person</a> photos were taken. ${journey.stats.fixes} of the ${journey.stats.frames} files still carry what the phone recorded: latitude, longitude, altitude, the compass bearing of the lens, even walking speed. A small EXIF reader written for this site pulls that out, puts the photos in the order they were taken, and groups shots a few seconds apart into pairs.</p>
            <p>The chart is drawn on a canvas, with no map library and no tiles. Coastlines at continent scale come from Natural Earth. Close up they come from OpenStreetMap, along with lakes, rivers and village names. The lines on the water side of every shore are an old engraver’s habit, added because the data knows which side of a coastline is sea. Photos without a fix say so, and the marker waits at the last known position.</p>
          </section>

          <section>
            <h2>Things to try</h2>
            <ul>
              <li>Press <kbd data-shortcut>⌘K</kbd> anywhere to search every note and quote, down to the paragraph.</li>
              <li>Scroll <a href="${routeUrl}">3rd Person</a> and watch the chart, or click a dot on it to jump to that photo.</li>
              <li>On the <a href="${to('notes.html')}">notes shelf</a>, the width of each spine is the length of the notes inside.</li>
              <li>Scroll over the <a href="${to('albums/editorial-feed/index.html')}">moving wall</a> to push it along.</li>
              <li>Switch between the porcelain and cyanotype themes with the half-circle in the header.</li>
            </ul>
          </section>

          <section>
            <h2>How it is built</h2>
            <p>Plain HTML, CSS and JavaScript. No framework, no runtime dependencies, nothing fetched from another server. A build script written in Node turns Markdown and JSON into ${plural(facts.pages, 'page')}; adding a note means adding one text file.</p>
            <dl class="colophon__facts">
              <div><dt>Stylesheet</dt><dd>${kb(facts.css)}</dd></div>
              <div><dt>Scripts, every page</dt><dd>${kb(facts.js)}</dd></div>
              <div><dt>Chart engine</dt><dd>${kb(facts.chart)}</dd></div>
              <div><dt>Words of notes</dt><dd>${formatNumber(totals.words)}</dd></div>
            </dl>
            <p>It works without JavaScript, from a folder on disk, with a keyboard, and with motion turned off.</p>
          </section>

          <section>
            <h2>Type and colour</h2>
            <p>Headlines are set in Bodoni Moda, text in Source Serif 4, and data in IBM Plex Mono. All three are open-source typefaces served from this site. The blue is the blue of the rosette. The one red dot is the marker: the full stop on the home page, the active page in the menu, the position on the chart.</p>
          </section>

          <section>
            <h2>Credits</h2>
            <p>Coastline data: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a>, public domain. Close-up shores, lakes, rivers and place names: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors, under the Open Database License. Typefaces under the SIL Open Font License.</p>
          </section>
        </div>
      </article>`;

  return { page, section: '', kind: 'colophon', title: 'Colophon', description: 'How this site was made.', body };
}
