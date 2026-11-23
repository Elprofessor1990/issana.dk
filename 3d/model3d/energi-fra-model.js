/* ISSANA 3D: Energi-fanens model ud fra 3D-eksporten. Rent modul uden DOM. Browser: window.IssanaEnergiModel. Node: module.exports.
   Bruger bygningsdel-placering.js og varmetab-placering.js til at afgøre, hvad der vender mod det fri, jord og uopvarmede rum.

   Fra modellen: arealer, retninger, antal, vinduesmål, opvarmet etageareal, etager, U-værdier, hvor Revit har dem.
   Revit-modellen kender ikke g-værdi, glasandel, skygger, ventilation, forsyning og linjetab. De får standardværdier, der er
   mærket «antaget» i fanen, indtil brugeren har rettet dem. Glaspanelers U i Revit (fx 6,7) er ikke en vinduesværdi og bruges ikke. */
(function (root, fabrik) {
  "use strict";
  var erNode = typeof module === "object" && module && module.exports;
  var api = fabrik(root, erNode);
  if (erNode) module.exports = api; else root.IssanaEnergiModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, erNode) {
  "use strict";
  var P = erNode ? require("./bygningsdel-placering.js") : root.IssanaPlacering;
  var V = erNode ? require("./varmetab-placering.js") : root.IssanaVarmetabPlacering;
  var RAD = Math.PI / 180, KAELDER = /k[æa]lder|basement|\bu\.?\s*etage\b/i;

  // Fra Energy Designs klimadata «Københavns Lufthavn».
  var KLIMA = { name: "Københavns Lufthavn", supp_start: 810, supp_slope: -35.5, ude: [1.3, 1.1, 3.1, 7.4, 12.1, 15.5, 18.5, 18, 14.4, 9.7, 5.9, 2.3], fugtUde: [88, 87, 81, 76, 74, 74, 75, 78, 81, 84, 88, 89], fugtInde: [57.9, 57.6, 56.4, 56.9, 61, 66.8, 74.9, 76.2, 69.6, 63.2, 60.6, 58.6] };
  var STD = {
    vindue: { u: 0.8, g: 0.5, ff: 0.7, eref: 20, type: 200 },
    glas: { u: 1.0, g: 0.5, ff: 0.9, eref: 20, type: 200 },
    doer: { u: 1.0, g: 0, ff: 0, eref: -100, type: 202 },
    skygge: { horizon: 10, overhang: 0, sidefin_left: 0, sidefin_right: 0, opening: 10 },
    uVaeg: 0.15, uTag: 0.1, uDaek: 0.15, uJord: 0.15, ventUopvarmet: 0.3, psiFundament: 0.12, psiVindue: 0.03, psiGlas: 0.04
  };

  function rund(x, d) { var f = Math.pow(10, d == null ? 2 : d), r = Math.round(x * f) / f; return r === 0 ? 0 : r; }
  function kopi(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- Geometri ---------- */
  // Bygningsdelens lodrette hovedflade som vinkel fra projektnord med uret, i halvplanet 0-180. null uden lodrette flader.
  function hovedretning(meshes) {
    var sum = {};
    P.geo.hvertTrekant(meshes, function (ax, ay, az, bx, by, bz, cx, cy, cz) {
      var ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-9 || Math.abs(nz / l) > 0.3) return;
      var v = Math.atan2(nx, ny) / RAD; if (v < 0) v += 360; if (v >= 180) v -= 180;
      var k = Math.round(v / 3) * 3 % 180; sum[k] = (sum[k] || 0) + l / 2;
    });
    var bedst = null, m = 0;
    Object.keys(sum).forEach(function (k) { if (sum[k] > m) { m = sum[k]; bedst = Number(k); } });
    return bedst;
  }
  function midte(b) { return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, z: (b.z0 + b.z1) / 2 }; }
  // Udadvendt retning: væk fra det opvarmede rum (eller væk fra bygningens midte, når rummet ikke kendes).
  function udad(halv, bEl, bRum) {
    var n = { x: Math.sin(halv * RAD), y: Math.cos(halv * RAD) }, a = midte(bEl), r = midte(bRum);
    return n.x * (a.x - r.x) + n.y * (a.y - r.y) >= 0 ? halv : (halv + 180) % 360;
  }
  // Mere sikkert: prøv et punkt på hver side af elementets midte. Den side, der ligger i rummet, er indad. Null, hvis ingen af dem gør.
  function udadVedRum(halv, bEl, rum) {
    if (!rum || !rum.meshes || !rum.meshes.length || !rum.boks) return null;
    var n = { x: Math.sin(halv * RAD), y: Math.cos(halv * RAD) }, c = midte(bEl), z = Math.max(rum.boks.z0 + 0.3, Math.min(rum.boks.z1 - 0.3, c.z));
    for (var d = 0.4; d <= 1.3; d += 0.3) {
      var plus = P.geo.iRum(rum, c.x + n.x * d, c.y + n.y * d, z), minus = P.geo.iRum(rum, c.x - n.x * d, c.y - n.y * d, z);
      if (plus && !minus) return (halv + 180) % 360;
      if (minus && !plus) return halv;
    }
    return null;
  }
  // Bredde (i væggens plan) og højde af elementet.
  function maal(meshes, az) {
    var hx = Math.cos(az * RAD), hy = -Math.sin(az * RAD), nx = Math.sin(az * RAD), ny = Math.cos(az * RAD), s0 = Infinity, s1 = -Infinity, z0 = Infinity, z1 = -Infinity, d0 = Infinity, d1 = -Infinity;
    (meshes || []).forEach(function (m) { var p = m && m.pos; if (!p) return; for (var i = 0; i + 2 < p.length; i += 3) { var s = p[i] * hx + p[i + 1] * hy, d = p[i] * nx + p[i + 1] * ny; if (s < s0) s0 = s; if (s > s1) s1 = s; if (d < d0) d0 = d; if (d > d1) d1 = d; if (p[i + 2] < z0) z0 = p[i + 2]; if (p[i + 2] > z1) z1 = p[i + 2]; } });
    return s1 >= s0 ? { b: s1 - s0, h: z1 - z0, t: d1 - d0, s0: s0, s1: s1, z0: z0, z1: z1 } : { b: 0, h: 0, t: 0 };
  }
  // Går en vandret stråle fra punktet udad gennem en anden bygningsdels boks inden for afstanden? (slab-test i planen)
  function rammerBoks(x, y, z, nx, ny, afstand, b) {
    if (z < b.z0 || z > b.z1) return false;
    var t0 = 0.02, t1 = afstand, akser = [[x, nx, b.x0, b.x1], [y, ny, b.y0, b.y1]];
    for (var i = 0; i < 2; i++) {
      var o = akser[i][0], d = akser[i][1], a = akser[i][2], c = akser[i][3];
      if (Math.abs(d) < 1e-6) { if (o < a || o > c) return false; continue; }
      var u = (a - o) / d, v = (c - o) / d; if (u > v) { var w = u; u = v; v = w; }
      if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) return false;
    }
    return true;
  }
  function kompas(az) {
    var d = Math.round(az / 90) % 4, afv = Math.abs(((az - d * 90 + 540) % 360) - 180);
    if (afv <= 22.5) return { kode: ["n", "ø", "s", "v"][d], navn: ["Nord", "Øst", "Syd", "Vest"][d], grader: d * 90 };
    var g = Math.round(az / 5) * 5 % 360, m = ["Nordøst", "Sydøst", "Sydvest", "Nordvest"][Math.floor(az / 90) % 4];
    return { kode: g, navn: m + " " + g + "°", grader: g };
  }

  /* ---------- Modellen ---------- */
  function fraModel(model, opt) {
    opt = opt || {};
    var a = P.analyser(model), rand = V.randbetingelser(opt.rand), ix = a.ix, sandNord = (model.placering && model.placering.sandNordVinkel) || 0;
    var els = {}; (model.elements || []).forEach(function (e) { if (e && !e.erRum) els[String(e.id)] = e; });
    var byg = P.geo.boks([].concat.apply([], (model.elements || []).filter(function (e) { return e && !e.erRum && !e.installation && e.meshes; }).map(function (e) { return e.meshes; })));
    var adv = [], afklares = [], konstr = {}, orden = [], vaertGruppe = {}, ae = {}, zNiv = {};
    var uhInt = [], uhEks = {}, uhGulv = 0, antal = { vindue: 0, doer: 0, glas: 0 }, glasUde = {};
    var fundament = 0, omkredsVindue = 0, uhIds = [];
    function erOpvarmet(id) { if (id == null) return false; var r = ix.rumAfId[String(id)]; if (!r) return false; if (opt.kaelderUopvarmet !== false && KAELDER.test(String(r.niveau || ""))) return false; var s = V.side({ art: "rum", rumtype: r.rumtype.id, tilstand: (a.rum.filter(function (x) { return x.id === id; })[0] || {}).tilstand, navn: r.navn }, rand); return s.art === "opvarmet"; }
    function rumside(f) { return f.a && f.a.art === "rum" && erOpvarmet(f.a.rumId) ? f.a : (f.b && f.b.art === "rum" && erOpvarmet(f.b.rumId) ? f.b : (f.a && f.a.art === "rum" ? f.a : (f.b && f.b.art === "rum" ? f.b : null))); }
    function aziAf(e, f) {
      var halv = hovedretning(e.meshes); if (halv == null) return null;
      var bEl = P.geo.boks(e.meshes), s = rumside(f), r = s ? ix.rumAfId[String(s.rumId)] : null;
      var ud = udadVedRum(halv, bEl, r);
      if (ud == null) ud = udad(halv, bEl, r && r.boks ? r.boks : byg);
      return ((ud - sandNord) % 360 + 360) % 360;
    }
    function gruppe(k, ny) { if (!konstr[k]) { konstr[k] = ny; orden.push(k); } return konstr[k]; }
    function nyKonstr(o) { return Object.assign({ netto: 0, ids: [], aabninger: [], td_out: -12, b: 1, slope: 90, orient: "0", uKilde: null }, o); }
    function uFra(el, standard) { var u = el.uValue; if (typeof u === "number" && u > 0.03 && u < 4) return { u: rund(u, 3), kilde: el.uValueSource === "exercise" ? "exercise" : "revit" }; return { u: standard, kilde: "antaget" }; }

    function juster(f) {
      if (opt.kaelderUopvarmet === false) return f;
      var s = function (x) { return x && x.art === "rum" && KAELDER.test(String(x.niveau || "")) && x.tilstand !== "ude" ? Object.assign({}, x, { tilstand: "uopvarmet" }) : x; };
      return Object.assign({}, f, { a: s(f.a), b: s(f.b) });
    }
    function koldUopv(f) {
      var kold = function (x) { return x && x.art === "rum" && !erOpvarmet(x.rumId) && x.tilstand !== "ude"; }, fri = function (x) { return x && (x.art === "ude" || x.art === "jord"); };
      return (kold(f.a) && fri(f.b)) || (kold(f.b) && fri(f.a));
    }
    function erGlasvaeg(el) { return /curtain|glasfacade/i.test(String(el.family || "") + " " + String(el.type || "")); }
    var vaegge = [], AFSTAND_SKAKT = 5;
    var alleVaegge = (model.elements || []).filter(function (e) { return e && !e.erRum && e.category === "Vægge" && e.meshes && e.meshes.length; }).map(function (e) { return { id: e.id, boks: P.geo.boks(e.meshes) }; });
    // En «ydervæg» med en anden væg lige udenfor står i virkeligheden inde i bygningen (skakt, niche uden tegnet rum).
    function erInde(el, azProj) {
      var b = P.geo.boks(el.meshes); if (!b) return false;
      var nx = Math.sin(azProj * RAD), ny = Math.cos(azProj * RAD), c = midte(b), m = maal(el.meshes, azProj), halv = (m.t || 0) / 2 + 0.05, x = c.x + nx * halv, y = c.y + ny * halv;
      return alleVaegge.some(function (v) { return v.id !== el.id && v.boks && rammerBoks(x, y, c.z, nx, ny, AFSTAND_SKAKT, v.boks); });
    }
    a.elementer.forEach(function (e) {
      if (e.udenfor || !e.flader.length) return;
      var el = els[String(e.id)]; if (!el) return;
      var fl = e.flader.map(function (f0) { var f = juster(f0); return { f: f, v: V.vurderFlade(f, rand), andel: f.andel == null ? 1 : f.andel }; });
      // Opvarmet etageareal: hele dækket tæller, når der er opvarmet rum over det (BR18 måler til ydersiden af ydervæggene).
      if ((e.kategori === "Gulve" || e.kategori === "Tage") && fl.some(function (x) { return x.f.over != null && erOpvarmet(x.f.over); })) {
        ae[e.niveau || "Etage"] = (ae[e.niveau || "Etage"] || 0) + (e.areal || 0);
        var b0 = P.geo.boks(el.meshes); if (b0) zNiv[e.niveau || "Etage"] = b0.z1;
      }
      // Klimaskærmen på det uopvarmede rum: bruges til temperaturfaktoren.
      if (e.kategori === "Vægge" || e.kategori === "Gulve" || e.kategori === "Tage") fl.forEach(function (x) {
        if (!x.v.ikke || !koldUopv(x.f)) return;
        var kUh = e.kategori + "|" + e.type, uh = uhEks[kUh] || (uhEks[kUh] = Object.assign({ id: e.type, area: 0 }, uFra(el, STD.uJord)));
        uh.area += (e.areal || 0) * x.andel;
        if (e.kategori === "Gulve" && (x.f.a.art === "jord" || x.f.b.art === "jord")) uhGulv += (e.areal || 0) * x.andel;
      });
      // Hele bygningsdelen regnes efter den side, det meste af den vender mod. Revits areal har allerede fratrukket åbningerne.
      var sum = {}, bedst = null, ukendt = null;
      fl.forEach(function (x) { if (x.v.ikke) { sum.ikke = (sum.ikke || 0) + x.andel; return; } if (!x.v.med) { ukendt = ukendt || x; return; } sum[x.v.art] = (sum[x.v.art] || 0) + x.andel; });
      Object.keys(sum).forEach(function (k) { if (!bedst || sum[k] > sum[bedst]) bedst = k; });
      if (!bedst) { if (ukendt) afklares.push({ tekst: e.kategori + ": " + (ukendt.v.grund || ukendt.v.tekst), id: e.id }); return; }
      if (bedst === "ikke") return;
      var x0 = fl.filter(function (x) { return !x.v.ikke && x.v.med && x.v.art === bedst; }).sort(function (p, q) { return q.andel - p.andel; })[0], f = x0.f, v = x0.v, areal = e.areal || 0;
      if (e.kategori === "Vægge") {
        var az = aziAf(el, f), kp = az == null ? { kode: "0", navn: "Ukendt retning", grader: 0 } : kompas(az), funk = el.revit && el.revit.funktion;
        if (v.art === "ude") {
          if (funk && funk !== "Exterior") { afklares.push({ tekst: "Vægge: indervægstype med det fri på den ene side regnes ikke med. Tegn rummet på den anden side, eller ret typen", id: e.id }); return; }
          if (az != null && erInde(el, (az + sandNord) % 360)) { afklares.push({ tekst: "Vægge: står inde i bygningen med en anden væg lige udenfor (skakt eller niche uden tegnet rum), så den regnes ikke med", id: e.id }); return; }
          var k = "v|" + kp.navn + "|" + e.type, ui = uFra(el, STD.uVaeg);
          var c = gruppe(k, nyKonstr({ navn: kp.navn, id: "Ydervæg " + kp.navn, u: ui.u, uKilde: ui.kilde, type: 0, orient: kp.kode, grader: kp.grader, rolle: "vaeg", typeNavn: e.type }));
          c.netto += areal; c.ids.push(e.id); vaertGruppe[String(e.id)] = c;
          if (az != null) vaegge.push(maal(el.meshes, ((az + sandNord) % 360)));
        } else if (v.art === "uopvarmet" || v.art === "jord") {
          var k2 = v.art + "|v|" + e.type, ui2 = uFra(el, STD.uJord);
          var c2 = gruppe(k2, nyKonstr({ id: (v.art === "jord" ? "Væg mod jord" : "Væg mod uopvarmet"), u: ui2.u, uKilde: ui2.kilde, type: 0, td_out: v.thetaB, rolle: v.art, typeNavn: e.type, mod_uopvarmet: v.art === "uopvarmet", b: v.art === "jord" ? rund((20 - v.thetaB) / 32, 2) : 1 }));
          c2.netto += areal; c2.ids.push(e.id);
          if (v.art === "uopvarmet") uhInt.push({ id: e.type, area: areal, u: ui2.u });
          if (v.art === "jord") adv.push("«" + e.type + "» vender mod jord. Typekoden for jordvendte dele i Energy Design er ikke kortlagt, så den skrives som ydervæg.");
        }
      } else if (e.kategori === "Gulve" || e.kategori === "Tage" || e.kategori === "Lofter") {
        if (v.art === "ude") {
          var ui3 = uFra(el, STD.uTag);
          var c3 = gruppe("tag|" + e.type, nyKonstr({ id: "Tag", u: ui3.u, uKilde: ui3.kilde, type: 28, slope: 0, rolle: "tag", typeNavn: e.type }));
          c3.netto += areal; c3.ids.push(e.id);
        } else if (v.art === "uopvarmet" || v.art === "jord") {
          var ui4 = uFra(el, STD.uDaek);
          var c4 = gruppe(v.art + "|d|" + e.type, nyKonstr({ id: v.art === "jord" ? "Terrændæk" : "Dæk mod uopvarmet", u: ui4.u, uKilde: ui4.kilde, type: v.art === "jord" ? 0 : 11, slope: 0, td_out: v.thetaB, rolle: v.art, typeNavn: e.type, mod_uopvarmet: v.art === "uopvarmet", b: v.art === "jord" ? rund((20 - v.thetaB) / 32, 2) : 1 }));
          c4.netto += areal; c4.ids.push(e.id);
          if (v.art === "uopvarmet") uhInt.push({ id: e.type, area: areal, u: ui4.u });
          if (v.art === "jord") adv.push("«" + e.type + "» vender mod jord. Typekoden for jordvendte dele i Energy Design er ikke kortlagt, så den skrives som ydervæg.");
        }
      } else if (e.kategori === "Vinduer" || e.kategori === "Døre" || e.kategori === "Glasfacader") {
        if (v.art !== "ude") { afklares.push({ tekst: e.kategori + ": åbning mod " + (v.art === "uopvarmet" ? "uopvarmet rum" : v.art) + " er ikke med", id: e.id }); return; }
        var erGlas = e.kategori === "Glasfacader", erDoer = e.kategori === "Døre", vaertEl = el.hostId != null ? els[String(el.hostId)] : null, vaert = !erGlas && el.hostId != null ? vaertGruppe[String(el.hostId)] : null;
        if (!erGlas && !vaert && vaertEl && vaertEl.category === "Vægge" && !erGlasvaeg(vaertEl)) { afklares.push({ tekst: e.kategori + ": værtsvæggen er ikke en del af facaden, så åbningen er ikke med", id: e.id }); return; }
        var az2 = vaert ? vaert.grader : aziAf(el, f), kp2 = az2 == null ? { kode: "0", navn: "Ukendt retning", grader: 0 } : kompas(az2);
        var azM = az2 == null ? 0 : ((az2 + sandNord) % 360), mm = maal(el.meshes, azM), rumS = rumside(f), std = erGlas ? STD.glas : erDoer ? STD.doer : STD.vindue;
        var bred = rund(mm.b, 2), hoej = rund(mm.h, 2), arealAb = erGlas ? (areal || rund(mm.b * mm.h, 2)) : rund(mm.b * mm.h, 2);
        if (arealAb < 0.1) { afklares.push({ tekst: e.kategori + " «" + e.type + "»: under 0,1 m², regnes ikke med", id: e.id }); return; }
        var parent = vaert || gruppe("g|" + kp2.navn, nyKonstr({ id: "Glasfacade " + kp2.navn, navn: kp2.navn, u: 0.14, uKilde: "antaget", type: 0, orient: kp2.kode, grader: kp2.grader, rolle: "glas", typeNavn: "Glasfacade" }));
        var noegle = erGlas ? "glas" : (e.type + "|" + bred + "x" + hoej), raekke = parent.aabninger.filter(function (o) { return o._n === noegle; })[0];
        if (!raekke) {
          raekke = { _n: noegle, id: erGlas ? "Glasfacade" : (erDoer ? "Dør " : "Vindue ") + e.type, fab: null, u: std.u, no: 0, type: std.type, ff: std.ff, g: std.g, fc: 1, ot: false, eref: std.eref, width: erGlas ? 0 : bred, height: erGlas ? 0 : hoej, area: 0, skygge: kopi(STD.skygge), ids: [], rum: [], rolle: erGlas ? "glas" : erDoer ? "doer" : "vindue", kilde: "antaget" };
          parent.aabninger.push(raekke);
        }
        if (erGlas) { raekke.no = 1; raekke.area = rund(raekke.area + arealAb, 2); antal.glas++; var gu = glasUde[parent.id] || (glasUde[parent.id] = { s0: Infinity, s1: -Infinity, z0: Infinity, z1: -Infinity }); if (mm.s0 < gu.s0) gu.s0 = mm.s0; if (mm.s1 > gu.s1) gu.s1 = mm.s1; if (mm.z0 < gu.z0) gu.z0 = mm.z0; if (mm.z1 > gu.z1) gu.z1 = mm.z1; }
        else { raekke.no++; raekke.area = arealAb; if (erDoer) antal.doer++; else antal.vindue++; omkredsVindue += 2 * (mm.b + mm.h); }
        raekke.ids.push(e.id);
        if (rumS) raekke.rum.push({ id: rumS.rumId, navn: rumS.navn, element: e.id, areal: arealAb });
      }
    });

    var etager = Object.keys(ae).length;
    // BR18 måler til ydersiden af ydervæggene. Revits dæk stopper ofte indenfor, så væggenes grundplan lægges til pr. etage.
    var zBund = vaegge.reduce(function (s, m) { return m.z0 < s ? m.z0 : s; }, Infinity), vaegPlan = vaegge.reduce(function (s, m) { return m.z0 <= zBund + 0.8 ? s + m.b * m.t : s; }, 0);
    var A = 0; Object.keys(ae).forEach(function (k) { ae[k] += vaegPlan; A += ae[k]; }); A = rund(A, 1);
    var zMin = vaegge.reduce(function (s, m) { return m.z0 < s ? m.z0 : s; }, Infinity);
    vaegge.forEach(function (m) { if (m.z0 <= zMin + 0.8) fundament += m.b; });
    Object.keys(glasUde).forEach(function (k) { var g = glasUde[k]; if (g.z0 <= zMin + 1.5) fundament += g.s1 - g.s0; });
    var konstruktioner = orden.map(function (k) {
      var c = konstr[k], aab = c.aabninger.reduce(function (s, o) { return s + o.no * o.area; }, 0);
      c.total_area = rund(c.netto + aab, 2);
      delete c.netto;
      c.aabninger.forEach(function (o) { delete o._n; });
      return c;
    });
    // Temperaturfaktoren for det uopvarmede rum (DS 418): H_ude / (H_inde + H_ude), med rummets luftskifte.
    var unheated = null;
    if (uhInt.length) {
      var ekstern = Object.keys(uhEks).map(function (k) { var x = uhEks[k]; return { id: x.id, area: rund(x.area, 1), u: x.u, kilde: x.kilde }; });
      var intern = {}; uhInt.forEach(function (x) { var y = intern[x.id] || (intern[x.id] = { id: x.id, area: 0, u: x.u }); y.area += x.area; });
      var liste = Object.keys(intern).map(function (k) { intern[k].area = rund(intern[k].area, 1); return intern[k]; });
      var brutto = rund(uhGulv || a.rum.reduce(function (s, r) { return s + (!erOpvarmet(r.id) && r.tilstand !== "ude" && r.kilde && r.kilde.area || 0); }, 0), 1);
      unheated = { id: "Uopvarmet kælder", gross_area: brutto, vent: STD.ventUopvarmet, intern: liste, ekstern: ekstern };
      var bb = bFaktor(unheated);
      konstruktioner.forEach(function (c) { if (c.mod_uopvarmet) { c.b = bb; c.td_out = 5; } });
    }
    var kuldebroer = [];
    if (fundament > 0) kuldebroer.push({ id: "Samling ydervæg/fundament eller kælderdæk", laengde: rund(fundament, 1), psi: STD.psiFundament, type: 100, kilde: "antaget" });
    if (omkredsVindue > 0) kuldebroer.push({ id: "Samling ydervæg/vinduer og døre", laengde: rund(omkredsVindue, 1), psi: STD.psiVindue, type: 104, kilde: "antaget" });
    var omkredsGlas = 0; Object.keys(glasUde).forEach(function (k) { var g = glasUde[k]; omkredsGlas += 2 * ((g.s1 - g.s0) + (g.z1 - g.z0)); });
    if (omkredsGlas > 0) kuldebroer.push({ id: "Samling glasfacade", laengde: rund(omkredsGlas, 1), psi: STD.psiGlas, type: 104, kilde: "antaget" });

    // BR18 § 264: bebygget areal er den største opvarmede etage. Rumhøjden er volumen / areal i de opvarmede rum, der har et volumen.
    var bebygget = Object.keys(ae).reduce(function (s, k) { return Math.max(s, ae[k]); }, 0), rumA = 0, rumV = 0;
    a.rum.forEach(function (r) { var k = r.kilde || {}; if (erOpvarmet(r.id) && k.area > 0 && k.volume > 0) { rumA += k.area; rumV += k.volume; } });
    var areas = Object.keys(ae).sort(function (x, y) { return (zNiv[x] || 0) - (zNiv[y] || 0); }).map(function (k) { return { id: k, area: rund(ae[k], 1), type: "NORMAL" }; });
    if (unheated) areas.push({ id: unheated.id, area: unheated.gross_area, type: "UNHEATED_BASEMENT" });
    var p = {
      etager: etager,
      bygning: { id: String(model.model || "Projekt"), ae: A, ae4: bebygget > 0 ? rund(bebygget, 1) : A, rumhoejde: rumA > 0 ? rund(rumV / rumA, 2) : null, kaelderAreal: 0, heat_cap: 120, rotation: 0, has_btype: ".ETYPE.", basic_heat_supply: ".SUP_DISTRICT.", project_no: null, street: null, zip_code: null, city: null },
      areas: areas, konstruktioner: konstruktioner, kuldebroer: kuldebroer,
      ventilation: { id: "Mekanisk ventilation med varmegenvinding (antaget)", area: A, fo: 1, qvm: 0.5, nvgv: 0.85, tin: 18, qid: 0.1, sel: 1.5, qvm_day: 0.5, qid_day: 0.9, air_tightness: 1 },
      brug: { id: "Standardbelastning", area: A, ppers: 1.5, papp: 3.5 },
      fjernvarme: { id: "Fjernvarmeveksler (antaget)", nom_eff: 50, heat_loss: 1, dhw: true, min_temp: 60, b_factor: 0.7, auto_stb: 5 },
      fremloeb: 60, retur: 40, pumpe: { id: "Cirkulationspumpe (antaget)", no: 1, pnom: 80, fp: 0.6 }, brugsvand: 250,
      rum: { area: 20, vent_day: 1.4, vent_evening: 1.4, vent_night: 0.5, vent_basic: 0.6 },
      klima: { name: KLIMA.name, supp_start: KLIMA.supp_start, supp_slope: KLIMA.supp_slope, months: KLIMA.ude.map(function (t, i) { return { tempOut: t, humidityOut: KLIMA.fugtUde[i], tempIn: 20, humidityIn: KLIMA.fugtInde[i] }; }) }
    };
    if (unheated) p.unheated = unheated;
    var unikke = {}; adv.forEach(function (t) { unikke[t] = 1; });
    return { model: p, advarsler: Object.keys(unikke), afklares: afklares, antal: antal, sandNord: sandNord, harRum: a.harRum, etageareal: { daek: rund(A - vaegPlan * etager, 1), vaegge: rund(vaegPlan * etager, 1), rum: rund(a.rum.reduce(function (s, r) { return s + (erOpvarmet(r.id) && r.kilde && r.kilde.area || 0); }, 0), 1) } };
  }

  function bFaktor(u) {
    var Hi = u.intern.reduce(function (s, e) { return s + e.u * e.area; }, 0), He = u.ekstern.reduce(function (s, e) { return s + e.u * e.area; }, 0) + 1.2 * u.vent * u.gross_area;
    return Hi + He > 0 ? rund(He / (Hi + He), 2) : 1;
  }

  // Sommerkomfort i ét rum: rummets vinduer lægges på egne rækker, og kun de tæller med (ot). Resten af modellen er uændret.
  function medRum(p, rumId, rumNavn) {
    var u = kopi(p);
    u.konstruktioner.forEach(function (c) {
      var nye = [];
      c.aabninger.forEach(function (o) {
        o.ot = false;
        var her = (o.rum || []).filter(function (r) { return String(r.id) === String(rumId); });
        if (!her.length || !(o.g > 0)) { nye.push(o); return; }
        var ny = kopi(o);
        ny.id = o.id + ", " + (rumNavn || rumId); ny.ot = true;
        if (o.rolle === "glas" || (o.no === 1 && her.length > 1)) {
          var a = rund(her.reduce(function (s, r) { return s + r.areal; }, 0), 2);
          ny.area = a; ny.no = 1; o.area = rund(o.area - a, 2);
          if (o.area > 0.01) nye.push(o);
        } else {
          ny.no = her.length; o.no -= her.length;
          if (o.no > 0) nye.push(o);
        }
        nye.push(ny);
      });
      c.aabninger = nye;
    });
    return u;
  }

  return { fraModel: fraModel, bFaktor: bFaktor, medRum: medRum, kompas: kompas, hovedretning: hovedretning, STD: STD };
});
