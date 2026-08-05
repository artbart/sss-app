/*
 * Reading mode — dark ↔ light theme + 3 light palettes for chapter and
 * library book reading. Self-contained, no imports. Included by:
 *   • chapter.html
 *   • /library/read.html
 *   • every /library/book/*/index.html static book page
 *
 * Behavior:
 *   1. On script load (before DOM ready) — read localStorage and apply
 *      data-theme + data-palette to <html> immediately, so returning
 *      readers don't see a burgundy flash before the light theme kicks
 *      in. First-time visitors default to dark (the app's native look).
 *   2. On DOM ready — find any element marked with data-reading-toolbar
 *      and inject the toggle + palette picker UI. Wire clicks.
 *
 * localStorage keys:
 *   sss.readingTheme   → "dark" | "light"
 *   sss.readingPalette → "sepia" | "pocket" | "paper"   (light-only)
 */
(function () {
  var LS_THEME = "sss.readingTheme";
  var LS_PALETTE = "sss.readingPalette";
  var DEFAULT_PALETTE = "sepia";
  var VALID_PALETTES = ["sepia", "pocket", "paper"];

  function readTheme() {
    try {
      var t = localStorage.getItem(LS_THEME);
      return t === "light" ? "light" : "dark";
    } catch (_) { return "dark"; }
  }
  function readPalette() {
    try {
      var p = localStorage.getItem(LS_PALETTE);
      return VALID_PALETTES.indexOf(p) >= 0 ? p : DEFAULT_PALETTE;
    } catch (_) { return DEFAULT_PALETTE; }
  }
  function saveTheme(t) {
    try { localStorage.setItem(LS_THEME, t); } catch (_) {}
  }
  function savePalette(p) {
    try { localStorage.setItem(LS_PALETTE, p); } catch (_) {}
  }

  // Apply state to <html> immediately — before DOM ready, before CSS
  // paints — so returning light-mode readers never see a burgundy flash.
  var html = document.documentElement;
  var currentTheme = readTheme();
  var currentPalette = readPalette();
  html.setAttribute("data-theme", currentTheme);
  html.setAttribute("data-palette", currentPalette);

  function paintToolbar(container) {
    // Idempotent — never inject twice, even if two callers add markup.
    if (container.dataset.rmMounted === "1") return;
    container.dataset.rmMounted = "1";

    container.classList.add("rm-toolbar");
    container.innerHTML =
      '<div class="rm-palette" role="group" aria-label="Reading palette">' +
        '<button type="button" data-rm-palette="sepia">Sepia</button>' +
        '<button type="button" data-rm-palette="pocket">Pocket</button>' +
        '<button type="button" data-rm-palette="paper">Paper</button>' +
      '</div>' +
      '<button type="button" class="rm-btn" data-rm-toggle aria-label="Toggle reading mode">' +
        '<span class="ico" data-rm-ico></span>' +
        '<span data-rm-label></span>' +
      '</button>';

    syncToolbar(container);

    container.addEventListener("click", function (e) {
      var toggle = e.target.closest("[data-rm-toggle]");
      if (toggle) {
        var next = html.getAttribute("data-theme") === "light" ? "dark" : "light";
        html.setAttribute("data-theme", next);
        saveTheme(next);
        syncToolbars();
        return;
      }
      var pBtn = e.target.closest("[data-rm-palette]");
      if (pBtn) {
        var p = pBtn.getAttribute("data-rm-palette");
        if (VALID_PALETTES.indexOf(p) < 0) return;
        html.setAttribute("data-palette", p);
        savePalette(p);
        // If they touched a palette while in dark mode, auto-flip to light —
        // the user just told us they want to see it.
        if (html.getAttribute("data-theme") !== "light") {
          html.setAttribute("data-theme", "light");
          saveTheme("light");
        }
        syncToolbars();
      }
    });
  }

  function syncToolbar(container) {
    var isLight = html.getAttribute("data-theme") === "light";
    var palette = html.getAttribute("data-palette") || DEFAULT_PALETTE;
    var ico = container.querySelector("[data-rm-ico]");
    var label = container.querySelector("[data-rm-label]");
    if (ico) ico.textContent = isLight ? "🌙" : "☀️";
    if (label) label.textContent = isLight ? "Dark" : "Light";
    container.querySelectorAll("[data-rm-palette]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-rm-palette") === palette);
    });
  }
  function syncToolbars() {
    document.querySelectorAll("[data-reading-toolbar]").forEach(syncToolbar);
  }

  function mountAll() {
    var containers = document.querySelectorAll("[data-reading-toolbar]");
    containers.forEach(paintToolbar);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll);
  } else {
    mountAll();
  }
})();
