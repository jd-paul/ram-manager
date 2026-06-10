// Synchronous FOUC-prevention helper. Must be loaded as a classic <script>
// in the <head> of every extension page, before any stylesheet, so the
// correct theme-light / theme-dark class is applied before first paint.
(function () {
  try {
    const cls = localStorage.getItem('ram-manager-theme-class');
    if (cls) {
      document.documentElement.classList.add(cls);
    }
  } catch (e) {
    // Ignore localStorage errors in restricted contexts.
  }
})();
