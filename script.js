(function () {
  "use strict";

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Mobile menu (full-screen overlay; header is stable — bind once) ----------
   * #mobile-menu lives outside #route-content next to the navbar, so this
   * binds once and keeps working across every PJAX page swap. */
  var toggle = document.getElementById("menu-toggle");
  var mobileMenu = document.getElementById("mobile-menu");
  var mobileMenuClose = document.getElementById("mobile-menu-close");

  if (toggle && mobileMenu) {
    var openMobileMenu = function () {
      mobileMenu.classList.add("is-open");
      mobileMenu.setAttribute("aria-hidden", "false");
      toggle.setAttribute("aria-expanded", "true");
      document.documentElement.classList.add("no-scroll");
      if (mobileMenuClose) mobileMenuClose.focus();
    };

    var closeMobileMenu = function () {
      mobileMenu.classList.remove("is-open");
      mobileMenu.setAttribute("aria-hidden", "true");
      toggle.setAttribute("aria-expanded", "false");
      document.documentElement.classList.remove("no-scroll");
    };

    toggle.addEventListener("click", function () {
      if (mobileMenu.classList.contains("is-open")) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    });

    if (mobileMenuClose) mobileMenuClose.addEventListener("click", closeMobileMenu);

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

  var updateNavbar = function () {
    if (!navbar) return;
    tickingNavbar = false;
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
    initAssetCardButtons();
    initContactForm();
  }

  initContent();

  window.Herbig = window.Herbig || {};
  window.Herbig.initContent = initContent;
  window.Herbig.refreshNavbarTheme = refreshDarkSections;
})();
