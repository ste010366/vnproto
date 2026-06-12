/* ════════════════════════════════════════════════════════════════════
   promo.js — Popup promozionale con video-intro animato (XLSuiteVolley)
   Compare all'apertura della pagina VolleyNetwork e presenta la suite in
   una sequenza di "scene" animate (panoramica funzioni), con CTA verso
   prodotto.html ("Scopri prezzi e funzioni").

   Indipendente da app.js: usa solo il proprio markup .promo-/.scene.
   NON mostra il popup a chi sta consultando i dati di una società
   (login Auth o parametri ?soc/?db) né a chi ha scelto "non mostrare più".

   Stato ricordato:
     localStorage  'xlsv_promo_off'   = '1'  → mai più (scelta dell'utente)
     sessionStorage 'xlsv_promo_vista' = '1'  → già visto in questa sessione
   Forzare la visione (test / link "rivedi"):  ?promo=1  oppure  XLSVPromo.apri()
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var K_OFF = 'xlsv_promo_off';
  var K_VISTA = 'xlsv_promo_vista';

  /* ── Scene del video (panoramica funzioni reali della suite) ───────── */
  var SCENE = [
    { id: 'hero', dur: 3200, cls: 'scene--hero', html:
      '<div class="hero-logo" data-in="1">🏐</div>' +
      '<div class="hero-brand" data-in="2">XLSuite<span class="vn">Volley</span></div>' +
      '<p class="scene-sub" data-in="3">La suite che trasforma ogni partita di pallavolo in dati, video e decisioni.</p>' +
      '<div class="promo-chips" data-in="3">' +
        '<span class="promo-chip">Scout</span><span class="promo-chip">Analisi</span>' +
        '<span class="promo-chip">Video</span><span class="promo-chip">VolleyNetwork</span></div>' },

    { id: 'live', dur: 4200, cls: 'scene--live', html:
      '<div class="scene-kick" data-in="1">Rilevazione live</div>' +
      '<h3 class="scene-tit" data-in="1">Scout in tempo reale, <em>zero carta</em></h3>' +
      '<div class="scene-art" data-in="2">' +
        '<div class="court">' +
          '<div class="scoreboard">CASA <span class="pt">18</span> : <span>15</span> OSPITI</div>' +
          '<div class="net"></div>' +
          '<div class="spot" style="left:25%;top:25%">4</div>' +
          '<div class="spot" style="left:50%;top:20%">3</div>' +
          '<div class="spot" style="left:75%;top:25%">2</div>' +
          '<div class="spot" style="left:25%;top:40%">5</div>' +
          '<div class="spot" style="left:50%;top:44%">6</div>' +
          '<div class="spot" style="left:75%;top:40%">1</div>' +
          '<div class="ball">🏐</div>' +
        '</div>' +
      '</div>' +
      '<p class="scene-sub" data-in="3">Campo interattivo, punteggio e codici rapidi: l\'azione è registrata mentre giochi.</p>' },

    { id: 'atleta', dur: 4600, cls: 'scene--atleta', html:
      '<div class="scene-kick" data-in="1">Profilo atleta</div>' +
      '<h3 class="scene-tit" data-in="1">Ogni atleta come una <em>stella</em></h3>' +
      '<div class="scene-art" data-in="2">' +
        '<div class="radar-box">' + svgRadar() + '<div class="art-cap">Radar fondamentali</div></div>' +
        '<div class="coni-box">' + svgConi() + '<div class="art-cap">Coni d\'attacco</div></div>' +
      '</div>' +
      '<p class="scene-sub" data-in="3">Radar di efficienza e distribuzione degli attacchi a colpo d\'occhio.</p>' },

    { id: 'video', dur: 4200, cls: 'scene--video', html:
      '<div class="scene-kick" data-in="1">Montaggio video</div>' +
      '<h3 class="scene-tit" data-in="1">Highlight <em>automatici</em></h3>' +
      '<div class="scene-art" data-in="2">' +
        '<div class="timeline">' +
          '<div class="clip title">TITOLO</div>' +
          '<div class="clip">▶</div><div class="clip">▶</div><div class="clip">▶</div>' +
        '</div>' +
        '<div class="render-bar"><i></i></div>' +
      '</div>' +
      '<p class="scene-sub" data-in="3">Scegli le azioni: la suite genera il video con title card e clip in sequenza.</p>' },

    { id: 'classifiche', dur: 4400, cls: 'scene--classifiche', html:
      '<div class="scene-kick" data-in="1">VolleyNetwork</div>' +
      '<h3 class="scene-tit" data-in="1">Classifiche <em>nazionali</em> di rendimento</h3>' +
      '<div class="scene-art" data-in="2">' +
        '<table class="rank"><thead><tr><th>#</th><th>Giocatore</th><th>Ruolo</th><th class="n">Indice</th></tr></thead>' +
        '<tbody>' +
          '<tr><td class="idx">1</td><td>Rossi M.</td><td>Opposto</td><td class="n val">41,8</td></tr>' +
          '<tr><td class="idx">2</td><td>Conti L.</td><td>Schiacc.</td><td class="n val">38,2</td></tr>' +
          '<tr><td class="idx">3</td><td>Neri G.</td><td>Centrale</td><td class="n val">35,6</td></tr>' +
          '<tr><td class="idx">4</td><td>Verdi A.</td><td>Schiacc.</td><td class="n val">33,1</td></tr>' +
        '</tbody></table>' +
      '</div>' +
      '<p class="scene-sub" data-in="3">Confronta i tuoi atleti con il database condiviso: indice bayesiano, filtri, drill-down.</p>' },

    { id: 'studio', dur: 4200, cls: 'scene--studio', html:
      '<div class="scene-kick" data-in="1">Studio &amp; report</div>' +
      '<h3 class="scene-tit" data-in="1">Analisi tattica, <em>pronta da stampare</em></h3>' +
      '<div class="scene-art" data-in="2">' +
        '<div class="grid-mini">' + celleGriglia() + '</div>' +
        '<div class="pdf-badge" data-in="3">📄 Esporta in Excel &amp; PDF</div>' +
      '</div>' +
      '<p class="scene-sub" data-in="3">Griglie rotazione × zona × esito e relazioni complete in pochi minuti.</p>' }
  ];

  /* ── SVG di scena (stilizzati, valori dimostrativi) ────────────────── */
  function svgRadar() {
    // pentagono S-R-A-B-D + poligono valori (porta concettuale del radar Pos%)
    var griglia = [0.25, 0.5, 0.75, 1].map(function (f) {
      return poligonoPenta(95, 82, 58 * f, 'none', '#33425e', 1);
    }).join('');
    var assi = pentaPunti(95, 82, 58).map(function (p) {
      return '<line x1="95" y1="82" x2="' + p[0] + '" y2="' + p[1] + '" stroke="#33425e"/>';
    }).join('');
    var dati = '<polygon class="radar-poly" points="95,46 138,68 124,122 76,108 56,69" ' +
      'fill="rgba(96,165,250,.30)" stroke="#60a5fa" stroke-width="2.5"/>';
    var lab = ['S', 'R', 'A', 'M', 'D'];
    var etich = pentaPunti(95, 82, 72).map(function (p, i) {
      return '<text x="' + p[0] + '" y="' + (p[1] + 4) + '" text-anchor="middle" ' +
        'fill="#9fb2cc" font-size="11" font-weight="700">' + lab[i] + '</text>';
    }).join('');
    return '<svg viewBox="0 0 190 164" role="img" aria-label="Radar fondamentali">' +
      griglia + assi + dati + etich + '</svg>';
  }
  function pentaPunti(cx, cy, r) {
    var pts = [];
    for (var i = 0; i < 5; i++) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / 5;
      pts.push([Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))]);
    }
    return pts;
  }
  function poligonoPenta(cx, cy, r, fill, stroke, sw) {
    return '<polygon points="' + pentaPunti(cx, cy, r).map(function (p) { return p.join(','); }).join(' ') +
      '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"/>';
  }
  function svgConi() {
    // mini-campo con punto di partenza e 3 coni d'attacco verso zone diverse
    return '<svg viewBox="0 0 190 150" role="img" aria-label="Coni d\'attacco">' +
      '<rect x="6" y="6" width="178" height="138" rx="6" fill="#0e7c63" stroke="rgba(255,255,255,.4)"/>' +
      '<line x1="6" y1="75" x2="184" y2="75" stroke="#fff" stroke-opacity=".7"/>' +
      '<polygon class="cono" points="95,120 40,40 64,34" fill="#22c55e" stroke="#22c55e"/>' +
      '<polygon class="cono" points="95,120 86,30 106,32" fill="#84cc16" stroke="#84cc16"/>' +
      '<polygon class="cono" points="95,120 132,40 150,56" fill="#f59e0b" stroke="#f59e0b"/>' +
      '<circle cx="95" cy="120" r="5" fill="#fff"/>' +
      '</svg>';
  }
  function celleGriglia() {
    // 18 celle "a semaforo" come una griglia rotazione×zona dello Studio
    var pattern = ['g', 'g', 'y', 'b', 'g', 'r', 'b', 'g', 'g', 'y', 'g', 'b',
                   'g', 'r', 'y', 'g', 'b', 'g'];
    return pattern.map(function (c, i) {
      return '<i class="' + c + '" style="animation-delay:' + (0.05 * i).toFixed(2) + 's"></i>';
    }).join('');
  }

  /* ── Condizioni di visualizzazione ─────────────────────────────────── */
  function utenteSocieta() {
    // login società (Auth) o link diretto ai dati di una società → niente promo
    var p = new URLSearchParams(location.search);
    if (p.get('soc') || p.get('db')) return true;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('sb-') === 0 && k.indexOf('auth-token') >= 0) {
          var v = localStorage.getItem(k);
          if (v && v.indexOf('access_token') >= 0) return true;
        }
      }
    } catch (e) { /* storage non disponibile */ }
    return false;
  }
  function dovrebbeMostrare() {
    var p = new URLSearchParams(location.search);
    if (p.get('promo') === '1') return true;     // forzatura esplicita
    if (p.get('promo') === '0') return false;
    try {
      if (localStorage.getItem(K_OFF) === '1') return false;
      if (sessionStorage.getItem(K_VISTA) === '1') return false;
    } catch (e) { /* prosegui */ }
    if (utenteSocieta()) return false;
    return true;
  }

  /* ── Motore scene ──────────────────────────────────────────────────── */
  var idx = 0, timer = null, restante = 0, inizioScena = 0, inPausa = false;
  var elVideo, elScene = [], elSeg = [], elPausa;

  function vaiA(i, autoavvio) {
    if (i < 0) i = 0;
    if (i >= SCENE.length) { fine(); return; }
    idx = i;
    elScene.forEach(function (s, n) { s.classList.toggle('attiva', n === i); });
    // ri-trigger animazioni CSS della scena entrante
    var s = elScene[i];
    s.classList.remove('attiva'); void s.offsetWidth; s.classList.add('attiva');
    // segmenti barra
    elSeg.forEach(function (g, n) {
      g.classList.toggle('done', n < i);
      g.classList.toggle('cur', n === i);
      if (n === i) g.style.setProperty('--seg-dur', (SCENE[i].dur / 1000) + 's');
    });
    if (autoavvio !== false) avviaTimer(SCENE[i].dur);
  }
  function avviaTimer(ms) {
    clearTimeout(timer);
    restante = ms; inizioScena = Date.now(); inPausa = false;
    elVideo.classList.remove('paused');
    timer = setTimeout(function () { vaiA(idx + 1); }, ms);
  }
  function pausaRiprendi() {
    if (idx >= SCENE.length) { rivedi(); return; }
    if (inPausa) {
      inPausa = false; elVideo.classList.remove('paused');
      inizioScena = Date.now();
      timer = setTimeout(function () { vaiA(idx + 1); }, restante);
      if (elPausa) elPausa.textContent = '❚❚';
    } else {
      inPausa = true; elVideo.classList.add('paused');
      clearTimeout(timer);
      restante -= (Date.now() - inizioScena);
      if (elPausa) elPausa.textContent = '▶';
    }
  }
  function fine() {
    // ferma sull'ultima scena con barra piena; il pulsante pausa diventa "rivedi"
    clearTimeout(timer);
    idx = SCENE.length;
    elSeg.forEach(function (g) { g.classList.add('done'); g.classList.remove('cur'); });
    elVideo.classList.add('paused');
    if (elPausa) { elPausa.textContent = '↻'; elPausa.title = 'Rivedi'; }
  }
  function rivedi() { if (elPausa) elPausa.title = 'Pausa'; vaiA(0); }

  /* ── Costruzione e apertura del popup ──────────────────────────────── */
  function apri() {
    if (document.querySelector('.promo-overlay')) return;   // già aperto
    var ov = document.createElement('div');
    ov.className = 'promo-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Presentazione XLSuiteVolley');

    var sceneHtml = SCENE.map(function (s) {
      return '<div class="scene ' + s.cls + '" data-id="' + s.id + '">' + s.html + '</div>';
    }).join('');
    var segHtml = SCENE.map(function () { return '<div class="promo-seg"><i></i></div>'; }).join('');

    ov.innerHTML =
      '<div class="promo-card">' +
        '<button class="promo-x" title="Chiudi" aria-label="Chiudi">✕</button>' +
        '<div class="promo-video">' +
          sceneHtml +
          '<button class="promo-pause" title="Pausa" aria-label="Pausa/Riprendi">❚❚</button>' +
          '<button class="promo-skip">Salta ▸</button>' +
          '<div class="promo-progress">' + segHtml + '</div>' +
        '</div>' +
        '<div class="promo-cta">' +
          '<h2>Porta la tua squadra nell\'era del dato</h2>' +
          '<p>Scout, analisi, video e il database VolleyNetwork in un\'unica suite.</p>' +
          '<div class="promo-actions">' +
            '<a class="promo-btn primario" href="prodotto.html">Scopri prezzi e funzioni →</a>' +
            '<button class="promo-btn ghost" data-chiudi>Esplora il VolleyNetwork</button>' +
          '</div>' +
          '<div class="promo-foot">' +
            '<label><input type="checkbox" id="promoOff"> Non mostrare più all\'avvio</label>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    try { sessionStorage.setItem(K_VISTA, '1'); } catch (e) { /* ignora */ }

    elVideo = ov.querySelector('.promo-video');
    elScene = [].slice.call(ov.querySelectorAll('.scene'));
    elSeg = [].slice.call(ov.querySelectorAll('.promo-seg'));
    elPausa = ov.querySelector('.promo-pause');

    // interazioni
    ov.querySelector('.promo-x').onclick = chiudi;
    ov.querySelector('[data-chiudi]').onclick = chiudi;
    ov.querySelector('.promo-skip').onclick = fine;
    elPausa.onclick = pausaRiprendi;
    elSeg.forEach(function (g, n) { g.onclick = function () { vaiA(n); }; });
    ov.addEventListener('click', function (e) { if (e.target === ov) chiudi(); });
    document.addEventListener('keydown', onKey);
    ov.querySelector('#promoOff').onchange = function (e) {
      try { localStorage.setItem(K_OFF, e.target.checked ? '1' : '0'); } catch (err) { /* ignora */ }
    };
    // la CTA primaria registra comunque la chiusura (l'utente "ha visto")
    ov.querySelector('.promo-btn.primario').addEventListener('click', function () {
      try { sessionStorage.setItem(K_VISTA, '1'); } catch (err) { /* ignora */ }
    });

    vaiA(0);
  }

  function onKey(e) {
    if (e.key === 'Escape') chiudi();
    else if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); pausaRiprendi(); }
    else if (e.key === 'ArrowRight') vaiA(idx + 1);
    else if (e.key === 'ArrowLeft') vaiA(Math.max(0, idx - 1));
  }
  function chiudi() {
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    var ov = document.querySelector('.promo-overlay');
    if (ov) ov.parentNode.removeChild(ov);
  }

  // API pubblica per il link "rivedi la presentazione" (vedi footer index.html)
  window.XLSVPromo = { apri: apri, chiudi: chiudi };

  // Avvio automatico, con un piccolo ritardo per non competere col caricamento dati
  window.addEventListener('DOMContentLoaded', function () {
    if (!dovrebbeMostrare()) return;
    setTimeout(apri, 650);
  });
})();
