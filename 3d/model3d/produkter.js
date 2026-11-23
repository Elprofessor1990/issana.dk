/* ============================================================
   ISSANA – produktdata og LCA til 3D-visningen (produkter.js)

   Rent modul uden afhængigheder. I browseren/WebView2 giver <script src="produkter.js">
   window.IssanaProdukter; i Node giver require() det samme objekt.

   Produktbibliotek, format "issana-produkter/1" (eksempel: docs/issana-mcp/produktbibliotek-eksempel.json):
     {schema, navn, opdateret, produkter:[{id, navn, producent, kategori, beskrivelse, tykkelseMm,
       lyd:{Rw, C, Ctr, Lnw, kilde, metode}, uVaerdi, brand:{klasse, kilde},
       lca:{enhed, gwp:{A1A3, A4, A5, B4, C1C4, D}, epd:{nummer, udloeber, kilde}},
       pris:{beloeb, enhed, valuta, kilde, dato}, kilde, eksempel}]}
   Manglende tal er null, aldrig 0. Et tal regnes kun som dokumenteret, når det har en kilde:
     lyd → lyd.kilde · U-værdi → produktets kilde · GWP → epd.nummer eller epd.kilde · pris → pris.kilde.

   Modulet sammenholder dokumenterede værdier med brugerens egne mål. Det vurderer ikke myndighedskrav.
   LCA: modul D lægges aldrig i kgCO2e (rapporteres for sig, jf. EN 15978), og summer holdes adskilt
   pr. handlingsstatus, så et renoveringsprojekt aldrig summeres som om hele bygningen udskiftes.
   ============================================================ */
(function (rod, fabrik) {
  "use strict";
  var api = fabrik();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else if (rod) rod.IssanaProdukter = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  /* ---------- Konstanter ---------- */
  var SCHEMA = "issana-produkter/1";
  var KATEGORIER = ["vaeg", "daek", "tag", "vindue", "dor", "andet"];
  var KATEGORI_ETIKETTER = {vaeg: "Væg", daek: "Dæk", tag: "Tag", vindue: "Vindue", dor: "Dør", andet: "Andet"};
  // Filer må også bruge de danske stavemåder
  var KATEGORI_ALIAS = {"vaeg": "vaeg", "væg": "vaeg", "daek": "daek", "dæk": "daek", "tag": "tag",
    "vindue": "vindue", "dor": "dor", "dør": "dor", "doer": "dor", "andet": "andet"};
  var LYD_METODER = ["lab", "felt", "beregnet"];
  var LYD_METODE_ALIAS = {"lab": "lab", "laboratorie": "lab", "laboratorium": "lab", "felt": "felt",
    "feltmåling": "felt", "beregnet": "beregnet", "beregning": "beregnet"};
  var LCA_ENHEDER = ["m2", "m3", "stk", "kg"];
  var ENHED_ALIAS = {"m2": "m2", "m²": "m2", "m3": "m3", "m³": "m3", "stk": "stk", "stk.": "stk", "kg": "kg"};
  var ENHED_TEKST = {m2: "m²", m3: "m³", stk: "stk", kg: "kg"};
  var GWP_MODULER = ["A1A3", "A4", "A5", "B4", "C1C4", "D"];
  var MODUL_TEKST = {A1A3: "A1-A3", A4: "A4", A5: "A5", B4: "B4", C1C4: "C1-C4", D: "D"};
  var STANDARD_MODULER = ["A1A3", "C1C4"];
  var MAENGDE_FOR_ENHED = {m2: "areal", m3: "volumen", stk: "antal", kg: "masse"};
  var MAENGDE_TEKST = {areal: "areal (m²)", volumen: "volumen (m³)", antal: "antal (stk)", masse: "masse (kg)"};
  var LYD_STOERRELSER = {
    "Rw": {felter: ["Rw"], retning: "min"},
    "Rw+C": {felter: ["Rw", "C"], retning: "min"},
    "Rw+Ctr": {felter: ["Rw", "Ctr"], retning: "min"},
    "Lnw": {felter: ["Lnw"], retning: "max"}
  };
  var SORTERINGER = ["co2", "pris", "lyd"];

  // Handlingsstatus i renoveringsprojekter (samme koder som ISSANA-parametrene)
  var HANDLINGSSTATUS = Object.freeze({
    existing_not_assessed: "eksisterende (ikke vurderet)",
    retain_unchanged: "bevares uændret",
    maintain: "vedligeholdes",
    repair: "repareres",
    renovate: "renoveres",
    rebuild: "genopbygges",
    dismantle_for_reuse: "demonteres til genbrug",
    demolish: "rives ned",
    replace: "udskiftes",
    new_element: "nyt element",
    unset: "ikke angivet"
  });
  var STATUSLISTE = Object.keys(HANDLINGSSTATUS);

  // CSV-kolonner i skabelonens rækkefølge: [kolonne, sti i produktet]
  var CSV_FELTER = [
    ["id", "id"], ["navn", "navn"], ["producent", "producent"], ["kategori", "kategori"],
    ["beskrivelse", "beskrivelse"], ["tykkelseMm", "tykkelseMm"],
    ["Rw", "lyd.Rw"], ["C", "lyd.C"], ["Ctr", "lyd.Ctr"], ["Lnw", "lyd.Lnw"],
    ["lydKilde", "lyd.kilde"], ["lydMetode", "lyd.metode"],
    ["uVaerdi", "uVaerdi"], ["brandklasse", "brand.klasse"], ["brandKilde", "brand.kilde"],
    ["lcaEnhed", "lca.enhed"], ["gwpA1A3", "lca.gwp.A1A3"], ["gwpA4", "lca.gwp.A4"], ["gwpA5", "lca.gwp.A5"],
    ["gwpB4", "lca.gwp.B4"], ["gwpC1C4", "lca.gwp.C1C4"], ["gwpD", "lca.gwp.D"],
    ["epdNummer", "lca.epd.nummer"], ["epdUdloeber", "lca.epd.udloeber"], ["epdKilde", "lca.epd.kilde"],
    ["prisBeloeb", "pris.beloeb"], ["prisEnhed", "pris.enhed"], ["prisValuta", "pris.valuta"],
    ["prisKilde", "pris.kilde"], ["prisDato", "pris.dato"],
    ["kilde", "kilde"], ["eksempel", "eksempel"]
  ];
  var CSV_KOLONNER = CSV_FELTER.map(function (f) { return f[0]; });

  // Kendte felter i JSON (ukendte meldes, så tastefejl som "rw" ikke forsvinder i stilhed)
  var KENDTE_FELTER = {
    top: ["schema", "navn", "opdateret", "produkter"],
    produkt: ["id", "navn", "producent", "kategori", "beskrivelse", "tykkelseMm", "lyd", "uVaerdi", "brand",
      "lca", "pris", "kilde", "eksempel"],
    lyd: ["Rw", "C", "Ctr", "Lnw", "kilde", "metode"],
    brand: ["klasse", "kilde"],
    lca: ["enhed", "gwp", "epd"],
    gwp: GWP_MODULER,
    epd: ["nummer", "udloeber", "kilde"],
    pris: ["beloeb", "enhed", "valuta", "kilde", "dato"]
  };
  var TALFELTER = ["tykkelseMm", "lyd.Rw", "lyd.C", "lyd.Ctr", "lyd.Lnw", "uVaerdi", "lca.gwp.A1A3", "lca.gwp.A4",
    "lca.gwp.A5", "lca.gwp.B4", "lca.gwp.C1C4", "lca.gwp.D", "pris.beloeb"];

  /* ---------- Små hjælpere ---------- */
  function erTal(v) { return typeof v === "number" && isFinite(v); }
  function erObjekt(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function harTekst(v) { return typeof v === "string" && v.trim() !== ""; }
  function stort(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function vis(v) { return typeof v === "string" ? v : JSON.stringify(v); }
  function fjernBom(t) { return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t; }
  function rund(n) { var r = Math.round(n * 1e6) / 1e6; return r === 0 ? 0 : r; }
  function to(n) { return (n < 10 ? "0" : "") + n; }
  function isoAf(d) { return d.getFullYear() + "-" + to(d.getMonth() + 1) + "-" + to(d.getDate()); }
  function iDag() { return isoAf(new Date()); }
  function ikkeD(m) { return m !== "D"; }

  // Tal med dansk decimalkomma i tekst: 52,5 · 0,18 · -1,2
  function fmt(n) {
    if (!erTal(n)) return "–";
    return String(Math.round(n * 1000) / 1000).replace(".", ",");
  }
  function fmtDato(iso) { var d = iso.split("-"); return d[2] + "." + d[1] + "." + d[0]; }

  // ["a","b","c"] → "a, b og c"
  function listeTekst(liste, ord) {
    if (liste.length < 2) return liste.join("");
    return liste.slice(0, -1).join(", ") + " " + ord + " " + liste[liste.length - 1];
  }

  function hent(o, sti) {
    var dele = sti.split(".");
    for (var i = 0; i < dele.length; i++) { if (!erObjekt(o)) return undefined; o = o[dele[i]]; }
    return o;
  }
  function saetSti(o, sti, v) {
    var dele = sti.split(".");
    for (var i = 0; i < dele.length - 1; i++) { if (!erObjekt(o[dele[i]])) o[dele[i]] = {}; o = o[dele[i]]; }
    o[dele[dele.length - 1]] = v;
  }

  function laesTekst(v) {
    if (typeof v === "string") { v = v.trim(); return v === "" ? null : v; }
    if (erTal(v)) return String(v);
    return null;
  }

  // Læser tal fra fil: "52,5" og "52.5" er det samme; "1.250,50" og "1 250,50" er 1250,5.
  // Et enkelt punktum efterfulgt af tre cifre (1.250) læses som decimaltal, men meldes som tvetydigt.
  function laesTal(v) {
    if (v === null || v === undefined) return {vaerdi: null};
    if (typeof v === "number") return isFinite(v) ? {vaerdi: v} : {vaerdi: null, fejl: true};
    if (typeof v !== "string") return {vaerdi: null, fejl: true};
    var s = v.replace(/[\s  ]/g, "").replace(/−/g, "-"), tvetydig = false;
    if (s === "") return {vaerdi: null};
    var komma = s.lastIndexOf(","), punktum = s.lastIndexOf(".");
    if (komma >= 0 && punktum >= 0) {
      // Begge tegn: det sidste er decimaltegnet, det andet tusindtalsskilletegn
      s = komma > punktum ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    } else if (komma >= 0) {
      if (s.indexOf(",") !== komma) return {vaerdi: null, fejl: true};
      s = s.replace(",", ".");
    } else if (punktum >= 0 && s.indexOf(".") !== punktum) {
      s = s.replace(/\./g, "");   // 1.250.000
    } else if (/^[-+]?[1-9]\d{0,2}\.\d{3}$/.test(s)) {
      tvetydig = true;
    }
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return {vaerdi: null, fejl: true};
    var n = Number(s);
    return isFinite(n) ? {vaerdi: n, tvetydig: tvetydig} : {vaerdi: null, fejl: true};
  }

  // Dato som ÅÅÅÅ-MM-DD; dansk 30-06-2027, 30.06.2027 og 30/06/2027 forstås også
  function laesDato(v) {
    if (v === null || v === undefined) return {vaerdi: null};
    if (v instanceof Date) return isNaN(v.getTime()) ? {vaerdi: null, fejl: true} : {vaerdi: isoAf(v)};
    if (typeof v !== "string") return {vaerdi: null, fejl: true};
    var s = v.trim(), m, aar, md, dag;
    if (s === "") return {vaerdi: null};
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s))) { aar = +m[1]; md = +m[2]; dag = +m[3]; }
    else if ((m = /^(\d{1,2})[-.\/](\d{1,2})[-.\/](\d{4})$/.exec(s))) { dag = +m[1]; md = +m[2]; aar = +m[3]; }
    else return {vaerdi: null, fejl: true};
    var d = new Date(Date.UTC(aar, md - 1, dag));
    if (d.getUTCFullYear() !== aar || d.getUTCMonth() !== md - 1 || d.getUTCDate() !== dag) return {vaerdi: null, fejl: true};
    return {vaerdi: aar + "-" + to(md) + "-" + to(dag)};
  }

  function laesJaNej(v) {
    if (v === true || v === false) return {vaerdi: v};
    if (v === null || v === undefined) return {vaerdi: false};
    var s = String(v).trim().toLowerCase();
    if (s === "" || s === "nej" || s === "n" || s === "false" || s === "0") return {vaerdi: false};
    if (s === "ja" || s === "j" || s === "x" || s === "true" || s === "1") return {vaerdi: true};
    return {vaerdi: true, fejl: true};   // ukendt: hellere markeret som eksempel end som rigtige data
  }

  function normKategori(v) { var s = laesTekst(v); return s ? (KATEGORI_ALIAS[s.toLowerCase()] || null) : null; }
  function normEnhed(v) { var s = laesTekst(v); return s ? (ENHED_ALIAS[s.toLowerCase()] || null) : null; }

  /* ---------- Normalisering af ét produkt (fælles for JSON og CSV) ---------- */
  // ktx: {linje, nr, felt(sti) → "feltet «…»"/"kolonnen «…»", fejl, advarsler, tjekFelter}
  function normaliserProdukt(raa, ktx) {
    var id = laesTekst(raa.id);
    var hvem = id ? "Produkt «" + id + "»" : "Produkt nr. " + ktx.nr;
    function meld(liste, tekst) { liste.push({linje: ktx.linje, tekst: hvem + ": " + tekst}); }
    function under(o, navn, sti) {
      var v = o[navn];
      if (v === undefined || v === null) return {};
      if (!erObjekt(v)) { meld(ktx.fejl, ktx.felt(sti) + " skal være et objekt; det er sprunget over."); return {}; }
      return v;
    }
    function tal(v, sti) {
      var r = laesTal(v);
      if (r.fejl) meld(ktx.fejl, "«" + vis(v) + "» i " + ktx.felt(sti) + " er ikke et tal; feltet er sat til tomt.");
      else if (r.tvetydig) meld(ktx.advarsler, "«" + v + "» i " + ktx.felt(sti) + " er læst som " + fmt(r.vaerdi) +
        ". Er punktummet et tusindtalsskilletegn, så skriv tallet uden punktum.");
      return r.vaerdi;
    }
    function tekst(v) { return laesTekst(v); }
    function dato(v, sti) {
      var r = laesDato(v);
      if (r.fejl) meld(ktx.fejl, "«" + vis(v) + "» i " + ktx.felt(sti) + " er ikke en dato (brug ÅÅÅÅ-MM-DD); feltet er sat til tomt.");
      return r.vaerdi;
    }
    function valgt(v, sti, alias, tilladte) {
      var s = laesTekst(v);
      if (!s) return null;
      var n = alias[s.toLowerCase()];
      if (!n) { meld(ktx.fejl, "ukendt værdi «" + s + "» i " + ktx.felt(sti) + " (brug " + listeTekst(tilladte, "eller") + "); feltet er sat til tomt."); return null; }
      return n;
    }

    // Felter der gør produktet ubrugeligt: id og kategori
    var katRaa = laesTekst(raa.kategori), kat = normKategori(katRaa), stop = false;
    if (!id) { meld(ktx.fejl, "mangler id. Produktet er ikke indlæst."); stop = true; }
    if (!katRaa) { meld(ktx.fejl, "mangler kategori (" + listeTekst(KATEGORIER, "eller") + "). Produktet er ikke indlæst."); stop = true; }
    else if (!kat) { meld(ktx.fejl, "ukendt kategori «" + katRaa + "» (brug " + listeTekst(KATEGORIER, "eller") + "). Produktet er ikke indlæst."); stop = true; }
    if (stop) return null;

    var lyd = under(raa, "lyd", "lyd"), brand = under(raa, "brand", "brand"), lca = under(raa, "lca", "lca"),
      pris = under(raa, "pris", "pris"), gwp = under(lca, "gwp", "lca.gwp"), epd = under(lca, "epd", "lca.epd");

    if (ktx.tjekFelter) {
      var ukendte = function (o, kendte, praefiks) {
        Object.keys(o).forEach(function (k) {
          if (kendte.indexOf(k) >= 0) return;
          var gaet = null;
          kendte.forEach(function (kk) { if (kk.toLowerCase() === k.toLowerCase()) gaet = kk; });
          meld(ktx.advarsler, "feltet «" + praefiks + k + "» kendes ikke og er sprunget over" +
            (gaet ? " (mente du «" + praefiks + gaet + "»?)" : "") + ".");
        });
      };
      ukendte(raa, KENDTE_FELTER.produkt, ""); ukendte(lyd, KENDTE_FELTER.lyd, "lyd.");
      ukendte(brand, KENDTE_FELTER.brand, "brand."); ukendte(lca, KENDTE_FELTER.lca, "lca.");
      ukendte(gwp, KENDTE_FELTER.gwp, "lca.gwp."); ukendte(epd, KENDTE_FELTER.epd, "lca.epd.");
      ukendte(pris, KENDTE_FELTER.pris, "pris.");
    }

    var p = {
      id: id,
      navn: tekst(raa.navn),
      producent: tekst(raa.producent),
      kategori: kat,
      beskrivelse: tekst(raa.beskrivelse),
      tykkelseMm: tal(raa.tykkelseMm, "tykkelseMm"),
      lyd: {
        Rw: tal(lyd.Rw, "lyd.Rw"), C: tal(lyd.C, "lyd.C"), Ctr: tal(lyd.Ctr, "lyd.Ctr"), Lnw: tal(lyd.Lnw, "lyd.Lnw"),
        kilde: tekst(lyd.kilde), metode: valgt(lyd.metode, "lyd.metode", LYD_METODE_ALIAS, LYD_METODER)
      },
      uVaerdi: tal(raa.uVaerdi, "uVaerdi"),
      brand: {klasse: tekst(brand.klasse), kilde: tekst(brand.kilde)},
      lca: {
        enhed: valgt(lca.enhed, "lca.enhed", ENHED_ALIAS, LCA_ENHEDER),
        gwp: {},
        epd: {nummer: tekst(epd.nummer), udloeber: dato(epd.udloeber, "lca.epd.udloeber"), kilde: tekst(epd.kilde)}
      },
      pris: {
        beloeb: tal(pris.beloeb, "pris.beloeb"),
        enhed: (function () { var s = tekst(pris.enhed); return s ? (ENHED_ALIAS[s.toLowerCase()] || s) : null; })(),
        valuta: (function () { var s = tekst(pris.valuta); return s ? s.toUpperCase() : null; })(),
        kilde: tekst(pris.kilde),
        dato: dato(pris.dato, "pris.dato")
      },
      kilde: tekst(raa.kilde),
      eksempel: false
    };
    GWP_MODULER.forEach(function (m) { p.lca.gwp[m] = tal(gwp[m], "lca.gwp." + m); });
    var eks = laesJaNej(raa.eksempel);
    if (eks.fejl) meld(ktx.advarsler, "«" + vis(raa.eksempel) + "» i " + ktx.felt("eksempel") + " er hverken ja eller nej; produktet er markeret som eksempel.");
    p.eksempel = eks.vaerdi;
    if (!p.navn) meld(ktx.advarsler, "mangler navn.");
    return p;
  }

  function tilfoejProdukt(bib, set, p, linje, res) {
    if (!p) return;
    if (set[p.id]) {
      res.fejl.push({linje: linje, tekst: "Id «" + p.id + "» findes allerede" + (set[p.id].linje ? " (linje " + set[p.id].linje + ")" : "") +
        ". Denne forekomst er ikke indlæst."});
      return;
    }
    set[p.id] = {linje: linje};
    bib.produkter.push(p);
  }

  /* ---------- JSON ---------- */
  function linjeVed(tekst, pos) {
    var n = 1;
    for (var i = 0; i < pos && i < tekst.length; i++) if (tekst.charCodeAt(i) === 10) n++;
    return n;
  }
  function jsonFejlLinje(tekst, e) {
    var besked = (e && e.message) || "", m = /line (\d+)/.exec(besked);
    if (m) return +m[1];
    m = /position (\d+)/.exec(besked);
    return m ? linjeVed(tekst, +m[1]) : null;
  }
  // JSON.parse giver ingen positioner: find hvert "id"-felt i teksten og par dem i rækkefølge med produkterne
  function jsonIdLinjer(tekst, produkter) {
    var fund = [], re = /"id"\s*:\s*"((?:[^"\\]|\\.)*)"/g, m, linje = 1, pos = 0, i, k, j = 0;
    while ((m = re.exec(tekst)) !== null) {
      for (; pos < m.index; pos++) if (tekst.charCodeAt(pos) === 10) linje++;
      var v;
      try { v = JSON.parse('"' + m[1] + '"'); } catch (e) { v = m[1]; }
      fund.push({linje: linje, id: laesTekst(v)});
    }
    var linjer = [];
    for (i = 0; i < produkter.length; i++) {
      var id = erObjekt(produkter[i]) ? laesTekst(produkter[i].id) : null;
      linjer.push(null);
      if (!id) continue;
      for (k = j; k < fund.length; k++) if (fund[k].id === id) { linjer[i] = fund[k].linje; j = k + 1; break; }
    }
    return linjer;
  }

  function indlaesJson(tekst) {
    var res = {bibliotek: null, fejl: [], advarsler: []};
    if (typeof tekst !== "string" || fjernBom(tekst).trim() === "") { res.fejl.push({linje: null, tekst: "Filen er tom."}); return res; }
    tekst = fjernBom(tekst);
    var data;
    try { data = JSON.parse(tekst); }
    catch (e) {
      var l = jsonFejlLinje(tekst, e);
      res.fejl.push({linje: l, tekst: "Filen er ikke gyldig JSON. Tjek kommaer, anførselstegn og klammer" + (l ? " omkring linje " + l : "") + "."});
      return res;
    }
    var top = data;
    if (Array.isArray(data)) {
      res.advarsler.push({linje: 1, tekst: "Filen er en liste af produkter uden «schema»; den læses som " + SCHEMA + "."});
      top = {schema: SCHEMA, produkter: data};
    } else if (!erObjekt(data)) {
      res.fejl.push({linje: 1, tekst: "Filen indeholder ikke et produktbibliotek (forventede et objekt med «produkter»)."});
      return res;
    } else {
      Object.keys(top).forEach(function (k) {
        if (KENDTE_FELTER.top.indexOf(k) < 0) res.advarsler.push({linje: null, tekst: "Feltet «" + k + "» øverst i filen kendes ikke og er sprunget over."});
      });
      if (top.schema === undefined || top.schema === null) res.advarsler.push({linje: 1, tekst: "Feltet «schema» mangler; filen læses som " + SCHEMA + "."});
      else if (top.schema !== SCHEMA) {
        res.fejl.push({linje: 1, tekst: "Ukendt format «" + vis(top.schema) + "»; modulet kan læse «" + SCHEMA + "»."});
        return res;
      }
    }
    if (!Array.isArray(top.produkter)) {
      res.fejl.push({linje: null, tekst: "Feltet «produkter» mangler eller er ikke en liste."});
      return res;
    }
    var opd = laesDato(top.opdateret);
    if (opd.fejl) res.advarsler.push({linje: null, tekst: "«" + vis(top.opdateret) + "» i feltet «opdateret» er ikke en dato (brug ÅÅÅÅ-MM-DD)."});
    var bib = {schema: SCHEMA, navn: laesTekst(top.navn), opdateret: opd.vaerdi, produkter: []};
    var linjer = jsonIdLinjer(tekst, top.produkter), set = Object.create(null);
    top.produkter.forEach(function (raa, i) {
      if (!erObjekt(raa)) { res.fejl.push({linje: null, tekst: "Produkt nr. " + (i + 1) + " er ikke et objekt og er ikke indlæst."}); return; }
      var p = normaliserProdukt(raa, {
        linje: linjer[i], nr: i + 1, fejl: res.fejl, advarsler: res.advarsler, tjekFelter: true,
        felt: function (sti) { return "feltet «" + sti + "»"; }
      });
      tilfoejProdukt(bib, set, p, linjer[i], res);
    });
    if (!bib.produkter.length) res.advarsler.push({linje: null, tekst: "Der blev ikke indlæst nogen produkter."});
    res.bibliotek = bib;
    return res;
  }

  /* ---------- CSV ---------- */
  // Deler teksten i rækker og felter (semikolon, "…" som citat, "" som citattegn). Husker startlinjen.
  function delCsv(tekst) {
    var raekker = [], raekke = [], felt = "", iCitat = false, linje = 1, start = 1, citatLinje = null, i, c;
    for (i = 0; i < tekst.length; i++) {
      c = tekst.charAt(i);
      if (iCitat) {
        if (c === '"') {
          if (tekst.charAt(i + 1) === '"') { felt += '"'; i++; } else iCitat = false;
        } else { if (c === "\n") linje++; felt += c; }
        continue;
      }
      if (c === '"' && felt.trim() === "") { iCitat = true; felt = ""; citatLinje = linje; continue; }
      if (c === ";") { raekke.push(felt); felt = ""; continue; }
      if (c === "\n") {
        raekke.push(felt); raekker.push({linje: start, felter: raekke});
        raekke = []; felt = ""; linje++; start = linje;
        continue;
      }
      felt += c;
    }
    if (felt !== "" || raekke.length) { raekke.push(felt); raekker.push({linje: start, felter: raekke}); }
    return {raekker: raekker, aabentCitat: iCitat ? citatLinje : null};
  }

  function indlaesCsv(tekst, valg) {
    valg = valg || {};
    var res = {bibliotek: null, fejl: [], advarsler: []};
    if (typeof tekst !== "string" || fjernBom(tekst).trim() === "") { res.fejl.push({linje: null, tekst: "Filen er tom."}); return res; }
    var del = delCsv(fjernBom(tekst).replace(/\r\n?/g, "\n"));
    if (del.aabentCitat) res.fejl.push({linje: del.aabentCitat, tekst: "Et anførselstegn (\") på linje " + del.aabentCitat + " lukkes aldrig; resten af filen er læst som ét felt."});
    var raekker = del.raekker.filter(function (r) { return r.felter.some(harTekst); });
    if (!raekker.length) { res.fejl.push({linje: null, tekst: "Filen er tom."}); return res; }

    var hoved = raekker.shift();
    var foerste = hoved.felter[0].trim().toLowerCase();
    if (foerste.indexOf("sep=") === 0) {
      // Excel skriver nogle gange "sep=;" øverst
      if (!(foerste === "sep=" && hoved.felter.length === 2)) {
        res.fejl.push({linje: hoved.linje, tekst: "Filen angiver et andet skilletegn end semikolon («" + hoved.felter.join(";").trim() + "»). Gem den som «CSV (semikolonsepareret)»."});
        return res;
      }
      if (!raekker.length) { res.fejl.push({linje: null, tekst: "Filen har ingen kolonneoverskrifter."}); return res; }
      hoved = raekker.shift();
    }
    if (hoved.felter.length === 1 && /[,\t]/.test(hoved.felter[0])) {
      res.fejl.push({linje: hoved.linje, tekst: "Kolonneoverskrifterne er ikke adskilt med semikolon (;). Gem filen som «CSV (semikolonsepareret)», eller tag udgangspunkt i skabelonen."});
      return res;
    }

    var opslag = {}, stiTilKolonne = {}, kort = [], set = {};
    CSV_FELTER.forEach(function (f) { opslag[f[0].toLowerCase()] = f; stiTilKolonne[f[1]] = f[0]; });
    hoved.felter.forEach(function (navn) {
      var n = navn.trim(), f = opslag[n.toLowerCase()];
      if (!n) { kort.push(null); return; }
      if (!f) { res.advarsler.push({linje: hoved.linje, tekst: "Kolonnen «" + n + "» kendes ikke og springes over."}); kort.push(null); return; }
      if (set[f[0]]) { res.fejl.push({linje: hoved.linje, tekst: "Kolonnen «" + f[0] + "» står flere gange; kun den første bruges."}); kort.push(null); return; }
      set[f[0]] = true; kort.push(f);
    });
    ["id", "kategori"].forEach(function (k) {
      if (!set[k]) res.fejl.push({linje: hoved.linje, tekst: "Kolonnen «" + k + "» mangler i overskriften."});
    });
    if (!set.id || !set.kategori) return res;

    var bib = {schema: SCHEMA, navn: laesTekst(valg.navn), opdateret: null, produkter: []}, ids = Object.create(null);
    var felt = function (sti) { return "kolonnen «" + (stiTilKolonne[sti] || sti) + "»"; };
    raekker.forEach(function (r, i) {
      if (r.felter.length > kort.length && r.felter.slice(kort.length).some(harTekst))
        res.advarsler.push({linje: r.linje, tekst: "Linjen har flere felter end overskriften; de overskydende er sprunget over."});
      var raa = {};
      kort.forEach(function (f, c) { if (f) saetSti(raa, f[1], r.felter[c] === undefined ? "" : r.felter[c]); });
      var p = normaliserProdukt(raa, {linje: r.linje, nr: i + 1, felt: felt, fejl: res.fejl, advarsler: res.advarsler, tjekFelter: false});
      tilfoejProdukt(bib, ids, p, r.linje, res);
    });
    if (!bib.produkter.length) res.advarsler.push({linje: null, tekst: "Der blev ikke indlæst nogen produkter."});
    res.bibliotek = bib;
    return res;
  }

  /* ---------- Kontrol af et bibliotek ---------- */
  // valg: {dato} (Date eller ÅÅÅÅ-MM-DD; standard i dag) → {fejl:[{id, felt, tekst}], advarsler:[…], dato}
  function valider(bibliotek, valg) {
    valg = valg || {};
    var dato = laesDato(valg.dato).vaerdi || iDag();
    var res = {fejl: [], advarsler: [], dato: dato};
    if (!erObjekt(bibliotek)) { res.fejl.push({id: null, felt: null, tekst: "Der er intet produktbibliotek at kontrollere."}); return res; }
    if (bibliotek.schema !== SCHEMA)
      res.fejl.push({id: null, felt: "schema", tekst: "Biblioteket har formatet «" + vis(bibliotek.schema) + "»; forventet «" + SCHEMA + "»."});
    if (!Array.isArray(bibliotek.produkter)) {
      res.fejl.push({id: null, felt: "produkter", tekst: "Biblioteket har ingen produktliste («produkter»)."});
      return res;
    }
    if (!bibliotek.produkter.length) res.advarsler.push({id: null, felt: "produkter", tekst: "Biblioteket indeholder ingen produkter."});
    var set = Object.create(null);
    bibliotek.produkter.forEach(function (p, i) {
      var id = erObjekt(p) ? laesTekst(p.id) : null;
      var hvem = id ? "Produkt «" + id + "»" : "Produkt nr. " + (i + 1);
      function f(felt, tekst) { res.fejl.push({id: id, felt: felt, tekst: hvem + ": " + tekst}); }
      function a(felt, tekst) { res.advarsler.push({id: id, felt: felt, tekst: hvem + ": " + tekst}); }
      if (!erObjekt(p)) { f(null, "er ikke et objekt."); return; }

      // Fejl: strukturen
      if (!id) f("id", "mangler id.");
      else if (set[id]) f("id", "id'et findes flere gange i biblioteket.");
      else set[id] = true;
      if (KATEGORIER.indexOf(p.kategori) < 0) f("kategori", p.kategori ? "ukendt kategori «" + vis(p.kategori) + "»." : "mangler kategori.");
      TALFELTER.forEach(function (sti) {
        var v = hent(p, sti);
        if (v !== null && v !== undefined && !erTal(v)) f(sti, "feltet «" + sti + "» skal være et tal eller tomt (null), ikke «" + vis(v) + "».");
      });
      var lyd = erObjekt(p.lyd) ? p.lyd : {}, lca = erObjekt(p.lca) ? p.lca : {}, gwp = erObjekt(lca.gwp) ? lca.gwp : {},
        epd = erObjekt(lca.epd) ? lca.epd : {}, pris = erObjekt(p.pris) ? p.pris : {}, brand = erObjekt(p.brand) ? p.brand : {};
      if (lyd.metode != null && LYD_METODER.indexOf(lyd.metode) < 0) f("lyd.metode", "ukendt lydmetode «" + vis(lyd.metode) + "» (brug lab, felt eller beregnet).");
      if (lca.enhed != null && LCA_ENHEDER.indexOf(lca.enhed) < 0) f("lca.enhed", "ukendt LCA-enhed «" + vis(lca.enhed) + "» (brug m2, m3, stk eller kg).");
      var udl = laesDato(epd.udloeber);
      if (udl.fejl) f("lca.epd.udloeber", "udløbsdatoen «" + vis(epd.udloeber) + "» er ikke en dato (brug ÅÅÅÅ-MM-DD).");

      // Advarsler: indholdet
      if (p.eksempel === true) a("eksempel", "er et eksempelprodukt med opdigtede tal, ikke rigtige produktdata.");
      if (!harTekst(p.navn)) a("navn", "mangler navn.");
      var lydFelter = ["Rw", "C", "Ctr", "Lnw"].filter(function (k) { return erTal(lyd[k]); });
      if (lydFelter.length && !harTekst(lyd.kilde)) a("lyd.kilde", listeTekst(lydFelter, "og") + " er angivet uden kilde.");
      if (lydFelter.length && lyd.metode == null) a("lyd.metode", "lydværdierne har ingen metode (lab, felt eller beregnet).");
      if (erTal(lyd.Rw) && (lyd.Rw < 0 || lyd.Rw > 100)) a("lyd.Rw", "Rw " + fmt(lyd.Rw) + " dB ligger uden for det sædvanlige område (0-100 dB). Tjek tallet.");
      if (erTal(lyd.Lnw) && (lyd.Lnw < 0 || lyd.Lnw > 120)) a("lyd.Lnw", "Lnw " + fmt(lyd.Lnw) + " dB ligger uden for det sædvanlige område (0-120 dB). Tjek tallet.");
      ["C", "Ctr"].forEach(function (k) {
        if (erTal(lyd[k]) && lyd[k] > 0) a("lyd." + k, k + " er positiv (" + fmt(lyd[k]) + " dB); spektrumtilpasningsled er normalt 0 eller negative. Tjek fortegnet.");
      });
      if (erTal(p.uVaerdi) && !harTekst(p.kilde)) a("uVaerdi", "U-værdien er angivet uden kilde (produktets kilde).");
      if (erTal(p.uVaerdi) && (p.uVaerdi <= 0 || p.uVaerdi > 6)) a("uVaerdi", "U-værdien " + fmt(p.uVaerdi) + " W/m²K ligger uden for det sædvanlige område. Tjek tallet.");
      if (erTal(p.tykkelseMm) && p.tykkelseMm <= 0) a("tykkelseMm", "tykkelsen skal være større end 0 mm.");
      if (harTekst(brand.klasse) && !harTekst(brand.kilde)) a("brand.kilde", "brandklassen er angivet uden kilde.");
      var gwpFelter = GWP_MODULER.filter(function (m) { return erTal(gwp[m]); });
      if (gwpFelter.length) {
        if (!lca.enhed) a("lca.enhed", "har GWP-tal, men ingen LCA-enhed; LCA kan ikke beregnes.");
        if (!harTekst(epd.nummer) && !harTekst(epd.kilde)) a("lca.epd", "GWP-tallene har intet EPD-nummer eller kilde.");
        if (!erTal(gwp.A1A3)) a("lca.gwp.A1A3", "mangler GWP A1-A3.");
      }
      if (udl.vaerdi && udl.vaerdi < dato)
        a("lca.epd.udloeber", "EPD" + (harTekst(epd.nummer) ? " «" + epd.nummer + "»" : "") + " udløb " + fmtDato(udl.vaerdi) + " (før " + fmtDato(dato) + ").");
      if (erTal(pris.beloeb)) {
        var mangler = [];
        if (!harTekst(pris.enhed)) mangler.push("enhed");
        if (!harTekst(pris.valuta)) mangler.push("valuta");
        if (!harTekst(pris.kilde)) mangler.push("kilde");
        if (!pris.dato) mangler.push("dato");
        if (mangler.length) a("pris", "prisen mangler " + listeTekst(mangler, "og") + ".");
      }
      if (!harTekst(p.kilde) && !harTekst(lyd.kilde) && !harTekst(epd.kilde) && !harTekst(epd.nummer) &&
          !harTekst(pris.kilde) && !harTekst(brand.kilde)) a("kilde", "har ingen kilde.");
    });
    return res;
  }

  /* ---------- Nøgletal til sammenligning ---------- */
  function lydVaerdi(lyd, felter) {
    var sum = 0, mangler = [];
    felter.forEach(function (k) { if (erTal(lyd[k])) sum += lyd[k]; else mangler.push(k); });
    return {vaerdi: mangler.length ? null : sum, mangler: mangler};
  }

  // CO₂ pr. deklareret enhed for de valgte moduler (uden D). m³ omregnes til m² med tykkelsen.
  function co2Noegletal(p, moduler) {
    var lca = erObjekt(p.lca) ? p.lca : {}, gwp = erObjekt(lca.gwp) ? lca.gwp : {};
    var enhed = normEnhed(lca.enhed);
    if (!enhed) return {mangler: "mangler LCA-enhed"};
    var sum = 0, mangler = [];
    moduler.filter(ikkeD).forEach(function (m) { if (erTal(gwp[m])) sum += gwp[m]; else mangler.push("GWP " + MODUL_TEKST[m]); });
    if (mangler.length) return {mangler: "mangler " + listeTekst(mangler, "og")};
    if (enhed === "m3" && erTal(p.tykkelseMm) && p.tykkelseMm > 0)
      return {vaerdi: sum * p.tykkelseMm / 1000, enhed: "m2", gruppe: "m2", omregnet: true};
    return {vaerdi: sum, enhed: enhed, gruppe: enhed, omregnet: false};
  }

  function prisNoegletal(p) {
    var pr = erObjekt(p.pris) ? p.pris : {};
    if (!erTal(pr.beloeb)) return {mangler: "mangler pris"};
    if (!harTekst(pr.enhed)) return {mangler: "prisen mangler enhed"};
    var enhed = ENHED_ALIAS[pr.enhed.toLowerCase()] || pr.enhed, valuta = harTekst(pr.valuta) ? pr.valuta : null;
    return {vaerdi: pr.beloeb, enhed: enhed, valuta: valuta, gruppe: enhed + "|" + (valuta || ""),
      kilde: harTekst(pr.kilde) ? pr.kilde : null, dato: pr.dato || null};
  }
  function prisGruppeTekst(g) {
    var d = g.split("|");
    return (d[1] ? d[1] + " " : "") + "pr. " + (ENHED_TEKST[d[0]] || d[0]);
  }

  // Dokumenteret værdi sammenholdt med et mål (ingen vurdering af krav)
  function sammenhold(maal, vaerdi, kilde, metode) {
    var inden = maal.retning === "min" ? vaerdi >= maal.vaerdi : vaerdi <= maal.vaerdi;
    var tegn = maal.retning === "min" ? "≥" : "≤";
    var vt = maal.stoerrelse + " " + fmt(vaerdi) + " " + maal.enhed;
    return {
      inden: inden,
      post: {stoerrelse: maal.stoerrelse, vaerdi: vaerdi, maal: maal.vaerdi, retning: maal.retning, forskel: rund(vaerdi - maal.vaerdi),
        enhed: maal.enhed, kilde: kilde || null, metode: metode || null,
        tekst: vt + " (mål " + tegn + " " + fmt(maal.vaerdi) + " " + maal.enhed + ")"},
      tekst: "dokumenteret " + vt + " ligger " + (maal.retning === "min" ? "under" : "over") + " målet " + fmt(maal.vaerdi) + " " + maal.enhed
    };
  }

  function tjekModuler(moduler, fejl) {
    if (moduler === undefined || moduler === null) return STANDARD_MODULER.slice();
    if (!Array.isArray(moduler) || !moduler.length) { fejl("Moduler skal være en liste, fx [\"A1A3\", \"C1C4\"]."); return []; }
    moduler.forEach(function (m) {
      if (GWP_MODULER.indexOf(m) < 0) fejl("Ukendt LCA-modul «" + vis(m) + "» (brug " + listeTekst(GWP_MODULER, "eller") + ").");
    });
    return moduler.slice();
  }

  // Den hyppigste gruppe; ved lighed vinder præferencerækkefølgen og derefter den første
  function vaelgGruppe(orden, taelling, praeference) {
    var bedst = null;
    orden.forEach(function (g) {
      if (bedst === null || taelling[g] > taelling[bedst]) { bedst = g; return; }
      if (taelling[g] === taelling[bedst] && praeference) {
        var a = praeference.indexOf(g), b = praeference.indexOf(bedst);
        if (a >= 0 && (b < 0 || a < b)) bedst = g;
      }
    });
    return bedst;
  }

  /* ---------- Forslag til produkter ---------- */
  // valg: {bibliotek, kategori, maal:{lyd:{stoerrelse, vaerdi, retning}, uVaerdi:{vaerdi, retning}},
  //        sorter:"co2"|"pris"|"lyd", antal, moduler, dato}
  // → {forslag:[…], udeladt:[{id, navn, grund, koder}], fejl:[{tekst}], grundlag, forbehold}
  function foreslaa(valg) {
    valg = valg || {};
    var res = {forslag: [], udeladt: [], fejl: [], grundlag: null,
      forbehold: "Forslagene sammenholder dokumenterede produktværdier med de angivne mål. De er ikke en vurdering af myndighedskrav."};
    function fejl(t) { res.fejl.push({tekst: t}); }
    var bib = valg.bibliotek;
    if (!erObjekt(bib) || !Array.isArray(bib.produkter)) fejl("Der er intet produktbibliotek at foreslå fra.");
    var kategori = null;
    if (valg.kategori !== undefined && valg.kategori !== null && valg.kategori !== "") {
      kategori = normKategori(valg.kategori);
      if (!kategori) fejl("Ukendt kategori «" + vis(valg.kategori) + "» (brug " + listeTekst(KATEGORIER, "eller") + ").");
    }
    var sorter = valg.sorter || "co2";
    if (SORTERINGER.indexOf(sorter) < 0) fejl("Ukendt sortering «" + vis(sorter) + "» (brug co2, pris eller lyd).");
    var moduler = tjekModuler(valg.moduler, fejl);
    if (moduler.length && !moduler.filter(ikkeD).length) fejl("Vælg mindst ét LCA-modul ud over D; modul D rapporteres for sig.");

    var maal = erObjekt(valg.maal) ? valg.maal : {}, lydMaal = null, uMaal = null;
    if (maal.lyd) {
      var st = maal.lyd.stoerrelse || "Rw", def = LYD_STOERRELSER[st];
      var lv = laesTal(maal.lyd.vaerdi).vaerdi, lr = maal.lyd.retning || (def && def.retning);
      if (!def) fejl("Ukendt lydstørrelse «" + vis(st) + "» (brug Rw, Rw+C, Rw+Ctr eller Lnw).");
      else if (lv === null) fejl("Lydmålet for " + st + " mangler en talværdi.");
      else if (lr !== "min" && lr !== "max") fejl("Retningen for lydmålet skal være «min» eller «max».");
      else lydMaal = {stoerrelse: st, felter: def.felter, vaerdi: lv, retning: lr, enhed: "dB"};
    }
    if (maal.uVaerdi) {
      var uv = laesTal(maal.uVaerdi.vaerdi).vaerdi, ur = maal.uVaerdi.retning || "max";
      if (uv === null) fejl("U-værdimålet mangler en talværdi.");
      else if (ur !== "min" && ur !== "max") fejl("Retningen for U-værdimålet skal være «min» eller «max».");
      else uMaal = {stoerrelse: "U-værdi", vaerdi: uv, retning: ur, enhed: "W/m²K"};
    }
    var antal = erTal(valg.antal) && valg.antal >= 1 ? Math.floor(valg.antal) : 3;
    var dato = laesDato(valg.dato).vaerdi || iDag();
    if (res.fejl.length) return res;

    var lydSortDef = lydMaal || {stoerrelse: "Rw", felter: ["Rw"], retning: "min"};
    var kandidater = [];
    bib.produkter.forEach(function (p) {
      if (!erObjekt(p) || (kategori && p.kategori !== kategori)) return;
      var lyd = erObjekt(p.lyd) ? p.lyd : {}, grunde = [], koder = [], sammenligning = [], bem = [];
      function grund(kode, tekst) { if (koder.indexOf(kode) < 0) koder.push(kode); grunde.push(tekst); }

      if (lydMaal) {
        var l = lydVaerdi(lyd, lydMaal.felter);
        if (l.mangler.length) grund("mangler_data", "mangler " + listeTekst(l.mangler, "og"));
        else if (!harTekst(lyd.kilde)) grund("uden_kilde", lydMaal.stoerrelse + " er angivet uden kilde");
        else {
          var s = sammenhold(lydMaal, l.vaerdi, lyd.kilde, lyd.metode);
          if (s.inden) sammenligning.push(s.post); else grund("uden_for_maal", s.tekst);
        }
      }
      if (uMaal) {
        if (!erTal(p.uVaerdi)) grund("mangler_data", "mangler U-værdi");
        else if (!harTekst(p.kilde)) grund("uden_kilde", "U-værdien er angivet uden kilde");
        else {
          var su = sammenhold(uMaal, p.uVaerdi, p.kilde, null);
          if (su.inden) sammenligning.push(su.post); else grund("uden_for_maal", su.tekst);
        }
      }
      var co2 = co2Noegletal(p, moduler), pris = prisNoegletal(p), lydSort = lydVaerdi(lyd, lydSortDef.felter);
      if (sorter === "co2" && co2.mangler) grund("kan_ikke_sorteres", "kan ikke sorteres efter CO₂: " + co2.mangler);
      if (sorter === "pris" && pris.mangler) grund("kan_ikke_sorteres", "kan ikke sorteres efter pris: " + pris.mangler);
      if (sorter === "lyd" && !lydMaal && lydSort.mangler.length) grund("kan_ikke_sorteres", "kan ikke sorteres efter lyd: mangler " + listeTekst(lydSort.mangler, "og"));
      if (grunde.length) { res.udeladt.push({id: p.id || null, navn: p.navn || null, grund: stort(grunde.join("; ")) + ".", koder: koder}); return; }

      // Bemærkninger til de værdier, der vises
      if (p.eksempel === true) bem.push("Eksempeldata med opdigtede tal, ikke rigtige produktdata.");
      if (lydMaal || sorter === "lyd") {
        if (lyd.metode === "lab") bem.push("Lydværdien er målt i laboratorium; i bygningen afhænger den også af flanketransmission.");
        else if (lyd.metode === "beregnet") bem.push("Lydværdien er beregnet, ikke målt.");
        else if (!lyd.metode) bem.push("Lydværdien har ingen angivet metode (lab, felt eller beregnet).");
        if (!lydMaal && !harTekst(lyd.kilde)) bem.push("Lydværdien har ingen kilde.");
      }
      if (!co2.mangler) {
        var epd = erObjekt(p.lca) && erObjekt(p.lca.epd) ? p.lca.epd : {}, udl = laesDato(epd.udloeber).vaerdi;
        if (!harTekst(epd.nummer) && !harTekst(epd.kilde)) bem.push("GWP-tallene har intet EPD-nummer eller kilde.");
        if (udl && udl < dato) bem.push("EPD" + (harTekst(epd.nummer) ? " «" + epd.nummer + "»" : "") + " udløb " + fmtDato(udl) + ".");
        if (co2.omregnet) bem.push("CO₂ er omregnet fra pr. m³ med tykkelsen " + fmt(p.tykkelseMm) + " mm.");
      }
      if (!pris.mangler && !pris.kilde) bem.push("Prisen har ingen kilde.");
      kandidater.push({p: p, sammenligning: sammenligning, co2: co2, pris: pris, lydSort: lydSort, bem: bem});
    });

    // CO₂ og pris kan kun sorteres inden for samme enhed (fx pr. m²); de andre meldes
    var grundlagEnhed = null;
    if (sorter === "co2" || sorter === "pris") {
      var taelling = {}, orden = [];
      kandidater.forEach(function (k) {
        var g = k[sorter].gruppe;
        if (!taelling[g]) { taelling[g] = 0; orden.push(g); }
        taelling[g]++;
      });
      var valgt = vaelgGruppe(orden, taelling, sorter === "co2" ? ["m2", "stk", "m3", "kg"] : null);
      var gruppeTekst = function (g) { return sorter === "co2" ? "pr. " + ENHED_TEKST[g] : prisGruppeTekst(g); };
      if (valgt !== null) grundlagEnhed = sorter === "co2" ? "kg CO₂e pr. " + ENHED_TEKST[valgt] : prisGruppeTekst(valgt);
      kandidater = kandidater.filter(function (k) {
        if (k[sorter].gruppe === valgt) return true;
        res.udeladt.push({id: k.p.id || null, navn: k.p.navn || null, koder: ["kan_ikke_sorteres"],
          grund: (sorter === "co2" ? "CO₂" : "Prisen") + " er opgjort " + gruppeTekst(k[sorter].gruppe) +
            " og kan ikke sorteres sammen med de øvrige, der er opgjort " + gruppeTekst(valgt) + "."});
        return false;
      });
    }

    kandidater.sort(function (a, b) {
      var d;
      if (sorter === "co2") d = a.co2.vaerdi - b.co2.vaerdi;
      else if (sorter === "pris") d = a.pris.vaerdi - b.pris.vaerdi;
      else d = lydSortDef.retning === "min" ? b.lydSort.vaerdi - a.lydSort.vaerdi : a.lydSort.vaerdi - b.lydSort.vaerdi;
      if (d !== 0) return d;
      return a.p.id < b.p.id ? -1 : (a.p.id > b.p.id ? 1 : 0);
    });

    var modulTekst = moduler.filter(ikkeD).map(function (m) { return MODUL_TEKST[m]; });
    res.forslag = kandidater.slice(0, antal).map(function (k, i) {
      return {
        rang: i + 1,
        id: k.p.id, navn: k.p.navn || null, producent: k.p.producent || null, kategori: k.p.kategori,
        sammenligning: k.sammenligning,
        co2: k.co2.mangler ? null : {vaerdi: rund(k.co2.vaerdi), enhed: k.co2.enhed, enhedTekst: "kg CO₂e pr. " + ENHED_TEKST[k.co2.enhed],
          moduler: modulTekst.slice(), omregnet: k.co2.omregnet},
        pris: k.pris.mangler ? null : {beloeb: k.pris.vaerdi, enhed: k.pris.enhed, valuta: k.pris.valuta, kilde: k.pris.kilde, dato: k.pris.dato},
        lyd: k.lydSort.vaerdi === null ? null : {stoerrelse: lydSortDef.stoerrelse, vaerdi: k.lydSort.vaerdi, enhed: "dB",
          kilde: (erObjekt(k.p.lyd) && k.p.lyd.kilde) || null, metode: (erObjekt(k.p.lyd) && k.p.lyd.metode) || null},
        eksempel: k.p.eksempel === true,
        bemaerkninger: k.bem,
        produkt: k.p
      };
    });
    res.grundlag = {
      kategori: kategori, sorter: sorter, moduler: modulTekst,
      maal: {
        lyd: lydMaal ? {stoerrelse: lydMaal.stoerrelse, vaerdi: lydMaal.vaerdi, retning: lydMaal.retning} : null,
        uVaerdi: uMaal ? {vaerdi: uMaal.vaerdi, retning: uMaal.retning} : null
      },
      sammenligningsenhed: grundlagEnhed, dato: dato,
      antalKandidater: kandidater.length, antalVist: res.forslag.length
    };
    return res;
  }

  /* ---------- LCA for ét element ---------- */
  // valg: {produkt, maengde:{areal, volumen, antal, masse}, moduler}
  // → {status:"beregnet"|"needs_input", kgCO2e, pr:{modul: kg}, mangler:[…], mangelTyper:[…], modulD, …}
  // Produktets lca.enhed vælger mængden (m2 → areal, m3 → volumen, stk → antal, kg → masse).
  function lcaElement(valg) {
    valg = valg || {};
    var p = valg.produkt, maengde = erObjekt(valg.maengde) ? valg.maengde : {};
    var modulFejl = [], moduler = tjekModuler(valg.moduler, function (t) { modulFejl.push(t); });
    var res = {status: "needs_input", kgCO2e: null, pr: {}, mangler: [], mangelTyper: [], modulD: null,
      moduler: moduler.slice(), enhed: null, maengdeBrugt: null,
      produktId: erObjekt(p) ? (p.id || null) : null, eksempel: erObjekt(p) && p.eksempel === true};
    function mangl(type, tekst) { res.mangler.push(tekst); if (res.mangelTyper.indexOf(type) < 0) res.mangelTyper.push(type); }
    moduler.forEach(function (m) { res.pr[m] = null; });
    modulFejl.forEach(function (t) { mangl("modul", t); });
    if (!erObjekt(p)) { mangl("produkt", "produkt"); return res; }

    var lca = erObjekt(p.lca) ? p.lca : {}, gwp = erObjekt(lca.gwp) ? lca.gwp : {}, enhed = normEnhed(lca.enhed), q = null;
    res.enhed = enhed;
    if (!enhed) mangl("lcaData", "LCA-enhed i produktdata (m2, m3, stk eller kg)");
    else {
      var felt = MAENGDE_FOR_ENHED[enhed], r = laesTal(maengde[felt]);
      if (r.vaerdi === null) mangl("maengde", MAENGDE_TEKST[felt]);
      else if (r.vaerdi < 0) mangl("maengde", MAENGDE_TEKST[felt] + " som et tal ≥ 0");
      else { q = r.vaerdi; res.maengdeBrugt = {felt: felt, vaerdi: q, enhed: enhed}; }
    }
    var sum = 0, antalModuler = 0;
    moduler.forEach(function (m) {
      if (GWP_MODULER.indexOf(m) < 0) return;
      if (!erTal(gwp[m])) { mangl("lcaData", "GWP " + MODUL_TEKST[m] + " i produktdata"); return; }
      if (q === null) return;
      res.pr[m] = rund(gwp[m] * q);
      if (m !== "D") { sum += gwp[m] * q; antalModuler++; }
    });
    if (res.mangler.length) return res;
    res.status = "beregnet";
    res.kgCO2e = antalModuler ? rund(sum) : null;
    if (moduler.indexOf("D") >= 0) res.modulD = res.pr.D;
    return res;
  }

  /* ---------- LCA-summer pr. handlingsstatus ---------- */
  // valg: {elementer:[{id, handlingsstatus, produkt, maengde}], moduler, modulerPrStatus:{status:[…]}, medtagStatus:[…]}
  // Summerne holdes adskilt pr. status; totalen tæller kun statusserne i medtagStatus.
  // VEJLEDENDE, IKKE ISSANA LCA: en produktsammenligning til renovering (Produkter-fanen). BR18-tallet (kg CO₂e/m²/år,
  // moduler, mangler) regnes kun af ISSANA LCA's Rust-kerne gennem issana_lca_beregn (LCA-fanen, lca-projekt.js).
  function lcaSum(valg) {
    valg = valg || {};
    var res = {prStatus: {}, total: null, fejl: [], advarsler: [], moduler: null};
    var moduler = tjekModuler(valg.moduler, function (t) { res.fejl.push({id: null, tekst: t}); });
    res.moduler = moduler.slice();
    var prStatusModuler = erObjekt(valg.modulerPrStatus) ? valg.modulerPrStatus : {};
    Object.keys(prStatusModuler).forEach(function (s) {
      if (!HANDLINGSSTATUS.hasOwnProperty(s)) res.fejl.push({id: null, tekst: "Ukendt handlingsstatus «" + s + "» i modulerPrStatus."});
    });
    function modulerFor(s) {
      return Array.isArray(prStatusModuler[s]) ? tjekModuler(prStatusModuler[s], function (t) { res.fejl.push({id: null, tekst: t}); }) : moduler;
    }
    STATUSLISTE.forEach(function (s) {
      var mods = modulerFor(s), pr = {};
      mods.forEach(function (m) { pr[m] = null; });
      res.prStatus[s] = {status: s, etiket: HANDLINGSSTATUS[s], moduler: mods.slice(),
        antalElementer: 0, antalBeregnet: 0, antalIkkeBeregnet: 0,
        antalUdenProdukt: 0, antalUdenMaengde: 0, antalManglerLcaData: 0,
        kgCO2e: null, pr: pr, modulD: null, komplet: true, ikkeBeregnet: []};
    });

    var elementer = Array.isArray(valg.elementer) ? valg.elementer : [];
    if (!Array.isArray(valg.elementer)) res.fejl.push({id: null, tekst: "Elementlisten mangler («elementer»)."});
    else if (!elementer.length) res.advarsler.push({id: null, tekst: "Der er ingen elementer at summere."});

    var sete = Object.create(null);
    elementer.forEach(function (el, i) {
      el = erObjekt(el) ? el : {};
      var id = el.id !== undefined && el.id !== null ? el.id : null, navn = id !== null ? "Element «" + id + "»" : "Element nr. " + (i + 1);
      if (id !== null) {
        var noegle = String(id);
        sete[noegle] = (sete[noegle] || 0) + 1;
        if (sete[noegle] === 2) res.advarsler.push({id: id, tekst: navn + " optræder flere gange; det er talt med hver gang."});
      }
      var status = el.handlingsstatus;
      if (status === undefined || status === null || status === "") status = "unset";
      else if (!HANDLINGSSTATUS.hasOwnProperty(status)) {
        res.fejl.push({id: id, tekst: navn + " har ukendt handlingsstatus «" + vis(status) + "»; det er talt som «" + HANDLINGSSTATUS.unset + "»."});
        status = "unset";
      }
      var s = res.prStatus[status];
      var r = lcaElement({produkt: el.produkt, maengde: el.maengde, moduler: s.moduler});
      s.antalElementer++;
      if (r.status === "beregnet") {
        s.antalBeregnet++;
        if (r.kgCO2e !== null) s.kgCO2e = rund((s.kgCO2e || 0) + r.kgCO2e);
        s.moduler.forEach(function (m) { if (erTal(r.pr[m])) s.pr[m] = rund((s.pr[m] || 0) + r.pr[m]); });
        if (erTal(r.modulD)) s.modulD = rund((s.modulD || 0) + r.modulD);
      } else {
        s.antalIkkeBeregnet++;
        s.komplet = false;
        if (r.mangelTyper.indexOf("produkt") >= 0) s.antalUdenProdukt++;
        if (r.mangelTyper.indexOf("maengde") >= 0) s.antalUdenMaengde++;
        if (r.mangelTyper.indexOf("lcaData") >= 0) s.antalManglerLcaData++;
        s.ikkeBeregnet.push({id: id, mangler: r.mangler});
      }
    });

    // Total kun over de valgte statusser
    var medtag = [];
    if (Array.isArray(valg.medtagStatus)) {
      valg.medtagStatus.forEach(function (s) {
        if (!HANDLINGSSTATUS.hasOwnProperty(s)) res.fejl.push({id: null, tekst: "Ukendt handlingsstatus «" + vis(s) + "» i medtagStatus."});
        else if (medtag.indexOf(s) < 0) medtag.push(s);
      });
    }
    var total = {medtagStatus: medtag.slice(), etiketter: medtag.map(function (s) { return HANDLINGSSTATUS[s]; }),
      antalElementer: 0, antalBeregnet: 0, antalIkkeBeregnet: 0, antalUdenProdukt: 0, antalUdenMaengde: 0, antalManglerLcaData: 0,
      kgCO2e: null, pr: {}, modulD: null, komplet: true, ikkeMedtaget: []};
    STATUSLISTE.forEach(function (st) {
      var s = res.prStatus[st];
      if (medtag.indexOf(st) < 0) {
        if (s.antalElementer) total.ikkeMedtaget.push({status: st, etiket: s.etiket, antalElementer: s.antalElementer, kgCO2e: s.kgCO2e});
        return;
      }
      ["antalElementer", "antalBeregnet", "antalIkkeBeregnet", "antalUdenProdukt", "antalUdenMaengde", "antalManglerLcaData"]
        .forEach(function (k) { total[k] += s[k]; });
      if (s.kgCO2e !== null) total.kgCO2e = rund((total.kgCO2e || 0) + s.kgCO2e);
      if (s.modulD !== null) total.modulD = rund((total.modulD || 0) + s.modulD);
      Object.keys(s.pr).forEach(function (m) {
        if (!total.pr.hasOwnProperty(m)) total.pr[m] = null;
        if (s.pr[m] !== null) total.pr[m] = rund((total.pr[m] || 0) + s.pr[m]);
      });
      if (!s.komplet) total.komplet = false;
    });
    if (!medtag.length) {
      total.komplet = false;
      res.advarsler.push({id: null, tekst: "Ingen handlingsstatus er valgt til totalen; vælg hvilke statusser der skal indgå."});
    }
    res.total = total;
    return res;
  }

  /* ---------- Udadtil ---------- */
  return {
    SCHEMA: SCHEMA,
    KATEGORIER: Object.freeze(KATEGORIER.slice()),
    KATEGORI_ETIKETTER: Object.freeze(KATEGORI_ETIKETTER),
    GWP_MODULER: Object.freeze(GWP_MODULER.slice()),
    STANDARD_MODULER: Object.freeze(STANDARD_MODULER.slice()),
    HANDLINGSSTATUS: HANDLINGSSTATUS,
    CSV_KOLONNER: Object.freeze(CSV_KOLONNER.slice()),
    indlaesJson: indlaesJson,
    indlaesCsv: indlaesCsv,
    valider: valider,
    foreslaa: foreslaa,
    lcaElement: lcaElement,
    lcaSum: lcaSum,
    laesTal: laesTal
  };
});
