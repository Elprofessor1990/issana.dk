/* ============================================================
   ISSANA 3D → ISSANA LCA: projektformat v3 (lca-projekt.js)

   Rent modul uden DOM. I browseren: window.IssanaLcaProjekt; i Node: module.exports.
   3D regner ALDRIG selv CO₂. Dette modul oversætter kun LCAbyg-strukturen fra ai-lca.js (bygLcaStruktur) og de EPD-valg,
   brugeren har lavet pr. lag (epd-match.js-poster: bekræftede i dataposten lca.byggevarer, eller «Brug»-forslag med status
   proposed), til et ISSANA LCA-projekt i format v3 (22_ISSANA_LCA/prototype/PROJEKTFORMAT-V3.md, Rust-typerne i
   core/src/model.rs og environment.rs; ukendte felter afvises). Rust-kernen (issana-lca-core.exe calculate-project-stdin,
   gennem plugin-metoden issana_lca_beregn) regner alt: moduler, B4, mangler, status og grænse.

   Oversættelsen:
     bygningsdel (lca-bygningsdele.json)      → building_model.parts[]          id d-<del>
     konstruktion (Revit-type i bygningsdelen) → building_model.constructions[]  id k-<del>-<typeId>, mængde = samlet areal (m²)
     byggevare (typens lag; luftlag udelades)  → building_model.products[]       id p-<del>-<typeId>-<lag>, mængde pr. m²
     valgt BR18 tabel 7-datasæt                → building_model.environmental_data[]
        bekræftet  → origin official_catalogue; alle kildefelter låst til katalogrækken, præcis som Rust kræver
                     (dataset_id = catalogue_key = key, dataset_name = name_da, deklareret enhed, A1-A3/C3/C4/D deklareret,
                     kanonisk kildetekst, valid_until tom) + catalogues[] med katalogets SHA-256
        forslag    → origin unverified med catalogue_id/key: Rust regner vejledende, giver status
                     official_confirmation_pending og en mangel, indtil brugeren bekræfter forslaget
   Mængden pr. m² konstruktion følger datasættets deklarerede enhed (samme regel som epd-match.js maengde): m³ = lagets
   tykkelse; m² = 1; kg/ton = volumen eller areal med Rust-feltet conversion og tabellens egen massefaktor; «m² with R=1»
   kun med λ fra datasættets navn. Ellers er mængden ukendt (null) → Rust giver en mangel. Ukendt EPD er en mangel, aldrig 0.
   Referenceareal og bygningstype kendes ikke af Revit-typerne: de angives i LCA-panelet (forslag: sum af gulvarealer).
   Uden dem er projektet ikke klar (klar:false), og Rust kaldes ikke.
   Fra start til slut (docs/issana-mcp/LCA-MOTOR-3.0.md): levetid som service_life_ref til BUILD levetidstabel 2021 (række efter
   bygningsdel og lagets plads, kolonne efter materialet; Rust slår op), A4/A5 som process_defaults (tabel 10/11), installationer
   med tabel 7's standardværdier, og B6 fra Be18-nøgletal med tabel 8.1 (energiPoster). Stadig ingen CO₂-regning her.
   Rust-feltet revit_ref bruges ikke: det er låst til LCA-006's materialeudtræk (get_material_quantities, ft²/ft³ og
   udtrækkets SHA-256); her kommer mængderne fra 3D-eksporten, og sporet står i quantity_source og i kort (id → elementer).
   ============================================================ */
(function (rod, fabrik) {
  "use strict";
  var api = fabrik();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else if (rod) rod.IssanaLcaProjekt = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var SCHEMA_VERSION = 3;
  var KATALOG_PREFIX = "br18-tabel-7-2025";
  var KATALOG_TITEL = "BR18 bilag 2 tabel 7 (2025) · lokalt katalog";
  var KATALOG_FIL = "prototype/data/br18-tabel-7-2025.json";
  // Rusts building_use (project.rs limit_for) med grænse i kg CO₂e/m²/år, til panelets valg. Grænsen står kun som tekst.
  var BYGNINGSTYPER = [
    { id: "single_family", navn: "Enfamiliehus, række- eller dobbelthus", graense: "6,7" },
    { id: "apartment", navn: "Etageboligbyggeri", graense: "7,5" },
    { id: "office", navn: "Kontor, handel, lager", graense: "7,5" },
    { id: "holiday_under_150", navn: "Fritidshus under 150 m²", graense: "4,0" },
    { id: "holiday_150_plus", navn: "Fritidshus 150 m² og derover", graense: "6,7" },
    { id: "other", navn: "Andet byggeri", graense: "8,0" }
  ];

  function erTal(v) { return typeof v === "number" && isFinite(v); }
  function tekst(v) { return v == null ? "" : String(v); }
  function slug(v) { return tekst(v).toLowerCase().replace(/[^a-z0-9æøå]+/g, "-").replace(/^-+|-+$/g, "") || "x"; }
  function tal(n) { return erTal(n) ? String(Math.round(n * 1000) / 1000).replace(".", ",") : "?"; }
  // Rusts unit_key (project.rs): små bogstaver, ² → 2, ³ → 3, stk./pcs → stk.
  function enhedNoegle(v) { var s = tekst(v).trim().toLowerCase().replace(/²/g, "2").replace(/³/g, "3"); return s === "pcs" || s === "stk." ? "stk" : s; }

  /* ---------- Katalog (BR18 tabel 7) ---------- */
  // katalog: {sha256, source_workbook_sha256?} fra issana_lca_info (Rusts catalogue-info) eller data/br18-tabel-7-2025.meta.json.
  function katalogId(sha) { return KATALOG_PREFIX + "@" + tekst(sha).slice(0, 12); }
  function katalogRef(katalog, tabel) {
    return { id: katalogId(katalog.sha256), title: KATALOG_TITEL, file: KATALOG_FIL, sha256: katalog.sha256,
      source_workbook_sha256: katalog.source_workbook_sha256 || (tabel && tabel.source_workbook_sha256) || null };
  }
  // Den kanoniske kildetekst (catalogue.rs source_text). Officielle poster skal bære præcis denne tekst.
  function kildeTekst(tabel, raekke) {
    return "BR18 bilag 2 tabel 7 (2025), " + raekke.key + ", række " + (raekke.workbook_row || 0) + "; " + tekst(tabel && tabel.source_page) +
      "; underliggende kilde: " + (raekke.underlying_source_url || "ikke angivet");
  }
  // Rækken for en post: key (entydig) → id + dansk navn (som Rusts same_dataset) → id, når det er entydigt.
  function findRaekke(tabel, post) {
    var liste = tabel && tabel.materials || [], key = post && (post.datasaetKey || post.key), id = post && (post.datasaet || post.id), navn = post && post.navn, i;
    if (key) for (i = 0; i < liste.length; i++) if (liste[i].key === key) return liste[i];
    if (!id) return null;
    var med = liste.filter(function (r) { return r.id === id; });
    if (navn) { var n = med.filter(function (r) { return tekst(r.name_da).trim() === tekst(navn).trim(); }); if (n.length) return n[0]; }
    return med.length === 1 ? med[0] : null;
  }
  function modul(v) { return { status: "declared", value: v }; }
  function miljoedata(tabel, katalog, raekke, officiel) {
    var md = { id: (officiel ? "m-" : "m-forslag-") + slug(raekke.key), origin: officiel ? "official_catalogue" : "unverified",
      dataset_id: raekke.key, dataset_name: raekke.name_da, catalogue_id: katalogId(katalog.sha256), catalogue_key: raekke.key,
      source: kildeTekst(tabel, raekke), declared_unit: raekke.declared_unit,
      modules: { a1a3: modul(raekke.a1a3), c3: modul(raekke.c3), c4: modul(raekke.c4), d: modul(raekke.d) }, valid_until: null, epd: null };
    if (!officiel) md.source = "ISSANA 3D: forslag (ikke bekræftet) fra " + md.source;
    return md;
  }

  /* ---------- Mængde pr. m² konstruktion ---------- */
  // → {unit, amount, conversion|null, kilde} eller {mangler}. Kun tabellens egne tal (massefaktor, λ i navnet).
  function produktMaengde(raekke, tykkelseMm, fraNavn) {
    var u = raekke.declared_unit, k = enhedNoegle(u), tyk = erTal(tykkelseMm) && tykkelseMm > 0 ? tykkelseMm : null;
    var tykTekst = tyk != null ? (fraNavn ? "tykkelse " + tal(tyk) + " mm udledt af typenavnet" : "lagtykkelse " + tal(tyk) + " mm fra Revit-typen") : null;
    var vol = tyk != null ? tyk / 1000 : null;
    var mf = erTal(raekke.mass_factor) && raekke.mass_factor > 0 ? raekke.mass_factor : null, mu = tekst(raekke.mass_unit);
    var omr = function (fra, mult, hvad) { return { from_unit: fra, to_unit: u, multiplier: mult, source: hvad + " (BR18 bilag 2 tabel 7 (2025), " + raekke.key + ", massefaktor " + tal(mf) + " " + mu + ")" }; };
    if (k === "m3") return vol == null ? { mangler: "mængden kræver lagets tykkelse (datasættet er pr. m³)" } : { unit: "m3", amount: vol, conversion: null, kilde: tykTekst + " = " + tal(vol) + " m³ pr. m²" };
    if (k === "m2") return { unit: "m2", amount: 1, conversion: null, kilde: "1 m² byggevare pr. m² konstruktion (datasættet er pr. m²)" };
    if (k === "kg" || k === "ton") {
      var tilTon = k === "ton" ? 1 / 1000 : 1;
      if (!mf) return { mangler: "datasættet er pr. " + u + ", men tabel 7 har ingen massefaktor; omregning mangler" };
      if (mu === "kg/m³" || mu === "ton/m³" || mu === "g/cm³") {
        if (vol == null) return { mangler: "mængden kræver lagets tykkelse (massefaktoren er pr. m³)" };
        var kgPrM3 = mu === "kg/m³" ? mf : mf * 1000;
        return { unit: "m3", amount: vol, conversion: omr("m3", kgPrM3 * tilTon, "m³ → " + u), kilde: tykTekst + " = " + tal(vol) + " m³ pr. m²; omregnet til " + u + " med tabellens massefaktor" };
      }
      if (mu === "kg/m²") return { unit: "m2", amount: 1, conversion: omr("m2", mf * tilTon, "m² → " + u), kilde: "1 m² pr. m² konstruktion; omregnet til " + u + " med tabellens massefaktor" };
      if (mu === "kg/m²/mm") {
        if (tyk == null) return { mangler: "mængden kræver lagets tykkelse (massefaktoren er pr. mm)" };
        return { unit: "m2", amount: 1, conversion: omr("m2", mf * tyk * tilTon, "m² × " + tal(tyk) + " mm → " + u), kilde: "1 m² pr. m² konstruktion, " + tykTekst + "; omregnet til " + u + " med tabellens massefaktor" };
      }
      return { mangler: "massefaktoren i tabel 7 er i «" + mu + "»; omregning mangler" };
    }
    if (/^m2 with r=1/.test(k)) {
      var kl = /kl\.?\s*(\d{2})/i.exec(tekst(raekke.name_da));
      if (!kl) return { mangler: "datasættet er pr. m² ved R=1, og λ står ikke i datasættets navn; omregning mangler" };
      if (vol == null) return { mangler: "mængden kræver lagets tykkelse (datasættet er pr. m² ved R=1)" };
      var lambda = Number(kl[1]) / 1000, r = vol / lambda;
      return { unit: "m2", amount: 1, conversion: { from_unit: "m2", to_unit: u, multiplier: r, source: "R = tykkelse ÷ λ = " + tal(vol) + " m ÷ " + lambda + " W/mK (kl. " + kl[1] + " i datasættets navn, BR18 bilag 2 tabel 7 (2025), " + raekke.key + ")" },
        kilde: "1 m² pr. m² konstruktion, " + tykTekst + "; omregnet til m² ved R=1 med λ fra datasættets navn" };
    }
    return { mangler: "datasættet er pr. «" + u + "», som ikke kan udledes af lagets tykkelse og konstruktionens areal; omregning mangler" };
  }

  /* ---------- Levetid (BUILD levetidstabel 2021, bilag 4) ---------- */
  // Rust slår levetiden og den kanoniske kilde op (service_life.rs); adapteren vælger kun række og kolonne. Tabelversionen
  // er indbygget i motoren; id'et her er SHA-256 af plugin/lca/data/build-levetidstabel-2021.json (testen holder dem ens).
  var LEVETID_TABEL = "build-levetidstabel-2021@1fdb4998faeb";
  // De rækker, 3D bruger, med tabellens værdier (år) pr. kolonne. Har rækken ingen værdi for materialegruppen, bruges
  // rækkens «Sum, beregnet» (kolonne sum). Genereret fra datafilen; testen kontrollerer hver celle.
  var BUILD_RAEKKER = {"12/(12)1":{"navn":"(12)1 Liniefundamenter","s":40,"v":{"sum":120,"f2,f3":120}},"12/(12)4":{"navn":"(12)4 Fundamenter, fugt- og varmeisolering","s":40,"v":{"sum":60,"m1":50,"n1":80,"n6,n7":80}},"13/(13)2":{"navn":"(13)2 Terrændæk i terrænniveau","s":40,"v":{"sum":100,"f2,f3":100,"i1":100}},"13/(13)3":{"navn":"(13)3 Terrændæk, fugt- og varmeisolering","s":40,"v":{"sum":60,"m1":50,"n1":80,"n6,n7":80}},"43/(43)1":{"navn":"(43)1 Terrændæk, overflader","s":43,"v":{"sum":80,"e0":120,"f2,f3":120,"g2":120,"g3":120,"i2":80,"i3":100,"i4,i5":60,"n2":10,"n4,n5":50,"n6,n7":15,"v0":10}},"21/(21)3":{"navn":"(21)3 Ydervægge","s":41,"v":{"sum":120,"e0":120,"f2,f3":120,"f4":80,"f5":120,"g2":120,"h1,h2,h3":120,"i1":120,"i3":120,"i4,i5":100}},"21/(21)5":{"navn":"(21)5 Ydervægge, fugt- og varmeisolering","s":41,"v":{"sum":60,"j1,j7":60,"j2":60,"m1":80,"n1":80,"n6,n7":80,"p1":50}},"41/(41)3":{"navn":"(41)3 Ydervægge, udvendige overflader","s":43,"v":{"sum":60,"e0":120,"f1":50,"f2,f3":80,"f4":80,"f5":50,"g2":80,"g3":80,"h1,h2,h3":60,"h4":60,"h5":60,"h7,h9":80,"i1":50,"i2":50,"i3":60,"j8":60,"n1":25,"o0":80,"v0":10}},"42/(42)1":{"navn":"(42)1 Indvendige vægoverflader","s":43,"v":{"sum":60,"e0":80,"f1":50,"f2,f3":80,"f4":60,"f5":80,"f7":50,"g2":80,"g3":80,"h1,h2,h3":60,"h4":80,"h5":80,"h7,h9":80,"i2":40,"i3":60,"i4,i5":30,"j2":20,"v0":15}},"22/(22)2":{"navn":"(22)2 Indervægge ekskl. kælderindervægge","s":41,"v":{"sum":100,"f2,f3":100,"f4":100,"f5":100,"f7":80,"g2":100,"h1,h2,h3":100,"i1":100,"i3":120,"i4,i5":100}},"23/(23)2":{"navn":"(23)2 Etagedæk","s":41,"v":{"sum":100,"f2,f3":120,"f5":100,"g2":100,"i1":100,"i3":120,"i4,i5":100}},"43/(43)2":{"navn":"(43)2 Etagedæk, overflader","s":43,"v":{"sum":80,"e0":100,"f2,f3":100,"g2":100,"g3":100,"i2":60,"i3":80,"i4,i5":50,"n2":10,"n4,n5":40,"n6,n7":15,"v0":10}},"45/(45)1":{"navn":"(45)1 Lofter, overflader","s":43,"v":{"sum":60,"f1":80,"f2,f3":100,"f7":60,"i2":80,"j2":30,"j8":60,"m1":30,"v0":15}},"27/(27)1":{"navn":"(27)1 Tagværker","s":41,"v":{"sum":120,"f2,f3":120,"h1,h2,h3":120,"i1":120,"i4,i5":120}},"27/(27)3":{"navn":"(27)3 Tage, fugt- og varmeisolering","s":41,"v":{"sum":40,"j1,j7":40,"j2":40,"m1":50,"n6,n7":40,"p1":40}},"47/(47)1":{"navn":"(47)1 Tage, overflader","s":43,"v":{"sum":40,"e0":80,"f2,f3":50,"g2":60,"g3":80,"h1,h2,h3":40,"h4":50,"h5":80,"h7,h9":50,"i2":25,"i3":30,"j1,j7":25,"j2":25,"j8":40,"n1":20,"n2":40,"n4,n5":40,"n6,n7":20,"v0":15}},"31/(31)4":{"navn":"(31)4 Vinduer, ydervægge","s":42,"v":{"sum":50,"h1,h2,h3":60,"h4":60,"i1":50,"i3":60,"n6,n7":50,"o0":50}},"24/(24)3":{"navn":"(24)3 Trapper indvendige","s":41,"v":{"sum":100,"e0":100,"f2,f3":100,"h1,h2,h3":100,"i1":100,"i4,i5":100}},"25/(25)1":{"navn":"(25)1 Bærende konstruktioner, øvrige (søjler, bjælker, rammer, skaller)","s":41,"v":{"sum":120,"e0":120,"f2,f3":120,"f4":80,"f5":120,"g2":120,"h1,h2,h3":120,"i1":120,"i4,i5":120}},"26/(26)1":{"navn":"(26)1 Altaner og altangange, udkragede","s":41,"v":{"sum":60,"f2,f3":80,"h1,h2,h3":80,"i1":60,"i4,i5":60}}};
  // Bygningsdel (lca-bygningsdele.json) × lagets plads → BUILD-række. Pladsen: bærende/isolering efter Revits lagfunktion;
  // overfladelag (Finish) før kernen er «ude/top», efter kernen «inde/bund» (Revit ordner vægge ude→inde og dæk/tage top→bund).
  var BUILD_DELE = {
    fundamenter: { baerende: "12/(12)1", isolering: "12/(12)4", ude: "12/(12)1", inde: "12/(12)1" },
    terraendaek: { baerende: "13/(13)2", isolering: "13/(13)3", ude: "43/(43)1", inde: "13/(13)2" },
    ydervaegge: { baerende: "21/(21)3", isolering: "21/(21)5", ude: "41/(41)3", inde: "42/(42)1" },
    indervaegge: { baerende: "22/(22)2", isolering: "22/(22)2", ude: "42/(42)1", inde: "42/(42)1" },
    daek: { baerende: "23/(23)2", isolering: "23/(23)2", ude: "43/(43)2", inde: "45/(45)1" },
    tage: { baerende: "27/(27)1", isolering: "27/(27)3", ude: "47/(47)1", inde: "45/(45)1" },
    vinduer_doere: { alle: "31/(31)4" }, trapper: { alle: "24/(24)3" }, soejler_bjaelker: { alle: "25/(25)1" }, altaner: { alle: "26/(26)1" }
  };
  // Tabel 7-datasættets navn → BUILD-materialegruppe (første regel, der passer). Rækkefølgen tæller (fx træbeton før beton).
  // Danske tabel 7-navne og Revits engelske standardmaterialer («Concrete - Precast», «Masonry - Brick», «Insulation / …»).
  var BUILD_MATERIALER = [
    [/porebeton|aerated concrete|aircrete/i, "f4"], [/letklinker|letbeton|leca|lightweight (concrete|aggregate)/i, "f5"],
    [/træbeton|fibercement|cementbundet|fib(er|re) cement/i, "j8"], [/gips|gypsum|plasterboard/i, "f7"],
    [/(^|[^-])glaseret|glazed/i, "g3"], [/tegl|mursten|klinker|keramik|brick|ceramic/i, "g2"], [/natursten|granit|skifer|marmor|natural stone|granite|slate|marble/i, "e0"],
    [/kalkmørtel|kalkpuds|lime (mortar|plaster)/i, "f1"],
    [/beton|cement|mørtel|terrazzo|puds|flise|concrete|mortar|screed|plaster/i, "f2,f3"], [/masonry/i, "g2"],
    [/armering|stål|jern|steel|iron|rebar/i, "h1,h2,h3"], [/alumin/i, "h4"], [/kobber|copper/i, "h5"], [/zink|zinc|bly|lead/i, "h7,h9"],
    [/mineraluld|stenuld|glasuld|mineral wool|rock ?wool|glass ?wool|batt/i, "m1"],
    [/krydsfin|finér|limtræ|clt|krydslamineret|parket|plywood|glulam|laminated|parquet/i, "i4,i5"],
    [/spånplade|osb|mdf|træfiber|hdf|particle ?board|fib(er|re) ?board/i, "j1,j7"],
    [/konstruktionstræ|træ|fyr|gran|lærk|ceder|wood|timber|lumber/i, "i1"], [/asfalt|bitumen|tagpap|asphalt|roofing felt/i, "n1"],
    [/filt|tæppe|carpet/i, "n2"], [/linoleum|gummi|epdm|rubber/i, "n4,n5"],
    [/eps|xps|pir|pur|polystyren|plast|pvc|polyethylen|polypropylen|folie|membran|dampspærre|undertag|radonspærre|rigid insulation|foam|polystyrene|polyethylene|vapou?r/i, "n6,n7"],
    [/glas|rude|glass|glazing/i, "o0"], [/maling|lak|spartel|paint/i, "v0"], [/grus|sand|singles|tilslag|gravel/i, "p1"]
  ];
  function lagPlads(b, kerne, i) {
    var f = tekst(b.funktion).toLowerCase();
    if (/insulation|thermal|membrane/.test(f)) return "isolering";
    if (/finish/.test(f)) return kerne >= 0 && i > kerne ? "inde" : "ude";
    return "baerende";
  }
  function buildKolonne(navn) { for (var i = 0; i < BUILD_MATERIALER.length; i++) if (BUILD_MATERIALER[i][0].test(navn)) return BUILD_MATERIALER[i][1]; return "sum"; }
  // → {table,row,column} og årene (kun til visning; Rust slår op), eller null når bygningsdelen ikke har en række.
  function levetidRef(delId, plads, raekke) {
    var d = BUILD_DELE[delId]; if (!d) return null;
    var key = d.alle || d[plads], r = BUILD_RAEKKER[key]; if (!r) return null;
    var kol = buildKolonne(tekst(raekke && raekke.name_da));
    if (r.v[kol] == null) kol = "sum";
    return { ref: { table: LEVETID_TABEL, row: key, column: kol }, aar: r.v[kol], tekst: "BUILD 2021 bilag 4, s. " + r.s + ": " + r.navn + ", kolonne " + kol + " = " + r.v[kol] + " år" };
  }

  /* ---------- A4/A5 med standardværdier (BR18 bilag 2 tabel 10 og 11) ---------- */
  // Rust laver A4/A5-linjerne af projektfeltet process_defaults (construction.rs). Tabelversionen er indbygget i motoren.
  var PROCES_TABEL = "br18-tabel-10-11-2025@76db8ecf459b";
  var TRANSPORT = [
    [/porebeton/i, "Cementbaserede produkter (uden beton) / Porebeton"], [/letklinker/i, "Cementbaserede produkter (uden beton) / Letklinker"],
    [/fibercement/i, "Cementbaserede produkter (uden beton) / Fibercement"], [/fabriksbeton/i, "Beton / Fabriksbeton"],
    [/letbeton|beton.*(element|dæk)|huldæk|ribbedæk|tt-element/i, "Beton / Væg- og dækelementer"], [/beton/i, "Beton / Øvrige elementer"],
    [/tagsten/i, "Tegl og mursten / Tagsten"], [/mursten|tegl|klinker|keramik/i, "Tegl og mursten / Mursten"], [/kalksandsten/i, "Kalciumsilikat / Kalksandsten"],
    [/gipsplade|gips.*plade/i, "Gips / Gipsplader"], [/gips|spartel/i, "Gips / Mørtel og puds"],
    [/mørtel|puds|cement|flise/i, "Cementbaserede produkter (uden beton) / Cementbaseret mørtel og puds"],
    [/armering/i, "Stål / Armeringsstål"], [/stål|jern/i, "Stål / Plader og profiler"], [/alumin/i, "Aluminium / Plader og profiler"], [/zink/i, "Zink / Zinkbeklædninger"],
    [/vindue|dør|rude|curtain/i, "Facadeåbninger / Vinduer og døre"], [/natursten|granit|skifer/i, "Natursten / Natursten"],
    [/mineraluld|stenuld|glasuld/i, "Isolering / Mineraluld"], [/eps|xps|pir|pur|polystyren/i, "Isolering / EPS"], [/cellulose|papiruld/i, "Isolering / Cellulose"],
    [/træfiber.*isol/i, "Isolering / Træfiber"], [/tagpap|bitumen|epdm|tagmembran|tagfolie/i, "Bitumen / Tagpap"],
    [/dampspærre|folie|membran|undertag/i, "Membraner og overfladebehandlinger / Dampspærre"], [/maling|lak/i, "Membraner og overfladebehandlinger / Paint"],
    [/krydsfin|osb|spånplade|mdf|træfiber|plade|bræd|gulv|parket/i, "Træ / Træplader, brædder og gulve"],
    [/limtræ|clt|krydslamineret|konstruktionstræ|træ|fyr|gran/i, "Træ / Konstruktionstræ"], [/solcelle/i, "Tekniske bygningsinstallationer / Solceller"]
  ];
  function transportGruppe(navn) { for (var i = 0; i < TRANSPORT.length; i++) if (TRANSPORT[i][0].test(navn)) return TRANSPORT[i][1]; return null; }
  // Tabel 11-fraktioner (til panelets valg). Ved blandet affald bruges den højeste værdi af de blandede typer.
  var AFFALDSFRAKTIONER = ["Natursten", "Uglaseret tegl (mur- og tagsten)", "Beton", "Jern og metal", "Fibergips", "Almindelig gips", "Stenuld", "Glasuld",
    "Asfalt", "Træ", "Plastik", "PVC", "Glas", "Emballagepap", "Sanitet, fliser og glaserede tegl"];

  /* ---------- Installationer: tabel 7-standardværdier (vejledning 1.4.9) ---------- */
  var INSTALLATIONER = {
    single_family: ["#S0001@494", "#S0002@495", "#S0003@496"], holiday_under_150: ["#S0001@494", "#S0002@495", "#S0003@496"], holiday_150_plus: ["#S0001@494", "#S0002@495", "#S0003@496"],
    apartment: ["#S0007@500", "#S0008@501", "#S0009@502"], office: ["#S0010@503", "#S0011@504", "#S0012@505"], other: ["#S0013@506", "#S0014@507", "#S0015@508"]
  };
  var INSTALLATIONSDELE = { afloeb: 1, vand: 1, varme: 1, ventilation: 1 };
  function installationKategori(navn) { var n = tekst(navn).toLowerCase(); return /afløb$/.test(n) ? "afloeb" : /vand$/.test(n) ? "vand" : /varme, ventilation og køl$/.test(n) ? "varme_ventilation_koel" : null; }

  /* ---------- B6 fra Be18-nøgletal (BR18 bilag 2 tabel 8.1) ---------- */
  // Som ISSANA LCA's web/energy-factors.mjs: 50 årlige poster med tabel 8.1-faktoren for kalenderåret (2050-værdien videreføres).
  var BAERER = { electricity: "El", district_heat: "Fjernvarme", gas: "Ledningsgas" };
  function energiPoster(tabel8, baerer, foersteAar, aarligt, kilde, prefiks) {
    var faktorer = {}; (tabel8 && tabel8.energy_years || []).forEach(function (r) { faktorer[r.year] = r; });
    var ud = [];
    for (var y = 0; y < 50; y++) {
      var aar = foersteAar + y, r = faktorer[Math.min(aar, 2050)];
      if (!r || !erTal(r[baerer])) return null;
      ud.push({ id: prefiks + "-" + baerer + "-" + foersteAar + "-" + y, carrier: BAERER[baerer], from_year: y, to_year: y + 1, annual_quantity: aarligt, unit: "kWh",
        factor_kgco2e_per_unit: r[baerer], factor_source: "BR18 bilag 2 tabel 8.1 (2025), Ark1!" + r.workbook_row + ", kalenderår " + aar + (aar > 2050 ? " (2050-værdi videreført)" : "") + "; " + tekst(tabel8.energy_source && tabel8.energy_source.url),
        quantity_source: kilde });
    }
    return ud;
  }

  /* ---------- Mængde pr. m³ konstruktion (konstruktioner uden areal, fx trapper og søjler) ---------- */
  // Hele elementet er byggevaren. Pr. m³ konstruktion er det 1 m³; pr. m eller stk er det elementernes volumen ÷ længden eller antallet
  // (m³/m og m³/stk som i LCAbyg). volPr 0 = volumenet er ukendt.
  var ENHED_TEKST = { m2: "m²", m3: "m³", m: "m", stk: "stk" };
  function produktMaengdeVolumen(raekke, volPr, kEnhed) {
    if (volPr == null) { volPr = 1; kEnhed = "m3"; }
    var u = raekke.declared_unit, k = enhedNoegle(u), mf = erTal(raekke.mass_factor) && raekke.mass_factor > 0 ? raekke.mass_factor : null, mu = tekst(raekke.mass_unit), pr = ENHED_TEKST[kEnhed];
    if (!(volPr > 0)) return { mangler: "elementerne har ingen lukket geometri, så volumenet pr. " + pr + " er ukendt; angiv omregningsfaktoren" };
    if (k === "m3") return { unit: "m3", amount: volPr, conversion: null, kilde: tal(volPr) + " m³ byggevare pr. " + pr + " konstruktion (hele elementet; datasættet er pr. m³)" };
    if ((k === "kg" || k === "ton") && mf && (mu === "kg/m³" || mu === "ton/m³")) {
      var kgPrM3 = mu === "kg/m³" ? mf : mf * 1000;
      return { unit: "m3", amount: volPr, conversion: { from_unit: "m3", to_unit: u, multiplier: kgPrM3 * (k === "ton" ? 1 / 1000 : 1), source: "m³ → " + u + " (BR18 bilag 2 tabel 7 (2025), " + raekke.key + ", massefaktor " + tal(mf) + " " + mu + ")" },
        kilde: tal(volPr) + " m³ pr. " + pr + " konstruktion; omregnet til " + u + " med tabellens massefaktor" };
    }
    return { mangler: kEnhed === "m3" ? "konstruktionen har kun et volumen, og datasættet er pr. «" + u + "»; omregning mangler" : "konstruktionen er opgjort pr. " + pr + ", og datasættet er pr. «" + u + "»; angiv omregningsfaktoren" };
  }

  /* ---------- Referenceareal ---------- */
  // Forslag: sum af gulvenes areal i modellen (alle etager). Kun et forslag; brugeren bekræfter det i panelet.
  function forslagReferenceareal(model) {
    var sum = 0, n = 0, etager = {};
    (model && model.elements || []).forEach(function (e) {
      if (!e || e.erRum || !erTal(e.area) || e.area <= 0) return;
      if (!/^(gulve|floors)$/i.test(tekst(e.category)) && e.builtInCategory !== "OST_Floors") return;
      sum += e.area; n++; if (e.level) etager[e.level] = 1;
    });
    if (!n) return null;
    var m2 = Math.round(sum * 100) / 100;
    return { m2: m2, kilde: "ISSANA 3D: sum af " + n + " gulves areal på " + Object.keys(etager).length + " etager i modellen (" + tal(m2) + " m²). Kontrollér mod etagearealet efter BR18 vejledning 1.3." };
  }

  // Deterministisk projekt-id (uuid-form) af modellens navn, så samme model giver samme id i preview. «Åbn i ISSANA LCA»
  // får et nyt id i pluginet (issana_lca_gem), så et projekt i ISSANA LCA aldrig overskrives.
  function projektId(noegle) {
    var h = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b], s = tekst(noegle) || "model";
    for (var i = 0; i < s.length; i++) for (var j = 0; j < 4; j++) { h[j] ^= s.charCodeAt(i) + j; h[j] = Math.imul(h[j], 16777619 + j * 2); }
    var hex = h.map(function (x) { return ("00000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4" + hex.slice(13, 16) + "-8" + hex.slice(17, 20) + "-" + hex.slice(20, 32);
  }

  /* ---------- EPD-valg pr. lag ---------- */
  // epdValg: {<typeId>: {<lag-id>: {post, status:'bekraeftet'|'proposed'}}}. Uden valg bruges strukturens egne «har»-poster
  // (dataposten lca.byggevarer, bekræftet). Kun BR18 tabel 7-poster kan blive miljødata her; andre kilder bliver en note.
  function valgFor(epdValg, typeId, b) {
    var v = epdValg && epdValg[String(typeId)] && epdValg[String(typeId)][String(b.id)];
    if (v && v.post) return { post: v.post, bekraeftet: v.status === "bekraeftet" || v.status === "confirmed" };
    if (b.status === "har" && b.epd) return { post: { datasaet: b.epd.nummer, datasaetKey: b.epd.key || b.epd.datasaetKey || null, navn: b.epd.navn || null, kildeType: b.generisk ? "br18-tabel7" : null, kilde: b.kilde }, bekraeftet: true, fraStruktur: true };
    return null;
  }
  function erTabel7(post) { return post && (post.kildeType === "br18-tabel7" || /^BR18 bilag 2 tabel 7/.test(tekst(post.kilde)) || /^#[A-Z]\d{4}$/.test(tekst(post.datasaet))); }

  /* ---------- Egen EPD pr. byggevare (LCA-fanens «Ret» → «Egen EPD») ---------- */
  // post.kildeType "bruger-epd": moduler og dokumentation, som brugeren har tastet. Bliver environmental_data med origin user_epd;
  // Rust (environment.rs) vurderer dokumentationen (3.-partsverifikation, EN 15804, datoer, produktmatch) og giver mangler for
  // det, der mangler. 3D udfylder intet: et tomt modul er «ikke deklareret», aldrig 0.
  var BRUGER_EPD_ENHEDER = ["m³", "m²", "m", "kg", "ton", "stk"];
  function erBrugerEpd(post) { return !!post && post.kildeType === "bruger-epd"; }
  function brugerModul(v, scenarie) {
    return erTal(v) ? { status: "declared", value: v, source: null, scenario: tekst(scenarie).trim() || null } : { status: "not_declared", value: null, source: null, scenario: null };
  }
  function enumVaerdi(v, tilladt, std) { return tilladt.indexOf(v) >= 0 ? v : std; }
  function brugerMiljoedata(post, pid, produktNavn) {
    var e = post.epd || {}, g = post.gwp || {}, s = function (v) { return tekst(v).trim() || null; };
    return { id: "m-epd-" + slug(pid), origin: "user_epd", dataset_id: s(e.registreringsnr) || s(post.navn) || pid, dataset_name: s(post.navn),
      catalogue_id: null, catalogue_key: null,
      source: (s(post.kildeTekst) || "Egen EPD angivet i ISSANA 3D") + (s(e.url) ? ": " + s(e.url) : "") + (s(e.placering) ? ", " + s(e.placering) : ""),
      declared_unit: post.enhed,
      // D uden deklareret værdi kræver en eksplicit fallback (vejledning 1.6: 0 anbefales); kun når brugeren har valgt det.
      modules: { a1a3: brugerModul(g.A1A3), c3: brugerModul(g.C3, e.scenarieC3), c4: brugerModul(g.C4, e.scenarieC4),
        d: !erTal(g.D) && e.dNul === true ? { status: "fallback", value: 0, source: "LCA-vejledningen til BR18, afsnit 1.6: 0 anbefales, når D ikke er deklareret. Valgt af brugeren i ISSANA 3D.",
          scenario: "D er ikke deklareret i EPD'en «" + (s(post.navn) || produktNavn) + "»." } : brugerModul(g.D) },
      valid_until: s(e.udloeb),
      epd: { document: { url: s(e.url), file_name: null, file_sha256: null, size_bytes: null, location: s(e.placering) },
        registration_number: s(e.registreringsnr), program_operator: s(e.programoperatoer), manufacturer: s(e.producent),
        third_party_verified: enumVaerdi(e.verificeret, ["yes", "no", "unknown"], "unknown"),
        en15804_version: enumVaerdi(e.en15804, ["A1", "A2", "unknown"], "unknown"),
        gwp_indicator: enumVaerdi(e.gwpIndikator, ["GWP", "GWP-total", "unknown"], "unknown"),
        epd_type: enumVaerdi(e.type, ["product", "project", "branch", "unknown"], "unknown"),
        issue_date: s(e.udstedt), use_date: s(e.anvendt), issued_after_use_assessment: null,
        product_match: { epd_product: s(post.navn) || produktNavn, product_id: pid, actual_product: produktNavn,
          assessment: e.daekker === true ? "confirmed" : "not_confirmed",
          note: e.daekker === true ? "Bekræftet af brugeren i ISSANA 3D: EPD'en dækker byggevaren." : null } } };
  }
  // Mængde pr. enhed konstruktion i EPD'ens deklarerede enhed. kg kræver densiteten (kg/m³), som brugeren angiver fra EPD'en.
  function brugerMaengde(post, tykkelseMm, fraNavn, volPr, kEnhed) {
    var u = post.enhed, k = enhedNoegle(u), tyk = erTal(tykkelseMm) && tykkelseMm > 0 ? tykkelseMm : null, rho = erTal(post.densitet) && post.densitet > 0 ? post.densitet : null;
    var tykTekst = tyk != null ? (fraNavn ? "tykkelse " + tal(tyk) + " mm udledt af typenavnet" : "lagtykkelse " + tal(tyk) + " mm fra Revit-typen") : null;
    var omr = function (fra) { return { from_unit: fra, to_unit: u, multiplier: rho, source: "densitet " + tal(rho) + " kg/m³ angivet med den egne EPD «" + tekst(post.navn) + "» i ISSANA 3D" }; };
    if (volPr != null) {
      var pr = ENHED_TEKST[kEnhed];
      if (!(volPr > 0)) return { mangler: "elementerne har ingen lukket geometri, så volumenet pr. " + pr + " er ukendt; angiv omregningsfaktoren" };
      if (k === "m3") return { unit: "m3", amount: volPr, conversion: null, kilde: tal(volPr) + " m³ byggevare pr. " + pr + " konstruktion (EPD'en er pr. m³)" };
      if (k === "kg" && rho) return { unit: "m3", amount: volPr, conversion: omr("m3"), kilde: tal(volPr) + " m³ pr. " + pr + " konstruktion; omregnet til kg med densiteten" };
      return { mangler: (kEnhed === "m3" ? "konstruktionen har kun et volumen" : "konstruktionen er opgjort pr. " + pr) + ", og EPD'en er pr. «" + u + "»; angiv mængden under «Ret»" };
    }
    if (k === "m2") return { unit: "m2", amount: 1, conversion: null, kilde: "1 m² byggevare pr. m² konstruktion (EPD'en er pr. m²)" };
    if (k === "m3") return tyk == null ? { mangler: "mængden kræver lagets tykkelse (EPD'en er pr. m³)" } : { unit: "m3", amount: tyk / 1000, conversion: null, kilde: tykTekst + " = " + tal(tyk / 1000) + " m³ pr. m²" };
    if (k === "kg") {
      if (tyk == null) return { mangler: "mængden kræver lagets tykkelse (EPD'en er pr. kg)" };
      if (!rho) return { mangler: "EPD'en er pr. kg: angiv densiteten (kg/m³) under «Ret»" };
      return { unit: "m3", amount: tyk / 1000, conversion: omr("m3"), kilde: tykTekst + " = " + tal(tyk / 1000) + " m³ pr. m²; omregnet til kg med densiteten" };
    }
    return { mangler: "EPD'en er pr. «" + u + "»; angiv mængden under «Ret»" };
  }
  // Masse pr. deklareret enhed til A4 (Rust tager kg selv): m³ = densitet; m² = densitet × lagtykkelse.
  function brugerMasse(post, tykkelseMm) {
    var k = enhedNoegle(post.enhed), rho = erTal(post.densitet) && post.densitet > 0 ? post.densitet : null;
    if (!rho) return null;
    if (k === "m3") return { kg: rho, kilde: "densitet " + tal(rho) + " kg/m³ fra den egne EPD «" + tekst(post.navn) + "»" };
    if (k === "m2" && erTal(tykkelseMm) && tykkelseMm > 0) return { kg: rho * tykkelseMm / 1000, kilde: "densitet " + tal(rho) + " kg/m³ × lagtykkelse " + tal(tykkelseMm) + " mm (egen EPD «" + tekst(post.navn) + "»)" };
    return null;
  }
  // Hvem har valgt byggevarens data: brugeren selv i LCA-fanen, en bekræftet eller ubekræftet AI/tabel 7-post, eller typens egne data.
  function valgKilde(v) {
    if (!v) return null;
    if (v.fraStruktur) return "struktur";
    if (erBrugerEpd(v.post)) return "egen_epd";
    if (v.post && v.post.valgtAfBruger) return "bruger";
    return v.bekraeftet ? "bekraeftet" : "forslag";
  }

  /* ---------- Hele projektet ---------- */
  // struktur: ai-lca.js bygLcaStruktur. valg: {tabel (tabel 7-JSON), katalog {sha256, source_workbook_sha256?}, epdValg,
  //   levetider {<produkt-id>: {aar, kilde}}, referenceareal {m2, kilde}, bygningstype, model (issana-3d, til navn/id), navn?, id?, testdata?}
  // → {klar, projekt|null, mangler:[{kode, tekst}] (blokerer beregning), noter:[{id, kode, tekst}] (forklarer Rusts mangler),
  //    kort:{<v3-id>: [Revit element-id'er]}, tal}
  function bygProjekt(struktur, valg) {
    valg = valg || {};
    var tabel = valg.tabel || null, katalog = valg.katalog || null, mangler = [], noter = [], kort = {};
    var tal0 = { bygningsdele: 0, konstruktioner: 0, produkter: 0, udeladt: 0, officielle: 0, forslag: 0, udenMiljoedata: 0, udenMaengde: 0 };
    if (!struktur || !Array.isArray(struktur.bygningsdele)) mangler.push({ kode: "struktur_mangler", tekst: "LCA-strukturen fra modellen er ikke bygget (ingen model indlæst)." });
    if (!tabel || !Array.isArray(tabel.materials)) mangler.push({ kode: "katalog_mangler", tekst: "BR18 tabel 7 (data/br18-tabel-7-2025.js) er ikke indlæst." });
    if (!katalog || !/^[0-9a-f]{64}$/.test(tekst(katalog.sha256))) mangler.push({ kode: "katalog_sha_mangler", tekst: "Katalogets SHA-256 kendes ikke (issana_lca_info eller br18-tabel-7-2025.meta.json)." });
    var ref = valg.referenceareal;
    if (!ref || !erTal(ref.m2) || ref.m2 <= 0) mangler.push({ kode: "referenceareal_mangler", tekst: "Referenceareal (m²) mangler. Angiv det i LCA-panelet (forslag: sum af gulvarealer)." });
    var brug = BYGNINGSTYPER.filter(function (b) { return b.id === valg.bygningstype; })[0];
    if (!brug) mangler.push({ kode: "bygningstype_mangler", tekst: "Bygningstype mangler. Vælg den i LCA-panelet; den giver BR18-grænsen." });
    if (mangler.some(function (m) { return m.kode === "struktur_mangler" || m.kode === "katalog_mangler" || m.kode === "katalog_sha_mangler"; }))
      return { klar: false, projekt: null, mangler: mangler, noter: noter, kort: kort, tal: tal0 };

    var parts = [], constructions = [], products = [], miljo = {}, miljoListe = [], transport = [], byggevarer = {}, konstruktioner = {};
    tal0.buildLevetid = 0; tal0.transport = 0; tal0.egneEpd = 0;
    var brugInstallationer = valg.installationer !== false;
    var brugMiljo = function (raekke, officiel) {
      var md = miljoedata(tabel, katalog, raekke, officiel);
      if (!miljo[md.id]) { miljo[md.id] = md; miljoListe.push(md); }
      return md.id;
    };
    struktur.bygningsdele.forEach(function (d) {
      if (brugInstallationer && INSTALLATIONSDELE[d.id] && (d.konstruktioner || []).length) {
        noter.push({ id: null, kode: "installationer_standard", tekst: "«" + d.navn + "» i modellen er ikke medregnet: installationer regnes med tabel 7's standardværdier pr. m² opvarmet areal (vejledning 1.4.9), så de ikke tælles dobbelt." });
        return;
      }
      var partId = "d-" + slug(d.id);
      var delIds = [];
      parts.push({ id: partId, name: d.navn, category: "ISSANA 3D › " + d.navn,
        source: "ISSANA 3D: bygningsdel efter lca-bygningsdele.json (Revit-kategori, funktion, laveste niveau, CCI) i " + (tekst(struktur.model) || "modellen") + ".",
        import_ref: null, installation_category: null });
      tal0.bygningsdele++;
      (d.konstruktioner || []).forEach(function (k) {
        var kid = "k-" + slug(d.id) + "-" + slug(k.typeId != null ? k.typeId : k.navn);
        // Samme type i to underkategorier (fx kælder og stue): den anden får underkategorien i id'et; ellers er id'et som før.
        // Byggevarerne (pid) får det samme tillæg, ellers afviser Rust dem som dubletter.
        var kTillaeg = konstruktioner[kid] ? "-" + slug(k.underkategori || "2") : "";
        kid += kTillaeg;
        konstruktioner[kid] = { underkategori: k.underkategori || null, antaget: !!k.underkategoriAntaget };
        var ids = (k.elementIds || []).slice(); delIds = delIds.concat(ids); kort[kid] = ids;
        // Et kendt nulareal er en mængde; null er manglende data.
        var areal = erTal(k.areal) && k.areal >= 0 ? k.areal : null;
        // Linjeelementer (fundamenter, bjælker, søjler) tælles i løbende meter og enkeltstående fundamenter i stk, som i LCAbyg.
        var linjeStk = k.enhed === "m" && erTal(k.laengde) && k.laengde > 0 ? "m" : k.enhed === "stk" && k.antal > 0 ? "stk" : null;
        // Uden areal (trapper): volumenet af Revit-geometrien (ai-lca.js meshVolumen), så mængden ikke mangler.
        var volumen = !linjeStk && areal == null && erTal(k.volumen) && k.volumen > 0 ? k.volumen : null, kEnhed = linjeStk || (volumen != null ? "m3" : "m2");
        var kMaengde = linjeStk === "m" ? k.laengde : linjeStk === "stk" ? k.antal : areal != null ? areal : volumen;
        // Volumen pr. enhed konstruktion, når hele elementet er byggevaren; null = regnes pr. m² ud fra laget.
        var volPr = kEnhed === "m3" ? 1 : linjeStk ? (erTal(k.volumen) && k.volumen > 0 ? k.volumen / kMaengde : 0) : null;
        constructions.push({ id: kid, part_id: partId, name: k.navn || "Uden type", quantity: kMaengde, unit: kEnhed,
          quantity_source: "Revit via ISSANA 3D: " + k.antal + " elementer af typen «" + (k.navn || "") + "»" + (k.typeId != null ? " (type-id " + k.typeId + ")" : "") +
            (linjeStk === "m" ? ", samlet længde " + tal(kMaengde) + " m (" + (k.laengdeGeometri ? "målt på elementernes geometri i issana-3d-eksporten" : "Revits længde i issana-3d-eksporten") + ")." :
              linjeStk === "stk" ? ", opgjort i stk." :
              areal != null ? ", samlet areal " + tal(areal) + " m² (elementernes areal i issana-3d-eksporten)." :
              volumen != null ? ", samlet volumen " + tal(volumen) + " m³ beregnet af elementernes lukkede geometri i issana-3d-eksporten (de har intet areal)." : "; arealet mangler i eksporten."),
          import_ref: null });
        tal0.konstruktioner++;
        if (!linjeStk && areal == null && volumen == null) noter.push({ id: kid, kode: "areal_mangler", tekst: "«" + k.navn + "»: elementerne har hverken areal eller lukket geometri i 3D-eksporten, så konstruktionens mængde er ukendt." });
        if (volumen != null) noter.push({ id: kid, kode: "maengde_volumen", tekst: "«" + k.navn + "»: mængden er volumenet af Revit-geometrien (" + tal(volumen) + " m³), fordi elementerne intet areal har. Kontrollér det mod tegningerne." });
        if (linjeStk === "m" && k.laengdeGeometri) noter.push({ id: kid, kode: "laengde_geometri", tekst: "«" + k.navn + "»: længden (" + tal(kMaengde) + " m) er målt på geometrien, fordi eksporten ikke har Revits længde. Kontrollér den mod tegningerne, eller eksportér modellen igen." });
        if (k.kildeType && k.co2PrM2 != null && !(k.byggevarer || []).some(function (b) { return valgFor(valg.epdValg, k.typeId, b); }))
          noter.push({ id: kid, kode: "kilde_ikke_modulopdelt", tekst: "«" + k.navn + "» har CO₂ for hele typen (" + tal(k.co2PrM2) + " kg CO₂e/m², " + (k.kilde || k.kildeType) + "). Tallet er ikke opdelt i A1-A3/C3/C4/D og kan ikke bruges i ISSANA LCA; vælg EPD pr. lag, eller registrér EPD'en i ISSANA LCA." });
        // En hel opbygning fra brugerens LCAbyg-bibliotek afløser Revit-typens lag, når den har samme enhed som konstruktionen.
        var opb = valg.opbygninger && k.typeId != null ? valg.opbygninger[k.typeId] : null;
        if (opb && opb.enhed !== kEnhed) { noter.push({ id: kid, kode: "opbygning_enhed", tekst: "«" + k.navn + "»: opbygningen «" + tekst(opb.navn) + "» er pr. " + (ENHED_TEKST[opb.enhed] || opb.enhed) + ", men konstruktionen er opgjort pr. " + ENHED_TEKST[kEnhed] + "; den bruges ikke." }); opb = null; }
        konstruktioner[kid].typeId = k.typeId != null ? k.typeId : null;
        konstruktioner[kid].opbygning = opb ? { navn: tekst(opb.navn), kilde: tekst(opb.kilde) } : null;
        if (opb) {
          (opb.linjer || []).forEach(function (l, i) {
            var pid = "p-" + slug(d.id) + "-" + slug(k.typeId) + kTillaeg + "-o" + i, mde = brugerMiljoedata(l.post, pid, l.navn);
            kort[pid] = ids;
            if (!miljo[mde.id]) { miljo[mde.id] = mde; miljoListe.push(mde); }
            var p = { id: pid, construction_id: kid, name: l.navn, amount: l.maengde, unit: l.post.enhed, per_unit: kEnhed,
              quantity_source: "Opbygningen «" + tekst(opb.navn) + "» fra " + tekst(opb.kilde) + ": " + tal(l.maengde) + " " + l.post.enhed + " pr. " + ENHED_TEKST[kEnhed] + " konstruktion.",
              service_life_years: erTal(l.levetid) && l.levetid > 0 ? l.levetid : null, service_life_source: erTal(l.levetid) && l.levetid > 0 ? "Levetid fra LCAbyg-eksporten (" + tekst(opb.navn) + ")." : null,
              environmental_data_id: mde.id, conversion: null, import_ref: null };
            var mo = valg.maengder && valg.maengder[pid], maengdeValg = null;
            if (mo && erTal(mo.faktor) && mo.faktor >= 0 && tekst(mo.kilde).trim()) {
              p.amount = mo.faktor; p.quantity_source = "Angivet i ISSANA 3D: omregningsfaktor " + tal(mo.faktor) + " " + l.post.enhed + " pr. " + ENHED_TEKST[kEnhed] + " konstruktion (" + tekst(mo.kilde).trim() + ").";
              maengdeValg = { faktor: mo.faktor, enhed: l.post.enhed, kilde: tekst(mo.kilde).trim(), form: mo.form || null, felter: mo.felter || null };
            }
            var gr = transportGruppe(tekst(l.post.materiale || l.navn));
            if (gr) { var tr = { product_id: pid, group: gr }, ms = brugerMasse(l.post, null); if (ms) { tr.mass_kg_per_unit = ms.kg; tr.mass_source = ms.kilde; } transport.push(tr); tal0.transport++; }
            tal0.egneEpd++; tal0.produkter++;
            byggevarer[pid] = { typeId: k.typeId, lag: null, materiale: l.navn, funktion: null, tykkelseMm: null, konstruktionId: kid, delId: d.id, valg: "bibliotek", post: l.post, enhed: l.post.enhed, maengde: maengdeValg, levetid: null,
              kanAendres: false, kanAendreMaengde: true, massefaktor: erTal(l.post.densitet) && l.post.densitet > 0 ? { v: l.post.densitet, enhed: "kg/m³" } : null };
            products.push(p);
          });
          return;
        }
        var kerne = -1;
        (k.byggevarer || []).forEach(function (b, i) { if (kerne < 0 && /structure/i.test(tekst(b.funktion))) kerne = i; });
        (k.byggevarer || []).forEach(function (b, i) {
          if (b.medregnes === false) { tal0.udeladt++; return; }
          var pid = "p-" + slug(d.id) + "-" + slug(k.typeId != null ? k.typeId : k.navn) + kTillaeg + "-" + i;
          kort[pid] = ids;
          var navn = b.opbygningMangler ? (k.navn + " (opbygning mangler)") : (b.navn || b.materiale || ("Lag " + (i + 1)));
          var p = { id: pid, construction_id: kid, name: navn, amount: 1, unit: kEnhed, per_unit: kEnhed,
            quantity_source: "", service_life_years: null, service_life_source: null, environmental_data_id: null, conversion: null, import_ref: null };
          var lagTekst = "Revit-typen «" + k.navn + "»" + (b.heltElement ? " (hele elementet)" : b.opbygningMangler ? " (ingen lagopbygning i Revit)" : ", lag " + (i + 1) + " «" + (b.materiale || b.navn || "") + "»" + (b.tykkelseMm != null ? " " + tal(b.tykkelseMm) + " mm" : ""));
          var v = valgFor(valg.epdValg, k.typeId, b), raekke = v && erTabel7(v.post) ? findRaekke(tabel, v.post) : null;
          var egen = v && erBrugerEpd(v.post) && BRUGER_EPD_ENHEDER.indexOf(v.post.enhed) >= 0 ? v.post : null;
          if (v && erBrugerEpd(v.post) && !egen) noter.push({ id: pid, kode: "egen_epd_enhed", tekst: navn + ": den egne EPD har en ukendt enhed «" + tekst(v.post.enhed) + "» (m³, m², kg eller stk)." });
          else if (v && !egen && !erTabel7(v.post)) noter.push({ id: pid, kode: "kilde_ikke_tabel7", tekst: navn + ": kilden «" + (v.post.kilde || "?") + "» er ikke en BR18 tabel 7-post; registrér EPD'en i ISSANA LCA (bruger-EPD med dokumentation)." });
          else if (v && !raekke) noter.push({ id: pid, kode: "datasaet_ukendt", tekst: navn + ": datasæt " + (v.post.datasaet || "?") + " findes ikke entydigt i den indlæste BR18 tabel 7." });
          if (raekke) {
            var q = volPr != null ? produktMaengdeVolumen(raekke, volPr, kEnhed) : produktMaengde(raekke, b.tykkelseMm, !!b.tykkelseFraNavn);
            p.environmental_data_id = brugMiljo(raekke, v.bekraeftet);
            if (v.bekraeftet) tal0.officielle++; else tal0.forslag++;
            if (q.mangler) { p.amount = null; p.unit = raekke.declared_unit; p.quantity_source = lagTekst + ": " + q.mangler + "."; tal0.udenMaengde++;
              noter.push({ id: pid, kode: "omregning_mangler", tekst: navn + " → " + raekke.name_da + ": " + q.mangler + "." }); }
            else { p.amount = q.amount; p.unit = q.unit; p.conversion = q.conversion; p.quantity_source = lagTekst + ": " + q.kilde + "."; }
            // Levetid: BUILD levetidstabel 2021 (BR18 § 297 stk. 10) ud fra bygningsdel, lagets plads og materialet. Rust slår op.
            var lr = levetidRef(d.id, lagPlads(b, kerne, i), raekke);
            if (lr) { p.service_life_ref = lr.ref; tal0.buildLevetid++; }
            else if (erTal(v.post.levetid) && v.post.levetid > 0) { p.service_life_years = v.post.levetid; p.service_life_source = "ISSANA 3D: levetid i typens datapost (" + (v.post.kilde || "uden kilde") + ")."; }
            // A4: transportgruppe i tabel 10. «m² ved R=1» kræver masse pr. enhed = λ × massefaktor (λ fra «kl. NN»).
            var gruppe = transportGruppe(raekke.name_da);
            if (gruppe) {
              var tr = { product_id: pid, group: gruppe }, klM = /kl\.?\s*(\d{2})/i.exec(tekst(raekke.name_da));
              if (/^m2 with r=1/.test(enhedNoegle(raekke.declared_unit)) && klM && erTal(raekke.mass_factor)) {
                var lam = Number(klM[1]) / 1000;
                tr.mass_kg_per_unit = lam * raekke.mass_factor;
                tr.mass_source = "λ " + lam + " m (kl. " + klM[1] + " i datasættets navn) × tabel 7 " + raekke.key + " massefaktor " + tal(raekke.mass_factor) + " kg/m³";
              }
              transport.push(tr); tal0.transport++;
            }
          } else if (egen) {
            // Egen EPD (user_epd): mængde i EPD'ens enhed, levetid og A4-gruppe ud fra materialet, A4-masse fra densiteten.
            var qe = brugerMaengde(egen, b.tykkelseMm, !!b.tykkelseFraNavn, volPr, kEnhed), mde = brugerMiljoedata(egen, pid, navn);
            if (!miljo[mde.id]) { miljo[mde.id] = mde; miljoListe.push(mde); }
            p.environmental_data_id = mde.id; tal0.egneEpd++;
            if (qe.mangler) { p.amount = null; p.unit = egen.enhed; p.quantity_source = lagTekst + ": " + qe.mangler + "."; tal0.udenMaengde++;
              noter.push({ id: pid, kode: "omregning_mangler", tekst: navn + " → egen EPD «" + tekst(egen.navn) + "»: " + qe.mangler + "." }); }
            else { p.amount = qe.amount; p.unit = qe.unit; p.conversion = qe.conversion; p.quantity_source = lagTekst + ": " + qe.kilde + "."; }
            var lre = levetidRef(d.id, lagPlads(b, kerne, i), { name_da: egen.materiale || b.materiale || b.navn || k.navn });
            if (lre) { p.service_life_ref = lre.ref; tal0.buildLevetid++; }
            var gre = transportGruppe(tekst(egen.materiale || b.materiale || egen.navn));
            if (gre) { var tre = { product_id: pid, group: gre }, mse = brugerMasse(egen, b.tykkelseMm); if (mse) { tre.mass_kg_per_unit = mse.kg; tre.mass_source = mse.kilde; } transport.push(tre); tal0.transport++; }
          } else {
            tal0.udenMiljoedata++;
            p.quantity_source = lagTekst + ": 1 " + ENHED_TEKST[kEnhed] + " pr. " + ENHED_TEKST[kEnhed] + " konstruktion (byggevaren har endnu intet datasæt; enheden følger datasættet, når det vælges).";
            // Levetiden findes allerede ud fra materialenavnet (BUILD), så byggevaren kun mangler sit datasæt (én årsag, én mangel).
            var lr0 = levetidRef(d.id, lagPlads(b, kerne, i), { name_da: b.materiale || b.navn || k.navn });
            if (lr0) { p.service_life_ref = lr0.ref; tal0.buildLevetid++; }
            if (b.opbygningMangler) noter.push({ id: pid, kode: "opbygning_mangler", tekst: "«" + k.navn + "» har ingen lagopbygning i Revit; byggevarerne kan ikke udledes. Tilføj lag i typen, eller opbyg den i ISSANA LCA." });
          }
          // Levetid, brugeren selv har angivet med kilde i LCA-panelet (fx BUILD-levetidstabellen); uden kilde bruges den ikke.
          var lv = valg.levetider && valg.levetider[pid], levetidValg = null;
          if (lv && erTal(lv.aar) && lv.aar > 0 && tekst(lv.kilde).trim()) {
            if (p.service_life_ref) { delete p.service_life_ref; tal0.buildLevetid--; }
            p.service_life_years = lv.aar; p.service_life_source = "Angivet i ISSANA 3D: " + tekst(lv.kilde).trim();
            levetidValg = { aar: lv.aar, kilde: tekst(lv.kilde).trim() };
          }
          // Mængde, brugeren selv har angivet i LCA-fanen: samlet mængde i datasættets enhed med kilde, fordelt på konstruktionens
          // mængde (Rust ganger igen). Uden kilde eller uden konstruktionsmængde bruges den ikke.
          var mo = valg.maengder && valg.maengder[pid], maengdeValg = null, envEnhed = raekke ? raekke.declared_unit : egen ? egen.enhed : null;
          if (mo && p.environmental_data_id) {
            var kq = constructions[constructions.length - 1].quantity;
            // En omregningsfaktor (LCA-fanens «Mængde og omregningsfaktor»): datasættets enhed pr. enhed konstruktion, med kilde
            // (formlen). Rust ganger med konstruktionens mængde, så faktoren følger modellen, når arealet ændres.
            if (erTal(mo.faktor) && mo.faktor >= 0 && tekst(mo.kilde).trim()) {
              if (p.amount == null) tal0.udenMaengde--;
              noter = noter.filter(function (n) { return !(n.id === pid && n.kode === "omregning_mangler"); });
              p.amount = mo.faktor; p.unit = envEnhed; p.conversion = null;
              p.quantity_source = "Angivet i ISSANA 3D: omregningsfaktor " + tal(mo.faktor) + " " + envEnhed + " pr. " + ENHED_TEKST[kEnhed] + " konstruktion (" + tekst(mo.kilde).trim() + ").";
              maengdeValg = { faktor: mo.faktor, enhed: envEnhed, kilde: tekst(mo.kilde).trim(), form: mo.form || null, felter: mo.felter || null };
            } else if (erTal(mo.maengde) && mo.maengde >= 0 && tekst(mo.kilde).trim() && erTal(kq) && kq > 0) {
              if (p.amount == null) tal0.udenMaengde--;
              noter = noter.filter(function (n) { return !(n.id === pid && n.kode === "omregning_mangler"); });
              p.amount = mo.maengde / kq; p.unit = envEnhed; p.conversion = null;
              p.quantity_source = "Angivet i ISSANA 3D: " + tal(mo.maengde) + " " + envEnhed + " i alt (" + tekst(mo.kilde).trim() + "), fordelt på konstruktionens " + tal(kq) + " " + ENHED_TEKST[kEnhed] + ".";
              maengdeValg = { maengde: mo.maengde, enhed: envEnhed, kilde: tekst(mo.kilde).trim() };
            } else noter.push({ id: pid, kode: "maengde_ikke_brugt", tekst: navn + ": den angivne mængde bruges ikke (" + (erTal(kq) && kq > 0 ? "angiv både mængde og kilde" : "konstruktionens mængde er ukendt") + ")." });
          }
          // Til LCA-fanens tabel: hvor byggevaren kommer fra i modellen (type og lag), og hvem der har valgt dens data.
          byggevarer[pid] = { typeId: k.typeId != null ? k.typeId : null, lag: b.id != null ? b.id : null, materiale: b.materiale || b.navn || null, funktion: b.funktion || null,
            tykkelseMm: erTal(b.tykkelseMm) ? b.tykkelseMm : null, konstruktionId: kid, delId: d.id, valg: valgKilde(v), post: v ? v.post : null,
            enhed: envEnhed, maengde: maengdeValg, levetid: levetidValg, kanAendres: k.typeId != null && b.id != null,
            massefaktor: raekke && erTal(raekke.mass_factor) && raekke.mass_factor > 0 ? { v: raekke.mass_factor, enhed: tekst(raekke.mass_unit) } : egen && erTal(egen.densitet) && egen.densitet > 0 ? { v: egen.densitet, enhed: "kg/m³" } : null };
          products.push(p); tal0.produkter++;
        });
      });
      kort[partId] = delIds;
    });

    var model = valg.model || {}, modelNavn = tekst(model.model || struktur.model) || "model";
    var refM2 = ref && erTal(ref.m2) ? ref.m2 : null;

    // B6: Be18-nøgletal (kWh/m²/år uden tillæg) × opvarmet areal × tabel 8.1. Uden dem giver Rust en mangel for B6.
    var b6 = valg.b6 || null, energi = [], forsyninger = null, opvarmet = 0;
    if (b6 && erTal(b6.opvarmetAreal) && b6.opvarmetAreal > 0) opvarmet = b6.opvarmetAreal; else if (b6 && refM2) opvarmet = refM2;
    var b6Klar = b6 && erTal(b6.varme) && b6.varme >= 0 && erTal(b6.el) && b6.el >= 0 && BAERER[b6.forsyning] && erTal(b6.ibrugtagning) && b6.ibrugtagning >= 2025 && tekst(b6.kilde).trim() && opvarmet > 0;
    if (b6Klar && !valg.tabel8) noter.push({ id: null, kode: "tabel8_mangler", tekst: "BR18 tabel 8 (data/br18-tabel-8-2025.js) er ikke indlæst; B6 kan ikke regnes." });
    if (b6Klar && valg.tabel8) {
      var kildeB6 = function (hvad, vaerdi) { return "Be18 (" + tekst(b6.kilde).trim() + "): " + hvad + " " + tal(vaerdi) + " kWh/m²/år uden tillæg × opvarmet etageareal " + tal(opvarmet) + " m²"; };
      var aar0 = Math.round(b6.ibrugtagning);
      var elSum = b6.forsyning === "electricity" ? b6.el + b6.varme : b6.el;
      var elPoster = energiPoster(valg.tabel8, "electricity", aar0, elSum * opvarmet, kildeB6(b6.forsyning === "electricity" ? "el til bygningsdrift og opvarmning" : "el til bygningsdrift", elSum), "b6-el");
      var varmePoster = b6.forsyning === "electricity" ? [] : energiPoster(valg.tabel8, b6.forsyning, aar0, b6.varme * opvarmet, kildeB6("varme", b6.varme), "b6-varme");
      if (elPoster && varmePoster) {
        energi = elPoster.concat(varmePoster);
        forsyninger = [{ id: "forsyning-el", carrier: "electricity", energy_source: "El fra nettet" + (b6.forsyning === "electricity" ? " (også til opvarmning)" : "") + " · angivet i ISSANA 3D", period_ids: elPoster.map(function (x) { return x.id; }), factor_basis: "table_8_1", commissioning_year: aar0 }];
        if (varmePoster.length) forsyninger.push({ id: "forsyning-varme", carrier: b6.forsyning, energy_source: BAERER[b6.forsyning] + " · angivet i ISSANA 3D", period_ids: varmePoster.map(function (x) { return x.id; }), factor_basis: "table_8_1", commissioning_year: aar0 });
      }
    }

    // Installationer efter standardværdimetoden (tabel 7), arealet = opvarmet etageareal (eller referencearealet).
    var installationer = null;
    if (brugInstallationer && brug && INSTALLATIONER[brug.id] && (opvarmet || refM2)) {
      var stdRaekker = tabel.installation_standards_not_for_material_editor || [];
      var linjer = INSTALLATIONER[brug.id].map(function (key) { return stdRaekker.filter(function (r) { return r.key === key; })[0]; }).filter(Boolean).map(function (r) {
        return { id: "installation-" + installationKategori(r.name_da), category: installationKategori(r.name_da), catalogue_id: katalogId(katalog.sha256), standard_key: r.key, name: r.name_da,
          area_share: 1, a1a3: r.a1a3, c3: r.c3, c4: r.c4, d: r.d, source: kildeTekst(tabel, r) };
      });
      if (linjer.length === 3) installationer = { area_m2: opvarmet || refM2, area_definition: "Samlet opvarmet etageareal jf. § 256, stk. 3, plus opvarmet kælderareal (BR18 bilag 2, tabel 7).",
        area_source: opvarmet ? "Opvarmet etageareal angivet i ISSANA 3D (B6)." : "ISSANA 3D: referencearealet bruges, indtil det opvarmede etageareal er angivet (B6).", lines: linjer };
    }

    // A4/A5: tabel 10-standardværdier for materialetransport og de faste satser; byggepladsens energi og affald fra panelet.
    var bp = valg.byggeplads || {}, pladsEnergi = [], affald = [], bpKilde = tekst(bp.kilde).trim() || "Angivet i ISSANA 3D";
    var bpAar = erTal(bp.aar) ? Math.round(bp.aar) : (b6 && erTal(b6.ibrugtagning) ? Math.round(b6.ibrugtagning) - 1 : null);
    if (erTal(bp.elKwh) && bp.elKwh > 0 && bpAar) pladsEnergi.push({ id: "el", label: "Byggepladsens el", carrier: "electricity", quantity: bp.elKwh, unit: "kWh", calendar_year: bpAar, source: bpKilde });
    if (erTal(bp.varmeKwh) && bp.varmeKwh > 0 && bpAar) pladsEnergi.push({ id: "varme", label: "Byggevarme (fjernvarme)", carrier: "district_heat", quantity: bp.varmeKwh, unit: "kWh", calendar_year: bpAar, source: bpKilde });
    if (erTal(bp.dieselLiter) && bp.dieselLiter > 0) pladsEnergi.push({ id: "diesel", label: "Maskiner (diesel)", carrier: "fuel", quantity: bp.dieselLiter, unit: "liter", fuel: "Diesel", source: bpKilde });
    (bp.affald || []).forEach(function (a, i) { if (a && AFFALDSFRAKTIONER.indexOf(a.fraktion) >= 0 && erTal(a.kg) && a.kg > 0) affald.push({ id: "affald-" + (i + 1), label: "Byggeaffald: " + a.fraktion, fraction: a.fraktion, mass_kg: a.kg, source: bpKilde }); });

    var projekt = {
      schema_version: SCHEMA_VERSION, kind: "issana_lca_project", id: valg.id || projektId(model.modelKey || modelNavn),
      name: valg.navn || ("ISSANA 3D · " + modelNavn), test_data: !!valg.testdata,
      building_use: brug ? brug.id : null, reference_area_m2: refM2, heated_area_m2: forsyninger ? opvarmet : 0, period_years: 50,
      source_lcabyg: null, catalogues: [katalogRef(katalog, tabel)],
      building_model: { parts: parts, constructions: constructions, products: products, environmental_data: miljoListe },
      installations: installationer, energy: forsyninger ? energi : [], b6_not_applicable_reason: null, process: null, migration: null
    };
    if (forsyninger) projekt.b6_supplies = forsyninger;
    if (valg.proces !== false) projekt.process_defaults = { table: PROCES_TABEL, material_transport: transport, equipment_transport_default: true,
      soil_removal_default: bp.jord !== false, waste_removal_default: true, site_energy: pladsEnergi, waste_treatment: affald };
    if (ref && ref.kilde) noter.push({ id: null, kode: "referenceareal_kilde", tekst: "Referenceareal " + tal(ref.m2) + " m²: " + ref.kilde });
    if (!forsyninger) noter.push({ id: null, kode: "b6_mangler", tekst: "B6: angiv Be18-nøgletallene (varme og el til bygningsdrift uden tillæg, kWh/m²/år), varmeforsyning, ibrugtagningsår og kilde under «Drift og byggeplads»." });
    if (tal0.buildLevetid) noter.push({ id: null, kode: "levetid_build", tekst: tal0.buildLevetid + " byggevarer har levetid fra BUILD levetidstabel 2021, bilag 4 (række efter bygningsdel og lagets plads, kolonne efter materialet). Ret den under «Angiv levetid» med kilde, hvis en anden levetid er dokumenteret." });
    noter.push({ id: null, kode: "kun_i_issana_lca", tekst: "Et andet datasæt, en egen EPD, mængde og levetid rettes pr. byggevare i LCA-fanens tabel («Ret»). Arealopgørelse, blandet anvendelse og særlige forhold registreres i det fulde ISSANA LCA-program («Åbn i ISSANA LCA»)." });
    return { klar: !mangler.length, projekt: projekt, mangler: mangler, noter: noter, kort: kort, tal: tal0, byggevarer: byggevarer, konstruktioner: konstruktioner };
  }

  /* ---------- Rusts svar til visning (ingen regning) ---------- */
  // Rusts tal uændret, ordnet til panelet og AI'en: total, moduler, bygningsdele og mangler med elementer.
  // rust: calculate-project-stdin's JSON; ud: bygProjekt's resultat (navne og kort).
  var MODULER = ["A1-A3", "B4", "B6", "C3", "C4", "A4", "A5", "D"];
  function oversigt(rust, ud) {
    rust = rust || {}; ud = ud || {};
    var navne = {}, kort = ud.kort || {}, bm = ud.projekt && ud.projekt.building_model || {};
    (bm.parts || []).concat(bm.constructions || [], bm.products || []).forEach(function (x) { navne[x.id] = x.name; });
    var totals = rust.totals || {}, mod = rust.modules_kgco2e || {}, model = rust.model || {};
    var mangler = (rust.missing_items || []).map(function (m) {
      return { tekst: m.message, kode: m.code || null, id: m.target_id || null, navn: m.target_id ? (navne[m.target_id] || m.target_id) : null, elementIds: m.target_id && kort[m.target_id] ? kort[m.target_id].slice() : [], proces: m.scope === "process" };
    });
    var lim = rust.limits || {}, bygningAfgjort = lim.building_numerical_check === true || lim.building_numerical_check === false;
    var procesMangel = mangler.filter(function (m) { return m.proces; })[0] || null;
    return {
      status: rust.status || null,
      // Bygningens grænse (§ 298 stk. 1) og byggeprocessens (stk. 5) afgøres hver for sig: en mangel, der kun angår A4/A5,
      // forhindrer ikke bygningens afgørelse (Rust: missing_items[].scope = process).
      statusTekst: rust.status === "calculated_draft" ? "beregnet (kladde uden mangler)" : rust.status === "incomplete" ? (bygningAfgjort ? "ufuldstændig: kun byggeprocessen (A4/A5) mangler data; bygningen er afgjort" : "ufuldstændig: der er mangler, ingen grænseafgørelse") : tekst(rust.status),
      total: erTal(totals.building_kgco2e_per_m2_year) ? totals.building_kgco2e_per_m2_year : null,
      materialer: erTal(totals.material_kgco2e_per_m2_year) ? totals.material_kgco2e_per_m2_year : null,
      b6: erTal(totals.b6_kgco2e_per_m2_year) ? totals.b6_kgco2e_per_m2_year : null,
      proces: {
        total: erTal(totals.process_kgco2e_per_m2_year) ? totals.process_kgco2e_per_m2_year : null,
        graense: erTal(lim.process_kgco2e_per_m2_year) ? lim.process_kgco2e_per_m2_year : null,
        overholdt: lim.process_numerical_check == null ? null : lim.process_numerical_check,
        grund: procesMangel && procesMangel.tekst || null,
        produktId: procesMangel && procesMangel.id || null
      },
      graense: rust.limits ? rust.limits.building_kgco2e_per_m2_year : null, overholdt: rust.limits ? rust.limits.building_numerical_check : null,
      moduler: MODULER.map(function (k) { return { modul: k, kg: erTal(mod[k]) ? mod[k] : null }; }),
      bygningsdele: (model.part_results || []).map(function (p) { return { id: p.id, navn: navne[p.id] || p.id, moduler: p.modules_kgco2e || {}, elementIds: (kort[p.id] || []).slice() }; }),
      mangler: mangler, advarsler: (rust.warnings || []).slice(), referenceareal: rust.reference_area_m2, tal: model.counts || null,
      // Hvor meget tallet dækker: et total over 0 af 68 byggevarer må aldrig ligne et resultat.
      daekning: model.counts ? { byggevarer: model.counts.products, regnet: model.counts.calculated_products,
        udenData: erTal(model.counts.products_without_environmental_data) ? model.counts.products_without_environmental_data : null,
        installationer: !!(rust.installation_result && rust.installation_result.lines && rust.installation_result.lines.length) } : null,
      grupper: grupperMangler(mangler),
      beregning: beregning(rust, ud)
    };
  }
  // «regnet: 6 af 68 byggevarer (+ installationer)» til fanen, bundlinjen og AI'en.
  function daekningTekst(o) {
    var d = o && o.daekning; if (!d) return "";
    return "regnet: " + d.regnet + " af " + d.byggevarer + " byggevarer" + (d.installationer ? " + installationer (standardværdier)" : "");
  }
  /* ---------- Mangler samlet efter type: én overskrift og én handling pr. type i stedet for hundredvis af linjer ---------- */
  // Rækkefølgen er den, brugeren løser dem i. «handling» er knappen i LCA-fanen (arbejdsrum-lca.js).
  var MANGEL_TYPER = [
    { id: "bekraeft", titel: "Forslag venter på din bekræftelse", handling: "bekraeft",
      hjaelp: "BR18 tabel 7-datasættene er foreslået ud fra materialenavnet. Tjek dem (Data-fanen viser hvert forslag), og bekræft dem; først da er de officielle.",
      test: function (m) { return /Bekræft posten som officiel/.test(m.tekst); } },
    { id: "miljoedata", titel: "Miljødata mangler", handling: "foreslaa",
      hjaelp: "Byggevarerne har intet datasæt. ISSANA foreslår et generisk BR18 tabel 7-datasæt pr. lag ud fra materialenavnet; du bekræfter bagefter. Levetid og A4 følger automatisk af datasættet.",
      test: function (m) { return /miljødata\/EPD mangler|Miljødata er hverken/.test(m.tekst); } },
    { id: "maengde", titel: "Mængde mangler", handling: "vaelg",
      hjaelp: "Konstruktionen har hverken areal eller volumen i modellen, eller enheden kan ikke omregnes. Vælg elementerne i 3D, og ret typen i Revit.",
      test: function (m) { return /mængde|projektmængde|omregning|enhed/i.test(m.tekst) && !/^A[45]\b/.test(m.tekst); } },
    { id: "levetid", titel: "Levetid mangler", handling: "levetid",
      hjaelp: "BUILD-levetidstabellen dækker ikke byggevaren. Angiv levetiden med kilde.",
      test: function (m) { return /levetid/i.test(m.tekst); } },
    { id: "b6", titel: "Driftsenergi (B6) mangler", handling: "udfyld",
      hjaelp: "Angiv Be18-nøgletallene (varme og el til bygningsdrift uden tillæg), varmeforsyning og ibrugtagningsår under «Drift og byggeplads».",
      test: function (m) { return /^B6\b/.test(m.tekst) || /^b6_/.test(tekst(m.kode)); } },
    { id: "proces", titel: "Byggeproces (A4/A5) mangler data", handling: "udfyld",
      hjaelp: "Byggepladsens energi og affald har ingen standardværdi i BR18. Angiv forbrug eller et dokumenteret skøn under «Drift og byggeplads». Det påvirker kun byggeprocessens grænse (1,5), ikke bygningens.",
      test: function (m) { return !!m.proces; } }
  ];
  function grupperMangler(mangler) {
    var grupper = MANGEL_TYPER.map(function (t) { return { id: t.id, titel: t.titel, hjaelp: t.hjaelp, handling: t.handling, mangler: [] }; });
    var oevrige = { id: "oevrige", titel: "Øvrige mangler", hjaelp: "Se teksten ved hver mangel.", handling: "vaelg", mangler: [] };
    (mangler || []).forEach(function (m) {
      for (var i = 0; i < MANGEL_TYPER.length; i++) if (MANGEL_TYPER[i].test(m)) { grupper[i].mangler.push(m); return; }
      oevrige.mangler.push(m);
    });
    return grupper.concat([oevrige]).filter(function (g) { return g.mangler.length; }).map(function (g) {
      var ids = {}; g.mangler.forEach(function (m) { m.elementIds.forEach(function (x) { ids[x] = 1; }); });
      g.antal = g.mangler.length; g.elementIds = Object.keys(ids).map(Number); return g;
    });
  }

  /* ---------- Sådan er tallet regnet: Rusts tal pr. bygningsdel → konstruktion → byggevare ---------- */
  // Ingen regning her: mængder, faktorer, udskiftninger og kg er Rusts (product_results, environment_results,
  // process_result.lines, part_results, totals). Panelet viser dem som en sporbar kæde.
  function beregning(rust, ud) {
    rust = rust || {}; ud = ud || {};
    var bm = ud.projekt && ud.projekt.building_model || {}, model = rust.model || {}, totals = rust.totals || {}, mod = rust.modules_kgco2e || {};
    var miljo = {}, faktorer = {}, a4 = {}, partR = {};
    (bm.environmental_data || []).forEach(function (e) { miljo[e.id] = e; });
    (model.environment_results || []).forEach(function (e) { faktorer[e.id] = e.factors || null; });
    (rust.process_result && rust.process_result.lines || []).forEach(function (l) { if (/^a4-/.test(l.id)) a4[l.id.slice(3)] = l.kgco2e; });
    (model.part_results || []).forEach(function (p) { partR[p.id] = p; });
    var prodR = {}; (model.product_results || []).forEach(function (p) { prodR[p.id] = p; });
    // Rusts mangler pr. byggevare (target_id), så tabellen kan vise dem i rækken. Byggevarens oprindelse i modellen: ud.byggevarer.
    var prodMangler = {}; (rust.missing_items || []).forEach(function (m) { if (m && m.target_id) (prodMangler[m.target_id] || (prodMangler[m.target_id] = [])).push(m.message); });
    var bvRef = ud.byggevarer || {};
    var dele = (bm.parts || []).map(function (d) {
      var pr = partR[d.id] || {};
      var kons = (bm.constructions || []).filter(function (k) { return k.part_id === d.id; }).map(function (k) {
        var bv = (bm.products || []).filter(function (p) { return p.construction_id === k.id; }).map(function (p) {
          var r = prodR[p.id] || {}, md = p.environmental_data_id ? miljo[p.environmental_data_id] : null, f = p.environmental_data_id ? faktorer[p.environmental_data_id] : null;
          // Uden Rust-svar (før første beregning): datasættets egen A1-A3-faktor fra projektet, så rækken viser, hvad der regnes med.
          var a1a3 = f ? f["A1-A3"] : md && md.modules && md.modules.a1a3 && erTal(md.modules.a1a3.value) && !rust.model ? md.modules.a1a3.value : null;
          return { id: p.id, navn: p.name, regnet: !!r.calculated, maengde: erTal(r.calc_quantity) ? r.calc_quantity : null, enhed: r.calc_unit || p.unit,
            datasaet: md ? { key: md.catalogue_key || md.dataset_id, navn: md.dataset_name || md.dataset_id, enhed: md.declared_unit, a1a3: a1a3, officiel: md.origin === "official_catalogue", egen: md.origin === "user_epd" } : null,
            levetid: erTal(r.service_life_years) ? r.service_life_years : null, levetidKilde: r.service_life_source || null, udskiftninger: erTal(r.replacements) ? r.replacements : null,
            moduler: r.modules_kgco2e || null, a4: erTal(a4[p.id]) ? a4[p.id] : null, status: r.environment_status || null,
            mangler: (prodMangler[p.id] || []).slice(), ref: bvRef[p.id] || null, maengdeKilde: p.quantity_source || null,
            // «CO₂e i alt» (kompakt visning): A1-A3 + B4 + C3 + C4 af Rusts moduler, samme sum som Rusts part_results.material_kgco2e.
            kg: r.modules_kgco2e ? ["A1-A3", "B4", "C3", "C4"].reduce(function (s, x) { return s + (erTal(r.modules_kgco2e[x]) ? r.modules_kgco2e[x] : 0); }, 0) : null,
            elementIds: (ud.kort && ud.kort[p.id] || []).slice() };
        });
        var ki = (ud.konstruktioner || {})[k.id] || {};
        return { id: k.id, navn: k.name, maengde: k.quantity, enhed: k.unit, byggevarer: bv, regnet: bv.filter(function (b) { return b.regnet; }).length,
          elementIds: (ud.kort && ud.kort[k.id] || []).slice(),
          underkategori: ki.underkategori || null, underkategoriAntaget: !!ki.antaget, typeId: ki.typeId != null ? ki.typeId : null, opbygning: ki.opbygning || null };
      });
      return { id: d.id, navn: d.name, kg: erTal(pr.material_kgco2e) ? pr.material_kgco2e : null, prM2: erTal(pr.material_kgco2e_per_m2_year) ? pr.material_kgco2e_per_m2_year : null,
        moduler: pr.modules_kgco2e || {}, konstruktioner: kons };
    });
    var matKg = ["A1-A3", "B4", "C3", "C4"].reduce(function (s, k) { return s + (erTal(mod[k]) ? mod[k] : 0); }, 0);
    var inst = rust.installation_result && rust.installation_result.modules_kgco2e;
    return { dele: dele, areal: rust.reference_area_m2 || null, opvarmet: ud.projekt ? ud.projekt.heated_area_m2 : null,
      materialer: { kg: matKg, rate: erTal(totals.material_kgco2e_per_m2_year) ? totals.material_kgco2e_per_m2_year : null },
      installationer: inst ? ["A1-A3", "C3", "C4"].reduce(function (s, k) { return s + (erTal(inst[k]) ? inst[k] : 0); }, 0) : null,
      // Tabel 7-linjerne (afløb, vand, varme/ventilation/køl) til LCA-fanens bygningsdele Afløb, Vand og Varme. Rusts tal uændret.
      installationLinjer: (rust.installation_result && rust.installation_result.lines || []).filter(function (l) { return l && l.included !== false; }).map(function (l) {
        var m = l.modules_kgco2e || {};
        return { id: l.id, kategori: l.category || null, navn: l.name, key: l.standard_key || null, moduler: m, areal: rust.installation_result.area_m2 || null,
          kg: ["A1-A3", "B4", "C3", "C4"].reduce(function (s, k) { return s + (erTal(m[k]) ? m[k] : 0); }, 0) };
      }),
      // A4/A5-linjerne (materialetransport, faste satser, byggeplads) til LCA-fanens «Spild og transport». Rusts tal uændret.
      procesLinjer: (rust.process_result && rust.process_result.lines || []).map(function (l) { return { id: l.id, modul: l.module || null, kategori: l.category || null, navn: l.label || l.id, kg: erTal(l.kgco2e) ? l.kgco2e : null, kilde: l.source || null }; }),
      b6: { kg: erTal(mod.B6) ? mod.B6 : null, rate: erTal(totals.b6_kgco2e_per_m2_year) ? totals.b6_kgco2e_per_m2_year : null },
      bygning: erTal(totals.building_kgco2e_per_m2_year) ? totals.building_kgco2e_per_m2_year : null,
      proces: { kg: erTal(totals.process_kgco2e) ? totals.process_kgco2e : null, rate: erTal(totals.process_kgco2e_per_m2_year) ? totals.process_kgco2e_per_m2_year : null, a4: mod.A4, a5: mod.A5 } };
  }

  // Kort tekst til AI-konteksten og -svaret: kun Rusts tal.
  function oversigtTekst(o) {
    if (!o) return "ISSANA LCA har ikke regnet endnu.";
    var t = "ISSANA LCA (Rust): " + (o.total != null ? tal(o.total) + " kg CO₂e/m²/år" : "intet total") + ", status " + o.statusTekst + (o.daekning ? " (" + daekningTekst(o) + ")" : "");
    if (o.graense != null) t += "; grænse " + tal(o.graense) + (o.overholdt === true ? " (overholdt)" : o.overholdt === false ? " (overskredet)" : " (ingen afgørelse)");
    if (o.proces && o.proces.total != null) t += "; byggeproces A4+A5 " + tal(o.proces.total) + " kg CO₂e/m²/år (grænse 1,5" + (o.proces.overholdt === true ? ", overholdt" : o.proces.overholdt === false ? ", overskredet" : ", ingen afgørelse") + ")";
    t += ". Moduler (kg CO₂e): " + o.moduler.map(function (m) { return m.modul + " " + (m.kg != null ? tal(m.kg) : "?"); }).join(", ") + ".";
    if (o.grupper && o.grupper.length) t += " Mangler: " + o.grupper.map(function (g) { return g.titel + " (" + g.antal + ")"; }).join(", ") + ".";
    else if (o.mangler.length) t += " " + o.mangler.length + " mangler, fx: " + o.mangler.slice(0, 3).map(function (m) { return m.tekst; }).join(" | ");
    return t;
  }

  return { SCHEMA_VERSION: SCHEMA_VERSION, BYGNINGSTYPER: BYGNINGSTYPER, MODULER: MODULER.slice(), katalogId: katalogId, katalogRef: katalogRef, kildeTekst: kildeTekst,
    findRaekke: findRaekke, miljoedata: miljoedata, produktMaengde: produktMaengde, forslagReferenceareal: forslagReferenceareal, projektId: projektId,
    bygProjekt: bygProjekt, oversigt: oversigt, oversigtTekst: oversigtTekst, enhedNoegle: enhedNoegle,
    LEVETID_TABEL: LEVETID_TABEL, BUILD_RAEKKER: BUILD_RAEKKER, BUILD_DELE: BUILD_DELE, buildKolonne: buildKolonne, levetidRef: levetidRef, lagPlads: lagPlads,
    PROCES_TABEL: PROCES_TABEL, transportGruppe: transportGruppe, AFFALDSFRAKTIONER: AFFALDSFRAKTIONER.slice(), INSTALLATIONER: INSTALLATIONER, energiPoster: energiPoster,
    produktMaengdeVolumen: produktMaengdeVolumen, grupperMangler: grupperMangler, beregning: beregning, daekningTekst: daekningTekst,
    BRUGER_EPD_ENHEDER: BRUGER_EPD_ENHEDER.slice(), erBrugerEpd: erBrugerEpd, brugerMiljoedata: brugerMiljoedata, brugerMaengde: brugerMaengde };
});
