import { formatDate, formatDotted, formatNumber, plural } from '../format.mjs';
import { esc, icon, leaders, linker, pageHead } from '../layout.mjs';
import { typeset } from '../markdown.mjs';

const text = (value) => esc(typeset(value));

const byline = (note) => [note.author, note.year].filter(Boolean).join(', ');

const quoteWords = (quotes) => quotes.items.reduce((sum, quote) => sum + quote.text.split(/\s+/).length, 0);

// ---- Notes index: the shelf and the list ---------------------------------------

/** Deterministic 0..1 value from a string, so the shelf looks the same on every build. */
function unit(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

function shelf(model, to) {
  const cloths = ['a', 'b', 'c', 'd', 'e'];
  const spines = model.library
    .map((entry, i) => {
      const words = entry.kind === 'quotes' ? quoteWords(entry) : entry.words;
      const tall = (0.84 + unit(entry.slug) * 0.16).toFixed(3);
      const cloth = entry.kind === 'quotes' ? 'q' : cloths[(i * 3) % cloths.length];
      return `<a class="spine spine--${cloth}" href="${to(entry.page)}" tabindex="-1" style="--words:${words};--tall:${tall};--i:${i}">
            <span class="spine__title">${text(entry.title)}</span>
          </a>`;
    })
    .join('\n          ');

  // The list below carries the same links for keyboards and screen readers.
  return `<div class="shelf" aria-hidden="true">
          ${spines}
        </div>
        <p class="shelf__key label">Spine width = how much I wrote down</p>`;
}

export function notesIndexPage(model) {
  const page = 'notes.html';
  const to = linker(page);
  const { library, totals } = model;

  const list = leaders(
    library.map((entry) => ({
      href: to(entry.page),
      title: text(entry.title),
      sub: entry.kind === 'quotes' ? plural(totals.quotes, 'quote') : text(byline(entry)),
      meta: entry.kind === 'quotes' ? formatDotted(entry.date) : `${entry.minutes} min · ${formatDotted(entry.date)}`,
    })),
  );

  const body = `      <div class="wrap">
        ${pageHead({
          title: 'Notes',
          lede: 'Short notes.',
          label: `${plural(totals.notes, 'book')} · ${formatNumber(totals.words)} words · ${plural(totals.quotes, 'quote')}`,
        })}
        ${shelf(model, to)}
        ${list}
      </div>`;

  return { page, section: 'notes', kind: 'notes', title: 'Notes', description: 'Notes by Jack Babcock.', body };
}

// ---- A single note ---------------------------------------------------------------

function pager(model, entry, to) {
  const index = model.library.indexOf(entry);
  const previous = model.library[index - 1];
  const next = model.library[index + 1];
  const cell = (item, direction) =>
    item
      ? `<a class="pager__link pager__link--${direction}" href="${to(item.page)}" rel="${direction === 'next' ? 'next' : 'prev'}">
            <span class="label">${direction === 'next' ? 'Next' : 'Previous'}</span>
            <span class="pager__title">${text(item.title)}</span>
          </a>`
      : '<span></span>';
  return `<nav class="wrap" aria-label="More notes">
        <div class="pager">
          ${cell(previous, 'previous')}
          ${cell(next, 'next')}
        </div>
      </nav>`;
}

export function notePage(model, note) {
  const page = note.page;
  const to = linker(page);

  const prose = note.blocks
    .map((block, i) => {
      if (block.type === 'heading') return `<h2 id="${block.id}">${block.html}</h2>`;
      const lead = i === 0 && /^[A-Z]/.test(block.text) ? ' class="has-initial"' : '';
      return `<p id="${block.id}"${lead}>${block.html}</p>`;
    })
    .join('\n          ');

  const toc =
    note.sections.length >= 2
      ? `<nav class="note__toc" aria-label="Sections">
          <p class="label">Sections</p>
          <ol>
            ${note.sections.map((section) => `<li><a href="#${section.id}">${section.html}</a></li>`).join('\n            ')}
          </ol>
        </nav>`
      : '';

  const by = [byline(note), note.subtitle].filter(Boolean).map(text);

  const body = `      <div class="progress" aria-hidden="true"><span data-progress></span></div>
      <article class="wrap note${toc ? ' note--sectioned' : ''}">
        <header class="note__head">
          <a class="back" href="${to('notes.html')}">${icon('arrow', 'icon icon--back')}notes</a>
          <p class="label">Notes · ${esc(formatDate(note.date))} · ${formatNumber(note.words)} words · ${note.minutes} min</p>
          <h1 class="note__title">${text(note.title)}</h1>
          ${by.length ? `<p class="note__by">${by.map((part, i) => (i === 0 ? `<span>${part}</span>` : `<span class="note__sub">${part}</span>`)).join(' ')}</p>` : ''}
        </header>
        ${toc}
        <div class="prose">
          ${prose}
        </div>
      </article>
      ${pager(model, note, to)}`;

  return { page, section: 'notes', kind: 'note', title: typeset(note.title), description: note.description, body };
}

// ---- Quotes ----------------------------------------------------------------------

/** Short quotes are set large and long ones small, so the page builds its own hierarchy. */
function quoteScale(quote) {
  const length = quote.text.length;
  const lines = quote.html.split('<br>').length;
  if (lines > 1) return 'm';
  if (length <= 30) return 'xl';
  if (length <= 70) return 'l';
  if (length <= 150) return 'm';
  return 's';
}

export function quotesPage(model) {
  const { quotes } = model;
  const page = quotes.page;
  const to = linker(page);

  // A quote left on its own between two headline quotes takes the full width too.
  const scales = quotes.items.map(quoteScale);
  const alone = (i) => scales[i] !== 'xl' && (i === 0 || scales[i - 1] === 'xl') && (i === scales.length - 1 || scales[i + 1] === 'xl');

  const items = quotes.items
    .map(
      (quote, i) => `<li class="quote quote--${scales[i]}${alone(i) ? ' quote--wide' : ''}" id="${quote.id}">
            <blockquote><p>${quote.html}</p></blockquote>
            <p class="quote__foot"><a class="quote__no" href="#${quote.id}" aria-label="Link to quote ${quote.number}">Nº ${String(quote.number).padStart(2, '0')}</a>${quote.cite ? `<cite>${text(quote.cite)}</cite>` : ''}</p>
          </li>`,
    )
    .join('\n          ');

  const body = `      <div class="wrap">
        ${pageHead({
          back: { href: to('notes.html'), label: 'notes' },
          label: `Notes · ${esc(formatDate(quotes.date))} · ${plural(quotes.items.length, 'quote')}`,
          title: text(quotes.title),
          lede: text(quotes.subtitle),
        })}
        <ol class="quotes">
          ${items}
        </ol>
      </div>
      ${pager(model, quotes, to)}`;

  return { page, section: 'notes', kind: 'quotes', title: quotes.title, description: quotes.description, body };
}
