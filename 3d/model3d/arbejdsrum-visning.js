/* ISSANA 3D (3.0): visningsvælger, Klip og Opbygning.

   Visningsvælgeren nederst i 3D: Hele, Etage (én etage), Snit (etagerne op til den valgte, skåret i en højde
   du styrer med en skyder), Valgte (resten gennemsigtig) og Opbygning (ét element isoleret, lagene trukket fra
   hinanden og skåret trinvis tilbage, nummereret). Klip-panelet: fire skydere (vest, øst, nord, syd) som
   three.js-klipplaner, «Klip om det valgte» med 1 m luft og «Nulstil».

   Den rene udregning (etager og højder fra elementernes bokse, klipplaner fra en boks, de eksploderede lag,
   konstruktiv funktion) ligger på window.IssanaArbejdsrumVisning (module.exports i Node) og testes i
   tests/web-model3d/arbejdsrum-visning.test.mjs. installer(V) kobler den på 3D-visningen (window.IssanaVisning)
   og ændrer kun det, man ser; intet skrives i Revit. Koordinater er modellens: +Y er nord (kompassets standard).
   Indlæses efter arbejdsrum.js; arbejdsrum-layout.js bygger knapperne. */
(function (fabrik) {
  "use strict";
  var api = fabrik();
  if (typeof module === "object" && module && module.exports) { module.exports = api; return; }
  if (typeof window !== "undefined") window.IssanaArbejdsrumVisning = api;
})(function () {
  "use strict";

  /* ---------- Faste værdier ---------- */
  var TILSTANDE = [
    {id: "hele", titel: "Hele", hjaelp: "Hele modellen i fuld højde"},
    {id: "etage", titel: "Etage", hjaelp: "Kun den valgte etage"},
    {id: "snit", titel: "Snit", hjaelp: "Etagerne op til den valgte, skåret i den højde skyderen viser"},
    {id: "valgte", titel: "Valgte", hjaelp: "Kun det, du har valgt; resten er gennemsigtigt"},
    {id: "opbygning", titel: "Opbygning", hjaelp: "Ét element isoleret med lagene trukket fra hinanden"}
  ];
  var UDEN_ETAGE = "(uden etage)";
  var KLIP_SIDER = [["vest", "Vest"], ["oest", "Øst"], ["nord", "Nord"], ["syd", "Syd"]];
  var KLIP_MIN_AFSTAND = 0.5;        // mindst 0,5 m mellem to modstående flader
  var KLIP_TRIN = 0.1;               // skyderne går i 0,1 m
  var LUFT = 1;                      // «Klip om det valgte»: 1 m luft
  var VANDRETTE = {"Gulve": 1, "Tage": 1, "Lofter": 1, "Floors": 1, "Roofs": 1, "Ceilings": 1};   // lagene stables lodret
  var BAERENDE_KAT = {"Vægge": 1, "Gulve": 1, "Tage": 1, "Søjler": 1, "Bjælker": 1};
  // Revits lagfunktioner (CompoundStructureLayer.Function) på dansk
  var ROLLE = {Structure: "Bærende lag", Substrate: "Underlag", Insulation: "Isolering", Finish1: "Overflade, udvendig",
    Finish2: "Overflade, indvendig", Membrane: "Membran", StructuralDeck: "Bærende dæk", None: "Uden funktion"};
  var ROLLE_FARVE = {Structure: "#A3ABAE", Substrate: "#C9C4BA", Insulation: "#E8C76A", Finish1: "#C98E6E", Finish2: "#EFEDE7",
    Membrane: "#5F6E75", StructuralDeck: "#8B9096", None: "#B9B2A6"};
  var KONSTRUKTIV = ["Bærende", "Stabiliserende", "Begge", "Ingen af delene", "Ikke angivet"];
  // Samme farver som Statik (konstruktiv-vaerdier.json): bærende blå, stabiliserende orange, begge mørk. Før var blå og orange byttet om her.
  var KONSTRUKTIV_FARVE = {"Bærende": "#3567A6", "Stabiliserende": "#E3923A", "Begge": "#3A2B6B", "Ingen af delene": "#B4BDC2", "Ikke angivet": "#D6D9D6"};
  // Revits Structural Usage som forslag (vises som «Fra Revit», bruges aldrig som brugerens værdi)
  var REVIT_KONSTRUKTIV = {bearing: "Bærende", "bærende": "Bærende", baerende: "Bærende", shear: "Stabiliserende", stabiliserende: "Stabiliserende",
    combined: "Begge", begge: "Begge", nonbearing: "Ingen af delene", "non-bearing": "Ingen af delene", none: "Ingen af delene", ingen: "Ingen af delene",
    "ingen af delene": "Ingen af delene", "ikke-bærende": "Ingen af delene", "ikke bærende": "Ingen af delene"};

  /* ---------- Små hjælpere ---------- */
  function rund(v, trin) { trin = trin || KLIP_TRIN; return Math.round(v / trin) * trin; }
  function rundNed(v, trin) { trin = trin || KLIP_TRIN; return Math.floor(v / trin + 1e-9) * trin; }
  function rundOp(v, trin) { trin = trin || KLIP_TRIN; return Math.ceil(v / trin - 1e-9) * trin; }
  function pyn(v) { return Math.round(v * 1000) / 1000; }
  function klem(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function sorterEtager(navne) {
    return navne.slice().sort(function (a, b) {
      if (a === UDEN_ETAGE) return 1; if (b === UDEN_ETAGE) return -1;
      return String(a).localeCompare(String(b), "da", {numeric: true});
    });
  }

  /* ---------- Bokse ---------- */
  // Samler bokse {min:[x,y,z], max:[x,y,z]} til én; null hvis ingen.
  function boksUnion(bokse) {
    var r = null;
    (bokse || []).forEach(function (b) {
      if (!b || !b.min || !b.max) return;
      if (!r) { r = {min: b.min.slice(), max: b.max.slice()}; return; }
      for (var k = 0; k < 3; k++) { if (b.min[k] < r.min[k]) r.min[k] = b.min[k]; if (b.max[k] > r.max[k]) r.max[k] = b.max[k]; }
    });
    return r;
  }
  function boksStoerrelse(b) { return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]; }

  /* ---------- Etager ----------
     items: [{idx, etage, boks}]. Etagens z0 er den laveste underkant blandt dens elementer, z1 er næste etages z0
     (ellers etagens højeste overkant). Sorteret efter z0, så «etagerne op til den valgte» følger højden og ikke
     navnet. Elementer uden etage samles sidst og tæller ikke med i snittet. */
  function etager(items) {
    var pr = {};
    (items || []).forEach(function (it) {
      var navn = it.etage || UDEN_ETAGE;
      var e = pr[navn] || (pr[navn] = {navn: navn, idx: [], zMin: Infinity, zMax: -Infinity});
      e.idx.push(it.idx);
      if (it.boks) { if (it.boks.min[2] < e.zMin) e.zMin = it.boks.min[2]; if (it.boks.max[2] > e.zMax) e.zMax = it.boks.max[2]; }
    });
    var liste = Object.keys(pr).filter(function (n) { return n !== UDEN_ETAGE; }).map(function (n) { return pr[n]; });
    liste.sort(function (a, b) {
      var za = isFinite(a.zMin) ? a.zMin : Infinity, zb = isFinite(b.zMin) ? b.zMin : Infinity;
      if (Math.abs(za - zb) > 1e-6) return za - zb;
      return String(a.navn).localeCompare(String(b.navn), "da", {numeric: true});
    });
    var r = liste.map(function (e, i) {
      var z0 = isFinite(e.zMin) ? e.zMin : 0;
      var naeste = liste[i + 1];
      var z1 = naeste && isFinite(naeste.zMin) && naeste.zMin > z0 + 1e-6 ? naeste.zMin : (isFinite(e.zMax) && e.zMax > z0 ? e.zMax : z0 + 3);
      return {navn: e.navn, z0: pyn(z0), z1: pyn(z1), idx: e.idx, nr: i};
    });
    if (pr[UDEN_ETAGE]) r.udenEtage = pr[UDEN_ETAGE].idx;
    return r;
  }
  function etageAf(etagerListe, navn) { for (var i = 0; i < etagerListe.length; i++) if (etagerListe[i].navn === navn) return etagerListe[i]; return null; }

  /* ---------- Snit ----------
     Snithøjden ligger «andel» (0..1) op i etagen; 0 er gulvet, 1 er næste etages gulv. Standard 0,55 (øjenhøjde-
     agtigt). Planen beholder alt under højden: normal (0,0,-1), konstant z, dvs. -z + konstant >= 0. */
  var SNIT_STANDARD = 0.55;
  function snitHoejde(etage, andel) {
    if (!etage) return null;
    var a = klem(andel == null ? SNIT_STANDARD : Number(andel), 0.02, 0.98);
    return pyn(etage.z0 + a * (etage.z1 - etage.z0));
  }
  function snitPlan(z) { return z == null ? null : {normal: [0, 0, -1], konstant: pyn(z), side: "snit"}; }
  // Elementet er med i Snit, når dets etage ligger på eller under den valgte (efter højde). Uden etage: kun hvis
  // elementets boks starter under snithøjden.
  function iSnit(it, etagerListe, valgtNavn, z) {
    var valgt = etageAf(etagerListe, valgtNavn);
    if (!valgt) return true;
    var e = it.etage ? etageAf(etagerListe, it.etage) : null;
    if (e) return e.nr <= valgt.nr;
    return !!(it.boks && z != null && it.boks.min[2] < z);
  }

  /* ---------- Klip ----------
     Klippet er fire lodrette flader: vest = mindste x, øst = største x, syd = mindste y, nord = største y.
     Grænserne er modellens boks rundet udad til 0,1 m. En flade giver kun en plan, når den er trukket ind. */
  function klipGraenser(modelBoks) {
    if (!modelBoks) return {vest: 0, oest: 10, syd: 0, nord: 10};
    return {vest: pyn(rundNed(modelBoks.min[0])), oest: pyn(rundOp(modelBoks.max[0])), syd: pyn(rundNed(modelBoks.min[1])), nord: pyn(rundOp(modelBoks.max[1]))};
  }
  function klipAaben(graenser) { return {vest: graenser.vest, oest: graenser.oest, syd: graenser.syd, nord: graenser.nord}; }
  function klipAktiv(klip, graenser) {
    return ["vest", "oest", "syd", "nord"].some(function (k) { return Math.abs(klip[k] - graenser[k]) > 1e-6; });
  }
  // Sæt én side; den modstående flade viger, så der altid er mindst 0,5 m imellem. Alt holdes inden for grænserne.
  function saetKlip(klip, side, vaerdi, graenser) {
    var r = klipAaben(klip), v = pyn(rund(Number(vaerdi) || 0));
    if (side === "vest") { v = klem(v, graenser.vest, graenser.oest - KLIP_MIN_AFSTAND); r.vest = v; if (r.oest < v + KLIP_MIN_AFSTAND) r.oest = pyn(Math.min(graenser.oest, v + KLIP_MIN_AFSTAND)); }
    else if (side === "oest") { v = klem(v, graenser.vest + KLIP_MIN_AFSTAND, graenser.oest); r.oest = v; if (r.vest > v - KLIP_MIN_AFSTAND) r.vest = pyn(Math.max(graenser.vest, v - KLIP_MIN_AFSTAND)); }
    else if (side === "syd") { v = klem(v, graenser.syd, graenser.nord - KLIP_MIN_AFSTAND); r.syd = v; if (r.nord < v + KLIP_MIN_AFSTAND) r.nord = pyn(Math.min(graenser.nord, v + KLIP_MIN_AFSTAND)); }
    else if (side === "nord") { v = klem(v, graenser.syd + KLIP_MIN_AFSTAND, graenser.nord); r.nord = v; if (r.syd > v - KLIP_MIN_AFSTAND) r.syd = pyn(Math.max(graenser.syd, v - KLIP_MIN_AFSTAND)); }
    ["vest", "oest", "syd", "nord"].forEach(function (k) { r[k] = pyn(r[k]); });
    return r;
  }
  // «Klip om det valgte»: de valgtes samlede boks med 1 m luft, rundet til 0,1 m og klemt til grænserne.
  function klipOmValgte(bokse, graenser, luft) {
    var b = boksUnion(bokse); if (!b) return null;
    var l = luft == null ? LUFT : luft;
    return {
      vest: pyn(klem(rundNed(b.min[0] - l), graenser.vest, graenser.oest)),
      oest: pyn(klem(rundOp(b.max[0] + l), graenser.vest, graenser.oest)),
      syd: pyn(klem(rundNed(b.min[1] - l), graenser.syd, graenser.nord)),
      nord: pyn(klem(rundOp(b.max[1] + l), graenser.syd, graenser.nord))
    };
  }
  // Planer som {normal, konstant}: et punkt beholdes, når normal·p + konstant >= 0 (three.js' fortegn).
  function klipPlaner(klip, graenser) {
    var r = [];
    if (!klip) return r;
    if (klip.vest - graenser.vest > 1e-6) r.push({normal: [1, 0, 0], konstant: pyn(-klip.vest), side: "vest"});
    if (graenser.oest - klip.oest > 1e-6) r.push({normal: [-1, 0, 0], konstant: pyn(klip.oest), side: "oest"});
    if (klip.syd - graenser.syd > 1e-6) r.push({normal: [0, 1, 0], konstant: pyn(-klip.syd), side: "syd"});
    if (graenser.nord - klip.nord > 1e-6) r.push({normal: [0, -1, 0], konstant: pyn(klip.nord), side: "nord"});
    return r;
  }
  function beholdes(punkt, planer) {
    return (planer || []).every(function (p) { return p.normal[0] * punkt[0] + p.normal[1] * punkt[1] + p.normal[2] * punkt[2] + p.konstant >= -1e-9; });
  }
  function klipTekst(v) { return (Math.round(v * 10) / 10).toLocaleString("da-DK", {minimumFractionDigits: 1, maximumFractionDigits: 1}) + " m"; }

  /* ---------- Opbygning ----------
     lag: typens lag fra Revit (yderst først), [{material, function, widthMm}]. boks: elementets boks. Lagene lægges
     langs elementets tynde akse (vægge: x eller y, dæk/tage/lofter: z), skaleret så de tilsammen fylder elementets
     tykkelse, og trukket lidt fra hinanden. 3D viser et kort prøvestykke midt på elementet og ikke hele dets længde
     (ejer, 2026-11-14: lagene langs hele væggen var forvirrende; man skal bare kunne se lagene).
     Lag 1 er det yderste (for et dæk: det øverste). */
  var STYKKE_MIN = 0.8, STYKKE_MAX = 1.5;   // m: prøvestykkets længde og højde (3 × tykkelsen inden for de to grænser)
  function rolleTekst(fn) { return fn ? (ROLLE[fn] || fn) : "Uden funktion"; }
  function lagFarve(fn) { return ROLLE_FARVE[fn] || "#B9B2A6"; }
  function opbygning(lag, boks, kategori) {
    var lagene = Array.isArray(lag) ? lag.filter(Boolean) : [];
    var samletMm = lagene.reduce(function (s, l) { return s + (Number(l.widthMm) || 0); }, 0);
    var r = {lag: [], samletMm: pyn(samletMm), baerende: lagene.filter(function (l) { return l["function"] === "Structure" || l["function"] === "StructuralDeck"; }).map(function (l) { return l.material || "(uden materiale)"; }),
      akse: null, laengdeAkse: null, boks: null, mangler: !lagene.length};
    if (!boks) return r;
    var s = boksStoerrelse(boks);
    var akse = VANDRETTE[kategori] ? 2 : (s[0] <= s[1] ? 0 : 1);
    var andre = [0, 1, 2].filter(function (k) { return k !== akse; });
    var laengdeAkse = s[andre[0]] >= s[andre[1]] ? andre[0] : andre[1], tredje = andre[0] === laengdeAkse ? andre[1] : andre[0];
    var T = Math.max(s[akse], 0.01), L = Math.max(s[laengdeAkse], 0.1), H = Math.max(s[tredje], 0.1);
    var n = lagene.length;
    var skala = samletMm > 0 ? T / (samletMm / 1000) : 1;
    var mellemrum = Math.max(0.02, Math.min(0.08, T * 0.12));
    // Prøvestykket: midt på elementets længde; for en væg det nederste stykke, for et dæk et felt midt på.
    var stykke = Math.max(STYKKE_MIN, Math.min(STYKKE_MAX, T * 3)), Ls = Math.min(L, stykke), Hs = Math.min(H, stykke);
    var midt = (boks.min[laengdeAkse] + boks.max[laengdeAkse]) / 2, midt3 = (boks.min[tredje] + boks.max[tredje]) / 2;
    var offset = 0, min = boks.min.slice(), max = boks.max.slice();
    lagene.forEach(function (l, i) {
      var t = samletMm > 0 ? (Number(l.widthMm) || 0) / 1000 * skala : T / Math.max(n, 1);
      t = Math.max(t, 0.005);
      var bMin = min.slice(), bMax = max.slice();
      if (akse === 2) { bMax[2] = max[2] - offset; bMin[2] = bMax[2] - t; }     // dæk: lag 1 øverst, nedefter
      else { bMin[akse] = min[akse] + offset; bMax[akse] = bMin[akse] + t; }     // væg: lag 1 ved den lave side
      bMin[laengdeAkse] = midt - Ls / 2; bMax[laengdeAkse] = midt + Ls / 2;
      if (tredje === 2) bMax[2] = bMin[2] + Hs;                                  // væg: fra bunden og op
      else { bMin[tredje] = midt3 - Hs / 2; bMax[tredje] = midt3 + Hs / 2; }     // dæk (eller en høj, smal væg): midt på
      offset += t + mellemrum;
      r.lag.push({nr: i + 1, materiale: l.material || "(uden materiale)", funktion: l["function"] || "", rolle: rolleTekst(l["function"]),
        tykkelseMm: pyn(Number(l.widthMm) || 0), baerende: l["function"] === "Structure" || l["function"] === "StructuralDeck",
        farve: lagFarve(l["function"]), boks: {min: bMin.map(pyn), max: bMax.map(pyn)}});
    });
    r.akse = "xyz"[akse]; r.laengdeAkse = "xyz"[laengdeAkse]; r.stykke = {laengde: pyn(Ls), hoejde: pyn(Hs)};
    r.boks = boksUnion(r.lag.map(function (x) { return x.boks; })) || {min: min, max: max};
    return r;
  }

  /* Snittegning af lagene (svg som tekst): vægge med lag 1 til venstre (yderst), dæk med lag 1 øverst. Hvert lag får
     en bredde efter sin tykkelse, dog mindst så meget, at en membran kan ses, og sit nummer. Kun til visning. */
  function snitSvg(lagListe, vandret) {
    var lagene = (lagListe || []).filter(Boolean);
    if (!lagene.length) return "";
    var B = 320, Hj = vandret ? Math.max(90, Math.min(220, 26 * lagene.length + 30)) : 110, luft = 14, plads = (vandret ? Hj : B) - 2 * luft;
    var sum = lagene.reduce(function (a, l) { return a + Math.max(0, Number(l.tykkelseMm) || 0); }, 0) || lagene.length;
    var mindst = Math.min(8, plads / lagene.length);
    var raa = lagene.map(function (l) { return Math.max(mindst, (Math.max(0, Number(l.tykkelseMm) || 0) || sum / lagene.length) / sum * plads); });
    var skala = plads / raa.reduce(function (a, b) { return a + b; }, 0), pos = luft;
    var tekst = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c]; }); };
    var h = '<svg class="v3-snit" viewBox="0 0 ' + B + " " + Hj + '" role="img" aria-label="Snit gennem lagene">';
    lagene.forEach(function (l, i) {
      var t = raa[i] * skala, x = vandret ? luft + 46 : pos, y = vandret ? pos : 22, w = vandret ? B - 2 * luft - 46 : t, hh = vandret ? t : Hj - 44;
      h += '<rect x="' + pyn(x) + '" y="' + pyn(y) + '" width="' + pyn(w) + '" height="' + pyn(hh) + '" fill="' + tekst(l.farve || "#B9B2A6") + '" stroke="#2B3A40" stroke-width="' + (l.baerende ? 1.6 : 0.6) + '"><title>' + tekst(l.nr + ". " + l.materiale + " · " + l.tykkelseMm + " mm") + "</title></rect>";
      // Nummeret står ud for laget: over (væg) eller til venstre (dæk).
      h += vandret
        ? '<text x="' + (luft + 40) + '" y="' + pyn(y + hh / 2 + 4) + '" text-anchor="end" font-size="11">' + tekst(l.nr) + "</text>"
        : '<text x="' + pyn(x + w / 2) + '" y="16" text-anchor="middle" font-size="11">' + tekst(l.nr) + "</text>";
      pos += t;
    });
    h += vandret
      ? '<text x="' + luft + '" y="' + (luft + 9) + '" font-size="10" fill="#5B6B70">øverst</text><text x="' + luft + '" y="' + (Hj - luft) + '" font-size="10" fill="#5B6B70">nederst</text>'
      : '<text x="' + luft + '" y="' + (Hj - 6) + '" font-size="10" fill="#5B6B70">ude (lag 1)</text><text x="' + (B - luft) + '" y="' + (Hj - 6) + '" text-anchor="end" font-size="10" fill="#5B6B70">inde</text>';
    return h + "</svg>";
  }

  /* ---------- Konstruktiv funktion ----------
     Brugerens værdi: element.konstruktiv (Statik-sporet leverer den senere) eller tags (bærende/stabiliserende/
     ikke-bærende). Mangler begge, er svaret «Ikke angivet», aldrig udledt af Revit. Revits Structural Usage vises
     separat som forslag (fraRevit). */
  function konstruktivAf(ed, tagSet) {
    ed = ed || {}; tagSet = tagSet || {};
    var egen = typeof ed.konstruktiv === "string" ? ed.konstruktiv.trim() : (ed.konstruktiv && typeof ed.konstruktiv === "object" ? ed.konstruktiv.funktion : null);
    if (egen) { var k = REVIT_KONSTRUKTIV[String(egen).toLowerCase()]; if (k) return k; if (KONSTRUKTIV.indexOf(egen) >= 0) return egen; }
    var b = !!tagSet["bærende"], s = !!tagSet["stabiliserende"], ib = !!tagSet["ikke-bærende"];
    if (b && s) return "Begge";
    if (b) return "Bærende";
    if (s) return "Stabiliserende";
    if (ib) return "Ingen af delene";
    return "Ikke angivet";
  }
  function konstruktivFraRevit(ed) {
    var v = ed && ed.revit && ed.revit.konstruktiv; if (!v) return null;
    return REVIT_KONSTRUKTIV[String(v).toLowerCase()] || null;
  }
  function erKonstruktivKategori(kategori) { return !!BAERENDE_KAT[kategori]; }
  // Tæller pr. funktion blandt bærende kategorier. items: [{kategori, funktion}]
  function konstruktivTal(items) {
    var t = {}; KONSTRUKTIV.forEach(function (k) { t[k] = 0; });
    (items || []).forEach(function (it) { if (!BAERENDE_KAT[it.kategori]) return; var k = KONSTRUKTIV.indexOf(it.funktion) >= 0 ? it.funktion : "Ikke angivet"; t[k]++; });
    return t;
  }

  /* ---------- Kobling til 3D-visningen (kun i browseren) ---------- */
  function installer(V, muligheder) {
    var o = muligheder || {};
    var tre = V.three(), THREE = tre.THREE;
    var tilstand = "hele", etageNavn = null, snitAndel = SNIT_STANDARD, bokse = null, etagerListe = [], graenser = null, klip = null;
    var opbygIdx = -1, opbygGruppe = null, xrayMin = false, lyttere = [];
    var lagOverride = null;   // lag, der vises i stedet for typens egne, mens de rettes i panelet (opbygningMed)
    var $ = function (id) { return document.getElementById(id); };

    function elementBoks(rec) {
      var b = null;
      (rec.meshes || []).forEach(function (m) {
        if (!m.geometry) return; if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        var bb = m.geometry.boundingBox.clone(); m.updateMatrixWorld(true); bb.applyMatrix4(m.matrixWorld);
        var x = {min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z]};
        b = b ? boksUnion([b, x]) : x;
      });
      return b;
    }
    function alleBokse() {
      if (bokse) return bokse;
      bokse = V.elementer().map(function (rec) { return elementBoks(rec); });
      return bokse;
    }
    function items() { var bs = alleBokse(); return V.elementer().map(function (rec, i) { return {idx: i, etage: rec.data.level, boks: bs[i], erRum: !!rec.data.erRum}; }).filter(function (it) { return !it.erRum; }); }
    function modelBoks() { var mb = V.modelBoks && V.modelBoks(); return mb && !mb.isEmpty() ? {min: [mb.min.x, mb.min.y, mb.min.z], max: [mb.max.x, mb.max.y, mb.max.z]} : boksUnion(alleBokse()); }
    function vedModel() {
      bokse = null; etagerListe = etager(items()); graenser = klipGraenser(modelBoks()); klip = klipAaben(graenser);
      if (!etageAf(etagerListe, etageNavn)) etageNavn = etagerListe.length ? etagerListe[0].navn : null;
      afsluttOpbygning(); tilstand = "hele"; anvend();
    }
    function trePlan(p) { return new THREE.Plane(new THREE.Vector3(p.normal[0], p.normal[1], p.normal[2]), p.konstant); }
    function xray(til) {
      var b = $("btnXray"); if (!b) return; var er = b.classList.contains("on");
      if (til && !er) { b.click(); xrayMin = true; } else if (!til && er && xrayMin) { b.click(); xrayMin = false; }
    }
    function anvend() {
      var e = etageAf(etagerListe, etageNavn), z = tilstand === "snit" ? snitHoejde(e, snitAndel) : null;
      var planer = klipPlaner(klip, graenser).map(trePlan);
      if (z != null) planer.push(trePlan(snitPlan(z)));
      V.klipplaner(planer);
      var f = null;
      if (tilstand === "etage" && e) f = function (rec) { return (rec.data.level || UDEN_ETAGE) === e.navn || rec.data.erRum; };
      else if (tilstand === "snit" && e) { var bs = alleBokse(); f = function (rec, i) { return rec.data.erRum || iSnit({etage: rec.data.level, boks: bs[i]}, etagerListe, e.navn, z); }; }
      else if (tilstand === "opbygning" && opbygIdx >= 0) f = function (rec, i) { return i !== opbygIdx; };
      // o.filter: layoutets eget filter (Lag-panelet) lægges oven på visningens
      var g = typeof o.filter === "function" ? o.filter : null;
      V.visningsfilter(f || g ? function (rec, i) { return (!f || f(rec, i)) && (!g || g(rec, i)); } : null);
      xray(tilstand === "valgte");
      if (o.vedAendring) o.vedAendring(status());
      lyttere.forEach(function (fn) { try { fn(status()); } catch (err) { console.error(err); } });
      V.render();
    }
    function status() {
      var e = etageAf(etagerListe, etageNavn);
      return {tilstand: tilstand, etage: etageNavn, etager: etagerListe.map(function (x) { return x.navn; }), snitAndel: snitAndel,
        snitHoejde: e ? snitHoejde(e, snitAndel) : null, klip: klipAaben(klip || klipGraenser(null)), graenser: graenser || klipGraenser(null),
        klipAktiv: !!(klip && graenser && klipAktiv(klip, graenser)), opbygning: opbygIdx};
    }

    /* Opbygning i 3D: kasser pr. lag + kanter + nummer-skilte (canvas-sprites). */
    function tal(n, farve) {
      var c = document.createElement("canvas"); c.width = 64; c.height = 64; var g = c.getContext("2d");
      g.fillStyle = "#ffffff"; g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
      g.lineWidth = 4; g.strokeStyle = farve || "#11201d"; g.stroke();
      g.fillStyle = "#11201d"; g.font = "bold 30px Segoe UI, Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n), 32, 34);
      var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({map: t, depthTest: false, transparent: true})); sp.renderOrder = 999; sp.raycast = function () {};
      return sp;
    }
    function rydOpbygGruppe() {
      if (!opbygGruppe) return;
      tre.scene.remove(opbygGruppe);
      opbygGruppe.traverse(function (ch) { if (ch.geometry) ch.geometry.dispose(); if (ch.material) { if (ch.material.map) ch.material.map.dispose(); ch.material.dispose(); } });
      opbygGruppe = null;
    }
    function visOpbygning(idx) {
      rydOpbygGruppe();
      var rec = V.elementer()[idx]; if (!rec) return null;
      var ed = rec.data, typer = V.typer(), t = ed.typeId != null ? typer[String(ed.typeId)] : null;
      var lag = lagOverride || (t && t.layers) || [];
      var res = opbygning(lag, alleBokse()[idx], ed.category);
      res.element = {idx: idx, id: ed.id, navn: ed.type || ed.name || "Element", kategori: ed.category, etage: ed.level, typeNavn: t && t.name};
      opbygGruppe = new THREE.Group(); tre.scene.add(opbygGruppe);
      // Skiltene passer til prøvestykket og står i tre rækker, så tynde lag ved siden af hinanden ikke dækker hinandens tal.
      var d = res.stykke ? Math.max(0.07, Math.min(0.16, res.stykke.laengde * 0.09)) : 0.3;
      res.lag.forEach(function (l, nr) {
        var raekke = (nr % 3) * d * 1.05;
        var s = boksStoerrelse(l.boks), geo = new THREE.BoxGeometry(s[0], s[1], s[2]);
        var m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color: new THREE.Color(l.farve), metalness: 0.04, roughness: 0.85}));
        m.position.set((l.boks.min[0] + l.boks.max[0]) / 2, (l.boks.min[1] + l.boks.max[1]) / 2, (l.boks.min[2] + l.boks.max[2]) / 2);
        m.castShadow = true; m.receiveShadow = true; m.raycast = function () {};
        var kant = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({color: 0x11201d, transparent: true, opacity: 0.55}));
        kant.raycast = function () {}; m.add(kant);
        var sp = tal(l.nr, l.farve); sp.scale.set(d, d, 1);
        var topp = l.boks.max.slice(); // skiltet ved lagets fjerne ende, lidt over
        if (res.akse === "z") sp.position.set(l.boks.max[0] + d * 0.6 + raekke, (l.boks.min[1] + l.boks.max[1]) / 2, (l.boks.min[2] + l.boks.max[2]) / 2);
        else sp.position.set((l.boks.min[0] + l.boks.max[0]) / 2, (l.boks.min[1] + l.boks.max[1]) / 2, topp[2] + d * 0.6 + raekke);
        opbygGruppe.add(m); opbygGruppe.add(sp);
      });
      if (!res.lag.length) {
        // Ingen lag på typen: vis elementet selv som ét lag, så der stadig er noget at se.
        var b = alleBokse()[idx]; if (b) { var s2 = boksStoerrelse(b), m2 = new THREE.Mesh(new THREE.BoxGeometry(s2[0], s2[1], s2[2]), new THREE.MeshStandardMaterial({color: 0xb9b2a6, transparent: true, opacity: 0.6})); m2.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2); m2.raycast = function () {}; opbygGruppe.add(m2); res.boks = b; }
      }
      V.skygge();
      return res;
    }
    function afsluttOpbygning() {
      if (opbygIdx < 0 && !opbygGruppe) return;
      rydOpbygGruppe(); opbygIdx = -1; V.isoler(null);
    }

    var ctrl = {
      TILSTANDE: TILSTANDE,
      status: status,
      paa: function (fn) { lyttere.push(fn); },
      saet: function (id, valg) {
        if (!TILSTANDE.some(function (t) { return t.id === id; })) return;
        if (tilstand === "opbygning" && id !== "opbygning") afsluttOpbygning();
        tilstand = id;
        if (id === "opbygning") {
          var idx = valg != null ? valg : (V.valgte()[0]);
          if (idx == null || idx < 0) { tilstand = "hele"; anvend(); return null; }
          opbygIdx = idx; var r = visOpbygning(idx);
          var liste = V.valgte(); if (liste.indexOf(idx) < 0) V.vaelgFlere([idx]);
          V.isoler(new Set([idx]));
          anvend();
          if (r && r.boks) { var bx = new THREE.Box3(new THREE.Vector3(r.boks.min[0], r.boks.min[1], r.boks.min[2]), new THREE.Vector3(r.boks.max[0], r.boks.max[1], r.boks.max[2])); V.tilpas(bx.expandByScalar(0.3)); }
          return r;
        }
        anvend(); return null;
      },
      tilstand: function () { return tilstand; },
      etage: function (navn) { if (etageAf(etagerListe, navn)) { etageNavn = navn; if (tilstand === "hele" || tilstand === "valgte") tilstand = "etage"; anvend(); } },
      etageTrin: function (delta) { var e = etageAf(etagerListe, etageNavn); var i = e ? e.nr + delta : 0; i = klem(i, 0, etagerListe.length - 1); if (etagerListe[i]) { etageNavn = etagerListe[i].navn; anvend(); } },
      snit: function (andel) { snitAndel = klem(Number(andel), 0.02, 0.98); if (tilstand !== "snit") tilstand = "snit"; anvend(); },
      klip: function (side, vaerdi) { if (!graenser) return; klip = saetKlip(klip, side, vaerdi, graenser); anvend(); },
      klipOmValgte: function () { if (!graenser) return false; var bs = alleBokse(); var vb = V.valgte().map(function (i) { return bs[i]; }).filter(Boolean); var k = klipOmValgte(vb, graenser); if (!k) return false; klip = k; anvend(); return true; },
      nulstilKlip: function () { if (!graenser) return; klip = klipAaben(graenser); anvend(); },
      opbygningFor: function (idx) { return ctrl.saet("opbygning", idx); },
      // De rettede lag i 3D-stykket (uden at flytte kameraet): panelet kalder det efter hver rettelse.
      opbygningMed: function (idx, lag) { lagOverride = Array.isArray(lag) ? lag : null; try { return visOpbygning(idx); } finally { lagOverride = null; } },
      afslutOpbygning: function () { afsluttOpbygning(); tilstand = "hele"; anvend(); },
      boks: function (idx) { return alleBokse()[idx] || null; },
      etager: function () { return etagerListe.slice(); },
      opdater: anvend,
      vedModel: vedModel
    };
    V.paa("model", vedModel);
    if (V.data()) vedModel();
    return ctrl;
  }

  return {
    TILSTANDE: TILSTANDE, UDEN_ETAGE: UDEN_ETAGE, KLIP_SIDER: KLIP_SIDER, KLIP_MIN_AFSTAND: KLIP_MIN_AFSTAND, LUFT: LUFT, SNIT_STANDARD: SNIT_STANDARD,
    KONSTRUKTIV: KONSTRUKTIV.slice(), KONSTRUKTIV_FARVE: KONSTRUKTIV_FARVE, ROLLE: ROLLE,
    sorterEtager: sorterEtager, boksUnion: boksUnion, boksStoerrelse: boksStoerrelse,
    etager: etager, etageAf: etageAf, snitHoejde: snitHoejde, snitPlan: snitPlan, iSnit: iSnit,
    klipGraenser: klipGraenser, klipAaben: klipAaben, klipAktiv: klipAktiv, saetKlip: saetKlip, klipOmValgte: klipOmValgte, klipPlaner: klipPlaner, beholdes: beholdes, klipTekst: klipTekst,
    rolleTekst: rolleTekst, lagFarve: lagFarve, opbygning: opbygning, snitSvg: snitSvg,
    konstruktivAf: konstruktivAf, konstruktivFraRevit: konstruktivFraRevit, erKonstruktivKategori: erKonstruktivKategori, konstruktivTal: konstruktivTal,
    installer: installer
  };
});
