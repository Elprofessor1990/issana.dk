/* ISSANA 3D: brugerens egne LCAbyg-eksporter som lokalt bibliotek (byggevarer med faser og konstruktionsopbygninger).
   Læser LCAbygs åbne JSON (graf med Node og Edge: projekt-JSON, .lb5cstr, .lb5elm). Krypterede filer (.lb5, .lb5epd) læses ikke.
   Biblioteket ligger kun på brugerens pc (Model3dLca.Bibliotek: %LOCALAPPDATA%\ISSANA\LCA\bibliotek) og følger aldrig med installationen.
   Regnemåde (LCAbygs brugervejledning, tabel 2.7): værdi pr. indikatorenhed = indikator × skaleringsfaktor ÷ indikatorfaktor.
   En mængde i faseenheden ganges med enhedsfaktoren; kg divideres med massefaktoren (kg pr. indikatorenhed).
   I browseren: window.IssanaLcabygBibliotek; i Node: module.exports. */
(function (root, lav) {
  var api = lav();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else root.IssanaLcabygBibliotek = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var SCHEMA = "issana-lcabyg-bibliotek/1";
  var ENHED = { M3: "m³", M2: "m²", M: "m", KG: "kg", TON: "ton", PCS: "stk", STK: "stk" };
  var KODE = { "m³": "m3", "m²": "m2", m: "m", stk: "stk", kg: "kg", ton: "ton" };
  var FASE = { A1TO3: "A1A3", C3: "C3", C4: "C4", D: "D" };
  function erTal(v) { return typeof v === "number" && isFinite(v); }
  function enhed(u) { return ENHED[String(u == null ? "" : u).toUpperCase()] || null; }
  function navn(n) { return n == null ? "" : typeof n === "string" ? n : String(n.Danish || n.English || n.German || ""); }
  function positiv(v, std) { return erTal(v) && v > 0 ? v : std; }

  function faseAf(s) {
    var f = FASE[String(s.stage || "").toUpperCase()], gwp = s.indicators && s.indicators.GWP, ie = enhed(s.indicator_unit);
    if (!f || !erTal(gwp) || !ie) return null;
    return { fase: f, enhed: ie, faseEnhed: enhed(s.stage_unit) || ie, vaerdi: gwp * positiv(s.scale_factor, 1) / positiv(s.indicator_factor, 1),
      enhedsfaktor: positiv(s.stage_factor, 1), masse: positiv(s.mass_factor, null), udloeb: s.valid_to || null, kilde: s.external_source || null,
      eksternId: s.external_id || null, url: /^https?:/i.test(String(s.external_url || "")) ? s.external_url : null, standard: s.compliance || null, datatype: s.data_type || null };
  }
  // Alle faser i A1-A3's enhed. En fase i en anden enhed regnes om med massefaktorerne; kan det ikke lade sig gøre, tæller den ikke med.
  function produktAf(p, faser) {
    var a = faser.filter(function (f) { return f.fase === "A1A3"; })[0];
    if (!a) return { sprunget: "mangler A1-A3" };
    var gwp = { A1A3: a.vaerdi, C3: null, C4: null, D: null };
    faser.forEach(function (f) {
      if (f.fase === "A1A3") return;
      if (f.enhed === a.enhed) gwp[f.fase] = f.vaerdi;
      else if (f.masse && a.masse) gwp[f.fase] = f.vaerdi * a.masse / f.masse;
    });
    if (gwp.C3 == null && gwp.C4 == null) return { sprunget: "mangler C3 og C4" };
    return { id: p.id, navn: navn(p.name), kilde: p.source || null, enhed: a.enhed, faseEnhed: a.faseEnhed, enhedsfaktor: a.enhedsfaktor, masse: a.masse, gwp: gwp,
      udloeb: a.udloeb, programoperatoer: a.kilde, registreringsnr: a.eksternId, url: a.url, standard: a.standard, datatype: a.datatype };
  }
  // 1 enhed af linjens enhed = så mange deklarerede enheder; null = kan ikke regnes om.
  function omregning(u, p) {
    if (u === p.enhed) return 1;
    if (u === p.faseEnhed) return p.enhedsfaktor;
    if (u === "kg" && p.masse) return 1 / p.masse;
    if (u === "ton" && p.masse) return 1000 / p.masse;
    return null;
  }

  // tekst: filens indhold → {fil, produkter, konstruktioner, sprunget} eller {fejl}.
  function laes(tekst, filnavn) {
    var s = String(tekst == null ? "" : tekst).replace(/^﻿/, ""), data;
    try { data = JSON.parse(s); } catch (e) { return { fejl: /\.lb5(epd)?$/i.test(String(filnavn || "")) ? "filen er krypteret af LCAbyg. Eksportér projektet som JSON fra LCAbyg, og vælg den fil." : "filen er ikke JSON." }; }
    if (!Array.isArray(data)) return { fejl: data && Array.isArray(data.model) ? "filen er en kontoeksport, hvor biblioteksdata kun står som referencer. Eksportér projektet som JSON-fil fra LCAbyg." : "filen er ikke en LCAbyg-eksport." };
    var noder = {}, kanter = [];
    data.forEach(function (x) {
      if (x && x.Node) { var t = Object.keys(x.Node)[0], d = x.Node[t]; if (d && d.id) noder[d.id] = { t: t, d: d }; }
      else if (x && Array.isArray(x.Edge) && x.Edge[0]) { var k = Object.keys(x.Edge[0])[0]; kanter.push({ t: k, d: x.Edge[0][k] || {}, a: x.Edge[1], b: x.Edge[2] }); }
    });
    function af(type) { return Object.keys(noder).map(function (i) { return noder[i]; }).filter(function (n) { return n.t === type; }).map(function (n) { return n.d; }); }
    var produktNoder = af("Product"), konstruktionNoder = af("Construction");
    if (!produktNoder.length && !konstruktionNoder.length) return { fejl: "filen har hverken byggevarer eller konstruktioner." };
    var faser = {}, sprunget = [];
    kanter.filter(function (k) { return k.t === "ProductToStage" && k.d.enabled !== false; }).forEach(function (k) {
      var p = noder[k.a] && noder[k.a].t === "Product" ? k.a : k.b, sn = noder[k.a] && noder[k.a].t === "Stage" ? noder[k.a] : noder[k.b];
      var f = sn && sn.t === "Stage" ? faseAf(sn.d) : null;
      if (f) (faser[p] = faser[p] || []).push(f);
    });
    var produkter = {};
    produktNoder.forEach(function (p) {
      var ud = produktAf(p, faser[p.id] || []);
      if (ud.sprunget) sprunget.push({ navn: navn(p.name), grund: ud.sprunget }); else produkter[p.id] = ud;
    });
    var konstruktioner = konstruktionNoder.map(function (c) {
      var linjer = [], udeladt = 0;
      kanter.filter(function (k) { return k.t === "ConstructionToProduct" && k.d.enabled !== false && (k.a === c.id || k.b === c.id); }).forEach(function (k) {
        var pid = k.a === c.id ? k.b : k.a, u = enhed(k.d.unit);
        if (!erTal(k.d.amount) || k.d.amount <= 0) return;
        if (!produkter[pid] || !u || omregning(u, produkter[pid]) == null) { udeladt++; return; }
        linjer.push({ produkt: pid, maengde: k.d.amount, enhed: u, levetid: positiv(k.d.lifespan, null), nedrivning: !!k.d.demolition, forskudt: positiv(k.d.delayed_start, 0) });
      });
      return { id: c.id, navn: navn(c.name), enhed: enhed(c.unit), kilde: c.source || null, kommentar: navn(c.comment) || null, linjer: linjer, udeladt: udeladt };
    });
    // En projekteksport gemmer kun brugerens egne byggevarer; resten er henvisninger til LCAbygs bibliotek. En opbygning med huller ville give for lav CO₂.
    var hele = konstruktioner.filter(function (c) { return c.enhed && c.linjer.length && !c.udeladt; });
    var liste = Object.keys(produkter).map(function (i) { return produkter[i]; });
    if (!liste.length) return { fejl: "ingen byggevarer med A1-A3 og en C-fase i filen. LCAbygs egne byggevarer står kun som henvisninger i en projekteksport; eksportér konstruktionen som komponentfil i stedet." };
    return { fil: String(filnavn || "eksport"), produkter: liste, konstruktioner: hele, ufuldstaendige: konstruktioner.length - hele.length, sprunget: sprunget };
  }

  function produktNoegle(p) { return [p.navn, p.enhed, p.gwp.A1A3, p.gwp.C3, p.gwp.C4, p.gwp.D].join("|"); }
  function konstruktionNoegle(k) { return [k.navn, k.enhed].concat(k.linjer.map(function (l) { return [l.produkt, l.maengde, l.enhed, l.levetid].join("/"); }).sort()).join("|"); }
  // Lægger en eksport i biblioteket; samme byggevare eller opbygning fra flere filer står der kun én gang.
  function flet(bib, eksport, nu) {
    var ud = bib && bib.schema === SCHEMA ? { schema: SCHEMA, opdateret: bib.opdateret, filer: bib.filer.slice(), produkter: bib.produkter.slice(), konstruktioner: bib.konstruktioner.slice() } : { schema: SCHEMA, opdateret: null, filer: [], produkter: [], konstruktioner: [] };
    var pNoegler = {}, kNoegler = {}, nyId = {}, nyeP = 0, nyeK = 0;
    ud.produkter.forEach(function (p) { pNoegler[produktNoegle(p)] = p.id; });
    ud.konstruktioner.forEach(function (k) { kNoegler[konstruktionNoegle(k)] = 1; });
    eksport.produkter.forEach(function (p) {
      var n = produktNoegle(p);
      if (pNoegler[n]) { nyId[p.id] = pNoegler[n]; return; }
      pNoegler[n] = p.id; nyId[p.id] = p.id; ud.produkter.push(p); nyeP++;
    });
    eksport.konstruktioner.forEach(function (k) {
      var kopi = Object.assign({}, k, { linjer: k.linjer.map(function (l) { return Object.assign({}, l, { produkt: nyId[l.produkt] || l.produkt }); }) }), n = konstruktionNoegle(kopi);
      if (kNoegler[n]) return;
      kNoegler[n] = 1; ud.konstruktioner.push(kopi); nyeK++;
    });
    ud.opdateret = nu || new Date().toISOString();
    ud.filer = ud.filer.filter(function (f) { return f.navn !== eksport.fil; }).concat([{ navn: eksport.fil, hentet: ud.opdateret, produkter: eksport.produkter.length, konstruktioner: eksport.konstruktioner.length }]);
    return { bibliotek: ud, nyeProdukter: nyeP, nyeKonstruktioner: nyeK };
  }

  // Byggevaren som post i EPD-listen (samme felter som en EPD-database), så den kan bruges som byggevarens egen EPD.
  // En manglende C-fase er 0 som i LCAbyg og står som scenarie; en manglende D regnes med 0 efter vejledningens anbefaling.
  function epdPost(p) {
    var a2 = p.standard === "A2", g = p.gwp;
    return { navn: p.navn, producent: p.kilde, enhed: p.enhed, densitet: p.enhed === "m³" ? p.masse : null, gwp: { A1A3: g.A1A3, C3: g.C3 == null ? 0 : g.C3, C4: g.C4 == null ? 0 : g.C4, D: g.D },
      registreringsnr: p.registreringsnr, programoperatoer: p.programoperatoer, url: p.url, udstedt: null, udloeb: p.udloeb, verificeret: "unknown", en15804: p.standard === "A1" || a2 ? p.standard : "unknown",
      gwpIndikator: a2 ? "GWP-total" : p.standard === "A1" ? "GWP" : "unknown", type: p.datatype === "Specific" ? "product" : p.datatype === "Average" ? "branch" : "unknown", omregnet: "fra LCAbyg-eksport",
      scenarieC3: g.C3 == null ? "LCAbyg-eksporten har ingen C3-fase; regnet som 0 som i LCAbyg." : null, scenarieC4: g.C4 == null ? "LCAbyg-eksporten har ingen C4-fase; regnet som 0 som i LCAbyg." : null, dNul: g.D == null };
  }
  function somEpdDatabase(bib) {
    return { navn: "LCAbyg-bibliotek", fil: "dine LCAbyg-eksporter", bibliotek: true, epd: (bib && bib.produkter || []).map(epdPost) };
  }
  function produktPost(p) {
    var x = epdPost(p);
    return { kildeType: "bruger-epd", navn: x.navn, enhed: x.enhed, densitet: x.densitet, materiale: x.navn, kildeTekst: "LCAbyg-eksport i brugerens lokale bibliotek" + (p.kilde ? " (kilde i LCAbyg: " + p.kilde + ")" : ""), gwp: x.gwp,
      epd: { registreringsnr: x.registreringsnr, programoperatoer: x.programoperatoer, producent: x.producent, url: x.url, placering: "LCAbyg-eksport", verificeret: x.verificeret, en15804: x.en15804, gwpIndikator: x.gwpIndikator, type: x.type,
        udstedt: null, udloeb: x.udloeb, anvendt: null, scenarieC3: x.scenarieC3, scenarieC4: x.scenarieC4, daekker: false, dNul: x.dNul } };
  }
  // Konstruktionens opbygning, klar til LCA-projektet: mængderne pr. enhed konstruktion i EPD'ens enhed. Selvstændig, så den virker uden biblioteket.
  function opbygning(bib, id) {
    var k = (bib && bib.konstruktioner || []).filter(function (x) { return x.id === id; })[0];
    if (!k) return null;
    var pr = {}; bib.produkter.forEach(function (p) { pr[p.id] = p; });
    var linjer = [];
    k.linjer.forEach(function (l) {
      var p = pr[l.produkt], f = p ? omregning(l.enhed, p) : null;
      if (f == null) return;
      linjer.push({ navn: p.navn, maengde: l.maengde * f, enhed: p.enhed, indtastet: l.maengde, indtastetEnhed: l.enhed, levetid: l.levetid, post: produktPost(p) });
    });
    return { id: k.id, navn: k.navn, enhed: KODE[k.enhed] || k.enhed, kilde: "LCAbyg-bibliotek", linjer: linjer };
  }
  function soegKonstruktioner(bib, q, enhedKode, max) {
    var ord = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    var hits = (bib && bib.konstruktioner || []).filter(function (k) {
      var t = String(k.navn).toLowerCase();
      return (!enhedKode || KODE[k.enhed] === enhedKode) && ord.every(function (o) { return t.indexOf(o) >= 0; });
    });
    return { antal: hits.length, hits: hits.slice(0, max || 30) };
  }
  function produktAfId(bib, id) { return (bib && bib.produkter || []).filter(function (p) { return p.id === id; })[0] || null; }
  // En fuldt beregnet konstruktion fra Model gemmes i samme form som en importeret opbygning.
  // Datasættets eksisterende faseværdier kopieres; der udledes ingen GWP i browseren.
  function fraProjekt(k, projektNavn) {
    if (!k || !(k.maengde > 0) || !(k.byggevarer || []).length) return { fejl: "konstruktionen har ingen brugbar mængde." };
    var prefix = "projekt-" + String(k.id || k.navn || Date.now()).replace(/[^a-z0-9_-]+/gi, "-") + "-", produkter = [], linjer = [];
    (k.byggevarer || []).forEach(function (b, i) {
      var d = b.datasaet || {}, post = (b.ref || {}).post || {}, g = post.gwp || d.gwp || {}, u0 = d.enhed || b.enhed, u = ENHED[String(u0 || "").toUpperCase()] || u0;
      if (!b.regnet || d.a1a3 == null || !u || !(b.maengde >= 0)) return;
      var id = prefix + i;
      produkter.push({ id: id, navn: d.navn || b.navn, kilde: "Fra projekt " + (projektNavn || "uden navn"), enhed: u, faseEnhed: u, enhedsfaktor: 1,
        masse: post.densitet || d.densitet || null, gwp: { A1A3: d.a1a3, C3: g.C3 == null ? 0 : g.C3, C4: g.C4 == null ? 0 : g.C4, D: g.D == null ? 0 : g.D },
        udloeb: post.epd && post.epd.udloeb || null, programoperatoer: post.epd && post.epd.programoperatoer || null, registreringsnr: d.key || null, url: post.epd && post.epd.url || null, standard: null, datatype: "Specific" });
      linjer.push({ produkt: id, maengde: b.maengde / k.maengde, enhed: u, levetid: b.levetid || null, nedrivning: false, forskudt: 0 });
    });
    if (produkter.length !== k.byggevarer.length) return { fejl: "alle byggevarer skal have bekræftede data og mængder." };
    return { fil: "Fra projekt " + (projektNavn || "uden navn"), produkter: produkter,
      konstruktioner: [{ id: prefix + "opbygning", navn: k.navn, enhed: ENHED[String(k.enhed || "").toUpperCase()] || k.enhed, kilde: "Fra projekt " + (projektNavn || "uden navn"), kommentar: null, linjer: linjer }], ufuldstaendige: 0, sprunget: [] };
  }
  return { SCHEMA: SCHEMA, laes: laes, flet: flet, fraProjekt: fraProjekt, omregning: omregning, epdPost: epdPost, somEpdDatabase: somEpdDatabase, produktPost: produktPost, opbygning: opbygning, soegKonstruktioner: soegKonstruktioner, produktAfId: produktAfId };
});
