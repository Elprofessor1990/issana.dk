/* ISSANA 3D: BR18 bilag 2 tabel 8 (2025) til browseren (B6 i LCA-fanen). Kilden er data/br18-tabel-8-2025.json ved siden af (med
   br18-tabel-8-2025.meta.json: URL, dato og SHA-256); denne fil er de samme data som script, fordi WebView2 ikke må hente JSON fra
   file://. tests/web-model3d/lca-projekt.test.mjs holder de to filer ens, og scripts/hent-lca-motor.ps1 skriver den ved en ny version.
   Ret aldrig tallene her. I browseren: window.ISSANA_BR18_TABEL8; i Node: module.exports. */
(function (root, data) {
  if (typeof module === "object" && module && module.exports) module.exports = data;
  else root.ISSANA_BR18_TABEL8 = data;
})(typeof globalThis !== "undefined" ? globalThis : this, {
  "schema_version": 1,
  "kind": "br18_2025_table_8_catalogue",
  "energy_source": {
    "url": "https://www.bygningsreglementet.dk/media/xoontk4a/tabel-81.xlsx",
    "file": "br18-tabel-8-1-2025.xlsx",
    "sha256": "517f44388d93e3569afa56eb60ae5490710e42d14c3926d93193f412bf7a80f9",
    "source_page": "https://www.bygningsreglementet.dk/historisk/version-18/bilag/b2/bilag_2/tabel_8/",
    "sheet": "Ark1"
  },
  "fuel_source": {
    "url": "https://www.bygningsreglementet.dk/media/2bphcenr/tabel-82-september-2025.xlsx",
    "file": "br18-tabel-8-2-2025.xlsx",
    "sha256": "049b31218ae0645a6cdf85bfebe8b1cf1724876e5fb653296161b7b7350c342f",
    "source_page": "https://www.bygningsreglementet.dk/historisk/version-18/bilag/b2/bilag_2/tabel_8/",
    "sheet": "Ark1"
  },
  "energy_years": [
    {
      "year": 2025,
      "through_end": false,
      "electricity": 0.0801,
      "district_heat": 0.0418,
      "gas": 0.151,
      "workbook_row": 5
    },
    {
      "year": 2026,
      "through_end": false,
      "electricity": 0.07058,
      "district_heat": 0.037059999999999996,
      "gas": 0.13194,
      "workbook_row": 6
    },
    {
      "year": 2027,
      "through_end": false,
      "electricity": 0.06106,
      "district_heat": 0.03232,
      "gas": 0.11288,
      "workbook_row": 7
    },
    {
      "year": 2028,
      "through_end": false,
      "electricity": 0.05154,
      "district_heat": 0.02758,
      "gas": 0.09382,
      "workbook_row": 8
    },
    {
      "year": 2029,
      "through_end": false,
      "electricity": 0.04202,
      "district_heat": 0.02284,
      "gas": 0.07476,
      "workbook_row": 9
    },
    {
      "year": 2030,
      "through_end": false,
      "electricity": 0.0325,
      "district_heat": 0.0181,
      "gas": 0.0557,
      "workbook_row": 10
    },
    {
      "year": 2031,
      "through_end": false,
      "electricity": 0.03182,
      "district_heat": 0.01728,
      "gas": 0.05564,
      "workbook_row": 11
    },
    {
      "year": 2032,
      "through_end": false,
      "electricity": 0.03114,
      "district_heat": 0.016460000000000002,
      "gas": 0.05558,
      "workbook_row": 12
    },
    {
      "year": 2033,
      "through_end": false,
      "electricity": 0.03046,
      "district_heat": 0.01564,
      "gas": 0.05552,
      "workbook_row": 13
    },
    {
      "year": 2034,
      "through_end": false,
      "electricity": 0.02978,
      "district_heat": 0.01482,
      "gas": 0.055459999999999995,
      "workbook_row": 14
    },
    {
      "year": 2035,
      "through_end": false,
      "electricity": 0.0291,
      "district_heat": 0.014,
      "gas": 0.0554,
      "workbook_row": 15
    },
    {
      "year": 2036,
      "through_end": false,
      "electricity": 0.028980000000000002,
      "district_heat": 0.01388,
      "gas": 0.0554,
      "workbook_row": 16
    },
    {
      "year": 2037,
      "through_end": false,
      "electricity": 0.02886,
      "district_heat": 0.01376,
      "gas": 0.0554,
      "workbook_row": 17
    },
    {
      "year": 2038,
      "through_end": false,
      "electricity": 0.02874,
      "district_heat": 0.013640000000000001,
      "gas": 0.0554,
      "workbook_row": 18
    },
    {
      "year": 2039,
      "through_end": false,
      "electricity": 0.02862,
      "district_heat": 0.01352,
      "gas": 0.0554,
      "workbook_row": 19
    },
    {
      "year": 2040,
      "through_end": false,
      "electricity": 0.0285,
      "district_heat": 0.0134,
      "gas": 0.0554,
      "workbook_row": 20
    },
    {
      "year": 2041,
      "through_end": false,
      "electricity": 0.02802,
      "district_heat": 0.01336,
      "gas": 0.05536,
      "workbook_row": 21
    },
    {
      "year": 2042,
      "through_end": false,
      "electricity": 0.027540000000000002,
      "district_heat": 0.01332,
      "gas": 0.05532,
      "workbook_row": 22
    },
    {
      "year": 2043,
      "through_end": false,
      "electricity": 0.02706,
      "district_heat": 0.01328,
      "gas": 0.055279999999999996,
      "workbook_row": 23
    },
    {
      "year": 2044,
      "through_end": false,
      "electricity": 0.026580000000000003,
      "district_heat": 0.01324,
      "gas": 0.05524,
      "workbook_row": 24
    },
    {
      "year": 2045,
      "through_end": false,
      "electricity": 0.0261,
      "district_heat": 0.0132,
      "gas": 0.0552,
      "workbook_row": 25
    },
    {
      "year": 2046,
      "through_end": false,
      "electricity": 0.025840000000000002,
      "district_heat": 0.0132,
      "gas": 0.05518,
      "workbook_row": 26
    },
    {
      "year": 2047,
      "through_end": false,
      "electricity": 0.025580000000000002,
      "district_heat": 0.0132,
      "gas": 0.05516,
      "workbook_row": 27
    },
    {
      "year": 2048,
      "through_end": false,
      "electricity": 0.02532,
      "district_heat": 0.0132,
      "gas": 0.05514,
      "workbook_row": 28
    },
    {
      "year": 2049,
      "through_end": false,
      "electricity": 0.02506,
      "district_heat": 0.0132,
      "gas": 0.05512,
      "workbook_row": 29
    },
    {
      "year": 2050,
      "through_end": true,
      "electricity": 0.0248,
      "district_heat": 0.0132,
      "gas": 0.0551,
      "workbook_row": 30
    }
  ],
  "fuels": [
    {
      "name": "Diesel",
      "kgco2e_per_kg": 4.13,
      "kgco2e_per_liter": 3.44,
      "workbook_row": 3
    },
    {
      "name": "Biodiesel (100% bio)",
      "kgco2e_per_kg": 1.27,
      "kgco2e_per_liter": 1.13,
      "workbook_row": 4
    },
    {
      "name": "HVO*/HEFA (SAF, 100% bio)",
      "kgco2e_per_kg": 1.26,
      "kgco2e_per_liter": 0.97,
      "workbook_row": 5
    },
    {
      "name": "LPG (Liquefied Petroleum Gas)",
      "kgco2e_per_kg": 4.11,
      "kgco2e_per_liter": 2.26,
      "workbook_row": 6
    },
    {
      "name": "Benzin",
      "kgco2e_per_kg": 4.21,
      "kgco2e_per_liter": 3.13,
      "workbook_row": 7
    },
    {
      "name": "Ethanol (100%)",
      "kgco2e_per_kg": 1.29,
      "kgco2e_per_liter": 1.01,
      "workbook_row": 8
    },
    {
      "name": "Flybrændstof",
      "kgco2e_per_kg": 4.02,
      "kgco2e_per_liter": 3.22,
      "workbook_row": 9
    },
    {
      "name": "Heavy Fuel Oil (HFO) (2.5% sulfur)",
      "kgco2e_per_kg": 3.86,
      "kgco2e_per_liter": 3.74,
      "workbook_row": 10
    },
    {
      "name": "Light Fuel Oil (LFO) (0.1% sulfur)",
      "kgco2e_per_kg": 4.06,
      "kgco2e_per_liter": 3.49,
      "workbook_row": 11
    },
    {
      "name": "Brint (fra fossilt gas)",
      "kgco2e_per_kg": 19.3,
      "kgco2e_per_liter": null,
      "workbook_row": 12
    },
    {
      "name": "LNG",
      "kgco2e_per_kg": 3.98,
      "kgco2e_per_liter": null,
      "workbook_row": 13
    },
    {
      "name": "CNG",
      "kgco2e_per_kg": 3.83,
      "kgco2e_per_liter": null,
      "workbook_row": 14
    },
    {
      "name": "Bio-CNG (100% bio)",
      "kgco2e_per_kg": 1.24,
      "kgco2e_per_liter": null,
      "workbook_row": 15
    },
    {
      "name": "Bio-LNG (100% bio)",
      "kgco2e_per_kg": 1.44,
      "kgco2e_per_liter": null,
      "workbook_row": 16
    },
    {
      "name": "LNG (Otto dual fuel ship, medium speed)",
      "kgco2e_per_kg": 4.82,
      "kgco2e_per_liter": null,
      "workbook_row": 17
    },
    {
      "name": "LNG (Otto dual fuel ship, slow speed)",
      "kgco2e_per_kg": 4.45,
      "kgco2e_per_liter": null,
      "workbook_row": 18
    }
  ],
  "note": "Year 2050 applies to later years. Values are kg CO2e/kWh or kg CO2e per indicated fuel unit."
});
