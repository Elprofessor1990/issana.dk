/* ISSANA 3D (3.0): 3D-arbejdsrummets layout.

   Venstre bjælke med logo og værktøjerne Mindmap, Egenskaber, Søg, Lag, Klip, Måle og Indstillinger (plus
   arbejdsrummets Data, Ændringer, Graf, Sol og Produkter fra 2.12), faner øverst (3D Inspektion, Bygningsdele,
   Statik, Varmetabsberegning, Lyd, LCA), status «Udkast · version n» og «Gem i Revit (n)», midterpanel og
   højrepaneler VED SIDEN AF 3D, bundlinjen (visningsvælger, tal, forklaring, hjælp) og AI-feltet UNDER 3D.
   3D dækkes aldrig: intet i layoutet ligger position:absolute oven på canvas.

   Ét panel ad gangen (arbejdsrum-paneler.js ejer tilstanden): bjælkens knapper og fanerne øverst er én radio-gruppe.
   Vælger man ét, lukkes alle andre (midterpanel, 2.12-skuffen, Egenskaber/typer/parametre og docks). Klik på det
   aktive lukker det. Ved opstart er intet åbent (kun 3D + AI-feltet); intet huskes i localStorage.

   Registrerings-API for de andre spor (Statik, AI, Lyd), dokumenteret i docs/issana-mcp/3D-ARBEJDSRUM-API.md:
     window.issanaArbejdsrum.registrerFane({id, titel, bred, monter(container, api), vis(container, api)})
     window.issanaArbejdsrum.registrerPanel({id, titel, ikon, monter(container, api)})
     window.issanaArbejdsrum.api  (valgte, vaelg, isoler, farvelaeg, model, aendringsliste.tilfoej, lydSted, paa, three …)
   Registreringer før start køes; spor, der indlæses før os, kan også lægge en funktion i window.issanaArbejdsrumVentende.
   Alle indekser i api'et er elementindekser (api.elementer()); api.indeks(revitId) og api.elementId(idx) oversætter.

   Intet her skriver i Revit. Ændringer går gennem arbejdsrum.js' ændringsliste («Gem i Revit» viser først
   forhåndsvisningen), og listen får kun poster ved en knap (Brug som forslag, Forhåndsvis ændring, Godkend/Bekræft, Læg i
   ændringslisten). Bygger på window.IssanaVisning (Revit-modelviewer.html), window.IssanaArbejdsrum (arbejdsrum.js),
   IssanaArbejdsrumMindmap, IssanaArbejdsrumVisning og IssanaArbejdsrumPaneler. Indlæses sidst. */
(function () {
  "use strict";
  var V = null, A = null, Mm = window.IssanaArbejdsrumMindmap, Vn = window.IssanaArbejdsrumVisning, Pn = window.IssanaArbejdsrumPaneler, visning = null;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c]; }); }
  function el(tag, attrs, html) { var e = document.createElement(tag); if (attrs) Object.keys(attrs).forEach(function (k) { if (k === "class") e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }); if (html != null) e.innerHTML = html; return e; }
  function lagr(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  /* ---------- Ikoner (streg, som skitsen) ---------- */
  var IK = {
    mindmap: "M14.5 12a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0zM3 5h3v3H3zM18 5h3v3h-3zM3 16h3v3H3zM18 16h3v3h-3zM10 10.5L6 7.5M14 10.5L18 7.5M10 13.5L6 16.5M14 13.5L18 16.5",
    egenskaber: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
    soeg: "M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4-4",
    lag: "M12 4l8 4l-8 4l-8-4zM4 12l8 4l8-4M4 16l8 4l8-4",
    klip: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
    maale: "M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2",
    indst: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
    data: "M4 5h16v14H4zM4 10h16M9 10v9",
    aendringer: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
    graf: "M5 5a2 2 0 1 0 0 4a2 2 0 0 0 0-4zM19 5a2 2 0 1 0 0 4a2 2 0 0 0 0-4zM12 15a2 2 0 1 0 0 4a2 2 0 0 0 0-4zM7 8l4 7M17 8l-4 7",
    sol: "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
    produkter: "M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10",
    opbygning: "M4 4h4v16H4zM10 4h4v13h-4zM16 4h4v10h-4z"
  };
  function ikon(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; }

  /* ---------- Tilstand ---------- */
  var paneler = {}, panelOrden = [], faner = {}, docks = {}, lyttere = {};
  var reg = null, aktivtPanel = null, vistDock = null, anvender = false;   // reg: arbejdsrum-paneler.js' register; aktivtPanel: det ene åbne panel (eller null)
  var tidlige = [];               // registrerFane/registrerPanel kaldt før start (sporene indlæses før os): køes og tages i start
  var mmTilstand = {gruppering: "etage", aabne: {}, filter: null, soegTekst: ""};
  var lagSkjul = {};              // konstruktiv funktion -> true = skjult
  var opbyg = {liste: [], i: 0, resultat: null};
  var eksternFarve = null;        // api.farvelaeg
  var isoleretFraMindmap = false; // mindmappet har isoleret et rum eller en etage («Vis alle» ophæver)
  var startFejl = [];             // byggetrin, der fejlede i start() (også window.issanaArbejdsrum.startFejl); tom = alt kom op
  function udsend(navn) { var a = Array.prototype.slice.call(arguments, 1); (lyttere[navn] || []).forEach(function (fn) { try { fn.apply(null, a); } catch (e) { console.error("ISSANA 3D-arbejdsrum (" + navn + "):", e); } }); }

  /* ---------- Hjælpere til modellen ---------- */
  function infos() { return (A && A.infos) || []; }
  function tagSetMedAendringer(info) {
    // Tags som de står i Revit plus det, der ligger i ændringslisten (godkendt, ikke gemt): tallene skifter, så snart du godkender.
    var set = {};
    if (!info) return set;
    var tilf = function (s) { A.splitTags(s).forEach(function (t) { set[A.tagNorm(t)] = 1; }); };
    try { tilf(A.nu(A.maal(info, "element"), A.P.tags)); if (info.type && info.type.uniqueId) tilf(A.nu(A.maal(info, "type"), A.P.typeTags)); } catch (e) { (info.tags || []).forEach(function (t) { set[A.tagNorm(t.tag)] = 1; }); }
    return set;
  }
  var KONSTRUKTIV_PARAM = "ISSANA Konstruktiv funktion";   // Statik-sporets parameter (konstruktiv-vaerdier.json); 1.3-eksporten har den som element.konstruktiv
  function konstruktiv(idx) {
    var inf = infos()[idx]; if (!inf) return "Ikke angivet";
    // Som tags: en værdi i ændringslisten (godkendt, ikke gemt) tæller med det samme i Lag, farver og Opbygning.
    var ed = inf.ed, raw = (ed.bygdata && ed.bygdata.raw && ed.bygdata.raw[KONSTRUKTIV_PARAM]) || "", nu = raw;
    try { nu = A.nu(A.maal(inf, "element"), KONSTRUKTIV_PARAM); } catch (e) { nu = raw; }
    if (nu !== raw) ed = Object.assign({}, ed, {konstruktiv: nu});   // også en rydning («Ikke angivet») i listen slår igennem
    return Vn.konstruktivAf(ed, tagSetMedAendringer(inf));
  }
  function konstruktivTal() { return Vn.konstruktivTal(infos().map(function (inf, i) { return inf ? {kategori: inf.ed.category, funktion: konstruktiv(i)} : {kategori: "", funktion: ""}; })); }
  function mmPunkter() { return Mm.fraElementer(V.elementer().map(function (r) { return r.data; }), V.typer()); }
  function valgteSet() { return new Set(V.valgte()); }
  function vaelg(ids, tilfoej) {
    var liste = tilfoej ? V.valgte().concat(ids.filter(function (i) { return V.valgte().indexOf(i) < 0; })) : ids.slice();
    V.vaelgFlere(liste);   // visningen sender krogen 'valg' → vedValg
  }

  /* ---------- Opbygning af DOM ---------- */
  function bygRail() {
    var ws = $("workspace"), app = $("app");
    var rail = el("nav", {id: "v3rail", "aria-label": "Arbejdsrum"});
    rail.innerHTML = '<div class="v3-logo" title="ISSANA"><span><img src="issana-logo.svg" alt="ISSANA"></span></div>';
    ws.insertBefore(rail, app);
    return rail;
  }
  function railKnap(id, titel, d, onclick, hint) {
    var b = el("button", {type: "button", class: "v3-rknap", id: "v3r-" + id, title: hint || titel}, ikon(d) + "<span>" + esc(titel) + "</span>");
    b.onclick = onclick; return b;
  }
  function bygMid() {
    var app = $("app"), mid = el("aside", {id: "v3mid", "aria-label": "Panel"});
    app.insertBefore(mid, $("types"));
    return mid;
  }
  // Bundlinjen under canvas: visningsvælger, tal («205 elementer», «4 valgt»), måleresultat, hjælpelinje og farveforklaringen
  // (sammenklappet til én linje med «Mere»). Alt, der før lå position:absolute oven på 3D, flyttes herned.
  function bygBund() {
    var app = $("app"), bund = el("div", {id: "v3bund", "aria-label": "Under 3D"});
    app.insertBefore(bund, $("types"));
    var v = el("div", {id: "v3visning", "aria-label": "Visning"});
    v.addEventListener("keydown", function (e) { e.stopPropagation(); });
    bund.appendChild(v);
    ["stats", "selInfo"].forEach(function (id) { var e = $(id); if (e) bund.appendChild(e); });
    // Markering og filter (ejer, 2026-11-14): markér flere, vis kun eller skjul det markerede, og hent alt frem igen.
    var valg = el("div", {id: "v3valg", "aria-label": "Markering og filter"});
    valg.addEventListener("keydown", function (e) { e.stopPropagation(); });
    bund.appendChild(valg);
    var maal = $("measureOut"); if (maal) bund.appendChild(maal);
    var hint = document.querySelector("#view .gizmo-hint"); if (hint) bund.appendChild(hint);
    var ramme = el("div", {id: "v3legendRamme"}), legend = $("legend");
    var mere = el("button", {type: "button", class: "tbtn v3-legend-mere", title: "Vis hele forklaringen"}, "Mere");
    if (legend) ramme.appendChild(legend);
    ramme.appendChild(mere);
    bund.appendChild(ramme);
    mere.onclick = function () { var ud = ramme.classList.toggle("ud"); mere.textContent = ud ? "Mindre" : "Mere"; };
    if (legend && window.MutationObserver) {
      var synk = function () {
        ramme.classList.toggle("vis", legend.style.display !== "none" && legend.innerHTML !== "");
        ramme.classList.toggle("pris", !!legend.querySelector(".sigma-pris-legender"));
      };
      new MutationObserver(synk).observe(legend, {attributes: true, attributeFilter: ["style"], childList: true});
      synk();
    }
    return bund;
  }
  function bygAi() {
    var app = $("app"), ai = el("div", {id: "v3ai"});
    ai.innerHTML = '<div class="v3-ai-titel">ISSANA AI <small>Svar og oversigter vises i AI-panelet ved siden af 3D.</small><button class="tbtn" id="v3aiVisSvar">Vis AI-svar</button></div>';
    app.insertBefore(ai, $("resbar"));
    var felt = $("arbAi"), svar = $("arbAiSvar");
    if (felt) ai.appendChild(felt);
    // skjult: ingen knap i bjælken (den ville stå over Mindmap); panelet åbnes med «Vis AI-svar» og når der kommer et svar.
    registrerPanel({id:"ai-svar",titel:"AI-svar og data",ikon:IK.data,bred:true,skjult:true,monter:function(c){
      c.classList.add("v3-ai-side");
      if(svar)c.appendChild(svar);
    }});
    A.aiSvarVis=function(){aabnPanel("ai-svar");};
    A.aiSvarLuk=function(){if(aktivtPanel==="ai-svar")lukPanel();};
    $("v3aiVisSvar").onclick=A.aiSvarVis;
    return ai;
  }
  function flytSkuffe() {
    var arb = $("arb"); if (arb) $("v3mid").appendChild(arb);
  }
  function bygStatus() {
    var tb = $("tabbar"), sp = tb.querySelector(".tabsp");
    var st = el("div", {id: "v3status"});
    st.innerHTML = '<span id="v3version">Udkast · version 1</span><button class="tbtn primary" id="v3gem" title="Forhåndsvis ændringerne, og gem dem i Revit i én transaktion">Gem i Revit</button>';
    tb.insertBefore(st, sp ? sp.nextSibling : null);
    $("v3gem").onclick = function () { A.aabenSkuffe("aendringer"); };
    opdaterStatus(A.antalAendringer());
  }
  function versionNoegle() { var d = V.data(); return "issana-3d-version-v1|" + ((d && (d.modelKey || d.model)) || "model"); }
  function version() { var n = parseInt(lagr(versionNoegle()) || "0", 10); return (isFinite(n) ? n : 0) + 1; }
  function opdaterStatus(n) {
    var v = $("v3version"), g = $("v3gem"); if (!v) return;
    v.innerHTML = "Udkast · <b>version " + version() + "</b>" + (n ? " · " + n + " ændring" + (n === 1 ? "" : "er") + " ikke gemt" : "");
    g.textContent = "Gem i Revit (" + (n || 0) + ")"; g.classList.toggle("vis", n > 0);
    var rk = $("v3r-" + Pn.SKUFFE + "aendringer"); if (rk) { var t = rk.querySelector(".v3-rtal"); if (n) { if (!t) { t = el("span", {class: "v3-rtal"}); rk.appendChild(t); } t.textContent = n; } else if (t) t.remove(); }
    udsend("aendringer", n || 0);
  }
  function vedGemt(antal) { lagr(versionNoegle(), String(version())); opdaterStatus(0); renderLag(); renderMindmap(); udsend("gemt", antal); }

  /* ---------- Ét panel ad gangen ---------- */
  // Radio-gruppen: knap i bjælken (eller Indstillinger → Paneler). Samme panel igen lukker.
  function vaelgPanel(id) { aktivtPanel = Pn.vaelg(aktivtPanel, id, reg); anvend(); }
  function aabnPanel(id) { if (!reg[id]) return; aktivtPanel = id; anvend(); }
  function lukPanel() { aktivtPanel = null; anvend(); }
  function setBtn(id, on) { var b = $(id); if (b) b.classList.toggle("on", !!on); }
  // Sæt DOM'en efter tilstanden: præcis ét af midterpanel / skuffe / højre kolonne / dock er synligt, eller intet.
  function anvend() {
    if (anvender) return;   // skiftFane/aabenSkuffe melder tilbage gennem krogene; tilstanden er allerede sat
    anvender = true;
    try {
      var t = Pn.tilstand(aktivtPanel, reg), app = $("app");
      aktivtPanel = t.aktiv;
      // Midterpaneler
      Object.keys(paneler).forEach(function (k) { paneler[k].rod.classList.toggle("vis", k === t.midt); });
      // 2.12-skuffen er ét panel pr. fane i samme mekanisme
      if (t.skuffeFane) { if (!A.skuffeAaben() || A.aktivFane() !== t.skuffeFane) A.aabenSkuffe(t.skuffeFane); }
      else if (A.skuffeAaben()) A.lukSkuffe();
      app.classList.toggle("no-mid", !t.midt && !t.skuffeFane);
      app.classList.toggle("mid-bred", !!t.midtBred || !!(t.skuffeFane && A.faner().some(function (f) { return f.id === t.skuffeFane && f.bred; })));
      // Html'ens højre kolonner (Egenskaber, Bygningsdelstyper, Bygningsdelsparametre)
      app.classList.toggle("no-props", !t.props); setBtn("btnProps", t.props);
      app.classList.toggle("no-types", !t.types); setBtn("btnTypes", t.types);
      app.classList.toggle("no-params", !t.params); setBtn("btnParams", t.params);
      // Fanen øverst og docks til højre
      if (V.aktivFane() !== t.fane) V.skiftFane(t.fane);
      Object.keys(docks).forEach(function (k) { docks[k].classList.toggle("hidden", k !== t.dock); });
      if (vistDock && vistDock !== t.dock) { var g = faner[vistDock]; if (g && g.handle && typeof g.handle.luk === "function") { try { g.handle.luk(); } catch (e) { console.error(e); } } }
      vistDock = t.dock;
      if (t.dock) monterFane(t.dock);
      if (t.midt) monterPanel(t.midt);
      opdaterModelgrundlag();
      markRail(t.aktiv);
      V.render && V.render(); vinduesstoerrelse();
      udsend("panel", t.aktiv);
    } finally { anvender = false; }
  }
  function monterPanel(id) {
    var p = paneler[id]; if (!p) return;
    if (!p.monteret) { p.monteret = true; try { p.monter && p.monter(p.krop, API); } catch (e) { p.krop.innerHTML = '<div class="v3-tom">Fejl: ' + esc(e.message) + "</div>"; console.error(e); } }
    if (p.vis) { try { p.vis(p.krop, API); } catch (e) { console.error(e); } }
  }
  function monterFane(navn) {
    var f = faner[navn];
    if (!f) {
      if (navn !== "lyd" && navn !== "statik") return;
      // Pladsholder, til sporet registrerer sig (arbejdsrum-lyd.js / arbejdsrum-statik.js). Registreres fanen senere,
      // genbruges docken, og pladsholderen erstattes (samme id, aldrig to faner med samme navn).
      registrerFane({id: navn, titel: navn === "lyd" ? "Lyd" : "Statik", monter: function (c) {
        c.innerHTML = navn === "lyd"
          ? '<div class="v3-tom">Lyd-sporet (arbejdsrum-lyd.js) er ikke indlæst. Det monterer sig her med <code>window.issanaArbejdsrum.registrerFane({id:"lyd", …})</code>.</div>'
          : '<div class="v3-tom">Statik-sporet (arbejdsrum-statik.js) er ikke indlæst. Det monterer sig her med <code>window.issanaArbejdsrum.registrerFane({id:"statik", …})</code>.<br><br>Indtil da: brug Lag (konstruktiv funktion) og Data (tags).</div>';
      }});
      if (faner[navn]) monterFane(navn);
      return;
    }
    if (!f.monteret) { f.monteret = true; f.krop.innerHTML = ""; try { f.handle = f.monter ? f.monter(f.krop, API) : null; } catch (e) { f.krop.innerHTML = '<div class="v3-tom">Fejl: ' + esc(e.message) + "</div>"; console.error(e); } }
    if (f.vis) { try { f.vis(f.krop, API); } catch (e) { console.error(e); } }
  }
  function markRail(id) {
    document.querySelectorAll("#v3rail .v3-rknap").forEach(function (b) { if (b.dataset.fast) return; b.classList.toggle("on", !!id && b.id === "v3r-" + id); });
  }
  function vinduesstoerrelse() { try { window.dispatchEvent(new Event("resize")); } catch (e) {} }
  // Skuffen (arbejdsrum.js) melder åben/lukket, også når den selv åbner Ændringer efter «Læg i ændringslisten».
  function vedSkuffe(aaben, fane) { aktivtPanel = Pn.vedSkuffe(aktivtPanel, aaben, fane); anvend(); }
  function skuffeKnap(fane, titel, d, hint) { return railKnap(Pn.SKUFFE + fane, titel, d, function () { vaelgPanel(Pn.SKUFFE + fane); }, hint); }
  // Fane-skift fra html'en (knapperne øverst, Fuldskærm, api.skiftFane): dock = ét panel i samme radio-gruppe.
  function vedFane(navn) { aktivtPanel = Pn.vedFane(aktivtPanel, navn, reg); anvend(); udsend("fane", navn); }
  // Udeladte elementer påvirker alle fag. Beskeden ligger uden for fagets egen krop,
  // så ny beregning/genoptegning ikke fjerner den. Ingen ekstra knap eller dialog.
  function opdaterModelgrundlag() {
    var m = V && V.data(), afkortet = m && m.truncated === true;
    document.querySelectorAll('#workspace .dock').forEach(function (d) {
      var besked = d.querySelector('[data-modelgrundlag]');
      if (!afkortet) { if (besked) besked.remove(); return; }
      if (!besked) {
        besked = el('div', {class: 'v3-modelgrundlag', 'data-modelgrundlag': '', role: 'status'});
        var krop = d.querySelector('.v3-pbody') || d.querySelector('.page-scroll');
        d.insertBefore(besked, krop && krop.parentNode === d ? krop : d.firstChild);
      }
      var antal = typeof m.skipped === 'number' && isFinite(m.skipped) && m.skipped > 0 && Math.floor(m.skipped) === m.skipped
        ? m.skipped.toLocaleString('da-DK') + ' elementer er udeladt.' : 'Elementer er udeladt.';
      besked.innerHTML = '<strong>Ufuldstændig eksport</strong><p>' + antal + ' Beregninger og mængder bygger kun på de indlæste dele, ikke hele modellen.</p><p>' +
        (m.detailLevel === 'coarse' ? 'Afgræns modellen, og hent den igen.' : 'Prøv detaljegraden Grov eller et mindre udsnit, og hent modellen igen.') + '</p>';
    });
  }
  // Html'ens egne docks (Bygningsdele, Varmetabsberegning, LCA) får samme tydelige X som de registrerede.
  function dockLukKnapper() {
    ["fysik", "varmetab", "lca"].forEach(function (id) {
      var d = $("page-" + id); if (!d || d.querySelector(".v3-dock-luk")) return;
      var bar = el("div", {class: "v3-dock-luk"}, '<button type="button" class="v3-luk" title="Luk panelet (tilbage til 3D Inspektion)">×</button>');
      bar.querySelector("button").onclick = lukPanel;
      d.insertBefore(bar, d.firstChild);
    });
  }

  /* ---------- Paneler i midten ---------- */
  function registrerPanel(def) {
    if (!def || !def.id) return;
    if (!V) { tidlige.push(["panel", def]); return; }
    if (paneler[def.id]) { paneler[def.id] = Object.assign(paneler[def.id], def); reg = Pn.registrer(reg, def.id, {slags: "midt", bred: !!paneler[def.id].bred}); return; }
    var p = {id: def.id, titel: def.titel || def.id, ikon: def.ikon || IK.mindmap, monter: def.monter, vis: def.vis, skjult: !!def.skjult, bred: !!def.bred, monteret: false, hint: def.hint, undertitel: def.undertitel};
    paneler[p.id] = p; panelOrden.push(p.id);
    reg = Pn.registrer(reg, p.id, {slags: "midt", bred: p.bred});
    p.rod = el("section", {class: "v3-panel", id: "v3p-" + p.id, "aria-label": p.titel});
    p.rod.innerHTML = '<div class="v3-phead"><h2>' + esc(p.titel) + "</h2>" + (p.undertitel ? '<span class="s">' + esc(p.undertitel) + "</span>" : "") + '<button class="v3-luk" title="Luk panelet">×</button></div><div class="v3-pbody"></div>';
    p.rod.querySelector(".v3-luk").onclick = lukPanel;
    p.krop = p.rod.querySelector(".v3-pbody");
    // Foran skuffen, når den ligger i midterkolonnen, ellers sidst: insertBefore kaster NotFoundError, hvis #arb ligger et
    // andet sted (før flytSkuffe), og det må aldrig kunne stoppe start() eller et spors registrering.
    var mid = $("v3mid"), arb = $("arb"), rail = $("v3rail");
    if (mid) mid.insertBefore(p.rod, arb && arb.parentNode === mid ? arb : null);
    if (!p.skjult && rail) {
      var spacer = rail.querySelector(".v3-rspacer");
      var groupAnchor = spacer;
      if (def.gruppe === "data") {
        var lastDataButton = $("v3r-skuffe:produkter");
        groupAnchor = lastDataButton ? lastDataButton.nextSibling : spacer;
      }
      p.knap = railKnap(p.id, p.titel, p.ikon, function () { vaelgPanel(p.id); }, p.hint);
      rail.insertBefore(p.knap, def.efter === "slut" ? null : (groupAnchor || null));
    }
  }

  /* ---------- Faner (docks til højre) ---------- */
  function registrerFane(def) {
    if (!def || !def.id) return;
    if (!V) { tidlige.push(["fane", def]); return; }
    var f = faner[def.id] = Object.assign(faner[def.id] || {}, {id: def.id, titel: def.titel || def.id, monter: def.monter, vis: def.vis, bred: !!def.bred, monteret: false, handle: null});
    reg = Pn.registrer(reg, def.id, {slags: "dock", bred: f.bred});
    var tabs = $("tabs"), ws = $("workspace"), knap = tabs ? tabs.querySelector('[data-tab="' + def.id + '"]') : null;
    if (!knap && tabs) { knap = el("button", {class: "tab", "data-tab": def.id}, esc(f.titel)); tabs.appendChild(knap); knap.onclick = function () { V.skiftFane(def.id); }; }
    else if (knap && def.titel) knap.textContent = def.titel;
    if (!docks[def.id]) {
      var d = docks[def.id] = el("section", {class: "dock v3-dock hidden", id: "v3dock-" + def.id, "aria-label": f.titel});
      d.innerHTML = '<div class="v3-phead"><h2>' + esc(f.titel) + '</h2><button type="button" class="v3-luk" title="Luk panelet (tilbage til 3D Inspektion)">×</button></div><div class="v3-pbody"></div>';
      d.querySelector(".v3-luk").onclick = lukPanel;
      if (ws) ws.appendChild(d);
    }
    f.dock = docks[def.id]; f.krop = f.dock.querySelector(".v3-pbody");
    f.dock.classList.toggle("bred", f.bred);
    f.dock.querySelector("h2").textContent = f.titel;
    if (ws && window.IssanaPanelStoerrelse) window.IssanaPanelStoerrelse.installer(ws);
    if (aktivtPanel === def.id && !anvender) { vistDock = null; anvend(); }
  }

  /* ---------- Mindmap-panelet (og Søg) ---------- */
  function mmAabne() { var g = mmTilstand.gruppering; if (!mmTilstand.aabne[g]) mmTilstand.aabne[g] = Mm.standardAabne(g, mmPunkter()); return mmTilstand.aabne[g]; }
  function visAlle() { isoleretFraMindmap = false; V.isoler(null); if (visning.tilstand() === "valgte") visning.saet("hele"); renderMindmap(); }
  function renderMindmap() {
    ["mindmap", "soeg"].forEach(function (id) {
      var p = paneler[id]; if (!p || !p.monteret || !p.rod.classList.contains("vis")) return;
      var rul = p.krop.querySelector(".mm-rul"); if (!rul) return;
      var va = p.krop.querySelector(".v3-visalle"); if (va) va.disabled = !isoleretFraMindmap;
      if (!V.elementer().length) { rul.innerHTML = '<div class="v3-tom">Hent modellen fra Revit først (eller åbn en .issana3d.json).</div>'; return; }
      var punkter = mmPunkter();
      var filter = id === "soeg" ? Mm.filtrer(punkter, mmTilstand.soegTekst) : null;
      if (id === "soeg") { var tal = p.krop.querySelector(".v3-soegtal"); if (tal) tal.textContent = filter ? filter.size + " træffer" + (filter.size === 1 ? "" : "e") : ""; var vb = p.krop.querySelector(".v3-soegvaelg"); if (vb) vb.disabled = !filter || !filter.size; }
      if (id === "soeg" && !filter) { rul.innerHTML = '<div class="v3-tom">Skriv for at søge i id, typenavn, familie, etage og CCI-kode. Træfferne vises som mindmap; Enter vælger dem alle.</div>'; return; }
      var res = Mm.byg(punkter, {gruppering: mmTilstand.gruppering, aabne: mmAabne(), valgte: valgteSet(), filter: filter});
      Mm.tegn(rul, res, {
        klik: function (node, ev) {
          var r = Mm.handling(node, mmAabne(), valgteSet(), !!(ev.shiftKey || ev.ctrlKey || ev.metaKey));
          mmTilstand.aabne[mmTilstand.gruppering] = r.aabne;
          // Isolering: rum → kun rummets elementer og «Valgte»; etage → kun etagen; Model → alt igen
          if (r.isoler === null) { isoleretFraMindmap = false; V.isoler(null); }
          else if (r.isoler) { isoleretFraMindmap = true; V.isoler(new Set(r.isoler)); }
          if (r.vaelg) vaelg(r.vaelg, !r.erstat); else renderMindmap();
          if (r.visning === "valgte" && visning.tilstand() !== "valgte") visning.saet("valgte");
          else if (r.visning === "hele" && visning.tilstand() === "valgte") visning.saet("hele");
        },
        dobbelt: function (node) {
          var r = Mm.dobbelt(node, mmAabne());
          mmTilstand.aabne[mmTilstand.gruppering] = r.aabne;
          if (r.fokus === "alt") { vaelg([], false); V.tilpas(null); return; }
          vaelg(r.vaelg, false); V.fokus();
        },
        plus: function (node) { vaelg(Mm.plus(node).vaelg, true); }
      });
      var seg = p.krop.querySelector(".v3-grupper"); if (seg) seg.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.g === mmTilstand.gruppering); });
    });
  }
  function mindmapVaerktoej(medSoeg) {
    var h = '<div class="v3-mm-vaerk">';
    if (medSoeg) h += '<input class="v3-in v3-soeg" type="search" placeholder="Søg id, type, familie, CCI-kode …" autocomplete="off" style="flex:1 1 160px;width:auto"><span class="v3-soegtal v3-hint" style="margin:0"></span><button class="tbtn v3-soegvaelg" disabled>Vælg træfferne</button>';
    h += '<span class="v3-hint" style="margin:0">Gruppér</span><span class="v3-seg v3-grupper">' + Mm.GRUPPERINGER.map(function (g) { return '<button type="button" data-g="' + g.id + '"' + (g.id === mmTilstand.gruppering ? ' class="on"' : "") + ">" + esc(g.titel) + "</button>"; }).join("") + "</span>";
    if (!medSoeg) h += '<span class="sp"></span><button class="tbtn v3-visalle" title="Ophæv isoleringen: vis hele modellen igen" disabled>Vis alle</button><button class="tbtn v3-fold" data-ud="1" title="Fold alt ud">⊞</button><button class="tbtn v3-fold" data-ud="0" title="Fold alt sammen">⊟</button>';
    h += '</div><div class="v3-mm-zoom"><button class="tbtn" data-mm-zoom="ud" aria-label="Zoom ud i mindmap">−</button><button class="tbtn" data-mm-zoom="nul" title="Nulstil mindmap til 100 %">100 %</button><button class="tbtn" data-mm-zoom="ind" aria-label="Zoom ind i mindmap">+</button><button class="tbtn" data-mm-zoom="tilpas">Tilpas bredde</button><span class="v3-hint">Scroll: zoom · rullepaneler: flyt</span></div><div class="mm-rul"></div>' + (medSoeg ? "" : '<div class="v3-hint">Klik på et rum: kun rummet vises i 3D (isoleret, «Valgte»). Klik på en etage: kun etagen vises. «Model» eller «Vis alle» viser alt igen. «+» og Skift-klik føjer til valget uden at isolere. Dobbeltklik zoomer til det, du klikker på.</div>');
    return h;
  }
  function bindMindmapZoom(c) {
    c.querySelectorAll('[data-mm-zoom]').forEach(function (b) { b.onclick = function () {
      var r = c.querySelector('.mm-rul'); if (!r || !r.mmSaetZoom) return;
      var z = r.mmZoom || 1, a = b.dataset.mmZoom;
      if (a === 'tilpas') { var f = r.firstElementChild; z = f ? (r.clientWidth - 12) / parseFloat(f.style.width) : 1; }
      else z = a === 'nul' ? 1 : z * (a === 'ind' ? 1.2 : 1 / 1.2);
      r.mmSaetZoom(z);
      if (a === 'tilpas' || a === 'nul') { r.scrollLeft = 0; r.scrollTop = 0; }
    }; });
  }
  function monterMindmap(c) {
    c.innerHTML = mindmapVaerktoej(false);
    bindMindmapZoom(c);
    c.querySelector(".v3-grupper").onclick = function (ev) { var b = ev.target.closest("button"); if (!b) return; mmTilstand.gruppering = b.dataset.g; renderMindmap(); };
    c.querySelector(".v3-visalle").onclick = visAlle;
    c.querySelectorAll(".v3-fold").forEach(function (b) { b.onclick = function () {
      // Med et filter på alle punkter bygges hele træet udfoldet; så kender foldAlle alle knuder, der kan foldes.
      var g = mmTilstand.gruppering, punkter = mmPunkter();
      var alle = Mm.byg(punkter, {gruppering: g, filter: new Set(punkter.map(function (p) { return p.idx; }))});
      mmTilstand.aabne[g] = Mm.foldAlle(alle, mmAabne(), b.dataset.ud === "1"); renderMindmap(); }; });
    renderMindmap();
  }
  function monterSoeg(c) {
    c.innerHTML = mindmapVaerktoej(true);
    bindMindmapZoom(c);
    var inp = c.querySelector(".v3-soeg");
    inp.value = mmTilstand.soegTekst;
    inp.addEventListener("input", function () { mmTilstand.soegTekst = inp.value; renderMindmap(); });
    inp.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); vaelgTraeffere(); } });
    c.querySelector(".v3-grupper").onclick = function (ev) { var b = ev.target.closest("button"); if (!b) return; mmTilstand.gruppering = b.dataset.g; renderMindmap(); };
    c.querySelector(".v3-soegvaelg").onclick = vaelgTraeffere;
    function vaelgTraeffere() { var f = Mm.filtrer(mmPunkter(), mmTilstand.soegTekst); if (!f || !f.size) { V.info("Ingen træffere."); return; } vaelg(Array.from(f), false); V.fokus(); }
    renderMindmap();
    setTimeout(function () { inp.focus({preventScroll: true}); }, 0);
  }

  /* ---------- Lag-panelet: konstruktiv funktion ---------- */
  function lagPasser(rec, i) {
    if (!rec || rec.data.erRum || !Vn.erKonstruktivKategori(rec.data.category)) return true;
    return !lagSkjul[konstruktiv(i)];
  }
  function renderLag() {
    var p = paneler.lag; if (!p || !p.monteret) return;
    if (!V.elementer().length) { p.krop.innerHTML = '<div class="v3-tom">Hent modellen fra Revit først.</div>'; return; }
    var tal = konstruktivTal(), sum = 0; Vn.KONSTRUKTIV.forEach(function (k) { sum += tal[k]; });
    var h = '<div class="v3-hint" style="margin-top:0">Bærende bygningsdele (vægge, dæk, tage, søjler, bjælker) efter konstruktiv funktion. Tallene følger ændringslisten: de skifter, så snart du godkender en ændring, også før den er gemt i Revit. Fjern fluebenet for at skjule i 3D.</div>';
    Vn.KONSTRUKTIV.forEach(function (k) {
      h += '<label class="v3-lag"><input type="checkbox" data-k="' + esc(k) + '"' + (lagSkjul[k] ? "" : " checked") + '><span class="sw" style="background:' + Vn.KONSTRUKTIV_FARVE[k] + '"></span><span>' + esc(k) + '</span><span class="n">' + tal[k] + "</span></label>";
    });
    h += '<div class="v3-row" style="margin-top:10px"><button class="tbtn" id="v3lagFarv">Farv 3D efter funktion</button><button class="tbtn" id="v3lagVaelg" title="Vælg alle bærende bygningsdele uden angivet funktion">Vælg «Ikke angivet» (' + tal["Ikke angivet"] + ")</button></div>";
    h += '<div class="v3-hint">' + sum + " bærende bygningsdele i alt. Funktionen sættes i Data (tags «bærende» / «stabiliserende» / «ikke-bærende») eller af Statik-sporet; Revits Structural Usage bruges kun som forslag.</div>";
    h += '<div class="v3-row"><button class="tbtn" id="v3lagAlle">Alle lag og filtre (kategori, lyd, brand, renovering …)</button></div>';
    p.krop.innerHTML = h;
    p.krop.querySelectorAll("input[data-k]").forEach(function (cb) { cb.onchange = function () { lagSkjul[cb.dataset.k] = !cb.checked; visning.opdater(); }; });
    $("v3lagFarv").onclick = function () { V.farveTilstandVis("konstruktiv"); };
    $("v3lagVaelg").onclick = function () { var ids = []; infos().forEach(function (inf, i) { if (inf && !inf.erRum && Vn.erKonstruktivKategori(inf.ed.category) && konstruktiv(i) === "Ikke angivet") ids.push(i); }); if (!ids.length) { V.info("Alle bærende bygningsdele har en funktion."); return; } vaelg(ids, false); };
    $("v3lagAlle").onclick = function () { aabnPanel(Pn.SKUFFE + "lag"); };
  }
  function konstruktivLegend() {
    var tal = konstruktivTal();
    return "<h4>Konstruktiv funktion</h4>" + Vn.KONSTRUKTIV.map(function (k) { return '<div class="legrow"><span class="sw" style="background:' + Vn.KONSTRUKTIV_FARVE[k] + '"></span>' + esc(k) + " (" + tal[k] + ")</div>"; }).join("") +
      '<div class="legrow"><span class="sw" style="background:#55655e"></span>ikke en bærende kategori</div>';
  }

  /* ---------- Klip-panelet ---------- */
  function renderKlip() {
    var p = paneler.klip; if (!p || !p.monteret) return;
    if (!V.elementer().length) { p.krop.innerHTML = '<div class="v3-tom">Hent modellen fra Revit først.</div>'; return; }
    var st = visning.status(), g = st.graenser, k = st.klip;
    var h = '<div class="v3-hint" style="margin-top:0">Klip modellen med en boks. Det, der ligger uden for boksen, skjules, og snitfladerne bliver mørke. Nord er modellens +Y (kompasset). Klip i højden: brug Snit i visningsvælgeren under 3D.</div>';
    [["vest", "Vest", g.vest, g.oest], ["oest", "Øst", g.vest, g.oest], ["nord", "Nord", g.syd, g.nord], ["syd", "Syd", g.syd, g.nord]].forEach(function (r) {
      h += '<label class="v3-kliprow"><span class="l">' + r[1] + '</span><input type="range" data-side="' + r[0] + '" min="' + r[2] + '" max="' + r[3] + '" step="0.1" value="' + k[r[0]] + '"><span class="v" data-v="' + r[0] + '">' + Vn.klipTekst(k[r[0]]) + "</span></label>";
    });
    h += '<div class="v3-row" style="margin-top:8px"><button class="tbtn" id="v3klipOm">Klip om det valgte</button><button class="tbtn" id="v3klipNul"' + (st.klipAktiv ? "" : " disabled") + ">Nulstil</button></div>";
    h += '<div class="v3-hint">«Klip om det valgte» lægger boksen 1 m uden om de valgte elementer. Skyderne går i 0,1 m og holder mindst 0,5 m mellem to modstående flader.</div>';
    p.krop.innerHTML = h;
    p.krop.querySelectorAll("input[data-side]").forEach(function (r) { r.oninput = function () { visning.klip(r.dataset.side, parseFloat(r.value)); }; });
    $("v3klipOm").onclick = function () { if (!V.valgte().length) { V.info("Vælg først et eller flere elementer."); return; } visning.klipOmValgte(); };
    $("v3klipNul").onclick = function () { visning.nulstilKlip(); };
  }
  function opdaterKlipFelter(st) {
    var p = paneler.klip; if (!p || !p.monteret || !p.rod.classList.contains("vis")) return;
    p.krop.querySelectorAll("input[data-side]").forEach(function (r) { var s = r.dataset.side; if (document.activeElement !== r) r.value = st.klip[s]; var v = p.krop.querySelector('[data-v="' + s + '"]'); if (v) v.textContent = Vn.klipTekst(st.klip[s]); });
    var nul = $("v3klipNul"); if (nul) nul.disabled = !st.klipAktiv;
  }

  /* ---------- Opbygning-panelet ---------- */
  function visOpbygningFor(idx) {
    var liste = V.valgte(); if (!liste.length) { V.info("Vælg først et element (klik i 3D eller i mindmappet)."); return; }
    if (idx == null || liste.indexOf(idx) < 0) idx = liste[0];
    opbyg.liste = liste.slice(); opbyg.i = opbyg.liste.indexOf(idx);
    opbyg.resultat = visning.opbygningFor(idx);
    aabnPanel("opbygning");
  }
  /* ---------- Ret lagene (opbygning-ret.js) ----------
     Ejer, 2026-11-14: lagene skal kunne rettes her (tilføj, fjern, flyt, tykkelse, materiale, skelet) og gå tilbage i Revit.
     Rettelsen er et forslag i panelet, til brugeren trykker «Gem i Revit»: så skrives typens lag med Revit-kommandoen
     set_compound_structure, og det, Revit svarer, at typen nu har, sammenlignes med det sendte (læs tilbage). Lagene gælder
     typen, altså alle elementer af den; «Gem som ny type» kopierer typen først. Skelettet findes ikke i Revits lag: det
     lægges i typens ISSANA Data gennem ændringslisten. */
  var opbygRet = null;   // {idx, typeId, typeNavn, antal, lag, original, bekraeft: null|"samme"|"ny", nytNavn, gemmer}
  function Ret() { return window.IssanaOpbygningRet || null; }
  function retType(idx) {
    var rec = V.elementer()[idx], ed = rec && rec.data; if (!ed || ed.typeId == null) return null;
    var t = V.typer()[String(ed.typeId)]; if (!t || !Array.isArray(t.layers) || !t.layers.length) return null;
    var antal = V.elementer().filter(function (r) { return r && r.data && r.data.typeId === ed.typeId; }).length;
    return {typeId: ed.typeId, navn: t.name || ed.type || "Type", lag: t.layers, antal: antal};
  }
  // Skelettet, som det står i typens ISSANA Data (med det, der ligger i ændringslisten): [{lag, bredde, cc}].
  function retSkelet(idx) {
    var inf = infos()[idx]; if (!inf || !A.dataFor || !A.maal) return [];
    try { var rec = A.dataFor(A.maal(inf, "type")); return (rec && rec.opbygning && Array.isArray(rec.opbygning.skelet)) ? rec.opbygning.skelet : []; } catch (e) { return []; }
  }
  function retMaterialer(lag) {
    var set = {}, typer = V.typer();
    Object.keys(typer).forEach(function (k) { ((typer[k] && typer[k].layers) || []).forEach(function (l) { if (l && l.material) set[l.material] = 1; }); });
    (lag || []).forEach(function (l) { if (l.material) set[l.material] = 1; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, "da"); });
  }
  function startRet(idx) {
    var R = Ret(), t = retType(idx); if (!R || !t) return;
    var lag = R.kopi(t.lag, retSkelet(idx));
    opbygRet = {idx: idx, typeId: t.typeId, typeNavn: t.navn, antal: t.antal, lag: lag, original: R.kopi(lag, R.skeletData(lag)), bekraeft: null, nytNavn: t.navn + " (rettet)", gemmer: false};
    renderOpbygning();
  }
  function stopRet() {
    var o = opbygRet; opbygRet = null;
    if (o && visning.tilstand() === "opbygning") opbyg.resultat = visning.opbygningFor(o.idx);   // Revits egne lag igen
    renderOpbygning();
  }
  // Efter en rettelse: 3D-stykket og snittegningen følger de rettede lag.
  function retVis() {
    var o = opbygRet; if (!o) return;
    if (visning.opbygningMed) opbyg.resultat = visning.opbygningMed(o.idx, o.lag.map(function (l) { return {material: l.material, "function": l["function"], widthMm: l.widthMm}; }));
    renderOpbygning();
  }
  function retHtml(o) {
    var R = Ret(), mat = retMaterialer(o.lag);
    var h = '<ol class="v3-ol v3-ret">' + o.lag.map(function (l, i) {
      var fn = R.FUNKTIONER.map(function (f) { return '<option value="' + f + '"' + (l["function"] === f ? " selected" : "") + ">" + esc(Vn.rolleTekst(f)) + "</option>"; }).join("");
      var m = '<option value=""' + (l.material ? "" : " selected") + ">(uden materiale)</option>" + mat.map(function (n) { return '<option value="' + esc(n) + '"' + (l.material === n ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("");
      var membran = l["function"] === "Membrane";
      var sk = l.skelet ? '<span class="v3-ret-sk"><input type="number" min="1" step="1" data-ret="bredde" data-i="' + i + '" value="' + esc(l.skelet.bredde) + '" aria-label="Stolpens bredde i mm"> mm pr. <input type="number" min="1" step="1" data-ret="cc" data-i="' + i + '" value="' + esc(l.skelet.cc) + '" aria-label="Afstand mellem stolperne i mm"> mm</span>' : "";
      return '<li><span class="v3-nr">' + (i + 1) + '</span><span class="m">'
        + '<select data-ret="material" data-i="' + i + '" aria-label="Materiale, lag ' + (i + 1) + '">' + m + "</select>"
        + '<select data-ret="function" data-i="' + i + '" aria-label="Funktion, lag ' + (i + 1) + '">' + fn + "</select>"
        + (membran ? "" : '<label class="v3-ret-skelet"><input type="checkbox" data-ret="skelet" data-i="' + i + '"' + (l.skelet ? " checked" : "") + "> Skelet (stolper)</label>" + sk)
        + '</span><span class="t"><input type="number" min="0" step="1" data-ret="widthMm" data-i="' + i + '" value="' + esc(isFinite(l.widthMm) ? l.widthMm : "") + '"' + (membran ? " disabled" : "") + ' aria-label="Tykkelse i mm, lag ' + (i + 1) + '"> mm</span>'
        + '<span class="v3-ret-knap"><button type="button" data-ret="op" data-i="' + i + '" title="Flyt laget udad"' + (i ? "" : " disabled") + '>↑</button><button type="button" data-ret="ned" data-i="' + i + '" title="Flyt laget indad"' + (i < o.lag.length - 1 ? "" : " disabled") + '>↓</button><button type="button" data-ret="slet" data-i="' + i + '" title="Fjern laget"' + (o.lag.length > 1 ? "" : " disabled") + ">✕</button></span></li>";
    }).join("") + "</ol>";
    return h + '<div class="v3-row"><button type="button" class="tbtn" data-ret="tilfoej">+ Tilføj lag inderst</button><button type="button" class="tbtn" data-ret="tilfoejYderst">+ Tilføj lag yderst</button></div>';
  }
  function retFod(o) {
    var R = Ret(), mangler = R.fejl(o.lag), forskel = R.forskel(o.original, o.lag), iRevit = V.erRevit();
    var h = '<div class="v3-ret-fod">';
    h += '<div class="v3-hint">Lagene hører til typen «' + esc(o.typeNavn) + "», som " + (o.antal === 1 ? "1 element" : o.antal + " elementer") + " i modellen bruger. " + (forskel ? "<b>Ændret:</b> " + esc(forskel) + "." : "Intet er ændret endnu.") + "</div>";
    if (mangler.length) h += '<div class="v3-hint issana-mangler">' + mangler.slice(0, 3).map(esc).join("<br>") + "</div>";
    if (o.bekraeft) {
      h += '<div class="v3-ret-bekraeft">' + (o.bekraeft === "ny"
        ? 'Typen kopieres i Revit, og kopien får de nye lag. Elementerne beholder den gamle type, til du selv skifter den.<br><label>Navn på den nye type <input type="text" data-ret="nytNavn" value="' + esc(o.nytNavn) + '"></label>'
        : "Lagene i typen «" + esc(o.typeNavn) + "» ændres i Revit for " + (o.antal === 1 ? "det ene element" : "alle " + o.antal + " elementer") + ". Revit spørger selv en gang til, før den gemmer.")
        + '<div class="v3-row"><button type="button" class="tbtn primary" data-ret="gemJa"' + (o.gemmer ? " disabled" : "") + ">" + (o.gemmer ? "Gemmer …" : "Ja, gem i Revit") + '</button><button type="button" class="tbtn" data-ret="gemNej"' + (o.gemmer ? " disabled" : "") + ">Annullér</button></div></div>";
    } else {
      var kan = !mangler.length && !!forskel && iRevit;
      h += '<div class="v3-row"><button type="button" class="tbtn primary" data-ret="gem"' + (kan ? "" : " disabled") + '>Gem i Revit …</button><button type="button" class="tbtn" data-ret="gemNy"' + (!mangler.length && iRevit ? "" : " disabled") + '>Gem som ny type …</button><button type="button" class="tbtn" data-ret="fortryd">Fortryd</button></div>';
      if (!iRevit) h += '<div class="v3-hint">Lagene kan kun gemmes, når ISSANA 3D er åbnet fra Revit.</div>';
    }
    return h + "</div>";
  }
  function bindRet(rod) {
    var R = Ret(), o = opbygRet; if (!R || !o || !rod || !rod.querySelectorAll) return;
    rod.querySelectorAll("[data-ret]").forEach(function (el) {
      var hvad = el.getAttribute("data-ret"), i = Number(el.getAttribute("data-i"));
      var ret = function (lag) { o.lag = lag; o.bekraeft = null; retVis(); };
      if (hvad === "material" || hvad === "function" || hvad === "widthMm") el.onchange = function () { ret(R.saet(o.lag, i, hvad, el.value)); };
      else if (hvad === "skelet") el.onchange = function () { ret(R.saet(o.lag, i, "skelet", el.checked ? {bredde: 45, cc: 600} : null)); };
      else if (hvad === "bredde" || hvad === "cc") el.onchange = function () { var s = Object.assign({}, o.lag[i].skelet); s[hvad] = el.value; ret(R.saet(o.lag, i, "skelet", s)); };
      else if (hvad === "op") el.onclick = function () { ret(R.flyt(o.lag, i, -1)); };
      else if (hvad === "ned") el.onclick = function () { ret(R.flyt(o.lag, i, 1)); };
      else if (hvad === "slet") el.onclick = function () { ret(R.fjern(o.lag, i)); };
      else if (hvad === "tilfoej") el.onclick = function () { ret(R.indsaet(o.lag, o.lag.length, R.nytLag(retMaterialer(o.lag)[0]))); };
      else if (hvad === "tilfoejYderst") el.onclick = function () { ret(R.indsaet(o.lag, 0, Object.assign(R.nytLag(retMaterialer(o.lag)[0]), {"function": "Finish1"}))); };
      else if (hvad === "fortryd") el.onclick = stopRet;
      else if (hvad === "gem") el.onclick = function () { o.bekraeft = "samme"; renderOpbygning(); };
      else if (hvad === "gemNy") el.onclick = function () { o.bekraeft = "ny"; renderOpbygning(); };
      else if (hvad === "gemNej") el.onclick = function () { o.bekraeft = null; renderOpbygning(); };
      else if (hvad === "nytNavn") el.oninput = function () { o.nytNavn = el.value; };
      else if (hvad === "gemJa") el.onclick = function () { gemLag(o.bekraeft === "ny"); };
    });
  }
  // Skriver lagene til Revit og kontrollerer svaret. Skelettet lægges i ændringslisten (typens ISSANA Data).
  function gemLag(somNy) {
    var R = Ret(), o = opbygRet; if (!R || !o || o.gemmer) return;
    var mangler = R.fejl(o.lag);
    if (mangler.length) { V.fejl(mangler[0]); return; }
    if (!V.erRevit()) { V.fejl("Ikke i Revit: lagene kan kun gemmes, når ISSANA 3D er åbnet fra Revit."); return; }
    if (somNy && !String(o.nytNavn || "").trim()) { V.fejl("Skriv et navn til den nye type."); return; }
    var lagAendret = R.lagAendret(o.original, o.lag), skeletAendret = R.skeletAendret(o.original, o.lag);
    var skeletTilListen = function () {
      if (somNy || !skeletAendret) return false;
      var inf = infos()[o.idx]; if (!inf || !A.gemData || !A.dataFor) return false;
      var m = A.maal(inf, "type"), rec = A.dataFor(m);
      rec.opbygning = Object.assign({}, rec.opbygning, {skelet: R.skeletData(o.lag)});
      A.gemData(m, rec, "skelet i opbygningen");
      return true;
    };
    if (!lagAendret && !somNy) {
      // Kun skelettet er ændret: Revits lag røres ikke.
      var lagt = skeletTilListen(); opbygRet = null; renderOpbygning();
      V.info(lagt ? "Skelettet er lagt i ændringslisten. Tryk «Gem i Revit» øverst for at gemme det i typen." : "Intet er ændret.");
      return;
    }
    var p = R.tilRevit(o.typeId, o.lag, somNy ? o.nytNavn : "");
    o.gemmer = true; renderOpbygning();
    V.kald("set_compound_structure", p, {timeoutMs: 180000}).then(function (svar) {
      var s = R.laesSvar(svar);
      if (!s.ok) throw new Error(s.besked || "Revit afviste lagene.");
      var tjek = R.sammenlign(p.layers, s.lag), lagt = skeletTilListen(), navn = s.typeNavn || (somNy ? o.nytNavn : o.typeNavn);
      opbygRet = null;
      if (tjek.ens) V.info("Lagene er gemt i Revit i typen «" + navn + "» og læst tilbage: " + p.layers.length + " lag, " + fmtMm(R.samletMm(o.lag)) + "." + (lagt ? " Skelettet ligger i ændringslisten." : "") + (somNy && R.skeletData(o.lag).length ? " Skelettet er ikke gemt på den nye type; sæt det, når modellen er hentet igen." : "") + " Modellen hentes igen.");
      else V.fejl("Revit har gemt lagene i typen «" + navn + "», men de er ikke helt som sendt: " + tjek.afvigelser.slice(0, 3).join(" "));
      udsend("opbygningGemt", {typeId: s.typeId != null ? s.typeId : o.typeId, ny: !!somNy, ens: tjek.ens});
      V.hentIgen();
    }).catch(function (e) {
      o.gemmer = false; o.bekraeft = null;
      V.fejl("Lagene er ikke gemt: " + ((e && e.message) || e));
      renderOpbygning();
    });
  }

  function renderOpbygning() {
    var p = paneler.opbygning; if (!p || !p.monteret) return;
    var r = opbyg.resultat;
    if (!r || visning.tilstand() !== "opbygning") { p.krop.innerHTML = '<div class="v3-tom">Intet valgt.<br>Dobbeltklik på en væg eller et dæk i 3D, eller vælg i mindmappet og tryk «Opbygning» under 3D.<br><br><button class="tbtn" id="v3opbTilbage">Tilbage til modellen</button></div>'; var tb = $("v3opbTilbage"); if (tb) tb.onclick = function () { visning.saet("hele"); }; return; }
    var e = r.element, inf = infos()[e.idx] || {}, kf = konstruktiv(e.idx), fr = Vn.konstruktivFraRevit(inf.ed || {});
    if (opbygRet && opbygRet.idx !== e.idx) opbygRet = null;
    var ret = opbygRet, skelet = {};
    if (!ret) retSkelet(e.idx).forEach(function (s) { if (s && s.lag) skelet[s.lag] = s; });
    var h = '<div style="font-weight:600;font-size:14px">' + esc(e.navn) + '</div><div class="v3-hint" style="margin:2px 0 8px">' + esc(e.kategori || "") + (e.etage ? " · " + esc(e.etage) : "") + " · ID " + esc(e.id) + "</div>";
    if (opbyg.liste.length > 1) h += '<div class="v3-row"><button class="tbtn" id="v3opbForrige">‹ Forrige</button><span class="v3-hint" style="margin:0">' + (opbyg.i + 1) + " af " + opbyg.liste.length + '</span><button class="tbtn" id="v3opbNaeste">Næste ›</button></div>';
    if (r.mangler) h += '<div class="v3-hint">Typen har ingen lag i Revit (ingen opbygning, eller elementet er ikke en lagdelt type). Elementet vises som ét volumen.</div>';
    else {
      // Først lagene som en snittegning: det er dem, man vil se. 3D viser et kort stykke af elementet.
      h += Vn.snitSvg(r.lag, r.akse === "z");
      h += '<div class="v3-hint">' + (r.akse === "z" ? "Lag 1 er øverst." : "Lag 1 er yderst (Revits rækkefølge).") + " 3D viser et kort stykke af elementet, så lagene kan ses.</div>";
      if (ret) h += retHtml(ret);
      else h += '<ol class="v3-ol">' + r.lag.map(function (l) { var sk = skelet[l.nr]; return '<li><span class="v3-nr">' + l.nr + '</span><span class="sw" style="background:' + l.farve + '"></span><span class="m">' + esc(l.materiale) + "<small>" + esc(l.rolle) + (l.baerende ? ' · <b>bærende lag</b>' : "") + (sk ? " · skelet " + esc(sk.bredde) + " mm pr. " + esc(sk.cc) + " mm" : "") + '</small></span><span class="t">' + esc(fmtMm(l.tykkelseMm)) + "</span></li>"; }).join("") + "</ol>";
      h += '<div class="v3-kv" style="font-weight:600;margin-top:10px"><span>Samlet tykkelse</span><span>' + esc(fmtMm(r.samletMm)) + "</span></div>";
      h += '<div class="v3-kv"><span class="k">Bærende lag</span><span class="v">' + (r.baerende.length ? esc(r.baerende.join(", ")) : '<span class="issana-mangler">intet lag er markeret bærende i Revit</span>') + "</span></div>";
    }
    if (ret) h += retFod(ret);
    else if (!r.mangler && Ret() && retType(e.idx)) h += '<div class="v3-row" style="margin-top:8px"><button class="tbtn" id="v3opbRet" title="Tilføj, fjern og flyt lag, ret tykkelse og materiale, og gem i Revit">Ret lagene</button></div>';
    h += '<div class="v3-kv"><span class="k">Konstruktiv funktion</span><span class="v"' + (kf === "Ikke angivet" ? ' style="color:var(--warn)"' : "") + ">" + esc(kf) + "</span></div>";
    if (fr) h += '<div class="v3-kv"><span class="k">Fra Revit (Structural Usage)</span><span class="v">' + esc(fr) + ' <span class="v3-chip">forslag</span></span></div>';
    h += '<div class="v3-row" style="margin-top:12px"><button class="tbtn" id="v3opbData">Rediger bygningsdata</button><button class="tbtn" id="v3opbTilbage">Tilbage til modellen</button></div>';
    h += '<div class="v3-hint">Lagene er typens opbygning fra Revit (materiale, funktion, tykkelse). Konstruktiv funktion er din egen angivelse; mangler den, står der «Ikke angivet».</div>';
    p.krop.innerHTML = h;
    var rk = $("v3opbRet"); if (rk) rk.onclick = function () { startRet(e.idx); };
    bindRet(p.krop);
    var f = $("v3opbForrige"), n = $("v3opbNaeste");
    if (f) f.onclick = function () { opbyg.i = (opbyg.i - 1 + opbyg.liste.length) % opbyg.liste.length; opbyg.resultat = visning.opbygningFor(opbyg.liste[opbyg.i]); renderOpbygning(); };
    if (n) n.onclick = function () { opbyg.i = (opbyg.i + 1) % opbyg.liste.length; opbyg.resultat = visning.opbygningFor(opbyg.liste[opbyg.i]); renderOpbygning(); };
    $("v3opbData").onclick = function () { aabnPanel(Pn.SKUFFE + "data"); };
    $("v3opbTilbage").onclick = function () { visning.saet("hele"); };
  }
  function fmtMm(mm) { if (!isFinite(mm)) return "-"; return (Math.round(mm * 10) / 10).toLocaleString("da-DK") + " mm"; }

  /* ---------- Indstillinger ---------- */
  var BJAELKER = [["lys", "Lys"], ["moerk", "Mørk"], ["groen", "Grøn"]];
  function saetBjaelke(v) { document.body.setAttribute("data-bjaelke", v); lagr("issana-3d-bjaelke-v1", v); var p = paneler.indstillinger; if (p && p.monteret) p.krop.querySelectorAll("[data-bj]").forEach(function (b) { b.classList.toggle("on", b.dataset.bj === v); }); }
  // Panelet bygges kun én gang: åbnes det før modellen, skal knapperne låses op, når værktøjerne bliver aktive.
  var flereKnapper = [];
  function synkFlere() { flereKnapper.forEach(function (x) { x.b.disabled = x.o.disabled; }); }
  function monterIndstillinger(c) {
    var nu = document.body.getAttribute("data-bjaelke") || "lys";
    var h = '<div class="v3-sek" style="margin-top:0">Venstre bjælke</div><span class="v3-seg">' + BJAELKER.map(function (b) { return '<button type="button" data-bj="' + b[0] + '"' + (b[0] === nu ? ' class="on"' : "") + ">" + b[1] + "</button>"; }).join("") + "</span>";
    h += '<div class="v3-sek">Tema</div><div class="v3-row"><button class="tbtn" id="v3tema">Skift mellem lys og mørk</button></div>';
    h += '<div class="v3-sek">Flere værktøjer</div><div class="v3-hint" style="margin-top:0">Værktøjerne fra 2.12\'s ikon-rail. De virker som før.</div><div class="v3-row" id="v3flere"></div>';
    h += '<div class="v3-sek">Paneler</div><div class="v3-hint" style="margin-top:0">Ét panel ad gangen: åbner du et af disse, lukkes Indstillinger og alt andet.</div><div class="v3-row" id="v3panelknapper"></div>';
    h += '<div class="v3-sek">Om</div><div class="v3-hint">ISSANA 3D-arbejdsrum 3.0 (layout). AI-valg (forbindelse, model, intensitet) kommer med AI-sporet og står også her. Intet skrives i Revit uden forhåndsvisning og «Gem i Revit».</div>';
    c.innerHTML = h;
    c.querySelectorAll("[data-bj]").forEach(function (b) { b.onclick = function () { saetBjaelke(b.dataset.bj); }; });
    $("v3tema").onclick = function () { $("btnTheme").click(); };
    var flere = $("v3flere");
    [["btnIsolate", "Isolér valgte (I)"], ["btnAll", "Vis alle"], ["btnXray", "Røntgen"], ["btnFind", "Find og isolér"], ["btnQty", "Mængder pr. type"], ["btnReport", "Rapport (PDF)"]].forEach(function (x) {
      var o = $(x[0]); if (!o) return; var b = el("button", {class: "tbtn", type: "button"}, esc(x[1])); b.disabled = o.disabled; b.onclick = function () { o.click(); b.classList.toggle("on", o.classList.contains("on")); }; flere.appendChild(b);
      flereKnapper.push({b: b, o: o});
    });
    var pk = $("v3panelknapper");
    [["types", "Bygningsdelstyper"], ["egenskaber", "Egenskaber"], ["params", "Bygningsdelsparametre"]].forEach(function (x) {
      var b = el("button", {class: "tbtn", type: "button"}, esc(x[1])); b.onclick = function () { vaelgPanel(x[0]); }; pk.appendChild(b);
    });
  }

  /* ---------- Markering og filter i bundlinjen under 3D ----------
     «Markér flere» lader klik føje til det markerede og trækker en ramme. «Vis kun» og «Skjul» filtrerer på det markerede,
     og filteret bliver stående, til «Vis alle». Knapperne ses kun, når de kan bruges, så linjen ikke fyldes. */
  function opdaterValgUI() {
    var v = $("v3valg"); if (!v || !V.filterStatus) return;
    var st = V.filterStatus(), n = V.valgte().length;
    // Opbygning isolerer selv sit element og har sin egen vej tilbage: brugerens filterknapper holder sig væk imens.
    var iOpbygning = !!(visning && visning.tilstand && visning.tilstand() === "opbygning");
    v.classList.toggle("vis", V.elementer().length > 0 && !iOpbygning);
    if (iOpbygning) { v.innerHTML = ""; return; }
    var h = '<span class="v3-seg"><button type="button" data-valg="flere"' + (st.markerFlere ? ' class="on"' : "") + ' aria-pressed="' + (st.markerFlere ? "true" : "false") + '" title="Klik føjer til det markerede, og et træk med venstre museknap tegner en ramme om flere på én gang. Højre museknap flytter, hjulet zoomer.">Markér flere</button>';
    if (n) h += '<button type="button" data-valg="kun" title="Vis kun det markerede (' + n + ')">Vis kun</button><button type="button" data-valg="skjul" title="Skjul det markerede (' + n + ')">Skjul</button>';
    h += "</span>";
    if (st.isoleret || st.skjult) {
      var tal = (st.isoleret ? "viser " + st.vist : "") + (st.isoleret && st.skjult ? " · " : "") + (st.skjult ? st.skjult + " skjult" : "");
      h += '<button type="button" class="tbtn v3-visalle" data-valg="alle" title="Hent alt frem igen">Vis alle</button><span class="v3-filtertal">' + esc(tal) + "</span>";
    }
    v.innerHTML = h;
    v.querySelectorAll("[data-valg]").forEach(function (b) {
      b.onclick = function () {
        var hvad = b.dataset.valg, valgte = V.valgte();
        if (hvad === "flere") V.markerFlere(!V.markerFlere());
        else if (hvad === "kun" && valgte.length) { V.isoler(new Set(valgte)); V.fokus(); }
        // Det skjulte kan ikke være markeret: valget tømmes uden at røre filteret (fravaelg ville hente alt frem).
        else if (hvad === "skjul" && valgte.length) { V.skjul(new Set(valgte)); V.vaelgFlere([]); }
        else if (hvad === "alle") V.visAlle();
        opdaterValgUI();
      };
    });
  }

  /* ---------- Visningsvælger i bundlinjen under 3D ---------- */
  function opdaterVisningsUI(st) {
    var v = $("v3visning"); if (!v) return;
    v.classList.toggle("vis", V.elementer().length > 0);
    var h = '<span class="v3-seg">' + Vn.TILSTANDE.map(function (t) { return '<button type="button" data-t="' + t.id + '" title="' + esc(t.hjaelp) + '"' + (st.tilstand === t.id ? ' class="on"' : "") + ">" + esc(t.titel) + "</button>"; }).join("") + "</span>";
    if (st.tilstand === "etage" || st.tilstand === "snit") h += '<span class="v3-lvl" title="Etage"><b>' + esc(st.etage || "–") + '</b><span><button class="v3-step" data-trin="1" title="Etagen over">▲</button><button class="v3-step" data-trin="-1" title="Etagen under">▼</button></span></span>';
    if (st.tilstand === "snit") h += '<label title="Snithøjde: ' + (st.snitHoejde != null ? st.snitHoejde.toLocaleString("da-DK", {maximumFractionDigits: 2}) + " m" : "") + '"><input type="range" min="2" max="98" step="1" value="' + Math.round(st.snitAndel * 100) + '" id="v3snit"></label>';
    if (st.tilstand === "valgte" && !V.valgte().length) h += '<span class="v3-hint" style="margin:0">Vælg noget i 3D eller i mindmappet.</span>';
    if (st.klipAktiv) h += '<span class="v3-klipchip">Klip er slået til <button type="button" id="v3klipChipNul">Nulstil</button></span>';
    v.innerHTML = h;
    v.querySelectorAll("[data-t]").forEach(function (b) { b.onclick = function () { var id = b.dataset.t; if (id === "opbygning") { visOpbygningFor(null); return; } visning.saet(id); }; });
    v.querySelectorAll("[data-trin]").forEach(function (b) { b.onclick = function () { visning.etageTrin(+b.dataset.trin); }; });
    var sn = $("v3snit"); if (sn) sn.oninput = function () { visning.snit(sn.value / 100); };
    var kn = $("v3klipChipNul"); if (kn) kn.onclick = function () { visning.nulstilKlip(); };
    opdaterKlipFelter(st);
    if (st.tilstand !== "opbygning" && aktivtPanel === "opbygning") { opbyg.resultat = null; lukPanel(); }
    opdaterValgUI();
    udsend("visning", st);
  }

  /* ---------- Hændelser fra visningen ---------- */
  function vedModel() {
    var ai = $("v3ai"); if (ai) ai.classList.add("vis");   // først: AI-feltet skal frem, selv om noget af det følgende fejler
    opdaterModelgrundlag();
    synkFlere();
    if (A.aiNulstil) A.aiNulstil();
    mmTilstand.aabne = {}; mmTilstand.filter = null; opbyg = {liste: [], i: 0, resultat: null}; lagSkjul = {}; isoleretFraMindmap = false;
    opdaterStatus(A.antalAendringer());
    renderMindmap(); renderLag(); renderKlip(); renderOpbygning(); opdaterValgUI();
    // Start rent: intet panel åbnes af sig selv (brugeren vælger i bjælken)
    udsend("model", V.data());
  }
  function vedValg(liste) { renderMindmap(); if (aktivtPanel === "opbygning" && visning.tilstand() === "opbygning") renderOpbygning(); opdaterValgUI(); udsend("valg", liste || V.valgte()); }
  function synkRailMedApp() {
    var app = $("app"), ma = $("v3r-maale");
    if (ma) ma.classList.toggle("on", app.classList.contains("maal-aktiv"));
  }

  /* ---------- Offentlig flade ---------- */
  var API = {
    version: "3.0",
    model: function () { return V.data(); },
    elementer: function () { return V.elementer(); },
    typer: function () { return V.typer(); },
    infos: infos,
    // Revit-id → elementindeks. Rum findes under "rum:"+id i arbejdsrum.js; her prøves begge, så sporene kan sende rummets id direkte.
    indeks: function (revitId) { var m = (A && A.byRevitId) || {}; var i = m[revitId]; if (i == null) i = m["rum:" + revitId]; return i == null ? -1 : i; },
    elementId: function (idx) { var r = V.elementer()[idx]; return r ? r.data.id : null; },
    valgte: function () { return V.valgte(); },
    vaelg: function (ids, o) { vaelg((ids || []).filter(function (i) { return V.elementer()[i]; }), !!(o && o.tilfoej)); },
    fravaelg: function () { V.fravaelg(); },
    isoler: function (ids) { if (!ids || !ids.length) { V.isoler(null); return; } if(visning){visning.saet("hele");visning.nulstilKlip();} V.isoler(new Set(ids)); V.fokus(); },
    fokus: function () { V.fokus(); },
    // Brugerens eget filter: skjul elementer (indeks), og hent alt frem igen. Bundlinjens knapper bruger det samme.
    skjul: function (ids) { if (ids && ids.length) V.skjul(new Set(ids)); },
    visAlle: function () { V.visAlle(); },
    // En fanes eget udsnit af modellen (Statik: dækket og etagen under). fn(rec, idx) → true for det, der skal ses; null fjerner det.
    // Fanen fjerner selv udsnittet, når den lukker eller skifter emne.
    fanefilter: function (fn) { V.fanefilter(fn); },
    tilpas: function () { V.tilpas(null); },
    farvelaeg: function (fn, o) {
      var sel = $("colorBy"), option = sel && sel.querySelector('option[value="ekstern"]');
      if (!fn) {
        eksternFarve = null;
        if (option) option.textContent = "Fra sporet";
        if (V.farveTilstandNu() === "ekstern") V.farveTilstandVis("material");
        return;
      }
      // Et opslag kan være pr. indeks (standard) eller pr. Revit-id ({ids:true}; Statik og Lyd regner i id'er).
      var f = typeof fn === "function" ? fn : (o && o.ids ? function (rec) { return fn[rec.data.id] || null; } : function (rec, i) { return fn[i] != null ? fn[i] : (fn[rec.data.id] || null); });
      eksternFarve = {farve: f, legend: o && o.legend, titel: (o && o.titel) || "Fra sporet"};
      if (option) option.textContent = eksternFarve.titel;
      V.farveTilstandVis("ekstern");   // forklaringen (legend) står i bundlinjen under 3D, aldrig oven på scenen
    },
    konstruktiv: konstruktiv,
    konstruktivFraRevit: function (idx) { var inf = infos()[idx]; return inf ? Vn.konstruktivFraRevit(inf.ed) : null; },
    lydSted: function () {
      var d = V.data(), rum = null; V.valgte().forEach(function (i) { var r = V.elementer()[i]; if (rum == null && r && r.data.erRum) rum = i; });
      return {rum: rum, placering: (d && d.placering) || null, etage: visning ? visning.status().etage : null};
    },
    visning: {
      tilstand: function () { return visning.tilstand(); }, status: function () { return visning.status(); },
      saet: function (id, valg) { if (id === "opbygning") visOpbygningFor(valg); else visning.saet(id, valg); },
      etage: function (navn) { visning.etage(navn); }, snit: function (andel) { visning.snit(andel); },
      klip: function (side, v) { visning.klip(side, v); }, klipOmValgte: function () { return visning.klipOmValgte(); }, nulstilKlip: function () { visning.nulstilKlip(); },
      boks: function (idx) { return visning.boks(idx); }
    },
    aendringsliste: {
      P: null,
      antal: function () { return A.antalAendringer(); },
      liste: function () { return A.aendringer(); },
      vis: function () { A.aabenSkuffe("aendringer"); },
      // Sporenes ændringsobjekt {uniqueId, param, til, navn, obj, instans, hvad, af} → listen i arbejdsrum.js (samme form som dens egne rækker)
      tilfoej: function (x) { return A.tilfoej(x); },
      // Værdien lige nu: ændringslisten først, ellers Revits værdi i obj.bygdata.raw
      nu: function (uniqueId, param, obj) { return A.nu({uniqueId: uniqueId, obj: obj || {}}, param); },
      saet: function (idx, param, vaerdi, hvad, paa) { var inf = infos()[idx]; if (!inf) return false; A.saet(A.maal(inf, paa || "element"), param, vaerdi, hvad || "sporet"); return true; },
      data: function (idx, paa) { var inf = infos()[idx]; return inf ? A.dataFor(A.maal(inf, paa || "element")) : null; },
      gemData: function (idx, rec, hvad, paa) { var inf = infos()[idx]; if (!inf) return false; A.gemData(A.maal(inf, paa || "element"), rec, hvad || "sporet"); return true; },
      laegTags: function (idxs, paa, til, fra) { var l = (idxs || []).map(function (i) { return infos()[i]; }).filter(Boolean); if (!l.length) return 0; A.laegTags(l, paa || "element", til || [], fra || []); return l.length; },
      opdater: function () { A.opdater(); renderLag(); renderMindmap(); }
    },
    paa: function (navn, fn) { (lyttere[navn] || (lyttere[navn] = [])).push(fn); },
    aabnPanel: aabnPanel, lukPanel: lukPanel, vaelgPanel: vaelgPanel,
    aktivtPanel: function () { return aktivtPanel; },
    skiftFane: function (id) { V.skiftFane(id); },
    aabenSkuffe: function (id) { aabnPanel(Pn.SKUFFE + id); },
    revit: {erRevit: function () { return V.erRevit(); }, kald: function (m, p, o) { return V.kald(m, p, o); }},
    three: function () { try { return V.three(); } catch (e) { return null; } },   // {THREE, scene, camera, renderer, …}; sporene må tegne egne hjælpere (fx lastpile) og fjerne dem igen
    render: function () { V.render && V.render(); },
    info: function (t) { V.info(t); }, fejl: function (t) { V.fejl(t); }, esc: esc, fmt: function (n, d) { return A.fmt(n, d); }
  };
  window.issanaArbejdsrum = {
    version: "3.0",
    registrerFane: registrerFane,
    registrerPanel: registrerPanel,
    aabnPanel: aabnPanel, lukPanel: lukPanel, vaelgPanel: vaelgPanel,
    api: API,
    klar: false,
    startFejl: startFejl
  };
  // Spor, der indlæses før os, lægger funktioner i window.issanaArbejdsrumVentende; listen deles, så også spor, der kommer
  // til efter os (fx arbejdsrum-statik.js, der henter sine filer asynkront), lander i samme liste. Efter start kaldes nye straks.
  var ventende = window.issanaArbejdsrumVentende = (Array.isArray(window.issanaArbejdsrumVentende) ? window.issanaArbejdsrumVentende : []);

  /* ---------- Start ---------- */
  // Hvert byggetrin kører for sig: ét, der fejler, må ikke fjerne bjælkens knapper, krogene eller kaldene til de ventende spor.
  function trin(navn, fn) {
    try { return fn(); }
    catch (e) { startFejl.push(navn + ": " + ((e && e.message) || e)); console.error("ISSANA 3D-arbejdsrum (start: " + navn + "):", e); return null; }
  }
  function start() {
    V = window.IssanaVisning; A = window.IssanaArbejdsrum;
    if (!V || !A || !Mm || !Vn || !Pn) { console.error("ISSANA 3D-arbejdsrum 3.0: visningen, arbejdsrummet eller paneltilstanden mangler."); return; }
    API.aendringsliste.P = A.P;
    reg = Pn.standardRegister();
    trin("grundlayout", function () {
      document.body.setAttribute("data-bjaelke", lagr("issana-3d-bjaelke-v1") || "lys");
      $("app").classList.add("v3", "no-mid", "no-props", "no-types", "no-params");
    });
    // Rækkefølgen tæller: #arb skal ligge i #v3mid, før bygAi registrerer sit panel (paneler indsættes foran #arb).
    var rail = trin("bjælke", bygRail);
    trin("midterpanel", bygMid);
    trin("bundlinje", bygBund);
    trin("skuffe", flytSkuffe);
    trin("AI-felt", bygAi);
    trin("status", bygStatus);
    trin("luk-knapper", dockLukKnapper);
    trin("visningsvælger", function () { visning = Vn.installer(V, {vedAendring: opdaterVisningsUI, filter: lagPasser}); });

    // Bjælkens faste knapper (rækkefølgen fra skitsen); Måle styrer viewerens egen knap (en tilstand, ikke et panel).
    trin("Mindmap", function () { registrerPanel({id: "mindmap", titel: "Mindmap", ikon: IK.mindmap, monter: monterMindmap, vis: renderMindmap, hint: "Mindmap: modellens struktur (Etage / Type / Familie)"}); });
    trin("Egenskaber", function () { rail.appendChild(railKnap("egenskaber", "Egenskaber", IK.egenskaber, function () { vaelgPanel("egenskaber"); }, "Egenskaber for det valgte (højre panel)")); });
    trin("Søg", function () { registrerPanel({id: "soeg", titel: "Søg", ikon: IK.soeg, monter: monterSoeg, vis: renderMindmap, hint: "Søg i id, typenavn, familie, etage og CCI-kode"}); });
    trin("Lag", function () { registrerPanel({id: "lag", titel: "Lag", ikon: IK.lag, monter: renderLag, vis: renderLag, hint: "Lag: konstruktiv funktion med antal"}); });
    trin("Klip", function () { registrerPanel({id: "klip", titel: "Klip", ikon: IK.klip, monter: renderKlip, vis: renderKlip, hint: "Klip modellen med fire skydere"}); });
    trin("Måle", function () { var ma = railKnap("maale", "Måle", IK.maale, function () { if ($("btnMeasure").disabled) { V.info("Hent modellen først."); return; } $("btnMeasure").click(); synkRailMedApp(); }, "Mål i 3D (M): vælg tilstand i bjælken foroven"); ma.dataset.fast = "1"; rail.appendChild(ma); });
    trin("Indstillinger", function () { registrerPanel({id: "indstillinger", titel: "Indstillinger", ikon: IK.indst, monter: monterIndstillinger, vis: synkFlere}); });
    trin("bjælkens datagruppe", function () {
      rail.appendChild(el("span", {class: "v3-rskille", "aria-hidden": "true"}));
      // Arbejdsrummets skuffe fra 2.12 som knapper: Data, Ændringer, Graf, Sol, Produkter (Lag og filtre nås fra Lag-panelet, Lyd fra fanen Lyd)
      [["data", "Data", IK.data, "Redigér bygningsdata for det valgte (tags, lyd, brand, status …)"], ["aendringer", "Ændringer", IK.aendringer, "Forhåndsvisning af ændringer og «Gem i Revit»"],
        ["graf", "Graf", IK.graf, "Netværksdiagram over bygningsdelene"], ["sol", "Sol", IK.sol, "Sol og skygge"], ["produkter", "Produkter", IK.produkter, "Produktforslag"]].forEach(function (x) { rail.appendChild(skuffeKnap(x[0], x[1], x[2], x[3])); });
      rail.appendChild(el("span", {class: "v3-rspacer", "aria-hidden": "true"}));
    });
    trin("Opbygning", function () { registrerPanel({id: "opbygning", titel: "Opbygning", ikon: IK.opbygning, monter: renderOpbygning, vis: renderOpbygning, skjult: true}); });

    // Farvetilstande: Konstruktiv funktion og sporenes egen («ekstern»)
    trin("farvetilstande", function () {
      V.farveTilstand({id: "konstruktiv", titel: "Konstruktiv funktion", farve: function (rec, i) { if (!rec || rec.data.erRum || !Vn.erKonstruktivKategori(rec.data.category)) return null; return Vn.KONSTRUKTIV_FARVE[konstruktiv(i)] || null; }, legend: konstruktivLegend});
      V.farveTilstand({id: "ekstern", titel: "Fra sporet", farve: function (rec, i) { return eksternFarve && eksternFarve.farve ? eksternFarve.farve(rec, i) : null; }, legend: function () { return eksternFarve && eksternFarve.legend ? eksternFarve.legend() : (eksternFarve ? "<h4>" + esc(eksternFarve.titel) + "</h4>" : ""); }});
      var sel = $("colorBy"); if (sel) { var ek = sel.querySelector('option[value="ekstern"]'); if (ek) ek.hidden = true; }
    });

    // Kroge
    trin("kroge", function () {
      V.paa("model", vedModel);
      V.paa("valg", function (liste) { vedValg(liste); });
      V.paa("filter", function () { opdaterValgUI(); });
      V.paa("fane", vedFane);
      A.paa("aendringer", function (n) { opdaterStatus(n); renderLag(); if (V.farveTilstandNu() === "konstruktiv") V.farveTilstandVis("konstruktiv"); });
      A.paa("gemt", vedGemt);
      A.paa("skuffe", vedSkuffe);
    });
    trin("måle-synkronisering", function () { new MutationObserver(synkRailMedApp).observe($("app"), {attributes: true, attributeFilter: ["class"]}); });
    // Dobbeltklik i 3D: isolér elementet og vis opbygningen
    try { V.three().renderer.domElement.addEventListener("dblclick", function () { if (V.valgte().length) visOpbygningFor(V.valgte()[0]); }); } catch (e) {}
    // Esc i 3D lukker Opbygning tilbage til Hele
    window.addEventListener("keydown", function (e) { if (e.key === "Escape" && visning && visning.tilstand() === "opbygning" && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) visning.saet("hele"); });

    // Faner og paneler, der blev registreret før start (sporene indlæses før os)
    tidlige.splice(0).forEach(function (t) { trin(t[0] + " " + t[1].id, function () { (t[0] === "fane" ? registrerFane : registrerPanel)(t[1]); }); });
    window.issanaArbejdsrum.klar = true;
    trin("panelstørrelse", function () { if (window.IssanaPanelStoerrelse) window.IssanaPanelStoerrelse.installer($("workspace")); });
    // Start rent: intet panel åbent. Står html'en allerede på en anden fane, følger tilstanden den.
    trin("første visning", function () { aktivtPanel = Pn.vedFane(null, V.aktivFane(), reg); anvend(); });
    trin("model", function () { if (V.data()) vedModel(); });
    var kald = function (fn) { try { fn(window.issanaArbejdsrum); } catch (e) { console.error(e); } };
    ventende.splice(0).forEach(kald);
    ventende.push = function (fn) { kald(fn); return 0; };   // sene spor kaldes med det samme
    try { document.dispatchEvent(new CustomEvent("issana-arbejdsrum-klar", {detail: window.issanaArbejdsrum})); } catch (e) {}
    // Brugeren skal kunne se, at noget mangler; detaljerne står i konsollen og i window.issanaArbejdsrum.startFejl.
    if (startFejl.length) trin("fejlbesked", function () { V.fejl("ISSANA 3D: " + startFejl.length + " del" + (startFejl.length === 1 ? "" : "e") + " af arbejdsrummet kunne ikke starte. Detaljer i konsollen (F12)."); });
  }
  if (window.IssanaVisning && window.IssanaArbejdsrum) start();
  else {
    // Visningen starter asynkront (three.js indlæses først); arbejdsrum.js har hægtet sig på issanaVisningKlar. Vi kæder os på.
    // Fejler arbejdsrum.js dér, skal layoutet stadig starte; ellers er bjælken tom igen.
    var forrige = window.issanaVisningKlar;
    window.issanaVisningKlar = function (api) {
      if (typeof forrige === "function") { try { forrige(api); } catch (e) { startFejl.push("arbejdsrum: " + ((e && e.message) || e)); console.error("ISSANA 3D-arbejdsrum (arbejdsrum.js):", e); } }
      setTimeout(start, 0);
    };
  }
})();
