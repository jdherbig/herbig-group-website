(function () {
  "use strict";

  /* ---------- Mobile menu toggle ---------- */
  var toggle = document.getElementById("menu-toggle");
  var navLinks = document.getElementById("nav-links");

  if (toggle && navLinks) {
    toggle.addEventListener("click", function () {
      var isOpen = navLinks.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    // Close menu when a link is tapped
    navLinks.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        navLinks.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });

    // Close menu on outside click
    document.addEventListener("click", function (e) {
      if (!navLinks.classList.contains("is-open")) return;
      if (navLinks.contains(e.target) || toggle.contains(e.target)) return;
      navLinks.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    });
  }

  /* ---------- Scroll reveal ---------- */
  var revealEls = document.querySelectorAll(".reveal, .reveal-stagger");

  if ("IntersectionObserver" in window && revealEls.length) {
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
  } else {
    // Fallback: no IO support, just show everything
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  }
})();
