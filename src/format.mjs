// Formatting helpers shared by the page templates.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/**
 * Photo times are local wall-clock times ("2024-05-23T14:44:48+02:00"). They are read
 * as written, never converted, so 14:44 in Italy stays 14:44 whatever the reader's zone.
 */
export function parseStamp(stamp) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(stamp || '');
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map((v) => (v === undefined ? null : Number(v)));
  return { year, month, day, hour, minute, second };
}

/** Seconds on a common clock, for sorting and for measuring gaps between photos. */
export function epochSeconds(stamp) {
  const t = parseStamp(stamp);
  if (!t) return null;
  const zone = /([+-])(\d{2}):(\d{2})$/.exec(stamp);
  const offset = zone ? (zone[1] === '-' ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3])) : 0;
  const utc = Date.UTC(t.year, t.month - 1, t.day || 1, t.hour || 0, t.minute || 0, t.second || 0);
  return utc / 1000 - offset * 60;
}

export function formatDate(stamp, { year = true } = {}) {
  const t = parseStamp(stamp);
  if (!t) return '';
  const parts = [];
  if (t.day) parts.push(String(t.day));
  parts.push(MONTHS[t.month - 1]);
  if (year) parts.push(String(t.year));
  return parts.join(' ');
}

export const formatMonth = (stamp) => {
  const t = parseStamp(stamp);
  return t ? `${MONTHS[t.month - 1]} ${t.year}` : '';
};

export const formatTime = (stamp) => {
  const t = parseStamp(stamp);
  return t && t.hour !== null ? `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}` : '';
};

/** "2026.03.11", the date style of the original index pages. */
export const formatDotted = (stamp) => {
  const t = parseStamp(stamp);
  if (!t) return '';
  return [t.year, String(t.month).padStart(2, '0'), t.day && String(t.day).padStart(2, '0')].filter(Boolean).join('.');
};

/** "20\u201321 May 2024", "20 May \u2013 17 Jun 2024" */
export function formatDateRange(first, last) {
  const a = parseStamp(first);
  const b = parseStamp(last);
  if (!a || !b) return formatDate(first || last);
  if (a.year === b.year && a.month === b.month && a.day === b.day) return formatDate(first);
  if (a.year === b.year && a.month === b.month) return `${a.day}\u2013${b.day} ${MONTHS[a.month - 1]} ${a.year}`;
  if (a.year === b.year) return `${formatDate(first, { year: false })} \u2013 ${formatDate(last)}`;
  return `${formatDate(first)} \u2013 ${formatDate(last)}`;
}

export const compassPoint = (degrees) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];

export function formatCoordinate(value, axis, places = 4) {
  const hemisphere = axis === 'lat' ? (value < 0 ? 'S' : 'N') : value < 0 ? 'W' : 'E';
  return `${Math.abs(value).toFixed(places)}\u00b0\u00a0${hemisphere}`;
}

export const formatNumber = (value) => Math.round(value).toLocaleString('en-US');

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];

/** Spell out a count below one hundred ("thirty-six"); larger numbers stay as digits. */
export function spellNumber(n) {
  if (!Number.isInteger(n) || n < 0 || n > 99) return formatNumber(n);
  if (n <= 12) return NUMBER_WORDS[n];
  if (n < 20) return TEENS[n - 10];
  const ones = n % 10;
  return ones ? `${TENS[Math.floor(n / 10)]}-${NUMBER_WORDS[ones]}` : TENS[Math.floor(n / 10)];
}

export const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export const plural = (count, one, many = `${one}s`) => `${formatNumber(count)} ${count === 1 ? one : many}`;

/** Great-circle distance in kilometres. */
export function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** Roman numerals for chapter numbers. */
export function roman(n) {
  const table = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [value, glyph] of table) {
    while (n >= value) {
      out += glyph;
      n -= value;
    }
  }
  return out;
}
