// Applica tema e colore d'accento prima del primo disegno (niente lampo bianco/nero).
// Caricato in modo sincrono nel <head> di index.html e login.html.
(function () {
  var t = null;
  try { t = localStorage.getItem('coach-tema'); } catch (e) {}
  if (t !== 'light' && t !== 'dark') t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  var c = null;
  try { c = localStorage.getItem('coach-colore'); } catch (e) {}
  document.documentElement.setAttribute('data-accent', c || 'verde');
})();
// Icona della scheda nel colore d'accento scelto (letto dai CSS a pagina caricata)
window.aacFavicon = function () {
  try {
    var cs = getComputedStyle(document.documentElement);
    var a = cs.getPropertyValue('--accent').trim();
    if (!/^#[0-9a-fA-F]{3,8}$/.test(a)) return;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 6 56 52"><g stroke="' + a + '" stroke-width="4.8" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M13.6 26.5A19 19 0 1 1 13.6 37.5"/><path d="M8 32h14l3.5-8 5 16 3.5-8h4"/></g></svg>';
    var l = document.querySelector('link[rel="icon"]');
    if (l) l.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  } catch (e) {}
};
window.addEventListener('DOMContentLoaded', function () { window.aacFavicon(); });
