/*
 * Herbig Group — page-transition system.
 *
 * Architecture: the global header (#navbar) never moves and is never
 * touched by this file. Route content lives in #route-content; this file
 * swaps its innerHTML on internal navigation (fetch + DOMParser, a small
 * PJAX-style router) and animates it in.
 *
 * Two distinct moments share this system:
 *  - First-load intro (once per browser session, on an actual page
 *    load/refresh): the full white curtain + animated Lottie logo
 *    mark, covering the whole viewport including the navbar.
 *  - Every internal link click, the logo included: an instant content
 *    swap, no overlay and no animation at all — see navigate().
 *    #route-content's innerHTML is replaced directly; the only visible
 *    motion on a "page-to-page" nav is whatever the new page's own
 *    content does on load (e.g. its scroll-reveal).
 *
 * Depends on:
 *  - lottie-web (window.lottie), loaded before this file — used only for
 *    the first-load intro, not for any internal navigation.
 *  - window.Herbig.initContent(), defined in script.js, which (re)binds
 *    every content-scoped behaviour (scroll reveal, hero zoom, the
 *    cinematic track, disabled asset-card buttons, the contact form,
 *    and the navbar's dark/light section detection) to whatever is
 *    currently inside #route-content.
 */
(function () {
  "use strict";

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var overlay = document.getElementById("page-transition-overlay");
  var logoEl = document.getElementById("page-transition-logo");
  var routeContent = document.getElementById("route-content");

  if (!routeContent) return;

  // Manual scroll restoration, set as early as possible: the browser's own
  // automatic restore (the default) can race the PJAX router's own instant
  // scroll handling on a Back/Forward popstate, producing a double-jump. See
  // the scrollPositions block below for how reload/Back/Forward get their
  // position back under manual mode.
  if (window.history && "scrollRestoration" in window.history) {
    history.scrollRestoration = "manual";
  }

  var LOTTIE_SRC = "assets/lottie/logo-animation.json";
  var SEG_FULL = [0, 90];        // full "HERBIG GROUP" wordmark cascade — intro + logo-click replay
  var LOGO_SAFETY_MS = 1300;     // don't wait on lottie forever if it stalls or fails to load

  // Internal navigation: a brief, deliberately restrained exit conceal
  // (see .is-leaving in styles.css) plays while the fetch is in flight,
  // just long enough to hide the DOM swap - never long enough to feel
  // like a wait. Reduced motion skips it (0ms) entirely.
  var EXIT_MS = prefersReducedMotion ? 0 : 180;

  // Remembers each page's own scroll position, keyed by URL, so Back/
  // Forward can restore it instead of every navigation - forward or
  // backward - dropping the user at the top. Kept continuously up to
  // date by a passive scroll listener (rather than only captured at the
  // moment of leaving) because by the time a popstate fires, the
  // browser has already updated window.location to the destination -
  // there is no reliable "still on the old page" moment left to hook for
  // a Back/Forward-triggered leave, only for an ordinary link click.
  //
  // MOT-07: also mirrored into sessionStorage, not just kept in memory.
  // Back/Forward within a PJAX session never loses the in-memory map, but
  // a real reload tears this whole script down and reruns it from
  // scratch - an in-memory-only map has nothing left to restore from at
  // that point. sessionStorage survives the reload (session-lifetime,
  // same as before - a fresh browser session still has nothing to
  // restore), which is what lets the reload-restoration block further
  // below recover the position.
  var SCROLL_STORE_KEY = "hgScrollPositions";
  var scrollPositions = {};
  try {
    var storedScrollPositions = sessionStorage.getItem(SCROLL_STORE_KEY);
    if (storedScrollPositions) scrollPositions = JSON.parse(storedScrollPositions) || {};
  } catch (e) {}

  var scrollSaveTicking = false;
  function saveScrollPosition() {
    scrollSaveTicking = false;
    scrollPositions[window.location.href] = window.scrollY;
    try { sessionStorage.setItem(SCROLL_STORE_KEY, JSON.stringify(scrollPositions)); } catch (e) {}
  }
  window.addEventListener("scroll", function () {
    if (scrollSaveTicking) return;
    scrollSaveTicking = true;
    window.requestAnimationFrame(saveScrollPosition);
  }, { passive: true });

  var ACTIVE_NAV_MAP = {
    "our-blueprint.html": "our-blueprint.html",
    "active-holdings.html": "active-holdings.html",
    "joint-ventures.html": "joint-ventures.html",
    "housing-projects.html": "housing-projects.html",
    "fortitude-arizona-case-study.html": "active-holdings.html"
  };

  /* ---------- Lottie (single shared instance, lazily created) ---------- */
  var lottieInstance = null;
  var lottieReady = null;

  function ensureLottie() {
    if (prefersReducedMotion) return Promise.resolve(null);
    if (lottieReady) return lottieReady;
    lottieReady = new Promise(function (resolve) {
      if (typeof lottie === "undefined" || !overlay || !logoEl) {
        resolve(null);
        return;
      }
      try {
        lottieInstance = lottie.loadAnimation({
          container: logoEl,
          renderer: "svg",
          loop: false,
          autoplay: false,
          path: LOTTIE_SRC,
          rendererSettings: { preserveAspectRatio: "xMidYMid meet" }
        });
        lottieInstance.addEventListener("DOMLoaded", function () { resolve(lottieInstance); });
        lottieInstance.addEventListener("data_failed", function () { resolve(null); });
      } catch (e) {
        resolve(null);
      }
    });
    return lottieReady;
  }

  function playLogo(segment, speed) {
    return ensureLottie().then(function (inst) {
      if (!inst) return null;
      inst.setSpeed(speed || 1);
      inst.playSegments(segment, true);
      return inst;
    });
  }

  // Plays a logo segment and resolves once it completes OR safetyMs
  // elapses, whichever comes first — shared by the first-load intro and
  // the logo-click replay so neither can hang forever if lottie fails.
  function playLogoAndWait(segment, speed, safetyMs) {
    return playLogo(segment, speed).then(function (inst) {
      return new Promise(function (resolve) {
        var finished = false;
        var finish = function () {
          if (finished) return;
          finished = true;
          resolve(inst);
        };
        if (inst) {
          inst.addEventListener("complete", finish);
          window.setTimeout(finish, safetyMs);
        } else {
          finish();
        }
      });
    });
  }

  /* ---------- Small helpers ---------- */

  // Resets scroll position without ever animating - regardless of any
  // scroll-behavior:smooth an in-page anchor link elsewhere on the site
  // might set for itself. This runs while #route-content is still
  // concealed (see navigate()/applySwap()), so the reset itself is never
  // seen; the only visible motion afterward is the new page's own hero
  // entrance settling in from its already-correct position.
  function resetScrollInstant(y) {
    var root = document.documentElement;
    var prevBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo(0, y || 0);
    window.requestAnimationFrame(function () {
      root.style.scrollBehavior = prevBehavior;
    });
  }

  /* ---------- MOT-07: restore reading position on reload ----------
   * A real reload doesn't go through navigate()/applySwap() at all - the
   * browser re-requests and re-parses the whole document from scratch, and
   * this entire script reruns as part of that. With scrollRestoration set
   * to "manual" above, nothing was putting the scroll position back
   * afterward, so a reload always landed at y=0 and replayed the
   * top-of-page entrance in front of the reader instead of picking up
   * where they left off. A fresh/typed-URL load and an ordinary PJAX
   * navigation both still intentionally start at the top - this only
   * fires for an actual reload of a URL this session already has a saved
   * position for.
   *
   * This runs synchronously, at the end of a normal (non-deferred)
   * <script> tag placed after all of the page's own markup, so the DOM is
   * already fully parsed and laid out at this point - every image on the
   * site reserves its box with an explicit width/height or aspect-ratio
   * (no layout-shifting image loads), so the scrollTo below already lands
   * on the right spot immediately, before the browser's first paint of
   * this document (same reasoning as the hg-intro-pending overlay avoiding
   * a flash of the wrong state). The one thing that can still nudge
   * layout after that is a late web-font swap - the window "load" pass
   * below corrects for that without fighting a reader who has already
   * started scrolling on their own by then. */
  try {
    var navEntries = window.performance && performance.getEntriesByType
      ? performance.getEntriesByType("navigation")
      : [];
    var navType = navEntries && navEntries[0] ? navEntries[0].type : null;

    if (navType === "reload") {
      var restoreY = scrollPositions[window.location.href];
      if (restoreY && restoreY > 16) {
        resetScrollInstant(restoreY);
        window.addEventListener("load", function () {
          // Only correct if nothing has meaningfully moved the scroll
          // position since our own restore above - never override a
          // reader who started scrolling before images/fonts settled.
          if (Math.abs(window.scrollY - restoreY) < 4) {
            window.scrollTo(0, restoreY);
          }
        }, { once: true });
      }
    }
  } catch (e) {}

  // HG-P3-03/HG-P3-06: a same-document section target (#team/#core/
  // #contact) isn't natively focusable, so scrollIntoView alone moves the
  // viewport but leaves keyboard/screen-reader focus stranded wherever it
  // was before the click (often the menu link that's about to close, or -
  // after a cross-page hash arrival - nowhere meaningful at all). Giving
  // it a temporary tabindex="-1" and focusing it lands the reader right
  // at the section they asked for, and is removed again on blur so it
  // doesn't linger in the tab order for anyone tabbing through afterward.
  function focusSectionTarget(target) {
    if (!target) return;
    var hadTabindex = target.hasAttribute("tabindex");
    if (!hadTabindex) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    if (!hadTabindex) {
      target.addEventListener("blur", function onBlur() {
        target.removeEventListener("blur", onBlur);
        target.removeAttribute("tabindex");
      });
    }
  }

  function pathFilename(href) {
    try {
      var u = new URL(href, window.location.href);
      return u.pathname.split("/").pop() || "index.html";
    } catch (e) {
      return "";
    }
  }

  // HG-P3-01: is-active already got toggled on every navigation, but never
  // carried the actual semantic (aria-current="page") screen readers and
  // other assistive tech rely on to know which nav item represents the
  // page the user is currently on - the visual accent existed with no
  // matching announcement. Kept in lockstep with is-active right here
  // rather than as a second pass over the links.
  function updateActiveNav(filename) {
    var target = ACTIVE_NAV_MAP[filename] || null;
    document.querySelectorAll("#nav-links .nav-link, #mobile-menu-list .mobile-menu__link").forEach(function (link) {
      var isActive = !!target && pathFilename(link.getAttribute("href")) === target;
      link.classList.toggle("is-active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  /* ---------- Initial branded reveal (once per browser session) ---------- */
  // Played at 1.8x: the full wordmark cascade is ~1.5s at native speed,
  // which reads as a long static pause on the logo (see the Loader
  // section of the motion spec) - at 1.8x it lands at ~830ms, inside the
  // ~600-900ms target for the whole perceived loader moment.
  var LOGO_SPEED = 1.8;

  function runIntro() {
    var html = document.documentElement;

    if (prefersReducedMotion) {
      html.classList.remove("hg-intro-pending");
      try { sessionStorage.setItem("hgIntroSeen", "1"); } catch (e) {}
      return;
    }

    if (overlay) overlay.classList.add("is-visible");

    playLogoAndWait(SEG_FULL, LOGO_SPEED, LOGO_SAFETY_MS).then(function () {
      // Both happen in the same tick, no gap between them: the overlay
      // starts clearing the instant the content underneath is ready to
      // be seen, so this reads as one continuous arrival (brand mark →
      // surface clears → hero already there) rather than a loader
      // finishing and then a second, separate reveal beginning.
      html.classList.remove("hg-intro-pending");
      if (overlay) overlay.classList.remove("is-visible");
      try { sessionStorage.setItem("hgIntroSeen", "1"); } catch (e) {}
    });
  }

  var introPending = false;
  try {
    introPending = !sessionStorage.getItem("hgIntroSeen") &&
      document.documentElement.classList.contains("hg-intro-pending");
  } catch (e) {}

  if (introPending) {
    runIntro();
  } else {
    document.documentElement.classList.remove("hg-intro-pending");
  }

  /* ---------- Internal navigation (PJAX-style router) ---------- */
  function isEligibleLink(a) {
    if (!a || !a.href) return false;
    if (a.target && a.target !== "_self") return false;
    if (a.hasAttribute("download")) return false;
    if (a.protocol !== "http:" && a.protocol !== "https:") return false;
    if (a.host !== window.location.host) return false;
    return true;
  }

  // HG-P3-01: compares resolved filenames rather than raw pathnames, so a
  // canonical "index.html#contact"-style link still reads as "already
  // home" when the page was actually reached via the bare root URL
  // (pathname "/") - a plain pathname === pathname check would otherwise
  // mismatch ("/" vs "/index.html") and send an already-home click on an
  // unnecessary round trip through navigate() instead of scrolling in
  // place. pathFilename is declared further below but hoisted, same as
  // every other function here.
  function isSamePage(a) {
    return pathFilename(a.href) === pathFilename(window.location.href) && a.search === window.location.search;
  }

  var navToken = 0;

  // All internal navigation, including the logo: a brief, subtle exit
  // conceal (never a wait), then an instant content swap - see the
  // header comment and .is-leaving in styles.css. The only visible
  // "arrival" motion is whatever the new page's own hero entrance does
  // once it's already sitting in its correct, final position.
  function navigate(url, isPopstate) {
    var token = ++navToken;

    // Freeze the navbar's scroll-driven theme updates for the duration of
    // the fetch - not to force any particular look, just so a stray
    // resize/scroll event mid-flight can't recompute it against a section
    // that's about to be replaced. applySwap() below sets the *correct*
    // theme declaratively, from the incoming page's own markup, in the
    // same synchronous tick as the content swap - see setInitialNavbarTheme
    // in script.js. This is what eliminates the old flash-to-solid-then-
    // flash-back that used to happen on every internal navigation.
    if (window.Herbig && typeof window.Herbig.lockNavbarTheme === "function") {
      window.Herbig.lockNavbarTheme();
    }

    if (!prefersReducedMotion) {
      routeContent.classList.add("is-leaving");
    }

    var fetchDone = fetch(url, { credentials: "same-origin" }).then(function (res) {
      if (!res.ok) throw new Error("Navigation fetch failed: " + res.status);
      return res.text();
    });

    // The exit conceal and the fetch run concurrently - whichever takes
    // longer sets the pace, so a fast (cached) fetch never lets the swap
    // happen before the conceal has actually had a moment to register,
    // and a slow fetch never gets an extra artificial delay stacked on
    // top of it.
    var minWait = new Promise(function (resolve) { window.setTimeout(resolve, EXIT_MS); });

    Promise.all([fetchDone, minWait]).then(function (results) {
      if (token !== navToken) return; // a newer navigation has taken over
      applySwap(results[0], url, isPopstate);
      if (window.Herbig && typeof window.Herbig.unlockNavbarTheme === "function") {
        window.Herbig.unlockNavbarTheme();
      }
    }).catch(function () {
      if (token !== navToken) return;
      window.location.href = url; // never leave the user stuck
    });
  }

  function applySwap(html, url, isPopstate) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var newContent = doc.getElementById("route-content");

    if (!newContent) {
      window.location.href = url;
      return;
    }

    if (!isPopstate) {
      try { history.pushState({ url: url }, "", url); } catch (e) {}
    }

    var newTitle = doc.querySelector("title");
    if (newTitle) document.title = newTitle.textContent;

    // Declarative navbar theme: read it straight from the fetched page's
    // own markup (the same data-navbar-theme convention every section
    // already uses - see refreshDarkSections() in script.js) and apply it
    // to the live navbar BEFORE the content swap below, so the correct
    // theme and the new content land in the same paint. Every page on the
    // site opens on a dark-themed section today, but this reads it rather
    // than assuming it, so it stays correct if that ever changes.
    var firstThemed = newContent.querySelector("[data-navbar-theme]");
    var initialDark = !!firstThemed && firstThemed.getAttribute("data-navbar-theme") === "dark";
    if (window.Herbig && typeof window.Herbig.setInitialNavbarTheme === "function") {
      window.Herbig.setInitialNavbarTheme(initialDark);
    }

    routeContent.innerHTML = newContent.innerHTML;

    // Instant, while still concealed by .is-leaving (or, under reduced
    // motion, simply before anything has been painted at the wrong spot).
    // Browser Back/Forward restores that page's own remembered position;
    // ordinary link navigation always resets to the top. Never a smooth
    // scroll here - see resetScrollInstant() and the removed global
    // scroll-behavior:smooth in styles.css.
    var targetScroll = isPopstate ? (scrollPositions[url] || 0) : 0;
    resetScrollInstant(targetScroll);

    updateActiveNav(pathFilename(url));

    if (window.Herbig && typeof window.Herbig.initContent === "function") {
      window.Herbig.initContent();
    }

    // Un-conceal instantly (no transition on the way back in - only the
    // exit itself animates; see .is-leaving in styles.css). Whatever
    // motion the user perceives from here is the new page's own hero
    // entrance, already reading from its correct, final position.
    routeContent.classList.remove("is-leaving");

    var hash = "";
    try { hash = new URL(url, window.location.href).hash; } catch (e) {}
    if (hash) {
      window.setTimeout(function () {
        var target = document.getElementById(hash.slice(1));
        if (target) {
          target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" });
          focusSectionTarget(target);
        }
      }, prefersReducedMotion ? 0 : 400);
    } else {
      // HG-P3-03: no fragment to land on - focus the new page's own
      // heading so a screen reader announces where the reader actually
      // is, falling back to the route wrapper itself if a page is ever
      // missing one. Matches what a full page load already gives for
      // free; a client-side swap was otherwise leaving focus wherever it
      // happened to be on the previous page.
      focusSectionTarget(routeContent.querySelector("h1") || routeContent);
    }
  }

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || !isEligibleLink(a)) return;

    if (isSamePage(a)) {
      // Same-page anchor (e.g. the homepage navbar linking to its own
      // #core/#team/#contact) or the logo when already home. This used
      // to lean on a sitewide scroll-behavior:smooth for its smooth
      // scroll, but that same CSS property was also silently hijacking
      // the PJAX router's own top-of-page reset (see the removed rule in
      // styles.css) - so it's handled explicitly here instead, scoped to
      // just this one interaction. A bare "#" (no id) has nothing to
      // scroll to; leave that to native behaviour.
      if (a.hash && a.hash.length > 1) {
        var target = document.getElementById(a.hash.slice(1));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" });
          focusSectionTarget(target);
          // HG-P3-06: preventDefault above also suppresses the browser's
          // own default fragment-navigation, which is what would normally
          // update the address bar - without this the URL stayed on
          // whatever fragment (or none) was already there, disagreeing
          // with the section actually on screen. replaceState (not
          // pushState) keeps this to the one history entry per real
          // navigation Back/Forward already relies on, rather than
          // stacking a new entry for every section clicked in a session.
          try { history.replaceState(history.state, "", a.href); } catch (err) {}
        }
      }
      return;
    }

    e.preventDefault();
    navigate(a.href, false);
  });

  window.addEventListener("popstate", function () {
    navigate(window.location.href, true);
  });

  // MOT-09: prefersReducedMotion/EXIT_MS above are snapshots taken once at
  // script load - keep them in sync with a live preference change so the
  // next internal navigation (exit conceal duration, hash-link scroll
  // behavior) respects it immediately rather than only after a fresh
  // reload. script.js has its own matching listener for everything it
  // gates on the same preference.
  var reducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  var onReducedMotionChange = function (e) {
    prefersReducedMotion = e.matches;
    EXIT_MS = prefersReducedMotion ? 0 : 180;
  };
  if (typeof reducedMotionMedia.addEventListener === "function") {
    reducedMotionMedia.addEventListener("change", onReducedMotionChange);
  } else if (typeof reducedMotionMedia.addListener === "function") {
    reducedMotionMedia.addListener(onReducedMotionChange);
  }
})();
