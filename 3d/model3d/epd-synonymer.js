/* ISSANA 3D: synonymlisten til epd-match.js i browseren. Kilden er epd-synonymer.json ved siden af; denne fil er den samme
   liste som script, fordi WebView2 ikke må hente JSON fra file://. tests/web-model3d/epd-match.test.mjs holder de to filer ens.
   Ret altid JSON-filen først. I browseren: window.IssanaEpdSynonymer; i Node: module.exports. */
(function (root, data) {
  if (typeof module === "object" && module && module.exports) module.exports = data;
  else root.IssanaEpdSynonymer = data;
})(typeof globalThis !== "undefined" ? globalThis : this, {
  "_om": [
    "Synonymliste til epd-match.js: et Revit-materialenavn (ofte engelsk: «Concrete Masonry Units», «Gypsum Wall Board», «Mineral Wool»)",
    "→ en materialegruppe → kandidater i BR18 bilag 2 tabel 7 (data/br18-tabel-7-2025.json). Reglerne prøves alle; den gruppe,",
    "hvis synonym dækker mest af navnet, vinder. 'navne' er ord/fraser (små bogstaver, dansk og engelsk) der matcher i materialenavnet;",
    "'datasaet' er de foretrukne tabel 7-id'er i prioriteret rækkefølge (det første er standardvalget); 'moenster' er et regex, der",
    "finder flere kandidater i tabel 7's name_da. 'ignorer': true = laget er ikke en byggevare (luft, hulrum).",
    "Ret listen her; epd-synonymer.js er den samme liste som script til browseren (en test holder dem ens)."
  ],
  "version": 1,
  "grupper": [
    { "id": "luft", "navn": "Luft/hulrum (ingen byggevare)", "navne": ["air", "luft", "hulrum", "cavity", "air gap", "air space", "void", "ventilated"], "ignorer": true },

    { "id": "beton", "navn": "Beton, pladsstøbt/fabriksbeton", "navne": ["beton", "concrete", "cast-in-place", "in-situ", "fabriksbeton", "c25/30", "c30/37", "c35/45", "jernbeton", "reinforced concrete", "betonelement", "precast", "slidlagsbeton", "slidlag", "insitu", "in situ"],
      "datasaet": ["#B1477", "#B1433", "#B1441", "#B1469"], "moenster": "^Fabriksbeton" },
    { "id": "betonblok", "navn": "Betonblokke/betonmursten (CMU)", "navne": ["concrete masonry", "cmu", "concrete block", "betonblok", "betonmursten", "blokke"], "datasaet": ["#G0330"], "moenster": "^Betonmursten" },
    { "id": "letbeton", "navn": "Letbeton", "navne": ["letbeton", "lightweight concrete", "letbetonelement"], "datasaet": ["#B1401", "#B1397", "#B1405"], "moenster": "^Letbeton" },
    { "id": "porebeton", "navn": "Porebeton (gasbeton)", "navne": ["porebeton", "gasbeton", "aerated", "aac", "ytong", "autoclaved"], "datasaet": ["#D1512", "#G0973"], "moenster": "^Porebeton" },
    { "id": "letklinker", "navn": "Letklinkerblokke (leca)", "navne": ["letklinker", "leca", "lightweight aggregate", "klinkerblok"], "datasaet": ["#B1358", "#B1362"], "moenster": "^Letklinker" },
    { "id": "kalksandsten", "navn": "Kalksandsten", "navne": ["kalksandsten", "calcium silicate", "sand-lime"], "datasaet": ["#D1511"] },

    { "id": "tegl", "navn": "Teglsten/murværk", "navne": ["tegl", "brick", "mursten", "murværk", "masonry", "facing brick", "clay brick", "skalmur"], "datasaet": ["#D1507", "#D1508", "#D1509"], "moenster": "^Teglsten" },
    { "id": "tagsten", "navn": "Tagsten", "navne": ["tagsten", "roof tile", "roofing tile", "tegltag", "betontagsten"], "datasaet": ["#D1497", "#D1500"], "moenster": "^Tagsten" },
    { "id": "moertel", "navn": "Mørtel/puds", "navne": ["mørtel", "mortar", "puds", "plaster", "render", "stucco", "cement plaster", "lime plaster", "spartel", "skim"], "datasaet": ["#D1575", "#D1573", "#D1580"], "moenster": "mørtel|puds" },

    { "id": "gips", "navn": "Gipsplader", "navne": ["gips", "gypsum", "gyproc", "plasterboard", "drywall", "wall board", "wallboard", "gipsplade", "fermacell", "fibergips"], "datasaet": ["#D1515", "#D1516", "#D1521", "#D1517"], "moenster": "^Gipsplade" },
    { "id": "fibercement", "navn": "Fibercementplader", "navne": ["fibercement", "fibre cement", "fiber cement", "eternit", "cembrit"], "datasaet": ["#D1514", "#D1505"], "moenster": "^Fibercement" },

    { "id": "mineraluld", "navn": "Mineraluld (sten-/glasuld)", "navne": ["mineraluld", "mineral wool", "stenuld", "stone wool", "rock wool", "rockwool", "glasuld", "glass wool", "glasswool", "isover", "batts", "murbatts", "isolering", "insulation", "insul"],
      "datasaet": ["#D1535", "#D1534", "#D1541", "#D1537"], "moenster": "^Mineraluld" },
    { "id": "eps", "navn": "EPS (ekspanderet polystyren)", "navne": ["eps", "expanded polystyrene", "polystyren", "polystyrene", "flamingo", "styropor", "sundolitt"], "datasaet": ["#D1557", "#D1556", "#D1560"], "moenster": "^EPS isolering" },
    { "id": "xps", "navn": "XPS (ekstruderet polystyren)", "navne": ["xps", "extruded polystyrene", "styrodur"], "datasaet": ["#D1565"], "moenster": "^XPS" },
    { "id": "pir", "navn": "PIR/PUR-isolering", "navne": ["pir", "pur", "polyurethan", "polyurethane", "polyisocyanurat", "kingspan"], "datasaet": ["#D1566"], "moenster": "^PIR" },
    { "id": "traefiberisolering", "navn": "Træfiberisolering", "navne": ["træfiberisolering", "wood fibre insulation", "wood fiber insulation", "hunton", "steico"], "datasaet": ["#D1627", "#D1626", "#D1628"], "moenster": "^Træfiberisolering" },
    { "id": "papiruld", "navn": "Papiruld/celluloseisolering", "navne": ["papiruld", "cellulose", "celluloseisolering"], "datasaet": ["#D1623"] },

    { "id": "trae", "navn": "Konstruktionstræ", "navne": ["træ", "wood", "timber", "lumber", "softwood", "fyr", "gran", "pine", "spruce", "konstruktionstræ", "lægte", "lægter", "batten", "stud", "reglar", "skelet", "framing"],
      "datasaet": ["#B1370", "#B1489", "#B1325"], "moenster": "^Konstruktionstræ" },
    { "id": "clt", "navn": "Krydslamineret træ (CLT)", "navne": ["clt", "cross laminated", "krydslamineret", "massivtræ", "mass timber"], "datasaet": ["#B1318"] },
    { "id": "limtrae", "navn": "Limtræ", "navne": ["limtræ", "glulam", "glued laminated", "lvl", "kerto"], "datasaet": ["#B1339"] },
    { "id": "krydsfiner", "navn": "Krydsfiner/OSB/spånplade", "navne": ["krydsfiner", "plywood", "osb", "spånplade", "chipboard", "particle board", "particleboard", "mdf", "sheathing"], "datasaet": ["#B1496", "#G0701", "#G0457"], "moenster": "^Krydsfiner|^Spånplade" },

    { "id": "staal", "navn": "Konstruktionsstål", "navne": ["stål", "steel", "metal stud", "metal", "structural steel", "hea", "heb", "ipe", "profil", "profile", "galvani"], "datasaet": ["#D1591", "#D1594", "#D1595"], "moenster": "^Konstruktionsstål|^Lette stålprofiler|^Stål, plade" },
    { "id": "armering", "navn": "Armeringsstål", "navne": ["armering", "rebar", "reinforcement", "reinforcing", "armeringsnet", "mesh"], "datasaet": ["#D1590"] },
    { "id": "aluminium", "navn": "Aluminium", "navne": ["aluminium", "aluminum", "alu"], "datasaet": ["#G0452", "#G0333"], "moenster": "^Aluminiumsplade|^Aluminiumsprofil" },
    { "id": "zink", "navn": "Zink", "navne": ["zink", "zinc", "rheinzink"], "datasaet": ["#G0015"] },

    { "id": "glas", "navn": "Glas (rude, glasvæg)", "navne": ["glas", "glass", "glazing", "rude", "glazed"], "datasaet": ["#D1527", "#D1528"], "moenster": "^Glasvægge" },
    { "id": "vindue", "navn": "Vinduer (hele elementet)", "navne": ["vindue", "window", "vinduer", "windows", "oplukkelig", "fastkarm"], "datasaet": ["#D1635", "#D1634", "#D1632"], "moenster": "vindue med 3-lags rude" },
    { "id": "glasfacade", "navn": "Glasfacade/curtain wall", "navne": ["curtain wall", "glasfacade", "facadesystem", "curtain panel"], "datasaet": ["#G0111", "#G0523"], "moenster": "^Curtain wall" },

    { "id": "tagpap", "navn": "Tagpap/bitumen", "navne": ["tagpap", "roofing felt", "bitumen", "asphalt roofing", "membrane roofing", "icopal"], "datasaet": ["#D1501", "#D1502", "#D1503"], "moenster": "^Tagpap" },
    { "id": "dampspaerre", "navn": "Dampspærre/folie", "navne": ["dampspærre", "vapour barrier", "vapor barrier", "vapour retarder", "vapor retarder", "retarder", "pe-folie", "pe folie", "polyethylene", "membrane", "membran", "folie", "foil", "radonspærre", "radon barrier", "radonmembran"], "datasaet": ["#D1504", "#G0519"] },
    { "id": "undertag", "navn": "Undertag", "navne": ["undertag", "underlay", "underlayment", "roofing underlay"], "datasaet": ["#D1506"] },
    { "id": "vindspaerre", "navn": "Vindspærre", "navne": ["vindspærre", "wind barrier", "windbreak", "weather barrier"], "datasaet": ["#D1520", "#D1531"] },

    { "id": "fliser", "navn": "Keramiske fliser/klinker", "navne": ["flise", "fliser", "klinke", "klinker", "tile", "tiles", "ceramic", "porcelain", "keramik"], "datasaet": ["#G0340"], "moenster": "^Keramikfliser" },
    { "id": "vinyl", "navn": "Vinyl/linoleum", "navne": ["vinyl", "linoleum", "pvc floor", "resilient"], "datasaet": ["#D1602"] },
    { "id": "taeppe", "navn": "Tæppe", "navne": ["tæppe", "carpet", "gulvtæppe"], "datasaet": ["#G0008"] },
    { "id": "natursten", "navn": "Natursten", "navne": ["natursten", "natural stone", "granit", "granite", "marmor", "marble", "skifer", "slate", "stone"], "datasaet": ["#G0617"] },
    { "id": "sand_grus", "navn": "Sand/grus/kapillarbrydende lag", "navne": ["sand", "grus", "gravel", "aggregate", "crushed", "singels", "kapillarbrydende", "stabilgrus"], "datasaet": ["#G0321", "#G0158", "#D1624"] },
    { "id": "asfalt", "navn": "Asfalt", "navne": ["asfalt", "asphalt"], "datasaet": ["#G0731", "#G0558"] },
    { "id": "kork", "navn": "Kork", "navne": ["kork", "cork"], "datasaet": ["#G0366", "#D1621"] }
  ]
});
