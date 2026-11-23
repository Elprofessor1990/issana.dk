/* ISSANA 3D: Statik (3.0). Ren logik uden DOM, efter «Statik – regler» (24_ISSANA_Ideer/03 Statik).
   I browseren giver <script src="statik.js"> window.IssanaStatik; i Node giver require/createRequire module.exports.
   Værdilisten (Revit-navne, Statik-navne, farver, Revit-mapping) kommer fra konstruktiv-vaerdier.json
   (konstruktiv-vaerdier.js i browseren).

   Grundregel: kun det, brugeren har defineret, får farve. Det er en forenklet vurdering til undervisning og tidlige
   faser, ikke en statisk beregning; ingeniøren skal godkende.

   Model: issana-3d/1.2 eller 1.3 (elements[].meshes[].pos, rooms[].bounds eller rooms[].meshes, rooms[].graenser, level).
   Retning: X = øst, Y = nord (projektnord). En væg «står øst–vest» (ov), når dens længde ligger langs X.
   Vinkler: vinkelGrader er målt fra øst mod nord (mod uret) og ligger i [0; 180[. 0 = øst–vest, 90 = nord–syd.

   Brugerens valg (alle pr. id, aldrig udledt af navn eller geometri):
   - spaend[rumId] = 'ov' | 'ns' | 'begge' | { vinkelGrader, begge }   dækket over rummet (etageadskillelse eller tag)
   - daek[daekId] = { metode: 'hele' | 'rum' | 'egne', hele: retning, egne: [{ id, navn, polygon, vinkelGrader, begge }] }
     hvordan ét helt dæk er delt i felter. Uden post er metoden 'rum', hvis et rum under dækket har en spændretning (gamle valg),
     ellers 'hele'.
   - vaegtype[vaegId] = 'tung' | 'let'   (en rettelse af det, der er fundet ud fra opbygningen; 'skive' læses fra ældre valg)
   - rolle[vaegId] = 'baerende' | 'stab' | 'begge' | 'ingen'   (vinder over reglen; Statik-panelet tilbyder den ikke længere, ejer 2026-11-14)
   - daek[daekId].tag = 'gitter' | 'haneband' | 'kip'   tagets konstruktion, kun for et tag med hældning og kun når hele taget
     er ét felt (ejer 2026-11-14). Den afgør, hvilke vægge taget hviler på: se TAGTYPER og tagRegel.

   Tage med hældning: et tag er ikke et vandret dæk. tagform (pr. dæk) giver hældningen, den vej spærene spænder (på tværs af
   kippen) og kippens linje, læst fra tagets egne flader. I 3D lægges feltet, stregerne og pilene på tagets flade (zOverside).

   Felter: felter(geo, valg) giver hvert defineret felt som { id, daekId, navn, polygon: [[x,y],...], z, vinkelGrader, begge, ... }.
   polygon er én ring (med en skjult sømlinje, hvis feltet har huller); z er dækkets overside i meter. */
(function (root, fabrik) {
  var vaerdier = null;
  if (typeof module === "object" && module && module.exports) {
    try { vaerdier = require("./konstruktiv-vaerdier.js"); } catch (e) { vaerdier = null; }
    module.exports = fabrik(vaerdier);
  } else {
    root.IssanaStatik = fabrik(root.IssanaKonstruktivVaerdier || null);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (VAERDIER) {
  "use strict";

  /* ---------- Faste værdier ---------- */
  // Reserve, hvis konstruktiv-vaerdier.js ikke er indlæst (samme indhold som JSON-filen).
  VAERDIER = VAERDIER || {
    parameter: "ISSANA Konstruktiv funktion",
    vaerdier: [
      { kode: "baerende", revit: "Bærende", statik: "Bærende", baerer: true, afstiver: false, farve: "#3567A6" },
      { kode: "stab", revit: "Stabiliserende", statik: "Stabiliserende", baerer: false, afstiver: true, farve: "#E3923A" },
      { kode: "begge", revit: "Begge", statik: "Bærende og stabiliserende", baerer: true, afstiver: true, farve: "#3A2B6B" },
      { kode: "ingen", revit: "Ingen", statik: "Ingen af delene", baerer: false, afstiver: false, farve: "#B4BDC2" },
      { kode: "ikke", revit: "", statik: "Ikke angivet", baerer: null, afstiver: null, farve: "#F4F5F6" }
    ],
    fraRevit: { Bearing: "baerende", Shear: "stab", Combined: "begge", NonBearing: "ingen" },
    kategorier: ["Vægge", "Gulve", "Tage", "Søjler", "Bjælker"]
  };
  var VAL = {};
  VAERDIER.vaerdier.forEach(function (v) { VAL[v.kode] = v; });
  var RETNING = { ov: "øst–vest", ns: "nord–syd", begge: "begge veje" };
  var VAEGTYPE = {
    tung: "Tung væg (beton, murværk)",
    skive: "Let væg med skiveplader",
    let: "Let væg (skelet, gips, glas)"
  };
  var VAEGTYPE_HJAELP = {
    tung: "En tung væg bærer de dæk, der hviler på den, og afstiver bygningen i sin egen retning.",
    skive: "En let væg med skiveplader, fx krydsfiner eller fibergips, bærer de dæk, der hviler på den, og afstiver i sin egen retning.",
    let: "En let væg bærer de dæk, der hviler på den, men afstiver ikke af sig selv. Skal den også stabilisere, skal den have plader på, fx krydsfiner eller fibergips, og forankres. Det afgør ingeniøren."
  };
  // Noten ved en let væg under et dæk med spændretning: det, der skal huskes i projektet.
  var LET_NOTE = {
    baerer: "Væggen er let. Den bærer dækket, men stabiliserer ikke af sig selv. Skal den også være stabiliserende, skal den have plader på, fx krydsfiner eller fibergips, og forankres. Husk det i projektet.",
    fri: "Væggen er let og bærer ikke her. Skal den stabilisere, skal den have plader på, fx krydsfiner eller fibergips, og forankres."
  };
  // Lette vægge har deres egen faste farve (ejer, 2026-11-14): man skal altid kunne se, at der skal gøres noget særligt, før
  // en let væg kan bære eller afstive. Farven er kun til visning; i Revit findes stadig kun de fire roller.
  var LET_FARVE = "#E2CF3A";
  // Skøn af væggens type ud fra Revit-typens lag og navn. Et tungt bærende lag vinder. Ellers peger gips, skelet, stolper og
  // glasfacader på en let væg. Kan intet læses, er der intet skøn: væggen regnes som tung, til brugeren vælger en type.
  var TUNG_ORD = /beton|concrete|murv|mursten|tegl|brick|masonry|\bcmu\b|blok|block|letklinker|leca|porebeton|gasbeton|kalksand|natursten|granit|stone|\bclt\b|massivtr/i;
  // «Skillevæg» og «partition» alene siger intet om materialet (en skillevæg kan være muret), så de tæller ikke.
  var LET_ORD = /gips|gyps|\bgwb\b|drywall|plasterboard|stud|stolpe|skelet|regel|l(æ|ae)gte|furring|let skillev|let v(æ|ae)g|letv(æ|ae)g|curtain|glasfacade|glasv(æ|ae)g|storefront/i;
  function skoenVaegtype(typeNavn, lag) {
    var navn = String(typeNavn || ""), L = (lag || []).filter(function (l) { return l && l.widthMm > 0; });
    // De bærende lag (Revits «Structure»); uden dem alle lag på mindst 20 mm.
    var kerne = L.filter(function (l) { return /structure/i.test(l.function || ""); });
    if (!kerne.length) kerne = L.filter(function (l) { return l.widthMm >= 20; });
    var tungt = kerne.filter(function (l) { return TUNG_ORD.test(l.material || ""); })[0];
    if (tungt) return { type: "tung", grund: "laget «" + tungt.material + "» (" + Math.round(tungt.widthMm) + " mm)" };
    var letLag = L.filter(function (l) { return LET_ORD.test(l.material || ""); })[0];
    if (letLag) return { type: "let", grund: "laget «" + letLag.material + "»" };
    if (TUNG_ORD.test(navn)) return { type: "tung", grund: "typenavnet «" + navn + "»" };
    if (LET_ORD.test(navn)) return { type: "let", grund: "typenavnet «" + navn + "»" };
    return null;
  }
  var FILTRE = [
    { id: "alle", titel: "Alle" },
    { id: "baer", titel: "Bærende system" },
    { id: "nord", titel: "Stabilisering · last fra nord" },
    { id: "oest", titel: "Stabilisering · last fra øst" }
  ];
  var KANT_FARVE = "#3A2B6B";          // mørk kant: væggen bærer også et dæk (i et lasttilfælde)
  var TOL = 0.35;                       // m: hvor tæt en væg skal stå på rummet for at «høre til» det
  var VAEG_RAEK_TOL = 1.0;              // m: en væg regnes med under dækket, når dens top højst er så langt under dækkets underside (modeller stopper ofte vægge over nedhængte lofter)
  var VAEG_TAET = 0.3;                  // m: slutter væggen længere under dækket end det, står det i forklaringen
  var LINJE_TOL = 0.5;                  // m: to vægge «står på samme linje»
  var METODER = { hele: "Hele dækket", rum: "Ét felt pr. rum", egne: "Egne felter" };
  var RETNING_FARVE = { ov: "#1C8C84", ns: "#B0528C", begge: "#C08A1E", fri: "#5A6FB5" };
  // Tagets konstruktion (ejer, 2026-11-14): et tag med hældning bærer forskelligt efter, hvordan det er bygget. Gitterspær og
  // hanebåndsspær spænder frit fra facade til facade og hviler kun på væggene under tagfoden. Med kip og spær bærer en
  // kipbjælke det halve af taget; den hviler på gavlene eller på en væg under kippen. Forenklet, som resten af Statik.
  var TAGTYPER = {
    gitter: { navn: "Gitterspær", kort: "gitterspærene", fri: "frit fra facade til facade",
      note: "Gitterspær spænder frit fra facade til facade og hviler på væggene under tagfoden. Indervægge bærer ikke taget." },
    haneband: { navn: "Hanebåndsspær", kort: "hanebåndsspærene", fri: "frit fra facade til facade",
      note: "Hanebåndsspær hviler på væggene under tagfoden og trykker vandret ud i dem. Trykket skal optages af bjælkelaget eller af en forankring i remmen. Husk det i projektet." },
    kip: { navn: "Kip og spær", kort: "spærene", fri: "fra kip til tagfod",
      note: "Kipbjælken bærer det halve af taget og skal understøttes i begge ender: af gavlene, søjler eller en bærende væg under kippen. Husk det i projektet." }
  };
  var TAG_MIN_HAELDNING = 3;            // grader: under det er taget fladt og regnes som et dæk
  var TAGFOD_TOL = 1.2;                 // m: så langt inde fra tagets kant kan væggen under tagfoden stå (udhænget)
  var KIP_TOL = 0.6;                    // m: så tæt på kippen står en væg, som kipbjælken kan hvile på i sin længde
  var KIP_UDHAENG = 1.2;                // m: så langt kan kippen række ud over gavlen
  var KIP_NAA = 1.0;                    // m: en væg når op til kippen, når dens top højst er så langt under kippens overside
  var AABNING_ADV = 0.25, AABNING_MAX = 0.5;
  var VAEG_KAT = { "Vægge": 1 }, DAEK_KAT = { "Gulve": 1, "Tage": 1 }, AABNING_KAT = { "Vinduer": 1, "Døre": 1 };

  /* ---------- Små hjælpere ---------- */
  function r1(x) { return Math.round(x * 10) / 10; }
  function dk(x, dec) { return Number(x).toFixed(dec == null ? 1 : dec).replace(".", ","); }
  function flertal(n, en, flere) { return n + " " + (n === 1 ? en : flere); }
  function unik(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }
  function kode2revit(kode) { return VAL[kode] ? VAL[kode].revit : ""; }
  function revit2kode(revit) {
    var s = String(revit == null ? "" : revit).trim();
    for (var k in VAL) if (VAL[k].revit === s) return k;
    return s === "" ? "ikke" : null;        // null: en værdi, listen ikke kender (vises, skjules ikke)
  }
  function statikTekst(kode) { return VAL[kode] ? VAL[kode].statik : (kode || "Ikke angivet"); }
  function farve(kode) { return VAL[kode] ? VAL[kode].farve : null; }
  function fraRevitUsage(usage) { return usage && VAERDIER.fraRevit[usage] ? VAERDIER.fraRevit[usage] : null; }

  function bboxAf(meshes) {
    var b = null;
    (meshes || []).forEach(function (m) {
      var p = m && m.pos; if (!p) return;
      for (var i = 0; i + 2 < p.length; i += 3) {
        if (!b) b = { x0: p[i], y0: p[i + 1], z0: p[i + 2], x1: p[i], y1: p[i + 1], z1: p[i + 2] };
        else {
          if (p[i] < b.x0) b.x0 = p[i]; if (p[i] > b.x1) b.x1 = p[i];
          if (p[i + 1] < b.y0) b.y0 = p[i + 1]; if (p[i + 1] > b.y1) b.y1 = p[i + 1];
          if (p[i + 2] < b.z0) b.z0 = p[i + 2]; if (p[i + 2] > b.z1) b.z1 = p[i + 2];
        }
      }
    });
    return b;
  }
  function bboxFraBounds(bounds) {
    if (!bounds) return null;
    if (Array.isArray(bounds) && bounds.length >= 6) return { x0: bounds[0], y0: bounds[1], z0: bounds[2], x1: bounds[3], y1: bounds[4], z1: bounds[5] };
    if (Array.isArray(bounds.min) && Array.isArray(bounds.max)) return { x0: bounds.min[0], y0: bounds.min[1], z0: bounds.min[2], x1: bounds.max[0], y1: bounds.max[1], z1: bounds.max[2] };
    if (bounds.x0 != null && bounds.x1 != null) return bounds;
    return null;
  }
  function overlapXY(a, b, tol) {
    tol = tol || 0;
    return a.x0 - tol <= b.x1 && a.x1 + tol >= b.x0 && a.y0 - tol <= b.y1 && a.y1 + tol >= b.y0;
  }

  /* ---------- Retning: øst–vest, nord–syd, begge veje eller en fri vinkel ---------- */
  function cosG(v) { return v === 90 ? 0 : Math.cos(v * Math.PI / 180); }
  function sinG(v) { return v === 0 ? 0 : Math.sin(v * Math.PI / 180); }
  function vinkelNorm(v) { var a = Math.round((((Number(v) % 180) + 180) % 180) * 10) / 10; return a >= 180 ? 0 : a; }
  // Forskellen mellem to retninger (uden pil): 0–90 grader
  function vinkelForskel(a, b) { var d = Math.abs(a - b) % 180; return d > 90 ? 180 - d : d; }
  function retningAf(x) {
    if (x === "ov") return { vinkelGrader: 0, begge: false };
    if (x === "ns") return { vinkelGrader: 90, begge: false };
    if (x === "begge") return { vinkelGrader: 0, begge: true };
    if (typeof x === "number" && isFinite(x)) return { vinkelGrader: vinkelNorm(x), begge: false };
    if (x && typeof x === "object" && x.vinkelGrader != null && isFinite(x.vinkelGrader)) return { vinkelGrader: vinkelNorm(x.vinkelGrader), begge: !!x.begge };
    return null;
  }
  function retningKode(r) {
    if (!r) return "";
    if (r.begge) return r.vinkelGrader === 0 || r.vinkelGrader === 90 ? "begge" : "fri";
    return r.vinkelGrader === 0 ? "ov" : r.vinkelGrader === 90 ? "ns" : "fri";
  }
  function retningLager(r) { var k = retningKode(r); return !r ? null : k === "fri" ? { vinkelGrader: r.vinkelGrader, begge: !!r.begge } : k; }
  function gradTekst(v) { return dk(v, v % 1 ? 1 : 0) + "°"; }
  function retningTekst(r) {
    var k = retningKode(r);
    if (RETNING[k]) return RETNING[k];
    if (!r) return "ikke angivet";
    return r.begge ? "i retningerne " + gradTekst(r.vinkelGrader) + " og " + gradTekst(vinkelNorm(r.vinkelGrader + 90)) : "i retningen " + gradTekst(r.vinkelGrader);
  }
  function retningKort(r) {
    var k = retningKode(r);
    if (!r) return "Ikke angivet";
    return k === "ov" ? "Ø–V" : k === "ns" ? "N–S" : k === "begge" ? "Begge veje" : gradTekst(r.vinkelGrader) + (r.begge ? " og " + gradTekst(vinkelNorm(r.vinkelGrader + 90)) : "");
  }
  function retningFarve(r) { var k = retningKode(r); return RETNING_FARVE[k] || RETNING_FARVE.fri; }

  /* ---------- Flader og omrids ud fra mesh ---------- */
  function forHverTrekant(meshes, fn) {
    (meshes || []).forEach(function (m) {
      var P = m && m.pos, I = m && m.idx, n = P ? (I ? I.length : Math.floor(P.length / 3)) : 0;
      for (var t = 0; t + 2 < n; t += 3) {
        var a = (I ? I[t] : t) * 3, b = (I ? I[t + 1] : t + 1) * 3, c = (I ? I[t + 2] : t + 2) * 3;
        fn(P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]);
      }
    });
  }
  // Trekanter, der ikke står lodret: dem bruges der til at finde dækkets over- og underside i et punkt.
  function fladeTrekanter(meshes) {
    var ud = [];
    forHverTrekant(meshes, function (ax, ay, az, bx, by, bz, cx, cy, cz) {
      var ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (!L || Math.abs(nz) / L < 0.1) return;
      ud.push({ ax: ax, ay: ay, az: az, bx: bx, by: by, bz: bz, cx: cx, cy: cy, cz: cz,
        x0: Math.min(ax, bx, cx), y0: Math.min(ay, by, cy), x1: Math.max(ax, bx, cx), y1: Math.max(ay, by, cy) });
    });
    return ud;
  }
  // Under- og overside af et dæk i punktet (x, y). null: dækket er der ikke (fx et hul eller en lysgård).
  function zVed(d, x, y) {
    var T = d.flader, min = Infinity, max = -Infinity;
    if (!T || !T.length) return x >= d.b.x0 && x <= d.b.x1 && y >= d.b.y0 && y <= d.b.y1 ? { min: d.b.z0, max: d.b.z1 } : null;
    for (var i = 0; i < T.length; i++) {
      var t = T[i];
      if (x < t.x0 || x > t.x1 || y < t.y0 || y > t.y1) continue;
      var n = (t.by - t.cy) * (t.ax - t.cx) + (t.cx - t.bx) * (t.ay - t.cy);
      if (!n) continue;
      var l1 = ((t.by - t.cy) * (x - t.cx) + (t.cx - t.bx) * (y - t.cy)) / n;
      var l2 = ((t.cy - t.ay) * (x - t.cx) + (t.ax - t.cx) * (y - t.cy)) / n;
      var l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      var z = l1 * t.az + l2 * t.bz + l3 * t.cz;
      if (z < min) min = z;
      if (z > max) max = z;
    }
    return min === Infinity ? null : { min: min, max: max };
  }
  // Tagets overside i punktet (x, y); null uden for taget. Et punkt på selve kanten prøves lidt længere inde.
  function zOverside(d, x, y) {
    var v = zVed(d, x, y);
    if (v) return v.max;
    var dx = (d.b.x0 + d.b.x1) / 2 - x, dy = (d.b.y0 + d.b.y1) / 2 - y, L = Math.sqrt(dx * dx + dy * dy) || 1;
    for (var k = 1; k <= 3; k++) { v = zVed(d, x + dx / L * 0.04 * k, y + dy / L * 0.04 * k); if (v) return v.max; }
    return null;
  }
  // Tagets form ud fra de opadvendte flader: hældningen, den vej spærene spænder (på tværs af kippen) og kippens linje.
  // null for et vandret dæk og et fladt tag. Fladerne samles efter, hvilken vej de falder; den akse, der dækker mest, er tagets.
  function tagform(meshes) {
    var flader = [], A = 0, skraa = 0;
    forHverTrekant(meshes, function (ax, ay, az, bx, by, bz, cx, cy, cz) {
      var ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (!L || nz / L < 0.5) return;                    // de samme flader som dækkets omrids (deleAfMesh)
      var areal = nz / 2, haeld = Math.acos(Math.min(1, nz / L)) * 180 / Math.PI;
      A += areal;
      if (haeld < TAG_MIN_HAELDNING) return;
      skraa += areal;
      // En flade falder den vej, dens normal hælder i planen.
      flader.push({ haeld: haeld, fald: Math.atan2(ny, nx) * 180 / Math.PI, areal: areal, p: [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] });
    });
    if (!A || skraa / A < 0.5) return null;
    // Spændaksen: faldretningen uden fortegn (0–180), den med mest areal.
    var spand = {}, vaegt = {}, bedst = null;
    function akseAf(fald) { var a = ((fald % 180) + 180) % 180; return a >= 179.5 ? a - 180 : a; }
    flader.forEach(function (f) { var a = akseAf(f.fald), k = Math.round(a); spand[k] = (spand[k] || 0) + f.areal; vaegt[k] = (vaegt[k] || 0) + f.areal * a; });
    Object.keys(spand).forEach(function (k) { if (bedst == null || spand[k] > spand[bedst]) bedst = k; });
    var akse = vinkelNorm(vaegt[bedst] / spand[bedst]), rest = akse % 90;
    if (Math.min(rest, 90 - rest) < 1) akse = vinkelNorm(Math.round(akse / 90) * 90);
    var ux = cosG(akse), uy = sinG(akse), rx = -uy, ry = ux;   // u: langs spærene, r: langs kippen
    var hoved = flader.filter(function (f) { return vinkelForskel(akseAf(f.fald), akse) <= 2; });
    var sum = 0, areal = 0, med = 0, mod = 0, zMax = -Infinity;
    hoved.forEach(function (f) {
      sum += f.haeld * f.areal; areal += f.areal;
      if (Math.cos(f.fald * Math.PI / 180) * ux + Math.sin(f.fald * Math.PI / 180) * uy > 0) med += f.areal; else mod += f.areal;
      f.p.forEach(function (q) { if (q[2] > zMax) zMax = q[2]; });
    });
    // Kippen: de højeste punkter på hovedfladerne, lagt på en linje langs kippen. Et spidst tag (et tårn) har ingen kip.
    var s0 = Infinity, s1 = -Infinity, t = 0, n = 0;
    hoved.forEach(function (f) { f.p.forEach(function (q) {
      if (q[2] < zMax - 0.05) return;
      var s = q[0] * rx + q[1] * ry; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t += q[0] * ux + q[1] * uy; n++;
    }); });
    var kip = n && s1 - s0 >= 0.5 ? { p0: [ux * t / n + rx * s0, uy * t / n + ry * s0], p1: [ux * t / n + rx * s1, uy * t / n + ry * s1], z: zMax } : null;
    return { akse: akse, haeldning: Math.round(sum / areal * 10) / 10, ensidig: Math.min(med, mod) < 0.15 * (med + mod), kip: kip };
  }
  // Flade trekanter [x, y, x, y, ...] delt, til ingen kant er længere end maks: så kan hvert hjørne løftes op på et tag med hældning.
  function underdel(tal, maks) {
    var ud = [], m2 = maks * maks;
    function del(ax, ay, bx, by, cx, cy, dybde) {
      var ab = (ax - bx) * (ax - bx) + (ay - by) * (ay - by), bc = (bx - cx) * (bx - cx) + (by - cy) * (by - cy), ca = (cx - ax) * (cx - ax) + (cy - ay) * (cy - ay);
      var laengst = Math.max(ab, bc, ca), mx, my;
      if (laengst <= m2 || dybde > 14) { ud.push(ax, ay, bx, by, cx, cy); return; }
      if (laengst === ab) { mx = (ax + bx) / 2; my = (ay + by) / 2; del(ax, ay, mx, my, cx, cy, dybde + 1); del(mx, my, bx, by, cx, cy, dybde + 1); }
      else if (laengst === bc) { mx = (bx + cx) / 2; my = (by + cy) / 2; del(ax, ay, bx, by, mx, my, dybde + 1); del(ax, ay, mx, my, cx, cy, dybde + 1); }
      else { mx = (cx + ax) / 2; my = (cy + ay) / 2; del(ax, ay, bx, by, mx, my, dybde + 1); del(mx, my, bx, by, cx, cy, dybde + 1); }
    }
    for (var i = 0; i + 5 < tal.length; i += 6) del(tal[i], tal[i + 1], tal[i + 2], tal[i + 3], tal[i + 4], tal[i + 5], 0);
    return ud;
  }
  // En ring (også én med sømlinjer ud til huller, se somRing) delt i trekanter [x, y, x, y, ...] ved at klippe ører af.
  // null, når trekanterne ikke dækker ringens areal (en ring, der krydser sig selv): så må kalderen gøre noget andet.
  function trekanterAfRing(ring) {
    var p = (ring || []).slice(), maal = Math.abs(arealRing(p)), ud = [], vagt = 0;
    if (p.length < 3 || !maal) return null;
    if (arealRing(p) < 0) p.reverse();
    function kryds(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
    function inde(q, a, b, c) { return kryds(a, b, q) > 1e-10 && kryds(b, c, q) > 1e-10 && kryds(c, a, q) > 1e-10; }
    while (p.length > 3 && vagt++ < 200000) {
      var klippet = false;
      for (var i = 0; i < p.length && !klippet; i++) {
        var a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length], k = kryds(a, b, c);
        if (Math.abs(k) <= 1e-10) { p.splice(i, 1); klippet = true; break; }   // et hjørne på en ret linje fylder intet
        if (k < 0) continue;                                                    // et indadgående hjørne er ikke et øre
        var fri = true;
        for (var j = 0; j < p.length && fri; j++) { var q = p[j]; if (q !== a && q !== b && q !== c && inde(q, a, b, c)) fri = false; }
        if (!fri) continue;
        ud.push(a[0], a[1], b[0], b[1], c[0], c[1]);
        p.splice(i, 1); klippet = true;
      }
      if (!klippet) break;
    }
    if (p.length === 3) ud.push(p[0][0], p[0][1], p[1][0], p[1][1], p[2][0], p[2][1]);
    var sum = 0;
    for (var m = 0; m + 5 < ud.length; m += 6) sum += Math.abs((ud[m + 2] - ud[m]) * (ud[m + 5] - ud[m + 1]) - (ud[m + 3] - ud[m + 1]) * (ud[m + 4] - ud[m])) / 2;
    return Math.abs(sum - maal) <= 0.02 * maal ? ud : null;
  }
  // En streg [x1, y1, x2, y2] som punkter med højst maks imellem.
  function underdelStreg(l, maks) {
    var dx = l[2] - l[0], dy = l[3] - l[1], n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / maks)), ud = [];
    for (var i = 0; i <= n; i++) ud.push([l[0] + dx * i / n, l[1] + dy * i / n]);
    return ud;
  }
  function arealRing(r) { var s = 0; for (var i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return s / 2; }
  function ringBoks(r) { var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }; r.forEach(function (p) { b.x0 = Math.min(b.x0, p[0]); b.y0 = Math.min(b.y0, p[1]); b.x1 = Math.max(b.x1, p[0]); b.y1 = Math.max(b.y1, p[1]); }); return b; }
  function ringeBoks(ringe) { return ringBoks([].concat.apply([], ringe)); }
  // Punkter, der ligger på en ret linje mellem naboerne, fjernes (de stammer kun fra trekanterne).
  function forenklRing(r) {
    var ud = r.slice(), fjernet = true;
    while (fjernet && ud.length > 3) {
      fjernet = false;
      for (var i = 0; i < ud.length && ud.length > 3; i++) {
        var a = ud[(i + ud.length - 1) % ud.length], p = ud[i], c = ud[(i + 1) % ud.length];
        var ex = c[0] - a[0], ey = c[1] - a[1], L = Math.sqrt(ex * ex + ey * ey) || 1;
        var afst = Math.abs((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / L;
        var langs = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (L * L);
        if (afst < 0.005 && langs >= 0 && langs <= 1) { ud.splice(i, 1); fjernet = true; i--; }
      }
    }
    return ud;
  }
  // Omridset af de opadvendte trekanter: kanter, der kun hører til én trekant, sat sammen til ringe.
  // Uret-vendte ringe er huller. Giver [{ ringe: [ydre, hul, ...], areal }], største del først; [] hvis ringene ikke lukker.
  function deleAfMesh(meshes) {
    var kanter = {}, nogle = {}, noegle = function (x, y) { var k = Math.round(x * 1000) + "|" + Math.round(y * 1000); nogle[k] = [x, y]; return k; };
    function kant(a, b) { if (a === b) return; var mod = b + ">" + a; if (kanter[mod]) delete kanter[mod]; else kanter[a + ">" + b] = 1; }
    forHverTrekant(meshes, function (ax, ay, az, bx, by, bz, cx, cy, cz) {
      var ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (!L || nz / L < 0.5) return;
      var a = noegle(ax, ay), b = noegle(bx, by), c = noegle(cx, cy);
      kant(a, b); kant(b, c); kant(c, a);
    });
    var naeste = {};
    Object.keys(kanter).forEach(function (k) { var d = k.split(">"); (naeste[d[0]] || (naeste[d[0]] = [])).push(d[1]); });
    var ringe = [];
    Object.keys(naeste).forEach(function (start) {
      while (naeste[start] && naeste[start].length) {
        var ring = [start], cur = start, lukket = false, vagt = 0;
        while (vagt++ < 100000) {
          var ud = naeste[cur];
          if (!ud || !ud.length) break;
          var n = ud.shift();
          if (n === start) { lukket = true; break; }
          ring.push(n); cur = n;
        }
        if (lukket && ring.length >= 3) ringe.push(forenklRing(ring.map(function (k) { return nogle[k]; })));
      }
    });
    var ydre = ringe.filter(function (r) { return arealRing(r) >= 0.05; }).sort(function (a, b) { return arealRing(b) - arealRing(a); });
    var dele = ydre.map(function (r) { return { ringe: [r], areal: arealRing(r) }; });
    ringe.filter(function (r) { return arealRing(r) <= -0.02; }).forEach(function (h) {
      var p = h[0], bedst = null;
      dele.forEach(function (d) { if (pktIRing(d.ringe[0], p[0], p[1]) && (!bedst || arealRing(d.ringe[0]) < arealRing(bedst.ringe[0]))) bedst = d; });
      if (bedst) { bedst.ringe.push(h); bedst.areal += arealRing(h); }
    });
    return dele;
  }
  function rektangel(b) { return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]; }
  function deleEllerBoks(meshes, b) {
    var d = meshes && meshes.length ? deleAfMesh(meshes) : [];
    return d.length || !b ? d : [{ ringe: [rektangel(b)], areal: (b.x1 - b.x0) * (b.y1 - b.y0) }];
  }
  function pktIRing(r, x, y) {
    var ind = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) ind = !ind;
    }
    return ind;
  }
  function pktIRinge(ringe, x, y) { var ind = false; ringe.forEach(function (r) { if (pktIRing(r, x, y)) ind = !ind; }); return ind; }
  function afstandSegment(x, y, a, b) {
    var ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey, t = L2 ? ((x - a[0]) * ex + (y - a[1]) * ey) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    var dx = x - (a[0] + t * ex), dy = y - (a[1] + t * ey);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function afstandRinge(ringe, x, y) {
    var d = Infinity;
    ringe.forEach(function (r) { for (var i = 0, j = r.length - 1; i < r.length; j = i++) d = Math.min(d, afstandSegment(x, y, r[j], r[i])); });
    return d;
  }
  function proevePunkter(ringe, b, maks) {
    maks = maks || 8;
    var w = b.x1 - b.x0, h = b.y1 - b.y0, nx = Math.max(3, Math.min(maks, Math.ceil(w / 0.5))), ny = Math.max(3, Math.min(maks, Math.ceil(h / 0.5))), ud = [];
    for (var i = 0; i < nx; i++) for (var j = 0; j < ny; j++) {
      var x = b.x0 + (i + 0.5) / nx * w, y = b.y0 + (j + 0.5) / ny * h;
      if (!ringe || pktIRinge(ringe, x, y)) ud.push([x, y]);
    }
    return ud.length ? ud : [[(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]];
  }
  function ringeAf(dele) { return [].concat.apply([], dele.map(function (d) { return d.ringe; })); }
  // Væggens retning og midterlinje ud fra dens kanter: den retning, hvor flest meter kant ligger. En væg, der højst er 1° skæv,
  // regnes som ret (så rette vægge giver præcis 0 eller 90 og samme retning som boksen).
  function vaegLinje(meshes, b) {
    var dx = b.x1 - b.x0, dy = b.y1 - b.y0, ov = dx >= dy, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    var ret = { vinkel: ov ? 0 : 90, p0: ov ? [b.x0, cy] : [cx, b.y0], p1: ov ? [b.x1, cy] : [cx, b.y1], laengde: Math.max(dx, dy), tykkelse: Math.min(dx, dy) };
    var spand = {}, vaegt = {};
    function kant(x0, y0, x1, y1) {
      var ex = x1 - x0, ey = y1 - y0, L = Math.sqrt(ex * ex + ey * ey);
      if (L < 0.02) return;
      var a = Math.atan2(ey, ex) * 180 / Math.PI; a = ((a % 180) + 180) % 180; if (a >= 179.5) a -= 180;
      var k = Math.round(a);
      spand[k] = (spand[k] || 0) + L; vaegt[k] = (vaegt[k] || 0) + L * a;
    }
    forHverTrekant(meshes, function (ax, ay, az, bx, by, bz, qx, qy) { kant(ax, ay, bx, by); kant(bx, by, qx, qy); kant(qx, qy, ax, ay); });
    var bedst = null;
    Object.keys(spand).forEach(function (k) { if (bedst == null || spand[k] > spand[bedst]) bedst = k; });
    if (bedst == null) return ret;
    var v = vinkelNorm(vaegt[bedst] / spand[bedst]), rest = v % 90;
    if (Math.min(rest, 90 - rest) < 1) return ret;
    var ux = cosG(v), uy = sinG(v), s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    (meshes || []).forEach(function (m) {
      var P = m && m.pos; if (!P) return;
      for (var i = 0; i + 2 < P.length; i += 3) {
        var s = (P[i] - cx) * ux + (P[i + 1] - cy) * uy, t = -(P[i] - cx) * uy + (P[i + 1] - cy) * ux;
        s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
      }
    });
    var tm = (t0 + t1) / 2, mx = cx - tm * uy, my = cy + tm * ux;
    return { vinkel: v, p0: [mx + s0 * ux, my + s0 * uy], p1: [mx + s1 * ux, my + s1 * uy], laengde: s1 - s0, tykkelse: t1 - t0 };
  }

  /* ---------- Geometri: vægge, dæk, rum, etager, åbninger ---------- */
  // Samler det, reglerne skal bruge, ud fra elementernes mesh-bokse og rummenes bounds/meshes. Intet gættes: en væg
  // uden geometri eller etage tæller ikke med; et rum uden bounds får ingen vægge.
  // Dækket over et rum: grænsen «top», ellers det nærmeste gulv/tag over rummets midte, målt i punkter i rummets plan, så huller
  // i dækket og lave rum tæller rigtigt. Dækket skal dække over 30 % af rummet.
  function findDaekOver(r, daekEl) {
    var zMin = r.b.z0 + (r.b.z1 - r.b.z0) * 0.5;
    var kand = daekEl.filter(function (d) { return d.b.z1 > zMin && overlapXY(d.b, r.b, 0); });
    if (!kand.length) return null;
    var pts = proevePunkter(r.ringe, r.b), antal = {};
    pts.forEach(function (p) {
      var bedst = null, z = Infinity;
      kand.forEach(function (d) { var v = zVed(d, p[0], p[1]); if (v && v.min > zMin && v.min < z) { z = v.min; bedst = d; } });
      if (bedst) antal[bedst.id] = (antal[bedst.id] || 0) + 1;
    });
    var over = null, flest = 0;
    kand.forEach(function (d) { if ((antal[d.id] || 0) > flest || (over && antal[d.id] === flest && d.b.z0 < over.b.z0)) { flest = antal[d.id]; over = d; } });
    return over && flest / pts.length > 0.3 ? over : null;
  }
  // Gulvet under rummet: grænsen «bund», ellers det øverste gulv lige under rummets bund.
  function findGulvUnder(r, daekEl) {
    var kand = daekEl.filter(function (d) { return d.b.z0 < r.b.z0 + 0.5 && d.b.z1 > r.b.z0 - 1.5 && overlapXY(d.b, r.b, 0); });
    if (!kand.length) return null;
    var pts = proevePunkter(r.ringe, r.b), antal = {};
    pts.forEach(function (p) {
      var bedst = null, z = -Infinity;
      kand.forEach(function (d) { var v = zVed(d, p[0], p[1]); if (v && v.max < r.b.z0 + 0.5 && v.max > z) { z = v.max; bedst = d; } });
      if (bedst) antal[bedst.id] = (antal[bedst.id] || 0) + 1;
    });
    var ud = null, flest = 0;
    kand.forEach(function (d) { if ((antal[d.id] || 0) > flest) { flest = antal[d.id]; ud = d; } });
    return ud && flest / pts.length > 0.3 ? ud : null;
  }
  function andelDaekket(a, b, punkter) {
    if (!overlapXY(a.b, b.b, 0)) return 0;
    var n = 0;
    punkter.forEach(function (p) { if (zVed(b, p[0], p[1])) n++; });
    return n / punkter.length;
  }
  function geometri(model) {
    var els = (model && model.elements) || [], rooms = (model && model.rooms) || [];
    var vaegge = [], daekEl = [], aabn = [], byId = {}, etageZ = {}, typer = {};
    ((model && model.types) || []).forEach(function (t) { if (t && t.id != null) typer[t.id] = t; });
    els.forEach(function (e) {
      if (!e || e.erRum || e.installation) return;   // en rørføring under dækket må ikke flytte etagens kote
      byId[e.id] = e;
      var b = bboxAf(e.meshes); if (!b) return;
      if (e.level != null && (etageZ[e.level] == null || b.z0 < etageZ[e.level])) etageZ[e.level] = b.z0;
      if (VAEG_KAT[e.category]) {
        var dx = b.x1 - b.x0, dy = b.y1 - b.y0, ov = dx >= dy, vl = vaegLinje(e.meshes, b);
        vaegge.push({ id: e.id, uniqueId: e.uniqueId, navn: (e.name || e.type || "Væg") + "", type: e.type || "", etage: e.level == null ? null : String(e.level),
          retning: ov ? "ov" : "ns", vinkel: vl.vinkel, p0: vl.p0, p1: vl.p1, laengde: r1(vl.laengde), tykkelse: vl.tykkelse, b: b,
          cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, linje: ov ? r1((b.y0 + b.y1) / 2) : r1((b.x0 + b.x1) / 2),
          aabninger: [], el: e, skoen: skoenVaegtype(e.type || e.name, typer[e.typeId] && typer[e.typeId].layers) });
      } else if (DAEK_KAT[e.category]) {
        var dele = deleEllerBoks(e.meshes, b);
        daekEl.push({ id: e.id, uniqueId: e.uniqueId, navn: (e.name || e.type || "Dæk") + "", etage: e.level == null ? null : String(e.level), erTag: e.category === "Tage", b: b, el: e,
          flader: fladeTrekanter(e.meshes), dele: dele, ringe: ringeAf(dele), tagform: tagform(e.meshes) });
      } else if (AABNING_KAT[e.category]) {
        aabn.push({ id: e.id, hostId: e.hostId, b: b, kategori: e.category });
      }
    });
    var vaegById = {};
    vaegge.forEach(function (w) { vaegById[w.id] = w; });
    // Døre og vinduer: bredden langs værtsvæggen
    aabn.forEach(function (a) {
      var w = a.hostId != null ? vaegById[a.hostId] : null;
      if (!w) return;
      var bredde = w.retning === "ov" ? a.b.x1 - a.b.x0 : a.b.y1 - a.b.y0;
      if (bredde > 0) w.aabninger.push({ id: a.id, bredde: r1(bredde), kategori: a.kategori });
    });
    vaegge.forEach(function (w) {
      w.aabning = r1(w.aabninger.reduce(function (s, a) { return s + a.bredde; }, 0));
      w.effektiv = r1(Math.max(0, w.laengde - w.aabning));
    });
    // Etager efter højde (laveste først)
    var etager = Object.keys(etageZ).sort(function (a, b) { return etageZ[a] - etageZ[b]; });
    var etageIdx = {};
    etager.forEach(function (n, i) { etageIdx[n] = i; });
    // Rum med bounds; vægge, der afgrænser rummet (graenser først, ellers geometri)
    var rumListe = rooms.map(function (r) {
      var b = bboxFraBounds(r.bounds) || bboxAf(r.meshes);
      var etage = r.level == null ? null : String(r.level);
      var vaegIds = [];
      var graenser = Array.isArray(r.graenser) ? r.graenser : [];
      graenser.forEach(function (g) { if (g && g.side !== "top" && g.side !== "bund" && vaegById[g.id] && vaegIds.indexOf(g.id) < 0) vaegIds.push(g.id); });
      if (!vaegIds.length && b) vaegge.forEach(function (w) { if ((etage == null || w.etage === etage) && overlapXY(w.b, b, TOL)) vaegIds.push(w.id); });
      var rd = deleEllerBoks(r.meshes, b);
      return { id: r.id, uniqueId: r.uniqueId, navn: ((r.number ? r.number + " " : "") + (r.name || "Rum")).trim(), etage: etage, b: b, vaegge: vaegIds, graenser: graenser, rum: r,
        dele: rd, ringe: ringeAf(rd) };
    });
    var rumById = {};
    rumListe.forEach(function (r) { rumById[r.id] = r; });
    var daekElById = {};
    daekEl.forEach(function (d) { daekElById[d.id] = d; });
    // Dækket over og gulvet under hvert rum
    var over = {}, rumPaa = {};
    rumListe.forEach(function (r) {
      var o = null, u = null;
      r.graenser.forEach(function (g) {
        if (!g || !daekElById[g.id]) return;
        if (!o && g.side === "top") o = daekElById[g.id];
        if (!u && g.side === "bund") u = daekElById[g.id];
      });
      if (!o && r.b) o = findDaekOver(r, daekEl);
      if (!u && r.b) u = findGulvUnder(r, daekEl);
      over[r.id] = o;
      if (u) rumPaa[u.id] = (rumPaa[u.id] || []).concat([r.id]);
    });
    var daekOverRum = {};
    rumListe.forEach(function (r) { var o = over[r.id]; if (o) daekOverRum[o.id] = (daekOverRum[o.id] || []).concat([r.id]); });
    // Et gulv uden rum eller dæk over sig og med noget under sig er et tag, også når det er tegnet som gulv.
    daekEl.forEach(function (d) {
      if (d.erTag) return;
      var pts = proevePunkter(d.ringe, d.b, 10);
      var daekOver = daekEl.some(function (e) { return e !== d && e.b.z0 >= d.b.z1 - 0.02 && andelDaekket(d, e, pts) > 0.1; });
      var daekUnder = daekEl.some(function (e) { return e !== d && e.b.z1 <= d.b.z0 + 0.02 && andelDaekket(d, e, pts) > 0.1; });
      if (!rumPaa[d.id] && !daekOver && (daekOverRum[d.id] || daekUnder)) d.erTag = true;
    });
    // Rummet under dækket afgør, hvilken etage dækket vises på i planen.
    daekEl.forEach(function (d) {
      var antal = {}, bedst = null;
      (daekOverRum[d.id] || []).forEach(function (id) { var et = rumById[id].etage; if (et != null) antal[et] = (antal[et] || 0) + 1; });
      Object.keys(antal).forEach(function (et) { if (bedst == null || antal[et] > antal[bedst]) bedst = et; });
      var i = d.etage == null ? null : etageIdx[d.etage];
      d.etageUnder = bedst != null ? bedst : (i ? etager[i - 1] : d.etage);
    });
    // På øverste etage uden gulv ovenover er det taget (også når taget ikke er tegnet).
    var daek = [];
    rumListe.forEach(function (r) {
      var o = over[r.id];
      var oeverst = r.etage == null || etageIdx[r.etage] === etager.length - 1;
      var erTag = o ? o.erTag : oeverst;
      var d2 = { id: "daek:" + r.id, rumId: r.id, elementId: o ? o.id : null, erTag: erTag, etage: r.etage,
        navn: (erTag ? "Tag over " : o ? "Etageadskillelse over " : "Dæk over ") + r.navn,
        bredde: r.b ? r1(r.b.x1 - r.b.x0) : null, dybde: r.b ? r1(r.b.y1 - r.b.y0) : null, vaegge: r.vaegge };
      r.daek = d2;
      daek.push(d2);
    });
    // Terrændæk: gulve på nederste etage, som intet rum har som dæk over sig
    var terraen = {};
    daekEl.forEach(function (d) {
      if (d.erTag || daekOverRum[d.id]) return;
      if (d.etage == null || etageIdx[d.etage] === 0) terraen[d.id] = true;
    });
    // Vægge nedenunder (til «ned til fundamentet»): samme retning, samme linje, overlap langs væggen
    vaegge.forEach(function (w) {
      w.under = [];
      if (w.etage == null || !etageIdx[w.etage]) return;
      var underEtage = etager[etageIdx[w.etage] - 1];
      vaegge.forEach(function (v) {
        if (v.etage !== underEtage || v.retning !== w.retning || Math.abs(v.linje - w.linje) > LINJE_TOL) return;
        var o = w.retning === "ov" ? Math.min(w.b.x1, v.b.x1) - Math.max(w.b.x0, v.b.x0) : Math.min(w.b.y1, v.b.y1) - Math.max(w.b.y0, v.b.y0);
        if (o >= Math.min(w.laengde, v.laengde) * 0.5) w.under.push(v.id);
      });
    });
    return { vaegge: vaegge, vaegById: vaegById, daek: daek, daekEl: daekEl, daekElById: daekElById, daekOverRum: daekOverRum, terraen: terraen,
      rum: rumListe, rumById: rumById, etager: etager, etageIdx: etageIdx, byId: byId, vaegCache: {} };
  }

  /* ---------- Dæk for et valg ---------- */
  // Hvad brugeren har peget på: et rum → dækket over rummet; et gulv mellem to etager → væggene nedenunder, dvs.
  // rummene under gulvet; alle et rums vægge → rummets dæk; et terrændæk → besked (ingen spændretning).
  // Er et rum valgt (eller alle dets vægge), er dets gulv og dæk ikke et valg af hele dækket: mindmappet vælger rummets
  // vægge, gulv og dæk sammen. daekEl er dækkene, brugeren har peget direkte på; rum er rummene.
  function daekForValg(geo, ids) {
    var daek = [], set = {}, terraen = false, vaegIds = [], daekEl = [], rum = [], gulve = [];
    function tilfoejRum(r) { if (r && r.daek && !set[r.daek.id]) { set[r.daek.id] = 1; daek.push(r.daek); rum.push(r.id); } }
    (ids || []).forEach(function (id) {
      if (geo.rumById[id]) tilfoejRum(geo.rumById[id]);
      else if (geo.vaegById[id]) vaegIds.push(id);
      else if (geo.terraen[id] || geo.daekElById[id]) gulve.push(id);
    });
    if (vaegIds.length) geo.rum.forEach(function (r) { if (r.vaegge.length && r.vaegge.every(function (v) { return vaegIds.indexOf(v) >= 0; })) tilfoejRum(r); });
    var egne = {};
    rum.forEach(function (rid) {
      var r = geo.rumById[rid];
      r.graenser.forEach(function (g) { if (g && g.side === "bund") egne[g.id] = 1; });
      if (r.daek && r.daek.elementId != null) egne[r.daek.elementId] = 1;
    });
    gulve.forEach(function (id) {
      if (egne[id]) return;
      if (geo.terraen[id]) { terraen = true; return; }
      daekEl.push(id);
      (geo.daekOverRum[id] || []).forEach(function (rid) { var d = geo.rumById[rid] && geo.rumById[rid].daek; if (d && !set[d.id]) { set[d.id] = 1; daek.push(d); } });
    });
    return { daek: daek, terraen: terraen, vaegge: vaegIds, daekEl: daekEl, rum: rum };
  }

  /* ---------- Felter: hele dækket, ét felt pr. rum eller egne felter ---------- */
  function rumUnder(geo, daekId) { return (geo.daekOverRum[daekId] || []).map(function (id) { return geo.rumById[id]; }).filter(function (r) { return r && r.dele.length; }); }
  function daekValg(valg, daekId) { return (valg && valg.daek && valg.daek[daekId]) || {}; }
  function metodeFor(geo, valg, daekId, foretrukket) {
    var m = daekValg(valg, daekId).metode;
    if (METODER[m]) return m;
    var spaend = (valg && valg.spaend) || {};
    if (rumUnder(geo, daekId).some(function (r) { return retningAf(spaend[r.id]); })) return "rum";
    return METODER[foretrukket] ? foretrukket : "hele";
  }
  // Væggene under et felt: de står under dækket, når dækket, og deres side rører feltet.
  function vaeggeUnder(geo, noegle, ringe, zU) {
    if (geo.vaegCache[noegle]) return geo.vaegCache[noegle];
    var b = ringeBoks(ringe), ud = [];
    geo.vaegge.forEach(function (w) {
      if (zU != null && !(w.b.z0 < zU - 0.1 && w.b.z1 >= zU - VAEG_RAEK_TOL)) return;
      var tol = w.tykkelse / 2 + 0.15;
      if (w.b.x1 < b.x0 - tol || w.b.x0 > b.x1 + tol || w.b.y1 < b.y0 - tol || w.b.y0 > b.y1 + tol) return;
      var N = Math.max(5, Math.min(60, Math.ceil(w.laengde / 0.4))), n = 0;
      for (var i = 0; i < N; i++) {
        var t = (i + 0.5) / N, x = w.p0[0] + (w.p1[0] - w.p0[0]) * t, y = w.p0[1] + (w.p1[1] - w.p0[1]) * t;
        if (pktIRinge(ringe, x, y) || afstandRinge(ringe, x, y) <= tol) n++;
      }
      if (n / N * w.laengde >= Math.min(1, w.laengde * 0.3)) ud.push(w.id);
    });
    geo.vaegCache[noegle] = ud;
    return ud;
  }
  function rumFelt(geo, valg, r) {
    var spaend = (valg && valg.spaend) || {}, d = r.daek, el = d.elementId != null ? geo.daekElById[d.elementId] : null;
    var rd = r.dele.length ? r.dele : [{ ringe: [rektangel(r.b)], areal: 0 }];
    return { id: "rum:" + r.id, type: "rum", daekId: d.elementId, rumId: r.id, navn: d.navn, kortNavn: r.navn, dele: rd, ringe: ringeAf(rd), z: el ? el.b.z1 : r.b.z1, zU: el ? el.b.z0 : null,
      retning: retningAf(spaend[r.id]), erTag: d.erTag, etage: r.etage, tagform: el ? el.tagform || null : null,
      vaegge: el ? r.vaegge.filter(function (id) { var w = geo.vaegById[id]; return w.b.z1 >= el.b.z0 - VAEG_RAEK_TOL; }) : r.vaegge };
  }
  // Felterne på ét dæk, også dem uden retning. metode kan gives for at vise en bestemt opdeling.
  function feltListe(geo, valg, daekId, metode) {
    var d = geo.daekElById[daekId];
    if (!d || geo.terraen[daekId]) return [];
    var m = metode || metodeFor(geo, valg, daekId), v = daekValg(valg, daekId);
    if (m === "rum") return rumUnder(geo, daekId).map(function (r) { return rumFelt(geo, valg, r); });
    if (m === "egne") return (v.egne || []).map(function (f) {
      var ringe = [f.polygon];
      return { id: f.id, type: "egen", daekId: d.id, navn: f.navn, kortNavn: f.navn, dele: [{ ringe: ringe, areal: arealRing(f.polygon) }], ringe: ringe, z: d.b.z1, zU: d.b.z0, retning: retningAf(f), erTag: d.erTag, etage: d.etageUnder, tagform: d.tagform || null,
        vaegge: vaeggeUnder(geo, f.id + "|" + JSON.stringify(f.polygon), ringe, d.b.z0) };
    });
    return [{ id: "hele:" + d.id, type: "hele", daekId: d.id, navn: d.navn, kortNavn: "Hele dækket", dele: d.dele, ringe: d.ringe, z: d.b.z1, zU: d.b.z0, retning: retningAf(v.hele), erTag: d.erTag, etage: d.etageUnder,
      tagform: d.tagform || null, tag: d.tagform && d.erTag && TAGTYPER[v.tag] ? v.tag : null,
      vaegge: vaeggeUnder(geo, "hele:" + d.id, d.ringe, d.b.z0) }];
  }
  function alleFelter(geo, valg) {
    var ud = [];
    geo.daekEl.forEach(function (d) { ud = ud.concat(feltListe(geo, valg, d.id)); });
    geo.rum.forEach(function (r) { if (r.daek && r.daek.elementId == null && r.b) ud.push(rumFelt(geo, valg, r)); });
    return ud;
  }
  function definerede(geo, valg) { return alleFelter(geo, valg).filter(function (f) { return f.retning; }); }
  // Ét ydre omrids og dets huller som én ring: hvert hul kobles til det ydre med en sømlinje, så areal og «punkt i polygon» stadig passer.
  function somRing(ringe) {
    var ud = ringe[0].slice();
    ringe.slice(1).forEach(function (h) {
      var bedstI = 0, bedstJ = 0, min = Infinity;
      ud.forEach(function (p, i) { h.forEach(function (q, j) { var d = (p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]); if (d < min) { min = d; bedstI = i; bedstJ = j; } }); });
      var hul = h.slice(bedstJ).concat(h.slice(0, bedstJ)), o = ud[bedstI];
      ud = ud.slice(0, bedstI + 1).concat(hul, [hul[0], o], ud.slice(bedstI + 1));
    });
    return ud;
  }
  // Det, andre dele af 3D læser: hvert defineret felt med én ring. Et dæk af flere adskilte dele giver ét felt pr. del.
  function felter(geo, valg) {
    var ud = [];
    definerede(geo, valg).forEach(function (f) {
      f.dele.forEach(function (del, i) {
        ud.push({ id: i ? f.id + ":" + i : f.id, kilde: f.id, type: f.type, daekId: f.daekId, navn: f.navn,
          polygon: somRing(del.ringe), ringe: del.ringe, z: f.z, vinkelGrader: f.retning.vinkelGrader, begge: f.retning.begge,
          areal: Math.round(Math.abs(del.ringe.reduce(function (s, r) { return s + arealRing(r); }, 0)) * 10) / 10, etage: f.etage, rumId: f.rumId == null ? null : f.rumId, erTag: !!f.erTag,
          skraa: !!f.tagform, tag: f.tag || null,
          vaegge: f.type === "hele" && f.dele.length > 1 ? vaeggeUnder(geo, f.id + "#" + i, del.ringe, geo.daekElById[f.daekId].b.z0) : f.vaegge });
      });
    });
    return ud;
  }

  /* ---------- Ændringer af felterne (ren logik; panelet gemmer bagefter) ---------- */
  function sikrDaek(valg, daekId) { valg.daek = valg.daek || {}; return valg.daek[daekId] || (valg.daek[daekId] = {}); }
  function saetMetode(geo, valg, daekId, metode) {
    if (!METODER[metode]) return;
    var gl = metodeFor(geo, valg, daekId), v = sikrDaek(valg, daekId), spaend = valg.spaend || (valg.spaend = {});
    if (metode === "rum" && gl === "hele" && retningAf(v.hele)) rumUnder(geo, daekId).forEach(function (r) { if (!retningAf(spaend[r.id])) spaend[r.id] = v.hele; });
    if (metode === "hele" && gl === "rum" && !retningAf(v.hele)) {
      var koder = unik(rumUnder(geo, daekId).map(function (r) { return JSON.stringify(retningAf(spaend[r.id])); }));
      if (koder.length === 1 && koder[0] !== "null") v.hele = retningLager(JSON.parse(koder[0]));
    }
    v.metode = metode;
  }
  // Tagets konstruktion for et tag med hældning (type = null fjerner valget, så taget igen regnes som et dæk). Spærene spænder
  // på tværs af kippen, så retningen sættes ud fra tagets egen form, når den ikke er valgt, eller står til «begge veje».
  function saetTag(geo, valg, daekId, type) {
    var d = geo.daekElById[daekId];
    if (!d || !d.tagform || !d.erTag) return false;
    var v = sikrDaek(valg, daekId);
    if (!TAGTYPER[type]) { delete v.tag; return true; }
    v.tag = type; v.metode = "hele";
    var r = retningAf(v.hele);
    if (!r || r.begge) v.hele = retningLager({ vinkelGrader: d.tagform.akse, begge: false });
    return true;
  }
  // Kort tekst om tagets form: «Taget hælder 18° og har kip øst–vest. Spærene spænder nord–syd.»
  function tagTekst(form) {
    if (!form) return "";
    var spaend = retningTekst({ vinkelGrader: form.akse, begge: false }), kip = retningTekst({ vinkelGrader: vinkelNorm(form.akse + 90), begge: false });
    return "Taget hælder " + dk(form.haeldning, 0) + "°" + (form.ensidig ? " til én side" : form.kip ? " og har kip " + kip : "") + ". Spærene spænder " + spaend + ".";
  }
  // retning: 'ov' | 'ns' | 'begge' | tal | { vinkelGrader, begge } | null (ikke angivet)
  function saetRetning(geo, valg, feltId, retning) {
    var dele = String(feltId).split(":"), r = retningAf(retning), lager = retningLager(r);
    if (dele[0] === "hele") { var v = sikrDaek(valg, dele[1]); v.hele = lager; v.metode = "hele"; return; }
    if (dele[0] === "rum") {
      var spaend = valg.spaend || (valg.spaend = {}), rum = geo.rumById[dele[1]];
      if (!rum) return;
      if (lager) spaend[rum.id] = lager; else delete spaend[rum.id];
      if (rum.daek && rum.daek.elementId != null) sikrDaek(valg, rum.daek.elementId).metode = "rum";
      return;
    }
    if (dele[0] === "egen") {
      var f = (sikrDaek(valg, dele[1]).egne || []).filter(function (x) { return x.id === feltId; })[0];
      if (f) { f.vinkelGrader = r ? r.vinkelGrader : null; f.begge = r ? r.begge : false; }
    }
  }
  function krydser(a, b, c, d) {
    function s(p, q, r) { return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); }
    var s1 = s(a, b, c), s2 = s(a, b, d), s3 = s(c, d, a), s4 = s(c, d, b);
    return ((s1 > 1e-9 && s2 < -1e-9) || (s1 < -1e-9 && s2 > 1e-9)) && ((s3 > 1e-9 && s4 < -1e-9) || (s3 < -1e-9 && s4 > 1e-9));
  }
  // Et felt tegnet i planen. Giver { ok, felt } eller { fejl }.
  function tilfoejFelt(geo, valg, daekId, punkter, navn) {
    if (!geo.daekElById[daekId] || geo.terraen[daekId]) return { fejl: "Vælg først et dæk." };
    var p = (punkter || []).map(function (q) { return [Math.round(q[0] * 1000) / 1000, Math.round(q[1] * 1000) / 1000]; });
    if (p.length >= 2 && Math.abs(p[0][0] - p[p.length - 1][0]) < 1e-3 && Math.abs(p[0][1] - p[p.length - 1][1]) < 1e-3) p.pop();
    if (p.length < 3) return { fejl: "Et felt skal have mindst tre hjørner." };
    for (var i = 0; i < p.length; i++) for (var j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      if (krydser(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])) return { fejl: "Feltets kanter krydser hinanden. Tegn det igen." };
    }
    if (Math.abs(arealRing(p)) < 0.25) return { fejl: "Feltet er for lille." };
    if (arealRing(p) < 0) p.reverse();
    var v = sikrDaek(valg, daekId), liste = v.egne || (v.egne = []), n = 1;
    while (liste.some(function (f) { return f.id === "egen:" + daekId + ":" + n; })) n++;
    var felt = { id: "egen:" + daekId + ":" + n, navn: (navn || "").trim() || "Felt " + n, polygon: p, vinkelGrader: null, begge: false };
    liste.push(felt);
    v.metode = "egne";
    return { ok: true, felt: felt };
  }
  function fjernFelt(valg, feltId) {
    var dele = String(feltId).split(":"), v = daekValg(valg, dele[1]);
    if (v.egne) v.egne = v.egne.filter(function (f) { return f.id !== feltId; });
  }
  function omdoebFelt(valg, feltId, navn) {
    var dele = String(feltId).split(":"), f = (daekValg(valg, dele[1]).egne || []).filter(function (x) { return x.id === feltId; })[0];
    if (f && String(navn || "").trim()) f.navn = String(navn).trim();
  }
  // Hvor godt egne felter dækker dækket: andel uden felt og par af felter, der overlapper.
  function daekning(geo, valg, daekId) {
    var d = geo.daekElById[daekId], egne = (daekValg(valg, daekId).egne || []);
    if (!d || !egne.length) return { uden: 1, overlap: [] };
    var pts = proevePunkter(d.ringe, d.b, 24), uden = 0, par = {};
    pts.forEach(function (p) {
      var hit = egne.filter(function (f) { return pktIRing(f.polygon, p[0], p[1]); });
      if (!hit.length) uden++;
      for (var i = 0; i < hit.length; i++) for (var j = i + 1; j < hit.length; j++) par[hit[i].navn + " og " + hit[j].navn] = 1;
    });
    return { uden: uden / pts.length, overlap: Object.keys(par) };
  }

  /* ---------- Pile og skravering for et felt ---------- */
  // Intervallerne på en linje (u-retningen, afstand t langs n), hvor linjen er inde i feltet. Små hak fra søjler lukkes.
  function intervaller(ringe, ux, uy, nx, ny, t) {
    var s = [];
    ringe.forEach(function (r) {
      for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
        var d0 = r[j][0] * nx + r[j][1] * ny - t, d1 = r[i][0] * nx + r[i][1] * ny - t;
        if ((d0 <= 0) === (d1 <= 0)) continue;
        var k = d0 / (d0 - d1), x = r[j][0] + (r[i][0] - r[j][0]) * k, y = r[j][1] + (r[i][1] - r[j][1]) * k;
        s.push(x * ux + y * uy);
      }
    });
    s.sort(function (a, b) { return a - b; });
    var ud = [];
    for (var m = 0; m + 1 < s.length; m += 2) {
      if (ud.length && s[m] - ud[ud.length - 1][1] < 0.4) ud[ud.length - 1][1] = s[m + 1];
      else ud.push([s[m], s[m + 1]]);
    }
    return ud;
  }
  // Pile og skravering langs spændretningen, fælles for 3D og planen.
  function feltGrafik(felt) {
    var pile = [], skravering = [], r = felt.retning || (felt.vinkelGrader != null ? { vinkelGrader: felt.vinkelGrader, begge: !!felt.begge } : null);
    if (!r) return { pile: pile, skravering: skravering, tekst: null };
    var retninger = r.begge ? [r.vinkelGrader, vinkelNorm(r.vinkelGrader + 90)] : [r.vinkelGrader];
    var tekst = null, bedstL = 0;
    (felt.dele || [{ ringe: felt.ringe }]).forEach(function (del) {
      retninger.forEach(function (a) {
        var ux = cosG(a), uy = sinG(a), nx = a === 0 ? 0 : -uy, ny = ux, t0 = Infinity, t1 = -Infinity;
        del.ringe.forEach(function (ring) { ring.forEach(function (p) { var t = p[0] * nx + p[1] * ny; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }); });
        var W = t1 - t0, raekker = Math.max(1, Math.round(W / 9));
        for (var k = 0; k < raekker; k++) {
          var t = t0 + (k + 0.5) / raekker * W, iv = intervaller(del.ringe, ux, uy, nx, ny, t);
          var maks = iv.reduce(function (m, x) { return Math.max(m, x[1] - x[0]); }, 0);
          iv.forEach(function (x) {
            var L = x[1] - x[0];
            if (L < Math.min(1, maks * 0.5) || L <= 0) return;
            var m = Math.max(1, Math.round(L / 12)), lp = Math.min(L / m * 0.7, 7);
            for (var q = 0; q < m; q++) {
              var mid = x[0] + (q + 0.5) / m * L;
              pile.push({ x1: (mid - lp / 2) * ux + t * nx, y1: (mid - lp / 2) * uy + t * ny, x2: (mid + lp / 2) * ux + t * nx, y2: (mid + lp / 2) * uy + t * ny, dobbelt: true, feltId: felt.id, rumId: felt.rumId });
              if (L > bedstL) { bedstL = L; tekst = { x: mid * ux + t * nx, y: mid * uy + t * ny, laengde: lp }; }
            }
          });
        }
        var afst = Math.max(1, W / 110);
        for (var h = 0.5; h * afst < W; h++) {
          intervaller(del.ringe, ux, uy, nx, ny, t0 + h * afst).forEach(function (x) {
            skravering.push({ x1: x[0] * ux + (t0 + h * afst) * nx, y1: x[0] * uy + (t0 + h * afst) * ny, x2: x[1] * ux + (t0 + h * afst) * nx, y2: x[1] * uy + (t0 + h * afst) * ny });
          });
        }
      });
    });
    return { pile: pile, skravering: skravering, tekst: tekst };
  }
  // En dobbeltpil som flade trekanter i planet: [x, y, x, y, ...], tre punkter pr. trekant.
  function pilTrekanter(p, bredde, hovedL, hovedB) {
    var dx = p.x2 - p.x1, dy = p.y2 - p.y1, L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    var hl = Math.min(hovedL, L * 0.32), hb = Math.min(hovedB, L * 0.32) / 2, b = bredde / 2;
    function P(s, t) { return [p.x1 + ux * s + nx * t, p.y1 + uy * s + ny * t]; }
    var ud = [];
    function trekant(a, c, e) { ud.push(a[0], a[1], c[0], c[1], e[0], e[1]); }
    trekant(P(hl, -b), P(L - hl, -b), P(L - hl, b));
    trekant(P(hl, -b), P(L - hl, b), P(hl, b));
    trekant(P(L, 0), P(L - hl, hb), P(L - hl, -hb));
    trekant(P(0, 0), P(hl, -hb), P(hl, hb));
    return ud;
  }

  /* ---------- Fang: punkter i planen falder på vægge, rum og dæk ---------- */
  // sidste: forrige hjørne. Er man tæt på samme x eller y som det, låses kanten vandret eller lodret.
  function fang(geo, etage, x, y, tol, ekstra, sidste) {
    var punkter = [], linjer = [];
    geo.vaegge.forEach(function (w) { if (w.etage === etage) { punkter.push(w.p0, w.p1); linjer.push([w.p0, w.p1]); } });
    function ringe(R) { R.forEach(function (r) { r.forEach(function (p, i) { punkter.push(p); linjer.push([r[(i + r.length - 1) % r.length], p]); }); }); }
    geo.rum.forEach(function (r) { if (r.etage === etage) ringe(r.ringe); });
    geo.daekEl.forEach(function (d) { if (d.etageUnder === etage) ringe(d.ringe); });
    (ekstra || []).forEach(function (r) { ringe([r]); });
    var bedst = null, min = tol;
    punkter.forEach(function (p) { var d = Math.sqrt((p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y)); if (d < min) { min = d; bedst = { x: p[0], y: p[1], slags: "punkt" }; } });
    if (bedst) return bedst;
    min = tol * 0.7;
    linjer.forEach(function (l) {
      var ex = l[1][0] - l[0][0], ey = l[1][1] - l[0][1], L2 = ex * ex + ey * ey; if (!L2) return;
      var t = Math.max(0, Math.min(1, ((x - l[0][0]) * ex + (y - l[0][1]) * ey) / L2)), px = l[0][0] + t * ex, py = l[0][1] + t * ey, d = Math.sqrt((px - x) * (px - x) + (py - y) * (py - y));
      if (d < min) { min = d; bedst = { x: px, y: py, slags: "linje" }; }
    });
    var ud = bedst || { x: x, y: y, slags: null };
    if (sidste) {
      if (Math.abs(ud.x - sidste[0]) < tol * 0.7) ud.x = sidste[0];
      if (Math.abs(ud.y - sidste[1]) < tol * 0.7) ud.y = sidste[1];
    }
    return ud;
  }

  /* ---------- «Hjælp mig med at vælge»: korteste vej ---------- */
  function foreslaa(daek) {
    if (!daek || daek.bredde == null || daek.dybde == null) return { retning: null, hvorfor: daek ? daek.navn + " har ingen mål, så der kan ikke foreslås en spændretning." : "" };
    var w = daek.bredde, d = daek.dybde, sp = w < d ? "ov" : (d < w ? "ns" : "begge");
    return { retning: sp, hvorfor: daek.navn + " dækker " + dk(w) + " m øst–vest og " + dk(d) + " m nord–syd. Et dæk spænder normalt den korteste vej, så " + RETNING[sp] + "." };
  }
  // Hovedretningen for et omrids eller en samling vægge: den vinkel (0–90), hvor flest meter ligger.
  function hovedakse(maal) {
    var spand = {}, vaegt = {}, bedst = null;
    maal.forEach(function (m) {
      var a = ((m[0] % 90) + 90) % 90; if (a >= 89.5) a -= 90;
      var k = Math.round(a);
      spand[k] = (spand[k] || 0) + m[1]; vaegt[k] = (vaegt[k] || 0) + m[1] * a;
    });
    Object.keys(spand).forEach(function (k) { if (bedst == null || spand[k] > spand[bedst]) bedst = k; });
    if (bedst == null) return 0;
    var v = Math.round(vaegt[bedst] / spand[bedst] * 10) / 10;
    return Math.abs(v) < 1 ? 0 : (v + 90) % 90;
  }
  function feltAkse(felt) {
    var m = [];
    felt.dele.forEach(function (d) {
      var r = d.ringe[0];
      for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
        var ex = r[i][0] - r[j][0], ey = r[i][1] - r[j][1], L = Math.sqrt(ex * ex + ey * ey);
        if (L > 0.01) m.push([vinkelNorm(Math.atan2(ey, ex) * 180 / Math.PI), L]);
      }
    });
    return hovedakse(m);
  }
  // Som foreslaa, men for et felt af enhver form og også på en skæv bygning.
  function foreslaaFelt(felt) {
    // Et tag med hældning spænder på tværs af kippen, ikke den korteste vej.
    if (felt.tagform && felt.erTag && felt.type === "hele") {
      var rt = { vinkelGrader: felt.tagform.akse, begge: false };
      return { retning: rt, hvorfor: felt.navn + " hælder " + dk(felt.tagform.haeldning, 0) + "°. Spærene spænder på tværs af kippen, så " + retningTekst(rt) + "." };
    }
    var a = feltAkse(felt), ux = cosG(a), uy = sinG(a), s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    felt.ringe.forEach(function (r) { r.forEach(function (p) { var s = p[0] * ux + p[1] * uy, t = -p[0] * uy + p[1] * ux; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }); });
    var w = s1 - s0, d = t1 - t0;
    if (a === 0) return foreslaa({ navn: felt.navn, bredde: r1(w), dybde: r1(d) });
    var r = Math.abs(w - d) < 0.05 * Math.max(w, d) ? { vinkelGrader: a, begge: true } : w < d ? { vinkelGrader: a, begge: false } : { vinkelGrader: vinkelNorm(a + 90), begge: false };
    return { retning: r, hvorfor: felt.navn + " er ca. " + dk(w) + " m den ene vej og " + dk(d) + " m den anden. Et dæk spænder normalt den korteste vej, så " + retningTekst(r) + "." };
  }
  // Skæve vægge under et felt: { langs, tvaers } i grader, når væggene ikke står øst–vest eller nord–syd; ellers null.
  function vaegAkse(geo, felt) {
    var m = felt.vaegge.map(function (id) { var w = geo.vaegById[id]; return w ? [w.vinkel, w.laengde] : null; }).filter(Boolean);
    if (!m.length) return null;
    var a = hovedakse(m);
    return a === 0 ? null : { langs: a, tvaers: vinkelNorm(a + 90) };
  }
  // Foreslår den korteste vej for alle felter uden retning. Et dæk uden valg deles efter rummene under det.
  function foreslaaAlle(geo, valg) {
    var n = 0;
    function saet(f) { if (f.retning) return; var s = f.type === "rum" && f.daekId == null ? foreslaa(geo.rumById[f.rumId].daek) : foreslaaFelt(f); if (s.retning) { saetRetning(geo, valg, f.id, s.retning); n++; } }
    geo.daekEl.forEach(function (d) {
      if (geo.terraen[d.id]) return;
      var v = daekValg(valg, d.id), m = metodeFor(geo, valg, d.id);
      if (!v.metode && m === "hele" && !retningAf(v.hele) && rumUnder(geo, d.id).length) { feltListe(geo, valg, d.id, "rum").forEach(saet); return; }
      feltListe(geo, valg, d.id).forEach(saet);
    });
    geo.rum.forEach(function (r) { if (r.daek && r.daek.elementId == null && r.b) saet(rumFelt(geo, valg, r)); });
    return n;
  }

  /* ---------- Tag med hældning: hvilke vægge hviler taget på ---------- */
  // Hvor langt der er fra et punkt til feltets kant, målt langs spændretningen (den korteste af de to veje ud).
  function afstandTilKant(ringe, x, y, ux, uy) {
    var nx = -uy, ny = ux, t = x * nx + y * ny, s = x * ux + y * uy, bedst = Infinity;
    intervaller(ringe, ux, uy, nx, ny, t).forEach(function (iv) {
      if (s < iv[0] - 0.3 || s > iv[1] + 0.3) return;
      bedst = Math.min(bedst, Math.max(0, Math.min(s - iv[0], iv[1] - s)));
    });
    return bedst;
  }
  // Står væggen under tagfoden: ved tagets kant i den retning, spærene spænder (over halvdelen af væggen)?
  function underTagfod(f, w) {
    var a = f.retning.vinkelGrader, ux = cosG(a), uy = sinG(a), N = Math.max(5, Math.min(40, Math.ceil(w.laengde / 0.5))), n = 0, tol = TAGFOD_TOL + w.tykkelse / 2;
    for (var i = 0; i < N; i++) {
      var k = (i + 0.5) / N;
      if (afstandTilKant(f.ringe, w.p0[0] + (w.p1[0] - w.p0[0]) * k, w.p0[1] + (w.p1[1] - w.p0[1]) * k, ux, uy) <= tol) n++;
    }
    return n / N >= 0.5;
  }
  // En væg langs kippen og under den, som når op til kippen: kipbjælken kan hvile på den i hele sin længde.
  function underKip(form, w) {
    if (!form.kip || w.b.z1 < form.kip.z - KIP_NAA) return false;
    return afstandSegment((w.p0[0] + w.p1[0]) / 2, (w.p0[1] + w.p1[1]) / 2, form.kip.p0, form.kip.p1) <= KIP_TOL + w.tykkelse / 2;
  }
  // En væg på tværs af kippen, som når op til den: kipbjælken hviler på den, hvis kippens ende ligger ved væggen (en gavl),
  // eller kippen går hen over væggen (en tværvæg). ende: 0 eller 1 for kun at spørge om den ene ende.
  function vedKip(form, w, ende) {
    if (!form.kip || w.b.z1 < form.kip.z - KIP_NAA) return false;
    var tol = KIP_UDHAENG + w.tykkelse / 2, K = form.kip;
    var v0 = afstandSegment(K.p0[0], K.p0[1], w.p0, w.p1) <= tol, v1 = afstandSegment(K.p1[0], K.p1[1], w.p0, w.p1) <= tol;
    if (ende === 0) return v0;
    if (ende === 1) return v1;
    return v0 || v1 || krydser(K.p0, K.p1, w.p0, w.p1);
  }
  // Hviler taget på væggen? { baerer, tekst }. Kun for et helt tag med hældning og en valgt konstruktion.
  function tagRegel(f, w, sp, forskel) {
    var T = TAGTYPER[f.tag], form = f.tagform, paaTvaers = forskel >= 45;
    if (paaTvaers && underTagfod(f, w)) return { baerer: true, tekst: f.navn + ": " + T.kort + " spænder " + sp + " og hviler på væggen, fordi den står under tagfoden." };
    if (f.tag === "kip") {
      if (paaTvaers && underKip(form, w)) return { baerer: true, tekst: f.navn + ": væggen står under kippen og når op til den, så kipbjælken hviler på den." };
      if (!paaTvaers && vedKip(form, w)) return { baerer: true, tekst: f.navn + ": kipbjælken hviler på væggen, fordi den står på tværs af kippen og når op til den." };
    }
    if (paaTvaers) return { baerer: false, tekst: f.navn + ": " + T.kort + " spænder " + sp + " " + T.fri + ", så taget hviler ikke på denne væg inde i huset." };
    return { baerer: false, tekst: f.navn + ": " + T.kort + " spænder " + sp + ", langs væggen, så taget hviler ikke på den." };
  }
  function verdenshjoerne(dx, dy) { return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "øst" : "vest") : (dy >= 0 ? "nord" : "syd"); }
  // Det, der skal huskes i projektet for et tag: konstruktionens egen note, og for kip og spær hvor kipbjælken mangler en væg.
  function tagNoter(geo, f) {
    var ud = [TAGTYPER[f.tag].note], K = f.tagform.kip;
    if (f.tag !== "kip" || !K) return ud;
    var vaegge = f.vaegge.map(function (id) { return geo.vaegById[id]; }).filter(Boolean);
    // En væg under kippen i hele dens længde bærer begge ender.
    if (vaegge.some(function (w) { return vinkelForskel(w.vinkel, f.retning.vinkelGrader) >= 45 && underKip(f.tagform, w) && w.laengde >= 0.6 * Math.sqrt(Math.pow(K.p1[0] - K.p0[0], 2) + Math.pow(K.p1[1] - K.p0[1], 2)); })) return ud;
    [0, 1].forEach(function (ende) {
      if (vaegge.some(function (w) { return vinkelForskel(w.vinkel, f.retning.vinkelGrader) < 45 && vedKip(f.tagform, w, ende); })) return;
      var a = ende ? K.p1 : K.p0, b = ende ? K.p0 : K.p1;
      ud.push("I modellen står der ingen væg under kippens ende mod " + verdenshjoerne(a[0] - b[0], a[1] - b[1]) + ". Dér skal en gavl, en søjle eller en bærende væg bære kipbjælken.");
    });
    return ud;
  }

  /* ---------- Resultat pr. væg ---------- */
  // Spændretningen bestemmer rollen (ejer, 2026-11-14). Et dæk med spændretning hviler på de vægge, der står på tværs af
  // retningen: de er bærende, tunge som lette. En tung væg afstiver desuden i sin egen retning (stabiliserende). En let
  // væg afstiver ikke af sig selv: skal den også stabilisere, skal den have plader på og forankres. Det står som en note
  // ved væggen (noter), så det huskes i projektet. Vægge uden et dæk med spændretning får ingen rolle.
  // valg.rolle (en rolle sat direkte på væggen) læses stadig her, men Statik-panelet tilbyder den ikke og sender den ikke med.
  function vurder(geo, valg) {
    valg = valg || {};
    var vaegtype = valg.vaegtype || {}, rolle = valg.rolle || {};
    var res = {}, hvorfor = {}, afledt = {}, kilde = {}, typeAf = {}, lette = {}, letteMedRolle = {}, noter = {}, skoen = {}, tagnoter = {};
    var feltForVaeg = {};
    definerede(geo, valg).forEach(function (f) {
      f.vaegge.forEach(function (id) { (feltForVaeg[id] || (feltForVaeg[id] = [])).push(f); });
      // Et tag med hældning og en valgt konstruktion: det, der skal huskes i projektet.
      if (f.tag && f.tagform && !f.retning.begge) tagnoter[f.id] = tagNoter(geo, f);
    });
    geo.vaegge.forEach(function (w) {
      // En rettelse af typen vinder; ellers det, der er fundet ud fra opbygningen; ellers tung.
      var valgt = VAEGTYPE[vaegtype[w.id]] ? vaegtype[w.id] : "";
      var type = valgt || (w.skoen && w.skoen.type) || "tung";
      typeAf[w.id] = type;
      if (!valgt && w.skoen) skoen[w.id] = w.skoen;
      var noget = false, baerer = false, rs = [], afstand = 0;
      (feltForVaeg[w.id] || []).forEach(function (f) {
        noget = true;
        if (f.zU != null) afstand = Math.max(afstand, f.zU - w.b.z1);
        var sp = retningTekst(f.retning), forskel = vinkelForskel(w.vinkel, f.retning.vinkelGrader);
        // Et tag med hældning og en valgt konstruktion hviler kun på væggene under tagfoden (og, med kip og spær, dem ved kippen).
        if (f.tag && f.tagform && !f.retning.begge) { var tr = tagRegel(f, w, sp, forskel); if (tr.baerer) baerer = true; rs.push(tr.tekst); return; }
        // Står væggen mere på tværs end på langs af spændretningen, hviler dækket på den, også når væggen er let.
        if (f.retning.begge || forskel >= 45) {
          var paaTvaers = f.retning.begge || forskel >= 75 ? "på tværs af spændretningen" : "mest på tværs af spændretningen";
          baerer = true;
          rs.push(f.navn + " spænder " + sp + " og hviler på væggen, fordi den står " + paaTvaers + ".");
        } else rs.push(f.navn + " spænder " + sp + (forskel <= 15 ? ", parallelt med væggen, så det hviler ikke på den." : ", mest langs væggen, så det hviler ikke på den."));
      });
      var regel = "";
      if (noget) {
        var afstiver = type !== "let";
        if (type === "let") {
          noter[w.id] = baerer ? LET_NOTE.baerer : LET_NOTE.fri;
          rs.push(noter[w.id]);
        } else rs.push({
          tung: "Væggen er tung (beton, murværk), så den kan afstive bygningen i sin egen retning (" + RETNING[w.retning] + ").",
          skive: "Væggen er en let væg med skiveplader, så den kan afstive i sin egen retning (" + RETNING[w.retning] + ")."
        }[type]);
        if (!valgt && w.skoen) rs.push("Typen er fundet ud fra " + w.skoen.grund + ". Ret «Væggens type», hvis det ikke passer.");
        regel = baerer && afstiver ? "begge" : baerer ? "baerende" : afstiver ? "stab" : "ingen";
        if (afstand > VAEG_TAET) rs.push("Væggen slutter " + dk(afstand) + " m under dækket i modellen. Tjek, at den faktisk når op til dækket.");
      }
      afledt[w.id] = regel;
      var egen = VAL[rolle[w.id]] && rolle[w.id] !== "ikke" ? rolle[w.id] : "";
      if (egen) {
        res[w.id] = egen; kilde[w.id] = "rolle";
        hvorfor[w.id] = ["Du har selv defineret væggen som «" + statikTekst(egen) + "»."]
          .concat(regel && regel !== egen ? ["Ud fra spændretningen ville den være «" + statikTekst(regel) + "»."] : []);
        if (type === "let" && (VAL[egen].baerer || VAL[egen].afstiver)) hvorfor[w.id].push("Væggen er let. Skal den bære eller afstive, skal den bygges og eftervises til det. Det afgør ingeniøren.");
      } else if (noget) { res[w.id] = regel; kilde[w.id] = "regel"; hvorfor[w.id] = rs; }
      // En let væg uden en bærende eller afstivende rolle vises som let (gul). Bærer den, får den rollens farve og en gul kant.
      var k = res[w.id];
      if (type === "let") {
        if (k && (VAL[k].baerer || VAL[k].afstiver)) letteMedRolle[w.id] = 1; else lette[w.id] = 1;
      }
    });
    // Filtre: bærende system, og de vægge, der afstiver mod last fra nord (står nord–syd) og fra øst (står øst–vest)
    var filtre = { alle: [], baer: [], nord: [], oest: [] };
    geo.vaegge.forEach(function (w) {
      var k = res[w.id]; if (!k) return;
      filtre.alle.push(w.id);
      if (VAL[k].baerer) filtre.baer.push(w.id);
      if (VAL[k].afstiver) (w.retning === "ns" ? filtre.nord : filtre.oest).push(w.id);
    });
    var antal = {};
    Object.keys(res).forEach(function (id) { if (!lette[id]) antal[res[id]] = (antal[res[id]] || 0) + 1; });
    if (Object.keys(lette).length) antal.let = Object.keys(lette).length;
    if (Object.keys(letteMedRolle).length) antal.letMedRolle = Object.keys(letteMedRolle).length;
    return { res: res, hvorfor: hvorfor, afledt: afledt, kilde: kilde, filtre: filtre, antal: antal, lette: lette, letteMedRolle: letteMedRolle, noter: noter, skoen: skoen, tagnoter: tagnoter,
      vaegtype: function (id) { return typeAf[id] || "tung"; } };
  }

  /* ---------- Farver til 3D ---------- */
  // Uden filter: væggens rolle-farve; i et lasttilfælde: én farve for alle afstivende vægge, og en mørk kant for dem,
  // der også bærer et dæk. Vægge uden resultat (eller uden for filtret) får null = ingen farve.
  function farver(geo, resultat, filter) {
    filter = filtre(filter);
    var ud = {}, kant = {}, lastF = filter === "nord" || filter === "oest";
    var iFilter = {};
    (resultat.filtre[filter] || []).forEach(function (id) { iFilter[id] = 1; });
    var lette = resultat.lette || {}, medRolle = resultat.letteMedRolle || {};
    geo.vaegge.forEach(function (w) {
      var k = resultat.res[w.id];
      if (lette[w.id]) { ud[w.id] = LET_FARVE; return; }
      if (!k) { ud[w.id] = null; return; }
      if (filter !== "alle" && !iFilter[w.id]) { ud[w.id] = null; return; }
      ud[w.id] = lastF ? VAL.stab.farve : farve(k);
      if (lastF && k === "begge") kant[w.id] = KANT_FARVE;
      // En let væg med en rolle: rollens farve og en gul kant, så man stadig ser, at den er let.
      else if (medRolle[w.id]) kant[w.id] = LET_FARVE;
    });
    return { farver: ud, kant: kant, gennemsigtige: filter === "alle" ? [] : geo.vaegge.filter(function (w) { return !iFilter[w.id]; }).map(function (w) { return w.id; }) };
  }
  function filtre(f) { return FILTRE.some(function (x) { return x.id === f; }) ? f : "alle"; }

  function filterTekst(geo, resultat, filter) {
    filter = filtre(filter);
    var F = resultat.filtre, perEtage = function (ids) {
      return geo.etager.map(function (et) {
        var L = ids.filter(function (id) { return geo.vaegById[id].etage === et; }).reduce(function (s, id) { return s + geo.vaegById[id].laengde; }, 0);
        return et + " " + dk(L) + " m";
      }).join(" · ");
    };
    if (!F.alle.length) return "Ingen vægge har farve endnu. Sæt spændretning på et dæk først. Kun væggene under de dæk, du har defineret, får farve.";
    return {
      alle: "Væggene under de dæk, du har givet en spændretning. Lette vægge er gule; andre vægge er grå.",
      baer: F.baer.length ? "Bærende system: " + flertal(F.baer.length, "væg", "vægge") + " bærer de definerede dæk. " + perEtage(F.baer) + "." : "Ingen af de definerede vægge bærer et dæk.",
      nord: F.nord.length ? "Last fra nord, fx vind, skubber bygningen mod syd. Den tages af vægge, der står nord–syd, altså parallelt med lasten: " + flertal(F.nord.length, "væg", "vægge") + ". " + perEtage(F.nord) + ". Vægge på tværs af lasten afstiver ikke i den retning."
        : "Ingen af de definerede vægge afstiver mod last fra nord. Det skal ingeniøren se på.",
      oest: F.oest.length ? "Last fra øst, fx vind, skubber bygningen mod vest. Den tages af vægge, der står øst–vest, altså parallelt med lasten: " + flertal(F.oest.length, "væg", "vægge") + ". " + perEtage(F.oest) + ". Vægge på tværs af lasten afstiver ikke i den retning."
        : "Ingen af de definerede vægge afstiver mod last fra øst. Det skal ingeniøren se på."
    }[filter];
  }

  /* ---------- Hvor meget tager hver væg? ---------- */
  // Fordelt efter længde minus døre og vinduer. Forenklet: lange vægge tager i virkeligheden endnu mere.
  function andel(geo, resultat, filter, etage) {
    var ids = (filter === "nord" ? resultat.filtre.nord : filter === "oest" ? resultat.filtre.oest : [])
      .filter(function (id) { return etage == null || geo.vaegById[id].etage === etage; });
    var sum = ids.reduce(function (s, id) { return s + geo.vaegById[id].effektiv; }, 0);
    return ids.map(function (id) { var w = geo.vaegById[id]; return { id: id, navn: w.navn, etage: w.etage, laengde: w.laengde, effektiv: w.effektiv, andel: sum ? w.effektiv / sum : 0 }; })
      .sort(function (a, b) { return b.effektiv - a.effektiv; });
  }

  /* ---------- Tjek af stabiliteten pr. etage ---------- */
  function tjek(geo, resultat, etage) {
    var chk = function (status, titel, tekst) { return { status: status, titel: titel, tekst: tekst }; };
    var sw = geo.vaegge.filter(function (w) { return w.etage === etage && resultat.res[w.id] && VAL[resultat.res[w.id]].afstiver; });
    if (!sw.length) return [chk("info", "Intet at tjekke endnu", "Der er ingen stabiliserende vægge på " + etage + ". Sæt spændretning på et dæk først, eller giv væggene en rolle.")];
    var ns = sw.filter(function (w) { return w.retning === "ns"; }), ew = sw.filter(function (w) { return w.retning === "ov"; });
    var sumEff = function (l) { return l.reduce(function (s, w) { return s + w.effektiv; }, 0); };
    var ud = [];
    ud.push(ns.length ? chk("ok", "Last fra nord", flertal(ns.length, "væg", "vægge") + " står nord–syd, i alt " + dk(sumEff(ns)) + " m uden åbninger.")
      : chk("mangler", "Last fra nord", "Ingen vægge står nord–syd og afstiver mod last fra nord på " + etage + "."));
    ud.push(ew.length ? chk("ok", "Last fra øst", flertal(ew.length, "væg", "vægge") + " står øst–vest, i alt " + dk(sumEff(ew)) + " m uden åbninger.")
      : chk("mangler", "Last fra øst", "Ingen vægge står øst–vest og afstiver mod last fra øst på " + etage + "."));
    if (ns.length && ew.length) {
      var linjer = function (l) { var r = []; l.forEach(function (w) { if (!r.some(function (x) { return Math.abs(x - w.linje) <= LINJE_TOL; })) r.push(w.linje); }); return r; };
      ud.push(sw.length < 3 ? chk("advarsel", "Vridning", "Der er under tre stabiliserende vægge. Der skal være mindst tre, som ikke mødes i ét punkt, ellers kan bygningen vride.")
        : (linjer(ns).length === 1 && linjer(ew).length === 1 ? chk("advarsel", "Vridning", "Alle væggene mødes i ét punkt, så bygningen kan vride. Der skal være vægge på mindst to linjer i én af retningerne.")
          : chk("ok", "Vridning", "Væggene står på flere linjer og mødes ikke i ét punkt, så bygningen kan ikke vride.")));
    }
    var idx = geo.etageIdx[etage];
    if (!idx) ud.push(chk("ok", "Ned til fundamentet", etage + " står direkte på fundamentet."));
    else {
      var under = geo.etager[idx - 1];
      var svaever = sw.filter(function (w) { return !w.under.some(function (id) { return resultat.vaegtype(id) !== "let"; }); });
      ud.push(svaever.length ? chk("advarsel", "Ned til fundamentet", svaever.map(function (w) { return w.navn; }).join(", ") + " står ikke på en tung væg i " + under + ". Lasten skal føres ned på en anden måde.")
        : chk("ok", "Ned til fundamentet", "Alle stabiliserende vægge på " + etage + " står på en tung væg i " + under + "."));
    }
    var huller = sw.filter(function (w) { return w.laengde > 0 && w.aabning / w.laengde > AABNING_ADV; });
    ud.push(huller.length ? chk("advarsel", "Åbninger", huller.map(function (w) {
      var p = Math.round(w.aabning / w.laengde * 100);
      return w.navn + ": " + p + " % åbninger" + (p > AABNING_MAX * 100 ? ", så meget, at den ikke kan regnes med" : ", så den afstiver mindre");
    }).join(". ") + ".") : chk("ok", "Åbninger", "Ingen af de stabiliserende vægge har mere end 25 % døre og vinduer."));
    ud.push(chk("info", "Dæk og forankring", "Kan ikke tjekkes i skitsen: dækket skal virke som en skive og være forbundet til væggene, og væggene skal forankres. Det afgør ingeniøren."));
    return ud;
  }

  /* ---------- Lastpile i 3D og plantegning med nord opad ---------- */
  function omrids(geo, etage) {
    var b = null;
    geo.vaegge.concat(geo.daekEl).forEach(function (w) {
      if (etage != null && w.etage !== etage) return;
      if (!b) b = { x0: w.b.x0, y0: w.b.y0, z0: w.b.z0, x1: w.b.x1, y1: w.b.y1, z1: w.b.z1 };
      else { b.x0 = Math.min(b.x0, w.b.x0); b.y0 = Math.min(b.y0, w.b.y0); b.z0 = Math.min(b.z0, w.b.z0); b.x1 = Math.max(b.x1, w.b.x1); b.y1 = Math.max(b.y1, w.b.y1); b.z1 = Math.max(b.z1, w.b.z1); }
    });
    return b;
  }
  // Tre pile mod facaden i halv hoejde. Modelkoordinater: X oest, Y nord, Z op.
  function lastpile(geo, filter) {
    var b = omrids(geo, null); if (!b || (filter !== "nord" && filter !== "oest")) return [];
    var zTop = (b.z0 + b.z1) / 2, L = Math.max(2, Math.min(4, (b.x1 - b.x0) * 0.25));
    if (filter === "nord") return [0.25, 0.5, 0.75].map(function (t) { var x = b.x0 + (b.x1 - b.x0) * t; return { fra: [x, b.y1 + L, zTop], til: [x, b.y1 + 0.4, zTop], tekst: t === 0.5 ? "Last fra nord" : null }; });
    var zm = (b.z0 + b.z1) / 2;
    return [0.25, 0.5, 0.75].map(function (t) { var y = b.y0 + (b.y1 - b.y0) * t; return { fra: [b.x1 + L, y, zm], til: [b.x1 + 0.4, y, zm], tekst: t === 0.5 ? "Last fra øst" : null }; });
  }
  // Plantegning for én etage: linjer pr. væg (farve efter filter), rumnavne, spændretnings-/lastpile. Modelkoordinater;
  // tegnes med nord opad (SVG skal spejle Y). viewBox i modelmeter med luft til pile og nordpil.
  // opt: { daekId, metode }: felterne på dette dæk vises, også uden retning (så de kan vælges i planen).
  function plan(geo, resultat, valg, etage, filter, opt) {
    filter = filtre(filter); opt = opt || {};
    var F = farver(geo, resultat, filter), lastF = filter === "nord" || filter === "oest";
    var b = omrids(geo, etage) || { x0: 0, y0: 0, x1: 10, y1: 8 };
    var linjer = geo.vaegge.filter(function (w) { return w.etage === etage; }).map(function (w) {
      var f = F.farver[w.id];
      return { id: w.id, x1: w.p0[0], y1: w.p0[1], x2: w.p1[0], y2: w.p1[1],
        farve: f || "#C3CDCF", bredde: f ? 0.32 : 0.12, med: !!f, kant: F.kant[w.id] || null };
    }).sort(function (a, c) { return (a.med ? 1 : 0) - (c.med ? 1 : 0); });
    var rum = geo.rum.filter(function (r) { return r.etage === etage && r.b; }).map(function (r) { return { id: r.id, x: (r.b.x0 + r.b.x1) / 2, y: (r.b.y0 + r.b.y1) / 2, tekst: r.navn }; });
    var pile = [], tekster = [];
    var L = Math.max(2, Math.min(4, (b.x1 - b.x0) * 0.25));
    if (filter === "nord") { [0.25, 0.5, 0.75].forEach(function (t) { var x = b.x0 + (b.x1 - b.x0) * t; pile.push({ x1: x, y1: b.y1 + L, x2: x, y2: b.y1 + 0.5, last: true }); }); tekster.push({ x: (b.x0 + b.x1) / 2, y: b.y1 + L + 0.9, tekst: "Last fra nord" }); }
    else if (filter === "oest") { [0.25, 0.5, 0.75].forEach(function (t) { var y = b.y0 + (b.y1 - b.y0) * t; pile.push({ x1: b.x1 + L, y1: y, x2: b.x1 + 0.5, y2: y, last: true }); }); tekster.push({ x: b.x1 + L / 2, y: b.y1 + 0.9, tekst: "Last fra øst" }); }
    // Spændretningen vises under alle filtre.
    var feltVis = [], medtaget = {};
    function medFelt(f) {
      if (medtaget[f.id]) return;
      medtaget[f.id] = 1;
      var g = feltGrafik(f);
      g.pile.forEach(function (a) { pile.push(a); });
      feltVis.push({ id: f.id, type: f.type, navn: f.kortNavn || f.navn, daekId: f.daekId, rumId: f.rumId, ringe: f.ringe, defineret: !!f.retning, farve: f.retning ? retningFarve(f.retning) : "#7C898C",
        skravering: g.skravering, tekst: g.tekst ? { x: g.tekst.x, y: g.tekst.y, laengde: g.tekst.laengde, tekst: retningKort(f.retning) } : null });
    }
    definerede(geo, valg).forEach(function (f) { if (f.etage === etage) medFelt(f); });
    if (opt.daekId != null && geo.daekElById[opt.daekId]) feltListe(geo, valg, opt.daekId, opt.metode).forEach(function (f) { if (f.etage === etage) medFelt(f); });
    var daekRinge = opt.daekId != null && geo.daekElById[opt.daekId] && geo.daekElById[opt.daekId].etageUnder === etage ? geo.daekElById[opt.daekId].ringe : null;
    var luft = L + 1.6;
    return { etage: etage, filter: filter, viewBox: { x: b.x0 - 1.2, y: b.y0 - 1.2, w: (b.x1 - b.x0) + luft + 1.2 + 1.5, h: (b.y1 - b.y0) + luft + 1.2 }, omrids: b,
      linjer: linjer, rum: rum, pile: pile, tekster: tekster, nordpil: { x: b.x1 + luft - 0.2, y: b.y1 + luft - 1.6 }, lastF: lastF, felter: feltVis, daekRinge: daekRinge };
  }
  // Feltet i et punkt af planen, til klik: egne felter før rum før hele dækket.
  function feltVed(p, x, y) {
    var rang = { egen: 0, rum: 1, hele: 2 }, hits = p.felter.filter(function (f) { return pktIRinge(f.ringe, x, y); });
    hits.sort(function (a, b) { return rang[a.type] - rang[b.type]; });
    return hits[0] || null;
  }

  /* ---------- Forslag til Konstruktiv funktion ---------- */
  // Resultatet som ændringsrækker: én pr. væg med resultat, Revit-navnet i parameteren, kun hvor værdien er en anden.
  // Går altid gennem ændringslisten og «Gem i Revit»; intet skrives her.
  function forslag(geo, resultat, nuvaerende) {
    var rows = [];
    Object.keys(resultat.res).forEach(function (id) {
      var w = geo.vaegById[id]; if (!w) return;
      var til = kode2revit(resultat.res[id]);
      var fra = nuvaerende ? nuvaerende(w.id) : (w.el.konstruktiv || (w.el.bygdata && w.el.bygdata.raw && w.el.bygdata.raw[VAERDIER.parameter]) || "");
      fra = fra == null ? "" : String(fra);
      if (fra.trim() === til) return;
      rows.push({ id: w.id, uniqueId: w.uniqueId, navn: w.navn, param: VAERDIER.parameter, fra: fra, til: til, kode: resultat.res[id], kilde: resultat.kilde[id], hvorfor: resultat.hvorfor[id] || [] });
    });
    return rows;
  }

  return {
    VAERDIER: VAERDIER, VAL: VAL, RETNING: RETNING, VAEGTYPE: VAEGTYPE, VAEGTYPE_HJAELP: VAEGTYPE_HJAELP, FILTRE: FILTRE, KANT_FARVE: KANT_FARVE,
    LET_FARVE: LET_FARVE, skoenVaegtype: skoenVaegtype,
    TAGTYPER: TAGTYPER, tagform: tagform, saetTag: saetTag, tagTekst: tagTekst, zOverside: zOverside, underdel: underdel, underdelStreg: underdelStreg, trekanterAfRing: trekanterAfRing,
    geometri: geometri, daekForValg: daekForValg, foreslaa: foreslaa, vurder: vurder, farver: farver, filterTekst: filterTekst,
    andel: andel, tjek: tjek, lastpile: lastpile, plan: plan, forslag: forslag,
    METODER: METODER, RETNING_FARVE: RETNING_FARVE, metodeFor: metodeFor, feltListe: feltListe, rumFelt: rumFelt, felter: felter, saetMetode: saetMetode, saetRetning: saetRetning,
    tilfoejFelt: tilfoejFelt, fjernFelt: fjernFelt, omdoebFelt: omdoebFelt, daekning: daekning, feltGrafik: feltGrafik, pilTrekanter: pilTrekanter, fang: fang, feltVed: feltVed,
    foreslaaFelt: foreslaaFelt, foreslaaAlle: foreslaaAlle, vaegAkse: vaegAkse, retningAf: retningAf, retningKode: retningKode, retningLager: retningLager, retningTekst: retningTekst, retningKort: retningKort, retningFarve: retningFarve,
    kode2revit: kode2revit, revit2kode: revit2kode, statikTekst: statikTekst, farve: farve, fraRevitUsage: fraRevitUsage, bboxAf: bboxAf
  };
});
