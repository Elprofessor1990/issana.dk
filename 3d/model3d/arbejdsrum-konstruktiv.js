/* ISSANA 3D (3.0): panelet «Konstruktiv funktion» under Bygningsdele.
   Funktion-knapper (Bærende, Stabiliserende, Begge, Ingen af delene, Ikke angivet), «Fra Revit (Structural Usage)» med
   Bearing → Bærende, Shear → Stabiliserende, Combined → Begge og «Brug forslaget», de valgte elementer (navn, id, type,
   CCI eller «CCI mangler») og «Forhåndsvis ændring», der lægger valget i den eksisterende ændringsliste/forhåndsvisning.
   Først «Gem i Revit» skriver (issana_apply_plan). Værdilisten og Revit-mappingen kommer fra konstruktiv-vaerdier.json
   (konstruktiv-vaerdier.js i browseren), så listen kun rettes ét sted.

   Montering: window.issanaArbejdsrum.registrerPanel({id:'konstruktiv', titel:'Konstruktiv funktion', gruppe:'Bygningsdele',
   monter(container, api)}). Findes det ikke, bruges arbejdsrummets nuværende flade (IssanaArbejdsrum.fane) gennem broen i
   arbejdsrum-statik.js. Indlæses af arbejdsrum-statik.js. */
(function () {
  "use strict";
  function advar(t) { try { console.warn("ISSANA Konstruktiv funktion: " + t); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function flertal(n, en, flere) { return n + " " + (n === 1 ? en : flere); }

  var V = window.IssanaKonstruktivVaerdier || (window.IssanaStatik && window.IssanaStatik.VAERDIER);
  if (!V) { advar("konstruktiv-vaerdier.js er ikke indlæst; panelet monteres ikke."); return; }
  var PARAM = V.parameter, VAL = {}, KAT = {};
  V.vaerdier.forEach(function (v) { VAL[v.kode] = v; });
  V.kategorier.forEach(function (k) { KAT[k] = 1; });
  function revit2kode(s) { s = String(s == null ? "" : s).trim(); for (var k in VAL) if (VAL[k].revit === s) return k; return s === "" ? "ikke" : null; }
  function tekst(kode, revitVaerdi) { return VAL[kode] ? VAL[kode].statik : "«" + revitVaerdi + "» (ukendt værdi)"; }

  var bro = null, pending = "";   // pending: en kode, 'revit' eller ''

  function cci(el) { var i = el && el.issana; var t = bro.type(el); return (i && i.cciCode) || (t && t.issana && t.issana.cciCode) || ""; }

  function render(el) {
    var ids = bro.valgte(), dele = [], andre = 0;
    ids.forEach(function (id) { var e = bro.element(id); if (!e) return; if (KAT[e.category] && !e.erRum) dele.push(e); else andre++; });
    var h = '<div class="st-h3" style="margin-top:4px">Funktion</div><div class="st-grid">';
    ["baerende", "stab", "begge", "ingen", "ikke"].forEach(function (k, i) {
      h += '<button class="st-btn" data-fn="' + k + '" aria-pressed="' + (pending === k) + '"' + (i === 4 ? ' style="grid-column:span 2"' : "") + ">" + esc(k === "ikke" ? "Ikke angivet" : VAL[k].statik) + "</button>";
    });
    h += "</div>";
    h += '<p class="arb-hint">I Revit-parameteren «' + esc(PARAM) + '» skrives Bærende, Stabiliserende, Begge eller Ingen. «Bærende og stabiliserende» hedder Begge i Revit. Ikke angivet rydder værdien.</p>';

    // Fra Revit (Structural Usage), kun vægge har den
    var rv = {}, uden = 0;
    dele.forEach(function (e) { var u = e.revit && e.revit.konstruktiv; if (u && V.fraRevit[u]) rv[u] = (rv[u] || 0) + 1; else uden++; });
    var rvKeys = Object.keys(rv);
    if (dele.length) {
      h += '<div class="arb-aendr"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="font-size:12.5px">Fra Revit (Structural Usage)</b>' +
        '<button class="tbtn" id="kfRevit" aria-pressed="' + (pending === "revit") + '"' + (rvKeys.length ? "" : " disabled") + ">Brug forslaget</button></div>";
      rvKeys.forEach(function (u) { var k = V.fraRevit[u]; h += '<div class="st-row"><span class="st-dot" style="background:' + VAL[k].farve + '"></span><span style="flex:1">' + esc(u) + " → " + esc(VAL[k].revit) + '</span><span class="arb-n">' + rv[u] + "</span></div>"; });
      if (uden) h += '<div class="arb-n">' + flertal(uden, "element", "elementer") + " uden Structural Usage i Revit (kun vægge har den).</div>";
      h += "</div>";
    }

    // Valgte elementer
    h += '<div class="st-h3">Valgte elementer (' + dele.length + ")</div>";
    if (!dele.length) h += '<p class="arb-hint">Vælg vægge, gulve, tage, søjler eller bjælker i 3D. Hold Ctrl/Skift nede for at vælge flere.' + (andre ? " " + flertal(andre, "valgt element", "valgte elementer") + " er ikke en bygningsdel med konstruktiv funktion." : "") + "</p>";
    else {
      h += '<ul class="st-liste">';
      dele.slice(0, 40).forEach(function (e) {
        var nu = bro.nuvaerende(e.uniqueId, PARAM, e), nuK = revit2kode(nu), fra = (e.bygdata && e.bygdata.raw && e.bygdata.raw[PARAM]) != null ? e.bygdata.raw[PARAM] : (e.konstruktiv || "");
        var maal = maalFor(e), c = cci(e);
        h += '<li><div style="display:flex;gap:8px;align-items:flex-start"><span class="st-dot" title="' + esc(tekst(nuK, nu)) + '" style="margin-top:4px;background:' + (VAL[nuK] ? VAL[nuK].farve : "#F4F5F6") + '"></span><div style="flex:1;min-width:0">' +
          '<div style="font-weight:600">' + esc(e.name || e.type || "Element") + ' <span class="arb-n">[' + esc(e.id) + "]</span></div>" +
          '<div class="arb-n">' + esc(e.category) + " · " + esc(e.type || "") + (e.level ? " · " + esc(e.level) : "") + "</div>" +
          '<div style="font-size:12px;' + (c ? "" : "color:#8A1F17") + '">' + (c ? "CCI " + esc(c) : "CCI mangler") + "</div>" +
          '<div style="font-size:12px">Nu: ' + esc(tekst(revit2kode(fra), fra)) + (String(nu) !== String(fra) ? ' <span class="arb-kilde">i ændringslisten: ' + esc(tekst(nuK, nu)) + "</span>" : "") +
          (maal && maal !== nuK ? ' → <b>' + esc(tekst(maal, "")) + "</b>" : "") + "</div></div></div></li>";
      });
      if (dele.length > 40) h += "<li class=\"arb-n\">… og " + (dele.length - 40) + " til</li>";
      h += "</ul>";
      if (andre) h += '<div class="arb-n">' + flertal(andre, "valgt element", "valgte elementer") + " er ikke med (ikke væg, gulv, tag, søjle eller bjælke).</div>";
    }

    var aendringer = dele.filter(function (e) { var m = maalFor(e); return m != null && m !== revit2kode(bro.nuvaerende(e.uniqueId, PARAM, e)); });
    h += '<button class="tbtn primary st-primaer" id="kfVis"' + (aendringer.length ? "" : " disabled") + ">Forhåndsvis ændring" + (aendringer.length ? " (" + aendringer.length + ")" : "") + "</button>";
    h += '<p class="arb-hint">Ændringen lægges i ændringslisten med før/efter. Den vises med det samme i Lag og farver, men skrives først i Revit, når du trykker «Gem i Revit».</p>';
    el.innerHTML = h;

    el.querySelectorAll("[data-fn]").forEach(function (b) { b.onclick = function () { pending = pending === b.getAttribute("data-fn") ? "" : b.getAttribute("data-fn"); render(el); }; });
    var rb = el.querySelector("#kfRevit"); if (rb) rb.onclick = function () { pending = pending === "revit" ? "" : "revit"; render(el); };
    el.querySelector("#kfVis").onclick = function () {
      var n = 0;
      aendringer.forEach(function (e) {
        var k = maalFor(e), til = VAL[k].revit, fra = (e.bygdata && e.bygdata.raw && e.bygdata.raw[PARAM]) != null ? e.bygdata.raw[PARAM] : (e.konstruktiv || "");
        var ok = bro.tilfoej({ uniqueId: e.uniqueId, param: PARAM, fra: fra, til: til, navn: (e.name || e.type || "Element") + " (" + e.id + ")", obj: e, instans: true, hvad: [pending === "revit" ? "fra Revit (Structural Usage)" : "konstruktiv funktion"], kraeverOpsaetning: !(e.bygdata && e.bygdata.raw && e.bygdata.raw[PARAM] != null) });
        if (ok !== false) n++;
      });
      if (!n) { bro.fejl("Ingen ændringer kunne lægges i listen."); return; }
      pending = "";
      bro.info(n + " ændringer i listen. Se forhåndsvisningen, og gem i Revit.");
      bro.visAendringer(); render(el);
    };
  }
  // Den valgte funktion for et element: knappen, eller Revits Structural Usage ved «Brug forslaget»
  function maalFor(e) {
    if (!pending) return null;
    if (pending === "revit") { var u = e.revit && e.revit.konstruktiv; return u && V.fraRevit[u] ? V.fraRevit[u] : null; }
    return pending;
  }

  function monter(container, api) {
    var B = window.IssanaArbejdsrumStatik;
    bro = B ? B.lavBro(api) : null;
    if (!bro) { container.innerHTML = '<div class="arb-tom">arbejdsrum-statik.js (broen) er ikke indlæst.</div>'; advar("broen mangler"); return; }
    render(container);
    bro.paa("valg", function () { if (container.isConnected) render(container); });
    bro.paa("model", function () { pending = ""; if (container.isConnected) render(container); });
    return { opdater: function () { render(container); } };
  }
  window.issanaKonstruktivMonter = monter;

  var registreret = false;
  function registrer() {
    if (registreret) return true;
    var ny = window.issanaArbejdsrum;
    if (ny && typeof ny.registrerPanel === "function") { registreret = true; ny.registrerPanel({ id: "konstruktiv", titel: "Konstruktiv funktion", gruppe: "Bygningsdele", ikon: "M4 20V9l8-5 8 5v11M4 20h16M9 20v-6h6v6M12 4v5", hint: "Konstruktiv funktion for de valgte bygningsdele (Bærende, Stabiliserende, Begge, Ingen af delene)", monter: monter, vis: function (c) { if (bro) render(c); } }); return true; }
    if (ny && typeof ny.registrerFane === "function") { registreret = true; ny.registrerFane({ id: "konstruktiv", titel: "Konstruktiv funktion", monter: monter }); return true; }
    if (typeof document !== "undefined" && document.readyState && document.readyState !== "complete") return false;   // layoutet kan komme senere i html'en
    var A = window.IssanaArbejdsrum;
    if (A && typeof A.fane === "function") {
      registreret = true;
      var mon = false;
      A.fane({ id: "konstruktiv", titel: "Konstruktiv", valg: true, render: function (el) { if (!mon) { mon = true; monter(el, null); } else if (bro) render(el); } });
      return true;
    }
    return false;
  }
  if (!registrer()) {
    (window.issanaArbejdsrumVentende = window.issanaArbejdsrumVentende || []).push(function () { registrer(); });
    var forsoeg = 0, t = setInterval(function () { if (registrer() || ++forsoeg > 50) { clearInterval(t); if (forsoeg > 50) advar("hverken registrerPanel/registrerFane eller IssanaArbejdsrum.fane findes. Kald window.issanaKonstruktivMonter(container, api) selv."); } }, 200);
  }
})();
