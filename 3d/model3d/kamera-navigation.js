/* Kamera og navigation i ISSANA 3D: virker uanset bygningens størrelse, form og placering.

   Rullehjulet zoomer mod det, markøren peger på (stråle mod modellen, ellers et plan), near/far følger kameraet
   ved hver tegning, gitteret følger udsnittet, og tilpasningen lader sig ikke ødelægge af et enkelt element langt væk.
   Ændrer aldrig modellens koordinater. Regnestykkerne herunder kender hverken three.js eller DOM og testes direkte
   (tests/web-model3d/kamera-navigation.test.mjs); installer() er den tynde kobling til visningen. Enheder: meter. */
(function (rod) {
  "use strict";

  var MIN_AFSTAND = 0.3;       // m: så tæt på en flade stopper zoomen, og næste hak går igennem fladen
  var NEAR_MIN = 0.02;         // m: near går aldrig under dette (dybdebufferen)
  var ZOOM_PR_ENHED = 0.0016;  // zoomfaktor pr. wheel-enhed: ét hak (120) ≈ 17 % tættere
  var MAX_HJUL = 600;          // et enkelt hop afgrænses, så en hurtig touchpad ikke kaster kameraet væk
  var GENBRUG_MS = 400;        // samme anker bruges, mens hjulet kører på samme sted (strålen koster på store modeller)
  var DOBBELT_MS = 600;        // så kort mellem to tryk tæller som ét dobbeltklik (Windows bruger højst 500 ms som standard)

  /* ---------- Vektorer som [x,y,z] ---------- */
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function vec(v) { return [v.x, v.y, v.z]; }
  function klem(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------- Hvad tæller med i tilpasningen ----------
     b er [minX,minY,minZ,maxX,maxY,maxZ, ...] pr. element. Ét vildfarent element eller en kæmpelinje langt væk må ikke
     afgøre udsnittet, men to rigtige bygninger langt fra hinanden skal begge med: kun FÅ elementer kan udelades
     (højst 2 % eller 3 stk.), og kun når de ligger langt fra resten. Under 20 elementer udelades intet. */
  function robustBoks(b) {
    var n = Math.floor(b.length / 6);
    if (!n) return null;
    var aktiv = new Uint8Array(n);
    for (var a0 = 0; a0 < n; a0++) aktiv[a0] = 1;
    var maxFaa = n >= 20 ? Math.max(3, Math.floor(n * 0.02)) : 0;
    var maxI = function (i, a) { return b[i * 6 + 3 + a]; };
    var minI = function (i, a) { return b[i * 6 + a]; };
    function aktive() { var l = []; for (var i = 0; i < n; i++) if (aktiv[i]) l.push(i); return l; }

    function fjernKaempe(a) {
      var l = aktive(); if (l.length < 2) return;
      var midter = l.map(function (i) { return (minI(i, a) + maxI(i, a)) / 2; }).sort(function (x, y) { return x - y; });
      var spredning = midter[Math.floor(midter.length * 0.98)] - midter[Math.floor(midter.length * 0.02)];
      var graense = Math.max(200, 4 * spredning);
      var kaempe = l.filter(function (i) { return maxI(i, a) - minI(i, a) > graense; });
      if (kaempe.length && kaempe.length <= maxFaa) kaempe.forEach(function (i) { aktiv[i] = 0; });
    }
    function fjernFjerne(a) {
      var l = aktive().sort(function (x, y) { return minI(x, a) - minI(y, a); });
      if (l.length < 2) return;
      var klynger = [], k = null;
      l.forEach(function (i) {
        if (!k || minI(i, a) > k.hi + 1) { k = { lo: minI(i, a), hi: maxI(i, a), idx: [i] }; klynger.push(k); }
        else { k.idx.push(i); if (maxI(i, a) > k.hi) k.hi = maxI(i, a); }
      });
      if (klynger.length < 2) return;
      var stoerst = 0;
      klynger.forEach(function (c, j) { if (c.idx.length > klynger[stoerst].idx.length) stoerst = j; });
      var lo = klynger[stoerst].lo, hi = klynger[stoerst].hi;
      function vurder(c, gab) {
        if (c.idx.length <= maxFaa && gab >= Math.max(3 * (hi - lo), 200)) { c.idx.forEach(function (i) { aktiv[i] = 0; }); return false; }
        return true;
      }
      for (var j = stoerst - 1; j >= 0; j--) if (vurder(klynger[j], lo - klynger[j].hi)) { lo = Math.min(lo, klynger[j].lo); hi = Math.max(hi, klynger[j].hi); }
      for (var m = stoerst + 1; m < klynger.length; m++) if (vurder(klynger[m], klynger[m].lo - hi)) { lo = Math.min(lo, klynger[m].lo); hi = Math.max(hi, klynger[m].hi); }
    }

    if (maxFaa) for (var a = 0; a < 3; a++) { fjernKaempe(a); fjernFjerne(a); }
    var ude = []; for (var u = 0; u < n; u++) if (!aktiv[u]) ude.push(u);
    if (ude.length > n * 0.1) { ude = []; for (var v = 0; v < n; v++) aktiv[v] = 1; }   // for meget at udelade: så er det en del af modellen

    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < n; i++) if (aktiv[i]) for (var ax = 0; ax < 3; ax++) { if (minI(i, ax) < mn[ax]) mn[ax] = minI(i, ax); if (maxI(i, ax) > mx[ax]) mx[ax] = maxI(i, ax); }
    return { min: mn, max: mx, udeladt: ude };
  }

  /* ---------- near og far ----------
     Afstand fra kameraet til det nærmeste og fjerneste af de synlige bokse (0 inde i en boks). near = halvdelen af det
     nærmeste, så intet klippes væk, selv i billedets hjørner, hvor dybden er kortere end afstanden. */
  function afstandeTilBokse(C, b, meshes, ekstra) {
    var dMin = Infinity, dMax = 0;
    function maal(a0, a1, a2, a3, a4, a5) {
      var dx = Math.max(a0 - C[0], 0, C[0] - a3), dy = Math.max(a1 - C[1], 0, C[1] - a4), dz = Math.max(a2 - C[2], 0, C[2] - a5);
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d < dMin) dMin = d;
      var fx = Math.max(Math.abs(C[0] - a0), Math.abs(C[0] - a3)), fy = Math.max(Math.abs(C[1] - a1), Math.abs(C[1] - a4)), fz = Math.max(Math.abs(C[2] - a2), Math.abs(C[2] - a5));
      var D = Math.sqrt(fx * fx + fy * fy + fz * fz); if (D > dMax) dMax = D;
    }
    var n = b ? Math.floor(b.length / 6) : 0;
    for (var i = 0; i < n; i++) { if (meshes && meshes[i] && !meshes[i].visible) continue; var k = i * 6; maal(b[k], b[k + 1], b[k + 2], b[k + 3], b[k + 4], b[k + 5]); }
    var e = ekstra || [];
    for (var j = 0; j + 5 < e.length; j += 6) maal(e[j], e[j + 1], e[j + 2], e[j + 3], e[j + 4], e[j + 5]);
    return { min: dMin, max: dMax };
  }
  function nearFar(dMin, dMax) {
    if (!isFinite(dMin)) return { near: 0.1, far: 10000 };   // intet synligt
    var near = Math.max(NEAR_MIN, dMin * 0.5);
    return { near: near, far: Math.max(dMax * 1.05 + near, near * 20) };
  }

  /* ---------- Gitter: maskestørrelse efter afstand (0,1/1/10/100 m); 200 masker, så kanten er langt ude af syne ---------- */
  function gitterMaske(afstand) { return Math.pow(10, Math.round(Math.log10(Math.max(afstand, 0.5) / 20))); }

  /* ---------- Skyggen følger udsnittet ----------
     Tæt på er zonen lille (skarp skygge på den bygning, man ser på), langt væk dækker den hele modellen som før. */
  function skyggeZone(T, c, afstand, Emax) {
    var e = Math.min(Math.max(afstand * 3, 15), Emax);
    var t = klem((e / Emax - 0.5) * 2, 0, 1);
    return { e: e, fokus: add(T, mul(sub(c, T), t)) };
  }

  /* ---------- Zoom mod et punkt ----------
     C' = A + (C-A)·s bevarer punktet under markøren. Målet lægges på synsaksen i ankerets dybde, så orbit og panorering
     passer til det, man ser på, uden at kameraet drejer. Tæt på en flade går næste hak igennem den i stedet for at gå i stå. */
  function zoomTrin(C, A, f, s, ramt) {
    var d = len(sub(C, A));
    if (s < 1 && ramt && d * s < MIN_AFSTAND) {
      var C1 = add(C, mul(norm(sub(A, C)), d + MIN_AFSTAND * 1.5));
      return { C: C1, T: add(C1, mul(f, 1)), gennem: true };
    }
    var C2 = add(A, mul(sub(C, A), s));
    var dybde = Math.max(dot(sub(A, C2), f), MIN_AFSTAND);
    return { C: C2, T: add(C2, mul(f, dybde)), gennem: false };
  }
  function hjulFaktor(e) {
    var dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 100 : 1);
    return Math.exp(klem(dy, -MAX_HJUL, MAX_HJUL) * ZOOM_PR_ENHED);
  }

  /* Rammer strålen ingenting: jordplanet, hvis det ligger inden for rimelig afstand, ellers et plan gennem målet på tværs af synsaksen. */
  function faldbakPunkt(o, r, T, f, jordZ, minDybde) {
    var dybde = Math.max(dot(sub(T, o), f), minDybde);
    var cosV = dot(r, f);
    var t = dybde / (cosV > 1e-6 ? cosV : 1e-6);
    if (jordZ != null && Math.abs(r[2]) > 1e-6) {
      var tj = (jordZ - o[2]) / r[2];
      if (tj > 0 && tj < 3 * t) t = tj;
    }
    return add(o, mul(r, t));
  }

  /* Rammer strålen ikke, men går tæt forbi et element (fx et lille element langt væk, der fylder mindre end en pixel): punktet på
     strålen i elementets dybde, så det bliver under markøren, mens man zoomer ind på det. tolRad er tolerancen som vinkel. */
  function naerAnker(C, r, f, b, meshes, tolRad) {
    var n = b ? Math.floor(b.length / 6) : 0, bedst = null, bedstS = Infinity;
    for (var i = 0; i < n; i++) {
      if (meshes && meshes[i] && !meshes[i].visible) continue;
      var k = i * 6, m = [(b[k] + b[k + 3]) / 2, (b[k + 1] + b[k + 4]) / 2, (b[k + 2] + b[k + 5]) / 2], v = sub(m, C), dybde = dot(v, f);
      if (dybde <= 0) continue;
      var p = add(C, mul(r, dot(v, r)));   // strålens nærmeste punkt ved elementets midte; afstand derfra til boksen (0 inde i den)
      var dx = Math.max(b[k] - p[0], 0, p[0] - b[k + 3]), dy = Math.max(b[k + 1] - p[1], 0, p[1] - b[k + 4]), dz = Math.max(b[k + 2] - p[2], 0, p[2] - b[k + 5]);
      var fri = Math.sqrt(dx * dx + dy * dy + dz * dz), tilladt = dybde * tolRad;
      if (fri > tilladt) continue;
      var s = fri / tilladt + dybde * 1e-9;
      if (s < bedstS) { bedstS = s; bedst = add(C, mul(r, dybde / dot(r, f))); }
    }
    return bedst;
  }

  /* ---------- Koblingen til visningen ----------
     o: camera, controls, dom, gitter(), ram(e) → {point, object}|null, straale(e) → {origin:{x,y,z}, direction:{x,y,z}},
        bokse(), meshes(), ekstraBokse(), helBoks() → {center:[..], diag}, jordZ(), frit(), valgte(), flyv(pos,mål), afbrydFlyvning(), render(). */
  function installer(o) {
    var kamera = o.camera, ctl = o.controls, dom = o.dom;
    var anker = null;        // sidste anker på modellen: {x,y,t,A}
    var valgtVedTryk = [], sidsteTryk = -1e9;
    var nu = o.nu || function () { return (rod.performance && rod.performance.now) ? rod.performance.now() : Date.now(); };

    function synsaks(C) { var f = sub(vec(ctl.target), C); return len(f) > 1e-9 ? norm(f) : [0, 1, 0]; }
    function minDybde() { var h = o.helBoks && o.helBoks(); return Math.max(h ? h.diag * 0.05 : 1, 1); }

    // Punktet under markøren: modellen, ellers et plan. Svaret genbruges, mens hjulet kører på samme sted.
    function findAnker(e, C, T, f) {
      var t = nu();
      if (anker && t - anker.t < GENBRUG_MS && Math.abs(anker.x - e.clientX) + Math.abs(anker.y - e.clientY) < 3) { anker.t = t; return anker; }
      var hit = o.ram(e);
      if (hit) { anker = { x: e.clientX, y: e.clientY, t: t, A: vec(hit.point), ramt: true }; return anker; }
      anker = null;
      var s = o.straale(e), r = vec(s.direction), tolRad = 2 * Math.tan((kamera.fov || 50) * Math.PI / 360) / (dom.clientHeight || 600) * 14;
      var naer = naerAnker(vec(s.origin), r, f, o.bokse ? o.bokse() : null, o.meshes ? o.meshes() : null, tolRad);
      return { A: naer || faldbakPunkt(vec(s.origin), r, T, f, o.jordZ ? o.jordZ() : null, minDybde()), ramt: false, naer: !!naer };
    }

    function saetKamera(C, T) {
      kamera.position.set(C[0], C[1], C[2]); ctl.target.set(T[0], T[1], T[2]);
      ctl.update(); o.render();
    }

    function hjul(e) {
      if (ctl.enabled === false) return;           // gizmo eller måling har musen
      e.preventDefault(); e.stopImmediatePropagation();
      if (o.afbrydFlyvning) o.afbrydFlyvning();
      var s = hjulFaktor(e); if (s === 1) return;
      var C = vec(kamera.position), T = vec(ctl.target), f = synsaks(C);
      var a = findAnker(e, C, T, f);
      var r = zoomTrin(C, a.A, f, s, a.ramt);
      var h = o.helBoks && o.helBoks();
      if (h && s > 1 && len(sub(r.C, h.center)) > Math.max(h.diag * 6, 1000)) return;
      if (r.gennem) anker = null;
      saetKamera(r.C, r.T);
    }

    // Panorering og midterknap-zoom følger det punkt, man griber i: målet flyttes til den dybde (uden at kameraet rører sig).
    function grebSetDybde(e) {
      var C = vec(kamera.position), f = synsaks(C);
      var hit = o.ram(e);
      if (hit) { var d = dot(sub(vec(hit.point), C), f); if (d > 0.05) { var T = add(C, mul(f, d)); ctl.target.set(T[0], T[1], T[2]); ctl.update(); } }
    }
    function ned(e) {
      anker = null;
      var t = nu();
      if (t - sidsteTryk > DOBBELT_MS) valgtVedTryk = o.valgte ? o.valgte() : [];
      sidsteTryk = t;
      if (ctl.enabled === false) return;
      if (e.button === 1 || e.button === 2 || (e.button === 0 && (e.ctrlKey || e.metaKey || e.shiftKey))) grebSetDybde(e);
    }

    // Dobbeltklik centrerer på punktet (og kommer tættere på, hvis elementet er lille i forhold til afstanden).
    // Et element, der allerede var valgt, åbner stadig Opbygning (arbejdsrum-layout.js lytter på dblclick).
    function dobbeltklik(e) {
      if (o.frit && !o.frit()) return;
      var hit = o.ram(e), idx = hit && hit.object && hit.object.userData ? hit.object.userData.elIndex : -1;
      if (hit && valgtVedTryk.indexOf(idx) >= 0) return;
      e.stopImmediatePropagation();
      var C = vec(kamera.position), T = vec(ctl.target), f = synsaks(C), P, nyDybde;
      if (hit) {
        P = vec(hit.point);
        var d = dot(sub(P, C), f), box = hit.object.geometry && hit.object.geometry.boundingBox;
        var rad = box ? Math.max(len(sub(vec(box.max), vec(box.min))) / 2, 1) : 1;
        nyDybde = d > 3 * rad ? Math.max(3 * rad, d * 0.5) : d;
      } else {
        var a = findAnker(e, C, T, f); anker = null; P = a.A;
        var dd = dot(sub(P, C), f);
        nyDybde = Math.max(a.naer ? dd * 0.5 : dd, 0.5);   // tæt på et lille element: kom tættere på
      }
      o.flyv(sub(P, mul(f, nyDybde)), P);
    }

    // Lytterne ligger i capture-fasen, så de kommer før OrbitControls' og arbejdsrummets på samme canvas.
    dom.addEventListener("wheel", hjul, { passive: false, capture: true });
    dom.addEventListener("pointerdown", ned, true);
    dom.addEventListener("dblclick", dobbeltklik, true);

    /* near, far og gitter ved hver tegning */
    function foerRender() {
      var C = vec(kamera.position);
      var ekstra = o.ekstraBokse ? o.ekstraBokse() : [];
      var g = o.gitter ? o.gitter() : null;
      if (g && g.visible) {
        var afst = len(sub(C, vec(ctl.target))), m = gitterMaske(afst), trin = m * 10;
        g.scale.setScalar(m);
        g.position.set(Math.round(ctl.target.x / trin) * trin, Math.round(ctl.target.y / trin) * trin, o.jordZ ? o.jordZ() - 0.01 : 0);
        ekstra = ekstra.concat([g.position.x - 100 * m, g.position.y - 100 * m, g.position.z, g.position.x + 100 * m, g.position.y + 100 * m, g.position.z]);
      }
      var d = afstandeTilBokse(C, o.bokse ? o.bokse() : null, o.meshes ? o.meshes() : null, ekstra);
      var nf = nearFar(d.min, d.max);
      kamera.near = nf.near; kamera.far = nf.far;
      kamera.updateProjectionMatrix();
    }
    return { foerRender: foerRender };
  }

  var api = {
    MIN_AFSTAND: MIN_AFSTAND, NEAR_MIN: NEAR_MIN,
    robustBoks: robustBoks, afstandeTilBokse: afstandeTilBokse, nearFar: nearFar, gitterMaske: gitterMaske, skyggeZone: skyggeZone,
    zoomTrin: zoomTrin, hjulFaktor: hjulFaktor, faldbakPunkt: faldbakPunkt, naerAnker: naerAnker, installer: installer
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (rod) rod.IssanaKameraNavigation = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
