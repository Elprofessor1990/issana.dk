/* ISSANA 3D: LCAbygs bygningsdelskategorier og Revit-mappingen til browseren.
   Kilden er lca-bygningsdele.json ved siden af; denne fil er den samme liste som script, fordi WebView2 ikke må hente JSON
   fra file://. tests/web-model3d/ai-lca.test.mjs holder de to filer ens. Ret altid JSON-filen først.
   I browseren: window.IssanaLcaBygningsdele; i Node: module.exports. */
(function (root, data) {
  if (typeof module === "object" && module && module.exports) module.exports = data;
  else root.IssanaLcaBygningsdele = data;
})(typeof globalThis !== "undefined" ? globalThis : this, {
  "_om": [
    "LCAbygs 17 faste bygningsdele med deres underkategorier, og hvordan Revit-elementer i issana-3d-eksporten lander i dem (ai-lca.js: bygLcaStruktur).",
    "Bygningsdelene og underkategorierne har LCAbygs navne og rækkefølge (læst fra et LCAbyg-projekt: ElementSuperCategoryInstance og",
    "ElementCategoryInstance; samme 17 som ISSANA LCA's PART_CATEGORIES). Bygningsdelene er faste; under hver ligger underkategorierne, og under",
    "dem modellens konstruktioner (Revit-typer). Reglerne prøves oppefra; den første, der passer, vinder og giver bygningsdel og underkategori.",
    "En regel matcher på kategori (dansk kategori eller builtInCategory), funktion (element.revit.funktion: Exterior/Interior/Foundation/",
    "Retaining/Soffit/CoreShaft), 'laveste' (modellens laveste niveau), 'niveau' og 'navn' (regulære udtryk mod niveauets og typens navn,",
    "uden forskel på store og små bogstaver), 'baerende' (Revits Structural-afkrydsning eller StructuralUsage Bearing/Shear/Combined) og",
    "CCI-klassen (typens ISSANA CCI Code). 'antaget': underkategorien er ikke registreret i Revit, kun det sandsynlige valg; panelet siger det.",
    "Ret listen her; lca-bygningsdele.js er den samme liste som script til browseren (WebView2 må ikke hente JSON fra file://); en test holder",
    "de to filer ens. ISSANA LCA (22_ISSANA_LCA/prototype/core/lcabyg.rs) læser og skriver LCAbygs projektformat."
  ],
  "version": 2,
  "bygningsdele": [
    {
      "id": "afloeb",
      "navn": "Afløb",
      "underkategorier": [
        "Faldstammer",
        "Nedløb fra tag"
      ]
    },
    {
      "id": "altaner",
      "navn": "Altaner og altangange",
      "underkategorier": [
        "Altanbund",
        "Fastgørelse",
        "Rækværk"
      ]
    },
    {
      "id": "andet",
      "navn": "Andet",
      "underkategorier": [
        "Andet"
      ]
    },
    {
      "id": "daek",
      "navn": "Dæk",
      "underkategorier": [
        "Etagedæk",
        "Gulv",
        "Kælderdæk",
        "Loft"
      ]
    },
    {
      "id": "el_mek",
      "navn": "El- og mekaniske anlæg",
      "underkategorier": [
        "Andet (El- og mekaniske anlæg)",
        "Belysning",
        "El-anlæg",
        "Energiproduktion",
        "Transportanlæg"
      ]
    },
    {
      "id": "fundamenter",
      "navn": "Fundamenter",
      "underkategorier": [
        "Pladefundament",
        "Punktfundament",
        "Pælefundering",
        "Randfundamenter",
        "Spuns",
        "Stribefundamenter under bærende indervægge"
      ]
    },
    {
      "id": "indervaegge",
      "navn": "Indervægge",
      "underkategorier": [
        "Bærende indervægge",
        "Bærende indervægge i kælderen",
        "Ikke-bærende indervægge",
        "Ikke-bærende indervægge i kælderen"
      ]
    },
    {
      "id": "soejler_bjaelker",
      "navn": "Søjler og bjælker",
      "underkategorier": [
        "Andet (søjler og bjælker)",
        "Beklædning",
        "Bjælker",
        "Søjler"
      ]
    },
    {
      "id": "tage",
      "navn": "Tage",
      "underkategorier": [
        "Loft",
        "Tage"
      ]
    },
    {
      "id": "terraendaek",
      "navn": "Terrændæk",
      "underkategorier": [
        "Gulv",
        "Terrændæk"
      ]
    },
    {
      "id": "trapper",
      "navn": "Trapper og ramper",
      "underkategorier": [
        "Trapper og ramper"
      ]
    },
    {
      "id": "udendoers",
      "navn": "Udendørs areal",
      "underkategorier": [
        "Andet (udendørs areal)",
        "Belægninger",
        "Installationer over jord",
        "Installationer under jord",
        "Sekundær bebyggelse",
        "Terrænbefæstninger",
        "Udendørs belysning",
        "Udendørs inventar",
        "Udendørs trapper og ramper"
      ]
    },
    {
      "id": "vand",
      "navn": "Vand",
      "underkategorier": [
        "Vandrør",
        "Varmtvandsbeholder"
      ]
    },
    {
      "id": "varme",
      "navn": "Varme",
      "underkategorier": [
        "Andet (varme)",
        "Gulvvarme",
        "Radiatorer",
        "Varmeforsyningsanlæg",
        "Varmerør"
      ]
    },
    {
      "id": "ventilation",
      "navn": "Ventilation og køl",
      "underkategorier": [
        "Ventilationsanlæg",
        "Ventilationskanaler"
      ]
    },
    {
      "id": "vinduer_doere",
      "navn": "Vinduer, døre, glasfacader",
      "underkategorier": [
        "Døre",
        "Glasfacader",
        "Vinduer"
      ]
    },
    {
      "id": "ydervaegge",
      "navn": "Ydervægge",
      "underkategorier": [
        "Kælderydervægge",
        "Ydervægge"
      ]
    }
  ],
  "regler": [
    {
      "bygningsdel": "fundamenter",
      "underkategori": "Randfundamenter",
      "kategori": [
        "OST_StructuralFoundation",
        "Fundamenter",
        "Structural Foundations"
      ],
      "navn": [
        "wall foundation",
        "vægfundament",
        "stribefundament",
        "linjefundament",
        "randfundament",
        "\\bstrip\\b"
      ],
      "enhed": "m",
      "antaget": true
    },
    {
      "bygningsdel": "fundamenter",
      "underkategori": "Punktfundament",
      "kategori": [
        "OST_StructuralFoundation",
        "Fundamenter",
        "Structural Foundations"
      ],
      "navn": [
        "punkt",
        "isolated",
        "\\bpad\\b",
        "enkeltfundament",
        "\\bfooting\\b"
      ],
      "enhed": "stk"
    },
    {
      "bygningsdel": "fundamenter",
      "underkategori": "Pladefundament",
      "kategori": [
        "OST_StructuralFoundation",
        "Fundamenter",
        "Structural Foundations"
      ],
      "navn": [
        "plade",
        "\\bslab\\b",
        "\\braft\\b",
        "bundplade"
      ]
    },
    {
      "bygningsdel": "fundamenter",
      "underkategori": "Pælefundering",
      "kategori": [
        "OST_StructuralFoundation",
        "Fundamenter",
        "Structural Foundations"
      ],
      "navn": [
        "pæl",
        "\\bpile"
      ],
      "enhed": "stk"
    },
    {
      "bygningsdel": "fundamenter",
      "underkategori": "Spuns",
      "kategori": [
        "OST_StructuralFoundation",
        "Fundamenter",
        "Structural Foundations"
      ],
      "navn": [
        "spuns",
        "sheet pil"
      ]
    },
    {
      "bygningsdel": "fundamenter",
      "underkategori": "Randfundamenter",
      "kategori": [
        "OST_StructuralFoundation",
        "Fundamenter",
        "Structural Foundations"
      ],
      "antaget": true
    },
    {
      "bygningsdel": "fundamenter",
      "underkategori": "Randfundamenter",
      "kategori": [
        "OST_Walls",
        "Vægge",
        "Walls"
      ],
      "funktion": [
        "Foundation"
      ],
      "antaget": true
    },
    {
      "bygningsdel": "fundamenter",
      "underkategori": "Randfundamenter",
      "cci": [
        "[L]%BB"
      ],
      "antaget": true
    },
    {
      "bygningsdel": "altaner",
      "underkategori": "Altanbund",
      "kategori": [
        "OST_Floors",
        "Gulve",
        "Floors"
      ],
      "navn": [
        "altan",
        "balkon",
        "balcony"
      ]
    },
    {
      "bygningsdel": "altaner",
      "underkategori": "Rækværk",
      "kategori": [
        "OST_StairsRailing",
        "OST_Railings",
        "Rækværk",
        "Railings"
      ],
      "navn": [
        "altan",
        "balkon",
        "balcony"
      ]
    },
    {
      "bygningsdel": "altaner",
      "underkategori": "Altanbund",
      "cci": [
        "[L]%AG"
      ],
      "antaget": true
    },
    {
      "bygningsdel": "tage",
      "underkategori": "Tage",
      "kategori": [
        "OST_Roofs",
        "Tage",
        "Roofs"
      ]
    },
    {
      "bygningsdel": "tage",
      "underkategori": "Tage",
      "kategori": [
        "OST_Floors",
        "Gulve",
        "Floors"
      ],
      "navn": [
        "\\btag",
        "roof"
      ]
    },
    {
      "bygningsdel": "ydervaegge",
      "underkategori": "Kælderydervægge",
      "kategori": [
        "OST_Walls",
        "Vægge",
        "Walls"
      ],
      "funktion": [
        "Exterior",
        "Retaining"
      ],
      "niveau": [
        "kælder",
        "basement",
        "\\bkld\\b"
      ]
    },
    {
      "bygningsdel": "ydervaegge",
      "underkategori": "Ydervægge",
      "kategori": [
        "OST_Walls",
        "Vægge",
        "Walls"
      ],
      "funktion": [
        "Exterior",
        "Retaining"
      ]
    },
    {
      "bygningsdel": "ydervaegge",
      "underkategori": "Ydervægge",
      "kategori": [
        "OST_Walls",
        "Vægge",
        "Walls"
      ],
      "tag": [
        "facade"
      ]
    },
    {
      "bygningsdel": "indervaegge",
      "underkategori": "Bærende indervægge i kælderen",
      "kategori": [
        "OST_Walls",
        "Vægge",
        "Walls"
      ],
      "niveau": [
        "kælder",
        "basement",
        "\\bkld\\b"
      ],
      "baerende": true
    },
    {
      "bygningsdel": "indervaegge",
      "underkategori": "Ikke-bærende indervægge i kælderen",
      "kategori": [
        "OST_Walls",
        "Vægge",
        "Walls"
      ],
      "niveau": [
        "kælder",
        "basement",
        "\\bkld\\b"
      ],
      "antaget": true
    },
    {
      "bygningsdel": "indervaegge",
      "underkategori": "Bærende indervægge",
      "kategori": [
        "OST_Walls",
        "Vægge",
        "Walls"
      ],
      "baerende": true
    },
    {
      "bygningsdel": "indervaegge",
      "underkategori": "Ikke-bærende indervægge",
      "kategori": [
        "OST_Walls",
        "Vægge",
        "Walls"
      ],
      "antaget": true
    },
    {
      "bygningsdel": "terraendaek",
      "underkategori": "Gulv",
      "kategori": [
        "OST_Floors",
        "Gulve",
        "Floors"
      ],
      "laveste": true,
      "navn": [
        "gulv",
        "belægning",
        "finish"
      ]
    },
    {
      "bygningsdel": "terraendaek",
      "underkategori": "Terrændæk",
      "kategori": [
        "OST_Floors",
        "Gulve",
        "Floors"
      ],
      "laveste": true
    },
    {
      "bygningsdel": "daek",
      "underkategori": "Kælderdæk",
      "kategori": [
        "OST_Floors",
        "Gulve",
        "Floors"
      ],
      "niveau": [
        "kælder",
        "basement",
        "\\bkld\\b"
      ]
    },
    {
      "bygningsdel": "daek",
      "underkategori": "Kælderdæk",
      "kategori": [
        "OST_Floors",
        "Gulve",
        "Floors"
      ],
      "navn": [
        "kælder",
        "basement"
      ]
    },
    {
      "bygningsdel": "daek",
      "underkategori": "Gulv",
      "kategori": [
        "OST_Floors",
        "Gulve",
        "Floors"
      ],
      "navn": [
        "gulv",
        "belægning",
        "finish"
      ]
    },
    {
      "bygningsdel": "daek",
      "underkategori": "Etagedæk",
      "kategori": [
        "OST_Floors",
        "Gulve",
        "Floors"
      ]
    },
    {
      "bygningsdel": "daek",
      "underkategori": "Loft",
      "kategori": [
        "OST_Ceilings",
        "Lofter",
        "Ceilings"
      ]
    },
    {
      "bygningsdel": "vinduer_doere",
      "underkategori": "Vinduer",
      "kategori": [
        "OST_Windows",
        "Vinduer",
        "Windows"
      ]
    },
    {
      "bygningsdel": "vinduer_doere",
      "underkategori": "Døre",
      "kategori": [
        "OST_Doors",
        "Døre",
        "Doors"
      ]
    },
    {
      "bygningsdel": "vinduer_doere",
      "underkategori": "Glasfacader",
      "kategori": [
        "OST_CurtainWallPanels",
        "OST_CurtainWallMullions",
        "Curtain Panels",
        "Glasfacader"
      ]
    },
    {
      "bygningsdel": "trapper",
      "underkategori": "Trapper og ramper",
      "kategori": [
        "OST_Stairs",
        "Trapper",
        "Stairs",
        "OST_Ramps",
        "Ramper",
        "Ramps",
        "OST_StairsRailing",
        "OST_Railings",
        "Rækværk",
        "Railings"
      ]
    },
    {
      "bygningsdel": "soejler_bjaelker",
      "underkategori": "Søjler",
      "kategori": [
        "OST_StructuralColumns",
        "OST_Columns",
        "Søjler",
        "Structural Columns",
        "Columns"
      ],
      "enhed": "m"
    },
    {
      "bygningsdel": "soejler_bjaelker",
      "underkategori": "Bjælker",
      "kategori": [
        "OST_StructuralFraming",
        "Bjælker",
        "Structural Framing"
      ],
      "enhed": "m"
    },
    {
      "bygningsdel": "afloeb",
      "underkategori": "Nedløb fra tag",
      "kategori": [
        "OST_PipeCurves",
        "Rør",
        "Pipes"
      ],
      "navn": [
        "nedløb",
        "tagvand",
        "storm"
      ]
    },
    {
      "bygningsdel": "afloeb",
      "underkategori": "Faldstammer",
      "kategori": [
        "OST_PipeCurves",
        "Rør",
        "Pipes"
      ],
      "navn": [
        "afløb",
        "faldstamme",
        "spildevand",
        "kloak",
        "sanitary"
      ]
    },
    {
      "bygningsdel": "varme",
      "underkategori": "Varmerør",
      "kategori": [
        "OST_PipeCurves",
        "Rør",
        "Pipes"
      ],
      "navn": [
        "varme",
        "heating",
        "hydronic"
      ]
    },
    {
      "bygningsdel": "vand",
      "underkategori": "Vandrør",
      "kategori": [
        "OST_PipeCurves",
        "Rør",
        "Pipes"
      ],
      "antaget": true
    },
    {
      "bygningsdel": "vand",
      "underkategori": "Varmtvandsbeholder",
      "kategori": [
        "OST_PlumbingFixtures",
        "OST_MechanicalEquipment",
        "Plumbing Fixtures",
        "Mechanical Equipment"
      ],
      "navn": [
        "varmtvandsbeholder",
        "vvb",
        "water heater"
      ]
    },
    {
      "bygningsdel": "vand",
      "underkategori": "Vandrør",
      "kategori": [
        "OST_PlumbingFixtures",
        "Plumbing Fixtures"
      ],
      "antaget": true
    },
    {
      "bygningsdel": "ventilation",
      "underkategori": "Ventilationsanlæg",
      "kategori": [
        "OST_MechanicalEquipment",
        "Mechanical Equipment"
      ],
      "navn": [
        "ventil",
        "aggregat",
        "air handling",
        "\\bahu\\b"
      ]
    },
    {
      "bygningsdel": "varme",
      "underkategori": "Radiatorer",
      "kategori": [
        "OST_MechanicalEquipment",
        "Mechanical Equipment"
      ],
      "navn": [
        "radiator"
      ]
    },
    {
      "bygningsdel": "varme",
      "underkategori": "Gulvvarme",
      "kategori": [
        "OST_MechanicalEquipment",
        "Mechanical Equipment"
      ],
      "navn": [
        "gulvvarme",
        "underfloor"
      ]
    },
    {
      "bygningsdel": "varme",
      "underkategori": "Varmeforsyningsanlæg",
      "kategori": [
        "OST_MechanicalEquipment",
        "Mechanical Equipment"
      ],
      "antaget": true
    },
    {
      "bygningsdel": "ventilation",
      "underkategori": "Ventilationskanaler",
      "kategori": [
        "OST_DuctCurves",
        "OST_DuctFitting",
        "OST_DuctTerminal",
        "Kanaler",
        "Ducts",
        "Air Terminals"
      ]
    },
    {
      "bygningsdel": "el_mek",
      "underkategori": "Belysning",
      "kategori": [
        "OST_LightingFixtures",
        "Lighting Fixtures"
      ]
    },
    {
      "bygningsdel": "el_mek",
      "underkategori": "Energiproduktion",
      "kategori": [
        "OST_ElectricalEquipment",
        "OST_SpecialityEquipment",
        "Electrical Equipment"
      ],
      "navn": [
        "solcelle",
        "\\bpv\\b",
        "photovolta"
      ]
    },
    {
      "bygningsdel": "el_mek",
      "underkategori": "Transportanlæg",
      "kategori": [
        "OST_SpecialityEquipment",
        "OST_GenericModel",
        "Specialty Equipment"
      ],
      "navn": [
        "elevator",
        "\\blift\\b",
        "rulletrappe"
      ]
    },
    {
      "bygningsdel": "el_mek",
      "underkategori": "El-anlæg",
      "kategori": [
        "OST_ElectricalEquipment",
        "OST_ElectricalFixtures",
        "OST_CableTray",
        "OST_Conduit",
        "Electrical Equipment",
        "Electrical Fixtures"
      ]
    },
    {
      "bygningsdel": "udendoers",
      "underkategori": "Belægninger",
      "kategori": [
        "OST_Hardscape",
        "OST_Parking",
        "OST_Roads",
        "Hardscape",
        "Parking"
      ]
    },
    {
      "bygningsdel": "udendoers",
      "underkategori": "Terrænbefæstninger",
      "kategori": [
        "OST_Topography",
        "OST_Toposolid",
        "Topography",
        "Toposolid"
      ],
      "antaget": true
    },
    {
      "bygningsdel": "udendoers",
      "underkategori": "Udendørs inventar",
      "kategori": [
        "OST_Site",
        "Site"
      ],
      "antaget": true
    }
  ],
  "enheder": {
    "_om": "Mængdeenhed pr. byggevare-linje: et lag med tykkelse regnes i m³ (tykkelse × areal), et lag uden tykkelse og en type uden lag i m² (areal). En regel kan sætte konstruktionens enhed med «enhed»: m (løbende meter, som LCAbyg gør med fundamenter og bjælker) eller stk.",
    "lag": "m3",
    "udenLag": "m2"
  },
  "levetid": {
    "_om": "Standardlevetid (år) pr. bygningsdel, kun som udkast; LCAbygs tabel afgør. Tom = ikke sat.",
    "standard": null
  }
});
