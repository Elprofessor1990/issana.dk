/* ISSANA 3D: fanen «Graf» i arbejdsrummet (netværksdiagram over bygningsdelene).

   Overblik: én kolonne pr. etage og én node pr. (kategori, type). Noden viser typenavn og antal og er farvet efter
   datakomplethed: andelen af elementer uden mangler (grøn → gul → rød). Mærket «≠» betyder, at elementerne af typen
   på etagen IKKE har de samme data. Sammenligningen bruger et fingeraftryk af dataposten (uden historik, kontrol,
   forslag og schema) plus tags, handlingsstatus og støj udefra. Kanter forbinder samme type på tværs af etager; en
   stiplet kant betyder, at flertallet på de to etager har forskellige data.

   Sammenhæng: det valgte element eller rum i midten med naboerne omkring: rummene, en bygningsdel afgrænser,
   bygningsdelene, der afgrænser et rum, naborum, vinduer og døre, typen, støj udefra og brugerens lydmål.

   Fanen læser kun og ændrer intet i Revit. Ændringer laves i fanen Data (knappen «Rediger i Data»).
   Den rene logik ligger på window.IssanaArbejdsrumGraf (og module.exports i Node), så den kan testes:
   tests/web-model3d/arbejdsrum-graf.test.mjs. Indlæses efter arbejdsrum.js med <script src="arbejdsrum-graf.js">. */
(function (fabrik) {
  "use strict";
  var api = fabrik();
  if (typeof module === "object" && module && module.exports) { module.exports = api; return; }
  if (typeof window !== "undefined") { window.IssanaArbejdsrumGraf = api; api.installer(window); }
})(function () {
  "use strict";

  /* ---------- Faste værdier ---------- */
  var KAT_ORDEN = ["Vægge", "Gulve", "Tage", "Vinduer", "Døre", "Lofter", "Søjler", "Bjælker", "Trapper"];
  var AABNING_KAT = {"Vinduer": 1, "Døre": 1};
  var UDEN_ETAGE = "(uden etage)";
  var UDELADT = {historik: 1, kontrol: 1, forslag: 1, schema: 1};   // tæller ikke med i fingeraftrykket
  // Samme tekster som arbejdsrum.js (bruges, hvis kernen ikke giver sine egne)
  var STATUS_TEKST = {documented_against_target: "Dokumenteret mod mål", difference_from_target: "Forskel fra mål",
    needs_input: "Mangler input", not_reviewed: "Ikke kontrolleret", not_applicable: "Ikke relevant"};
  var HANDLING_TEKST = {unset: "Ikke angivet", existing_not_assessed: "Eksisterende, ikke vurderet",
    retain_unchanged: "Bevares uændret", maintain: "Vedligeholdes", repair: "Repareres", renovate: "Renoveres",
    rebuild: "Genopbygges", dismantle_for_reuse: "Demonteres til genbrug", demolish: "Rives ned",
    replace: "Udskiftes", new_element: "Nyt element"};
  var NOEGLE_TEKST = {vaerdi: "værdi", maal: "mål", stoerrelse: "størrelse", forudsaetninger: "forudsætninger",
    begraensninger: "begrænsninger", maengder: "mængder", ikkeRelevant: "ikke relevant", psi: "ψ", stoej: "støj",
    aktuel: "indgår i analysen", tekst: "tekst"};
  var SAERLIGE_STIER = {":tags": "Tags", ":status": "Handlingsstatus", ":stoej": "Støj udefra (dB)"};
  var SIDE_FOR_RUM = {side: "væg", top: "loft", bund: "gulv"};            // hvad bygningsdelen er for rummet
  var RETNING_TEKST = {side: "ved siden af", over: "over", under: "under"};
  var LYDMAAL_DELE = [["facade", "Inde fra trafik"], ["luftlyd", "Luftlyd R'w"], ["trinlyd", "Trinlyd L'nT,w"],
    ["installation", "Installationer"]];

  /* ---------- Små hjælpere ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]; }); }
  function sammenlign(a, b) { return String(a).localeCompare(String(b), "da", {numeric: true}); }
  function katOrden(k) { var i = KAT_ORDEN.indexOf(k); return i < 0 ? KAT_ORDEN.length : i; }
  function unikke(liste) { var s = {}, r = []; liste.forEach(function (x) { if (!s[x]) { s[x] = 1; r.push(x); } }); return r; }
  function rund(n, dec) { var f = Math.pow(10, dec || 0); return Math.round(n * f) / f; }
  function fmtTal(n, dec) {
    if (n == null || !isFinite(n)) return "–";
    try { return Number(n).toLocaleString("da-DK", {minimumFractionDigits: 0, maximumFractionDigits: dec == null ? 1 : dec}); }
    catch (e) { return String(n); }
  }
  function pct(andel) { return andel == null ? "–" : Math.round(andel * 100) + " %"; }
  function kort(s, max) { s = String(s == null ? "" : s); return max > 1 && s.length > max ? s.slice(0, max - 1) + "…" : s; }
  function erRumInfo(info) { return !!(info && (info.erRum || (info.ed && info.ed.erRum))); }

  function sorterKategorier(liste) { return liste.slice().sort(function (a, b) { return katOrden(a) - katOrden(b) || sammenlign(a, b); }); }
  // Etager som tal-bevidst tekst; elementer uden etage sidst
  function sorterEtager(liste) {
    return liste.slice().sort(function (a, b) {
      if (a === UDEN_ETAGE) return b === UDEN_ETAGE ? 0 : 1;
      if (b === UDEN_ETAGE) return -1;
      return sammenlign(a, b);
    });
  }
  function etageAf(info) { return (info && info.ed && info.ed.level) || UDEN_ETAGE; }
  function typeNavnAf(info) { var ed = (info && info.ed) || {}; return ed.type || (info && info.type && info.type.name) || ed.name || "(uden type)"; }
  function familieAf(info) { var ed = (info && info.ed) || {}; return ed.family || (info && info.type && info.type.family) || ""; }
  // Typen: kategori + Revit-type-id (eller typenavnet, hvis id mangler)
  function typeNoegle(info) {
    var ed = (info && info.ed) || {};
    return (ed.category || "Andet") + "¦" + (ed.typeId != null ? "id:" + ed.typeId : "navn:" + typeNavnAf(info));
  }
  function kortNavn(info) {
    if (!info || !info.ed) return "?";
    if (erRumInfo(info)) return info.ed.name || ("Rum " + (info.ed.id != null ? info.ed.id : ""));
    return typeNavnAf(info);
  }
  function elementNavn(info) {
    if (!info || !info.ed) return "?";
    if (erRumInfo(info)) return "Rum " + (info.ed.name || info.ed.id) + (info.ed.level ? " (" + info.ed.level + ")" : "");
    return typeNavnAf(info) + " (id " + info.ed.id + (info.ed.level ? ", " + info.ed.level : "") + ")";
  }

  /* ---------- Fingeraftryk: er dataene de samme? ---------- */
  // Tomt er tomt: null, "" og tomme objekter/lister fjernes, og nøglerne sorteres, så rækkefølgen ikke tæller.
  function rens(v) {
    if (v == null || v === "") return undefined;
    if (typeof v === "number" && !isFinite(v)) return undefined;
    if (Array.isArray(v)) { var a = v.map(rens).filter(function (x) { return x !== undefined; }); return a.length ? a : undefined; }
    if (typeof v === "object") {
      var r = {}, n = 0;
      Object.keys(v).sort().forEach(function (k) { var x = rens(v[k]); if (x !== undefined) { r[k] = x; n++; } });
      return n ? r : undefined;
    }
    return v;
  }
  function tagListe(info) {
    var s = {};
    if (info && info.tagSet) Object.keys(info.tagSet).forEach(function (k) { s[String(k).trim().toLowerCase()] = 1; });
    else ((info && info.tags) || []).forEach(function (t) { var x = typeof t === "string" ? t : t && t.tag; if (x) s[String(x).trim().toLowerCase()] = 1; });
    return Object.keys(s).filter(Boolean).sort();
  }
  // Det, der sammenlignes: dataposten uden historik/kontrol/forslag/schema + tags, handlingsstatus og støj udefra
  function normalPost(info) {
    var d = info && info.data && typeof info.data === "object" ? info.data : null, dd = {};
    if (d) Object.keys(d).forEach(function (k) { if (!UDELADT[k]) dd[k] = d[k]; });
    return {data: rens(dd) || null, tags: tagListe(info), status: (info && info.status) || "unset",
      stoej: info && info.stoej != null && isFinite(info.stoej) ? info.stoej : null};
  }
  function fingeraftryk(info) { return JSON.stringify(normalPost(info)); }

  // Fladt opslag sti -> værdi (lister holdes samlet)
  function flad(info) {
    var p = normalPost(info), ud = {};
    (function gaa(o, sti) {
      if (o && typeof o === "object" && !Array.isArray(o)) Object.keys(o).forEach(function (k) { gaa(o[k], sti ? sti + "." + k : k); });
      else if (sti) ud[sti] = o;
    })(p.data, "");
    if (p.tags.length) ud[":tags"] = p.tags;
    if (p.status !== "unset") ud[":status"] = p.status;
    if (p.stoej != null) ud[":stoej"] = p.stoej;
    return ud;
  }
  function stiTekst(sti) {
    if (SAERLIGE_STIER[sti]) return SAERLIGE_STIER[sti];
    return String(sti).split(".").map(function (k) { return NOEGLE_TEKST[k] || k; }).join(" › ");
  }
  function visVaerdi(v, sti) {
    if (v === undefined || v === null) return "(tom)";
    if (sti === ":status") return HANDLING_TEKST[v] || v;
    if (Array.isArray(v)) return v.map(function (x) { return typeof x === "object" ? JSON.stringify(x) : String(x); }).join(", ");
    if (typeof v === "boolean") return v ? "ja" : "nej";
    if (typeof v === "number") return fmtTal(v, 3);
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }
  // Hvad er forskelligt mellem a og b? [{sti, tekst, a, b}]
  function forskelle(a, b) {
    var fa = flad(a), fb = flad(b), r = [];
    unikke(Object.keys(fa).concat(Object.keys(fb))).sort().forEach(function (k) {
      if (JSON.stringify(fa[k]) !== JSON.stringify(fb[k])) r.push({sti: k, tekst: stiTekst(k), a: fa[k], b: fb[k]});
    });
    return r;
  }
  function dataListe(info) {
    var f = flad(info);
    return Object.keys(f).sort(function (x, y) { return (x.charAt(0) === ":" ? 0 : 1) - (y.charAt(0) === ":" ? 0 : 1) || sammenlign(x, y); })
      .map(function (k) { return {sti: k, tekst: stiTekst(k), vaerdi: visVaerdi(f[k], k)}; });
  }

  // Varianter af data i en liste af elementer; flertallet er den største. aftryk (valgfri) er et opslag idx -> aftryk.
  function varianter(infos, idxListe, aftryk) {
    var af = {}, orden = [];
    (idxListe || []).forEach(function (i) {
      var info = infos[i]; if (!info) return;
      var a = aftryk && aftryk[i] != null ? aftryk[i] : fingeraftryk(info);
      if (!af[a]) { af[a] = {aftryk: a, idx: []}; orden.push(af[a]); }
      af[a].idx.push(i);
    });
    var v = orden.slice().sort(function (x, y) { return y.idx.length - x.idx.length; });
    var afv = [];
    v.slice(1).forEach(function (x) { afv.push.apply(afv, x.idx); });
    afv.sort(function (x, y) { return x - y; });
    return {varianter: v, flertal: v.length ? v[0].aftryk : null, flertalIdx: v.length ? v[0].idx.slice() : [], afvigere: afv,
      uafgjort: v.length > 1 && v[1].idx.length === v[0].idx.length};
  }

  /* ---------- Overblik: grupper pr. (kategori, type, etage) ---------- */
  function grupperOverblik(infos) {
    infos = infos || [];
    var grupper = [], afNoegle = {}, gruppeAf = {}, etSet = {}, aftryk = {}, typer = [], typeAf = {};
    for (var i = 0; i < infos.length; i++) {
      var info = infos[i];
      if (!info || !info.ed || erRumInfo(info)) continue;
      var et = etageAf(info), tn = typeNoegle(info), k = tn + "¦" + et, g = afNoegle[k];
      if (!g) {
        g = afNoegle[k] = {noegle: k, typeNoegle: tn, kategori: info.ed.category || "Andet", etage: et, typeNavn: typeNavnAf(info),
          familie: familieAf(info), typeId: info.ed.typeId == null ? null : info.ed.typeId, idx: []};
        grupper.push(g);
        if (!typeAf[tn]) { typeAf[tn] = {noegle: tn, kategori: g.kategori, navn: g.typeNavn, familie: g.familie, grupper: [], antal: 0}; typer.push(typeAf[tn]); }
        typeAf[tn].grupper.push(g);
      }
      g.idx.push(i); gruppeAf[i] = k; etSet[et] = 1; typeAf[tn].antal++;
      aftryk[i] = fingeraftryk(info);
    }
    var etager = sorterEtager(Object.keys(etSet)), etIdx = {};
    etager.forEach(function (e, j) { etIdx[e] = j; });
    // To typer med samme navn i samme kategori (fx «Standard» i flere dørfamilier) får familien med i etiketten
    var navne = {};
    typer.forEach(function (t) { var nk = t.kategori + "¦" + t.navn; (navne[nk] || (navne[nk] = [])).push(t); });
    typer.forEach(function (t) { t.etiket = navne[t.kategori + "¦" + t.navn].length > 1 && t.familie ? t.navn + " (" + t.familie + ")" : t.navn; });
    grupper.forEach(function (g) {
      g.etiket = typeAf[g.typeNoegle].etiket;
      g.antal = g.idx.length;
      var komplette = 0, mm = {}, ml = [];
      g.idx.forEach(function (j) {
        var m = infos[j].mangler || [], set = {};
        if (!m.length) komplette++;
        m.forEach(function (x) {
          var key = (x.felt || "") + "|" + (x.tekst || "");
          if (set[key]) return; set[key] = 1;
          if (!mm[key]) { mm[key] = {felt: x.felt || null, tekst: x.tekst || x.felt || "?", antal: 0, idx: []}; ml.push(mm[key]); }
          mm[key].antal++; mm[key].idx.push(j);
        });
      });
      ml.sort(function (a, b) { return b.antal - a.antal || sammenlign(a.tekst, b.tekst); });
      g.komplette = komplette; g.andel = g.antal ? komplette / g.antal : null; g.mangler = ml;
      var v = varianter(infos, g.idx, aftryk);
      g.varianter = v.varianter; g.flertal = v.flertal; g.afvigere = v.afvigere; g.uafgjort = v.uafgjort;
      g.forskellige = v.varianter.length > 1;
    });
    typer.forEach(function (t) {
      t.grupper.sort(function (a, b) { return etIdx[a.etage] - etIdx[b.etage]; });
      t.ensPaaTvaers = unikke(t.grupper.map(function (g) { return g.flertal; })).length <= 1;
      t.forskellige = t.grupper.some(function (g) { return g.forskellige; });
    });
    var sorter = function (a, b) {
      return katOrden(a.kategori) - katOrden(b.kategori) || sammenlign(a.kategori, b.kategori) || sammenlign(a.etiket, b.etiket) ||
        sammenlign(a.noegle, b.noegle);
    };
    typer.sort(sorter);
    grupper.sort(function (a, b) { return sorter(a, b) || etIdx[a.etage] - etIdx[b.etage]; });
    var kategorier = sorterKategorier(unikke(grupper.map(function (g) { return g.kategori; }))).map(function (k) {
      var gs = grupper.filter(function (g) { return g.kategori === k; });
      return {navn: k, typer: unikke(gs.map(function (g) { return g.typeNoegle; })).length,
        elementer: gs.reduce(function (s, g) { return s + g.antal; }, 0)};
    });
    return {etager: etager, grupper: grupper, typer: typer, kategorier: kategorier, afNoegle: afNoegle, gruppeAf: gruppeAf,
      typeAf: typeAf, aftryk: aftryk};
  }

  // Overblikkets placering: kolonner pr. etage, et bånd pr. kategori. En type ligger i samme række på alle etager, så
  // kanterne bliver vandrette; typer, hvis etager ikke overlapper, deler række (pakning af intervaller).
  function layoutKolonner(grupper, etager, opt) {
    opt = opt || {};
    var kolB = opt.kolonneBredde || 160, nodeH = opt.nodeHoejde || 32, rH = opt.raekkeHoejde || 40, baandH = opt.baandHoejde || 24;
    var venstre = opt.venstre == null ? 8 : opt.venstre, top = opt.top == null ? 6 : opt.top, nodeB = Math.max(60, kolB - 16);
    var kol = {};
    (etager || []).forEach(function (e, i) { kol[e] = i; });
    var typer = [], tAf = {};
    (grupper || []).forEach(function (g) {
      if (kol[g.etage] == null) return;
      var t = tAf[g.typeNoegle];
      if (!t) { t = tAf[g.typeNoegle] = {noegle: g.typeNoegle, kategori: g.kategori, etiket: g.etiket || g.typeNavn || "", grupper: []}; typer.push(t); }
      t.grupper.push(g);
    });
    typer.forEach(function (t) {
      t.grupper.sort(function (a, b) { return kol[a.etage] - kol[b.etage]; });
      t.fra = kol[t.grupper[0].etage]; t.til = kol[t.grupper[t.grupper.length - 1].etage];
    });
    var y = top, noder = [], kanter = [], baand = [], nodeAf = {};
    sorterKategorier(unikke(typer.map(function (t) { return t.kategori; }))).forEach(function (kat) {
      var tk = typer.filter(function (t) { return t.kategori === kat; })
        .sort(function (a, b) { return sammenlign(a.etiket, b.etiket) || sammenlign(a.noegle, b.noegle); });
      baand.push({kategori: kat, y: y, h: baandH, typer: tk.length});
      y += baandH;
      var raekker = [];
      tk.forEach(function (t) {
        var r = 0;
        for (; r < raekker.length; r++) {
          if (raekker[r].every(function (iv) { return t.til < iv[0] || t.fra > iv[1]; })) break;
        }
        if (r === raekker.length) raekker.push([]);
        raekker[r].push([t.fra, t.til]);
        t.grupper.forEach(function (g) {
          var c = kol[g.etage];
          var n = {gruppe: g, noegle: g.noegle, kolonne: c, raekke: r, x: venstre + c * kolB + (kolB - nodeB) / 2,
            y: y + r * rH + (rH - nodeH) / 2, b: nodeB, h: nodeH};
          noder.push(n); nodeAf[g.noegle] = n;
        });
        for (var j = 1; j < t.grupper.length; j++) {
          var a = nodeAf[t.grupper[j - 1].noegle], b = nodeAf[t.grupper[j].noegle];
          kanter.push({fra: a.noegle, til: b.noegle, x1: a.x + a.b, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2,
            ens: a.gruppe.flertal === b.gruppe.flertal, spring: b.kolonne - a.kolonne > 1});
        }
      });
      y += Math.max(1, raekker.length) * rH + 6;
    });
    return {bredde: venstre * 2 + (etager || []).length * kolB, hoejde: y + 4, kolonneBredde: kolB, nodeBredde: nodeB, venstre: venstre,
      kolonner: (etager || []).map(function (e, i) { return {etage: e, x: venstre + i * kolB, b: kolB}; }),
      noder: noder, kanter: kanter, baand: baand, nodeAf: nodeAf};
  }

  /* ---------- Sammenhæng: naboer til ét element eller rum ---------- */
  function byggIndeks(infos) {
    var ix = {rumAfDel: {}, aabningAfVaert: {}, aabningAfRum: {}, afType: {}, elementAfId: {}, rumAfId: {}};
    function push(o, k, v) { (o[k] || (o[k] = [])).push(v); }
    (infos || []).forEach(function (info, i) {
      if (!info || !info.ed) return;
      var ed = info.ed;
      if (erRumInfo(info)) {
        if (ed.id != null) ix.rumAfId[String(ed.id)] = i;
        (ed.graenser || []).forEach(function (g) { if (g && g.id != null) push(ix.rumAfDel, String(g.id), {idx: i, areal: g.areal, side: g.side}); });
        return;
      }
      if (ed.id != null) ix.elementAfId[String(ed.id)] = i;
      if (ed.hostId != null) push(ix.aabningAfVaert, String(ed.hostId), i);
      if (Array.isArray(ed.rum)) ed.rum.forEach(function (r) { if (r != null) push(ix.aabningAfRum, String(r), i); });
      push(ix.afType, typeNoegle(info), i);
    });
    return ix;
  }

  function lydmaalTekst(m) {
    if (!m || typeof m !== "object") return "";
    function del(o, navn) {
      if (!o || o.vaerdi == null || o.vaerdi === "") return null;
      var r = o.retning || (/^L/.test(String(o.stoerrelse || "")) ? "max" : "min");
      return (navn || o.stoerrelse || "Mål") + " " + (r === "max" ? "≤" : "≥") + " " + fmtTal(Number(o.vaerdi)) + " " + (o.enhed || "dB");
    }
    if (m.vaerdi != null) return del(m, null) || "";
    return LYDMAAL_DELE.map(function (p) { return del(m[p[0]], p[1]); }).filter(Boolean).join(" · ");
  }

  // naboer(infos, idx, byRevitId) -> {midte, art: 'rum'|'del'|'aabning', rum, naborum, dele, aabninger, vaert, type, stoej, lydmaal}
  function naboer(infos, idx, byRevitId, indeks) {
    infos = infos || [];
    var info = infos[idx];
    if (!info || !info.ed) return null;
    var ix = indeks || byggIndeks(infos), ed = info.ed;
    function elIdx(id) {
      if (id == null) return null;
      var v = byRevitId ? byRevitId[id] : undefined;
      if (typeof v === "number" && infos[v] && !erRumInfo(infos[v])) return v;
      v = ix.elementAfId[String(id)];
      return v == null ? null : v;
    }
    function rumIdx(id) {
      if (id == null) return null;
      var v = byRevitId ? byRevitId["rum:" + id] : undefined;
      if (typeof v === "number" && infos[v]) return v;
      v = ix.rumAfId[String(id)];
      return v == null ? null : v;
    }
    var erRum = erRumInfo(info);
    var nb = {midte: idx, art: erRum ? "rum" : (AABNING_KAT[ed.category] || ed.hostId != null) ? "aabning" : "del",
      rum: [], naborum: [], dele: [], aabninger: [], vaert: null, type: null, stoej: null, lydmaal: null};

    if (erRum) {
      var delAf = {};
      (ed.graenser || []).forEach(function (g) {
        if (!g || g.id == null) return;
        var k = String(g.id), d = delAf[k];
        if (!d) { d = delAf[k] = {idx: elIdx(g.id), revitId: g.id, areal: 0, sider: []}; nb.dele.push(d); }
        if (typeof g.areal === "number" && isFinite(g.areal)) d.areal += g.areal;
        if (g.side && d.sider.indexOf(g.side) < 0) d.sider.push(g.side);
      });
      nb.dele.forEach(function (d) { d.areal = rund(d.areal, 2); });
      nb.dele.sort(function (a, b) { return b.areal - a.areal; });
      (ix.aabningAfRum[String(ed.id)] || []).forEach(function (j) {
        var h = infos[j].ed.hostId;
        nb.aabninger.push({idx: j, vaert: elIdx(h), vaertId: h == null ? null : h, iRummetsDele: h != null && !!delAf[String(h)]});
      });
      // Naborum: rum, der deler en bygningsdel (væg, dæk) eller en dør/et vindue med rummet
      var nr = {};
      var tilfoej = function (j, via, retning) {
        if (j == null || j === idx) return;
        var n = nr[j];
        if (!n) { n = nr[j] = {idx: j, via: [], retning: []}; nb.naborum.push(n); }
        if (!n.via.some(function (x) { return String(x.revitId) === String(via.revitId); })) n.via.push(via);
        if (n.retning.indexOf(retning) < 0) n.retning.push(retning);
      };
      // Retning: dækket er loft her og gulv dér → rummet ligger over (og omvendt). Samme gulv eller væg → ved siden af.
      nb.dele.forEach(function (d) {
        (ix.rumAfDel[String(d.revitId)] || []).forEach(function (r) {
          var ret = d.sider.indexOf("top") >= 0 && r.side === "bund" ? "over" : d.sider.indexOf("bund") >= 0 && r.side === "top" ? "under" : "side";
          tilfoej(r.idx, {idx: d.idx, revitId: d.revitId}, ret);
        });
      });
      nb.aabninger.forEach(function (a) {
        var ae = infos[a.idx].ed;
        (ae.rum || []).forEach(function (rid) { tilfoej(rumIdx(rid), {idx: a.idx, revitId: ae.id}, "side"); });
      });
      nb.naborum.sort(function (a, b) { return b.via.length - a.via.length || a.idx - b.idx; });
    } else {
      var rr = {};
      (ix.rumAfDel[String(ed.id)] || []).forEach(function (r) {
        var x = rr[r.idx];
        if (!x) { x = rr[r.idx] = {idx: r.idx, areal: 0, sider: []}; nb.rum.push(x); }
        if (typeof r.areal === "number" && isFinite(r.areal)) x.areal += r.areal;
        if (r.side && x.sider.indexOf(r.side) < 0) x.sider.push(r.side);
      });
      nb.rum.forEach(function (x) { x.areal = rund(x.areal, 2); });
      nb.rum.sort(function (a, b) { return b.areal - a.areal; });
      if (nb.art === "aabning") {
        if (ed.hostId != null) nb.vaert = {idx: elIdx(ed.hostId), revitId: ed.hostId};
        (ed.rum || []).forEach(function (rid) {
          var j = rumIdx(rid);
          if (j == null) nb.rum.push({idx: null, revitId: rid, areal: null, sider: []});
          else if (!rr[j]) { rr[j] = {idx: j, areal: null, sider: []}; nb.rum.push(rr[j]); }
        });
      }
      (ix.aabningAfVaert[String(ed.id)] || []).forEach(function (j) { if (j !== idx) nb.aabninger.push({idx: j, vaert: idx, vaertId: ed.id}); });
      var tk = typeNoegle(info), alle = (ix.afType[tk] || [idx]).slice(), et = {};
      alle.forEach(function (j) { et[etageAf(infos[j])] = 1; });
      nb.type = {noegle: tk, navn: typeNavnAf(info), kategori: ed.category || "Andet", familie: familieAf(info), idx: alle,
        antal: alle.length, etager: sorterEtager(Object.keys(et))};
    }

    if (info.stoej != null && isFinite(info.stoej)) nb.stoej = {vaerdi: info.stoej, tekst: info.stoejTekst || null, kilde: "element", via: []};
    else if (erRum) {
      // Rummets støj udefra står på facadevæggene; vis den højeste, og hvor den kommer fra
      var maks = null, via = [];
      nb.dele.forEach(function (d) {
        var di = d.idx != null ? infos[d.idx] : null;
        if (di && di.stoej != null && isFinite(di.stoej)) { via.push(d.idx); if (maks == null || di.stoej > maks) maks = di.stoej; }
      });
      if (via.length) nb.stoej = {vaerdi: maks, tekst: null, kilde: "facadevaeg", via: via};
    }
    var lm = info.data && info.data.lyd && info.data.lyd.maal, lt = lydmaalTekst(lm);
    if (lt) nb.lydmaal = {tekst: lt, maal: lm};
    return nb;
  }

  // Placering: det valgte i midten, rum/naborum til venstre, bygningsdele/åbninger/vært til højre, lydmål og støj over,
  // typen under. Åbninger i et rum hænger under den væg, de sidder i.
  function layoutSammenhaeng(nb, opt) {
    opt = opt || {};
    // Bredderne følger den plads, der er: sidekolonnerne mindst 130 px, midterkolonnen mindst 200 px
    var W = Math.max(opt.bredde || 760, 560), nodeH = 34, rH = 42, top = 30, indryk = 22, mellem = 26, midH = 58;
    var nodeB = Math.max(130, Math.min(opt.nodeBredde || 210, Math.floor((W - 20 - 2 * mellem - 200) / 2)));
    var midtRum = W - 20 - 2 * nodeB - 2 * mellem;
    var midB = Math.min(236, midtRum);
    var venstre = [], hoejre = [], over = [], under = [], vTitel = "", hTitel = "";
    if (!nb) return {bredde: W, hoejde: 0, midte: null, noder: [], kanter: [], overskrifter: []};
    if (nb.art === "rum") {
      vTitel = "Naborum"; hTitel = "Afgrænses af";
      nb.naborum.forEach(function (n) { venstre.push({art: "naborum", idx: n.idx, ref: n}); });
      var brugt = {};
      nb.dele.forEach(function (d) {
        hoejre.push({art: "del", idx: d.idx, ref: d});
        var p = hoejre.length - 1;
        nb.aabninger.forEach(function (a) {
          if (d.idx != null && a.vaert === d.idx && !brugt[a.idx]) { brugt[a.idx] = 1; hoejre.push({art: "aabning", idx: a.idx, ref: a, foraelder: p}); }
        });
      });
      nb.aabninger.forEach(function (a) { if (!brugt[a.idx]) hoejre.push({art: "aabning", idx: a.idx, ref: a}); });
    } else {
      vTitel = "Rum";
      nb.rum.forEach(function (r) { venstre.push({art: "rum", idx: r.idx, ref: r}); });
      if (nb.vaert) { hoejre.push({art: "vaert", idx: nb.vaert.idx, ref: nb.vaert}); hTitel = "Sidder i"; }
      if (nb.aabninger.length) {
        hTitel = hTitel ? "Sidder i · vinduer og døre" : "Vinduer og døre";
        nb.aabninger.forEach(function (a) { hoejre.push({art: "aabning", idx: a.idx, ref: a}); });
      }
    }
    if (nb.lydmaal) over.push({art: "lydmaal", idx: null, ref: nb.lydmaal});
    if (nb.type) under.push({art: "type", idx: null, ref: nb.type});
    if (nb.stoej) (nb.type ? over : under).push({art: "stoej", idx: null, ref: nb.stoej});   // et rum har ingen type: støjen under

    var behovOver = over.length ? 20 + nodeH : 0, behovUnder = under.length ? 20 + nodeH : 0;
    var indre = Math.max(venstre.length * rH, hoejre.length * rH, midH + 2 * Math.max(behovOver, behovUnder), midH + 24);
    var cy = top + indre / 2, cx = W / 2;
    var midte = {x: cx - midB / 2, y: cy - midH / 2, b: midB, h: midH};
    var noder = [], kanter = [];
    function kurve(x1, y1, x2, y2) { var mx = (x1 + x2) / 2; return "M" + rund(x1, 1) + " " + rund(y1, 1) + " C" + rund(mx, 1) + " " + rund(y1, 1) + " " + rund(mx, 1) + " " + rund(y2, 1) + " " + rund(x2, 1) + " " + rund(y2, 1); }
    var y0 = top + (indre - venstre.length * rH) / 2;
    venstre.forEach(function (n, k) {
      n.x = 10; n.y = y0 + k * rH + (rH - nodeH) / 2; n.b = nodeB; n.h = nodeH; noder.push(n);
      kanter.push({art: n.art, d: kurve(midte.x, cy, n.x + n.b, n.y + n.h / 2)});
    });
    y0 = top + (indre - hoejre.length * rH) / 2;
    var xH = W - 10 - nodeB;
    hoejre.forEach(function (n, k) {
      var ind = n.foraelder != null;
      n.x = xH + (ind ? indryk : 0); n.y = y0 + k * rH + (rH - nodeH) / 2; n.b = nodeB - (ind ? indryk : 0); n.h = nodeH; noder.push(n);
      if (ind) {
        var p = hoejre[n.foraelder], px = p.x + 10;
        kanter.push({art: n.art, d: "M" + rund(px, 1) + " " + rund(p.y + p.h, 1) + " V" + rund(n.y + n.h / 2, 1) + " H" + rund(n.x, 1)});
      } else kanter.push({art: n.art, d: kurve(midte.x + midte.b, cy, n.x, n.y + n.h / 2)});
    });
    var raek = function (liste, y, op) {
      var smaaB = Math.min(170, Math.floor((midtRum - 12 * (liste.length - 1)) / Math.max(1, liste.length)));
      var tot = liste.length * smaaB + (liste.length - 1) * 12, x = cx - tot / 2;
      liste.forEach(function (n, k) {
        n.x = x + k * (smaaB + 12); n.y = y; n.b = smaaB; n.h = nodeH; noder.push(n);
        var nx = n.x + n.b / 2;
        kanter.push({art: n.art, d: op ? "M" + rund(nx, 1) + " " + rund(n.y + n.h, 1) + " L" + rund(nx, 1) + " " + rund(midte.y, 1)
          : "M" + rund(nx, 1) + " " + rund(midte.y + midte.h, 1) + " L" + rund(nx, 1) + " " + rund(n.y, 1)});
      });
    };
    raek(over, midte.y - 20 - nodeH, true);
    raek(under, midte.y + midte.h + 20, false);
    var overskrifter = [];
    if (venstre.length) overskrifter.push({x: 10, y: 16, tekst: vTitel + " (" + venstre.length + ")", anker: "start"});
    if (hoejre.length) overskrifter.push({x: W - 10, y: 16, tekst: hTitel + " (" + hoejre.length + ")", anker: "end"});
    return {bredde: W, hoejde: top + indre + 12, midte: midte, noder: noder, kanter: kanter, overskrifter: overskrifter};
  }

  /* ---------- Tekster (tooltip og «Kopiér som tekst», fx til en AI) ---------- */
  function vaerdiKort(o) {
    if (!o || o.vaerdi == null || o.vaerdi === "") return null;
    return (o.stoerrelse ? o.stoerrelse + " " : "") + fmtTal(Number(o.vaerdi)) + " " + (o.enhed || "dB");
  }
  function tooltipTekst(info, tk) {
    if (!info || !info.ed) return "";
    tk = tk || {};
    var st = tk.status || STATUS_TEKST, ht = tk.handling || function (v) { return HANDLING_TEKST[v] || v; };
    var ed = info.ed, erRum = erRumInfo(info), L = [], d = info.data || {};
    L.push(kortNavn(info));
    L.push([ed.category || (erRum ? "Rum" : ""), etageAf(info), ed.id != null ? "Revit-id " + ed.id : ""].filter(Boolean).join(" · "));
    if (!erRum && familieAf(info)) L.push("Familie: " + familieAf(info));
    if (info.cci) L.push("CCI: " + info.cci);
    var tags = (info.tags || []).map(function (t) { return typeof t === "string" ? t : t && t.tag; }).filter(Boolean);
    L.push("Tags: " + (tags.length ? tags.join(", ") : "ingen"));
    if (erRum) L.push("Rumanvendelse: " + (info.rumanvendelse || "ikke angivet"));
    else if (info.status) L.push("Handlingsstatus: " + ht(info.status));
    if (info.lyd && !info.lyd.kategori) {
      var l = d.lyd || {}, x = [];
      if (vaerdiKort(l.dokumenteret)) x.push("dok. " + vaerdiKort(l.dokumenteret));
      if (vaerdiKort(l.maal)) x.push("mål " + vaerdiKort(l.maal));
      L.push("Lyd: " + (st[info.lyd.status] || info.lyd.status) + (x.length ? " (" + x.join(", ") + ")" : ""));
    }
    if (info.brand && !info.brand.kategori) {
      var b = d.brand || {}, y = [];
      if (b.dokumenteret && b.dokumenteret.klasse) y.push("dok. " + b.dokumenteret.klasse);
      if (b.maal && b.maal.klasse) y.push("krav " + b.maal.klasse);
      L.push("Brand: " + (st[info.brand.status] || info.brand.status) + (y.length ? " (" + y.join(", ") + ")" : ""));
    }
    if (info.stoej != null) L.push("Støj udefra: " + (info.stoejTekst || fmtTal(info.stoej) + " dB"));
    if (erRum) {
      var lm = lydmaalTekst(d.lyd && d.lyd.maal);
      if (lm) L.push("Lydmål: " + lm);
      if (typeof ed.area === "number") L.push("Areal: " + fmtTal(ed.area) + " m²");
    }
    L.push("Kontrolleret: " + (info.kontrolleret ? "ja" : "nej"));
    var m = info.mangler || [];
    L.push(m.length ? "Mangler: " + m.map(function (z) { return z.tekst; }).join("; ") : "Mangler: intet");
    return L.join("\n");
  }
  function kortData(info, tk) {
    if (!info) return "";
    var st = (tk && tk.status) || STATUS_TEKST, r = [];
    var tags = tagListe(info);
    if (tags.length) r.push("tags " + tags.join("/"));
    if (info.lyd && !info.lyd.kategori) r.push("lyd: " + (st[info.lyd.status] || info.lyd.status));
    if (info.brand && !info.brand.kategori) r.push("brand: " + (st[info.brand.status] || info.brand.status));
    if (info.stoej != null) r.push("støj " + fmtTal(info.stoej) + " dB");
    var m = info.mangler || [];
    r.push(m.length ? "mangler: " + m.map(function (z) { return z.tekst; }).join(", ") : "intet mangler");
    var s = r.join("; ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function gruppeTekst(g, infos, ov) {
    var L = [];
    L.push("Type: " + g.etiket + " (" + g.kategori + (g.familie ? ", familie " + g.familie : "") + "), etage: " + g.etage + ", " + g.antal + " elementer.");
    L.push("Uden mangler: " + g.komplette + " af " + g.antal + " (" + pct(g.andel) + ").");
    L.push(g.mangler.length ? "Mangler: " + g.mangler.map(function (m) { return m.tekst + " (" + m.antal + ")"; }).join("; ") + "." : "Mangler: intet.");
    var ref = g.varianter.length ? infos[g.varianter[0].idx[0]] : null;
    if (!g.forskellige) L.push("Data: alle " + g.antal + " har de samme data.");
    else {
      L.push("Data: " + g.varianter.length + " forskellige sæt; flertallet er " + g.varianter[0].idx.length + " af " + g.antal + (g.uafgjort ? " (uafgjort)" : "") + ".");
      g.afvigere.slice(0, 50).forEach(function (i) {
        L.push("- Afviger: " + elementNavn(infos[i]) + ": " + forskelle(infos[i], ref).map(function (f) {
          return f.tekst + " = " + visVaerdi(f.a, f.sti) + " (flertal: " + visVaerdi(f.b, f.sti) + ")";
        }).join("; "));
      });
      if (g.afvigere.length > 50) L.push("- … og " + (g.afvigere.length - 50) + " mere.");
    }
    var dl = dataListe(ref);
    L.push(dl.length ? "Flertallets data: " + dl.map(function (x) { return x.tekst + " = " + x.vaerdi; }).join("; ") + "." : "Flertallets data: ingen registrerede data.");
    var t = ov && ov.typeAf && ov.typeAf[g.typeNoegle];
    if (t) {
      var andre = t.grupper.filter(function (x) { return x !== g; });
      if (andre.length) L.push("Samme type på andre etager: " + andre.map(function (x) {
        return x.etage + " (" + x.antal + " stk, " + pct(x.andel) + " uden mangler, " + (x.flertal === g.flertal ? "samme data" : "andre data") + ")";
      }).join("; ") + ".");
    }
    return L.join("\n");
  }

  function overblikTekst(ov, grupper) {
    grupper = grupper || (ov && ov.grupper) || [];
    var L = ["Overblik over bygningsdele pr. type og etage (" + grupper.length + " noder). Kolonner: kategori | type | etage | antal | uden mangler | mangler | data."];
    grupper.forEach(function (g) {
      L.push([g.kategori, g.etiket, g.etage, g.antal + " stk", pct(g.andel),
        g.mangler.length ? g.mangler.map(function (m) { return m.tekst + " (" + m.antal + ")"; }).join(", ") : "intet",
        g.forskellige ? g.varianter.length + " forskellige sæt (" + g.afvigere.length + " afviger)" : "ens"].join(" | "));
    });
    var typer = ov && ov.typer ? ov.typer.filter(function (t) { return !t.ensPaaTvaers; }) : [];
    if (typer.length) L.push("Typer med forskellige data på forskellige etager: " + typer.map(function (t) { return t.etiket + " (" + t.kategori + ")"; }).join("; ") + ".");
    return L.join("\n");
  }

  function sammenhaengTekst(nb, infos, tk) {
    if (!nb) return "";
    var c = infos[nb.midte], L = [];
    var navnOgData = function (i, ekstra) { var inf = infos[i]; return elementNavn(inf) + (ekstra ? ": " + ekstra : "") + ". " + kortData(inf, tk) + "."; };
    L.push("Valgt: " + elementNavn(c) + " [" + ((c.ed && c.ed.category) || "") + "]. " + kortData(c, tk) + ".");
    if (nb.lydmaal) L.push("Lydmål (brugerens): " + nb.lydmaal.tekst + ".");
    if (nb.stoej) L.push("Støj udefra: " + fmtTal(nb.stoej.vaerdi) + " dB" + (nb.stoej.kilde === "facadevaeg"
      ? " (højeste værdi registreret på facadevæggene: " + nb.stoej.via.map(function (i) { return elementNavn(infos[i]); }).join(", ") + ")" : "") + ".");
    if (nb.dele.length) {
      L.push("Afgrænses af (" + nb.dele.length + "):");
      nb.dele.forEach(function (d) {
        var side = d.sider.map(function (s) { return SIDE_FOR_RUM[s] || s; }).join("/");
        L.push("- " + (d.idx != null ? navnOgData(d.idx, fmtTal(d.areal) + " m², " + side) : "Revit-id " + d.revitId + " (ikke i 3D): " + fmtTal(d.areal) + " m², " + side + "."));
      });
    }
    if (nb.vaert) L.push("Sidder i: " + (nb.vaert.idx != null ? navnOgData(nb.vaert.idx) : "Revit-id " + nb.vaert.revitId + " (ikke i 3D)."));
    if (nb.aabninger.length) {
      L.push("Vinduer og døre (" + nb.aabninger.length + "):");
      nb.aabninger.forEach(function (a) { L.push("- " + navnOgData(a.idx, a.vaertId != null && nb.art === "rum" ? "i bygningsdel id " + a.vaertId : "")); });
    }
    if (nb.naborum.length) {
      L.push("Naborum (" + nb.naborum.length + "):");
      nb.naborum.forEach(function (n) {
        L.push("- " + navnOgData(n.idx, n.retning.map(function (r) { return RETNING_TEKST[r] || r; }).join("/") + ", via " +
          n.via.map(function (v) { return v.idx != null ? elementNavn(infos[v.idx]) : "id " + v.revitId; }).join(", ")));
      });
    }
    if (nb.rum.length) {
      L.push("Rum (" + nb.rum.length + "):");
      nb.rum.forEach(function (r) {
        var ek = (r.areal ? fmtTal(r.areal) + " m²" : "") + (r.sider.length ? (r.areal ? ", " : "") + r.sider.map(function (s) { return SIDE_FOR_RUM[s] || s; }).join("/") + " for rummet" : "");
        L.push("- " + (r.idx != null ? navnOgData(r.idx, ek) : "Rum med Revit-id " + r.revitId + " (ikke i 3D)."));
      });
    }
    if (nb.type) L.push("Type: " + nb.type.navn + " (" + nb.type.kategori + "), " + nb.type.antal + " stk på " + nb.type.etager.join(", ") + ".");
    return L.join("\n");
  }

  // Grøn (alle uden mangler) → gul (halvdelen) → rød (alle mangler noget), som CSS-farve med visningens variabler
  function komplethedFarve(andel) {
    if (andel == null || !isFinite(andel)) return "var(--muted)";
    if (andel >= 1) return "var(--ok)";
    if (andel <= 0) return "var(--red)";
    if (andel >= 0.5) return "color-mix(in srgb, var(--ok) " + Math.round((andel - 0.5) * 200) + "%, var(--warn))";
    return "color-mix(in srgb, var(--warn) " + Math.round(andel * 200) + "%, var(--red))";
  }

  /* ======================================================================
     Fanen i arbejdsrummet (kun i browseren)
     ====================================================================== */
  var CSS = "\
.grf-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 6px}\
.grf-skift{display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden}\
.grf-skift button{border:0;background:none;color:var(--muted);padding:5px 12px;font:inherit;cursor:pointer}\
.grf-skift button+button{border-left:1px solid var(--border)}\
.grf-skift button.on{background:var(--accent);color:var(--accent-ink);font-weight:600}\
.grf-top .grf-hoejre{margin-left:auto;display:flex;gap:6px;align-items:center}\
.grf-chips{margin:4px 0}\
.grf-legende{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;color:var(--muted);font-size:11px;margin:4px 0 6px}\
.grf-legende i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}\
.grf-legende svg{vertical-align:middle;margin-right:4px}\
.grf-ne{display:inline-block;background:var(--accent);color:var(--accent-ink);border-radius:7px;padding:0 5px;font-size:10px;font-weight:700;margin-right:4px}\
.grf-skrol{overflow:auto;max-height:max(260px,calc(100vh - 330px));border:1px solid var(--border);border-radius:8px;background:var(--bg);position:relative}\
.grf-hd{position:sticky;top:0;z-index:1;display:flex;box-sizing:border-box;min-width:100%;background:var(--bg-paper);border-bottom:1px solid var(--border)}\
.grf-hd div{flex:none;box-sizing:border-box;text-align:center;font-weight:600;padding:4px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
.grf-hd small{display:block;font-weight:400;color:var(--muted);font-size:10.5px}\
svg.grf{display:block}\
.grf text{fill:var(--text);font-size:11px;pointer-events:none}\
.grf .t1{font-weight:600}.grf .t0{font-size:12.5px;font-weight:700}\
.grf .t2{fill:var(--muted);font-size:10px}\
.grf .rd{fill:var(--red);font-size:10.5px}.grf .gr{fill:var(--ok);font-size:10.5px}\
.grf .baand{fill:var(--accent);font-size:10px;font-weight:700;letter-spacing:.08em}\
.grf .baandstreg,.grf .kolstreg{stroke:var(--line-soft);stroke-width:1}\
.grf .overskrift{fill:var(--accent);font-size:10px;font-weight:700;letter-spacing:.08em}\
.grf .kant{stroke:var(--muted);stroke-opacity:.5;stroke-width:1.5;fill:none}\
.grf .kant.forskel{stroke:var(--warn);stroke-opacity:1;stroke-dasharray:5 3}\
.grf .hit{stroke:transparent;stroke-width:10;fill:none}\
.grf .nd{cursor:pointer;outline:none}\
.grf .nd rect.k{stroke-width:1.3}\
.grf .maerke rect{fill:var(--accent)}.grf .maerke text{fill:var(--accent-ink);font-weight:700;font-size:10px}\
.grf .s rect.k{fill:var(--bg-paper)}\
.grf .s.ok rect.k{stroke:var(--ok)}\
.grf .s.mangler rect.k{stroke:var(--red);stroke-width:2}\
.grf .s.neutral rect.k{stroke:var(--border);fill:var(--bg-elev)}\
.grf .s.ukendt{cursor:default}.grf .s.ukendt rect.k{stroke-dasharray:4 3}\
.grf .s.fast{cursor:default}\
.grf .nd[data-h]:hover rect.k,.grf .nd[data-h]:focus-visible rect.k{stroke-width:2.8}\
.grf .nd.i3d rect.k{stroke:var(--text)!important;stroke-width:2}\
.grf .nd.valgt rect.k{stroke:var(--accent)!important;stroke-width:3}\
.grf .mtal circle{fill:var(--red)}.grf .mtal text{fill:var(--bg-paper);font-size:9.5px;font-weight:700}\
.grf .midte rect.k{fill:color-mix(in srgb,var(--accent) 10%,var(--bg-paper));stroke:var(--accent);stroke-width:2.5}\
.grf-detalje{border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-top:8px;background:var(--bg-paper)}\
.grf-dh{display:flex;align-items:baseline;gap:6px}\
.grf-tab{width:100%;border-collapse:collapse;margin:2px 0}\
.grf-tab td{padding:3px 4px;border-top:1px solid var(--line-soft);vertical-align:top}\
.grf-tab td.tal{text-align:right;white-space:nowrap;color:var(--muted)}\
.grf-link{background:none;border:0;padding:0;color:var(--accent);cursor:pointer;font:inherit;text-align:left;text-decoration:underline dotted}\
.grf-diff{color:var(--muted);font-size:11.5px;word-break:break-word}\
.grf-diff b{color:var(--text);font-weight:600}\
";
  var FORKLARING = "Vælg en væg, et dæk, et vindue, en dør eller et rum i 3D, eller klik på en node i Overblik og derefter «Vis sammenhæng». " +
    "Det valgte vises i midten med naboerne omkring: de rum, en bygningsdel afgrænser, de bygningsdele, der afgrænser et rum, naborum, " +
    "vinduer og døre, typen, støj udefra og dine lydmål. Klik på en nabo for at gå videre til den. " +
    "Rum kan vælges i 3D, når «Vis rum» er slået til under Lag.";

  function installer(win) {
    var A0 = win && win.IssanaArbejdsrum;
    if (!A0 || typeof A0.fane !== "function") return false;   // kernen er ikke indlæst: gør ingenting
    if (A0.__grafFane) return true;
    A0.__grafFane = true;
    var doc = win.document;
    var T = {visning: "overblik", kategorier: null, kunProblemer: false, valgtGruppe: null, historik: [], sidsteMidte: null,
      gaarTilbage: false, valgSig: null, rulTil: false, sidstVist: null};
    var cOv = {}, cIx = {}, renderTal = 0;

    function A() { return win.IssanaArbejdsrum; }                 // A.infos udskiftes ved hver model: læs altid friskt
    function V() { var a = A(); return a && a.V ? a.V() : null; }
    function infosNu() { var a = A(); return (a && a.infos) || []; }
    function e(s) { var a = A(); return a && a.esc ? a.esc(s) : esc(s); }
    function tk() { var a = A() || {}; return {status: a.STATUS_TEKST, handling: a.handlingTekst}; }
    function overblik() { var inf = infosNu(); if (cOv.infos !== inf) cOv = {infos: inf, ov: grupperOverblik(inf)}; return cOv.ov; }
    function indeks() { var inf = infosNu(); if (cIx.infos !== inf) cIx = {infos: inf, ix: byggIndeks(inf)}; return cIx.ix; }
    function sikrCss() {
      if (!doc || doc.getElementById("grfCss")) return;
      var st = doc.createElement("style"); st.id = "grfCss"; st.textContent = CSS; doc.head.appendChild(st);
    }
    // Afkort tekst til en bredde i px, målt med visningens skrift (falder tilbage til et skøn pr. tegn)
    var maaler = null, skrift = "sans-serif", passerCache = {};
    function passer(tekst, px, vaegt, str) {
      tekst = String(tekst == null ? "" : tekst);
      var font = (vaegt || 400) + " " + str + "px " + skrift, k = font + "|" + px + "|" + tekst;
      if (passerCache[k] != null) return passerCache[k];
      if (maaler === null) { try { maaler = doc.createElement("canvas").getContext("2d") || false; } catch (x) { maaler = false; } }
      var r;
      if (!maaler) r = kort(tekst, Math.floor(px / (str * 0.58)));
      else {
        maaler.font = font;
        if (maaler.measureText(tekst).width <= px) r = tekst;
        else {
          var lo = 0, hi = tekst.length;
          while (lo < hi) { var m = (lo + hi + 1) >> 1; if (maaler.measureText(tekst.slice(0, m) + "…").width <= px) lo = m; else hi = m - 1; }
          r = tekst.slice(0, lo).replace(/\s+$/, "") + "…";
        }
      }
      return (passerCache[k] = r);
    }
    function midte() { var v = V(), vs = v ? v.valgte() : []; return vs.length ? vs[0] : null; }
    function vaelgFlere(liste) { var v = V(); v.vaelgFlere(liste); T.valgSig = v.valgte().join(","); }
    function vaelgEn(idx, el) { var v = V(), foer = renderTal; v.vaelg(idx); if (renderTal === foer) render(el); }  // valg-krogen gentegner normalt selv
    function kopier(tekst) {
      var v = V();
      var ok = function () { v.info("Kopieret. Sæt teksten ind i en AI-samtale eller et notat."); };
      var reserve = function () {
        var ta = doc.createElement("textarea"); ta.value = tekst; ta.style.position = "fixed"; ta.style.opacity = "0";
        doc.body.appendChild(ta); ta.select(); var r = false;
        try { r = doc.execCommand("copy"); } catch (x) { r = false; }
        ta.remove(); if (r) ok(); else v.fejl("Teksten kunne ikke kopieres.");
      };
      try { if (win.navigator && win.navigator.clipboard && win.navigator.clipboard.writeText) { win.navigator.clipboard.writeText(tekst).then(ok, reserve); return; } }
      catch (x) { /* brug reserven */ }
      reserve();
    }
    function filtrer(o) {
      return o.grupper.filter(function (g) {
        if (T.kategorier && !T.kategorier[g.kategori]) return false;
        if (T.kunProblemer && !(g.mangler.length || g.forskellige || !o.typeAf[g.typeNoegle].ensPaaTvaers)) return false;
        return true;
      });
    }

    function render(el) {
      renderTal++;
      sikrCss();
      var v = V(), infos = infosNu();
      var gl = el.querySelector(".grf-skrol");
      var forrige = {x: gl ? gl.scrollLeft : 0, y: gl ? gl.scrollTop : 0, bd: el.scrollTop, noegle: T.sidstVist};
      if (!v || !infos.length) { el.innerHTML = '<div class="arb-tom">Hent modellen fra Revit først. Så viser grafen bygningsdelene pr. type og etage.</div>'; T.sidstVist = null; return; }
      try { var ff = win.getComputedStyle(el).fontFamily; if (ff && ff !== skrift) { skrift = ff; passerCache = {}; } } catch (x) { /* behold skønnet */ }
      var bredde = Math.max(560, (el.clientWidth || 836) - 24 - 2 - 14);
      var r = T.visning === "sammenhaeng" ? sammenhaeng(v, infos, bredde) : overbliksVisning(v, infos, bredde);
      el.innerHTML = '<div class="grf-rod">' +
        '<div class="grf-top"><div class="grf-skift" role="tablist" aria-label="Visning">' +
        '<button role="tab" data-h="visning" data-v="overblik" class="' + (T.visning === "overblik" ? "on" : "") + '" aria-selected="' + (T.visning === "overblik") + '">Overblik</button>' +
        '<button role="tab" data-h="visning" data-v="sammenhaeng" class="' + (T.visning === "sammenhaeng" ? "on" : "") + '" aria-selected="' + (T.visning === "sammenhaeng") + '">Sammenhæng</button>' +
        '</div><span class="arb-n">' + (r.status || "") + '</span><span class="grf-hoejre">' + (r.knapper || "") + '</span></div>' + r.html + '</div>';
      var rod = el.querySelector(".grf-rod");
      rod.addEventListener("click", function (ev) {
        var t = ev.target && ev.target.closest ? ev.target.closest("[data-h]") : null;
        if (t && rod.contains(t)) handling(t, el);
      });
      rod.addEventListener("keydown", function (ev) {   // skuffen stopper keydown, så visningens genvejstaster ikke ser dem
        var t = ev.target;
        if ((ev.key === "Enter" || ev.key === " ") && t && t.getAttribute && t.getAttribute("data-h") && t.tagName.toLowerCase() === "g") { ev.preventDefault(); handling(t, el); }
      });
      var sk = rod.querySelector(".grf-skrol");
      if (sk) {
        if (r.rulTil) { sk.scrollTop = Math.max(0, r.rulTil.y - sk.clientHeight / 2); sk.scrollLeft = Math.max(0, r.rulTil.x - sk.clientWidth / 2); }
        else if (forrige.noegle === r.noegle) { sk.scrollLeft = forrige.x; sk.scrollTop = forrige.y; }
      }
      el.scrollTop = forrige.noegle === r.noegle ? forrige.bd : 0;
      T.sidstVist = r.noegle;
    }

    function handling(t, el) {
      var h = t.getAttribute("data-h"), val = t.getAttribute("data-v"), v = V(), a = A(), o = overblik();
      var g = T.valgtGruppe ? o.afNoegle[T.valgtGruppe] : null, c, inf, key;
      switch (h) {
        case "visning": T.visning = val === "sammenhaeng" ? "sammenhaeng" : "overblik"; break;
        case "kat":
          if (!val) T.kategorier = null;
          else {
            var k = {}, x;
            if (T.kategorier) for (x in T.kategorier) k[x] = 1;
            if (k[val]) delete k[val]; else k[val] = 1;
            T.kategorier = Object.keys(k).length ? k : null;
          }
          break;
        case "kun": T.kunProblemer = !T.kunProblemer; break;
        case "gruppe": if (o.afNoegle[val]) { T.valgtGruppe = val; vaelgFlere(o.afNoegle[val].idx); } break;
        case "luk": T.valgtGruppe = null; break;
        case "isoler": if (g) { vaelgFlere(g.idx); v.isoler(new Set(g.idx)); v.fokus(); } break;
        case "ophaev": v.isoler(null); return;
        case "afvigere": if (g && g.afvigere.length) vaelgFlere(g.afvigere); break;
        case "mangel": if (g && g.mangler[+val]) vaelgFlere(g.mangler[+val].idx); break;
        case "el": case "nabo": vaelgEn(+val, el); return;
        case "samm": if (g) { T.visning = "sammenhaeng"; vaelgEn(g.idx[0], el); return; } break;
        case "type":
          c = midte(); inf = c != null ? infosNu()[c] : null;
          if (inf) {
            key = typeNoegle(inf) + "¦" + etageAf(inf);
            if (o.afNoegle[key]) { T.valgtGruppe = key; T.rulTil = true; T.visning = "overblik"; vaelgFlere(o.afNoegle[key].idx); }
          }
          break;
        case "tilbage": if (T.historik.length) { T.gaarTilbage = true; vaelgEn(T.historik.pop(), el); return; } break;
        case "zoom": v.fokus(); return;
        case "data":
          if (T.visning === "overblik" && g) vaelgFlere(g.idx);
          else { c = midte(); if (c != null) v.vaelgFlere([c]); }
          a.visFane("data"); return;
        case "kopier-gruppe": if (g) kopier(gruppeTekst(g, infosNu(), o)); return;
        case "kopier-overblik": kopier(overblikTekst(o, filtrer(o))); return;
        case "kopier-samm":
          c = midte(); if (c != null && infosNu()[c]) kopier(sammenhaengTekst(naboer(infosNu(), c, a.byRevitId, indeks()), infosNu(), tk()));
          return;
        default: return;
      }
      render(el);
    }

    /* ----- Overblik ----- */
    function overbliksVisning(v, infos, bredde) {
      var o = overblik();
      if (!o.grupper.length) return {html: '<div class="arb-tom">Modellen har ingen bygningsdele at vise (kun rum).</div>', noegle: "overblik"};
      // Et enkelt element valgt i 3D: åbn dets node
      var vs = v.valgte(), sig = vs.join(",");
      if (sig !== T.valgSig) { T.valgSig = sig; if (vs.length === 1 && o.gruppeAf[vs[0]]) { T.valgtGruppe = o.gruppeAf[vs[0]]; T.rulTil = true; } }
      var i3d = {};
      vs.forEach(function (i) { var k = o.gruppeAf[i]; if (k) i3d[k] = 1; });
      var gr = filtrer(o);
      var h = '<div class="arb-chips grf-chips"><button class="arb-chip' + (T.kategorier ? "" : " on") + '" data-h="kat" data-v="">Alle</button>';
      o.kategorier.forEach(function (k) {
        h += '<button class="arb-chip' + (T.kategorier && T.kategorier[k.navn] ? " on" : "") + '" data-h="kat" data-v="' + e(k.navn) + '">' + e(k.navn) +
          ' <span class="arb-n">' + k.typer + '</span></button>';
      });
      h += '<button class="arb-chip' + (T.kunProblemer ? " on" : "") + '" data-h="kun" title="Vis kun typer, hvor noget mangler, eller hvor dataene er forskellige">Kun mangler og forskelle</button></div>';
      var nT = unikke(gr.map(function (g) { return g.typeNoegle; })).length, nE = 0, nK = 0, nF = 0;
      gr.forEach(function (g) { nE += g.antal; nK += g.komplette; if (g.forskellige) nF++; });
      h += '<div class="arb-hint">' + nT + ' typer · ' + nE + ' elementer · ' + (nE - nK) + ' med mangler · ' + nF + ' noder med forskellige data. ' +
        'Klik på en node for at vælge elementerne i 3D og se, hvad der mangler.</div>';
      h += '<div class="grf-legende"><span><i style="background:var(--ok)"></i>alle uden mangler</span>' +
        '<span><i style="background:var(--warn)"></i>halvdelen</span><span><i style="background:var(--red)"></i>alle mangler noget</span>' +
        '<span><b class="grf-ne">≠2</b>forskellige data inden for typen</span>' +
        '<span><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" style="stroke:var(--muted);stroke-width:1.5"/></svg>samme type, samme data</span>' +
        '<span><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" style="stroke:var(--warn);stroke-width:1.5;stroke-dasharray:5 3"/></svg>samme type, andre data</span></div>';
      var rulTil = null;
      if (!gr.length) h += '<div class="arb-tom">Ingen typer passer til filteret.</div>';
      else {
        var kolB = Math.max(150, Math.min(230, Math.floor((bredde - 16) / Math.max(1, o.etager.length))));
        var L = layoutKolonner(gr, o.etager, {kolonneBredde: kolB});
        var HD = 36;   // højden af etagehovedet over SVG'en
        h += '<div class="grf-skrol"><div class="grf-hd" style="width:' + L.bredde + 'px;padding-left:' + L.venstre + 'px">';
        L.kolonner.forEach(function (k) {
          var gs = gr.filter(function (g) { return g.etage === k.etage; }), n = 0, kk = 0;
          gs.forEach(function (g) { n += g.antal; kk += g.komplette; });
          h += '<div style="width:' + k.b + 'px" title="' + e(k.etage + ": " + gs.length + " typer, " + n + " elementer, " + kk + " uden mangler (" + pct(n ? kk / n : null) + ")") + '">' +
            e(k.etage) + '<small>' + n + ' stk · ' + pct(n ? kk / n : null) + ' uden mangler</small></div>';
        });
        h += '</div><svg class="grf" width="' + L.bredde + '" height="' + L.hoejde + '" viewBox="0 0 ' + L.bredde + ' ' + L.hoejde + '" role="img" aria-label="Netværksdiagram: bygningsdelstyper pr. etage">';
        L.kolonner.forEach(function (k, i) { if (i) h += '<line class="kolstreg" x1="' + k.x + '" y1="0" x2="' + k.x + '" y2="' + L.hoejde + '"/>'; });
        L.baand.forEach(function (b) {
          h += '<line class="baandstreg" x1="0" y1="' + (b.y + b.h - 2) + '" x2="' + L.bredde + '" y2="' + (b.y + b.h - 2) + '"/>' +
            '<text class="baand" x="' + (L.venstre + 2) + '" y="' + (b.y + 15) + '">' + e(String(b.kategori).toUpperCase()) + ' · ' + b.typer + ' TYPE' + (b.typer === 1 ? "" : "R") + '</text>';
        });
        L.kanter.forEach(function (k) {
          var a = L.nodeAf[k.fra].gruppe, b = L.nodeAf[k.til].gruppe;
          var d = "M" + rund(k.x1, 1) + " " + rund(k.y1, 1) + " L" + rund(k.x2, 1) + " " + rund(k.y2, 1);
          h += '<g><title>' + e(a.etiket + ": " + (k.ens ? "samme data" : "forskellige data") + " på " + a.etage + " og " + b.etage) + '</title>' +
            '<path class="hit" d="' + d + '"/><path class="kant' + (k.ens ? "" : " forskel") + '" d="' + d + '"/></g>';
        });
        L.noder.forEach(function (n) { h += overbliksNode(n, T.valgtGruppe === n.noegle, !!i3d[n.noegle]); });
        h += '</svg></div>';
        if (T.rulTil && T.valgtGruppe && L.nodeAf[T.valgtGruppe]) { var rn = L.nodeAf[T.valgtGruppe]; rulTil = {x: rn.x + rn.b / 2, y: rn.y + rn.h / 2 + HD}; }
      }
      T.rulTil = false;
      var g = T.valgtGruppe ? o.afNoegle[T.valgtGruppe] : null;
      h += g ? detaljeHtml(g, o, infos) : '<div class="arb-hint">Klik på en node: elementerne vælges i 3D, og her vises de manglende felter og de elementer, der afviger fra typens flertal.</div>';
      return {html: h, noegle: "overblik", rulTil: rulTil, status: "",
        knapper: '<button class="tbtn" data-h="kopier-overblik" title="Kopiér det viste overblik som tekst, fx til en AI">Kopiér som tekst</button>'};
    }

    function overbliksNode(n, valgt, i3d) {
      var g = n.gruppe, c = komplethedFarve(g.andel);
      var titel = g.etiket + " · " + g.kategori + " · " + g.etage + "\n" + g.antal + " elementer, " + g.komplette + " uden mangler (" + pct(g.andel) + ")" +
        (g.mangler.length ? "\nMangler: " + g.mangler.slice(0, 6).map(function (m) { return m.tekst + " (" + m.antal + ")"; }).join(", ") + (g.mangler.length > 6 ? " …" : "") : "") +
        "\n" + (g.forskellige ? "Data: " + g.varianter.length + " forskellige sæt, " + g.afvigere.length + " afviger fra flertallet" : "Data: ens for alle") +
        (i3d ? "\nIndeholder det valgte i 3D" : "") + "\nKlik for detaljer og for at vælge dem i 3D.";
      var s = '<g class="nd' + (valgt ? " valgt" : "") + (i3d ? " i3d" : "") + '" data-h="gruppe" data-v="' + e(g.noegle) + '" tabindex="0" role="button" aria-label="' +
        e(g.etiket + ", " + g.etage + ", " + g.antal + " stk, " + pct(g.andel) + " uden mangler" + (g.forskellige ? ", forskellige data" : "")) +
        '" transform="translate(' + rund(n.x, 1) + "," + rund(n.y, 1) + ')"><title>' + e(titel) + '</title>' +
        '<rect class="k" width="' + n.b + '" height="' + n.h + '" rx="6" style="fill:' + c + ";fill-opacity:.15;stroke:" + c + '"/>' +
        '<rect width="4" height="' + n.h + '" rx="2" style="fill:' + c + '"/>' +
        '<text class="t1" x="10" y="13">' + e(passer(g.etiket, n.b - 16, 600, 11)) + '</text>' +
        '<text class="t2" x="10" y="26">' + g.antal + " stk · " + pct(g.andel) + '</text>';
      if (g.forskellige) s += '<g class="maerke" transform="translate(' + (n.b - 32) + "," + (n.h - 16) + ')"><rect width="28" height="13" rx="6.5"/><text x="14" y="10" text-anchor="middle">≠' + g.varianter.length + '</text></g>';
      return s + "</g>";
    }

    function detaljeHtml(g, o, infos) {
      var h = '<div class="grf-detalje"><div class="grf-dh"><b>' + e(g.etiket) + '</b><span class="arb-n">' + e(g.kategori) + " · " + e(g.etage) + '</span>' +
        '<button class="arb-x" data-h="luk" title="Luk">×</button></div>';
      h += '<div class="arb-hint">' + g.antal + " elementer · " + g.komplette + " uden mangler (" + pct(g.andel) + ")" + (g.familie ? " · familie " + e(g.familie) : "") + "</div>";
      h += '<div class="arb-row"><button class="tbtn" data-h="isoler">Isolér i 3D</button><button class="tbtn" data-h="ophaev">Ophæv isolering</button>' +
        (g.afvigere.length ? '<button class="tbtn" data-h="afvigere">Vælg afvigerne (' + g.afvigere.length + ")</button>" : "") +
        '<button class="tbtn" data-h="samm">Vis sammenhæng</button><button class="tbtn" data-h="data" title="Vælg elementerne, og åbn fanen Data">Rediger i Data</button>' +
        '<button class="tbtn" data-h="kopier-gruppe" title="Kopiér noden som tekst, fx til en AI">Kopiér som tekst</button></div>';
      h += '<div class="arb-sek">Manglende felter</div>';
      if (!g.mangler.length) h += '<div class="arb-hint">Intet mangler.</div>';
      else h += '<table class="grf-tab">' + g.mangler.map(function (m, j) {
        return '<tr><td><button class="grf-link" data-h="mangel" data-v="' + j + '" title="Vælg de ' + m.antal + ' elementer i 3D">' + e(m.tekst) + '</button></td><td class="tal">' + m.antal + " af " + g.antal + "</td></tr>";
      }).join("") + "</table>";
      h += '<div class="arb-sek">Data</div>';
      var ref = infos[g.varianter[0].idx[0]];
      if (!g.forskellige) h += '<div class="arb-hint">Alle ' + g.antal + " har de samme data.</div>";
      else {
        h += '<div class="arb-hint">' + g.varianter.length + " forskellige sæt data. Flertallet er " + g.varianter[0].idx.length + " af " + g.antal +
          (g.uafgjort ? " (uafgjort: flere sæt er lige store)" : "") + ". Disse afviger:</div>";
        h += '<table class="grf-tab">' + g.afvigere.slice(0, 60).map(function (i) {
          return '<tr><td><button class="grf-link" data-h="el" data-v="' + i + '" title="Vælg i 3D">' + e(elementNavn(infos[i])) + '</button></td><td class="grf-diff">' +
            forskelle(infos[i], ref).map(function (f) { return e(f.tekst) + ": <b>" + e(visVaerdi(f.a, f.sti)) + "</b> (flertal: " + e(visVaerdi(f.b, f.sti)) + ")"; }).join("<br>") + "</td></tr>";
        }).join("") + "</table>" + (g.afvigere.length > 60 ? '<div class="arb-hint">… og ' + (g.afvigere.length - 60) + " mere.</div>" : "");
      }
      var dl = dataListe(ref);
      h += '<div class="arb-sek">' + (g.forskellige ? "Flertallets data" : "Typens data") + "</div>";
      h += dl.length ? '<table class="grf-tab">' + dl.slice(0, 20).map(function (x) { return "<tr><td>" + e(x.tekst) + '</td><td class="grf-diff"><b>' + e(x.vaerdi) + "</b></td></tr>"; }).join("") + "</table>" +
        (dl.length > 20 ? '<div class="arb-hint">… og ' + (dl.length - 20) + " felter mere.</div>" : "")
        : '<div class="arb-hint">Ingen registrerede data.</div>';
      var andre = o.typeAf[g.typeNoegle].grupper.filter(function (x) { return x !== g; });
      if (andre.length) {
        h += '<div class="arb-sek">Samme type på andre etager</div><div class="arb-chips">' + andre.map(function (x) {
          return '<button class="arb-chip" data-h="gruppe" data-v="' + e(x.noegle) + '">' + e(x.etage) + ' <span class="arb-n">' + x.antal + " stk · " +
            (x.flertal === g.flertal ? "samme data" : "andre data") + "</span></button>";
        }).join("") + "</div>";
      }
      return h + "</div>";
    }

    /* ----- Sammenhæng ----- */
    function sammenhaeng(v, infos, bredde) {
      var vs = v.valgte(), c = vs.length ? vs[0] : null, tilbage = T.gaarTilbage;
      T.gaarTilbage = false;
      if (c !== T.sidsteMidte) {
        if (!tilbage && T.sidsteMidte != null && c != null && infos[T.sidsteMidte]) { T.historik.push(T.sidsteMidte); if (T.historik.length > 30) T.historik.shift(); }
        T.sidsteMidte = c;
      }
      var info = c != null ? infos[c] : null;
      if (!info) return {html: '<div class="arb-tom">' + e(FORKLARING) + "</div>", noegle: "samm:"};
      var nb = naboer(infos, c, A().byRevitId, indeks());
      if (!nb) return {html: '<div class="arb-tom">' + e(FORKLARING) + "</div>", noegle: "samm:"};
      var L = layoutSammenhaeng(nb, {bredde: bredde}), t = tk();
      var h = '<div class="arb-row">' + (T.historik.length ? '<button class="tbtn" data-h="tilbage" title="Tilbage til det forrige">← Tilbage</button>' : "") +
        "<b>" + e(kortNavn(info)) + '</b><span class="arb-n">' + e((info.ed.category || "") + " · " + etageAf(info)) + "</span>" +
        (vs.length > 1 ? '<span class="arb-n">' + vs.length + " valgt; viser det første</span>" : "") + "</div>";
      h += '<div class="arb-hint">Rød kant: noget mangler (tallet er antal felter). Hold musen over en node for dens data. Klik på en nabo for at gå videre.</div>';
      h += '<div class="grf-skrol"><svg class="grf" width="' + L.bredde + '" height="' + L.hoejde + '" viewBox="0 0 ' + L.bredde + " " + L.hoejde + '" role="img" aria-label="Sammenhæng for det valgte">';
      L.overskrifter.forEach(function (o) { h += '<text class="overskrift" x="' + o.x + '" y="' + o.y + '" text-anchor="' + o.anker + '">' + e(String(o.tekst).toUpperCase()) + "</text>"; });
      L.kanter.forEach(function (k) { h += '<path class="kant" d="' + k.d + '"/>'; });
      L.noder.forEach(function (n) { h += sammenhaengNode(n, infos, nb, t); });
      var m = L.midte, mm = info.mangler || [];
      h += '<g class="nd midte"><title>' + e(tooltipTekst(info, t)) + "</title>" +
        '<rect class="k" x="' + rund(m.x, 1) + '" y="' + rund(m.y, 1) + '" width="' + m.b + '" height="' + m.h + '" rx="8"/>' +
        '<text class="t0" x="' + rund(m.x + 10, 1) + '" y="' + rund(m.y + 19, 1) + '">' + e(passer(kortNavn(info), m.b - 20, 700, 12.5)) + "</text>" +
        '<text class="t2" x="' + rund(m.x + 10, 1) + '" y="' + rund(m.y + 34, 1) + '">' + e(passer((info.ed.category || "") + " · " + etageAf(info) + (info.ed.id != null ? " · id " + info.ed.id : ""), m.b - 20, 400, 10)) + "</text>" +
        '<text class="' + (mm.length ? "rd" : "gr") + '" x="' + rund(m.x + 10, 1) + '" y="' + rund(m.y + 49, 1) + '">' +
        e(passer(mm.length ? "Mangler: " + mm.map(function (z) { return z.tekst; }).join(", ") : "Intet mangler", m.b - 20, 400, 10.5)) + "</text></g>";
      h += "</svg></div>";
      // Mangler i sammenhængen: det valgte og naboerne
      var set = {}, raekker = [];
      [c].concat(L.noder.map(function (n) { return n.idx; })).forEach(function (j) {
        if (j == null || set[j]) return; set[j] = 1;
        var inf = infos[j];
        if (inf && inf.mangler && inf.mangler.length) raekker.push('<tr><td>' + (j === c ? "<b>" + e(elementNavn(inf)) + "</b>" : '<button class="grf-link" data-h="nabo" data-v="' + j + '">' + e(elementNavn(inf)) + "</button>") +
          '</td><td class="grf-diff">' + e(inf.mangler.map(function (z) { return z.tekst; }).join(", ")) + "</td></tr>");
      });
      h += '<div class="arb-sek">Mangler i sammenhængen</div>' + (raekker.length ? '<table class="grf-tab">' + raekker.join("") + "</table>" : '<div class="arb-hint">Intet mangler for det valgte og dets naboer.</div>');
      return {html: h, noegle: "samm:" + c, status: "",
        knapper: '<button class="tbtn" data-h="zoom" title="Zoom til det valgte i 3D">Zoom til i 3D</button>' +
          '<button class="tbtn" data-h="data" title="Åbn det valgte i fanen Data">Rediger i Data</button>' +
          '<button class="tbtn" data-h="kopier-samm" title="Kopiér sammenhængen som tekst, fx til en AI">Kopiér som tekst</button>'};
    }

    function sammenhaengNode(n, infos, nb, t) {
      var inf = n.idx != null ? infos[n.idx] : null, r = n.ref, l1 = "", l2 = "", titel = "", hh = null, vv = null, ukendt = false;
      var sider = function (s, efter) { return s && s.length ? s.map(function (x) { return SIDE_FOR_RUM[x] || x; }).join("/") + (efter || "") : ""; };
      var led = function (a) { return a.filter(Boolean).join(" · "); };
      if (n.art === "del") {
        if (inf) { l1 = kortNavn(inf); l2 = led([inf.ed.category, fmtTal(r.areal) + " m²", sider(r.sider)]); }
        else { ukendt = true; l1 = "Revit-id " + r.revitId; l2 = led(["ikke i 3D", fmtTal(r.areal) + " m²", sider(r.sider)]); titel = "Bygningsdelen med Revit-id " + r.revitId + " afgrænser rummet, men er ikke med i 3D-modellen."; }
        if (inf) titel = tooltipTekst(inf, t) + "\n\nAfgrænser rummet: " + fmtTal(r.areal) + " m² (" + sider(r.sider) + ")";
      } else if (n.art === "naborum") {
        l1 = kortNavn(inf); l2 = led([etageAf(inf), r.retning.map(function (x) { return RETNING_TEKST[x] || x; }).join("/"), "via " + r.via.length]);
        titel = tooltipTekst(inf, t) + "\n\nNaborum via: " + r.via.map(function (x) { return x.idx != null ? elementNavn(infos[x.idx]) : "Revit-id " + x.revitId; }).join(", ");
      } else if (n.art === "rum") {
        if (inf) { l1 = kortNavn(inf); l2 = led([etageAf(inf), r.areal ? fmtTal(r.areal) + " m²" : "", sider((r.sider || []).filter(function (x) { return x !== "side"; }), " i rummet")]); titel = tooltipTekst(inf, t); }
        else { ukendt = true; l1 = "Rum " + (r.revitId != null ? r.revitId : ""); l2 = "ikke i 3D"; titel = "Rummet med Revit-id " + r.revitId + " er ikke med i 3D-modellen."; }
      } else if (n.art === "aabning") {
        l1 = kortNavn(inf); l2 = led([inf.ed.category, etageAf(inf)]); titel = tooltipTekst(inf, t);
        if (nb.art === "rum" && r.vaertId != null && r.vaert == null) titel += "\n\nSidder i Revit-id " + r.vaertId + " (ikke i 3D)";
      } else if (n.art === "vaert") {
        if (inf) { l1 = kortNavn(inf); l2 = led(["sidder i", inf.ed.category]); titel = tooltipTekst(inf, t); }
        else { ukendt = true; l1 = "Revit-id " + r.revitId; l2 = "vært, ikke i 3D"; titel = "Værten med Revit-id " + r.revitId + " er ikke med i 3D-modellen."; }
      } else if (n.art === "type") {
        l1 = r.navn; l2 = "Type · " + r.antal + " stk på " + r.etager.length + " etage" + (r.etager.length === 1 ? "" : "r");
        titel = "Typen " + r.navn + (r.familie ? " (" + r.familie + ")" : "") + ": " + r.antal + " stk på " + r.etager.join(", ") + ".\nKlik for at se typen i Overblik.";
        hh = "type"; vv = "";
      } else if (n.art === "stoej") {
        l1 = "Støj udefra"; l2 = fmtTal(r.vaerdi) + " dB" + (r.kilde === "facadevaeg" ? " (facadevæg)" : "");
        titel = "Støj udefra: " + (r.tekst || fmtTal(r.vaerdi) + " dB") + (r.kilde === "facadevaeg" ? "\nHøjeste værdi registreret på facadevæggene: " + r.via.map(function (i) { return elementNavn(infos[i]); }).join(", ") : "");
      } else if (n.art === "lydmaal") {
        l1 = "Lydmål (dine)"; l2 = r.tekst; titel = "Dine lydmål: " + r.tekst;
      }
      if (inf && n.idx != null) { hh = "nabo"; vv = String(n.idx); titel += "\n\nKlik for at gøre den til midte."; }
      var mangler = inf ? (inf.mangler || []).length : 0;
      var kls = "nd s s-" + n.art + (inf ? (mangler ? " mangler" : " ok") : " neutral") + (ukendt ? " ukendt" : "") + (hh ? "" : " fast");
      var s = '<g class="' + kls + '"' + (hh ? ' data-h="' + hh + '" data-v="' + e(vv) + '" tabindex="0" role="button" aria-label="' + e(l1 + ", " + l2) + '"' : "") +
        ' transform="translate(' + rund(n.x, 1) + "," + rund(n.y, 1) + ')"><title>' + e(titel) + "</title>" +
        '<rect class="k" width="' + n.b + '" height="' + n.h + '" rx="6"/>' +
        '<text class="t1" x="9" y="14">' + e(passer(l1, n.b - (mangler ? 32 : 16), 600, 11)) + "</text>" +
        '<text class="t2" x="9" y="27">' + e(passer(l2, n.b - 16, 400, 10)) + "</text>";
      if (mangler) s += '<g class="mtal" transform="translate(' + (n.b - 12) + ',12)"><circle r="8"/><text y="3.5" text-anchor="middle">' + mangler + "</text></g>";
      return s + "</g>";
    }

    A0.fane({id: "graf", titel: "Graf", bred: true, valg: true, render: render,
      model: function () { T.valgtGruppe = null; T.historik = []; T.sidsteMidte = null; T.valgSig = null; T.rulTil = false; T.sidstVist = null; cOv = {}; cIx = {}; }});
    return true;
  }

  return {
    KAT_ORDEN: KAT_ORDEN.slice(),
    UDEN_ETAGE: UDEN_ETAGE,
    sorterEtager: sorterEtager,
    sorterKategorier: sorterKategorier,
    typeNoegle: typeNoegle,
    fingeraftryk: fingeraftryk,
    normalPost: normalPost,
    forskelle: forskelle,
    dataListe: dataListe,
    varianter: varianter,
    grupperOverblik: grupperOverblik,
    layoutKolonner: layoutKolonner,
    byggIndeks: byggIndeks,
    naboer: naboer,
    layoutSammenhaeng: layoutSammenhaeng,
    lydmaalTekst: lydmaalTekst,
    tooltipTekst: tooltipTekst,
    gruppeTekst: gruppeTekst,
    overblikTekst: overblikTekst,
    sammenhaengTekst: sammenhaengTekst,
    komplethedFarve: komplethedFarve,
    installer: installer
  };
});
