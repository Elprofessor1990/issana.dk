/* ISSANA 3D: værdilisten for «Konstruktiv funktion» til browseren.
   Kilden er konstruktiv-vaerdier.json ved siden af; denne fil er den samme liste som script, fordi WebView2 ikke må hente
   JSON fra file://. tests/web-model3d/statik.test.mjs holder de to filer ens. Ret altid JSON-filen først.
   I browseren: window.IssanaKonstruktivVaerdier; i Node: module.exports. */
(function (root, vaerdier) {
  if (typeof module === "object" && module && module.exports) module.exports = vaerdier;
  else root.IssanaKonstruktivVaerdier = vaerdier;
})(typeof globalThis !== "undefined" ? globalThis : this, {
  "parameter": "ISSANA Konstruktiv funktion",
  "beskrivelse": "Værdilisten og Revit-mappingen for «Konstruktiv funktion». Læses af statik.js, arbejdsrum-statik.js og arbejdsrum-konstruktiv.js (konstruktiv-vaerdier.js er en kopi til browseren; en test holder dem ens). Revit-navnene står også i plugin/Core/BygData/BygDataRules.cs (KonstruktivValues).",
  "vaerdier": [
    { "kode": "baerende", "revit": "Bærende", "statik": "Bærende", "baerer": true, "afstiver": false, "farve": "#3567A6" },
    { "kode": "stab", "revit": "Stabiliserende", "statik": "Stabiliserende", "baerer": false, "afstiver": true, "farve": "#E3923A" },
    { "kode": "begge", "revit": "Begge", "statik": "Bærende og stabiliserende", "baerer": true, "afstiver": true, "farve": "#3A2B6B" },
    { "kode": "ingen", "revit": "Ingen", "statik": "Ingen af delene", "baerer": false, "afstiver": false, "farve": "#B4BDC2" },
    { "kode": "ikke", "revit": "", "statik": "Ikke angivet", "baerer": null, "afstiver": null, "farve": "#F4F5F6" }
  ],
  "fraRevit": { "Bearing": "baerende", "Shear": "stab", "Combined": "begge", "NonBearing": "ingen" },
  "kategorier": ["Vægge", "Gulve", "Tage", "Søjler", "Bjælker"],
  "builtInCategories": ["OST_Walls", "OST_Floors", "OST_Roofs", "OST_Columns", "OST_StructuralColumns", "OST_StructuralFraming"]
});
