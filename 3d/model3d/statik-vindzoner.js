/* ISSANA 3D: vindens tryk og sug på zoner, til Statik-fanen «Laster og redegørelse». Rent modul uden DOM (testes i Node,
   tests/web-model3d/statik-vindzoner.test.mjs). Bygger oven på statik-lastmodel.js, som regner hastighedstrykket q_p.

   Metoden er Eurocodens for bygninger med rektangulær plan (DS/EN 1991-1-4, afsnit 7.2 og 7.5): væggene deles i zone A, B og C
   (siderne langs vinden), D (vindsiden) og E (læsiden); taget i zone F, G, H, I og J; og flader langs vinden får friktion bag en
   vis afstand fra vindsiden. Hver zone har en formfaktor c_pe,10, og w = q_p(z_e) · c_pe,10. Plus er tryk mod fladen, minus er sug.

   Forenklet: bygningen regnes som den kasse, der omslutter den (b på tværs af vinden, d langs vinden, h til det højeste punkt),
   og taget som den tagform, der fylder mest. Pilene i 3D står på bygningens virkelige flader. Ingeniøren skal godkende.

   Tal: hver formfaktor er læst i standardens tabel, og kilden står i K. Overfladens ruhed er et valg; det er tomt, til brugeren
   har sat det. Retning: X = øst, Y = nord, Z = op. SVG'en bruger kun enkelte anførselstegn, så den kan stå i en Typst-streng.
   Browser: window.IssanaStatikVind. Node: module.exports. */
(function (root, factory) {
  var node = typeof module === "object" && module && module.exports;
  var api = factory(node ? require("./statik-lastmodel.js") : root.IssanaStatikLast);
  if (node) module.exports = api;
  else root.IssanaStatikVind = api;
})(typeof window !== "undefined" ? window : this, function (L) {
  "use strict";

  /* ---------- Kilder og tabelværdier ---------- */
  var K = {
    zoner: "DS/EN 1991-1-4, figur 7.5 til 7.8 (DK NA:2024: uændret)",
    vaeg: "DS/EN 1991-1-4, tabel 7.1 (DK NA:2024: uændret for 7.2.2)",
    flad: "DS/EN 1991-1-4, tabel 7.2, skarp tagkant, med DK NA:2024 pkt. 7.2.3(4): zone I −0,5 i stedet for −0,2",
    pult: "DS/EN 1991-1-4, tabel 7.3a og 7.3b (DK NA:2024: uændret for 7.2.4)",
    sadel: "DS/EN 1991-1-4, tabel 7.4a og 7.4b (DK NA:2024: uændret for 7.2.5)",
    cfr: "DS/EN 1991-1-4, tabel 7.10 og pkt. 7.5(3)",
    udelad: "DS/EN 1991-1-4, pkt. 5.3(4)",
    model: "Aflæst af modellen",
    bruger: "Angivet af brugeren"
  };
  var OVERFLADE = {
    glat: { cfr: 0.01, navn: "Glat: stål, glat beton" },
    ru: { cfr: 0.02, navn: "Ru: ru beton, tagpap" },
    megetru: { cfr: 0.04, navn: "Meget ru: riller, ribber, false" }
  };
  var TAGART = { fladt: "fladt tag", sadel: "sadeltag", ensidigt: "ensidigt tag" };
  // Rækker: [hældning i grader, sug, tryk]. c_pe,10 (flader på 10 m² og derover). Tom plads: standarden har ingen værdi dér.
  // 0 står i tabellen «til interpolation»: mellem to rækker regnes lineært, sug for sig og tryk for sig (note 2 til tabellerne).
  var TAB = {
    // Tabel 7.4a: sadeltag, vinden på tværs af kippen (θ = 0°). F, G, H på vindsiden af kippen, J og I på læsiden.
    sadel0: {
      F: [[5, -1.7, 0], [15, -0.9, 0.2], [30, -0.5, 0.7], [45, 0, 0.7], [60, null, 0.7], [75, null, 0.8]],
      G: [[5, -1.2, 0], [15, -0.8, 0.2], [30, -0.5, 0.7], [45, 0, 0.7], [60, null, 0.7], [75, null, 0.8]],
      H: [[5, -0.6, 0], [15, -0.3, 0.2], [30, -0.2, 0.4], [45, 0, 0.6], [60, null, 0.7], [75, null, 0.8]],
      I: [[5, -0.6, null], [15, -0.4, 0], [30, -0.4, 0], [45, -0.2, 0], [60, -0.2, null], [75, -0.2, null]],
      J: [[5, -0.6, 0.2], [15, -1.0, 0], [30, -0.5, 0], [45, -0.3, 0], [60, -0.3, null], [75, -0.3, null]]
    },
    // Tabel 7.4b: sadeltag, vinden langs kippen (θ = 90°).
    sadel90: {
      F: [[5, -1.6], [15, -1.3], [30, -1.1], [45, -1.1], [60, -1.1], [75, -1.1]],
      G: [[5, -1.3], [15, -1.3], [30, -1.4], [45, -1.4], [60, -1.2], [75, -1.2]],
      H: [[5, -0.7], [15, -0.6], [30, -0.8], [45, -0.9], [60, -0.8], [75, -0.8]],
      I: [[5, -0.6], [15, -0.5], [30, -0.5], [45, -0.5], [60, -0.5], [75, -0.5]]
    },
    // Tabel 7.3a: ensidigt tag, vinden mod den lave tagkant (θ = 0°).
    pult0: {
      F: [[5, -1.7, 0], [15, -0.9, 0.2], [30, -0.5, 0.7], [45, 0, 0.7], [60, null, 0.7], [75, null, 0.8]],
      G: [[5, -1.2, 0], [15, -0.8, 0.2], [30, -0.5, 0.7], [45, 0, 0.7], [60, null, 0.7], [75, null, 0.8]],
      H: [[5, -0.6, 0], [15, -0.3, 0.2], [30, -0.2, 0.4], [45, 0, 0.6], [60, null, 0.7], [75, null, 0.8]]
    },
    // Tabel 7.3a: ensidigt tag, vinden mod den høje tagkant (θ = 180°).
    pult180: {
      F: [[5, -2.3], [15, -2.5], [30, -1.1], [45, -0.6], [60, -0.5], [75, -0.5]],
      G: [[5, -1.3], [15, -1.3], [30, -0.8], [45, -0.5], [60, -0.5], [75, -0.5]],
      H: [[5, -0.8], [15, -0.9], [30, -0.8], [45, -0.7], [60, -0.5], [75, -0.5]]
    },
    // Tabel 7.3b: ensidigt tag, vinden langs tagkanterne (θ = 90°). Fop ligger ved den høje tagkant, Fned ved den lave.
    pult90: {
      Fop: [[5, -2.1], [15, -2.4], [30, -2.1], [45, -1.5], [60, -1.2], [75, -1.2]],
      Fned: [[5, -2.1], [15, -1.6], [30, -1.3], [45, -1.3], [60, -1.2], [75, -1.2]],
      G: [[5, -1.8], [15, -1.9], [30, -1.5], [45, -1.4], [60, -1.2], [75, -1.2]],
      H: [[5, -0.6], [15, -0.8], [30, -1.0], [45, -1.0], [60, -1.0], [75, -1.0]],
      I: [[5, -0.5], [15, -0.7], [30, -0.8], [45, -0.9], [60, -0.7], [75, -0.5]]
    }
  };
  // Tabel 7.2, skarp tagkant. Zone I: både tryk og sug skal undersøges (note 3); suget er DK NA's −0,5.
  var FLAD = { F: { sug: -1.8 }, G: { sug: -1.2 }, H: { sug: -0.7 }, I: { sug: -0.5, tryk: 0.2 } };
  var FARVE = { tryk: "#2c6fbf", sug: "#d6453d", friktion: "#7d8590" };

  /* ---------- Små hjælpere ---------- */
  function r2(n) { return Math.round(n * 100) / 100; }
  function klem(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function erTal(v) { return typeof v === "number" && isFinite(v); }
  function interp(x, x0, y0, x1, y1) { if (x <= x0) return y0; if (x >= x1) return y1; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  function xml(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;"); }
  function fortegn(x, dec) { return x == null || !isFinite(x) ? "–" : (x >= 0 ? "+" : "−") + L.dk(Math.abs(x), dec); }
  // Værdien i en tabelrække ved hældningen alfa: sug og tryk hver for sig, lineært mellem rækkerne, fast uden for dem.
  function tabVaerdi(raekker, alfa) {
    function serie(k) {
      var pkt = raekker.filter(function (r) { return r[k] != null; });
      if (!pkt.length) return null;
      if (alfa <= pkt[0][0]) return pkt[0][k];
      for (var i = 0; i + 1 < pkt.length; i++) if (alfa <= pkt[i + 1][0]) return interp(alfa, pkt[i][0], pkt[i][k], pkt[i + 1][0], pkt[i + 1][k]);
      return pkt[pkt.length - 1][k];
    }
    return { sug: serie(1), tryk: serie(2) };
  }

  /* ---------- Tagets form ---------- */
  var PLADE = { "Gulve": 1, "Tage": 1 };
  // Læst af de flader, der ligger øverst i modellen: fladt, sadeltag eller ensidigt, hældningen og den vej, taget falder.
  // fald: for et ensidigt tag retningen ned mod den lave tagkant; for et sadeltag aksen på tværs af kippen.
  function tagform(form, model) {
    var fald = { xp: 0, xn: 0, yp: 0, yn: 0 }, flad = 0, hist = {}, g = form.g;
    ((model && model.elements) || []).forEach(function (e) {
      if (!e || e.erRum || !PLADE[e.category] || !e.meshes) return;
      e.meshes.forEach(function (m) {
        var p = m && m.pos, ix = m && m.idx; if (!p || !ix) return;
        for (var i = 0; i + 2 < ix.length; i += 3) {
          var a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
          var ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
          var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (l < 1e-9 || nz / l <= 0.2) continue;                      // kun flader, der vender opad
          var mx = (p[a] + p[b] + p[c]) / 3, my = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, mz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
          if (mz < form.terraen + 0.5) continue;                        // terrændæk
          var i2 = Math.floor((mx - g.x0) / g.c), j2 = Math.floor((my - g.y0) / g.c);
          if (i2 < 0 || j2 < 0 || i2 >= g.nx || j2 >= g.ny || form.zTop[i2 + j2 * g.nx] > mz + 0.15) continue;   // noget ligger over
          var areal = l / 2, gr = Math.acos(klem(nz / l, 0, 1)) * 180 / Math.PI;
          if (gr < 5) { flad += areal; continue; }
          var k = Math.round(gr); hist[k] = (hist[k] || 0) + areal;
          if (Math.abs(nx) >= Math.abs(ny)) fald[nx > 0 ? "xp" : "xn"] += areal; else fald[ny > 0 ? "yp" : "yn"] += areal;
        }
      });
    });
    var X = fald.xp + fald.xn, Y = fald.yp + fald.yn, S = X + Y;
    if (S <= 0 || S < 0.3 * (S + flad)) return { art: "fladt", alfa: 0, fald: null, sammensat: S > 0.05 * (S + flad) };
    var alfa = null, top = 0;
    Object.keys(hist).forEach(function (n) { if (hist[n] > top) { top = hist[n]; alfa = +n; } });
    var langsX = X >= Y, plus = langsX ? fald.xp : fald.yp, minus = langsX ? fald.xn : fald.yn;
    var ensidig = Math.min(plus, minus) < 0.15 * (plus + minus), tegn = ensidig && minus > plus ? -1 : 1;
    return { art: ensidig ? "ensidigt" : "sadel", alfa: alfa, fald: langsX ? [tegn, 0] : [0, tegn], sammensat: Math.min(X, Y) >= 0.25 * S || flad > 0.3 * (S + flad) };
  }

  /* ---------- Bygningen set fra vinden ---------- */
  // Det omsluttende rektangel: s langs vinden (0 ved vindsiden), t på tværs (0 til b).
  function ramme(form, ret) {
    var d = L.RETNING[ret].d, p = [-d[1], d[0]], g = form.g, c = g.c, s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity, i, j;
    for (j = 0; j < g.ny; j++) for (i = 0; i < g.nx; i++) {
      if (!form.fyldt[i + j * g.nx]) continue;
      var x = g.x0 + (i + 0.5) * c, y = g.y0 + (j + 0.5) * c, ss = x * d[0] + y * d[1], tt = x * p[0] + y * p[1];
      if (ss < s0) s0 = ss; if (ss > s1) s1 = ss; if (tt < t0) t0 = tt; if (tt > t1) t1 = tt;
    }
    s0 -= c / 2; s1 += c / 2; t0 -= c / 2; t1 += c / 2;
    return { d: d, p: p, s0: s0, t0: t0, dybde: s1 - s0, bredde: t1 - t0, punkt: function (s, t) { return [d[0] * (s0 + s) + p[0] * (t0 + t), d[1] * (s0 + s) + p[1] * (t0 + t)]; } };
  }
  // Kippens afstand fra vindsiden: dér, hvor bygningen er højest set på tværs af vinden.
  function kipSted(form, R) {
    var s = L.silhuet(form, R.d[0], R.d[1]), m = -Infinity, sum = 0, n = 0, i;
    for (i = 0; i < s.n; i++) if (s.z[i] > m) m = s.z[i];
    for (i = 0; i < s.n; i++) if (s.z[i] >= m - 0.15) { sum += s.u0 + i * s.c; n++; }
    return klem(n ? sum / n - R.s0 : R.dybde / 2, R.dybde * 0.15, R.dybde * 0.85);
  }

  /* ---------- Zonerne ---------- */
  // tag: resultatet af tagform(). ind.vind.overflade vælger friktionen; ind.vind.tagart og tagalfa retter tagets form.
  // Tomme/ugyldige input er manglende grundlag, aldrig NaN i pile, SVG eller kamera.
  // Bruges også af den samlede vindvisning, så begge visninger har samme grundlag.
  function vind(form, ind, ret) {
    var v = (ind && ind.vind) || {}, r = L.vind(form, { vind: Object.assign({}, v, { cdir2: v.cdir2 || {} }) }, ret);
    [["vb0", "Basisvindhastighed v_b,0"], ["cseason2", "Årstidsfaktor c_season²"], ["rho", "Luftens densitet ρ"], ["co", "Orografifaktor c_o"]].forEach(function (x) {
      if (!erTal(v[x[0]]) || v[x[0]] <= 0) r.mangler.push(x[1] + " (skal være et tal større end 0)");
    });
    if (v.ze != null && (!erTal(v.ze) || v.ze <= 0)) r.mangler.push("Referencehøjde z_e (skal være et tal større end 0)");
    if (erTal(r.cdir2) && r.cdir2 <= 0) r.mangler.push("Retningsfaktor (skal være større end 0)");
    if (v.cscd != null && (!erTal(v.cscd) || v.cscd <= 0)) r.mangler.push("Konstruktionsfaktor c_s·c_d (skal være et tal større end 0)");
    if (!r.mangler.length && (!erTal(r.qp) || r.qp < 0)) r.mangler.push("Hastighedstryk q_p: kontrollér vindens input");
    if (r.mangler.length) ["qp", "wD", "wE", "wN", "F", "vb", "vm", "Iv"].forEach(function (k) { r[k] = null; });
    Object.keys(r).forEach(function (k) { if (typeof r[k] === "number" && !erTal(r[k])) r[k] = null; });
    return r;
  }
  function zoner(form, ind, ret, tag) {
    // Trykket på en flade er q_p · c_pe (pkt. 5.2). Konstruktionsfaktoren c_s·c_d ganges først på, når kræfterne lægges sammen
    // (pkt. 5.3(3)), så zonerne kan regnes, selv om den ikke er sat: her spørges lastmodellen om q_p med faktoren 1.
    var v = (ind && ind.vind) || {}, r = vind(form, { vind: Object.assign({}, v, { cscd: 1 }) }, ret);
    var O = OVERFLADE[v.overflade], R = ramme(form, ret), dv = R.d, p = R.p;
    var b = r.b, d = r.d, h = r.h, e = Math.min(b, 2 * h), qp = erTal(r.qp) ? r.qp : null, c = L.cpe(r.hd);
    var z = { ret: ret, navn: r.navn, mangler: r.mangler.slice(), b: b, d: d, h: h, e: e, ze: r.ze, hd: r.hd, qp: qp, ramme: R, vaegge: [], tag: [], noter: [] };
    function zone(navn, flade, s0, s1, t0, t1, cpe, alt) {
      return { zone: navn, flade: flade, s0: s0, s1: s1, t0: t0, t1: t1, cpe: cpe, cpeAlt: alt == null ? null : alt, w: qp == null ? null : qp * cpe, wAlt: qp == null || alt == null ? null : qp * alt };
    }
    // Vægge: figur 7.5 og tabel 7.1. e er det mindste af b og 2h.
    z.vaegge.push(zone("D", "vind", 0, 0, 0, b, c.D));
    z.vaegge.push(zone("E", "lae", d, d, 0, b, c.E));
    // Målene er læst af et gitter og er derfor ikke helt skarpe: en rest, der er smallere end tol, er ikke en zone for sig.
    var tol = Math.max(0.3, 2 * form.g.c);
    (e < d - tol ? [["A", 0, e / 5, -1.2], ["B", e / 5, e, -0.8], ["C", e, d, -0.5]] : e < 5 * d ? [["A", 0, e / 5, -1.2], ["B", e / 5, d, -0.8]] : [["A", 0, d, -1.2]])
      .forEach(function (x) { z.vaegge.push(zone(x[0], "side", x[1], x[2], 0, 0, x[3])); });

    // Tagets form og vindens retning i forhold til den.
    var T = tag || { art: "fladt", alfa: 0, fald: null }, art = TAGART[v.tagart] ? v.tagart : T.art, alfa = v.tagalfa != null ? v.tagalfa : T.alfa, f = T.fald;
    z.tagMangler = [];
    if (art !== "fladt") {
      if (art !== T.art || !f || !f.every(erTal) || Math.hypot(f[0], f[1]) < 0.5) z.tagMangler.push("Tagzoner er ikke beregnet: den valgte tagform har ingen entydig kip- eller faldretning i modellen. Ret taggeometrien og hent modellen igen, eller vælg tagformen fra modellen.");
      if (!erTal(alfa) || alfa < 0 || alfa > 75 || (T.art === "fladt" && v.tagalfa == null)) z.tagMangler.push("Tagzoner er ikke beregnet: angiv en taghældning mellem 0° og 75°. Modulet understøtter ikke større hældninger.");
      if (!z.tagMangler.length && alfa < 5) { art = "fladt"; z.noter.push("Taghældningen er under 5°. Taget behandles som fladt efter pkt. 7.2.3(1)."); }
    }
    var prik = f ? f[0] * dv[0] + f[1] * dv[1] : 0, theta = art === "fladt" || z.tagMangler.length ? null : Math.abs(prik) < 0.7 ? 90 : art === "sadel" ? 0 : prik < 0 ? 0 : 180;
    z.tagart = art; z.alfa = art === "fladt" ? 0 : erTal(alfa) ? alfa : null; z.theta = theta; z.sammensat = !!T.sammensat;
    z.tagFraModel = !TAGART[v.tagart] && v.tagalfa == null;
    z.noter = z.noter.concat(z.tagMangler);
    if (!z.tagFraModel) z.noter.push("Tagform eller taghældning er angivet af brugeren. Retningen skal fortsat kunne aflæses entydigt af modellen.");

    var e10 = Math.min(e / 10, d), e4 = e / 4, e2 = d - e / 2 < tol ? d : e / 2;
    function tz(navn, s0, s1, t0, t1, x) {
      if (s1 - s0 < 1e-6 || t1 - t0 < 1e-6) return;
      var sug = x.sug, tryk = x.tryk, hoved, alt = null;
      if (sug != null && sug < -1e-9) { hoved = sug; if (tryk != null && tryk > 1e-9) alt = tryk; } else hoved = tryk != null ? tryk : 0;
      z.tag.push(zone(navn, "tag", s0, s1, t0, t1, hoved, alt));
    }
    function kant(dyb, F1, G, F2) { tz("F", 0, dyb, 0, e4, F1); tz("G", 0, dyb, e4, b - e4, G); tz("F", 0, dyb, b - e4, b, F2); }
    function fra(tab, navn) { return tabVaerdi(tab[navn], alfa); }
    if (z.tagMangler.length) {
      z.tagKilde = "Tagzoner ikke beregnet: taggrundlaget skal afklares";
    } else if (art === "fladt") {
      kant(e10, FLAD.F, FLAD.G, FLAD.F); tz("H", e10, e2, 0, b, FLAD.H); tz("I", e2, d, 0, b, FLAD.I);
      z.tagKilde = K.flad;
    } else if (art === "sadel" && theta === 0) {
      var sk = kipSted(form, R), dyb = Math.min(e10, sk), jSlut = d - (sk + e / 10) < tol ? d : sk + e / 10, t0 = TAB.sadel0;
      kant(dyb, fra(t0, "F"), fra(t0, "G"), fra(t0, "F")); tz("H", dyb, sk, 0, b, fra(t0, "H")); tz("J", sk, jSlut, 0, b, fra(t0, "J")); tz("I", jSlut, d, 0, b, fra(t0, "I"));
      z.kip = sk; z.tagKilde = K.sadel;
    } else if (art === "sadel") {
      var t9 = TAB.sadel90;
      kant(e10, fra(t9, "F"), fra(t9, "G"), fra(t9, "F")); tz("H", e10, e2, 0, b, fra(t9, "H")); tz("I", e2, d, 0, b, fra(t9, "I"));
      z.tagKilde = K.sadel;
    } else if (theta === 90) {
      var p9 = TAB.pult90, lavVedB = f[0] * p[0] + f[1] * p[1] > 0;   // faldet peger mod t = b: den lave tagkant ligger dér
      var Fop = fra(p9, "Fop"), Fned = fra(p9, "Fned");
      tz(lavVedB ? "Fop" : "Fned", 0, e10, 0, e4, lavVedB ? Fop : Fned); tz("G", 0, e10, e4, b - e4, fra(p9, "G")); tz(lavVedB ? "Fned" : "Fop", 0, e10, b - e4, b, lavVedB ? Fned : Fop);
      tz("H", e10, e2, 0, b, fra(p9, "H")); tz("I", e2, d, 0, b, fra(p9, "I"));
      z.tagKilde = K.pult;
    } else {
      var pt = theta === 0 ? TAB.pult0 : TAB.pult180;
      kant(e10, fra(pt, "F"), fra(pt, "G"), fra(pt, "F")); tz("H", e10, d, 0, b, fra(pt, "H"));
      z.tagKilde = K.pult;
    }

    // Friktion: pkt. 7.5(3) og 5.3(4). Fladerne langs vinden er de to sider og taget; fladerne på tværs er vind- og læside.
    var start = Math.min(2 * b, 4 * h), lgd = Math.max(0, d - start), Alangs = 2 * d * h + b * d, Atvaers = 2 * b * h, Afr = lgd * (2 * h + b);
    var udelad = Alangs <= 4 * Atvaers;
    z.friktion = { overflade: O ? v.overflade : "", cfr: O ? O.cfr : null, start: start, laengde: lgd, Alangs: Alangs, Atvaers: Atvaers, kanUdelades: udelad, aktiv: !udelad && lgd > 1e-6,
      A: Afr, w: O && qp != null ? O.cfr * qp : null, F: O && qp != null ? O.cfr * qp * Afr : null };
    z.friktion.mangler = z.friktion.aktiv && !O;

    z.noter.push("Bygningen er regnet som en kasse: " + L.dk(b, 1) + " m på tværs af vinden, " + L.dk(d, 1) + " m langs vinden og " + L.dk(h, 1) + " m høj.");
    if (z.sammensat && !z.tagMangler.length) z.noter.push("Taget har flere former. Zonerne er regnet for den form, der fylder mest: " + TAGART[art] + (art === "fladt" ? "" : " med " + L.dk(alfa, 0) + "°") + ".");
    if (h > b + 1e-6) z.noter.push("Bygningen er højere, end den er bred på tværs af vinden. Trykket er regnet med q_p i toppen i hele højden; det er på den sikre side (pkt. 7.2.2(1)).");
    if (z.tag.some(function (x) { return x.cpeAlt != null; })) z.noter.push("Hvor der står to tal, skal begge undersøges: sug på hele tagfladen for sig og tryk på hele tagfladen for sig.");
    if (h >= 15 && !erTal(v.cscd)) z.noter.push("Konstruktionsfaktoren c_s·c_d er ikke sat. Den ændrer ikke trykket på den enkelte flade; den ganges på, når kræfterne lægges sammen (pkt. 5.3(3)).");
    z.noter.push("Indvendigt vindtryk er ikke med. Tallene er c_pe,10, som gælder flader på 10 m² og derover; små dele og fastgørelser skal regnes med c_pe,1.");
    return z;
  }
  // Én linje pr. zonenavn (de to F-hjørner har samme tal), til tabeller.
  function raekker(z) {
    var ud = [], set = {};
    z.vaegge.concat(z.tag).forEach(function (x) { if (set[x.zone]) return; set[x.zone] = 1; ud.push(x); });
    return ud;
  }
  function hvor(z, x) {
    var m = function (v) { return L.dk(v, 1); };
    if (x.zone === "D") return "vindsiden";
    if (x.zone === "E") return "læsiden";
    if (x.flade === "side") return "siderne, " + m(x.s0) + "–" + m(x.s1) + " m fra vindsiden";
    if (x.zone === "G") return "taget, langs vindsidens kant mellem hjørnerne";
    if (x.zone.charAt(0) === "F") return "taget, hjørne ved vindsiden" + (x.zone === "Fop" ? " (høj tagkant)" : x.zone === "Fned" ? " (lav tagkant)" : "") + ", " + m(x.t1 - x.t0) + " × " + m(x.s1 - x.s0) + " m";
    return "taget, " + m(x.s0) + "–" + m(x.s1) + " m fra vindsiden";
  }
  function vaerdiTekst(z, x) {
    if (z.qp == null) return "c_pe " + fortegn(x.cpe, 1) + (x.cpeAlt != null ? " / " + fortegn(x.cpeAlt, 1) : "");
    return fortegn(x.w) + (x.wAlt != null ? " / " + fortegn(x.wAlt) : "");
  }
  function tagTekst(z) {
    if (z.tagMangler && z.tagMangler.length) return (z.tagart === "sadel" ? "Sadeltag" : "Ensidigt tag") + " – tagzoner ikke beregnet";
    if (z.tagart === "fladt") return "Fladt tag";
    var t = (z.tagart === "sadel" ? "Sadeltag" : "Ensidigt tag") + ", " + L.dk(z.alfa, 0) + "°";
    if (z.tagart === "sadel") return t + (z.theta === 0 ? ", vinden på tværs af kippen" : ", vinden langs kippen");
    return t + (z.theta === 0 ? ", vinden mod den lave tagkant" : z.theta === 180 ? ", vinden mod den høje tagkant" : ", vinden langs tagkanterne");
  }

  /* ---------- Pile, flader og etiketter til 3D ---------- */
  // Første sted på strålen fra (x, y) i retningen (ux, uy), hvor bygningen er mindst z høj. Null: strålen rammer ikke.
  function ram(form, x, y, ux, uy, z, maks) {
    var skr = form.g.c * 0.5;
    for (var a = 0; a <= maks; a += skr) if (L.zPaa(form, x + ux * a, y + uy * a) >= z) return a;
    return null;
  }
  // Tagfladens normal læst af højdekortet; lodret ved kanter og spring.
  function normal(form, x, y) {
    var dl = form.g.c * 2, a = L.zPaa(form, x + dl, y), b = L.zPaa(form, x - dl, y), c = L.zPaa(form, x, y + dl), d = L.zPaa(form, x, y - dl);
    if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) return [0, 0, 1];
    var gx = (a - b) / (2 * dl), gy = (c - d) / (2 * dl);
    if (Math.abs(gx) > 2.5 || Math.abs(gy) > 2.5) return [0, 0, 1];
    var l = Math.sqrt(gx * gx + gy * gy + 1);
    return [-gx / l, -gy / l, 1 / l];
  }
  // Pilene står på bygningens virkelige flader: en stråle går ind fra kassens side, til den rammer en væg; på taget bruges højdekortet.
  // Tryk peger ind mod fladen (blå), sug peger væk fra den (rød), friktion ligger langs fladen i vindens retning (grå).
  // Længden følger tallets størrelse. Tagets zoner følger også med som farvede flader, der ligger på taget, og streger viser,
  // hvor én zone slutter og den næste begynder. o.kamera: retningen fra bygningen mod kameraet (x, y); så står sidernes
  // etiketter kun på den side, man ser.
  function pile3d(form, z, o) {
    o = o || {};
    var R = z.ramme, dv = R.d, p = R.p, c = form.g.c, gap = c * 1.8, terr = form.terraen, maal = z.qp == null ? "cpe" : "w", kam = o.kamera || null;
    // Den længste pil (det største tal) passer til bygningens mindste mål, så pilene ikke bliver større end huset.
    var Lm = klem(Math.min(form.laengde * 0.15, z.h * 0.6, Math.min(z.b, z.d) * 0.35), 0.8, 7);
    var alle = z.vaegge.concat(z.tag), maks = alle.reduce(function (m, x) { return Math.max(m, Math.abs(x[maal])); }, 0) || 1;
    var tryk = [], sug = [], frik = [], etk = [], kanter = [], skr = klem(Lm * 0.9, 1, 4);
    function laengde(x) { return Lm * Math.max(0.3, Math.abs(x[maal]) / maks); }
    function saet(zone, Q, n) {
      var l = laengde(zone), ud = [Q[0] + n[0] * l, Q[1] + n[1] * l, Q[2] + n[2] * l];
      if (zone[maal] >= 0) tryk.push({ fra: ud, til: Q, zone: zone.zone }); else sug.push({ fra: Q, til: ud, zone: zone.zone });
    }
    function etiket(zone, pos) { etk.push({ pos: pos, tekst: zone.zone, tekst2: vaerdiTekst(z, zone) + (z.qp == null ? "" : " kN/m²"), art: zone[maal] >= 0 ? "tryk" : "sug", zone: zone.zone }); }
    function modKamera(n) { return !kam || n[0] * kam[0] + n[1] * kam[1] > 0; }
    function vaegHoejde(x0, y0, ind, a0) {
      var zf = L.zPaa(form, x0 + ind[0] * (a0 + 1.5 * c), y0 + ind[1] * (a0 + 1.5 * c));
      return Math.max(0.8, Math.min(isFinite(zf) ? zf : terr + z.h, terr + z.h) - terr);
    }
    // En lodret flade fra k0 til k1 langs kassens side. P(k): punkt på kassens side. ind: retningen ind mod bygningen.
    // Giver stedet til zonens etiket: ud for midten af fladen, i halv væghøjde, lige uden for pilene.
    function flade(zone, P, ind, k0, k1) {
      var n = Math.max(1, Math.round((k1 - k0) / skr)), dyb = (Math.abs(ind[0] * dv[0] + ind[1] * dv[1]) > 0.5 ? z.d : z.b) + 6 * c, midt = null, bedst = Infinity;
      for (var i = 0; i < n; i++) {
        var k = k0 + (i + 0.5) / n * (k1 - k0), q = P(k), x0 = q[0] - ind[0] * 3 * c, y0 = q[1] - ind[1] * 3 * c;
        var a0 = ram(form, x0, y0, ind[0], ind[1], terr + 0.4, dyb); if (a0 == null) continue;
        var hv = vaegHoejde(x0, y0, ind, a0), nz = klem(Math.round(hv / skr), 1, 3);
        for (var rk = 0; rk < nz; rk++) {
          var zz = terr + (rk + 0.5) / nz * hv, a = ram(form, x0, y0, ind[0], ind[1], zz, dyb); if (a == null) continue;
          saet(zone, [x0 + ind[0] * (a - gap), y0 + ind[1] * (a - gap), zz], [-ind[0], -ind[1], 0]);
        }
        var afst = Math.abs(i + 0.5 - n / 2), ud = gap + laengde(zone) + Lm * 0.35;
        if (afst < bedst) { bedst = afst; midt = [x0 + ind[0] * (a0 - ud), y0 + ind[1] * (a0 - ud), terr + hv * 0.55]; }
      }
      return midt;
    }
    // Skellet mellem to zoner på en side: en lodret streg på facaden.
    function skel(P, ind, k) {
      var q = P(k), x0 = q[0] - ind[0] * 3 * c, y0 = q[1] - ind[1] * 3 * c, a = ram(form, x0, y0, ind[0], ind[1], terr + 0.4, z.b + 6 * c); if (a == null) return;
      var hv = vaegHoejde(x0, y0, ind, a), x = x0 + ind[0] * (a - gap * 0.4), y = y0 + ind[1] * (a - gap * 0.4);
      kanter.push(x, y, terr + 0.05, x, y, terr + hv);
    }
    var sider = [[function (s) { return R.punkt(s, 0); }, p], [function (s) { return R.punkt(s, z.b); }, [-p[0], -p[1]]]];
    z.vaegge.forEach(function (zn) {
      if (zn.flade === "vind") { var m = flade(zn, function (t) { return R.punkt(0, t); }, dv, 0, z.b); if (m) etiket(zn, m); }
      else if (zn.flade === "lae") { var m2 = flade(zn, function (t) { return R.punkt(z.d, t); }, [-dv[0], -dv[1]], 0, z.b); if (m2) etiket(zn, m2); }
      else sider.forEach(function (S) {
        var m3 = flade(zn, S[0], S[1], zn.s0, zn.s1);
        if (m3 && modKamera([-S[1][0], -S[1][1]])) etiket(zn, m3);      // kun den side, kameraet ser
        if (zn.s1 < z.d - 1e-6) skel(S[0], S[1], zn.s1);
      });
    });
    // Taget: pile vinkelret på tagfladen, en farvet flade pr. zone og en streg om zonen.
    var flader = [], kandidater = {};
    function tagkant(zn) {
      var hj = [[zn.s0, zn.t0], [zn.s1, zn.t0], [zn.s1, zn.t1], [zn.s0, zn.t1]];
      for (var i = 0; i < 4; i++) {
        var a = hj[i], b = hj[(i + 1) % 4], l = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]), n = Math.max(1, Math.round(l / 0.5)), forrige = null;
        for (var k = 0; k <= n; k++) {
          // Et hår inden for kassen, så punktet ligger på taget.
          var q = R.punkt(klem(a[0] + (b[0] - a[0]) * k / n, c, z.d - c), klem(a[1] + (b[1] - a[1]) * k / n, c, z.b - c)), zt = L.zPaa(form, q[0], q[1]);
          var nu = isFinite(zt) && zt > terr + 0.5 ? [q[0], q[1], zt + 0.1] : null;
          if (forrige && nu && Math.abs(nu[2] - forrige[2]) < 1.5) kanter.push(forrige[0], forrige[1], forrige[2], nu[0], nu[1], nu[2]);
          forrige = nu;
        }
      }
    }
    z.tag.forEach(function (zn) {
      var ns = Math.max(1, Math.round((zn.s1 - zn.s0) / skr)), nt = Math.max(1, Math.round((zn.t1 - zn.t0) / skr)), foerste = null;
      for (var i = 0; i < ns; i++) for (var j = 0; j < nt; j++) {
        var q = R.punkt(zn.s0 + (i + 0.5) / ns * (zn.s1 - zn.s0), zn.t0 + (j + 0.5) / nt * (zn.t1 - zn.t0)), zt = L.zPaa(form, q[0], q[1]);
        if (!isFinite(zt) || zt < terr + 0.5) continue;
        var n = normal(form, q[0], q[1]);
        saet(zn, [q[0] + n[0] * gap, q[1] + n[1] * gap, zt + n[2] * gap], n);
        if (!foerste) foerste = [q[0] + n[0] * (laengde(zn) + gap), q[1] + n[1] * (laengde(zn) + gap), zt + n[2] * (laengde(zn) + gap) + Lm * 0.35];
      }
      // Etiketten står over zonens midte; ligger midten ikke på taget (en gård, et hak), står den ved zonens første pil.
      var mq = R.punkt((zn.s0 + zn.s1) / 2, (zn.t0 + zn.t1) / 2), mz = L.zPaa(form, mq[0], mq[1]), sted = foerste;
      if (isFinite(mz) && mz > terr + 0.5) { var nn = normal(form, mq[0], mq[1]), l2 = laengde(zn) + gap; sted = [mq[0] + nn[0] * l2, mq[1] + nn[1] * l2, mz + nn[2] * l2 + Lm * 0.35]; }
      if (sted) (kandidater[zn.zone] || (kandidater[zn.zone] = [])).push({ zone: zn, pos: sted });
      tagkant(zn);
      var pos = fladePaaTag(form, R, zn);
      if (pos.length) flader.push({ zone: zn.zone, art: zn[maal] >= 0 ? "tryk" : "sug", farve: zn[maal] >= 0 ? FARVE.tryk : FARVE.sug, alfa: r2(0.2 + 0.45 * Math.min(1, Math.abs(zn[maal]) / maks)), pos: pos });
    });
    // Én etiket pr. zonenavn: af de to F-hjørner den, der er nærmest kameraet.
    Object.keys(kandidater).forEach(function (navn) {
      var k = kandidater[navn], valgt = k[0];
      if (kam) k.forEach(function (x) { if (x.pos[0] * kam[0] + x.pos[1] * kam[1] > valgt.pos[0] * kam[0] + valgt.pos[1] * kam[1]) valgt = x; });
      etiket(valgt.zone, valgt.pos);
    });
    // Friktion: korte pile langs fladen i vindens retning, på de to sider og på taget, bag afstanden fra vindsiden.
    var fr = z.friktion;
    if (fr && fr.aktiv) {
      var lf = Lm * 0.55, n1 = Math.max(1, Math.round(fr.laengde / (lf * 1.6))), frSted = null;
      sider.forEach(function (S) {
        for (var i = 0; i < n1; i++) {
          var s = fr.start + (i + 0.5) / n1 * fr.laengde - lf / 2, q = S[0](s), ind = S[1], x0 = q[0] - ind[0] * 3 * c, y0 = q[1] - ind[1] * 3 * c, zz = terr + Math.min(z.h * 0.2, 1.2);
          var a = ram(form, x0, y0, ind[0], ind[1], zz, z.b + 6 * c); if (a == null) continue;
          var Q = [x0 + ind[0] * (a - gap * 1.3), y0 + ind[1] * (a - gap * 1.3), zz];
          frik.push({ fra: Q, til: [Q[0] + dv[0] * lf, Q[1] + dv[1] * lf, zz], zone: "fr" });
          if (i === n1 - 1 && modKamera([-ind[0], -ind[1]])) frSted = [Q[0] - ind[0] * Lm * 0.6, Q[1] - ind[1] * Lm * 0.6, zz];
        }
      });
      var nt2 = Math.max(1, Math.round(z.b / (lf * 2.2)));
      for (var i3 = 0; i3 < n1; i3++) for (var j3 = 0; j3 < nt2; j3++) {
        var s3 = fr.start + (i3 + 0.5) / n1 * fr.laengde - lf / 2, q3 = R.punkt(s3, (j3 + 0.5) / nt2 * z.b), q4 = R.punkt(s3 + lf, (j3 + 0.5) / nt2 * z.b), za = L.zPaa(form, q3[0], q3[1]), zb = L.zPaa(form, q4[0], q4[1]);
        if (!isFinite(za) || za < terr + 0.5) continue;
        frik.push({ fra: [q3[0], q3[1], za + gap * 1.6], til: [q4[0], q4[1], (isFinite(zb) && zb > terr + 0.5 ? zb : za) + gap * 1.6], zone: "fr" });
      }
      if (!frSted && frik.length) frSted = [frik[0].fra[0], frik[0].fra[1], frik[0].fra[2] + Lm * 0.45];
      if (frSted) etk.push({ pos: frSted, tekst: "Friktion", tekst2: fr.w == null ? (fr.cfr == null ? "vælg overflade" : "vindinput mangler") : L.dk(fr.w, 3) + " kN/m²", art: "friktion", zone: "fr" });
    }
    var Lk = Lm * 0.62;
    return { lag: [{ art: "tryk", farve: FARVE.tryk, pile: tryk, L: Lk }, { art: "sug", farve: FARVE.sug, pile: sug, L: Lk }, { art: "friktion", farve: FARVE.friktion, pile: frik, L: Lk * 0.8 }],
      flader: flader, kanter: kanter, etiketter: etk, L: Lm };
  }
  // En zone lagt på taget som små vandrette ruder i højdekortets højde (to trekanter pr. rude, x y z).
  function fladePaaTag(form, R, zn) {
    var g = form.g, c = g.c, n = Math.max(1, Math.round(0.3 / c)), a = R.punkt(zn.s0, zn.t0), b = R.punkt(zn.s1, zn.t1), pos = [];
    var x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]), loeft = 0.07;
    var i0 = Math.max(0, Math.floor((x0 - g.x0) / c)), i1 = Math.min(g.nx, Math.ceil((x1 - g.x0) / c)), j0 = Math.max(0, Math.floor((y0 - g.y0) / c)), j1 = Math.min(g.ny, Math.ceil((y1 - g.y0) / c));
    for (var j = j0; j < j1; j += n) for (var i = i0; i < i1; i += n) {
      var im = Math.min(g.nx - 1, i + (n >> 1)), jm = Math.min(g.ny - 1, j + (n >> 1)), k = im + jm * g.nx;
      if (!form.fyldt[k] || form.slags[k] !== 1) continue;
      var zt = form.zTop[k]; if (!isFinite(zt) || zt < form.terraen + 0.5) continue;
      var xa = Math.max(x0, g.x0 + i * c), xb = Math.min(x1, g.x0 + (i + n) * c), ya = Math.max(y0, g.y0 + j * c), yb = Math.min(y1, g.y0 + (j + n) * c), zz = zt + loeft;
      if (xb - xa < 1e-6 || yb - ya < 1e-6) continue;
      pos.push(xa, ya, zz, xb, ya, zz, xb, yb, zz, xa, ya, zz, xb, yb, zz, xa, yb, zz);
    }
    return pos;
  }

  /* ---------- Tegningen: bygningen foldet ud ---------- */
  // Taget i midten set oppefra, vinden nedefra. Væggene er foldet ud til siderne som bjælker, hvis bredde følger trykket:
  // siderne (A, B, C) til venstre og højre, vindsiden (D) nederst og læsiden (E) øverst. Friktionen står yderst som grå striber.
  function tx(x, y, t, fs, o) {
    o = o || {};
    return "<text x='" + r2(x) + "' y='" + r2(y) + "' font-size='" + r2(fs) + "' text-anchor='" + (o.a || "middle") + "'" + (o.b ? " font-weight='bold'" : "") + " fill='" + (o.f || "#222222") + "'>" + xml(t) + "</text>";
  }
  function pil(x1, y1, x2, y2, farve, fs) {
    var dx = x2 - x1, dy = y2 - y1, l = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / l, uy = dy / l, hl = Math.min(fs * 0.5, l * 0.6), hb = hl * 0.45, bx = x2 - ux * hl, by = y2 - uy * hl;
    return "<path d='M" + r2(x1) + " " + r2(y1) + "L" + r2(bx) + " " + r2(by) + "' stroke='" + farve + "' stroke-width='" + r2(fs * 0.09) + "' fill='none'/>" +
      "<path d='M" + r2(x2) + " " + r2(y2) + "L" + r2(bx - uy * hb) + " " + r2(by + ux * hb) + "L" + r2(bx + uy * hb) + " " + r2(by - ux * hb) + "Z' fill='" + farve + "'/>";
  }
  function rekt(x, y, w, h, fyld, alfa, streg, fs) {
    return "<rect x='" + r2(x) + "' y='" + r2(y) + "' width='" + r2(w) + "' height='" + r2(h) + "' fill='" + fyld + "' fill-opacity='" + r2(alfa) + "' stroke='" + (streg || "#222222") + "' stroke-width='" + r2(fs * 0.06) + "'/>";
  }
  function svg(form, z, o) {
    o = o || {};
    var b = z.b, d = z.d, maal = z.qp == null ? "cpe" : "w", alle = z.vaegge.concat(z.tag), maks = alle.reduce(function (m, x) { return Math.max(m, Math.abs(x[maal])); }, 0) || 1;
    var stor = Math.max(b, d), B = stor * 0.2, luft = stor * 0.025, fs = Math.max(0.2, (stor + 2 * B) * 0.036), ud = "", fr = z.friktion;
    function bred(x) { return Math.max(B * 0.12, Math.abs(x[maal]) / maks * B); }
    function farve(x) { return x[maal] >= 0 ? FARVE.tryk : FARVE.sug; }
    function tal(x) { return x.zone + "  " + vaerdiTekst(z, x); }
    var navn = {}; z.vaegge.forEach(function (x) { navn[x.zone] = x; });
    var D = navn.D, E = navn.E, sider = z.vaegge.filter(function (x) { return x.flade === "side"; });
    // Taget: y = −s, så vindsiden ligger nederst.
    var tag = "";
    z.tag.forEach(function (x) {
      tag += rekt(x.t0, -x.s1, x.t1 - x.t0, x.s1 - x.s0, farve(x), 0.14 + 0.5 * Math.min(1, Math.abs(x[maal]) / maks), "#222222", fs * 0.7);
      var lille = Math.min(x.t1 - x.t0, x.s1 - x.s0), f2 = Math.min(fs, Math.max(fs * 0.55, lille * 0.8));
      // Går kippen midt gennem zonen (vind langs kippen), står bogstavet ved siden af den.
      var paaKip = z.tagart === "sadel" && z.theta === 90 && x.t0 < b / 2 - 1e-6 && x.t1 > b / 2 + 1e-6;
      tag += tx(paaKip ? x.t0 + (x.t1 - x.t0) * 0.3 : (x.t0 + x.t1) / 2, -(x.s0 + x.s1) / 2 + f2 * 0.35, x.zone, x.zone.length > 1 ? f2 * 0.65 : f2, { b: true });
    });
    tag += "<rect x='0' y='" + r2(-d) + "' width='" + r2(b) + "' height='" + r2(d) + "' fill='none' stroke='#222222' stroke-width='" + r2(fs * 0.16) + "'/>";
    if (z.tagMangler && z.tagMangler.length) tag += tx(b / 2, -d / 2, "Tagzoner ikke beregnet", Math.min(fs * 0.75, b / 12), { b: true });
    if (z.kip != null) tag += "<path d='M0 " + r2(-z.kip) + "L" + r2(b) + " " + r2(-z.kip) + "' stroke='#222222' stroke-width='" + r2(fs * 0.1) + "' stroke-dasharray='" + r2(fs * 0.5) + " " + r2(fs * 0.35) + "'/>" + tx(b - fs * 0.3, -z.kip - fs * 0.3, "kip", fs * 0.75, { a: "end", f: "#444444" });
    if (z.tagart === "sadel" && z.theta === 90) tag += "<path d='M" + r2(b / 2) + " 0L" + r2(b / 2) + " " + r2(-d) + "' stroke='#222222' stroke-width='" + r2(fs * 0.1) + "' stroke-dasharray='" + r2(fs * 0.5) + " " + r2(fs * 0.35) + "'/>";
    // Siderne: bjælker til venstre og højre, pile væk fra bygningen ved sug.
    var side = "", yderst = 0;
    sider.forEach(function (x) {
      var w = bred(x), y0 = -x.s1, hh = x.s1 - x.s0, n = Math.max(1, Math.round(hh / (fs * 1.5))), i, y;
      yderst = Math.max(yderst, w);
      side += rekt(-luft - w, y0, w, hh, farve(x), 0.5, null, fs) + rekt(b + luft, y0, w, hh, farve(x), 0.5, null, fs);
      for (i = 0; i < n; i++) {
        y = y0 + (i + 0.5) / n * hh;
        if (x[maal] < 0) { side += pil(-luft, y, -luft - w, y, "#222222", fs * 0.8) + pil(b + luft, y, b + luft + w, y, "#222222", fs * 0.8); }
        else { side += pil(-luft - w, y, -luft, y, "#222222", fs * 0.8) + pil(b + luft + w, y, b + luft, y, "#222222", fs * 0.8); }
      }
      // Tallet står uden for bjælken. En kort zone (A) får tallet skubbet ned forbi vindsidens kant, så tallene ikke rører hinanden.
      var ty = Math.min(-(x.s0 + x.s1) / 2 + fs * 0.35, -x.s0 + (hh < fs * 1.3 ? fs * 1.15 : 0) - (hh < fs * 1.3 ? 0 : 0));
      if (hh < fs * 1.3) ty = -x.s0 + fs * 1.15;
      side += tx(-luft - w - fs * 0.4, ty, tal(x), fs, { a: "end" }) + tx(b + luft + w + fs * 0.4, ty, tal(x), fs, { a: "start" });
    });
    // Vindsiden nederst (pile ind mod bygningen ved tryk) og læsiden øverst.
    var wD = bred(D), wE = bred(E), ender = "", nD = Math.max(2, Math.round(b / (fs * 1.5))), k, xx;
    ender += rekt(0, luft, b, wD, farve(D), 0.55, null, fs) + rekt(0, -d - luft - wE, b, wE, farve(E), 0.5, null, fs);
    for (k = 0; k < nD; k++) {
      xx = (k + 0.5) / nD * b;
      ender += D[maal] >= 0 ? pil(xx, luft + wD, xx, luft, "#222222", fs * 0.8) : pil(xx, luft, xx, luft + wD, "#222222", fs * 0.8);
      ender += E[maal] < 0 ? pil(xx, -d - luft, xx, -d - luft - wE, "#222222", fs * 0.8) : pil(xx, -d - luft - wE, xx, -d - luft, "#222222", fs * 0.8);
    }
    ender += tx(b / 2, luft + wD + fs * 1.15, tal(D), fs) + tx(b / 2, -d - luft - wE - fs * 0.45, tal(E), fs);
    // Friktion: grå striber yderst og et gråt felt på taget, fra afstanden min(2b, 4h) til læsiden.
    var talBred = fs * (Math.max.apply(null, sider.map(function (x) { return tal(x).length; })) * 0.5 + 0.8), frik = "", frX = luft + yderst + talBred + fs * 0.6, frW = fs * 0.9;
    var ft = "fr  " + (fr && fr.w != null ? L.dk(fr.w, 3) : fr && fr.cfr != null ? "vindinput mangler" : "vælg overflade");
    if (fr && fr.aktiv) {
      var fy = -d, fh = fr.laengde;
      frik += rekt(-frX - frW, fy, frW, fh, FARVE.friktion, 0.45, null, fs) + rekt(b + frX, fy, frW, fh, FARVE.friktion, 0.45, null, fs);
      frik += pil(-frX - frW / 2, fy + fh - fs * 0.2, -frX - frW / 2, fy + fs * 0.2, "#222222", fs * 0.8) + pil(b + frX + frW / 2, fy + fh - fs * 0.2, b + frX + frW / 2, fy + fs * 0.2, "#222222", fs * 0.8);
      frik += tx(-frX - frW - fs * 0.4, fy + fh / 2 + fs * 0.35, ft, fs, { a: "end", f: "#444444" }) + tx(b + frX + frW + fs * 0.4, fy + fh / 2 + fs * 0.35, ft, fs, { a: "start", f: "#444444" });
      tag += "<rect x='0' y='" + r2(-d) + "' width='" + r2(b) + "' height='" + r2(fh) + "' fill='#30363d' fill-opacity='0.16' stroke='none'/>";
      var nf = Math.max(1, Math.min(3, Math.round(b / (fs * 4))));
      for (k = 0; k < nf; k++) { xx = (k + 0.5) / nf * b + (nf === 1 ? b * 0.22 : 0); tag += pil(xx, -d + fh - fs * 0.3, xx, -d + Math.max(fs * 0.3, fh - fs * 2.6), "#30363d", fs * 0.8); }
      tag += "<path d='M0 " + r2(-d + fh) + "L" + r2(b) + " " + r2(-d + fh) + "' stroke='#30363d' stroke-width='" + r2(fs * 0.08) + "' stroke-dasharray='" + r2(fs * 0.3) + " " + r2(fs * 0.25) + "'/>";
    }
    // Vinden og teksterne.
    var yV = luft + wD + fs * 2.2, vindpil = "<path d='M" + r2(b / 2) + " " + r2(yV) + "l" + r2(fs * 0.9) + " " + r2(fs * 1.1) + "h" + r2(-fs * 0.45) + "v" + r2(fs * 1.5) + "h" + r2(-fs * 0.9) + "v" + r2(-fs * 1.5) + "h" + r2(-fs * 0.45) + "Z' fill='#ffffff' stroke='#222222' stroke-width='" + r2(fs * 0.1) + "'/>";
    var titel = "Vindzoner, vind fra " + z.navn, under = (z.qp == null ? "Formfaktorer c_pe,10" : "Tryk (+) og sug (−) i kN/m²") + "  ·  b × d × h = " + L.dk(b, 1) + " × " + L.dk(d, 1) + " × " + L.dk(z.h, 1) + " m";
    var linjer = ["Vind fra " + z.navn + (z.qp == null ? "" : ":  q_p(" + L.dk(z.ze, 1) + " m) = " + L.dk(z.qp) + " kN/m²"), tagTekst(z) + ":"];
    // Bredden følger tegningen og de korte linjer. Tagets tal brydes i linjer, så en lang række tal ikke gør tegningen lille.
    var halv = luft + yderst + talBred + (fr && fr.aktiv ? fs * 0.6 + frW + fs * (ft.length * 0.5 + 0.8) : 0) + fs * 0.4;
    [[titel, 1.1], [under, 0.9], [linjer[0], 1], [linjer[1], 0.9]].forEach(function (t) { halv = Math.max(halv, t[0].length * fs * t[1] * 0.26 - b / 2 + fs * 0.5); });
    var maksTegn = Math.floor((b + 2 * halv) / (fs * 0.9 * 0.5)), raekke = "";
    raekker(z).filter(function (x) { return x.flade === "tag"; }).map(tal).forEach(function (t) {
      if (raekke && (raekke + "  ·  " + t).length > maksTegn) { linjer.push(raekke); raekke = t; } else raekke = raekke ? raekke + "  ·  " + t : t;
    });
    if (raekke) linjer.push(raekke);
    var yT = yV + fs * 2.6 + fs * 1.3, tekster = "";
    linjer.forEach(function (t, i) { tekster += tx(b / 2, yT + i * fs * 1.3, t, fs * (i ? 0.9 : 1), { b: !i }); });
    var yTop = -d - luft - wE - fs * 1.9;
    tekster += tx(b / 2, yTop - fs * 1.35, titel, fs * 1.1, { b: true }) + tx(b / 2, yTop, under, fs * 0.9, { f: "#444444" });
    var vb = { x: -halv, y: yTop - fs * 2.9, w: b + 2 * halv, h: 0 };
    vb.h = yT + (linjer.length - 1) * fs * 1.3 + fs * 0.9 - vb.y;
    ud = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='" + r2(vb.x) + " " + r2(vb.y) + " " + r2(vb.w) + " " + r2(vb.h) + "' font-family='Libertinus Serif'>" + tag + side + ender + frik + vindpil + tekster + "</svg>";
    return { svg: ud, w: vb.w, h: vb.h, bredde: Math.round(Math.min(150, (o.maksH || 150) * vb.w / vb.h)), fs: fs, titel: titel };
  }

  return { K: K, OVERFLADE: OVERFLADE, TAGART: TAGART, TAB: TAB, FLAD: FLAD, FARVE: FARVE, tabVaerdi: tabVaerdi, tagform: tagform, ramme: ramme, vind: vind, zoner: zoner, raekker: raekker, hvor: hvor,
    vaerdiTekst: vaerdiTekst, tagTekst: tagTekst, pile3d: pile3d, svg: svg, fortegn: fortegn };
});
