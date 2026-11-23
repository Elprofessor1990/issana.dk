/* ISSANA 3D: lastmodel til Statik. Rent modul uden DOM (testes i Node, tests/web-model3d/statik-laster.test.mjs).
   Tre ting: (1) bygningens virkelige form ud fra 3D-eksportens trekanter, (2) lasterne med kilde (Eurocode 1 med dansk NA),
   (3) pile og tegninger (SVG), der følger formen. Forenklet vurdering til undervisning og tidlige faser; ingeniøren skal godkende.

   Tal: et tal står her kun, hvis det har en kilde i standarden. Valg, der afhænger af stedet eller brugen (terrænkategori,
   topografi, brugskategori, lag uden effektiv tyngde), er tomme, til brugeren har sat dem («skal angives af ingeniøren»).

   Retning: X = øst, Y = nord, Z = op (som statik.js). SVG'en bruger kun enkelte anførselstegn, så den kan stå i en Typst-streng.
   Browser: window.IssanaStatikLast. Node: module.exports. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else root.IssanaStatikLast = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  /* ---------- Kilder og tabelværdier ---------- */
  var SKAL = "skal angives af ingeniøren";
  var K = {
    vb0: "DS/EN 1991-1-4 DK NA:2024, pkt. 4.2(1)P note 2",
    cdir: "DS/EN 1991-1-4 DK NA:2024, tabel 1a",
    cseason: "DS/EN 1991-1-4 DK NA:2024, tabel 1b",
    rho: "DS/EN 1991-1-4, pkt. 4.5 note 2 (DK NA: uændret)",
    terraen: "DS/EN 1991-1-4, tabel 4.1, med DK NA:2024 pkt. 4.3.2(1)",
    co: "DS/EN 1991-1-4, pkt. 4.3.1 note 2 og 4.3.3 (DK NA: uændret)",
    qp: "DS/EN 1991-1-4, formel (4.3)-(4.10) (DK NA: uændret for 4.4 og 4.5)",
    cpe: "DS/EN 1991-1-4, tabel 7.1 (DK NA: uændret for 7.2.2)",
    kor: "DS/EN 1991-1-4, pkt. 7.2.2(3) note, med DK NA:2024 pkt. 5.3(5)",
    cscd: "DS/EN 1991-1-4, pkt. 6.2(1)a: under 15 m (DK NA: uændret for 6.1)",
    sk: "DS/EN 1991-1-3 DK NA:2024, pkt. 4.1(1) note 1",
    ce: "DS/EN 1991-1-3 DK NA:2024, pkt. 5.2(7) og tabel 5.1.a",
    ct: "DS/EN 1991-1-3, pkt. 5.2(8)",
    mu: "DS/EN 1991-1-3, tabel 5.2",
    nytte: "DS/EN 1991-1-1 DK NA:2024, tabel 6.2 og 6.4",
    skille: "DS/EN 1991-1-1 DK NA:2024, pkt. 5.2.2(2)P",
    gamma: "DS/EN 1991-1-1, anneks A tabel A.1 (DK NA: anneks A benyttes)",
    bruger: "Angivet af brugeren",
    model: "Aflæst af modellen"
  };
  // Kategori 0 bruges ikke i Danmark: DK NA A.2(1) erstatter den med kategori I, og I omfatter også kyst mod åbent hav.
  var TERRAEN = {
    I: { z0: 0.01, zmin: 1, navn: "I: søer, fladt uden forhindringer, kyst mod åbent hav" },
    II: { z0: 0.05, zmin: 2, navn: "II: lav vegetation og spredte forhindringer" },
    III: { z0: 0.3, zmin: 5, navn: "III: regelmæssig bebyggelse eller vegetation" },
    IV: { z0: 1.0, zmin: 10, navn: "IV: mindst 15 % bygninger over 15 m i gennemsnit" }
  };
  var TOPOGRAFI = {
    vindblaest: { ctop: 0.8, navn: "Vindblæst" },
    normal: { ctop: 1.0, navn: "Normal" },
    afskaermet: { ctop: 1.25, navn: "Afskærmet" }
  };
  var NYTTE = [
    { id: "A1", navn: "A1 bolig og interne adgangsveje", q: 1.5, Q: 2.0 }, { id: "A2", navn: "A2 tagrum", q: 0.5, Q: 0.5 },
    { id: "A3", navn: "A3 loftsrum", q: 1.0, Q: 0.5 }, { id: "A4", navn: "A4 trapper og lokale adgangsveje", q: 3.0, Q: 2.0 },
    { id: "A5", navn: "A5 balkoner", q: 2.5, Q: 2.0 }, { id: "B", navn: "B kontor", q: 2.5, Q: 2.5 },
    { id: "C1", navn: "C1 med bordopstilling", q: 2.5, Q: 3.0 }, { id: "C2", navn: "C2 med faste siddepladser", q: 4.0, Q: 3.0 },
    { id: "C3", navn: "C3-C5 uden faste siddepladser", q: 5.0, Q: 4.0 }, { id: "D1", navn: "D1 mindre butikker", q: 4.0, Q: 4.0 },
    { id: "D2", navn: "D2 større butikker", q: 5.0, Q: 7.0 }, { id: "BC1L", navn: "B-C1 lokale adgangsveje", q: 3.0, Q: 3.0 },
    { id: "BC1F", navn: "B-C1 fælles adgangsveje", q: 5.0, Q: 4.0 }, { id: "C2D", navn: "C2-D adgangsveje", q: 5.0, Q: 4.0 },
    { id: "E", navn: "E erhverv, oplagring", q: 7.5, Q: 7.0 }
  ];
  // Retning vinden kommer fra. d: vindens gangretning. op: den side, tegningen ses fra, så vinden går fra venstre mod højre.
  var RETNING = {
    n: { navn: "nord", d: [0, -1], cdir2: 0.8, setFra: "vest" }, o: { navn: "øst", d: [-1, 0], cdir2: 0.7, setFra: "nord" },
    s: { navn: "syd", d: [0, 1], cdir2: 0.7, setFra: "øst" }, v: { navn: "vest", d: [1, 0], cdir2: 1.0, setFra: "syd" }
  };
  var TILFAELDE = [
    { id: "vind-n", navn: "Vind fra nord", art: "vind", ret: "n" }, { id: "vind-o", navn: "Vind fra øst", art: "vind", ret: "o" },
    { id: "vind-s", navn: "Vind fra syd", art: "vind", ret: "s" }, { id: "vind-v", navn: "Vind fra vest", art: "vind", ret: "v" },
    { id: "sne", navn: "Sne på tag", art: "sne" }, { id: "nytte", navn: "Nyttelast på dæk", art: "nytte" }, { id: "egen", navn: "Egenlast", art: "egen" }
  ];
  var FARVE = { vind: "#1f6fb5", sne: "#0e8f9c", nytte: "#c2571a", egen: "#6a4fa3" };

  /* ---------- Små hjælpere ---------- */
  function dk(x, dec) { return x == null || !isFinite(x) ? "–" : Number(x).toFixed(dec == null ? 2 : dec).replace(".", ","); }
  function fortegn(x, dec) { return x == null || !isFinite(x) ? "–" : (x >= 0 ? "+" : "−") + dk(Math.abs(x), dec); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function klem(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function xml(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;"); }
  function erTal(v) { return typeof v === "number" && isFinite(v); }
  function hvertTrekant(meshes, fn) {
    (meshes || []).forEach(function (m) {
      var p = m && m.pos, ix = m && m.idx; if (!p || !ix) return;
      for (var i = 0; i + 2 < ix.length; i += 3) { var a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3; fn(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]); }
    });
  }
  function nyBoks() { return { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity }; }
  function polyAreal(p) { var a = 0; for (var i = 0, n = p.length; i < n; i++) { var q = p[(i + 1) % n]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
  function iPoly(p, x, y) { var ind = false; for (var i = 0, j = p.length - 1; i < p.length; j = i++) { var a = p[i], b = p[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) ind = !ind; } return ind; }

  /* ---------- Bygningens form: højdekort og omrids ---------- */
  // Dele, der former bygningen. Fundamenter og rækværk tæller ikke: de er ikke den flade, vind og sne rammer.
  var KROP = { "Vægge": 1, "Gulve": 1, "Tage": 1, "Glasfacader": 1, "Søjler": 1, "Bjælker": 1 };
  var PLADE = { "Gulve": 1, "Tage": 1 };

  // Gitter i planen, hvor hver celle husker den højeste flade. Terræn sættes efter kælderen: lodrette dele, der starter under −1 m, er kælder.
  function nytGitter(b, c) {
    var nx = Math.ceil((b.x1 - b.x0) / c) + 7, ny = Math.ceil((b.y1 - b.y0) / c) + 7;
    return { c: c, x0: b.x0 - 3 * c, y0: b.y0 - 3 * c, nx: nx, ny: ny };
  }
  function sigtTrekant(g, ax, ay, az, bx, by, bz, cx, cy, cz, fn) {
    var c = g.c, min = function (u, v, w) { return Math.min(u, v, w); }, max = function (u, v, w) { return Math.max(u, v, w); };
    var i0 = Math.max(0, Math.floor((min(ax, bx, cx) - g.x0) / c)), i1 = Math.min(g.nx - 1, Math.ceil((max(ax, bx, cx) - g.x0) / c));
    var j0 = Math.max(0, Math.floor((min(ay, by, cy) - g.y0) / c)), j1 = Math.min(g.ny - 1, Math.ceil((max(ay, by, cy) - g.y0) / c));
    var d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) > 1e-9) for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) {
      var x = g.x0 + (i + 0.5) * c, y = g.y0 + (j + 0.5) * c;
      var w1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, w2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, w3 = 1 - w1 - w2;
      if (w1 >= -1e-6 && w2 >= -1e-6 && w3 >= -1e-6) fn(i, j, w1 * az + w2 * bz + w3 * cz, true);
    }
    // Kanterne tegnes altid, så tynde og lodrette flader (vægge) også er med.
    [[ax, ay, az, bx, by, bz], [bx, by, bz, cx, cy, cz], [cx, cy, cz, ax, ay, az]].forEach(function (k) {
      var L = Math.sqrt((k[3] - k[0]) * (k[3] - k[0]) + (k[4] - k[1]) * (k[4] - k[1])), n = Math.max(1, Math.ceil(L / (c * 0.5)));
      for (var t = 0; t <= n; t++) {
        var s = t / n, i = Math.floor((k[0] + (k[3] - k[0]) * s - g.x0) / c), j = Math.floor((k[1] + (k[4] - k[1]) * s - g.y0) / c);
        if (i >= 0 && j >= 0 && i < g.nx && j < g.ny) fn(i, j, k[2] + (k[5] - k[2]) * s, false);
      }
    });
  }
  function terraenKote(els) {
    var minZ = Infinity;
    els.forEach(function (e) { if (e.category !== "Vægge" && e.category !== "Glasfacader") return; hvertTrekant(e.meshes, function (ax, ay, az, bx, by, bz, cx, cy, cz) { minZ = Math.min(minZ, az, bz, cz); }); });
    if (!isFinite(minZ)) els.forEach(function (e) { hvertTrekant(e.meshes, function (ax, ay, az, bx, by, bz, cx, cy, cz) { minZ = Math.min(minZ, az, bz, cz); }); });
    return minZ < -1 ? 0 : minZ;
  }
  // Omrids: kanterne mellem fyldte og tomme celler, kædet sammen til lukkede løkker og forenklet, så trapper i skæve vægge bliver rette.
  function loekker(g, fyldt) {
    var nx = g.nx, ny = g.ny, ud = {}, nk = function (i, j) { return i + j * (nx + 1); }, F = function (i, j) { return i >= 0 && j >= 0 && i < nx && j < ny && fyldt[i + j * nx]; };
    function kant(a, b) { (ud[a] || (ud[a] = [])).push(b); }
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      if (!F(i, j)) continue;
      if (!F(i, j - 1)) kant(nk(i, j), nk(i + 1, j));
      if (!F(i + 1, j)) kant(nk(i + 1, j), nk(i + 1, j + 1));
      if (!F(i, j + 1)) kant(nk(i + 1, j + 1), nk(i, j + 1));
      if (!F(i - 1, j)) kant(nk(i, j + 1), nk(i, j));
    }
    var res = [];
    Object.keys(ud).forEach(function (s) {
      var a = +s;
      while (ud[a] && ud[a].length) {
        var kaede = [a], nu = ud[a].pop();
        while (nu !== a) { kaede.push(nu); var l = ud[nu]; if (!l || !l.length) break; nu = l.pop(); }
        if (nu === a && kaede.length >= 4) res.push(kaede.map(function (k) { return [g.x0 + (k % (nx + 1)) * g.c, g.y0 + Math.floor(k / (nx + 1)) * g.c]; }));
      }
    });
    return res;
  }
  function dpFold(p, tol) {
    if (p.length < 3) return p;
    var maxD = 0, idx = 0, a = p[0], b = p[p.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.sqrt(dx * dx + dy * dy) || 1e-9;
    for (var i = 1; i < p.length - 1; i++) { var d = Math.abs(dy * (p[i][0] - a[0]) - dx * (p[i][1] - a[1])) / L; if (d > maxD) { maxD = d; idx = i; } }
    if (maxD <= tol) return [a, b];
    var v = dpFold(p.slice(0, idx + 1), tol), h = dpFold(p.slice(idx), tol);
    return v.slice(0, -1).concat(h);
  }
  function forenkl(loekke, tol) {
    // Start i det punkt, der er længst fra tyngdepunktet: det er næsten altid et rigtigt hjørne.
    var cx = 0, cy = 0; loekke.forEach(function (q) { cx += q[0]; cy += q[1]; }); cx /= loekke.length; cy /= loekke.length;
    var st = 0, m = -1; loekke.forEach(function (q, i) { var d = (q[0] - cx) * (q[0] - cx) + (q[1] - cy) * (q[1] - cy); if (d > m) { m = d; st = i; } });
    var r = loekke.slice(st).concat(loekke.slice(0, st)); r.push(r[0]);
    // Del ved punktet længst fra starten, så en lukket løkke ikke bliver til én linje.
    var far = 1, fm = -1; r.forEach(function (q, i) { var d = (q[0] - r[0][0]) * (q[0] - r[0][0]) + (q[1] - r[0][1]) * (q[1] - r[0][1]); if (d > fm) { fm = d; far = i; } });
    var ens = dpFold(r.slice(0, far + 1), tol).slice(0, -1).concat(dpFold(r.slice(far), tol).slice(0, -1));
    return ens;
  }
  function luk(g, f, r) {
    // Lukning (udvid, krymp) fylder små sprækker mellem vægge og facadefelter.
    var nx = g.nx, ny = g.ny, ny1 = new Uint8Array(f), i, j, a, b, s, n = new Uint8Array(f.length);
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) { if (!ny1[i + j * nx]) continue; for (b = Math.max(0, j - r); b <= Math.min(ny - 1, j + r); b++) for (a = Math.max(0, i - r); a <= Math.min(nx - 1, i + r); a++) n[a + b * nx] = 1; }
    var e = new Uint8Array(f.length);
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) { s = 1; for (b = Math.max(0, j - r); s && b <= Math.min(ny - 1, j + r); b++) for (a = Math.max(0, i - r); a <= Math.min(nx - 1, i + r); a++) if (!n[a + b * nx]) { s = 0; break; } e[i + j * nx] = s; }
    return e;
  }

  // Hele bygningens form. opts.terraen: terrænkote angivet af brugeren. opts.geo: statik.js' geometri (til terrændæk).
  function bygningsform(model, opts) {
    opts = opts || {};
    var els = ((model && model.elements) || []).filter(function (e) { return e && !e.erRum && KROP[e.category] && e.meshes && e.meshes.length; });
    if (!els.length) return null;
    var b = nyBoks();
    els.forEach(function (e) { hvertTrekant(e.meshes, function (ax, ay, az, bx, by, bz, cx, cy, cz) { b.x0 = Math.min(b.x0, ax, bx, cx); b.x1 = Math.max(b.x1, ax, bx, cx); b.y0 = Math.min(b.y0, ay, by, cy); b.y1 = Math.max(b.y1, ay, by, cy); b.z0 = Math.min(b.z0, az, bz, cz); b.z1 = Math.max(b.z1, az, bz, cz); }); });
    if (!isFinite(b.x0)) return null;
    var c = Math.max(0.12, Math.max(b.x1 - b.x0, b.y1 - b.y0) / 240), g = nytGitter(b, c), N = g.nx * g.ny;
    var zTop = new Float32Array(N), slags = new Uint8Array(N);   // slags 1: toppen er en plade (dæk eller tag), der vender opad
    zTop.fill(-Infinity);
    var hHist = {}, plader = [];
    els.forEach(function (e) {
      var plade = !!PLADE[e.category], opFlade = [];
      hvertTrekant(e.meshes, function (ax, ay, az, bx, by, bz, cx, cy, cz) {
        var ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az, nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        var opad = plade && l > 1e-9 && nz / l > 0.2;
        if (opad) opFlade.push([ax, ay, az, bx, by, bz, cx, cy, cz, l / 2 * Math.abs(nz / l), Math.acos(klem(Math.abs(nz / l), 0, 1)) * 180 / Math.PI]);
        sigtTrekant(g, ax, ay, az, bx, by, bz, cx, cy, cz, function (i, j, z, flade) {
          var k = i + j * g.nx;
          if (z > zTop[k] + 1e-4) { zTop[k] = z; slags[k] = opad && flade ? 1 : 0; }
          else if (opad && flade && z > zTop[k] - 0.02) slags[k] = 1;
        });
      });
      if (plade && opFlade.length) plader.push({ el: e, op: opFlade });
    });
    var terr = erTal(opts.terraen) ? opts.terraen : terraenKote(els), minH = 0.3;
    var fyldtRaa = new Uint8Array(N), i, j;
    for (i = 0; i < N; i++) fyldtRaa[i] = zTop[i] > terr + minH ? 1 : 0;
    var fyldt = luk(g, fyldtRaa, 2);
    // Sprækker, der er lukket, får højden fra en naboflade, så pile ikke går igennem dem.
    var uFyld = function (k) { if (zTop[k] > terr + minH) return; var i0 = k % g.nx, j0 = Math.floor(k / g.nx), m = -Infinity, a, bb; for (bb = Math.max(0, j0 - 2); bb <= Math.min(g.ny - 1, j0 + 2); bb++) for (a = Math.max(0, i0 - 2); a <= Math.min(g.nx - 1, i0 + 2); a++) if (zTop[a + bb * g.nx] > m) m = zTop[a + bb * g.nx]; if (isFinite(m)) zTop[k] = m; };
    for (i = 0; i < N; i++) if (fyldt[i] && !fyldtRaa[i]) uFyld(i);
    // Omrids
    var tol = Math.max(0.2, c * 1.6);
    var omrids = loekker(g, fyldt).map(function (l) { var p = forenkl(l, tol); return { p: p, areal: polyAreal(p) }; }).filter(function (o) { return Math.abs(o.areal) >= 0.8 && o.p.length >= 3; });
    var ydre = omrids.filter(function (o) { return o.areal > 0; }).sort(function (a2, b2) { return b2.areal - a2.areal; });
    var huller = omrids.filter(function (o) { return o.areal < 0; });
    // Udstrækning af det, der står over terræn
    var B = nyBoks(), zMax = -Infinity;
    for (j = 0; j < g.ny; j++) for (i = 0; i < g.nx; i++) { if (!fyldt[i + j * g.nx]) continue; var x = g.x0 + (i + 0.5) * c, y = g.y0 + (j + 0.5) * c; B.x0 = Math.min(B.x0, x); B.x1 = Math.max(B.x1, x); B.y0 = Math.min(B.y0, y); B.y1 = Math.max(B.y1, y); if (zTop[i + j * g.nx] > zMax) zMax = zTop[i + j * g.nx]; }
    if (!isFinite(B.x0)) return null;
    // Taghældning: den største samlede tagflade pr. grad
    plader.forEach(function (p) { p.op.forEach(function (t) {
      var mx = (t[0] + t[3] + t[6]) / 3, my = (t[1] + t[4] + t[7]) / 3, mz = (t[2] + t[5] + t[8]) / 3, i2 = Math.floor((mx - g.x0) / c), j2 = Math.floor((my - g.y0) / c);
      if (i2 < 0 || j2 < 0 || i2 >= g.nx || j2 >= g.ny || zTop[i2 + j2 * g.nx] > mz + 0.15) return;
      var gr = Math.round(t[10]); hHist[gr] = (hHist[gr] || 0) + t[9];
    }); });
    var alfa = null, alfaA = 0;
    Object.keys(hHist).forEach(function (k) { if (hHist[k] > alfaA) { alfaA = hHist[k]; alfa = +k; } });

    var form = { g: g, zTop: zTop, slags: slags, fyldt: fyldt, terraen: terr, h: zMax - terr, zMax: zMax, boks: B, omrids: ydre.map(function (o) { return o.p; }), huller: huller.map(function (o) { return o.p; }), alfa: alfa };
    form.laengde = Math.max(B.x1 - B.x0, B.y1 - B.y0);
    form.bredde = Math.min(B.x1 - B.x0, B.y1 - B.y0);
    form.pileL = klem(form.laengde * 0.15, 1.2, 7);
    form.plader = lavPlader(form, plader, opts.geo);
    form.niveauer = niveauer(form);
    return form;
  }
  function zPaa(form, x, y) {
    var g = form.g, i = Math.floor((x - g.x0) / g.c), j = Math.floor((y - g.y0) / g.c);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return -Infinity;
    return form.fyldt[i + j * g.nx] ? form.zTop[i + j * g.nx] : -Infinity;
  }
  function lavPlader(form, plader, geo) {
    var g = form.g, ud = [];
    plader.forEach(function (p) {
      var e = p.el, bb = nyBoks();
      p.op.forEach(function (t) { bb.x0 = Math.min(bb.x0, t[0], t[3], t[6]); bb.x1 = Math.max(bb.x1, t[0], t[3], t[6]); bb.y0 = Math.min(bb.y0, t[1], t[4], t[7]); bb.y1 = Math.max(bb.y1, t[1], t[4], t[7]); bb.z1 = Math.max(bb.z1, t[2], t[5], t[8]); });
      var sub = nytGitter(bb, g.c), f = new Uint8Array(sub.nx * sub.ny), zs = new Float32Array(sub.nx * sub.ny);
      p.op.forEach(function (t) { sigtTrekant(sub, t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], function (i, j, z, fl) { if (!fl) return; f[i + j * sub.nx] = 1; if (z > zs[i + j * sub.nx]) zs[i + j * sub.nx] = z; }); });
      var fl = luk(sub, f, 1), tol = Math.max(0.2, g.c * 1.6), alle = loekker(sub, fl).map(function (l) { var q = forenkl(l, tol); return { p: q, a: polyAreal(q) }; }).filter(function (o) { return Math.abs(o.a) >= 0.5 && o.p.length >= 3; }),
        rand = alle.filter(function (o) { return o.a > 0; }).sort(function (a, b) { return b.a - a.a; }), hul = alle.filter(function (o) { return o.a < 0; }).map(function (o) { return o.p; });
      if (!rand.length) return;
      // Et dæk er tag, når det for det meste er den øverste flade (også et fladt tag, Revit kalder et gulv).
      var ialt = 0, top = 0;
      for (var j = 0; j < sub.ny; j += 2) for (var i = 0; i < sub.nx; i += 2) { if (!fl[i + j * sub.nx]) continue; ialt++; var z2 = zPaa(form, sub.x0 + (i + 0.5) * sub.c, sub.y0 + (j + 0.5) * sub.c); if (z2 <= zs[i + j * sub.nx] + 0.3) top++; }
      var z = bb.z1, erTag = e.category === "Tage" || (ialt > 0 && top / ialt >= 0.5 && z > form.terraen + 0.5);
      var terraen = !!(geo && geo.terraen && geo.terraen[e.id]);
      ud.push({ id: e.id, navn: e.type || e.name || "Dæk", etage: e.level == null ? "" : String(e.level), typeId: e.typeId, kategori: e.category, polygon: rand[0].p, huller: hul, z: z, erTag: erTag, terraen: terraen, areal: alle.reduce(function (s, o) { return s + o.a; }, 0) });
    });
    if (!(geo && geo.terraen)) { var zs2 = ud.filter(function (u) { return !u.erTag; }).map(function (u) { return u.z; }), m = Math.min.apply(null, zs2.length ? zs2 : [Infinity]); ud.forEach(function (u) { if (!u.erTag && u.z <= m + 0.2 && u.z <= form.terraen + 0.2) u.terraen = true; }); }
    return ud.sort(function (a, b) { return a.z - b.z; });
  }
  function niveauer(form) {
    var u = {};
    form.plader.forEach(function (p) { if (p.terraen) return; var k = p.etage || ("z" + Math.round(p.z * 10)); if (!u[k] || p.z > u[k].z) u[k] = { navn: p.etage || (p.erTag ? "Tag" : "Dæk"), z: p.z, erTag: p.erTag }; });
    return Object.keys(u).map(function (k) { return u[k]; }).sort(function (a, b) { return a.z - b.z; });
  }
  // Silhuet på tværs af en akse: for hver position u langs (ax,ay) den højeste z. Bruges til facade/snit og projektioner.
  function silhuet(form, ax, ay) {
    var g = form.g, B = form.boks, u0 = Infinity, u1 = -Infinity, i, j;
    for (j = 0; j < g.ny; j += 1) for (i = 0; i < g.nx; i += 1) { if (!form.fyldt[i + j * g.nx]) continue; var u = (g.x0 + (i + 0.5) * g.c) * ax + (g.y0 + (j + 0.5) * g.c) * ay; if (u < u0) u0 = u; if (u > u1) u1 = u; }
    var c = g.c, n = Math.ceil((u1 - u0) / c) + 1, z = new Float32Array(n).fill(-Infinity), bred = new Float32Array(n);
    for (j = 0; j < g.ny; j++) for (i = 0; i < g.nx; i++) { var k = i + j * g.nx; if (!form.fyldt[k]) continue; var w = (g.x0 + (i + 0.5) * c) * ax + (g.y0 + (j + 0.5) * c) * ay, b = Math.round((w - u0) / c); if (form.zTop[k] > z[b]) z[b] = form.zTop[k]; bred[b] += c; }
    return { u0: u0, u1: u1, c: c, n: n, z: z, B: B, dybde: u1 - u0 + c };
  }
  function profilPunkter(s, terr) {
    var q = [], i;
    for (i = 0; i < s.n; i++) { var z = isFinite(s.z[i]) ? Math.max(terr, s.z[i]) : terr; q.push([s.u0 + i * s.c, z]); }
    var f = [[q[0][0], terr]].concat(dpFold(q, Math.max(0.25, s.c * 1.6)), [[q[q.length - 1][0], terr]]);
    return f;
  }
  function hoejdeVed(s, u) { var i = Math.round((u - s.u0) / s.c); return i >= 0 && i < s.n && isFinite(s.z[i]) ? s.z[i] : -Infinity; }
  // Facadeareal mod vinden: fra terræn op til silhuetten, langs facaden (på tværs af vinden).
  function vindAreal(form, ret, fraZ) {
    var d = RETNING[ret].d, s = silhuet(form, -d[1], d[0]), a = 0, bund = fraZ == null ? form.terraen : fraZ;
    for (var i = 0; i < s.n; i++) if (isFinite(s.z[i])) a += Math.max(0, s.z[i] - bund) * s.c;
    return a;
  }

  /* ---------- Indstillinger: standardværdier med kilde ---------- */
  function standard() {
    return {
      terraenKote: null,
      vind: { vb0: 24, cseason2: 1.0, rho: 1.25, co: 1.0, terraen: "", cdir2: { n: 0.8, o: 0.7, s: 0.7, v: 1.0 }, ze: null, cscd: null },
      sne: { sk: 1.0, topografi: "", ct: 1.0, alfa: null },
      nytte: {},    // pr. etage: { kat: "B", q: null, skille: null }
      egen: {},     // pr. type-id: { g: null, lag: { indeks: gamma } }
      org: {}       // felter til rapporten
    };
  }
  function flet(std, g) {
    if (!g || typeof g !== "object") return std;
    Object.keys(g).forEach(function (k) {
      var v = g[k];
      if (v && typeof v === "object" && !Array.isArray(v) && std[k] && typeof std[k] === "object") flet(std[k], v);
      else if (v !== undefined) std[k] = v;
    });
    return std;
  }

  /* ---------- Beregning: vind ---------- */
  function interp(x, x0, y0, x1, y1) { if (x <= x0) return y0; if (x >= x1) return y1; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  function cpe(hd) {
    return {
      D: hd <= 0.25 ? 0.7 : hd >= 1 ? 0.8 : interp(hd, 0.25, 0.7, 1, 0.8),
      E: hd <= 0.25 ? -0.3 : hd >= 5 ? -0.7 : hd >= 1 ? interp(hd, 1, -0.5, 5, -0.7) : interp(hd, 0.25, -0.3, 1, -0.5)
    };
  }
  function vind(form, ind, ret) {
    var v = ind.vind, R = RETNING[ret], T = TERRAEN[v.terraen], d = R.d, mangler = [];
    if (!T) mangler.push("Terrænkategori");
    var s = silhuet(form, d[0], d[1]), dybde = s.dybde, h = form.h, ze = erTal(v.ze) ? v.ze : h;
    var bred = silhuet(form, -d[1], d[0]).dybde;
    var cdir2 = erTal(v.cdir2[ret]) ? v.cdir2[ret] : null;
    var cs = erTal(v.cscd) ? v.cscd : (h < 15 ? 1 : null);
    if (cs == null) mangler.push("Konstruktionsfaktor c_s·c_d");
    if (cdir2 == null) mangler.push("Retningsfaktor");
    var r = { ret: ret, navn: R.navn, d: dybde, b: bred, h: h, ze: ze, hd: dybde > 0 ? h / dybde : null, cdir2: cdir2, cs: cs, mangler: mangler, A: vindAreal(form, ret), terraen: v.terraen };
    if (mangler.length) return r;
    var z = Math.max(ze, T.zmin), kr = 0.19 * Math.pow(T.z0 / 0.05, 0.07), lg = Math.log(z / T.z0), cr = kr * lg, co = v.co, Iv = 1 / (co * lg);
    var vb2 = cdir2 * v.cseason2 * v.vb0 * v.vb0, vm2 = cr * cr * co * co * vb2, qp = (1 + 7 * Iv) * 0.5 * v.rho * vm2 / 1000;
    var c = cpe(r.hd), kor = r.hd >= 5 ? 1 : r.hd <= 1 ? 0.85 : interp(r.hd, 1, 0.85, 5, 1);
    var wD = qp * c.D, wE = qp * c.E, wN = cs * kor * (wD - wE);
    r.z0 = T.z0; r.zmin = T.zmin; r.z = z; r.kr = kr; r.cr = cr; r.Iv = Iv; r.vb = Math.sqrt(vb2); r.vm = Math.sqrt(vm2); r.qp = qp; r.cD = c.D; r.cE = c.E; r.kor = kor; r.wD = wD; r.wE = wE; r.wN = wN; r.F = wN * r.A; r.co = co;
    return r;
  }

  /* ---------- Beregning: sne ---------- */
  function mu1(a) { return a <= 30 ? 0.8 : a < 60 ? 0.8 * (60 - a) / 30 : 0; }
  function sne(form, ind) {
    var s = ind.sne, T = TOPOGRAFI[s.topografi], m = [], l1 = form.laengde, l2 = form.bredde, h = form.h;
    if (!T) m.push("Topografi");
    var alfa = erTal(s.alfa) ? s.alfa : form.alfa;
    if (alfa == null) m.push("Taghældning");
    var r = { mangler: m, alfa: alfa, sk: s.sk, ct: s.ct, topografi: s.topografi, l1: l1, l2: l2, h: h };
    if (m.length) return r;
    var cs = s.topografi === "afskaermet" || 2 * h > l1 ? 1 : (l2 <= 10 * h ? 1 : l2 < 20 * h ? 1 + 0.025 * (l2 - 10 * h) / h : 1.25);
    r.ctop = T.ctop; r.cs = cs; r.ce = T.ctop * cs; r.mu = mu1(alfa); r.s = r.mu * r.ce * s.ct * s.sk;
    return r;
  }

  /* ---------- Beregning: nyttelast og egenlast ---------- */
  function nytte(ind, etage) {
    var u = ind.nytte[etage] || {}, k = NYTTE.filter(function (x) { return x.id === u.kat; })[0], q = erTal(u.q) ? u.q : (k ? k.q : null), Q = k ? k.Q : null;
    var skille = erTal(u.skille) ? u.skille : null;
    return { etage: etage, kat: u.kat || "", katNavn: k ? k.navn : "", q: q, Q: Q, skille: skille, ialt: q == null ? null : q + (skille || 0), kilde: erTal(u.q) ? K.bruger : K.nytte, mangler: q == null ? ["Brugskategori for " + etage] : [] };
  }
  function forslagGamma(mat) {
    var t = String(mat || "");
    if (!/beton|concrete/i.test(t) || /porebeton|letbeton|leca|aerated|lightweight|huld|hollow|element/i.test(t)) return null;
    return { gamma: 25, kilde: K.gamma + ": normalbeton 24 kN/m³ plus 1 kN/m³ for armering. Forslag ud fra materialenavnet; kontrollér.", kort: "Anneks A, tabel A.1: 24 + 1 kN/m³ (forslag ud fra navnet)" };
  }
  function typeNr(id) { return String(id); }
  // Egenlast pr. type: Σ γ·t over lagene. Et lag uden γ får intet tal; summen vises først, når alle lag har en værdi.
  function egen(model, ind, typeId) {
    var t = (model.types || []).filter(function (x) { return String(x.id) === String(typeId); })[0], u = ind.egen[typeNr(typeId)] || {};
    var lag = (t && t.layers ? t.layers : []).map(function (l, i) {
      var mm = Number(l.widthMm) || 0, fors = forslagGamma(l.material), eget = u.lag && erTal(u.lag[i]) ? u.lag[i] : null, g = eget != null ? eget : (fors ? fors.gamma : null);
      return { i: i, navn: l.material || "", mm: mm, gamma: g, last: g == null ? null : g * mm / 1000, kilde: eget != null ? K.bruger : (fors ? fors.kilde : ""), kildeKort: eget != null ? K.bruger : (fors ? fors.kort : ""), mangler: g == null && mm > 0 };
    });
    var sum = lag.reduce(function (s, l) { return s + (l.last || 0); }, 0), hul = lag.filter(function (l) { return l.mangler; }).length;
    var g = erTal(u.g) ? u.g : (hul || !lag.length ? null : sum);
    return { typeId: typeId, navn: (t && (t.name || t.type)) || "", lag: lag, delsum: sum, hul: hul, g: g, kilde: erTal(u.g) ? K.bruger : "Lagene ganget med effektiv tyngde", mangler: g == null ? ["Egenlast"] : [] };
  }

  /* ---------- Felter: dæk med spændretning ---------- */
  function polygonSom(p) {
    if (!Array.isArray(p)) return null;
    var q = p.map(function (a) { return Array.isArray(a) ? [a[0], a[1]] : (a && a.x != null ? [a.x, a.y] : null); }).filter(Boolean);
    return q.length >= 3 ? q : null;
  }
  function polyMidte(p) { var A = 0, cx = 0, cy = 0; for (var i = 0, n = p.length; i < n; i++) { var q = p[(i + 1) % n], k = p[i][0] * q[1] - q[0] * p[i][1]; A += k; cx += (p[i][0] + q[0]) * k; cy += (p[i][1] + q[1]) * k; } if (Math.abs(A) < 1e-9) return p[0]; return [cx / (3 * A), cy / (3 * A)]; }
  // Felterne er pladerne (dæk og tag i modellen), så lasten står på hele dækket, også hvor der ikke er sat spændretning.
  // Statiks felter (tilstand.felter, kun dem med retning) gemmes til spændmærkerne. Uden dem læses retningen af rummene.
  function felter(form, tilstand, geo, valg) {
    var ud = [];
    var raa = tilstand && Array.isArray(tilstand.felter) ? tilstand.felter : [], plader = {};
    form.plader.forEach(function (p) { plader[p.id] = p; });
    form.statikFelter = raa.map(function (f) {
      var poly = polygonSom(f.polygon); if (!poly) return null;
      var p = plader[f.daekId], z = erTal(f.z) ? f.z : (p ? p.z : null); if (z == null) return null;
      return { id: f.id, daekId: f.daekId, navn: f.navn || (p ? p.navn : "Dæk"), etage: p ? p.etage : naermesteNiveau(form, z), polygon: poly, z: z, erTag: p ? p.erTag : !!f.erTag, vinkel: erTal(f.vinkelGrader) ? f.vinkelGrader : null, begge: !!f.begge, rumId: f.rumId };
    }).filter(Boolean);
    var spaend = (valg && valg.spaend) || {}, rumFor = (geo && geo.daekOverRum) || {};
    form.plader.forEach(function (p) {
      var k = {}; (rumFor[p.id] || []).forEach(function (r) { var s = spaend[r]; if (s) k[s] = (k[s] || 0) + 1; });
      var n = Object.keys(k), vinkel = n.length === 1 && n[0] === "ov" ? 0 : n.length === 1 && n[0] === "ns" ? 90 : null, begge = n.length === 1 && n[0] === "begge";
      ud.push({ id: "plade:" + p.id, daekId: p.id, navn: p.navn, etage: p.etage, typeId: p.typeId, polygon: p.polygon, huller: p.huller, z: p.z, erTag: p.erTag, terraen: p.terraen, vinkel: vinkel, begge: begge, areal: p.areal, blandet: n.length > 1 });
    });
    return ud;
  }
  function naermesteNiveau(form, z) { var b = null, m = Infinity; form.niveauer.forEach(function (n) { if (Math.abs(n.z - z) < m) { m = Math.abs(n.z - z); b = n.navn; } }); return b || ""; }
  // Spændretninger som korte dobbeltpile i planen: fra felternes vinkel, ellers fra rummene.
  function spaendmaerker(form, felt, geo, valg, etage) {
    var ud = [], fra = (form.statikFelter && form.statikFelter.length) ? form.statikFelter : felt, af = fra.filter(function (f) { return f.etage === etage && !f.terraen && (f.vinkel != null || f.begge); });
    af.forEach(function (f) { var m = polyMidte(f.polygon), b = nyBoks(); f.polygon.forEach(function (q) { b.x0 = Math.min(b.x0, q[0]); b.x1 = Math.max(b.x1, q[0]); b.y0 = Math.min(b.y0, q[1]); b.y1 = Math.max(b.y1, q[1]); }); var L = Math.min(b.x1 - b.x0, b.y1 - b.y0) * 0.32, v = (f.vinkel || 0) * Math.PI / 180; ud.push({ x: m[0], y: m[1], ux: Math.cos(v), uy: Math.sin(v), l: L, begge: f.begge }); });
    if (af.length || !geo) return ud;
    // Uden felter fra Statik: rummene under pladerne på etagen
    var spaend = (valg && valg.spaend) || {}, ider = {}; form.plader.forEach(function (p) { if (p.etage === etage) ider[p.id] = 1; });
    geo.rum.forEach(function (r) {
      var s = spaend[r.id]; if (!s || !r.b || !r.daek || !ider[r.daek.elementId]) return;
      var L = Math.min(r.b.x1 - r.b.x0, r.b.y1 - r.b.y0) * 0.32;
      ud.push({ x: (r.b.x0 + r.b.x1) / 2, y: (r.b.y0 + r.b.y1) / 2, ux: s === "ns" ? 0 : 1, uy: s === "ns" ? 1 : 0, l: L, begge: s === "begge" });
    });
    return ud;
  }
  // Etagen med dækket over væggene på etagen «etage» (spændretningen hører til dækket over rummet).
  function daekOver(form, geo, etage) {
    var w = geo && geo.vaegge ? geo.vaegge.filter(function (x) { return x.etage === etage; }) : [];
    if (!w.length) return null;
    var zm = w.reduce(function (s, x) { return s + (x.b.z0 + x.b.z1) / 2; }, 0) / w.length;
    var over = form.plader.filter(function (p) { return !p.terraen && p.z > zm; }).sort(function (a, b) { return a.z - b.z; })[0];
    return over ? over.etage : null;
  }

  /* ---------- Pile: hvor de står, så de rammer bygningen ---------- */
  // Vind: en vandret stråle pr. række og kolonne. Pilen stopper ved den første flade, strålen rammer i den højde.
  function vindPile(form, ret) {
    var R = RETNING[ret], d = R.d, p = [-d[1], d[0]], L = form.pileL, g = form.g, c = g.c, s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity, i, j, ud = [];
    for (j = 0; j < g.ny; j += 2) for (i = 0; i < g.nx; i += 2) { if (!form.fyldt[i + j * g.nx]) continue; var x = g.x0 + (i + 0.5) * c, y = g.y0 + (j + 0.5) * c, ss = x * d[0] + y * d[1], tt = x * p[0] + y * p[1]; if (ss < s0) s0 = ss; if (ss > s1) s1 = ss; if (tt < t0) t0 = tt; if (tt > t1) t1 = tt; }
    var nT = klem(Math.round((t1 - t0) / (L * 1.1)), 3, 14), nZ = klem(Math.round(form.h / (L * 0.95)), 1, 4), gap = c * 1.8;
    for (var a = 0; a < nT; a++) {
      var t = t0 + (a + 0.5) / nT * (t1 - t0);
      for (var r = 0; r < nZ; r++) {
        var z = form.terraen + (r + 0.5) / nZ * form.h, hit = null;
        for (var s = s0 - 3 * c; s <= s1 + 3 * c; s += c * 0.5) { var hx = d[0] * s + p[0] * t, hy = d[1] * s + p[1] * t; if (zPaa(form, hx, hy) >= z) { hit = s; break; } }
        if (hit == null) continue;
        var sx = hit - gap, tx = d[0] * sx + p[0] * t, ty = d[1] * sx + p[1] * t;
        ud.push({ til: [tx, ty, z], fra: [tx - d[0] * L, ty - d[1] * L, z], kolonne: a, raekke: r, t: t, s: hit });
      }
    }
    return { pile: ud, L: L, nZ: nZ, gjennem: false, r: { s0: s0, s1: s1, t0: t0, t1: t1 } };
  }
  function iHul(h, x, y, skr) { var m = skr * 0.35; return iPoly(h, x, y) || iPoly(h, x - m, y) || iPoly(h, x + m, y) || iPoly(h, x, y - m) || iPoly(h, x, y + m); }
  function laengsteVinkel(p) { var m = -1, v = 0; for (var i = 0, n = p.length; i < n; i++) { var q = p[(i + 1) % n], dx = q[0] - p[i][0], dy = q[1] - p[i][1], l = dx * dx + dy * dy; if (l > m) { m = l; v = Math.atan2(dy, dx); } } return v; }
  function gitterIPolygon(poly, skridt, tjek) {
    var v = laengsteVinkel(poly), c = Math.cos(v), s = Math.sin(v), b = nyBoks(), til = function (x, y) { return [x * c - y * s, x * s + y * c]; };
    poly.forEach(function (q) { var r = [q[0] * c + q[1] * s, -q[0] * s + q[1] * c]; b.x0 = Math.min(b.x0, r[0]); b.x1 = Math.max(b.x1, r[0]); b.y0 = Math.min(b.y0, r[1]); b.y1 = Math.max(b.y1, r[1]); });
    var nx = Math.max(1, Math.round((b.x1 - b.x0) / skridt)), ny = Math.max(1, Math.round((b.y1 - b.y0) / skridt)), ud = [], mx = 0.3 * skridt;
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var ru = b.x0 + (i + 0.5) * (b.x1 - b.x0) / nx, rv = b.y0 + (j + 0.5) * (b.y1 - b.y0) / ny, p = til(ru, rv), x = p[0], y = p[1];
      if (!iPoly(poly, x, y)) continue;
      if (!(iPoly(poly, x - mx, y) && iPoly(poly, x + mx, y) && iPoly(poly, x, y - mx) && iPoly(poly, x, y + mx))) continue;
      if (tjek && !tjek(x, y)) continue;
      ud.push([x, y]);
    }
    return ud;
  }
  function snePile(form) {
    var L = form.pileL * 0.8, skr = klem(form.laengde / 8, 1.2, 6), gap = form.g.c * 1.6, ud = [];
    var erTagCelle = function (x, y) { var g = form.g, i = Math.floor((x - g.x0) / g.c), j = Math.floor((y - g.y0) / g.c); return i >= 0 && j >= 0 && i < g.nx && j < g.ny && form.fyldt[i + j * g.nx] && form.slags[i + j * g.nx] === 1; };
    form.omrids.forEach(function (o) {
      gitterIPolygon(o, skr, erTagCelle).forEach(function (q) { var z = zPaa(form, q[0], q[1]); if (!isFinite(z) || z < form.terraen + 0.5) return; ud.push({ til: [q[0], q[1], z + gap], fra: [q[0], q[1], z + gap + L] }); });
    });
    return { pile: ud, L: L, gjennem: false };
  }
  function dækPile(form, liste) {
    var L = Math.min(form.pileL * 0.7, 2.4), skr = klem(form.laengde / 7, 1.4, 6), gap = form.g.c * 1.2, ud = [];
    liste.forEach(function (f) {
      gitterIPolygon(f.polygon, skr, function (x, y) { return !(f.huller || []).some(function (h) { return iHul(h, x, y, skr); }); }).forEach(function (q) { ud.push({ til: [q[0], q[1], f.z + gap], fra: [q[0], q[1], f.z + gap + L], felt: f.id, etage: f.etage }); });
    });
    return { pile: ud, L: L, gjennem: true };
  }
  function pileFor(form, felt, tilf) {
    var t = TILFAELDE.filter(function (x) { return x.id === tilf; })[0]; if (!t) return { pile: [], L: 0 };
    if (t.art === "vind") return vindPile(form, t.ret);
    if (t.art === "sne") return snePile(form);
    if (t.art === "nytte") return dækPile(form, felt.filter(function (f) { return !f.erTag && !f.terraen; }));
    return dækPile(form, felt.filter(function (f) { return !f.terraen; }));
  }

  /* ---------- Teksterne, der står ved pilene ---------- */
  function vaerdiTekst(t, res, etage) {
    if (t.art === "vind") { var v = res.vind[t.ret]; return v && v.wN != null ? "netto " + dk(v.wN) + " kN/m² (tryk " + fortegn(v.wD) + ", sug " + fortegn(v.wE) + ")" : "mangler: " + (v ? v.mangler.join(", ") : ""); }
    if (t.art === "sne") return res.sne.s != null ? "s = " + dk(res.sne.s) + " kN/m²" : "mangler: " + res.sne.mangler.join(", ");
    if (t.art === "nytte") { var n = res.nytte[etage]; return n && n.ialt != null ? "q = " + dk(n.ialt) + " kN/m²" + (n.kat ? " (kat. " + n.kat + ")" : "") : SKAL; }
    var g = etage && res.egen.perEtage ? res.egen.perEtage[etage] : null;
    return g != null ? "g = " + dk(g) + " kN/m²" : SKAL;
  }
  // Etiketter i 3D: én pr. vindretning, sne, og én pr. etage for nyttelast og egenlast, ude ved facaden, så de ikke står oven i hinanden.
  function etiketter3d(form, felt, tilf, res) {
    var t = TILFAELDE.filter(function (x) { return x.id === tilf; })[0], ud = []; if (!t) return ud;
    var B = form.boks, L = form.pileL;
    if (t.art === "vind") {
      var R = RETNING[t.ret], d = R.d, cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2, afst = (d[0] ? (B.x1 - B.x0) / 2 : (B.y1 - B.y0) / 2) + L * 1.25, top = form.zMax + form.laengde * 0.15;
      var tvaers = (d[0] ? (B.y1 - B.y0) / 2 : (B.x1 - B.x0) / 2) + L * 0.55, p = [-d[1], d[0]];
      ud.push({ pos: [cx - d[0] * afst + p[0] * tvaers, cy - d[1] * afst + p[1] * tvaers, top], tekst: "Vind fra " + R.navn, tekst2: vaerdiTekst(t, res) });
    } else if (t.art === "sne") ud.push({ pos: [B.x1 + L * 0.35, B.y1 + L * 0.35, form.zMax + L * 1.55], tekst: "Sne på tag", tekst2: vaerdiTekst(t, res) });
    else {
      var niv = form.niveauer.filter(function (n) { return t.art === "egen" ? true : !n.erTag; });
      niv.forEach(function (n) {
        var fs = felt.filter(function (f) { return f.etage === n.navn && !f.terraen; }); if (!fs.length) return;
        ud.push({ pos: [B.x1 + form.laengde * 0.14, (B.y0 + B.y1) / 2, n.z + 0.9], tekst: (t.art === "nytte" ? "Nyttelast " : "Egenlast ") + n.navn, tekst2: vaerdiTekst(t, res, n.navn) });
      });
    }
    return ud;
  }

  /* ---------- Samlet beregning ---------- */
  function beregn(form, model, ind, felt) {
    var res = { vind: {}, sne: sne(form, ind), nytte: {}, egen: { pr: {}, perEtage: {} }, mangler: [] };
    Object.keys(RETNING).forEach(function (r) { res.vind[r] = vind(form, ind, r); });
    var etager = {}; felt.forEach(function (f) { if (!f.erTag && !f.terraen && f.etage) etager[f.etage] = 1; });
    Object.keys(etager).forEach(function (e) { res.nytte[e] = nytte(ind, e); });
    var typer = {}; felt.forEach(function (f) { if (!f.terraen && f.typeId != null) typer[f.typeId] = 1; });
    Object.keys(typer).forEach(function (id) { res.egen.pr[id] = egen(model, ind, id); });
    var perE = {}; felt.forEach(function (f) { if (f.terraen || f.typeId == null) return; var g = res.egen.pr[f.typeId].g; if (g == null) { perE[f.etage] = null; return; } if (perE[f.etage] === undefined) perE[f.etage] = g; else if (perE[f.etage] != null) perE[f.etage] = Math.max(perE[f.etage], g); });
    res.egen.perEtage = perE;
    return res;
  }

  /* ---------- Tegninger: plan og facade/snit ---------- */
  function pil(x1, y1, x2, y2, farve, fs) {
    var dx = x2 - x1, dy = y2 - y1, L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L, hl = fs * 0.72, hb = fs * 0.36;
    var bx = x2 - ux * hl, by = y2 - uy * hl;
    return "<path d='M" + r2(x1) + " " + r2(y1) + "L" + r2(bx) + " " + r2(by) + "' stroke='" + farve + "' stroke-width='" + r2(fs * 0.17) + "' stroke-linecap='round' fill='none'/>" +
      "<path d='M" + r2(x2) + " " + r2(y2) + "L" + r2(bx - uy * hb) + " " + r2(by + ux * hb) + "L" + r2(bx + uy * hb) + " " + r2(by - ux * hb) + "Z' fill='" + farve + "'/>";
  }
  function dobbeltpil(x, y, ux, uy, L, farve, fs) {
    var hl = fs * 0.5, hb = fs * 0.24, x1 = x - ux * L, y1 = y - uy * L, x2 = x + ux * L, y2 = y + uy * L;
    var hoved = function (px, py, vx, vy) { var bx = px - vx * hl, by = py - vy * hl; return "M" + r2(px) + " " + r2(py) + "L" + r2(bx - vy * hb) + " " + r2(by + vx * hb) + "L" + r2(bx + vy * hb) + " " + r2(by - vx * hb) + "Z"; };
    return "<path d='M" + r2(x1 + ux * hl) + " " + r2(y1 + uy * hl) + "L" + r2(x2 - ux * hl) + " " + r2(y2 - uy * hl) + "' stroke='" + farve + "' stroke-width='" + r2(fs * 0.13) + "' fill='none'/><path d='" + hoved(x2, y2, ux, uy) + hoved(x1, y1, -ux, -uy) + "' fill='" + farve + "'/>";
  }
  function krydsPil(x, y, farve, fs) {
    // Pil, der går ned i tegningen: en cirkel med kryds.
    var r = fs * 0.4, k = r * 0.68;
    return "<circle cx='" + r2(x) + "' cy='" + r2(y) + "' r='" + r2(r) + "' fill='#ffffff' stroke='" + farve + "' stroke-width='" + r2(fs * 0.11) + "'/><path d='M" + r2(x - k) + " " + r2(y - k) + "L" + r2(x + k) + " " + r2(y + k) + "M" + r2(x - k) + " " + r2(y + k) + "L" + r2(x + k) + " " + r2(y - k) + "' stroke='" + farve + "' stroke-width='" + r2(fs * 0.11) + "'/>";
  }
  function tekst(x, y, t, fs, stil) { return "<text x='" + r2(x) + "' y='" + r2(y) + "' font-size='" + r2(fs) + "' text-anchor='" + ((stil && stil.a) || "middle") + "'" + (stil && stil.b ? " font-weight='bold'" : "") + " fill='" + ((stil && stil.f) || "#222222") + "'>" + xml(t) + "</text>"; }
  function polyD(p) { return "M" + p.map(function (q) { return r2(q[0]) + " " + r2(-q[1]); }).join("L") + "Z"; }
  function bredTekst(t, fs) { return String(t).length * fs * 0.5; }
  function svgDok(vb, indhold) { return "<svg xmlns='http://www.w3.org/2000/svg' viewBox='" + r2(vb.x) + " " + r2(vb.y) + " " + r2(vb.w) + " " + r2(vb.h) + "' font-family='Libertinus Serif'>" + indhold + "</svg>"; }
  function papir(vb, maksB, maksH) { return Math.round(Math.min(maksB, maksH * vb.w / vb.h)); }

  function nordpil(x, y, fs) { return "<path d='M" + r2(x) + " " + r2(y) + "L" + r2(x) + " " + r2(y - fs * 2.2) + "M" + r2(x - fs * 0.5) + " " + r2(y - fs * 1.5) + "L" + r2(x) + " " + r2(y - fs * 2.2) + "L" + r2(x + fs * 0.5) + " " + r2(y - fs * 1.5) + "' stroke='#222222' stroke-width='" + r2(fs * 0.14) + "' fill='none' stroke-linecap='round' stroke-linejoin='round'/>" + tekst(x, y + fs * 1.1, "N", fs, { b: true }); }
  function maalestok(x, y, W, fs) { var l = [1, 2, 5, 10, 20, 50, 100].filter(function (v) { return v <= W / 4; }).pop() || 1; return "<path d='M" + r2(x) + " " + r2(y) + "h" + l + "' stroke='#333333' stroke-width='" + r2(fs * 0.25) + "' fill='none'/>" + tekst(x + l + fs * 0.5, y + fs * 0.35, l + " m", fs, { a: "start" }); }
  function trekantFodaftryk(meshes) {
    var op = [], ned = [];
    hvertTrekant(meshes, function (ax, ay, az, bx, by, bz, cx, cy, cz) { var ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az, nz = ux * vy - uy * vx, nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, l = Math.sqrt(nx * nx + ny * ny + nz * nz); if (l < 1e-9) return; var k = nz / l, t = [ax, ay, bx, by, cx, cy]; if (k > 0.5) op.push(t); else if (k < -0.5) ned.push(t); });
    return op.length ? op : ned;
  }
  function triD(t) { return "M" + r2(t[0]) + " " + r2(-t[1]) + "L" + r2(t[2]) + " " + r2(-t[3]) + "L" + r2(t[4]) + " " + r2(-t[5]) + "Z"; }

  // Plan: det virkelige omrids med pile, der rammer det. o.tilf: lasttilfælde. o.etage: etage (nyttelast/egenlast). o.vaegge: [{tri, farve}] (valgfri).
  function planSvg(form, felt, res, o) {
    o = o || {};
    var t = TILFAELDE.filter(function (x) { return x.id === o.tilf; })[0], B = form.boks, W = B.x1 - B.x0, D = B.y1 - B.y0, F = t ? FARVE[t.art] : "#222222";
    var fs = Math.max(0.3, (Math.max(W, D) + 2 * form.pileL) * 0.03);
    var titel = t ? (t.art === "vind" ? "Vind fra " + RETNING[t.ret].navn : t.art === "sne" ? "Sne på tag" : (t.art === "nytte" ? "Nyttelast" : "Egenlast") + (o.etage ? ", " + o.etage : "")) : (o.titel || "");
    var vaerdi = t ? vaerdiTekst(t, res, o.etage) : "";
    var L = form.pileL, xM0 = B.x0, xM1 = B.x1, yM0 = B.y0, yM1 = B.y1, etk = "", pileSvg = "", fyld = "", extra = "";
    var maxLbl = Math.max(bredTekst(titel, fs * 1.05), bredTekst(vaerdi, fs)), lblLuft = fs * 3.4;
    var m = { v: fs * 2.5, h: fs * 2.5, o: fs * 2.5, n: fs * 2.5 };
    var plad = Math.max(0, (maxLbl - W) / 2);
    form.omrids.forEach(function (p) { fyld += "<path d='" + polyD(p) + "' fill='#ffffff' stroke='#222222' stroke-width='" + r2(fs * 0.2) + "' stroke-linejoin='round'/>"; });
    form.huller.forEach(function (p) { fyld += "<path d='" + polyD(p) + "' fill='#eef1f2' stroke='#222222' stroke-width='" + r2(fs * 0.12) + "'/>"; });
    (o.vaegge || []).forEach(function (w) { fyld += "<path d='" + w.tri.map(triD).join("") + "' fill='" + w.farve + "' stroke='" + w.farve + "' stroke-width='0.02'/>"; });
    if (t && t.art === "vind") {
      var A = vindPile(form, t.ret), d = RETNING[t.ret].d, rk = 0, seen = {};
      A.pile.filter(function (a) { return a.raekke === rk; }).forEach(function (a) { seen[a.kolonne] = 1; pileSvg += pil(a.fra[0], -a.fra[1], a.til[0], -a.til[1], F, fs); });
      A.pile.forEach(function (a) { if (!seen[a.kolonne]) { seen[a.kolonne] = 1; pileSvg += pil(a.fra[0], -a.fra[1], a.til[0], -a.til[1], F, fs); } });
      // Teksten står i et bånd øverst. Ved vind fra nord står båndet over pilenes haler, så intet rører hinanden.
      var overPile = d[1] < 0 ? L + fs * 0.9 : 0;
      m.o = Math.max(m.o, overPile + fs * 3.3); m.v = Math.max(m.v, (d[0] > 0 ? L + fs * 1.4 : fs * 2.5), plad + fs); m.h = Math.max(m.h, (d[0] < 0 ? L + fs * 1.4 : fs * 2.5), plad + fs); if (d[1] > 0) m.n = Math.max(m.n, L + fs * 3.6);
      etk += tekst((B.x0 + B.x1) / 2, -B.y1 - overPile - fs * 1.9, titel, fs * 1.05, { b: true }); etk += tekst((B.x0 + B.x1) / 2, -B.y1 - overPile - fs * 0.65, vaerdi, fs);
    } else if (t && t.art === "sne") {
      snePile(form).pile.forEach(function (a) { pileSvg += krydsPil(a.til[0], -a.til[1], F, fs); });
      m.o = lblLuft + fs; m.v = Math.max(m.v, plad + fs); m.h = Math.max(m.h, plad + fs);
      etk += tekst((B.x0 + B.x1) / 2, -B.y1 - lblLuft * 0.72, titel, fs * 1.05, { b: true }); etk += tekst((B.x0 + B.x1) / 2, -B.y1 - lblLuft * 0.32, vaerdi + "  ⊗ last nedad", fs);
    } else if (t) {
      var liste = felt.filter(function (f) { return f.etage === o.etage && !f.terraen && (t.art === "egen" || !f.erTag); });
      liste.forEach(function (f) { extra += "<path d='" + polyD(f.polygon) + (f.huller || []).map(polyD).join("") + "' fill-rule='evenodd' fill='" + F + "' fill-opacity='0.08' stroke='" + F + "' stroke-width='" + r2(fs * 0.1) + "'/>"; });
      dækPile(form, liste).pile.forEach(function (a) { pileSvg += krydsPil(a.til[0], -a.til[1], F, fs); });
      m.o = lblLuft + fs; m.v = Math.max(m.v, plad + fs); m.h = Math.max(m.h, plad + fs);
      etk += tekst((B.x0 + B.x1) / 2, -B.y1 - lblLuft * 0.72, titel, fs * 1.05, { b: true }); etk += tekst((B.x0 + B.x1) / 2, -B.y1 - lblLuft * 0.32, vaerdi + "  ⊗ last nedad", fs);
      if (!liste.length) etk += tekst((B.x0 + B.x1) / 2, -(B.y0 + B.y1) / 2, "Ingen dæk på denne etage", fs, { f: "#777777" });
    }
    if (o.spaend) o.spaend.forEach(function (s) { extra += dobbeltpil(s.x, -s.y, s.ux, -s.uy, s.l, "#1a1a1a", fs); if (s.begge) extra += dobbeltpil(s.x, -s.y, -s.uy, -s.ux, s.l, "#1a1a1a", fs); });
    var vb = { x: B.x0 - m.v, y: -B.y1 - m.o, w: W + m.v + m.h, h: D + m.o + m.n };
    var nx = vb.x + vb.w - fs * 1.2, ny = vb.y + fs * 2.8;
    // Nordpil i hjørnet (skæres ikke af pile: pilene står inden for bygningens bredde) og målestok nederst.
    var ind = fyld + extra + pileSvg + etk + nordpil(nx, ny, fs) + maalestok(vb.x + fs * 0.8, vb.y + vb.h - fs * 1.1, W, fs * 0.85);
    return { svg: svgDok(vb, ind), w: vb.w, h: vb.h, bredde: papir(vb, 150, o.maksH || 115), fs: fs, titel: titel };
  }

  // Facade/snit set på tværs af lasten: bygningens silhuet med etager og pile, der rammer den.
  function facadeSvg(form, felt, res, o) {
    o = o || {};
    var t = TILFAELDE.filter(function (x) { return x.id === o.tilf; })[0]; if (!t) return null;
    var F = FARVE[t.art], erVind = t.art === "vind", d = erVind ? RETNING[t.ret].d : [1, 0], s = silhuet(form, d[0], d[1]);
    var terr = form.terraen, H = form.h, W = s.dybde, fs = Math.max(0.3, (W + 2 * form.pileL) * 0.033), L = form.pileL;
    var titel = erVind ? "Vind fra " + RETNING[t.ret].navn : t.art === "sne" ? "Sne på tag" : t.art === "nytte" ? "Nyttelast på dæk" : "Egenlast";
    var vaerdi = t.art === "vind" || t.art === "sne" ? vaerdiTekst(t, res) : "";
    var setFra = erVind ? "Set fra " + RETNING[t.ret].setFra : "Set fra syd", u0 = s.u0, u1 = s.u1 + s.c;
    var prof = profilPunkter(s, terr), ind = "";
    var pkt = prof.map(function (q) { return r2(q[0]) + " " + r2(-q[1]); }).join("L");
    var sil = "<path d='M" + pkt + "Z' fill='#f3f4f5' stroke='#222222' stroke-width='" + r2(fs * 0.2) + "' stroke-linejoin='round'/>";
    var niv = form.niveauer.map(function (n) { var u; var a = Infinity, b = -Infinity; for (u = 0; u < s.n; u++) if (s.z[u] >= n.z - 0.1) { var w = s.u0 + u * s.c; if (w < a) a = w; if (w > b) b = w; } return { n: n, a: a, b: b }; }).filter(function (x) { return isFinite(x.a); });
    var etage = niv.map(function (x) { return "<path d='M" + r2(x.a) + " " + r2(-x.n.z) + "L" + r2(x.b) + " " + r2(-x.n.z) + "' stroke='#7a8388' stroke-width='" + r2(fs * 0.1) + "' stroke-dasharray='" + r2(fs * 0.4) + " " + r2(fs * 0.3) + "'/>"; }).join("");
    // Etagenavne står i højre side, væk fra vindpilene; de rykkes, hvis to etager er for tæt på hinanden.
    var ny = -Infinity, etTekst = "";
    niv.slice().sort(function (a, b) { return a.n.z - b.n.z; }).forEach(function (x) { var y = Math.max(ny + fs * 1.05, x.n.z); ny = y; etTekst += tekst(u1 + fs * 0.7, -y - fs * 0.22, x.n.navn, fs * 0.82, { a: "start", f: "#555555" }); });
    var maxEt = niv.reduce(function (m2, x) { return Math.max(m2, bredTekst(x.n.navn, fs * 0.82)); }, 0);
    var pileSvg = "", m = { v: fs * 1.5, h: fs * 2 + maxEt, o: fs * 3.2, n: fs * 3 };
    var tTop = -form.zMax - fs * 1.1, tL = fs * 1.25;
    if (erVind) {
      var nZ = klem(Math.round(H / (L * 0.8)), 2, 5), gap = s.c * 2.2;
      for (var r = 0; r < nZ; r++) {
        var z = terr + (r + 0.5) / nZ * H, hit = null;
        for (var i = 0; i < s.n; i++) if (s.z[i] >= z) { hit = s.u0 + i * s.c; break; }
        if (hit == null) continue;
        pileSvg += pil(hit - gap - L, -z, hit - gap, -z, F, fs);
      }
      m.v = L + fs * 2;
      ind += tekst((u0 + u1) / 2, tTop - tL, titel, fs * 1.05, { b: true }) + tekst((u0 + u1) / 2, tTop, vaerdi, fs);
      m.o = -tTop + tL + fs - form.zMax + fs * 1.2;
    } else if (t.art === "sne") {
      var skr = klem(W / 8, 1.4, 6), ant = Math.max(2, Math.round(W / skr)), gv = s.c * 2;
      for (var a = 0; a < ant; a++) { var u = u0 + (a + 0.5) / ant * W, zt = hoejdeVed(s, u); if (!isFinite(zt)) continue; pileSvg += pil(u, -(zt + gv + L * 0.8), u, -(zt + gv), F, fs); }
      ind += tekst((u0 + u1) / 2, -form.zMax - L * 0.8 - fs * 1.6, titel, fs * 1.05, { b: true }) + tekst((u0 + u1) / 2, -form.zMax - L * 0.8 - fs * 0.4, vaerdi, fs);
      m.o = L * 0.8 + fs * 3.4;
    } else {
      var lstr = felt.filter(function (f) { return !f.terraen && (t.art === "egen" || !f.erTag); }), hojestTop = form.zMax;
      var gruppe = {}; lstr.forEach(function (f) { (gruppe[f.etage] || (gruppe[f.etage] = [])).push(f); });
      Object.keys(gruppe).forEach(function (e) {
        var fs2 = gruppe[e], a = Infinity, b = -Infinity, z = 0; fs2.forEach(function (f) { f.polygon.forEach(function (q) { var v = q[0] * d[0] + q[1] * d[1]; a = Math.min(a, v); b = Math.max(b, v); }); z = Math.max(z, f.z); });
        var Lk = Math.min(L * 0.55, 1.6), ant = Math.max(2, Math.round((b - a) / klem(W / 8, 1.4, 6))), gv = s.c * 1.5;
        for (var i2 = 0; i2 < ant; i2++) { var u2 = a + (i2 + 0.5) / ant * (b - a); pileSvg += pil(u2, -(z + gv + Lk), u2, -(z + gv), F, fs * 0.8); }
        var etLbl = vaerdiTekst(t, res, e);
        if (t.art === "egen" && fs2.some(function (f) { return f.erTag; })) etLbl = etLbl;
        ind += tekst(a + fs * 0.3, -(z + gv + Lk + fs * 0.45), etLbl, fs * 0.85, { a: "start", f: F, b: true });
        hojestTop = Math.max(hojestTop, z + gv + Lk + fs * 1.3);
      });
      ind += tekst((u0 + u1) / 2, -hojestTop - fs * 0.55, titel, fs * 1.05, { b: true });
      m.o = hojestTop - form.zMax + fs * 2;
    }
    var jord = "<path d='M" + r2(u0 - m.v * 0.9) + " " + r2(-terr) + "L" + r2(u1 + m.h * 0.7) + " " + r2(-terr) + "' stroke='#222222' stroke-width='" + r2(fs * 0.22) + "'/>";
    var vb = { x: u0 - m.v, y: -form.zMax - m.o, w: W + m.v + m.h, h: H + m.o + m.n };
    var bund = tekst(u0, -terr + fs * 1.5, setFra, fs * 0.85, { a: "start", f: "#555555" }) + tekst(u1, -terr + fs * 1.5, "h = " + dk(H, 1) + " m  ·  d = " + dk(W, 1) + " m", fs * 0.85, { a: "end", f: "#555555" });
    return { svg: svgDok(vb, sil + etage + pileSvg + jord + ind + etTekst + bund), w: vb.w, h: vb.h, bredde: papir(vb, 150, o.maksH || 80), fs: fs, titel: titel };
  }

  /* ---------- Bærende system i planen ---------- */
  function vaeggeSomTrekanter(model, etage, farver) {
    return ((model.elements || []).filter(function (e) { return e && !e.erRum && e.category === "Vægge" && e.level === etage && e.meshes; })).map(function (e) { return { id: e.id, tri: trekantFodaftryk(e.meshes), farve: (farver && farver[e.id]) || "#c3cdcf" }; }).filter(function (w) { return w.tri.length; });
  }

  return {
    SKAL: SKAL, K: K, TERRAEN: TERRAEN, TOPOGRAFI: TOPOGRAFI, NYTTE: NYTTE, RETNING: RETNING, TILFAELDE: TILFAELDE, FARVE: FARVE,
    standard: standard, flet: flet, bygningsform: bygningsform, zPaa: zPaa, silhuet: silhuet, vindAreal: vindAreal,
    vind: vind, sne: sne, nytte: nytte, egen: egen, beregn: beregn, cpe: cpe, mu1: mu1, forslagGamma: forslagGamma,
    felter: felter, spaendmaerker: spaendmaerker, daekOver: daekOver, pileFor: pileFor, vindPile: vindPile, snePile: snePile, etiketter3d: etiketter3d, vaerdiTekst: vaerdiTekst,
    planSvg: planSvg, facadeSvg: facadeSvg, vaeggeSomTrekanter: vaeggeSomTrekanter, dk: dk, polyMidte: polyMidte, iPoly: iPoly
  };
});
