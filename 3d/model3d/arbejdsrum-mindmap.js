/* ISSANA 3D (3.0): mindmappet, modellens struktur som et træ ved siden af 3D.

   Gruppering Etage: Model → etage → rum → «Vægge (n)» / «Dæk (n)» / «Vinduer (n)» … (rummets grænser og de
   åbninger, der hører til rummet) og «Uden rum (n)» for det, der ikke afgrænser et rum.
   Gruppering Type: Model → kategori → type → antal pr. etage. Gruppering Familie: Model → kategori → Revit-familie
   → typer i hele modellen.
   «+» føjer til valget. Klik på et blad vælger (Skift føjer til). Første klik på et rum, en type eller en familie
   vælger alt af den og folder den ud; næste klik folder den sammen. Kategoriknuder folder kun.
   Isolering (handling()): klik på et rum isolerer rummets elementer i 3D og viser «Valgte»; klik på en etage isolerer
   etagen; Model-noden eller «Vis alle» viser alt igen. Dobbeltklik zoomer til knuden (dobbelt()).

   Den rene logik (træ, rækker, klik, søgning) ligger på window.IssanaArbejdsrumMindmap (module.exports i Node)
   og testes i tests/web-model3d/arbejdsrum-mindmap.test.mjs. tegn(container, resultat, handlers) er den eneste
   DOM-del. Indlæses før arbejdsrum-layout.js, som ejer panelet. */
(function (fabrik) {
  "use strict";
  var api = fabrik();
  if (typeof module === "object" && module && module.exports) { module.exports = api; return; }
  if (typeof window !== "undefined") window.IssanaArbejdsrumMindmap = api;
})(function () {
  "use strict";

  /* ---------- Faste værdier ---------- */
  var GRUPPERINGER = [{id: "etage", titel: "Etage"}, {id: "type", titel: "Type"}, {id: "familie", titel: "Familie"}];
  var KAT_ORDEN = ["Vægge", "Gulve", "Tage", "Lofter", "Søjler", "Bjælker", "Trapper", "Vinduer", "Døre"];
  var KAT_ETIKET = {"Gulve": "Dæk"};
  var UDEN_ETAGE = "(uden etage)", UDEN_RUM = "Uden rum", UDEN_FAMILIE = "(uden familie)", UDEN_TYPE = "(uden type)";
  // Kolonner (px) pr. gruppering: x og bredde for niveau 0..3. Panelet ruller vandret, hvis der ikke er plads.
  var KOLONNER = {
    etage: {x: [4, 72, 160, 278], b: [60, 80, 110, 124]},
    type: {x: [4, 72, 160, 290], b: [60, 80, 122, 124]},
    familie: {x: [4, 72, 160, 290], b: [60, 80, 122, 124]}
  };
  var RAEKKE = 40, TOP = 8, HOEJDE = 32, PLUS = 26;

  /* ---------- Små hjælpere ---------- */
  function sorterEtager(navne) {
    return navne.slice().sort(function (a, b) {
      if (a === UDEN_ETAGE) return 1; if (b === UDEN_ETAGE) return -1;
      return String(a).localeCompare(String(b), "da", {numeric: true});
    });
  }
  function sorterKategorier(navne) {
    return navne.slice().sort(function (a, b) {
      var ia = KAT_ORDEN.indexOf(a), ib = KAT_ORDEN.indexOf(b);
      if (ia < 0) ia = 99; if (ib < 0) ib = 99;
      return ia - ib || String(a).localeCompare(String(b), "da");
    });
  }
  function sorterNavne(navne) { return navne.slice().sort(function (a, b) { return String(a).localeCompare(String(b), "da", {numeric: true}); }); }
  function tilSet(x) { if (x instanceof Set) return x; var s = new Set(); (x || []).forEach(function (v) { s.add(v); }); return s; }
  function unik(a) { var set = {}, r = []; a.forEach(function (v) { if (!set[v]) { set[v] = 1; r.push(v); } }); return r; }
  function katEtiket(k) { return KAT_ETIKET[k] || k; }

  /* ---------- Fra modellen til mindmappets punkter ----------
     eds: visningens elementer (ed-objekter i rækkefølge; rum er med som erRum, som arbejdsrum.js lægger dem ind).
     typer: data.types som opslag (id → type), bruges til CCI-koden på typen. */
  function fraElementer(eds, typer) {
    typer = typer || {};
    return (eds || []).map(function (ed, idx) {
      ed = ed || {};
      var t = ed.typeId != null ? typer[String(ed.typeId)] : null;
      return {
        idx: idx, id: ed.id, uniqueId: ed.uniqueId, erRum: !!ed.erRum,
        kategori: ed.erRum ? "Rum" : (ed.category || "Andet"),
        type: ed.type || ed.name || UDEN_TYPE, familie: ed.family || (t && t.family) || UDEN_FAMILIE,
        etage: ed.level || UDEN_ETAGE, navn: ed.name || ed.type || "",
        graenser: (ed.graenser || []).map(function (g) { return {id: g.id, side: g.side}; }),
        rum: (ed.rum || []).slice(),
        cci: (ed.issana && ed.issana.cciCode) || (t && t.issana && t.issana.cciCode) || ""
      };
    });
  }
  // Samme omskrivning af rummene som arbejdsrum.js' forIndlaes (kun felterne mindmappet bruger), til test uden browser.
  function rumSomElementer(data) {
    var r = (data.elements || []).slice();
    (data.rooms || []).forEach(function (x) {
      r.push({id: x.id, uniqueId: x.uniqueId, category: "Rum", name: ((x.number ? x.number + " " : "") + (x.name || "")).trim(), level: x.level, graenser: x.graenser || [], erRum: true});
    });
    return r;
  }

  /* ---------- Træet ---------- */
  function knude(key, niveau, etiket, ids, ekstra) {
    var n = {key: key, niveau: niveau, etiket: etiket, ids: ids, boern: [], blad: false, kanFoldes: !!key && niveau > 0};
    if (ekstra) Object.keys(ekstra).forEach(function (k) { n[k] = ekstra[k]; });
    return n;
  }
  function blad(etiket, ids, ekstra) { var n = knude(null, 3, etiket, ids, ekstra); n.blad = true; n.kanFoldes = false; return n; }
  function idsAf(liste) { return liste.map(function (i) { return i.idx; }); }
  function bladePrKategori(liste, niveau) {
    var pr = {}; liste.forEach(function (i) { (pr[i.kategori] || (pr[i.kategori] = [])).push(i); });
    return sorterKategorier(Object.keys(pr)).map(function (k) { var b = blad(katEtiket(k) + " (" + pr[k].length + ")", idsAf(pr[k]), {kategori: k}); if (niveau != null) b.niveau = niveau; return b; });
  }

  // Rummets medlemmer: bygningsdele i grænserne (efter Revit-id) og åbninger, hvis rum-liste nævner rummet.
  function rumMedlemmer(rum, dele, prId) {
    var set = {}, r = [];
    rum.graenser.forEach(function (g) { var it = prId[g.id]; if (it && !set[it.idx]) { set[it.idx] = 1; r.push(it); } });
    dele.forEach(function (it) { if (it.rum && it.rum.indexOf(rum.id) >= 0 && !set[it.idx]) { set[it.idx] = 1; r.push(it); } });
    return r;
  }

  function bygEtage(dele, rum, aaben) {
    var prId = {}; dele.forEach(function (it) { if (it.id != null) prId[it.id] = it; });
    var rod = knude("model", 0, "Model", idsAf(dele));
    var etager = sorterEtager(unik(dele.map(function (i) { return i.etage; })));
    etager.forEach(function (e) {
      var paaEtage = dele.filter(function (i) { return i.etage === e; });
      var en = knude("etage:" + e, 1, e, idsAf(paaEtage));
      rod.boern.push(en);
      if (!aaben(en.key)) return;
      var iRum = {};
      rum.filter(function (r) { return r.etage === e; }).forEach(function (r) {
        var medl = rumMedlemmer(r, dele, prId);
        if (!medl.length) return;
        medl.forEach(function (it) { iRum[it.idx] = 1; });
        var rn = knude("rum:" + r.idx, 2, r.navn || "Rum", idsAf(medl), {rumIdx: r.idx});
        en.boern.push(rn);
        if (aaben(rn.key)) rn.boern = bladePrKategori(medl, 3);
      });
      var rest = paaEtage.filter(function (it) { return !iRum[it.idx]; });
      if (rest.length) {
        var rk = knude("rest:" + e, 2, UDEN_RUM, idsAf(rest));
        en.boern.push(rk);
        if (aaben(rk.key)) rk.boern = bladePrKategori(rest, 3);
      }
    });
    return rod;
  }

  function bygTypeEllerFamilie(dele, aaben, gruppering) {
    var rod = knude("model", 0, "Model", idsAf(dele));
    var prKat = {}; dele.forEach(function (i) { (prKat[i.kategori] || (prKat[i.kategori] = [])).push(i); });
    sorterKategorier(Object.keys(prKat)).forEach(function (k) {
      var kn = knude("kat:" + k, 1, k, idsAf(prKat[k]));
      rod.boern.push(kn);
      if (!aaben(kn.key)) return;
      if (gruppering === "type") {
        var prType = {}; prKat[k].forEach(function (i) { (prType[i.type] || (prType[i.type] = [])).push(i); });
        sorterNavne(Object.keys(prType)).forEach(function (t) {
          var tn = knude("type:" + k + "|" + t, 2, t, idsAf(prType[t]), {antal: prType[t].length});
          kn.boern.push(tn);
          if (!aaben(tn.key)) return;
          var prEtage = {}; prType[t].forEach(function (i) { (prEtage[i.etage] || (prEtage[i.etage] = [])).push(i); });
          sorterEtager(Object.keys(prEtage)).forEach(function (e) { tn.boern.push(blad(e + " (" + prEtage[e].length + ")", idsAf(prEtage[e]), {etage: e})); });
        });
      } else {
        var prFam = {}; prKat[k].forEach(function (i) { (prFam[i.familie] || (prFam[i.familie] = [])).push(i); });
        sorterNavne(Object.keys(prFam)).forEach(function (f) {
          var fn = knude("fam:" + k + "|" + f, 2, f, idsAf(prFam[f]), {antal: prFam[f].length});
          kn.boern.push(fn);
          if (!aaben(fn.key)) return;
          var prType2 = {}; prFam[f].forEach(function (i) { (prType2[i.type] || (prType2[i.type] = [])).push(i); });
          sorterNavne(Object.keys(prType2)).forEach(function (t) { fn.boern.push(blad(t + " (" + prType2[t].length + ")", idsAf(prType2[t]), {type: t})); });
        });
      }
    });
    return rod;
  }

  // Standard: Etage-gruppering starter foldet; Type og Familie viser kategorierne åbne.
  function standardAabne(gruppering, items) {
    var s = new Set();
    if (gruppering === "type" || gruppering === "familie") unik((items || []).filter(function (i) { return !i.erRum; }).map(function (i) { return i.kategori; })).forEach(function (k) { s.add("kat:" + k); });
    return s;
  }

  /* byg(items, {gruppering, aabne, valgte, filter}) → {noder, links, plusser, hoejde, bredde, gruppering, antal}
     filter (Set af idx): kun de punkter tælles, og alt foldes ud, så træfferne kan ses. */
  function byg(items, opts) {
    opts = opts || {};
    var gruppering = KOLONNER[opts.gruppering] ? opts.gruppering : "etage";
    var aabne = tilSet(opts.aabne), valgte = tilSet(opts.valgte), filter = opts.filter ? tilSet(opts.filter) : null;
    var alleDele = (items || []).filter(function (i) { return !i.erRum; });
    var dele = filter ? alleDele.filter(function (i) { return filter.has(i.idx); }) : alleDele;
    var rum = (items || []).filter(function (i) { return i.erRum; });
    var aaben = filter ? function () { return true; } : function (key) { return aabne.has(key); };
    var rod = gruppering === "etage" ? bygEtage(dele, rum, aaben) : bygTypeEllerFamilie(dele, aaben, gruppering);

    // Rækker: blade og foldede knuder tager én række; en forælder står midt for sine børn.
    var raekke = 0;
    (function placer(n) {
      if (!n.boern.length) { n.raekke = raekke++; return; }
      n.boern.forEach(placer);
      n.raekke = (n.boern[0].raekke + n.boern[n.boern.length - 1].raekke) / 2;
    })(rod);

    var kol = KOLONNER[gruppering], noder = [], links = [], plusser = [], bredde = 0;
    (function gaa(n, forael) {
      var x = kol.x[n.niveau], y = TOP + n.raekke * RAEKKE, b = kol.b[n.niveau];
      var k = 0; n.ids.forEach(function (i) { if (valgte.has(i)) k++; });
      n.x = x; n.y = y; n.b = b; n.h = HOEJDE; n.antalValgt = k; n.alleValgt = k > 0 && k === n.ids.length; n.nogenValgt = k > 0;
      n.aaben = n.kanFoldes ? aaben(n.key) : false;
      n.antal = n.ids.length;
      n.titel = n.etiket + (n.blad ? "" : " · " + n.ids.length + " element" + (n.ids.length === 1 ? "" : "er")) + (k ? " · " + k + " valgt" : "");
      n.nr = noder.length;
      noder.push(n);
      if (forael) {
        var x1 = forael.x + forael.b, y1 = forael.y + HOEJDE / 2, x2 = x, y2 = y + HOEJDE / 2, xm = (x1 + x2) / 2;
        links.push({fra: forael.nr, til: n.nr, d: "M" + x1 + " " + y1 + "C" + xm + " " + y1 + " " + xm + " " + y2 + " " + x2 + " " + y2, valgt: n.nogenValgt});
      }
      if (n.blad) plusser.push({nr: n.nr, x: x + b + 4, y: y + (HOEJDE - PLUS) / 2, titel: "Føj " + n.etiket + " til valget", valgt: n.nogenValgt});
      bredde = Math.max(bredde, x + b + 4 + PLUS + 4);
      n.boern.forEach(function (c) { gaa(c, n); });
    })(rod, null);

    return {noder: noder, links: links, plusser: plusser, hoejde: TOP * 2 + raekke * RAEKKE, bredde: bredde, gruppering: gruppering, antal: dele.length, filtreret: !!filter,
      antalRaekker: raekke};
  }

  /* Klik: hvad skal der ske? Rent svar: {aabne (nyt Set), vaelg (liste af idx eller null), erstat (true = erstat valget)}. */
  function klik(node, aabne, valgte, tilfoej) {
    var a = new Set(tilSet(aabne)), v = tilSet(valgte);
    if (node.niveau === 0) return {aabne: a, vaelg: [], erstat: true};
    if (node.blad) return {aabne: a, vaelg: node.ids.slice(), erstat: !tilfoej};
    var key = node.key || "";
    if (key.indexOf("etage:") === 0 || key.indexOf("kat:") === 0) { if (a.has(key)) a["delete"](key); else a.add(key); return {aabne: a, vaelg: null, erstat: false}; }
    var alle = node.ids.length > 0 && node.ids.every(function (i) { return v.has(i); });
    if (alle && a.has(key)) { a["delete"](key); return {aabne: a, vaelg: null, erstat: false}; }
    a.add(key);
    return {aabne: a, vaelg: node.ids.slice(), erstat: !tilfoej};
  }
  function plus(node) { return {vaelg: node.ids.slice(), erstat: false}; }
  /* Klik med isolering (3.0-rettelse efter første Revit-test): som klik(), plus hvad 3D skal vise.
       isoler: liste af idx = vis kun dem; null = ophæv isoleringen; undefined = rør ikke isoleringen.
       visning: "valgte" | "hele" | undefined (visningsvælgeren).
     Rum: vælg rummets elementer, isolér dem og vis «Valgte». Etage: isolér etagen (foldningen skifter som før, valget
     røres ikke). Model-noden: alt vises igen, valget tømmes. «+»/Skift føjer til valget uden at isolere; blade, typer og
     familier vælger uden at isolere. */
  function handling(node, aabne, valgte, tilfoej) {
    var r = klik(node, aabne, valgte, tilfoej), key = node.key || "";
    if (tilfoej) return r;
    if (node.niveau === 0) { r.isoler = null; r.visning = "hele"; return r; }
    if (key.indexOf("rum:") === 0 && r.vaelg) { r.isoler = node.ids.slice(); r.visning = "valgte"; return r; }
    if (key.indexOf("etage:") === 0) { r.isoler = node.ids.slice(); return r; }
    return r;
  }
  /* Dobbeltklik: zoom til knudens elementer (rum, etage, type, blad …). Knuden holdes åben, selvom det andet klik foldede den. */
  function dobbelt(node, aabne) {
    var a = new Set(tilSet(aabne));
    if (node.niveau === 0) return {aabne: a, vaelg: [], erstat: true, fokus: "alt"};
    if (node.kanFoldes && node.key) a.add(node.key);
    return {aabne: a, vaelg: node.ids.slice(), erstat: true, fokus: "valg"};
  }
  function foldAlle(res, aabne, ud) {
    var a = new Set(tilSet(aabne));
    res.noder.forEach(function (n) { if (n.kanFoldes) { if (ud) a.add(n.key); else a["delete"](n.key); } });
    return a;
  }

  /* Søgning: alle ord skal findes i id, navn, type, familie, kategori, etage eller CCI-kode. Tom tekst = ingen søgning. */
  function filtrer(items, tekst) {
    var ord = String(tekst || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!ord.length) return null;
    var s = new Set();
    (items || []).forEach(function (i) {
      if (i.erRum) return;
      var h = [i.id, i.uniqueId, i.navn, i.type, i.familie, i.kategori, i.etage, i.cci].map(function (x) { return x == null ? "" : String(x); }).join(" ").toLowerCase();
      if (ord.every(function (o) { return h.indexOf(o) >= 0; })) s.add(i.idx);
    });
    return s;
  }

  /* ---------- DOM (kun i browseren) ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c]; }); }
  function tegn(container, res, h) {
    var zoom = container.mmZoom || 1;
    var w = Math.max(res.bredde, container.clientWidth || 0), hh = Math.max(res.hoejde, 48);
    var s = '<div class="mm-flade" style="width:' + w + 'px;height:' + hh + 'px">';
    s += '<svg class="mm-links" width="' + w + '" height="' + hh + '" aria-hidden="true">' + res.links.map(function (l) { return '<path d="' + l.d + '" class="' + (l.valgt ? "valgt" : "") + '"/>'; }).join("") + "</svg>";
    res.noder.forEach(function (n) {
      var kl = "mm-node mm-n" + n.niveau + (n.blad ? " mm-blad" : "") + (n.alleValgt ? " valgt-alle" : n.nogenValgt ? " valgt-del" : "") + (n.aaben ? " aaben" : "") + (n.kanFoldes ? " kan-foldes" : "");
      s += '<button type="button" class="' + kl + '" data-nr="' + n.nr + '" style="left:' + n.x + "px;top:" + n.y + "px;width:" + n.b + 'px" title="' + esc(n.titel) + '">' +
        (n.kanFoldes ? '<span class="mm-pil" aria-hidden="true">' + (n.aaben ? "▾" : "▸") + "</span>" : "") + esc(n.etiket) + "</button>";
    });
    res.plusser.forEach(function (p) {
      s += '<button type="button" class="mm-plus' + (p.valgt ? " valgt" : "") + '" data-plus="' + p.nr + '" style="left:' + p.x + "px;top:" + p.y + 'px" title="' + esc(p.titel) + '" aria-label="' + esc(p.titel) + '">+</button>';
    });
    s += "</div>";
    container.innerHTML = s;
    function saetZoom(ny) {
      var gammel = zoom; zoom = Math.max(0.25, Math.min(2, ny));
      container.mmZoom = zoom;
      var flade = container.firstElementChild;
      if (flade) flade.style.zoom = zoom;
      container.scrollLeft = container.scrollLeft * zoom / gammel;
      container.scrollTop = container.scrollTop * zoom / gammel;
      if (h.zoom) h.zoom(zoom);
    }
    container.mmSaetZoom = saetZoom;
    saetZoom(zoom);
    container.onwheel = function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      saetZoom(zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    container.onclick = function (ev) {
      var b = ev.target.closest ? ev.target.closest("[data-nr],[data-plus]") : null; if (!b) return;
      if (b.hasAttribute("data-plus")) { h.plus(res.noder[+b.getAttribute("data-plus")], ev); return; }
      h.klik(res.noder[+b.getAttribute("data-nr")], ev);
    };
    container.ondblclick = function (ev) {
      if (!h.dobbelt) return;
      var b = ev.target.closest ? ev.target.closest("[data-nr]") : null; if (!b) return;
      ev.preventDefault(); h.dobbelt(res.noder[+b.getAttribute("data-nr")], ev);
    };
  }

  return {
    GRUPPERINGER: GRUPPERINGER, KAT_ORDEN: KAT_ORDEN.slice(), UDEN_ETAGE: UDEN_ETAGE, UDEN_RUM: UDEN_RUM, RAEKKE: RAEKKE, HOEJDE: HOEJDE,
    sorterEtager: sorterEtager, sorterKategorier: sorterKategorier,
    fraElementer: fraElementer, rumSomElementer: rumSomElementer,
    byg: byg, standardAabne: standardAabne, klik: klik, handling: handling, dobbelt: dobbelt, plus: plus, foldAlle: foldAlle, filtrer: filtrer,
    tegn: tegn
  };
});
