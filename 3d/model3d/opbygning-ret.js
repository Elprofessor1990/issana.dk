/* Ret en types lag i ISSANA 3D (ejer, 2026-11-14): tilføj, fjern, flyt, ret tykkelse, materiale og funktion, og sig, at et
   lag er et skelet (stolper med bredde og afstand). Ren logik uden DOM og uden Revit: listen med lag, kontrollen af den,
   forskellen fra Revits lag, det, der sendes til Revit (set_compound_structure), og kontrollen af det, Revit svarer.
   Lagene står som i Revit: yderst først for vægge, øverst først for dæk og tage. Skelettet findes ikke i Revits lag; det
   gemmes i typens ISSANA Data og følger laget efter dets nummer. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.IssanaOpbygningRet = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Revits lagfunktioner i den rækkefølge, de typisk står i en væg (udefra og ind).
  var FUNKTIONER = ["Finish1", "Substrate", "Insulation", "Membrane", "Structure", "StructuralDeck", "Finish2"];
  var TOL_MM = 0.1;                 // Revit regner i fod: en tykkelse er «den samme» inden for 0,1 mm
  var UDEN_MATERIALE = "";          // intet materiale på laget (Revits «By Category»)

  function tal(v) { var n = typeof v === "number" ? v : Number(String(v == null ? "" : v).replace(",", ".")); return isFinite(n) ? n : NaN; }
  function etLag(l) {
    l = l || {};
    var s = l.skelet && typeof l.skelet === "object" ? { bredde: tal(l.skelet.bredde), cc: tal(l.skelet.cc) } : null;
    return { material: l.material == null ? UDEN_MATERIALE : String(l.material), "function": l["function"] == null ? "" : String(l["function"]), widthMm: tal(l.widthMm), skelet: s };
  }
  /** En kopi af lagene, som kan rettes uden at røre modellens egne. skelet: [{lag, bredde, cc}] fra typens ISSANA Data. */
  function kopi(lag, skelet) {
    var ud = (Array.isArray(lag) ? lag : []).filter(Boolean).map(etLag);
    (Array.isArray(skelet) ? skelet : []).forEach(function (s) {
      var i = s ? Number(s.lag) - 1 : -1;
      if (i >= 0 && i < ud.length && tal(s.bredde) > 0 && tal(s.cc) > 0) ud[i].skelet = { bredde: tal(s.bredde), cc: tal(s.cc) };
    });
    return ud;
  }
  /** Et nyt lag: en indvendig plade på 13 mm, til brugeren vælger andet. */
  function nytLag(material) { return { material: material || UDEN_MATERIALE, "function": "Finish2", widthMm: 13, skelet: null }; }
  function indsaet(lag, i, l) { var ud = lag.slice(); ud.splice(Math.max(0, Math.min(ud.length, i)), 0, etLag(l || nytLag())); return ud; }
  function fjern(lag, i) { var ud = lag.slice(); if (i >= 0 && i < ud.length) ud.splice(i, 1); return ud; }
  /** Flytter et lag ét trin: retning -1 er udad (mod lag 1), +1 indad. */
  function flyt(lag, i, retning) {
    var j = i + (retning < 0 ? -1 : 1), ud = lag.slice();
    if (i < 0 || i >= ud.length || j < 0 || j >= ud.length) return ud;
    var t = ud[i]; ud[i] = ud[j]; ud[j] = t;
    return ud;
  }
  /** Sætter ét felt på ét lag. En membran har ingen tykkelse i Revit; skelet: {bredde, cc} eller null. */
  function saet(lag, i, felt, vaerdi) {
    var ud = lag.slice(); if (i < 0 || i >= ud.length) return ud;
    var l = etLag(ud[i]);
    if (felt === "widthMm") l.widthMm = tal(vaerdi);
    else if (felt === "material") l.material = vaerdi == null ? UDEN_MATERIALE : String(vaerdi);
    else if (felt === "function") { l["function"] = String(vaerdi || ""); if (l["function"] === "Membrane") l.widthMm = 0; }
    else if (felt === "skelet") l.skelet = vaerdi ? { bredde: tal(vaerdi.bredde), cc: tal(vaerdi.cc) } : null;
    ud[i] = l;
    return ud;
  }
  function samletMm(lag) { return (lag || []).reduce(function (s, l) { var n = tal(l && l.widthMm); return s + (n > 0 ? n : 0); }, 0); }

  /** Det, der skal rettes, før lagene kan sendes til Revit. Tom liste = i orden. */
  function fejl(lag) {
    var ud = [];
    if (!lag || !lag.length) return ["Der skal være mindst ét lag."];
    lag.forEach(function (l, i) {
      var nr = "Lag " + (i + 1) + ": ";
      if (FUNKTIONER.indexOf(l["function"]) < 0) ud.push(nr + "vælg en funktion.");
      if (l["function"] === "Membrane") { if (tal(l.widthMm) !== 0) ud.push(nr + "en membran har tykkelsen 0 i Revit."); }
      else if (!(tal(l.widthMm) > 0)) ud.push(nr + "tykkelsen skal være over 0 mm.");
      else if (tal(l.widthMm) > 5000) ud.push(nr + "tykkelsen er over 5 m.");
      if (l.skelet) {
        if (!(l.skelet.bredde > 0) || !(l.skelet.cc > 0)) ud.push(nr + "skelettet mangler bredde og afstand.");
        else if (l.skelet.bredde >= l.skelet.cc) ud.push(nr + "stolpernes afstand skal være større end deres bredde.");
        if (l["function"] === "Membrane") ud.push(nr + "en membran kan ikke være et skelet.");
      }
    });
    if (!lag.some(function (l) { return l["function"] !== "Membrane" && tal(l.widthMm) > 0; })) ud.push("Mindst ét lag skal have en tykkelse.");
    return ud;
  }

  function ensLag(a, b) {
    return a.material === b.material && a["function"] === b["function"] && Math.abs((tal(a.widthMm) || 0) - (tal(b.widthMm) || 0)) < TOL_MM;
  }
  function ensSkelet(a, b) {
    if (!a && !b) return true;
    return !!a && !!b && Math.abs(a.bredde - b.bredde) < TOL_MM && Math.abs(a.cc - b.cc) < TOL_MM;
  }
  /** Er Revits lag ændret (materiale, funktion, tykkelse, rækkefølge, antal)? Skelettet tæller ikke med her. */
  function lagAendret(foer, efter) {
    if (foer.length !== efter.length) return true;
    return foer.some(function (l, i) { return !ensLag(l, efter[i]); });
  }
  function skeletAendret(foer, efter) {
    var n = Math.max(foer.length, efter.length);
    for (var i = 0; i < n; i++) if (!ensSkelet(foer[i] && foer[i].skelet, efter[i] && efter[i].skelet)) return true;
    return false;
  }
  /** Kort tekst om ændringen: antal lag og samlet tykkelse før og efter. */
  function forskel(foer, efter) {
    var dele = [];
    if (foer.length !== efter.length) dele.push(foer.length + " lag → " + efter.length + " lag");
    else if (lagAendret(foer, efter)) dele.push(efter.filter(function (l, i) { return !ensLag(l, foer[i]); }).length + " lag ændret");
    var a = Math.round(samletMm(foer) * 10) / 10, b = Math.round(samletMm(efter) * 10) / 10;
    if (Math.abs(a - b) >= TOL_MM) dele.push("samlet tykkelse " + dk(a) + " → " + dk(b) + " mm");
    if (skeletAendret(foer, efter)) dele.push("skelet ændret");
    return dele.join(", ");
  }
  function dk(n) { return String(n).replace(".", ","); }

  /** Parametrene til Revit-kommandoen set_compound_structure. Med nytNavn kopieres typen først, så de andre elementer ikke ændres. */
  function tilRevit(typeId, lag, nytNavn) {
    var p = { typeId: Number(typeId), layers: lag.map(function (l) {
      var x = { "function": l["function"], widthMm: l["function"] === "Membrane" ? 0 : Math.round(tal(l.widthMm) * 100) / 100 };
      if (l.material) x.materialName = l.material;
      return x;
    }) };
    if (nytNavn && String(nytNavn).trim()) p.duplicateAsName = String(nytNavn).trim();
    return p;
  }
  /** Kommandoens svar, uanset om felterne står med stort eller lille (AIResult): {ok, besked, lag, typeId, typeNavn}. */
  function laesSvar(svar) {
    var s = svar || {}, r = s.Response || s.response || s.data || {};
    var ok = s.Success != null ? !!s.Success : s.success != null ? !!s.success : Array.isArray(r.layers);
    return { ok: ok, besked: s.Message || s.message || "", lag: Array.isArray(r.layers) ? r.layers : null, typeId: r.typeId != null ? r.typeId : null, typeNavn: r.typeName || "" };
  }
  /** Læs-tilbage-kontrollen: er det, Revit siger, at typen nu har, det samme som det, der blev sendt? */
  function sammenlign(sendt, svarLag) {
    var afv = [];
    if (!Array.isArray(svarLag)) return { ens: false, afvigelser: ["Revit svarede uden lagene, så de kan ikke kontrolleres."] };
    if (svarLag.length !== sendt.length) afv.push("Revit har " + svarLag.length + " lag, der blev sendt " + sendt.length + ".");
    sendt.forEach(function (l, i) {
      var r = svarLag[i]; if (!r) return;
      var nr = "Lag " + (i + 1) + ": ";
      if (String(r["function"] || "") !== l["function"]) afv.push(nr + "funktionen er «" + (r["function"] || "") + "», sendt «" + l["function"] + "».");
      if (Math.abs((tal(r.widthMm) || 0) - (l.widthMm || 0)) >= TOL_MM) afv.push(nr + "tykkelsen er " + dk(tal(r.widthMm)) + " mm, sendt " + dk(l.widthMm) + " mm.");
      var navn = r.material != null ? r.material : r.materialName;
      if (l.materialName && navn != null && String(navn) !== l.materialName) afv.push(nr + "materialet er «" + navn + "», sendt «" + l.materialName + "».");
    });
    return { ens: !afv.length, afvigelser: afv };
  }
  /** Skelettet til typens ISSANA Data: [{lag, materiale, bredde, cc}] for de lag, der er skelet. */
  function skeletData(lag) {
    var ud = [];
    (lag || []).forEach(function (l, i) { if (l.skelet && l.skelet.bredde > 0 && l.skelet.cc > 0) ud.push({ lag: i + 1, materiale: l.material || "", bredde: l.skelet.bredde, cc: l.skelet.cc }); });
    return ud;
  }
  /** Skelettets andel af laget (bredde ÷ afstand), som LCA og U-værdi bruger for gentagne lag. */
  function skeletAndel(s) { return s && s.cc > 0 && s.bredde > 0 ? Math.min(1, s.bredde / s.cc) : 0; }

  return { FUNKTIONER: FUNKTIONER.slice(), TOL_MM: TOL_MM, kopi: kopi, nytLag: nytLag, indsaet: indsaet, fjern: fjern, flyt: flyt, saet: saet, samletMm: samletMm,
    fejl: fejl, lagAendret: lagAendret, skeletAendret: skeletAendret, forskel: forskel, tilRevit: tilRevit, laesSvar: laesSvar, sammenlign: sammenlign,
    skeletData: skeletData, skeletAndel: skeletAndel };
});
