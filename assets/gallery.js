(function () {
  'use strict';

  var DESKTOP = '(min-width: 760px)';
  var AUTOPLAY_MS = 3500;
  var SWIPE_PX = 40;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var carousels = [];
  var lb, lbImg, lbCap, lbPrev, lbNext, lbClose;
  var group = [];
  var gi = 0;
  var lastFocus = null;

  function prefersReduced() {
    return reducedMotion.matches;
  }

  function visibleCount() {
    return window.matchMedia(DESKTOP).matches ? 3 : 1;
  }

  function isLbOpen() {
    return !!(lb && lb.classList.contains('open'));
  }

  /* ---------- Swipe ---------- */
  function bindSwipe(el, onSwipe) {
    var x0 = 0, y0 = 0, tracking = false, locked = false;
    el.addEventListener('touchstart', function (e) {
      if (!e.changedTouches || !e.changedTouches.length) return;
      x0 = e.changedTouches[0].clientX;
      y0 = e.changedTouches[0].clientY;
      tracking = true;
      locked = false;
    }, { passive: true });
    el.addEventListener('touchmove', function (e) {
      if (!tracking) return;
      var x = e.changedTouches[0].clientX - x0;
      var y = e.changedTouches[0].clientY - y0;
      if (!locked && Math.abs(x) > 10 && Math.abs(x) > Math.abs(y)) locked = true;
      if (locked && e.cancelable) e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      var x = e.changedTouches[0].clientX - x0;
      var y = e.changedTouches[0].clientY - y0;
      if (Math.abs(x) >= SWIPE_PX && Math.abs(x) > Math.abs(y)) onSwipe(x < 0 ? 1 : -1);
    }, { passive: true });
  }

  /* ---------- Lightbox ---------- */
  function buildLightbox() {
    if (lb) return;
    lb = document.createElement('div');
    lb.className = 'lb';
    lb.id = 'lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Image viewer');
    lb.setAttribute('hidden', '');
    lb.innerHTML =
      '<div class="lb-backdrop" data-lb-close></div>' +
      '<div class="lb-dialog">' +
        '<button type="button" class="lb-close" aria-label="Close">&times;</button>' +
        '<button type="button" class="lb-prev" aria-label="Previous image">&#8249;</button>' +
        '<img alt="">' +
        '<div class="lb-caption" id="lb-caption" aria-live="polite"></div>' +
        '<button type="button" class="lb-next" aria-label="Next image">&#8250;</button>' +
      '</div>';
    document.body.appendChild(lb);
    lbImg = lb.querySelector('img');
    lbCap = lb.querySelector('.lb-caption');
    lbPrev = lb.querySelector('.lb-prev');
    lbNext = lb.querySelector('.lb-next');
    lbClose = lb.querySelector('.lb-close');

    lb.querySelector('[data-lb-close]').addEventListener('click', closeLb);
    lbClose.addEventListener('click', closeLb);
    lbPrev.addEventListener('click', function () { stepLb(-1); });
    lbNext.addEventListener('click', function () { stepLb(1); });

    document.addEventListener('keydown', function (e) {
      if (!isLbOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); closeLb(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepLb(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepLb(1); }
      else if (e.key === 'Tab') trapFocus(e);
    });

    bindSwipe(lb, function (dir) { stepLb(dir); });
  }

  function focusables() {
    return [lbClose, lbPrev, lbNext].filter(function (el) {
      return el && el.offsetParent !== null;
    });
  }

  function trapFocus(e) {
    var els = focusables();
    if (!els.length) return;
    var first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function showLbItem() {
    var item = group[gi];
    if (!item) return;
    lbImg.src = item.src;
    lbImg.alt = item.alt || item.caption || '';
    lbCap.textContent = item.caption || item.alt || '';
    lb.setAttribute('aria-label', item.caption ? 'Image viewer: ' + item.caption : 'Image viewer');
    lb.setAttribute('data-single', group.length < 2 ? 'true' : 'false');
  }

  function openLb(items, index) {
    buildLightbox();
    group = items;
    gi = index || 0;
    lastFocus = document.activeElement;
    showLbItem();
    lb.removeAttribute('hidden');
    lb.classList.add('open');
    document.body.classList.add('lb-lock');
    pauseAll();
    lbClose.focus();
  }

  function closeLb() {
    if (!lb) return;
    lb.classList.remove('open');
    lb.setAttribute('hidden', '');
    document.body.classList.remove('lb-lock');
    resumeAll();
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  function stepLb(dir) {
    if (group.length < 2) return;
    gi = (gi + dir + group.length) % group.length;
    showLbItem();
  }

  function itemFromFigure(fig) {
    var img = fig.querySelector('img');
    var cap = fig.querySelector('figcaption');
    if (!img) return null;
    return {
      src: img.getAttribute('src') || img.currentSrc || '',
      alt: img.alt || '',
      caption: cap ? cap.textContent.trim() : (img.alt || '')
    };
  }

  /* ---------- Fountain carousel ---------- */
  function initCarousel(root) {
    var viewport = root.querySelector('.g-viewport');
    var track = root.querySelector('.g-track');
    var prev = root.querySelector('.g-prev');
    var next = root.querySelector('.g-next');
    var dotsWrap = root.querySelector('.g-dots');
    var originals = Array.prototype.slice.call(track.children);
    var n = originals.length;
    if (!n) return;

    var state = { root: root, index: 0, vis: 1, timer: null, paused: false, hold: false, wrapping: false };

    originals.forEach(function (fig, i) {
      fig.setAttribute('data-g-i', String(i));
      fig.setAttribute('tabindex', '0');
      fig.setAttribute('role', 'button');
      var cap = fig.querySelector('figcaption');
      fig.setAttribute('aria-label', 'View ' + (cap ? cap.textContent.trim() : 'photo') + ', larger');
    });

    function lead() {
      return n > state.vis ? state.vis : 0;
    }

    function metrics() {
      var first = originals[0];
      var slide = first.getBoundingClientRect().width;
      var gap = parseFloat(window.getComputedStyle(track).gap) || 0;
      return { slide: slide, gap: gap, step: slide + gap };
    }

    function offsetAt(childIndex) {
      return childIndex * metrics().step;
    }

    function setTransform(childIndex, animate) {
      var reduce = prefersReduced() || !animate;
      track.style.transition = reduce ? 'none' : '';
      track.style.transform = 'translateX(' + (-offsetAt(childIndex)) + 'px)';
      if (reduce) {
        void track.offsetWidth;
        track.style.transition = '';
      }
    }

    function renderDots() {
      if (!dotsWrap) return;
      dotsWrap.innerHTML = '';
      for (var i = 0; i < n; i++) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-label', 'Photo ' + (i + 1) + ' of ' + n);
        b.setAttribute('aria-selected', i === state.index ? 'true' : 'false');
        if (i === state.index) b.className = 'on';
        (function (idx) {
          b.addEventListener('click', function () {
            goTo(idx, true);
            restart();
          });
        })(i);
        dotsWrap.appendChild(b);
      }
    }

    function goTo(logicalIndex, animate) {
      state.index = ((logicalIndex % n) + n) % n;
      setTransform(lead() + state.index, animate);
      renderDots();
    }

    function nextSlide(dir) {
      if (state.wrapping) return;
      var target = state.index + dir;
      var L = lead();
      if (n > state.vis && (target < 0 || target > n - 1)) {
        var real = target < 0 ? n - 1 : 0;
        var child = target < 0 ? (L - 1) : (L + n);
        if (prefersReduced()) {
          goTo(real, false);
          return;
        }
        state.wrapping = true;
        state.index = real;
        renderDots();
        track.style.transition = '';
        track.style.transform = 'translateX(' + (-offsetAt(child)) + 'px)';
        var done = function (e) {
          if (e && e.propertyName && e.propertyName !== 'transform') return;
          track.removeEventListener('transitionend', done);
          goTo(real, false);
          state.wrapping = false;
        };
        track.addEventListener('transitionend', done);
        setTimeout(function () {
          if (state.wrapping) done({ propertyName: 'transform' });
        }, 700);
        return;
      }
      goTo(((target % n) + n) % n, true);
    }

    function clearClones() {
      Array.prototype.slice.call(track.querySelectorAll('[data-clone]')).forEach(function (c) {
        c.parentNode.removeChild(c);
      });
    }

    function rebuild() {
      state.vis = visibleCount();
      clearClones();
      if (n > state.vis) {
        for (var i = 0; i < state.vis; i++) {
          var head = originals[i].cloneNode(true);
          head.setAttribute('data-clone', 'end');
          head.setAttribute('tabindex', '-1');
          head.removeAttribute('role');
          track.appendChild(head);
          var tail = originals[n - state.vis + i].cloneNode(true);
          tail.setAttribute('data-clone', 'start');
          tail.setAttribute('tabindex', '-1');
          tail.removeAttribute('role');
          track.insertBefore(tail, track.firstChild);
        }
      }
      if (state.index > n - 1) state.index = 0;
      goTo(state.index, false);
      root.classList.add('is-ready');
    }

    function canAutoplay() {
      return !prefersReduced() && !state.paused && !state.hold && !document.hidden && !isLbOpen() && n > 1;
    }
    function stop() {
      if (state.timer) { clearInterval(state.timer); state.timer = null; }
    }
    function play() {
      stop();
      if (!canAutoplay()) return;
      state.timer = setInterval(function () { nextSlide(1); }, AUTOPLAY_MS);
    }
    function restart() { stop(); play(); }

    state.play = play;
    state.stop = stop;
    carousels.push(state);

    if (prev) prev.addEventListener('click', function () { nextSlide(-1); restart(); });
    if (next) next.addEventListener('click', function () { nextSlide(1); restart(); });

    function hold(on) {
      state.hold = on;
      if (on) stop(); else play();
    }
    root.addEventListener('mouseenter', function () { hold(true); });
    root.addEventListener('mouseleave', function () { hold(false); });
    root.addEventListener('focusin', function () { hold(true); });
    root.addEventListener('focusout', function (e) {
      if (!root.contains(e.relatedTarget)) hold(false);
    });
    root.addEventListener('touchstart', function () { hold(true); }, { passive: true });
    root.addEventListener('touchend', function () {
      setTimeout(function () { hold(false); }, 600);
    }, { passive: true });

    var items = originals.map(itemFromFigure);
    var ignoreClick = false;
    track.addEventListener('click', function (e) {
      if (ignoreClick) { ignoreClick = false; return; }
      var fig = e.target.closest('figure');
      if (!fig || !track.contains(fig)) return;
      var i = parseInt(fig.getAttribute('data-g-i'), 10);
      if (isNaN(i)) return;
      openLb(items, i);
    });
    track.addEventListener('keydown', function (e) {
      var fig = e.target.closest('figure');
      if (!fig || fig.getAttribute('data-clone')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        var i = parseInt(fig.getAttribute('data-g-i'), 10);
        if (!isNaN(i)) openLb(items, i);
      }
    });

    bindSwipe(viewport, function (dir) {
      ignoreClick = true;
      nextSlide(dir);
      restart();
    });

    window.addEventListener('resize', function () {
      var v = visibleCount();
      if (v !== state.vis) rebuild();
      else goTo(state.index, false);
    });

    rebuild();
    play();
  }

  function pauseAll() {
    carousels.forEach(function (c) { c.paused = true; c.stop(); });
  }
  function resumeAll() {
    carousels.forEach(function (c) { c.paused = false; c.play(); });
  }

  document.addEventListener('visibilitychange', function () {
    carousels.forEach(function (c) {
      if (document.hidden) c.stop(); else c.play();
    });
  });
  reducedMotion.addEventListener('change', function () {
    carousels.forEach(function (c) { if (prefersReduced()) c.stop(); else c.play(); });
  });

  /* ---------- Toy images ---------- */
  function initToys() {
    document.querySelectorAll('.toy').forEach(function (card) {
      var main = card.querySelector('.toy-main img');
      var wrap = card.querySelector('.toy-main');
      if (!main || !wrap) return;
      var thumbImgs = Array.prototype.slice.call(card.querySelectorAll('.toy-thumbs img'));
      var thumbBtns = Array.prototype.slice.call(card.querySelectorAll('.toy-thumbs button'));

      function groupFromCard() {
        var seen = {};
        var items = [];
        function addSrc(src, alt) {
          if (!src || seen[src]) return;
          seen[src] = true;
          items.push({ src: src, alt: alt || '', caption: alt || '' });
        }
        thumbBtns.forEach(function (btn) {
          var img = btn.querySelector('img');
          addSrc(btn.getAttribute('data-src') || (img && (img.getAttribute('src') || img.currentSrc)), img ? img.alt : '');
        });
        thumbImgs.forEach(function (img) {
          addSrc(img.getAttribute('src') || img.currentSrc, img.alt);
        });
        addSrc(main.getAttribute('src') || main.currentSrc, main.alt);
        return items;
      }

      wrap.setAttribute('tabindex', '0');
      wrap.setAttribute('role', 'button');
      wrap.setAttribute('aria-label', 'View ' + (main.alt || 'toy photo') + ', larger');
      wrap.addEventListener('click', function () {
        var items = groupFromCard();
        var src = main.getAttribute('src') || main.currentSrc;
        var idx = 0;
        for (var i = 0; i < items.length; i++) {
          if (items[i].src === src) { idx = i; break; }
        }
        openLb(items, idx);
      });
      wrap.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wrap.click(); }
      });
    });
  }

  buildLightbox();
  document.querySelectorAll('[data-gallery-carousel]').forEach(initCarousel);
  initToys();
})();
