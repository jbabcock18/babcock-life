/* babcock.life: behaviour shared by every page.
   Theme, search, the photo viewer, reading aids, the quote turner and the moving wall.
   No dependencies. Every feature starts from HTML that already works without it. */

(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var base = root.dataset.root || './';
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var version = (doc.currentScript && doc.currentScript.src.split('?v=')[1]) || '';

  var $ = function (selector, scope) {
    return (scope || doc).querySelector(selector);
  };
  var $$ = function (selector, scope) {
    return Array.prototype.slice.call((scope || doc).querySelectorAll(selector));
  };

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function icon(name) {
    return '<svg class="icon" aria-hidden="true" focusable="false"><use href="#' + name + '"/></svg>';
  }

  /** Run a DOM change inside a view transition where the browser has them and motion is welcome. */
  function transition(update) {
    if (!doc.startViewTransition || reducedMotion.matches) {
      update();
      return Promise.resolve();
    }
    try {
      return doc.startViewTransition(update).finished.catch(function () {});
    } catch (error) {
      update();
      return Promise.resolve();
    }
  }

  // ---- Theme -----------------------------------------------------------------

  function currentTheme() {
    return root.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  function toggleTheme() {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    transition(function () {
      root.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch (error) {
        /* private mode: the choice lasts for this page only */
      }
      doc.dispatchEvent(new CustomEvent('themechange'));
    });
  }

  $$('[data-theme-toggle]').forEach(function (button) {
    button.addEventListener('click', toggleTheme);
  });

  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', function () {
      doc.dispatchEvent(new CustomEvent('themechange'));
    });

  // ---- Search ----------------------------------------------------------------

  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  if (!isMac) {
    $$('[data-shortcut]').forEach(function (key) {
      key.textContent = 'Ctrl K';
    });
  }

  var palette = null;
  var searchData = null;

  var fold = function (text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"');
  };

  function pageUrl(url) {
    return base + url.split('/').map(encodeURIComponent).join('/').replace(/%23/g, '#');
  }

  function loadSearch() {
    if (searchData) return Promise.resolve(searchData);
    return new Promise(function (resolve, reject) {
      var script = doc.createElement('script');
      script.src = base + 'assets/search-index.js' + (version ? '?v=' + version : '');
      script.onload = function () {
        searchData = (window.BL_SEARCH || []).map(function (entry) {
          return {
            kind: entry.kind,
            title: entry.title,
            sub: entry.sub || '',
            url: entry.url,
            hay: fold(entry.title + ' ' + (entry.sub || '')),
            body: (entry.body || []).map(function (part) {
              return { id: part[0], text: part[1], hay: fold(part[1]) };
            }),
          };
        });
        resolve(searchData);
      };
      script.onerror = reject;
      doc.head.appendChild(script);
    });
  }

  /** Wrap each matched term in <mark>, escaping everything else. */
  function highlight(text, terms) {
    var hay = fold(text);
    var ranges = [];
    terms.forEach(function (term) {
      var from = 0;
      var at;
      while ((at = hay.indexOf(term, from)) !== -1) {
        ranges.push([at, at + term.length]);
        from = at + term.length;
      }
    });
    if (!ranges.length) return escapeHtml(text);
    ranges.sort(function (a, b) {
      return a[0] - b[0];
    });
    var out = '';
    var cursor = 0;
    ranges.forEach(function (range) {
      if (range[1] <= cursor) return;
      var start = Math.max(range[0], cursor);
      out += escapeHtml(text.slice(cursor, start)) + '<mark>' + escapeHtml(text.slice(start, range[1])) + '</mark>';
      cursor = range[1];
    });
    return out + escapeHtml(text.slice(cursor));
  }

  /** About 150 characters around the first match, cut at word boundaries. */
  function snippet(part, terms) {
    var first = part.text.length;
    terms.forEach(function (term) {
      var at = part.hay.indexOf(term);
      if (at !== -1 && at < first) first = at;
    });
    var start = Math.max(0, first - 50);
    var end = Math.min(part.text.length, start + 150);
    if (start > 0) start = part.text.indexOf(' ', start) + 1 || start;
    if (end < part.text.length) end = part.text.lastIndexOf(' ', end) > start ? part.text.lastIndexOf(' ', end) : end;
    return (start > 0 ? '\u2026' : '') + highlight(part.text.slice(start, end), terms) + (end < part.text.length ? '\u2026' : '');
  }

  var KIND_ORDER = { Page: 0, Album: 1, Place: 2, Project: 3, Note: 4, Quote: 5 };

  function search(query) {
    var terms = fold(query).split(/\s+/).filter(Boolean);
    var results = [];

    if (!terms.length) {
      searchData.forEach(function (entry) {
        if (entry.kind === 'Page' || entry.kind === 'Album' || entry.kind === 'Project') {
          results.push({ kind: entry.kind, title: escapeHtml(entry.title), sub: escapeHtml(entry.sub), url: pageUrl(entry.url), score: 0 });
        }
      });
      results.push({ kind: 'Action', title: 'Switch colour theme', sub: 'Porcelain or cyanotype', action: 'theme', score: 0 });
      return results;
    }

    searchData.forEach(function (entry) {
      var inTitle = terms.filter(function (term) {
        return entry.hay.indexOf(term) !== -1;
      });

      if (inTitle.length === terms.length) {
        var titleHay = fold(entry.title);
        var score = 100 - KIND_ORDER[entry.kind];
        if (titleHay.indexOf(terms[0]) === 0) score += 20;
        else if (titleHay.indexOf(' ' + terms[0]) !== -1) score += 10;
        results.push({
          kind: entry.kind,
          title: highlight(entry.title, terms),
          sub: highlight(entry.sub, terms),
          url: pageUrl(entry.url),
          score: score,
        });
      }

      // Paragraph hits: every term is in the paragraph, or split between it and the title.
      var hits = 0;
      for (var i = 0; i < entry.body.length && hits < 3; i += 1) {
        var part = entry.body[i];
        var inPart = 0;
        var covered = true;
        for (var t = 0; t < terms.length; t += 1) {
          if (part.hay.indexOf(terms[t]) !== -1) inPart += 1;
          else if (inTitle.indexOf(terms[t]) === -1) {
            covered = false;
            break;
          }
        }
        if (!covered || !inPart) continue;
        hits += 1;
        results.push({
          kind: entry.kind,
          title: escapeHtml(entry.title),
          sub: snippet(part, terms),
          url: pageUrl(entry.url + '#' + part.id),
          score: 50 + inPart - hits,
        });
      }
    });

    results.sort(function (a, b) {
      return b.score - a.score;
    });
    return results.slice(0, 40);
  }

  function buildPalette() {
    var dialog = doc.createElement('dialog');
    dialog.className = 'palette';
    dialog.setAttribute('aria-label', 'Search');
    dialog.innerHTML =
      '<div class="palette__field">' +
      icon('search') +
      '<input class="palette__input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" placeholder="Search notes, quotes, places" autocomplete="off" autocapitalize="off" spellcheck="false" />' +
      '</div>' +
      '<ul class="palette__list" id="palette-list" role="listbox" aria-label="Results"></ul>' +
      '<p class="palette__foot"><span>\u2191\u2193 move</span><span>\u21b5 open</span><span>esc close</span></p>';
    doc.body.appendChild(dialog);

    var input = $('.palette__input', dialog);
    var list = $('.palette__list', dialog);
    var selected = 0;
    var items = [];

    function select(index, scroll) {
      if (!items.length) return;
      selected = (index + items.length) % items.length;
      items.forEach(function (item, i) {
        item.setAttribute('aria-selected', i === selected ? 'true' : 'false');
      });
      input.setAttribute('aria-activedescendant', items[selected].id);
      if (scroll) items[selected].scrollIntoView({ block: 'nearest' });
    }

    function render() {
      var results = search(input.value);
      if (!results.length) {
        list.innerHTML = '<li class="palette__empty" role="presentation">Nothing found for \u201c' + escapeHtml(input.value.trim()) + '\u201d.</li>';
        items = [];
        input.removeAttribute('aria-activedescendant');
        return;
      }
      list.innerHTML = results
        .map(function (result, i) {
          var target = result.action ? 'href="#" data-action="' + result.action + '"' : 'href="' + escapeHtml(result.url) + '"';
          return (
            '<li role="presentation"><a class="palette__item" role="option" id="palette-option-' + i + '" ' + target + ' tabindex="-1">' +
            '<span class="label">' + result.kind + '</span>' +
            '<span><span class="palette__title">' + result.title + '</span>' +
            (result.sub ? '<span class="palette__sub">' + result.sub + '</span>' : '') +
            '</span></a></li>'
          );
        })
        .join('');
      items = $$('.palette__item', list);
      list.scrollTop = 0;
      select(0, false);
    }

    input.addEventListener('input', render);

    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        select(selected + (event.key === 'ArrowDown' ? 1 : -1), true);
      } else if (event.key === 'Enter' && items[selected]) {
        event.preventDefault();
        items[selected].click();
      }
    });

    list.addEventListener('pointermove', function (event) {
      var item = event.target.closest('.palette__item');
      if (item && item.getAttribute('aria-selected') !== 'true') select(items.indexOf(item), false);
    });

    list.addEventListener('click', function (event) {
      var item = event.target.closest('.palette__item');
      if (!item) return;
      if (item.dataset.action === 'theme') {
        event.preventDefault();
        dialog.close();
        toggleTheme();
        return;
      }
      // Links to another paragraph of the page already open only need the dialog out of the way.
      dialog.close();
    });

    // A click on the backdrop lands on the dialog element itself.
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) dialog.close();
    });

    return {
      open: function () {
        if (dialog.open) return;
        input.value = '';
        dialog.showModal();
        input.focus();
        list.innerHTML = '<li class="palette__empty" role="presentation">Loading\u2026</li>';
        loadSearch().then(render, function () {
          list.innerHTML = '<li class="palette__empty" role="presentation">Search could not be loaded.</li>';
        });
      },
      toggle: function () {
        if (dialog.open) dialog.close();
        else this.open();
      },
    };
  }

  function openPalette(toggle) {
    if (!palette) palette = buildPalette();
    if (toggle) palette.toggle();
    else palette.open();
  }

  $$('[data-palette-open]').forEach(function (button) {
    button.addEventListener('click', function () {
      openPalette(false);
    });
  });

  doc.addEventListener('keydown', function (event) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette(true);
    } else if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !$('dialog[open]')) {
      event.preventDefault();
      openPalette(false);
    }
  });

  // ---- Photo viewer ----------------------------------------------------------

  var viewer = null;

  function buildViewer() {
    var dialog = doc.createElement('dialog');
    dialog.className = 'lightbox';
    dialog.setAttribute('aria-label', 'Photo viewer');
    dialog.tabIndex = -1;
    dialog.innerHTML =
      '<div class="lightbox__stage"><img class="lightbox__image" alt="" /></div>' +
      '<button class="lightbox__button lightbox__button--close" type="button" aria-label="Close">' +
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>' +
      '<button class="lightbox__button lightbox__button--prev" type="button" aria-label="Previous photo">' + icon('arrow') + '</button>' +
      '<button class="lightbox__button lightbox__button--next" type="button" aria-label="Next photo">' + icon('arrow') + '</button>' +
      '<div class="lightbox__bar"><p class="lightbox__caption"></p><p class="lightbox__count"></p></div>';
    doc.body.appendChild(dialog);

    var stage = $('.lightbox__stage', dialog);
    var image = $('.lightbox__image', dialog);
    var caption = $('.lightbox__caption', dialog);
    var count = $('.lightbox__count', dialog);
    var previous = $('.lightbox__button--prev', dialog);
    var next = $('.lightbox__button--next', dialog);
    var group = [];
    var index = 0;
    var token = 0;

    function fit() {
      var link = group[index];
      if (!link) return;
      var w = Number(link.dataset.width);
      var h = Number(link.dataset.height);
      var scale = Math.min(stage.clientWidth / w, stage.clientHeight / h, 1);
      image.style.width = Math.round(w * scale) + 'px';
      image.style.height = Math.round(h * scale) + 'px';
    }

    function show(at) {
      index = (at + group.length) % group.length;
      var link = group[index];
      var thumb = $('img', link);
      var mine = (token += 1);

      // Show what is already on screen at once, then swap in the full file when it has arrived.
      image.removeAttribute('srcset');
      image.src = (thumb && thumb.currentSrc) || link.href;
      image.alt = thumb ? thumb.alt : '';
      fit();
      var full = new Image();
      full.onload = function () {
        if (mine === token) image.src = link.href;
      };
      full.src = link.href;

      caption.textContent = link.dataset.caption || '';
      count.textContent = group.length > 1 ? index + 1 + ' / ' + group.length : '';
      previous.hidden = next.hidden = group.length < 2;

      // Warm the neighbours so arrow keys feel instant.
      [index + 1, index - 1].forEach(function (near) {
        var neighbour = group[(near + group.length) % group.length];
        if (neighbour && neighbour !== link) new Image().src = neighbour.href;
      });
    }

    function thumbOf(link) {
      var thumb = $('img', link);
      if (!thumb) return null;
      var box = thumb.getBoundingClientRect();
      var visible = box.bottom > 0 && box.top < window.innerHeight && box.width > 0;
      return { element: thumb, visible: visible };
    }

    function open(link) {
      var name = link.dataset.zoomGroup;
      var seen = {};
      group = (name ? $$('a[data-zoom][data-zoom-group="' + name + '"]') : [link]).filter(function (item) {
        // The moving wall repeats its photos; keep one of each.
        if (item !== link && (seen[item.href] || item.href === link.href)) return false;
        seen[item.href] = true;
        return true;
      });
      var thumb = thumbOf(link);
      if (thumb) thumb.element.style.viewTransitionName = 'zoomed';
      transition(function () {
        if (thumb) thumb.element.style.viewTransitionName = '';
        dialog.showModal();
        dialog.focus();
        root.classList.add('is-locked');
        show(group.indexOf(link));
      });
    }

    function close() {
      if (!dialog.open) return;
      var link = group[index];
      var thumb = link && thumbOf(link);
      var done = function () {
        if (thumb) thumb.element.style.viewTransitionName = '';
      };
      transition(function () {
        dialog.close();
        if (thumb && !thumb.visible) thumb.element.scrollIntoView({ block: 'center', behavior: 'instant' });
        if (thumb) thumb.element.style.viewTransitionName = 'zoomed';
      }).then(done, done);
    }

    dialog.addEventListener('close', function () {
      root.classList.remove('is-locked');
      doc.dispatchEvent(new CustomEvent('viewerclose'));
    });

    // Escape: run the same closing transition as the button.
    dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      close();
    });

    dialog.addEventListener('click', function (event) {
      if (event.target === dialog || event.target === stage || event.target.closest('.lightbox__button--close')) close();
      else if (event.target.closest('.lightbox__button--prev')) show(index - 1);
      else if (event.target.closest('.lightbox__button--next') || event.target === image) show(index + 1);
    });

    dialog.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowRight') show(index + 1);
      else if (event.key === 'ArrowLeft') show(index - 1);
    });

    // Swipe sideways to change photo, down to close.
    var startX = 0;
    var startY = 0;
    stage.addEventListener(
      'touchstart',
      function (event) {
        startX = event.changedTouches[0].clientX;
        startY = event.changedTouches[0].clientY;
      },
      { passive: true },
    );
    stage.addEventListener(
      'touchend',
      function (event) {
        var dx = event.changedTouches[0].clientX - startX;
        var dy = event.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) show(index + (dx < 0 ? 1 : -1));
        else if (dy > 90 && dy > Math.abs(dx) * 1.5) close();
      },
      { passive: true },
    );

    window.addEventListener('resize', function () {
      if (dialog.open) fit();
    });

    return { open: open };
  }

  doc.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target.closest && event.target.closest('a[data-zoom]');
    if (!link || typeof HTMLDialogElement === 'undefined') return;
    event.preventDefault();
    if (!viewer) viewer = buildViewer();
    viewer.open(link);
  });

  // ---- Reading aids ------------------------------------------------------------

  var onScroll = [];
  var scrollQueued = false;
  function queueScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(function () {
      scrollQueued = false;
      onScroll.forEach(function (fn) {
        fn();
      });
    });
  }

  // Progress bar: CSS scroll-driven where supported, otherwise this.
  var progress = $('[data-progress]');
  if (progress && !(window.CSS && CSS.supports('animation-timeline: scroll()'))) {
    onScroll.push(function () {
      var max = root.scrollHeight - window.innerHeight;
      progress.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, window.scrollY / max) : 0) + ')';
    });
  }

  // Mark the section being read in the table of contents.
  var tocLinks = $$('.note__toc a');
  if (tocLinks.length) {
    var headings = tocLinks.map(function (link) {
      return doc.getElementById(decodeURIComponent(link.hash.slice(1)));
    });
    var currentSection = -1;
    onScroll.push(function () {
      var at = -1;
      for (var i = 0; i < headings.length; i += 1) {
        if (headings[i] && headings[i].getBoundingClientRect().top < window.innerHeight * 0.3) at = i;
      }
      if (at === currentSection) return;
      currentSection = at;
      tocLinks.forEach(function (link, i) {
        if (i === at) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
        link.classList.toggle('is-current', i === at);
      });
    });
  }

  if (onScroll.length) {
    window.addEventListener('scroll', queueScroll, { passive: true });
    window.addEventListener('resize', queueScroll);
    queueScroll();
  }

  // ---- Quote turner ------------------------------------------------------------

  $$('[data-quotes]').forEach(function (figure) {
    var source = $('[data-quote-list]', figure);
    var text = $('[data-quote-text]', figure);
    var cite = $('[data-quote-cite]', figure);
    var button = $('[data-quote-next]', figure);
    var quotes;
    try {
      quotes = JSON.parse(source.textContent);
    } catch (error) {
      return;
    }
    if (!quotes || quotes.length < 2) return;

    // Walk through every quote once, in a fresh order, before any repeats.
    var queue = [];
    function nextQuote() {
      if (!queue.length) {
        queue = quotes.filter(function (quote) {
          return quote.cite !== cite.textContent;
        });
        for (var i = queue.length - 1; i > 0; i -= 1) {
          var j = Math.floor(Math.random() * (i + 1));
          var swap = queue[i];
          queue[i] = queue[j];
          queue[j] = swap;
        }
      }
      return queue.pop();
    }

    button.hidden = false;
    button.addEventListener('click', function () {
      var quote = nextQuote();
      text.innerHTML = '<p>' + quote.html + '</p>';
      cite.textContent = quote.cite;
      text.classList.remove('is-turning');
      void text.offsetWidth;
      text.classList.add('is-turning');
    });
  });

  // ---- Moving wall -------------------------------------------------------------

  $$('[data-wall]').forEach(function (wall) {
    var list = $('.wall__list', wall);
    var toggle = $('[data-wall-toggle]');
    if (!list || reducedMotion.matches) return;

    var tiles = $$('.wall__tile', list);
    var columns = [];
    var holder = doc.createElement('div');
    holder.className = 'wall__columns';
    var paused = false;
    var visible = true;
    var push = 0;
    var last = 0;
    var frame = 0;

    function columnCount() {
      var width = wall.clientWidth;
      return width < 560 ? 2 : width < 900 ? 3 : width < 1280 ? 4 : 5;
    }

    function build() {
      var count = columnCount();
      if (count === columns.length) return;
      holder.textContent = '';
      holder.style.setProperty('--columns', count);
      columns = [];
      for (var c = 0; c < count; c += 1) {
        var element = doc.createElement('ul');
        element.className = 'wall__column';
        holder.appendChild(element);
        columns.push({
          element: element,
          direction: c % 2 ? -1 : 1,
          speed: 13 + ((c * 7) % 5) * 2.4,
          offset: 0,
          period: 0,
        });
      }
      tiles.forEach(function (tile, i) {
        columns[i % count].element.appendChild(tile);
      });
      // Each column carries a second copy of itself so it can loop without a seam.
      columns.forEach(function (column) {
        $$('.wall__tile', column.element).forEach(function (tile) {
          var copy = tile.cloneNode(true);
          copy.setAttribute('aria-hidden', 'true');
          $$('a', copy).forEach(function (link) {
            link.tabIndex = -1;
          });
          column.element.appendChild(copy);
        });
      });
      measure();
    }

    function measure() {
      var gap = parseFloat(getComputedStyle(holder).rowGap) || 8;
      columns.forEach(function (column) {
        column.period = (column.element.scrollHeight + gap) / 2;
      });
    }

    function tick(now) {
      frame = 0;
      var dt = Math.min(0.05, (now - last) / 1000 || 0);
      last = now;
      push *= Math.pow(0.04, dt);
      if (Math.abs(push) < 0.5) push = 0;
      columns.forEach(function (column) {
        if (!column.period) return;
        column.offset += column.direction * (column.speed + push) * dt;
        column.offset = ((column.offset % column.period) + column.period) % column.period;
        column.element.style.transform = 'translate3d(0,' + -column.offset.toFixed(2) + 'px,0)';
      });
      run();
    }

    function run() {
      var active = visible && !doc.hidden && !$('dialog[open]') && (!paused || push !== 0);
      if (active && !frame) {
        frame = requestAnimationFrame(tick);
      } else if (!active && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (!active) last = 0;
    }

    list.hidden = true;
    wall.appendChild(holder);
    wall.classList.add('is-moving');
    build();

    // Scrolling over the wall pushes it along; it coasts back to its own pace.
    wall.addEventListener(
      'wheel',
      function (event) {
        push = Math.max(-1400, Math.min(1400, push + event.deltaY * 2.2));
        run();
      },
      { passive: true },
    );

    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      run();
    }).observe(wall);

    doc.addEventListener('visibilitychange', run);
    doc.addEventListener('viewerclose', run);
    wall.addEventListener('click', function () {
      setTimeout(run, 0);
    });

    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        build();
        measure();
      }).observe(holder);
    }

    if (toggle) {
      toggle.hidden = false;
      toggle.addEventListener('click', function () {
        paused = !paused;
        toggle.setAttribute('aria-pressed', String(paused));
        toggle.textContent = paused ? 'Play' : 'Pause';
        run();
      });
    }

    run();
  });

  // ---- Page transitions ----------------------------------------------------------
  // The title of the thing you click grows into the headline of the page it opens,
  // and shrinks back when you return. Browsers without view transitions just navigate.

  var TITLE_PARTS = '.leaders__title, .contents__name, .tile__title, .plate__title, .pager__title';
  var ownTitle = $('.page-head__title, .note__title');

  function resetTitles() {
    $$(TITLE_PARTS).forEach(function (part) {
      part.style.viewTransitionName = '';
    });
    if (ownTitle) ownTitle.style.viewTransitionName = '';
  }

  function handOver(link) {
    var part = link && $(TITLE_PARTS, link);
    if (!part) return false;
    resetTitles();
    part.style.viewTransitionName = 'page-title';
    if (ownTitle) ownTitle.style.viewTransitionName = 'none';
    return true;
  }

  if ('CSSViewTransitionRule' in window || 'onpagereveal' in window) {
    doc.addEventListener('click', function (event) {
      var link = event.target.closest && event.target.closest('a[href]');
      if (link && !link.target && link.origin === location.origin) handOver(link);
    });

    // Coming back: find the link that leads to the page just left and morph into it.
    window.addEventListener('pagereveal', function (event) {
      resetTitles();
      var activation = window.navigation && navigation.activation;
      if (!event.viewTransition || !activation || !activation.from || !activation.from.url) return;
      var from = activation.from.url.split('#')[0];
      var link = $$('a[href]').filter(function (candidate) {
        return candidate.href.split('#')[0] === from && $(TITLE_PARTS, candidate);
      })[0];
      if (link && handOver(link)) event.viewTransition.finished.then(resetTitles, resetTitles);
    });

    window.addEventListener('pageshow', function (event) {
      if (event.persisted && !doc.startViewTransition) resetTitles();
    });
  }
})();
