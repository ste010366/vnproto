/* Prototipo web VolleyNetwork — consultazione e ricerca (sola lettura).
   Porta in JS le stesse query e formule del desktop XLSuiteVolley:
   • Classifiche  = ModRepositoryUniversale.ClassificaRendimento + ParametriBayes
                    + frmVNClassifiche.BayesIndex (indice bayesiano)
   • Scheda squadra = i 4 "fogli" del PDF RenderSchedaSquadraVN
                    (Scheda / Fondamentali / Coni d'attacco / Formule)
   • Profilo atleta = frmVNProfilo (radar Pos% + coni + storico tesseramenti)
   • *E% e Pos%   = dinamiche da TBEfficienza/TBPositivita (come l'app)
   Il DB (vn_web.db) è generato da: XLSuiteVolley.exe --export-vn-web        */

'use strict';

/* ── Costanti (codifiche identiche al desktop) ─────────────────────── */
const QUALITA = ['#', '+', '!', '-', '/', '='];
const LABEL_QUALITA = { '#': 'punto', '+': 'positivo', '!': 'esclamativo', '-': 'negativo', '/': 'slash', '=': 'errore' };
const LABEL_FOND = { S: 'Battuta', R: 'Ricezione', A: 'Attacco', B: 'Muro', D: 'Difesa', E: 'Alzata', F: 'Free' };
const LABEL_FOND_SCHEDA = { S: 'Servizio', R: 'Ricezione', A: 'Attacco', B: 'Muro', E: 'Alzata', D: 'Difesa', F: 'Freeball' };
const ORDINE_SCHEDA = ['S', 'R', 'A', 'B', 'E', 'D', 'F'];
const FOND_CLASSIFICA = ['S', 'R', 'A', 'B', 'D'];
const LABEL_RUOLO = { P: 'Palleggiatore', S: 'Schiacciatore', C: 'Centrale', O: 'Opposto', L: 'Libero' };
const MIN_ATTACCHI_CONI = 10;   // come il PDF (MIN_ATTACCHI)

let db = null;
let EFF = {};        // f → {v:'#+/', p:'=', formula}
let POS = {};        // f → {p:'#+!', formula}
let META = {};
let catStagList = [];
let clipSeq = 0;     // id univoci per i clipPath SVG

/* ── Avvio ─────────────────────────────────────────────────────────── */
let FONTE = 'file locale';   // da dove arrivano i dati (locale o Supabase)

/* ── Accesso società (Fase 4): Supabase Auth + membership ───────────────
   La pagina resta una DEMO PUBBLICA (vnproto) per default; il login è un di
   più che, via RLS sul bucket privato vn (migrazione 0005), mostra i dati
   della PROPRIA società. PROGETTO_URL e ANON sono pubblici (l'anon non dà
   accesso al DB: tabelle protette da RLS) — gli stessi del client desktop. */
const SB_URL  = 'https://tptaihactzorfyleqwsf.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwdGFpaGFjdHpvcmZ5bGVxd3NmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjI1MDUsImV4cCI6MjA5NjQzODUwNX0.WpJbQyZ-bIbEWN_ztku3zmDsaDWL6viVA451PsRRWho';
let sb = null;          // client supabase-js (creato solo se la libreria c'è)
let sessione = null;    // sessione Auth corrente (o null)
let mieSocieta = [];    // [{id, nome, ruolo}] società dell'utente loggato
let socAttiva = null;   // società scelta → legge vn/<id>/vn_web.db
let SQL = null;         // motore sql.js, inizializzato una sola volta

/* Carica i byte del DB: prima dal cloud se vn_config.json indica un remoteDb
   (pubblicato con Pubblica-Supabase.ps1), altrimenti dal file locale. */
async function caricaDbBytes() {
  const params = new URLSearchParams(location.search);

  // 0) Sessione società (Fase 4): utente autenticato + società scelta →
  //    lettura DIRETTA dal bucket privato vn. La RLS di storage.objects
  //    (migrazione 0005) autorizza solo se l'utente ha membership attiva per
  //    questa società: nessun signed URL, basta il JWT conservato in `sb`.
  if (sb && socAttiva) {
    const path = socAttiva.id + '/vn_web.db';
    const { data, error } = await sb.storage.from('vn').download(path);
    if (error || !data)
      throw new Error('Dati della società non disponibili (' +
        (error && error.message ? error.message : 'accesso negato') +
        '). La società potrebbe non aver ancora pubblicato i dati dal programma.');
    FONTE = '🔒 ' + (socAttiva.nome || 'società');
    return await data.arrayBuffer();
  }

  // 1) Override esplicito ?db=<url firmato>: verifica una pubblicazione DI
  //    SOCIETÀ. È il "download_url" che la Edge Function pubblica-vn restituisce
  //    (bucket privato vn/<societa_id>/vn_web.db, link firmato a tempo).
  const dbDiretto = params.get('db');
  if (dbDiretto) {
    const r = await fetch(dbDiretto, { cache: 'no-store' });
    if (r.ok) { FONTE = '☁️ società (link firmato)'; return r.arrayBuffer(); }
    throw new Error('Link dati non valido o scaduto (?db).');
  }

  // 2) Società specifica ?soc=<id>: con bucket privato servirà il login
  //    (Auth + membership, in arrivo). Per ora si appoggia a remoteBase di
  //    vn_config.json, se presente: <remoteBase>/<id>/vn_web.db.
  const soc = params.get('soc');
  try {
    const cfg = await fetch('vn_config.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).catch(() => null);
    if (soc && cfg && cfg.remoteBase) {
      const url = cfg.remoteBase.replace(/\/+$/, '') + '/' + encodeURIComponent(soc) + '/vn_web.db';
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) { FONTE = '☁️ società ' + soc; return r.arrayBuffer(); }
    }
    // 3) Comportamento storico: repository VN demo (bucket pubblico vnproto).
    if (cfg && cfg.remoteDb) {
      const url = cfg.remoteDb + (cfg.remoteDb.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(cfg.pubblicato || '');
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) { FONTE = '☁️ Supabase' + (cfg.pubblicato ? ' (' + cfg.pubblicato + ')' : ''); return r.arrayBuffer(); }
    }
  } catch (e) { /* offline o bucket non raggiungibile → fallback locale */ }

  // 4) Fallback: file locale accanto alla pagina.
  const r2 = await fetch('vn_web.db');
  if (!r2.ok) throw new Error('vn_web.db non trovato: esegui prima l\'export (tile "Esporta per il web" o --export-vn-web)');
  return r2.arrayBuffer();
}

/* Carica il DB (demo o società) e popola le viste. Richiamabile a ogni cambio
   di fonte: login, scelta società, logout — senza ri-bindare i tab. */
async function caricaDati() {
  const view = document.getElementById('view');
  view.innerHTML = '<div class="caricamento"><div class="palla">🏐</div>' +
    '<p>Carico i dati VolleyNetwork…</p></div>';
  try {
    if (!SQL) SQL = await initSqlJs({ locateFile: f => 'lib/' + f });
    const buf = await caricaDbBytes();
    db = new SQL.Database(new Uint8Array(buf));

    EFF = {}; POS = {}; META = {}; catStagList = [];   // azzerati a ogni ricarico
    q("SELECT Fondamentale f, COALESCE(EffettiVincenti,'') v, COALESCE(EffettiPerdenti,'') p, COALESCE(Formula,'') fo FROM TBEfficienza")
      .forEach(r => EFF[r.f] = { v: r.v, p: r.p, formula: r.fo });
    q("SELECT Fondamentale f, COALESCE(EffettiPositivi,'') p, COALESCE(Formula,'') fo FROM TBPositivita")
      .forEach(r => POS[r.f] = { p: r.p, formula: r.fo });
    q('SELECT Chiave k, Valore v FROM WEB_Meta').forEach(r => META[r.k] = r.v);
    catStagList = q('SELECT DISTINCT Categoria c, Stagione s FROM VN_Stat ORDER BY Categoria, Stagione');

    const nAtl = q('SELECT COUNT(*) n FROM VN_Atleti')[0].n;
    document.getElementById('metaInfo').textContent =
      `${nAtl.toLocaleString('it-IT')} atleti · ${catStagList.length} campionati` +
      (META.vn_data_version ? ` · dati VN v${META.vn_data_version}` : '') +
      (META.generato_il ? ` · aggiornati al ${META.generato_il}` : '') +
      ` · fonte: ${FONTE}`;
    mostraTab('classifiche');
  } catch (e) {
    view.innerHTML =
      `<div class="nota">⚠️ ${esc(e.message)}<br>Apri la pagina con <b>Avvia-Prototipo.cmd</b> (serve un piccolo server locale: il browser non legge i file direttamente).</div>`;
  }
}

/* ════════════════════════════════════════════════════════════════════
   ACCESSO SOCIETÀ — Supabase Auth (codice OTP via email) + membership
   La demo pubblica vnproto resta accessibile senza login; chi accede vede
   invece i dati della propria società dal bucket privato vn (RLS, 0005).
   ════════════════════════════════════════════════════════════════════ */
function initAuth() {
  if (window.supabase && SB_ANON) {
    try { sb = window.supabase.createClient(SB_URL, SB_ANON); }
    catch (e) { sb = null; }
  }
}

async function caricaMieSocieta() {
  mieSocieta = [];
  if (!sb) return;
  try {
    const { data, error } = await sb
      .from('membership')
      .select('societa_id, ruolo, societa(nome)')
      .eq('stato', 'attiva');           // RLS limita già a utente_id = auth.uid()
    if (error) throw error;
    mieSocieta = (data || []).map(r => ({
      id: r.societa_id,
      nome: (r.societa && r.societa.nome) || r.societa_id,
      ruolo: r.ruolo
    })).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  } catch (e) { mieSocieta = []; }
}

function aggiornaUserbar() {
  const bar = document.getElementById('userbar');
  if (!bar) return;
  if (!sb) { bar.innerHTML = ''; return; }   // libreria non caricata → solo demo
  if (!sessione) {
    bar.innerHTML = '<button class="btn-auth" id="btnAccedi">🔐 Accedi (società)</button>';
    document.getElementById('btnAccedi').onclick = apriLogin;
    return;
  }
  const email = (sessione.user && sessione.user.email) || '';
  let h = `<span class="ub-user" title="${esc(email)}">👤 ${esc(email)}</span>`;
  if (mieSocieta.length > 1) {
    h += `<select class="ub-soc" id="ubSoc" title="Cambia società">` +
      mieSocieta.map(s => `<option value="${esc(s.id)}" ${socAttiva && s.id === socAttiva.id ? 'selected' : ''}>${esc(s.nome)}</option>`).join('') +
      `</select>`;
  } else if (socAttiva) {
    h += `<span class="ub-soc-fissa">🔒 ${esc(socAttiva.nome)}</span>`;
  } else {
    h += '<span class="ub-soc-fissa ub-warn" title="Il tuo utente non è collegato ad alcuna società">⚠ nessuna società</span>';
  }
  h += '<button class="btn-auth" id="btnEsci">Esci</button>';
  bar.innerHTML = h;
  const sel = document.getElementById('ubSoc');
  if (sel) sel.onchange = e => selezionaSocieta(e.target.value);
  document.getElementById('btnEsci').onclick = esci;
}

async function selezionaSocieta(id) {
  socAttiva = mieSocieta.find(s => s.id === id) || null;
  aggiornaUserbar();
  await caricaDati();
}

async function esci() {
  try { if (sb) await sb.auth.signOut(); } catch (e) { /* ignora */ }
  sessione = null; socAttiva = null; mieSocieta = [];
  aggiornaUserbar();
  await caricaDati();      // torna alla demo pubblica
}

/* ── Overlay login a due passi: email → codice OTP ─────────────────── */
function apriLogin() {
  const ov = document.getElementById('authOverlay');
  if (!ov) return;
  ov.hidden = false;
  ov.innerHTML =
    '<div class="auth-card">' +
      '<button class="auth-x" id="authX" title="Chiudi">✕</button>' +
      '<h2>🔐 Accesso società</h2>' +
      '<p class="auth-sub">Riservato agli utenti abilitati dalla propria società. ' +
      'Inserisci l\'email: riceverai un <b>link per entrare</b> (apri l\'email e clicca «Accedi»).</p>' +
      '<div id="authBody"></div>' +
      '<div class="auth-msg" id="authMsg"></div>' +
    '</div>';
  document.getElementById('authX').onclick = chiudiLogin;
  ov.onclick = e => { if (e.target === ov) chiudiLogin(); };
  stepEmail();
}
function chiudiLogin() {
  const ov = document.getElementById('authOverlay');
  if (ov) { ov.hidden = true; ov.innerHTML = ''; }
}
function authMsg(t, err) {
  const m = document.getElementById('authMsg');
  if (m) { m.textContent = t || ''; m.className = 'auth-msg' + (err ? ' err' : ''); }
}
function stepEmail() {
  document.getElementById('authBody').innerHTML =
    '<label class="auth-l">Email' +
    '<input type="email" id="authEmail" placeholder="nome@societa.it" autocomplete="email"></label>' +
    '<button class="btn-auth primario" id="authSend">Invia link di accesso</button>';
  const inp = document.getElementById('authEmail');
  const send = document.getElementById('authSend');
  inp.onkeydown = e => { if (e.key === 'Enter') send.click(); };
  send.onclick = async () => {
    const email = inp.value.trim().toLowerCase();
    if (!email || email.indexOf('@') < 1) { authMsg('Inserisci un indirizzo email valido.', true); return; }
    send.disabled = true; authMsg('Invio del link in corso…');
    try { await inviaMagicLink(email); stepInviato(email); }
    catch (e) { authMsg(traduciAuthErr(e), true); send.disabled = false; }
  };
  inp.focus();
}
function stepInviato(email) {
  document.getElementById('authBody').innerHTML =
    `<p class="auth-sub">Ho inviato un'email a <b>${esc(email)}</b>.<br>Apri il messaggio e clicca <b>«Accedi»</b>: tornerai qui già autenticato (controlla anche lo spam; può metterci un minuto).</p>` +
    '<button class="btn-auth primario" id="authOk">Ho capito</button>' +
    '<button class="btn-auth link" id="authBack">← usa un\'altra email</button>';
  document.getElementById('authOk').onclick = chiudiLogin;
  document.getElementById('authBack').onclick = stepEmail;
}
async function inviaMagicLink(email) {
  // Magic link: l'utente clicca il link nell'email e RIENTRA su questa pagina
  // già autenticato — supabase-js cattura la sessione dal fragment URL e scatta
  // onAuthStateChange. shouldCreateUser:false → solo utenti abilitati dal gestore.
  // emailRedirectTo = questa stessa pagina (va aggiunta agli URL di redirect Auth).
  const redirect = location.origin + location.pathname;
  const { error } = await sb.auth.signInWithOtp({
    email, options: { shouldCreateUser: false, emailRedirectTo: redirect }
  });
  if (error) throw error;
}
function traduciAuthErr(e) {
  const s = ((e && e.message) || String(e)).toLowerCase();
  if (s.indexOf('not allowed') >= 0 || s.indexOf('signups') >= 0)
    return 'Email non abilitata. Chiedi al gestore di registrare il tuo indirizzo.';
  if (s.indexOf('expired') >= 0) return 'Codice scaduto: richiedi un nuovo codice.';
  if (s.indexOf('invalid') >= 0 || s.indexOf('token') >= 0)
    return 'Codice errato o scaduto. Riprova, oppure richiedi un nuovo codice.';
  if (s.indexOf('rate') >= 0 || s.indexOf('too many') >= 0)
    return 'Troppi tentativi: attendi qualche minuto e riprova.';
  return 'Errore di accesso: ' + ((e && e.message) || e);
}

window.addEventListener('DOMContentLoaded', async () => {
  // tab: bind una sola volta (i dati vengono ricaricati senza ri-bindare)
  document.querySelectorAll('#tabs button').forEach(b =>
    b.addEventListener('click', () => mostraTab(b.dataset.tab)));

  initAuth();
  if (sb) {
    try {
      const { data } = await sb.auth.getSession();
      sessione = (data && data.session) || null;
      if (sessione) {
        await caricaMieSocieta();
        if (mieSocieta.length) socAttiva = mieSocieta[0];
      }
      sb.auth.onAuthStateChange(async (evt, s) => {
        sessione = s;
        if (!s) { socAttiva = null; mieSocieta = []; aggiornaUserbar(); return; }
        // ritorno dal magic link: se non ho ancora una società attiva, carico
        // le membership e mostro i dati della società senza bisogno di ricaricare.
        if (evt === 'SIGNED_IN' && !socAttiva) {
          await caricaMieSocieta();
          if (mieSocieta.length) socAttiva = mieSocieta[0];
          aggiornaUserbar();
          await caricaDati();
          if (!mieSocieta.length)
            setTimeout(() => alert('Accesso eseguito, ma il tuo utente non è collegato a nessuna società. Contatta il gestore.'), 50);
          return;
        }
        aggiornaUserbar();
      });
    } catch (e) { /* auth non disponibile → solo demo */ }
  }
  aggiornaUserbar();
  await caricaDati();
});

/* ── Helper DB / formato ───────────────────────────────────────────── */
function q(sql, params = []) {
  const st = db.prepare(sql); st.bind(params);
  const rows = []; while (st.step()) rows.push(st.getAsObject());
  st.free(); return rows;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function titleCase(s) { return String(s || '').toLowerCase().replace(/(^|[\s'-])\S/g, m => m.toUpperCase()); }
function fmtN(v) { return Number(v || 0).toLocaleString('it-IT'); }
function fmt1(v) { return isNaN(v) ? '—' : (Math.round(v * 10) / 10).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function labelRuolo(r) { return LABEL_RUOLO[String(r || '').trim().toUpperCase()] || String(r || '').trim(); }

/* Conteggi {qualità → n} da una riga aggregata P/Po/Ne/Ng/Sl/Er (come ConteggiQualita) */
function conteggi(r) { return { '#': r.P || 0, '+': r.Po || 0, '!': r.Ne || 0, '-': r.Ng || 0, '/': r.Sl || 0, '=': r.Er || 0 }; }

/* *E% dinamica: (Σ vincenti − Σ perdenti)/Tot ·100 — NaN se Tot=0 (CalcolaEfficienza) */
function effPerc(f, c, tot) {
  if (!tot) return NaN;
  const cfg = EFF[f] || { v: '', p: '' };
  let sv = 0, sp = 0;
  for (const ch of cfg.v) sv += c[ch] || 0;
  for (const ch of cfg.p) sp += c[ch] || 0;
  return 100 * (sv - sp) / tot;
}
/* Pos% dinamica: (Σ positivi)/Tot ·100 (CalcolaPositivita) */
function posPerc(f, c, tot) {
  if (!tot) return NaN;
  let s = 0; for (const ch of (POS[f] || { p: '' }).p) s += c[ch] || 0;
  return 100 * s / tot;
}

/* Soglie colore identiche a ScriviPerc del PDF */
function classeEff(v) { if (isNaN(v)) return 'na'; if (v >= 30) return 'ok'; if (v <= 0) return 'ko'; if (v < 15) return 'mid'; return ''; }
function classePos(v) { if (isNaN(v)) return 'na'; if (v >= 50) return 'ok'; if (v <= 30) return 'ko'; return 'mid'; }
function classeErr(v) { if (isNaN(v)) return 'na'; if (v <= 10) return 'ok'; if (v >= 25) return 'ko'; return ''; }
function cellaEff(v) { return `<td class="${classeEff(v)}">${fmt1(v)}</td>`; }
function cellaPos(v) { return `<td class="${classePos(v)}">${fmt1(v)}</td>`; }
function cellaErr(v) { return `<td class="${classeErr(v)}">${fmt1(v)}</td>`; }

/* ── SVG: coni d'attacco (porta fedele di ModVNDisegno) ────────────── */
function coloreEff(eff) {
  if (eff >= 35) return 'rgb(34,197,94)';
  if (eff >= 20) return 'rgb(132,204,22)';
  if (eff >= 8) return 'rgb(234,179,8)';
  if (eff >= 0) return 'rgb(249,115,22)';
  return 'rgb(239,68,68)';
}
const COL_ZONA = { '4': 0, '7': 0, '5': 0, '3': 1, '8': 1, '6': 1, '2': 2, '9': 2, '1': 2 };
const ROW_ZONA = { '4': 0, '3': 0, '2': 0, '7': 1, '8': 1, '9': 1, '5': 2, '6': 2, '1': 2 };
const colZona = z => COL_ZONA[z] ?? 1;
const rowZona = z => ROW_ZONA[z] ?? 1;

/* coni = [{zp,za,tot,uso,eff}] · soglia = % minima per disegnare una direzione */
function svgConi(coni, soglia) {
  if (!coni || !coni.length) return '<div class="vuoto">Nessun cono d\'attacco disponibile.</div>';
  let totGen = 0;
  const perZp = {}, totZp = {};
  coni.forEach(c => {
    totGen += c.tot;
    (perZp[c.zp] = perZp[c.zp] || []).push(c);
    totZp[c.zp] = (totZp[c.zp] || 0) + c.tot;
  });
  // zone di partenza significative: volume ≥ max(3, 5% del totale), max 4, per volume ↓
  let zps = Object.keys(totZp).filter(z => totZp[z] >= Math.max(3, totGen * 0.05));
  zps.sort((a, b) => totZp[b] - totZp[a]);
  zps = zps.slice(0, 4);
  if (!zps.length) return '<div class="vuoto">Volumi troppo bassi per disegnare i coni.</div>';

  const cw = 150, ch = 200, gap = 8;
  const W = zps.length * cw + (zps.length - 1) * gap;
  let s = `<svg viewBox="0 0 ${W} ${ch}" class="coni" role="img">`;
  zps.forEach((zp, i) => { s += miniCampo(i * (cw + gap), 0, cw, ch, zp, perZp[zp], totZp[zp], soglia); });
  return s + '</svg>';
}

function miniCampo(left, top, w, h, zp, direzioni, totZp, soglia) {
  const rete = top + h / 2, passo = (h / 2) / 3, colW = w / 3;
  const px = left + (colZona(zp) + 0.5) * colW;
  const py = rete + (rowZona(zp) + 0.5) * passo;
  const cp = 'cp' + (++clipSeq);
  let s = `<clipPath id="${cp}"><rect x="${left}" y="${top}" width="${w}" height="${h}"/></clipPath>`;
  s += `<rect x="${left}" y="${top}" width="${w}" height="${h}" fill="rgb(20,120,90)" stroke="rgba(255,255,255,.67)" stroke-width="2"/>`;
  s += `<line x1="${left}" y1="${rete}" x2="${left + w}" y2="${rete}" stroke="#fff" stroke-width="2"/>`;
  s += `<line x1="${left}" y1="${rete - passo}" x2="${left + w}" y2="${rete - passo}" stroke="rgba(255,255,255,.43)"/>`;
  s += `<line x1="${left}" y1="${rete + passo}" x2="${left + w}" y2="${rete + passo}" stroke="rgba(255,255,255,.43)"/>`;
  s += `<g clip-path="url(#${cp})">`;
  for (const c of direzioni) {
    const perc = totZp > 0 ? 100 * c.tot / totZp : 0;     // uso% RELATIVO alla zona
    if (perc < soglia) continue;
    const ax = left + (colZona(c.za) + 0.5) * colW;
    const ay = rete - (rowZona(c.za) + 0.5) * passo;
    const dx = ax - px, dy = ay - py, len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const nx = -(dy / len), ny = dx / len;
    const baseHalf = (perc / 100) * (w * 0.7) / 2;        // larghezza cono ∝ uso%
    const col = coloreEff(c.eff);
    s += `<polygon points="${px},${py} ${ax + nx * baseHalf},${ay + ny * baseHalf} ${ax - nx * baseHalf},${ay - ny * baseHalf}"` +
      ` fill="${col}" fill-opacity=".59" stroke="${col}" stroke-opacity=".86"/>`;
    s += `<text x="${ax - 10}" y="${ay - 4}" class="et1">${Math.round(perc)}%</text>`;
    s += `<text x="${ax - 10}" y="${ay + 9}" class="et2">${Math.round(c.eff)}%</text>`;
  }
  s += '</g>';
  s += `<circle cx="${px}" cy="${py}" r="4" fill="#fff"/>`;
  s += `<text x="${left + 4}" y="${top + h - 6}" class="etZona">da zona ${esc(zp)}</text>`;
  return s;
}

/* ── SVG: radar fondamentali Pos% (porta di DisegnaRadarFondamentali) ─ */
function svgRadar(perFond) {   // perFond: f → {pos, tot}
  const W = 380, H = 300, cx = W / 2, cy = H / 2 + 6;
  const r = Math.min(W, H) / 2 - 54;
  const assi = FOND_CLASSIFICA;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="radar" role="img">`;
  [0.25, 0.5, 0.75, 1].forEach(f =>
    s += `<circle cx="${cx}" cy="${cy}" r="${r * f}" fill="none" stroke="#d2d2d2"/>`);
  const pts = [];
  assi.forEach((f, i) => {
    const ang = -Math.PI / 2 + 2 * Math.PI * i / assi.length;
    const ax = cx + r * Math.cos(ang), ay = cy + r * Math.sin(ang);
    s += `<line x1="${cx}" y1="${cy}" x2="${ax}" y2="${ay}" stroke="#d2d2d2"/>`;
    const d = perFond[f] || { pos: NaN, tot: 0 };
    const val = isNaN(d.pos) ? 0 : Math.max(0, Math.min(100, d.pos));
    const rr = r * val / 100;
    pts.push(`${cx + rr * Math.cos(ang)},${cy + rr * Math.sin(ang)}`);
    const lx = cx + (r + 26) * Math.cos(ang), ly = cy + (r + 26) * Math.sin(ang);
    s += `<text x="${lx}" y="${ly}" text-anchor="middle" class="radLab">${LABEL_FOND[f]}${d.tot > 0 ? ' ' + Math.round(val) + '%' : ''}</text>`;
  });
  s += `<polygon points="${pts.join(' ')}" fill="rgba(96,165,250,.27)" stroke="#60a5fa" stroke-width="2"/>`;
  return s + '</svg>';
}

/* ── Navigazione tab ───────────────────────────────────────────────── */
function mostraTab(tab) {
  document.querySelectorAll('#tabs button').forEach(b =>
    b.classList.toggle('attiva', b.dataset.tab === tab));
  const v = document.getElementById('view');
  if (tab === 'classifiche') vistaClassifiche(v);
  else if (tab === 'squadre') vistaSquadre(v);
  else if (tab === 'atleti') vistaAtleti(v);
  else vistaFormule(v);
}
function opzioniCatStag(sel) {
  return catStagList.map(r => {
    const v = `${r.c}||${r.s}`;
    return `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(r.c)} · ${esc(r.s)}</option>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════════════
   CLASSIFICHE — porta di frmVNClassifiche (indice bayesiano)
   ════════════════════════════════════════════════════════════════════ */
const stClas = { catStag: null, fond: 'A', ruolo: '', min: 10, sortCol: 'Indice', sortDesc: true };

function vistaClassifiche(v) {
  if (!catStagList.length) { v.innerHTML = '<div class="vuoto">Nessun dato VolleyNetwork nel repository.</div>'; return; }
  if (!stClas.catStag) stClas.catStag = `${catStagList[0].c}||${catStagList[0].s}`;
  v.innerHTML = `
    <div class="filtri">
      <label>Campionato · Stagione
        <select id="clCat">${opzioniCatStag(stClas.catStag)}</select></label>
      <label>Classifica per (miglior…)
        <select id="clFond">${FOND_CLASSIFICA.map(f =>
          `<option value="${f}" ${f === stClas.fond ? 'selected' : ''}>${LABEL_FOND[f]}</option>`).join('')}</select></label>
      <label>Ruolo <select id="clRuolo"></select></label>
      <label>Min. azioni <input type="number" id="clMin" min="0" value="${stClas.min}"></label>
    </div>
    <div id="clTab"></div>
    <p class="sottotitolo">Indice = *E% corretto bayesiano: (n·*E% + M·media lega) / (n + M) — con poche azioni il valore
    è riportato verso la media del campionato. Clic su una riga per aprire il profilo dell'atleta.</p>`;
  ['clCat', 'clFond', 'clRuolo', 'clMin'].forEach(id =>
    document.getElementById(id).addEventListener('change', () => {
      stClas.catStag = document.getElementById('clCat').value;
      stClas.fond = document.getElementById('clFond').value;
      stClas.ruolo = document.getElementById('clRuolo').value;
      stClas.min = parseInt(document.getElementById('clMin').value) || 0;
      renderClassifica();
    }));
  renderClassifica(true);
}

function calcolaClassifica(cat, stag) {
  // 1) statistiche per atleta+fondamentale (stessa query del desktop)
  const stat = q(`SELECT IDAtleta id, Fondamentale F, SUM(Perfetti) P, SUM(Positivi) Po, SUM(Neutri) Ne,
                         SUM(Negativi) Ng, SUM(Slash) Sl, SUM(Errori) Er, SUM(Tot) T
                  FROM VN_Stat WHERE Categoria = ? AND Stagione = ? GROUP BY IDAtleta, Fondamentale`, [cat, stag]);
  // 2) anagrafica + 3) tesseramenti (ruolo della stagione, squadre multiple unite con " / ")
  const anag = {};
  q("SELECT IDAtleta id, COALESCE(Cognome,'') c, COALESCE(Nome,'') n, COALESCE(RuoloPrevalente,'') r FROM VN_Atleti")
    .forEach(r => anag[r.id] = r);
  const ruoli = {}, squadre = {};
  q("SELECT IDAtleta id, COALESCE(Ruolo,'') r, COALESCE(NomeSquadra,'') s FROM VN_Tesseramenti WHERE Categoria=? AND Stagione=? ORDER BY NomeSquadra", [cat, stag])
    .forEach(t => {
      if (!t.id) return;
      if (!(t.id in ruoli) || (!ruoli[t.id] && t.r.trim())) ruoli[t.id] = t.r.trim();
      const sq = t.s.trim();
      if (sq) {
        squadre[t.id] = squadre[t.id] || [];
        if (!squadre[t.id].includes(sq)) squadre[t.id].push(sq);
      }
    });
  // 4) pivot per atleta + parametri bayesiani per fondamentale (ParametriBayes)
  const atleti = {}, pooled = {}, volumi = {};
  stat.forEach(r => {
    if (!r.id || !r.F) return;
    const t = r.T || 0, c = conteggi(r);
    const a = atleti[r.id] = atleti[r.id] || { eff: {}, tot: {} };
    a.eff[r.F] = effPerc(r.F, c, t);
    a.tot[r.F] = t;
    if (t > 0) {
      const p = pooled[r.F] = pooled[r.F] || { '#': 0, '+': 0, '!': 0, '-': 0, '/': 0, '=': 0, T: 0 };
      QUALITA.forEach(qq => p[qq] += c[qq]);
      p.T += t;
      (volumi[r.F] = volumi[r.F] || []).push(t);
    }
  });
  const bayes = {};
  FOND_CLASSIFICA.forEach(f => {
    if (!pooled[f]) { bayes[f] = { media: NaN, M: 1 }; return; }
    bayes[f] = { media: effPerc(f, pooled[f], pooled[f].T), M: Math.max(1, mediana(volumi[f])) };
  });
  // 5) righe finali (esclusi atleti senza ruolo o senza nome, come il desktop)
  const righe = [];
  for (const [id, a] of Object.entries(atleti)) {
    const an = anag[id] || { c: '', n: '', r: '' };
    const ruolo = (ruoli[id] || an.r || '').trim();
    const nome = `${an.c} ${an.n}`.trim();
    if (!ruolo || !nome) continue;
    righe.push({
      id, ruolo, nome: titleCase(nome),
      squadre: (squadre[id] || []).join(' / '),
      eff: a.eff, tot: a.tot
    });
  }
  return { righe, bayes };
}
function mediana(vals) {
  if (!vals || !vals.length) return 0;
  const v = [...vals].sort((a, b) => a - b), n = v.length;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}
function bayesIndex(eff, n, b) {
  if (!n || isNaN(eff)) return NaN;
  if (!b || isNaN(b.media) || (n + b.M) <= 0) return eff;
  return (n * eff + b.M * b.media) / (n + b.M);
}

function renderClassifica(aggiornaRuoli = false) {
  const [cat, stag] = stClas.catStag.split('||');
  const { righe, bayes } = calcolaClassifica(cat, stag);
  const selRuolo = document.getElementById('clRuolo');
  if (aggiornaRuoli || selRuolo.options.length === 0) {
    const ruoliPresenti = [...new Set(righe.map(r => r.ruolo.toUpperCase()))].sort();
    selRuolo.innerHTML =
      `<option value="">Tutti i ruoli</option>` +
      ruoliPresenti.map(r => `<option value="${esc(r)}" ${r === stClas.ruolo ? 'selected' : ''}>${esc(labelRuolo(r))}</option>`).join('');
  }
  const f = stClas.fond;
  let rows = righe
    .map(r => ({ ...r, indice: bayesIndex(r.eff[f], r.tot[f] || 0, bayes[f]) }))
    .filter(r => (r.tot[f] || 0) >= stClas.min)
    .filter(r => !stClas.ruolo || r.ruolo.toUpperCase() === stClas.ruolo);
  const sc = stClas.sortCol, segno = stClas.sortDesc ? -1 : 1;
  rows.sort((a, b) => {
    let va, vb;
    if (sc === 'Indice') { va = a.indice; vb = b.indice; }
    else if (sc === 'Giocatore') { va = a.nome; vb = b.nome; }
    else if (sc === 'Ruolo') { va = a.ruolo; vb = b.ruolo; }
    else if (sc === 'Squadre') { va = a.squadre; vb = b.squadre; }
    else if (sc.startsWith('E')) { va = a.eff[sc[1]]; vb = b.eff[sc[1]]; }
    else { va = a.tot[sc[1]] || 0; vb = b.tot[sc[1]] || 0; }
    if (typeof va === 'string') return segno * va.localeCompare(vb, 'it');
    va = (va === undefined || isNaN(va)) ? -Infinity : va;
    vb = (vb === undefined || isNaN(vb)) ? -Infinity : vb;
    return segno * (va - vb);
  });
  const th = (key, label, cls = '') =>
    `<th class="sortable ${cls}" data-col="${key}">${label}${sc === key ? (stClas.sortDesc ? ' ▼' : ' ▲') : ''}</th>`;
  let h = `<div class="tbl-wrap"><table><thead><tr>
      ${th('Ruolo', 'Ruolo', 'txt')}${th('Giocatore', 'Giocatore', 'txt')}${th('Squadre', 'Squadre', 'txt')}
      ${th('Indice', `Indice (${LABEL_FOND[f]})`)}`;
  FOND_CLASSIFICA.forEach(ff => { h += th('E' + ff, `*E% ${ff}`) + th('T' + ff, `N. ${ff}`); });
  h += '</tr></thead><tbody>';
  rows.forEach(r => {
    h += `<tr class="cliccabile" data-id="${esc(r.id)}">
      <td class="txt">${esc(labelRuolo(r.ruolo))}</td>
      <td class="txt"><b>${esc(r.nome)}</b></td>
      <td class="txt ell" title="${esc(r.squadre)}">${esc(r.squadre)}</td>
      <td><b>${fmt1(r.indice)}</b></td>`;
    FOND_CLASSIFICA.forEach(ff => {
      h += cellaEff(r.eff[ff]) + `<td>${r.tot[ff] ? fmtN(r.tot[ff]) : '<span class="na">—</span>'}</td>`;
    });
    h += '</tr>';
  });
  h += `</tbody></table></div>
    <p class="sottotitolo">${rows.length} atleti — ${esc(cat)} · ${esc(stag)} — media lega ${LABEL_FOND[f]}:
    ${fmt1(bayes[f]?.media)}% · peso prior M = ${fmt1(bayes[f]?.M)}</p>`;
  const cont = document.getElementById('clTab');
  cont.innerHTML = h;
  cont.querySelectorAll('th.sortable').forEach(thEl => thEl.addEventListener('click', () => {
    const c = thEl.dataset.col;
    if (stClas.sortCol === c) stClas.sortDesc = !stClas.sortDesc;
    else { stClas.sortCol = c; stClas.sortDesc = true; }
    renderClassifica();
  }));
  cont.querySelectorAll('tr.cliccabile').forEach(tr =>
    tr.addEventListener('click', () => apriProfilo(tr.dataset.id)));
}

/* ════════════════════════════════════════════════════════════════════
   SCHEDA SQUADRA — "tutto il PDF in pagine web"
   (fogli: Scheda · Fondamentali · Coni d'attacco · Formule→tab dedicata)
   ════════════════════════════════════════════════════════════════════ */
const stSq = { catStag: null, squadra: '', soglia: 10 };

function vistaSquadre(v) {
  if (!catStagList.length) { v.innerHTML = '<div class="vuoto">Nessun dato VolleyNetwork nel repository.</div>'; return; }
  if (!stSq.catStag) stSq.catStag = `${catStagList[0].c}||${catStagList[0].s}`;
  v.innerHTML = `
    <div class="filtri">
      <label>Campionato · Stagione <select id="sqCat">${opzioniCatStag(stSq.catStag)}</select></label>
      <label>Squadra <select id="sqSq"></select></label>
      <label>Coni ≥ % <input type="number" id="sqSoglia" min="0" max="100" value="${stSq.soglia}"></label>
    </div>
    <div id="sqOut"></div>`;
  const caricaSquadre = () => {
    const [cat, stag] = stSq.catStag.split('||');
    const sq = q("SELECT DISTINCT IDSquadra id, COALESCE(NomeSquadra,'') n FROM VN_Tesseramenti WHERE Categoria=? AND Stagione=? ORDER BY NomeSquadra", [cat, stag]);
    document.getElementById('sqSq').innerHTML =
      sq.map(r => `<option value="${esc(r.id)}" ${r.id === stSq.squadra ? 'selected' : ''}>${esc(titleCase(r.n))}</option>`).join('');
    stSq.squadra = document.getElementById('sqSq').value || '';
  };
  document.getElementById('sqCat').addEventListener('change', () => {
    stSq.catStag = document.getElementById('sqCat').value; stSq.squadra = '';
    caricaSquadre(); renderScheda();
  });
  document.getElementById('sqSq').addEventListener('change', () => { stSq.squadra = document.getElementById('sqSq').value; renderScheda(); });
  document.getElementById('sqSoglia').addEventListener('change', () => { stSq.soglia = parseInt(document.getElementById('sqSoglia').value) || 0; renderScheda(); });
  caricaSquadre(); renderScheda();
}

function renderScheda() {
  const out = document.getElementById('sqOut');
  if (!stSq.squadra) { out.innerHTML = '<div class="vuoto">Nessuna squadra in questo campionato.</div>'; return; }
  const [cat, stag] = stSq.catStag.split('||');
  const idSq = stSq.squadra;
  const rNome = q("SELECT COALESCE(NomeSquadra,'') n FROM VN_Tesseramenti WHERE IDSquadra=? AND Categoria=? AND Stagione=? LIMIT 1", [idSq, cat, stag]);
  const nomeSq = titleCase((rNome[0] || { n: idSq }).n) || idSq;

  // distinta + conteggi grezzi per atleta·fondamentale (ConteggiSquadra)
  const distinta = q(`SELECT t.IDAtleta id, COALESCE(a.Cognome,'')||' '||COALESCE(a.Nome,'') nome,
                             COALESCE(t.Ruolo,'') ruolo, t.Numero num
                      FROM VN_Tesseramenti t LEFT JOIN VN_Atleti a ON a.IDAtleta=t.IDAtleta
                      WHERE t.Categoria=? AND t.Stagione=? AND t.IDSquadra=? ORDER BY t.Numero`, [cat, stag, idSq]);
  const contSq = q(`SELECT IDAtleta id, Fondamentale F, SUM(Perfetti) P, SUM(Positivi) Po, SUM(Neutri) Ne,
                           SUM(Negativi) Ng, SUM(Slash) Sl, SUM(Errori) Er, SUM(Tot) T
                    FROM VN_Stat WHERE Categoria=? AND Stagione=? AND IDSquadra=? GROUP BY IDAtleta, Fondamentale`, [cat, stag, idSq]);
  const gioc = {};
  distinta.forEach(d => gioc[d.id] = { ...d, nome: titleCase(d.nome.trim()) || d.id, fond: {} });
  const totali = {};   // fondamentale → conteggi pooled squadra
  contSq.forEach(r => {
    if (!gioc[r.id]) gioc[r.id] = { id: r.id, nome: r.id, ruolo: '', num: 0, fond: {} };
    gioc[r.id].fond[r.F] = r;
    const t = totali[r.F] = totali[r.F] || { P: 0, Po: 0, Ne: 0, Ng: 0, Sl: 0, Er: 0, T: 0 };
    ['P', 'Po', 'Ne', 'Ng', 'Sl', 'Er', 'T'].forEach(k => t[k] += r[k] || 0);
  });
  const giocatori = Object.values(gioc).sort((a, b) => ((a.num || 999) - (b.num || 999)) || a.nome.localeCompare(b.nome, 'it'));
  const conAzioni = giocatori.filter(g => Object.values(g.fond).some(r => (r.T || 0) > 0));

  /* ── Foglio SCHEDA: intestazione + totali squadra + dettaglio giocatori ── */
  let h = `
    <div class="banner">SCHEDA SQUADRA <small>(il foglio "Scheda" del PDF)</small></div>
    <div class="sezione"><div class="interno">
      <div class="titolone">${esc(nomeSq)}</div>
      <div class="sottotitolo">${esc(cat)} · Stagione ${esc(stag)} · dati VolleyNetwork${META.generato_il ? ' aggiornati al ' + esc(META.generato_il) : ''}</div>
      <h3>📊 Totali squadra</h3>
      <div class="tbl-wrap"><table><thead><tr>
        <th class="txt">Fondamentale</th><th>Tot</th><th>#</th><th>*E%</th><th>Pos%</th><th>Err%</th>
      </tr></thead><tbody>`;
  ORDINE_SCHEDA.forEach(f => {
    const t = totali[f] || { P: 0, Po: 0, Ne: 0, Ng: 0, Sl: 0, Er: 0, T: 0 };
    const c = conteggi(t);
    const errp = t.T > 0 ? 100 * ((t.Er || 0) + (t.Sl || 0)) / t.T : NaN;   // Err% del PDF: (= + /)/Tot
    h += `<tr><td class="txt"><b>${LABEL_FOND_SCHEDA[f]}</b></td>
      <td>${t.T ? fmtN(t.T) : '<span class="na">—</span>'}</td><td>${t.T ? fmtN(t.P) : '<span class="na">—</span>'}</td>
      ${cellaEff(effPerc(f, c, t.T))}${cellaPos(posPerc(f, c, t.T))}${cellaErr(errp)}</tr>`;
  });
  h += `</tbody></table></div>
      <h3>👥 Giocatori</h3>
      <div class="tbl-wrap"><table><thead><tr>
        <th class="txt">Giocatore</th><th>S Tot</th><th>S *E%</th><th>R Tot</th><th>R Pos%</th><th>A Tot</th><th>A *E%</th><th>M #</th>
      </tr></thead><tbody>`;
  conAzioni.forEach(g => {
    const S = g.fond.S, R = g.fond.R, A = g.fond.A, B = g.fond.B;
    h += `<tr class="cliccabile" data-id="${esc(g.id)}">
      <td class="txt"><b>${g.num ? g.num + ' · ' : ''}${esc(g.nome)}</b> <span class="na">${esc(labelRuolo(g.ruolo))}</span></td>
      <td>${S?.T ? fmtN(S.T) : '<span class="na">—</span>'}</td>${cellaEff(S ? effPerc('S', conteggi(S), S.T) : NaN)}
      <td>${R?.T ? fmtN(R.T) : '<span class="na">—</span>'}</td>${cellaPos(R ? posPerc('R', conteggi(R), R.T) : NaN)}
      <td>${A?.T ? fmtN(A.T) : '<span class="na">—</span>'}</td>${cellaEff(A ? effPerc('A', conteggi(A), A.T) : NaN)}
      <td>${B?.P ? fmtN(B.P) : '<span class="na">—</span>'}</td></tr>`;
  });
  h += '</tbody></table></div></div></div>';

  /* ── Foglio FONDAMENTALI: una sezione per fondamentale, 15 colonne ── */
  h += `<div class="banner">FONDAMENTALI <small>(le tabelle oggi solo stampate — qui in pagine web)</small></div>
        <div class="sezione">`;
  ORDINE_SCHEDA.forEach(f => {
    const tSq = totali[f];
    if (!tSq || !tSq.T) return;
    h += `<div class="interno"><h3>🏐 ${LABEL_FOND_SCHEDA[f].toUpperCase()}</h3>
      <div class="tbl-wrap"><table><thead><tr><th class="txt">Giocatore</th><th>*E%</th><th>Tot</th>`;
    QUALITA.forEach(qq => h += `<th>${qq}</th><th>% ${qq}</th>`);
    h += '</tr></thead><tbody>';
    const riga = (label, r, totaleRiga = false, idClick = '') => {
      const c = conteggi(r), t = r.T || 0;
      let s = `<tr class="${totaleRiga ? 'totale' : 'cliccabile'}" ${idClick ? `data-id="${esc(idClick)}"` : ''}>
        <td class="txt">${label}</td>${cellaEff(effPerc(f, c, t))}<td>${t ? fmtN(t) : '—'}</td>`;
      QUALITA.forEach(qq => {
        const n = c[qq] || 0;
        s += `<td>${t ? fmtN(n) : '—'}</td><td>${t ? fmt1(100 * n / t) : '—'}</td>`;
      });
      return s + '</tr>';
    };
    h += riga('▣ TOTALE SQUADRA', tSq, true);
    conAzioni.forEach(g => {
      const r = g.fond[f];
      if (r && (r.T || 0) > 0) h += riga(`<b>${g.num ? g.num + ' · ' : ''}${esc(g.nome)}</b>`, r, false, g.id);
    });
    h += '</tbody></table></div></div>';
  });
  h += '</div>';

  /* ── Foglio CONI D'ATTACCO: una card per attaccante (≥10 attacchi) ── */
  const attaccanti = [];
  conAzioni.forEach(g => {
    const zone = q(`SELECT ZonaPartenza zp, ZonaArrivo za, SUM(Punti) P, SUM(Errori) E, SUM(Murati) M, SUM(Tot) T
                    FROM VN_Zone WHERE IDAtleta=? AND Categoria=? AND Stagione=? AND Fondamentale='A'
                      AND ZonaPartenza GLOB '[1-9]' AND ZonaArrivo GLOB '[1-9]'
                    GROUP BY ZonaPartenza, ZonaArrivo`, [g.id, cat, stag]);
    const tot = zone.reduce((s, z) => s + (z.T || 0), 0);
    if (tot >= MIN_ATTACCHI_CONI) {
      const coni = zone.map(z => ({
        zp: String(z.zp), za: String(z.za), tot: z.T || 0,
        uso: tot > 0 ? 100 * z.T / tot : 0,
        eff: z.T > 0 ? 100 * ((z.P || 0) - (z.E || 0) - (z.M || 0)) / z.T : 0
      }));
      attaccanti.push({ g, coni, tot });
    }
  });
  attaccanti.sort((a, b) => b.tot - a.tot);
  h += `<div class="banner">CONI D'ATTACCO <small>larghezza ∝ uso% della zona · colore ∝ efficienza · soglia ${stSq.soglia}%</small></div>
        <div class="sezione"><div class="cards">`;
  if (!attaccanti.length) h += '<div class="vuoto">Nessun giocatore con almeno 10 attacchi a zona.</div>';
  attaccanti.forEach(({ g, coni, tot }) => {
    h += `<div class="card"><h4>${g.num ? g.num + ' · ' : ''}${esc(g.nome)}</h4>
      <div class="ruolino">${esc(labelRuolo(g.ruolo))} — attacchi a zona: ${fmtN(tot)}</div>
      ${svgConi(coni, stSq.soglia)}</div>`;
  });
  h += `</div></div>
    <p class="sottotitolo">Come nel PDF, per i dati VolleyNetwork non sono disponibili: attaccanti per fase,
    coni di ricezione e rotazioni (i dati VN sono aggregati per stagione). Le formule *E%/Pos% sono nella tab "Formule &amp; legenda".</p>`;

  out.innerHTML = h;
  out.querySelectorAll('tr.cliccabile[data-id]').forEach(tr =>
    tr.addEventListener('click', () => apriProfilo(tr.dataset.id)));
}

/* ════════════════════════════════════════════════════════════════════
   ATLETI — ricerca globale (frmVNProfilo) + profilo con radar e coni
   ════════════════════════════════════════════════════════════════════ */
const stAtl = { testo: '', profilo: null, contesto: 'TUTTO', soglia: 10 };

function vistaAtleti(v) {
  v.innerHTML = `
    <div class="filtri">
      <label>Cerca atleta (nome, cognome o codice — min 2 lettere)
        <input type="search" id="atCerca" value="${esc(stAtl.testo)}" placeholder="es. Rossi"></label>
    </div>
    <div id="atOut"></div>`;
  const inp = document.getElementById('atCerca');
  inp.addEventListener('input', () => { stAtl.testo = inp.value; stAtl.profilo = null; renderRicerca(); });
  if (stAtl.profilo) renderProfilo(); else renderRicerca();
}

function renderRicerca() {
  const out = document.getElementById('atOut');
  const t = stAtl.testo.trim();
  if (t.length < 2) { out.innerHTML = '<div class="vuoto">Scrivi almeno 2 lettere per cercare nel repository (oppure arriva qui da Classifiche/Scheda squadra cliccando un giocatore).</div>'; return; }
  const k = `%${t}%`;
  const ris = q(`SELECT IDAtleta id, TRIM(COALESCE(Cognome,'')||' '||COALESCE(Nome,'')) nome, COALESCE(RuoloPrevalente,'') ruolo
                 FROM VN_Atleti
                 WHERE IDAtleta LIKE ? OR Cognome LIKE ? OR Nome LIKE ? OR (COALESCE(Cognome,'')||' '||COALESCE(Nome,'')) LIKE ?
                 ORDER BY Cognome, Nome LIMIT 300`, [k, k, k, k]);
  if (!ris.length) { out.innerHTML = '<div class="vuoto">Nessun atleta trovato.</div>'; return; }
  out.innerHTML = `<p class="sottotitolo">${ris.length} risultati${ris.length === 300 ? ' (massimo raggiunto: raffina la ricerca)' : ''}</p>
    <ul class="risultati">` + ris.map(r =>
      `<li data-id="${esc(r.id)}"><span><b>${esc(titleCase(r.nome))}</b> ${r.ruolo ? '· ' + esc(labelRuolo(r.ruolo)) : ''}</span><span class="cod">${esc(r.id)}</span></li>`
    ).join('') + '</ul>';
  out.querySelectorAll('li').forEach(li => li.addEventListener('click', () => apriProfilo(li.dataset.id)));
}

function apriProfilo(id) {
  stAtl.profilo = id; stAtl.contesto = 'TUTTO';
  mostraTab('atleti');
}

function renderProfilo() {
  const out = document.getElementById('atOut');
  const id = stAtl.profilo;
  const rAn = q("SELECT COALESCE(Cognome,'') c, COALESCE(Nome,'') n, COALESCE(RuoloPrevalente,'') r FROM VN_Atleti WHERE IDAtleta=?", [id]);
  const an = rAn[0] || { c: '', n: '', r: '' };
  const contesti = q('SELECT DISTINCT Categoria c, Stagione s FROM VN_Stat WHERE IDAtleta=? ORDER BY Stagione DESC, Categoria', [id]);
  const tess = q("SELECT Stagione s, Categoria c, COALESCE(NomeSquadra,'') sq, Numero num, COALESCE(Ruolo,'') r FROM VN_Tesseramenti WHERE IDAtleta=? ORDER BY Stagione DESC, Categoria", [id]);

  // statistiche del contesto scelto (storico aggregato o categoria·stagione)
  let where = 'IDAtleta = ?', params = [id];
  if (stAtl.contesto !== 'TUTTO') {
    const [c, s] = stAtl.contesto.split('||');
    where += ' AND Categoria = ? AND Stagione = ?'; params = [id, c, s];
  }
  const stat = q(`SELECT Fondamentale F, SUM(Perfetti) P, SUM(Positivi) Po, SUM(Neutri) Ne, SUM(Negativi) Ng,
                         SUM(Slash) Sl, SUM(Errori) Er, SUM(Tot) T FROM VN_Stat WHERE ${where} GROUP BY Fondamentale`, params);
  const perFond = {};
  stat.forEach(r => {
    const c = conteggi(r), t = r.T || 0;
    perFond[r.F] = { c, pos: posPerc(r.F, c, t), eff: effPerc(r.F, c, t), err: t > 0 ? 100 * (r.Er || 0) / t : NaN, tot: t };
  });
  // coni del contesto (ConiAttacco / ConiAttaccoTotali)
  const zone = q(`SELECT ZonaPartenza zp, ZonaArrivo za, SUM(Punti) P, SUM(Errori) E, SUM(Murati) M, SUM(Tot) T
                  FROM VN_Zone WHERE IDAtleta = ?${stAtl.contesto !== 'TUTTO' ? ' AND Categoria=? AND Stagione=?' : ''}
                    AND Fondamentale='A' AND ZonaPartenza GLOB '[1-9]' AND ZonaArrivo GLOB '[1-9]'
                  GROUP BY ZonaPartenza, ZonaArrivo`,
    stAtl.contesto !== 'TUTTO' ? [id, ...stAtl.contesto.split('||')] : [id]);
  const totZone = zone.reduce((s, z) => s + (z.T || 0), 0);
  const coni = zone.map(z => ({
    zp: String(z.zp), za: String(z.za), tot: z.T || 0,
    uso: totZone > 0 ? 100 * z.T / totZone : 0,
    eff: z.T > 0 ? 100 * ((z.P || 0) - (z.E || 0) - (z.M || 0)) / z.T : 0
  })).sort((a, b) => b.tot - a.tot);

  const h = `
    <p><a href="#" id="atIndietro">← torna alla ricerca</a></p>
    <div class="titolone">${esc(titleCase(`${an.c} ${an.n}`.trim()) || id)}</div>
    <div class="sottotitolo">${an.r ? esc(labelRuolo(an.r)) + ' · ' : ''}codice ${esc(id)}</div>
    <div class="filtri">
      <label>Contesto
        <select id="atCtx">
          <option value="TUTTO" ${stAtl.contesto === 'TUTTO' ? 'selected' : ''}>Tutto lo storico</option>
          ${contesti.map(r => { const vv = `${r.c}||${r.s}`; return `<option value="${esc(vv)}" ${vv === stAtl.contesto ? 'selected' : ''}>${esc(r.c)} · ${esc(r.s)}</option>`; }).join('')}
        </select></label>
      <label>Coni ≥ % <input type="number" id="atSoglia" min="0" max="100" value="${stAtl.soglia}"></label>
    </div>
    <div class="profilo-top">
      <div>
        <div class="banner">RADAR FONDAMENTALI <small>positività %</small></div>
        <div class="sezione"><div class="interno">${svgRadar(perFond)}</div></div>
        <div class="banner">STATISTICHE</div>
        <div class="sezione"><div class="tbl-wrap"><table>
          <thead><tr><th class="txt">Fondamentale</th><th>Tot</th><th>*E%</th><th>Pos%</th><th>Err%</th></tr></thead><tbody>
          ${ORDINE_SCHEDA.filter(f => perFond[f]).map(f => {
            const d = perFond[f];
            return `<tr><td class="txt"><b>${LABEL_FOND[f]}</b></td><td>${fmtN(d.tot)}</td>
              ${cellaEff(d.eff)}${cellaPos(d.pos)}${cellaErr(d.err)}</tr>`;
          }).join('') || '<tr><td colspan="5" class="vuoto">Nessuna statistica nel contesto scelto.</td></tr>'}
        </tbody></table></div></div>
        <div class="banner">DETTAGLIO VALUTAZIONI <small># + ! − / =</small></div>
        <div class="sezione"><div class="tbl-wrap"><table>
          <thead><tr><th class="txt">Fond.</th>${QUALITA.map(qq => `<th>${qq}</th>`).join('')}<th>Tot</th></tr></thead><tbody>
          ${ORDINE_SCHEDA.filter(f => perFond[f]).map(f => {
            const d = perFond[f];
            return `<tr><td class="txt"><b>${LABEL_FOND[f]}</b></td>${QUALITA.map(qq => `<td>${fmtN(d.c[qq])}</td>`).join('')}<td><b>${fmtN(d.tot)}</b></td></tr>`;
          }).join('')}
        </tbody></table></div></div>
      </div>
      <div>
        <div class="banner">CONI D'ATTACCO <small>${stAtl.contesto === 'TUTTO' ? 'tutto lo storico' : 'contesto selezionato'}${totZone ? ' · ' + fmtN(totZone) + ' attacchi a zona' : ''}</small></div>
        <div class="sezione"><div class="interno">${svgConi(coni, stAtl.soglia)}</div></div>
        <div class="banner">CARRIERA <small>tesseramenti VolleyNetwork</small></div>
        <div class="sezione"><div class="tbl-wrap"><table>
          <thead><tr><th class="txt">Stagione</th><th class="txt">Campionato</th><th class="txt">Squadra</th><th>N°</th><th class="txt">Ruolo</th></tr></thead><tbody>
          ${tess.map(t => `<tr><td class="txt">${esc(t.s)}</td><td class="txt">${esc(t.c)}</td><td class="txt">${esc(titleCase(t.sq))}</td>
            <td>${t.num || '—'}</td><td class="txt">${esc(labelRuolo(t.r))}</td></tr>`).join('')
          || '<tr><td colspan="5" class="vuoto">Nessun tesseramento registrato.</td></tr>'}
        </tbody></table></div></div>
      </div>
    </div>`;
  out.innerHTML = h;
  document.getElementById('atIndietro').addEventListener('click', e => { e.preventDefault(); stAtl.profilo = null; renderRicerca(); });
  document.getElementById('atCtx').addEventListener('change', () => { stAtl.contesto = document.getElementById('atCtx').value; renderProfilo(); });
  document.getElementById('atSoglia').addEventListener('change', () => { stAtl.soglia = parseInt(document.getElementById('atSoglia').value) || 0; renderProfilo(); });
}

/* ════════════════════════════════════════════════════════════════════
   FORMULE & LEGENDA — il foglio "Formule" del PDF + legenda qualità
   ════════════════════════════════════════════════════════════════════ */
function vistaFormule(v) {
  v.innerHTML = `
    <div class="banner">QUALITÀ DELLE VALUTAZIONI</div>
    <div class="sezione"><div class="tbl-wrap"><table>
      <thead><tr><th class="txt">Simbolo</th><th class="txt">Significato</th></tr></thead><tbody>
      ${QUALITA.map(qq => `<tr><td class="txt"><b>${qq}</b></td><td class="txt">${LABEL_QUALITA[qq]}</td></tr>`).join('')}
    </tbody></table></div></div>

    <div class="banner">EFFICIENZA *E% <small>*E% = (Σ effetti vincenti − Σ effetti perdenti) / totale azioni</small></div>
    <div class="sezione"><div class="tbl-wrap"><table>
      <thead><tr><th class="txt">Fondamentale</th><th class="txt">Vincenti</th><th class="txt">Perdenti</th><th class="txt">Formula *E%</th></tr></thead><tbody>
      ${ORDINE_SCHEDA.map(f => {
        const e = EFF[f] || { v: '', p: '', formula: '' };
        return `<tr><td class="txt"><b>${LABEL_FOND_SCHEDA[f]}</b> (${f})</td>
          <td class="txt">${esc([...e.v].join('  '))}</td><td class="txt">${esc([...e.p].join('  ')) || '—'}</td>
          <td class="txt">${esc(e.formula)}</td></tr>`;
      }).join('')}
    </tbody></table></div></div>

    <div class="banner">POSITIVITÀ Pos% <small>Pos% = (Σ effetti positivi) / totale azioni</small></div>
    <div class="sezione"><div class="tbl-wrap"><table>
      <thead><tr><th class="txt">Fondamentale</th><th class="txt">Positivi</th><th class="txt">Formula Pos%</th></tr></thead><tbody>
      ${ORDINE_SCHEDA.map(f => {
        const p = POS[f] || { p: '', formula: '' };
        return `<tr><td class="txt"><b>${LABEL_FOND_SCHEDA[f]}</b> (${f})</td>
          <td class="txt">${esc([...p.p].join('  '))}</td><td class="txt">${esc(p.formula)}</td></tr>`;
      }).join('')}
    </tbody></table></div></div>

    <div class="banner">INDICE BAYESIANO DELLE CLASSIFICHE</div>
    <div class="sezione"><div class="interno">
      <p><b>Indice = (n · *E%<sub>atleta</sub> + M · *E%<sub>media lega</sub>) / (n + M)</b></p>
      <p>dove <b>n</b> = azioni del giocatore nel fondamentale, <b>M</b> = mediana delle azioni-per-atleta del
      campionato (peso del prior), <b>*E%<sub>media lega</sub></b> = efficienza calcolata su tutte le azioni del
      fondamentale nel campionato. Con poche azioni l'indice è riportato verso la media (niente outlier da
      campioni piccoli); con molte azioni prevale il valore reale del giocatore.</p>
    </div></div>

    <div class="banner">SOGLIE COLORE</div>
    <div class="sezione"><div class="interno">
      <p>*E%: <span class="ok">≥ 30 buono</span> · <span class="mid">&lt; 15 medio</span> · <span class="ko">≤ 0 critico</span>
      &nbsp;—&nbsp; Pos%: <span class="ok">≥ 50</span> · <span class="mid">30–50</span> · <span class="ko">≤ 30</span>
      &nbsp;—&nbsp; Err%: <span class="ok">≤ 10</span> · <span class="ko">≥ 25</span></p>
      <p>Coni d'attacco — colore per efficienza della direzione:
      <span style="color:rgb(34,197,94)">■ ≥ 35%</span>
      <span style="color:rgb(132,204,22)">■ ≥ 20%</span>
      <span style="color:rgb(234,179,8)">■ ≥ 8%</span>
      <span style="color:rgb(249,115,22)">■ ≥ 0%</span>
      <span style="color:rgb(239,68,68)">■ &lt; 0%</span> — larghezza del cono ∝ uso% della zona di partenza.</p>
    </div></div>

    <div class="nota">ℹ️ <b>Limiti dei dati VolleyNetwork</b> (aggregati per stagione): non sono disponibili le analisi per
    fase di gioco, i coni di ricezione e le rotazioni — per quelle serve lo scout completo nel programma desktop.
    ${META.tabelle ? '<br>Contenuto export: ' + esc(META.tabelle) : ''}</div>`;
}
