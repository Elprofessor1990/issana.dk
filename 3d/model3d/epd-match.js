/* ============================================================
   ISSANA 3D: EPD-match for byggevarer (epd-match.js)

   Rent modul uden DOM. I browseren: window.IssanaEpdMatch; i Node: module.exports.
   Et lags materialenavn fra Revit (ofte engelsk: «Concrete Masonry Units», «Gypsum Wall Board», «Mineral Wool», «Brick»)
   → kandidater i BR18 bilag 2 tabel 7 (2025) (data/br18-tabel-7-2025.json) gennem den redigerbare synonymliste
   epd-synonymer.json. Score 0–1, top-3 med begrundelse. Mængden regnes af lagets tykkelse × konstruktionens areal (m³) eller
   areal (m²) efter datasættets deklarerede enhed; kg/ton omregnes KUN med tabellens egen mass_factor; «m² with R=1 m²K/W»
   (isolering) kun når λ står i datasættets navn («kl. 37» = 0,037 W/mK); ellers «mangler omregning». Ingen tal opfindes.
   Resultatet er altid et FORSLAG (status proposed) med kilde «BR18 bilag 2 tabel 7 (2025), datasæt <id>» og match_score;
   et produktbibliotek eller koblet ISSANA-data med rigtige EPD'er foretrækkes af ai-lca.js; tabel 7 er reserven, mærket generisk.
   ============================================================ */
(function (rod, fabrik) {
  "use strict";
  var api = fabrik();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else if (rod) rod.IssanaEpdMatch = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var KILDE_NAVN = "BR18 bilag 2 tabel 7 (2025)";
  var TYPE_VAEGT = { "Dansk generisk data": 1, "Branche data": 0.95, "Generisk data": 0.85, "Standardværdi": 0.5 };

  function erTal(v) { return typeof v === "number" && isFinite(v); }
  function rund(n, d) { var f = Math.pow(10, d == null ? 3 : d); return Math.round(n * f) / f; }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[_\-\/\.,()]+/g, " ").replace(/\s+/g, " ").trim(); }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function indeholderOrd(navn, syn) {
    // Ordgrænse i begge ender (så «eps» ikke rammer «steps»); et synonym på 5+ tegn må også stå forrest i et sammensat ord
    // («betondæk», «teglvæg», «gipsvæg»), som dansk gør det.
    if (new RegExp("(^|[^a-zæøå0-9])" + escRe(syn) + "($|[^a-zæøå0-9])").test(navn)) return true;
    return syn.length >= 5 && new RegExp("(^|[^a-zæøå0-9])" + escRe(syn)).test(navn);
  }

  /* ---------- Tabel 7 ---------- */
  function datasaetAf(tabel, id) {
    var liste = tabel && tabel.materials || [];
    for (var i = 0; i < liste.length; i++) if (liste[i].id === id) return liste[i];
    return null;
  }
  function soeg(tabel, moenster) {
    if (!moenster) return [];
    var re = new RegExp(moenster, "i");
    return (tabel && tabel.materials || []).filter(function (m) { return re.test(m.name_da || ""); });
  }

  /* ---------- Materialenavn → gruppe ---------- */
  // → [{gruppe, score, synonym}] sorteret efter score. Score = dækning af navnet (synonymets længde / navnets længde, højst 1)
  // vægtet så et længere synonym («concrete masonry») slår et kortere («concrete»).
  function grupperFor(materiale, synonymer) {
    var navn = norm(materiale), hits = [];
    if (!navn) return hits;
    (synonymer && synonymer.grupper || []).forEach(function (g) {
      var bedst = null;
      (g.navne || []).forEach(function (s) {
        var syn = norm(s); if (!syn || !indeholderOrd(navn, syn)) return;
        var score = Math.min(1, 0.55 + 0.45 * (syn.length / navn.length));
        if (syn === navn) score = 1;
        if (!bedst || score > bedst.score || (score === bedst.score && syn.length > bedst.synonym.length)) bedst = { gruppe: g, score: rund(score), synonym: s };
      });
      if (bedst) hits.push(bedst);
    });
    hits.sort(function (a, b) { return b.score - a.score || b.synonym.length - a.synonym.length; });
    return hits;
  }

  /* ---------- Mængde efter datasættets enhed ---------- */
  // lag: {tykkelseMm, areal (m²)} → {maengde, enhed, omregning, mangler}
  function maengde(lag, ds) {
    var enhed = String(ds && ds.declared_unit || "").trim(), tyk = erTal(lag.tykkelseMm) ? lag.tykkelseMm / 1000 : null, areal = erTal(lag.areal) ? lag.areal : null;
    var faktor = erTal(ds && ds.declared_factor) && ds.declared_factor > 0 ? ds.declared_factor : 1;
    if (areal == null) return { maengde: null, enhed: enhed, mangler: "mangler areal" };
    var vol = tyk != null ? tyk * areal : null;
    var r = function (q, e, om) { return { maengde: rund(q / faktor), enhed: e, omregning: om || null }; };
    if (enhed === "m³") return vol == null ? { maengde: null, enhed: "m³", mangler: "mangler tykkelse på laget" } : r(vol, "m³", "tykkelse × areal");
    if (enhed === "m²") return r(areal, "m²", "areal");
    if (enhed === "kg" || enhed === "ton") {
      var mf = ds.mass_factor, mu = String(ds.mass_unit || "");
      if (!erTal(mf) || mf <= 0) return { maengde: null, enhed: enhed, mangler: "mangler omregning (ingen massefaktor i tabellen)" };
      var kg = null, om = null;
      if (mu === "kg/m³" && vol != null) { kg = vol * mf; om = "tykkelse × areal × " + mf + " kg/m³"; }
      else if (mu === "ton/m³" && vol != null) { kg = vol * mf * 1000; om = "tykkelse × areal × " + mf + " t/m³"; }
      else if (mu === "kg/m²") { kg = areal * mf; om = "areal × " + mf + " kg/m²"; }
      else if (mu === "kg/m²/mm" && tyk != null) { kg = areal * mf * tyk * 1000; om = "areal × tykkelse(mm) × " + mf + " kg/m²/mm"; }
      else return { maengde: null, enhed: enhed, mangler: vol == null && /m³|\/mm/.test(mu) ? "mangler tykkelse på laget" : "mangler omregning (" + mu + ")" };
      return enhed === "ton" ? r(kg / 1000, "ton", om + " ÷ 1000") : r(kg, "kg", om);
    }
    if (/^m² with R=1/.test(enhed)) {
      var kl = /kl\.?\s*(\d{2})/i.exec(ds.name_da || "");
      if (!kl) return { maengde: null, enhed: enhed, mangler: "mangler omregning (λ står ikke i datasættet; enheden er m² ved R=1)" };
      if (tyk == null) return { maengde: null, enhed: enhed, mangler: "mangler tykkelse på laget" };
      var lambda = Number(kl[1]) / 1000;
      return r(areal * tyk / lambda, enhed, "areal × tykkelse ÷ λ (kl. " + kl[1] + " = " + lambda + " W/mK)");
    }
    return { maengde: null, enhed: enhed, mangler: "mangler omregning (enheden «" + enhed + "» kan ikke udledes af tykkelse og areal)" };
  }

  /* ---------- Match for ét lag ---------- */
  // lag: {materiale, funktion?, tykkelseMm, areal}. → {status:'match'|'ignorer'|'ingen', kandidater:[{id, navn, score, begrundelse,
  //   enhed, gwp:{A1A3,C3,C4,D}, maengde, maengdeEnhed, omregning, mangler, dataType, kilde}], gruppe}
  // Et lag af stolper, lægter o.l. er ikke massivt. Et automatisk forslag ville regne hele lagets tykkelse som massivt materiale
  // (en «Metal Stud Layer» på 45 mm gav 267 ton stål i testmodellen). Brugeren vælger selv datasæt og sætter «Gentaget» (b og c-c).
  var GENTAGET_LAG = /\bstuds?\b|stolpe|reglar|skelet|lægte|\bbattens?\b|furring|\bjoists?\b|bjælkelag|spærlag/i;
  function erGentagetLag(navn) { return GENTAGET_LAG.test(String(navn || "")); }
  function match(lag, tabel, synonymer, valg) {
    valg = valg || {};
    if (!valg.manuel && erGentagetLag(lag.materiale)) return { status: "ingen", kandidater: [], gruppe: null, gentaget: true, begrundelse: "«" + lag.materiale + "» er et gentaget lag (stolper, lægter) og ikke massivt. Vælg datasæt selv, og sæt «Gentaget» med bredde og c-c." };
    var antal = valg.antal || 3, grupper = grupperFor(lag.materiale, synonymer);
    if (!grupper.length) return { status: "ingen", kandidater: [], gruppe: null, begrundelse: "«" + (lag.materiale || "(uden materiale)") + "» matcher intet synonym i epd-synonymer.json; tilføj det der." };
    var top = grupper[0];
    if (top.gruppe.ignorer) return { status: "ignorer", kandidater: [], gruppe: top.gruppe.id, begrundelse: "«" + lag.materiale + "» er " + (top.gruppe.navn || top.gruppe.id).toLowerCase() + "; ingen byggevare." };
    var kandidater = [], set = {};
    var tilfoej = function (ds, rang, hvorfra, grp, gScore) {
      if (!ds || set[ds.key || ds.id]) return; set[ds.key || ds.id] = 1;
      var m = maengde(lag, ds), tv = TYPE_VAEGT[ds.data_type] || 0.8;
      var score = rund(gScore * tv * (1 - 0.06 * rang) * (m.mangler ? 0.9 : 1));
      kandidater.push({ id: ds.id, key: ds.key, navn: ds.name_da, dataType: ds.data_type, enhed: ds.declared_unit, score: score,
        begrundelse: "«" + lag.materiale + "» ≈ " + (grp.navn || grp.id) + " (synonym «" + hvorfra.synonym + "»); " + (rang === 0 ? "gruppens standardvalg" : "kandidat " + (rang + 1)) + " i " + KILDE_NAVN + (m.omregning ? "; mængde = " + m.omregning : "") + (m.mangler ? "; " + m.mangler : ""),
        gwp: { A1A3: erTal(ds.a1a3) ? ds.a1a3 : null, C3: erTal(ds.c3) ? ds.c3 : null, C4: erTal(ds.c4) ? ds.c4 : null, D: erTal(ds.d) ? ds.d : null },
        maengde: m.maengde, maengdeEnhed: m.enhed, omregning: m.omregning || null, mangler: m.mangler || null,
        massefaktor: erTal(ds.mass_factor) ? ds.mass_factor + " " + (ds.mass_unit || "") : null, url: ds.underlying_source_url || null, kilde: KILDE_NAVN + ", datasæt " + ds.id });
    };
    grupper.filter(function (g) { return !g.gruppe.ignorer; }).forEach(function (hit, gi) {
      var g = hit.gruppe, gScore = hit.score * (gi === 0 ? 1 : 0.7), rang = 0;
      (g.datasaet || []).forEach(function (id) { tilfoej(datasaetAf(tabel, id), rang++, hit, g, gScore); });
      if (kandidater.length < antal) soeg(tabel, g.moenster).forEach(function (ds) { if (kandidater.length < antal + 3) tilfoej(ds, rang++, hit, g, gScore); });
    });
    kandidater.sort(function (a, b) { return b.score - a.score; });
    return { status: kandidater.length ? "match" : "ingen", kandidater: kandidater.slice(0, antal), gruppe: top.gruppe.id, begrundelse: kandidater.length ? null : "gruppen «" + top.gruppe.id + "» peger på datasæt, der ikke findes i tabellen." };
  }

  /* ---------- Byggevare-post til dataposten (status proposed) ---------- */
  // kandidat fra match() + byggevaren fra ai-lca.js' struktur → feltet lca.byggevarer[<lag-id>] i typens datapost.
  function post(kandidat, byggevare, valg) {
    valg = valg || {};
    return {
      lag: byggevare.id, materiale: byggevare.materiale || byggevare.navn || null, funktion: byggevare.funktion || null, tykkelseMm: byggevare.tykkelseMm != null ? byggevare.tykkelseMm : null,
      datasaet: kandidat.id, datasaetKey: kandidat.key || null, navn: kandidat.navn, enhed: kandidat.enhed, gwp: kandidat.gwp,
      maengde: kandidat.maengde, maengdeEnhed: kandidat.maengdeEnhed, omregning: kandidat.omregning, mangler: kandidat.mangler,
      kilde: kandidat.kilde, kildeType: "br18-tabel7", generisk: true, match_score: kandidat.score, begrundelse: kandidat.begrundelse,
      status: valg.status || "proposed", af: valg.af || "AI", dato: valg.dato || null
    };
  }

  /* ---------- Hele strukturen ---------- */
  // struktur fra ai-lca.js bygLcaStruktur → ét forslag pr. byggevare uden EPD; byggevarer uden lagopbygning får en «opbygning
  // mangler»-post (ingen kandidat), luft ignoreres. → {forslag:[{typeId, typeNavn, bygningsdel, konstruktion, byggevare, kandidat, post,
  //   status:'match'|'ingen'|'opbygning_mangler'|'ignorer'}], tal:{byggevarer, match, ingen, opbygningMangler, ignoreret, manglerOmregning}}
  function forslagForStruktur(struktur, tabel, synonymer, valg) {
    valg = valg || {};
    var ud = { forslag: [], tal: { byggevarer: 0, match: 0, ingen: 0, opbygningMangler: 0, ignoreret: 0, manglerOmregning: 0, allerede: 0 } };
    (struktur && struktur.bygningsdele || []).forEach(function (d) {
      d.konstruktioner.forEach(function (k) {
        k.byggevarer.forEach(function (b) {
          if (b.medregnes === false) { ud.tal.ignoreret++; return; }
          ud.tal.byggevarer++;
          var f = { typeId: k.typeId, typeNavn: k.navn, kategori: k.kategori, bygningsdel: d.navn, bygningsdelId: d.id, konstruktion: k.navn, byggevare: b, kandidat: null, kandidater: [], post: null, status: null };
          if (b.status === "har" && !valg.ogsaaMedData) { f.status = "har"; ud.tal.allerede++; ud.forslag.push(f); return; }
          var m = match({ materiale: b.materiale || b.navn, funktion: b.funktion, tykkelseMm: b.tykkelseMm, areal: k.areal }, tabel, synonymer, valg);
          if (b.opbygningMangler) {
            // Ingen lag i Revit-typen: materialet kan højst udledes af typens NAVN («Betondæk 220 mm»); det er et svagere match.
            ud.tal.opbygningMangler++;
            if (m.status !== "match") { f.status = "opbygning_mangler"; f.begrundelse = "Typen «" + k.navn + "» har ingen lagopbygning i Revit, og navnet matcher intet materiale; byggevarer kan ikke udledes. Tilføj lag i typen, eller knyt et produkt/en EPD til hele typen (saet_lca)."; ud.forslag.push(f); return; }
            m.kandidater.forEach(function (c) { c.score = Math.round(c.score * 0.7 * 1000) / 1000; c.begrundelse = "Typen har ingen lagopbygning; materialet er udledt af typenavnet «" + k.navn + "». " + c.begrundelse; });
          }
          f.status = m.status; f.kandidater = m.kandidater; f.gruppe = m.gruppe; f.begrundelse = m.begrundelse;
          if (m.status === "match") { f.kandidat = m.kandidater[0]; f.post = post(f.kandidat, b, valg); ud.tal.match++; if (f.kandidat.mangler) ud.tal.manglerOmregning++; }
          else if (m.status === "ignorer") ud.tal.ignoreret++;
          else ud.tal.ingen++;
          ud.forslag.push(f);
        });
      });
    });
    return ud;
  }

  // Dækning: hvor mange af tabel 7's datasæt synonymlisten kan nå (direkte id eller mønster), og hvilke materialenavne der ikke matcher.
  function daekning(tabel, synonymer, materialer) {
    var set = {};
    (synonymer && synonymer.grupper || []).forEach(function (g) { (g.datasaet || []).forEach(function (id) { set[id] = 1; }); soeg(tabel, g.moenster).forEach(function (ds) { set[ds.id] = 1; }); });
    var alle = (tabel && tabel.materials || []).length, naaet = Object.keys(set).filter(function (id) { return datasaetAf(tabel, id); }).length;
    var uden = (materialer || []).filter(function (m) { var g = grupperFor(m, synonymer); return !g.length; });
    return { datasaet: alle, naaet: naaet, andel: alle ? rund(naaet / alle) : 0, udenMatch: uden };
  }

  return { KILDE_NAVN: KILDE_NAVN, grupperFor: grupperFor, maengde: maengde, match: match, post: post, forslagForStruktur: forslagForStruktur, daekning: daekning, datasaetAf: datasaetAf, soeg: soeg };
});
