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
   * rules) is the only open/close control — no separate close button, so
   * it doubles as "Close" for focus-trapping purposes below.
   *
   * HG-P3-03: this used to only toggle visual state - nothing stopped Tab
   * from walking straight through the (still perfectly focusable)
   * underlying page while the overlay sat on top of it, and Escape closed
   * the panel but left focus stranded on a link that had just gone
   * invisible. Below 900px, route content sits fully behind the overlay
   * while it's open, so it's made inert for the duration (removes it from
   * both the tab order and the accessibility tree in one step) and focus
   * is explicitly trapped to [toggle, ...everything focusable inside the
   * menu], with Escape/close always returning focus to the toggle. */
  var toggle = document.getElementById("menu-toggle");
  var mobileMenu = document.getElementById("mobile-menu");
  var navbar = document.getElementById("navbar");
  var menuInertTarget = document.getElementById("route-content");

  if (toggle && mobileMenu) {
    var MENU_FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    // toggle first: Tab from the last real menu control wraps to it, and
    // Shift+Tab from the first real control wraps back to it too, so the
    // close affordance is always one Tab away in either direction.
    var getMenuFocusables = function () {
      return [toggle].concat(Array.prototype.slice.call(mobileMenu.querySelectorAll(MENU_FOCUSABLE_SELECTOR)));
    };

    var openMobileMenu = function () {
      mobileMenu.classList.add("is-open");
      mobileMenu.setAttribute("aria-hidden", "false");
      toggle.setAttribute("aria-expanded", "true");
      if (navbar) navbar.classList.add("menu-open");
      document.documentElement.classList.add("no-scroll");
      if (menuInertTarget) menuInertTarget.setAttribute("inert", "");

      var focusables = getMenuFocusables();
      if (focusables[1]) focusables[1].focus();
    };

    var closeMobileMenu = function (returnFocus) {
      mobileMenu.classList.remove("is-open");
      mobileMenu.setAttribute("aria-hidden", "true");
      toggle.setAttribute("aria-expanded", "false");
      if (navbar) navbar.classList.remove("menu-open");
      document.documentElement.classList.remove("no-scroll");
      if (menuInertTarget) menuInertTarget.removeAttribute("inert");
      if (returnFocus !== false) toggle.focus();
    };

    toggle.addEventListener("click", function () {
      if (mobileMenu.classList.contains("is-open")) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    });

    mobileMenu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        // Selection: close and unlock, but don't steal focus back to the
        // toggle - the destination content takes it instead (see the
        // post-navigation focus handling in transitions.js).
        closeMobileMenu(false);
      });
    });

    document.addEventListener("keydown", function (e) {
      if (!mobileMenu.classList.contains("is-open")) return;

      if (e.key === "Escape") {
        closeMobileMenu();
        return;
      }

      if (e.key !== "Tab") return;
      var focusables = getMenuFocusables();
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      var active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || focusables.indexOf(active) === -1) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || focusables.indexOf(active) === -1) {
        e.preventDefault();
        first.focus();
      }
    });

    // Never leave the overlay stuck open (e.g. a resize past the 1200px
    // breakpoint, where .mobile-menu is force-hidden by CSS but would
    // otherwise still hold the scroll lock and aria-expanded state).
    // Kept in sync with the .mobile-menu/.nav-links/.btn--nav/.menu-toggle
    // breakpoint in styles.css (HG-VR-05: row nav needs ~1180px to avoid
    // wrapping, so the mobile menu now covers 900-1199px too).
    window.addEventListener("resize", function () {
      if (window.matchMedia("(min-width: 1200px)").matches && mobileMenu.classList.contains("is-open")) {
        closeMobileMenu(false);
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
  // MOT-05: DIRECTION_DEADZONE alone used to gate is-compact directly off
  // the last single rAF tick's delta sign, so a 3px trackpad wobble or a
  // scroll's momentum settling could flip the state right back within a
  // couple of frames - a "small scroll correction" repeatedly resizing
  // the navbar. DIRECTION_HYSTERESIS instead requires that much
  // *sustained* movement in a direction (tracked from wherever the
  // current directional run started, see runStartY below) before
  // is-compact actually commits to that direction, while still reacting
  // immediately to a real, deliberate reversal - a scroll up of more
  // than this any time past the threshold still expands the navbar
  // right away, per the original "even deep in the page" intent.
  var DIRECTION_HYSTERESIS = 40;
  var lastScrollY = Math.max(0, window.scrollY || 0);
  var directionSign = 0; // -1 = running up, 1 = running down, 0 = none yet
  var runStartY = lastScrollY; // scroll Y where the current directional run began

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

    if (currentY <= COMPACT_THRESHOLD) {
      navbar.classList.remove("is-compact");
      directionSign = 0;
      runStartY = currentY;
    } else {
      // A per-tick delta past the deadzone starts (or continues) a
      // directional run; a delta within the deadzone (near-zero motion,
      // e.g. between discrete wheel ticks) doesn't reset it, so a run
      // isn't broken up by the gaps between frames that carried it.
      if (delta > DIRECTION_DEADZONE && directionSign !== 1) {
        directionSign = 1;
        runStartY = lastScrollY;
      } else if (delta < -DIRECTION_DEADZONE && directionSign !== -1) {
        directionSign = -1;
        runStartY = lastScrollY;
      }

      var runDistance = currentY - runStartY;
      if (directionSign === 1 && runDistance > DIRECTION_HYSTERESIS) {
        navbar.classList.add("is-compact");
      } else if (directionSign === -1 && -runDistance > DIRECTION_HYSTERESIS) {
        navbar.classList.remove("is-compact");
      }
      // else: this run hasn't gone far enough yet to commit a state
      // change - leave is-compact exactly as it already is.
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
    // HG-P4-10: "loaded" is not "decoded". The bytes can have arrived while
    // the pixels backdrop-filter needs still have not, which is precisely
    // the moment this upgrade must not run - it would blur nothing and then
    // pop, the exact artefact the gate exists to avoid. decode() resolves
    // when the frame is genuinely ready to paint. It stays a non-blocking
    // upgrade: a rejection (or a browser without decode()) just keeps the
    // deliberate unblurred panel, and nothing else on the page waits on it.
    var img = hero.querySelector(".hero__media img");
    if (img) {
      var markPhotoReady = function () { hero.classList.add("is-photo-ready"); };
      var markWhenDecoded = function () {
        if (typeof img.decode === "function") {
          img.decode().then(markPhotoReady, markPhotoReady);
        } else {
          markPhotoReady();
        }
      };
      if (img.complete && img.naturalWidth > 0) {
        markWhenDecoded();
      } else {
        img.addEventListener("load", markWhenDecoded, { once: true });
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

  /* Trigger point for each entrance family, expressed as "top of element
   * reaches this % of the viewport height", then converted to the
   * negative-bottom rootMargin percentage that produces it: shrinking
   * the effective (root-less) viewport's bottom edge inward by
   * (100 - target)% moves the trigger line up to target% down the
   * viewport, so IntersectionObserver only fires once the element's top
   * has actually scrolled that far into view - not the instant it peeks
   * in at the very bottom edge. A HIGHER targetVh fires SOONER (the
   * trigger line sits closer to the bottom edge, so less scrolling is
   * needed to cross it) - that's what "trigger earlier" means below.
   *
   * Two full tables, not one shared with a fudge factor: mobile users
   * scroll faster and shouldn't be left waiting on a reveal that hasn't
   * caught up, so every mobile tier fires a bit sooner (higher targetVh)
   * than its desktop equivalent, per the site's timing hierarchy -
   * small detail/metrics, then editorial text, then surface panels,
   * then large grid/photo compositions, each tier later than the last. */
  /* MOT-01: .reveal-stagger and .reveal now trigger at ~90vh (top of
   * element crossing 90% down the viewport) instead of 70-76vh, and
   * reveal immediately if already inside that region when the observer
   * is set up (see revealIfOnscreenAtLoad below) - both per the Phase 2
   * motion spec ("reveal when an element's top crosses approximately
   * 90% of the viewport... initialize elements already in that region
   * without requiring an additional scroll"). .reveal-surface and
   * .reveal-grid are unchanged; MOT-01 only names the small-detail tier
   * (Blueprint stage cards) and the .reveal-tier case-study gallery
   * heading, so the surface/grid tiers keep their existing, later
   * trigger points and deliberate hierarchy. */
  var REVEAL_TIERS_DESKTOP = [
    { selector: ".reveal-stagger, .eq-reveal-mobile", targetVh: 90, revealIfOnscreenAtLoad: true },
    { selector: ".reveal", targetVh: 90, revealIfOnscreenAtLoad: true },
    { selector: ".reveal-surface", targetVh: 76 },                    // surface panels/forms: ~74-77vh
    { selector: ".reveal-grid", targetVh: 79 }                        // large grid/image compositions: ~78-80vh
  ];
  var REVEAL_TIERS_MOBILE = [
    { selector: ".reveal-stagger, .eq-reveal-mobile", targetVh: 90, revealIfOnscreenAtLoad: true },
    { selector: ".reveal", targetVh: 90, revealIfOnscreenAtLoad: true },
    { selector: ".reveal-surface", targetVh: 80 },                    // surface panels/forms: ~78-82vh
    { selector: ".reveal-grid", targetVh: 83 }                        // large grid/image compositions: ~82-84vh
  ];

  function initScrollReveal() {
    var anyEls = document.querySelectorAll(".reveal, .reveal-stagger, .reveal-surface, .reveal-grid, .eq-reveal-mobile");
    if (!anyEls.length) return;

    // MOT-09: every other reveal-ish init function (initPhotoGrid below,
    // initPhotographyDepth, initAmbientMotion, initPinnedScroll's canPin)
    // already short-circuits under reduced motion - this one didn't. The
    // revealIfOnscreenAtLoad tiers above only resolve what's already
    // onscreen at setup time, so anything further down the page (the
    // entire .reveal-surface/.reveal-grid tiers, which never opt into
    // that early check, plus any .reveal/.reveal-stagger below the fold)
    // was left sitting at its pre-reveal opacity/transform until an
    // IntersectionObserver callback got around to it - exactly the
    // "waiting on another scroll/observer" the reduced-motion spec rules
    // out. No observer at all under reduced motion: everything just
    // starts in its final state.
    if (!("IntersectionObserver" in window) || prefersReducedMotion) {
      anyEls.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }

    var REVEAL_TIERS = window.matchMedia("(min-width: 900px)").matches ? REVEAL_TIERS_DESKTOP : REVEAL_TIERS_MOBILE;
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
      els.forEach(function (el) {
        // HG-VR-06: the small-detail tier's trigger line sits at ~70-74%
        // down the viewport, meant for content scrolling INTO view. On
        // shorter pages that content can instead land just below that
        // line at first paint (before the visitor has scrolled at all),
        // so it's already on screen but still reads as "not revealed"
        // until a few px of scroll happen to nudge it across the line.
        // Content already visible at load shouldn't wait on a scroll
        // gesture that may not come - so for this tier only, skip the
        // trigger line and reveal immediately if any part of the element
        // is already within the real (unshrunk) viewport at load.
        if (tier.revealIfOnscreenAtLoad) {
          var rect = el.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            el.classList.add("is-visible");
            return;
          }
        }
        observer.observe(el);
      });
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

    // Large photo grids/image compositions: same "large grid" tier as
    // .reveal-grid (see REVEAL_TIERS_DESKTOP/MOBILE above), just expressed
    // locally since photo grids keep their own bespoke observer/logic -
    // ~79vh desktop, ~83vh mobile (mobile scrolls faster, so it triggers
    // a bit sooner).
    var isDesktop = window.matchMedia("(min-width: 900px)").matches;
    var marginPct = isDesktop ? -21 : -17;
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            reveal(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.05, rootMargin: "0px 0px " + marginPct + "% 0px" }
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
   * The site's one true signature scroll interaction (kept deliberately
   * rare - see the "if every section is special, nothing is special"
   * rule). The Purpose card (.eq-card--dark) is the section's anchor: it
   * settles into place first, and stays visually dominant throughout.
   * People and Profit finish their own alignment around it - they should
   * already feel present, not like they're materializing from nothing,
   * which is why both the starting opacity and the travel distance are
   * intentionally modest (fixed values, not a dramatic pull-in). This is
   * continuously tied to scroll position (not a one-shot trigger):
   * scrolling back up un-reveals it too.
   *
   * Desktop only (>=900px) - the row layout is what this choreography is
   * choreographed for. Below that breakpoint .equation-grid stacks to a
   * single column and the cards instead get one plain, one-shot CSS
   * reveal (see .eq-reveal-mobile in styles.css): no horizontal scrub,
   * no continuous scroll-linking, just a quiet settle-and-stop, per the
   * "mobile is not a scaled-down desktop system" rule.
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
    if (!grid || prefersReducedMotion || !window.matchMedia("(min-width: 900px)").matches) return;

    var purpose = grid.querySelector(".eq-card--dark");
    var sideCards = Array.prototype.slice.call(grid.querySelectorAll(".eq-card:not(.eq-card--dark)"));
    if (!purpose || !sideCards.length) return;

    // Fixed values, not measured relative to Purpose's live position - the
    // cards are finishing alignment, not travelling any real distance.
    // DOM order is People, Purpose, Profit, so the first side card is
    // visually on the left and the second on the right.
    var SIDE_TRAVEL = 36;    // px, left card starts +36 (right of rest), right card starts -36
    var SIDE_OPACITY_START = 0.7;
    var PURPOSE_RISE = 14;   // Purpose's own settle distance, px
    var PURPOSE_SCALE_START = 0.99;
    var PURPOSE_OPACITY_START = 0.8;
    var PURPOSE_END = 0.3;   // Purpose finishes settling by this fraction of overall progress
    var SIDE_START = 0.4;    // side cards begin resolving at this fraction (the gap before it
                              // is the "brief moment of stability" after Purpose settles)
    var TRIGGER_START_FRAC = 0.78; // grid top at 78% down the viewport -> progress 0
    var TRIGGER_END_FRAC = 0.56;   // grid top at 56% down the viewport -> progress 1

    var ticking = false;

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

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
        purpose.style.opacity = "";
        purpose.style.transition = "";
      } else {
        purpose.style.transition = "none";
        purpose.style.transform = "translate3d(0, " + (PURPOSE_RISE * (1 - purposeT)) + "px, 0) scale(" + (PURPOSE_SCALE_START + (1 - PURPOSE_SCALE_START) * purposeT) + ")";
        purpose.style.opacity = String(PURPOSE_OPACITY_START + (1 - PURPOSE_OPACITY_START) * purposeT);
      }

      sideCards.forEach(function (el, i) {
        if (progress >= 1) {
          el.style.transform = "";
          el.style.opacity = "";
          el.style.transition = "";
        } else {
          var startX = i === 0 ? SIDE_TRAVEL : -SIDE_TRAVEL;
          el.style.transition = "none";
          el.style.transform = "translate3d(" + (startX * (1 - sideT)) + "px, 0, 0)";
          el.style.opacity = String(SIDE_OPACITY_START + (1 - SIDE_OPACITY_START) * sideT);
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
      apply();
    }

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    activeEquationScrollCleanup = function () {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      purpose.style.transform = "";
      purpose.style.opacity = "";
      purpose.style.transition = "";
      sideCards.forEach(function (el) {
        el.style.transform = "";
        el.style.opacity = "";
        el.style.transition = "";
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

  /* ---------- Ambient decoration: pause offscreen / tab hidden ----------
   * MOT-06: .blob/.specular (styles.css) are frozen outright below
   * 900px by CSS - no JS needed for that. On desktop they keep their
   * drift/shimmer loop, but it's wasted work while a blob is scrolled
   * out of view or the tab is backgrounded, so this pauses each one's
   * own animation-play-state via IntersectionObserver (offscreen) and
   * visibilitychange (tab hidden), resuming only the ones actually
   * visible again. Same reduced-motion/desktop-only guard and the same
   * "tear down before re-running" cleanup pattern as
   * initPhotographyDepth() above, since this also runs again after
   * every PJAX swap against a fresh set of elements. */
  var activeAmbientCleanup = null;

  function initAmbientMotion() {
    if (activeAmbientCleanup) {
      activeAmbientCleanup();
      activeAmbientCleanup = null;
    }

    if (prefersReducedMotion || !window.matchMedia("(min-width: 900px)").matches) return;

    var targets = Array.prototype.slice.call(document.querySelectorAll(".blob, .specular"));
    if (!targets.length || !("IntersectionObserver" in window)) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        entry.target.style.animationPlayState = (entry.isIntersecting && !document.hidden) ? "running" : "paused";
      });
    }, { threshold: 0 });
    targets.forEach(function (el) { observer.observe(el); });

    function onVisibilityChange() {
      if (document.hidden) {
        targets.forEach(function (el) { el.style.animationPlayState = "paused"; });
        return;
      }
      // Coming back from a hidden tab: re-check each element's own
      // position rather than assuming they're all in view again. A raw
      // getBoundingClientRect() comparison against the viewport isn't
      // enough here - several blobs are deliberately offset outside
      // their own section via negative left/top percentages and get
      // clipped by that section's overflow:hidden, so their unclipped
      // rect can overlap the viewport even while nothing is actually
      // rendered on screen. Re-observing forces the IntersectionObserver
      // to recompute real (clipped) intersection and drive playState via
      // its callback instead of duplicating that logic by hand.
      targets.forEach(function (el) {
        observer.unobserve(el);
        observer.observe(el);
      });
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    activeAmbientCleanup = function () {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      targets.forEach(function (el) { el.style.animationPlayState = ""; });
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

  /* Inquiry forms (contact and joint venture).
   *
   * One implementation for both: identical validation, identical delivery,
   * identical states. Field-specific errors carry aria-invalid and an
   * associated description, and a failed submit focuses the first invalid
   * field rather than leaving focus on the button with only a general
   * message (HG-P3-08). Delivery goes to Netlify Forms, so the success
   * message below is only ever shown after a submission the server
   * confirmed - it is never a reassurance the page invented. Values are
   * preserved on failure; the form is reset only on confirmed success.
   */
  var INQUIRY_MESSAGES = {
    pending: "Sending your inquiry\u2026",
    success: "Thank you. Your inquiry has been received.",
    failure: "Your inquiry could not be sent. Please try again."
  };

  function initInquiryForm(options) {
    var form = document.getElementById(options.formId);
    var note = document.getElementById(options.noteId);
    if (!form || !note) return;

    var submitBtn = form.querySelector("button[type='submit']");
    var isSubmitting = false;

    function requiredFields() {
      return Array.prototype.slice.call(form.querySelectorAll("[required]"));
    }

    function errorElFor(field) {
      return document.getElementById(field.id + "-error");
    }

    function clearFieldError(field) {
      field.classList.remove("is-invalid");
      field.removeAttribute("aria-invalid");
      var errorEl = errorElFor(field);
      if (errorEl) errorEl.textContent = "";
    }

    function setFieldError(field, message) {
      field.classList.add("is-invalid");
      field.setAttribute("aria-invalid", "true");
      var errorEl = errorElFor(field);
      if (errorEl) errorEl.textContent = message;
    }

    function validate() {
      var firstInvalid = null;
      requiredFields().forEach(function (field) {
        clearFieldError(field);
        var value = field.value.trim();
        if (!value) {
          setFieldError(field, "This field is required.");
          firstInvalid = firstInvalid || field;
          return;
        }
        if (field.type === "email" && !field.checkValidity()) {
          setFieldError(field, "Enter a valid email address.");
          firstInvalid = firstInvalid || field;
        }
      });
      return firstInvalid;
    }

    requiredFields().forEach(function (field) {
      field.addEventListener("input", function () {
        if (field.classList.contains("is-invalid")) clearFieldError(field);
      });
    });

    function setNote(text, state) {
      note.classList.remove("is-error", "is-success", "is-pending");
      if (state) note.classList.add(state);
      note.textContent = text;
    }

    function setPending(pending) {
      isSubmitting = pending;
      if (submitBtn) submitBtn.disabled = pending;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (isSubmitting) return;

      var firstInvalid = validate();
      if (firstInvalid) {
        var invalidCount = form.querySelectorAll(".is-invalid").length;
        setNote("Please correct the highlighted field" + (invalidCount > 1 ? "s" : "") + " before sending.", "is-error");
        firstInvalid.focus();
        return;
      }

      // Honeypot: a real person never sees this field. If it has a value,
      // report success and send nothing at all.
      var honeypot = form.querySelector("[name='" + options.honeypot + "']");
      if (honeypot && honeypot.value) {
        setNote(INQUIRY_MESSAGES.success, "is-success");
        form.reset();
        return;
      }

      setPending(true);
      setNote(INQUIRY_MESSAGES.pending, "is-pending");

      var params = [];
      new FormData(form).forEach(function (value, key) {
        params.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
      });

      fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.join("&"),
      })
        .then(function (response) {
          setPending(false);
          if (response.ok) {
            setNote(INQUIRY_MESSAGES.success, "is-success");
            form.reset();
          } else {
            setNote(INQUIRY_MESSAGES.failure, "is-error");
          }
        })
        .catch(function () {
          setPending(false);
          setNote(INQUIRY_MESSAGES.failure, "is-error");
        });
    });
  }

  function initContactForm() {
    initInquiryForm({ formId: "inquiry-form", noteId: "form-note", honeypot: "contact-bot-field" });
  }

  function initJVForm() {
    initInquiryForm({ formId: "jv-form", noteId: "jv-form-note", honeypot: "jv-bot-field" });
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
    initAmbientMotion();
    initAssetCardButtons();
    initContactForm();
    initJVForm();
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

  /* ---------- MOT-09: react live to a reduced-motion preference change ----------
   * prefersReducedMotion above is a plain snapshot taken once at script
   * load - every function that reads it (initScrollReveal, initPhotoGrid,
   * initPhotographyDepth, initAmbientMotion, initPinnedScroll, the drag-
   * scroll glide, ...) was correct for whatever the preference was at
   * page load, but none of them would ever hear about a change made while
   * the page stayed open - motion already in progress (an ambient blob
   * loop, a parallax offset, a pinned scroll effect) had nothing telling
   * it to stop, and reveal-gated content still pending an observer would
   * never have gotten the "just show it" branch above. Re-running
   * initContent() after flipping the flag re-applies every one of those
   * guards against the new value in one pass - each already tears down
   * its own previous listeners/observers first (activeDepthCleanup,
   * activeAmbientCleanup, activePinnedScrollCleanup,
   * activeEquationScrollCleanup), so switching TO reduced motion cleanly
   * cancels anything running and reveals whatever was still pending, and
   * switching away restores the normal effects rather than leaving the
   * page permanently frozen from one earlier preference change. */
  var reducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  var onReducedMotionChange = function (e) {
    prefersReducedMotion = e.matches;
    initContent();
  };
  if (typeof reducedMotionMedia.addEventListener === "function") {
    reducedMotionMedia.addEventListener("change", onReducedMotionChange);
  } else if (typeof reducedMotionMedia.addListener === "function") {
    // Older Safari/WebKit.
    reducedMotionMedia.addListener(onReducedMotionChange);
  }
})();
