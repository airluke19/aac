(function () {
  var en = (function () { try { return localStorage.getItem('coach-lingua') === 'en'; } catch (e) { return false; } })();
  var T = function (it, e) { return en ? e : it; };
  if (en) {
    document.documentElement.lang = 'en';
    document.title = 'Sign in · AAC';
    document.getElementById('sub').textContent = 'Your running plan that adapts to how you feel, from your watch data.';
    document.getElementById('btn-t').textContent = 'Sign in with Google';
    document.getElementById('btn-esci').textContent = 'Use another account';
    document.getElementById('nota').textContent = 'Access is by invitation: if this is your first time, your request goes to the administrator.';
    document.getElementById('f1').textContent = 'Adaptive plan';
    document.getElementById('demo-link').textContent = 'See the demo with simulated data →';
    document.getElementById('f2').textContent = 'Recovery';
    document.getElementById('f3').textContent = 'Progress';
  }
  var q = new URLSearchParams(location.search);
  var msg = document.getElementById('msg');
  var mostra = function (cls, titolo, testo) { msg.className = 'msg ' + cls; msg.innerHTML = '<b>' + titolo + '</b>' + testo; msg.hidden = false; };
  var errori = {
    richiesta: T('La richiesta di accesso è scaduta o non è valida. Riprova.', 'The sign-in request expired or is invalid. Please try again.'),
    email: T('Il tuo account Google non ha un’email verificata.', 'Your Google account has no verified email.'),
    google: T('Non è stato possibile completare l’accesso con Google. Riprova tra poco.', 'Could not complete Google sign-in. Please try again shortly.'),
    pieno: T('Troppe richieste in attesa: riprova più tardi.', 'Too many pending requests: try again later.')
  };
  if (q.get('errore')) mostra('err', T('Accesso non riuscito', 'Sign-in failed'), errori[q.get('errore')] || errori.google);

  fetch('/auth/stato', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (s) {
    if (!s.login) { location.replace('/'); return; }
    var u = s.utente;
    if (u && u.stato === 'attivo') { location.replace('/'); return; }
    if (u && u.stato === 'in_attesa') {
      mostra('warn', T('Richiesta inviata', 'Request sent'), T('Ciao ' + (u.nome || u.email) + ', l’amministratore deve approvare il tuo accesso (' + u.email + '). Riprova più tardi.', 'Hi ' + (u.nome || u.email) + ', the administrator needs to approve your access (' + u.email + '). Please check back later.'));
      document.getElementById('btn-t').textContent = T('Controlla di nuovo', 'Check again');
      document.getElementById('btn-esci').hidden = false;
      document.getElementById('nota').hidden = true;
    } else if (q.get('stato') === 'bloccato') {
      mostra('err', T('Accesso non consentito', 'Access not allowed'), T('Questo account non può accedere.', 'This account cannot sign in.'));
    }
  }).catch(function () {});

  document.getElementById('btn-esci').addEventListener('click', function () {
    fetch('/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'coach' } }).finally(function () { location.replace('/login.html'); });
  });
})();
