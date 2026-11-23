/* ISSANA 3D (3.0): fanen «Statik» og broen til arbejdsrummets API.
   Reglerne står i statik.js (ren logik, testet); her er kun panelet, lastpilene i 3D og plantegningen.
   Statik har to faner: Stabilitet (her) og Laster og redegørelse (statik-laster.js, monteres i docken herfra).

   Montering: window.issanaArbejdsrum.registrerFane({id:'statik', titel:'Statik', monter(container, api)}) – 3.0-API'et
   (arbejdsrum-layout.js, docs/issana-mcp/3D-ARBEJDSRUM-API.md). Layoutets api regner i elementindekser; broen herunder
   oversætter til Revit-id'er (api.elementer()/api.indeks()), som statik.js regner i. Findes layoutet ikke, bruges
   arbejdsrummets 2.12-flade (IssanaArbejdsrum.fane + IssanaVisning) gennem samme bro: valgte(), vaelg(ids),
   farvelaeg({id:'#hex'|null}), model(), tilfoej(aendring). Mangler begge, logges en advarsel, og
   window.issanaStatikMonter(container, api) kan kaldes manuelt.

   Intet skrives i Revit herfra: «Brug som forslag i Konstruktiv funktion» lægger rækker i ændringslisten med
   forhåndsvisning; først «Gem i Revit» skriver (issana_apply_plan, der validerer med BygDataRules).

   Denne fil indlæser selv konstruktiv-vaerdier.js, statik.js og arbejdsrum-konstruktiv.js fra sin egen mappe, så
   Revit-modelviewer.html kun behøver én <script src>-linje. */
(function () {
  "use strict";
  var PARAM = "ISSANA Konstruktiv funktion";
  var FILER = ["konstruktiv-vaerdier.js", "statik.js", "arbejdsrum-konstruktiv.js"];
  var mappe = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.slice(0, s.lastIndexOf("/") + 1) : "";
  })();

  function advar(t) { try { console.warn("ISSANA Statik: " + t); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function dk(x, dec) { return Number(x).toFixed(dec == null ? 1 : dec).replace(".", ","); }
  function flertal(n, en, flere) { return n + " " + (n === 1 ? en : flere); }
  function ens(liste) { var u = liste.filter(function (v, i) { return liste.indexOf(v) === i; }); return u.length === 1 ? u[0] : (u.length ? "__forskellige" : ""); }

  /* ---------- Broen: 3.0-API'et eller arbejdsrummets nuværende flade ---------- */
  // Giver samme form uanset underlag. Alt, der mangler, giver en advarsel og en ufarlig standard; intet gættes om modellen.
  function lavBro(api) {
    var A = window.IssanaArbejdsrum, V = A && A.V ? A.V() : null;
    api = api || {};
    function elementId(rec) { var d = rec && rec.data; return d ? (d.erRum ? d.id : d.id) : null; }
    function idxAf(id) {
      if (!A || !A.byRevitId) return -1;
      if (A.byRevitId[id] != null) return A.byRevitId[id];
      if (A.byRevitId["rum:" + id] != null) return A.byRevitId["rum:" + id];
      return -1;
    }
    // Layoutets api giver elementindekser; statik.js regner i Revit-id'er. api.elementer()/api.indeks() oversætter.
    function idTilIdx(ids) {
      if (api.indeks) return ids.map(function (id) { return api.indeks(id); }).filter(function (i) { return i >= 0; });
      return ids.map(idxAf).filter(function (i) { return i >= 0; });
    }
    function idxTilId(ixs) {
      var els = api.elementer ? api.elementer() : (V && V.elementer ? V.elementer() : null);
      if (!els) return ixs;   // ingen elementliste: tag indeksene for id'er (kun i tests uden visning)
      return ixs.map(function (i) { return elementId(els[i]); }).filter(function (x) { return x != null; });
    }
    var bro = {
      ny: !!api.valgte,
      model: function () { if (api.model) return api.model(); if (V && V.data) return V.data(); advar("api.model mangler"); return null; },
      raaElementer: function () { return (api.elementer ? api.elementer() : (V && V.elementer ? V.elementer() : null)) || []; },
      valgteIdx: function () { return (api.valgte ? api.valgte() : (V && V.valgte ? V.valgte() : null)) || []; },
      valgte: function () {
        if (api.valgte) return idxTilId(api.valgte() || []);
        if (V && V.valgte) return idxTilId(V.valgte());
        return [];
      },
      vaelg: function (ids) {
        if (api.vaelg) return api.vaelg(idTilIdx(ids));
        if (V && V.vaelgFlere) return V.vaelgFlere(idTilIdx(ids));
        advar("api.vaelg mangler");
      },
      farvelaeg: function (map, legend) {
        if (api.farvelaeg) return api.farvelaeg(map, { ids: true, titel: "Statik", legend: legend });
        if (!V || !V.farve) { advar("api.farvelaeg mangler"); return; }
        if (!map) { V.farve(null); return; }
        V.farve({ farve: function (rec) { var id = elementId(rec); var f = map[id]; return f || null; }, legend: legend || function () { return ""; } });
      },
      tilfoej: function (x) {
        // x = {uniqueId, param, fra, til, navn, obj, instans, hvad, kraeverOpsaetning}: samme ændringsobjekt som arbejdsrum.js
        if (api.aendringsliste && api.aendringsliste.tilfoej) return api.aendringsliste.tilfoej(x);
        if (A && A.saet) return A.saet({ uniqueId: x.uniqueId, instans: x.instans !== false, navn: x.navn, obj: x.obj }, x.param, x.til, (x.hvad && x.hvad[0]) || "statik");
        advar("api.aendringsliste.tilfoej mangler: ændringen er ikke lagt i listen (" + x.navn + ")");
        return false;
      },
      nuvaerende: function (uniqueId, param, obj) {
        if (api.aendringsliste && api.aendringsliste.nu) return api.aendringsliste.nu(uniqueId, param, obj);
        if (A && A.nu) return A.nu({ uniqueId: uniqueId, obj: obj || {} }, param);
        var raw = obj && obj.bygdata && obj.bygdata.raw; return raw && raw[param] != null ? raw[param] : (obj && obj.konstruktiv) || "";
      },
      visAendringer: function () { if (api.aendringsliste && api.aendringsliste.vis) return api.aendringsliste.vis(); if (api.visAendringer) return api.visAendringer(); if (A && A.visFane) A.visFane("aendringer"); },
      paa: function (navn, fn) { if (api.paa) return api.paa(navn, fn); if (V && V.paa) return V.paa(navn, fn); advar("api.paa mangler: panelet opdateres ikke ved nyt valg"); },
      three: function () { try { if (api.three) return api.three(); if (V && V.three) return V.three(); } catch (e) {} return null; },
      // 3D-visningen centrerer modellen om nulpunktet. Hjælpere i scenen, der regnes i modelkoordinater, skal forskydes lige så meget.
      forskydning: function () {
        var els = api.elementer ? api.elementer() : (V && V.elementer ? V.elementer() : null);
        for (var i = 0; els && i < els.length; i++) {
          var r = els[i], g = r && r.meshes && r.meshes[0] && r.meshes[0].geometry, a = g && g.attributes && g.attributes.position && g.attributes.position.array;
          var ms = r && r.data && !r.data.erRum ? r.data.meshes : null, P = ms && ms[0] && ms[0].pos;
          if (a && P && a.length === P.length && P.length >= 3) return [a[0] - P[0], a[1] - P[1], a[2] - P[2]];
        }
        return [0, 0, 0];
      },
      render: function () { if (api.render) api.render(); else if (V && V.render) V.render(); },
      // Fanens eget udsnit af modellen i 3D (dækket og etagen under); null fjerner det. Kameraet flyttes til en boks eller til hele modellen.
      fanefilter: function (fn) { if (api.fanefilter) return api.fanefilter(fn); if (V && V.fanefilter) return V.fanefilter(fn); },
      harUdsnit: !!(api.fanefilter || (V && V.fanefilter)),
      tilpas: function (boks) { if (V && V.tilpas) return V.tilpas(boks || null); if (!boks && api.tilpas) return api.tilpas(); },
      info: function (t) { if (api.info) api.info(t); else if (V && V.info) V.info(t); else advar(t); },
      fejl: function (t) { if (api.fejl) api.fejl(t); else if (V && V.fejl) V.fejl(t); else advar(t); },
      modelNoegle: function () { var d = bro.model(); return (d && (d.modelKey || d.model)) || "model"; },
      // Elementposten (issana-3d) for et id, uanset om det er en bygningsdel eller et rum
      element: function (id) {
        var d = bro.model(); if (!d) return null;
        var i, els = d.elements || [];
        for (i = 0; i < els.length; i++) if (els[i] && els[i].id === id) return els[i];
        var rum = d.rooms || [];
        for (i = 0; i < rum.length; i++) if (rum[i] && rum[i].id === id) return rum[i];
        return null;
      },
      type: function (el) { var d = bro.model(); if (!d || !el || el.typeId == null) return null; var t = (d.types || []).filter(function (x) { return x.id === el.typeId; })[0]; return t || null; }
    };
    return bro;
  }

  /* ---------- Tilstand ---------- */
  var S = null, bro = null, geo = null, geoFor = null;
  function tomtValg() { return { spaend: {}, vaegtype: {}, rolle: {}, daek: {} }; }
  var valg = tomtValg(), filter = "alle", etage = null, note = "", farvetAktiv = false, pileGruppe = null, spaendGruppe = null;
  var visI3d = true, aktivtDaek = null, aktivFelt = null, tegner = null, fokusNoegle = "", valgNoegle = null, sidstePlan = null, tastLytter = false, rod = null;
  var fane = "stab", faneBar = null, stabKrop = null, lastKrop = null, lastApi = null, lastHandle = null;
  // Udsnittet i 3D: "alt" (hele bygningen, væggenes roller) eller "daek" (dækket og etagen under, mens spændretningen sættes).
  var udsnit = "alt", udsnitFor = null;
  function noegle() { return "issana-statik-" + bro.modelNoegle(); }
  function hent() {
    valgNoegle = noegle(); valg = tomtValg();
    // Egne roller bruges ikke længere (ejer, 2026-11-14): spændretningen bestemmer, så gemte roller læses ikke ind.
    try { var g = JSON.parse(localStorage.getItem(valgNoegle) || "null"); if (g && (g.spaend || g.daek)) valg = { spaend: g.spaend || {}, vaegtype: g.vaegtype || {}, rolle: {}, daek: g.daek || {} }; } catch (e) {}
  }
  function gem() { try { localStorage.setItem(noegle(), JSON.stringify(valg)); } catch (e) {} }
  function geometri() {
    var m = bro.model();
    if (!m) return null;
    if (geo && geoFor === m) return geo;
    geo = S.geometri(m); geoFor = m;
    if (valgNoegle !== noegle()) hent();
    return geo;
  }
  // Til de andre dele af 3D (statik-laster.js): dækkene, valgene og de felter, der har en retning.
  function tilstand() {
    if (!S) S = window.IssanaStatik || null;
    if (!S) return { geo: null, valg: valg, felter: [] };
    if (!bro) bro = lavBro(window.issanaArbejdsrum && window.issanaArbejdsrum.api);
    var g = geometri();
    return { geo: g, valg: valg, felter: g ? S.felter(g, valg) : [] };
  }

  /* ---------- Udsnittet i 3D ----------
     Fast regel (ejer, 2026-11-14): når væggenes roller vises, ses hele bygningen. Når et dæk får sin spændretning, ses kun
     dækket og etagen under det, altså de vægge, dækket hviler på (stue → kælder, 1. sal → stue, tag → øverste etage).
     Panelet styrer selv 3D, så der ikke er visningsvalg at huske. */
  function udsnitDaek(g) {
    if (fane !== "stab" || !visI3d || udsnit !== "daek" || aktivtDaek == null || !g) return null;
    return g.daekElById[aktivtDaek] || null;
  }
  function anvendUdsnit(g) {
    if (!bro || !bro.harUdsnit) return;
    var D = udsnitDaek(g);
    if (!D) { fjernUdsnit(); return; }
    if (udsnitFor === D.id) return;
    udsnitFor = D.id;
    var under = D.etageUnder, med = {};
    med[D.id] = 1;
    // Væggene under dækket findes ud fra højden, så en høj væg, der står på en lavere etage, også er med.
    S.feltListe(g, valg, D.id).forEach(function (f) { (f.vaegge || []).forEach(function (id) { med[id] = 1; }); });
    bro.fanefilter(function (rec) {
      var d = rec && rec.data; if (!d) return false;
      if (med[d.id]) return true;
      return under != null && d.level != null && String(d.level) === under;
    });
    // Kameraet flytter sig til det, der nu ses (LAERINGSLOG L-R66: en ny visning vender selv kameraet).
    var T = bro.three(), boks = null;
    if (T && T.THREE && T.THREE.Box3) {
      boks = new T.THREE.Box3();
      bro.raaElementer().forEach(function (r) { if (r && r.meshes) r.meshes.forEach(function (m) { if (m.visible) boks.expandByObject(m); }); });
      if (boks.isEmpty()) boks = null;
    }
    bro.tilpas(boks);
  }
  function fjernUdsnit() {
    if (udsnitFor == null || !bro || !bro.harUdsnit) return;
    udsnitFor = null; bro.fanefilter(null); bro.tilpas(null);
  }

  /* ---------- Farver og pile i 3D ---------- */
  function farvelaeg(resultat) {
    var g = geometri(); if (!g) return;
    var F = S.farver(g, resultat, filter);
    var nogen = Object.keys(F.farver).some(function (k) { return F.farver[k]; });
    if (!nogen) { if (farvetAktiv) { bro.farvelaeg(null); farvetAktiv = false; } fjernSpoegelse(); fjernKant(); if (udsnitFor != null) visSpoegelse(null); return; }
    var leg = function () {
      var h = "<h4>Statik: " + esc(filter === "alle" ? "forslag" : S.FILTRE.filter(function (f) { return f.id === filter; })[0].titel) + "</h4>";
      if (filter === "nord" || filter === "oest") h += '<div class="legrow"><span class="sw" style="background:' + S.VAL.stab.farve + '"></span>Afstiver i lastretningen</div><div class="legrow"><span class="sw" style="background:' + S.VAL.stab.farve + ";box-shadow:0 0 0 2px " + S.KANT_FARVE + '"></span>… og bærer også et dæk</div>';
      else ["baerende", "stab", "begge", "ingen"].forEach(function (k) { if (resultat.antal[k]) h += '<div class="legrow"><span class="sw" style="background:' + S.VAL[k].farve + '"></span>' + esc(S.statikTekst(k)) + " (" + resultat.antal[k] + ")</div>"; });
      if (resultat.antal.let) h += '<div class="legrow"><span class="sw" style="background:' + S.LET_FARVE + '"></span>Let væg (' + resultat.antal.let + ")</div>";
      h += '<div class="legrow"><span class="sw" style="background:' + BLEG + '"></span>' + (filter === "alle" ? "Ikke defineret" : filter === "baer" ? "Bærer ikke" : "Afstiver ikke i denne retning") + "</div>";
      return h + '<div class="legrow arb-note">Forenklet vurdering, ikke en statisk beregning.</div>';
    };
    // Alt andet end systemet bliver lyst og næsten gennemsigtigt, så man kan se væggene inde i bygningen.
    var kort = {};
    Object.keys(g.byId).forEach(function (id) { kort[id] = BLEG; });
    Object.keys(F.farver).forEach(function (id) { if (F.farver[id]) kort[id] = F.farver[id]; });
    bro.farvelaeg(kort, leg); farvetAktiv = true;
    visSpoegelse(F.farver);
    visKant(F.kant);
  }
  var BLEG = "#E4E8E9", spoegelse = [], kantGruppe = null;
  // Mørk kant på de vægge, der også bærer et dæk (lastfiltrene).
  function fjernKant() {
    var T = bro.three();
    if (kantGruppe && T && T.scene) {
      T.scene.remove(kantGruppe);
      (kantGruppe.children || []).forEach(function (o) { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
    }
    kantGruppe = null;
  }
  function visKant(kant) {
    fjernKant();
    var T = bro.three();
    if (!kant || !Object.keys(kant).length || !T || !T.THREE || !T.scene || !T.THREE.EdgesGeometry) return;
    var THREE = T.THREE, grp = new THREE.Group();
    grp.name = "issana-statik-kant";
    bro.raaElementer().forEach(function (r) {
      if (!r || !r.data || !kant[r.data.id] || !r.meshes) return;
      r.meshes.forEach(function (m) {
        if (!m.geometry) return;
        var l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), new THREE.LineBasicMaterial({ color: kant[r.data.id], toneMapped: false }));
        l.renderOrder = 3; grp.add(l);
      });
    });
    if (!grp.children.length) return;
    T.scene.add(grp); kantGruppe = grp; bro.render();
  }
  // Udtoningen skrives på meshens faste materiale (userData.solid), også mens røntgen viser det udtonede: røntgen skifter selv materiale og sætter det udtonedes værdier.
  function fastMat(m) { return (m.userData && m.userData.solid) || m.material; }
  function fjernSpoegelse() {
    if (!spoegelse.length) return;
    spoegelse.forEach(function (m) { var tb = (m.userData && m.userData.transBase) || 0, f = fastMat(m); f.opacity = 1 - tb; f.transparent = tb > 0; f.depthWrite = true; f.needsUpdate = true; });
    spoegelse = [];
    bro.render();
  }
  // farver = null: kun dækket i udsnittet gøres gennemsigtigt (ingen vægge har farve endnu).
  function visSpoegelse(farver) {
    fjernSpoegelse();
    var valgt = {};
    bro.valgteIdx().forEach(function (i) { valgt[i] = 1; });
    bro.raaElementer().forEach(function (r, i) {
      if (!r || !r.data || r.data.erRum || !r.meshes) return;
      // Dækket i udsnittet ligger oven på væggene: det gøres gennemsigtigt, også når det er valgt, så væggene under det kan ses.
      var fokusDaek = udsnitFor != null && r.data.id === udsnitFor;
      if (!fokusDaek && (!farver || farver[r.data.id] || valgt[i])) return;
      r.meshes.forEach(function (m) {
        var f = fastMat(m); if (!f) return;
        f.transparent = true; f.opacity = Math.min(f.opacity, fokusDaek ? 0.3 : 0.2); f.depthWrite = false; f.needsUpdate = true;
        spoegelse.push(m);
      });
    });
    bro.render();
  }
  function fjernFarver() { if (farvetAktiv) { bro.farvelaeg(null); farvetAktiv = false; } fjernSpoegelse(); fjernKant(); fjernPile(); fjernSpaend(); fjernUdsnit(); tegner = null; }
  function fjernPile() { var T = bro.three(); if (pileGruppe && T && T.scene) { T.scene.remove(pileGruppe); pileGruppe = null; bro.render(); } }
  function fjernSpaend() {
    var T = bro.three();
    if (!spaendGruppe || !T || !T.scene) return;
    T.scene.remove(spaendGruppe);
    (spaendGruppe.children || []).forEach(function (o) { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
    spaendGruppe = null; bro.render();
  }
  // Spændretningen på selve dækket: farvet felt, streger langs retningen og tydelige dobbeltpile. Tegnes oven på alt andet,
  // så et dæk inde i bygningen kan ses, og kun for den etage, planen viser.
  function visSpaend() {
    fjernSpaend();
    var g = geometri(), T = bro.three();
    if (!visI3d || !g || !T || !T.THREE || !T.scene) return;
    var liste = S.felter(g, valg).filter(function (f) { return f.etage === etage; });
    // Det valgte dæk får altid sit omrids, så man kan se, hvilket dæk man arbejder på, også før det har en retning.
    var D = aktivtDaek != null ? g.daekElById[aktivtDaek] : null, visD = D && D.etageUnder === etage;
    if (!liste.length && !visD) return;
    var THREE = T.THREE, grp = new THREE.Group(), x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    grp.name = "issana-statik-spaend";
    liste.forEach(function (f) { f.polygon.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }); });
    if (visD) D.ringe.forEach(function (r) { r.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }); });
    var str = Math.max(x1 - x0, y1 - y0), maal = function (a, lav, hoej) { return Math.max(lav, Math.min(hoej, str * a)); };
    var bredde = maal(0.012, 0.14, 0.34), hovedL = maal(0.05, 0.55, 1.5), hovedB = hovedL * 0.9;
    function mat(farve, op) { return new THREE.MeshBasicMaterial({ color: farve, transparent: true, opacity: op, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }); }
    function trekanter(tal, z, m, orden) {
      var a = new Float32Array(tal.length / 2 * 3);
      for (var i = 0, j = 0; i < tal.length; i += 2, j += 3) { a[j] = tal[i]; a[j + 1] = tal[i + 1]; a[j + 2] = z; }
      var ge = new THREE.BufferGeometry(); ge.setAttribute("position", new THREE.BufferAttribute(a, 3));
      var me = new THREE.Mesh(ge, m); me.renderOrder = orden; grp.add(me);
    }
    function streger(linjer, z, farve, op, orden) {
      var a = new Float32Array(linjer.length * 6);
      linjer.forEach(function (l, i) { a[i * 6] = l[0]; a[i * 6 + 1] = l[1]; a[i * 6 + 2] = z; a[i * 6 + 3] = l[2]; a[i * 6 + 4] = l[3]; a[i * 6 + 5] = z; });
      var ge = new THREE.BufferGeometry(); ge.setAttribute("position", new THREE.BufferAttribute(a, 3));
      var me = new THREE.LineSegments(ge, new THREE.LineBasicMaterial({ color: farve, transparent: true, opacity: op, depthTest: false, depthWrite: false, toneMapped: false }));
      me.renderOrder = orden; grp.add(me);
    }
    var fv = function (p) { return new THREE.Vector2(p[0], p[1]); };
    // Et tag med hældning er ikke et vandret plan (ejer, 2026-11-14): feltet, stregerne og pilene løftes op på tagets egen
    // flade. loeft giver højden i et punkt; uden for taget bruges den højde, stykket ellers har.
    function loeftFor(d) { return function (x, y) { var z = S.zOverside(d, x, y); return z == null ? null : z + 0.06; }; }
    function trekanterPaa(tal, loeft, m, orden) {
      var a = [];
      for (var i = 0; i + 5 < tal.length; i += 6) {
        var z = [loeft(tal[i], tal[i + 1]), loeft(tal[i + 2], tal[i + 3]), loeft(tal[i + 4], tal[i + 5])];
        var kendt = z.filter(function (v) { return v != null; });
        if (!kendt.length) continue;
        var snit = kendt.reduce(function (s, v) { return s + v; }, 0) / kendt.length;
        for (var k = 0; k < 3; k++) a.push(tal[i + k * 2], tal[i + k * 2 + 1], z[k] == null ? snit : z[k]);
      }
      if (!a.length) return;
      var ge = new THREE.BufferGeometry(); ge.setAttribute("position", new THREE.BufferAttribute(new Float32Array(a), 3));
      var me = new THREE.Mesh(ge, m); me.renderOrder = orden; grp.add(me);
    }
    function stregerPaa(linjer, loeft, farve, op, orden) {
      var a = [];
      linjer.forEach(function (l) {
        var pts = S.underdelStreg(l, 0.5), sidste = null;
        var zs = pts.map(function (p) { var z = loeft(p[0], p[1]); if (z != null) sidste = z; return z; });
        if (sidste == null) return;
        // Punkter uden for taget (kanten) tager naboens højde.
        for (var i = 0; i < zs.length; i++) if (zs[i] == null) { var j = i; while (j < zs.length && zs[j] == null) j++; zs[i] = j < zs.length ? zs[j] : (i ? zs[i - 1] : sidste); }
        for (var k = 0; k + 1 < pts.length; k++) a.push(pts[k][0], pts[k][1], zs[k], pts[k + 1][0], pts[k + 1][1], zs[k + 1]);
      });
      if (!a.length) return;
      var ge = new THREE.BufferGeometry(); ge.setAttribute("position", new THREE.BufferAttribute(new Float32Array(a), 3));
      var me = new THREE.LineSegments(ge, new THREE.LineBasicMaterial({ color: farve, transparent: true, opacity: op, depthTest: false, depthWrite: false, toneMapped: false }));
      me.renderOrder = orden; grp.add(me);
    }
    // Feltets flade som flade trekanter [x, y, ...]: reglernes egen opdeling, ellers threes (en ring, der krydser sig selv).
    function fladeTal(f, form) {
      var tal = S.trekanterAfRing(f.polygon);
      if (tal) return tal;
      var ge = new THREE.ShapeGeometry(form), P = ge.attributes && ge.attributes.position, I = ge.index;
      tal = [];
      if (P) { var n = I ? I.count : P.count; for (var i = 0; i < n; i++) { var k = I ? I.getX(i) : i; tal.push(P.getX(k), P.getY(k)); } }
      if (ge.dispose) ge.dispose();
      return tal;
    }
    if (visD) {
      var omr = [];
      D.ringe.forEach(function (ring) { ring.forEach(function (p, i) { var q = ring[(i + 1) % ring.length]; omr.push([p[0], p[1], q[0], q[1]]); }); });
      if (D.tagform) stregerPaa(omr, loeftFor(D), "#16B9DB", 1, 954);
      else streger(omr, D.b.z1 + 0.06, "#16B9DB", 1, 954);
    }
    liste.forEach(function (f) {
      var r = { vinkelGrader: f.vinkelGrader, begge: f.begge }, farve = S.retningFarve(r), z = f.z + 0.06, aktiv = f.kilde === aktivFelt;
      var form = new THREE.Shape(f.ringe[0].map(fv));
      f.ringe.slice(1).forEach(function (h) { form.holes.push(new THREE.Path(h.map(fv))); });
      var dTag = f.skraa && f.daekId != null ? g.daekElById[f.daekId] : null, loeft = dTag ? loeftFor(dTag) : null;
      var gr = S.feltGrafik(f), linjer = gr.skravering.map(function (l) { return [l.x1, l.y1, l.x2, l.y2]; });
      f.ringe.forEach(function (ring) { ring.forEach(function (p, i) { var q = ring[(i + 1) % ring.length]; linjer.push([p[0], p[1], q[0], q[1]]); }); });
      var halo = [], pil = [];
      gr.pile.forEach(function (p) { halo = halo.concat(S.pilTrekanter(p, bredde + 0.16, hovedL + 0.34, hovedB + 0.34)); pil = pil.concat(S.pilTrekanter(p, bredde, hovedL, hovedB)); });
      if (loeft) {
        // På tagets flade: trekanterne deles, så de følger hældningen på begge sider af kippen.
        trekanterPaa(S.underdel(fladeTal(f, form), 0.6), loeft, mat(farve, aktiv ? 0.5 : 0.32), 950);
        stregerPaa(linjer, loeft, farve, 0.75, 951);
        if (pil.length) { trekanterPaa(S.underdel(halo, 0.5), loeft, mat("#ffffff", 0.95), 952); trekanterPaa(S.underdel(pil, 0.5), loeft, mat("#12302F", 1), 953); }
        return;
      }
      var flade = new THREE.Mesh(new THREE.ShapeGeometry(form), mat(farve, aktiv ? 0.5 : 0.32));
      flade.position.z = z; flade.renderOrder = 950; grp.add(flade);
      streger(linjer, z, farve, 0.75, 951);
      if (pil.length) { trekanter(halo, z, mat("#ffffff", 0.95), 952); trekanter(pil, z, mat("#12302F", 1), 953); }
    });
    var fs = bro.forskydning(); grp.position.set(fs[0], fs[1], fs[2]);
    T.scene.add(grp); spaendGruppe = grp; bro.render();
  }
  // Tre pile pr. lasttilfælde (statik.js bestemmer, hvor de står). Uden three tegnes de kun i plantegningen.
  function visPile() {
    fjernPile();
    var g = geometri(), T = bro.three();
    if (!g || !T || !T.THREE || !T.scene || !(filter === "nord" || filter === "oest")) return;
    var THREE = T.THREE, grp = new THREE.Group();
    S.lastpile(g, filter).forEach(function (p) {
      var fra = new THREE.Vector3(p.fra[0], p.fra[1], p.fra[2]), til = new THREE.Vector3(p.til[0], p.til[1], p.til[2]);
      var dir = til.clone().sub(fra), len = dir.length(); dir.normalize();
      grp.add(new THREE.ArrowHelper(dir, fra, len, 0xe3923a, Math.min(0.8, len * 0.3), 0.5));
    });
    grp.name = "issana-statik-lastpile";
    var fs = bro.forskydning(); grp.position.set(fs[0], fs[1], fs[2]);
    T.scene.add(grp); pileGruppe = grp; bro.render();
  }

  /* ---------- Plantegning med nord opad (SVG) ---------- */
  var n2 = function (v) { return (+v).toFixed(2); };
  function planSvg(resultat, opt) {
    var g = geometri(); if (!g || etage == null) return "";
    var p = S.plan(g, resultat, valg, etage, filter, opt), vb = p.viewBox;
    sidstePlan = p;
    var hoved = function (x, y, ux, uy, s) { return "M" + n2(x) + " " + n2(y) + "L" + n2(x - (ux * 0.6 + uy * 0.4) * s) + " " + n2(y + (-uy * 0.6 + ux * 0.4) * s) + "M" + n2(x) + " " + n2(y) + "L" + n2(x + (-ux * 0.6 + uy * 0.4) * s) + " " + n2(y - (uy * 0.6 + ux * 0.4) * s); };
    var sti = function (liste) {
      return liste.map(function (a) {
        var dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L, s = Math.min(1, L / 2.4);
        return "M" + n2(a.x1) + " " + n2(a.y1) + "L" + n2(a.x2) + " " + n2(a.y2) + hoved(a.x2, a.y2, ux, uy, s) + (a.dobbelt ? hoved(a.x1, a.y1, -ux, -uy, s) : "");
      }).join("");
    };
    var ringSti = function (ringe) { return ringe.map(function (r) { return "M" + r.map(function (q) { return n2(q[0]) + " " + n2(q[1]); }).join("L") + "Z"; }).join(""); };
    var tekst = function (x, y, t, stil) { return '<text transform="translate(' + n2(x) + " " + n2(y) + ') scale(1,-1)" style="font-family:Inter,system-ui,sans-serif;text-anchor:middle;' + stil + '">' + esc(t) + "</text>"; };
    var h = '<svg viewBox="' + n2(vb.x) + " " + n2(-(vb.y + vb.h)) + " " + n2(vb.w) + " " + n2(vb.h) + '" role="img" aria-label="Plan af ' + esc(etage) + ' med nord opad" style="width:100%;height:auto;display:block;background:var(--bg-elev,#f7f9f9);border:1px solid var(--border,#e1e6e8);border-radius:8px"><g transform="scale(1,-1)">';
    h += '<rect x="' + n2(p.omrids.x0) + '" y="' + n2(p.omrids.y0) + '" width="' + n2(p.omrids.x1 - p.omrids.x0) + '" height="' + n2(p.omrids.y1 - p.omrids.y0) + '" style="fill:var(--bg-paper,#fff)"></rect>';
    if (p.daekRinge) h += '<path d="' + ringSti(p.daekRinge) + '" style="fill:none;stroke:var(--muted,#7C898C);stroke-width:0.07;stroke-dasharray:0.35 0.25"></path>';
    p.felter.forEach(function (f) {
      var akt = f.id === aktivFelt;
      h += '<path d="' + ringSti(f.ringe) + '" style="fill:' + f.farve + ";fill-opacity:" + (f.defineret ? (akt ? 0.42 : 0.22) : (akt ? 0.18 : 0.05)) + ";fill-rule:evenodd;stroke:" + f.farve + ";stroke-width:" + (akt ? 0.16 : 0.07) + (f.defineret ? "" : ";stroke-dasharray:0.3 0.2") + '"></path>';
      if (f.skravering.length) h += '<path d="' + f.skravering.map(function (l) { return "M" + n2(l.x1) + " " + n2(l.y1) + "L" + n2(l.x2) + " " + n2(l.y2); }).join("") + '" style="fill:none;stroke:' + f.farve + ';stroke-width:0.035;stroke-opacity:0.5"></path>';
    });
    p.rum.forEach(function (r) { h += tekst(r.x, r.y, r.tekst, "font-size:0.6px;fill:var(--muted,#7C898C)"); });
    p.linjer.forEach(function (l) {
      if (l.kant) h += '<line x1="' + n2(l.x1) + '" y1="' + n2(l.y1) + '" x2="' + n2(l.x2) + '" y2="' + n2(l.y2) + '" style="stroke:' + l.kant + ";stroke-width:" + n2(l.bredde + 0.18) + ';stroke-linecap:square"></line>';
      h += '<line x1="' + n2(l.x1) + '" y1="' + n2(l.y1) + '" x2="' + n2(l.x2) + '" y2="' + n2(l.y2) + '" style="stroke:' + l.farve + ";stroke-width:" + n2(l.bredde) + ';stroke-linecap:square"></line>';
    });
    var last = p.pile.filter(function (a) { return a.last; }), spaend = p.pile.filter(function (a) { return !a.last; });
    if (spaend.length) {
      h += '<path d="' + sti(spaend) + '" style="fill:none;stroke:var(--bg-paper,#fff);stroke-width:0.36;stroke-linecap:round;stroke-linejoin:round"></path>';
      h += '<path d="' + sti(spaend) + '" style="fill:none;stroke:#12302F;stroke-width:0.17;stroke-linecap:round;stroke-linejoin:round"></path>';
    }
    if (last.length) h += '<path d="' + sti(last) + '" style="fill:none;stroke:var(--text,#1B2426);stroke-width:0.14;stroke-linecap:round;stroke-linejoin:round"></path>';
    p.felter.forEach(function (f) {
      if (!f.tekst || (f.type === "rum" && (!/°/.test(f.tekst.tekst) || f.tekst.laengde < 3))) return;
      h += tekst(f.tekst.x, f.tekst.y - 1.05, f.tekst.tekst, "font-size:0.72px;font-weight:700;fill:#12302F;paint-order:stroke;stroke:var(--bg-paper,#fff);stroke-width:0.22px");
    });
    var N = p.nordpil;
    h += '<path d="M' + n2(N.x) + " " + n2(N.y) + "L" + n2(N.x) + " " + n2(N.y + 1.6) + "M" + n2(N.x - 0.4) + " " + n2(N.y + 1.1) + "L" + n2(N.x) + " " + n2(N.y + 1.6) + "L" + n2(N.x + 0.4) + " " + n2(N.y + 1.1) + '" style="fill:none;stroke:var(--text,#1B2426);stroke-width:0.12;stroke-linecap:round;stroke-linejoin:round"></path>';
    h += tekst(N.x, N.y - 0.4, "N", "font-size:0.8px;font-weight:700;fill:var(--text,#1B2426)");
    p.tekster.forEach(function (t) { h += tekst(t.x, t.y, t.tekst, "font-size:0.75px;font-weight:700;fill:var(--text,#1B2426)"); });
    h += '<g id="stTegnLag">' + tegnLagHtml() + "</g>";
    return h + "</g></svg>";
  }
  // Det, der er ved at blive tegnet: hjørner, kanter og det punkt, musen fanger.
  function tegnLagHtml() {
    if (!tegner) return "";
    var P = tegner.punkter, h = "", hv = tegner.hover;
    var linje = P.concat(hv ? [[hv.x, hv.y]] : []);
    if (linje.length > 1) h += '<path d="M' + linje.map(function (q) { return n2(q[0]) + " " + n2(q[1]); }).join("L") + '" style="fill:none;stroke:#1C8C84;stroke-width:0.14"></path>';
    P.forEach(function (q, i) { h += '<circle cx="' + n2(q[0]) + '" cy="' + n2(q[1]) + '" r="' + (i === 0 && P.length > 2 ? 0.34 : 0.2) + '" style="fill:' + (i === 0 && P.length > 2 ? "#fff" : "#1C8C84") + ';stroke:#1C8C84;stroke-width:0.08"></circle>'; });
    if (hv) h += '<circle cx="' + n2(hv.x) + '" cy="' + n2(hv.y) + '" r="' + (hv.slags ? 0.3 : 0.14) + '" style="fill:none;stroke:' + (hv.slags ? "#C0391B" : "#1C8C84") + ';stroke-width:0.09"></circle>';
    return h;
  }
  function egneRinge() {
    if (!tegner) return [];
    var v = (valg.daek[tegner.daekId] || {}).egne || [];
    return v.map(function (f) { return f.polygon; });
  }
  function afslutTegning(el) {
    if (!tegner) return;
    var g = geometri(), svar = S.tilfoejFelt(g, valg, tegner.daekId, tegner.punkter);
    if (svar.fejl) { bro.fejl(svar.fejl); return; }
    aktivFelt = svar.felt.id; tegner = null; visI3d = true; gem(); render(el);
  }
  function bindPlan(el) {
    var svg = el.querySelector("#stPlan svg");
    if (!svg || !svg.getScreenCTM) return;
    function pkt(e) { var q = svg.createSVGPoint(); q.x = e.clientX; q.y = e.clientY; var m = q.matrixTransform(svg.getScreenCTM().inverse()); return [m.x, -m.y]; }
    function pixel() { var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal; return vb.width / (r.width || 1); }
    function lag() { var g = svg.querySelector("#stTegnLag"); if (g) g.innerHTML = tegnLagHtml(); }
    svg.style.cursor = tegner ? "crosshair" : "pointer";
    function fanget(p) { var P = tegner.punkter; return S.fang(geometri(), etage, p[0], p[1], 9 * pixel(), egneRinge(), P.length ? P[P.length - 1] : null); }
    svg.onmousemove = function (e) { if (!tegner) return; tegner.hover = fanget(pkt(e)); lag(); };
    svg.onmouseleave = function () { if (tegner) { tegner.hover = null; lag(); } };
    svg.onclick = function (e) {
      var p = pkt(e);
      if (tegner) {
        var f = fanget(p), P = tegner.punkter, n = P.length;
        var afst = function (q) { return Math.sqrt((q[0] - f.x) * (q[0] - f.x) + (q[1] - f.y) * (q[1] - f.y)); };
        if (n > 2 && afst(P[0]) < 12 * pixel()) { afslutTegning(el); return; }
        if (n && afst(P[n - 1]) < 4 * pixel()) return;
        P.push([f.x, f.y]); lag();
        var t = el.querySelector("#stTegnAntal"); if (t) t.textContent = flertal(P.length, "hjørne", "hjørner");
        return;
      }
      var hit = sidstePlan && S.feltVed(sidstePlan, p[0], p[1]);
      if (!hit) return;
      aktivFelt = aktivFelt === hit.id ? null : hit.id;
      if (hit.daekId != null) aktivtDaek = hit.daekId;
      if (bro.valgte().length) bro.vaelg([]);
      render(el);
    };
    svg.ondblclick = function (e) { if (tegner) { if (e.preventDefault) e.preventDefault(); afslutTegning(el); } };
  }
  function sikrTaster() {
    if (tastLytter || typeof document.addEventListener !== "function") return;
    tastLytter = true;
    document.addEventListener("keydown", function (e) {
      if (!tegner || !rod) return;
      var t = e.target && e.target.tagName;
      if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
      if (e.key === "Escape") { tegner = null; e.stopPropagation(); render(rod); }
      else if (e.key === "Enter") { e.preventDefault(); afslutTegning(rod); }
      else if (e.key === "Backspace") { e.preventDefault(); tegner.punkter.pop(); render(rod); }
    }, true);
  }

  /* ---------- Panelet ---------- */
  var CSS = ".st-h3{font-size:12.5px;font-weight:700;margin:14px 0 6px}.st-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}" +
    ".st-btn{border:1px solid var(--border,#ccd);background:var(--bg,#fff);color:var(--text,#222);border-radius:8px;padding:6px 8px;font:inherit;text-align:left;cursor:pointer}" +
    ".st-btn[aria-pressed=true]{background:var(--ok-bg,#e6f4ea);border-color:var(--ok,#4a7c59);font-weight:600}.st-btn:disabled{opacity:.5;cursor:default}" +
    ".st-col{display:flex;flex-direction:column;gap:6px}.st-row{display:flex;align-items:center;gap:8px;font-size:12.5px;border:1px solid var(--line-soft,#eee);border-radius:8px;padding:5px 8px;margin:3px 0}" +
    ".st-dot{width:10px;height:10px;border-radius:50%;display:inline-block;flex:none}.st-chip{border-radius:10px;padding:1px 8px;font-size:11px;font-weight:600}" +
    ".st-ok{background:#E6F4EA;color:#1D5B33}.st-advarsel{background:#FDF1E0;color:#7A4A00}.st-mangler{background:#FBE7E5;color:#8A1F17}.st-info{background:#EEF1F2;color:#3F4D50}" +
    ".st-note{background:var(--ok-bg,#eef6f0);border-radius:8px;padding:6px 8px;font-size:12px;margin:6px 0}.st-advar{background:#FDF1E0;color:#7A4A00}" +
    ".st-udsnit{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--muted,#667);margin:0 0 8px}.st-udsnit span{flex:1;min-width:150px}" +
    ".st-bar{height:6px;background:var(--line-soft,#eef1f2);border-radius:3px;margin-top:3px}.st-bar>div{height:6px;border-radius:3px;background:#E3923A}" +
    ".st-liste{list-style:none;margin:0;padding:0}.st-liste li{padding:5px 0;border-bottom:1px solid var(--line-soft,#eee);font-size:12.5px}.st-liste ul{margin:4px 0 0;padding-left:16px;font-size:12px;color:var(--muted,#555)}" +
    ".st-primaer{width:100%;margin-top:12px;padding:9px;font-weight:600}" +
    ".st-seg{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:6px 0 8px}.st-seg .st-btn{text-align:center;padding:6px 3px;font-size:12px}" +
    ".st-felter{display:flex;flex-direction:column;gap:3px;max-height:220px;overflow:auto;margin:6px 0}" +
    ".st-felt{display:flex;align-items:stretch;gap:3px}.st-felt .st-btn{padding:4px 7px;font-size:12px;display:flex;align-items:center;gap:7px}.st-felt .st-felt-v{flex:1;min-width:0}" +
    ".st-felt-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.st-felt-r{color:var(--muted,#555);white-space:nowrap}" +
    ".st-hvor{font-size:12.5px;margin:8px 0 6px}.st-vinkel{display:flex;align-items:center;gap:8px;margin:8px 0 2px;font-size:12.5px}.st-vinkel input[type=range]{flex:1;min-width:0}.st-vinkel input[type=number]{width:62px;padding:3px 5px;font:inherit}" +
    ".st-glyf{flex:none;color:#12302F}.st-tegn b{display:block;margin-bottom:2px}" +
    ".st-faner{flex:none;display:flex;gap:2px;padding:0 12px;border-bottom:1px solid var(--border,#e1e6e8);background:var(--bg-paper,#fff)}" +
    ".st-faner button{border:0;border-bottom:2px solid transparent;margin-bottom:-1px;background:none;color:var(--muted,#666);font:inherit;font-size:13px;padding:8px 10px;cursor:pointer}" +
    ".st-faner button:hover{color:var(--text,#111)}.st-faner button[aria-selected=true]{color:var(--accent,#0f4c4c);border-bottom-color:var(--accent,#0f4c4c);font-weight:700}";
  var cssSat = false;
  function sikrCss() { if (cssSat) return; var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); cssSat = true; }

  // Lille dobbeltpil i rækkerne: samme retning som på dækket.
  function glyf(r) {
    if (!r) return '<svg class="st-glyf" viewBox="-10 -10 20 20" width="18" height="18"></svg>';
    var pil = function (v) { return '<path transform="rotate(' + (-v) + ')" d="M-8 0H8M-8 0l3-3M-8 0l3 3M8 0l-3-3M8 0l-3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>'; };
    return '<svg class="st-glyf" viewBox="-10 -10 20 20" width="18" height="18" aria-hidden="true">' + pil(r.vinkelGrader) + (r.begge ? pil(r.vinkelGrader + 90) : "") + "</svg>";
  }
  // Hvilket dæk og hvilke felter panelet arbejder på. Det sidst valgte dæk bliver stående, også efter et klik ved siden af.
  function fokusFelter(g, fokus) {
    var ny = null, intetDaek = false;
    if (fokus.daekEl.length === 1) ny = fokus.daekEl[0];
    else if (!fokus.daekEl.length && fokus.rum.length) {
      var ids = fokus.daek.map(function (d) { return d.elementId; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      if (ids.length === 1) { if (ids[0] != null) ny = ids[0]; else intetDaek = true; }
    }
    if (ny != null) { if (ny !== aktivtDaek) { aktivtDaek = ny; aktivFelt = null; udsnit = "daek"; } }
    else if (intetDaek || (fokus.terraen && !fokus.daekEl.length && !fokus.rum.length)) { aktivtDaek = null; aktivFelt = null; }
    if (aktivtDaek != null && !g.daekElById[aktivtDaek]) { aktivtDaek = null; aktivFelt = null; }
    if (aktivtDaek == null) udsnit = "alt";
    var D = aktivtDaek != null ? g.daekElById[aktivtDaek] : null, rumFokus = fokus.daekEl.length ? [] : fokus.rum;
    var metode = D ? S.metodeFor(g, valg, D.id, rumFokus.length ? "rum" : "hele") : null;
    var liste = D ? S.feltListe(g, valg, D.id, metode) : [], maal = [], titel = "";
    if (fokus.daekEl.length > 1) {
      fokus.daekEl.forEach(function (id) { maal = maal.concat(S.feltListe(g, valg, id)); });
      titel = flertal(fokus.daekEl.length, "dæk", "dæk") + " valgt";
    } else if (rumFokus.length && (!D || metode === "rum")) {
      maal = rumFokus.map(function (id) { return g.rumById[id]; }).filter(function (r) { return r && r.daek && r.b; }).map(function (r) { return S.rumFelt(g, valg, r); });
      titel = maal.length === 1 ? maal[0].navn : flertal(maal.length, "rum", "rum") + " valgt";
    } else if (D) {
      var a = liste.filter(function (f) { return f.id === aktivFelt; })[0];
      if (!a) aktivFelt = null;
      maal = a ? [a] : liste;
      titel = a ? a.navn : metode === "hele" ? D.navn : flertal(liste.length, "felt", "felter") + " på dækket";
    }
    return { D: D, metode: metode, liste: liste, maal: maal, titel: titel, rumFokus: rumFokus };
  }

  function render(el) {
    rod = el;
    sikrCss(); sikrTaster();
    var g = geometri();
    if (!g || !g.vaegge.length) { el.innerHTML = '<div class="arb-tom">Hent modellen fra Revit først. Statik bruger væggenes og rummenes geometri fra issana-3d.</div>'; return; }
    if (etage == null || g.etageIdx[etage] == null) etage = g.etager[0] || null;
    var valgte = bro.valgte();
    var fokus = S.daekForValg(g, valgte);
    var selVaegge = valgte.filter(function (id) { return g.vaegById[id]; });
    var F = fokusFelter(g, fokus), D = F.D;
    // Planen følger det, brugeren lige har peget på, men ændrer sig ikke af sig selv bagefter.
    var fn = [aktivtDaek, fokus.rum.join(","), selVaegge[0]].join("|");
    if (fn !== fokusNoegle) {
      fokusNoegle = fn;
      if (fokus.rum.length && g.rumById[fokus.rum[0]].etage != null) etage = g.rumById[fokus.rum[0]].etage;
      else if (fokus.daekEl.length && g.daekElById[fokus.daekEl[0]].etageUnder != null) etage = g.daekElById[fokus.daekEl[0]].etageUnder;
      else if (selVaegge.length && g.vaegById[selVaegge[0]].etage != null) etage = g.vaegById[selVaegge[0]].etage;
      else if (D && D.etageUnder != null) etage = D.etageUnder;
    }
    if (tegner && D && tegner.daekId !== D.id) tegner = null;
    var R = S.vurder(g, valg);
    var h = '<p class="arb-hint">Sæt hvilken vej et dæk spænder: en etageadskillelse eller et tag. Så får væggene under dækket farve: bærende, stabiliserende eller begge dele. For et tag med hældning vælger du også, hvordan det er bygget. Tunge og lette vægge findes af sig selv ud fra opbygningen i Revit, og spændretningen afgør resten: du skal ikke vælge roller. Lette vægge er gule. Vægge under dæk, du ikke har defineret, forbliver grå.</p>';

    // Spændretning: dækket, hvordan det er delt, og retningen pr. felt
    h += '<div class="st-h3">Spændretning</div>';
    if (fokus.terraen) h += '<div class="st-note st-advar">Terrændækket hviler på jorden og har ingen spændretning. Vælg gulvet på etagen ovenover, eller vælg et rum.</div>';
    var daekListe = g.daekEl.filter(function (d) { return !g.terraen[d.id]; }).sort(function (a, b) { return a.b.z0 - b.b.z0; });
    if (daekListe.length) {
      h += '<select id="stDaek" class="arb-in" aria-label="Dæk" style="width:100%;margin-bottom:6px"><option value="">Vælg et dæk …</option>' + daekListe.map(function (d) {
        return '<option value="' + esc(d.id) + '"' + (D && D.id === d.id ? " selected" : "") + ">" + esc(d.navn + (d.etageUnder ? " over " + d.etageUnder : "")) + "</option>";
      }).join("") + "</select>";
    }
    if (D && bro.harUdsnit) {
      var kunDaek = !!udsnitDaek(g);
      h += '<div class="st-udsnit"><span>' + (kunDaek ? "3D viser dækket og etagen under" + (D.etageUnder ? " (" + esc(D.etageUnder) + ")" : "") + "." : "3D viser hele bygningen.") + '</span><button class="tbtn" id="stUdsnit">' + (kunDaek ? "Vis hele bygningen" : "Vis dækket og etagen under") + "</button></div>";
    }
    if (D && fokus.daekEl.length <= 1) {
      var antalRum = (g.daekOverRum[D.id] || []).length;
      h += '<div class="st-seg" role="group" aria-label="Sådan er dækket delt">';
      ["hele", "rum", "egne"].forEach(function (k) { h += '<button class="st-btn" data-metode="' + k + '" aria-pressed="' + (F.metode === k) + '"' + (k === "rum" && !antalRum ? " disabled" : "") + ">" + S.METODER[k] + "</button>"; });
      h += "</div>";
      if (F.metode === "hele") h += '<p class="arb-hint">Hele dækket har én retning. Er dækket tegnet i ét, men spænder forskelligt, så del det efter rum, eller tegn dine egne felter.</p>';
      // Et tag med hældning: hvordan det er bygget, afgør, hvilke vægge det hviler på (ejer, 2026-11-14).
      if (D.tagform && D.erTag && F.metode === "hele") {
        var tagValgt = (F.liste[0] && F.liste[0].tag) || "";
        h += '<div class="st-h3">Tagets konstruktion</div><p class="arb-hint">' + esc(S.tagTekst(D.tagform)) + " Vælg, hvordan taget er bygget. Det afgør, hvilke vægge det hviler på.</p>";
        h += '<div class="st-grid">';
        ["gitter", "haneband", "kip", ""].forEach(function (k) { h += '<button class="st-btn" data-tag="' + k + '" aria-pressed="' + (tagValgt === k) + '">' + (k ? esc(S.TAGTYPER[k].navn) : "Ikke valgt") + "</button>"; });
        h += "</div>";
        var tn = tagValgt ? R.tagnoter["hele:" + D.id] : null;
        if (tn) tn.forEach(function (t, i) { h += '<div class="st-note' + (i ? " st-advar" : "") + '">' + esc(t) + "</div>"; });
        else if (tagValgt) h += '<p class="arb-hint">Sæt spændretningen til én retning herunder, så bruges tagets konstruktion.</p>';
        else h += '<p class="arb-hint">Uden et valg regnes taget som et dæk: alle vægge på tværs af spændretningen bærer.</p>';
      }
      if (F.metode === "egne") {
        if (!tegner) h += '<div class="arb-row"><button class="tbtn" id="stTegnNyt">Tegn et felt i planen</button></div>';
        var dkn = S.daekning(g, valg, D.id);
        if (F.liste.length && dkn.uden > 0.02) h += '<p class="arb-hint">Ca. ' + Math.round(dkn.uden * 100) + " % af dækket har intet felt og ingen retning endnu.</p>";
        if (dkn.overlap.length) h += '<div class="st-note st-advar">' + esc(dkn.overlap.join(", ")) + " overlapper. Væggene under begge felter får begge retninger.</div>";
      }
      if (F.metode !== "hele" && F.liste.length) {
        h += '<div class="st-felter">';
        F.liste.forEach(function (f) {
          var iFokus = f.id === aktivFelt || (F.maal.length < F.liste.length && F.maal.some(function (m) { return m.id === f.id; }));
          h += '<div class="st-felt"><button class="st-btn st-felt-v" data-felt="' + esc(f.id) + '" aria-pressed="' + iFokus + '">' + glyf(f.retning) + '<span class="st-felt-n">' + esc(f.kortNavn) + '</span><span class="st-felt-r">' + esc(S.retningKort(f.retning)) + "</span></button>";
          if (f.type === "egen") h += '<button class="st-btn" data-fjern-felt="' + esc(f.id) + '" title="Slet feltet" aria-label="Slet ' + esc(f.kortNavn) + '">×</button>';
          h += "</div>";
        });
        h += "</div>";
      }
    }
    if (F.maal.length) {
      var cur = ens(F.maal.map(function (f) { return S.retningKode(f.retning); }));
      var fr = F.maal.filter(function (f) { return f.retning; })[0], v0 = fr ? fr.retning : null, vinkel = v0 ? v0.vinkelGrader : 0;
      var enkelt = F.maal.length === 1 && F.maal[0].type === "egen" ? F.maal[0] : null;
      h += '<div class="st-hvor">Retning for: <b>' + esc(F.titel) + "</b></div>";
      if (F.rumFokus.length && (!D || F.metode === "rum")) h += '<p class="arb-hint" style="margin:0 0 6px">Rummets dæk valgt. Retningen gælder kun ' + (F.maal.length === 1 ? "dette rum" : "de valgte rum") + ".</p>";
      if (enkelt) h += '<input id="stFeltNavn" class="arb-in" aria-label="Feltets navn" value="' + esc(enkelt.navn) + '" style="width:100%;margin-bottom:6px">';
      h += '<div class="st-grid">';
      [["ov", "Øst–vest"], ["ns", "Nord–syd"], ["begge", "Begge veje"], ["", "Ikke angivet"]].forEach(function (b) {
        h += '<button class="st-btn" data-spaend="' + b[0] + '" aria-pressed="' + (cur === b[0]) + '">' + b[1] + "</button>";
      });
      h += "</div>";
      var akse = S.vaegAkse(g, F.maal[0]);
      if (akse) h += '<div class="st-grid" style="margin-top:6px"><button class="st-btn" data-vinkel="' + akse.langs + '">Langs væggene (' + akse.langs + '°)</button><button class="st-btn" data-vinkel="' + akse.tvaers + '">På tværs af væggene (' + akse.tvaers + "°)</button></div>";
      h += '<div class="st-vinkel"><span>Fri vinkel</span><input id="stVinkelR" type="range" min="0" max="179" step="1" value="' + Math.round(vinkel) + '" aria-label="Vinkel fra øst mod nord"' + (cur === "fri" ? "" : ' style="opacity:.75"') + '><input id="stVinkelT" type="number" min="0" max="179.9" step="0.5" value="' + vinkel + '" aria-label="Vinkel i grader"><span>°</span></div>';
      h += '<p class="arb-hint" style="margin-top:2px">Vinklen måles fra øst mod nord: 0° er øst–vest, 90° er nord–syd.</p>';
      h += '<div class="arb-row"><button class="tbtn" id="stHjaelp">Hjælp mig med at vælge</button></div>';
    } else if (!fokus.terraen && !(D && F.metode === "egne")) {
      h += '<p class="arb-hint">Vælg et dæk på listen, klik på det i 3D, eller vælg et rum for dækket over rummet. På øverste etage er det taget.</p>';
    }
    if (fokus.rum.length && !D && F.maal.some(function (f) { return f.daekId == null; })) h += '<p class="arb-hint">Der er ikke tegnet et dæk over rummet. Retningen gælder rummet alene.</p>';
    h += '<div class="arb-row"><button class="tbtn" id="stAlle">Foreslå for alle dæk uden spændretning</button></div>';
    if (note) h += '<div class="st-note">' + esc(note) + "</div>";

    // Plan med nord opad: her ses retningen altid, og egne felter tegnes her
    var planOpt = D ? { daekId: D.id, metode: F.metode } : null;
    h += '<div class="arb-row" style="margin-top:10px"><span class="arb-tal">Plan med nord opad</span><select id="stEtage" class="arb-in">' + g.etager.map(function (e) { return '<option value="' + esc(e) + '"' + (e === etage ? " selected" : "") + ">" + esc(e) + "</option>"; }).join("") + "</select></div>";
    if (tegner) h += '<div class="st-note st-tegn"><b>Tegn et felt</b>Klik hjørnerne i planen. Punkterne fanger vægge og hjørner. Slut på det første punkt, eller tryk «Færdig». <span id="stTegnAntal">' + flertal(tegner.punkter.length, "hjørne", "hjørner") + '</span><div class="arb-row"><button class="tbtn" id="stTegnFaerdig">Færdig</button><button class="tbtn" id="stTegnFortryd">Fortryd punkt</button><button class="tbtn" id="stTegnAnnuller">Annullér</button></div></div>';
    h += '<div id="stPlan">' + planSvg(R, planOpt) + "</div>";

    // Væggens type: fundet ud fra opbygningen. Det eneste, der kan rettes, er, om væggen er tung eller let.
    if (selVaegge.length) {
      var curType = ens(selVaegge.map(function (id) { var t = R.vaegtype(id); return t === "skive" ? "let" : t; }));
      h += '<div class="st-h3">Væggens type · ' + flertal(selVaegge.length, "væg", "vægge") + ' valgt</div><div class="st-grid">';
      ["tung", "let"].forEach(function (k) { h += '<button class="st-btn" data-type="' + k + '" aria-pressed="' + (curType === k) + '">' + esc(S.VAEGTYPE[k]) + "</button>"; });
      h += '</div><p class="arb-hint">' + esc(S.VAEGTYPE_HJAELP[curType] || "De valgte vægge har forskellige typer.") + "</p>";
      var skoennet = selVaegge.filter(function (id) { return R.skoen && R.skoen[id]; });
      if (skoennet.length) h += '<p class="arb-hint">' + (skoennet.length === selVaegge.length ? "Typen er fundet ud fra " : flertal(skoennet.length, "væg", "vægge") + " har en type, der er fundet, fx ud fra ") + esc(R.skoen[skoennet[0]].grund) + ". Ret den herover, hvis det ikke passer.</p>";
      // Det, der skal huskes i projektet for de valgte lette vægge.
      var husk = selVaegge.filter(function (id) { return R.noter && R.noter[id]; });
      if (husk.length) h += '<div class="st-note">' + esc(R.noter[husk[0]]) + "</div>";
    }

    // Resultat
    h += '<div class="st-h3">Resultat for væggene</div>';
    if (!R.filtre.alle.length) h += '<p class="arb-hint">Ingen bærende eller stabiliserende vægge endnu. Sæt en spændretning på et dæk; så finder Statik selv rollerne.</p>';
    else ["baerende", "stab", "begge", "ingen"].forEach(function (k) {
      h += '<div class="st-row"><span class="st-dot" style="background:' + S.VAL[k].farve + '"></span><span style="flex:1">' + esc(S.statikTekst(k)) + "</span><b>" + (R.antal[k] || 0) + "</b></div>";
    });
    // Lette vægge: altid med, i deres egen faste farve, også før et dæk har fået en retning.
    h += '<div class="st-row"><span class="st-dot" style="background:' + S.LET_FARVE + '"></span><span style="flex:1">Let væg</span><b>' + (R.antal.let || 0) + "</b></div>";
    if (R.antal.letMedRolle) h += '<div class="st-note">' + flertal(R.antal.letMedRolle, "let væg", "lette vægge") + " bærer et dæk og har en gul kant. Skal de også stabilisere, skal de have plader på og forankres. Husk det i projektet.</div>";
    h += '<p class="arb-hint">Tunge og lette vægge findes ud fra væggens opbygning i Revit (gips, skelet, glasfacade er lette). En let væg, som et dæk hviler på, er bærende. Den stabiliserer ikke, før den får plader på.</p>';

    // Filtre, plan, tekst
    h += '<div class="st-h3">Bærende og stabiliserende system</div><div class="st-col">';
    S.FILTRE.forEach(function (f) { h += '<button class="st-btn" data-filter="' + f.id + '" aria-pressed="' + (filter === f.id) + '">' + esc(f.titel) + (f.id !== "alle" ? " (" + R.filtre[f.id].length + ")" : "") + "</button>"; });
    h += "</div>";
    h += '<p style="font-size:12.5px;margin:8px 0 0">' + esc(S.filterTekst(g, R, filter)) + "</p>";

    // Andel
    var andel = S.andel(g, R, filter, etage);
    if (andel.length) {
      h += '<div class="st-h3">Hvor meget tager hver væg? · ' + esc(etage) + '</div><ul class="st-liste">';
      andel.forEach(function (a) { h += "<li><div style=\"display:flex;gap:8px\"><span style=\"flex:1\">" + esc(a.navn) + '</span><span class="arb-n">' + dk(a.effektiv) + " m</span><b style=\"width:44px;text-align:right\">" + Math.round(a.andel * 100) + ' %</b></div><div class="st-bar"><div style="width:' + Math.round(a.andel * 100) + '%"></div></div></li>'; });
      h += '</ul><p class="arb-hint">Fordelt efter væggens længde uden døre og vinduer. Det er forenklet: i virkeligheden tager lange vægge endnu mere, fordi en væg bliver meget stivere, jo længere den er.</p>';
    }

    // Tjek
    h += '<div class="st-h3">Tjek af stabiliteten · ' + esc(etage) + '</div><ul class="st-liste">';
    S.tjek(g, R, etage).forEach(function (c) {
      var navn = { ok: "OK", advarsel: "Advarsel", mangler: "Mangler", info: "Info" }[c.status] || c.status;
      h += '<li><div style="display:flex;align-items:center;gap:8px"><b style="flex:1">' + esc(c.titel) + '</b><span class="st-chip st-' + c.status + '">' + navn + '</span></div><div style="font-size:12px;color:var(--muted,#555);margin-top:3px">' + esc(c.tekst) + "</div></li>";
    });
    h += '</ul><p class="arb-hint">Tjekket gælder den valgte etage. Døre og vinduer hentes fra Revit (vinduer og døre med værtsvæg).</p>';

    // Hvorfor
    h += '<div class="st-h3">Hvorfor?</div>';
    var hv = selVaegge.filter(function (id) { return R.hvorfor[id]; }).slice(0, 4);
    if (!hv.length) h += '<p class="arb-hint">Vælg en væg under et dæk med spændretning (eller med en rolle), så forklares resultatet her.</p>';
    else {
      h += '<ul class="st-liste">';
      hv.forEach(function (id) { var w = g.vaegById[id]; h += '<li><div style="display:flex;align-items:center;gap:8px"><span class="st-dot" style="background:' + S.farve(R.res[id]) + '"></span><b style="flex:1">' + esc(w.navn) + "</b><span>" + esc(S.statikTekst(R.res[id])) + "</span></div><ul>" + R.hvorfor[id].map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></li>"; });
      h += "</ul>";
    }

    // Brug som forslag
    var rows = S.forslag(g, R, function (id) { var w = g.vaegById[id]; return bro.nuvaerende(w.uniqueId, PARAM, w.el); });
    h += '<button class="tbtn primary st-primaer" id="stBrug"' + (rows.length ? "" : " disabled") + ">Brug som forslag i Konstruktiv funktion" + (rows.length ? " (" + rows.length + ")" : "") + "</button>";
    h += '<p class="arb-hint">I Revit skrives resultatet i «' + PARAM + '» som Bærende, Stabiliserende eller Begge. «Bærende og stabiliserende» hedder Begge i Revit. Forslaget lægges i ændringslisten; først «Gem i Revit» skriver.</p>';
    h += '<p class="arb-hint">Forenklet vurdering ud fra spændretning og vægtype. Det er ikke en statisk beregning. Ingeniøren skal godkende, før noget skrives i Revit.</p>';
    h += '<div class="arb-row"><button class="tbtn" id="stRyd">' + (visI3d ? "Fjern farver og pile i 3D" : "Vis farver og pile i 3D") + '</button><button class="tbtn" id="stNulstil">Nulstil alle valg</button></div>';
    el.innerHTML = h;

    // Hændelser
    var opd = function () { visI3d = true; gem(); render(el); };
    function saetAlle(r) { if (D) udsnit = "daek"; F.maal.forEach(function (f) { S.saetRetning(g, valg, f.id, r); }); }
    el.querySelectorAll("[data-tag]").forEach(function (b) {
      b.onclick = function () { if (!D) return; S.saetTag(g, valg, D.id, b.getAttribute("data-tag") || null); udsnit = "daek"; visI3d = true; gem(); render(el); };
    });
    var uds = el.querySelector("#stUdsnit"); if (uds) uds.onclick = function () { udsnit = udsnitDaek(g) ? "alt" : "daek"; visI3d = true; render(el); };
    function live() { var p = el.querySelector("#stPlan"); if (p) { p.innerHTML = planSvg(S.vurder(g, valg), planOpt); bindPlan(el); } visI3d = true; visSpaend(); }
    el.querySelectorAll("[data-spaend]").forEach(function (b) { b.onclick = function () {
      var v = b.getAttribute("data-spaend");
      saetAlle(v === "begge" && v0 && S.retningKode(v0) === "fri" ? { vinkelGrader: v0.vinkelGrader, begge: true } : (v || null));
      note = ""; opd();
    }; });
    el.querySelectorAll("[data-vinkel]").forEach(function (b) { b.onclick = function () { saetAlle({ vinkelGrader: Number(b.getAttribute("data-vinkel")), begge: false }); note = ""; opd(); }; });
    var vr = el.querySelector("#stVinkelR"), vt = el.querySelector("#stVinkelT");
    if (vr) {
      vr.oninput = function () { if (vt) vt.value = vr.value; saetAlle({ vinkelGrader: Number(vr.value), begge: !!(v0 && v0.begge) }); live(); };
      vr.onchange = function () { saetAlle({ vinkelGrader: Number(vr.value), begge: !!(v0 && v0.begge) }); note = ""; opd(); };
    }
    if (vt) vt.onchange = function () { var v = Number(String(vt.value).replace(",", ".")); if (!isFinite(v)) { render(el); return; } saetAlle({ vinkelGrader: v, begge: !!(v0 && v0.begge) }); note = ""; opd(); };
    el.querySelectorAll("[data-metode]").forEach(function (b) { b.onclick = function () { if (D) { S.saetMetode(g, valg, D.id, b.getAttribute("data-metode")); aktivFelt = null; tegner = null; note = ""; opd(); } }; });
    el.querySelectorAll("[data-felt]").forEach(function (b) { b.onclick = function () {
      var id = b.getAttribute("data-felt");
      aktivFelt = aktivFelt === id ? null : id;
      if (bro.valgte().length) bro.vaelg([]);
      render(el);
    }; });
    el.querySelectorAll("[data-fjern-felt]").forEach(function (b) { b.onclick = function () { var id = b.getAttribute("data-fjern-felt"); S.fjernFelt(valg, id); if (aktivFelt === id) aktivFelt = null; opd(); }; });
    var fnavn = el.querySelector("#stFeltNavn"); if (fnavn && enkelt) fnavn.onchange = function () { S.omdoebFelt(valg, enkelt.id, fnavn.value); opd(); };
    var dv = el.querySelector("#stDaek"); if (dv) dv.onchange = function () {
      var d = g.daekEl.filter(function (x) { return String(x.id) === dv.value; })[0];
      aktivtDaek = d ? d.id : null; aktivFelt = null; tegner = null; note = ""; udsnit = d ? "daek" : "alt";
      if (d && d.etageUnder != null) etage = d.etageUnder;
      bro.vaelg(d ? [d.id] : []);
      render(el);
    };
    var nyt = el.querySelector("#stTegnNyt"); if (nyt) nyt.onclick = function () {
      if (!D) return;
      tegner = { daekId: D.id, punkter: [], hover: null }; aktivFelt = null;
      if (D.etageUnder != null) etage = D.etageUnder;
      render(el);
      var pl = el.querySelector("#stPlan"); if (pl && pl.scrollIntoView) pl.scrollIntoView({ block: "center" });
    };
    var tf = el.querySelector("#stTegnFaerdig"); if (tf) tf.onclick = function () { afslutTegning(el); };
    var tb = el.querySelector("#stTegnFortryd"); if (tb) tb.onclick = function () { if (tegner) { tegner.punkter.pop(); render(el); } };
    var ta = el.querySelector("#stTegnAnnuller"); if (ta) ta.onclick = function () { tegner = null; render(el); };
    el.querySelectorAll("[data-type]").forEach(function (b) { b.onclick = function () { var v = b.getAttribute("data-type"); selVaegge.forEach(function (id) { valg.vaegtype[id] = v; }); opd(); }; });
    // Et filter viser væggenes roller: hele bygningen.
    el.querySelectorAll("[data-filter]").forEach(function (b) { b.onclick = function () { filter = b.getAttribute("data-filter"); visI3d = true; udsnit = "alt"; render(el); }; });
    var sel = el.querySelector("#stEtage"); if (sel) sel.onchange = function () { etage = sel.value; tegner = null; render(el); };
    var hj = el.querySelector("#stHjaelp"); if (hj) hj.onclick = function () {
      var t = [];
      F.maal.forEach(function (f) { var s = S.foreslaaFelt(f); if (s.retning) S.saetRetning(g, valg, f.id, s.retning); t.push(s.hvorfor); });
      note = "Jeg har valgt den korteste vej. " + t.slice(0, 3).join(" ") + (t.length > 3 ? " Og " + (t.length - 3) + " felter mere." : "");
      if (F.metode === "hele" && D && (g.daekOverRum[D.id] || []).length > 1) note += " Dækket ligger over flere rum. Vælg «Ét felt pr. rum», hvis hvert rum skal have sin egen retning.";
      opd();
    };
    el.querySelector("#stAlle").onclick = function () {
      var n = S.foreslaaAlle(g, valg);
      note = n ? flertal(n, "felt", "felter") + " fik spændretning efter korteste vej. Terrændæk er ikke med." : "Alle dæk har allerede en spændretning."; opd();
    };
    el.querySelector("#stBrug").onclick = function () {
      var n = 0;
      rows.forEach(function (r) {
        var w = g.vaegById[r.id];
        var ok = bro.tilfoej({ uniqueId: r.uniqueId, param: PARAM, fra: r.fra, til: r.til, navn: w.navn + " (" + w.id + ")", obj: w.el, instans: true, hvad: ["statik"], kraeverOpsaetning: !(w.el.bygdata && w.el.bygdata.raw && w.el.bygdata.raw[PARAM] != null) });
        if (ok !== false) n++;
      });
      if (!n) { bro.fejl("Ingen ændringer kunne lægges i listen."); return; }
      bro.vaelg(rows.map(function (r) { return r.id; }));
      bro.info(n + " forslag lagt i ændringslisten som «" + PARAM + "». Se forhåndsvisningen, og tryk «Gem i Revit», når ingeniøren har godkendt.");
      bro.visAendringer();
    };
    el.querySelector("#stRyd").onclick = function () {
      if (visI3d) { visI3d = false; fjernFarver(); render(el); } else { visI3d = true; render(el); }
    };
    el.querySelector("#stNulstil").onclick = function () { valg = tomtValg(); note = ""; aktivFelt = null; fjernFarver(); opd(); };

    bindPlan(el);
    anvendUdsnit(g);
    if (visI3d) { farvelaeg(R); visPile(); visSpaend(); }
  }

  /* ---------- To faner i docken: Stabilitet og Laster og redegørelse ---------- */
  // Fanebjælken og lasternes krop ligger ved siden af Stabilitets krop i docken, så hver fane ruller for sig, og bjælken altid kan ses.
  // Kun den åbne fane må vise noget i 3D: Stabilitets farver og lasternes pile fylder det samme billede.
  var FANER = [["stab", "Stabilitet"], ["last", "Laster og redegørelse"]];
  function lukLaster() { if (lastHandle && lastHandle.luk) lastHandle.luk(); }
  function visLaster() {
    if (!lastKrop) return;
    if (lastHandle) { lastHandle.vis(); return; }
    if (window.IssanaStatikLaster) lastHandle = window.IssanaStatikLaster.monter(lastKrop, lastApi) || null;
    if (!lastHandle) lastKrop.innerHTML = '<div class="arb-tom">Laster-delen er ikke indlæst endnu. Tryk på fanen igen om et øjeblik.</div>';
  }
  function visDele() {
    faneBar.querySelectorAll("[data-st-fane]").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-st-fane") === fane)); });
    stabKrop.hidden = fane !== "stab"; lastKrop.hidden = fane !== "last";
  }
  function skiftFane(navn) {
    if (!faneBar || (navn !== "stab" && navn !== "last") || (navn === fane && (navn === "stab" || lastHandle))) return;
    fane = navn; visDele();
    if (fane === "last") { fjernFarver(); visLaster(); }
    else { lukLaster(); render(stabKrop); }
  }
  // Uden dock og layoutets api (2.12-reserven, tests af selve panelet) er der kun Stabilitet.
  function lavFaner(container, api) {
    var far = container.parentNode;
    if (!far || !far.insertBefore || !api || !api.model || (faneBar && faneBar.parentNode === far)) return;
    sikrCss();
    stabKrop = container; lastApi = api;
    faneBar = document.createElement("div");
    faneBar.className = "st-faner"; faneBar.setAttribute("role", "tablist"); faneBar.setAttribute("aria-label", "Statik");
    faneBar.innerHTML = FANER.map(function (f) { return '<button type="button" role="tab" data-st-fane="' + f[0] + '">' + esc(f[1]) + "</button>"; }).join("");
    faneBar.querySelectorAll("[data-st-fane]").forEach(function (b) { b.onclick = function () { skiftFane(b.getAttribute("data-st-fane")); }; });
    lastKrop = document.createElement("div");
    lastKrop.className = container.className; lastKrop.setAttribute("role", "tabpanel"); container.setAttribute("role", "tabpanel");
    far.insertBefore(faneBar, container); far.appendChild(lastKrop);
    visDele();
  }

  /* ---------- Montering ---------- */
  function monter(container, api) {
    S = window.IssanaStatik;
    if (!S) { container.innerHTML = '<div class="arb-tom">statik.js er ikke indlæst.</div>'; advar("statik.js mangler"); return; }
    bro = lavBro(api);
    hent();
    lavFaner(container, api);
    render(container);
    // Kun mens docken er synlig: en skjult Statik-fane må ikke farve 3D igen ved næste valg (layoutet kalder luk() ved lukning
    // og vis() ved genåbning). offsetParent er null for skjulte elementer; i tests uden layout er den undefined.
    var synlig = function () { return fane === "stab" && container.isConnected && container.offsetParent !== null; };
    bro.paa("valg", function () { if (synlig()) render(container); });
    bro.paa("model", function () { fjernPile(); fjernSpaend(); fjernKant(); spoegelse = []; geo = null; geoFor = null; note = ""; hent(); farvetAktiv = false; pileGruppe = null; spaendGruppe = null; aktivtDaek = null; aktivFelt = null; tegner = null; fokusNoegle = ""; udsnit = "alt"; udsnitFor = null; if (synlig()) render(container); });
    return { opdater: function () { if (fane === "last") visLaster(); else render(container); }, luk: function () { fjernFarver(); lukLaster(); } };
  }
  function vis(container) { if (!S || !bro || !container) return; if (fane === "last") { visLaster(); return; } visI3d = true; render(container); }
  window.issanaStatikMonter = monter;
  window.IssanaArbejdsrumStatik = { lavBro: lavBro, monter: monter, PARAM: PARAM, tilstand: tilstand, visFane: skiftFane, fane: function () { return fane; } };

  var registreret = false;
  function registrer() {
    if (registreret) return true;
    var ny = window.issanaArbejdsrum;
    if (ny && typeof ny.registrerFane === "function") { registreret = true; ny.registrerFane({ id: "statik", titel: "Statik", monter: monter, vis: vis }); return true; }
    // Layoutet (arbejdsrum-layout.js) kan komme senere i html'en: vent, til siden er færdigindlæst, før 2.12-reserven bruges
    if (typeof document !== "undefined" && document.readyState && document.readyState !== "complete") return false;
    var A = window.IssanaArbejdsrum;
    if (A && typeof A.fane === "function") {
      registreret = true;
      var apiFor = null, mon = false;
      A.fane({ id: "statik", titel: "Statik", valg: true,
        render: function (el) { if (!mon) { mon = true; monter(el, apiFor); } else { S = window.IssanaStatik; bro = bro || lavBro(apiFor); render(el); } },
        model: function () { geo = null; geoFor = null; } });
      return true;
    }
    return false;
  }

  // Indlæs de tre andre filer fra samme mappe (i rækkefølge), og registrér så fanen.
  function indlaes(i, klar) {
    if (i >= FILER.length) { klar(); return; }
    var s = document.createElement("script"); s.src = mappe + FILER[i];
    s.onload = function () { indlaes(i + 1, klar); };
    s.onerror = function () { advar("kunne ikke indlæse " + FILER[i]); indlaes(i + 1, klar); };
    document.head.appendChild(s);
  }
  indlaes(0, function () {
    if (registrer()) return;
    // Layoutet samler funktioner i window.issanaArbejdsrumVentende op, når det starter; ellers prøves igen, og 2.12-reserven
    // bruges, når siden er færdigindlæst uden layout. Giver op med en advarsel.
    (window.issanaArbejdsrumVentende = window.issanaArbejdsrumVentende || []).push(function () { registrer(); });
    var forsoeg = 0, t = setInterval(function () { if (registrer() || ++forsoeg > 50) { clearInterval(t); if (forsoeg > 50) advar("hverken window.issanaArbejdsrum.registrerFane eller IssanaArbejdsrum.fane findes. Kald window.issanaStatikMonter(container, api) selv."); } }, 200);
  });
})();
