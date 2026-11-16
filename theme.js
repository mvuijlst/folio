// Applies the saved theme before first paint (dark is the default). A file of its own, not
// inline, so the Content-Security-Policy in index.html can forbid inline scripts.
(function () {
  var t = 'dark';
  try { t = localStorage.getItem('bookscan.theme') || 'dark'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', t);
})();
