#!/usr/bin/env node
// Prepares the map data for the chart on the 3rd Person album.
//
//   node tools/chart-data.mjs            use cached downloads where there are any
//   node tools/chart-data.mjs --refresh  download everything again
//
// Reads the GPS fixes in content/photos.json and writes two small data files:
//
//   assets/chart/base.js    Europe at 1:50m, plus 1:10m coasts around the route (Natural Earth)
//   assets/chart/detail.js  close-up shores, lakes, rivers and names around each group of
//                           photos (OpenStreetMap, through the Overpass API)
//
// Run it again only when photos with new locations are added. No dependencies.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, 'tools/.cache');
const refresh = process.argv.includes('--refresh');
const USER_AGENT = 'babcock.life chart builder (static personal site; one-off build)';

const NATURAL_EARTH = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const OVERPASS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter'];

// The overview: Europe and a margin, so the frame of the chart never shows the edge of the data.
const BASE_BBOX = [-20, 30, 56, 72.5]; // west, south, east, north
const BASE_Q = 100; // stored as integers of 1/100 degree (about 1 km)
const MID_Q = 2000;
const DETAIL_Q = 100000; // about 1 m

// Names for open water. [name, lat, lon, smallest scale, largest scale] in metres per pixel.
const SEAS = [
  ['North Sea', 56.4, 3.4, 1500, 20000],
  ['Norwegian Sea', 65.4, 3.5, 1500, 20000],
  ['Baltic Sea', 57.7, 19.9, 1500, 20000],
  ['Mediterranean Sea', 38.4, 5.5, 1500, 20000],
  ['Tyrrhenian Sea', 40.3, 12.1, 400, 6000],
  ['Adriatic Sea', 43.4, 14.9, 400, 6000],
  ['Bay of Biscay', 45.4, -4.6, 1500, 20000],
  ['Ligurian Sea', 43.75, 9.1, 150, 3000],
  ['Gulf of Finland', 59.85, 25.6, 150, 3000],
  ['Kattegat', 56.9, 11.6, 300, 4000],
  ['Skagerrak', 57.9, 9.0, 600, 5000],
  ['Øresund', 55.75, 12.78, 60, 700],
  ['Storfjorden', 62.4, 6.55, 100, 700],
  ['Nordfjord', 61.9, 5.9, 100, 900],
  ['Sognefjord', 61.12, 6.2, 150, 1500],
];

// ---- Small geometry kit (degrees, x = longitude, y = latitude) -----------------

const snap = (value, q, round) => round(value * q) / q;

/** Douglas-Peucker, iterative. Keeps the first and last point. */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i += 1) {
      const [px, py] = points[i];
      let d2;
      if (len2 === 0) {
        d2 = (px - ax) ** 2 + (py - ay) ** 2;
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (d2 > worst) {
        worst = d2;
        at = i;
      }
    }
    if (worst > t2) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplify a closed ring by splitting it at the point furthest from its start. */
function simplifyRing(ring, tolerance) {
  if (ring.length < 5) return ring;
  let far = 0;
  let best = -1;
  for (let i = 1; i < ring.length - 1; i += 1) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplify(ring.slice(0, far + 1), tolerance);
  const b = simplify(ring.slice(far), tolerance);
  return a.concat(b.slice(1));
}

/** Sutherland-Hodgman: clip a closed ring to a box. Returns a closed ring or null. */
function clipRing(ring, [w, s, e, n]) {
  let points = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring.slice();
  const edges = [
    [(p) => p[0] >= w, (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= e, (a, b) => [e, a[1] + ((b[1] - a[1]) * (e - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= s, (a, b) => [a[0] + ((b[0] - a[0]) * (s - a[1])) / (b[1] - a[1]), s]],
    [(p) => p[1] <= n, (a, b) => [a[0] + ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]), n]],
  ];
  for (const [inside, cross] of edges) {
    if (!points.length) return null;
    const out = [];
    let prev = points.at(-1);
    let prevIn = inside(prev);
    for (const point of points) {
      const pointIn = inside(point);
      if (pointIn !== prevIn) out.push(cross(prev, point));
      if (pointIn) out.push(point);
      prev = point;
      prevIn = pointIn;
    }
    points = out;
  }
  if (points.length < 3) return null;
  points.push(points[0]);
  return points;
}

/** Liang-Barsky: clip one segment to a box. Returns [t0, t1] along the segment, or null. */
function clipSegment(a, b, [w, s, e, n]) {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const checks = [
    [-dx, a[0] - w],
    [dx, e - a[0]],
    [-dy, a[1] - s],
    [dy, n - a[1]],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [t0, t1];
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Cut a line into the pieces that lie inside a box. Each piece notes whether it enters and leaves. */
function clipLine(points, bbox) {
  const pieces = [];
  let current = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const hit = clipSegment(a, b, bbox);
    if (!hit) {
      current = null;
      continue;
    }
    const [t0, t1] = hit;
    if (!current || t0 > 0) {
      current = { points: [t0 > 0 ? lerp(a, b, t0) : a], enters: t0 > 0, leaves: false };
      pieces.push(current);
    }
    current.points.push(t1 < 1 ? lerp(a, b, t1) : b);
    if (t1 < 1) {
      current.leaves = true;
      current = null;
    }
  }
  return pieces.filter((piece) => piece.points.length > 1);
}

/** Signed area in square degrees; positive when the ring runs counter-clockwise. */
function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return sum / 2;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const boxesTouch = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const boxUnion = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

function mergeBoxes(boxes) {
  const list = boxes.map((box) => box.slice());
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (boxesTouch(list[i], list[j])) {
          list[i] = boxUnion(list[i], list[j]);
          list.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return list;
}

/** Quantise to integers and delta-encode: [x0, y0, dx, dy, dx, dy, ...]. */
function encode(points, q) {
  const out = [];
  let px = 0;
  let py = 0;
  let first = true;
  for (const [x, y] of points) {
    const qx = Math.round(x * q);
    const qy = Math.round(y * q);
    if (!first && qx === px && qy === py) continue;
    out.push(first ? qx : qx - px, first ? qy : qy - py);
    px = qx;
    py = qy;
    first = false;
  }
  return out;
}

const encodeAll = (lines, q, min = 2) => lines.map((line) => encode(line, q)).filter((flat) => flat.length >= min * 2);

// ---- Downloads -------------------------------------------------------------------

async function cached(name, load) {
  const file = path.join(cacheDir, name);
  if (!refresh && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const text = await load();
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, text);
  return text;
}

async function naturalEarth(name) {
  const text = await cached(`${name}.geojson`, async () => {
    console.log(`  downloading ${name}`);
    const response = await fetch(`${NATURAL_EARTH}${name}.geojson`, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.text();
  });
  return JSON.parse(text);
}

async function overpass(id, query) {
  const text = await cached(`overpass-${id}.json`, async () => {
    for (const endpoint of OVERPASS) {
      try {
        console.log(`  asking ${new URL(endpoint).host} for ${id}`);
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(180000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.text();
        JSON.parse(body);
        return body;
      } catch (error) {
        console.warn(`  ! ${new URL(endpoint).host}: ${error.message}`);
      }
    }
    throw new Error(`Overpass query failed for ${id}`);
  });
  return JSON.parse(text);
}

// ---- Natural Earth: land, lakes and borders ---------------------------------------

function* polygonsOf(geojson) {
  for (const feature of geojson.features) {
    const { type, coordinates } = feature.geometry || {};
    if (type === 'Polygon') yield coordinates;
    else if (type === 'MultiPolygon') yield* coordinates;
  }
}

function* linesOf(geojson) {
  for (const feature of geojson.features) {
    const { type, coordinates } = feature.geometry || {};
    if (type === 'LineString') yield coordinates;
    else if (type === 'MultiLineString') yield* coordinates;
  }
}

const ringBox = (ring) => {
  let box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
  return box;
};

/** Clip, simplify and drop the specks. Holes in the land (inland seas) are returned as water. */
function landFor(geojson, bbox, tolerance, minArea) {
  const pad = [bbox[0] - 0.5, bbox[1] - 0.5, bbox[2] + 0.5, bbox[3] + 0.5];
  const land = [];
  const water = [];
  for (const polygon of polygonsOf(geojson)) {
    polygon.forEach((ring, i) => {
      if (!boxesTouch(ringBox(ring), bbox)) return;
      let clipped = clipRing(ring, pad);
      if (!clipped) return;
      clipped = clipRing(simplifyRing(clipped, tolerance), bbox);
      if (!clipped || Math.abs(ringArea(clipped)) < minArea) return;
      (i === 0 ? land : water).push(clipped);
    });
  }
  return { land, water };
}

// ---- OpenStreetMap: close-up shores -------------------------------------------------

const key = (point) => `${point[0]},${point[1]}`;

/** Join ways end to start, keeping their direction (coastlines have land on the left). */
function joinDirected(ways) {
  const byStart = new Map();
  for (const way of ways) byStart.set(key(way[0]), way);
  const used = new Set();
  const chains = [];
  const ends = new Set(ways.map((way) => key(way.at(-1))));
  // Begin with ways nothing leads into, then pick up any closed loops that are left.
  const order = [...ways.filter((way) => !ends.has(key(way[0]))), ...ways];
  for (const start of order) {
    if (used.has(start)) continue;
    const chain = start.slice();
    used.add(start);
    for (;;) {
      const next = byStart.get(key(chain.at(-1)));
      if (!next || used.has(next)) break;
      used.add(next);
      chain.push(...next.slice(1));
    }
    chains.push(chain);
  }
  return chains;
}

/** Join ways in either direction into closed rings (for multipolygon lakes). */
function joinRings(ways) {
  const rings = [];
  const open = ways.map((way) => way.slice());
  while (open.length) {
    let chain = open.pop();
    let grew = true;
    while (grew && key(chain[0]) !== key(chain.at(-1))) {
      grew = false;
      for (let i = 0; i < open.length; i += 1) {
        const way = open[i];
        if (key(way[0]) === key(chain.at(-1))) chain = chain.concat(way.slice(1));
        else if (key(way.at(-1)) === key(chain.at(-1))) chain = chain.concat(way.slice(0, -1).reverse());
        else if (key(way.at(-1)) === key(chain[0])) chain = way.concat(chain.slice(1));
        else if (key(way[0]) === key(chain[0])) chain = way.slice(1).reverse().concat(chain);
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (chain.length > 3 && key(chain[0]) === key(chain.at(-1))) rings.push(chain);
  }
  return rings;
}

/**
 * Turn coastline ways into closed land polygons inside a box.
 * A coastline that crosses the box is closed along the edge of the box, walking
 * counter-clockwise from where it leaves to where the next one enters: OpenStreetMap
 * coastlines always have the land on their left.
 */
function landFromCoast(ways, bbox) {
  const [w, s, e, n] = bbox;
  // Position along the edge of the box, counter-clockwise from the south-west corner, 0..4.
  const along = ([x, y]) => {
    const eps = 1e-9;
    if (Math.abs(y - s) < eps && x < e) return (x - w) / (e - w);
    if (Math.abs(x - e) < eps && y < n) return 1 + (y - s) / (n - s);
    if (Math.abs(y - n) < eps && x > w) return 2 + (e - x) / (e - w);
    return 3 + (n - y) / (n - s);
  };
  const corners = [[w, s], [e, s], [e, n], [w, n]];

  const islands = [];
  const pieces = [];
  for (const chain of joinDirected(ways)) {
    const closed = key(chain[0]) === key(chain.at(-1));
    let points = chain;
    if (closed) {
      const inside = (p) => p[0] > w && p[0] < e && p[1] > s && p[1] < n;
      const outside = chain.findIndex((p) => !inside(p));
      if (outside === -1) {
        islands.push(chain);
        continue;
      }
      // Start the walk outside the box so no piece is split across the seam of the loop.
      points = chain.slice(outside, -1).concat(chain.slice(0, outside + 1));
    }
    for (const piece of clipLine(points, bbox)) {
      if (piece.enters && piece.leaves) pieces.push({ points: piece.points, from: along(piece.points[0]), to: along(piece.points.at(-1)) });
    }
  }

  const rings = [];
  const used = new Set();
  const entries = pieces.slice().sort((a, b) => a.from - b.from);
  for (const start of pieces) {
    if (used.has(start)) continue;
    const ring = [];
    let piece = start;
    for (let guard = 0; guard <= pieces.length; guard += 1) {
      used.add(piece);
      ring.push(...piece.points);
      const next = entries.find((candidate) => candidate.from > piece.to) || entries[0];
      // Add the corners of the box passed on the way to the next coastline.
      let t = piece.to;
      const target = next.from > piece.to ? next.from : next.from + 4;
      for (let corner = Math.floor(t) + 1; corner <= target; corner += 1) ring.push(corners[corner % 4]);
      piece = next;
      if (piece === start) break;
    }
    ring.push(ring[0]);
    rings.push(ring);
  }

  // No coastline through the box: either all land or, when there are islands, all sea.
  if (!rings.length && !islands.length) rings.push([[w, s], [e, s], [e, n], [w, n], [w, s]]);
  return rings.concat(islands.filter((ring) => ringArea(ring) > 0));
}

const DRY_WATER = /^(river|canal|stream|ditch|drain|wastewater|basin|moat|fountain|reflecting_pool|pool|stream_pool|lock|fish_pass)$/;
const PLACE_RANK = { city: 0, town: 1, village: 2, suburb: 3, island: 3, quarter: 3, hamlet: 4, neighbourhood: 4 };

async function detailFor(cluster) {
  const [w, s, e, n] = cluster.bbox;
  const query = `[out:json][timeout:120][bbox:${s},${w},${n},${e}];
(
  way["natural"="coastline"];
  way["natural"="water"];
  relation["natural"="water"];
  way["waterway"="river"];
  node["place"~"^(city|town|village|hamlet|suburb|quarter|neighbourhood|island)$"]["name"];
  nwr["natural"~"^(bay|strait|fjord)$"]["name"];
);
out geom;`;
  const data = await overpass(cluster.id, query);
  const geometry = (element) => (element.geometry || []).filter(Boolean).map((p) => [p.lon, p.lat]);
  const tolerance = 1.2e-4; // about 12 m
  const minArea = 4e-6; // about 200 m by 200 m at these latitudes

  const coast = [];
  const lakeRings = [];
  const rivers = [];
  const riverNames = new Map();
  const places = [];
  const waters = [];
  const inside = (p) => p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n;

  for (const element of data.elements) {
    const tags = element.tags || {};
    if (element.type === 'node' && tags.place) {
      const rank = PLACE_RANK[tags.place];
      const name = rank <= 1 ? tags['name:en'] || tags.name : tags.name;
      if (rank !== undefined && name && name.length <= 24) places.push([name, element.lat, element.lon, rank, Number(tags.population) || 0]);
    } else if (tags.natural === 'coastline' && element.type === 'way') {
      coast.push(geometry(element));
    } else if (tags.natural === 'water') {
      if (DRY_WATER.test(tags.water || '')) continue;
      const rings =
        element.type === 'way'
          ? joinRings([geometry(element)])
          : joinRings((element.members || []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map(geometry));
      for (const ring of rings) lakeRings.push({ ring, name: tags.name });
    } else if (tags.waterway === 'river' && element.type === 'way') {
      const line = geometry(element);
      rivers.push(line);
      if (tags.name) riverNames.set(tags['name:en'] || tags.name, (riverNames.get(tags['name:en'] || tags.name) || []).concat(line));
    } else if (/^(bay|strait|fjord)$/.test(tags.natural || '') && tags.name) {
      // Label where the water actually is inside this box, not at the middle of a 100 km fjord.
      const points =
        element.type === 'node'
          ? [[element.lon, element.lat]]
          : element.type === 'way'
            ? geometry(element)
            : (element.members || []).flatMap((m) => (m.geometry ? geometry(m) : []));
      const within = points.filter(inside);
      if (!within.length) continue;
      const lon = within.reduce((sum, p) => sum + p[0], 0) / within.length;
      const lat = within.reduce((sum, p) => sum + p[1], 0) / within.length;
      waters.push([tags.name, lat, lon, within.length]);
    }
  }

  const land = landFromCoast(coast, cluster.bbox)
    .map((ring) => clipRing(simplifyRing(ring, tolerance), cluster.bbox))
    .filter((ring) => ring && Math.abs(ringArea(ring)) > minArea / 8);

  const lakes = [];
  for (const { ring, name } of lakeRings) {
    const clipped = clipRing(simplifyRing(ring, tolerance), cluster.bbox);
    if (!clipped || Math.abs(ringArea(clipped)) < minArea) continue;
    lakes.push(clipped);
    if (name && Math.abs(ringArea(clipped)) > minArea * 30) {
      const lon = clipped.reduce((sum, p) => sum + p[0], 0) / clipped.length;
      const lat = clipped.reduce((sum, p) => sum + p[1], 0) / clipped.length;
      waters.push([name, lat, lon, clipped.length]);
    }
  }

  const riverLines = rivers.flatMap((line) => clipLine(line, cluster.bbox).map((piece) => simplify(piece.points, tolerance)));
  for (const [name, points] of riverNames) {
    // Name a river once, at the point nearest the photos.
    let best = null;
    let bestD = Infinity;
    for (const p of points) {
      if (!inside(p)) continue;
      const d = (p[0] - cluster.centre[0]) ** 2 + (p[1] - cluster.centre[1]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) waters.push([name, best[1], best[0], 1e6]);
  }

  // One label per name, the best-supported one; places by rank, then nearest the photos first.
  const distance = (lat, lon) => (lat - cluster.centre[1]) ** 2 + ((lon - cluster.centre[0]) * Math.cos((lat * Math.PI) / 180)) ** 2;
  const seenWater = new Map();
  for (const water of waters) if (!seenWater.has(water[0]) || seenWater.get(water[0])[3] < water[3]) seenWater.set(water[0], water);
  const seenPlace = new Set();
  const placeList = places
    .sort((a, b) => a[3] - b[3] || distance(a[1], a[2]) - distance(b[1], b[2]))
    .filter((place) => !seenPlace.has(place[0]) && seenPlace.add(place[0]))
    .slice(0, 48)
    .map(([name, lat, lon, rank]) => [name, +lat.toFixed(5), +lon.toFixed(5), rank]);

  for (const fix of cluster.fixes) {
    if (!land.some((ring) => pointInRing(fix, ring))) console.warn(`  ! a fix in ${cluster.id} (${fix[1]}, ${fix[0]}) falls in the water on the close-up chart`);
  }

  return {
    id: cluster.id,
    q: DETAIL_Q,
    bbox: cluster.bbox,
    land: encodeAll(land, DETAIL_Q, 4),
    lakes: encodeAll(lakes, DETAIL_Q, 4),
    rivers: encodeAll(riverLines, DETAIL_Q),
    places: placeList,
    waters: [...seenWater.values()].map(([name, lat, lon]) => [name, +lat.toFixed(5), +lon.toFixed(5)]),
  };
}

// ---- Main ----------------------------------------------------------------------------

const photos = JSON.parse(fs.readFileSync(path.join(root, 'content/photos.json'), 'utf8'));
const albums = JSON.parse(fs.readFileSync(path.join(root, 'content/albums.json'), 'utf8'));
const journey = (albums.albums || albums).find((album) => album.layout === 'journey');
const fixes = (photos.photos || photos)
  .filter((photo) => photo.gps && (!journey || photo.set === journey.id))
  .map((photo) => [photo.gps.lon, photo.gps.lat]);
if (!fixes.length) throw new Error('No photos with a GPS fix were found for the route.');

// Group fixes that are close together, then give each group a box with room around it.
const KM_LAT = 1 / 110.574;
const kmLon = (lat) => 1 / (111.32 * Math.cos((lat * Math.PI) / 180));
const PAD_KM = 8;
const clusterBoxes = mergeBoxes(
  fixes.map(([lon, lat]) => [lon - PAD_KM * kmLon(lat), lat - PAD_KM * KM_LAT, lon + PAD_KM * kmLon(lat), lat + PAD_KM * KM_LAT]),
);
const clusters = clusterBoxes.map((box, i) => {
  const bbox = [snap(box[0], 1000, Math.floor), snap(box[1], 1000, Math.floor), snap(box[2], 1000, Math.ceil), snap(box[3], 1000, Math.ceil)];
  const inside = fixes.filter(([lon, lat]) => lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]);
  const centre = [inside.reduce((sum, p) => sum + p[0], 0) / inside.length, inside.reduce((sum, p) => sum + p[1], 0) / inside.length];
  return { id: `c${i + 1}-${centre[1].toFixed(2)}-${centre[0].toFixed(2)}`, bbox, centre, fixes: inside };
});
console.log(`${fixes.length} fixes in ${clusters.length} groups`);

// Middle distance: 1:10m coasts for a degree or two around each group.
const midBoxes = mergeBoxes(clusters.map(({ centre: [lon, lat] }) => [lon - 2.6, lat - 1.5, lon + 2.6, lat + 1.5])).map((box) => [
  Math.max(BASE_BBOX[0], Math.floor(box[0] * 10) / 10),
  Math.max(BASE_BBOX[1], Math.floor(box[1] * 10) / 10),
  Math.min(BASE_BBOX[2], Math.ceil(box[2] * 10) / 10),
  Math.min(BASE_BBOX[3], Math.ceil(box[3] * 10) / 10),
]);

console.log('Natural Earth');
const land50 = await naturalEarth('ne_50m_land');
const lakes50 = await naturalEarth('ne_50m_lakes');
const borders50 = await naturalEarth('ne_50m_admin_0_boundary_lines_land');
const land10 = await naturalEarth('ne_10m_land');
const lakes10 = await naturalEarth('ne_10m_lakes');

const baseLand = landFor(land50, BASE_BBOX, 0.012, 0.004);
const baseLakes = landFor(lakes50, BASE_BBOX, 0.012, 0.01).land.concat(baseLand.water);
const borders = [...linesOf(borders50)].flatMap((line) => clipLine(line, BASE_BBOX).map((piece) => simplify(piece.points, 0.012)));

const base = {
  q: BASE_Q,
  bbox: BASE_BBOX,
  land: encodeAll(baseLand.land, BASE_Q, 4),
  lakes: encodeAll(baseLakes, BASE_Q, 4),
  borders: encodeAll(borders, BASE_Q),
  seas: SEAS,
  mid: midBoxes.map((bbox) => {
    const { land, water } = landFor(land10, bbox, 0.0012, 0.00002);
    const lakes = landFor(lakes10, bbox, 0.0012, 0.0002).land.concat(water);
    return { q: MID_Q, bbox, land: encodeAll(land, MID_Q, 4), lakes: encodeAll(lakes, MID_Q, 4) };
  }),
};

console.log('OpenStreetMap');
const detail = [];
for (const cluster of clusters) detail.push(await detailFor(cluster));

const outDir = path.join(root, 'assets/chart');
fs.mkdirSync(outDir, { recursive: true });
const header = (source) => `/* Generated by tools/chart-data.mjs. ${source} */\n`;
const write = (name, prop, value, source) => {
  const text = `${header(source)}(window.BLChartData=window.BLChartData||{}).${prop}=${JSON.stringify(value)};\n`;
  fs.writeFileSync(path.join(outDir, name), text);
  console.log(`${name}  ${(text.length / 1024).toFixed(0)} KB`);
};
write('base.js', 'base', base, 'Coastlines, lakes and borders: Natural Earth (public domain).');
write('detail.js', 'detail', detail, 'Shores, lakes, rivers and names: (c) OpenStreetMap contributors, ODbL.');
for (const item of detail) {
  console.log(`  ${item.id}: ${item.land.length} land, ${item.lakes.length} lakes, ${item.rivers.length} rivers, ${item.places.length} places, ${item.waters.length} water names`);
}
