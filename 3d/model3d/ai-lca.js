/* ============================================================
   ISSANA 3D: LCA-delen af AI-feltet (ai-lca.js)

   Rent modul uden DOM. I browseren: window.IssanaAiLca; i Node: module.exports. arbejdsrum-ai.js kalder det, når
   AI'en svarer med lca_status, foreslaa_produkt eller saet_lca; LCA-fanen kan læse træet via window.issanaLca.struktur().

   Tre ting:
   1) kilder/status: hvilke typer har CO₂-data i dag, og hvor det kommer fra. Kilderne er KUN dem, der findes i siden:
        - ISSANA Konstruktion-eksporten koblet på modellen («Hent data» i fanen ISSANA Konstruktion): element.suite.co2,
          kg CO₂e/m² for A1–D (det LCA-fanen summerer i dag),
        - produktbiblioteket issana-produkter/1 (Produkter-fanen; produkter.js) med GWP pr. modul og EPD som kilde,
        - typens datapost issana-bygdata/1 (feltet lca, sat tidligere og bekræftet, eller produkt-koblingen).
      Der findes INGEN generiske BR18-værdier i ISSANA endnu (BR18 tabel 7 ligger i ISSANA LCA's Rust-kerne, ikke her);
      generiske() svarer derfor «mangler», og AI'en må aldrig opfinde tal.
   2) kandidater/lcaPost: forslag pr. type eller pr. byggevare (lag) ud fra biblioteket (produkter.js foreslaa) og den koblede
      ISSANA-data. saet_lca skriver kun en kandidat, siden selv har regnet frem; AI'en vælger kun kandidat-id'et.
      Dataposten får feltet lca i samme form som produkternes lca (enhed, gwp pr. modul, epd), så produkter.js' lcaElement
      og Produkter-fanens sum kan bruge det uændret.
   3) bygLcaStruktur(model, mapping): LCAbygs hierarki bygget automatisk fra issana-3d-eksporten:
        bygningsdel (lca-bygningsdele.json: Revit-kategori + funktion + laveste niveau + CCI) → konstruktion (Revit-type:
        navn, antal, samlet areal) → byggevare (typens layers[]: materiale, funktion, tykkelse → mængde = tykkelse × areal i m³,
        ellers areal i m²; EPD/GWP tomt med status «mangler», til brugeren eller AI'en vælger) → faser.
      Feltnavnene ligger tæt på LCAbygs (bygningsdel, konstruktion, byggevare, maengde, enhed, levetid, faser), så træet senere
      kan eksporteres til ISSANA LCA (22_ISSANA_LCA/prototype/core/lcabyg.rs), der læser/skriver LCAbygs projektformat.
   ============================================================ */
(function (rod, fabrik) {
  "use strict";
  var api = fabrik();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else if (rod) rod.IssanaAiLca = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var FASER = ["A1A3", "A4", "A5", "B4", "C1C4", "D"];
  var STANDARD_MODULER = ["A1A3", "C1C4"];
  var KAT_PRODUKT = { "Vægge": "vaeg", "Gulve": "daek", "Tage": "tag", "Vinduer": "vindue", "Døre": "dor" };
  var KILDE_ISSANA = "issana-konstruktion";
  var KILDE_GENERISK = "generisk";

  function erTal(v) { return typeof v === "number" && isFinite(v); }
  // Luft og hulrum er ikke byggevarer. Revits standardmateriale for luft hedder «Air» eller «Air Surfaces»; danske skabeloner bruger «Hulrum».
  function erLuftlag(navn) { return /^(air|air surfaces?|air infiltration barrier gap|luft|luftlag|luftspalte|luftrum|hulrum|air layer|air gap|air space|cavity|void|ventileret luftlag|ventileret hulrum|ventilated air layer|ventilated cavity)$/i.test(String(navn || '').trim()); }
  // Volumen (m³) af et elements lukkede trekantsflader i issana-3d-eksporten (positioner i meter): summen af de
  // fortegnsbestemte tetraedre (divergenssætningen). Kun for elementer uden areal (trapper, søjler); null uden geometri.
  function meshVolumen(e) {
    var v = 0, n = 0;
    (e && e.meshes || []).forEach(function (m) {
      var p = m && (m.pos || m.Pos), ix = m && (m.idx || m.Idx), s = 0;
      if (!p || p.length < 9 || p.length % 3) return;
      var antal = ix && ix.length >= 3 ? ix.length : p.length / 3;   // uden indeks ligger trekanterne i rækkefølge
      for (var i = 0; i + 2 < antal; i += 3) {
        var a = (ix ? ix[i] : i) * 3, b = (ix ? ix[i + 1] : i + 1) * 3, c = (ix ? ix[i + 2] : i + 2) * 3;
        s += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
      }
      v += Math.abs(s) / 6; n++;
    });
    return n && v > 0 ? v : null;
  }
  // Løbende længde (m) af et linjeelement: Revits egen længde, ellers geometrien (udstrækning langs hovedaksen i planen, højden for en søjle).
  function elementLaengde(e, lodret) {
    if (e && erTal(e.length) && e.length > 0) return { m: e.length, geometri: false };
    var P = [];
    (e && e.meshes || []).forEach(function (m) { var p = m && (m.pos || m.Pos); if (p) for (var i = 0; i + 2 < p.length; i += 3) P.push([p[i], p[i + 1], p[i + 2]]); });
    if (P.length < 4) return null;
    var cx = 0, cy = 0, xx = 0, yy = 0, xy = 0, z0 = Infinity, z1 = -Infinity, a0 = Infinity, a1 = -Infinity;
    P.forEach(function (p) { cx += p[0] / P.length; cy += p[1] / P.length; z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); });
    P.forEach(function (p) { var x = p[0] - cx, y = p[1] - cy; xx += x * x; yy += y * y; xy += x * y; });
    var th = 0.5 * Math.atan2(2 * xy, xx - yy), ux = Math.cos(th), uy = Math.sin(th);
    P.forEach(function (p) { var s = p[0] * ux + p[1] * uy; a0 = Math.min(a0, s); a1 = Math.max(a1, s); });
    var m = lodret ? z1 - z0 : a1 - a0;
    return m > 0 ? { m: m, geometri: true } : null;
  }
  function rund(n, d) { var f = Math.pow(10, d == null ? 3 : d); return Math.round(n * f) / f; }
  function iDag() { var d = new Date(), to = function (n) { return (n < 10 ? "0" : "") + n; }; return d.getFullYear() + "-" + to(d.getMonth() + 1) + "-" + to(d.getDate()); }
  function typeIdAf(info) { return info && info.type && info.type.id != null ? info.type.id : (info && info.ed ? info.ed.typeId : null); }

  /* ---------- 1) Kilder pr. type ---------- */
  // infos: arbejdsrum.js' infos (ed, type, data, status). bibliotek: issana-produkter/1 eller null.
  // → [{typeId, navn, kategori, antal, areal, co2PrM2, kilde, kildeType, status:'har'|'mangler', suite, produkt, datapost}]
  function kilder(infos, valg) {
    valg = valg || {};
    var bib = valg.bibliotek || null, pr = {};
    (infos || []).forEach(function (i) {
      if (!i || i.erRum || !i.ed || i.ed.installation) return;
      var tid = typeIdAf(i); if (tid == null) return;
      var t = pr[tid] || (pr[tid] = { typeId: tid, navn: (i.type && i.type.name) || i.ed.type || "", kategori: i.ed.category || "", antal: 0, areal: 0,
        suite: null, produkt: null, datapost: null, co2PrM2: null, kilde: null, kildeType: null, status: "mangler" });
      t.antal++;
      if (erTal(i.ed.area)) t.areal = rund(t.areal + i.ed.area, 3);
      if (t.suite == null && i.ed.suite && erTal(i.ed.suite.co2)) t.suite = i.ed.suite.co2;
      var d = i.data || {};
      if (!t.datapost && d.lca && (erTal(d.lca.co2PrM2) || (d.lca.gwp && FASER.some(function (m) { return erTal(d.lca.gwp[m]); })))) t.datapost = d.lca;
      if (!t.produkt && d.produkt && d.produkt.id) {
        var p = produktAf(bib, d.produkt.id), n = p ? co2Tal(p) : null;
        t.produkt = { id: d.produkt.id, navn: d.produkt.navn || (p && p.navn) || d.produkt.id, iBibliotek: !!p, co2PrM2: n && !n.mangler ? n.vaerdi : null, enhed: n && !n.mangler ? n.enhed : null, kilde: p ? epdKilde(p) : null, eksempel: !!(p && p.eksempel) };
      }
    });
    return Object.keys(pr).map(function (k) {
      var t = pr[k];
      // Rækkefølge: det, brugeren selv har bekræftet (datapost), så det koblede produkt, så den koblede ISSANA-data.
      if (t.datapost) { t.co2PrM2 = erTal(t.datapost.co2PrM2) ? t.datapost.co2PrM2 : sumGwp(t.datapost.gwp, STANDARD_MODULER); t.kilde = t.datapost.kilde || "datapost (lca)"; t.kildeType = t.datapost.kildeType || "datapost"; }
      else if (t.produkt && erTal(t.produkt.co2PrM2) && t.produkt.enhed === "m2") { t.co2PrM2 = t.produkt.co2PrM2; t.kilde = t.produkt.kilde || ("produkt " + t.produkt.id); t.kildeType = "produktbibliotek"; }
      else if (erTal(t.suite)) { t.co2PrM2 = t.suite; t.kilde = "ISSANA Konstruktion-eksport (A1–D), koblet på modellen"; t.kildeType = KILDE_ISSANA; }
      t.status = erTal(t.co2PrM2) ? "har" : "mangler";
      return t;
    });
  }
  function sumGwp(gwp, moduler) { if (!gwp) return null; var s = 0, n = 0; (moduler || STANDARD_MODULER).forEach(function (m) { if (erTal(gwp[m])) { s += gwp[m]; n++; } }); return n ? rund(s) : null; }
  function produktAf(bib, id) { if (!bib || !Array.isArray(bib.produkter) || !id) return null; for (var i = 0; i < bib.produkter.length; i++) if (bib.produkter[i].id === id) return bib.produkter[i]; return null; }
  function epdKilde(p) { var e = p && p.lca && p.lca.epd; if (!e) return p && p.kilde || null; return e.nummer ? "EPD " + e.nummer + (e.kilde ? " (" + e.kilde + ")" : "") : (e.kilde || p.kilde || null); }
  // CO₂ pr. deklareret enhed for standardmodulerne, uden D (samme regel som produkter.js co2Noegletal, m³ → m² med tykkelsen).
  function co2Tal(p, moduler) {
    var lca = p && p.lca || {}, gwp = lca.gwp || {}, enhed = String(lca.enhed || "").toLowerCase().replace("²", "2").replace("³", "3");
    if (!enhed) return { mangler: "mangler LCA-enhed" };
    var s = 0, mangler = [];
    (moduler || STANDARD_MODULER).forEach(function (m) { if (m === "D") return; if (erTal(gwp[m])) s += gwp[m]; else mangler.push(m); });
    if (mangler.length) return { mangler: "mangler GWP " + mangler.join(", ") };
    if (enhed === "m3" && erTal(p.tykkelseMm) && p.tykkelseMm > 0) return { vaerdi: rund(s * p.tykkelseMm / 1000), enhed: "m2", omregnet: true };
    return { vaerdi: rund(s), enhed: enhed, omregnet: false };
  }

  // Status til lca_status: tælling, kilder, og om bibliotek/ISSANA-data er indlæst. Med struktur (bygLcaStruktur) også LCAbyg-tallene.
  function status(infos, valg) {
    valg = valg || {};
    var k = kilder(infos, valg), har = k.filter(function (t) { return t.status === "har"; }), mangler = k.filter(function (t) { return t.status !== "har"; });
    var prKilde = {}; har.forEach(function (t) { prKilde[t.kildeType] = (prKilde[t.kildeType] || 0) + 1; });
    var bib = valg.bibliotek || null;
    var r = {
      typer: k, antalTyper: k.length, med: har.length, uden: mangler.length, prKilde: prKilde,
      bibliotek: { indlaest: !!bib, navn: bib && bib.navn || null, antal: bib && Array.isArray(bib.produkter) ? bib.produkter.length : 0, eksempler: !!(bib && (bib.produkter || []).some(function (p) { return p.eksempel; })) },
      issanaData: { indlaest: k.some(function (t) { return erTal(t.suite); }), antalTyper: k.filter(function (t) { return erTal(t.suite); }).length },
      generisk: generiske()
    };
    if (valg.struktur) r.struktur = valg.struktur.tal;
    r.tekst = statusTekst(r);
    r.valg = valgForMangler(r);
    return r;
  }
  function statusTekst(s) {
    var d = [];
    if (s.struktur) d.push("LCAbyg-struktur fra modellen: " + s.struktur.bygningsdele + " bygningsdele, " + s.struktur.konstruktioner + " konstruktioner, " + s.struktur.byggevarer + " byggevarer, heraf " + s.struktur.udenEpd + " uden EPD/GWP" + (s.struktur.udenOpbygning ? " og " + s.struktur.udenOpbygning + " uden lagopbygning" : "") + ".");
    d.push(s.med + " af " + s.antalTyper + " typer har CO₂-data" + (s.med ? " (" + Object.keys(s.prKilde).map(function (k) { return s.prKilde[k] + " fra " + kildeNavn(k); }).join(", ") + ")" : "") + "; " + s.uden + " mangler.");
    d.push(s.bibliotek.indlaest ? "Produktbibliotek: «" + (s.bibliotek.navn || "bibliotek") + "», " + s.bibliotek.antal + " produkter" + (s.bibliotek.eksempler ? " (indeholder eksempler, ikke rigtige data)" : "") + "." : "Intet produktbibliotek er indlæst.");
    d.push(s.issanaData.indlaest ? "ISSANA Konstruktion-data er koblet på " + s.issanaData.antalTyper + " typer." : "Ingen ISSANA Konstruktion-data er koblet på modellen.");
    d.push(s.generisk.tekst);
    return d.join(" ");
  }
  function kildeNavn(k) { return k === KILDE_ISSANA ? "ISSANA Konstruktion" : k === "produktbibliotek" ? "produktbiblioteket" : k === "datapost" ? "dataposten" : k; }

  // Generiske BR18-værdier: der er ingen i ISSANA MCP (produkter.js har ingen tal; BR18 tabel 7 ligger i ISSANA LCA's Rust-kerne).
  function generiske() { return { findes: false, kandidater: [], tekst: "Generiske BR18-værdier findes ikke i ISSANA MCP endnu (de ligger i ISSANA LCA-sporet); kun bibliotek, koblet ISSANA-data og dataposten kan bruges." }; }

  // Valg til brugeren, når noget mangler (knapper i AI-feltet). Handlingerne udføres af siden selv, ikke af AI'en.
  function valgForMangler(s) {
    var v = [];
    if (!s.bibliotek.indlaest) v.push({ id: "indlaes_bibliotek", tekst: "Indlæs produktbibliotek", handling: "aabn_produkter" });
    if (!s.issanaData.indlaest) v.push({ id: "hent_issana", tekst: "Hent ISSANA-data", handling: "hent_issana" });
    if (s.uden && (s.bibliotek.indlaest || s.issanaData.indlaest)) v.push({ id: "foreslaa", tekst: "Foreslå CO₂-kilde pr. type", handling: "foreslaa_produkt" });
    v.push({ id: "generisk", tekst: "Brug generiske BR18-værdier (udkast)", handling: "generisk" });
    if (s.struktur) v.push({ id: "struktur", tekst: "Vis LCAbyg-strukturen", handling: "lca_struktur" });
    return v.slice(0, 6);
  }

  /* ---------- 2) Kandidater og dataposten ---------- */
  // Kandidater for én type: fra biblioteket (produkter.js foreslaa, kategori og sortering CO₂) og den koblede ISSANA-data.
  // P = window.IssanaProdukter (valgfri: uden den bruges kun bibliotekets egne tal).
  // → [{id, navn, co2PrM2, enhed, moduler, kilde, kildeType, eksempel, status:'dokumenteret'|'eksempel'|'koblet'}]
  function kandidater(typeInfo, valg) {
    valg = valg || {};
    var bib = valg.bibliotek || null, P = valg.P || null, ud = [], antal = valg.antal || 3;
    if (erTal(typeInfo && typeInfo.suite)) ud.push({ id: KILDE_ISSANA, navn: "ISSANA Konstruktion (koblet på modellen)", co2PrM2: typeInfo.suite, enhed: "m2", moduler: "A1–D (samlet)", kilde: "ISSANA Konstruktion-eksport, koblet på typen", kildeType: KILDE_ISSANA, eksempel: false, status: "koblet" });
    var kat = KAT_PRODUKT[typeInfo && typeInfo.kategori];
    if (bib && kat) {
      var liste = [];
      if (P && typeof P.foreslaa === "function") {
        var f = P.foreslaa({ bibliotek: bib, kategori: kat, maal: {}, sorter: "co2", antal: antal });
        (f.forslag || []).forEach(function (x) { var p = produktAf(bib, x.id); if (p) liste.push(p); });
      } else liste = (bib.produkter || []).filter(function (p) { return p.kategori === kat; }).slice(0, antal);
      liste.forEach(function (p) {
        var n = co2Tal(p); if (n.mangler || n.enhed !== "m2") return;
        ud.push({ id: "produkt:" + p.id, produktId: p.id, navn: p.navn || p.id, co2PrM2: n.vaerdi, enhed: "m2", moduler: STANDARD_MODULER.join("+"), kilde: epdKilde(p) || "produkt " + p.id + " (uden EPD-kilde)", kildeType: "produktbibliotek", eksempel: !!p.eksempel, status: p.eksempel ? "eksempel" : (epdKilde(p) ? "dokumenteret" : "uden kilde") });
      });
    }
    return ud.slice(0, 6);
  }
  // Kandidater for alle typer i en liste af infos (til konteksten og til foreslaa_produkt uden værdi). → {typeId: [kandidater]}
  function kandidaterPrType(infos, valg) {
    var r = {}; kilder(infos, valg).forEach(function (t) { var k = kandidater(t, valg); if (k.length) r[t.typeId] = k; }); return r;
  }
  function findKandidat(liste, id) { for (var i = 0; i < (liste || []).length; i++) if (liste[i].id === id) return liste[i]; return null; }
  // Kontrol af AI'ens kilde-id: kun en kandidat, siden selv har regnet frem for typen, accepteres. generisk afvises med «mangler».
  function validerKilde(id, liste) {
    if (id === KILDE_GENERISK) return { ok: false, grund: generiske().tekst };
    var k = findKandidat(liste, id);
    return k ? { ok: true, kandidat: k } : { ok: false, grund: "ukendt kilde «" + id + "» (ikke blandt kandidaterne for typen)" };
  }

  // Feltet lca i typens datapost issana-bygdata/1, bygget af en kandidat (aldrig af AI'ens tal). Samme form som produkternes
  // lca (enhed, gwp, epd), så produkter.js' lcaElement kan regne på det. For ISSANA Konstruktion kendes kun A1–D samlet:
  // gwp udelades, og co2PrM2 bærer tallet.
  function lcaPost(kandidat, bib, valg) {
    valg = valg || {};
    var post = { enhed: "m2", co2PrM2: kandidat.co2PrM2, moduler: kandidat.moduler, kilde: kandidat.kilde, kildeType: kandidat.kildeType, status: valg.status || "udkast", dato: valg.dato || iDag() };
    if (kandidat.kildeType === "produktbibliotek") {
      var p = produktAf(bib, kandidat.produktId);
      post.produktId = kandidat.produktId; post.produktNavn = kandidat.navn;
      if (p && p.lca) {
        var n = co2Tal(p);
        if (!n.omregnet && p.lca.gwp) { post.gwp = {}; FASER.forEach(function (m) { post.gwp[m] = erTal(p.lca.gwp[m]) ? p.lca.gwp[m] : null; }); }
        if (p.lca.epd) post.epd = { nummer: p.lca.epd.nummer || null, udloeber: p.lca.epd.udloeber || null, kilde: p.lca.epd.kilde || null };
      }
      if (kandidat.eksempel) post.eksempel = true;
    }
    return post;
  }

  /* ---------- 3) LCAbygs struktur fra modellen ---------- */
  function lavesteNiveau(model) {
    var lv = model && Array.isArray(model.levels) ? model.levels.slice() : null;
    if (lv && lv.length && lv.every(function (l) { return l && erTal(l.elevation); })) { lv.sort(function (a, b) { return a.elevation - b.elevation; }); return lv[0].name || lv[0].navn || null; }
    var set = {}, navne = [];
    (model && model.elements || []).forEach(function (e) { if (e && e.level && !e.installation && !set[e.level]) { set[e.level] = 1; navne.push(e.level); } });
    if (!navne.length) return null;
    var num = function (s) { var m = /^\((-?\d+)\)/.exec(s) || /(-?\d+(?:[.,]\d+)?)/.exec(s); return m ? parseFloat(m[1].replace(",", ".")) : null; };
    if (navne.every(function (n) { return num(n) != null; })) navne.sort(function (a, b) { return num(a) - num(b); });
    return navne[0];
  }
  // Regulære udtryk fra lca-bygningsdele.json (navn, niveau), uden forskel på store og små bogstaver; et ugyldigt udtryk ignoreres.
  var RX = {};
  function rx(liste) { return (liste || []).map(function (s) { if (!(s in RX)) { try { RX[s] = new RegExp(s, "i"); } catch (x) { RX[s] = null; } } return RX[s]; }).filter(Boolean); }
  // Bærende: Revits Structural-afkrydsning eller StructuralUsage (Bearing/Shear/Combined); NonBearing og ukendt er ikke bærende.
  function erBaerende(e) { var rv = (e && e.revit) || {}; return rv.baerende === true || /^(Bearing|Shear|Combined)$/i.test(String(rv.konstruktiv || "")); }
  function matcher(regel, e, t, ctx) {
    var kat = regel.kategori, fn = regel.funktion, cci = regel.cci, tag = regel.tag;
    if (kat && kat.indexOf(e.category) < 0 && kat.indexOf(e.builtInCategory) < 0 && !(t && kat.indexOf(t.category) >= 0)) return false;
    if (fn && fn.indexOf(e.revit && e.revit.funktion) < 0) return false;
    if (regel.laveste && e.level !== ctx.laveste) return false;
    if (cci) { var kode = (e.issana && e.issana.cciCode) || (t && t.issana && t.issana.cciCode) || ""; if (!cci.some(function (c) { return kode.indexOf(c) === 0; })) return false; }
    if (tag) { var tags = [].concat((e.bygdata && e.bygdata.tags) || [], (t && t.bygdata && t.bygdata.tags) || []).map(function (x) { return String(x).toLowerCase(); }); if (!tag.some(function (x) { return tags.indexOf(x) >= 0; })) return false; }
    if (regel.navn) { var navn = [t && t.name, t && t.family, e.type, e.family, e.name].filter(Boolean).join(" "); if (!rx(regel.navn).some(function (r) { return r.test(navn); })) return false; }
    if (regel.niveau && !rx(regel.niveau).some(function (r) { return r.test(String(e.level || "")); })) return false;
    if (regel.baerende && !erBaerende(e)) return false;
    return !!(kat || fn || cci || tag || regel.laveste || regel.navn || regel.niveau || regel.baerende);
  }
  // → {bygningsdel, underkategori, antaget}: den første regel, der passer; ellers Andet › Andet. En regel uden underkategori får
  // bygningsdelens første underkategori (antaget).
  function regelFor(e, t, mapping, ctx) {
    var regler = mapping.regler || [], r = null;
    for (var i = 0; i < regler.length && !r; i++) if (matcher(regler[i], e, t, ctx)) r = regler[i];
    var del = r ? r.bygningsdel : "andet", def = (mapping.bygningsdele || []).filter(function (d) { return d.id === del; })[0];
    var under = r && r.underkategori ? r.underkategori : def && def.underkategorier && def.underkategorier[0] ? def.underkategorier[0] : (del === "andet" ? "Andet" : null);
    return { bygningsdel: del, underkategori: under, antaget: !r || !!r.antaget || !(r && r.underkategori), enhed: r && r.enhed || null };
  }
  function bygningsdelFor(e, t, mapping, ctx) { return regelFor(e, t, mapping, ctx).bygningsdel; }

  // model: issana-3d/1.x (types, elements, levels?). mapping: lca-bygningsdele.json. valg: {kilder: kilder(infos) pr. typeId}
  // → {schema, bygningsdele:[{id, navn, konstruktioner:[{typeId, navn, kategori, antal, areal, enhed, byggevarer:[{id, navn, materiale,
  //    funktion, tykkelseMm, maengde, enhed, levetid, epd, gwp:{A1A3..}, kilde, status:'mangler'|'har', faser}], mangler}], mangler}],
  //    tal:{bygningsdele, konstruktioner, byggevarer, udenEpd, udenOpbygning}, laveste}
  function bygLcaStruktur(model, mapping, valg) {
    valg = valg || {};
    mapping = mapping || { bygningsdele: [], regler: [] };
    var typer = {}; (model && model.types || []).forEach(function (t) { if (t && t.id != null) typer[String(t.id)] = t; });
    var kilderPrType = {}; (valg.kilder || []).forEach(function (k) { kilderPrType[String(k.typeId)] = k; });
    var ctx = { laveste: lavesteNiveau(model) };
    var enhedLag = (mapping.enheder && mapping.enheder.lag) || "m3", enhedUden = (mapping.enheder && mapping.enheder.udenLag) || "m2";
    var dele = {}, orden = (mapping.bygningsdele || []).map(function (b) { return b.id; });
    (mapping.bygningsdele || []).forEach(function (b) { dele[b.id] = { id: b.id, navn: b.navn, underkategorier: (b.underkategorier || []).slice(), konstruktioner: [], mangler: 0 }; });
    if (!dele.andet) { dele.andet = { id: "andet", navn: "Andet", underkategorier: ["Andet"], konstruktioner: [], mangler: 0 }; orden.push("andet"); }
    var konstr = {}, seteElementer = Object.create(null);
    (model && model.elements || []).forEach(function (e) {
      // Installationer regnes i LCA'ens egen installationsdel, ikke som bygningsdele.
      if (!e || e.erRum || e.installation) return;
      // Genindlæste kopier af samme element tælles én gang; ens geometri er ikke en dublet.
      var identitet = typeof e.uniqueId === "string" && e.uniqueId.trim() ? "uid:" + e.uniqueId : e.id != null && String(e.id).trim() ? "id:" + e.id : null;
      if (identitet != null) { if (seteElementer[identitet]) return; seteElementer[identitet] = true; }
      var t = e.typeId != null ? typer[String(e.typeId)] : null;
      // Bygningsdel › underkategori › konstruktion (Revit-typen). Samme type i to underkategorier (fx kælder og stue) er to konstruktioner.
      var rg = regelFor(e, t, mapping, ctx), del = dele[rg.bygningsdel] ? rg.bygningsdel : "andet";
      var noegle = del + "|" + (rg.underkategori || "") + "|" + (e.typeId != null ? e.typeId : "type?" + (e.type || ""));
      var k = konstr[noegle];
      if (!k) {
        k = konstr[noegle] = { typeId: e.typeId != null ? e.typeId : null, navn: (t && t.name) || e.type || e.name || "Uden type", kategori: e.category || "", cci: (t && t.issana && t.issana.cciCode) || (e.issana && e.issana.cciCode) || "",
          underkategori: rg.underkategori, underkategoriAntaget: rg.antaget, antal: 0, areal: null, elementIds: [], enhed: rg.enhed || "m2", byggevarer: [], mangler: 0 };
        dele[del].konstruktioner.push(k);
      }
      var harAreal = erTal(e.area) && e.area >= 0;
      k.antal++; k.elementIds.push(e.id); if (harAreal) k.areal = rund((k.areal == null ? 0 : k.areal) + e.area, 3);
      // Linjeelementer og enkeltstående elementer (m, stk): volumenet giver m³ pr. m eller pr. stk, som i LCAbyg.
      if (k.enhed !== "m2" || !harAreal) { var vol = meshVolumen(e); if (vol != null) k.volumen = rund((k.volumen || 0) + vol, 3); }
      if (k.enhed === "m") { var ll = elementLaengde(e, rg.underkategori === "Søjler"); if (ll) { k.laengde = rund((k.laengde || 0) + ll.m, 3); if (ll.geometri) k.laengdeGeometri = true; } }
    });
    orden.forEach(function (id) {
      dele[id].konstruktioner.forEach(function (k) {
        var t = k.typeId != null ? typer[String(k.typeId)] : null, lag = t && Array.isArray(t.layers) ? t.layers.filter(Boolean) : [];
        var kilde = kilderPrType[String(k.typeId)] || null;
        // En type med lag regnes pr. m² (tykkelse × areal), og uden længde kan et linjeelement heller ikke regnes pr. m.
        if (k.enhed !== "m2" && (lag.length || (k.enhed === "m" && !(k.laengde > 0)))) k.enhed = "m2";
        // Byggevarer med EPD/datasæt, som brugeren allerede har bekræftet i typens datapost (lca.byggevarer[lag-id]).
        var bekraeftede = (t && t.bygdata && t.bygdata.data && t.bygdata.data.lca && t.bygdata.data.lca.byggevarer) || (kilde && kilde.datapost && kilde.datapost.byggevarer) || null;
        var medEpd = function (b) { var p = bekraeftede && bekraeftede[String(b.id)]; if (!p) return; b.status = "har"; b.epd = p.epd || (p.datasaet ? { nummer: p.datasaet, kilde: p.kilde } : null); b.gwp = p.gwp || null; b.kilde = p.kilde || null; b.levetid = p.levetid != null ? p.levetid : b.levetid; if (p.generisk) b.generisk = true; };
        if (lag.length) {
          lag.forEach(function (l, i) {
            var tyk = erTal(l.widthMm) ? l.widthMm : (erTal(l.tykkelseMm) ? l.tykkelseMm : (erTal(l.thickness) ? l.thickness : null));
            var mat = l.material || l.materiale || l.name || null;
            var b = { id: k.typeId + ":" + i, navn: mat || "Lag " + (i + 1), materiale: mat, funktion: l.function || l.funktion || null, tykkelseMm: tyk,
              maengde: k.areal == null ? null : tyk != null ? rund(tyk / 1000 * k.areal) : rund(k.areal), enhed: tyk != null ? enhedLag : enhedUden, levetid: null, epd: null, gwp: null, kilde: null, status: "mangler", faser: FASER.slice() };
            if (erLuftlag(mat)) { b.medregnes = false; b.status = "udeladt"; b.udeladelsesgrund = "Luftlag medregnes ikke i LCA"; }
            else medEpd(b);
            k.byggevarer.push(b);
          });
        } else {
          var tykNavn = /(\d{2,4})\s*mm/.exec(k.navn || ""), tyk1 = tykNavn ? Number(tykNavn[1]) : null, erAabning = /Vinduer|Døre|Windows|Doors/.test(k.kategori), heltElement = k.enhed !== "m2";
          var b1 = { id: k.typeId + ":0", navn: k.navn, materiale: null, funktion: null, tykkelseMm: erAabning || heltElement ? null : tyk1, tykkelseFraNavn: !erAabning && !heltElement && tyk1 != null, maengde: heltElement ? rund(k.enhed === "m" ? k.laengde : k.antal) : k.areal == null ? null : rund(k.areal), enhed: heltElement ? k.enhed : enhedUden, levetid: null, epd: null, gwp: null, kilde: null, status: "mangler", faser: FASER.slice(), opbygningMangler: !erAabning && !heltElement, heltElement: heltElement };
          medEpd(b1);
          k.byggevarer.push(b1);
        }
        // Kendt CO₂ på typen (datapost, produkt, koblet ISSANA-data): en type med én linje får den; med flere lag står lagene
        // stadig som «mangler» (tallet gælder hele opbygningen og kan ikke fordeles på lag uden gætteri), men vises på konstruktionen.
        if (kilde && kilde.status === "har") {
          k.co2PrM2 = kilde.co2PrM2; k.kilde = kilde.kilde; k.kildeType = kilde.kildeType;
          if (k.byggevarer.length === 1 && k.byggevarer[0].medregnes !== false) { var b0 = k.byggevarer[0]; b0.status = "har"; b0.kilde = kilde.kilde; b0.co2PrM2 = kilde.co2PrM2; if (kilde.datapost && kilde.datapost.gwp) b0.gwp = kilde.datapost.gwp; if (kilde.datapost && kilde.datapost.epd) b0.epd = kilde.datapost.epd; }
        }
        k.mangler = k.byggevarer.filter(function (b) { return b.medregnes !== false && b.status !== "har"; }).length;
        dele[id].mangler += k.mangler;
      });
    });
    var ud = { schema: "issana-lca-struktur/1", kilde: "issana-3d", model: (model && model.model) || "", laveste: ctx.laveste, bygningsdele: [], tal: { bygningsdele: 0, konstruktioner: 0, byggevarer: 0, luftlag: 0, udenEpd: 0, udenOpbygning: 0 } };
    orden.forEach(function (id) {
      var d = dele[id]; if (!d.konstruktioner.length) return;
      ud.bygningsdele.push(d); ud.tal.bygningsdele++;
      d.konstruktioner.forEach(function (k) { ud.tal.konstruktioner++; k.byggevarer.forEach(function (b) { if (b.medregnes === false) { ud.tal.luftlag++; return; } ud.tal.byggevarer++; if (b.status !== "har") ud.tal.udenEpd++; if (b.opbygningMangler) ud.tal.udenOpbygning++; }); });
    });
    return ud;
  }
  // Byggevarer uden EPD i træet, flad liste (til foreslaa_produkt pr. byggevare).
  function byggevarerUdenEpd(struktur) {
    var r = [];
    (struktur && struktur.bygningsdele || []).forEach(function (d) { d.konstruktioner.forEach(function (k) { k.byggevarer.forEach(function (b) { if (b.medregnes !== false && b.status !== "har") r.push({ bygningsdel: d.navn, konstruktion: k.navn, typeId: k.typeId, byggevare: b }); }); }); });
    return r;
  }

  /* ---------- 4) Udvalg (maal) og masseforslag ---------- */
  // maal fra AI'en: {alle:true} | {valgte:true} | {kategori:"Vægge"} | {etage:"(02) Stue"} | {typeIds:[…]} | {elementIds:[…]}
  // (flere nøgler = OG). → de infos, det gælder. valgteIdx: elementindekser fra siden (til valgte:true).
  function udvalg(maal, infos, valgteIdx) {
    maal = maal || {};
    var liste = (infos || []).filter(function (i) { return i && !i.erRum && !(i.ed && i.ed.installation); });
    if (maal.alle) return liste;
    if (maal.valgte) { var set = {}; (valgteIdx || []).forEach(function (i) { set[i] = 1; }); liste = liste.filter(function (i) { return set[i.idx]; }); }
    if (maal.kategori) { var kat = [].concat(maal.kategori).map(function (k) { return String(k).toLowerCase(); }); liste = liste.filter(function (i) { return kat.indexOf(String(i.ed.category || "").toLowerCase()) >= 0 || kat.indexOf(String(i.ed.builtInCategory || "").toLowerCase()) >= 0; }); }
    if (maal.etage) { var et = [].concat(maal.etage); liste = liste.filter(function (i) { return et.indexOf(i.ed.level) >= 0; }); }
    if (maal.typeIds) { var ts = {}; [].concat(maal.typeIds).forEach(function (t) { ts[String(t)] = 1; }); liste = liste.filter(function (i) { return ts[String(typeIdAf(i))]; }); }
    if (maal.elementIds) { var es = {}; [].concat(maal.elementIds).forEach(function (e) { es[String(e)] = 1; }); liste = liste.filter(function (i) { return es[String(i.ed.id)]; }); }
    if (!maal.valgte && !maal.kategori && !maal.etage && !maal.typeIds && !maal.elementIds) return [];
    return liste;
  }
  function maalTekst(maal) {
    maal = maal || {};
    if (maal.alle) return "alle bygningsdele";
    var d = [];
    if (maal.valgte) d.push("de valgte");
    if (maal.kategori) d.push([].concat(maal.kategori).join("/"));
    if (maal.etage) d.push("på " + [].concat(maal.etage).join(", "));
    if (maal.typeIds) d.push([].concat(maal.typeIds).length + " typer");
    if (maal.elementIds) d.push([].concat(maal.elementIds).length + " elementer");
    return d.join(" ") || "intet udvalg";
  }
  // Model-udsnit til bygLcaStruktur af en liste infos (så strukturen kan bygges for et udvalg).
  function modelAf(infos, model) {
    return { model: model && model.model || "", levels: model && model.levels || null, types: model && model.types || [], elements: (infos || []).filter(function (i) { return i && !i.erRum; }).map(function (i) { return i.ed; }) };
  }
  // Masseforslag: ét forslag pr. byggevare uden EPD i udvalget. Rækkefølge af kilder: bibliotek/koblet ISSANA-data på typen
  // (kun når typen har én byggevare, ellers kan tallet ikke fordeles på lag) → BR18 tabel 7 (generisk) via epd-match.js.
  // valg: {model, mapping, tabel, synonymer, M (IssanaEpdMatch), bibliotek, P, af, valgteIdx}
  function masseForslag(maal, infos, valg) {
    valg = valg || {};
    var liste = udvalg(maal, infos, valg.valgteIdx), M = valg.M;
    var k = kilder(liste, { bibliotek: valg.bibliotek });
    var struktur = bygLcaStruktur(modelAf(liste, valg.model), valg.mapping, { kilder: k });
    var ud = { maal: maal, maalTekst: maalTekst(maal), antalElementer: liste.length, struktur: struktur, grupper: [], forslag: [], tal: { byggevarer: struktur.tal.byggevarer, allerede: 0, bibliotek: 0, generisk: 0, ingen: 0, opbygningMangler: 0, ignoreret: 0, manglerOmregning: 0 } };
    if (!liste.length) return ud;
    var kandPrType = kandidaterPrType(liste, { bibliotek: valg.bibliotek, P: valg.P });
    var epd = M && valg.tabel ? M.forslagForStruktur(struktur, valg.tabel, valg.synonymer || { grupper: [] }, { af: valg.af }) : { forslag: [], tal: {} };
    var prTypeLag = {}; epd.forslag.forEach(function (f) { prTypeLag[f.typeId + "|" + f.byggevare.id] = f; });
    struktur.bygningsdele.forEach(function (d) {
      var g = { bygningsdel: d.navn, bygningsdelId: d.id, konstruktioner: [] };
      d.konstruktioner.forEach(function (kon) {
        var gk = { typeId: kon.typeId, navn: kon.navn, kategori: kon.kategori, antal: kon.antal, areal: kon.areal, linjer: [] };
        var dokumenteret = (kandPrType[kon.typeId] || []).filter(function (c) { return c.kildeType === KILDE_ISSANA || c.status === "dokumenteret"; })[0] || null;
        kon.byggevarer.forEach(function (b) {
          if (b.medregnes === false) { ud.tal.ignoreret++; return; }
          var linje = { typeId: kon.typeId, typeNavn: kon.navn, bygningsdel: d.navn, konstruktion: kon.navn, byggevare: b, handling: null, status: null, kandidat: null, post: null, begrundelse: null };
          if (b.status === "har") { linje.status = "har"; linje.begrundelse = "har allerede " + (b.kilde || "en kilde"); ud.tal.allerede++; }
          else if (kon.byggevarer.length === 1 && dokumenteret && !dokumenteret.eksempel) {
            // Hele typen får bibliotekets/ISSANA-dataens tal (saet_lca); tabel 7 bruges ikke, når der er en rigtig kilde.
            linje.handling = "saet_lca"; linje.status = "bibliotek"; linje.kandidat = dokumenteret; linje.post = lcaPost(dokumenteret, valg.bibliotek, { status: "proposed" }); linje.begrundelse = dokumenteret.navn + " (" + dokumenteret.kilde + ")"; ud.tal.bibliotek++;
          } else {
            var f = prTypeLag[kon.typeId + "|" + b.id];
            if (!f) { linje.status = "ingen"; linje.begrundelse = "ingen matcher indlæst (epd-match.js/tabel 7 mangler)"; ud.tal.ingen++; }
            else if (f.status === "match") { linje.handling = "saet_epd"; linje.status = "generisk"; linje.kandidat = f.kandidat; linje.kandidater = f.kandidater; linje.post = f.post; linje.begrundelse = f.kandidat.begrundelse; ud.tal.generisk++; if (f.kandidat.mangler) ud.tal.manglerOmregning++; }
            else if (f.status === "opbygning_mangler") { linje.status = "opbygning_mangler"; linje.begrundelse = f.begrundelse; ud.tal.opbygningMangler++; }
            else if (f.status === "ignorer") { linje.status = "ignorer"; linje.begrundelse = f.begrundelse; ud.tal.ignoreret++; }
            else { linje.status = "ingen"; linje.begrundelse = f.begrundelse; ud.tal.ingen++; }
          }
          gk.linjer.push(linje); if (linje.handling) ud.forslag.push(linje);
        });
        g.konstruktioner.push(gk);
      });
      ud.grupper.push(g);
    });
    return ud;
  }
  function masseTekst(r) {
    var t = r.tal;
    return r.antalElementer + " elementer (" + r.maalTekst + "): " + t.byggevarer + " byggevarer; " + r.forslag.length + " forslag (" + t.bibliotek + " fra bibliotek/ISSANA-data, " + t.generisk + " generiske fra BR18 tabel 7" + (t.manglerOmregning ? ", heraf " + t.manglerOmregning + " uden mængdeomregning" : "") + ")" +
      (t.allerede ? "; " + t.allerede + " har allerede en kilde" : "") + (t.opbygningMangler ? "; " + t.opbygningMangler + " uden lagopbygning (opbygning mangler)" : "") + (t.ingen ? "; " + t.ingen + " uden match i synonymlisten" : "") + (t.ignoreret ? "; " + t.ignoreret + " luftlag sprunget over" : "") + ".";
  }

  return {
    udvalg: udvalg, maalTekst: maalTekst, modelAf: modelAf, masseForslag: masseForslag, masseTekst: masseTekst, erLuftlag: erLuftlag, meshVolumen: meshVolumen,
    FASER: FASER.slice(), STANDARD_MODULER: STANDARD_MODULER.slice(), KILDE_ISSANA: KILDE_ISSANA, KILDE_GENERISK: KILDE_GENERISK,
    kilder: kilder, status: status, statusTekst: statusTekst, generiske: generiske, valgForMangler: valgForMangler,
    kandidater: kandidater, kandidaterPrType: kandidaterPrType, findKandidat: findKandidat, validerKilde: validerKilde, lcaPost: lcaPost, co2Tal: co2Tal,
    bygLcaStruktur: bygLcaStruktur, byggevarerUdenEpd: byggevarerUdenEpd, lavesteNiveau: lavesteNiveau, regelFor: regelFor
  };
});
