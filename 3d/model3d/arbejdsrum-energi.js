/* ISSANA 3D, arbejdsrummet: fanen Energi.
   Seks underfaner: Overblik, Klimaskærm, Vinduer og skygge, Ventilation og forsyning, Sommerkomfort, Beregn og eksportér.
   Data: energi-fra-model.js (fra 3D-eksporten) eller en XML fra Energy Design (energi-be18.js). Tallene regnes af energi-beregning.js.
   Fanen skriver intet i Revit. Rettelser gemmes lokalt i browserprofilen pr. model (localStorage, nøgle issana-energi-<modelKey>).
   Forhåndsberegningen er ikke dokumentation; det endelige tal laves i Energy Design med XML-filen. */
(function () {
  "use strict";
  var B = window.IssanaEnergiBe18, R = window.IssanaEnergiBeregning, M = window.IssanaEnergiModel, F = window.IssanaFagInput;
  var FANER = [["overblik", "Overblik"], ["klima", "Klimaskærm"], ["vinduer", "Vinduer"], ["vent", "Ventilation"], ["sommer", "Sommerkomfort"], ["eksport", "Beregn og eksportér"]];
  var S = { api: null, el: null, p: null, kilde: null, fane: "overblik", info: null, res: null, fejl: null, besked: null, afklarAaben: false, rum: null, modelNoegle: null };

  var CSS = "\
body:has(#app.v3) #v3dock-energi.dock{width:min(720px,calc(50vw - 76px))}\
#v3dock-energi .v3-pbody{padding:0;background:var(--bg);font-size:13.5px}\
.en{min-height:100%;display:flex;flex-direction:column;color:var(--text);line-height:1.45}\
.en-top{position:sticky;top:0;z-index:3;background:var(--bg)}\
.en-status{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;padding:10px 16px;background:var(--bg-paper);border-bottom:1px solid var(--border)}\
.en-navn{font-weight:600;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 160px}\
.en-tal{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted);white-space:nowrap}.en-tal b{color:var(--text);font-size:15px}\
.en-faner{display:flex;flex-wrap:wrap;gap:2px;padding:6px 10px 0;background:var(--bg-elev);border-bottom:1px solid var(--border)}\
.en-faner button{background:transparent;border:0;border-bottom:3px solid transparent;color:var(--muted);padding:7px 10px;font:inherit;font-weight:500;white-space:nowrap;cursor:pointer}\
.en-faner button:hover{color:var(--text)}.en-faner button[aria-selected=true]{color:var(--text);border-bottom-color:var(--accent);font-weight:600}\
.en-side{padding:14px 16px 40px;display:grid;gap:12px}\
.en-kort{background:var(--bg-paper);border:1px solid var(--border);border-radius:8px;padding:12px 14px;min-width:0}\
.en-kort h3{margin:0 0 8px;font-size:14px;font-weight:600}\
.en-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}\
.en-lbl{font-size:13px;color:var(--muted)}.en-vaerdi{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2}\
.en-bar{height:8px;background:var(--line-soft);border-radius:4px;margin-top:8px;overflow:hidden}.en-bar i{display:block;height:100%;background:var(--ok)}.en-bar i.over{background:var(--red)}\
.en-chip{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;white-space:nowrap}\
.en-ok{background:var(--ok-bg);color:var(--ok)}.en-adv{background:var(--warn-bg);color:var(--warn)}.en-fejl{background:var(--err-bg);color:var(--err-text)}.en-inf{background:var(--info-bg);color:var(--info-text)}\
.en-note{color:var(--muted);font-size:13px;margin:0}\
.en-rul{overflow-x:auto}\
.en table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}\
.en th{text-align:left;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border);padding:5px 6px;white-space:nowrap}\
.en td{border-bottom:1px solid var(--line-soft);padding:5px 6px;vertical-align:middle}\
.en td.n,.en th.n{text-align:right}.en tr.sum td{font-weight:600;border-top:1px solid var(--border)}\
.en-in{font:inherit;width:64px;padding:3px 6px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);text-align:right;font-variant-numeric:tabular-nums}\
.en-in.tekst{width:100%;text-align:left}.en-in:focus-visible,.en button:focus-visible,.en select:focus-visible{outline:2px solid var(--accent);outline-offset:1px}\
.en-felter{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}\
.en-felt{display:flex;flex-direction:column;gap:3px;min-width:0}.en-felt>span{color:var(--muted);font-size:13px}.en-felt .en-in{width:100%;text-align:left}\
.en select.en-in{text-align:left}\
.en-knapper{display:flex;flex-wrap:wrap;gap:8px;align-items:center}\
.en-knap{font:inherit;font-weight:600;padding:6px 12px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-ink);cursor:pointer}\
.en-knap.sek{background:transparent;color:var(--text);border-color:var(--border)}.en-knap.sek:hover{border-color:var(--accent);color:var(--accent)}\
.en-link{font:inherit;background:none;border:0;padding:0;color:var(--accent);cursor:pointer;text-decoration:underline}\
.en-mini{font:inherit;font-size:12px;background:transparent;border:1px solid var(--border);border-radius:5px;color:var(--muted);padding:1px 6px;cursor:pointer}.en-mini:hover{color:var(--accent);border-color:var(--accent)}\
.en ul{margin:0;padding-left:18px}.en li{margin:3px 0}\
.en-besked{padding:8px 12px;border-radius:6px;background:var(--info-bg);color:var(--info-text);font-size:13px}\
.en-fgr{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:flex-end;margin:0 0 8px}.en-fgr .en-felt{flex:0 0 auto}.en-fgr .en-in{width:72px;text-align:right}\
.en-tom{padding:28px 18px;text-align:center;color:var(--muted);display:grid;gap:12px;justify-items:center}\
";

  /* ---------- Hjælpere ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmt(n, d) { if (n == null || !isFinite(n)) return "–"; return Number(n).toLocaleString("da-DK", { minimumFractionDigits: d == null ? 1 : d, maximumFractionDigits: d == null ? 1 : d }); }
  function inVal(v) { return v == null ? "" : String(v).replace(".", ","); }
  function tal(s) { var x=F.tal(s); return x.ok?x.vaerdi:null; }
  function feltTal(el, options) {var x=F.tal(el.value,options); if(el.setCustomValidity)el.setCustomValidity(x.ok?'':x.fejl); if(!x.ok){vis(x.fejl);if(el.reportValidity)el.reportValidity();} return x;}
  function model() { try { return (S.api && S.api.model && S.api.model()) || null; } catch (e) { return null; } }
  function noegle() { var m = model(); return (m && (m.modelKey || m.model)) || "uden-model"; }
  function gem() { try { localStorage.setItem("issana-energi-" + noegle(), JSON.stringify({ v: 1, p: S.p, kilde: S.kilde, info: S.info, fane: S.fane, rum: S.rum })); } catch (e) { /* lokalt lager kan være fuldt eller lukket */ } }
  function hentGemt() { try { var g = JSON.parse(localStorage.getItem("issana-energi-" + noegle()) || "null"); return g && g.v === 1 && g.p ? g : null; } catch (e) { return null; } }
  function vis(t) { S.besked = t; }
  function hentFelt(sti) { return sti.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, S.p); }
  function forfaelder(sti) { var d = sti.split("."), k = d.pop(); return { o: d.reduce(function (o, x) { return o == null ? o : o[x]; }, S.p), k: k }; }
  function saetFelt(sti, v) { var f = forfaelder(sti); if (!f.o) return; f.o[f.k] = v; (f.o.rettet = f.o.rettet || {})[f.k] = 1; }

  function regn() {
    S.res = null; S.fejl = null;
    if (!S.p) return;
    try { S.res = R.beregn(S.p); } catch (e) { S.fejl = e.message; console.warn("ISSANA Energi: beregningen fejlede", e); }
  }
  function fraModel(kaelder) {
    var m = model(); if (!m || !M) return false;
    try {
      var r = M.fraModel(m, { kaelderUopvarmet: kaelder !== false });
      S.p = r.model; S.kilde = "revit"; S.rum = null;
      S.info = { advarsler: r.advarsler, afklares: r.afklares, antal: r.antal, etageareal: r.etageareal, kaelderUopvarmet: kaelder !== false, rum: (m.rooms || []).map(function (x) { return { id: x.id, navn: ((x.number ? x.number + " " : "") + (x.name || "")).trim(), areal: x.area }; }) };
      return true;
    } catch (e) { S.fejl = "Modellen kunne ikke læses: " + e.message; console.warn("ISSANA Energi", e); return false; }
  }
  function klar() {
    var n = noegle();
    if (S.p && S.modelNoegle === n) return;
    S.modelNoegle = n; S.p = null; S.info = null; S.kilde = null; S.rum = null;
    var g = hentGemt();
    if (g) { S.p = g.p; S.kilde = g.kilde; S.info = g.info || null; S.rum = g.rum == null ? null : g.rum; if (g.fane) S.fane = g.fane; tilfoejParagraf264(); return; }
    fraModel();
  }
  // Gemt før § 264-felterne kom: hent bebygget areal og rumhøjde fra modellen, og behold de øvrige rettelser.
  function tilfoejParagraf264() {
    var b = S.p.bygning, m = model();
    if (S.kilde !== "revit" || b.rumhoejde !== undefined || !m || !M) return;
    try {
      var n = M.fraModel(m, { kaelderUopvarmet: !S.info || S.info.kaelderUopvarmet !== false }).model.bygning;
      b.ae4 = n.ae4; b.rumhoejde = n.rumhoejde; b.kaelderAreal = 0;
    } catch (e) { console.warn("ISSANA Energi", e); }
  }

  /* ---------- Små byggeklodser ---------- */
  function ind(sti, v, br) { return '<input class="en-in" data-k="' + esc(sti) + '" inputmode="decimal" value="' + esc(inVal(v)) + '"' + (br ? ' style="width:' + br + 'px"' : "") + ' aria-label="' + esc(sti) + '">'; }
  function felt(navn, sti, enhed) { return '<label class="en-felt"><span>' + esc(navn) + (enhed ? " (" + esc(enhed) + ")" : "") + '</span><input class="en-in" data-k="' + esc(sti) + '" inputmode="decimal" value="' + esc(inVal(hentFelt(sti))) + '"></label>'; }
  function tekstFelt(navn, sti) { return '<label class="en-felt"><span>' + esc(navn) + '</span><input class="en-in tekst" data-t="' + esc(sti) + '" value="' + esc(hentFelt(sti) == null ? "" : hentFelt(sti)) + '"></label>'; }
  function chip(t, k) { return '<span class="en-chip ' + k + '">' + esc(t) + "</span>"; }
  function kildeChip(o, felt0) {
    if (o.rettet && (felt0 ? o.rettet[felt0] : Object.keys(o.rettet).length)) return chip("Rettet", "en-ok");
    var k = felt0 === "u" && o.uKilde ? o.uKilde : o.kilde;
    if (k === "exercise") return chip("Øvelse", "en-ant");
    if (k === "revit") return chip("Revit", "en-inf");
    if (k === "antaget") return chip("Antaget", "en-adv");
    return chip("Fra XML", "en-inf");
  }
  function statusChip(ok) { return ok === true ? chip("Overholdt", "en-ok") : ok === false ? chip("Ikke overholdt", "en-fejl") : chip("Kan ikke vurderes", "en-inf"); }
  function vaelgKnap(ids) { return ids && ids.length ? '<button class="en-mini" data-vaelg="' + esc(ids.join(",")) + '" title="Vælg i 3D">Vis</button>' : ""; }
  function kpi(navn, v, enhed, krav, ok, krav2, ok2) {
    if (v == null || !isFinite(v) || !(krav > 0) || !isFinite(krav)) ok = null;
    if (v == null || !isFinite(v) || !(krav2 > 0) || !isFinite(krav2)) ok2 = null;
    var a = Math.min(100, Math.max(3, v / krav * 100));
    var bar = typeof ok === "boolean" && v != null && isFinite(v) && krav > 0 && isFinite(krav) ? '<div class="en-bar"><i class="' + (ok ? "" : "over") + '" style="width:' + a + '%"></i></div>' : "";
    return '<div class="en-kort"><div class="en-lbl">' + esc(navn) + '</div><div class="en-vaerdi">' + fmt(v) + '</div><div class="en-lbl">krav ' + fmt(krav) + " " + esc(enhed) + '</div>' + bar + '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' + statusChip(ok) + (krav2 != null && typeof ok2 === "boolean" ? chip("2020-mål " + fmt(krav2) + (ok2 ? " ok" : " ikke nået"), ok2 ? "en-ok" : "en-adv") : "") + "</div></div>";
  }
  function antagne() {
    var n = 0; S.p.konstruktioner.forEach(function (c) { c.aabninger.forEach(function (o) { if (o.kilde === "antaget" && !(o.rettet && o.rettet.u && (o.rettet.g || !(o.g > 0)))) n += o.no; }); });
    return n;
  }

  /* ---------- Sider ---------- */
  function sideOverblik() {
    var r = S.res, h = '<div class="en-kpi">' +
      kpi("Energiramme", r.energiramme.resultat, "kWh/m² pr. år", r.energiramme.krav, r.energiramme.ok, r.energiramme.krav2020, r.energiramme.ok2020) +
      kpi("Transmissionstab", r.transmission.resultat, "W/m² etageareal", r.transmission.krav, r.transmission.ok, r.transmission.krav2020, r.transmission.ok2020) +
      '<div class="en-kort"><div class="en-lbl">Opvarmet etageareal</div><div class="en-vaerdi">' + fmt(S.p.bygning.ae, 0) + '</div><div class="en-lbl">m², E = ' + fmt(r.etager, 2) + '</div><div style="margin-top:8px">' + (S.kilde === "revit" && !(S.p.bygning.rettet && S.p.bygning.rettet.ae) ? chip("Kontrollér mod arealskema", "en-adv") : chip("Angivet", "en-ok")) + "</div></div></div>";
    var bi = r.bidrag, sum = bi.varme + bi.el + bi.overtemperatur;
    h += '<div class="en-kort"><h3>Hvad energirammen består af</h3><div class="en-rul"><table><tr><td>Varme, rum og varmt vand (× ' + fmt(R.FAKTOR.fjernvarme, 2) + ')</td><td class="n">' + fmt(bi.varme) + '</td></tr><tr><td>El til bygningsdrift, efter solceller (× ' + fmt(R.FAKTOR.el, 1) + ')</td><td class="n">' + fmt(bi.el) + '</td></tr><tr><td>Tillæg for overtemperatur</td><td class="n">' + fmt(bi.overtemperatur) + '</td></tr><tr class="sum"><td>I alt, kWh/m² pr. år</td><td class="n">' + fmt(sum) + "</td></tr></table></div></div>";
    var fb = forbehold(), l = fb.linjer, ak = fb.grupper;
    h += '<div class="en-kort"><h3>Skal afklares før aflevering</h3>' + (l.length ? "<ul>" + l.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : '<p class="en-note">Ingen antagelser tilbage.</p>') +
      (ak.length ? '<p class="en-note" style="margin-top:8px">' + ak.reduce(function (s, x) { return s + x.ids.length; }, 0) + ' bygningsdele er ikke regnet med. <button class="en-link" id="enAfklar">' + (S.afklarAaben ? "Skjul" : "Vis dem") + "</button></p>" + (S.afklarAaben ? '<ul style="margin-top:6px">' + ak.map(function (x) { return "<li>" + esc(x.tekst) + " (" + x.ids.length + ") " + vaelgKnap(x.ids) + "</li>"; }).join("") + "</ul>" : "") : "") + "</div>";
    h += '<p class="en-note">' + esc(NOTE) + "</p>";
    return h;
  }
  // Fanens forbehold: det, der skal afklares, og de bygningsdele, der ikke er regnet med. Overblik og rapporten viser det samme.
  var NOTE = "Forhåndsberegning, månedsmetode efter ISO 13790. Den regner altid med 20 °C inde og med dagdrift hele døgnet: ingen natsænkning og ingen særskilt natventilation. Varmt brugsvand regnes altid fra 10 °C til 55 °C. Det gælder også, når en importeret fil siger noget andet. På referenceprojektet lå den inden for 1 kWh/m² af Energy Design, men det er kun prøvet på det ene projekt, og fordelingen mellem varme og overtemperatur er usikker. Brug XML-filen til Energy Design for det endelige tal.";
  function forbehold() {
    var l = [], afk = (S.info && S.info.afklares) || [], gr = {};
    if (S.kilde === "revit") {
      var ea = S.info && S.info.etageareal;
      if (!(S.p.bygning.rettet && S.p.bygning.rettet.ae) && ea) l.push("Etagearealet er regnet som dæk " + fmt(ea.daek, 0) + " m² plus ydervægge " + fmt(ea.vaegge, 0) + " m². Rummene alene giver " + fmt(ea.rum, 0) + " m².");
      var n = antagne(); if (n) l.push(n + " vinduer og døre har antagne værdier for U, g og glasandel.");
      if (!(S.p.ventilation.rettet && Object.keys(S.p.ventilation.rettet).length)) l.push("Ventilation, pumpe og forsyning bruger foreløbige input. Kontrollér driftstallene; de hentes ikke automatisk fra installationsdelene i modellen.");
      if (S.p.kuldebroer.some(function (k) { return k.kilde === "antaget" && !(k.rettet && k.rettet.psi); })) l.push("Linjetab er antaget ud fra længderne i modellen.");
    }
    afk.forEach(function (a) { var g = gr[a.tekst] || (gr[a.tekst] = { tekst: a.tekst, ids: [] }); g.ids.push(a.id); });
    var ak = Object.keys(gr).map(function (k) { return gr[k]; }).sort(function (a, b) { return b.ids.length - a.ids.length; });
    ((S.info && S.info.advarsler) || []).forEach(function (t) { l.push(t); });
    ((S.info && S.info.ikkeOverfoert) || []).forEach(function (t) { l.push(t); });
    return { linjer: l, grupper: ak, note: NOTE };
  }

  /* ---------- Rapport (Typst) ---------- */
  // Rapporten bygges af energi-rapport.js ud fra fanens egne data og resultat. Den regner intet nyt.
  function V() { return window.IssanaVisning || null; }
  function rapportTekst() {
    var RT = window.IssanaTypstRapport, ER = window.IssanaEnergiRapport;
    if (!RT || !ER) { vis("Rapportmodulet er ikke indlæst endnu. Prøv igen om et øjeblik."); return null; }
    if (!S.p || !S.res) { vis("Rapporten kræver en beregning. Ret først det, fanen beder om."); return null; }
    var fb = forbehold(), m = model() || {}, navn = m.model || (S.p.bygning && S.p.bygning.id) || "";
    try {
      var tekst = ER.lav(RT, {
        p: S.p, res: S.res, beregning: R, kilde: S.kilde, info: S.info, std: M && M.STD,
        faste: B.fasteFelter ? B.fasteFelter(S.p) : [], ikkeSkrevet: B.IKKE_SKREVET || [],
        forbehold: { note: NOTE, linjer: fb.linjer, afklares: fb.grupper.map(function (g) { return { tekst: g.tekst, antal: g.ids.length }; }) },
        model: navn,
        dato: new Date().toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" })
      });
      return { tekst: tekst, fil: ER.filnavn(navn), navn: navn };
    } catch (e) { vis("Rapporten kunne ikke laves: " + ((e && e.message) || e)); return null; }
  }
  function kraeverRevit(v, hvad) { if (v && v.erRevit && v.erRevit() && v.kald) return true; vis(hvad + " kræver, at ISSANA 3D er åbnet fra Revit. Du kan gemme Typst-filen i stedet."); return false; }
  function gemPdf(fil, base64) {
    var bin = atob(base64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([u], { type: "application/pdf" })), a = document.createElement("a");
    a.href = url; a.download = fil; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }
  // PDF'en laves af typst.exe, der følger med pluginet, gennem det samme værktøj som varmetabsrapporten.
  function rapportPdf() {
    var v = V(); if (!kraeverRevit(v, "PDF'en")) { tegn(); return Promise.resolve(null); }
    var r = rapportTekst(); if (!r) { tegn(); return Promise.resolve(null); }
    S.rapportOptaget = "pdf"; tegn();
    return v.kald("issana_rapport_pdf", { typst: r.tekst, filnavn: r.fil }, { timeoutMs: 180000 }).then(function (s) {
      gemPdf(s.filnavn, s.pdfBase64); vis("PDF'en er gemt som " + s.filnavn + "."); return s;
    }).catch(function (e) { vis("PDF'en blev ikke lavet: " + ((e && e.message) || e)); return null; }).then(function (s) { S.rapportOptaget = null; tegn(); return s; });
  }
  // Et nyt Typst-projekt i ISSANA Compose med rapporten som main.typ. Det projekt, der måske er åbent, røres ikke.
  function rapportCompose() {
    var v = V(); if (!kraeverRevit(v, "Send til Compose")) { tegn(); return Promise.resolve(null); }
    var r = rapportTekst(); if (!r) { tegn(); return Promise.resolve(null); }
    S.rapportOptaget = "compose"; tegn();
    return v.kald("issana_rapport_compose", { typst: r.tekst, navn: "Energi " + (r.navn || "model") }, { timeoutMs: 120000 }).then(function (s) {
      vis("Rapporten ligger nu i ISSANA Compose som projektet «" + s.projekt + "». Åbn det fra projektoversigten, og markér det som betroet, for at se PDF'en."); return s;
    }).catch(function (e) { vis("Rapporten blev ikke sendt: " + ((e && e.message) || e)); return null; }).then(function (s) { S.rapportOptaget = null; tegn(); return s; });
  }
  function retNavn(c) { var o = c.orient; if (c.slope === 0 || c.rolle === "tag") return "Vandret"; if (o === "0" || o === 0) return c.grader != null ? R.retningNavn(c.grader) : (c.rolle ? "–" : "Nord"); return R.retningNavn(R.retning(o)); }
  function sideKlima() {
    var p = S.p, h = '<div class="en-kort"><h3>Bygning</h3><div class="en-felter">' + felt("Opvarmet etageareal, målt til ydersiden af ydervæggene", "bygning.ae", "m²") + felt("Bebygget areal, største opvarmede etage", "bygning.ae4", "m²") + '<div class="en-felt"><span>Etager E, beregnet</span><b style="font-size:15px">' + fmt(R.krav(p).etager, 2) + "</b></div>" + felt("Gennemsnitlig rumhøjde", "bygning.rumhoejde", "m") + felt("Opvarmet kælder uden for etagearealet", "bygning.kaelderAreal", "m²") + felt("Varmekapacitet", "bygning.heat_cap", "Wh/K pr. m²") + felt("Bygningens drejning", "bygning.rotation", "grader") + '</div><p class="en-note" style="margin-top:8px">BR18 § 264: rumhøjde over 4,0 m giver et tillæg til kravet, og en opvarmet kælder uden for etagearealet tæller 40 % i A og E, så den må ikke også stå i etagearealet. De to felter skrives ikke i XML-filen og skal også tastes i Energy Design.</p></div>';
    h += '<div class="en-kort"><h3>Bygningsdele</h3><div class="en-rul"><table><thead><tr><th></th><th>Bygningsdel</th><th>Retning</th><th class="n">Brutto m²</th><th class="n">Netto m²</th><th class="n">U</th><th class="n">b</th><th class="n">W/K</th></tr></thead><tbody>';
    var sumH = 0;
    p.konstruktioner.forEach(function (c, i) {
      if (c.rolle === "glas" || (!c.rolle && c.id.indexOf("glasfacade") >= 0)) return;
      var n = R.netAreal(c), H = c.b * c.u * n; sumH += H;
      h += '<tr><td style="white-space:nowrap">' + vaelgKnap(c.ids) + ' <button class="en-mini" data-fjern="' + i + '" title="Tag ud af beregningen">Fjern</button></td><td>' + esc(c.id) + ' ' + kildeChip(c, "u") + (c.typeNavn ? '<div class="en-lbl" style="font-size:12px">' + esc(c.typeNavn) + "</div>" : "") + "</td><td>" + esc(retNavn(c)) + '</td><td class="n">' + ind("konstruktioner." + i + ".total_area", c.total_area, 66) + '</td><td class="n">' + fmt(n, 1) + '</td><td class="n">' + ind("konstruktioner." + i + ".u", c.u, 54) + '</td><td class="n">' + ind("konstruktioner." + i + ".b", c.b, 50) + '</td><td class="n">' + fmt(H, 1) + "</td></tr>";
    });
    h += '<tr class="sum"><td></td><td colspan="6">I alt, uden vinduer og døre</td><td class="n">' + fmt(sumH, 1) + "</td></tr></tbody></table></div></div>";
    h += '<div class="en-kort"><h3>Linjetab</h3><div class="en-rul"><table><thead><tr><th></th><th>Samling</th><th class="n">Længde m</th><th class="n">ψ W/mK</th><th class="n">W/K</th></tr></thead><tbody>';
    p.kuldebroer.forEach(function (k, i) { h += '<tr><td><button class="en-mini" data-fjernlinje="' + i + '">Fjern</button></td><td><input class="en-in tekst" data-t="kuldebroer.' + i + '.id" value="' + esc(k.id) + '" aria-label="Samling"><div style="margin-top:3px">' + kildeChip(k, "psi") + '</div></td><td class="n">' + ind("kuldebroer." + i + ".laengde", k.laengde, 66) + '</td><td class="n">' + ind("kuldebroer." + i + ".psi", k.psi, 54) + '</td><td class="n">' + fmt(k.psi * k.laengde, 1) + "</td></tr>"; });
    h += '</tbody></table></div><div class="en-knapper" style="margin-top:8px"><button class="en-knap sek" id="enNyLinje">Tilføj samling</button></div></div>';
    if (p.unheated) {
      var u = p.unheated;
      h += '<div class="en-kort"><h3>Uopvarmet rum: ' + esc(u.id) + '</h3><div class="en-felter">' + felt("Bruttoareal", "unheated.gross_area", "m²") + felt("Luftskifte", "unheated.vent", "l/s pr. m²") + '<div class="en-felt"><span>Temperaturfaktor b, beregnet</span><b style="font-size:15px">' + fmt(M.bFaktor(u), 2) + '</b></div></div><div class="en-rul" style="margin-top:8px"><table><thead><tr><th>Mod opvarmet</th><th class="n">Areal m²</th><th class="n">U</th></tr></thead><tbody>' + u.intern.map(function (e, i) { return "<tr><td>" + esc(e.id) + '</td><td class="n">' + ind("unheated.intern." + i + ".area", e.area, 72) + '</td><td class="n">' + ind("unheated.intern." + i + ".u", e.u, 58) + "</td></tr>"; }).join("") + '</tbody><thead><tr><th>Mod det fri og jord</th><th></th><th></th></tr></thead><tbody>' + u.ekstern.map(function (e, i) { return "<tr><td>" + esc(e.id) + '</td><td class="n">' + ind("unheated.ekstern." + i + ".area", e.area, 72) + '</td><td class="n">' + ind("unheated.ekstern." + i + ".u", e.u, 58) + "</td></tr>"; }).join("") + "</tbody></table></div></div>";
    }
    if (S.kilde === "revit" && S.info) h += '<div class="en-kort"><label class="en-felt" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="enKaelder"' + (S.info.kaelderUopvarmet !== false ? " checked" : "") + '><span style="color:var(--text)">Kælderen er uopvarmet</span></label><p class="en-note" style="margin-top:4px">Ændrer du den, læses modellen forfra, og dine rettelser på denne fane går tabt.</p></div>';
    return h;
  }
  function sideVinduer() {
    var h = "", p = S.p, nogen = false;
    p.konstruktioner.forEach(function (c, i) {
      if (!c.aabninger.length) return; nogen = true;
      var s0 = c.aabninger[0].skygge || {};
      h += '<div class="en-kort"><h3>' + esc(c.id) + '</h3><div class="en-fgr">' + [["Horisont", "horizon"], ["Udhæng", "overhang"], ["Side venstre", "sidefin_left"], ["Side højre", "sidefin_right"]].map(function (x) { return '<label class="en-felt"><span>' + x[0] + ' (°)</span><input class="en-in" data-skygge="' + i + "." + x[1] + '" inputmode="decimal" value="' + esc(inVal(s0[x[1]])) + '"></label>'; }).join("") + '</div><div class="en-rul"><table><thead><tr><th></th><th>Vindue eller dør</th><th class="n">Antal</th><th class="n">m² stk.</th><th class="n">U</th><th class="n">g</th><th class="n">Ff</th><th class="n">Fc</th><th title="Solafskærmning kun uden for opvarmningssæsonen">Kun<br>sommer</th></tr></thead><tbody>';
      c.aabninger.forEach(function (o, j) {
        var st = "konstruktioner." + i + ".aabninger." + j, erDoer = !(o.g > 0) && o.type === 202;
        h += "<tr><td>" + vaelgKnap(o.ids) + "</td><td>" + esc(o.id) + ' ' + kildeChip(o, "u") + '</td><td class="n">' + ind(st + ".no", o.no, 44) + '</td><td class="n">' + ind(st + ".area", o.area, 56) + '</td><td class="n">' + ind(st + ".u", o.u, 50) + '</td><td class="n">' + (erDoer ? "–" : ind(st + ".g", o.g, 50)) + '</td><td class="n">' + (erDoer ? "–" : ind(st + ".ff", o.ff, 50)) + '</td><td class="n">' + (erDoer ? "–" : '<input class="en-in" style="width:50px" data-fc="' + st + '" inputmode="decimal" value="' + esc(inVal(Math.abs(o.fc == null ? 1 : o.fc))) + '" aria-label="Fc">') + "</td><td>" + (erDoer ? "" : '<input type="checkbox" data-fcs="' + st + '"' + (o.fc < 0 ? " checked" : "") + ' aria-label="Kun sommer">') + "</td></tr>";
      });
      h += "</tbody></table></div></div>";
    });
    if (!nogen) h = '<div class="en-kort"><p class="en-note">Ingen vinduer eller døre mod det fri.</p></div>';
    return h + '<p class="en-note">Fc = 1 er ingen solafskærmning. «Kun sommer» betyder, at afskærmningen ikke regnes i opvarmningssæsonen. Skyggevinklerne gælder alle åbninger i gruppen.</p>';
  }
  function sideVent() {
    var p = S.p, h = '<div class="en-kort"><h3>Ventilation</h3><div class="en-felter">' + felt("Mekanisk, vinter", "ventilation.qvm", "l/s pr. m²") + felt("Mekanisk, sommer", "ventilation.qvm_day", "l/s pr. m²") + felt("Naturlig, sommer", "ventilation.qid_day", "l/s pr. m²") + felt("Varmegenvinding", "ventilation.nvgv", "0-1") + felt("SEL", "ventilation.sel", "kJ/m³") + felt("Indblæsning", "ventilation.tin", "°C") + felt("Lufttæthed q50", "ventilation.air_tightness", "l/s pr. m²") + felt("Infiltration", "ventilation.qid", "l/s pr. m²") + '</div><p class="en-note" style="margin-top:8px">Infiltrationen følger lufttætheden: 0,04 + 0,06 × q50.</p></div>';
    h += '<div class="en-kort"><h3>Brug</h3><div class="en-felter">' + felt("Personer", "brug.ppers", "W/m²") + felt("Apparater", "brug.papp", "W/m²") + felt("Varmt brugsvand", "brugsvand", "l/m² pr. år") + "</div></div>";
    h += '<div class="en-kort"><h3>Forsyning</h3><div class="en-felter"><label class="en-felt"><span>Varmeforsyning</span><select class="en-in"><option>Fjernvarme</option><option disabled>Kedel (format ikke kortlagt)</option><option disabled>Varmepumpe (format ikke kortlagt)</option></select></label>' + felt("Veksler, effekt", "fjernvarme.nom_eff", "kW") + felt("Veksler, tab", "fjernvarme.heat_loss", "W/K") + felt("Fremløb", "fremloeb", "°C") + felt("Retur", "retur", "°C") + felt("Pumpe, effekt", "pumpe.pnom", "W") + felt("Pumpe, faktor", "pumpe.fp", "0-1") + "</div></div>";
    h += '<div class="en-kort"><h3>Solceller</h3><label class="en-felt" style="flex-direction:row;align-items:center;gap:8px;margin-bottom:8px"><input type="checkbox" id="enPv"' + (p.solceller ? " checked" : "") + '><span style="color:var(--text)">Bygningen har solceller</span></label>' + (p.solceller ? '<div class="en-felter">' + felt("Areal", "solceller.area", "m²") + felt("Retning, syd = 180", "solceller.orient", "grader") + felt("Hældning", "solceller.slope", "grader") + felt("Horisont", "solceller.horizon", "grader") + felt("Peak effekt", "solceller.peak_power", "kW pr. m²") + felt("Virkningsgrad", "solceller.efficiency", "0-1") + "</div>" : "") + "</div>";
    return h;
  }
  function rumEksportFejl() {
    if (S.kilde === "revit") {
      var r = ((S.info && S.info.rum) || []).filter(function (x) { return String(x.id) === String(S.rum); })[0];
      if (!r) return "Vælg et rum fra modellen. Modeller uden rum kan ikke eksportere sommerkomfort.";
      if (!F.tal(r.areal, { positiv: true }).ok) return "Det valgte rum mangler et gyldigt areal i modellen.";
      if (!rumAabninger(S.rum).some(function (a) { return F.tal(a.areal, { positiv: true }).ok; })) return "Det valgte rum mangler tilknyttede vinduer med areal.";
    } else if (S.kilde === "xml") {
      if (!S.p.konstruktioner.some(function (c) { return c.aabninger.some(function (o) { return o.ot && o.g > 0 && o.area > 0; }); })) return "Vælg mindst ét vindue til rummet fra den importerede XML.";
    } else return "Hent modellen eller importér en XML med rumdata først.";
    var felter = [[S.p.bygning.ae, "Bygningens opvarmede areal"], [S.p.rum && S.p.rum.area, "Rummets gulvareal"]];
    for (var i = 0; i < felter.length; i++) { var a = F.tal(felter[i][0], { navn: felter[i][1], positiv: true }); if (!a.ok) return a.fejl; }
    var vent = ["vent_day", "vent_evening", "vent_night", "vent_basic"];
    for (var j = 0; j < vent.length; j++) { var v = F.tal(S.p.rum[vent[j]], { navn: "Rummets ventilation", min: 0 }); if (!v.ok) return v.fejl; }
    return null;
  }
  function sommerFejl(tekst, felt) {
    var e = S.el.querySelector("#enSommerFejl"); if (e) e.textContent = tekst || "";
    ["enResNavn", "enRes27", "enRes28"].forEach(function (id) { var f = S.el.querySelector("#" + id); if (f) f.setAttribute("aria-invalid", id === felt ? "true" : "false"); });
    var f = felt && S.el.querySelector("#" + felt); if (f) f.focus();
    if (e && e.scrollIntoView) e.scrollIntoView({ block: "center" });
  }
  function sideSommer() {
    var p = S.p, medRumData = p.konstruktioner.some(function (c) { return c.aabninger.some(function (o) { return o.rum && o.rum.length; }); }), liste = (S.info && S.info.rum) || [];
    var h = '<div class="en-kort"><h3>Rum, der skal eftervises</h3><p class="en-note" style="margin-bottom:8px">Sommerkomfort kræver en timeberegning. Den laves i Energy Design. Her vælger du rummet og laver filen, som du importerer dér. Krav: højst 100 timer over 27 °C og 25 timer over 28 °C.</p><div class="en-felter">';
    if (medRumData) h += '<label class="en-felt"><span>Rum</span><select class="en-in" id="enRum"><option value="">Vælg rum</option>' + liste.filter(function (r) { return rumAabninger(r.id).length; }).map(function (r) { return '<option value="' + esc(r.id) + '"' + (String(S.rum) === String(r.id) ? " selected" : "") + ">" + esc(r.navn) + "</option>"; }).join("") + "</select></label>";
    h += felt("Gulvareal", "rum.area", "m²") + felt("Ventilation, dag", "rum.vent_day", "l/s pr. m²") + felt("Ventilation, aften", "rum.vent_evening", "l/s pr. m²") + felt("Ventilation, nat", "rum.vent_night", "l/s pr. m²") + felt("Grundventilation", "rum.vent_basic", "l/s pr. m²") + "</div>";
    if (medRumData && S.rum != null && S.rum !== "") {
      var ab = rumAabninger(S.rum);
      h += '<div class="en-rul" style="margin-top:10px"><table><thead><tr><th>Vinduer i rummet</th><th class="n">Areal m²</th><th>Facade</th></tr></thead><tbody>' + ab.map(function (a) { return "<tr><td>" + esc(a.navn) + '</td><td class="n">' + fmt(a.areal, 1) + "</td><td>" + esc(a.facade) + "</td></tr>"; }).join("") + "</tbody></table></div>";
    }
    if (!medRumData) {
      h += '<div class="en-rul" style="margin-top:10px"><table><thead><tr><th>Med i rummet</th><th>Vindue</th><th>Facade</th></tr></thead><tbody>';
      p.konstruktioner.forEach(function (c, i) { c.aabninger.forEach(function (o, j) { if (o.g > 0) h += '<tr><td><input type="checkbox" data-ot="konstruktioner.' + i + ".aabninger." + j + '"' + (o.ot ? " checked" : "") + "></td><td>" + esc(o.id) + "</td><td>" + esc(c.id) + "</td></tr>"; }); });
      h += "</tbody></table></div>";
    }
    var eksportFejl = rumEksportFejl();
    h += '<div class="en-knapper" style="margin-top:10px"><button class="en-knap" id="enRumXml" aria-describedby="enRumXmlGrund"' + (eksportFejl ? " disabled" : "") + '>Gem XML for rummet</button></div><p id="enRumXmlGrund" class="en-note">' + esc(eksportFejl || "Rumfilen er input til Energy Design; den er ikke en færdig timeberegning.") + '</p></div>';
    var res = p.sommer || [];
    h += '<div class="en-kort"><h3>Resultater fra Energy Design</h3><div class="en-rul"><table><thead><tr><th>Rum</th><th class="n">Timer over 27 °C</th><th class="n">Timer over 28 °C</th><th>Status</th><th></th></tr></thead><tbody>' + res.map(function (x, i) { var gyldig = F.sommer(x.t27, x.t28).ok, ok = gyldig && x.t27 <= 100 && x.t28 <= 25; return "<tr><td>" + esc(x.navn) + '</td><td class="n">' + fmt(x.t27, 0) + '</td><td class="n">' + fmt(x.t28, 0) + "</td><td>" + (gyldig ? statusChip(ok) : chip("Ugyldigt input", "en-fejl")) + '</td><td><button class="en-mini" data-fjernres="' + i + '">Fjern</button></td></tr>'; }).join("") + (res.length ? "" : '<tr><td colspan="5" class="en-lbl">Ingen resultater endnu.</td></tr>') + '</tbody></table></div><div class="en-fgr" style="margin-top:10px"><label class="en-felt" style="flex:1 1 180px"><span>Rum</span><input class="en-in tekst" id="enResNavn" aria-describedby="enSommerFejl"></label><label class="en-felt"><span>Over 27 °C</span><input class="en-in" id="enRes27" aria-describedby="enSommerFejl" inputmode="decimal"></label><label class="en-felt"><span>Over 28 °C</span><input class="en-in" id="enRes28" aria-describedby="enSommerFejl" inputmode="decimal"></label><button class="en-knap sek" id="enResNy">Tilføj</button></div><p id="enSommerFejl" role="alert" class="en-note"></p></div>';
    return h;
  }
  function rumAabninger(rumId) {
    var ud = [];
    S.p.konstruktioner.forEach(function (c) { c.aabninger.forEach(function (o) {
      if (!(o.g > 0)) return;
      var her = (o.rum || []).filter(function (r) { return String(r.id) === String(rumId); });
      if (her.length) ud.push({ navn: o.id, areal: her.reduce(function (s, r) { return s + r.areal; }, 0), facade: c.id });
    }); });
    return ud;
  }
  // Det, XML-filen altid skriver med samme værdi, og det, den slet ikke skriver. Ret det i Energy Design efter importen.
  function fasteHtml() {
    var gr = B.fasteFelter ? B.fasteFelter(S.p) : [], n = gr.reduce(function (s, g) { return s + g.felter.length; }, 0), b = S.p.bygning;
    if (!n) return "";
    var ekstra = [];
    if (b.rumhoejde > 0) ekstra.push("rumhøjde " + fmt(b.rumhoejde, 2) + " m");
    if (b.kaelderAreal > 0) ekstra.push("opvarmet kælder " + fmt(b.kaelderAreal, 0) + " m²");
    return '<details style="margin-top:10px"><summary class="en-link" style="text-decoration:none">' + n + " felter skrives altid med en fast værdi. Vis dem</summary>" +
      '<p class="en-note" style="margin:6px 0">Panelet har ingen felter til dem, så filen får de værdier, der står her. Ret dem i Energy Design, hvis projektet har andre. Navnet i parentes er læst ud fra feltnavnet, ikke tjekket i Energy Designs vejledning.</p>' +
      '<div class="en-rul"><table><thead><tr><th>Post</th><th>Felt</th><th class="n">Værdi</th></tr></thead><tbody>' +
      gr.map(function (g) { return g.felter.map(function (f, i) { return "<tr><td>" + (i ? "" : esc(g.post)) + "</td><td>" + esc(f.felt) + (f.navn ? ' <span class="en-note">(' + esc(f.navn) + ")</span>" : "") + '</td><td class="n">' + esc(f.tekst) + "</td></tr>"; }).join(""); }).join("") +
      "</tbody></table></div>" +
      '<p class="en-note" style="margin-top:8px">Filen har slet ikke: ' + esc((B.IKKE_SKREVET || []).join(", ")) + "." + (ekstra.length ? " Her er sat " + esc(ekstra.join(" og ")) + ". Det bruges kun i kravet her og skal tastes i Energy Design." : "") + "</p></details>";
  }
  function sideEksport() {
    var r = S.res, mgl = B.mangler(S.p), h = '<div class="en-kort"><h3>Projekt</h3><div class="en-felter">' + tekstFelt("Projektnavn", "bygning.id") + tekstFelt("Projektnummer", "bygning.project_no") + tekstFelt("Adresse", "bygning.street") + tekstFelt("Postnummer", "bygning.zip_code") + tekstFelt("By", "bygning.city") + '<label class="en-felt"><span>Bygningstype</span><select class="en-in" id="enType"><option value=".ETYPE."' + (S.p.bygning.has_btype === ".ETYPE." ? " selected" : "") + '>Etagebolig (også hotel)</option><option value=".FTYPE."' + (S.p.bygning.has_btype === ".FTYPE." ? " selected" : "") + ">Fritliggende bolig</option></select></label></div></div>";
    h += '<div class="en-kort"><h3>Til Energy Design</h3><p class="en-note" style="margin-bottom:8px">Gem filen, og importér den i Energy Design for at få det endelige tal. Antagne værdier følger med, så ret dem først.</p>' + (mgl.length ? '<p class="en-besked">Mangler: ' + esc(mgl.join(", ")) + "</p>" : "") + '<div class="en-knapper"><button class="en-knap" id="enXml"' + (mgl.length ? " disabled" : "") + '>Gem XML til Energy Design</button><button class="en-knap sek" id="enImport">Importér XML</button>' + (model() ? '<button class="en-knap sek" id="enHent">Hent igen fra modellen</button>' : "") + '<input type="file" id="enFil" accept=".xml" hidden></div>' + fasteHtml() + "</div>";
    var dis = S.rapportOptaget ? " disabled" : "";
    h += '<div class="en-kort"><h3>Rapport</h3><p class="en-note" style="margin-bottom:8px">Resultatet mod kravet, alle inddata med kilde (læst i modellen, antaget, tastet eller fra XML-filen), mellemregningerne og forbeholdene. Det er en forhåndsberegning, ikke dokumentation.</p><div class="en-knapper"><button class="en-knap" id="enRapTyp"' + dis + '>Gem rapport (Typst)</button><button class="en-knap sek" id="enRapPdf"' + dis + ">" + (S.rapportOptaget === "pdf" ? "Laver PDF…" : "Lav PDF") + '</button><button class="en-knap sek" id="enRapCompose"' + dis + ">" + (S.rapportOptaget === "compose" ? "Sender…" : "Send til Compose") + "</button></div></div>";
    h += '<div class="en-kort"><h3>Forhåndsberegning, måned for måned</h3><div class="en-rul"><table><thead><tr><th>Måned</th><th class="n">Ude °C</th><th class="n">Tab kWh</th><th class="n">Sol kWh</th><th class="n">Intern kWh</th><th class="n">Udnyttelse</th><th class="n">Varme kWh</th></tr></thead><tbody>' + r.maaneder.map(function (m) { return "<tr><td>" + m.maaned + '</td><td class="n">' + fmt(m.ude, 1) + '</td><td class="n">' + fmt(m.tab, 0) + '</td><td class="n">' + fmt(m.sol, 0) + '</td><td class="n">' + fmt(m.intern, 0) + '</td><td class="n">' + fmt(m.udnyttelse, 2) + '</td><td class="n">' + fmt(m.varme, 0) + "</td></tr>"; }).join("") + "</tbody></table></div></div>";
    return h;
  }

  /* ---------- Tegn ---------- */
  function tegn() {
    var el = S.el; if (!el) return;
    if (!B || !R || !M || !F) { el.innerHTML = '<div class="en"><div class="en-tom">Energi-fanen kræver energi-be18.js, energi-beregning.js, energi-fra-model.js og fag-input.js. Tjek, at de er indlæst i Revit-modelviewer.html.</div></div>'; return; }
    klar(); regn();
    var aktiv = document.activeElement, fokus = aktiv && el.contains(aktiv) ? ["data-k", "data-t", "data-fc", "data-skygge"].map(function (a) { var v = aktiv.getAttribute(a); return v == null ? null : "[" + a + '="' + v + '"]'; }).filter(Boolean)[0] : null, rul = el.scrollTop;
    if (!S.p) {
      el.innerHTML = '<div class="en"><div class="en-tom"><div>Hent modellen fra Revit først, eller importér en XML fra Energy Design.</div>' + (S.fejl ? "<div>" + esc(S.fejl) + "</div>" : "") + '<button class="en-knap sek" id="enImport">Importér XML</button><input type="file" id="enFil" accept=".xml" hidden></div></div>';
      bind(); return;
    }
    var r = S.res, top = '<div class="en-top"><div class="en-status"><div class="en-navn" title="' + esc(S.p.bygning.id) + '">' + esc(S.p.bygning.id) + "</div>" + (r ? '<span class="en-tal">Energiramme <b>' + fmt(r.energiramme.resultat) + "</b> / " + fmt(r.energiramme.krav) + '</span><span class="en-tal">Transmission <b>' + fmt(r.transmission.resultat) + "</b> / " + fmt(r.transmission.krav) + "</span>" : "") + chip("Forhåndsberegning", "en-inf") + '</div><div class="en-faner" role="tablist" aria-label="Energi">' + FANER.map(function (f) { return '<button role="tab" data-fane="' + f[0] + '" aria-selected="' + (S.fane === f[0]) + '">' + f[1] + "</button>"; }).join("") + "</div></div>";
    var side = S.fejl ? '<div class="en-kort"><h3>Beregningen kunne ikke køre</h3><p class="en-note">' + esc(S.fejl) + "</p></div>" : ({ overblik: sideOverblik, klima: sideKlima, vinduer: sideVinduer, vent: sideVent, sommer: sideSommer, eksport: sideEksport }[S.fane] || sideOverblik)();
    el.innerHTML = '<div class="en">' + top + '<div class="en-side" role="tabpanel">' + (S.besked ? '<div class="en-besked">' + esc(S.besked) + "</div>" : "") + side + "</div></div>";
    S.besked = null; el.scrollTop = rul; bind();
    if (fokus) { var f = el.querySelector(fokus); if (f) { f.focus(); if (f.select) f.select(); } }
  }

  /* ---------- Handlinger ---------- */
  function gemFil(navn, tekst) { var a = document.createElement("a"), url = URL.createObjectURL(new Blob([tekst], { type: "application/xml;charset=utf-8" })); a.href = url; a.download = navn; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 5000); }
  function filnavn(t, x) { return String(t || "energi").replace(/[\\/:*?"<>|]+/g, "-").trim() + (x || "") + ".xml"; }
  function skrivXml() {
    var ms = B.mangler(S.p); if (ms.length) { vis("Filen kan ikke laves endnu. Mangler: " + ms.join(", ")); tegn(); return; }
    gemFil(filnavn(S.p.bygning.id), B.skriv(S.p));
    var nf = (B.fasteFelter ? B.fasteFelter(S.p) : []).reduce(function (s, g) { return s + g.felter.length; }, 0);
    vis("XML-filen er gemt. Importér den i Energy Design." + (nf ? " " + nf + " felter har en fast værdi, fx 20 °C og brugstid 168 timer. Se listen under Til Energy Design, og ret dem i Energy Design, hvis projektet har andre." : ""));
    tegn();
  }
  function skrivRumXml() {
    var fejl = rumEksportFejl();
    if (fejl) { vis(fejl); tegn(); return; }
    var kopi = S.p, navn = "";
    if (S.rum != null && S.rum !== "" && kopi.konstruktioner.some(function (c) { return c.aabninger.some(function (o) { return o.rum && o.rum.length; }); })) {
      var r = ((S.info && S.info.rum) || []).filter(function (x) { return String(x.id) === String(S.rum); })[0]; navn = r ? r.navn : String(S.rum);
      kopi = M.medRum(S.p, S.rum, navn);
    }
    gemFil(filnavn(S.p.bygning.id, navn ? " - " + navn : " - sommerkomfort"), B.skriv(kopi));
    vis("Filen til sommerkomfort er gemt. Importér den i Energy Design, og skriv timerne ind her bagefter.");
    tegn();
  }
  function importer(tekst) {
    try {
      var u = B.laes(tekst);
      S.p = u.model; S.kilde = "xml"; S.info = { advarsler: u.advarsler, afklares: [], ikkeOverfoert: (u.ikkeOverfoert || []).concat(u.noter || []) }; S.rum = null;
      if (!S.p.etager) S.p.etager = (S.p.areas || []).filter(function (a) { return a.type === "NORMAL"; }).length || 2;
      S.fane = "overblik";
      var nIkke = u.advarsler.length + (u.ikkeOverfoert || []).length;
      vis("XML-filen er importeret" + (nIkke ? ", med forbehold. Ikke alt i filen kom med. Se Skal afklares på Overblik." : "."));
      gem();
    } catch (e) { vis(e.message); }
    tegn();
  }
  function bind() {
    var el = S.el;
    el.onchange = function (ev) {
      var t = ev.target, a;
      if ((a = t.getAttribute("data-k"))) { var vx=feltTal(t); if(!vx.ok)return; var v=vx.vaerdi; if (v < 0 && !/rotation|orient/.test(a)) { vis("Værdien kan ikke være negativ."); tegn(); return; } saetFelt(a, v); if (a === "ventilation.air_tightness") S.p.ventilation.qid = Math.round((0.04 + 0.06 * v) * 1000) / 1000; if (a === "bygning.ae") { S.p.ventilation.area = v; S.p.brug.area = v; } if (/^unheated\./.test(a)) { var bb = M.bFaktor(S.p.unheated); S.p.konstruktioner.forEach(function (c) { if (c.mod_uopvarmet) c.b = bb; }); } gem(); tegn(); return; }
      if ((a = t.getAttribute("data-t"))) { var f = forfaelder(a); if (f.o) { f.o[f.k] = t.value.trim() || null; gem(); tegn(); } return; }
      if ((a = t.getAttribute("data-fc"))) { var fx=feltTal(t,{navn:"Fc",min:0,max:1}); if(!fx.ok)return; var fc=fx.vaerdi; var o = hentFelt(a); o.fc = (o.fc < 0 ? -1 : 1) * fc; (o.rettet = o.rettet || {}).fc = 1; gem(); tegn(); return; }
      if ((a = t.getAttribute("data-fcs"))) { var o2 = hentFelt(a); o2.fc = (t.checked ? -1 : 1) * Math.abs(o2.fc == null ? 1 : o2.fc); gem(); tegn(); return; }
      if ((a = t.getAttribute("data-ot"))) { hentFelt(a).ot = t.checked; gem(); tegn(); return; }
      if ((a = t.getAttribute("data-skygge"))) { var d=a.split("."),sx=feltTal(t,{navn:"Skyggevinkel",min:0,max:90}); if(!sx.ok)return; var s=sx.vaerdi; if(s>=90){if(t.setCustomValidity)t.setCustomValidity("Skyggevinklen skal være mindre end 90°.");if(t.reportValidity)t.reportValidity();return;} S.p.konstruktioner[+d[0]].aabninger.forEach(function (x) { x.skygge[d[1]] = s; }); gem(); tegn(); return; }
      if (t.id === "enPv") { if (t.checked) S.p.solceller = { id: "Solceller", area: 20, orient: 180, slope: 15, horizon: 5, peak_power: 0.2, efficiency: 0.8, kilde: "antaget" }; else delete S.p.solceller; gem(); tegn(); return; }
      if (t.id === "enType") { S.p.bygning.has_btype = t.value; gem(); return; }
      if (t.id === "enRum") { S.rum = t.value; var r = ((S.info && S.info.rum) || []).filter(function (x) { return String(x.id) === String(S.rum); })[0]; if (r && r.areal) S.p.rum.area = Math.round(r.areal * 10) / 10; gem(); tegn(); return; }
      if (t.id === "enKaelder") { if (fraModel(t.checked)) { gem(); tegn(); } return; }
      if (t.id === "enFil") { var fil = t.files && t.files[0]; if (!fil) return; var rd = new FileReader(); rd.onload = function () { importer(String(rd.result)); }; rd.readAsText(fil, "utf-8"); }
    };
    el.onclick = function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest("button") : null; if (!t) return;
      var a;
      if ((a = t.getAttribute("data-fane"))) { S.fane = a; gem(); tegn(); var b = el.querySelector(".v3-pbody") || el; b.scrollTop = 0; el.scrollTop = 0; return; }
      if ((a = t.getAttribute("data-vaelg"))) { var ids = a.split(",").map(Number), api = S.api; if (api && api.vaelg && api.indeks) api.vaelg(ids.map(function (i) { return api.indeks(i); }).filter(function (i) { return i != null && i >= 0; })); return; }
      if ((a = t.getAttribute("data-fjern")) != null) { var c = S.p.konstruktioner[+a]; if (c.aabninger.length) { vis("Bygningsdelen har vinduer eller døre. Fjern dem først, eller ret arealet."); tegn(); return; } S.p.konstruktioner.splice(+a, 1); gem(); tegn(); return; }
      if ((a = t.getAttribute("data-fjernlinje")) != null) { S.p.kuldebroer.splice(+a, 1); gem(); tegn(); return; }
      if ((a = t.getAttribute("data-fjernres")) != null) { S.p.sommer.splice(+a, 1); gem(); tegn(); return; }
      if (t.id === "enNyLinje") { S.p.kuldebroer.push({ id: "Ny samling", laengde: 0, psi: 0.05, type: 104, kilde: "antaget" }); gem(); tegn(); return; }
      if (t.id === "enAfklar") { S.afklarAaben = !S.afklarAaben; tegn(); return; }
      if (t.id === "enXml") { skrivXml(); return; }
      if (t.id === "enRumXml") { skrivRumXml(); return; }
      if (t.id === "enRapTyp") { var rt = rapportTekst(); if (rt && window.IssanaTypstRapport.gem(rt.fil, rt.tekst)) vis("Typst-filen er gemt som " + rt.fil + "."); tegn(); return; }
      if (t.id === "enRapPdf") { rapportPdf(); return; }
      if (t.id === "enRapCompose") { rapportCompose(); return; }
      if (t.id === "enImport") { var fi = el.querySelector("#enFil"); if (fi) fi.click(); return; }
      if (t.id === "enHent") { if (fraModel(!S.info || S.info.kaelderUopvarmet !== false)) { vis("Modellen er læst forfra. Dine rettelser er nulstillet."); gem(); } tegn(); return; }
      if (t.id === "enResNy") {
        var n = el.querySelector("#enResNavn").value.trim();
        if (!n) { sommerFejl("Skriv rummets navn.", "enResNavn"); return; }
        var sommer = F.sommer(el.querySelector("#enRes27").value, el.querySelector("#enRes28").value);
        if (!sommer.ok) { sommerFejl(sommer.fejl, sommer.felt); return; }
        (S.p.sommer = S.p.sommer || []).push({ navn: n, t27: sommer.t27, t28: sommer.t28 }); gem(); tegn();
      }
    };
  }

  function indsaetCss() { if (document.getElementById("energi-css")) return; var s = document.createElement("style"); s.id = "energi-css"; s.textContent = CSS; document.head.appendChild(s); }
  function monter(container, api) {
    S.el = container; S.api = api; S.modelNoegle = null;
    indsaetCss(); tegn();
    if (api && api.paa) api.paa("model", function () { S.modelNoegle = null; S.rum = null; if (container.offsetParent !== null) tegn(); });
    return { opdater: tegn, luk: function () { gem(); } };
  }

  var registreret = false;
  function registrer(ar) { if (registreret || !ar || typeof ar.registrerFane !== "function") return false; registreret = true; ar.registrerFane({ id: "energi", titel: "Energi", bred: true, monter: monter, vis: function () { tegn(); } }); return true; }
  if (!registrer(window.issanaArbejdsrum)) (window.issanaArbejdsrumVentende = window.issanaArbejdsrumVentende || []).push(registrer);
  window.IssanaEnergiFane = { monter: monter, opdater: tegn, tilstand: S, rapport: rapportTekst, rapportPdf: rapportPdf, rapportCompose: rapportCompose };
})();
