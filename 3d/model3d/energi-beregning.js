/* ISSANA 3D: forhåndsberegning af energiramme og transmissionstab. Rent modul uden DOM.
   Browser: window.IssanaEnergiBeregning. Node: module.exports.

   Det er en månedsbaseret forhåndsberegning efter samme princip som Be18 (DS/EN ISO 13790, månedsmetoden), til at sammenligne
   løsninger undervejs. Den er IKKE en Be18-beregning og kan ikke bruges som dokumentation over for myndighederne; dokumentationen
   laves i Energy Design/Be18 med XML-eksporten. Sommerkomfort kræver en timeberegning og regnes derfor ikke her.

   Afvigelser fra Be18, som er kendte:
   - Solindfald: PVGIS-SARAH3, København, gennemsnit 2005-2023. Be18 bruger det danske referenceår, som ikke er offentligt som månedstabel.
   - Skygger: forenklet model (solbane midt på måneden for direkte sol, himmelkig for diffus sol).
   - Overtemperatur: forenklet månedsbalance ved 25 °C, se overtemperatur().
   Testen energi-beregning.test.mjs holder tallene op mod syv kørsler i Energy Design. */
(function (root, fabrik) {
  var api = fabrik();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else root.IssanaEnergiBeregning = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DAGE = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var TIMER = DAGE.map(function (d) { return d * 24; });
  var MAANED = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
  // Månedligt solindfald i kWh/m². PVGIS 5.3, PVGIS-SARAH3, 2005-2023, 55,68° N 12,57° Ø. Lodrette flader pr. retning og vandret.
  var SOL = {
    N: [4.6, 8.5, 17.5, 27.3, 41.5, 51.1, 47.5, 33.9, 21.4, 12.3, 5.6, 3.4],
    NO: [4.6, 9.9, 25.0, 46.0, 62.6, 71.6, 68.5, 52.6, 33.0, 15.5, 5.8, 3.4],
    O: [11.4, 23.5, 50.7, 80.4, 94.7, 99.6, 97.6, 84.8, 61.4, 34.7, 13.7, 7.8],
    SO: [27.3, 43.6, 78.5, 107.3, 110.7, 107.2, 107.6, 103.7, 89.0, 60.4, 29.7, 20.2],
    S: [35.8, 54.5, 95.4, 114.9, 110.6, 100.9, 103.4, 105.5, 100.1, 74.7, 38.4, 26.1],
    SV: [27.0, 41.9, 81.9, 108.4, 115.4, 109.4, 109.7, 103.7, 87.2, 59.6, 29.3, 19.4],
    V: [11.0, 21.8, 52.9, 83.3, 103.0, 106.0, 102.3, 85.8, 61.6, 34.3, 13.5, 7.4],
    NV: [4.6, 9.4, 26.2, 48.2, 69.2, 78.1, 73.4, 55.9, 33.5, 15.6, 5.8, 3.4],
    H: [15.0, 31.3, 76.3, 129.6, 167.4, 177.6, 170.6, 137.7, 92.7, 48.3, 18.4, 10.3]
  };
  var RET = ["N", "NO", "O", "SO", "S", "SV", "V", "NV"];
  // Diffus andel af solen på vandret flade (dansk klima, typiske månedsværdier). Bruges kun til at dele solen, før skyggerne lægges på.
  var DIFFUS = [0.78, 0.7, 0.6, 0.52, 0.5, 0.5, 0.5, 0.52, 0.56, 0.66, 0.76, 0.82];
  var TEMP_STANDARD = [1.3, 1.1, 3.1, 7.4, 12.1, 15.5, 18.5, 18, 14.4, 9.7, 5.9, 2.3];
  var BREDDE = 55.68;
  // BR18: primærenergifaktorer og krav. Bolig og hotel bruger samme ramme (§ 259).
  var FAKTOR = { fjernvarme: 0.85, el: 1.9, fjernvarme2020: 0.6, el2020: 1.8 };
  var COP_KOEL = 2.5;
  // Afstemt mod syv kørsler i Energy Design på ét projekt: med hele horisontvinklen tog skyggen for meget sol (3 kWh/m² for højt).
  // Summen rammer inden for 1 kWh/m², men Be18 har mere overtemperatur og mindre varme end her. Fordelingen er derfor usikker.
  var HORISONT_VAEGT = 0.5;
  var RAD = Math.PI / 180;

  function rund(x, d) { var f = Math.pow(10, d == null ? 1 : d), r = Math.round(x * f) / f; return r === 0 ? 0 : r; }
  function klem(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function retning(o, rotation) {
    var g;
    if (typeof o === "number") g = o;
    else { var s = String(o).trim().toLowerCase(); g = { n: 0, "ø": 90, o: 90, s: 180, v: 270 }[s]; if (g == null) { var t = Number(s); g = isFinite(t) ? t : 0; } }
    return ((g + (rotation || 0)) % 360 + 360) % 360;
  }
  function retningNavn(g) { return ["Nord", "Nordøst", "Øst", "Sydøst", "Syd", "Sydvest", "Vest", "Nordvest"][Math.round(g / 45) % 8]; }
  function solLodret(az, m) {
    var i = az / 45, a = Math.floor(i) % 8, b = (a + 1) % 8, t = i - Math.floor(i);
    return SOL[RET[a]][m] * (1 - t) + SOL[RET[b]][m] * t;
  }
  // Skrå flade (solceller): vægtet mellem vandret og lodret. Giver 15° syd inden for 3 % af PVGIS' direkte tal.
  function solSkraa(az, haeldning, m) {
    var s = haeldning * RAD;
    return SOL.H[m] * Math.pow(Math.cos(s / 2), 2) * Math.cos(s) + solLodret(az, m) * Math.sin(s) + SOL.H[m] * Math.sin(s) * Math.pow(Math.cos(s / 2), 2) * 0.4;
  }

  /* ---------- Skygger ---------- */
  var DAG_I_AAR = [15, 46, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344];
  function solbane(m) {
    var dek = 23.45 * Math.sin(RAD * 360 * (284 + DAG_I_AAR[m]) / 365), ud = [], phi = BREDDE * RAD, d = dek * RAD;
    for (var t = 0.5; t < 24; t += 1) {
      var om = 15 * (t - 12) * RAD, sinH = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(om);
      if (sinH <= 0.02) continue;
      var h = Math.asin(sinH), cosAz = (Math.sin(d) - sinH * Math.sin(phi)) / (Math.cos(h) * Math.cos(phi));
      var az = Math.acos(klem(cosAz, -1, 1)) / RAD; if (om > 0) az = 360 - az;
      ud.push({ h: h / RAD, az: az, vaegt: Math.exp(-0.2 / sinH) });
    }
    return ud;
  }
  var BANER = MAANED.map(function (x, m) { return solbane(m); });
  // Andel af den direkte sol, der når vinduet: horisont, udhæng og sidefinner som vinkler set fra vinduets midte.
  function direkteAndel(az, s, m) {
    var ialt = 0, fri = 0;
    BANER[m].forEach(function (x) {
      var rel = ((x.az - az + 540) % 360) - 180, c = Math.cos(x.h * RAD) * Math.cos(rel * RAD);
      if (c <= 0) return;
      var v = c * x.vaegt, profil = Math.atan2(Math.tan(x.h * RAD), Math.cos(rel * RAD)) / RAD;
      ialt += v;
      if (x.h < (s.horizon || 0) * HORISONT_VAEGT) return;
      if ((s.overhang || 0) > 0 && profil > 90 - s.overhang) return;
      if ((s.sidefin_left || 0) > 0 && rel < -(90 - s.sidefin_left)) return;
      if ((s.sidefin_right || 0) > 0 && rel > 90 - s.sidefin_right) return;
      fri += v;
    });
    return ialt > 0 ? fri / ialt : 1;
  }
  function himmelkig(s) {
    return (1 - 0.5 * (s.overhang || 0) / 90) * (1 - 0.25 * ((s.sidefin_left || 0) + (s.sidefin_right || 0)) / 90);
  }
  // Solindfald på vinduet (kWh/m²): direkte og diffus delt, så solafskærmning og skygger kan lægges på hver for sig.
  function solPaaVindue(az, s, m) {
    var I = solLodret(az, m), dif = Math.min(I, 0.5 * SOL.H[m] * DIFFUS[m]), dir = Math.max(0, I - dif);
    return { dir: dir * direkteAndel(az, s || {}, m), dif: dif * himmelkig(s || {}) };
  }

  /* ---------- Balance ---------- */
  function netAreal(c) { return c.total_area - c.aabninger.reduce(function (s, o) { return s + o.no * o.area; }, 0); }
  function transmission(p) {
    var hOp = 0, hVin = 0, hPsi = 0, a = 0, dim = 0;
    p.konstruktioner.forEach(function (c) {
      var n = netAreal(c);
      hOp += c.b * c.u * n; a += c.total_area;
      dim += c.u * n * (20 - (c.td_out == null ? -12 : c.td_out));
      c.aabninger.forEach(function (o) { hVin += o.u * o.no * o.area; dim += o.u * o.no * o.area * 32; });
    });
    p.kuldebroer.forEach(function (k) { hPsi += k.psi * k.laengde; dim += k.psi * k.laengde * 32; });
    return { hOp: hOp, hVin: hVin, hPsi: hPsi, h: hOp + hVin + hPsi, areal: a, dim: dim };
  }
  // BR18 § 264 og § 476: E er et decimaltal, opvarmet etageareal / bebygget areal (største opvarmede etage, ae4 i Be18).
  // Over 4,0 m gennemsnitlig rumhøjde: +1,0 W/m² pr. meter. Opvarmet kælder uden for etagearealet tæller 40 % i A og E.
  // § 266's 50 % for kælderen i energirammen er ikke med.
  function krav(p) {
    var b = p.bygning, A0 = b.ae, A = A0 + 0.4 * (b.kaelderAreal > 0 ? b.kaelderAreal : 0);
    var bebygget = b.ae4 > 0 ? b.ae4 : A0 / Math.max(1, p.etager || antalEtager(p)), E = Math.max(1, A / bebygget);
    var tillaeg = b.rumhoejde > 4 ? b.rumhoejde - 4 : 0;
    return { energiramme: 30 + 1000 / A0, energiramme2020: 27, transmission: 12 + 6 / E + 300 / A + tillaeg, transmission2020: 11 + 6 / E + 300 / A + tillaeg, etager: E, areal: A, tillaeg: tillaeg };
  }
  function antalEtager(p) { var n = (p.areas || []).filter(function (a) { return a.type === "NORMAL"; }).length; return n > 0 ? n : 2; }
  function udnyttelse(gamma, a) {
    if (!(gamma > 0)) return 1;
    if (Math.abs(gamma - 1) < 1e-6) return a / (a + 1);
    return (1 - Math.pow(gamma, a)) / (1 - Math.pow(gamma, a + 1));
  }
  function solTilskud(p, m, aktiv) {
    var q = 0, rot = p.bygning.rotation;
    p.konstruktioner.forEach(function (c) {
      var az = retning(c.orient, rot);
      c.aabninger.forEach(function (o) {
        if (!(o.g > 0) || !(o.ff > 0)) return;
        var s = solPaaVindue(az, o.skygge, m);
        var kunSommer = o.fc < 0, fc = Math.abs(o.fc == null ? 1 : o.fc), brug = kunSommer ? aktiv : true;
        var I = brug ? s.dir * fc + s.dif * (0.5 + 0.5 * fc) : s.dir + s.dif;
        q += o.no * o.area * o.ff * o.g * 0.9 * I;
      });
    });
    return q;
  }
  // Overtemperatur: den varme, der ikke kan fjernes ved 25 °C med fuld sommerventilation uden varmegenvinding, regnes om til
  // det elbehov, et standard køleanlæg (COP 2,5) ville bruge. Be18's timeværdier kendes ikke, så det er et skøn.
  function overtemperatur(p, m, t, Ht, A, tau, qSolS, qInt) {
    var v = p.ventilation, Hs = Ht + 1.2 * (v.qvm_day + Math.max(v.qid_day, v.qid)) * A;
    var QL = Hs * Math.max(0.1, 25 - t[m]) * TIMER[m] / 1000, QG = qSolS + qInt;
    var g = QG / QL, a = 1 + tau / 15;
    var nC = Math.abs(g - 1) < 1e-6 ? a / (a + 1) : (1 - Math.pow(g, -a)) / (1 - Math.pow(g, -(a + 1)));
    return Math.max(0, QG - nC * QL);
  }

  function beregn(p) {
    var A = p.bygning.ae, tr = transmission(p), v = p.ventilation;
    var temp = (p.klima && p.klima.months && p.klima.months.length === 12) ? p.klima.months.map(function (x) { return x.tempOut; }) : TEMP_STANDARD;
    var Hv = 1.2 * (v.qvm * v.fo * (1 - v.nvgv) + v.qid) * A, H = tr.h + Hv, tau = p.bygning.heat_cap * A / H;
    var a = 1 + tau / 15, qInd = p.brug.ppers + p.brug.papp, md = [];
    var el = 0, varme = 0, koel = 0, solcelle = 0, dhw = 0, tabInst = 0, pumpeT = 0;
    var dhwAar = (p.brugsvand || 0) / 1000 * 1.16 * (55 - 10) * A;
    var fv = p.fjernvarme || {}, tabVeksler = (fv.heat_loss || 0) * Math.max(0, (fv.min_temp || 60) - 20) * (fv.b_factor == null ? 1 : fv.b_factor);
    var pv = p.solceller || null, pu = p.pumpe || { no: 0, pnom: 0, fp: 0 };
    for (var m = 0; m < 12; m++) {
      var h = TIMER[m], QL = H * (20 - temp[m]) * h / 1000, Qi = qInd * A * h / 1000;
      var Qs = solTilskud(p, m, false), Qg = Qs + Qi, g = QL > 0 ? Qg / QL : 99, n = udnyttelse(g, a), Qh = Math.max(0, QL - n * Qg);
      if (Qh < 0.002 * QL) Qh = 0;
      var QsS = solTilskud(p, m, true), Qk = overtemperatur(p, m, temp, tr.h, A, tau, QsS, Qi);
      var fan = v.sel * v.qvm * v.fo * A * h / 1000, pump = Qh > 0 ? pu.no * pu.pnom * pu.fp * h / 1000 : 0, auto = (fv.auto_stb || 0) * h / 1000;
      var elB = fan + pump + auto, elKoel = Qk / COP_KOEL;
      var pvM = pv ? pv.area * pv.peak_power * pv.efficiency * solSkraa(retning(pv.orient), pv.slope, m) : 0, pvKred = Math.min(pvM, elB + elKoel);
      var dhwM = dhwAar * DAGE[m] / 365, tabM = tabVeksler * h / 1000;
      varme += Qh; dhw += dhwM; tabInst += tabM; el += elB; koel += Qk; solcelle += pvKred; if (Qh > 0) pumpeT += h;
      md.push({ maaned: MAANED[m], ude: temp[m], tab: QL, sol: Qs, intern: Qi, udnyttelse: n, varme: Qh, koel: Qk, elBygning: elB, solceller: pvKred });
    }
    var varmeTot = varme + dhw + tabInst;
    var bidragVarme = varmeTot * FAKTOR.fjernvarme / A, koelEl = koel / COP_KOEL;
    var bidragEl = (el - solcelle + Math.max(0, solcelle - el)) * FAKTOR.el / A;
    var over = 0, elRest = el, sc = solcelle;
    var fraEl = Math.min(sc, el); elRest = el - fraEl; sc -= fraEl; over = Math.max(0, koelEl - sc);
    bidragEl = elRest * FAKTOR.el / A;
    var bidragOver = over * FAKTOR.el / A, resultat = bidragVarme + bidragEl + bidragOver;
    var k = krav(p), tab = tr.dim / k.areal;
    return {
      energiramme: { resultat: resultat, krav: k.energiramme, krav2020: k.energiramme2020, ok: resultat <= k.energiramme, ok2020: resultat <= k.energiramme2020 },
      bidrag: { varme: bidragVarme, el: bidragEl, overtemperatur: bidragOver },
      transmission: { resultat: tab, krav: k.transmission, krav2020: k.transmission2020, ok: tab <= k.transmission, ok2020: tab <= k.transmission2020, tillaeg: k.tillaeg, areal: tr.areal, h: tr.h, hOp: tr.hOp, hVin: tr.hVin, hPsi: tr.hPsi },
      netto: { rumvarme: varme / A, brugsvand: dhw / A, tabInstallation: tabInst / A, elBygning: el / A, solceller: solcelle / A, koel: koel / A },
      Hv: Hv, tau: tau, etager: k.etager, maaneder: md
    };
  }

  return { beregn: beregn, krav: krav, retning: retning, retningNavn: retningNavn, netAreal: netAreal, transmission: transmission, solLodret: solLodret, solSkraa: solSkraa, direkteAndel: direkteAndel, himmelkig: himmelkig, SOL: SOL, FAKTOR: FAKTOR, MAANED: MAANED, rund: rund };
});
