// A small EXIF reader for JPEG files. No dependencies.
//
// Reads only what the site uses: pixel size, capture time, camera model, and
// the GPS block (position, altitude, compass direction of the lens, speed).

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** Walk JPEG segments and return { width, height, exif: Buffer | null }. */
function scanJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
  let pos = 2;
  let width = 0;
  let height = 0;
  let exif = null;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) break;
    const marker = buf[pos + 1];
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const length = buf.readUInt16BE(pos + 2);
    const body = pos + 4;
    if (marker === 0xe1 && !exif && buf.toString('latin1', body, body + 6) === 'Exif\0\0') {
      exif = buf.subarray(body + 6, pos + 2 + length);
    }
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      height = buf.readUInt16BE(body + 1);
      width = buf.readUInt16BE(body + 3);
    }
    pos += 2 + length;
  }
  return { width, height, exif };
}

/** Read one TIFF image file directory into a Map of tag -> value. */
function readIfd(tiff, offset, little) {
  const u16 = (o) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const i32 = (o) => (little ? tiff.readInt32LE(o) : tiff.readInt32BE(o));
  const tags = new Map();
  if (!offset || offset + 2 > tiff.length) return tags;

  const count = u16(offset);
  for (let i = 0; i < count; i += 1) {
    const entry = offset + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    const tag = u16(entry);
    const type = u16(entry + 2);
    const n = u32(entry + 4);
    const size = (TYPE_SIZE[type] || 0) * n;
    if (!size) continue;
    const at = size <= 4 ? entry + 8 : u32(entry + 8);
    if (at + size > tiff.length) continue;

    let value;
    if (type === 2) {
      value = tiff.toString('latin1', at, at + n).replace(/\0+$/, '').trim();
    } else {
      const values = [];
      for (let k = 0; k < n; k += 1) {
        if (type === 1 || type === 7) values.push(tiff[at + k]);
        else if (type === 3) values.push(u16(at + k * 2));
        else if (type === 4) values.push(u32(at + k * 4));
        else if (type === 9) values.push(i32(at + k * 4));
        else if (type === 5) values.push(u32(at + k * 8) / (u32(at + k * 8 + 4) || 1));
        else if (type === 10) values.push(i32(at + k * 8) / (i32(at + k * 8 + 4) || 1));
      }
      value = n === 1 ? values[0] : values;
    }
    tags.set(tag, value);
  }
  return tags;
}

const degrees = (dms, ref) => {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const value = dms[0] + dms[1] / 60 + dms[2] / 3600;
  return ref === 'S' || ref === 'W' ? -value : value;
};

/** "2024:05:23 14:44:48" + "+02:00" -> "2024-05-23T14:44:48+02:00" */
const isoTime = (stamp, offset) => {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(stamp || '');
  if (!m) return null;
  const zone = /^[+-]\d{2}:\d{2}$/.test(offset || '') ? offset : '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${zone}`;
};

export function readJpegMeta(buf) {
  const { width, height, exif } = scanJpeg(buf);
  const meta = { width, height, orientation: 1, taken: null, camera: null, gps: null };
  if (!exif || exif.length < 8) return meta;

  const order = exif.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return meta;
  const little = order === 'II';
  const ifd0 = readIfd(exif, little ? exif.readUInt32LE(4) : exif.readUInt32BE(4), little);
  const photo = readIfd(exif, ifd0.get(0x8769), little);
  const gps = readIfd(exif, ifd0.get(0x8825), little);

  meta.orientation = ifd0.get(0x0112) || 1;
  meta.camera = ifd0.get(0x0110) || null;
  // Local wall-clock time where the photo was taken, with its UTC offset when recorded.
  meta.taken =
    isoTime(photo.get(0x9003), photo.get(0x9011)) || isoTime(ifd0.get(0x0132), photo.get(0x9010));

  const lat = degrees(gps.get(2), gps.get(1));
  const lon = degrees(gps.get(4), gps.get(3));
  if (lat !== null && lon !== null) {
    const number = (tag) => (Number.isFinite(gps.get(tag)) ? gps.get(tag) : null);
    const altitude = number(6);
    meta.gps = {
      lat,
      lon,
      altitude: altitude === null ? null : gps.get(5) === 1 ? -altitude : altitude,
      heading: number(0x11), // compass direction the lens was pointing, degrees from north
      speed: number(0x0d) === null ? null : speedInKmh(number(0x0d), gps.get(0x0c)),
      accuracy: number(0x1f), // horizontal error estimate, metres
    };
  }
  return meta;
}

function speedInKmh(value, unit) {
  if (unit === 'M') return value * 1.609344;
  if (unit === 'N') return value * 1.852;
  return value;
}
