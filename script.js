(function () {
  "use strict";

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Mobile menu toggle (header is stable — bind once) ---------- */
  var toggle = document.getElementById("menu-toggle");
  var navLinks = document.getElementById("nav-links");

  if (toggle && navLinks) {
    toggle.addEventListener("click", function () {
      var isOpen = navLinks.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    navLinks.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        navLinks.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });

    document.addEventListener("click", function (e) {
      if (!navLinks.classList.contains("is-open")) return;
      if (navLinks.contains(e.target) || toggle.contains(e.target)) return;
      navLinks.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
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

  function initCinematicTrack() {
    var track = document.getElementById("cinematic-track");
    if (!track) return;
    var outer = track.parentElement;
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
          outer.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      },
      { passive: false }
    );
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
