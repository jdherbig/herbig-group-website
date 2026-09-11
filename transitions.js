/*
 * Herbig Group — page-transition system.
 *
 * Architecture: the global header (#navbar) never moves and is never
 * touched by this file. Route content lives in #route-content; this file
 * swaps its innerHTML on internal navigation (fetch + DOMParser, a small
 * PJAX-style router) and animates it in.
 *
 * Three distinct moments share this system:
 *  - First-load intro (once per browser session): the full white curtain
 *    + animated Lottie logo mark, covering the whole viewport including
 *    the navbar.
 *  - Clicking the logo (.brand, any page -> index.html): replays that
 *    exact same full curtain + logo moment on demand, every time —
 *    see navigateHome().
 *  - Every other internal link click: a fast content-only crossfade —
 *    no overlay, just #route-content fading out, swapping, and fading
 *    back in with a small drift — see navigate(). This is the
 *    "page-to-page" transition; it's deliberately quick and
 *    single-motion so it reads as seamless rather than a multi-step
 *    animation sequence.
 *
 * Depends on:
 *  - lottie-web (window.lottie), loaded before this file — used only for
 *    the first-load intro and the logo-click replay, not for regular
 *    page-to-page navigation.
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

  var LOTTIE_SRC = "assets/lottie/logo-animation.json";
  var SEG_FULL = [0, 90];        // full "HERBIG GROUP" wordmark cascade — intro + logo-click replay
  var LOGO_SAFETY_MS = 2200;     // don't wait on lottie forever if it stalls or fails to load

  var NAV_EXIT_MS = 260;         // page-to-page nav: time from click to content swap (matches the CSS .route-content--exit transition duration, so the swap lands right as the old content finishes fading out)
  var NAV_ENTER_MS = 320;        // page-to-page nav: duration of the new content's crossfade-in (matches the CSS .route-content--nav-enter-active transition)

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
  function pathFilename(href) {
    try {
      var u = new URL(href, window.location.href);
      return u.pathname.split("/").pop() || "index.html";
    } catch (e) {
      return "";
    }
  }

  function updateActiveNav(filename) {
    var target = ACTIVE_NAV_MAP[filename] || null;
    document.querySelectorAll("#nav-links .nav-link, #mobile-menu-list .mobile-menu__link").forEach(function (link) {
      var isActive = !!target && pathFilename(link.getAttribute("href")) === target;
      link.classList.toggle("is-active", isActive);
    });
  }

  function forceReflow() {
    void routeContent.offsetWidth;
  }

  /* ---------- Initial branded reveal (once per browser session) ---------- */
  function runIntro() {
    var html = document.documentElement;

    if (prefersReducedMotion) {
      html.classList.remove("hg-intro-pending");
      try { sessionStorage.setItem("hgIntroSeen", "1"); } catch (e) {}
      return;
    }

    if (overlay) overlay.classList.add("is-visible");

    playLogoAndWait(SEG_FULL, 1, LOGO_SAFETY_MS).then(function () {
      html.classList.remove("hg-intro-pending");
      if (overlay) {
        window.setTimeout(function () { overlay.classList.remove("is-visible"); }, 250);
      }
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

  function isSamePage(a) {
    return a.pathname === window.location.pathname && a.search === window.location.search;
  }

  var navToken = 0;

  // Regular page-to-page navigation: a fast frosted-blur crossfade under
  // the navbar. See the header comment for how this differs from
  // navigateHome().
  function navigate(url, isPopstate) {
    var token = ++navToken;

    // Lock the navbar to its solid/legible look for the whole transition —
    // #route-content is fading out (and, shortly, fading back in) under it,
    // so its usual "transparent over a dark section" theme would otherwise
    // read as invisible white-on-white text for that stretch. See the
    // navbarThemeLocked comment in script.js.
    if (window.Herbig && typeof window.Herbig.lockNavbarTheme === "function") {
      window.Herbig.lockNavbarTheme();
    }

    if (!prefersReducedMotion) {
      routeContent.classList.add("route-content--exit");
    }

    var exitDelay = new Promise(function (resolve) {
      window.setTimeout(resolve, prefersReducedMotion ? 0 : NAV_EXIT_MS);
    });

    var fetchPromise = fetch(url, { credentials: "same-origin" }).then(function (res) {
      if (!res.ok) throw new Error("Navigation fetch failed: " + res.status);
      return res.text();
    });

    Promise.all([fetchPromise, exitDelay])
      .then(function (results) {
        if (token !== navToken) return; // a newer navigation has taken over
        applySwap(results[0], url, isPopstate, { instant: false });
      })
      .catch(function () {
        if (token !== navToken) return;
        window.location.href = url; // never leave the user stuck
      });
  }

  // Clicking the logo: replays the exact first-load intro (full white
  // curtain + full logo animation, covering the navbar too) instead of
  // the quick blur used for every other link, every time it's clicked —
  // not just once per session.
  function navigateHome(url, isPopstate) {
    var token = ++navToken;

    if (prefersReducedMotion) {
      fetch(url, { credentials: "same-origin" }).then(function (res) {
        if (!res.ok) throw new Error("Navigation fetch failed: " + res.status);
        return res.text();
      }).then(function (html) {
        if (token !== navToken) return;
        applySwap(html, url, isPopstate, { instant: true });
      }).catch(function () {
        if (token !== navToken) return;
        window.location.href = url;
      });
      return;
    }

    if (overlay) overlay.classList.add("is-visible");

    var fetchPromise = fetch(url, { credentials: "same-origin" }).then(function (res) {
      if (!res.ok) throw new Error("Navigation fetch failed: " + res.status);
      return res.text();
    });

    var logoPromise = playLogoAndWait(SEG_FULL, 1, LOGO_SAFETY_MS);

    Promise.all([fetchPromise, logoPromise])
      .then(function (results) {
        if (token !== navToken) return;
        applySwap(results[0], url, isPopstate, { instant: true });
        window.setTimeout(function () {
          if (token !== navToken) return;
          if (overlay) overlay.classList.remove("is-visible");
        }, 250);
      })
      .catch(function () {
        if (token !== navToken) return;
        window.location.href = url;
      });
  }

  function applySwap(html, url, isPopstate, opts) {
    opts = opts || {};

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

    routeContent.classList.remove("route-content--exit");

    if (opts.instant || prefersReducedMotion) {
      // Either fully hidden behind the opaque logo curtain (instant) or
      // reduced motion is on — no crossfade choreography needed, just swap.
      routeContent.classList.remove("route-content--nav-enter", "route-content--nav-enter-active");
      routeContent.innerHTML = newContent.innerHTML;
    } else {
      routeContent.classList.add("route-content--nav-enter");
      routeContent.innerHTML = newContent.innerHTML;
      forceReflow();
      routeContent.classList.remove("route-content--nav-enter");
      routeContent.classList.add("route-content--nav-enter-active");
      window.setTimeout(function () {
        routeContent.classList.remove("route-content--nav-enter-active");
      }, NAV_ENTER_MS);
    }

    window.scrollTo(0, 0);
    updateActiveNav(pathFilename(url));

    if (window.Herbig && typeof window.Herbig.initContent === "function") {
      window.Herbig.initContent();
    }

    if (!opts.instant) {
      window.setTimeout(function () {
        if (window.Herbig && typeof window.Herbig.unlockNavbarTheme === "function") {
          window.Herbig.unlockNavbarTheme();
        }
      }, prefersReducedMotion ? 0 : NAV_ENTER_MS);
    }

    var hash = "";
    try { hash = new URL(url, window.location.href).hash; } catch (e) {}
    if (hash) {
      window.setTimeout(function () {
        var target = document.getElementById(hash.slice(1));
        if (target) target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" });
      }, prefersReducedMotion ? 0 : 400);
    }
  }

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || !isEligibleLink(a)) return;

    if (a.classList.contains("brand")) {
      // The logo always replays the full intro treatment, even when
      // already on the homepage -- unlike regular links, it deliberately
      // ignores isSamePage() so every click plays the moment.
      e.preventDefault();
      navigateHome(a.href, false);
      return;
    }

    if (isSamePage(a)) return; // same-page anchors / "#" placeholders: native behaviour

    e.preventDefault();
    navigate(a.href, false);
  });

  window.addEventListener("popstate", function () {
    navigate(window.location.href, true);
  });

  if (window.history && "scrollRestoration" in window.history) {
    history.scrollRestoration = "manual";
  }
})();
