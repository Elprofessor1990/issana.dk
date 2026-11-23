/* Visningsopskrift i ISSANA 3D: ét lille, deklarativt JSON-lag oven på visningens egne kald (window.IssanaVisning).

   Samme opskrift giver samme billede, uanset om den kommer fra et panel, en rapport eller en AI. Opskriften er hele
   beskrivelsen af visningen: et udeladt afsnit sætter standarden (kameraet iso, alt vist, materialefarver, intet snit),
   så resultatet ikke afhænger af, hvad der var før. Med {delvis:true} bliver udeladte afsnit stående som de er.

   {
     "version": 1,
     "kamera": { "retning": "iso|top|front|bag|hojre|venstre", "tilpas": "alt|vist", "fov": 50 }
             eller { "position": [x,y,z], "maal": [x,y,z], "op": [0,0,1], "fov": 50 },      (modelkoordinater, meter)
     "vis":    { "kun": VAELGER, "skjul": VAELGER },
     "farve":  { "efter": "material|category|level|type|uvalue|..." } eller { "grupper": [{...VAELGER, "farve": "#rrggbb"}], "rest": "#rrggbb" },
     "snit":   { "akse": "x|y|z", "vaerdi": 3.0, "behold": "over|under" }   (eller en liste af dem),
     "stil":   { "kanter": true, "xray": false, "gitter": true },
     "billede": { "bredde": 1600, "hoejde": 900, "baggrund": "hvid|tema|gennemsigtig" }
   }
   VAELGER = { "fag": [..], "kategori": [..], "niveau": [..], "ids": [Revit-id, ..] }: alle angivne nøgler skal passe (og),
   flere værdier i én nøgle er eller. Fag: bygning, installationer. Rum styres af Rum-panelet og rammes aldrig af en vælger.

   Alt, der ikke kan bruges (ukendt nøgle, ukendt værdi, id der ikke findes), giver en advarsel på dansk, og den del af
   opskriften anvendes ikke. Intet ignoreres stille, og intet falder stille tilbage.

   Valideringen (valider, opskriftFraTilstand) er rene funktioner uden three.js og DOM og testes i Node
   (tests/web-model3d/visning-opskrift.test.mjs). installer(V) lægger anvendOpskrift, hentOpskrift og gemBillede på
   window.IssanaVisning. Ændrer kun det, man ser; intet skrives i Revit. */
(function (rod) {
  "use strict";

  var VERSION = 1;
  var RETNINGER = ["iso", "top", "front", "bag", "hojre", "venstre"];   // samme navne som viewerens VIEW_DIRS
  var TILPAS = ["alt", "vist"];
  var FAG = ["bygning", "installationer"];
  var BAGGRUNDE = ["hvid", "tema", "gennemsigtig"];
  var AKSER = ["x", "y", "z"];
  var STANDARD_FOV = 50;                                   // viewerens PerspectiveCamera(50, ...)
  var STANDARD_STIL = { kanter: true, xray: false, gitter: true };
  var STANDARD_REST = "#9aa5a0";                           // elementer uden for alle farvegrupper
  var MIN_AFSTAND = 0.05;                                  // m: OrbitControls.minDistance; tættere flyttes kameraet af controls
  var MIN_SIDE = 64, MAX_SIDE = 6000, MAX_PIXELS = 16e6;   // billedets størrelse: loft mod ukontrolleret hukommelse
  var MAX_SNIT = 6;
  var MAX_KOORD = 1e7;                                     // m: større koordinater er ikke meter, og rund() ville give Infinity
  var TOP = ["version", "kamera", "vis", "farve", "snit", "stil", "billede"];
  var VAELGER_NOEGLER = ["fag", "kategori", "niveau", "ids"];

  /* ---------- Små hjælpere ---------- */
  function erObjekt(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function erTal(v) { return typeof v === "number" && isFinite(v); }
  function erHeltal(v) { return erTal(v) && Math.floor(v) === v; }
  function kopi(v) { return JSON.parse(JSON.stringify(v)); }
  function rund(v) { return Math.round(v * 1e6) / 1e6 + 0; }   // + 0: ingen -0
  function citer(v) { return "«" + String(v) + "»"; }
  function liste(v) { return Array.isArray(v) ? v : [v]; }
  function sortTal(a, b) { return a - b; }
  function unik(a) { var set = {}, ud = []; a.forEach(function (x) { var k = typeof x + ":" + x; if (!set[k]) { set[k] = 1; ud.push(x); } }); return ud; }
  function tekstListe(a, max) { var l = a.slice(0, max || 8).map(citer).join(", "); return a.length > (max || 8) ? l + " og " + (a.length - (max || 8)) + " flere" : l; }
  function afstand(a, b) {
    var m = [], i, j;
    for (i = 0; i <= a.length; i++) { m[i] = [i]; }
    for (j = 1; j <= b.length; j++) { m[0][j] = j; }
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
  }
  // «Mente du ...?» kun, når der er et tæt bud
  function bud(navn, kendte) {
    var bedst = null, d = 3;
    kendte.forEach(function (k) { var x = afstand(String(navn).toLowerCase(), k.toLowerCase()); if (x < d) { d = x; bedst = k; } });
    return bedst ? " Mente du " + citer(bedst) + "?" : "";
  }
  function ukendteNoegler(sti, obj, kendte, adv, handling) {
    Object.keys(obj).forEach(function (k) {
      if (kendte.indexOf(k) < 0) adv.push(sti + ": ukendt felt " + citer(k) + "." + bud(k, kendte) + " Kendte felter: " + kendte.join(", ") + ". " + handling);
    });
  }
  function fagAf(ed) { return ed && ed.erRum ? "rum" : (ed && ed.installation ? "installationer" : "bygning"); }

  /* ---------- Hvad modellen indeholder (til at afvise ukendte værdier) ---------- */
  // kontekst: { elementer: [{id, kategori, niveau, fag}], farvevalg: [id, ...] }. Elementernes placering er deres indeks i visningen.
  function indeks(kontekst) {
    var els = (kontekst && kontekst.elementer) || [], ix = { kategorier: {}, niveauer: {}, fag: {}, ider: {}, antal: els.length };
    els.forEach(function (e, i) {
      if (!e || e.fag === "rum") return;
      ix.kategorier[e.kategori] = 1; ix.niveauer[e.niveau] = 1; ix.fag[e.fag] = 1;
      if (erHeltal(e.id)) (ix.ider[e.id] || (ix.ider[e.id] = [])).push(i);
    });
    return ix;
  }

  // En vælger: { fag, kategori, niveau, ids }. Giver den rensede vælger (lister, kun kendte værdier) eller null med advarsler.
  function normaliserVaelger(sti, v, ix, adv, tilladte) {
    if (!erObjekt(v)) { adv.push(sti + ": skal være et objekt med " + tilladte.join(", ") + "."); return null; }
    var noegler = Object.keys(v), ud = {}, ok = true;
    if (!noegler.length) { adv.push(sti + ": er tom. Angiv mindst en af " + tilladte.join(", ") + "."); return null; }
    ukendteNoegler(sti, v, tilladte, adv, "Feltet er ikke brugt.");
    tilladte.forEach(function (k) {
      if (v[k] === undefined) return;
      var vals = liste(v[k]);
      if (!vals.length) { adv.push(sti + "." + k + ": listen er tom."); ok = false; return; }
      var gode = [], ukendte = [];
      if (k === "ids") {
        vals.forEach(function (x) { if (!erHeltal(x)) adv.push(sti + ".ids: " + citer(x) + " er ikke et Revit-id (et helt tal)."); else if (!ix.ider[x]) ukendte.push(x); else gode.push(x); });
        if (ukendte.length) adv.push(sti + ".ids: " + ukendte.length + " element" + (ukendte.length === 1 ? "" : "er") + " findes ikke i modellen (" + tekstListe(ukendte, 8) + ") og er udeladt.");
      } else {
        var kilde = k === "fag" ? FAG : Object.keys(k === "kategori" ? ix.kategorier : ix.niveauer).sort(function (a, b) { return String(a).localeCompare(String(b), "da", { numeric: true }); });
        vals.forEach(function (x) {
          if (typeof x !== "string") adv.push(sti + "." + k + ": " + citer(x) + " er ikke en tekst.");
          else if (kilde.indexOf(x) < 0) { ukendte.push(x); adv.push(sti + "." + k + ": " + citer(x) + " findes ikke" + (k === "fag" ? "" : " i modellen") + "." + bud(x, kilde) + " Kendte: " + tekstListe(kilde, 12) + ". Værdien er udeladt."); }
          else gode.push(x);
        });
      }
      if (!gode.length) { adv.push(sti + "." + k + ": ingen gyldige værdier tilbage."); ok = false; return; }
      ud[k] = unik(gode);
    });
    if (!ok || !Object.keys(ud).length) return null;
    return ud;
  }

  // Indeks (i visningen) for de elementer, en vælger rammer. Rum er aldrig med.
  function vaelgElementer(vaelger, kontekst) {
    var ud = [], S = {};
    ["fag", "kategori", "niveau", "ids"].forEach(function (k) { if (vaelger[k]) S[k] = new Set(vaelger[k]); });   // opslag i stedet for indexOf: lange id-lister
    ((kontekst && kontekst.elementer) || []).forEach(function (e, i) {
      if (!e || e.fag === "rum") return;
      if (S.fag && !S.fag.has(e.fag)) return;
      if (S.kategori && !S.kategori.has(e.kategori)) return;
      if (S.niveau && !S.niveau.has(e.niveau)) return;
      if (S.ids && !S.ids.has(e.id)) return;
      ud.push(i);
    });
    return ud;
  }

  function hex(v) {
    if (typeof v !== "string") return null;
    var m = /^#([0-9a-fA-F]{6})$/.exec(v.trim());
    if (m) return "#" + m[1].toLowerCase();
    m = /^#([0-9a-fA-F]{3})$/.exec(v.trim());
    return m ? "#" + m[1].split("").map(function (c) { return c + c; }).join("").toLowerCase() : null;
  }

  function vektor(sti, navn, v, adv) {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(erTal)) { adv.push(sti + "." + navn + ": skal være tre tal [x, y, z] i meter."); return null; }
    if (navn !== "op" && v.some(function (x) { return Math.abs(x) > MAX_KOORD; })) { adv.push(sti + "." + navn + ": et tal er over " + MAX_KOORD / 1e6 + " mio. meter fra nul og kan ikke være en koordinat."); return null; }
    if (navn === "op" && v.some(function (x) { return Math.abs(x) > MAX_KOORD; })) { adv.push(sti + ".op: tallene er for store."); return null; }
    return v.map(rund);
  }

  /* ---------- Afsnittene ---------- */
  function afsnitKamera(v, adv) {
    var s = "kamera";
    if (!erObjekt(v)) { adv.push(s + ": skal være et objekt (retning eller position og maal). Kameraet er ikke ændret."); return null; }
    var antal = adv.length;
    ukendteNoegler(s, v, ["retning", "tilpas", "position", "maal", "op", "fov"], adv, "Feltet er ikke brugt.");
    var fov = STANDARD_FOV;
    if (v.fov !== undefined) { if (!erTal(v.fov) || v.fov < 10 || v.fov > 120) { adv.push(s + ".fov: " + citer(v.fov) + " er ikke et tal mellem 10 og 120 grader. Kameraet er ikke ændret."); return null; } fov = rund(v.fov); }
    var eksplicit = v.position !== undefined || v.maal !== undefined || v.op !== undefined, retning = v.retning !== undefined || v.tilpas !== undefined;
    if (eksplicit && retning) { adv.push(s + ": retning/tilpas kan ikke bruges sammen med position/maal/op. Vælg én af dem. Kameraet er ikke ændret."); return null; }
    if (eksplicit) {
      if (v.position === undefined || v.maal === undefined) { adv.push(s + ": position og maal skal angives sammen. Kameraet er ikke ændret."); return null; }
      var pos = vektor(s, "position", v.position, adv), maal = vektor(s, "maal", v.maal, adv), op = v.op === undefined ? [0, 0, 1] : vektor(s, "op", v.op, adv);
      if (!pos || !maal || !op) { adv.push(s + ": kameraet er ikke ændret."); return null; }
      var d = [pos[0] - maal[0], pos[1] - maal[1], pos[2] - maal[2]], dl = Math.hypot(d[0], d[1], d[2]), ol = Math.hypot(op[0], op[1], op[2]);
      if (dl < MIN_AFSTAND) { adv.push(s + ": position ligger kun " + dl.toFixed(3).replace(".", ",") + " m fra maal; mindst " + String(MIN_AFSTAND).replace(".", ",") + " m. Kameraet er ikke ændret."); return null; }
      if (ol < 1e-9) { adv.push(s + ".op: kan ikke være nulvektoren. Kameraet er ikke ændret."); return null; }
      var kryds = [d[1] * op[2] - d[2] * op[1], d[2] * op[0] - d[0] * op[2], d[0] * op[1] - d[1] * op[0]];
      if (Math.hypot(kryds[0], kryds[1], kryds[2]) / (dl * ol) < 1e-4) { adv.push(s + ": op peger i samme retning som blikket, så billedets retning er ubestemt. Kameraet er ikke ændret."); return null; }
      return { type: "eksplicit", position: pos, maal: maal, op: op.map(function (x) { return rund(x / ol); }), fov: fov };
    }
    var r = v.retning === undefined ? "iso" : v.retning, t = v.tilpas === undefined ? (v.retning === undefined ? "alt" : "vist") : v.tilpas;
    if (RETNINGER.indexOf(r) < 0) { adv.push(s + ".retning: " + citer(r) + " findes ikke." + bud(r, RETNINGER) + " Kendte: " + RETNINGER.join(", ") + ". Kameraet er ikke ændret."); return null; }
    if (TILPAS.indexOf(t) < 0) { adv.push(s + ".tilpas: " + citer(t) + " findes ikke. Kendte: " + TILPAS.join(", ") + " (vist = det, der vises lige nu). Kameraet er ikke ændret."); return null; }
    if (v.retning === undefined && v.tilpas === undefined && v.fov === undefined && adv.length === antal) { adv.push(s + ": er tomt. Angiv retning eller position og maal. Kameraet er ikke ændret."); return null; }
    return { type: "retning", retning: r, tilpas: t, fov: fov };
  }

  function afsnitVis(v, ix, adv) {
    var s = "vis";
    if (!erObjekt(v)) { adv.push(s + ": skal være et objekt med kun og/eller skjul. Visningen er ikke ændret."); return null; }
    ukendteNoegler(s, v, ["kun", "skjul"], adv, "Feltet er ikke brugt.");
    var ud = { kun: null, skjul: null };
    ["kun", "skjul"].forEach(function (k) { if (v[k] !== undefined) ud[k] = normaliserVaelger(s + "." + k, v[k], ix, adv, VAELGER_NOEGLER); });
    if (v.kun !== undefined && !ud.kun) adv.push(s + ".kun: filteret er ikke anvendt, så alle elementer vises.");
    if (v.skjul !== undefined && !ud.skjul) adv.push(s + ".skjul: filteret er ikke anvendt.");
    if (v.kun === undefined && v.skjul === undefined) adv.push(s + ": er tomt. Alt vises.");
    return ud;
  }

  function afsnitFarve(v, ix, kontekst, adv) {
    var s = "farve", valg = ((kontekst && kontekst.farvevalg) || []).filter(function (x) { return x !== "lag"; });
    if (!erObjekt(v)) { adv.push(s + ": skal være et objekt med efter eller grupper. Farven er ikke ændret."); return null; }
    ukendteNoegler(s, v, ["efter", "grupper", "rest"], adv, "Feltet er ikke brugt.");
    if (v.efter !== undefined && v.grupper !== undefined) { adv.push(s + ": efter og grupper kan ikke bruges sammen. Farven er ikke ændret."); return null; }
    if (v.efter !== undefined) {
      if (v.rest !== undefined) adv.push(s + ".rest: bruges kun sammen med grupper og er udeladt.");
      if (typeof v.efter !== "string" || valg.indexOf(v.efter) < 0) {
        adv.push(s + ".efter: " + citer(v.efter) + (v.efter === "lag" ? " styres af et panel og kan ikke bruges i en opskrift; brug grupper." : " findes ikke.") + bud(v.efter, valg) + " Kendte: " + valg.join(", ") + ". Farven er ikke ændret.");
        return null;
      }
      return { efter: v.efter };
    }
    if (v.grupper === undefined) { adv.push(s + ": angiv efter eller grupper. Farven er ikke ændret."); return null; }
    if (!Array.isArray(v.grupper) || !v.grupper.length) { adv.push(s + ".grupper: skal være en liste med mindst en gruppe. Farven er ikke ændret."); return null; }
    var rest = STANDARD_REST;
    if (v.rest !== undefined) { rest = hex(v.rest); if (!rest) { adv.push(s + ".rest: " + citer(v.rest) + " er ikke en farve på formen #rrggbb. Farven er ikke ændret."); return null; } }
    var grupper = [];
    v.grupper.forEach(function (g, i) {
      var sti = s + ".grupper[" + i + "]";
      if (!erObjekt(g)) { adv.push(sti + ": skal være et objekt med en vælger og farve. Gruppen er udeladt."); return; }
      var farve = hex(g.farve);
      if (!farve) { adv.push(sti + ".farve: " + (g.farve === undefined ? "mangler" : citer(g.farve) + " er ikke en farve på formen #rrggbb") + ". Gruppen er udeladt."); return; }
      var vg = {}; VAELGER_NOEGLER.forEach(function (k) { if (g[k] !== undefined) vg[k] = g[k]; });
      Object.keys(g).forEach(function (k) { if (k !== "farve" && VAELGER_NOEGLER.indexOf(k) < 0) adv.push(sti + ": ukendt felt " + citer(k) + "." + bud(k, VAELGER_NOEGLER.concat("farve")) + " Kendte felter: " + VAELGER_NOEGLER.concat("farve").join(", ") + ". Feltet er ikke brugt."); });
      var n = normaliserVaelger(sti, vg, ix, adv, VAELGER_NOEGLER);
      if (!n) { adv.push(sti + ": gruppen er udeladt."); return; }
      if (!vaelgElementer(n, kontekst).length) { adv.push(sti + ": ingen elementer passer til vælgeren. Gruppen er udeladt."); return; }
      grupper.push({ vaelger: n, farve: farve });
    });
    if (!grupper.length) { adv.push(s + ": ingen gyldige grupper. Farven er ikke ændret."); return null; }
    return { grupper: grupper, rest: rest };
  }

  function afsnitSnit(v, adv) {
    var s = "snit", l = Array.isArray(v) ? v : [v];
    if (!l.length) { adv.push(s + ": listen er tom. Snittet er ikke ændret."); return null; }
    if (l.length > MAX_SNIT) { adv.push(s + ": højst " + MAX_SNIT + " snitplaner. Snittet er ikke ændret."); return null; }
    var ud = [], fejl = false;
    l.forEach(function (p, i) {
      var sti = Array.isArray(v) ? s + "[" + i + "]" : s, antal = adv.length;
      if (!erObjekt(p)) { adv.push(sti + ": skal være et objekt med akse, vaerdi og behold."); fejl = true; return; }
      ukendteNoegler(sti, p, ["akse", "vaerdi", "behold"], adv, "Feltet er ikke brugt.");
      if (AKSER.indexOf(p.akse) < 0) adv.push(sti + ".akse: " + (p.akse === undefined ? "mangler" : citer(p.akse) + " findes ikke") + ". Kendte: x, y, z.");
      if (erTal(p.vaerdi) && Math.abs(p.vaerdi) > MAX_KOORD) adv.push(sti + ".vaerdi: " + citer(p.vaerdi) + " er over " + MAX_KOORD / 1e6 + " mio. meter fra nul og kan ikke være en koordinat.");
      else if (!erTal(p.vaerdi)) adv.push(sti + ".vaerdi: " + (p.vaerdi === undefined ? "mangler" : citer(p.vaerdi) + " er ikke et tal") + " (meter i modellens koordinater).");
      if (p.behold !== "over" && p.behold !== "under") adv.push(sti + ".behold: " + (p.behold === undefined ? "mangler" : citer(p.behold) + " findes ikke") + ". Kendte: over, under (hvilken side af planet, der beholdes).");
      if (adv.length > antal && adv.slice(antal).some(function (t) { return t.indexOf(sti + ".") === 0; })) { fejl = true; return; }
      ud.push({ akse: p.akse, vaerdi: rund(p.vaerdi), behold: p.behold });
    });
    if (fejl) { adv.push(s + ": snittet er ikke ændret."); return null; }
    return ud;
  }

  function afsnitStil(v, adv) {
    var s = "stil";
    if (!erObjekt(v)) { adv.push(s + ": skal være et objekt med kanter, xray og/eller gitter. Stilen er ikke ændret."); return null; }
    ukendteNoegler(s, v, ["kanter", "xray", "gitter"], adv, "Feltet er ikke brugt.");
    var ud = {}, fejl = false;
    Object.keys(STANDARD_STIL).forEach(function (k) {
      if (v[k] === undefined) { ud[k] = STANDARD_STIL[k]; return; }
      if (typeof v[k] !== "boolean") { adv.push(s + "." + k + ": " + citer(v[k]) + " er ikke sand eller falsk."); fejl = true; return; }
      ud[k] = v[k];
    });
    if (fejl) { adv.push(s + ": stilen er ikke ændret."); return null; }
    return ud;
  }

  // Billedets størrelse: ren kontrol, deles af opskriften og af gemBillede. Giver en tekst, når størrelsen ikke kan bruges.
  function stoerrelseFejl(b, h) {
    if (!erHeltal(b) || !erHeltal(h)) return "bredde og hoejde skal være hele tal (pixels).";
    if (b < MIN_SIDE || h < MIN_SIDE || b > MAX_SIDE || h > MAX_SIDE) return "bredde og hoejde skal være mellem " + MIN_SIDE + " og " + MAX_SIDE + " pixels (fik " + b + " x " + h + ").";
    if (b * h > MAX_PIXELS) return "billedet må højst have " + (MAX_PIXELS / 1e6) + " mio. pixels (fik " + (Math.round(b * h / 1e5) / 10).toString().replace(".", ",") + " mio.).";
    return null;
  }
  function afsnitBillede(v, adv) {
    var s = "billede";
    if (!erObjekt(v)) { adv.push(s + ": skal være et objekt med bredde, hoejde og evt. baggrund. Billedindstillingen er ikke brugt."); return null; }
    ukendteNoegler(s, v, ["bredde", "hoejde", "baggrund"], adv, "Feltet er ikke brugt.");
    var ud = { bredde: null, hoejde: null, baggrund: "hvid" }, fejl = false;
    if (v.baggrund !== undefined) { if (BAGGRUNDE.indexOf(v.baggrund) < 0) { adv.push(s + ".baggrund: " + citer(v.baggrund) + " findes ikke." + bud(v.baggrund, BAGGRUNDE) + " Kendte: " + BAGGRUNDE.join(", ") + "."); fejl = true; } else ud.baggrund = v.baggrund; }
    if (v.bredde !== undefined || v.hoejde !== undefined) {
      if (v.bredde === undefined || v.hoejde === undefined) { adv.push(s + ": bredde og hoejde skal angives sammen."); fejl = true; }
      else { var f = stoerrelseFejl(v.bredde, v.hoejde); if (f) { adv.push(s + ": " + f); fejl = true; } else { ud.bredde = v.bredde; ud.hoejde = v.hoejde; } }
    }
    return fejl ? null : ud;
  }

  /* ---------- Hele opskriften ---------- */
  // Giver { ok, opskrift: {afsnit: {status, vaerdi}}, advarsler }. status: sat (brug vaerdi), standard (afsnittet er udeladt: standarden sættes)
  // eller uaendret (afsnittet er ugyldigt, og visningen røres ikke). ok er falsk, når hele opskriften må afvises.
  function valider(opskrift, kontekst, valg) {
    var adv = [], delvis = !!(valg && valg.delvis), afsnit = {};
    var o = opskrift;
    if (typeof o === "string") { try { o = JSON.parse(o); } catch (e) { return { ok: false, opskrift: null, advarsler: ["Opskriften er ikke gyldig JSON: " + e.message + ". Intet er ændret."] }; } }
    if (!erObjekt(o)) return { ok: false, opskrift: null, advarsler: ["Opskriften skal være et objekt (JSON med kamera, vis, farve, snit, stil og billede). Intet er ændret."] };
    if (o.version !== undefined && o.version !== VERSION) return { ok: false, opskrift: null, advarsler: ["Opskriftens version " + citer(o.version) + " kendes ikke; denne visning forstår version " + VERSION + ". Intet er ændret."] };
    ukendteNoegler("opskrift", o, TOP, adv, "Feltet er ikke brugt.");
    var ix = indeks(kontekst);
    function saet(navn, funk, standard) {
      if (o[navn] === undefined) { afsnit[navn] = { status: delvis ? "uaendret" : "standard", vaerdi: delvis ? null : standard }; return; }
      var r = funk(o[navn]);
      afsnit[navn] = r ? { status: "sat", vaerdi: r } : { status: "uaendret", vaerdi: null };
    }
    saet("kamera", function (v) { return afsnitKamera(v, adv); }, { type: "retning", retning: "iso", tilpas: "alt", fov: STANDARD_FOV });
    saet("vis", function (v) { return afsnitVis(v, ix, adv); }, { kun: null, skjul: null });
    saet("farve", function (v) { return afsnitFarve(v, ix, kontekst, adv); }, { efter: "material" });
    saet("snit", function (v) { return afsnitSnit(v, adv); }, []);
    saet("stil", function (v) { return afsnitStil(v, adv); }, kopi(STANDARD_STIL));
    if (o.billede === undefined) afsnit.billede = { status: "standard", vaerdi: null };
    else { var b = afsnitBillede(o.billede, adv); afsnit.billede = b ? { status: "sat", vaerdi: b } : { status: "uaendret", vaerdi: null }; }
    // Et vis-filter, der ikke rammer noget, kan ikke anvendes (en tom isolering viser alt): sig det nu, mens vi kender elementerne
    var vis = afsnit.vis.vaerdi;
    if (vis && vis.kun) { var kun = vaelgElementer(vis.kun, kontekst); if (!kun.length) { adv.push("vis.kun: ingen elementer passer til vælgeren, så filteret er ikke anvendt og alle elementer vises."); vis.kun = null; } }
    if (vis && vis.skjul) { var sk = vaelgElementer(vis.skjul, kontekst); if (!sk.length) { adv.push("vis.skjul: ingen elementer passer til vælgeren, så intet er skjult."); vis.skjul = null; } }
    return { ok: true, opskrift: afsnit, advarsler: adv };
  }

  /* ---------- Fra visningens tilstand til en opskrift ---------- */
  // t er det, viewerens hentTilstand() giver (se Revit-modelviewer.html). Giver { opskrift, advarsler }.
  function opskriftFraTilstand(t, kontekst, stand) {
    var adv = [], els = (kontekst && kontekst.elementer) || [], f = t.forskydning || [0, 0, 0], ud = { version: VERSION };
    ud.kamera = { position: t.kamera.position.map(rund), maal: t.kamera.maal.map(rund), op: t.kamera.op.map(rund), fov: rund(t.kamera.fov) };
    // vis: det, opskriften selv kan sætte (isolering, skjulte, niveau). Alt andet, der skjuler elementer, advares om.
    var kun = {}, skjul = {}, vis = {}, n = t.vis;
    var perId = {};   // Revit-id -> indeks (uden rum): et id, der findes flere gange, kan ikke gemmes præcist
    els.forEach(function (e, i) { if (e && e.fag !== "rum" && erHeltal(e.id)) (perId[e.id] || (perId[e.id] = [])).push(i); });
    function ider(idxs, hvad) {
      var set = new Set(idxs), res = [], uden = 0, flere = [];
      idxs.forEach(function (i) { var e = els[i]; if (!e || e.fag === "rum") return; if (!erHeltal(e.id)) uden++; else res.push(e.id); });
      unik(res).forEach(function (x) { if (perId[x].length > 1 && !perId[x].every(function (i) { return set.has(i); })) flere.push(x); });
      if (uden) adv.push("vis: " + uden + " " + hvad + " har intet Revit-id og kan ikke gemmes i opskriften.");
      if (flere.length) adv.push("vis: Revit-id " + tekstListe(flere, 6) + " findes flere gange i modellen (koblede modeller); opskriften rammer dem alle.");
      return unik(res).sort(sortTal);
    }
    if (n.niveau) kun.niveau = [n.niveau];
    if (n.iso) kun.ids = ider(n.iso, "isolerede elementer");
    if (n.skjult && n.skjult.length) { var sk = ider(n.skjult, "skjulte elementer"); if (sk.length) skjul.ids = sk; }
    if (Object.keys(kun).length) vis.kun = kun;
    if (Object.keys(skjul).length) vis.skjul = skjul;
    if (Object.keys(vis).length) ud.vis = vis;
    if (n.synlige) {
      var isoSet = n.iso ? new Set(n.iso) : null, skjSet = n.skjult ? new Set(n.skjult) : null, afvig = 0;
      els.forEach(function (e, i) {
        if (!e || e.fag === "rum" || n.synlige[i] == null) return;
        var forventet = !(isoSet && !isoSet.has(i)) && !(skjSet && skjSet.has(i)) && !(n.niveau && e.niveau !== n.niveau);
        if (!!n.synlige[i] !== forventet) afvig++;
      });
      if (afvig) adv.push("vis: " + afvig + " element" + (afvig === 1 ? "" : "er") + " vises eller skjules af et panels eget filter (fx Etage, Snit eller Lag), som opskriften ikke kan gemme. Opskriften viser dem efter sine egne regler.");
    }
    // farve
    var fa = t.farve || {};
    if (fa.tilstand === "lag") {
      if (stand && stand.grupper && fa.ekstern === stand.def) ud.farve = { grupper: kopi(stand.grupper).map(function (g) { var o = kopi(g.vaelger); o.farve = g.farve; return o; }), rest: stand.rest };
      else { ud.farve = { efter: "material" }; adv.push("farve: farverne kommer fra et panel (Lag og filtre) og kan ikke gemmes i en opskrift. Opskriften bruger materialefarver."); }
    } else ud.farve = { efter: fa.tilstand || "material" };
    // snit
    var planer = [], ukendt = 0;
    ((t.snit && t.snit.planer) || []).concat(t.snit && t.snit.egen ? [t.snit.egen] : []).forEach(function (p) {
      var a = -1; AKSER.forEach(function (ax, k) { if (Math.abs(Math.abs(p.normal[k]) - 1) < 1e-6 && Math.abs(p.normal[(k + 1) % 3]) < 1e-6 && Math.abs(p.normal[(k + 2) % 3]) < 1e-6) a = k; });
      if (a < 0) { ukendt++; return; }
      if (p.normal[a] > 0) planer.push({ akse: AKSER[a], vaerdi: rund(-p.konstant + f[a]), behold: "over" });
      else planer.push({ akse: AKSER[a], vaerdi: rund(p.konstant + f[a]), behold: "under" });
    });
    if (ukendt) adv.push("snit: " + ukendt + " snitplan er ikke vandrette eller lodrette langs x, y eller z og kan ikke gemmes i opskriften.");
    if (planer.length > MAX_SNIT) { adv.push("snit: der er " + planer.length + " snitplaner, men en opskrift har højst " + MAX_SNIT + "; de første " + MAX_SNIT + " er gemt."); planer.length = MAX_SNIT; }
    if (planer.length) ud.snit = planer.length === 1 ? planer[0] : planer;
    ud.stil = { kanter: !!t.stil.kanter, xray: !!t.stil.xray, gitter: !!t.stil.gitter };
    return { opskrift: ud, advarsler: adv };
  }

  /* ---------- PNG ---------- */
  // Bredde og højde står i PNG'ens IHDR (bytes 16-23). Giver {bredde, hoejde} eller null.
  function pngMaal(dataUrl) {
    var m = /^data:image\/png;base64,([A-Za-z0-9+/]{44})/.exec(String(dataUrl));
    if (!m || typeof atob !== "function") return null;
    var b = atob(m[1]), by = function (i) { return b.charCodeAt(i); };
    if (by(1) !== 0x50 || by(2) !== 0x4e || by(3) !== 0x47) return null;
    return { bredde: ((by(16) * 256 + by(17)) * 256 + by(18)) * 256 + by(19), hoejde: ((by(20) * 256 + by(21)) * 256 + by(22)) * 256 + by(23) };
  }

  /* ---------- Kobling til visningen ---------- */
  function lavKontekst(V) {
    return {
      elementer: V.elementer().map(function (rec) {
        var d = rec.data || {};
        return { id: d.id, kategori: d.category || "Andet", niveau: d.level || "(uden niveau)", fag: fagAf(d) };
      }),
      farvevalg: V.farveValg().map(function (x) { return x.id; })
    };
  }

  // Sætter visningen efter en valideret opskrift. Giver {anvendt: {...}, grupper: {...}|null}; adv får advarsler om det, der først ses nu.
  function udfoer(V, res, kontekst, adv, billede) {
    var a = res.opskrift, anvendt = {}, grupper = null, f = V.forskydning();
    // stil først: røntgen ændrer materialerne, og kanterne bygges ud fra det, der vises
    if (a.stil.status !== "uaendret") { V.stil(a.stil.vaerdi); anvendt.stil = a.stil.status === "standard" ? "standard" : a.stil.vaerdi; } else anvendt.stil = "uændret";
    // vis
    if (a.vis.status === "uaendret") anvendt.vis = "uændret";
    else {
      var kun = a.vis.vaerdi.kun ? vaelgElementer(a.vis.vaerdi.kun, kontekst) : null, skjul = a.vis.vaerdi.skjul ? vaelgElementer(a.vis.vaerdi.skjul, kontekst) : null;
      V.saetVisning({ iso: kun ? new Set(kun) : null, skjult: skjul ? new Set(skjul) : null, niveau: "" });
      anvendt.vis = a.vis.status === "standard" ? "standard (alt vises)" : { kun: kun ? kun.length + " elementer" : "ingen", skjult: skjul ? skjul.length + " elementer" : "ingen" };
    }
    // farve
    if (a.farve.status === "uaendret") anvendt.farve = "uændret";
    else if (a.farve.status === "standard") { V.farveTilstandVis("material"); anvendt.farve = "standard (material)"; }
    else if (a.farve.vaerdi.efter) { V.farveTilstandVis(a.farve.vaerdi.efter); anvendt.farve = { efter: a.farve.vaerdi.efter }; }
    else {
      var kort = {}, rest = a.farve.vaerdi.rest;
      a.farve.vaerdi.grupper.forEach(function (g) { vaelgElementer(g.vaelger, kontekst).forEach(function (i) { if (kort[i] === undefined) kort[i] = g.farve; }); });   // første gruppe vinder
      var def = { farve: function (rec, i) { return kort[i] || rest; } };
      V.farve(def);
      grupper = { def: def, grupper: kopi(a.farve.vaerdi.grupper), rest: rest };
      anvendt.farve = { grupper: a.farve.vaerdi.grupper.length, rest: rest, farvede: Object.keys(kort).length + " elementer" };
    }
    // snit
    if (a.snit.status === "uaendret") anvendt.snit = "uændret";
    else {
      V.egetSnit(false);
      V.snitPlaner(a.snit.vaerdi.map(function (p) {
        var k = AKSER.indexOf(p.akse), n = [0, 0, 0], vs = p.vaerdi - f[k];
        n[k] = p.behold === "over" ? 1 : -1;
        return { normal: n, konstant: p.behold === "over" ? -vs : vs };
      }));
      anvendt.snit = a.snit.status === "standard" ? "standard (intet snit)" : a.snit.vaerdi;
    }
    // kamera sidst: «vist» tilpasser til det, der vises nu
    if (a.kamera.status === "uaendret") anvendt.kamera = "uændret";
    else {
      var k = a.kamera.vaerdi;
      if (k.type === "retning") {
        if (V.tilpasRetning(k.retning, k.tilpas, k.fov)) anvendt.kamera = a.kamera.status === "standard" ? "standard (iso, alt)" : { retning: k.retning, tilpas: k.tilpas, fov: k.fov };
        else { adv.push("kamera: intet vises, så kameraet kan ikke tilpasses til det viste. Kameraet er ikke ændret."); anvendt.kamera = "uændret"; }
      }
      else { V.saetKamera({ position: k.position, maal: k.maal, op: k.op, fov: k.fov, animer: false }); anvendt.kamera = { position: k.position, maal: k.maal, op: k.op, fov: k.fov }; }
    }
    if (!billede) {
      // Panelernes filtre (Etage/Snit, Lag og filtre, Statiks udsnit) og Klip-panelet ligger uden for opskriften. Siger visningen noget andet end opskriften, skal det siges.
      var t = V.hentTilstand(), kunSet = a.vis.status === "sat" && a.vis.vaerdi.kun ? new Set(vaelgElementer(a.vis.vaerdi.kun, kontekst)) : null, skSet = a.vis.status === "sat" && a.vis.vaerdi.skjul ? new Set(vaelgElementer(a.vis.vaerdi.skjul, kontekst)) : null, skjultAfAndre = 0;
      if (a.vis.status !== "uaendret") kontekst.elementer.forEach(function (e, i) {
        if (!e || e.fag === "rum" || t.vis.synlige[i] == null) return;
        if (!t.vis.synlige[i] && !(kunSet && !kunSet.has(i)) && !(skSet && skSet.has(i))) skjultAfAndre++;
      });
      if (skjultAfAndre) adv.push("vis: " + skjultAfAndre + " element" + (skjultAfAndre === 1 ? "" : "er") + " er stadig skjult af et panels eget filter (Etage, Snit, Lag og filtre eller Statik), som opskriften ikke styrer.");
      if (a.snit.status === "uaendret" && t.snit && (t.snit.planer.length || t.snit.egen)) adv.push("snit: der er stadig et snit fra Klip-panelet eller visningen, som opskriften ikke har ændret.");
    }
    anvendt.billede = a.billede.status === "sat" ? "gemmes til billede (bredde " + a.billede.vaerdi.bredde + ", hoejde " + a.billede.vaerdi.hoejde + ")" : "ikke angivet";
    return { anvendt: anvendt, grupper: grupper };
  }

  // Kendte nøgler i valg-objektet: en stavefejl (fx delvist) må ikke give en stille nulstilling.
  function valgFejl(valg, kendte, hvad) {
    if (valg === undefined || valg === null) return null;
    if (!erObjekt(valg)) return hvad + ": valg skal være et objekt. Intet er ændret.";
    var u = Object.keys(valg).filter(function (k) { return kendte.indexOf(k) < 0; });
    return u.length ? hvad + ": ukendt valg " + u.map(citer).join(", ") + "." + bud(u[0], kendte) + " Kendte: " + kendte.join(", ") + ". Intet er ændret." : null;
  }

  function lavApi(V) {
    var stand = null;   // de farvegrupper, opskriften selv har sat sidst: kun dem kan hentOpskrift give tilbage

    function anvendOpskrift(opskrift, valg) {
      var vf = valgFejl(valg, ["delvis"], "anvendOpskrift");
      if (vf) return { ok: false, anvendt: null, advarsler: [vf] };
      var kontekst = lavKontekst(V), res = valider(opskrift, kontekst, valg);
      if (!res.ok) return { ok: false, anvendt: null, advarsler: res.advarsler };
      var u = udfoer(V, res, kontekst, res.advarsler, false);
      if (res.opskrift.farve.status !== "uaendret") stand = u.grupper;
      return { ok: true, anvendt: u.anvendt, advarsler: res.advarsler };
    }
    function hentOpskriftMedAdvarsler() { return opskriftFraTilstand(V.hentTilstand(), lavKontekst(V), stand); }
    function hentOpskrift() { return hentOpskriftMedAdvarsler().opskrift; }

    function gemBillede(opskrift, valg) {
      var vf = valgFejl(valg, ["bredde", "hoejde", "baggrund"], "gemBillede");
      if (vf) throw new Error(vf);
      var kontekst = lavKontekst(V), res = valider(opskrift, kontekst, { delvis: false });
      if (!res.ok) throw new Error(res.advarsler.join(" "));
      var bi = res.opskrift.billede.vaerdi || {}, v = valg || {};
      var bredde = v.bredde !== undefined ? v.bredde : bi.bredde, hoejde = v.hoejde !== undefined ? v.hoejde : bi.hoejde, baggrund = v.baggrund || bi.baggrund || "hvid";
      if (bredde == null || hoejde == null) throw new Error("Billedet mangler en størrelse: angiv bredde og hoejde i gemBillede(opskrift, {bredde, hoejde}) eller i opskriftens billede.");
      var fejl = stoerrelseFejl(bredde, hoejde);
      if (fejl) throw new Error("Billedets størrelse kan ikke bruges: " + fejl);
      if (BAGGRUNDE.indexOf(baggrund) < 0) throw new Error("Baggrunden " + citer(baggrund) + " findes ikke. Kendte: " + BAGGRUNDE.join(", ") + ".");
      var anvendt = null;
      var png = V.billede({ bredde: bredde, hoejde: hoejde, baggrund: baggrund, tegn: function () { anvendt = udfoer(V, res, kontekst, res.advarsler, true).anvendt; } });
      var maal = pngMaal(png);
      if (!maal || maal.bredde !== bredde || maal.hoejde !== hoejde)
        throw new Error("Billedet fik ikke den bestilte størrelse (" + bredde + " x " + hoejde + "; fik " + (maal ? maal.bredde + " x " + maal.hoejde : "ukendt") + "). Browseren eller grafikkortet tillader ikke så stort et billede.");
      return { png: png, bredde: bredde, hoejde: hoejde, baggrund: baggrund, anvendt: anvendt, advarsler: res.advarsler };
    }
    return { anvendOpskrift: anvendOpskrift, hentOpskrift: hentOpskrift, hentOpskriftMedAdvarsler: hentOpskriftMedAdvarsler, gemBillede: gemBillede };
  }

  function installer(V) {
    var api = lavApi(V);
    Object.keys(api).forEach(function (k) { V[k] = api[k]; });
    return V;
  }

  var api = {
    VERSION: VERSION, RETNINGER: RETNINGER, FAG: FAG, BAGGRUNDE: BAGGRUNDE, STANDARD_FOV: STANDARD_FOV, STANDARD_STIL: STANDARD_STIL, STANDARD_REST: STANDARD_REST,
    MIN_SIDE: MIN_SIDE, MAX_SIDE: MAX_SIDE, MAX_PIXELS: MAX_PIXELS,
    valider: valider, opskriftFraTilstand: opskriftFraTilstand, vaelgElementer: vaelgElementer, stoerrelseFejl: stoerrelseFejl, pngMaal: pngMaal,
    fagAf: fagAf, lavApi: lavApi, installer: installer
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (rod) rod.IssanaVisningOpskrift = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
