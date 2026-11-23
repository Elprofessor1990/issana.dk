/* ISSANA 3D: the price-determining properties, as ONE small list. The server gets a registry of the same properties;
   the keys here are the agreed ones, so this file can be replaced by that registry without touching the workspace.

   Shape: { key, label, values?, unit?, assumed?, parameters?, appliesTo }
   - values:     the common values offered in the list (the user may still type another one where it makes sense).
   - unit:       shown after the value.
   - assumed:    the default the price is calculated with while the value is missing; always shown as «antaget».
   - parameters: Revit parameter names the value is read from when the model file carries them.
   - appliesTo:  { categories, materials?, exclude? }. The viewer's Danish category must be in categories; with materials,
                 a layer material (or the type name) must also contain one of the words, and none of the exclude words. */
(function (root) {
  "use strict";

  var list = [
    {
      key: "concreteStrength",
      label: "Betonstyrke",
      values: ["C12", "C16", "C20", "C25", "C30", "C35", "C40", "C45"],
      assumed: "C25",
      parameters: ["Betonstyrke", "Styrkeklasse", "Concrete Strength"],
      appliesTo: {
        categories: ["Vægge", "Gulve", "Tage", "Søjler", "Bjælker", "Fundamenter", "Trapper"],
        materials: ["beton", "concrete"],
        exclude: ["letbeton", "porebeton", "gasbeton", "betonsten", "betontegl"]
      }
    },
    {
      key: "insulationLambdaClass",
      label: "Isoleringsklasse (lambda)",
      values: [31, 32, 34, 37],
      assumed: 37,
      parameters: ["Isoleringsklasse", "Lambdaklasse"],
      appliesTo: {
        categories: ["Vægge", "Gulve", "Tage", "Lofter", "Fundamenter"],
        materials: ["isolering", "isolation", "insulation", "mineraluld", "stenuld", "glasuld", "polystyren", "eps", "xps", "pir"]
      }
    },
    {
      key: "fireClass",
      label: "Brandklasse",
      values: ["EI2 30", "EI2 30-C", "EI2 60-C", "EI 30", "EI 60", "REI 60"],
      parameters: ["Brandklasse", "Fire Rating"],
      appliesTo: { categories: ["Døre"] }
    },
    {
      key: "soundClass",
      label: "Lydklasse",
      values: [30, 35, 40, 45, 50],
      unit: "dB",
      parameters: ["Lydklasse", "Acoustic Rating"],
      appliesTo: { categories: ["Døre"] }
    },
    {
      key: "uValue",
      label: "U-værdi",
      unit: "W/m²K",
      parameters: ["U-værdi", "Heat Transfer Coefficient (U)"],
      appliesTo: { categories: ["Vinduer"] }
    },
    {
      key: "gypsumLayers",
      label: "Antal gipslag",
      values: [1, 2, 3],
      assumed: 1,
      parameters: ["Antal gipslag"],
      appliesTo: { categories: ["Vægge", "Lofter"], materials: ["gips", "gypsum", "gyproc", "fermacell"] }
    }
  ];

  root.IssanaPrisEgenskaber = {
    list: list,
    byKey: function (key) { return list.filter(function (def) { return def.key === key; })[0] || null; }
  };
})(window);
