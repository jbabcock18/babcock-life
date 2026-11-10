// Content files are plain text with a small, predictable subset of Markdown:
//
//   ---                      front matter: one "key: value" per line
//   title: Endurance
//   ---
//   ## Section heading
//   A paragraph with *emphasis*, **strong text** and [a link](https://example.com).
//   Put a backslash before a literal asterisk or bracket: \*like this\*.
//
// Nothing else is interpreted. A paragraph that starts with "1." stays a paragraph.

export const escapeHtml = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function parseFrontMatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!match) return { data: {}, body: source };
  const data = {};
  for (const line of match[1].split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) data[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { data, body: source.slice(match[0].length) };
}

// Words that begin with an apostrophe rather than an opening quote.
const ELISION = /^(cause\b|em\b|til\b|tis\b|twas\b|n'|\d)/i;

/** Curly quotes, real ellipses and en dashes for ranges. Wording is never changed. */
export function typeset(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const prev = out[out.length - 1] || ' ';
    const opens = /[\s([{\u2014\u2013\-*\u201c\u2018]/.test(prev);
    if (ch === '"') {
      out += opens ? '\u201c' : '\u201d';
    } else if (ch === "'") {
      const startsWord = opens && !ELISION.test(text.slice(i + 1));
      out += startsWord ? '\u2018' : '\u2019';
    } else {
      out += ch;
    }
  }
  return out
    .replace(/\.\.\./g, '\u2026')
    .replace(/(\d)-(?=\d)/g, '$1\u2013')
    .replace(/(\s)-(\s)/g, '$1\u2013$2');
}

const HOLD = '\uE000'; // private-use marker for text that must pass through untouched

/** Inline Markdown to HTML. */
export function renderInline(source) {
  const held = [];
  const hold = (html) => `${HOLD}${held.push(html) - 1}${HOLD}`;

  let text = source.replace(/\\([\\*[\]])/g, (_, ch) => hold(escapeHtml(ch)));
  text = text.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, label, url) =>
    hold(`<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${renderInline(label)}</a>`),
  );
  text = escapeHtml(typeset(text)).replace(/&quot;/g, '"');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
  return text.replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, 'g'), (_, i) => held[Number(i)]);
}

/** The same text with the markup removed: used for counting, searching and excerpts. */
export function plainText(source) {
  return source
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1')
    .replace(/\\([\\*[\]])/g, `${HOLD}$1`)
    .replace(/(?<!\uE000)\*+/g, '')
    .replace(new RegExp(HOLD, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const slugify = (text) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Split a note body into headings and paragraphs. */
export function parseBlocks(body) {
  const blocks = [];
  const used = new Set();
  for (const chunk of body.split(/\n{2,}/)) {
    const text = chunk.trim();
    if (!text) continue;
    const heading = /^##\s+(.+)$/.exec(text);
    if (heading) {
      const title = plainText(heading[1]);
      let id = `s-${slugify(title)}`;
      for (let n = 2; used.has(id); n += 1) id = `s-${slugify(title)}-${n}`;
      used.add(id);
      blocks.push({ type: 'heading', id, text: title, html: renderInline(heading[1]) });
    } else {
      const lines = text.split('\n');
      blocks.push({
        type: 'paragraph',
        text: plainText(lines.join(' ')),
        html: lines.map(renderInline).join('<br>'),
      });
    }
  }
  return blocks;
}

/** quotes.md: blank-line separated blocks; a last line starting with an em dash is the attribution. */
export function parseQuotes(body) {
  return body
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split('\n');
      const last = lines[lines.length - 1];
      const cite = /^(?:\u2014|--)\s*(.+)$/.exec(last);
      const quoteLines = cite ? lines.slice(0, -1) : lines;
      return {
        text: plainText(quoteLines.join(' ')),
        html: quoteLines.map(renderInline).join('<br>'),
        cite: cite ? plainText(cite[1]) : '',
      };
    });
}
