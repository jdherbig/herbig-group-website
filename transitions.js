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

  var LOTTIE_SRC = "assets/lottie/logo-animation.json";
  var SEG_FULL = [0, 90];        // full "HERBIG GROUP" wordmark cascade — intro + logo-click replay
  var LOGO_SAFETY_MS = 2200;     // don't wait on lottie forever if it stalls or fails to load

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

  // All internal navigation, including the logo: instant content swap,
  // no overlay, no animation. See the header comment.
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

    fetch(url, { credentials: "same-origin" }).then(function (res) {
      if (!res.ok) throw new Error("Navigation fetch failed: " + res.status);
      return res.text();
    }).then(function (html) {
      if (token !== navToken) return; // a newer navigation has taken over
      applySwap(html, url, isPopstate);
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

    window.scrollTo(0, 0);
    updateActiveNav(pathFilename(url));

    if (window.Herbig && typeof window.Herbig.initContent === "function") {
      window.Herbig.initContent();
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

    if (isSamePage(a)) return; // same-page anchors / "#" placeholders, including the logo when already home: native behaviour

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
