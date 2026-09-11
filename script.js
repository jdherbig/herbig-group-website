(function () {
  "use strict";

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Mobile menu (grows from under the navbar; header is stable — bind once) ----------
   * #mobile-menu lives outside #route-content next to the navbar, so this
   * binds once and keeps working across every PJAX page swap. The navbar
   * itself never gets covered — it stays put and eases into the same dark
   * theme as the panel beneath it (see .navbar.menu-open in styles.css),
   * so opening reads as one seamless move into dark mode rather than two
   * separate things happening on top of each other. The hamburger button
   * (which already animates into an X via the existing aria-expanded
   * rules) is the only open/close control — no separate close button. */
  var toggle = document.getElementById("menu-toggle");
  var mobileMenu = document.getElementById("mobile-menu");
  var navbar = document.getElementById("navbar");

  if (toggle && mobileMenu) {
    var openMobileMenu = function () {
      mobileMenu.classList.add("is-open");
      mobileMenu.setAttribute("aria-hidden", "false");
      toggle.setAttribute("aria-expanded", "true");
      if (navbar) navbar.classList.add("menu-open");
      document.documentElement.classList.add("no-scroll");
    };

    var closeMobileMenu = function () {
      mobileMenu.classList.remove("is-open");
      mobileMenu.setAttribute("aria-hidden", "true");
      toggle.setAttribute("aria-expanded", "false");
      if (navbar) navbar.classList.remove("menu-open");
      document.documentElement.classList.remove("no-scroll");
    };

    toggle.addEventListener("click", function () {
      if (mobileMenu.classList.contains("is-open")) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    });

    mobileMenu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeMobileMenu);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && mobileMenu.classList.contains("is-open")) closeMobileMenu();
    });

    // Never leave the overlay stuck open (e.g. a resize past the 900px
    // breakpoint, where .mobile-menu is force-hidden by CSS but would
    // otherwise still hold the scroll lock and aria-expanded state).
    window.addEventListener("resize", function () {
      if (window.matchMedia("(min-width: 900px)").matches && mobileMenu.classList.contains("is-open")) {
        closeMobileMenu();
      }
    });
  }

  /* ---------- Navbar theme (transparent/frosted+white over dark sections, solid white+green elsewhere) ----------
   * The dark/light sections it reads (data-navbar-theme="dark") live inside
   * #route-content, so refreshDarkSections() is re-run by Herbig.initContent()
   * after every client-side page swap. The scroll/resize/ResizeObserver
   * plumbing itself only needs to be wired up once — the header never moves. */
  var navbar = document.getElementById("navbar");
  var darkSections = [];

  // While a page-to-page transition is in flight, #route-content is
  // mid-fade (exit) or hasn't risen into place yet (enter) — its
  // data-navbar-theme section is present in the DOM but not yet visibly
  // painted, so reading "what's behind the navbar" would be correct on
  // paper but wrong on screen: a transparent/dark-theme navbar over
  // barely-there content reads as invisible white-on-white text. Locking
  // to the solid "is-scrolled" look for the duration of the transition
  // (see transitions.js) keeps the navbar legible throughout; unlocking
  // re-syncs it to the real scroll position the instant the transition
  // settles.
  var navbarThemeLocked = false;

  // Compact scroll state: independent of the dark/light theme swap above -
  // it should reflect literal scroll position, not what section is behind
  // the navbar, so it never "grows back" while scrolling past a dark
  // section further down the page. See .navbar.is-compact in styles.css.
  var COMPACT_THRESHOLD = 24;

  var updateNavbar = function () {
    if (!navbar) return;
    tickingNavbar = false;
    navbar.classList.toggle("is-compact", window.scrollY > COMPACT_THRESHOLD);
    if (navbarThemeLocked) {
      navbar.classList.add("is-scrolled");
      return;
    }
    // offsetTop/offsetHeight are layout-based and ignore CSS transforms, so this
    // stays correct even while #route-content is mid-rise (translateY animating
    // in) right after the branded transition swaps in a new page — a plain
    // getBoundingClientRect() read here would pick up that in-flight offset and
    // misjudge what's behind the navbar until the animation settles.
    var testY = window.scrollY + navbar.offsetHeight + 1;
    var overDark = darkSections.some(function (el) {
      var top = el.offsetTop;
      var bottom = top + el.offsetHeight;
      return top <= testY && bottom > testY;
    });
    navbar.classList.toggle("is-scrolled", !overDark);
  };

  var tickingNavbar = false;
  var requestNavbarUpdate = function () {
    if (tickingNavbar) return;
    tickingNavbar = true;
    window.requestAnimationFrame(updateNavbar);
  };

  var refreshDarkSections = function () {
    darkSections = Array.prototype.slice.call(
      document.querySelectorAll('[data-navbar-theme="dark"]')
    );
    updateNavbar();
  };

  if (navbar) {
    refreshDarkSections();
    window.addEventListener("scroll", requestNavbarUpdate, { passive: true });
    window.addEventListener("resize", requestNavbarUpdate);
    window.addEventListener("load", requestNavbarUpdate);
    if ("ResizeObserver" in window) {
      new ResizeObserver(requestNavbarUpdate).observe(document.body);
    }
  }

  /* ---------- Content-scoped behaviours ----------
   * Everything below targets elements that live inside #route-content and
   * get replaced whenever the branded page-transition system (transitions.js)
   * swaps in a new route. initContent() re-binds all of it; it is safe to
   * call repeatedly since each call only ever touches freshly-inserted DOM
   * nodes (nothing here is additive/leaky across calls). */

  function initHeroZoom() {
    var hero = document.querySelector(".hero");
    if (hero) {
      requestAnimationFrame(function () { hero.classList.add("is-loaded"); });
    }
  }

  function initScrollReveal() {
    var revealEls = document.querySelectorAll(".reveal, .reveal-stagger, .reveal-left, .reveal-right");
    if (!revealEls.length) return;

    if (!("IntersectionObserver" in window)) {
      revealEls.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach(function (el) { observer.observe(el); });
  }

  function initDragScroll(outer) {
    var isDown = false;
    var startX = 0;
    var startScroll = 0;
    var velocity = 0;
    var lastX = 0;
    var lastT = 0;

    outer.addEventListener("pointerdown", function (e) {
      isDown = true;
      outer.setPointerCapture(e.pointerId);
      startX = e.clientX;
      lastX = e.clientX;
      lastT = performance.now();
      startScroll = outer.scrollLeft;
      velocity = 0;
    });
    outer.addEventListener("pointermove", function (e) {
      if (!isDown) return;
      var dx = e.clientX - startX;
      outer.scrollLeft = startScroll - dx;
      var now = performance.now();
      var dt = now - lastT || 16;
      velocity = (lastX - e.clientX) / dt;
      lastX = e.clientX;
      lastT = now;
    });
    var endDrag = function () {
      if (!isDown) return;
      isDown = false;
      if (!prefersReducedMotion && Math.abs(velocity) > 0.05) {
        var glide = function () {
          velocity *= 0.94;
          outer.scrollLeft += velocity * 16;
          if (Math.abs(velocity) > 0.02) requestAnimationFrame(glide);
        };
        requestAnimationFrame(glide);
      }
    };
    outer.addEventListener("pointerup", endDrag);
    outer.addEventListener("pointerleave", endDrag);

    outer.addEventListener(
      "wheel",
      function (e) {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          // Scroll-snap + the track’s own horizontal padding mean the
          // resting min/max scrollLeft isn’t exactly 0 / scrollWidth -
          // clientWidth — it’s offset by that padding. Read it so the
          // boundary check matches where the track actually comes to rest,
          // otherwise wheel scroll gets trapped just short of either end.
          var trackStyle = getComputedStyle(outer);
          var padStart = parseFloat(trackStyle.paddingLeft) || 0;
          var padEnd = parseFloat(trackStyle.paddingRight) || 0;
          var atStart = outer.scrollLeft <= padStart;
          var atEnd = outer.scrollLeft >= outer.scrollWidth - outer.clientWidth - padEnd;
          if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) {
            return; // already at this end — let the page scroll normally
          }
          outer.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      },
      { passive: false }
    );
  }

  /* Pins the card row in the viewport (below the fixed navbar) and
   * translates it horizontally in lockstep with vertical scroll, so
   * scrolling the page IS how you move through the team carousel.
   * scrollWrap is given extra height (its sticky child’s own height
   * plus however far the track needs to travel) so there’s exactly
   * enough scroll distance to reach the end before the section unpins
   * and normal page scroll continues. */
  // initContent() (and so initCinematicTrack()) re-runs on every client-side
  // navigation, but #cinematic-track/#cinematic-scroll only exist on
  // index.html, so a round trip away and back to the homepage would
  // otherwise leave the previous visit’s window-level scroll/resize
  // listeners (closed over now-detached DOM nodes) permanently attached.
  // Track and tear down the previous instance before starting a new one.
  var activePinnedScrollCleanup = null;

  // Same story as activePinnedScrollCleanup above, for the People/Purpose/
  // Profit scroll-reveal below (#core only exists on index.html).
  var activeEquationScrollCleanup = null;

  // Same story again, for the pathway-card image breakout below
  // (#pillars only exists on index.html).
  var activePathwayScrollCleanup = null;

  function initPinnedScroll(scrollWrap, sticky, outer, track) {
    scrollWrap.classList.add("is-pinned");

    var maxTranslate = 0;
    var navHeight = 0;
    var ticking = false;

    function measure() {
      navHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-height")) || 0;
      // outer is overflow:visible in pinned mode, so its scrollWidth/clientWidth
      // no longer reflect the overflowing content (browsers only report a real
      // scrollWidth when the element is an actual scroll container). Measure the
      // track’s rendered width directly instead, and add back outer’s own
      // horizontal padding to get the same “total content width” figure
      // scrollWidth used to give us.
      var outerStyle = getComputedStyle(outer);
      var padStart = parseFloat(outerStyle.paddingLeft) || 0;
      var padEnd = parseFloat(outerStyle.paddingRight) || 0;
      var contentWidth = padStart + track.getBoundingClientRect().width + padEnd;
      var viewportWidth = outer.getBoundingClientRect().width;
      maxTranslate = Math.max(0, contentWidth - viewportWidth);
      scrollWrap.style.height = (sticky.getBoundingClientRect().height + maxTranslate) + "px";
    }

    function apply() {
      ticking = false;
      if (maxTranslate <= 0) {
        track.style.transform = "";
        return;
      }
      var wrapTop = scrollWrap.getBoundingClientRect().top;
      var scrolledIntoPin = navHeight - wrapTop;
      var progress = Math.min(1, Math.max(0, scrolledIntoPin / maxTranslate));
      track.style.transform = "translate3d(" + (-progress * maxTranslate) + "px, 0, 0)";
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(apply);
      }
    }

    function onResize() {
      measure();
      apply();
    }

    measure();
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    activePinnedScrollCleanup = function () {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }

  function initCinematicTrack() {
    if (activePinnedScrollCleanup) {
      activePinnedScrollCleanup();
      activePinnedScrollCleanup = null;
    }

    var track = document.getElementById("cinematic-track");
    if (!track) return;
    var outer = track.parentElement;
    var scrollWrap = document.getElementById("cinematic-scroll");
    var sticky = scrollWrap ? scrollWrap.querySelector(".cinematic-scroll__sticky") : null;
    var canPin = scrollWrap && sticky && window.matchMedia("(min-width: 900px)").matches && !prefersReducedMotion;

    if (canPin) {
      initPinnedScroll(scrollWrap, sticky, outer, track);
    } else {
      initDragScroll(outer);
    }
  }

  /* ---------- "People / Purpose / Profit" scroll-driven pillar reveal ----------
   * The Purpose card (.eq-card--dark) is the section's anchor: it settles
   * into place first, and stays visually dominant throughout. People and
   * Profit start pulled in toward its position — spatially closer, dimmer,
   * and beneath it in stacking order (see .eq-card z-index in styles.css) —
   * then spread outward into their resting grid position as the section
   * scrolls through the viewport. This is continuously tied to scroll
   * position (not a one-shot trigger): scrolling back up un-reveals it too.
   *
   * Each side card's starting offset is measured from its own live
   * position relative to Purpose's centre (getBoundingClientRect(), not a
   * hardcoded pixel value), so the same logic naturally reads as a
   * horizontal reveal on the desktop row layout and a vertical one once
   * .equation-grid stacks to a single column on narrow viewports — no
   * separate mobile code path needed.
   *
   * Only transform/opacity are ever touched (see the Performance note in
   * initPinnedScroll above) — never layout properties — so this can't
   * shift the page while scrolling. */
  function initEquationReveal() {
    if (activeEquationScrollCleanup) {
      activeEquationScrollCleanup();
      activeEquationScrollCleanup = null;
    }

    var grid = document.querySelector(".equation-grid");
    if (!grid || prefersReducedMotion) return;

    var purpose = grid.querySelector(".eq-card--dark");
    var sideCards = Array.prototype.slice.call(grid.querySelectorAll(".eq-card:not(.eq-card--dark)"));
    if (!purpose || !sideCards.length) return;

    var REACH = 0.68;       // how far toward Purpose's centre each side card starts, 0-1
    var RISE = 28;           // secondary "rising into place" offset shared by both side cards, px
    var PURPOSE_SETTLE = 16; // Purpose's own much smaller settle distance, px
    var PURPOSE_END = 0.3;   // Purpose finishes settling by this fraction of overall progress
    var SIDE_START = 0.4;    // side cards begin spreading at this fraction (the gap before it
                              // is the "brief moment of stability" after Purpose settles)
    var TRIGGER_START_FRAC = 0.85; // grid top at 85% down the viewport -> progress 0
    var TRIGGER_END_FRAC = 0.3;    // grid top at 30% down the viewport -> progress 1

    var offsets = [];
    var ticking = false;

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function measure() {
      var purposeRect = purpose.getBoundingClientRect();
      var purposeCenterX = purposeRect.left + purposeRect.width / 2;
      var purposeCenterY = purposeRect.top + purposeRect.height / 2;

      offsets = sideCards.map(function (el) {
        var rect = el.getBoundingClientRect();
        var centerX = rect.left + rect.width / 2;
        var centerY = rect.top + rect.height / 2;
        return {
          el: el,
          startX: (purposeCenterX - centerX) * REACH,
          startY: (purposeCenterY - centerY) * REACH + RISE
        };
      });
    }

    function apply() {
      ticking = false;

      var rect = grid.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      var startY = vh * TRIGGER_START_FRAC;
      var endY = vh * TRIGGER_END_FRAC;
      var progress = Math.min(1, Math.max(0, (startY - rect.top) / (startY - endY)));

      var purposeT = easeOutCubic(Math.min(1, progress / PURPOSE_END));
      var sideT = easeOutCubic(Math.min(1, Math.max(0, (progress - SIDE_START) / (1 - SIDE_START))));

      if (progress >= 1) {
        // Fully settled: hand control back to plain CSS (so :hover etc.
        // keep working normally) rather than leaving an identity inline
        // transform sitting on top of it forever.
        purpose.style.transform = "";
        purpose.style.transition = "";
      } else {
        purpose.style.transition = "none";
        purpose.style.transform = "translate3d(0, " + (PURPOSE_SETTLE * (1 - purposeT)) + "px, 0) scale(" + (0.98 + 0.02 * purposeT) + ")";
      }

      offsets.forEach(function (o) {
        if (progress >= 1) {
          o.el.style.transform = "";
          o.el.style.opacity = "";
          o.el.style.transition = "";
        } else {
          o.el.style.transition = "none";
          o.el.style.transform = "translate3d(" + (o.startX * (1 - sideT)) + "px, " + (o.startY * (1 - sideT)) + "px, 0) scale(" + (0.97 + 0.03 * sideT) + ")";
          o.el.style.opacity = String(0.15 + 0.85 * sideT);
        }
      });
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(apply);
      }
    }

    function onResize() {
      measure();
      apply();
    }

    measure();
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    activeEquationScrollCleanup = function () {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      purpose.style.transform = "";
      purpose.style.transition = "";
      offsets.forEach(function (o) {
        o.el.style.transform = "";
        o.el.style.opacity = "";
        o.el.style.transition = "";
      });
    };
  }

  /* ---------- Pathway image "breakout" toward the viewport edge ----------
   * Each .pathway-card's image is free to travel past the card's own
   * footprint now (.pathway-card is overflow:visible on desktop — see
   * styles.css), so as a card scrolls through the viewport its image
   * gradually slides outward - left for the first pillar, right for the
   * reverse-orientation second one - growing slightly and gaining a
   * touch of saturation as it goes, while the glass panel and copy stay
   * exactly where they are. It's a second, later stage of the same
   * card's scroll-through: the breakout only starts once the card is
   * already well into view, not from the moment it first appears.
   *
   * The travel distance isn't a fixed pixel value - it's measured from
   * the image's own live position out to the actual viewport edge (minus
   * a fixed breathing-room gap), so it's already correct at any
   * viewport width without separate tablet/desktop cases, and it can
   * never overshoot into the scrollbar or off-screen. Below the 900px
   * breakpoint .pathway-card__image goes back to being a normal
   * in-flow, clipped box (see styles.css), so there's no edge to break
   * out toward - the mobile fallback instead does a small in-place
   * rise + zoom within that same clipped box. */
  function initPathwayBreakout() {
    if (activePathwayScrollCleanup) {
      activePathwayScrollCleanup();
      activePathwayScrollCleanup = null;
    }

    var cards = Array.prototype.slice.call(document.querySelectorAll(".pathway-card"));
    if (!cards.length || prefersReducedMotion) return;

    var EDGE_GAP = 32;        // desktop: breathing room kept between the image and the true viewport edge, px
    var SCALE_MAX = 1.06;
    var MOBILE_RISE = 10;     // mobile: secondary translateY in place of the horizontal breakout, px
    var BREAKOUT_START = 0.3; // fraction of a card's own scroll-through progress before breakout begins (0-30% = still contained)
    var TRIGGER_START_FRAC = 0.85; // a card's top at 85% down the viewport -> that card's progress 0
    var TRIGGER_END_FRAC = 0.25;   // a card's top at 25% down the viewport -> that card's progress 1

    var entries = [];
    var ticking = false;

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function measure() {
      var isDesktop = window.matchMedia("(min-width: 900px)").matches;
      var vw = document.documentElement.clientWidth || window.innerWidth;

      entries = cards.map(function (card) {
        var img = card.querySelector(".pathway-card__image");
        if (!img) return null;
        var isReverse = card.classList.contains("pathway-card--reverse");

        img.style.transform = ""; // clear first so the rect below reads the true resting position

        var targetX = 0;
        if (isDesktop) {
          var rect = img.getBoundingClientRect();
          // scale() grows the box from its own centre, so at full breakout
          // (SCALE_MAX) the outward edge has already moved by half the
          // added width on its own - fold that into the translate target
          // so the two combine to land exactly EDGE_GAP from the viewport
          // edge, not overshoot past it.
          var scaleEdgeShift = (SCALE_MAX - 1) * rect.width / 2;
          targetX = isReverse
            ? ((vw - EDGE_GAP) - rect.right) - scaleEdgeShift
            : (EDGE_GAP - rect.left) + scaleEdgeShift;
          // Only ever move outward (right for the reverse card, left for the
          // default one) - never inward, even if a card already sits close
          // to the edge on a narrower desktop width.
          targetX = isReverse ? Math.max(0, targetX) : Math.min(0, targetX);
        }

        return { card: card, img: img, isDesktop: isDesktop, targetX: targetX };
      }).filter(Boolean);
    }

    function apply() {
      ticking = false;
      var vh = window.innerHeight || document.documentElement.clientHeight;
      var startY = vh * TRIGGER_START_FRAC;
      var endY = vh * TRIGGER_END_FRAC;

      entries.forEach(function (entry) {
        var rect = entry.card.getBoundingClientRect();
        var progress = Math.min(1, Math.max(0, (startY - rect.top) / (startY - endY)));
        var t = easeOutCubic(Math.min(1, Math.max(0, (progress - BREAKOUT_START) / (1 - BREAKOUT_START))));

        if (t <= 0) {
          entry.img.style.transform = "";
          entry.img.style.transition = "";
          return;
        }

        var scale = 1 + (SCALE_MAX - 1) * t;
        entry.img.style.transition = "none";
        entry.img.style.transform = entry.isDesktop
          ? "translate3d(" + (entry.targetX * t) + "px, 0, 0) scale(" + scale + ")"
          : "translate3d(0, " + (-MOBILE_RISE * t) + "px, 0) scale(" + scale + ")";
      });
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(apply);
      }
    }

    function onResize() {
      measure();
      apply();
    }

    measure();
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    activePathwayScrollCleanup = function () {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      entries.forEach(function (entry) {
        entry.img.style.transform = "";
        entry.img.style.transition = "";
      });
    };
  }

  function initAssetCardButtons() {
    document.querySelectorAll(".asset-card__btn--disabled").forEach(function (btn) {
      var resetTimer = null;
      btn.addEventListener("click", function () {
        var defaultLabel = btn.getAttribute("data-default-label") || btn.textContent;
        window.clearTimeout(resetTimer);
        btn.textContent = "Coming Soon";
        resetTimer = window.setTimeout(function () {
          btn.textContent = defaultLabel;
        }, 1800);
      });
    });
  }

  function initContactForm() {
    var form = document.getElementById("inquiry-form");
    var note = document.getElementById("form-note");
    if (!form || !note) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) {
        note.textContent = "Please fill out every field before sending.";
        note.classList.add("is-error");
        note.classList.remove("is-success");
        return;
      }
      note.classList.remove("is-error");
      note.classList.add("is-success");
      note.textContent = "Thanks — this form isn't connected to an inbox yet, so nothing was sent. Email hello@herbiggroup.com directly for now.";
    });
  }

  function initContent() {
    refreshDarkSections();
    initHeroZoom();
    initScrollReveal();
    initCinematicTrack();
    initEquationReveal();
    initPathwayBreakout();
    initAssetCardButtons();
    initContactForm();
  }

  initContent();

  window.Herbig = window.Herbig || {};
  window.Herbig.initContent = initContent;
  window.Herbig.refreshNavbarTheme = refreshDarkSections;
  window.Herbig.lockNavbarTheme = function () {
    navbarThemeLocked = true;
    if (navbar) navbar.classList.add("is-scrolled");
  };
  window.Herbig.unlockNavbarTheme = function () {
    navbarThemeLocked = false;
    updateNavbar();
  };
})();
