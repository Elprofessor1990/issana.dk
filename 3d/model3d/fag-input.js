/* Valider før modeldata ændres. Tomt er ikke nul; fejl må ikke rydde brugerens felter. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.IssanaFagInput = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  function tal(input, valg) {
    valg = valg || {};
    var navn = valg.navn || "Værdien", tekst = input == null ? "" : String(input).trim();
    function fejl(besked) { return { ok: false, vaerdi: null, fejl: besked }; }
    if (tekst === "") return valg.valgfri ? { ok: true, vaerdi: null, fejl: null } : fejl(navn + " skal udfyldes.");
    // Entydigt dansk tusindtal med decimal-komma accepteres.
    if (/^[+-]?[1-9]\d{0,2}(?:\.\d{3})+,\d+$/.test(tekst)) tekst = tekst.replace(/\./g, "");
    // 1.200 kan betyde 1200 på dansk. Kræv et entydigt felt i stedet for at gætte.
    if (typeof input === "string" && (/^[+-]?[1-9]\d{0,2}(?:\.\d{3})+$/.test(tekst))) return fejl(navn + " er tvetydig med tusindpunktum. Skriv uden tusindtalsseparator (fx 1200) og brug komma til decimaler (fx 1,200).");
    if ((typeof input !== "string" && typeof input !== "number") || !/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(tekst)) return fejl(navn + " skal være et tal.");
    var v = Number(tekst.replace(",", "."));
    if (!isFinite(v)) return fejl(navn + " skal være et endeligt tal.");
    if (valg.heltal && !Number.isInteger(v)) return fejl("Skriv hele timer.");
    if (valg.positiv && v <= 0) return fejl(navn + " skal være større end 0.");
    if (valg.min != null && v < valg.min) return fejl(navn + " skal være mindst " + valg.min + ".");
    if (valg.max != null && v > valg.max) return fejl(navn + " må højst være " + valg.max + ".");
    return { ok: true, vaerdi: v, fejl: null };
  }
  function sommer(t27, t28) {
    // Standardårets 8760 hele timer. Ingen afrunding før kontrollen.
    var a = tal(t27, { navn: "Timer over 27 °C", min: 0, max: 8760, heltal: true });
    var b = tal(t28, { navn: "Timer over 28 °C", min: 0, max: 8760, heltal: true });
    if (!a.ok) return { ok: false, fejl: a.fejl, felt: "enRes27" };
    if (!b.ok) return { ok: false, fejl: b.fejl, felt: "enRes28" };
    if (b.vaerdi > a.vaerdi) return { ok: false, fejl: "Timer over 28 °C kan ikke overstige timer over 27 °C.", felt: "enRes28" };
    return { ok: true, t27: a.vaerdi, t28: b.vaerdi, fejl: null };
  }
  return { tal: tal, sommer: sommer };
});
