/* ============================================================
   ISSANA 3D: valg, samtalehistorik og forslagsliste i AI-feltet (arbejdsrum-ai-valg.js)

   Rent modul uden DOM (returnerer tilstand og HTML-tekst). I browseren: window.IssanaAiValg; i Node: module.exports.
   arbejdsrum-ai.js bruger det, så brugeren aldrig står med et modspørgsmål uden knapper:
   - valg: AI'ens svar må bære valg:[{id, tekst, handling?}] (højst 6) og spoergsmaal. Feltet viser dem som knapper; et klik
     sender valgets tekst som næste besked med valgtId i konteksten (og de sidste 6 ture i historik).
   - historik: ture {rolle:'bruger'|'ai', tekst, valgtId?, valgIds?}; kun de sidste 6 sendes med.
   - forslagsliste: hvert forslag har Brug / Spring over, og «Brug alle» øverst; masseforslag grupperes pr. bygningsdel og type
     med antal, så hundredvis af lag kan godkendes i ét klik. Intet lægges i ændringslisten, før brugeren klikker.
   ============================================================ */
(function (rod, fabrik) {
  "use strict";
  var api = fabrik();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else if (rod) rod.IssanaAiValg = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var MAX_VALG = 6, MAX_HISTORIK = 6, MAX_TEKST = 80;
  // Valg-handlinger, siden selv udfører (uden AI); alt andet sendes til AI'en som ny besked.
  var LOKALE = { aabn_produkter: 1, hent_issana: 1, generisk: 1, lca_status: 1, lca_struktur: 1, lca_beregn: 1, foreslaa_produkt: 1, afbryd: 1 };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }
  function slug(t) { return String(t || "").toLowerCase().replace(/[^a-z0-9æøå]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "valg"; }

  /* ---------- Valg ---------- */
  // AI'ens valg → højst 6 rene valg med id, tekst og evt. handling. Tomme/ugyldige kasseres; dubletter af id får løbenummer.
  function normaliserValg(valg) {
    var ud = [], set = {};
    (Array.isArray(valg) ? valg : []).forEach(function (v) {
      if (ud.length >= MAX_VALG) return;
      if (typeof v === "string") v = { tekst: v };
      if (!v || typeof v !== "object") return;
      var tekst = String(v.tekst || v.text || "").trim(); if (!tekst) return;
      if (tekst.length > MAX_TEKST) tekst = tekst.slice(0, MAX_TEKST - 1) + "…";
      var id = String(v.id || slug(tekst)).trim() || slug(tekst), n = 2, basis = id;
      while (set[id]) id = basis + "_" + n++;
      set[id] = 1;
      var r = { id: id, tekst: tekst };
      if (v.handling && typeof v.handling === "string") r.handling = v.handling.trim().toLowerCase();
      if (v.maal && typeof v.maal === "object") r.maal = v.maal;
      if (v.vaerdi != null) r.vaerdi = v.vaerdi;
      ud.push(r);
    });
    return ud;
  }
  function erLokal(valg) { return !!(valg && valg.handling && LOKALE[valg.handling]); }

  // Et klik på et valg → den næste besked: {tekst, valgtId, lokal, handling}. Lokale handlinger udføres af siden; ellers sendes
  // teksten til AI'en med valgtId og historik i konteksten.
  function valgKlik(valg, id) {
    var v = null; (valg || []).forEach(function (x) { if (x.id === id) v = x; });
    if (!v) return null;
    return { tekst: v.tekst, valgtId: v.id, lokal: erLokal(v), handling: v.handling || null, maal: v.maal || null, vaerdi: v.vaerdi };
  }
  function valgHtml(valg, spoergsmaal) {
    valg = normaliserValg(valg);
    if (!valg.length && !spoergsmaal) return "";
    var h = "";
    if (spoergsmaal) h += "<div class=\"arb-sek\">" + esc(spoergsmaal) + "</div>";
    if (valg.length) h += "<div class=\"arb-row arb-ai-valg\" style=\"flex-wrap:wrap;gap:6px\">" + valg.map(function (v) { return "<button class=\"tbtn\" data-ai-valg=\"" + esc(v.id) + "\" title=\"" + esc(v.handling ? "Handling: " + v.handling : "Sendes til AI'en som næste besked") + "\">" + esc(v.tekst) + "</button>"; }).join("") + "</div>";
    return h;
  }

  /* ---------- Historik ---------- */
  // Tilføjer en tur og beholder kun de sidste MAX_HISTORIK (returnerer en ny liste).
  function historikTilfoej(historik, tur) {
    var l = (Array.isArray(historik) ? historik : []).slice();
    if (tur && tur.rolle && (tur.tekst || tur.valgtId)) {
      var t = { rolle: tur.rolle, tekst: String(tur.tekst || "").slice(0, 400) };
      if (tur.valgtId) t.valgtId = tur.valgtId;
      if (Array.isArray(tur.valgIds) && tur.valgIds.length) t.valgIds = tur.valgIds.slice(0, MAX_VALG);
      if (Array.isArray(tur.handlinger) && tur.handlinger.length) t.handlinger = tur.handlinger.slice(0, 10);
      l.push(t);
    }
    return l.length > MAX_HISTORIK ? l.slice(-MAX_HISTORIK) : l;
  }
  // Det, konteksten får med: historik (højst 6) og valgtId for et klik.
  function kontekstTillaeg(historik, valgtId) {
    var r = { historik: historikTilfoej(historik, null) };
    if (valgtId) r.valgtId = valgtId;
    return r;
  }

  /* ---------- Forslagsliste: Brug / Spring over / Brug alle ---------- */
  // tilstand: {poster:[{i, status:'aaben'|'brugt'|'sprunget'}]}
  function forslagTilstand(forslag) { return { poster: (forslag || []).map(function (f, i) { return { i: i, status: "aaben" }; }) }; }
  function marker(t, i, status) { (t.poster || []).forEach(function (p) { if (p.i === i && p.status === "aaben") p.status = status; }); return t; }
  function brug(t, i) { return marker(t, i, "brugt"); }
  function springOver(t, i) { return marker(t, i, "sprunget"); }
  function aabne(t) { return (t.poster || []).filter(function (p) { return p.status === "aaben"; }).map(function (p) { return p.i; }); }
  function brugAlle(t) { var l = aabne(t); l.forEach(function (i) { brug(t, i); }); return l; }
  function tal(t) { var r = { aabne: 0, brugt: 0, sprunget: 0 }; (t.poster || []).forEach(function (p) { r[p.status === "aaben" ? "aabne" : p.status]++; }); return r; }

  // Gruppering af masseforslag: pr. bygningsdel → pr. type (konstruktion) med antal. forslag[i].gruppe = {bygningsdel, type}.
  function grupper(forslag) {
    var ud = [], idx = {};
    (forslag || []).forEach(function (f, i) {
      var g = f.gruppe || {}, bd = g.bygningsdel || "Øvrige", ty = g.type || g.typeNavn || "";
      var k = bd + "|" + ty, e = idx[k];
      if (!e) { e = idx[k] = { bygningsdel: bd, type: ty, typeId: g.typeId != null ? g.typeId : null, indeks: [] }; ud.push(e); }
      e.indeks.push(i);
    });
    return ud;
  }
  // HTML for listen. tekstAf(f) giver linjens HTML. Små lister (≤ 8, ingen grupper) vises fladt; ellers grupperet med antal.
  function forslagHtml(forslag, t, tekstAf) {
    forslag = forslag || []; t = t || forslagTilstand(forslag);
    if (!forslag.length) return "";
    var n = tal(t), gr = grupper(forslag), grupperet = forslag.length > 8 || gr.some(function (g) { return g.type; });
    var h = "<div class=\"arb-sek\">Forslag: " + forslag.length + (n.brugt ? " · " + n.brugt + " brugt" : "") + (n.sprunget ? " · " + n.sprunget + " sprunget over" : "") + " (intet skrives før du godkender)</div>";
    h += "<div class=\"arb-row\"><button class=\"tbtn primary\" data-ai-brug-alle=\"1\"" + (n.aabne ? "" : " disabled") + ">Brug alle (" + n.aabne + ")</button><button class=\"tbtn\" data-ai-spring-alle=\"1\"" + (n.aabne ? "" : " disabled") + ">Spring resten over</button></div>";
    var linje = function (i) {
      var p = t.poster[i] || { status: "aaben" }, f = forslag[i];
      return "<div class=\"arb-row arb-ai-f\" data-ai-f=\"" + i + "\" data-ai-status=\"" + p.status + "\" style=\"align-items:flex-start;gap:6px" + (p.status !== "aaben" ? ";opacity:.55" : "") + "\"><span style=\"flex:1\">" + (tekstAf ? tekstAf(f, i) : esc(f.handling || "")) + "</span>" +
        (p.status === "aaben" ? "<button class=\"tbtn arb-mini\" data-ai-brug=\"" + i + "\">Brug</button><button class=\"tbtn arb-mini\" data-ai-spring=\"" + i + "\">Spring over</button>" : "<span class=\"arb-kilde\">" + (p.status === "brugt" ? "brugt" : "sprunget over") + "</span>") + "</div>";
    };
    if (!grupperet) forslag.forEach(function (f, i) { h += linje(i); });
    else gr.forEach(function (g, gi) {
      var aab = g.indeks.filter(function (i) { return (t.poster[i] || {}).status === "aaben"; }).length;
      h += "<details class=\"arb-lag\"" + (gi < 3 && forslag.length <= 60 ? " open" : "") + "><summary><b>" + esc(g.bygningsdel) + "</b>" + (g.type ? " · " + esc(g.type) : "") + " · " + g.indeks.length + " forslag" + (aab !== g.indeks.length ? " (" + aab + " åbne)" : "") +
        (aab ? " <button class=\"tbtn arb-mini\" data-ai-brug-gruppe=\"" + gi + "\">Brug gruppen</button>" : "") + "</summary>" + g.indeks.map(linje).join("") + "</details>";
    });
    return h;
  }

  return { MAX_VALG: MAX_VALG, MAX_HISTORIK: MAX_HISTORIK, LOKALE: Object.keys(LOKALE), normaliserValg: normaliserValg, erLokal: erLokal, valgKlik: valgKlik, valgHtml: valgHtml,
    historikTilfoej: historikTilfoej, kontekstTillaeg: kontekstTillaeg, forslagTilstand: forslagTilstand, brug: brug, springOver: springOver, brugAlle: brugAlle, aabne: aabne, tal: tal, grupper: grupper, forslagHtml: forslagHtml, esc: esc };
});
