/* ISSANA 3D: rapporten «Statisk redegørelse» i Typst. Regner intet selv: tallene kommer fra panelet Laster (statik-lastmodel.js), så rapport
   og panel ikke kan være uenige. Rækkefølgen følger en statisk projektredegørelse (bygværket, organisation, statisk system, laster,
   regneeksempler, dokumentation); organisationsdata er felter, brugeren udfylder. Standardernes tekst er ikke kopieret, formlerne står i egen notation.
   Browser: window.IssanaStatikRapport. Node: module.exports. R er rapport-typst.js. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else root.IssanaStatikRapport = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  var TOM = "________________";

  function fig1(R, p, tekst, bredde) { return "#figure(image(bytes(\"" + R.str(p.svg) + "\"), format: \"svg\", width: " + (bredde || p.bredde) + "mm), caption: [" + R.esc(tekst) + "])\n\n"; }
  function figPar(R, a, b, tekst) { return "#figure(grid(columns: (1fr, 1fr), gutter: 6mm, align: horizon, image(bytes(\"" + R.str(a.svg) + "\"), format: \"svg\", width: 100%), image(bytes(\"" + R.str(b.svg) + "\"), format: \"svg\", width: 100%)), caption: [" + R.esc(tekst) + "])\n\n"; }

  function lav(R, d) {
    var L = d.L, S = d.S, m = d.model || {}, form = d.form, felt = d.felt, res = d.res, ind = d.ind, geo = d.geo, valg = d.valg, V = d.vurdering, org = ind.org || {};
    if (d.vindzoner && d.vindzoner.vind) {
      var vindRes = {};
      ["n", "o", "s", "v"].forEach(function (r) { vindRes[r] = d.vindzoner.vind(form, ind, r); });
      res = Object.assign({}, res, { vind: vindRes });
    }
    var K = L.K, ov = R.overskrift, afs = R.afsnit, tb = R.tabel, tal = R.tal, mt = R.mt, eks = R.regneeksempel;
    var felt_ = function (k) { var v = String(org[k] == null ? "" : org[k]).trim(); return v || TOM; };
    var dk = function (x, n) { return x == null ? "–" : tal(x, n == null ? 2 : n); };
    var t = "#block(stroke: 1.2pt + rgb(\"#b3261e\"), inset: 9pt, radius: 3pt, width: 100%)[*Forbehold.* " + R.esc("Dette er en forenklet vurdering til undervisning og tidlige faser. Det er ikke en statisk beregning. Ingeniøren skal godkende alt indhold, før det bruges. Tal, der ikke kan læses af modellen eller findes i standarden, står som «skal angives af ingeniøren».") + "]\n\n";

    /* ---------- 1 Bygværket ---------- */
    var B = form.boks, pl = m.placering || {}, antal = (geo && geo.etager) ? geo.etager.length : form.niveauer.length;
    t += ov("Bygværket", 1) + ov("Art, funktion og placering", 2);
    t += tb({ kolonner: ["Oplysning", "Værdi"], justering: ["left", "left"], raekker: [
      ["Bygværkets navn", felt_("byggeri")], ["Adresse", felt_("adresse")], ["Anvendelse", felt_("funktion")],
      ["Placering i modellen", pl.stednavn || TOM], ["Længde og bredde (ydre mål)", dk(form.laengde, 1) + " m og " + dk(form.bredde, 1) + " m"],
      ["Højde over terræn", dk(form.h, 1) + " m"], ["Terrænkote", dk(form.terraen, 2) + " m"], ["Etager i modellen", String(antal)] ] });
    t += ov("Opbygning", 2);
    t += afs("Bygværkets opbygning er læst af modellen. Materialer og lag står, som de er i modellen.");
    var pr = {}; (felt || []).forEach(function (f) { if (f.terraen || f.typeId == null) return; var k = f.typeId; (pr[k] || (pr[k] = { navn: f.navn, etager: {}, tag: false, areal: 0 })); pr[k].etager[f.etage] = 1; pr[k].tag = pr[k].tag || f.erTag; pr[k].areal += f.areal; });
    t += tb({ kolonner: ["Dæk og tag", "Etage", "Areal (m²)", "Lag i modellen"], justering: ["left", "left", "right", "left"], raekker: Object.keys(pr).length ? Object.keys(pr).map(function (k) { var e = res.egen.pr[k], x = pr[k]; return [x.navn + (x.tag ? " (tag)" : ""), Object.keys(x.etager).join(", "), tal(x.areal, 0), e && e.lag.length ? e.lag.map(function (l) { return l.navn + " " + tal(l.mm, 0) + " mm"; }).join("; ") : "Ingen lag i modellen"]; }) : [["Ingen dæk fundet", "", "", ""]] });
    if (geo && geo.vaegge.length) {
      var g = {}; geo.vaegge.forEach(function (w) { var k = w.type || w.navn; (g[k] || (g[k] = { n: 0, l: 0 })); g[k].n++; g[k].l += w.laengde; });
      var rk = Object.keys(g).sort(function (a, b) { return g[b].l - g[a].l; }).slice(0, 10).map(function (k) { return [k, String(g[k].n), tal(g[k].l, 1)]; });
      t += tb({ kolonner: ["Vægge (de 10 længste typer)", "Antal", "Længde (m)"], justering: ["left", "right", "right"], raekker: rk });
    }

    /* ---------- 2 Organisation ---------- */
    t += ov("Organisation", 1) + ov("Organisationsstruktur", 2);
    t += tb({ kolonner: ["Rolle", "Navn"], justering: ["left", "left"], raekker: [["Bygherre", felt_("bygherre")], ["Arkitekt", felt_("arkitekt")], ["Rådgivende ingeniør", felt_("ingenioer")], ["Certificeret statiker", felt_("statiker")], ["Ansvarlig statiker", felt_("ansvarlig")], ["Konstruktionsklasse", felt_("klasse")], ["Sagsnummer", felt_("sag")]] });
    t += ov("Fordeling af projekteringsansvar", 2);
    t += tb({ kolonner: ["Konstruktionsafsnit", "Projekterende", "Grænseflader"], justering: ["left", "left", "left"], raekker: ["Tag", "Etageadskillelser", "Bærende og stabiliserende vægge", "Søjler og bjælker", "Fundamenter og terrændæk"].map(function (x) { return [x, TOM, TOM]; }) });

    /* ---------- 3 Bærende og stabiliserende system ---------- */
    t += ov("Bærende og stabiliserende system", 1);
    t += afs("Dæk, der er sat med spændretning i Statik, hviler på de tunge vægge på tværs af retningen. Vægge afstiver i deres egen retning. Figurerne viser væggene og dækkenes spændretning som dobbeltpile. Grå vægge er ikke defineret.");
    var harR = V && Object.keys(V.res).length;
    if (!harR) t += R.note("Der er endnu ikke sat spændretning eller vægroller i Statik, så det bærende og stabiliserende system er ikke defineret. Det gøres under fanen Statik.");
    var etager = (geo && geo.etager) || [];
    if (S && harR) {
      var brugt = {}; Object.keys(V.res).forEach(function (id) { brugt[V.res[id]] = 1; });
      t += Object.keys(brugt).map(function (k) { return "#box(fill: rgb(\"" + S.farve(k) + "\"), stroke: 0.4pt + luma(150), width: 8pt, height: 8pt, baseline: 1pt) #h(3pt) #text(8.5pt)[" + R.esc(S.statikTekst(k)) + "] #h(10pt) "; }).join("") + "\n\n";
    }
    etager.forEach(function (e) {
      if (!S || !V) return;
      var farver = {}; Object.keys(V.res).forEach(function (id) { farver[id] = S.farve(V.res[id]); });
      var w = L.vaeggeSomTrekanter(m, e, farver), over = L.daekOver(form, geo, e), sp = over ? L.spaendmaerker(form, felt, geo, valg, over) : [];
      if (!w.length) return;
      var p = L.planSvg(form, felt, res, { tilf: null, vaegge: w, spaend: sp, maksH: 95 });
      t += ov(e, 2) + fig1(R, p, e + ": vægge og spændretning for dækket over etagen" + (over && over !== e ? ", niveau " + over : ""));
      if (harR) {
        var ch = S.tjek(geo, V, e);
        t += tb({ kolonner: ["Tjek", "Status", "Beskrivelse"], justering: ["left", "left", "left"], raekker: ch.map(function (c) { return [c.titel, { ok: "OK", advarsel: "Advarsel", mangler: "Mangler", info: "Info" }[c.status] || c.status, c.tekst.length > 420 ? c.tekst.slice(0, 420) + " … (se hele listen i fanen Statik)" : c.tekst]; }) });
      }
    });

    /* ---------- 4 Laster ---------- */
    t += ov("Laster", 1);
    t += afs("Figurerne viser lasterne som pile, der peger mod bygningen. Pilene følger bygningens omrids og tag i modellen. Værdierne er karakteristiske værdier. Lastkombinationer er ikke regnet her.");
    var vR = ["n", "o", "s", "v"].map(function (r) { return res.vind[r]; });
    t += tb({ kolonner: ["Last", "Værdi", "Kilde"], justering: ["left", "right", "left"], raekker:
      [["Sne på tag", res.sne.s == null ? L.SKAL : dk(res.sne.s) + " kN/m²", K.sk + "; " + K.mu]]
        .concat(vR.map(function (v) { return ["Vind fra " + v.navn + ", netto", v.wN == null ? L.SKAL : dk(v.wN) + " kN/m²", K.qp + "; " + K.cpe]; }))
        .concat(Object.keys(res.nytte).map(function (e) { var n = res.nytte[e]; return ["Nyttelast, " + e + (n.katNavn ? " (" + n.katNavn + ")" : ""), n.ialt == null ? L.SKAL : dk(n.ialt, 1) + " kN/m²", n.kilde]; }))
        .concat(Object.keys(res.egen.pr).map(function (k) { var e = res.egen.pr[k]; return ["Egenlast, " + e.navn, e.g == null ? L.SKAL : dk(e.g) + " kN/m²", e.kilde]; }))
    });

    t += ov("Egenlast", 2);
    var fig = function (tilf, et, tekst) { var p = L.planSvg(form, felt, res, { tilf: tilf, etage: et, maksH: 90 }), f = L.facadeSvg(form, felt, res, { tilf: tilf, etage: et, maksH: 70 }); return figPar(R, p, f, tekst); };
    t += afs("Egenlasten af dæk og tag er lagenes tykkelse gange deres effektive tyngde. Væggenes egenlast er ikke med i pilene.");
    Object.keys(res.egen.pr).forEach(function (k) { var e = res.egen.pr[k]; t += tb({ kolonner: [e.navn, "t (mm)", "γ (kN/m³)", "kN/m²", "Kilde"], justering: ["left", "right", "right", "right", "left"], raekker: e.lag.length ? e.lag.map(function (l) { return [l.navn, tal(l.mm, 0), l.gamma == null ? L.SKAL : dk(l.gamma, 1), l.last == null ? "–" : dk(l.last), l.kildeKort || ""]; }).concat([["I alt", "", "", e.g == null ? "–" : dk(e.g), e.hul ? e.hul + " lag mangler" : ""]]) : [["Ingen lag i modellen", "", "", "", ""]] }); });
    var etagerF = {}; (felt || []).forEach(function (f) { if (!f.terraen) etagerF[f.etage] = 1; });
    var foerste = Object.keys(etagerF)[0];
    if (foerste) t += fig("egen", foerste, "Egenlast som pile på dæk og tag. Planen viser " + foerste + ". Kryds i cirkel er last, der går nedad.");

    t += ov("Nyttelast", 2);
    t += afs("Nyttelasten vælges pr. etage efter brugskategori. Den kan ikke aflæses af modellen.");
    var ner = Object.keys(res.nytte);
    t += tb({ kolonner: ["Etage", "Kategori", "q_k (kN/m²)", "Q_k (kN)", "Tillæg (kN/m²)", "I alt (kN/m²)"], justering: ["left", "left", "right", "right", "right", "right"], raekker: ner.length ? ner.map(function (e) { var n = res.nytte[e]; return [e, n.katNavn || L.SKAL, n.q == null ? "–" : dk(n.q, 1), n.Q == null ? "–" : dk(n.Q, 1), n.skille == null ? "–" : dk(n.skille, 1), n.ialt == null ? L.SKAL : dk(n.ialt, 1)]; }) : [["Ingen dæk", "", "", "", "", ""]] });
    ner.forEach(function (e) { t += fig("nytte", e, "Nyttelast på " + e + ", pile mod dækket i plan og snit."); });

    t += ov("Snelast", 2);
    if (res.sne.mangler.length) t += R.note("Snelasten er ikke regnet, fordi dette mangler: " + res.sne.mangler.join(", ") + ". " + L.SKAL + ".");
    t += fig("sne", null, "Sne på tag, pile mod den øverste flade i modellen.");

    t += ov("Vindlast", 2);
    t += afs("Vinden er vist fra alle fire sider. Pilene stopper ved den første flade, de rammer i modellen. Tallet er nettolasten på facaden, hvor tryk og sug er lagt sammen.");
    t += tb({ kolonner: ["Vind fra", "h/d", "c_pe,D", "c_pe,E", "q_p", "Tryk", "Sug", "Netto", "A (m²)", "F (kN)"], justering: ["left", "right", "right", "right", "right", "right", "right", "right", "right", "right"], raekker: vR.map(function (v) { return [v.navn, dk(v.hd), dk(v.cD), dk(v.cE), dk(v.qp), dk(v.wD), dk(v.wE), dk(v.wN), tal(v.A, 0), dk(v.F, 0)]; }) });
    ["n", "o", "s", "v"].forEach(function (r) { t += fig("vind-" + r, null, "Vind fra " + L.RETNING[r].navn + ": pile mod facaden i plan og snit."); });
    // Vindens tryk og sug på zoner (statik-vindzoner.js), for den retning, der giver det største hastighedstryk.
    var VZ = d.vindzoner, zr = null;
    if (VZ && d.zoner) {
      zr = ["n", "o", "s", "v"].map(function (r) { return d.zoner[r]; }).filter(function (z) { return z && typeof z.qp === "number" && isFinite(z.qp); }).sort(function (a, b) { return b.qp - a.qp; })[0] || null;
      t += ov("Vindens tryk og sug på zoner", 2);
      if (zr) {
        var fr = zr.friktion;
        t += afs("Trykket er ikke ens over hele bygningen. Væggene er delt i zone A til E og taget i zone F til J, og hver zone har sin formfaktor. Tabellen og figuren viser vind fra " + zr.navn + ", som giver det største hastighedstryk. Plus er tryk mod fladen, minus er sug væk fra den. " + VZ.tagTekst(zr) + ".");
        t += R.note("Zoneafsnittet viser kun én vindretning. Størst hastighedstryk er ikke nødvendigvis størst tryk eller sug på hver zone, fordi tagets formfaktorer afhænger af retningen. Dette er ikke en dimensionsgivende sammenstilling. Kontrollér zonerne for alle fire vindretninger i 3D-panelet.");
        t += tb({ kolonner: ["Zone", "Hvor", "c_pe,10", "w (kN/m²)"], justering: ["left", "left", "right", "right"],
          raekker: VZ.raekker(zr).map(function (x) { return [x.zone, VZ.hvor(zr, x), VZ.fortegn(x.cpe, 2) + (x.cpeAlt != null ? " / " + VZ.fortegn(x.cpeAlt, 2) : ""), VZ.fortegn(x.w) + (x.wAlt != null ? " / " + VZ.fortegn(x.wAlt) : "")]; })
            .concat(fr.aktiv ? [["fr", "siderne og taget, " + dk(fr.start, 1) + " til " + dk(zr.d, 1) + " m fra vindsiden", fr.cfr == null ? L.SKAL : "c_fr = " + dk(fr.cfr), fr.w == null ? L.SKAL : dk(fr.w, 3)]] : []) });
        t += fig1(R, VZ.svg(form, zr, { maksH: 120 }), "Vindzoner, vind fra " + zr.navn + ": bygningen foldet ud. Taget i midten, siderne til venstre og højre, vindsiden nederst og læsiden øverst.");
        t += R.punkter(zr.noter.concat([fr.kanUdelades ? "Friktion er udeladt: fladerne langs vinden (" + dk(fr.Alangs, 0) + " m²) er højst 4 gange fladerne på tværs (" + dk(fr.Atvaers, 0) + " m²)." : fr.aktiv ? "Friktion virker langs vinden bag " + dk(fr.start, 1) + " m fra vindsiden, det mindste af 2b og 4h." : "Ingen flade ligger længere fra vindsiden end " + dk(fr.start, 1) + " m, så der er ingen friktion at regne.",
          "Kilder: " + VZ.K.vaeg + "; " + zr.tagKilde + "; " + VZ.K.zoner + (fr.aktiv ? "; " + VZ.K.cfr : fr.kanUdelades ? "; " + VZ.K.udelad : "") + "."]));
      } else {
        var manglerVind = [];
        ["n", "o", "s", "v"].forEach(function (r) { var z = d.zoner[r]; if (z) (z.mangler || []).forEach(function (m) { if (manglerVind.indexOf(m) < 0) manglerVind.push(m); }); });
        t += R.note("Vindens tryk på zoner er ikke regnet. Manglende eller ugyldigt grundlag: " + (manglerVind.join(", ") || "hastighedstryk q_p") + ". " + L.SKAL + ".");
      }
    }

    /* ---------- 5 Formler og regneeksempler ---------- */
    t += ov("Formler og regneeksempler", 1);
    t += afs("Eksemplerne bruger modellens egne tal. Formlerne står i egen notation; værdierne og metoden er fra de nævnte standarder.");
    var bedst = null; vR.forEach(function (v) { if (v.wN != null && (!bedst || v.F > bedst.F)) bedst = v; });
    if (bedst) {
      var v = bedst, iv = ind.vind;
      t += eks({ titel: "Peakhastighedstryk, vind fra " + v.navn, hvorfor: "Hastighedstrykket afhænger af stedets vind, terrænets ruhed og højden. Her er det regnet i bygningens højde, og det gælder hele facaden.",
        formel: 'q_"p" = (1 + 7 I_"v") dot 1/2 rho (c_"r" c_"o" v_"b")^2',
        symboler: [['v_"b"^2', "basisvindhastigheden i anden potens: retningsfaktor gange årstidsfaktor gange grundværdi (m²/s²)"], ['c_"r"', "ruhedsfaktor: k_r gange logaritmen til z/z_0"], ['I_"v"', "turbulensintensitet"], ['c_"o"', "orografifaktor"], ['rho', "luftens densitet (kg/m³)"]],
        indsat: 'v_"b"^2 = ' + mt(v.cdir2, 3) + ' dot ' + mt(iv.cseason2, 3) + ' dot ' + mt(iv.vb0, 3) + '^2 = ' + mt(v.vb * v.vb, 5) + ' quad q_"p" = (1 + 7 dot ' + mt(v.Iv, 3) + ') dot 1/2 dot ' + mt(iv.rho, 3) + ' dot (' + mt(v.cr, 3) + ' dot ' + mt(v.co, 3) + ')^2 dot ' + mt(v.vb * v.vb, 5),
        resultat: mt(v.qp * 1000, 4) + ' "N/m²" = ' + mt(v.qp, 3) + ' "kN/m²"', kilde: K.qp + " (" + K.terraen + ")" }, 2);
      t += eks({ titel: "Tryk og sug på facaden", hvorfor: "Vindsiden får tryk og læsiden sug. Formfaktorerne afhænger af forholdet mellem højde og dybde. Når tryk og sug lægges sammen, må de ikke regnes fuldt samtidige.",
        formel: 'w_"net" = c_"s" c_"d" dot f dot q_"p" (c_"pe,D" - c_"pe,E")',
        symboler: [['c_"pe,D"', "formfaktor på vindsiden"], ['c_"pe,E"', "formfaktor på læsiden"], ["f", "faktor for manglende samtidighed"], ['c_"s" c_"d"', "konstruktionsfaktor"]],
        indsat: mt(v.cs, 3) + ' dot ' + mt(v.kor, 3) + ' dot ' + mt(v.qp, 3) + ' dot (' + mt(v.cD, 3) + ' - (' + mt(v.cE, 3) + '))', resultat: mt(v.wN, 3) + ' "kN/m²"', kilde: K.cpe + "; " + K.kor + "; " + K.cscd }, 2);
      t += eks({ titel: "Samlet vandret last", hvorfor: "Facadens areal er målt op til bygningens silhuet i modellen, altså de faktiske højder og det faktiske omrids.",
        formel: 'F = w_"net" dot A', symboler: [["A", "facadens areal mod vinden (m²)"]], indsat: mt(v.wN, 3) + ' dot ' + mt(v.A, 4), resultat: mt(v.F, 4) + ' "kN"', kilde: "Egen sammenlægning af ovenstående" }, 2);
      if (S && harR) {
        var filt = v.ret === "n" || v.ret === "s" ? "nord" : "oest", et0 = etager[0], liste = et0 ? S.andel(geo, V, filt, et0) : [];
        if (liste.length) { var a = liste[0];
          t += eks({ titel: "Andel på én væg", hvorfor: "Lasten er fordelt efter længden af de afstivende vægge uden døre og vinduer. Det er forenklet: en lang væg tager i virkeligheden mere.",
            formel: 'F_i = F dot L_i / (sum L_j)', symboler: [['L_i', "væggens effektive længde (m)"], ['sum L_j', "summen af de afstivende vægges effektive længde (m)"]],
            indsat: mt(v.F, 4) + ' dot ' + mt(a.andel, 3), resultat: mt(v.F * a.andel, 4) + ' "kN"', kilde: "Forenklet fordeling, ISSANA Statik" }, 2); }
      }
    } else {
      var manglerLast = [];
      vR.forEach(function (v) { (v.mangler || []).forEach(function (m) { if (manglerLast.indexOf(m) < 0) manglerLast.push(m); }); });
      t += R.note("Vindlasten er ikke regnet. Manglende eller ugyldigt grundlag: " + (manglerLast.join(", ") || "vindens input") + ". " + L.SKAL + ".");
    }
    if (res.sne.s != null) { var s = res.sne;
      t += eks({ titel: "Snelast på taget", hvorfor: "Snelasten er terrænværdien ganget med formfaktor, eksponering og termisk faktor. Taghældningen er aflæst af modellen.", formel: 's = mu_1 dot C_"e" dot C_"t" dot s_"k"', symboler: [['mu_1', "formfaktor"], ['C_"e"', "eksponeringsfaktor: topografi gange størrelse"], ['C_"t"', "termisk faktor"], ['s_"k"', "terrænværdi (kN/m²)"]], indsat: mt(s.mu, 3) + ' dot ' + mt(s.ce, 3) + ' dot ' + mt(s.ct, 3) + ' dot ' + mt(s.sk, 3), resultat: mt(s.s, 3) + ' "kN/m²"', kilde: K.sk + "; " + K.ce + "; " + K.ct + "; " + K.mu }, 2); }
    var eg = Object.keys(res.egen.pr).map(function (k) { return res.egen.pr[k]; }).filter(function (e) { return e.g != null && e.lag.length; })[0];
    if (eg) {
      var lags = eg.lag.filter(function (l) { return l.mm > 0; });
      t += eks({ titel: "Egenlast af «" + eg.navn + "»", hvorfor: "Egenlasten er summen af hvert lags tykkelse gange lagets effektive tyngde.", formel: 'g = sum_i gamma_i dot t_i', symboler: [['gamma_i', "effektiv tyngde (kN/m³)"], ['t_i', "lagets tykkelse (m)"]], indsat: lags.map(function (l) { return mt(l.gamma, 3) + ' dot ' + mt(l.mm / 1000, 3); }).join(' + '), resultat: mt(eg.g, 3) + ' "kN/m²"', kilde: K.gamma }, 2);
    }

    /* ---------- 6 Dokumentation ---------- */
    t += ov("Dokumentationens omfang", 1);
    t += afs("Denne redegørelse er en del af projektdokumentationen. Den samlede statiske dokumentation består normalt af disse dele, som udarbejdes af ingeniøren:");
    t += R.punkter(["Konstruktionsgrundlag", "Statiske beregninger", "Konstruktionstegninger og modeller", "Statisk projektredegørelse", "Statisk kontrolplan for projektering og udførelse", "Statisk kontrolrapport"]);
    t += ov("Det, der ikke er med", 2);
    t += R.punkter([
      "Lastkombinationer efter DS/EN 1990 og partialkoefficienter er ikke regnet.",
      zr ? "Vindens tryk og sug på zoner er vist for sig og er ikke lagt sammen til en kraft. Indvendigt vindtryk er ikke med." : "Vindsug på tag (zone F til I) og indvendigt vindtryk er ikke med.",
      "Sneophobning ved brystninger, ovenlys og niveauspring er ikke med. Det samme gælder lastopstillingen for læsiden af sadeltage.",
      "Vind er regnet med formfaktorer for rektangulære bygninger, også for skæve og uregelmæssige bygninger.",
      "Væggenes egenlast, punktlaster og ulykkeslast er ikke med.",
      "Pilene viser, hvor lasten rammer, ikke hvordan den fordeler sig i konstruktionen."]);
    t += R.note("Forbehold: Forenklet vurdering. Ingeniøren skal godkende.");
    return R.dokument({ titel: "Statisk redegørelse", undertitel: "Laster, bærende og stabiliserende system", projekt: org.byggeri || m.model || "", dato: d.dato || "", tekst: t, kilder: [
      "DS/EN 1991-1-1 med DK NA:2024: nyttelast (tabel 6.2 og 6.4), effektiv tyngde (anneks A), lette skillevægge (pkt. 5.2.2(2)P).",
      "DS/EN 1991-1-3 med DK NA:2024: terrænværdi (pkt. 4.1(1)), eksponering (pkt. 5.2(7), tabel 5.1.a), termisk faktor (pkt. 5.2(8)), formfaktor (tabel 5.2).",
      "DS/EN 1991-1-4 med DK NA:2024: basisvind (pkt. 4.2, tabel 1a og 1b), terræn (tabel 4.1), hastighedstryk (formel 4.3 til 4.10), formfaktorer (tabel 7.1), konstruktionsfaktor (pkt. 6.2).",
      "ISSANA MCP: 3D-eksporten (issana-3d) og Statik-fanens spændretninger og vægroller."] });
  }
  function filnavn(model) { return "statisk-redegoerelse-" + (String(model || "model").replace(/[^\wæøåÆØÅ-]+/g, "_").replace(/^_+|_+$/g, "") || "model") + ".typ"; }
  return { lav: lav, filnavn: filnavn };
});
