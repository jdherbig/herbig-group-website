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
  // it should reflect scroll behaviour, not what section is behind the
  // navbar, so it never "grows back" purely because a dark section
  // appears further down the page. Direction-aware, not just
  // position-aware: scrolling DOWN past the threshold compacts it, but
  // ANY upward scroll expands it back to full size immediately, even
  // deep in the page - the user shouldn't have to scroll all the way
  // back to the top to get the full header back. See .navbar.is-compact
  // in styles.css.
  var COMPACT_THRESHOLD = 24;
  var THEME_ANTICIPATE = 32; // px of lead on the navbar dark/light theme switch — see updateNavbar()
  var DIRECTION_DEADZONE = 2; // px of scroll noise to ignore before treating it as a real up/down move
  var lastScrollY = Math.max(0, window.scrollY || 0);

  /* ---------- Scroll velocity awareness ----------
   * A fast trackpad/wheel scroll shouldn't leave a trail of staggered
   * content slowly fading in behind the user - the transition-delay-based
   * reveal systems below (.reveal-stagger, .metric-card, .eq-card's own
   * divider) all read this one shared "html.is-fast-scroll" class and
   * zero their own delays while it's present (see styles.css), so
   * everything still appears, just without the choreographed stagger
   * that only reads well at a normal pace. Piggybacks on updateNavbar's
   * existing rAF-throttled scroll tick rather than adding a second
   * listener - lightweight by construction, not by extra effort to keep
   * it so. Distances/opacity/etc never change with speed, only timing. */
  var FAST_SCROLL_PX_MS = 1.4;
  var fastScrollTimer = null;
  var lastVelocityY = lastScrollY;
  var lastVelocityTime = (window.performance && performance.now) ? performance.now() : Date.now();

  function markScrollVelocity(delta, currentY) {
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    var dt = now - lastVelocityTime;
    lastVelocityTime = now;
    if (dt <= 0) return;

    var speed = Math.abs(currentY - lastVelocityY) / dt;
    lastVelocityY = currentY;

    if (speed > FAST_SCROLL_PX_MS) {
      document.documentElement.classList.add("is-fast-scroll");
      window.clearTimeout(fastScrollTimer);
      fastScrollTimer = window.setTimeout(function () {
        document.documentElement.classList.remove("is-fast-scroll");
      }, 160);
    }
  }

  var updateNavbar = function () {
    if (!navbar) return;
    tickingNavbar = false;

    var currentY = Math.max(0, window.scrollY);
    var delta = currentY - lastScrollY;
    if (currentY <= COMPACT_THRESHOLD || delta < -DIRECTION_DEADZONE) {
      navbar.classList.remove("is-compact");
    } else if (delta > DIRECTION_DEADZONE) {
      navbar.classList.add("is-compact");
    }

    markScrollVelocity(delta, currentY);
    lastScrollY = currentY;

    // While locked (a PJAX navigation is in flight), leave whatever theme
    // is currently showing exactly as-is - don't guess. applySwap() in
    // transitions.js sets the correct theme declaratively the moment the
    // new content lands; there's nothing useful to compute here until then.
    if (navbarThemeLocked) {
      return;
    }
    // offsetTop/offsetHeight are layout-based and ignore CSS transforms, so this
    // stays correct even while #route-content is mid-rise (translateY animating
    // in) right after the branded transition swaps in a new page — a plain
    // getBoundingClientRect() read here would pick up that in-flight offset and
    // misjudge what's behind the navbar until the animation settles.
    //
    // THEME_ANTICIPATE nudges the test point a little further down the page
    // than the navbar's own bottom edge, so the surface starts switching
    // slightly before a dark/light boundary actually reaches the navbar
    // rather than exactly as it does - the same geometry-based detection,
    // just sampled a beat early so the transition (see .navbar's sequenced
    // surface change above) never looks like it's catching up to what's
    // already visibly wrong underneath it.
    var testY = window.scrollY + navbar.offsetHeight + THEME_ANTICIPATE;
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
    if (!hero) return;

    requestAnimationFrame(function () { hero.classList.add("is-loaded"); });

    // The headline-card's frosted-glass look (see .headline-card in
    // styles.css) needs the hero photo to have actually decoded and
    // painted before backdrop-filter has anything real to blur -
    // otherwise it briefly shows a flat, cheap-looking panel and then
    // visibly "pops" once the photo catches up. This is the one place
    // on the site that's deliberately gated on image load rather than
    // just revealed unconditionally (see initHeroEntrance below for the
    // opposite, and more usual, choice) - the fallback state (a solid
    // tinted panel, no blur) already looks intentional on its own, so
    // there's nothing to wait on visually, just an upgrade once ready.
    var img = hero.querySelector(".hero__media img");
    if (img) {
      if (img.complete && img.naturalWidth > 0) {
        hero.classList.add("is-photo-ready");
      } else {
        var markPhotoReady = function () { hero.classList.add("is-photo-ready"); };
        img.addEventListener("load", markPhotoReady, { once: true });
        img.addEventListener("error", markPhotoReady, { once: true });
      }
    }
  }

  // Premium internal-page hero entrance (.page-header / .case-hero). Adds
  // .is-loaded on the next frame, same as initHeroZoom above - deliberately
  // NOT tied to the hero image's load event or any network timing, so it
  // can never be the thing that makes the page feel like it's waiting on
  // something. The navbar's own theme is set independently and earlier
  // (see setInitialNavbarTheme in this file / applySwap in transitions.js)
  // and never depends on this either.
  function initHeroEntrance() {
    var el = document.querySelector(".page-header, .case-hero");
    if (el) {
      requestAnimationFrame(function () { el.classList.add("is-loaded"); });
    }
  }

  /* Trigger point for each of the three entrance families, expressed as
   * "top of element reaches this % of the viewport height", then
   * converted to the negative-bottom rootMargin percentage that produces
   * it: shrinking the effective (root-less) viewport's bottom edge inward
   * by (100 - target)% moves the trigger line up to target% down the
   * viewport, so IntersectionObserver only fires once the element's top
   * has actually scrolled that far into view - not the instant it peeks
   * in at the very bottom edge. Tiered so large grid compositions can
   * begin a touch later than editorial text/small structured content,
   * per the site's timing hierarchy (small text/metrics ~68-72vh,
   * standard surfaces ~74-78vh, large grids ~78-80vh). */
  var REVEAL_TIERS = [
    { selector: ".reveal-stagger", targetVh: 70 },           // metrics / small structured content: ~68-72vh
    { selector: ".reveal, .reveal-surface", targetVh: 76 },  // editorial text + surface panels: ~74-78vh
    { selector: ".reveal-grid", targetVh: 79 }                // large grid/image compositions: ~78-80vh
  ];

  function initScrollReveal() {
    var anyEls = document.querySelectorAll(".reveal, .reveal-stagger, .reveal-surface, .reveal-grid");
    if (!anyEls.length) return;

    if (!("IntersectionObserver" in window)) {
      anyEls.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }

    REVEAL_TIERS.forEach(function (tier) {
      var els = document.querySelectorAll(tier.selector);
      if (!els.length) return;

      var marginPct = -(100 - tier.targetVh);
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.05, rootMargin: "0px 0px " + marginPct + "% 0px" }
      );
      els.forEach(function (el) { observer.observe(el); });
    });
  }

  /* ---------- Photo grid: composition-aware assembly ----------
   * A .photo-grid row (see .gallery-row in the case-study gallery) is
   * observed as ONE element, not photo-by-photo - the moment it crosses
   * the trigger line, .is-visible goes on the row itself (and, if one
   * immediately precedes it, its .gallery-rule divider), and CSS takes it
   * from there: each image's own reveal direction, distance and delay are
   * plain child-selector rules keyed to its place in the composition (see
   * styles.css), not per-element JS. That keeps the whole row resolving
   * as one short, grouped event instead of a long nth-child cascade. */
  function initPhotoGrid() {
    var grids = Array.prototype.slice.call(document.querySelectorAll(".photo-grid"));
    if (!grids.length) return;

    function reveal(grid) {
      grid.classList.add("is-visible");
      var rule = grid.previousElementSibling;
      if (rule && rule.classList.contains("gallery-rule")) rule.classList.add("is-visible");
    }

    if (!("IntersectionObserver" in window) || prefersReducedMotion) {
      grids.forEach(reveal);
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            reveal(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      // Large photo grids/image compositions: trigger around 78-80vh (top
      // reaching ~79-80% down the viewport) - same "large grid" tier as
      // .reveal-grid above (see REVEAL_TIERS), just expressed locally
      // since photo grids keep their own bespoke observer/logic.
      { threshold: 0.05, rootMargin: "0px 0px -21% 0px" }
    );
    grids.forEach(function (g) { observer.observe(g); });
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

    var REACH = 0.34;        // how far toward Purpose's centre each side card starts, 0-1 (kept as
                              // the signature interaction, but with roughly half its old reach)
    var RISE = 14;            // secondary "rising into place" offset shared by both side cards, px
    var PURPOSE_SETTLE = 14; // Purpose's own much smaller settle distance, px
    var PURPOSE_END = 0.3;   // Purpose finishes settling by this fraction of overall progress
    var SIDE_START = 0.4;    // side cards begin spreading at this fraction (the gap before it
                              // is the "brief moment of stability" after Purpose settles)
    var TRIGGER_START_FRAC = 0.78; // grid top at 78% down the viewport -> progress 0
    var TRIGGER_END_FRAC = 0.56;   // grid top at 56% down the viewport -> progress 1

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
          o.el.style.opacity = String(0.65 + 0.35 * sideT);
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

  /* ---------- Photography depth (very subtle parallax) ----------
   * Scoped deliberately narrow: only the two full-bleed internal-page
   * hero images (.page-header__bg / .case-hero__media) - the largest,
   * most "architectural" photography on the site and the ones the user
   * actually scrolls past. NOT the homepage hero (too short a box for
   * this to read as anything but a wobble) and NOT every image - the
   * brief was "almost disappear when consciously observed", not a
   * effect applied everywhere. Moves the CONTAINER, never the <img>
   * itself, because the image already carries its own one-time
   * scale-settle transition (see .page-header__bg img/.case-hero__media
   * img) - two different transforms on two different elements, so
   * neither has to fight or override the other. Desktop-only and
   * disabled under reduced motion; ~14px of total travel each way is a
   * couple of percent of a typical hero's own height, same spirit as
   * the spec's 2-4% figure. */
  var activeDepthCleanup = null;

  function initPhotographyDepth() {
    if (activeDepthCleanup) {
      activeDepthCleanup();
      activeDepthCleanup = null;
    }

    if (prefersReducedMotion || !window.matchMedia("(min-width: 900px)").matches) return;

    var targets = Array.prototype.slice.call(document.querySelectorAll(".page-header__bg, .case-hero__media"));
    if (!targets.length) return;

    var RANGE = 14; // px, each direction
    var ticking = false;

    function apply() {
      ticking = false;

      if (!window.matchMedia("(min-width: 900px)").matches) {
        // Resized down past the breakpoint mid-session (a real navigation
        // re-runs initPhotographyDepth from scratch and would already
        // catch this, but a plain window resize doesn't) - drop back to
        // the untouched resting position rather than keep computing an
        // effect the current viewport shouldn't have.
        targets.forEach(function (el) { el.style.transform = ""; });
        return;
      }

      var vh = window.innerHeight || document.documentElement.clientHeight;
      targets.forEach(function (el) {
        var rect = el.getBoundingClientRect();
        var center = rect.top + rect.height / 2;
        var span = vh / 2 + rect.height / 2;
        var progress = span > 0 ? (center - vh / 2) / span : 0;
        progress = Math.max(-1, Math.min(1, progress));
        el.style.transform = "translate3d(0, " + (progress * RANGE) + "px, 0)";
      });
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(apply);
      }
    }

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    activeDepthCleanup = function () {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      targets.forEach(function (el) { el.style.transform = ""; });
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
    initHeroEntrance();
    initScrollReveal();
    initPhotoGrid();
    initCinematicTrack();
    initEquationReveal();
    initPhotographyDepth();
    initAssetCardButtons();
    initContactForm();
  }

  initContent();

  window.Herbig = window.Herbig || {};
  window.Herbig.initContent = initContent;
  window.Herbig.refreshNavbarTheme = refreshDarkSections;
  window.Herbig.lockNavbarTheme = function () {
    navbarThemeLocked = true;
  };
  window.Herbig.unlockNavbarTheme = function () {
    navbarThemeLocked = false;
    updateNavbar();
  };
  // Called by transitions.js with the incoming page's theme, read
  // declaratively from its own markup, in the same synchronous tick as
  // the content swap - this is the one place that's allowed to set the
  // theme while locked, since it's not a guess.
  window.Herbig.setInitialNavbarTheme = function (isDark) {
    if (navbar) navbar.classList.toggle("is-scrolled", !isDark);
  };
})();
