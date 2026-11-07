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
