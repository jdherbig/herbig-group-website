/*
 * Herbig Group — page-transition system.
 *
 * Architecture: the global header (#navbar) never moves and is never
 * touched by this file. Route content lives in #route-content; this file
 * swaps its innerHTML on internal navigation (fetch + DOMParser, a small
 * PJAX-style router) and animates it in with a translateY(rise) + fade.
 *
 * Two distinct overlay moments share #page-transition-overlay:
 *  - First-load intro (once per browser session): the full white curtain
 *    + animated Lottie logo mark, unchanged from before.
 *  - Page-to-page navigation (every internal link click after that): a
 *    quick frosted white blur, no logo, sitting below the navbar
 *    (.page-transition-overlay--nav) so the navbar is never covered.
 *
 * Depends on:
 *  - lottie-web (window.lottie), loaded before this file — used only for
 *    the first-load intro, not for page-to-page navigation.
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
  var SEG_FULL = [0, 90];        // intro only — icon settle + full "HERBIG GROUP" wordmark cascade
  var NAV_BLUR_IN_MS = 380;      // page-to-page nav: hold the blur before the new page swaps in
  var NAV_BLUR_OUT_MS = 380;     // page-to-page nav: hold the blur after swap before fading back out

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

    playLogo(SEG_FULL).then(function (inst) {
      var finished = false;
      var finish = function () {
        if (finished) return;
        finished = true;
        html.classList.remove("hg-intro-pending");
        if (overlay) {
          window.setTimeout(function () { overlay.classList.remove("is-visible"); }, 250);
        }
        try { sessionStorage.setItem("hgIntroSeen", "1"); } catch (e) {}
      };

      if (inst) {
        inst.addEventListener("complete", finish);
        window.setTimeout(finish, 2200); // safety net
      } else {
        finish();
      }
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
      if (overlay) overlay.classList.add("is-visible", "page-transition-overlay--nav");
      routeContent.classList.add("route-content--exit");
    }

    var blurInDelay = new Promise(function (resolve) {
      window.setTimeout(resolve, prefersReducedMotion ? 0 : NAV_BLUR_IN_MS);
    });

    var fetchPromise = fetch(url, { credentials: "same-origin" }).then(function (res) {
      if (!res.ok) throw new Error("Navigation fetch failed: " + res.status);
      return res.text();
    });

    Promise.all([fetchPromise, blurInDelay])
      .then(function (results) {
        if (token !== navToken) return; // a newer navigation has taken over
        applySwap(results[0], url, isPopstate);
      })
      .catch(function () {
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

    routeContent.classList.remove("route-content--exit");

    if (!prefersReducedMotion) {
      routeContent.classList.add("route-content--enter");
      routeContent.innerHTML = newContent.innerHTML;
      forceReflow();
      routeContent.classList.remove("route-content--enter");
    } else {
      routeContent.innerHTML = newContent.innerHTML;
    }

    window.scrollTo(0, 0);
    updateActiveNav(pathFilename(url));

    if (window.Herbig && typeof window.Herbig.initContent === "function") {
      window.Herbig.initContent();
    }

    window.setTimeout(function () {
      if (overlay) overlay.classList.remove("is-visible", "page-transition-overlay--nav");
      if (window.Herbig && typeof window.Herbig.unlockNavbarTheme === "function") {
        window.Herbig.unlockNavbarTheme();
      }
    }, prefersReducedMotion ? 0 : NAV_BLUR_OUT_MS);

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
