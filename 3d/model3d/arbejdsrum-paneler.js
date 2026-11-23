/* ISSANA 3D (3.0): paneltilstanden i 3D-arbejdsrummet – ét panel ad gangen.

   Ejer svaret på «hvilket panel er åbent?». Venstre bjælke og fanerne øverst er tilsammen én radio-gruppe:
   Mindmap, Egenskaber, Søg, Lag, Klip, Indstillinger, Data, Ændringer, Graf, Sol, Produkter, Konstruktiv funktion
   (midterpaneler og html'ens højre kolonner) og fanerne Bygningsdele, Statik, Varmetabsberegning, Lyd, LCA (docks til
   højre). Vælger man ét, lukkes alle andre; klik på det aktive lukker det. Ved opstart er intet åbent (kun 3D + AI-feltet).
   Intet huskes i localStorage.

   Ren logik uden DOM (module.exports i Node), testet i tests/web-model3d/arbejdsrum-paneler.test.mjs.
   arbejdsrum-layout.js kalder tilstand() og sætter klasser, skuffe og fane derefter. bredder() er samme regel som
   CSS'ens min(ønsket, 50vw - bjælke): 3D får altid mindst halvdelen af vinduets bredde. */
(function (fabrik) {
  "use strict";
  var api = fabrik();
  if (typeof module === "object" && module && module.exports) { module.exports = api; return; }
  if (typeof window !== "undefined") window.IssanaArbejdsrumPaneler = api;
})(function () {
  "use strict";

  var SLAGS = {midt: "midt", hoejre: "hoejre", dock: "dock"};
  var BJAELKE = 76;                       // venstre bjælke (px), #v3rail
  var MINDST_3D = 0.5;                    // 3D får mindst denne andel af vinduets bredde
  var OENSKET = {midt: 424, midtBred: 680, dock: 440, dockBred: 720, varmetab: 560, props: 292, types: 300, params: 300};
  var SKUFFE = "skuffe:";                 // 2.12-skuffens faner som paneler: "skuffe:data", "skuffe:aendringer", …

  /* Registret: id → {slags, bred}. Returnerer et nyt objekt; det gamle røres ikke. */
  function registrer(reg, id, def) {
    if (!id) return reg || {};
    var r = {}; Object.keys(reg || {}).forEach(function (k) { r[k] = reg[k]; });
    def = def || {};
    var slags = SLAGS[def.slags] || SLAGS.midt;
    r[id] = {slags: slags, bred: !!def.bred, fane: slags === SLAGS.dock ? (def.fane || id) : null, kolonne: slags === SLAGS.hoejre ? (def.kolonne || id) : null};
    return r;
  }
  function standardRegister() {
    var r = {};
    ["mindmap", "soeg", "lag", "klip", "indstillinger", "opbygning"].forEach(function (id) { r = registrer(r, id, {slags: "midt"}); });
    ["lag", "data", "aendringer", "graf", "sol", "produkter"].forEach(function (id) { r = registrer(r, SKUFFE + id, {slags: "midt", bred: id === "graf"}); });
    r = registrer(r, "egenskaber", {slags: "hoejre", kolonne: "props"});
    r = registrer(r, "types", {slags: "hoejre", kolonne: "types"});
    r = registrer(r, "params", {slags: "hoejre", kolonne: "params"});
    ["fysik", "varmetab", "lca", "statik", "lyd"].forEach(function (id) { r = registrer(r, id, {slags: "dock", bred: id === "lyd"}); });
    return r;
  }

  /* Radio-gruppen: klik på et panel. Samme id igen lukker; ukendt id lukker alt. */
  function vaelg(aktiv, id, reg) {
    if (!id || !reg || !reg[id]) return null;
    return aktiv === id ? null : id;
  }
  function luk() { return null; }
  /* Fane-skift fra html'en (krogen 'fane'): "3d" lukker en åben dock, et dock-id åbner det (og lukker alt andet). */
  function vedFane(aktiv, navn, reg) {
    if (!navn || navn === "3d") return aktiv && reg && reg[aktiv] && reg[aktiv].slags === SLAGS.dock ? null : aktiv;
    return reg && reg[navn] && reg[navn].slags === SLAGS.dock ? navn : aktiv;
  }
  /* Skuffen (arbejdsrum.js) meldte åben/lukket med en fane. */
  function vedSkuffe(aktiv, aaben, fane) {
    var id = SKUFFE + fane;
    if (aaben) return id;
    return aktiv === id ? null : aktiv;
  }
  function erSkuffe(id) { return typeof id === "string" && id.indexOf(SKUFFE) === 0; }
  function skuffeFane(id) { return erSkuffe(id) ? id.slice(SKUFFE.length) : null; }

  /* Hvad layoutet skal vise for en given tilstand. Præcis ét af midt/skuffeFane/kolonne/dock er sat, eller ingen. */
  function tilstand(aktiv, reg) {
    var d = aktiv && reg ? reg[aktiv] : null;
    var t = {aktiv: d ? aktiv : null, slags: d ? d.slags : null, midt: null, midtBred: false, skuffeFane: null, kolonne: null, props: false, types: false, params: false, dock: null, fane: "3d"};
    if (!d) return t;
    if (d.slags === SLAGS.midt) { if (erSkuffe(aktiv)) t.skuffeFane = skuffeFane(aktiv); else t.midt = aktiv; t.midtBred = d.bred; }
    else if (d.slags === SLAGS.hoejre) { t.kolonne = d.kolonne; t[d.kolonne] = true; }
    else { t.dock = aktiv; t.fane = d.fane || aktiv; }
    return t;
  }

  /* Bredder i px for et vindue: panelet får sin ønskede bredde, men aldrig mere end at 3D beholder mindst halvdelen.
     Samme regel som CSS'en (min(ønsket, calc(50vw - 76px))). */
  function bredder(vindue, aktiv, reg, oensket) {
    vindue = Math.max(0, Number(vindue) || 0);
    var t = tilstand(aktiv, reg), o = oensket || OENSKET, vil = 0;
    if (t.midt || t.skuffeFane) vil = t.midtBred ? o.midtBred : o.midt;
    else if (t.kolonne) vil = o[t.kolonne] || o.props;
    else if (t.dock) vil = reg[t.dock].bred ? o.dockBred : (t.dock === "varmetab" ? o.varmetab : o.dock);
    var loft = Math.max(0, Math.floor(vindue * MINDST_3D) - BJAELKE);
    var panel = Math.min(vil, loft);
    var view = Math.max(0, vindue - BJAELKE - panel);
    return {bjaelke: BJAELKE, panel: panel, view: view, andel3d: vindue ? view / vindue : 0, begraenset: vil > loft};
  }

  return {SLAGS: SLAGS, BJAELKE: BJAELKE, MINDST_3D: MINDST_3D, OENSKET: OENSKET, SKUFFE: SKUFFE,
    registrer: registrer, standardRegister: standardRegister, vaelg: vaelg, luk: luk, vedFane: vedFane, vedSkuffe: vedSkuffe,
    erSkuffe: erSkuffe, skuffeFane: skuffeFane, tilstand: tilstand, bredder: bredder};
});
