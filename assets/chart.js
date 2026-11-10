/* babcock.life: the chart.
   A small map engine on a canvas, written for the 3rd Person album. No map library, no tiles.

   - Web Mercator, north up. Three levels of detail: Europe at 1:50m, coasts at 1:10m around
     the route (both Natural Earth), and close-up shores, lakes, rivers and names from
     OpenStreetMap. Finer data replaces coarser data inside its own box.
   - The lines on the water side of every shore are drawn the way engravers did it:
     contours at fixed distances from the land.
   - Moving between two photos follows van Wijk and Nuij's "smooth and efficient zooming
     and panning" (2003): pull back, travel, close in, along the shortest perceived path.

   The data files are prepared by tools/chart-data.mjs. */

(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var base = root.dataset.root || './';
  var version = (doc.currentScript && doc.currentScript.src.split('?v=')[1]) || '';
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---- Projection: Web Mercator in metres, x east from 180 W, y south from 85.05 N ----

  var R = 6378137;
  var RAD = Math.PI / 180;
  var mx = function (lon) {
    return (lon + 180) * RAD * R;
  };
  var my = function (lat) {
    return (Math.PI - Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2))) * R;
  };
  var lonOf = function (x) {
    return x / R / RAD - 180;
  };
  var latOf = function (y) {
    return (2 * Math.atan(Math.exp(Math.PI - y / R)) - Math.PI / 2) / RAD;
  };

  var DETAIL_BELOW = 70; // metres per pixel under which the OpenStreetMap level is used
  var MID_BELOW = 1400;
  var WATERLINES = [3.5, 8, 13.5]; // pixels from the shore
  var WATER_INK = [0.8, 0.5, 0.28];

  // ---- Data ----------------------------------------------------------------------

  var sources = { base: null, mid: [], detail: [] };
  var names = { seas: [], waters: [], places: [] };
  var dataRevision = 0;
  var charts = [];

  /** Turn delta-encoded integer rings into paths, in metres from the corner of their box. */
  function buildSource(data) {
    var q = data.q;
    var box = data.bbox;
    var ox = mx(box[0]);
    var oy = my(box[3]);
    var edge = [Math.round(box[0] * q), Math.round(box[1] * q), Math.round(box[2] * q), Math.round(box[3] * q)];
    var source = {
      rect: [ox, oy, mx(box[2]), my(box[1])],
      ox: ox,
      oy: oy,
      land: new Path2D(),
      coast: new Path2D(),
      lakes: null,
      shore: null,
      rivers: null,
      borders: null,
    };

    function trace(flat, fill, stroke, closed) {
      var X = 0;
      var Y = 0;
      var prevX = 0;
      var prevY = 0;
      var px = 0;
      var py = 0;
      var penDown = false;
      for (var i = 0; i < flat.length; i += 2) {
        X = i ? X + flat[i] : flat[i];
        Y = i ? Y + flat[i + 1] : flat[i + 1];
        var x = mx(X / q) - ox;
        var y = my(Y / q) - oy;
        if (fill) {
          if (i) fill.lineTo(x, y);
          else fill.moveTo(x, y);
        }
        if (stroke && i) {
          // A segment lying on the edge of the box is where the data was cut, not a shore.
          var cut =
            closed &&
            ((X === edge[0] && prevX === edge[0]) ||
              (X === edge[2] && prevX === edge[2]) ||
              (Y === edge[1] && prevY === edge[1]) ||
              (Y === edge[3] && prevY === edge[3]));
          if (cut) {
            penDown = false;
          } else {
            if (!penDown) stroke.moveTo(px, py);
            stroke.lineTo(x, y);
            penDown = true;
          }
        }
        prevX = X;
        prevY = Y;
        px = x;
        py = y;
      }
      if (fill) fill.closePath();
    }

    data.land.forEach(function (ring) {
      trace(ring, source.land, source.coast, true);
    });
    if (data.lakes && data.lakes.length) {
      source.lakes = new Path2D();
      source.shore = new Path2D();
      data.lakes.forEach(function (ring) {
        trace(ring, source.lakes, source.shore, true);
      });
    }
    if (data.rivers && data.rivers.length) {
      source.rivers = new Path2D();
      data.rivers.forEach(function (line) {
        trace(line, null, source.rivers, false);
      });
    }
    if (data.borders && data.borders.length) {
      source.borders = new Path2D();
      data.borders.forEach(function (line) {
        trace(line, null, source.borders, false);
      });
    }
    return source;
  }

  function ingest() {
    var data = window.BLChartData || {};
    var changed = false;
    if (data.base && !sources.base) {
      sources.base = buildSource(data.base);
      sources.mid = (data.base.mid || []).map(buildSource);
      names.seas = (data.base.seas || []).map(function (sea) {
        return { name: sea[0], x: mx(sea[2]), y: my(sea[1]), min: sea[3], max: sea[4] };
      });
      changed = true;
    }
    if (data.detail && !sources.detail.length) {
      sources.detail = data.detail.map(buildSource);
      data.detail.forEach(function (group) {
        group.places.forEach(function (place) {
          names.places.push({ name: place[0], x: mx(place[2]), y: my(place[1]), rank: place[3] });
        });
        group.waters.forEach(function (water) {
          names.waters.push({ name: water[0], x: mx(water[2]), y: my(water[1]) });
        });
      });
      names.places.sort(function (a, b) {
        return a.rank - b.rank;
      });
      changed = true;
    }
    if (changed) {
      dataRevision += 1;
      charts.forEach(function (chart) {
        chart.redraw();
      });
    }
  }

  function loadData(file) {
    var script = doc.createElement('script');
    script.src = base + 'assets/chart/' + file + (version ? '?v=' + version : '');
    script.onload = ingest;
    doc.head.appendChild(script);
  }

  // ---- Colour: the chart is inked from CSS custom properties ------------------------

  var swatch = doc.createElement('canvas');
  swatch.width = swatch.height = 1;
  var swatchContext = swatch.getContext('2d', { willReadFrequently: true });

  /** Any CSS colour to [r, g, b, a], by painting one pixel with it. */
  function rgba(color) {
    swatchContext.clearRect(0, 0, 1, 1);
    swatchContext.fillStyle = '#000';
    swatchContext.fillStyle = color;
    swatchContext.fillRect(0, 0, 1, 1);
    var data = swatchContext.getImageData(0, 0, 1, 1).data;
    return [data[0], data[1], data[2], data[3] / 255];
  }

  var over = function (top, under) {
    return [0, 1, 2].map(function (i) {
      return Math.round(top[i] * top[3] + under[i] * (1 - top[3]));
    });
  };
  var mix = function (a, b, amount) {
    return [0, 1, 2].map(function (i) {
      return Math.round(a[i] * amount + b[i] * (1 - amount));
    });
  };
  var css = function (rgb, alpha) {
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (alpha === undefined ? 1 : alpha) + ')';
  };

  function readPalette(element) {
    var probe = doc.createElement('span');
    probe.style.display = 'none';
    element.appendChild(probe);
    var read = function (name) {
      probe.style.color = 'var(--chart-' + name + ')';
      return rgba(getComputedStyle(probe).color);
    };
    var paper = over(read('paper'), [255, 255, 255]);
    var land = over(read('land'), paper);
    var coast = over(read('coast'), paper);
    var water = over(read('water'), paper);
    var grid = over(read('grid'), paper);
    var text = over(read('text'), paper);
    var frame = over(read('frame'), paper);
    var mark = over(read('mark'), paper);
    element.removeChild(probe);
    return {
      paper: css(paper),
      land: css(land),
      coast: css(coast),
      waterlines: WATER_INK.map(function (ink) {
        return css(mix(water, paper, ink));
      }),
      river: css(mix(water, land, 0.85)),
      grid: css(grid),
      gridOnLand: css(mix(grid, land, 0.6)),
      border: css(mix(text, land, 0.55)),
      text: css(text),
      sea: css(mix(coast, paper, 0.78)),
      frame: css(frame),
      future: css(mix(frame, paper, 0.55)),
      mark: css(mark),
      markRgb: mark,
    };
  }

  // ---- Smooth zooming (van Wijk and Nuij, 2003) -----------------------------------------

  var RHO = Math.SQRT2;

  /** A path from one view to another. Views are [x, y, width]; returns {at(t), length}. */
  function zoomPath(from, to) {
    var ux0 = from[0];
    var uy0 = from[1];
    var w0 = from[2];
    var dx = to[0] - ux0;
    var dy = to[1] - uy0;
    var w1 = to[2];
    var d2 = dx * dx + dy * dy;
    var path;
    var S;
    if (d2 < 1e-6) {
      S = Math.log(w1 / w0) / RHO;
      path = function (t) {
        return [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(RHO * t * S)];
      };
    } else {
      var d1 = Math.sqrt(d2);
      var b0 = (w1 * w1 - w0 * w0 + 4 * d2) / (2 * w0 * 2 * d1);
      var b1 = (w1 * w1 - w0 * w0 - 4 * d2) / (2 * w1 * 2 * d1);
      var r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
      var r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
      S = (r1 - r0) / RHO;
      path = function (t) {
        var s = t * S;
        var coshr0 = Math.cosh(r0);
        var u = (w0 / (2 * d1)) * (coshr0 * Math.tanh(RHO * s + r0) - Math.sinh(r0));
        return [ux0 + u * dx, uy0 + u * dy, (w0 * coshr0) / Math.cosh(RHO * s + r0)];
      };
    }
    return { at: path, length: Math.abs(S) };
  }

  var ease = function (t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  // ---- Small helpers -------------------------------------------------------------------

  var touches = function (a, b) {
    return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  };
  var contains = function (outer, inner) {
    return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
  };

  var STEPS = [20, 10, 5, 2, 1, 1 / 2, 1 / 4, 1 / 6, 1 / 12, 1 / 30, 1 / 60, 1 / 120, 1 / 360];
  function gridStep(span) {
    for (var i = 0; i < STEPS.length; i += 1) if (span / STEPS[i] >= 2.2) return STEPS[i];
    return STEPS[STEPS.length - 1];
  }

  /** 44°06′N, 9°44′E: degrees, then minutes and seconds only as the chart gets closer. */
  function degrees(value, step, positive, negative) {
    var seconds = Math.round(Math.abs(value) * 3600);
    var d = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    var two = function (n) {
      return (n < 10 ? '0' : '') + n;
    };
    var text = d + '\u00b0';
    if (step < 1) text += two(m) + '\u2032';
    if (step < 1 / 60) text += two(s) + '\u2033';
    return text + (value < 0 ? negative : positive);
  }

  function niceLength(metres) {
    var power = Math.pow(10, Math.floor(Math.log10(metres)));
    var lead = metres / power;
    return (lead >= 5 ? 5 : lead >= 2 ? 2 : 1) * power;
  }

  // ---- The chart ------------------------------------------------------------------------

  function createChart(container, options) {
    var canvas = container.querySelector('canvas');
    var ctx = canvas.getContext('2d');
    var back = doc.createElement('canvas');
    var backContext = back.getContext('2d');
    var backKey = '';
    var W = 0;
    var H = 0;
    var dpr = 1;
    var palette = readPalette(container);
    var paletteRevision = 0;
    var cam = null;
    var flight = null;
    var queued = 0;
    var hover = -1;

    var state = {
      route: [], // [{x, y}] in Mercator metres, in the order travelled
      progress: -1, // how far along the route the solid line reaches (may be fractional)
      marker: null, // {x, y, heading, accuracy, lost}
      note: '',
      stops: [], // [{x, y, text}] labels for the overview
      tip: null, // function (routeIndex) -> text shown beside a hovered dot
    };

    var api = {
      state: state,
      onPick: null,
      onHover: null,
      onResize: null,
      redraw: requestDraw,
      size: function () {
        return [W, H];
      },

      /** The view that shows the whole route. */
      fit: function () {
        var route = state.route;
        if (!route.length || !W) return { x: mx(12), y: my(52), w: 5e6 };
        var x0 = Infinity;
        var y0 = Infinity;
        var x1 = -Infinity;
        var y1 = -Infinity;
        route.forEach(function (p) {
          x0 = Math.min(x0, p.x);
          x1 = Math.max(x1, p.x);
          y0 = Math.min(y0, p.y);
          y1 = Math.max(y1, p.y);
        });
        // Leave room for the labels along the edges and for whatever sits in the corners.
        var small = Math.min(W, H) < 320;
        var pad = small ? [18, 18, 18, 18] : options.pad || [44, 44, 44, 44]; // top, right, bottom, left
        var spanX = Math.max(x1 - x0, 2e5);
        var spanY = Math.max(y1 - y0, 2e5);
        var scale = Math.min((W - pad[1] - pad[3]) / spanX, (H - pad[0] - pad[2]) / spanY);
        return {
          x: (x0 + x1) / 2 + (pad[1] - pad[3]) / 2 / scale,
          y: (y0 + y1) / 2 + (pad[2] - pad[0]) / 2 / scale,
          w: Math.min(W, H) / scale,
        };
      },

      /** Move to a view, flying there unless told (or asked by the reader) not to. */
      view: function (target, immediate) {
        if (immediate || !cam || reducedMotion.matches || !W) {
          cam = target;
          flight = null;
        } else {
          var path = zoomPath([cam.x, cam.y, cam.w], [target.x, target.y, target.w]);
          if (path.length < 1e-4) {
            cam = target;
            flight = null;
          } else {
            flight = { path: path, target: target, start: performance.now(), duration: Math.max(450, Math.min(2400, path.length * 520)) };
          }
        }
        requestDraw();
      },
    };

    function requestDraw() {
      if (!queued) queued = requestAnimationFrame(draw);
    }

    function resize() {
      var box = canvas.getBoundingClientRect();
      var width = Math.round(box.width);
      var height = Math.round(box.height);
      if (!width || !height || (width === W && height === H)) return;
      W = width;
      H = height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = back.width = Math.round(W * dpr);
      canvas.height = back.height = Math.round(H * dpr);
      backKey = '';
      if (api.onResize) api.onResize();
      requestDraw();
    }

    // -- Backdrop: land, water, graticule. Cached until the view, data or theme changes. --

    function pickSources(view, mpp) {
      var fine = [];
      var mid = [];
      if (mpp < DETAIL_BELOW) {
        fine = sources.detail.filter(function (source) {
          return touches(source.rect, view);
        });
      }
      if (mpp < MID_BELOW) {
        mid = sources.mid.filter(function (source) {
          return touches(source.rect, view);
        });
      }
      var inside = function (source) {
        return contains(source.rect, view);
      };
      var list = [];
      if (!fine.some(inside)) {
        if (!mid.some(inside) && sources.base) list.push({ source: sources.base, holes: mid.length ? mid : fine, clip: false });
        mid.forEach(function (source) {
          list.push({ source: source, holes: fine, clip: true });
        });
      }
      fine.forEach(function (source) {
        list.push({ source: source, holes: [], clip: true });
      });
      return list;
    }

    function drawSource(g, item, s, left, top, compact) {
      var source = item.source;
      var k = s * dpr;
      var rect = function (r) {
        g.rect((r[0] - left) * s, (r[1] - top) * s, (r[2] - r[0]) * s, (r[3] - r[1]) * s);
      };
      g.save();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (item.clip) {
        g.beginPath();
        rect(source.rect);
        g.clip();
      }
      if (item.holes.length) {
        g.beginPath();
        g.rect(-1, -1, W + 2, H + 2);
        item.holes.forEach(function (hole) {
          rect(hole.rect);
        });
        g.clip('evenodd');
      }
      g.setTransform(k, 0, 0, k, (source.ox - left) * k, (source.oy - top) * k);
      g.lineJoin = 'round';
      g.lineCap = 'round';

      // Waterlines: paint a band out from the shore, then all but its outer edge back to paper.
      // Furthest first; the land is filled afterwards and covers the half that fell on it.
      var lines = compact ? 2 : WATERLINES.length;
      for (var i = lines - 1; i >= 0; i -= 1) {
        g.strokeStyle = palette.waterlines[i];
        g.lineWidth = (2 * WATERLINES[i]) / s;
        g.stroke(source.coast);
        g.strokeStyle = palette.paper;
        g.lineWidth = (2 * (WATERLINES[i] - 1)) / s;
        g.stroke(source.coast);
      }

      g.fillStyle = palette.land;
      g.fill(source.land);

      if (source.lakes) {
        g.save();
        g.clip(source.lakes);
        g.fillStyle = palette.paper;
        g.fill(source.lakes);
        g.strokeStyle = palette.waterlines[1];
        g.lineWidth = (2 * WATERLINES[0]) / s;
        g.stroke(source.shore);
        g.strokeStyle = palette.paper;
        g.lineWidth = (2 * (WATERLINES[0] - 1)) / s;
        g.stroke(source.shore);
        g.restore();
      }

      if (source.rivers) {
        g.strokeStyle = palette.river;
        g.lineWidth = 1.5 / s;
        g.stroke(source.rivers);
      }

      g.strokeStyle = palette.coast;
      g.lineWidth = 1.1 / s;
      g.stroke(source.coast);
      if (source.shore) {
        g.lineWidth = 0.9 / s;
        g.stroke(source.shore);
      }
      g.restore();
    }

    function drawBackdrop(g, s, left, top, mpp) {
      var view = [left, top, left + W / s, top + H / s];
      var compact = Math.min(W, H) < 220;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = palette.paper;
      g.fillRect(0, 0, back.width, back.height);

      pickSources(view, mpp).forEach(function (item) {
        drawSource(g, item, s, left, top, compact);
      });

      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (sources.base && sources.base.borders && mpp > 250) {
        var k = s * dpr;
        g.save();
        g.setTransform(k, 0, 0, k, (sources.base.ox - left) * k, (sources.base.oy - top) * k);
        g.strokeStyle = palette.border;
        g.lineWidth = 1 / s;
        g.setLineDash([1 / s, 3 / s]);
        g.lineCap = 'round';
        g.stroke(sources.base.borders);
        g.restore();
      }

      // Graticule, with the meridians and parallels named along the top and left edges.
      var west = lonOf(view[0]);
      var east = lonOf(view[2]);
      var north = latOf(view[1]);
      var south = latOf(view[3]);
      var stepX = gridStep(east - west);
      var stepY = gridStep(north - south);
      var meridians = [];
      var parallels = [];
      var v;
      for (v = Math.ceil(west / stepX) * stepX; v < east; v += stepX) meridians.push(v);
      for (v = Math.ceil(south / stepY) * stepY; v < north; v += stepY) parallels.push(v);

      g.strokeStyle = palette.grid;
      g.lineWidth = 1;
      g.beginPath();
      meridians.forEach(function (lon) {
        var x = Math.round((mx(lon) - left) * s) + 0.5;
        g.moveTo(x, 0);
        g.lineTo(x, H);
      });
      parallels.forEach(function (lat) {
        var y = Math.round((my(lat) - top) * s) + 0.5;
        g.moveTo(0, y);
        g.lineTo(W, y);
      });
      g.stroke();

      if (!compact) {
        g.font = '400 9px "IBM Plex Mono", ui-monospace, monospace';
        g.textBaseline = 'alphabetic';
        g.lineJoin = 'round';
        g.lineWidth = 3;
        g.strokeStyle = palette.paper;
        g.fillStyle = palette.text;
        var label = function (text, x, y, align) {
          g.textAlign = align;
          g.strokeText(text, x, y);
          g.fillText(text, x, y);
        };
        meridians.forEach(function (lon) {
          var x = (mx(lon) - left) * s;
          if (x > 44 && x < W - 30) label(degrees(lon, stepX, 'E', 'W'), x + 4, 20, 'left');
        });
        parallels.forEach(function (lat) {
          var y = (my(lat) - top) * s;
          if (y > 34 && y < H - 30) label(degrees(lat, stepY, 'N', 'S'), 12, y - 4, 'left');
        });
      }
    }

    // -- Overlay: route, marker, names, scale. Drawn on every frame. --

    function drawOverlay(s, left, top, mpp) {
      var compact = Math.min(W, H) < 220;
      var px = function (p) {
        return [(p.x - left) * s, (p.y - top) * s];
      };
      var route = state.route.map(px);
      var boxes = [];
      var reserve = function (x, y, w, h) {
        boxes.push([x, y, x + w, y + h]);
      };
      var free = function (x, y, w, h) {
        if (x < 10 || y < 26 || x + w > W - 10 || y + h > H - 10) return false;
        for (var i = 0; i < boxes.length; i += 1) {
          var b = boxes[i];
          if (x < b[2] && b[0] < x + w && y < b[3] && b[1] < y + h) return false;
        }
        return true;
      };

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      // The route: dotted where it has not been walked yet, solid behind the marker.
      if (route.length > 1) {
        var reached = Math.max(0, Math.min(route.length - 1, state.progress));
        var whole = Math.floor(reached);
        var part = reached - whole;
        var tip = route[whole];
        if (part > 0 && route[whole + 1]) {
          tip = [tip[0] + (route[whole + 1][0] - tip[0]) * part, tip[1] + (route[whole + 1][1] - tip[1]) * part];
        }
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = palette.future;
        ctx.setLineDash([0.1, 4.5]);
        ctx.beginPath();
        ctx.moveTo(tip[0], tip[1]);
        for (var f = whole + 1; f < route.length; f += 1) ctx.lineTo(route[f][0], route[f][1]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (state.progress > 0) {
          ctx.strokeStyle = palette.frame;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(route[0][0], route[0][1]);
          for (var p = 1; p <= whole; p += 1) ctx.lineTo(route[p][0], route[p][1]);
          ctx.lineTo(tip[0], tip[1]);
          ctx.stroke();
        }
      }

      // One dot for every fix.
      route.forEach(function (point, i) {
        if (point[0] < -8 || point[1] < -8 || point[0] > W + 8 || point[1] > H + 8) return;
        var past = i <= state.progress;
        var radius = i === hover ? 4.5 : compact ? 2 : 2.8;
        ctx.beginPath();
        ctx.arc(point[0], point[1], radius, 0, Math.PI * 2);
        ctx.fillStyle = past ? palette.frame : palette.paper;
        ctx.fill();
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = palette.frame;
        ctx.stroke();
        reserve(point[0] - 5, point[1] - 5, 10, 10);
      });

      // The marker: where this photo was taken, how sure the phone was, and where the lens pointed.
      var marker = state.marker;
      if (marker) {
        var m = px(marker);
        var ring = marker.accuracy ? marker.accuracy / mpp : 0;
        if (ring > 11) {
          ctx.beginPath();
          ctx.arc(m[0], m[1], ring, 0, Math.PI * 2);
          ctx.fillStyle = css(palette.markRgb, 0.07);
          ctx.fill();
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.strokeStyle = css(palette.markRgb, 0.8);
          ctx.stroke();
          ctx.setLineDash([]);
          if (ring > 30 && !compact) {
            var metres = marker.accuracy;
            var text = '\u00b1' + (metres >= 1000 ? (metres / 1000).toFixed(1) + ' km' : Math.round(metres) + ' m');
            ctx.font = '500 9px "IBM Plex Mono", ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.lineWidth = 3;
            ctx.strokeStyle = palette.paper;
            ctx.strokeText(text, m[0], m[1] + ring - 6);
            ctx.fillStyle = palette.mark;
            ctx.fillText(text, m[0], m[1] + ring - 6);
            reserve(m[0] - 26, m[1] + ring - 18, 52, 16);
          }
        }
        if (marker.lost) {
          ctx.beginPath();
          ctx.arc(m[0], m[1], 7, 0, Math.PI * 2);
          ctx.fillStyle = palette.paper;
          ctx.fill();
          ctx.setLineDash([2.5, 2.5]);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = palette.mark;
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          if (marker.heading !== null && marker.heading !== undefined) {
            var angle = (marker.heading - 90) * RAD;
            var reach = compact ? 30 : 58;
            var glow = ctx.createRadialGradient(m[0], m[1], 4, m[0], m[1], reach);
            glow.addColorStop(0, css(palette.markRgb, 0.5));
            glow.addColorStop(1, css(palette.markRgb, 0));
            ctx.beginPath();
            ctx.moveTo(m[0], m[1]);
            ctx.arc(m[0], m[1], reach, angle - 0.42, angle + 0.42);
            ctx.closePath();
            ctx.fillStyle = glow;
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(m[0], m[1], compact ? 6 : 7.5, 0, Math.PI * 2);
          ctx.fillStyle = palette.paper;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(m[0], m[1], compact ? 4 : 5, 0, Math.PI * 2);
          ctx.fillStyle = palette.mark;
          ctx.fill();
        }
        reserve(m[0] - 12, m[1] - 12, 24, 24);
      }

      // Names. Each is placed where it does not collide with anything already on the chart.
      var write = function (text, x, y, align, color) {
        ctx.textAlign = align;
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = palette.paper;
        ctx.strokeText(text, x, y);
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
      };
      var spacing = function (value) {
        if ('letterSpacing' in ctx) ctx.letterSpacing = value;
      };
      ctx.textBaseline = 'middle';

      /** Try the label to the right of its point, then left, above and below. */
      var beside = function (text, x, y, height, color, gap) {
        var width = ctx.measureText(text).width;
        var tries = [
          [x + gap, y - height / 2, 'left', x + gap, y],
          [x - gap - width, y - height / 2, 'right', x - gap, y],
          [x - width / 2, y - gap - height, 'center', x, y - gap - height / 2],
          [x - width / 2, y + gap, 'center', x, y + gap + height / 2],
        ];
        for (var i = 0; i < tries.length; i += 1) {
          var t = tries[i];
          if (free(t[0] - 2, t[1] - 1, width + 4, height + 2)) {
            write(text, t[3], t[4], t[2], color);
            reserve(t[0] - 2, t[1] - 1, width + 4, height + 2);
            return true;
          }
        }
        return false;
      };

      var centred = function (text, x, y, height, color) {
        var width = ctx.measureText(text).width;
        if (!free(x - width / 2 - 3, y - height / 2 - 1, width + 6, height + 2)) return false;
        write(text, x, y, 'center', color);
        reserve(x - width / 2 - 3, y - height / 2 - 1, width + 6, height + 2);
        return true;
      };

      var inView = function (p) {
        return p.x > left && p.y > top && p.x < left + W / s && p.y < top + H / s;
      };

      if (!compact) {
        // Stops on the overview, in small capitals.
        if (state.stops.length) {
          ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
          spacing('0.8px');
          state.stops.forEach(function (stop) {
            var at = px(stop);
            beside(stop.text.toUpperCase(), at[0], at[1], 12, palette.frame, 9);
          });
        }

        // Towns and villages first: they say where you are.
        var shown = 0;
        var limit = mpp < DETAIL_BELOW ? 9 : 5;
        if (mpp < MID_BELOW && !state.stops.length) {
          spacing('0px');
          for (var n = 0; n < names.places.length && shown < limit; n += 1) {
            var place = names.places[n];
            var maxRank = mpp < 28 ? 4 : mpp < DETAIL_BELOW ? 2 : mpp < 420 ? 1 : 0;
            if (place.rank > maxRank || !inView(place)) continue;
            var at = px(place);
            ctx.font = (place.rank <= 1 ? '600 12.5px' : '400 11.5px') + ' "Source Serif 4", Georgia, serif';
            if (beside(place.name, at[0], at[1], 14, palette.text, 6)) {
              ctx.beginPath();
              ctx.arc(at[0], at[1], place.rank <= 1 ? 2.2 : 1.6, 0, Math.PI * 2);
              ctx.fillStyle = palette.text;
              ctx.fill();
              shown += 1;
            }
          }
        }

        // Then the water, in italics, as on any chart.
        spacing('1.2px');
        ctx.font = 'italic 400 13px "Bodoni Moda", Didot, serif';
        names.seas.forEach(function (sea) {
          if (mpp < sea.min || mpp > sea.max || !inView(sea)) return;
          var at = px(sea);
          centred(sea.name, at[0], at[1], 15, palette.sea);
        });
        if (mpp < DETAIL_BELOW) {
          var waters = 0;
          spacing('0.6px');
          ctx.font = 'italic 400 12px "Bodoni Moda", Didot, serif';
          for (var w = 0; w < names.waters.length && waters < 4; w += 1) {
            var water = names.waters[w];
            if (!inView(water)) continue;
            var spot = px(water);
            if (centred(water.name, spot[0], spot[1], 14, palette.sea)) waters += 1;
          }
        }
        spacing('0px');
      }

      // A dot under the pointer says which photo it is.
      if (hover >= 0 && route[hover] && state.tip) {
        var tipText = state.tip(hover);
        ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
        var tipWidth = ctx.measureText(tipText).width + 12;
        var tx = Math.max(8, Math.min(W - tipWidth - 8, route[hover][0] - tipWidth / 2));
        var ty = route[hover][1] > 44 ? route[hover][1] - 30 : route[hover][1] + 12;
        ctx.fillStyle = palette.frame;
        ctx.fillRect(tx, ty, tipWidth, 18);
        ctx.fillStyle = palette.paper;
        ctx.textAlign = 'left';
        ctx.fillText(tipText, tx + 6, ty + 9.5);
      }

      if (state.note && !compact) {
        ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
        spacing('0.8px');
        var noteWidth = ctx.measureText(state.note).width + 16;
        ctx.fillStyle = palette.mark;
        ctx.fillRect(14, H - 34 - 20, noteWidth, 20);
        ctx.fillStyle = palette.paper;
        ctx.textAlign = 'left';
        ctx.fillText(state.note, 22, H - 34 - 9.5);
        spacing('0px');
      }

      // Scale bar and north point.
      if (!compact) {
        var length = niceLength(mpp * Math.min(110, W * 0.26));
        var barWidth = length / mpp;
        var barX = options.scale === 'right' ? W - 16 - barWidth : 16;
        var barY = H - 20;
        var caption = length >= 1000 ? length / 1000 + ' km' : length + ' m';
        ctx.fillStyle = palette.paper;
        ctx.fillRect(barX - 4, barY - 16, barWidth + 8, 26);
        ctx.fillStyle = palette.frame;
        ctx.strokeStyle = palette.frame;
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(barX) + 0.5, barY + 0.5, Math.round(barWidth), 4);
        for (var q = 0; q < 4; q += 2) ctx.fillRect(Math.round(barX + (barWidth * q) / 4), barY, Math.round(barWidth / 4), 4);
        ctx.font = '400 9px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        ctx.fillStyle = palette.text;
        ctx.fillText('0', barX, barY - 5);
        ctx.textAlign = 'right';
        ctx.fillText(caption, barX + barWidth, barY - 5);

        var nx = W - 24;
        var ny = options.north === 'bottom' ? H - 30 : 34;
        ctx.strokeStyle = palette.frame;
        ctx.fillStyle = palette.frame;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(nx, ny + 12);
        ctx.lineTo(nx, ny - 8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(nx, ny - 12);
        ctx.lineTo(nx - 3.5, ny - 4);
        ctx.lineTo(nx + 3.5, ny - 4);
        ctx.closePath();
        ctx.fill();
        ctx.font = '500 9px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('N', nx, ny + 23);
      }

      // Neatline.
      ctx.strokeStyle = palette.frame;
      ctx.lineWidth = 1;
      if (options.frame) ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
      if (!compact) ctx.strokeRect(5.5, 5.5, W - 11, H - 11);
    }

    function draw(now) {
      queued = 0;
      if (!W || !H || !cam) return;

      if (flight) {
        var t = (now - flight.start) / flight.duration;
        if (t >= 1) {
          cam = flight.target;
          flight = null;
        } else {
          var at = flight.path.at(ease(Math.max(0, t)));
          cam = { x: at[0], y: at[1], w: at[2] };
          requestDraw();
        }
      }

      var s = Math.min(W, H) / cam.w; // CSS pixels per Mercator metre
      var left = cam.x - W / 2 / s;
      var top = cam.y - H / 2 / s;
      var mpp = Math.cos(latOf(cam.y) * RAD) / s; // metres on the ground per pixel

      var key = [cam.x, cam.y, cam.w, W, H, dpr, paletteRevision, dataRevision].join('|');
      if (key !== backKey) {
        drawBackdrop(backContext, s, left, top, mpp);
        backKey = key;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(back, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawOverlay(s, left, top, mpp);
    }

    // -- Pointer: dots can be hovered and picked. --

    function dotAt(event) {
      if (!cam || !W) return -1;
      var box = canvas.getBoundingClientRect();
      var s = Math.min(W, H) / cam.w;
      var x = cam.x + (event.clientX - box.left - W / 2) / s;
      var y = cam.y + (event.clientY - box.top - H / 2) / s;
      var best = -1;
      var bestDistance = 13 / s;
      state.route.forEach(function (point, i) {
        var d = Math.hypot(point.x - x, point.y - y);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      });
      return best;
    }

    function setHover(index) {
      if (index === hover) return;
      hover = index;
      canvas.style.cursor = index >= 0 ? 'pointer' : '';
      if (api.onHover) api.onHover(index);
      requestDraw();
    }

    canvas.addEventListener('pointermove', function (event) {
      if (event.pointerType === 'mouse') setHover(dotAt(event));
    });
    canvas.addEventListener('pointerleave', function () {
      setHover(-1);
    });
    canvas.addEventListener('click', function (event) {
      var index = dotAt(event);
      if (index >= 0 && api.onPick) api.onPick(index);
    });

    doc.addEventListener('themechange', function () {
      palette = readPalette(container);
      paletteRevision += 1;
      requestDraw();
    });

    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    window.addEventListener('resize', resize);
    resize();

    charts.push(api);
    return api;
  }

  function readFrames(scope) {
    var source = (scope || doc).querySelector('script[data-chart-frames]') || doc.querySelector('script[data-chart-frames]');
    try {
      return JSON.parse(source.textContent);
    } catch (error) {
      return [];
    }
  }

  var two = function (n) {
    return (n < 10 ? '0' : '') + n;
  };

  // ---- The album: the chart follows the photo being looked at ---------------------------

  function initJourney(hud) {
    var frames = readFrames();
    var figures = Array.prototype.slice.call(doc.querySelectorAll('[data-frame]'));
    if (!frames.length || !figures.length) return;

    var chart = createChart(hud.querySelector('.hud__chart'), { scale: 'left', north: 'bottom', frame: false, pad: [48, 48, 84, 48] });
    var field = {};
    Array.prototype.forEach.call(hud.querySelectorAll('[data-hud]'), function (element) {
      field[element.dataset.hud] = element;
    });
    var bars = Array.prototype.slice.call(hud.querySelectorAll('[data-bar]'));
    var modeButton = hud.querySelector('[data-chart-mode]');

    // The route is every distinct fix in order; each frame remembers the last one at or before it.
    var route = [];
    var routeIndex = frames.map(function (frame, i) {
      if (frame.fix) {
        var point = { x: mx(frame.fix[1]), y: my(frame.fix[0]), frame: i };
        var last = route[route.length - 1];
        if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 1) route.push(point);
      }
      return route.length - 1;
    });
    chart.state.route = route;
    chart.state.tip = function (index) {
      var frame = frames[route[index].frame];
      return two(frame.n) + '  ' + frame.place.toUpperCase();
    };

    var active = -1;
    var scrolled = -1;
    var whole = false;

    function lastFix(index) {
      for (var i = index; i >= 0; i -= 1) if (frames[i].fix) return frames[i];
      return null;
    }

    function viewFor(index) {
      var frame = lastFix(index);
      if (whole || !frame) return chart.fit();
      // Close in to about seven kilometres across; wider when the phone was unsure of itself.
      var ground = Math.max(7000, (frame.acc || 0) * 7);
      return { x: mx(frame.fix[1]), y: my(frame.fix[0]), w: ground / Math.cos(frame.fix[0] * RAD) };
    }

    function setActive(index, immediate) {
      if (index === active && !immediate) return;
      active = index;
      var frame = frames[index];
      var known = lastFix(index);

      field.index.textContent = two(frame.n);
      field.place.textContent = frame.place;
      field.area.textContent = frame.area;
      field.time.textContent = frame.when;
      field.pos.textContent = frame.pos;
      field.alt.textContent = frame.alt;
      field.hdg.textContent = frame.facing;
      bars.forEach(function (bar, i) {
        bar.classList.toggle('is-on', i === index);
        bar.classList.toggle('is-past', i < index);
      });
      figures.forEach(function (figure, i) {
        figure.classList.toggle('is-active', i === index);
      });

      chart.state.progress = routeIndex[index];
      chart.state.marker = known
        ? { x: mx(known.fix[1]), y: my(known.fix[0]), heading: frame.fix ? frame.hdg : null, accuracy: frame.fix ? frame.acc : 0, lost: !frame.fix }
        : null;
      chart.state.note = frame.fix ? '' : known ? 'NO GPS FIX \u00b7 LAST KNOWN POSITION' : 'NO GPS FIX \u00b7 THE ROUTE AHEAD';
      chart.view(viewFor(index), immediate);
    }

    function nearest() {
      var line = window.innerHeight * 0.45;
      var best = 0;
      var bestDistance = Infinity;
      figures.forEach(function (figure, i) {
        var box = figure.getBoundingClientRect();
        var distance = Math.abs((box.top + box.bottom) / 2 - line);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      });
      return best;
    }

    var queued = false;
    function onScroll() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        var index = nearest();
        if (index !== scrolled) {
          scrolled = index;
          setActive(index, false);
        }
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    // Pointing at a photo is enough to ask where it was taken.
    figures.forEach(function (figure, i) {
      figure.addEventListener('pointerenter', function (event) {
        if (event.pointerType === 'mouse') setActive(i, false);
      });
    });

    chart.onPick = function (index) {
      var figure = figures[route[index].frame];
      if (figure) figure.scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    };

    chart.onResize = function () {
      if (active >= 0) chart.view(viewFor(active), true);
    };

    if (modeButton) {
      modeButton.addEventListener('click', function () {
        whole = !whole;
        modeButton.setAttribute('aria-pressed', String(whole));
        chart.view(viewFor(active), false);
      });
    }

    scrolled = nearest();
    setActive(scrolled, true);
    loadData('base.js');
    loadData('detail.js');
  }

  // ---- The home page: the whole route, walked in a loop ----------------------------------

  function initOverview(container) {
    var frames = readFrames(container);
    if (!frames.length) return;
    var chart = createChart(container, { scale: 'right', north: 'top', frame: true, pad: [56, 70, 84, 70] });
    var readout = container.querySelector('[data-chart-readout]');
    var album = container.dataset.album || '';
    var restingText = readout ? readout.textContent : '';

    // Photos taken within about twelve kilometres of each other share a stop.
    var stops = [];
    frames.forEach(function (frame, i) {
      if (!frame.fix) return;
      var point = { x: mx(frame.fix[1]), y: my(frame.fix[0]), frame: i };
      var last = stops[stops.length - 1];
      var apart = last ? Math.hypot(last.x - point.x, last.y - point.y) * Math.cos(frame.fix[0] * RAD) : Infinity;
      if (apart > 12000) stops.push(point);
    });
    if (!stops.length) return;

    var named = {};
    chart.state.route = stops;
    chart.state.stops = stops
      .filter(function (stop) {
        var chapter = frames[stop.frame].chapter;
        if (named[chapter]) return false;
        named[chapter] = true;
        return true;
      })
      .map(function (stop) {
        return { x: stop.x, y: stop.y, text: frames[stop.frame].chapter || frames[stop.frame].place };
      });
    chart.state.tip = function (index) {
      return frames[stops[index].frame].place.toUpperCase();
    };

    var describe = function (index) {
      var frame = frames[stops[index].frame];
      return [frame.place, frame.area].filter(Boolean).join(', ') + ' \u00b7 ' + frame.date;
    };
    var say = function (text) {
      if (readout && readout.textContent !== text) readout.textContent = text;
    };

    function rest() {
      chart.state.progress = stops.length - 1;
      chart.state.marker = { x: stops[stops.length - 1].x, y: stops[stops.length - 1].y, heading: null };
      say(restingText);
      chart.redraw();
    }

    chart.onResize = function () {
      chart.view(chart.fit(), true);
    };
    chart.view(chart.fit(), true);

    chart.onPick = function (index) {
      if (album) window.location.href = album + '#' + frames[stops[index].frame].anchor;
    };

    loadData('base.js');

    if (reducedMotion.matches || stops.length < 2) {
      rest();
      return;
    }

    // Timeline: wait at a stop, travel to the next, and start again after the last.
    var DWELL = 1700;
    var legs = [];
    var total = 0;
    var size = chart.fit().w;
    stops.forEach(function (stop, i) {
      var next = stops[i + 1];
      var travel = next ? 650 + 1100 * Math.min(1, Math.hypot(next.x - stop.x, next.y - stop.y) / (size * 0.45)) : 0;
      legs.push({ start: total, dwell: next ? DWELL : DWELL * 2, travel: travel });
      total += (next ? DWELL : DWELL * 2) + travel;
    });

    var clock = 0;
    var previous = 0;
    var visible = false;
    var held = -1;
    var ticking = 0;

    function step(now) {
      ticking = 0;
      if (held < 0) clock = (clock + Math.min(100, previous ? now - previous : 0)) % total;
      previous = now;

      var index = legs.length - 1;
      while (index > 0 && legs[index].start > clock) index -= 1;
      var leg = legs[index];
      var into = clock - leg.start;
      var stop = stops[index];
      if (into <= leg.dwell || !stops[index + 1]) {
        chart.state.progress = index;
        chart.state.marker = { x: stop.x, y: stop.y, heading: frames[stop.frame].hdg };
        say(describe(index));
      } else {
        var u = ease(Math.min(1, (into - leg.dwell) / leg.travel));
        var next = stops[index + 1];
        chart.state.progress = index + u;
        chart.state.marker = { x: stop.x + (next.x - stop.x) * u, y: stop.y + (next.y - stop.y) * u, heading: null };
      }
      chart.redraw();
      run();
    }

    function run() {
      var active = visible && !doc.hidden;
      if (active && !ticking) ticking = requestAnimationFrame(step);
      if (!active) previous = 0;
    }

    // Pointing at a stop holds the marker there.
    chart.onHover = function (index) {
      held = index;
      if (index >= 0) clock = legs[index].start + 1;
    };

    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      run();
    }).observe(container);
    doc.addEventListener('visibilitychange', run);
    step(performance.now());
  }

  // ---- Start ----------------------------------------------------------------------------

  Array.prototype.forEach.call(doc.querySelectorAll('[data-chart]'), function (element) {
    if (element.dataset.chart === 'journey') initJourney(element);
    else if (element.dataset.chart === 'overview') initOverview(element);
  });

  // Text on the canvas uses the site's typefaces; draw again once they have arrived.
  if (doc.fonts && doc.fonts.load) {
    Promise.all([
      doc.fonts.load('italic 400 13px "Bodoni Moda"'),
      doc.fonts.load('500 10px "IBM Plex Mono"'),
      doc.fonts.load('400 9px "IBM Plex Mono"'),
      doc.fonts.load('400 12px "Source Serif 4"'),
      doc.fonts.load('600 12px "Source Serif 4"'),
    ]).then(function () {
      dataRevision += 1;
      charts.forEach(function (chart) {
        chart.redraw();
      });
    });
  }
})();
