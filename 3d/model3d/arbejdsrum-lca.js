/* ISSANA 3D: LCA-fanen. Ét regnested: ISSANA LCA's Rust-kerne (plugin-metoden issana_lca_beregn, Model3dLca.cs).
   Panelet regner ingen CO₂ selv. Øverst: opsætning (bygningstype, referenceareal), «Beregn med ISSANA LCA», «Åbn i ISSANA LCA»
   og «Importér LCAbyg-fil»; så Rusts resultat uændret (total kg CO₂e/m²/år, moduler, bygningsdele, status og mangler, hvor et klik
   vælger elementerne i 3D); tabellen «Sådan er tallet regnet» (bygningsdel | konstruktion | byggevare | EPD pr. byggevare), hvor
   brugeren selv vælger datasæt eller egen EPD og retter mængde og levetid pr. byggevare («Ret»); nederst LCAbyg-strukturen fra modellen.
   motor = window.issanaLca (arbejdsrum-ai.js): projekt/beregn/gem/importer/indstillinger/sidste/vaelg/paaAendring.
   I browseren: window.IssanaLcaPanel; i Node: module.exports (tests/web-model3d/arbejdsrum-lca.test.mjs). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IssanaLcaPanel = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var BYGNINGSTYPER = [
    { id: 'single_family', navn: 'Enfamiliehus, række- eller dobbelthus (6,7)' }, { id: 'apartment', navn: 'Etageboligbyggeri (7,5)' },
    { id: 'office', navn: 'Kontor, handel, lager (7,5)' }, { id: 'holiday_under_150', navn: 'Fritidshus under 150 m² (4,0)' },
    { id: 'holiday_150_plus', navn: 'Fritidshus 150 m² og derover (6,7)' }, { id: 'other', navn: 'Andet byggeri (8,0)' }];
  var MODUL_TEKST = { 'A1-A3': 'A1-3 Fremstilling af materialer', 'A4': 'A4 Transport til byggeplads', 'A5': 'A5 Byggeplads', 'B4': 'B4 Udskiftning af materialer', 'B6': 'B6 Energi i drift', 'C3': 'C3 Affaldsbehandling', 'C4': 'C4 Bortskaffelse', 'D': 'D Genbrugspotentiale (tæller ikke med)' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function tal(n, d) { return typeof n === 'number' && isFinite(n) ? n.toLocaleString('da-DK', {maximumFractionDigits: d == null ? 3 : d}) : '—'; }
  function ids(liste) { return esc((liste || []).join(',')); }

  /* ---------- LCAbyg-strukturen (kun data og mængder fra Revit; ingen CO₂) ---------- */
  function html(s, di, ki) {
    if (!s) return '<p>LCA-modulerne indlæses. Prøv «Opdater» om et øjeblik.</p>';
    var ds = s.bygningsdele || [], d = ds[di] || ds[0], ks = d ? d.konstruktioner : [], k = ks[ki] || ks[0];
    var h = '<h3>LCAbyg-struktur fra modellen</h3><p><b>' + s.tal.bygningsdele + ' bygningsdele · ' + s.tal.konstruktioner + ' konstruktioner · ' + s.tal.byggevarer + ' byggevarer</b><br>' + s.tal.udenEpd + ' mangler EPD/GWP · ' + s.tal.udenOpbygning + ' mangler opbygning</p>';
    h += '<p class="v3-hint">Data og mængder fra Revit. Generiske data er markeret. AI-forslag skal godkendes, før de bliver EPD-data. Strukturen regner ingen CO₂; tallene ovenfor kommer fra ISSANA LCA.</p><div class="lca-struktur">';
    h += '<div class="lca-kol-valg"><h3>Bygningsdele</h3>' + ds.map(function(x,i) { return '<button class="tbtn" style="white-space:normal;text-align:left;width:100%;margin-bottom:5px" data-lca-del="'+i+'" aria-pressed="'+(x===d)+'">'+esc(x.navn)+' ('+x.konstruktioner.length+')</button>'; }).join('') + '</div>';
    h += '<div class="lca-kol-valg"><h3>Konstruktioner</h3>' + ks.map(function(x,i) { return '<button class="tbtn" style="white-space:normal;text-align:left;width:100%;margin-bottom:5px" data-lca-type="'+i+'" aria-pressed="'+(x===k)+'">'+esc(x.navn)+'<br>'+x.antal+' stk · '+tal(x.areal)+' m²</button>'; }).join('') + '</div>';
    h += '<div><h3>Byggevarer / lag</h3>';
    if (k) h += '<b>'+esc(k.navn)+'</b>' + k.byggevarer.map(function(b) {
      if (b.medregnes === false) return '<article class="lca-lag"><b>'+esc(b.navn)+'</b>'+(b.tykkelseMm!=null?' · '+tal(b.tykkelseMm)+' mm':'')+'<p>Luftlag · medregnes ikke i LCA</p></article>';
      var epd = b.epd || {}, gwp = b.gwp || {};
      // Datasættets deklarerede faktorer (kg CO₂e pr. deklareret enhed) vises som kildedata; intet ganges eller summeres her.
      return '<article class="lca-lag"><b>'+esc(b.navn)+'</b>'+(b.tykkelseMm!=null?' · '+tal(b.tykkelseMm)+' mm':'')+'<p>'+tal(b.maengde)+' '+esc(b.enhed)+'</p><p>'+(b.status==='har' ? (b.generisk?'Generisk datasæt':'EPD/data')+': '+esc(epd.nummer || b.kilde || 'registreret') : '<strong class="issana-mangler">'+(b.opbygningMangler?'Opbygning mangler':'EPD/GWP mangler')+'</strong>')+'</p>'+Object.keys(gwp).map(function(m) { return '<div>'+esc(m)+': '+tal(gwp[m])+'</div>'; }).join('')+(b.kilde?'<small>'+esc(b.kilde)+'</small>':'')+'</article>';
    }).join('');
    var navigation='<div class="lca-navigation"><label>Bygningsdel<select data-lca-select="del">'+ds.map(function(x,i){return '<option value="'+i+'"'+(x===d?' selected':'')+'>'+esc(x.navn)+'</option>';}).join('')+'</select></label><label>Konstruktion<select data-lca-select="type">'+ks.map(function(x,i){return '<option value="'+i+'"'+(x===k?' selected':'')+'>'+esc(x.navn)+'</option>';}).join('')+'</select></label></div>';
    h=h.replace('<div class="lca-struktur">',navigation+'<div class="lca-struktur">');
    return h+'</div></div><p class="v3-hint">Skriv fx i AI-feltet: «Foreslå EPD til alle bygningsdele ud fra deres opbygning». Mangler vises, indtil et dokumenteret eller generisk datasæt er valgt.</p>';
  }

  /* ---------- Drift (B6), byggeplads (A5) og installationer ---------- */
  // Kun input; Rust regner. B6 = Be18-nøgletal × opvarmet areal × tabel 8.1 (lca-projekt.js energiPoster). Byggepladsens energi og
  // affald har ingen standardværdi i BR18; uden dem afgøres bygningen stadig, men byggeprocessen (A4/A5) får ingen afgørelse.
  var FORSYNINGER = [{ id: 'district_heat', navn: 'Fjernvarme' }, { id: 'electricity', navn: 'El (fx varmepumpe)' }, { id: 'gas', navn: 'Naturgas' }];
  var FRAKTIONER = ['Natursten', 'Uglaseret tegl (mur- og tagsten)', 'Beton', 'Jern og metal', 'Fibergips', 'Almindelig gips', 'Stenuld', 'Glasuld', 'Asfalt', 'Træ', 'Plastik', 'PVC', 'Glas', 'Emballagepap', 'Sanitet, fliser og glaserede tegl'];
  function felt(type, attr, navn, vaerdi, bredde, ekstra) {
    return '<label>' + esc(navn) + '<input type="' + type + '" ' + attr + ' value="' + (vaerdi == null ? '' : esc(vaerdi)) + '" style="width:' + (bredde || 90) + 'px"' + (ekstra || '') + '></label>';
  }
  // A5 byggeplads (forbrug og affald). Står i fanen «Spild og transport»; uden faner under «Drift og byggeplads».
  function byggepladsHtml(g) {
    var bp = g.byggeplads || {}, af = (bp.affald || [])[0] || {};
    var h = '<div class="lca-bp-hoved"><label>El <small>valgfrit · ellers standardsats</small><span><input type="number" data-lca-bp="elKwh" min="0" step="1" value="' + (bp.elKwh == null ? '' : esc(bp.elKwh)) + '"><i>kWh</i></span></label>';
    h += '<label>Byggevarme <small>valgfrit · ellers standardsats</small><span><input type="number" data-lca-bp="varmeKwh" min="0" step="1" value="' + (bp.varmeKwh == null ? '' : esc(bp.varmeKwh)) + '"><i>kWh</i></span></label>';
    h += '<label>Diesel <small>valgfrit · ellers standardsats</small><span><input type="number" data-lca-bp="dieselLiter" min="0" step="1" value="' + (bp.dieselLiter == null ? '' : esc(bp.dieselLiter)) + '"><i>liter</i></span></label></div>';
    h += '<h4 class="lca-bp-under">Byggeaffald <small>(valgfrit)</small></h4><div class="lca-bp-affald">';
    h += bpFelt('number', 'aar', 'Byggeår', bp.aar, '', 'min="2025" max="2100" step="1" placeholder="fx 2026"');
    h += '<label>Affaldsfraktion<span><select data-lca-bp="fraktion"><option value="">Vælg …</option>';
    h += FRAKTIONER.map(function (f) {
      return '<option' + (af.fraktion === f ? ' selected' : '') + '>' + esc(f) + '</option>';
    }).join('') + '</select></span></label>';
    h += bpFelt('number', 'affaldKg', 'Affald', af.kg, 'kg', 'min="0" step="1"');
    h += bpFelt('text', 'kilde', 'Kilde', bp.kilde, '', 'placeholder="fx byggepladsskema, skøn"');
    return h + '</div>';
  }
  function bpFelt(type, noegle, navn, vaerdi, enhed, ekstra) {
    var v = vaerdi == null ? '' : esc(vaerdi);
    return '<label>' + navn + '<span><input type="' + type + '" data-lca-bp="' + noegle + '" value="' + v + '" ' +
      (ekstra || '') + '>' + (enhed ? '<i>' + enhed + '</i>' : '') + '</span></label>';
  }
  function driftHtml(g, aaben, udenA5) {
    var b6 = g.b6 || {};
    var b6Klar = b6.varme != null && b6.el != null && b6.forsyning && b6.ibrugtagning && b6.kilde;
    var h = '<details data-lca-drift' + (aaben ? ' open' : '') + '><summary><b>' + (udenA5 ? 'Drift (B6)' : 'Drift og byggeplads') + '</b> · ' + (udenA5 ? 'kan udfyldes senere' : 'B6, A5 og installationer') + (b6Klar ? '' : ' · <span class="issana-mangler">mangler</span>') + '</summary>';
    h += '<p class="v3-hint">B6: Be18-nøgletal uden tillæg (kWh/m²/år). ISSANA LCA ganger med det opvarmede areal og BR18 tabel 8.1 for hvert år fra ibrugtagning.</p><div class="lca-raekke" style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:flex-end;margin:8px 0">';
    h += felt('number', 'data-lca-b6="opvarmetAreal" min="0" step="0.1"', 'Opvarmet etageareal (m²)', b6.opvarmetAreal, 100, ' placeholder="= referenceareal"');
    h += felt('number', 'data-lca-b6="varme" min="0" step="0.01"', 'Varme (kWh/m²/år)', b6.varme, 80);
    h += '<label>Varmeforsyning<select data-lca-b6="forsyning"><option value="">Vælg …</option>' + FORSYNINGER.map(function (f) { return '<option value="' + f.id + '"' + (b6.forsyning === f.id ? ' selected' : '') + '>' + esc(f.navn) + '</option>'; }).join('') + '</select></label>';
    h += felt('number', 'data-lca-b6="el" min="0" step="0.01"', 'El til drift (kWh/m²/år)', b6.el, 80);
    h += felt('number', 'data-lca-b6="ibrugtagning" min="2025" max="2100" step="1"', 'Ibrugtagningsår', b6.ibrugtagning, 70);
    h += felt('text', 'data-lca-b6="kilde"', 'Kilde', b6.kilde, 200, ' placeholder="fx Be18-beregning 12.03.2027, nøgletal"');
    h += '</div>' + (udenA5 ? '' : byggepladsHtml(g)) + '<label style="display:block;margin-top:6px"><input type="checkbox" data-lca-felt="installationer"' + (g.installationer === false ? '' : ' checked') + '> Installationer med BR18 tabel 7\'s standardværdier pr. m² opvarmet areal (modellens vand-, varme- og ventilationsdele medregnes så ikke)</label>';
    return h + '</details>';
  }
  function tal0(v) { var n = Number(String(v).replace(',', '.')); return String(v).trim() !== '' && isFinite(n) ? n : null; }

  /* ---------- Opsætning og knapper ---------- */
  // g: motor.indstillinger(); forslag: {m2, kilde} (sum af gulve); t: {erRevit, igang, info, fejl}
  function opsaetningHtml(g, forslag, t) {
    g = g || {}; t = t || {};
    var ref = g.referenceareal || null;
    var h = '<h3>Bygningen</h3><div class="lca-starttrin">';
    h += '<section><b><i>1</i> Bygningstype</b><select data-lca-felt="bygningstype"><option value="">Vælg bygningstype …</option>' + BYGNINGSTYPER.map(function (b) { return '<option value="' + b.id + '"' + (g.bygningstype === b.id ? ' selected' : '') + '>' + esc(b.navn) + '</option>'; }).join('') + '</select><small class="v3-hint">Hotel, butik, institution m.m. hører under Andet byggeri (grænse 8,0).</small></section>';
    h += '<section><b><i>2</i> Referenceareal</b><div class="lca-areal"><input type="text" inputmode="decimal" data-lca-felt="referenceareal" value="' + (ref && ref.m2 > 0 ? esc(String(ref.m2).replace('.', ',')) : '') + '" aria-label="Referenceareal i kvadratmeter"><span>m²</span>';
    if (forslag && (!ref || ref.m2 !== forslag.m2)) h += '<button class="tbtn" data-lca-brug-areal="' + esc(forslag.m2) + '">Brug forslaget ' + tal(forslag.m2, 0) + ' m²</button>';
    h += '</div></section><section><b><i>3</i> Beregn</b><button class="tbtn' + (t.harResultat ? '' : ' primary') + '" data-lca-beregn' + (t.igang || !g.bygningstype || !(ref && ref.m2 > 0) ? ' disabled' : '') + '>' + (t.igang ? 'Beregner …' : 'Beregn med ISSANA LCA') + '</button></section></div>';
    if (ref && ref.kilde) h += '<p class="v3-hint">Referenceareal: ' + esc(ref.kilde) + '</p>';
    h += driftHtml(g, t.aabenDrift, t.udenA5);
    // Med faner står knapper og beskeder øverst i fanen (toppenHtml), ikke her.
    if (t.udenKnapper) return h;
    return h + knapperHtml(t) + statusHtml(t);
  }
  function knapperHtml(t) {
    return '<button class="tbtn lcak-link" data-lca-aabn>Åbn i ISSANA LCA</button>';
  }
  function statusHtml(t) {
    var h = '';
    if (!t.erRevit) h += '<p class="issana-mangler">Beregningen kræver, at fanen åbnes fra Revit.</p>';
    var info = t.info;
    if (info && info.motor) h += '<details class="lca-om"><summary>Om beregningen</summary><p class="v3-hint">Motor: ' + (info.motor.findes ? 'issana-lca-core.exe' + (info.version && info.version.kilde ? ' · commit ' + esc(String(info.version.kilde.commit || '').slice(0, 7)) : '') : '<span class="issana-mangler">mangler</span>') + (info.katalog ? ' · katalog ' + esc(info.katalog.id) : '') + '</p></details>';
    if (t.fejl) h += '<p class="issana-mangler">' + esc(t.fejl) + '</p>';
    if (t.besked) h += '<p class="v3-hint">' + esc(t.besked) + '</p>';
    return h;
  }

  /* ---------- Rusts resultat (uændret; ingen regning her) ---------- */
  function primaerHandling(g, o, t, epdForslag) {
    g = g || {}; t = t || {};
    if (!g.bygningstype || !(g.referenceareal && g.referenceareal.m2 > 0)) return { id: 'bygning', tekst: 'Udfyld bygning', attr: 'data-lca-udfyld-bygning' };
    var grupper = o && o.grupper || [], find = function (id) { return grupper.filter(function (x) { return x.id === id; })[0]; }, grp = find('miljoedata');
    var bek = find('bekraeft');
    var forslagKendt = typeof epdForslag === 'number';
    if (forslagKendt ? epdForslag > 0 : !!bek) return { id: 'bekraeft', tekst: 'Bekræft ' + (forslagKendt ? epdForslag : bek.antal) + ' forslag', attr: 'data-lca-bekraeft' };
    var rawForsoegt = t.forslagForsoegt, forsoegt = rawForsoegt || {}, poster = grp && grp.mangler || [], ikkeForsoegt = poster.filter(function (m, i) { var id = m.id || m.target_id || m.navn || m.tekst || i; return !forsoegt[id]; }).length;
    if (grp && (poster.length ? ikkeForsoegt : !rawForsoegt)) return { id: 'foreslaa', tekst: 'Foreslå data for ' + (poster.length ? ikkeForsoegt : grp.antal) + ' byggevarer', attr: 'data-lca-foreslaa' };
    if (grp) return { id: 'vaelg-data', tekst: 'Vælg data for ' + udenDataAntal(o) + ' byggevarer', attr: 'data-lca-vaelg-data' };
    return { id: 'beregn', tekst: t.igang ? 'Beregner …' : 'Beregn igen', attr: 'data-lca-beregn', disabled: !!t.igang };
  }
  function handlingKnap(a, ekstraKlasse) {
    if (!a) return '';
    return '<button class="tbtn primary ' + (ekstraKlasse || '') + '" ' + a.attr + (a.disabled ? ' disabled' : '') + '>' + esc(a.tekst) + '</button>';
  }
  function overblikHtml(o, kompakt, handling) {
    if (!o) return '<section class="lca-overblik lca-overblik-tom" data-lca-overblik><div><span class="lca-overblik-status">Klar til opsætning</span><b>Beregn bygningens klimaaftryk</b></div>' + handlingKnap(handling) + '</section>';
    var foreloebig = o.overholdt == null || (o.daekning && o.daekning.regnet < o.daekning.byggevarer);
    var status = foreloebig ? 'Foreløbigt' : o.overholdt === true ? 'Under grænsen' : 'Over grænsen';
    var klasse = foreloebig ? 'mangler' : o.overholdt === true ? 'ok' : 'fejl';
    var skala = o.graense > 0 ? Math.max(o.graense * 1.25, o.total || 0) : 1, pct = Math.max(0, Math.min(100, (o.total || 0) / skala * 100)), graensePct = o.graense > 0 ? o.graense / skala * 100 : 80;
    var grundPct = Math.min(pct, graensePct), overPct = Math.max(0, pct - graensePct);
    var h = '<section class="lca-overblik ' + klasse + '" data-lca-overblik><div class="lca-overblik-hoved"><span class="lca-overblik-status">' + status + '</span><div><b>' + tal(o.total, 2) + '</b><span> af ' + tal(o.graense, 1) + ' kg CO₂e/m²/år</span></div></div>' + handlingKnap(handling);
    h += '<div class="lca-graensebar' + (foreloebig ? ' foreloebig' : '') + '" role="img" aria-label="' + esc(status + ': ' + tal(o.total, 2) + ' af ' + tal(o.graense, 1)) + '"><span class="lca-bar-grund' + (!foreloebig && o.overholdt === true ? ' endelig-ok' : '') + '" style="width:' + grundPct.toFixed(1) + '%"></span>' + (overPct ? '<span class="lca-bar-over" style="left:' + graensePct.toFixed(1) + '%;width:' + overPct.toFixed(1) + '%"></span>' : '') + '<i style="left:' + graensePct.toFixed(1) + '%"><em>grænse ' + tal(o.graense, 1) + '</em></i></div>';
    if (!kompakt && o.daekning) h += '<p data-lca-daekning><b>Data ' + o.daekning.regnet + ' af ' + o.daekning.byggevarer + ' byggevarer</b>' + daekningManglerTekst(o) + (o.daekning.installationer ? ' · installationer med standarddata' : '') + '</p>';
    return h + '</section>';
  }
  function udenDataAntal(o, b, valg) {
    var d = o && o.daekning;
    if (d && typeof d.udenData === 'number') return d.udenData;
    if (b) return manglendeByggevarer(b, valg || {}).length;
    var gruppe = ((o && o.grupper) || []).filter(function (g) { return g.id === 'miljoedata'; })[0];
    return gruppe ? gruppe.antal : 0;
  }
  function daekningManglerTekst(o, kort) {
    var d = o.daekning || {};
    var uden = udenDataAntal(o);
    var andre = Math.max(0, (d.byggevarer || 0) - (d.regnet || 0) - uden);
    var maengde = ((o.grupper || []).filter(function (g) { return g.id === 'maengde'; })[0] || {}).antal || 0;
    var andenTekst = andre ? (maengde === andre ? andre + ' uden mængde' : andre + ' med anden mangel') : '';
    return ' · ' + uden + (kort ? ' mangler' : ' uden miljødata') + (andenTekst ? ' · ' + andenTekst : '');
  }

  // Sorterer kun de rater, Rust allerede har leveret. Der summeres eller udledes ingen CO₂-tal i browseren.
  function hotspotData(b) {
    return ((b && b.dele) || []).filter(function (d) { return d.prM2 > 0; }).slice().sort(function (a, z) { return z.prM2 - a.prM2; });
  }
  function hotspotNulgrupper(b) { return ((b && b.dele) || []).filter(function (d) { return d.prM2 === 0; }); }
  function hotspotHtml(b) {
    var dele = hotspotData(b), nul = hotspotNulgrupper(b), max = dele.length ? dele[0].prM2 : 0;
    var h = '<section class="lca-sektion" data-lca-hotspots><div class="lca-sektion-hoved"><h3>Hvad fylder mest?</h3><span>kg CO₂e/m²/år</span></div>';
    if (!dele.length) return h + '<p class="lca-tom"><b>Ingen byggevarer har miljødata endnu</b><br>Tilføj eller foreslå data for at se bygningens hotspots.</p></section>';
    h += '<div class="lca-hotspots">' + dele.map(function (d) {
      var bredde = max > 0 ? Math.max(1, d.prM2 / max * 100) : 0;
      var ks = (d.konstruktioner || []).map(function (k) { return '<button class="lca-hotspot-kon" data-lca-vaelg="' + ids(k.elementIds) + '"' + ((k.elementIds || []).length ? '' : ' disabled') + '><span>' + esc(k.navn) + '</span><small>' + ((k.elementIds || []).length ? 'Vis i 3D' : 'Ingen elementer') + '</small></button>'; }).join('');
      return '<details class="lca-hotspot"><summary><span class="lca-hotspot-navn">' + esc(d.navn) + '</span><span class="lca-hotspot-spor"><i style="width:' + bredde.toFixed(1) + '%"></i></span><b class="lca-hotspot-tal">' + tal(d.prM2, 2) + '</b></summary><div class="lca-hotspot-kons">' + (ks || '<span class="v3-hint">Ingen konstruktioner i gruppen.</span>') + '</div></details>';
    }).join('');
    if (b && b.b6 && b.b6.rate === 0) nul.push({ navn: 'Drift (B6)' });
    if (b && b.b6 && b.b6.rate > 0) h += '<div class="lca-hotspot lca-hotspot-fast"><span>Drift (B6)</span><span class="lca-hotspot-spor"><i style="width:' + Math.min(100, Math.max(1, b.b6.rate / max * 100)).toFixed(1) + '%"></i></span><b>' + tal(b.b6.rate, 2) + '</b></div>';
    if (nul.length) h += '<div class="lca-hotspot-nul">Uden udledning endnu: ' + nul.map(function (d) { return esc(d.navn); }).join(', ') + '</div>';
    h += '</div><p class="v3-hint">Installationer kan også indgå i totalen. De vises ikke som egen række, fordi resultatet ikke indeholder et særskilt tal pr. m²/år.</p></section>';
    return h;
  }

  function faserOverblikHtml(o) {
    var alle = (o && o.moduler) || [], map = {}; alle.forEach(function (m) { map[m.modul] = m; });
    var orden = ['A1-A3', 'A4', 'A5', 'B4', 'B6', 'C3', 'C4'], positive = orden.map(function (k) { return map[k] && map[k].kg; }).filter(function (v) { return typeof v === 'number' && isFinite(v) && v > 0; });
    var max = positive.length ? Math.max.apply(null, positive) : 0;
    var forklaring = { 'A1-A3': 'Råvarer og produktion af byggevarerne', A4: 'Transport til byggepladsen', A5: 'Energi og spild på byggepladsen', B4: 'Udskiftning af materialer', B6: 'Energi til bygningens drift', C3: 'Behandling af materialer som affald', C4: 'Endelig bortskaffelse' };
    var kort = { 'A1-A3': 'Fremstilling', A4: 'Transport', A5: 'Byggeplads', B4: 'Udskiftning', B6: 'Drift', C3: 'Affaldsbehandling', C4: 'Bortskaffelse' };
    var h = '<section class="lca-sektion" data-lca-faser><div class="lca-sektion-hoved"><h3>Faser</h3><span>kg CO₂e</span></div><div class="lca-faser">';
    h += orden.map(function (k) { var m = map[k] || {}, bredde = max > 0 && m.kg > 0 ? Math.max(1, m.kg / max * 100) : 0; return '<div class="lca-fase' + (!(m.kg > 0) ? ' nul' : '') + '" title="' + esc((k === 'A1-A3' ? 'A1-3 Fremstilling: ' : k + ': ') + forklaring[k]) + '"><span><b>' + esc(k === 'A1-A3' ? 'A1-3' : k) + '</b> ' + esc(kort[k]) + '</span><span class="lca-fase-spor"><i style="width:' + bredde.toFixed(1) + '%"></i></span><b>' + tal(m.kg, 0) + '</b></div>'; }).join('');
    var d = map.D || {};
    return h + '</div><div class="lca-fase-d"><span><b>D</b> Genbrugspotentiale</span><b>' + tal(d.kg, 0) + ' kg CO₂e</b><small>Tæller ikke med i BR18-grænsen</small></div></section>';
  }

  // o: IssanaLcaProjekt.oversigt(rust, ud); ud: bygProjekt-resultatet (noter); valg: {kompakt, levetidFor}
  function resultatHtml(o, ud, valg) {
    valg = valg || {};
    if (!o) return '<p class="v3-hint">ISSANA LCA har ikke regnet endnu. Vælg bygningstype og referenceareal, og tryk «Beregn med ISSANA LCA».</p>';
    var h = '<div data-lca-resultat>';
    var afg = o.overholdt === true ? 'overholdt' : o.overholdt === false ? '<span class="issana-mangler">overskredet</span>' : 'ingen afgørelse (mangler)';
    h += overblikHtml(o, false, valg.handling);
    if (o.mangler.length) h += valg.kompakt ? manglerKortHtml(o) : manglerHtml(o, valg);
    if (!valg.analyseTrin) h += hotspotHtml(o.beregning) + faserOverblikHtml(o);
    h += '<details class="lca-resultat-detaljer"><summary>Vis alle tal</summary><div class="lca-tote"><div class="lca-card"><div class="v">' + tal(o.total, 2) + '</div><div class="k">kg CO₂e/m²/år (ISSANA LCA)</div></div>';
    h += '<div class="lca-card"><div class="v">' + (o.graense != null ? tal(o.graense, 1) : '—') + '</div><div class="k">BR18-grænse · ' + afg + '</div></div>';
    if (o.proces && o.proces.total != null) h += '<div class="lca-card"><div class="v">' + tal(o.proces.total, 2) + '</div><div class="k">A4+A5 byggeproces · grænse 1,5 · ' + (o.proces.overholdt === true ? 'overholdt' : o.proces.overholdt === false ? '<span class="issana-mangler">overskredet</span>' : 'ingen afgørelse (mangler)') + '</div></div>';
    if (o.tal) h += '<div class="lca-card"><div class="v">' + tal(o.tal.calculated_products, 0) + ' / ' + tal(o.tal.products, 0) + '</div><div class="k">byggevarer beregnet</div></div>';
    h += '</div>';
    // Dækningen står lige under tallet: et total over få af byggevarerne må aldrig ligne et resultat.
    var d0 = o.daekning;
    if (d0) h += '<p class="' + (d0.regnet < d0.byggevarer ? 'issana-mangler' : 'v3-hint') + '"><b>Tallet dækker ' + d0.regnet + ' af ' + d0.byggevarer + ' byggevarer</b>' +
      (d0.installationer ? ' + installationer (tabel 7-standardværdier)' : '') + (d0.regnet < d0.byggevarer ? '. Resten er ikke regnet endnu: se «Det mangler» herunder.' : '.') + '</p>';
    h += '<p><b>Status:</b> ' + (o.status === 'calculated_draft' ? esc(o.statusTekst) : '<span class="issana-mangler">' + esc(o.statusTekst) + '</span>') + '</p>';
    h += '<table class="lca"><thead><tr><th>Modul</th><th class="n">kg CO₂e</th></tr></thead><tbody>' + o.moduler.map(function (m) { return '<tr><td>' + esc(MODUL_TEKST[m.modul] || m.modul) + '</td><td class="n">' + tal(m.kg, 0) + '</td></tr>'; }).join('') + '</tbody></table>';
    if (!valg.kompakt && o.bygningsdele.length) {
      h += '<h3>Pr. bygningsdel (kg CO₂e)</h3><table class="lca"><thead><tr><th>Bygningsdel</th><th class="n">A1-A3</th><th class="n">B4</th><th class="n">C3</th><th class="n">C4</th><th class="n">D</th></tr></thead><tbody>';
      h += o.bygningsdele.map(function (d) { return '<tr' + (d.elementIds.length ? ' data-lca-vaelg="' + ids(d.elementIds) + '" style="cursor:pointer" title="Vis i 3D"' : '') + '><td>' + esc(d.navn) + '</td>' + ['A1-A3', 'B4', 'C3', 'C4', 'D'].map(function (k) { return '<td class="n">' + tal(d.moduler[k], 0) + '</td>'; }).join('') + '</tr>'; }).join('');
      h += '</tbody></table>';
    }
    h += '</details>';
    var tb = valg.venter ? null : (valg.beregning || o.beregning);
    if (valg.iFane) { if (tb) h += '<h3>Sådan er resultatet summeret</h3>' + summeringHtml(tb); }   // kolonnerne har deres egen fane
    else if (!valg.kompakt && (tb || valg.venter)) h += kolonnerHtml(tb, valg);
    if (!valg.kompakt && ud && ud.noter && ud.noter.length) h += '<details><summary>Forklaringer fra 3D (' + ud.noter.length + ')</summary><ul>' + ud.noter.map(function (n) { return '<li>' + esc(n.tekst) + (n.id && ud.kort && ud.kort[n.id] && ud.kort[n.id].length ? ' <button class="tbtn" data-lca-vaelg="' + ids(ud.kort[n.id]) + '">Vis i 3D</button>' : '') + '</li>'; }).join('') + '</ul></details>';
    if (!valg.kompakt && o.advarsler.length) h += '<details><summary>Advarsler fra ISSANA LCA (' + o.advarsler.length + ')</summary><ul>' + o.advarsler.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></details>';
    return h + '<p class="v3-hint">Beregnet af ISSANA LCA ud fra modellens mængder. Datasæt, mængder og levetider kan rettes under Model.</p></div>';
  }

  /* ---------- Det mangler: samlet efter type med én handling pr. type ---------- */
  // o.grupper: IssanaLcaProjekt.grupperMangler (rækkefølge = den rækkefølge, de løses i). valg: {levetidFor, epdForslag}.
  var HANDLING_KNAP = {
    foreslaa: function (g) { return '<button class="tbtn" data-lca-foreslaa>Foreslå data</button>'; },
    vaelgData: function () { return '<button class="tbtn" data-lca-vaelg-data>Vælg data</button>'; },
    bekraeft: function (g, valg) { var n = valg.bulkEpdForslag != null ? valg.bulkEpdForslag : valg.epdForslag || g.antal; return n > 0 ? '<button class="tbtn" data-lca-bekraeft>Bekræft ' + n + ' forslag</button>' : '<button class="tbtn" data-lca-vaelg-data>Se dem</button>'; },
    udfyld: function (g) { return '<button class="tbtn" data-lca-udfyld="' + esc(g.id) + '">Udfyld</button>'; },
    levetid: function () { return ''; }, vaelg: function (g) { return '<button class="tbtn" data-lca-vis-mangel="' + esc(g.id) + '">Vis</button>'; }
  };
  function samletMangler(liste) {
    var efter = {}, orden = [];
    (liste || []).forEach(function (m) {
      var navn = String(m.navn || m.tekst || 'Mangel').replace(/[.:]\s*(miljødata\/EPD mangler|dokumenteret levetid mangler|.*mangler).*$/i, '').replace(/\s*\(opbygning mangler\)\s*$/i, '').trim() || 'Mangel';
      var key = navn.toLowerCase(), r = efter[key];
      if (!r) { r = efter[key] = { navn: navn, antal: 0, elementIds: [], poster: [] }; orden.push(r); }
      r.antal++; r.poster.push(m); (m.elementIds || []).forEach(function (id) { if (r.elementIds.indexOf(id) < 0) r.elementIds.push(id); });
    });
    return orden;
  }
  function manglerHtml(o, valg) {
    var grupper = o.grupper && o.grupper.length ? o.grupper : [{ id: 'oevrige', titel: 'Mangler', hjaelp: '', handling: 'vaelg', antal: o.mangler.length, mangler: o.mangler, elementIds: [] }];
    var bek = grupper.filter(function (g) { return g.id === 'bekraeft'; })[0], mangler = grupper.filter(function (g) { return g.id !== 'bekraeft'; });
    var h = '';
    if (bek) { var alleN = typeof valg.epdForslag === 'number' ? valg.epdForslag : bek.antal, n = valg.bulkEpdForslag != null ? valg.bulkEpdForslag : alleN, usikre = Math.max(0, alleN - n); if (alleN > 0) h += '<div class="lca-forslag-venter"><b>Forslag venter på din bekræftelse</b><span>' + alleN + '</span>' + (n > 0 ? '<button class="tbtn" data-lca-bekraeft>Bekræft ' + n + ' forslag</button>' : '<button class="tbtn" data-lca-vaelg-data>Se dem</button>') + '</div>' + (usikre ? '<p class="v3-hint">' + usikre + ' forslag er usikre eller ser forkerte ud og skal ses igennem enkeltvis.' + (n > 0 ? ' <button class="tbtn" data-lca-vaelg-data>Se dem</button>' : '') + '</p>' : ''); }
    if (!mangler.length) return h;
    h += '<h3>' + mangler.length + ' ting mangler</h3><p class="v3-hint">Løs punkterne oppefra. Hver knap fører til det sted, hvor oplysningen kan rettes.</p><div class="lca-mangelgrupper">';
    mangler.forEach(function (g) {
      var vis = samletMangler(g.mangler).slice(0, 40);
      var gruppeAntal = g.id === 'miljoedata' && valg.udenDataAntal != null ? valg.udenDataAntal : g.antal;
      var handlingstype = g.id === 'miljoedata' && valg.handling && valg.handling.id === 'vaelg-data' ? 'vaelgData' : g.handling;
      var handling = (HANDLING_KNAP[handlingstype] || HANDLING_KNAP.vaelg)(g, valg);
      h += '<div class="lca-mangelgruppe" data-lca-gruppe="' + esc(g.id) + '"><details><summary><b>' + esc(g.titel) + '</b><span>' + gruppeAntal + '</span></summary><p class="v3-hint">' + esc(g.hjaelp) + '</p><ul class="lca-mangler">';
      h += vis.map(function (r) {
        var m = r.poster[0], lv = m.id && /levetid mangler/.test(m.tekst), form = lv && valg.levetidFor === m.id ? '<div class="lca-raekke" style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:flex-end;margin:4px 0"><label>År<input type="number" min="1" step="1" data-lca-lv-aar style="width:70px"></label><label>Kilde<input type="text" data-lca-lv-kilde placeholder="fx BUILD levetidstabel 2021" style="width:190px"></label><button class="tbtn" data-lca-lv-gem="' + esc(m.id) + '">Gem</button></div>' : '';
        return '<li><span><b>' + esc(r.navn) + '</b>' + (r.antal > 1 ? ' · ' + r.antal + ' ens' : '') + (r.elementIds.length ? ' · ' + r.elementIds.length + ' elementer' : '') + '</span>' + (r.elementIds.length ? '<button class="tbtn" data-lca-vaelg="' + ids(r.elementIds) + '">Vis i 3D</button>' : '') + (lv && valg.levetidFor !== m.id ? '<button class="tbtn" data-lca-levetid="' + esc(m.id) + '">Angiv levetid</button>' : '') + form + '</li>';
      }).join('') + '</ul></details>' + handling + '</div>';
    });
    return h + '</div>';
  }
  // AI-svaret: én linje pr. type.
  function manglerKortHtml(o) {
    var grupper = o.grupper && o.grupper.length ? o.grupper : [];
    if (!grupper.length) return '<h3>Mangler fra ISSANA LCA (' + o.mangler.length + ')</h3>';
    return '<h3>Mangler fra ISSANA LCA (' + o.mangler.length + ')</h3><ul class="lca-mangler">' + grupper.map(function (g) {
      return '<li><b>' + esc(g.titel) + '</b> · ' + g.antal + (g.elementIds.length ? ' <button class="tbtn" data-lca-vaelg="' + ids(g.elementIds) + '">Vis i 3D (' + g.elementIds.length + ')</button>' : '') + '</li>';
    }).join('') + '</ul><p class="v3-hint">Løs dem i LCA-fanen: én knap pr. type.</p>';
  }

  /* ---------- Sådan er tallet regnet: én tabel bygningsdel | konstruktion | byggevare | EPD, som brugeren selv kan rette ---------- */
  // b: IssanaLcaProjekt.beregning(rust, ud) (motor.tabel()). Hver række: mængde × datasættets faktor = A1-A3; levetid →
  // udskiftninger (B4); C3, C4 og A4. Alle tal er Rusts; panelet regner intet. «Ret» åbner en række under byggevaren: et andet
  // BR18 tabel 7-datasæt, en egen EPD, mængde eller levetid (motor.vaelgEpd/maengde/levetid), hvorefter ISSANA LCA regner igen.
  // valg: {ret (byggevare-id), fane ('datasaet'|'egen'|'maengde'|'levetid'), filterDel, kunMangler, foraeldet, regnet, kandidater, datasaet,
  //   omfang (maal: {alle}|{etage:[…]}|{valgte}|{elementIds:[…]}), omfangNavn, udsnit (motor.tabel(maal).udsnit), venter, etager}
  function kgTxt(n) { return tal(n, 0) + ' kg'; }
  var VALG_TEKST = { bruger: 'valgt af dig', egen_epd: 'egen EPD, valgt af dig', bekraeftet: 'bekræftet', forslag: 'forslag · tjek', struktur: 'typens egne data' };
  // «Ret» står i EPD-kolonnen (der, hvor man ændrer EPD'en), så den ses uden at rulle tabellen sidelæns i et smalt panel.
  // Kolonnernes klasse styrer den kompakte visning (STIL nederst, @container på #lcaBody). ≤ 620 px (delt skærm): bygningsdel,
  // faktor, levetid og modulerne skjules; bygningsdelen står som overskrift over sine rækker, og «CO₂e i alt» foldes ud til
  // modulerne i rækken under. ≤ 420 px (smalt panel): også konstruktionen står som overskrift. Ingen sidelæns rulning.
  var KOLONNE_DEF = [['del', 'Bygningsdel', 'lca-k-del'], ['kon', 'Konstruktion', 'lca-k-kon'], ['bv', 'Byggevare', 'lca-k-bv'], ['epd', 'EPD pr. byggevare', 'lca-k-epd'], ['m', 'Mængde', 'n lca-k-m'], ['f', 'Faktor A1-A3', 'n lca-k-f'],
    ['lev', 'Levetid', 'n lca-k-lev'], ['a1a3', 'A1-A3', 'n lca-k-mod'], ['b4', 'B4', 'n lca-k-mod'], ['c3', 'C3', 'n lca-k-mod'], ['c4', 'C4', 'n lca-k-mod'], ['a4', 'A4', 'n lca-k-mod'], ['ialt', 'CO₂e i alt', 'n lca-k-ialt']];
  var KOLONNER = KOLONNE_DEF.map(function (k) { return k[1]; });
  function td(i, c) { var kl = KOLONNE_DEF[i][2]; return '<td' + (kl ? ' class="' + kl + '"' : '') + '>' + c + '</td>'; }
  function enh(u) { return esc(String(u == null ? '' : u).replace(/^m2(?![0-9])/, 'm²').replace(/^m3(?![0-9])/, 'm³')); }
  // EPD-status som rammens chips: bekræftet = ok, forslag eller en egen EPD, Rust ikke har godkendt = tjek (warn), intet datasæt = grå.
  function epdStatus(b) {
    var ds = b.datasaet, v = (b.ref || {}).valg;
    if (!ds) return ['grey', 'mangler'];
    if (v === 'forslag' || (!v && !ds.officiel && !ds.egen)) return ['warn', 'Forslag · ikke bekræftet'];
    if (ds.egen && b.status !== 'valid_epd') return ['warn', 'egen EPD · tjek'];
    return ['ok', VALG_TEKST[v] || (ds.egen ? 'egen EPD' : 'bekræftet')];
  }
  function epdCelle(b) {
    var ds = b.datasaet, st = epdStatus(b), chip = '<span class="chip ' + st[0] + '">' + esc(st[1]) + '</span>';
    return ds ? '<b>' + esc(ds.key) + '</b> ' + esc(ds.navn || '') + '<br>' + chip : chip;
  }
  function raekkeHtml(b, dNavn, kNavn, valg) {
    var m = b.moduler || {}, ds = b.datasaet, ref = b.ref || {}, aaben = valg.ret === b.id;
    var maengde = b.maengde != null ? tal(b.maengde, 3) + ' ' + enh(b.enhed) : '<span class="issana-mangler">mangler</span>';
    var lev = b.levetid != null ? tal(b.levetid, 0) + ' år → ' + (b.udskiftninger || 0) + ' udsk.' : '—';
    var faktor = ds && ds.a1a3 != null ? tal(ds.a1a3, 3) + '<br><small class="v3-hint">kg CO₂e/' + enh(ds.enhed) + '</small>' : '—';
    // Kompakt: «CO₂e i alt» foldes ud; modulerne, faktoren og levetiden (de skjulte kolonners indhold) står så i rækken under
    // i hele tabellens bredde (lca-udfold, vist med :has(details[open]) i STIL), ikke i den smalle kolonne.
    var ud = b.kg != null ? '<small class="v3-hint">' + esc(b.navn) + ': A1-A3 ' + tal(m['A1-A3'], 0) + ' · B4 ' + tal(m.B4, 0) + ' · C3 ' + tal(m.C3, 0) + ' · C4 ' + tal(m.C4, 0) +
      (b.a4 != null ? ' · A4 ' + tal(b.a4, 0) : '') + ' kg · ' + (ds && ds.a1a3 != null ? 'faktor ' + tal(ds.a1a3, 3) + ' kg CO₂e/' + enh(ds.enhed) + ' · ' : '') + 'levetid ' + lev + '</small>' : null;
    var ialt = ud ? '<details data-lca-ud><summary>' + kgTxt(b.kg) + '</summary></details>' : '—';
    var celler = [dNavn != null ? '<b>' + esc(dNavn) + '</b>' : '', kNavn != null ? esc(kNavn) : '', esc(b.navn) + (b.mangler && b.mangler.length ? '<br><small class="issana-mangler">' + esc(b.mangler[0]) + (b.mangler.length > 1 ? ' (+' + (b.mangler.length - 1) + ')' : '') + '</small>' : ''),
      epdCelle(b) + (ref.kanAendres ? '<div><button class="tbtn" data-lca-ret="' + esc(b.id) + '" aria-expanded="' + aaben + '">' + (aaben ? 'Luk' : 'Ret') + '</button></div>' : ''),
      maengde + (ref.maengde ? '<br><small class="v3-hint">rettet af dig</small>' : ''), faktor,
      lev + (ref.levetid ? '<br><small class="v3-hint">rettet af dig</small>' : ''), tal(m['A1-A3'], 0), tal(m.B4, 0), tal(m.C3, 0), tal(m.C4, 0), b.a4 != null ? tal(b.a4, 0) : '—', ialt];
    var h = '<tr data-lca-pid="' + esc(b.id) + '"' + (b.regnet ? '' : ' class="lca-ikke-regnet"') + '>' + celler.map(function (c, i) { return td(i, c); }).join('') + '</tr>';
    if (ud) h += '<tr class="lca-udfold"><td colspan="' + KOLONNER.length + '">' + ud + '</td></tr>';
    if (aaben) h += '<tr class="lca-ret"><td colspan="' + KOLONNER.length + '">' + retHtml(b, valg) + '</td></tr>';
    return h;
  }
  var RAEKKE = '<div class="lca-raekke" style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:flex-end;margin:8px 0">';
  function vaelger(attr, navn, liste, vaerdi) {
    return '<label>' + esc(navn) + '<select ' + attr + '>' + liste.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (vaerdi === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></label>';
  }
  // Redigeringsrækken for én byggevare. Felterne hedder data-lca-t-… (ikke data-lca-lv-…), så de ikke forveksles med manglernes.
  function retHtml(b, valg) {
    var ref = b.ref || {}, fane = valg.fane || 'datasaet', post = ref.post || {};
    var h = '<div class="lca-ret-boks" data-lca-ret-boks="' + esc(b.id) + '"><b>Ret «' + esc(b.navn) + '»</b>' +
      (ref.materiale ? ' <span class="v3-hint">(lag «' + esc(ref.materiale) + '»' + (ref.tykkelseMm != null ? ' ' + tal(ref.tykkelseMm, 0) + ' mm' : '') + ')</span>' : '');
    h += RAEKKE + [['datasaet', 'BR18 tabel 7-datasæt'], ['egen', 'Egen EPD'], ['maengde', 'Mængde'], ['levetid', 'Levetid']].map(function (f) {
      return '<button class="tbtn" data-lca-ret-fane="' + f[0] + '" aria-pressed="' + (fane === f[0]) + '">' + esc(f[1]) + '</button>'; }).join('') + '</div>';
    if (fane === 'datasaet') {
      var k = valg.kandidater || [];
      if (k.length) h += '<p class="v3-hint">Forslag ud fra materialet «' + esc(ref.materiale || b.navn) + '» (epd-match):</p>' + RAEKKE + k.map(function (c) {
        return '<button class="tbtn" data-lca-brug-ds="' + esc(c.key) + '" title="' + esc(c.begrundelse || '') + '">' + esc(c.key) + ' ' + esc(c.navn) + (c.a1a3 != null ? ' · ' + tal(c.a1a3, 3) + ' kg CO₂e/' + esc(c.enhed) : '') + '</button>'; }).join('') + '</div>';
      var ds = valg.datasaet || [];
      h += RAEKKE + '<label>Søg i BR18 tabel 7 (' + ds.length + ' datasæt)<input list="issana-lca-datasaet" data-lca-t-soeg style="width:380px" placeholder="fx beton, mineraluld eller #B1318"></label><button class="tbtn primary" data-lca-brug-soeg>Brug datasættet</button></div>';
      h += '<datalist id="issana-lca-datasaet">' + ds.map(function (d) { return '<option value="' + esc(d.key + ' · ' + d.navn + ' (' + d.enhed + ')') + '"></option>'; }).join('') + '</datalist>';
    } else if (fane === 'egen') {
      // Fra en EPD-database («Brug»): felterne udfyldt fra listen; ellers byggevarens gemte egne EPD.
      var fra = valg.egenForslag && valg.egenForslag.pid === b.id ? valg.egenForslag : null;
      var e = fra ? fra.post : post.kildeType === 'bruger-epd' ? post : {}, g = e.gwp || {}, d = e.epd || {};
      if (fra) h += '<p class="v3-hint" data-lca-fra-db>Udfyldt fra EPD-databasen «' + esc(fra.db || '') + '».</p>';
      var tf = function (attr, navn, v, bredde, type, ekstra) { return felt(type || 'text', 'data-lca-t-egen="' + attr + '"', navn, v, bredde, ekstra); };
      h += '<p class="v3-hint">Tal og oplysninger fra EPD\'en (kg CO₂e pr. deklareret enhed). ISSANA LCA tjekker dokumentationen efter vejledningen (1.6): mangler noget, står byggevaren som mangel, og bygningen får ingen grænseafgørelse, før det er på plads. Et tomt modul er «ikke deklareret», aldrig 0.</p>';
      h += RAEKKE + tf('navn', 'Produkt i EPD\'en', e.navn, 220) + vaelger('data-lca-t-egen="enhed"', 'Deklareret enhed', [['', 'Vælg …'], ['m³', 'm³'], ['m²', 'm²'], ['kg', 'kg'], ['stk', 'stk']], e.enhed || '') +
        tf('A1A3', 'A1-A3', g.A1A3, 80, 'number', ' step="any"') + tf('C3', 'C3', g.C3, 70, 'number', ' step="any"') + tf('C4', 'C4', g.C4, 70, 'number', ' step="any"') + tf('D', 'D', g.D, 70, 'number', ' step="any"') +
        tf('densitet', 'Densitet (kg/m³)', e.densitet, 80, 'number', ' min="0" step="any"') + '</div>';
      h += RAEKKE + tf('scenarieC3', 'Scenarie C3', d.scenarieC3, 160) + tf('scenarieC4', 'Scenarie C4', d.scenarieC4, 160) + tf('registreringsnr', 'Registreringsnr.', d.registreringsnr, 120) +
        tf('programoperatoer', 'Programoperatør', d.programoperatoer, 140) + tf('producent', 'Producent', d.producent, 140) + '</div>';
      h += RAEKKE + tf('url', 'EPD-dokument (URL)', d.url, 260) + tf('placering', 'Placering i dokumentet', d.placering, 140, null, ' placeholder="fx s. 6, tabel 4"') +
        vaelger('data-lca-t-egen="verificeret"', '3.-partsverificeret', [['unknown', 'Ukendt'], ['yes', 'Ja'], ['no', 'Nej']], d.verificeret || 'unknown') +
        vaelger('data-lca-t-egen="en15804"', 'EN 15804', [['unknown', 'Ukendt'], ['A2', '+A2'], ['A1', '+A1']], d.en15804 || 'unknown') +
        vaelger('data-lca-t-egen="gwpIndikator"', 'GWP-indikator', [['unknown', 'Ukendt'], ['GWP-total', 'GWP-total'], ['GWP', 'GWP']], d.gwpIndikator || 'unknown') +
        vaelger('data-lca-t-egen="type"', 'EPD-type', [['unknown', 'Ukendt'], ['product', 'Produkt'], ['branch', 'Branche'], ['project', 'Projekt']], d.type || 'unknown') + '</div>';
      h += RAEKKE + tf('udstedt', 'Udstedt', d.udstedt, 130, 'date') + tf('udloeb', 'Udløber', d.udloeb, 130, 'date') + tf('anvendt', 'Anvendes (dato)', d.anvendt, 130, 'date') +
        '<label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" data-lca-t-egen="daekker"' + (d.daekker ? ' checked' : '') + '> EPD\'en dækker netop denne byggevare</label>' +
        '<label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" data-lca-t-egen="dNul"' + (d.dNul ? ' checked' : '') + '> D er ikke deklareret: brug 0 (vejledningens anbefaling)</label>' +
        '<button class="tbtn primary" data-lca-egen-gem>Brug den egne EPD</button></div>';
    } else if (fane === 'maengde') {
      var mv = ref.maengde || {};
      h += '<p class="v3-hint">Nu: ' + (b.maengde != null ? tal(b.maengde, 3) + ' ' + esc(b.enhed) : 'ukendt') + (b.maengdeKilde ? ' · ' + esc(b.maengdeKilde) : '') + '</p>';
      h += ref.enhed ? RAEKKE + felt('number', 'data-lca-t-m-vaerdi min="0" step="any"', 'Samlet mængde (' + ref.enhed + ')', mv.maengde, 110) + felt('text', 'data-lca-t-m-kilde', 'Kilde', mv.kilde, 240, ' placeholder="fx mængdeudtræk, tegning A-201, tilbud"') +
        '<button class="tbtn primary" data-lca-t-m-gem>Gem mængde</button>' + (ref.maengde ? '<button class="tbtn" data-lca-t-m-fjern>Brug modellens mængde</button>' : '') + '</div>' :
        '<p class="issana-mangler">Vælg først et datasæt eller en egen EPD; mængden angives i dens enhed.</p>';
    } else if (fane === 'levetid') {
      var lv = ref.levetid || {};
      h += '<p class="v3-hint">Nu: ' + (b.levetid != null ? tal(b.levetid, 0) + ' år' : 'ukendt') + (b.levetidKilde ? ' · ' + esc(b.levetidKilde) : '') + '</p>';
      h += RAEKKE + felt('number', 'data-lca-t-lv-aar min="1" step="1"', 'Levetid (år)', lv.aar, 80) + felt('text', 'data-lca-t-lv-kilde', 'Kilde', lv.kilde, 260, ' placeholder="fx BUILD levetidstabel 2021, tabel …"') +
        '<button class="tbtn primary" data-lca-t-lv-gem>Gem levetid</button>' + (ref.levetid ? '<button class="tbtn" data-lca-t-lv-fjern>Brug BUILD-levetiden</button>' : '') + '</div>';
    }
    if (ref.valg && ref.valg !== 'struktur' && (fane === 'datasaet' || fane === 'egen')) h += '<p class="v3-hint">Nu: ' + esc(VALG_TEKST[ref.valg] || ref.valg) + '. <button class="tbtn" data-lca-fjern>Fjern valget</button> (byggevaren står så uden datasæt)</p>';
    return h + '</div>';
  }
  // Søgefeltets tekst («#B1318@2 · Krydslamineret træ … (m³)», en key, et id eller et entydigt navn) → datasættet.
  function findDatasaet(liste, s) {
    s = String(s || '').trim(); if (!s) return null;
    var key = s.split(' · ')[0].trim(), lav = s.toLowerCase();
    var hit = liste.filter(function (d) { return d.key === key; })[0]; if (hit) return hit;
    var id = liste.filter(function (d) { return d.id === key; }); if (id.length === 1) return id[0];
    var n = liste.filter(function (d) { return String(d.navn || '').toLowerCase() === lav; }); return n.length === 1 ? n[0] : null;
  }
  // Omfanget som værdi i vælgeren og tilbage (tegn): '' = hele bygningen, 'valgte', 'etage:<navn>'; rammens elementIds = 'elementer'.
  function omfangVaerdi(m) { return !m || m.alle ? '' : m.valgte ? 'valgte' : m.etage ? 'etage:' + [].concat(m.etage)[0] : m.elementIds ? 'elementer' : ''; }
  function omfangFra(v, nu) { return !v ? null : v === 'valgte' ? { valgte: true } : v.indexOf('etage:') === 0 ? { etage: [v.slice(6)] } : v === 'elementer' ? nu : null; }
  function omfangTekst(m, navn) { return navn || (m && m.valgte ? 'valgte elementer' : m && m.etage ? 'etage ' + [].concat(m.etage).join(', ') : m && m.elementIds ? m.elementIds.length + ' elementer' : 'hele bygningen'); }
  function beregningTabelHtml(b, valg) {
    valg = valg || {};
    var udsnit = valg.omfang && !valg.omfang.alle ? (valg.udsnit || {}) : null;
    // indlejret: tabellen under kolonnerne («Alle byggevarer i én tabel»); kolonnerne har overskrift, status, omfang og summering.
    var ind = !!valg.indlejret;
    var h = ind ? '<div data-lca-tabel>' : '<section data-lca-beregning><h3>Sådan er tallet regnet · ret selv pr. byggevare</h3>';
    if (!ind) h += '<p class="v3-hint">Hver række: mængde × datasættets faktor = A1-A3. Levetiden (BUILD) giver udskiftningerne på 50 år (B4); C3/C4 er affaldsbehandling og bortskaffelse, A4 transport (kg CO₂e). Tryk «Ret» for at vælge et andet BR18 tabel 7-datasæt eller en egen EPD, eller rette mængde og levetid. Dit valg gemmes på Revit-typen (ændringslisten), og ISSANA LCA regner igen.</p>';
    if (!ind) h += statusLinjer(valg);
    var dele = (b && b.dele || []).filter(function (d) { return !valg.filterDel || d.id === valg.filterDel; });
    var alle = 0, vist = 0;
    (b && b.dele || []).forEach(function (d) { d.konstruktioner.forEach(function (k) { alle += k.byggevarer.length; }); });
    h += RAEKKE + (ind ? '' : omfangVaelger(valg)) +
      vaelger('data-lca-filter="del"', 'Bygningsdel', [['', 'Alle']].concat((b && b.dele || []).map(function (d) { return [d.id, d.navn]; })), valg.filterDel || '') +
      '<label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" data-lca-filter="mangler"' + (valg.kunMangler ? ' checked' : '') + '> Kun byggevarer, der ikke er regnet</label></div>';
    if (valg.venter) return h + (ind ? '</div>' : '</section>');
    var rows = '';
    dele.forEach(function (d) {
      var dNavn = d.navn, delRows = '';
      d.konstruktioner.forEach(function (k) {
        var kNavn = k.navn + (k.maengde != null ? ' · ' + tal(k.maengde, 1) + ' ' + String(k.enhed).replace(/^m2$/, 'm²').replace(/^m3$/, 'm³') : ' · mængde mangler'), kHoved = kNavn;
        k.byggevarer.forEach(function (bv) {
          if (valg.kunMangler && bv.regnet) return;
          // ≤ 420 px: konstruktionen som overskrift (kolonnen er skjult).
          if (kHoved) { delRows += '<tr class="lca-kon-hoved"><td colspan="' + KOLONNER.length + '">' + esc(kHoved) + '</td></tr>'; kHoved = null; }
          delRows += raekkeHtml(bv, dNavn, kNavn, valg); dNavn = null; kNavn = null; vist++;
        });
      });
      if (!delRows) return;
      var dm = d.moduler || {}, dTot = d.kg != null ? kgTxt(d.kg) + (!udsnit && d.prM2 != null ? ' = ' + tal(d.prM2, 3) + ' kg CO₂e/m²/år' : '') : '';
      // ≤ 620 px: bygningsdelen og dens sum som overskrift over rækkerne (kolonnen og subtotalen er skjult).
      rows += '<tr class="lca-del-hoved"><td colspan="' + KOLONNER.length + '"><b>' + esc(d.navn) + '</b>' + (dTot ? ' · i alt ' + dTot : '') + '</td></tr>';
      // Subtotalens celler har kolonnernes klasser, så den brede tabel holder sine kolonner. kg/m²/år kun for hele bygningen.
      rows += delRows + '<tr class="lca-subtotal"><td colspan="3"><b>I alt ' + esc(d.navn) + '</b>' + (dTot ? ' · ' + dTot : '') + '</td>' +
        td(3, '') + td(4, '') + td(5, '') + td(6, '') + ['A1-A3', 'B4', 'C3', 'C4'].map(function (x, i) { return td(7 + i, '<b>' + tal(dm[x], 0) + '</b>'); }).join('') + td(11, '') + td(12, d.kg != null ? '<b>' + kgTxt(d.kg) + '</b>' : '') + '</tr>';
    });
    h += '<p class="v3-hint">' + vist + ' af ' + alle + ' byggevarer vises' + (udsnit ? ' (' + esc(omfangTekst(valg.omfang, valg.omfangNavn)) + ')' : '') + '.</p>';
    h += '<div class="lca-tabel-boks" style="overflow-x:auto"><table class="lca lca-beregningstabel"><thead><tr>' + KOLONNE_DEF.map(function (k) { return '<th' + (k[2] ? ' class="' + k[2] + '"' : '') + '>' + esc(k[1]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (rows || '<tr><td colspan="' + KOLONNER.length + '">Ingen byggevarer i udvalget.</td></tr>') + '</tbody></table></div>';
    if (ind) return h + '</div>';
    return h + (udsnit ? udsnitHtml(udsnit, valg) : b ? summeringHtml(b) : '') + '</section>';
  }
  function statusLinjer(valg) {
    if (valg.venter) return '<p class="v3-hint" data-lca-venter>ISSANA LCA regner ' + esc(omfangTekst(valg.omfang, valg.omfangNavn)) + ' …</p>';
    if (valg.foraeldet) return '<p class="issana-mangler" data-lca-foraeldet>Du har ændret byggevarer: tallene herunder er fra før ændringen, indtil ISSANA LCA har regnet igen. Tryk «Beregn med ISSANA LCA», hvis de ikke opdateres.</p>';
    if (!valg.regnet) return '<p class="v3-hint">ISSANA LCA har ikke regnet endnu: tabellen viser byggevarerne og deres datasæt, men ingen kg.</p>';
    return '';
  }
  function omfangVaelger(valg) {
    var omfangValg = [['', 'Hele bygningen'], ['valgte', 'Valgte elementer']].concat((valg.etager || []).map(function (e) { return ['etage:' + e, 'Etage ' + e]; }));
    if (valg.omfang && valg.omfang.elementIds) omfangValg.push(['elementer', omfangTekst(valg.omfang, valg.omfangNavn)]);
    return '<div class="lcak-omfang">' + vaelger('data-lca-filter="omfang"', 'Omfang', omfangValg, omfangVaerdi(valg.omfang)) + '</div>';
  }

  /* ---------- Omregningsfaktor: byggevarens mængde pr. enhed konstruktion ---------- */
  // Samme former som F#-motoren (ISSANA_CalculationEngine/Formulas/LCA) og «Byggevare Faktor Beregner» (LCA_Omregner.html).
  // Panelet regner kun mængden (faktoren). Den gemmes med kilde (motor.maengde {faktor}), og ISSANA LCA regner CO₂ med
  // faktoren × konstruktionens mængde (lca-projekt.js). Faktoren gemmes i datasættets enhed pr. enhed konstruktion.
  var FORMER = {
    model: { navn: 'Fra Revit-laget', andel: true, felter: [] },
    m3m2: { navn: 'm³/m²', taeller: 'm3', naevner: 'm2', andel: true, felter: ['t'], formel: 'tykkelse × 1 m²', fs: 'lca.quantity.periodic_strip_volume_per_area' },
    kgm2: { navn: 'kg/m²', taeller: 'kg', naevner: 'm2', andel: true, felter: ['t', 'rho'], formel: 'tykkelse × densitet', fs: 'lca.quantity.homogeneous_layer_mass_per_area' },
    m2m2: { navn: 'm²/m²', taeller: 'm2', naevner: 'm2', andel: true, felter: [], formel: '1 m² pr. m²', fs: 'lca.quantity.periodic_strip_coverage' },
    mm2: { navn: 'm/m²', taeller: 'm', naevner: 'm2', andel: false, felter: ['ccl'], formel: '1000 ÷ c-c, løbende meter pr. m²', fs: null },
    kgskelet: { navn: 'Skelet eller profil', taeller: 'kg', naevner: 'm2', andel: false, felter: ['qm', 'cc'], formel: 'kg/m × 1000 ÷ c-c mm', fs: null },
    m3m: { navn: 'm³/m', taeller: 'm3', naevner: 'm', andel: false, felter: ['bb', 'hh'], formel: 'bredde × højde × 1 m', fs: 'lca.quantity.rectangular_section_volume_per_length' },
    kgm: { navn: 'kg/m', taeller: 'kg', naevner: 'm', andel: false, felter: ['bb', 'hh', 'rho'], formel: 'bredde × højde × densitet', fs: null },
    m2m: { navn: 'm²/m', taeller: 'm2', naevner: 'm', andel: false, felter: ['bb'], formel: 'bredde × 1 m', fs: null },
    mm: { navn: 'm/m', taeller: 'm', naevner: 'm', andel: false, felter: [], formel: '1 m pr. m', fs: null },
    kgdir: { navn: 'kg (skriv selv)', taeller: 'kg', andel: false, felter: ['vk'] },
    m3direkte: { navn: 'm³/m² (skriv selv)', taeller: 'm3', naevner: 'm2', andel: false, felter: ['v'] },
    m2direkte: { navn: 'm²/m² (skriv selv)', taeller: 'm2', naevner: 'm2', andel: false, felter: ['v'] },
    kgdirekte: { navn: 'kg/m² (skriv selv)', taeller: 'kg', naevner: 'm2', andel: false, felter: ['v'] },
    mdirekte: { navn: 'm/m² (skriv selv)', taeller: 'm', naevner: 'm2', andel: false, felter: ['v'] },
    stkdirekte: { navn: 'stk/m² (skriv selv)', taeller: 'stk', naevner: 'm2', andel: false, felter: ['v'] },
    direkte: { navn: 'Skriv selv', andel: false, felter: ['v'] }
  };
  var FORM_RAEKKE = ['model', 'm3m2', 'kgm2', 'm2m2', 'mm2', 'kgskelet', 'm3m', 'kgm', 'm2m', 'mm', 'kgdir', 'direkte'];
  var FELT_TEKST = { t: ['Tykkelse t', 'mm'], rho: ['Densitet ρ', 'kg/m³'], bb: ['Bredde b', 'mm'], hh: ['Højde h', 'mm'], ccl: ['Afstand c-c', 'mm'], qm: ['Profilvægt', 'kg/m'], v: ['Faktor', ''], vk: ['Mængde', ''], M: ['EPD\'ens masse', ''], b: ['Bredde b', 'mm'], cc: ['Afstand c-c', 'mm'] };
  var ENHED_PEN = { m3: 'm³', m2: 'm²', m2R: 'm² (R = 1)', ton: 'ton', kg: 'kg', m: 'm', stk: 'stk' };
  function enhedNorm(u) { u = String(u == null ? '' : u).trim(); if (/^m(3|³)$/.test(u)) return 'm3'; if (/^m(2|²)$/.test(u)) return 'm2'; if (/R ?= ?1/.test(u)) return 'm2R'; if (u === 't') return 'ton'; if (/^(pcs|stk\.?)$/i.test(u)) return 'stk'; return u; }
  // Hvad der kan vælges (reglen i LCAbyg, set på 253 byggevarer i brugerens projekter): tælleren er EPD'ens egen enhed eller kg,
  // nævneren er konstruktionens enhed. «m² ved R = 1» kan ikke regnes om til kg.
  function formTilladt(id, ud, uk) {
    var G = FORMER[id];
    if (id === 'model' || id === 'direkte') return true;
    if (G.naevner && G.naevner !== uk) return false;
    if (id === 'kgdir') return ud !== 'kg' && ud !== 'm2R';
    return G.taeller === ud || (G.taeller === 'kg' && ud !== 'm2R');
  }
  function tilladteFormer(ud, uk) { ud = enhedNorm(ud); uk = enhedNorm(uk); return FORM_RAEKKE.filter(function (id) { return formTilladt(id, ud, uk); }); }
  // Datasættets egen massefaktor, så kg kan vælges uden at slå densiteten op (som i LCAbyg).
  function faktorBv(bv) {
    var mf = (bv.ref || {}).massefaktor, ud = enhedNorm(bv.enhed || (bv.datasaet || {}).enhed), mu = mf ? String(mf.enhed || '') : '', o = { enhed: bv.enhed || (bv.datasaet || {}).enhed, maengde: bv.maengde, rho0: null, M0: null, fraOpbygning: !!(bv.ref || {}).kanAendreMaengde };
    if (!mf) return o;
    if (/^kg\/m(3|³)$/.test(mu)) o.rho0 = mf.v; else if (/^(ton\/m(3|³)|g\/cm(3|³))$/.test(mu)) o.rho0 = mf.v * 1000;
    else if (mu.indexOf('kg/') === 0 && enhedNorm(mu.slice(3)) === ud) o.M0 = mf.v;
    return o;
  }
  function enhedPen(u) { return ENHED_PEN[u] || u; }
  function talF(x) { if (x === '' || x == null) return NaN; return Number(String(x).replace(',', '.')); }
  function sig(n, s) { return typeof n === 'number' && isFinite(n) ? Number(n.toPrecision(s || 5)).toLocaleString('da-DK', { maximumFractionDigits: 10 }) : '—'; }
  function arealandel(r) {
    if (!r || !r.lagtype || r.lagtype === 'homogen') return 1;
    var b = talF(r.b), cc = talF(r.cc);
    if (!(b > 0) || !(cc > 0) || b > cc) return null;
    return r.lagtype === 'gentaget' ? b / cc : (cc - b) / cc;
  }
  // EPD'en er deklareret pr. ud; faktoren giver mængden i taeller. konv = deklarerede enheder pr. taeller-enhed.
  function epdKonv(ud, taeller, r, bv) {
    if (ud === taeller) return { konv: 1 };
    var rho = talF(r.rho) > 0 ? talF(r.rho) : (bv && bv.rho0) || NaN, M = talF(r.M) > 0 ? talF(r.M) : (bv && bv.M0) || NaN;
    if (taeller === 'kg') {
      if (ud === 'ton') return { konv: 1 / 1000, tekst: '1 kg = 1/1000 ton' };
      if (ud === 'm3') return rho > 0 ? { konv: 1 / rho, tekst: '1 kg = 1/ρ m³' } : { fejl: 'Angiv densiteten ρ for at regne EPD\'en om fra m³ til kg.' };
      if (ud === 'm2' || ud === 'm' || ud === 'stk') return M > 0 ? { konv: 1 / M, tekst: '1 kg = 1/' + tal(M) + ' ' + enhedPen(ud) } : { fejl: 'Angiv EPD\'ens masse pr. ' + enhedPen(ud) + ' for at regne den om til kg.' };
    }
    if (taeller === 'm3') {
      if (ud === 'kg') return rho > 0 ? { konv: rho, tekst: '1 m³ = ρ kg' } : { fejl: 'Angiv densiteten ρ for at regne EPD\'en om fra kg til m³.' };
      if (ud === 'ton') return rho > 0 ? { konv: rho / 1000, tekst: '1 m³ = ρ/1000 ton' } : { fejl: 'Angiv densiteten ρ for at regne EPD\'en om fra ton til m³.' };
    }
    if (ud === 'm2R') return { fejl: 'EPD\'en er pr. m² ved R = 1 m²K/W. Brug «Fra Revit-laget» eller «Skriv selv».' };
    return { fejl: 'EPD\'en er deklareret pr. ' + enhedPen(ud) + ' og kan ikke regnes om til ' + enhedPen(taeller) + '. Vælg en anden enhed.' };
  }
  // bv: {enhed (datasættets), maengde}; k: {enhed, maengde}; r: {form, t, rho, bb, hh, ccl, v, M, lagtype, b, cc, grund}
  // → {form, ud, uk, taeller, naevner, vaerdi (i taeller/naevner), konv, gem (i ud/uk, det der gemmes), andel, grund, fejl}
  function omregningsfaktor(bv, k, r) {
    r = r || {};
    var ud = enhedNorm(bv.enhed), uk = enhedNorm(k.enhed), form = FORMER[r.form] ? r.form : 'model', F = FORMER[form];
    var andel = F.andel ? arealandel(r) : 1;
    var o = { form: form, ud: ud, uk: uk, andel: andel, taeller: null, naevner: uk, vaerdi: null, konv: null, gem: null, fejl: null, grund: null, fraOpbygning: !!bv.fraOpbygning };
    if (form === 'model' || form === 'direkte') {
      o.taeller = ud; o.konv = 1;
      if (form === 'model') {
        o.grund = talF(r.grund) >= 0 ? talF(r.grund) : bv.maengde != null && k.maengde > 0 ? bv.maengde / k.maengde : null;
        if (o.grund == null) o.fejl = 'Modellen giver ingen mængde for byggevaren.';
        else if (andel == null) o.fejl = 'b skal være større end 0 og ikke større end c-c.';
        else o.vaerdi = o.grund * andel;
      } else if (talF(r.v) >= 0) o.vaerdi = talF(r.v);
      else o.fejl = 'Skriv faktoren i ' + enhedPen(ud) + '/' + enhedPen(uk) + '.';
      o.gem = o.vaerdi; return o;
    }
    o.taeller = F.taeller;
    if (F.naevner && F.naevner !== uk) { o.fejl = 'Konstruktionen er opgjort i ' + enhedPen(uk) + ', så faktoren skal være pr. ' + enhedPen(uk) + '.'; return o; }
    var t = talF(r.t), rho = talF(r.rho) > 0 ? talF(r.rho) : bv.rho0 || NaN, bb = talF(r.bb), hh = talF(r.hh), ccl = talF(r.ccl), qm = talF(r.qm), v0 = null, mangler = null;
    o.rho = rho;
    if (form === 'kgm2') { if (t > 0 && rho > 0) v0 = t / 1000 * rho; else mangler = 'Angiv tykkelse og densitet.'; }
    else if (form === 'm3m2') { if (t > 0) v0 = t / 1000; else mangler = 'Angiv tykkelsen.'; }
    else if (form === 'm2m2') v0 = 1;
    else if (form === 'mm2') { if (ccl > 0) v0 = 1000 / ccl; else mangler = 'Angiv c-c-afstanden.'; }
    else if (form === 'kgskelet') { if (qm > 0 && talF(r.cc) > 0) v0 = qm * 1000 / talF(r.cc); else mangler = 'Angiv profilvægt i kg/m og c-c-afstand. Profilvægten foreslås aldrig automatisk.'; }
    else if (form === 'm3m') { if (bb > 0 && hh > 0) v0 = bb * hh / 1e6; else mangler = 'Angiv bredde og højde.'; }
    else if (form === 'kgm') { if (bb > 0 && hh > 0 && rho > 0) v0 = bb * hh / 1e6 * rho; else mangler = 'Angiv bredde, højde og densitet.'; }
    else if (form === 'm2m') { if (bb > 0) v0 = bb / 1000; else mangler = 'Angiv bredden.'; }
    else if (form === 'mm') v0 = 1;
    else if (form === 'kgdir') { if (talF(r.vk) >= 0) v0 = talF(r.vk); else mangler = 'Skriv mængden i kg/' + enhedPen(uk) + '.'; }
    else if (/direkte$/.test(form)) { if (talF(r.v) >= 0) v0 = talF(r.v); else mangler = 'Skriv mængden i ' + enhedPen(F.taeller) + '/' + enhedPen(uk) + '.'; }
    if (mangler) { o.fejl = mangler; return o; }
    if (andel == null) { o.fejl = 'b skal være større end 0 og ikke større end c-c.'; return o; }
    var kv = epdKonv(ud, F.taeller, r, bv);
    if (kv.fejl) { o.fejl = kv.fejl; return o; }
    o.vaerdi = v0 * andel; o.konv = kv.konv; o.konvTekst = kv.tekst || null; o.gem = o.vaerdi * kv.konv;
    return o;
  }
  function faktorRegnestykke(f, r) {
    if (f.fejl) return '';
    var n = function (v) { return tal(talF(v), 1); }, s;
    if (f.form === 'model') s = (f.fraOpbygning ? 'Opbygningen: ' : f.uk === 'm2' ? 'Revit-laget: ' : 'Revit-geometrien: ') + sig(f.grund, 5);
    else if (f.form === 'kgm2') s = n(r.t) + ' mm ÷ 1000 × ' + tal(f.rho, 1) + ' kg/m³';
    else if (f.form === 'm3m2') s = n(r.t) + ' mm ÷ 1000';
    else if (f.form === 'm2m2') s = '1 m² pr. m²';
    else if (f.form === 'mm2') s = '1000 ÷ ' + n(r.ccl) + ' mm';
    else if (f.form === 'kgskelet') s = n(r.qm) + ' kg/m × 1000 ÷ ' + n(r.cc) + ' mm';
    else if (f.form === 'm3m') s = n(r.bb) + ' × ' + n(r.hh) + ' mm² ÷ 1.000.000';
    else if (f.form === 'kgm') s = n(r.bb) + ' × ' + n(r.hh) + ' mm² ÷ 1.000.000 × ' + tal(f.rho, 1) + ' kg/m³';
    else if (f.form === 'm2m') s = n(r.bb) + ' mm ÷ 1000';
    else if (f.form === 'mm') s = '1 m pr. m';
    else s = 'skrevet direkte';
    if (f.andel != null && f.andel !== 1) s += ' × arealandel ' + (r.lagtype === 'gentaget' ? n(r.b) + ' ÷ ' + n(r.cc) : '(' + n(r.cc) + ' − ' + n(r.b) + ') ÷ ' + n(r.cc)) + ' (' + sig(f.andel, 4) + ')';
    return s;
  }
  function faktorKilde(f, r) {
    var per = enhedPen(f.taeller) + '/' + enhedPen(f.naevner);
    return 'Omregningsfaktor ' + per + ' i ISSANA 3D: ' + faktorRegnestykke(f, r) + ' = ' + sig(f.vaerdi, 5) + ' ' + per +
      (f.konv !== 1 ? ' = ' + sig(f.gem, 5) + ' ' + enhedPen(f.ud) + '/' + enhedPen(f.naevner) + ' (EPD\'ens enhed)' : '');
  }
  // Redigeringen for byggevaren: brugerens igangværende valg, ellers det gemte (form og felter), ellers Revit-laget.
  function faktorRedigering(bv, fEdit) {
    if (fEdit && fEdit.id === bv.id) return fEdit;
    var ref = bv.ref || {}, mv = ref.maengde || {}, post = ref.post || {};
    if (mv.faktor != null && mv.form) return Object.assign({ id: bv.id, form: mv.form }, mv.felter || {});
    var rho = /× (\d+(?:[.,]\d+)?) kg\/m³/.exec(post.omregning || '');
    return { id: bv.id, form: 'model', t: ref.tykkelseMm != null ? ref.tykkelseMm : null, rho: rho ? Number(rho[1].replace(',', '.')) : null, lagtype: 'homogen' };
  }

  /* ---------- Kolonner: bygningsdel → konstruktion → byggevare → faser, den valgte byggevare og regnekæden ---------- */
  // LCAbygs 17 faste bygningsdele med underkategorier (lca-bygningsdele.js → window.IssanaLcaBygningsdele; i Node valg.bygningsdeleKatalog).
  function bygningsdeleKatalog(valg) {
    if (valg && valg.bygningsdeleKatalog) return valg.bygningsdeleKatalog;
    var g = typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null;
    return g && g.IssanaLcaBygningsdele ? g.IssanaLcaBygningsdele : null;
  }
  function delId(katId) { return 'd-' + String(katId).toLowerCase().replace(/[^a-z0-9æøå]+/g, '-').replace(/^-+|-+$/g, ''); }
  // Tabel 7-installationernes linjer (lca-projekt.js installationLinjer) hører til LCAbygs Afløb, Vand og Varme.
  var INST_DEL = { afloeb: 'afloeb', vand: 'vand', varme_ventilation_koel: 'varme' };
  // → [{id (katalogets), navn, underkategorier, konstruktioner (modellens + tabel 7-linjer), kg}] i LCAbygs rækkefølge; alle 17, også tomme.
  function delListe(b, valg) {
    var kat = bygningsdeleKatalog(valg), dele = (b && b.dele) || [], efterId = {}, inst = {};
    dele.forEach(function (d) { efterId[d.id] = d; });
    ((b && b.installationLinjer) || []).forEach(function (l) { var del = INST_DEL[l.kategori]; if (del) (inst[del] = inst[del] || []).push(l); });
    function post(id, navn, under, d) {
      var ls = inst[id] || [], kons = d ? d.konstruktioner.slice() : [];
      ls.forEach(function (l) { kons.push({ id: 'inst-' + l.id, navn: l.navn, inst: l, byggevarer: [], maengde: l.areal, enhed: 'm2', underkategori: null }); });
      var kg = d && d.kg != null ? d.kg : null;
      ls.forEach(function (l) { kg = (kg || 0) + l.kg; });
      return { id: id, navn: navn, underkategorier: under || [], d: d, konstruktioner: kons, kg: kg };
    }
    if (!kat || !(kat.bygningsdele || []).length) return dele.map(function (d) { return post(d.id, d.navn, [], d); });
    var liste = kat.bygningsdele.map(function (kd) { var d = efterId[delId(kd.id)] || null; if (d) d.brugt = true; return post(kd.id, kd.navn, kd.underkategorier, d); });
    dele.forEach(function (d) { if (!d.brugt) liste.push(post(d.id, d.navn, [], d)); delete d.brugt; });
    return liste;
  }
  function manglendeByggevarer(b, valg) {
    var poster = [];
    delListe(b, valg).forEach(function (d) {
      d.konstruktioner.forEach(function (k) {
        (k.byggevarer || []).forEach(function (bv) {
          if (!bv.datasaet) poster.push({ d: d, under: k.underkategori || null, k: k, bv: bv });
        });
      });
    });
    return poster;
  }
  function modelValgForMangel(b, valg, produktId, efterProduktId) {
    var poster = manglendeByggevarer(b, valg);
    var fundet = produktId ? poster.filter(function (x) { return x.bv.id === produktId; })[0] : null;
    if (!fundet && efterProduktId && poster.length) {
      var indeks = poster.findIndex(function (x) { return x.bv.id === efterProduktId; });
      fundet = poster[(indeks + 1 + poster.length) % poster.length];
    }
    return fundet || poster[0] || null;
  }
  function modelValgForProdukt(b, valg, produktId) {
    var fundet = null;
    delListe(b, valg).some(function (d) {
      return d.konstruktioner.some(function (k) {
        return (k.byggevarer || []).some(function (bv) {
          if (bv.id !== produktId) return false;
          fundet = { d: d, under: k.underkategori || null, k: k, bv: bv };
          return true;
        });
      });
    });
    return fundet;
  }
  function manglerAntal(liste, test) {
    var n = 0;
    liste.forEach(function (x) {
      if (!test || test(x)) n += (x.byggevarer || []).filter(function (bv) { return !bv.datasaet; }).length;
    });
    return n;
  }
  function sorterBygningsdele(liste) {
    var med = liste.filter(function (x) { return x.konstruktioner.length; });
    var tomme = liste.filter(function (x) { return !x.konstruktioner.length; });
    med.sort(function (a, z) { return (z.kg || 0) - (a.kg || 0); });
    return { med: med, tomme: tomme };
  }
  // valg.kDel (katalogets id), kUnder (underkategori eller null = alle), kKon, kBv: det valgte; ellers den største bygningsdel med
  // konstruktioner og dens første regnede byggevare.
  function kolonneValg(b, valg) {
    var liste = delListe(b, valg), d = null, k = null, bv = null;
    liste.forEach(function (x) { if (x.id === valg.kDel) d = x; });
    if (!d) liste.forEach(function (x) { if (x.kg != null && x.konstruktioner.length && (!d || x.kg > d.kg)) d = x; });
    d = d || liste.filter(function (x) { return x.konstruktioner.length; })[0] || liste[0] || null;
    var under = d && valg.kUnder && d.underkategorier.indexOf(valg.kUnder) >= 0 ? valg.kUnder : null;
    var ks = d ? d.konstruktioner.filter(function (x) { return !under || x.underkategori === under; }) : [];
    ks.forEach(function (x) { if (x.id === valg.kKon) k = x; });
    if (!k) ks.forEach(function (x) { if (!k && x.byggevarer.some(function (y) { return y.regnet; })) k = x; });
    k = k || ks[0] || null;
    var bs = k ? k.byggevarer : [];
    bs.forEach(function (x) { if (x.id === valg.kBv) bv = x; });
    if (!bv) bs.forEach(function (x) { if (!bv && x.regnet) bv = x; });
    return { liste: liste, d: d, under: under, ks: ks, k: k, bv: bv || bs[0] || null };
  }
  function kgKort(n) { return typeof n === 'number' && isFinite(n) ? tal(n, Math.abs(n) >= 100 ? 0 : 1) : '—'; }
  function kSum(k) { if (k.inst) return k.inst.kg; var s = 0, har = false; k.byggevarer.forEach(function (x) { if (x.kg != null) { s += x.kg; har = true; } }); return har ? s : null; }
  function kPost(attr, cur, navn, vv, uv, kl) {
    return '<button class="lcak-post' + (kl ? ' ' + kl : '') + '" ' + attr + ' aria-current="' + (cur ? 'true' : 'false') + '"><span class="lcak-navn">' + navn + '</span><span class="lcak-n">' + vv + '</span>' + (uv ? '<span class="lcak-u">' + uv + '</span>' : '') + '</button>';
  }
  var FASER = [['A1-A3', 'Produktion'], ['A4', 'Transport · byggeproces, egen grænse'], ['B4', 'Udskiftning'], ['C3', 'Affaldsbehandling'], ['C4', 'Bortskaffelse'], ['D', 'Uden for systemet · ikke i total']];
  function instFaserHtml(l) {
    var m = l.moduler || {};
    return FASER.filter(function (f) { return f[0] !== 'A4'; }).map(function (f) {
      return '<div class="lcak-fase"><span class="lcak-fk lcak-f' + f[0].replace('-', '') + '"></span><span>' + f[0] + '<small class="lcak-u">' + esc(f[1]) + '</small></span><span class="lcak-n">' + kgKort(m[f[0]] || 0) + ' kg</span></div>';
    }).join('') + '<div class="lcak-fase lcak-ialt"><span></span><span>I alt<small class="lcak-u">A1-A3 + B4 + C3 + C4</small></span><span class="lcak-n">' + kgKort(l.kg) + ' kg</span></div>';
  }
  function faserHtml(bv) {
    if (!bv) return '<p class="v3-hint lcak-tom">Vælg en byggevare.</p>';
    if (!bv.regnet || !bv.moduler) return '<p class="v3-hint lcak-tom">' + (bv.datasaet ? 'ISSANA LCA har ikke regnet byggevaren endnu.' : 'Byggevaren har ingen miljødata endnu.') + '</p>';
    var m = bv.moduler;
    return FASER.map(function (f) {
      var v = f[0] === 'A4' ? bv.a4 : m[f[0]];
      return '<div class="lcak-fase"><span class="lcak-fk lcak-f' + f[0].replace('-', '') + '"></span><span>' + f[0] + '<small class="lcak-u">' + esc(f[1]) + (f[0] === 'B4' && bv.udskiftninger != null ? ' · ' + bv.udskiftninger + ' udskiftninger' : '') + '</small></span><span class="lcak-n">' + kgKort(v) + ' kg</span></div>';
    }).join('') + '<div class="lcak-fase lcak-ialt"><span></span><span>I alt<small class="lcak-u">A1-A3 + B4 + C3 + C4</small></span><span class="lcak-n">' + kgKort(bv.kg) + ' kg</span></div>';
  }
  function konPost(x, v) {
    var uv = x.inst ? 'Standardværdi pr. m² opvarmet areal' + (x.inst.areal ? ' (' + tal(x.inst.areal, 0) + ' m²)' : '') + (x.inst.key ? ' · ' + esc(x.inst.key) : '')
      : (x.maengde != null ? tal(x.maengde, 1) + ' ' + enh(x.enhed) : 'mængde mangler') + ' · ' + x.byggevarer.length + ' byggevarer' + (x.underkategoriAntaget ? ' · underkategori antaget' : '');
    var mangler = manglerAntal([x]);
    var status = mangler ? '<span class="lcak-mangler-tal">' + mangler + ' uden data</span> ' : '';
    return kPost('data-lca-k-kon="' + esc(x.id) + '"', x === v.k, esc(x.navn), kgKort(kSum(x)), status + uv);
  }
  function naesteMangelTekst(v) {
    var i = v.mangler.findIndex(function (x) { return v.bv && x.bv.id === v.bv.id; });
    var naeste = i < 0 ? 1 : (i + 1) % v.mangler.length + 1;
    return 'Næste uden data (' + naeste + ' af ' + v.udenDataAntal + ')';
  }
  // Bygningsdele: LCAbygs 17 i fast rækkefølge; den valgte folder sine underkategorier ud (som i LCAbyg). Konstruktioner: grupperet
  // efter underkategori (tabel 7-standardværdien for sig).
  function navHtml(b, v) {
    var sorteret = sorterBygningsdele(v.liste);
    // Den korte liste prioriterer modellens indhold. Når alle vises, bruges katalogets
    // rækkefølge uændret, så de 17 LCAbyg-bygningsdele er nemme at genfinde.
    var dele = v.visTommeDele ? v.liste : sorteret.med;
    var h = '<div class="lcak-mobil-sti"><button class="lca-tekstlink" data-lca-mobile-tilbage' + (v.mobileKol > 0 ? '' : ' disabled') + '>Tilbage</button><span>' + esc(v.d ? v.d.navn : 'Bygningsdele') + (v.mobileKol > 0 && v.under ? ' › ' + esc(v.under) : '') + (v.mobileKol > 1 && v.k ? ' › ' + esc(v.k.navn) : '') + (v.mobileKol > 2 && v.bv ? ' › ' + esc(v.bv.navn) : '') + '</span></div><div class="lcak-nav lcak-mobile-' + v.mobileKol + '">';
    h += '<div class="lcak-kol"><b class="lcak-hoved">Bygningsdele <span>· kg CO₂e</span></b><div class="lcak-liste">' + dele.map(function (x) {
      var valgt = x === v.d, tom = !x.konstruktioner.length;
      var mangler = manglerAntal(x.konstruktioner);
      var status = mangler ? '<span class="lcak-mangler-tal">' + mangler + ' uden data</span>' : '';
      var s = kPost(
        'data-lca-k-del="' + esc(x.id) + '" data-lca-tom="' + tom + '"',
        valgt && !v.under,
        '<span class="lcak-pil">' + (x.underkategorier.length ? (valgt ? '▾' : '›') : '') + '</span>' + esc(x.navn),
        tom ? '—' : kgKort(x.kg),
        status
      );
      if (valgt) s += x.underkategorier.map(function (u) {
        var ku = x.konstruktioner.filter(function (k) { return k.underkategori === u; }), kg = null;
        ku.forEach(function (k) { var y = kSum(k); if (y != null) kg = (kg || 0) + y; });
        return kPost('data-lca-k-under="' + esc(u) + '" data-lca-tom="' + !ku.length + '"', v.under === u, esc(u), ku.length ? kgKort(kg) : '0', null, 'lcak-under' + (ku.length ? '' : ' lcak-tom-under'));
      }).join('');
      return s;
    }).join('');
    if (sorteret.tomme.length) {
      h += '<button class="lcak-vis-tomme" data-lca-vis-tomme>' +
        (v.visTommeDele ? 'Vis kun bygningsdele med indhold' : 'Vis alle ' + v.liste.length + ' bygningsdele') + '</button>';
    }
    h += '</div></div>';
    var grupper = [], efter = {};
    (v.ks || []).forEach(function (x) { var g = x.inst ? 'Standardværdi, BR18 tabel 7' : x.underkategori || 'Uden underkategori'; if (!efter[g]) { efter[g] = []; grupper.push(g); } efter[g].push(x); });
    h += '<div class="lcak-kol"><b class="lcak-hoved">Konstruktioner <span>· kg CO₂e</span>' + (v.under ? ' · ' + esc(v.under) : '') + '</b><div class="lcak-liste">' + (grupper.length ? grupper.map(function (g) {
      return (grupper.length > 1 || !v.under ? '<small class="lcak-gruppe">' + esc(g) + '</small>' : '') + efter[g].map(function (x) { return konPost(x, v); }).join('');
    }).join('') : '<p class="v3-hint lcak-tom">' + (v.d ? 'Ingen konstruktioner fra modellen i ' + esc(v.under || v.d.navn) + '.' : '') + '</p>') + '</div></div>';
    var bs = v.k && !v.k.inst ? v.k.byggevarer : [];
    var maxKg = bs.reduce(function (m, x) { return x.kg > m ? x.kg : m; }, 0);
    var uden = bs.filter(function (x) { return !x.datasaet; });
    var forslag = bs.filter(function (x) { return epdStatus(x)[0] === 'warn'; });
    var filter = v.bvFilter || 'alle';
    if (filter === 'uden' && !uden.length || filter === 'forslag' && !forslag.length) filter = 'alle';
    var viste = bs.filter(function (x) {
      return filter === 'alle' || filter === 'uden' && !x.datasaet || filter === 'forslag' && epdStatus(x)[0] === 'warn';
    });
    h += '<div class="lcak-kol"><b class="lcak-hoved">Byggevarer <span>· kg CO₂e</span></b><div class="lcak-bv-tools">';
    if (v.k && !v.k.inst) {
      h += '<div class="lcak-bv-filter"><button data-lca-bv-filter="alle" aria-pressed="' + (filter === 'alle') + '">Alle</button>' +
        '<button data-lca-bv-filter="uden" aria-pressed="' + (filter === 'uden') + '">Uden data (' + uden.length + ')</button>' +
        '<button data-lca-bv-filter="forslag" aria-pressed="' + (filter === 'forslag') + '">Forslag (' + forslag.length + ')</button></div>';
    }
    if (v.mangler.length) h += '<button class="tbtn lcak-naeste" data-lca-naeste-mangel>' + naesteMangelTekst(v) + '</button>';
    else h += '<p class="lcak-alle-data">Alle byggevarer har data ✓</p>';
    h += '</div><div class="lcak-liste">' + (v.k && v.k.inst ?
      '<p class="v3-hint lcak-tom">Installationerne regnes med BR18 tabel 7\'s standardværdier pr. m² opvarmet areal, ikke pr. byggevare.</p>' :
      v.k ? viste.map(function (x) {
        var st = epdStatus(x);
        var bredde = maxKg > 0 && x.kg > 0 ? x.kg / maxKg * 100 : 0;
        return kPost('data-lca-k-bv="' + esc(x.id) + '"', x === v.bv, esc(x.navn) + (x.datasaet ? '<small class="lcak-dataset">' + esc(x.datasaet.navn || x.datasaet.key) + '</small>' : '') + '<span class="lcak-bv-bar"><i style="width:' + bredde.toFixed(1) + '%"></i></span>', x.kg != null ? kgKort(x.kg) : '—', '<span class="lcak-chip lcak-' + st[0] + '-c">' + esc(st[1]) + '</span>');
      }).join('') : '') + '</div></div>';
    return h + '</div>';
  }
  function navnTykkelse(bv) {
    var m = /\((\d+(?:[.,]\d+)?)\s*mm\)/.exec(bv.navn || ''), t = (bv.ref || {}).tykkelseMm;
    if (!m || t == null) return null;
    var n = Number(m[1].replace(',', '.'));
    return Math.abs(n - t) > 0.5 ? 'Navnet siger ' + tal(n, 0) + ' mm, men laget i Revit er ' + tal(t, 0) + ' mm. Mængden følger Revit-laget.' : null;
  }
  function faktorFelter(navne, r, f, fbv) {
    return '<div class="lcak-felter">' + navne.map(function (n) {
      var t = FELT_TEKST[n], u = n === 'v' ? enhedPen(f.taeller || f.ud) + '/' + enhedPen(f.naevner) : n === 'vk' ? 'kg/' + enhedPen(f.naevner) : n === 'M' ? 'kg pr. ' + enhedPen(f.ud) : t[1];
      var fra = fbv && (n === 'rho' ? fbv.rho0 : n === 'M' ? fbv.M0 : null);
      return '<label>' + esc(t[0]) + ' (' + esc(u) + ')<input type="number" min="0" step="any" data-lca-f="' + n + '" value="' + (r[n] != null && r[n] !== '' ? esc(r[n]) : '') + '"' + (fra ? ' placeholder="' + esc(tal(fra, 1)) + ' (datasættet)"' : '') + '></label>';
    }).join('') + '</div>';
  }
  function faktorBlokHtml(bv, k, valg) {
    var ds = bv.datasaet, ref = bv.ref || {};
    var h = '<div class="lcak-blok" data-lca-faktor-boks><b class="lcak-h4">Mængde og omregningsfaktor</b>';
    h += '<div>Samlet mængde: <b>' + (k.maengde != null ? tal(k.maengde, 1) + ' ' + enh(k.enhed) : '—') + '</b> <small class="v3-hint">fra Revit</small></div>';
    if (!ds) return h + '<p class="v3-hint">Vælg først et datasæt eller en egen EPD. Faktoren regnes i dens enhed.</p></div>';
    var r = faktorRedigering(bv, valg.fEdit), fbv = faktorBv(bv), f = omregningsfaktor(fbv, k, r), F = FORMER[f.form], heltElement = f.uk !== 'm2' && !ref.tykkelseMm, fraOpbygning = !!ref.kanAendreMaengde;
    h += '<div>EPD\'ens enhed: <b>1 ' + enhedPen(f.ud) + '</b>' + (ref.maengde && ref.maengde.faktor != null ? ' · <span class="v3-hint">din faktor bruges nu</span>' : ref.maengde ? ' · <span class="v3-hint">din samlede mængde bruges nu</span>' : '') + '</div>';
    var skrivForm = /direkte$/.test(f.form) ? f.form : 'direkte';
    h += '<div class="lca-maengde-kilde"><b>Mængdekilde</b><div class="lcak-chips" role="group" aria-label="Mængdekilde">' +
      [['model', 'Lag (Revit-tykkelse)'], ['kgskelet', 'Skelet eller profil'], ['m2direkte', 'Overflade'], [skrivForm, 'Skriv selv']].map(function (x) { return '<button data-lca-f-form="' + x[0] + '" aria-pressed="' + (f.form === x[0] || x[1] === 'Skriv selv' && /direkte$/.test(f.form)) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<label>Enhed <select data-lca-maengde-enhed><option value="m3direkte"' + (f.form === 'm3direkte' ? ' selected' : '') + '>m³/m²</option><option value="m2direkte"' + (f.form === 'm2direkte' ? ' selected' : '') + '>m²/m²</option><option value="kgdirekte"' + (f.form === 'kgdirekte' || f.form === 'kgskelet' ? ' selected' : '') + '>kg/m²</option><option value="mdirekte"' + (f.form === 'mdirekte' ? ' selected' : '') + '>m/m²</option><option value="stkdirekte"' + (f.form === 'stkdirekte' ? ' selected' : '') + '>stk/m²</option></select></label><small>Profilvægten foreslås aldrig automatisk; angiv den fra producentens dokumentation.</small></div>';
    // Kun de enheder, der passer til EPD'en og konstruktionen. Et ældre gemt valg vises stadig, så det kan ses og skiftes.
    h += '<small class="v3-hint">Regn omregningsfaktoren i</small><div class="lcak-chips" role="group" aria-label="Omregningsfaktorens enhed">' + FORM_RAEKKE.filter(function (id) { return formTilladt(id, f.ud, f.uk) || id === f.form; }).map(function (id) {
      var G = FORMER[id], lbl = id === 'model' ? (fraOpbygning ? 'Fra opbygningen (' : heltElement ? 'Fra Revit-geometrien (' : 'Fra Revit-laget (') + enhedPen(f.ud) + '/' + enhedPen(f.uk) + ')' : id === 'direkte' ? 'Skriv selv (' + enhedPen(f.ud) + '/' + enhedPen(f.uk) + ')' : id === 'kgdir' ? 'Skriv selv (kg/' + enhedPen(f.uk) + ')' : G.navn;
      return '<button data-lca-f-form="' + id + '" aria-pressed="' + (f.form === id) + '">' + esc(lbl) + '</button>';
    }).join('') + '</div>';
    var felter = (F.felter || []).slice();
    if (F.taeller === 'kg' && ['m2', 'm', 'stk'].indexOf(f.ud) >= 0) felter.push('M');
    if (((F.taeller === 'm3' && (f.ud === 'kg' || f.ud === 'ton')) || (F.taeller === 'kg' && f.ud === 'm3')) && felter.indexOf('rho') < 0) felter.push('rho');
    if (felter.length) h += faktorFelter(felter, r, f, fbv);
    if (F.andel && !heltElement && !fraOpbygning) {
      var lt = r.lagtype || 'homogen';
      h += '<small class="v3-hint">Laget</small><div class="lcak-chips" role="group" aria-label="Lagtype">' + [['homogen', 'Homogent'], ['gentaget', 'Gentaget: b ÷ c-c (lægter, stolper)'], ['mellemrum', 'Mellemrum: (c-c − b) ÷ c-c (isolering)']].map(function (x) {
        return '<button data-lca-f-lag="' + x[0] + '" aria-pressed="' + (lt === x[0]) + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>';
      if (lt !== 'homogen') h += faktorFelter(['b', 'cc'], r, f);
    }
    var per = enhedPen(f.taeller || f.ud) + '/' + enhedPen(f.naevner);
    h += '<div class="lcak-formel"><div class="lcak-stor">Omregningsfaktor <b>' + (f.vaerdi != null ? sig(f.vaerdi, 5) : '—') + ' ' + per + '</b></div>' +
      (f.fejl ? '<div class="issana-mangler">' + esc(f.fejl) + '</div>' : '<div>' + esc(faktorRegnestykke(f, r)) + '</div>' +
        (f.konv !== 1 ? '<div>EPD\'en er pr. ' + enhedPen(f.ud) + ' (' + esc(f.konvTekst || '') + '), så faktoren gemmes som ' + sig(f.gem, 5) + ' ' + enhedPen(f.ud) + '/' + enhedPen(f.naevner) + '.</div>' : '') +
        (k.maengde != null ? '<div>' + tal(k.maengde, 1) + ' ' + enh(k.enhed) + ' × ' + sig(f.vaerdi, 5) + ' ' + per + ' = <b>' + sig(k.maengde * f.vaerdi, 5) + ' ' + enhedPen(f.taeller) + '</b></div>' : '')) +
      (F.fs ? '<div class="v3-hint">F#-formel: ' + esc(F.fs) + '</div>' : '') + '</div>';
    var faktorAendret = !!valg.fEdit;
    var faktorTekst = valg.faktorGemt === bv.id ? 'Gemt ✓' : 'Brug på dette lag';
    if (ref.kanAendres || ref.kanAendreMaengde) h += '<div class="lca-raekke" style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:flex-end;margin:4px 0"><button class="tbtn" data-lca-f-gem' + (f.fejl || !faktorAendret ? ' disabled' : '') + '>' + faktorTekst + '</button>' +
      '<button class="tbtn" data-lca-f-gem-alle' + (f.fejl || !faktorAendret ? ' disabled' : '') + '>Brug på alle lag med «' + esc(ref.materiale || bv.navn) + '»</button>' +
      (ref.maengde ? '<button class="tbtn" data-lca-f-fjern>Brug modellens mængde</button>' : '') + '</div>';
    return h + '<small class="v3-hint">Kilde: ' + (ref.maengde ? esc(ref.maengde.kilde || '') : esc(bv.maengdeKilde || 'Revit-modellen')) + '. Samlet mængde = ' + (k.maengde != null ? tal(k.maengde, 3) + ' ' + enh(k.enhed) : 'mangler') + ' × faktoren. ' + (valg.fEdit ? 'CO₂: Regnes om, når ændringen bruges.' : 'ISSANA LCA bruger den gemte mængde.') + '</small></div>';
  }
  /* ---------- Opbygning fra LCAbyg-biblioteket (brugerens egne eksporter): hele konstruktionen på én gang ---------- */
  function bibModul(valg) { return (valg && valg.bibliotekModul) || (typeof window !== 'undefined' && window.IssanaLcabygBibliotek) || null; }
  function opbygningBlokHtml(k, valg) {
    var h = '<div class="lcak-blok" data-lca-opb><b class="lcak-h4">Opbygning fra LCAbyg-bibliotek</b>', B = bibModul(valg), bib = valg.bibliotek;
    if (k.opbygning) h += '<div>Bruger nu: <b>' + esc(k.opbygning.navn) + '</b> <button class="tbtn" data-lca-opb-fjern>Brug Revit-typen igen</button></div>';
    if (!B || !bib || !(bib.konstruktioner || []).length) return '';
    var q = valg.opbSoeg || '', r = B.soegKonstruktioner(bib, q, enhedNorm(k.enhed), 12);
    h += '<div class="lcak-felter"><label>Søg i dine opbygninger pr. ' + enh(k.enhed) + '<input type="search" data-lca-opb-soeg value="' + esc(q) + '" placeholder="fx ydervæg, tag, trappe" style="width:240px"></label></div>';
    if (!r.antal) return h + '<p class="v3-hint">Ingen opbygninger pr. ' + enh(k.enhed) + (q ? ' matcher «' + esc(q) + '»' : ' i biblioteket') + '.</p></div>';
    h += r.hits.map(function (x) {
      var aaben = valg.opbVis === x.id, o = aaben ? B.opbygning(bib, x.id) : null;
      var r2 = '<div class="lcak-db-hit"><div><b>' + esc(x.navn) + '</b><small class="lcak-u">' + x.linjer.length + ' byggevarer · pr. ' + enh(k.enhed) + '</small></div><button class="tbtn" data-lca-opb-vis="' + esc(x.id) + '" aria-pressed="' + aaben + '">' + (aaben ? 'Skjul' : 'Vis') + '</button></div>';
      if (o) r2 += '<table class="lcak-opb" data-lca-opb-tabel><tr><th>Byggevare</th><th>Mængde</th><th>Levetid</th></tr>' + o.linjer.map(function (l) { return '<tr><td>' + esc(l.navn) + '</td><td>' + sig(l.indtastet, 4) + ' ' + esc(l.indtastetEnhed) + '/' + enh(k.enhed) + '</td><td>' + (l.levetid != null ? tal(l.levetid, 0) + ' år' : '—') + '</td></tr>'; }).join('') + '</table><div class="lcak-chips"><button class="tbtn primary" data-lca-opb-brug="' + esc(x.id) + '">Brug opbygningen på «' + esc(k.navn) + '»</button></div>';
      return r2;
    }).join('');
    return h + (r.antal > r.hits.length ? '<small class="v3-hint">Viser ' + r.hits.length + ' af ' + r.antal + '. Søg for at finde flere.</small>' : '') + '<small class="v3-hint">Data fra LCAbyg er ubekræftet, til du har tjekket dem mod EPD\'en. ISSANA LCA regner med dem, men melder, hvad der mangler for BR18.</small></div>';
  }
  function lagfunktionDansk(funktion) {
    var faste = {
      Structure: 'Bærende lag', Substrate: 'Underlag', 'Thermal/Air Layer': 'Isolering/luft',
      'Finish 1': 'Overflade 1', 'Finish 2': 'Overflade 2', 'Membrane Layer': 'Membran'
    };
    return faste[funktion] || funktion || '';
  }
  function serForkertUd(bv, d) {
    var k = arguments[2], beregning = arguments[3], ref = (bv && bv.ref) || {}, materiale = String(ref.materiale || bv && bv.navn || ''), del = String(d && d.navn || '');
    var datasæt = String(bv && bv.datasaet && (bv.datasaet.navn || bv.datasaet.key) || ''), funktion = String(ref.funktion || '');
    var manuel = !!(ref.maengde && ref.maengde.faktor != null), massiv = ref.tykkelseMm > 6 && !manuel;
    var finishModProfil = /finish|overflade|surface|membran/i.test(funktion) && /konstruktionsstål|structural steel|valsede profiler|steel profiles?|massiv/i.test(datasæt);
    var metalLag = /stål|steel|aluminium|aluminum/i.test(materiale + ' ' + datasæt) && /væg|loft|ceiling|wall/i.test(del);
    var konKg = k && kSum(k), totalKg = beregning && beregning.materialer && beregning.materialer.kg;
    var storAndel = !manuel && bv && bv.kg > 0 && (konKg > 0 && bv.kg / konKg > 0.8 || totalKg > 0 && bv.kg / totalKg > 0.5);
    return !!(massiv && (finishModProfil || metalLag) || storAndel);
  }
  function mistænkeligeForslag(b) {
    var typeIds = [];
    (b && b.dele || []).forEach(function (d) { (d.konstruktioner || []).forEach(function (k) { (k.byggevarer || []).forEach(function (bv) {
      var ref = bv.ref || {};
      if (ref.valg === 'forslag' && serForkertUd(bv, d, k, b) && ref.typeId != null && typeIds.indexOf(ref.typeId) < 0) typeIds.push(ref.typeId);
    }); }); });
    return typeIds;
  }
  function sammeBygningsdelHtml(valg) {
    var tilladt = { lyd: 'Lyd', varmetab: 'Varmetab', energi: 'Energi', pris: 'Pris' }, l = (valg && valg.sammeFag || []).filter(function (x) { return x && tilladt[x.id] && x.findes; });
    if (!l.length) return '<div class="lcak-blok"><b class="lcak-h4">Samme bygningsdel i</b><p class="v3-hint">Ingen verificerede koblinger til Lyd, Varmetab, Energi eller Pris blev fundet for denne bygningsdel.</p></div>';
    return '<div class="lcak-blok"><b class="lcak-h4">Samme bygningsdel i</b><div class="lcak-chips">' + l.map(function (x) { return '<button data-lca-samme-fag="' + x.id + '">' + tilladt[x.id] + '</button>'; }).join('') + '</div></div>';
  }
  function detaljeHtml(v, valg) {
    var bv = v.bv, k = v.k, opbH = k && !k.inst ? opbygningBlokHtml(k, valg) : '';
    if (k && k.inst) {
      var l = k.inst;
      return '<div class="lcak-detalje"><div><b class="lcak-titel">' + esc(l.navn) + '</b><small class="lcak-u">' + esc(v.d.navn) + ' › BR18 tabel 7, standardværdi' + (l.key ? ' ' + esc(l.key) : '') + '</small></div>' +
        '<p>Installationerne regnes med BR18 bilag 2, tabel 7\'s standardværdi pr. m² opvarmet areal' + (l.areal ? ' (' + tal(l.areal, 0) + ' m²)' : '') + ' for bygningstypen. Vil du regne med modellens egne installationer i stedet, så slå standardværdierne fra under «Drift og byggeplads».</p></div>';
    }
    if (!bv) return '<div class="lcak-detalje"><p class="v3-hint">' + (v.d && !v.d.konstruktioner.length ? 'Modellen har intet i «' + esc(v.d.navn) + '» endnu.' : 'Vælg en byggevare.') + '</p>' + opbH + '</div>';
    var ref = bv.ref || {}, ds = bv.datasaet, st = epdStatus(bv), nt = navnTykkelse(bv);
    var h = '<div class="lcak-detalje lcak-mobile-detalje" data-lca-k-detalje="' + esc(bv.id) + '"><div class="lcak-faser-detalje"><b class="lcak-hoved">Faser og detaljer</b>' + (k && k.inst ? instFaserHtml(k.inst) : faserHtml(bv)) + '</div>' + opbH + '<div><b class="lcak-titel">' + esc(bv.navn) + '</b><small class="lcak-u">' + esc(v.d.navn) + ' › ' + esc(k.navn) +
      (ref.tykkelseMm != null ? ' · lag ' + tal(ref.tykkelseMm, 0) + ' mm' : '') +
      (ref.funktion ? ' · ' + esc(lagfunktionDansk(ref.funktion)) : '') + '</small></div>';
    if (nt) h += '<p class="lcak-advar">' + esc(nt) + '</p>';
    if (serForkertUd(bv, v.d, k, valg.beregning)) h += '<p class="lcak-advar" data-lca-ser-forkert><b>Ser forkert ud</b><br>' + esc(ref.materiale || bv.navn) + ' fylder urimeligt meget eller er matchet som et massivt metal-/profillag. Kontrollér lagfunktion, datasæt og mængde. Vælg selv profilvægt og c-c; ISSANA foreslår aldrig profilvægten.</p>';
    // Et gentaget lag (stolper, lægter) må ikke regnes som massivt: samme ord som epd-match.js' forslag.
    if (/\bstuds?\b|stolpe|reglar|skelet|lægte|\bbattens?\b|furring|\bjoists?\b|bjælkelag|spærlag/i.test(ref.materiale || bv.navn || '') && !(ref.maengde && ref.maengde.faktor != null)) h += '<p class="lcak-advar" data-lca-gentaget>«' + esc(ref.materiale || bv.navn) + '» er sandsynligvis et gentaget lag og ikke massivt. Vælg datasæt, og sæt «Gentaget» med bredde og c-c under omregningsfaktoren; ellers regnes hele laget som massivt.</p>';
    if (!bv.regnet && bv.mangler && bv.mangler.length) h += '<p class="issana-mangler">' + esc(bv.mangler[0]) + '</p>';
    h += '<div class="lcak-blok"><b class="lcak-h4">EPD / datasæt</b>' + (ds ? '<div><b>' + esc(ds.key) + '</b> ' + esc(ds.navn || '') + ' <span class="lcak-chip lcak-' + st[0] + '-c">' + esc(st[1]) + '</span></div>' +
      (ds.a1a3 != null ? '<small class="v3-hint">A1-A3 ' + sig(ds.a1a3, 5) + ' kg CO₂e/' + enh(ds.enhed) + '</small>' : '') : '<p class="v3-hint">Ingen miljødata endnu.</p>');
    var aabenHer = valg.ret === bv.id && valg.retKilde === 'kolonner';
    if (ref.kanAendres) h += '<div class="lcak-chips">' + [['datasaet', 'BR18 tabel 7'], ['database', 'Fra EPD-database'], ['egen', 'Egen EPD'], ['levetid', 'Ret levetid']].map(function (f) {
      return '<button data-lca-k-ret="' + f[0] + '" aria-pressed="' + (aabenHer && valg.fane === f[0]) + '">' + f[1] + '</button>'; }).join('') + '</div>';
    if (aabenHer) h += valg.fane === 'database' ? epdDbVaelgHtml(bv, valg) : retHtml(bv, valg);
    if (ref.valg === 'forslag' && ds) h += '<div class="lca-ai-forslag"><b>Forslag til ændring · Ikke gemt endnu</b><div><span>Før: Ingen bekræftede miljødata</span><span title="Datasæt ' + esc(ds.key || '') + '">Forslag: ' + esc(ds.navn || 'miljødata') + ' – skal bekræftes</span></div><p class="v3-hint">Forslag · ikke bekræftet. Revit ændres ikke automatisk.</p><button class="tbtn primary" data-lca-bekraeft-produkt>Bekræft</button><button class="tbtn" data-lca-k-ret="datasaet">Vælg en anden</button><button class="tbtn" data-lca-fortryd-forslag>Fortryd</button><button class="tbtn" data-lca-brug-alle-materiale>Brug alle steder</button></div>';
    h += '</div>' + faktorBlokHtml(bv, k, valg) + sammeBygningsdelHtml(valg);
    h += '<div class="lcak-blok"><b class="lcak-h4">Levetid</b><div>' + (bv.levetid != null ? tal(bv.levetid, 0) + ' år → ' + (bv.udskiftninger != null ? bv.udskiftninger : '?') + ' udskiftninger på 50 år' : '—') + '</div>' +
      (bv.levetidKilde ? '<small class="v3-hint">' + esc(bv.levetidKilde) + '</small>' : '') + '</div>';
    return h + '</div>';
  }
  function kaedeHtml(v, skjulSmal) {
    var bv = v.bv, k = v.k;
    var klasse = 'lcak-kaede' + (skjulSmal ? ' lcak-kaede-auto' : '');
    if (k && k.inst) {
      var lm = k.inst.moduler || {};
      return '<div class="' + klasse + '" data-lca-kaede><b>Regnekæden: ' + esc(k.inst.navn) + '</b><p class="v3-hint">Standardværdi fra BR18 tabel 7' + (k.inst.key ? ' (' + esc(k.inst.key) + ')' : '') + ' × ' + (k.inst.areal ? tal(k.inst.areal, 0) + ' m²' : 'opvarmet areal') + ' × 50 år. Udskiftninger er indregnet i standardværdien, derfor ingen B4 (vejledning 1.4.9).</p>' +
        '<table class="lca lcak-tabel"><thead><tr><th>Fase</th><th class="n">kg CO₂e</th></tr></thead><tbody>' + ['A1-A3', 'C3', 'C4'].map(function (f) { return '<tr><td>' + f + '</td><td class="n">' + kgKort(lm[f] || 0) + '</td></tr>'; }).join('') +
        '<tr><td><b>I alt</b></td><td class="n"><b>' + kgKort(k.inst.kg) + '</b></td></tr><tr><td>D (ikke i total)</td><td class="n">' + kgKort(lm.D || 0) + '</td></tr></tbody></table><small class="v3-hint">Alle tal kommer fra ISSANA LCA.</small></div>';
    }
    if (!bv || !bv.regnet || !bv.moduler || !bv.datasaet) return '<div class="' + klasse + '" data-lca-kaede><b>Regnekæden</b><p class="v3-hint">Vælg en byggevare, som ISSANA LCA har regnet, for at se dens regnekæde.</p></div>';
    var ds = bv.datasaet, m = bv.moduler, q = bv.maengde, be = enh(bv.enhed), ref = bv.ref || {}, g = (ref.post || {}).gwp || {};
    var F = k.maengde > 0 && q != null ? q / k.maengde : null;
    var c3 = g.C3 != null ? g.C3 : q ? m.C3 / q : null, c4 = g.C4 != null ? g.C4 : q ? m.C4 / q : null;
    function boks(lb, vv, kk, res) { return '<div class="lcak-boks' + (res ? ' lcak-res' : '') + '"><small>' + lb + '</small><b>' + vv + '</b><span>' + kk + '</span></div>'; }
    function op(s) { return '<span class="lcak-op">' + s + '</span>'; }
    function tr(f, s, kgv) { return '<tr><td>' + f + '</td><td>' + s + '</td><td class="n">' + kgKort(kgv) + '</td></tr>'; }
    var h = '<div class="' + klasse + '" data-lca-kaede><b>Regnekæden: ' + esc(bv.navn) + '</b><div class="lcak-led">' +
      boks('Samlet mængde', tal(k.maengde, 1) + ' ' + enh(k.enhed), esc(k.navn) + ', fra Revit') + op('×') +
      boks('Omregningsfaktor', sig(F, 5) + ' ' + be + '/' + enh(k.enhed), ref.maengde && ref.maengde.faktor != null ? 'din faktor' : esc((ref.post || {}).omregning || (ref.kanAendreMaengde ? 'fra opbygningen' : k.enhed === 'm2' ? 'fra Revit-laget' : 'fra Revit-geometrien'))) + op('×') +
      boks('EPD A1-A3', sig(ds.a1a3, 6) + ' kg CO₂e/' + enh(ds.enhed), esc(ds.key) + ' ' + esc(ds.navn || '')) + op('=') +
      boks('A1-A3', kgKort(m['A1-A3']) + ' kg CO₂e', sig(q, 5) + ' ' + be + ' byggevare', true) + '</div>';
    h += '<table class="lca lcak-tabel"><thead><tr><th>Fase</th><th>Sådan</th><th class="n">kg CO₂e</th></tr></thead><tbody>' +
      tr('A1-A3', sig(q, 5) + ' ' + be + ' × ' + sig(ds.a1a3, 6), m['A1-A3']) + tr('C3', sig(q, 5) + ' ' + be + ' × ' + sig(c3, 4), m.C3) + tr('C4', sig(q, 5) + ' ' + be + ' × ' + sig(c4, 4), m.C4) +
      tr('B4', (bv.udskiftninger != null ? bv.udskiftninger : '?') + ' udskiftninger (levetid ' + tal(bv.levetid, 0) + ' år på 50 år) × (A1-A3 + C3 + C4)', m.B4) +
      '<tr><td><b>I alt</b></td><td>A1-A3 + B4 + C3 + C4</td><td class="n"><b>' + kgKort(bv.kg) + '</b></td></tr>' +
      tr('A4', 'Transport efter masse og transportgruppe. Tæller i byggeprocessen, ikke her.', bv.a4) + tr('D', '(udskiftninger + 1) × mængde × D. Vises, men tælles ikke med.', m.D) + '</tbody></table>';
    return h + '<small class="v3-hint">Alle tal kommer fra ISSANA LCA. Mængde = samlet mængde × omregningsfaktor.</small></div>';
  }
  /* ---------- EPD-databaser: brugerens egne EPD-lister (fil eller adresse) ved siden af BR18 tabel 7 ---------- */
  // Format «issana-epd/1» (JSON: {schema, navn, kilde, opdateret, epd:[…]} eller en liste) eller CSV med kolonnerne i EPD_KOLONNER
  // (fx navn;producent;enhed;A1A3;C3;C4;D;densitet;registreringsnr;programoperatoer;url;udstedt;udloeb;verificeret;en15804;gwpindikator;type).
  // Skabelon: docs/issana-mcp/epd-database-skabelon.csv. Gemmes i browserens lager (pr. bruger, på tværs af projekter). En EPD herfra
  // fylder «Egen EPD» ud; brugeren bekræfter, at den dækker byggevaren, og ISSANA LCA tjekker den efter vejledningen (1.6).
  var EPD_NOEGLE = 'issana-epd-databaser-v1';
  var EPD_KOLONNER = { navn: ['navn', 'name', 'produkt', 'product', 'produktnavn'], producent: ['producent', 'manufacturer', 'producer', 'fabrikant'], enhed: ['enhed', 'unit', 'deklareretenhed', 'declaredunit'],
    A1A3: ['a1a3', 'gwpa1a3', 'a1a3gwp'], C3: ['c3', 'gwpc3'], C4: ['c4', 'gwpc4'], D: ['d', 'gwpd'], densitet: ['densitet', 'density', 'massefylde'],
    registreringsnr: ['registreringsnr', 'regnr', 'epdnr', 'epdnummer', 'registrationnumber', 'nummer'], programoperatoer: ['programoperatoer', 'programoperator', 'operator'],
    url: ['url', 'link', 'epdurl', 'dokument'], udstedt: ['udstedt', 'issued', 'issuedate', 'udgivet'], udloeb: ['udloeb', 'udloeber', 'validuntil', 'expires', 'gyldigtil'], verificeret: ['verificeret', 'verified', 'tredjepartsverificeret'],
    en15804: ['en15804', 'standard'], gwpIndikator: ['gwpindikator', 'gwpindicator', 'indikator'], type: ['type', 'epdtype'], id: ['id'] };
  function noegleNavn(s) { return String(s == null ? '' : s).toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa').replace(/[^a-z0-9]/g, ''); }
  function talDk(v) {
    if (v == null) return null; if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim().replace(/\s/g, ''); if (!s) return null;
    s = s.indexOf(',') >= 0 && s.indexOf('.') >= 0 ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.');
    var n = Number(s); return isFinite(n) ? n : null;
  }
  function datoIso(v) {
    var s = String(v == null ? '' : v).trim(), m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    if ((m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(s))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return null;
  }
  function csvRaekker(tekst) {
    tekst = String(tekst || '').replace(/^﻿/, '');
    var forste = tekst.split(/\r?\n/)[0] || '', sep = [';', '\t', ','].reduce(function (a, s) { return forste.split(s).length > forste.split(a).length ? s : a; }, ';');
    var raekker = [], r = [], felt = '', i = 0, iCitat = false;
    for (; i < tekst.length; i++) {
      var c = tekst[i];
      if (iCitat) { if (c === '"' && tekst[i + 1] === '"') { felt += '"'; i++; } else if (c === '"') iCitat = false; else felt += c; continue; }
      if (c === '"') iCitat = true; else if (c === sep) { r.push(felt); felt = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && tekst[i + 1] === '\n') i++; r.push(felt); felt = ''; if (r.some(function (x) { return String(x).trim(); })) raekker.push(r); r = []; } else felt += c;
    }
    r.push(felt); if (r.some(function (x) { return String(x).trim(); })) raekker.push(r);
    return raekker;
  }
  // Ét råt opslag (objekt med vilkårlige kolonnenavne) → {epd} eller {grund}. ton regnes om til kg; m (løbende meter) kan ikke bruges.
  function epdNormaliser(raa) {
    var flad = {}; Object.keys(raa || {}).forEach(function (k) { var v = raa[k]; if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(v).forEach(function (k2) { flad[noegleNavn(k2)] = v[k2]; }); else flad[noegleNavn(k)] = v; });
    function f(felt) { var navne = EPD_KOLONNER[felt]; for (var i = 0; i < navne.length; i++) if (flad[navne[i]] != null && String(flad[navne[i]]).trim() !== '') return flad[navne[i]]; return null; }
    var navn = String(f('navn') || '').trim(), e = String(f('enhed') || '').trim().toLowerCase().replace(/\.$/, '');
    if (!navn) return { grund: 'mangler navn' };
    var enhed = /^m(3|³)$/.test(e) ? 'm³' : /^m(2|²)$/.test(e) ? 'm²' : e === 'kg' ? 'kg' : /^(stk|pcs|piece|stykke)$/.test(e) ? 'stk' : /^(ton|t|tonne)$/.test(e) ? 'ton' : /^(m|lbm|meter)$/.test(e) ? 'm' : null;
    if (!enhed) return { navn: navn, grund: 'ukendt enhed «' + e + '» (m³, m², kg, ton eller stk)' };
    if (enhed === 'm') return { navn: navn, grund: 'løbende meter kan ikke bruges som egen EPD i ISSANA LCA (m³, m², kg eller stk)' };
    var g = { A1A3: talDk(f('A1A3')), C3: talDk(f('C3')), C4: talDk(f('C4')), D: talDk(f('D')) };
    if (g.A1A3 == null) return { navn: navn, grund: 'mangler A1-A3' };
    var omregnet = null;
    if (enhed === 'ton') { ['A1A3', 'C3', 'C4', 'D'].forEach(function (k) { if (g[k] != null) g[k] = g[k] / 1000; }); enhed = 'kg'; omregnet = 'omregnet fra pr. ton til pr. kg'; }
    var ver = noegleNavn(f('verificeret')), std = noegleNavn(f('en15804')), ind = noegleNavn(f('gwpIndikator')), typ = noegleNavn(f('type'));
    return { epd: { id: f('id') != null ? String(f('id')) : null, navn: navn, producent: f('producent') != null ? String(f('producent')).trim() : null, enhed: enhed, densitet: talDk(f('densitet')), gwp: g,
      registreringsnr: f('registreringsnr') != null ? String(f('registreringsnr')).trim() : null, programoperatoer: f('programoperatoer') != null ? String(f('programoperatoer')).trim() : null,
      url: f('url') != null ? String(f('url')).trim() : null, udstedt: datoIso(f('udstedt')), udloeb: datoIso(f('udloeb')),
      verificeret: /^(ja|yes|true|1|x)$/.test(ver) ? 'yes' : /^(nej|no|false|0)$/.test(ver) ? 'no' : 'unknown',
      en15804: /a2/.test(std) ? 'A2' : /a1/.test(std) ? 'A1' : 'unknown', gwpIndikator: /total/.test(ind) ? 'GWP-total' : /gwp/.test(ind) ? 'GWP' : 'unknown',
      type: /produkt|product/.test(typ) ? 'product' : /branche|branch|industry|sektor/.test(typ) ? 'branch' : /projekt|project/.test(typ) ? 'project' : 'unknown', omregnet: omregnet } };
  }
  // Tekst fra en fil eller adresse → {navn, epd:[…], sprunget:[{navn, grund}]} eller {fejl}.
  function laesEpdDatabase(tekst, navn) {
    var raa, dbNavn = navn || 'EPD-database', s = String(tekst || '').replace(/^﻿/, '').trim();
    if (!s) return { fejl: 'Filen er tom.' };
    if (s[0] === '{' || s[0] === '[') {
      var j; try { j = JSON.parse(s); } catch (e) { return { fejl: 'Filen er ikke gyldig JSON: ' + e.message }; }
      raa = Array.isArray(j) ? j : j.epd || j.epds || j.items || j.produkter || null;
      if (!Array.isArray(raa)) return { fejl: 'JSON-filen har ingen liste «epd» (format issana-epd/1).' };
      if (!Array.isArray(j) && j.navn) dbNavn = String(j.navn);
    } else {
      var rk = csvRaekker(s); if (rk.length < 2) return { fejl: 'CSV-filen har ingen rækker under overskriften.' };
      var hoved = rk[0]; raa = rk.slice(1).map(function (r) { var o = {}; hoved.forEach(function (h, i) { o[h] = r[i]; }); return o; });
    }
    var epd = [], sprunget = [];
    raa.forEach(function (x) { var n = epdNormaliser(x); if (n.epd) epd.push(n.epd); else sprunget.push({ navn: n.navn || null, grund: n.grund }); });
    if (!epd.length) return { fejl: 'Ingen brugbare EPD\'er i filen' + (sprunget.length ? ' (' + sprunget[0].grund + ')' : '') + '.', sprunget: sprunget };
    return { navn: dbNavn, epd: epd, sprunget: sprunget };
  }
  function epdDatabaser(lager) { try { var t = lager && lager.getItem(EPD_NOEGLE), v = t ? JSON.parse(t) : []; return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function gemEpdDatabaser(lager, liste) { try { lager.setItem(EPD_NOEGLE, JSON.stringify(liste)); return true; } catch (e) { return false; } }
  // En EPD fra en database → «Egen EPD»-formularens felter (samme form som motor.vaelgEpd {egenEpd}). «Dækker byggevaren» sætter brugeren.
  function epdTilEgen(x, idag) {
    return { kildeType: 'bruger-epd', navn: x.navn, enhed: x.enhed, densitet: x.densitet, gwp: { A1A3: x.gwp.A1A3, C3: x.gwp.C3, C4: x.gwp.C4, D: x.gwp.D },
      epd: { registreringsnr: x.registreringsnr, programoperatoer: x.programoperatoer, producent: x.producent, url: x.url, placering: null, verificeret: x.verificeret, en15804: x.en15804,
        gwpIndikator: x.gwpIndikator, type: x.type, udstedt: x.udstedt, udloeb: x.udloeb, anvendt: idag || null, scenarieC3: x.scenarieC3 || null, scenarieC4: x.scenarieC4 || null, daekker: false, dNul: x.dNul === true } };
  }
  function epdSoeg(dbs, q, max) {
    var ord = String(q || '').toLowerCase().split(/\s+/).filter(Boolean), ud = [];
    dbs.forEach(function (db, di) { (db.epd || []).forEach(function (x, ei) {
      var t = (x.navn + ' ' + (x.producent || '') + ' ' + (x.registreringsnr || '')).toLowerCase();
      if (ord.every(function (o) { return t.indexOf(o) >= 0; })) ud.push({ db: db, di: di, ei: ei, x: x });
    }); });
    return ud.slice(0, max || 25);
  }
  function dbBlokHtml(valg) {
    var dbs = valg.epdDatabaser || [];
    var h = '<div class="lcak-db" data-lca-db><b class="lcak-h4">EPD-databaser</b><div class="lcak-db-liste"><span class="lcak-db-post"><b>BR18 tabel 7 (2025)</b> · indbygget, versionslåst · generiske data</span>';
    h += dbs.map(function (db, i) {
      return '<span class="lcak-db-post"><b>' + esc(db.navn) + '</b> · ' + db.epd.length + ' EPD\'er · ' + (db.url ? 'koblet til ' + esc(db.url) : 'fil ' + esc(db.fil || '')) + (db.hentet ? ' · ' + esc(String(db.hentet).slice(0, 10)) : '') +
        (db.url ? ' <button class="tbtn" data-lca-db-opdater="' + i + '">Opdatér</button>' : '') + ' <button class="tbtn" data-lca-db-fjern="' + i + '">Fjern</button></span>';
    }).join('');
    var bib = valg.bibliotek;
    if (bib) h += '<span class="lcak-db-post" data-lca-bib><b>LCAbyg-bibliotek</b> · ' + bib.produkter.length + ' byggevarer · ' + bib.konstruktioner.length + ' opbygninger · ' + bib.filer.length + ' filer · kun på denne pc <button class="tbtn" data-lca-bib-toem>Tøm</button></span>';
    h += '</div>' + RAEKKE + '<button class="tbtn" data-lca-bib-fil>Tilføj LCAbyg-eksport</button><input type="file" multiple accept=".json,.lb5cstr,.lb5elm,.lb5prd,.lb5stg,.lb5,.lb5epd" data-lca-bib-input hidden><button class="tbtn" data-lca-db-fil>Tilføj EPD-database (JSON eller CSV)</button><input type="file" accept=".json,.csv,application/json,text/csv" data-lca-db-input hidden>' +
      '<label>Eller kobl til en adresse<input type="url" data-lca-db-url placeholder="https://…/epd.json" style="width:230px"></label><button class="tbtn" data-lca-db-kobl>Kobl til</button></div>';
    return h + '<small class="v3-hint">Kolonner: navn, producent, enhed (m³, m², kg, ton eller stk), A1A3, C3, C4, D, densitet, registreringsnr, programoperatoer, url, udstedt, udloeb, verificeret, en15804, gwpindikator, type. En EPD herfra bruges som byggevarens egen EPD.</small></div>';
  }
  function epdDbVaelgHtml(bv, valg) {
    var dbs = valg.alleEpdDb || valg.epdDatabaser || [], n = dbs.reduce(function (s, d) { return s + d.epd.length; }, 0);
    if (!dbs.length) return '<p class="v3-hint">Ingen EPD-databaser endnu. Tilføj en fil eller kobl til en adresse under «EPD-databaser» ovenfor.</p>';
    var q = valg.dbSoeg || '', hits = epdSoeg(dbs, q, 25);
    var h = '<div class="lcak-felter"><label>Søg i ' + n + ' EPD\'er (' + dbs.length + ' databaser)<input type="search" data-lca-db-soeg value="' + esc(q) + '" placeholder="fx beton, tegl, mineraluld" style="width:220px"></label></div>';
    h += hits.length ? hits.map(function (t) {
      var x = t.x;
      return '<div class="lcak-db-hit"><div><b>' + esc(x.navn) + '</b>' + (x.producent ? ' · ' + esc(x.producent) : '') + '<small class="lcak-u">' + esc(t.db.navn) + ' · A1-A3 ' + sig(x.gwp.A1A3, 5) + ' kg CO₂e/' + esc(x.enhed) +
        (x.registreringsnr ? ' · ' + esc(x.registreringsnr) : '') + (x.omregnet ? ' · ' + esc(x.omregnet) : '') + '</small></div><button class="tbtn" data-lca-db-brug="' + t.di + ':' + t.ei + '">Brug</button></div>';
    }).join('') : '<p class="v3-hint">Ingen EPD\'er matcher «' + esc(q) + '».</p>';
    return h;
  }

  /* ---------- LCA-rapport i Typst: analysen med formler og regneeksempler med modellens egne tal ---------- */
  // b/o: ISSANA LCA's tal (motor.tabel().b og motor.sidste().oversigt); rapporten regner ingen CO₂ selv. R: rapport-typst.js.
  // info: {projekt, dato, bygningstype}. valg: bygningsdeleKatalog. Eksemplerne tager den byggevare, der vejer mest i resultatet.
  function lcaRapportTypst(b, o, info, R, valg) {
    info = info || {}; o = o || {}; valg = valg || {};
    var alle = []; (b.dele || []).forEach(function (d) { d.konstruktioner.forEach(function (k) { k.byggevarer.forEach(function (x) { alle.push({ d: d, k: k, bv: x }); }); }); });
    var regnede = alle.filter(function (a) { return a.bv.regnet && a.bv.moduler && a.bv.datasaet && a.bv.maengde != null; });
    function stoerst(l) { return l.slice().sort(function (x, y) { return (y.bv.kg || 0) - (x.bv.kg || 0); })[0] || null; }
    var ex = stoerst(regnede.filter(function (a) { return a.k.maengde > 0 && a.bv.datasaet.a1a3 != null; })), exB4 = stoerst(regnede.filter(function (a) { return a.bv.udskiftninger > 0 && a.bv.datasaet.a1a3 != null; }));
    var forslag = regnede.filter(function (a) { return (a.bv.ref || {}).valg === 'forslag'; }).length, mt = R.mt, t = '';
    function kgT(n) { return typeof n === 'number' && isFinite(n) ? R.tal(n, Math.abs(n) >= 100 ? 0 : 1) : '–'; }
    // 1. Resultat
    t += R.overskrift('Resultat', 1);
    t += R.tabel({ kolonner: ['Størrelse', 'Resultat', 'BR18-grænse'], justering: ['left', 'right', 'right'], raekker: [
      ['Bygningen (A1-A3 + B4 + B6 + C3 + C4), kg CO₂e/m²/år', R.tal(o.total, 2), o.graense != null ? R.tal(o.graense, 1) : '–'],
      ['Byggeproces (A4 + A5), kg CO₂e/m²/år', o.proces && o.proces.total != null ? R.tal(o.proces.total, 2) : '–', o.proces && o.proces.graense != null ? R.tal(o.proces.graense, 1) : '1,5'],
      ['Materialer og installationer, kg CO₂e', kgT(b.materialer && b.materialer.kg), ''], ['B6 driftsenergi, kg CO₂e', kgT(b.b6 && b.b6.kg), ''], ['Referenceareal, m²', R.tal(b.areal, 1), ''] ] });
    t += R.afsnit('Status: ' + (o.statusTekst || 'ikke oplyst') + '.' + (o.daekning ? ' Tallet dækker ' + o.daekning.regnet + ' af ' + o.daekning.byggevarer + ' byggevarer' + (o.daekning.installationer ? ' plus installationer efter BR18 tabel 7' : '') + '.' : ''));
    if (forslag) t += R.note(forslag + ' byggevarer er regnet med forslag fra BR18 tabel 7, som endnu ikke er bekræftet. Resultatet er derfor et udkast.');
    // 2. Sådan regnes det, med modellens egne tal
    t += R.overskrift('Sådan regnes det', 1);
    t += R.afsnit('En byggevares klimapåvirkning er dens mængde gange EPD\'ens tal for hver fase. Mængden er konstruktionens mængde fra Revit gange en omregningsfaktor. Eksemplerne bruger den byggevare, der vejer mest i resultatet. Alle kg er beregnet af ISSANA LCA.');
    if (ex) {
      var bv = ex.bv, k = ex.k, ds = bv.datasaet, m = bv.moduler, g = ((bv.ref || {}).post || {}).gwp || {}, ue = enh(bv.enhed), uk = enh(k.enhed), f = bv.maengde / k.maengde, q = bv.maengde;
      var c3 = g.C3 != null ? g.C3 : m.C3 / q, c4 = g.C4 != null ? g.C4 : m.C4 / q;
      t += R.afsnit('Eksempel: ' + bv.navn + ' i ' + k.navn + ' (' + ex.d.navn + '), datasæt ' + ds.key + ' ' + (ds.navn || '') + '.');
      t += R.regneeksempel({ titel: 'Byggevarens mængde', hvorfor: 'Revit giver konstruktionens mængde. Omregningsfaktoren siger, hvor meget byggevare der er pr. enhed konstruktion.', formel: 'q = Q_k dot f',
        symboler: [['q', 'byggevarens samlede mængde (' + ue + ')'], ['Q_k', 'konstruktionens mængde fra Revit (' + uk + ')'], ['f', 'omregningsfaktor (' + ue + '/' + uk + ')']],
        indsat: mt(k.maengde, 6) + ' dot ' + mt(f, 5), resultat: mt(q, 5) + ' ' + R.mtekst(ue), kilde: (bv.maengdeKilde || 'Revit via ISSANA 3D') }, 2);
      t += R.regneeksempel({ titel: 'Produktion (A1-A3)', hvorfor: 'Udledningen ved at fremstille byggevaren.', formel: 'E_"A1-A3" = q dot e_"A1-A3"', symboler: [['e_"A1-A3"', 'EPD\'ens tal (kg CO₂e/' + enh(ds.enhed) + ')']],
        indsat: mt(q, 5) + ' dot ' + mt(ds.a1a3, 6), resultat: mt(m['A1-A3'], 6) + ' "kg CO₂e"', kilde: ds.key + ' ' + (ds.navn || '') }, 2);
      t += R.regneeksempel({ titel: 'Affaldsbehandling og bortskaffelse (C3 og C4)', hvorfor: 'Udledningen, når byggevaren er udtjent.', formel: 'E_"C3" = q dot e_"C3", quad E_"C4" = q dot e_"C4"',
        indsat: 'E_"C3" = ' + mt(q, 5) + ' dot ' + mt(c3, 4) + ' = ' + mt(m.C3, 5) + ', quad E_"C4" = ' + mt(q, 5) + ' dot ' + mt(c4, 4), resultat: mt(m.C4, 5) + ' "kg CO₂e"' }, 2);
    }
    var e4 = exB4 || ex;
    if (e4) {
      var mb = e4.bv.moduler, n = e4.bv.udskiftninger, L = e4.bv.levetid;
      t += R.regneeksempel({ titel: 'Udskiftninger (B4)', hvorfor: 'En byggevare med kortere levetid end 50 år skiftes i løbet af perioden. Hver udskiftning tæller som ny produktion plus bortskaffelse af den gamle.' + (exB4 ? ' Eksempel: ' + e4.bv.navn + '.' : ' Den byggevare i eksemplet holder i hele perioden, så der er ingen udskiftninger.'),
        formel: 'n = ceil(T / L) - 1, quad E_"B4" = n dot (E_"A1-A3" + E_"C3" + E_"C4")', symboler: [['T', 'beregningsperioden, 50 år'], ['L', 'levetid (' + (L != null ? R.tal(L, 0) + ' år' : 'ukendt') + ')'], ['n', 'antal udskiftninger']],
        indsat: 'n = ' + n + ', quad E_"B4" = ' + n + ' dot (' + mt(mb['A1-A3'], 5) + ' + ' + mt(mb.C3, 5) + ' + ' + mt(mb.C4, 5) + ')', resultat: mt(mb.B4, 5) + ' "kg CO₂e"', kilde: e4.bv.levetidKilde || 'BUILD levetidstabel 2021' }, 2);
    }
    if (b.materialer && b.materialer.kg != null && b.areal) t += R.regneeksempel({ titel: 'Bygningens resultat', hvorfor: 'Summen af alle byggevarer, installationer og driftsenergi fordeles på referencearealet og 50 år og sammenholdes med grænsen i BR18 § 297.',
      formel: 'I = (sum E + E_"B6") / (A dot T)', symboler: [['sum E', 'A1-A3 + B4 + C3 + C4 for materialer og installationer'], ['E_"B6"', 'driftsenergi'], ['A', 'referenceareal (m²)'], ['T', '50 år']],
      indsat: '(' + mt(b.materialer.kg, 7) + ' + ' + mt((b.b6 && b.b6.kg) || 0, 6) + ') / (' + mt(b.areal, 6) + ' dot "50")', resultat: mt(o.total, 3) + ' "kg CO₂e/m²/år"', kilde: 'BR18 § 297' }, 2);
    t += R.afsnit('Modul D (genanvendelse uden for systemet) vises for hver byggevare, men indgår ikke i resultatet.');
    // 3. Omregningsfaktorer
    t += R.overskrift('Omregningsfaktorer', 1);
    t += R.afsnit('Omregningsfaktoren er byggevarens mængde pr. enhed af konstruktionen. Den regnes efter byggevarens opbygning og EPD\'ens enhed.');
    t += R.tabel({ kolonner: ['Enhed', 'Bruges til', 'Formel'], raekker: [['m³/m²', 'Homogent lag', 'tykkelse (m)'], ['kg/m²', 'Homogent lag, EPD pr. kg', 'tykkelse (m) × densitet (kg/m³)'], ['m²/m²', 'Plader, membraner, EPD pr. m²', '1'], ['m³/m', 'Bjælker, søjler', 'bredde (m) × højde (m)'], ['kg/m', 'Bjælker, EPD pr. kg', 'bredde × højde × densitet'], ['m/m²', 'Lægter som løbende meter', '1000 ÷ c-c (mm)'], ['× arealandel', 'Gentaget lag (lægter, stolper)', 'bredde ÷ c-c'], ['× arealandel', 'Mellemrum (isolering mellem stolper)', '(c-c − bredde) ÷ c-c']] });
    alle.filter(function (a) { return a.bv.ref && a.bv.ref.maengde && a.bv.ref.maengde.faktor != null; }).forEach(function (a) { t += R.afsnit('Rettet af brugeren: ' + a.bv.navn + '. ' + (a.bv.ref.maengde.kilde || '')); });
    // 4. Bygningsdele (LCAbygs 17)
    t += R.overskrift('Bygningsdele', 1);
    var liste = delListe(b, valg), sum = (b.materialer && b.materialer.kg) || 0, rk = [];
    liste.forEach(function (d) {
      if (!d.konstruktioner.length) { rk.push([d.navn, '', 'intet i modellen', '–', '–']); return; }
      d.konstruktioner.forEach(function (k, i) { var kg0 = kSum(k); rk.push([i ? '' : d.navn, k.inst ? 'BR18 tabel 7' : k.underkategori || '', k.navn, kgT(kg0), kg0 != null && sum ? R.tal(kg0 / sum * 100, 1) + ' %' : '–']); });
    });
    t += R.tabel({ kolonner: ['Bygningsdel', 'Underkategori', 'Konstruktion', 'kg CO₂e', 'Andel'], justering: ['left', 'left', 'left', 'right', 'right'], raekker: rk });
    // 5. Byggevarer
    t += R.overskrift('Byggevarer', 1);
    (b.dele || []).forEach(function (d) {
      var rs = []; d.konstruktioner.forEach(function (k) { k.byggevarer.forEach(function (x) { var mo = x.moduler || {}; rs.push([x.navn, x.datasaet ? x.datasaet.key : 'mangler', x.maengde != null ? R.sig(x.maengde, 4) + ' ' + enh(x.enhed) : '–', x.levetid != null ? R.tal(x.levetid, 0) + ' år' : '–', kgT(mo['A1-A3']), kgT(mo.B4), kgT(x.moduler ? (mo.C3 || 0) + (mo.C4 || 0) : null), kgT(x.kg)]); }); });
      if (!rs.length) return;
      t += R.overskrift(d.navn, 2) + R.tabel({ kolonner: ['Byggevare', 'Datasæt', 'Mængde', 'Levetid', 'A1-A3', 'B4', 'C3 + C4', 'I alt'], justering: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'], raekker: rs });
    });
    // 6. Mangler
    var gr = o.grupper || [];
    if (gr.length) { t += R.overskrift('Det mangler', 1) + R.punkter(gr.map(function (g) { return g.titel + ': ' + g.antal; })); }
    return R.dokument({ titel: 'LCA-rapport', undertitel: 'Klimapåvirkning efter BR18 § 297 med formler og regneeksempler', projekt: info.projekt || '', dato: info.dato || '', tekst: t,
      kilder: ['Bygningsreglementet (BR18) § 297 og § 298 og bilag 2, tabel 7 og 8', 'Vejledning om bygningers klimapåvirkning', 'BUILD levetidstabel version 2021 (BUILD rapport 2021:32)', 'DS/EN 15804 og DS/EN 15978', 'Beregnet af ISSANA LCA. Mængder fra Revit via ISSANA 3D.'] });
  }

  /* ---------- Tre arbejdstrin + bibliotek. Beregningsmotor og gemte valg er uændrede. ---------- */
  var FANER = [['bygning', '1 Bygning', '1 · Bygning og drift'], ['model', '2 Model', '2 · Bygningsmodel'], ['analyse', '3 Analyse', '3 · Analyse og rapport'], ['bibliotek', 'Bibliotek', 'Bibliotek']];
  function trinMangler(g, o, b, valg) {
    g = g || {}; var et = 0;
    if (!g.bygningstype) et++;
    if (!(g.referenceareal && g.referenceareal.m2 > 0)) et++;
    if (!(g.b6 && g.b6.kilde)) et++;
    var grupper = ((o && o.grupper) || []).filter(function (x) { return ['b6', 'proces', 'bygning', 'bekraeft'].indexOf(x.id) < 0; });
    var to = grupper.length ? grupper.reduce(function (n, x) { return n + (x.antal || 0); }, 0) : udenDataAntal(o, b, valg || {});
    return { bygning: et, model: to };
  }
  // Status er synlig på alle trin. Mangeltallet er en rigtig knap, som åbner den fælles mangelliste.
  function toppenHtml(t, o, fane, g, b, valg) {
    var m = trinMangler(g, o, b, valg), mangler = m.bygning + m.model, forslag = valg && valg.epdForslag || 0;
    var klima = o && o.total != null ? tal(o.total, 2) + ' / ' + tal(o.graense, 1) : 'Ikke beregnet';
    var proces = o && o.proces && o.proces.total != null ? tal(o.proces.total, 2) + ' / ' + tal(o.proces.graense != null ? o.proces.graense : 1.5, 1) : 'Ikke beregnet';
    var status = forslag ? forslag + ' forslag venter · ' + udenDataAntal(o, b, valg || {}) + ' uden data' : mangler ? 'Foreløbigt · ' + mangler + ' mangler' : o ? 'Endeligt' : 'Foreløbigt';
    function navn(f) { var n = f[1], c = f[0] === 'bygning' ? m.bygning : f[0] === 'model' ? m.model : 0; return n + (c > 0 ? ' (' + c + ')' : ''); }
    var aaben = !!(valg && valg.visStatusMangler);
    return '<div class="lcak-top"><div class="lcak-top-main"><div class="lcak-faner" role="tablist" aria-label="LCA-arbejdstrin">' + FANER.map(function (f) { return '<button role="tab" data-lca-fane="' + f[0] + '" aria-selected="' + (fane === f[0]) + '" aria-label="' + esc(f[2]) + '" title="' + esc(f[2]) + '">' + navn(f) + '</button>'; }).join('') + '</div><div class="lcak-top-action">' + knapperHtml(t) + '</div></div>' +
      '<div class="lcak-top-status" aria-label="LCA-status"><span><b>Klima</b> ' + esc(klima) + '</span><button class="lca-tekstlink" data-lca-status-mangler aria-expanded="' + aaben + '">' + (aaben ? 'Skjul' : 'Vis') + ' · ' + esc(status) + '</button><span><b>Proces</b> ' + esc(proces) + '</span></div></div>';
  }
  function panel(id, fane, indhold) { return '<div class="lcak-pane" data-lca-pane="' + id + '"' + (id === fane ? '' : ' hidden') + '>' + indhold + '</div>'; }
  // Spild og transport: byggeprocessen for sig (A4 + A5, egen grænse), byggepladsens forbrug og Rusts linjer, grupperet.
  function spildTransportHtml(g, b, o) {
    var h = '<h3>Spild og transport (A4 + A5)</h3><p class="v3-hint">Transport til byggepladsen regnes automatisk. Byggepladsens forbrug udfylder du her, når du kender det.</p>';
    if (o && o.proces && o.proces.total != null) h += '<div class="lca-tote"><div class="lca-card lca-proces-resultat"><div class="v">' + tal(o.proces.total, 2) + '</div><div class="k">kg CO₂e/m²/år · grænse ' + tal(o.proces.graense != null ? o.proces.graense : 1.5, 1) + '</div></div>' +
      (b && b.proces ? '<div class="lca-card"><div class="v">' + kgKort(b.proces.a4) + '</div><div class="k">A4 transport, kg CO₂e</div></div><div class="lca-card"><div class="v">' + kgKort(b.proces.a5) + '</div><div class="k">A5 byggeplads, kg CO₂e</div></div>' : '') + '</div>';
    if (o && o.proces) h += procesStatusHtml(o.proces);
    h += '<h3>Byggepladsen (A5)</h3>' + byggepladsHtml(g);
    var ls = (b && b.procesLinjer) || [];
    if (ls.length) {
      var grupper = [], efter = {};
      ls.forEach(function (l) { var k = l.kategori || l.modul || 'Øvrige'; if (!efter[k]) { efter[k] = []; grupper.push(k); } efter[k].push(l); });
      h += '<h3>Sådan er A4 og A5 regnet</h3>' + grupper.map(function (k) {
        var sum = efter[k].reduce(function (s, l) { return s + (l.kg || 0); }, 0);
        return '<details class="lca-mangelgruppe" data-lca-proces><summary><b>' + esc(k) + '</b><span>' + efter[k].length + ' byggevarer</span><strong>' + kgKort(sum) + ' kg CO₂e</strong></summary><table class="lca lcak-tabel"><thead><tr><th>Linje</th><th>Kilde</th><th class="n">kg CO₂e</th></tr></thead><tbody>' +
          efter[k].slice().sort(function (x, y) { return (y.kg || 0) - (x.kg || 0); }).map(function (l) { return '<tr><td>' + esc(l.navn) + '</td><td><small class="v3-hint">' + esc(l.kilde || '') + '</small></td><td class="n">' + kgKort(l.kg) + '</td></tr>'; }).join('') + '</tbody></table></details>';
      }).join('');
    }
    return h + '<details class="lca-om"><summary>Om transport og byggeplads</summary><p class="v3-hint">Transport, faste satser, overskud, emballage og tomme byggepladsfelter følger de indbyggede BR18-satser.</p></details>';
  }
  function procesStatusHtml(proces) {
    if (proces.overholdt === true) return '<p class="lca-proces-besked">Under grænsen ✓</p>';
    if (proces.overholdt === false) return '<p class="lca-proces-besked issana-mangler">Over grænsen</p>';
    if (!proces.grund) return '';
    var link = proces.produktId ? ' <button class="lca-tekstlink" data-lca-vis-produkt="' + esc(proces.produktId) + '">Vis byggevaren</button>' : '';
    return '<p class="lca-proces-besked issana-mangler">Kan ikke vurderes endnu: ' + esc(proces.grund) + link + '</p>';
  }
  // Rapport: visning og print af samme rapport som Typst-filen (R.html er samme byggeklodser som HTML).
  function rapportFaneHtml(tv, o, info, R) {
    var h = '<p class="v3-hint">Analysen med formler og regneeksempler med modellens egne tal. Print den (også som PDF), eller gem Typst-filen til ISSANA Compose.</p>';
    if (!o || !tv.beregning || !tv.regnet) return h + '<p class="v3-hint">Tryk «Beregn med ISSANA LCA» først.</p>';
    if (tv.omfang && !tv.omfang.alle) return h + '<p class="v3-hint">Rapporten gælder hele bygningen. Vælg «Hele bygningen» under Bygningsmodel.</p>';
    if (!R || !R.html) return h + '<p class="issana-mangler">Rapportmodulet er ikke indlæst (rapport-typst.js).</p>';
    return h + RAEKKE + '<button class="tbtn primary" data-lca-rapport-print>Print eller gem som PDF</button><button class="tbtn" data-lca-rapport>Gem Typst-fil</button></div><details class="lca-rapport-fold"><summary>Vis rapport</summary><style>' + R.html.CSS + '</style><div class="lcak-rapport" data-lca-rapport-visning>' + lcaRapportTypst(tv.beregning, o, info, R.html, tv) + '</div></details>';
  }

  function naesteTrinHtml(id, tekst) { return '<div class="lca-trin-naeste"><button class="tbtn primary" data-lca-fane="' + id + '">' + esc(tekst) + '</button></div>'; }
  function statusManglerHtml(g, o, b, valg) {
    var h = '<section class="lca-status-mangler" aria-label="Det mangler"><h3>Det mangler</h3>', nogen = false;
    g = g || {};
    var grund = [];
    if (!g.bygningstype) grund.push('Vælg bygningstype');
    if (!(g.referenceareal && g.referenceareal.m2 > 0)) grund.push('Angiv referenceareal');
    if (!(g.b6 && g.b6.kilde)) grund.push('Angiv kilde til drift');
    if (grund.length) { h += '<div class="lca-status-gruppe"><b>Bygning og drift · ' + grund.length + '</b><ul>' + grund.map(function (x) { return '<li><span>' + x + '</span><button class="tbtn" data-lca-udfyld-bygning>Gå til trin 1</button></li>'; }).join('') + '</ul></div>'; nogen = true; }
    ((o && o.grupper) || []).forEach(function (gruppe) {
      if (gruppe.id === 'bekraeft') return;
      var alle = samletMangler(gruppe.mangler || []), visAlle = valg && valg.statusVisAlle && valg.statusVisAlle[gruppe.id], viste = visAlle ? alle : alle.slice(0, 5);
      if (!alle.length) return;
      var antalTekst = gruppe.id === 'miljoedata' ? (gruppe.antal || 0) + ' byggevarer · ' + alle.length + ' materialer' : String(gruppe.antal || alle.length);
      h += '<div class="lca-status-gruppe" data-lca-status-gruppe="' + esc(gruppe.id) + '"><b>' + esc(gruppe.titel || gruppe.id) + ' · ' + antalTekst + '</b><ul>' + viste.map(function (r) {
        var m = r.poster[0], pid = m.id || m.target_id, hit = pid && b && modelValgForMangel(b, valg || {}, pid), kon = hit && hit.k && hit.k.navn;
        return '<li><span><b>' + esc(r.navn) + '</b>' + (kon ? '<small>' + esc(kon) + '</small>' : '') + '</span><button class="tbtn" data-lca-vis-mangel="' + esc(gruppe.id) + '">Løs i trin 2</button></li>';
      }).join('') + '</ul>' + (alle.length > 5 ? '<button class="lca-tekstlink" data-lca-status-vis-alle="' + esc(gruppe.id) + '">' + (visAlle ? 'Vis færre' : 'Vis alle (' + alle.length + ')') + '</button>' : '') + '</div>'; nogen = true;
    });
    if (!nogen && b && manglendeByggevarer(b, valg || {}).length) { h += '<div class="lca-status-gruppe"><b>Miljødata</b><ul><li><span>Byggevarer mangler miljødata</span><button class="tbtn" data-lca-vaelg-data>Gå til trin 2</button></li></ul></div>'; nogen = true; }
    return h + (nogen ? '' : '<p>Intet mangler.</p>') + '</section>';
  }
  function bygningTrinHtml(g, forslag, t, b, o) {
    return '<section class="lca-trin"><header><p class="lca-trin-nr">Trin 1</p><h2>Bygning og drift</h2><p>Fastlæg projektets grundlag, drift og byggeplads. Transport til byggepladsen beregnes af ISSANA LCA.</p></header>' +
      opsaetningHtml(g, forslag, Object.assign({}, t, { udenKnapper: true, udenA5: true, harResultat: !!o })) +
      '<section class="lca-trin-kort"><h3>Byggeplads og transport</h3>' + spildTransportHtml(g, b, o) + '</section>' +
      naesteTrinHtml('model', 'Fortsæt til 2 · Bygningsmodel') + '</section>';
  }
  function produktSpildHtml(b) {
    var ls = ((b && b.procesLinjer) || []).filter(function (x) { return /spild|affald|overskud|emballage/i.test((x.kategori || '') + ' ' + (x.navn || '')); });
    return '<details class="lca-produkt-spild"><summary>Vis mere · produktspild</summary>' + (ls.length ? '<table class="lca lcak-tabel"><thead><tr><th>Produkt</th><th>Kilde</th><th class="n">kg CO₂e</th></tr></thead><tbody>' + ls.map(function (x) { return '<tr><td>' + esc(x.navn) + '</td><td>' + esc(x.kilde || '') + '</td><td class="n">' + kgKort(x.kg) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="v3-hint">Der er ingen særskilte produktspildslinjer i den seneste beregning.</p>') + '</details>';
  }
  function analysePoster(b, niveau) {
    var a = b && b.areal > 0 ? b.areal * 50 : null, ud = [];
    if (!b) return ud;
    if (niveau === 'dele') return (b.dele || []).map(function (d) { return { id: d.id, navn: d.navn, rate: d.prM2, art: 'del' }; }).filter(function (x) { return x.rate != null; });
    (b.dele || []).forEach(function (d) { (d.konstruktioner || []).forEach(function (k) {
      var kg = kSum(k);
      if (niveau === 'konstruktioner') ud.push({ id: k.id, navn: k.navn, rate: kg != null && a ? kg / a : null, art: 'konstruktion' });
      else (k.byggevarer || []).forEach(function (p) { ud.push({ id: p.id, navn: p.navn, undertekst: k.navn, rate: p.kg != null && a ? p.kg / a : null, art: 'produkt' }); });
    }); });
    return ud.filter(function (x) { return x.rate != null; });
  }
  function analyseDiagramHtml(b, niveau) {
    var poster = analysePoster(b, niveau).sort(function (x, y) { return y.rate - x.rate; }), max = poster.length ? poster[0].rate : 0;
    var labels = { dele: 'Bygningsdele', konstruktioner: 'Konstruktioner', produkter: 'Produkter' };
    var h = '<section class="lca-sektion lca-analyse"><div class="lca-sektion-hoved"><h3>Hvad fylder mest</h3><span>kg CO₂e/m²/år</span></div><div class="lca-analyse-skift" role="group" aria-label="Vis analysen efter">' + ['dele', 'konstruktioner', 'produkter'].map(function (x) { return '<button data-lca-analyse-niveau="' + x + '" aria-pressed="' + (x === niveau) + '">' + labels[x] + '</button>'; }).join('') + '</div>';
    if (!poster.length) return h + '<p class="lca-tom">Beregn modellen og udfyld manglende miljødata for at se analysen.</p></section>';
    h += '<div class="lca-analyse-bars">' + poster.slice(0, 12).map(function (x) { return '<div><span><b>' + esc(x.navn) + '</b>' + (x.undertekst ? '<small>' + esc(x.undertekst) + '</small>' : '') + '</span><i><b style="width:' + (max > 0 ? x.rate / max * 100 : 0).toFixed(1) + '%"></b></i><strong>' + tal(x.rate, 3) + '</strong></div>'; }).join('') + '</div></section>';
    return h;
  }
  function topKonstruktionerHtml(b) {
    var top = analysePoster(b, 'konstruktioner').sort(function (x, y) { return y.rate - x.rate; }).slice(0, 5);
    return '<section class="lca-sektion"><h3>Top 5 konstruktioner</h3>' + (top.length ? '<ol class="lca-top-fem">' + top.map(function (x) { return '<li><button class="lca-tekstlink" data-lca-analyse-kon="' + esc(x.id) + '">' + esc(x.navn) + '</button><b>' + tal(x.rate, 3) + '</b></li>'; }).join('') + '</ol>' : '<p class="lca-tom">Ingen beregnede konstruktioner endnu.</p>') + '</section>';
  }
  function analyseTabelHtml(o, b) {
    var r = analysePoster(b, 'konstruktioner').sort(function (x, y) { return y.rate - x.rate; });
    return '<details class="lca-analyse-tabel"><summary>Tallene bag diagrammet</summary><button class="tbtn" data-lca-kopier-analyse>Kopiér</button><table class="lca"><thead><tr><th>Konstruktion</th><th class="n">kg CO₂e/m²/år</th></tr></thead><tbody>' + r.map(function (x) { return '<tr><td>' + esc(x.navn) + '</td><td class="n">' + tal(x.rate, 5) + '</td></tr>'; }).join('') + '</tbody></table></details>';
  }
  function analyseTrinHtml(tv, o, ud, info, R, niveau) {
    var b = tv && tv.beregning, foreloebig = !o || o.overholdt == null || (o.daekning && o.daekning.regnet < o.daekning.byggevarer);
    var h = '<section class="lca-trin"><header><p class="lca-trin-nr">Trin 3</p><h2>Analyse og rapport</h2><p>Resultaterne kommer fra ISSANA LCA. Udfyld manglerne, før rapporten bruges som endelig dokumentation.</p></header>';
    h += resultatHtml(o, ud, Object.assign({}, tv, { iFane: true, analyseTrin: true, handling: null }));
    h += analyseDiagramHtml(b, niveau || 'dele') + faserOverblikHtml(o).replace('<h3>Faser</h3>', '<h3>Hvor i livsforløbet</h3>') + topKonstruktionerHtml(b) + analyseTabelHtml(o, b);
    h += '<section class="lca-trin-kort"><h3>Rapport</h3>' + (foreloebig ? '<p class="issana-mangler"><b>Foreløbig rapport</b> · der er stadig mangler.</p>' : '<p><b>Endelig rapport</b></p>') + rapportFaneHtml(tv, o, info, R) + '</section>';
    return h + '</section>';
  }

  function kolonnerHtml(b, valg) {
    valg = valg || {};
    var udsnit = valg.omfang && !valg.omfang.alle ? (valg.udsnit || {}) : null;
    var h = '<section data-lca-beregning data-lca-kolonner><div class="lcak-model-hoved"><div><p class="lca-trin-nr">Trin 2</p><h2>Bygningsmodel</h2><p class="v3-hint">Vælg en bygningsdel, så en konstruktion, så et produkt. Lagene står udefra mod indefra.</p></div>' + omfangVaelger(valg) + '</div>';
    h += statusLinjer(valg) + '<p class="lcak-kildelinje">Kilde: BR18 tabel 7 (2025) · <button class="lca-tekstlink" data-lca-fane="bibliotek">Skift kilde</button></p>';
    h += '<aside class="lca-ai-hjaelp"><b>ISSANA AI</b><p>' + (valg.aiTilgaengelig ? 'AI kan foreslå miljødata. Intet gemmes, før du vælger Bekræft eller Brug alle steder.' : 'Ingen AI-forbindelse eller nøgle er tilgængelig. Trinnet er fuldt manuelt: vælg datasæt og mængdekilde herunder.') + ' Revit ændres ikke automatisk.</p></aside>';
    if (valg.venter) return h + '</section>';
    if (!b || !(b.dele || []).length) return h + '<p class="v3-hint">Ingen byggevarer i modellen.</p></section>';
    var v = kolonneValg(b, valg);
    v.bvFilter = valg.bvFilter || 'alle';
    v.mangler = manglendeByggevarer(b, valg);
    v.udenDataAntal = valg.udenDataAntal == null ? v.mangler.length : valg.udenDataAntal;
    v.visTommeDele = !!valg.visTommeDele;
    var kanGemme = v.k && !v.k.inst && v.k.byggevarer.length && v.k.byggevarer.every(function (x) { return x.regnet && epdStatus(x)[0] === 'ok'; });
    v.mobileKol = valg.mobileKol == null ? 0 : valg.mobileKol;
    h += '<div class="lcak-flade lcak-vis-' + v.mobileKol + '">' + navHtml(b, v) + detaljeHtml(v, valg) + '</div>';
    if (kanGemme) h += '<div class="lcak-gem-opb"><button class="tbtn" data-lca-gem-opb>Gem «' + esc(v.k.navn) + '» i biblioteket</button>' +
      (valg.opbGemt ? '<span>Gemt under Mine opbygninger ✓ · <button class="lca-tekstlink" data-lca-fane="bibliotek">Vis i Bibliotek</button></span>' : '') + '</div>';
    h += kaedeHtml(v, valg.mobileKol !== 3);
    h += udsnit ? udsnitHtml(udsnit, valg) : valg.iFane ? '' : summeringHtml(b);
    var tv = Object.assign({}, valg, { indlejret: true }); if (valg.retKilde === 'kolonner') tv.ret = null;
    h += produktSpildHtml(b) + '<details data-lca-tabel-ud' + (valg.tabelAaben ? ' open' : '') + '><summary>Alle byggevarer i én tabel</summary>' + beregningTabelHtml(b, tv) + '</details>';
    h += naesteTrinHtml('analyse', 'Fortsæt til 3 · Analyse og rapport');
    return h + '</section>';
  }
  // Et udsnit: kg CO₂e og andel af hele bygningen (begge Rusts tal). Grænse og kg/m²/år gælder kun hele bygningen.
  function udsnitHtml(u, valg) {
    var andel = u.kg != null && u.helKg ? Math.round(u.kg / u.helKg * 1000) / 10 : null;
    return '<p data-lca-udsnit><b>' + esc(omfangTekst(valg.omfang, valg.omfangNavn)) + '</b>' + (u.antalElementer ? ' (' + u.antalElementer + ' elementer)' : '') + ': ' +
      (u.kg != null ? kgTxt(u.kg) + ' CO₂e (A1-A3 + B4 + C3 + C4)' : 'ikke regnet') + (andel != null ? ' = ' + tal(andel, 1) + ' % af hele bygningens ' + kgTxt(u.helKg) + ' (inkl. installationer)' : '') + '.</p>' +
      '<p class="v3-hint">Udsnittet er regnet af ISSANA LCA for netop disse elementer, uden installationer, B6 og byggeplads. BR18-grænsen og kg CO₂e/m²/år gælder kun hele bygningen.</p>';
  }
  function summeringHtml(b) {
    var a = b.areal, aTxt = a != null ? tal(a, 1) + ' m² × 50 år' : 'referenceareal × 50 år';
    var h = '<table class="lca lca-summering"><tbody>';
    h += '<tr><td>Materialer A1-A3 + B4 + C3 + C4' + (b.installationer != null ? ' (heraf installationer ' + kgTxt(b.installationer) + ')' : '') + '</td><td class="n">' + kgTxt(b.materialer.kg) + ' ÷ (' + aTxt + ')</td><td class="n">' + tal(b.materialer.rate, 3) + '</td></tr>';
    h += '<tr><td>B6 driftsenergi</td><td class="n">' + (b.b6.kg != null ? kgTxt(b.b6.kg) : '—') + ' ÷ (' + (b.opvarmet ? tal(b.opvarmet, 1) + ' m² opvarmet' : 'opvarmet areal') + ' × 50 år)</td><td class="n">' + tal(b.b6.rate, 3) + '</td></tr>';
    h += '<tr><td><b>Bygning (BR18 § 297)</b></td><td class="n">materialer + B6</td><td class="n"><b>' + tal(b.bygning, 3) + '</b></td></tr>';
    h += '<tr><td>Byggeproces A4 + A5 (egen grænse 1,5)</td><td class="n">' + (b.proces.kg != null ? kgTxt(b.proces.kg) : '—') + ' ÷ (' + aTxt + ')</td><td class="n">' + tal(b.proces.rate, 3) + '</td></tr>';
    return h + '</tbody></table><p class="v3-hint">Enhed i højre kolonne: kg CO₂e/m²/år. D vises særskilt og indgår ikke.</p>';
  }

  /* ---------- LCAbyg-import (kun læsning) ---------- */
  // imp: Rusts import-model-svar (kind issana_lca_import_suggestion)
  function importHtml(imp, navn) {
    if (!imp) return '';
    var bm = imp.building_model || {}, parts = bm.parts || [], kons = bm.constructions || [], prods = bm.products || [];
    var h = '<h3>LCAbyg-kilde: ' + esc(navn || imp.file) + ' (kun læsning)</h3><p class="v3-hint">Læst af ISSANA LCA (import-model): ' + parts.length + ' bygningsdele, ' + kons.length + ' konstruktioner, ' + prods.length + ' byggevarer. Status: ' + esc(imp.status) + '. Brug filen som kilde i ISSANA LCA for at arbejde videre med den.</p>';
    h += '<table class="lca"><thead><tr><th>Bygningsdel</th><th class="n">Konstruktioner</th><th class="n">Byggevarer</th></tr></thead><tbody>';
    h += parts.map(function (p) { var ks = kons.filter(function (k) { return k.part_id === p.id; }), kid = {}; ks.forEach(function (k) { kid[k.id] = 1; }); return '<tr><td>' + esc(p.name) + '</td><td class="n">' + ks.length + '</td><td class="n">' + prods.filter(function (x) { return kid[x.construction_id]; }).length + '</td></tr>'; }).join('');
    return h + '</tbody></table>';
  }

  /* ---------- Samlet bibliotek: lokale LCAbyg-opbygninger, BR18 tabel 7 og EPD-databaser ---------- */
  function enhedMedVed(enhed) {
    return String(enhed || '').replace(/\s+with\s+R\s*=\s*(.+)$/i, ' (ved R = $1)');
  }
  function egenOpbygningHtml(k, opb, valg) {
    var sum = opb ? opb.linjer.reduce(function (s, l) { return s + (l.indtastet || 0); }, 0) : 0;
    var h = '<details class="lca-bib-post"><summary><span><b title="' + esc(k.navn) + '">' + esc(k.navn) + '</b>' +
      '<small><i class="lca-kildemaerke">Egen</i> ' + esc(k.kilde || 'Min opbygning') + ' · ' +
      esc(k.enhed || 'enhed mangler') + '</small></span></summary>';
    if (!opb) return h + '</details>';
    h += '<div class="lca-bib-indhold"><b class="lca-opb-kolonne">Andel af indtastet mængde</b>';
    h += opb.linjer.map(function (l) {
      var pct = sum > 0 ? l.indtastet / sum * 100 : 0;
      return '<div class="lca-opb-lag"><b>' + esc(l.navn) + '</b><span class="lca-mini-bar"><i style="width:' +
        pct.toFixed(1) + '%"></i></span><span>' + tal(pct, 1) + ' % · ' + tal(l.indtastet, 4) + ' ' +
        esc(enhedMedVed(l.indtastetEnhed)) + '</span></div>';
    }).join('');
    var valgt = valg.valgtKonstruktion;
    var navn = valgt ? valgt.navn : '';
    h += '<button class="tbtn lca-knyt" data-lca-opb-brug="' + esc(opb.id) + '"' +
      (valgt ? '' : ' disabled title="Vælg først en konstruktion under Model"') + '>' +
      (valgt ? 'Knyt til «' + esc(navn) + '»' : 'Knyt til valgt konstruktion') + '</button></div></details>';
    return h;
  }
  function bibliotekListeHtml(valg) {
    valg = valg || {};
    var q = String(valg.bibliotekSoeg || '').trim().toLowerCase(), filter = valg.bibFilter || 'alle', limit = valg.bibLimit || 20, B = bibModul(valg), bib = valg.bibliotek || null;
    var egne = B && bib ? B.soegKonstruktioner(bib, q, null, 10000).hits : [];
    var generiske = (valg.datasaet || []).filter(function (x) { var n = String(x.navn || x.name || x.materiale || x.key || ''); return !q || n.toLowerCase().indexOf(q) >= 0; });
    var epder = []; (valg.alleEpdDb || []).filter(function (db) { return db && !db.bibliotek; }).forEach(function (db) { (db.epd || []).forEach(function (x) { var n = String(x.navn || x.name || ''); if (!q || n.toLowerCase().indexOf(q) >= 0) epder.push({ db: db.navn || 'EPD-database', post: x }); }); });
    var h = '<section class="lca-bibliotek" data-lca-bibliotek><div class="lca-bibliotek-hoved"><div><h3>Bibliotek</h3><p class="v3-hint">Søg i dine opbygninger, generiske data og EPD-kilder.</p></div><label>Søg<input type="search" data-lca-bibliotek-soeg value="' + esc(valg.bibliotekSoeg || '') + '" placeholder="fx ydervæg eller beton"></label></div>';
    h += '<div class="lca-bib-filtre"><button data-lca-bib-filter="alle" aria-pressed="' + (filter === 'alle') + '">Alle (' + (egne.length + generiske.length + epder.length) + ')</button><button data-lca-bib-filter="mine" aria-pressed="' + (filter === 'mine') + '">Mine opbygninger (' + egne.length + ')</button><button data-lca-bib-filter="br18" aria-pressed="' + (filter === 'br18') + '">BR18 tabel 7 (' + generiske.length + ')</button><button data-lca-bib-filter="epd" aria-pressed="' + (filter === 'epd') + '">EPD\'er (' + epder.length + ')</button></div>';
    var raekker = [];
    if (filter === 'alle' || filter === 'mine') egne.forEach(function (k) {
      raekker.push(egenOpbygningHtml(k, B.opbygning(bib, k.id), valg));
    });
    if (filter === 'alle' || filter === 'br18') generiske.forEach(function (x) {
      raekker.push(br18BibliotekHtml(x, valg));
    });
    if (filter === 'alle' || filter === 'epd') epder.forEach(function (x) { var g = x.post.gwp || {}; raekker.push('<details class="lca-bib-post"><summary><span><b title="' + esc(x.post.navn || x.post.name) + '">' + esc(x.post.navn || x.post.name) + '</b><small><i class="lca-kildemaerke">EPD</i> ' + esc(x.db) + ' · ' + esc(x.post.enhed || 'enhed ikke angivet') + '</small></span><strong>' + tal(g.A1A3, 3) + ' kg CO₂e/' + esc(x.post.enhed || 'enhed') + '</strong></summary><div class="lca-bib-indhold"><table><tr><th>Fase</th><th>Værdi</th></tr><tr><td>A1-3</td><td>' + tal(g.A1A3, 3) + '</td></tr><tr><td>C3</td><td>' + tal(g.C3, 3) + '</td></tr><tr><td>C4</td><td>' + tal(g.C4, 3) + '</td></tr><tr><td>D</td><td>' + tal(g.D, 3) + '</td></tr></table><small>Datasæt-id: ' + esc(x.post.registreringsnr || '') + (x.post.udloeb ? ' · gyldig til ' + esc(x.post.udloeb) : '') + '</small><small>Vælg EPD\'en på en byggevare under Model.</small></div></details>'); });
    if (!raekker.length) h += '<p class="lca-tom">Ingen resultater matcher søgningen.</p>'; else h += '<div class="lca-bib-resultater">' + raekker.slice(0, limit).join('') + '</div>' + (raekker.length > limit ? '<button class="tbtn" data-lca-bib-flere>Vis flere (' + (raekker.length - limit) + ')</button>' : '');
    if (!egne.length && (filter === 'alle' || filter === 'mine')) h += '<article class="lca-importguide"><h3>Tilføj dine opbygninger</h3><ol><li>Eksportér fra LCAbyg som <code>.json</code> eller <code>.lb5cstr</code>.</li><li>Slip filen i feltet herunder.</li><li>Vælg opbygningen til en bygningsdel under Model.</li><li>Eller gem en konstruktion direkte fra Model.</li></ol><div class="lca-slip" data-lca-slip><b>Slip LCAbyg-filer her</b><span>eller</span><button class="tbtn" data-lca-bib-fil>Vælg filer</button><input type="file" multiple accept=".json,.lb5cstr,.lb5elm,.lb5prd,.lb5stg,.lb5,.lb5epd" data-lca-bib-input hidden></div><p class="v3-hint"><code>.lb5</code> og <code>.lb5epd</code> er krypterede. Eksportér i stedet som komponentfil eller åben JSON.</p></article>';
    else h += '<div class="lca-bib-import"><button class="tbtn" data-lca-bib-fil>Tilføj LCAbyg-opbygninger</button><input type="file" multiple accept=".json,.lb5cstr,.lb5elm,.lb5prd,.lb5stg,.lb5,.lb5epd" data-lca-bib-input hidden></div>';
    h += '<details class="lca-kilder"><summary>Kilder</summary>' + dbBlokHtml(valg) + '</details><details class="lca-import-projekt"><summary>Importér et helt LCAbyg-projekt</summary><button class="tbtn" data-lca-import>Vælg JSON-projektfil</button><input type="file" accept=".json,application/json" data-lca-fil hidden></details>';
    return h + '</section>';
  }
  function br18BibliotekHtml(x, valg) {
    var g = x.gwp || {};
    var faser = { A1A3: x.a1a3 != null ? x.a1a3 : g.A1A3, C3: x.c3 != null ? x.c3 : g.C3,
      C4: x.c4 != null ? x.c4 : g.C4, D: x.d != null ? x.d : g.D };
    var mangler = Object.keys(faser).filter(function (k) { return faser[k] == null; });
    var navn = x.navn || x.name || x.materiale || x.key;
    var h = '<details class="lca-bib-post"><summary><span><b title="' + esc(navn) + '">' + esc(navn) + '</b>' +
      '<small><i class="lca-kildemaerke">BR18</i> ' + esc(x.enhed || 'enhed ikke angivet') + '</small></span>' +
      '<strong>' + tal(faser.A1A3, 3) + ' kg CO₂e/' + esc(x.enhed || 'enhed') + '</strong></summary>';
    h += '<div class="lca-bib-indhold"><table><tr><th>Fase</th><th>Værdi · kg CO₂e/' + esc(x.enhed || 'enhed') + '</th></tr>';
    [['A1-3', 'A1A3'], ['C3', 'C3'], ['C4', 'C4'], ['D', 'D']].forEach(function (f) {
      h += '<tr><td>' + f[0] + '</td><td>' + (faser[f[1]] == null ? '' : tal(faser[f[1]], 3)) + '</td></tr>';
    });
    h += '</table>' + (mangler.length ? '<small>En eller flere faser er ikke oplyst i kilden.</small>' : '');
    h += '<small>Datasæt-id: ' + esc(x.key || '') + (x.udloeb ? ' · gyldig til ' + esc(x.udloeb) : '') + '</small>';
    if (valg.valgtBv && valg.harValgtBv) {
      var bvNavn = valg.valgtBv.datasaet && valg.valgtBv.datasaet.navn || valg.valgtBv.navn;
      h += '<button class="tbtn" data-lca-brug-bib-ds="' + esc(x.key || '') + '">Brug på valgt byggevare</button><small>Bruges på: ' + esc(bvNavn) + '</small>';
    } else h += '<button class="tbtn" disabled>Brug på valgt byggevare</button><small>Vælg først en byggevare under Model. <button class="lca-tekstlink" data-lca-fane="model">Gå til Model</button></small>';
    return h + '</div></details>';
  }

  /* ---------- Fanen ---------- */
  // Egne regler for panelets rækker. «lca-navigation» er 3D-layoutets smalle bygningsdel/konstruktion-vælger og er skjult over
  // 620 px (arbejdsrum-layout.css), så LCA's knapper og felter bruger «lca-raekke», der altid vises.
  var STIL = '.lca-raekke label{display:flex;flex-direction:column;gap:3px;font-size:12px;min-width:0}.lca-raekke input,.lca-raekke select{font:inherit}' +
    '.lca-mangelgruppe{border:1px solid var(--border,#d5d5d5);border-radius:6px;padding:6px 10px;margin:6px 0}.lca-mangelgruppe>summary{cursor:pointer}' +
    '.lca-ikke-regnet{opacity:.75}.lca-summering td{vertical-align:top}' +
    '.lca-beregningstabel{font-size:12px;min-width:840px}.lca-beregningstabel td{vertical-align:top}.lca-beregningstabel tr.lca-subtotal td{border-top:1px solid var(--border,#d5d5d5)}' +
    '.lca-beregningstabel tr.lca-ret>td{background:var(--bg-paper,#f7f7f5)}.lca-ret-boks{padding:4px 2px}.lca-ret-boks label{display:flex;flex-direction:column;gap:3px;font-size:12px;max-width:100%}' +
    '.lca-ret-boks input,.lca-ret-boks select{max-width:100%;box-sizing:border-box}' +
    // Kompakt visning (delt skærm, #lcaBody ≤ 620 px): faste kolonnebredder, der fylder panelet, og ord, der må brydes, så intet
    // skal rulles sidelæns. Bygningsdel, faktor, levetid, moduler og subtotal skjules; bygningsdelen og dens sum står som
    // overskrift, og «CO₂e i alt» foldes ud til modulerne i rækken under (lca-udfold). ≤ 420 px: også konstruktionen som overskrift.
    '.lca-beregningstabel .lca-k-ialt,.lca-beregningstabel tr.lca-del-hoved,.lca-beregningstabel tr.lca-kon-hoved,.lca-beregningstabel tr.lca-udfold{display:none}.lca-beregningstabel .lca-k-ialt summary{cursor:pointer}' +
    '.lca-beregningstabel tr.lca-del-hoved>td{background:var(--bg,#f3f3f1)}.lca-beregningstabel tr.lca-kon-hoved>td{color:var(--muted,#666)}.lca-beregningstabel tr.lca-udfold>td{padding-top:0}' +
    '@container (max-width:620px){table.lca.lca-beregningstabel{min-width:0;width:100%;table-layout:fixed}' +
    'table.lca.lca-beregningstabel th,table.lca.lca-beregningstabel td{padding:5px 6px;overflow-wrap:anywhere;letter-spacing:0}table.lca.lca-beregningstabel th{overflow-wrap:normal}' +
    '.lca-beregningstabel .lca-k-del,.lca-beregningstabel .lca-k-f,.lca-beregningstabel .lca-k-lev,.lca-beregningstabel .lca-k-mod,.lca-beregningstabel tr.lca-subtotal{display:none}' +
    '.lca-beregningstabel .lca-k-ialt{display:table-cell}.lca-beregningstabel tr.lca-del-hoved{display:table-row}' +
    '.lca-beregningstabel tr:has(>td.lca-k-ialt details[open])+tr.lca-udfold{display:table-row}' +
    '.lca-beregningstabel th.lca-k-kon{width:20%}.lca-beregningstabel th.lca-k-bv{width:22%}.lca-beregningstabel th.lca-k-epd{width:30%}.lca-beregningstabel th.lca-k-m{width:13%}.lca-beregningstabel th.lca-k-ialt{width:15%}}' +
    '@container (max-width:420px){.lca-beregningstabel .lca-k-kon{display:none}.lca-beregningstabel tr.lca-kon-hoved{display:table-row}' +
    '.lca-beregningstabel th.lca-k-bv{width:27%}.lca-beregningstabel th.lca-k-epd{width:33%}.lca-beregningstabel th.lca-k-m{width:19%}.lca-beregningstabel th.lca-k-ialt{width:21%}}' +
    // EPD-status som rammens chips (ok/warn/grey). Specificitet 0 (:where), så rammens egne chip-regler i arbejdsrum-layout.css vinder.
    ':where(.lca-beregningstabel .chip){display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;line-height:1.5;border:1px solid transparent;color:inherit;white-space:nowrap}' +
    ':where(.lca-beregningstabel .chip.ok){background:rgba(46,125,50,.14);border-color:rgba(46,125,50,.45)}:where(.lca-beregningstabel .chip.warn){background:rgba(237,108,2,.14);border-color:rgba(237,108,2,.5)}' +
    ':where(.lca-beregningstabel .chip.grey){background:rgba(128,128,128,.12);border-color:rgba(128,128,128,.4)}';
  // Kolonnerne (lcak-): fire kolonner og den valgte byggevare ved siden af i et bredt panel; under hinanden ≤ 900 px; kolonnerne
  // 2 × 2 ≤ 620 px og én ad gangen ≤ 420 px (#lcaBody er container). Farver fra rammens variabler, så mørkt tema virker.
  STIL += '.lcak-flade{display:grid;grid-template-columns:minmax(0,1fr) minmax(270px,340px);gap:10px;align-items:start;margin:8px 0}' +
    '.lcak-nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:start;border:1px solid var(--border,#d5d5d5);border-radius:var(--r-md,8px);overflow:hidden;min-width:0;min-height:0;background:var(--bg-paper,#fff)}' +
    '.lcak-kol{--lcak-list-height:auto;--lcak-list-max:260px;border-left:1px solid var(--border,#d5d5d5);min-width:0;min-height:0;display:flex;flex-direction:column}.lcak-kol:first-child{border-left:0}' +
    '.lcak-hoved{font-size:11px;padding:6px 8px;border-bottom:1px solid var(--border,#d5d5d5);background:var(--bg-elev,#ecefec);color:var(--accent,#0f4c4c)}.lcak-hoved span{font-weight:400;color:var(--muted,#666)}' +
    '.lcak-liste{display:flex;flex:0 0 auto;flex-direction:column;gap:2px;padding:3px;height:var(--lcak-list-height);max-height:var(--lcak-list-max);overflow-y:auto}' +
    '.lcak-post{all:unset;box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 6px;width:100%;min-width:0;padding:5px 6px;border-radius:var(--r-sm,4px);cursor:pointer;font-size:12px;line-height:1.35}' +
    '.lcak-post:hover{background:var(--line-soft,#ecefec)}.lcak-post[aria-current="true"]{background:var(--ok-bg,#e9f0ea);box-shadow:inset 3px 0 0 var(--accent,#0f4c4c)}' +
    '.lcak-post:focus-visible{outline:2px solid var(--accent,#0f4c4c);outline-offset:-2px}.lcak-navn{overflow-wrap:anywhere}' +
    '.lcak-n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.lcak-u{display:block;grid-column:1/3;font-size:11px;color:var(--muted,#666);overflow-wrap:anywhere}' +
    '.lcak-prik{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:1px}.lcak-ok{background:var(--ok,#4a7c59)}.lcak-warn{background:var(--warn,#8a6d1f)}.lcak-grey{border:1.5px solid var(--ink-soft,#8a968f)}' +
    '.lcak-fase{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:0 6px;align-items:start;padding:5px 8px;font-size:12px;border-bottom:1px solid var(--line-soft,#ecefec)}' +
    '.lcak-fase .lcak-u{grid-column:auto}.lcak-ialt{font-weight:700;border-bottom:0;border-top:1px solid var(--border,#d5d5d5)}.lcak-tom{padding:6px 8px;margin:0}' +
    '.lcak-fk{width:9px;height:9px;border-radius:2px;margin-top:3px}.lcak-fA1A3{background:var(--accent,#0f4c4c)}.lcak-fA4{background:var(--info-text,#2f5161)}.lcak-fB4{background:var(--warn,#8a6d1f)}.lcak-fC3{background:var(--red,#c65a2e)}.lcak-fC4{background:var(--muted,#666)}.lcak-fD{border:1.5px dashed var(--ink-soft,#8a968f)}' +
    '.lcak-detalje{border:1px solid var(--border,#d5d5d5);border-radius:var(--r-md,8px);padding:10px 12px;display:flex;flex-direction:column;gap:10px;min-width:0;background:var(--bg-paper,#fff);font-size:12.5px}' +
    '.lcak-titel{font-size:14px;overflow-wrap:anywhere}.lcak-blok{border-top:1px solid var(--line-soft,#ecefec);padding-top:8px;display:flex;flex-direction:column;gap:6px;min-width:0}' +
    '.lcak-h4{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#666)}' +
    '.lcak-chips{display:flex;flex-wrap:wrap;gap:4px}.lcak-chips button{border:1px solid var(--border,#d5d5d5);background:var(--bg-paper,#fff);color:inherit;border-radius:var(--r-sm,4px);padding:3px 8px;font:inherit;font-size:12px;cursor:pointer}' +
    '.lcak-chips button[aria-pressed="true"]{background:var(--accent,#0f4c4c);color:var(--accent-ink,#fff);border-color:var(--accent,#0f4c4c)}.lcak-chips button:disabled{opacity:.4;cursor:not-allowed}' +
    '.lcak-felter{display:flex;flex-wrap:wrap;gap:6px 10px}.lcak-felter label{display:flex;flex-direction:column;gap:2px;font-size:12px}.lcak-felter input{width:100px;font:inherit;box-sizing:border-box}' +
    '.lcak-formel{background:var(--bg-elev,#ecefec);border-radius:var(--r-sm,4px);padding:6px 8px;font-size:12px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;display:flex;flex-direction:column;gap:2px}.lcak-stor{font-size:14px}' +
    '.lcak-chip{display:inline-block;padding:0 7px;border-radius:999px;font-size:11px;border:1px solid var(--border,#d5d5d5)}.lcak-ok-c{color:var(--ok,#4a7c59)}.lcak-warn-c{color:var(--warn,#8a6d1f);background:var(--warn-bg,#f7efe3)}.lcak-grey-c{color:var(--muted,#666)}' +
    '.lcak-advar{color:var(--warn,#8a6d1f);background:var(--warn-bg,#f7efe3);border-radius:var(--r-sm,4px);padding:5px 8px;font-size:12px;margin:0}' +
    '.lcak-kaede{border:1px solid var(--border,#d5d5d5);border-radius:var(--r-md,8px);padding:10px 12px;margin:8px 0;display:flex;flex-direction:column;gap:8px;background:var(--bg-paper,#fff);min-width:0;font-size:12.5px}' +
    '.lcak-led{display:flex;flex-wrap:wrap;gap:6px;align-items:stretch}.lcak-boks{border:1px solid var(--border,#d5d5d5);border-radius:var(--r-sm,4px);padding:6px 9px;flex:1 1 130px;min-width:0;display:flex;flex-direction:column;gap:1px}' +
    '.lcak-boks small{font-size:10.5px;color:var(--muted,#666);text-transform:uppercase;letter-spacing:.04em}.lcak-boks b{font-size:16px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.lcak-boks span{font-size:11px;color:var(--muted,#666);overflow-wrap:anywhere}' +
    '.lcak-boks.lcak-res{background:var(--ok-bg,#e9f0ea);border-color:var(--accent,#0f4c4c)}.lcak-op{align-self:center;color:var(--muted,#666);font-size:18px}' +
    'table.lca.lcak-tabel{width:100%;font-size:12px}table.lca.lcak-tabel td{vertical-align:top;overflow-wrap:anywhere}' +
    '.lcak-top{position:sticky;top:0;z-index:3;background:var(--bg-paper,#fff);border-bottom:1px solid var(--border,#d5d5d5);padding:6px 0 0;margin-bottom:8px}.lcak-top-res{font-size:14px}.lcak-top .lca-raekke{margin:4px 0!important}' +
    '.lcak-faner{display:flex;flex-wrap:wrap;gap:2px}.lcak-faner button{border:0;border-bottom:2px solid transparent;background:none;color:var(--muted,#666);font:inherit;font-size:13px;padding:6px 10px;cursor:pointer}.lcak-faner button:hover{color:var(--text,#111)}.lcak-faner button[aria-selected="true"]{color:var(--accent,#0f4c4c);border-bottom-color:var(--accent,#0f4c4c);font-weight:700}' +
    '.lcak-rapport{border:1px solid var(--border,#d5d5d5);border-radius:var(--r-md,8px);overflow:auto;background:#fff;margin-top:8px}' +
    '.lcak-under{padding-left:22px}.lcak-under .lcak-navn{font-size:11.5px}.lcak-pil{display:inline-block;width:13px;color:var(--muted,#666)}.lcak-post[data-lca-tom="true"]{color:var(--ink-soft,#8a968f)}' +
    '.lcak-bv-filter{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:3px;min-width:0}.lcak-bv-filter button{border:1px solid var(--border,#d5d5d5);border-radius:999px;background:transparent;color:inherit;padding:2px 5px;font:inherit;font-size:11px;white-space:nowrap}.lcak-bv-filter button[aria-pressed="true"]{background:var(--accent,#0f4c4c);color:var(--accent-ink,#fff)}' +
    '.lcak-gruppe{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#666);padding:6px 6px 2px}' +
    '.lcak-db{border:1px solid var(--border,#d5d5d5);border-radius:var(--r-md,8px);padding:8px 10px;margin:8px 0;display:flex;flex-direction:column;gap:6px;background:var(--bg-paper,#fff);font-size:12.5px;min-width:0}' +
    '.lcak-db-liste{display:flex;flex-direction:column;gap:3px}.lcak-db-post{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;overflow-wrap:anywhere}' +
    '.lcak-db-hit{display:flex;justify-content:space-between;gap:8px;align-items:center;border-bottom:1px solid var(--line-soft,#ecefec);padding:5px 0}.lcak-opb{width:100%;border-collapse:collapse;font-size:12px;margin:6px 0}.lcak-opb th,.lcak-opb td{text-align:left;padding:3px 6px;border-bottom:1px solid var(--border)}.lcak-db-hit>div{min-width:0;overflow-wrap:anywhere}' +
    '@container (max-width:900px){.lcak-flade{grid-template-columns:minmax(0,1fr)}}' +
    '@container (max-width:620px){.lcak-nav{grid-template-columns:repeat(2,minmax(0,1fr))}.lcak-kol:nth-child(-n+2){--lcak-list-height:230px;--lcak-list-max:230px}.lcak-kol:nth-child(3){border-left:0}.lcak-kol:nth-child(n+3){--lcak-list-height:auto;--lcak-list-max:260px;border-top:1px solid var(--border,#d5d5d5)}}' +
    '@container (max-width:420px){.lcak-nav{grid-template-columns:minmax(0,1fr)}.lcak-kol{--lcak-list-height:200px;--lcak-list-max:200px;border-left:0;border-top:1px solid var(--border,#d5d5d5)}.lcak-kol:first-child{border-top:0}.lcak-op{width:100%}}';
  STIL += '.lca-overblik{display:grid;grid-template-columns:minmax(180px,1fr) minmax(150px,.7fr);gap:12px 20px;padding:16px;border:1px solid var(--border,#d5d5d5);border-radius:var(--r-md,8px);background:var(--bg-paper,#fff);margin:0 0 10px}' +
    '.lca-overblik-tal,.lca-overblik-graense{display:flex;flex-direction:column;gap:2px}.lca-overblik-tal>b{font-size:36px;line-height:1;font-variant-numeric:tabular-nums}.lca-overblik-graense>b{font-size:24px;line-height:1.15}.lca-overblik-status{font-weight:700;color:var(--muted,#666)}.lca-overblik.ok .lca-overblik-status{color:var(--ok,#4a7c59)}.lca-overblik.fejl .lca-overblik-status{color:var(--red,#c65a2e)}' +
    '.lca-graensebar{grid-column:1/-1;height:12px;border-radius:999px;background:var(--line-soft,#ecefec);position:relative;overflow:hidden}.lca-graensebar span{display:block;height:100%;max-width:100%;background:var(--accent,#0f4c4c)}.lca-overblik.fejl .lca-graensebar span{background:var(--red,#c65a2e)}.lca-graensebar i{position:absolute;left:71.43%;top:0;bottom:0;border-left:2px solid var(--ink,#222)}.lca-overblik p{grid-column:1/-1;margin:0}' +
    '.lca-sektion{margin:18px 0}.lca-sektion>h3{margin-bottom:3px}.lca-hotspots{display:flex;flex-direction:column;gap:5px}.lca-hotspot{border:1px solid var(--border,#d5d5d5);border-radius:var(--r-sm,4px);background:var(--bg-paper,#fff)}.lca-hotspot>summary{display:grid;grid-template-columns:minmax(130px,1fr) auto;gap:4px 12px;padding:8px 10px;cursor:pointer;list-style-position:inside}.lca-hotspot-navn{font-weight:700}.lca-hotspot-tal{font-variant-numeric:tabular-nums}.lca-hotspot-spor{grid-column:1/-1;height:8px;background:var(--line-soft,#ecefec);border-radius:99px;overflow:hidden}.lca-hotspot-spor i{display:block;height:100%;background:var(--accent,#0f4c4c);border-radius:99px}.lca-hotspot-kons{padding:3px 10px 10px;display:flex;flex-direction:column;gap:3px}.lca-hotspot-kon{display:flex;justify-content:space-between;gap:10px;text-align:left;padding:6px 8px;border:0;border-radius:var(--r-sm,4px);background:var(--bg-elev,#ecefec);color:inherit;cursor:pointer}.lca-hotspot-kon small{color:var(--muted,#666)}' +
    '.lca-faser{display:flex;flex-direction:column;gap:5px}.lca-fase{display:grid;grid-template-columns:minmax(180px,1fr) minmax(80px,2fr) auto;gap:10px;align-items:center}.lca-fase-spor{height:10px;background:var(--line-soft,#ecefec);border-radius:99px;overflow:hidden}.lca-fase-spor i{display:block;height:100%;background:var(--accent,#0f4c4c)}.lca-fase-d{display:grid;grid-template-columns:1fr auto;gap:2px 10px;margin-top:10px;padding:8px 10px;border:1px dashed var(--border,#d5d5d5);border-radius:var(--r-sm,4px)}.lca-fase-d small{grid-column:1/-1;color:var(--muted,#666)}' +
    '.lca-resultat-detaljer{margin:18px 0}.lca-bibliotek-hoved{display:flex;justify-content:space-between;gap:16px;align-items:end}.lca-bibliotek-hoved label{display:flex;flex-direction:column;gap:3px;font-size:13px}.lca-bibliotek-hoved input{min-width:260px}.lca-kildekort{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0}.lca-kildekort article{display:flex;flex-direction:column;gap:3px;padding:10px;border:1px solid var(--border,#d5d5d5);border-radius:var(--r-sm,4px);background:var(--bg-paper,#fff)}.lca-kildekort span{font-size:12px;color:var(--muted,#666)}.lca-bib-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.lca-bib-grid>div{min-width:0}.lca-bib-post{box-sizing:border-box;width:100%;display:flex;justify-content:space-between;gap:8px;padding:7px 8px;margin:3px 0;border:1px solid var(--border,#d5d5d5);border-radius:var(--r-sm,4px);background:var(--bg-paper,#fff);color:inherit;text-align:left;cursor:pointer}.lca-bib-post span{display:flex;flex-direction:column;min-width:0}.lca-bib-post small,.lca-bib-post i{color:var(--muted,#666);font-size:11px}.lca-bib-post.statisk{cursor:default}.lca-bib-detalje,.lca-importguide{margin-top:14px;padding:12px;border:1px solid var(--border,#d5d5d5);border-radius:var(--r-md,8px);background:var(--bg-paper,#fff)}.lca-slip{display:flex;align-items:center;justify-content:center;gap:10px;min-height:70px;border:2px dashed var(--border,#d5d5d5);border-radius:var(--r-md,8px);margin:10px 0}' +
    '@container (max-width:620px){.lca-overblik,.lca-kildekort,.lca-bib-grid{grid-template-columns:1fr}.lca-overblik-tal>b{font-size:30px}.lca-fase{grid-template-columns:1fr auto}.lca-fase-spor{grid-column:1/-1;grid-row:2}.lca-bibliotek-hoved{align-items:stretch;flex-direction:column}.lca-bibliotek-hoved input{min-width:0;width:100%}.lca-hotspot>summary{grid-template-columns:1fr}.lca-hotspot-spor{grid-column:1}.lca-slip{flex-wrap:wrap;padding:10px}}';
  // Runde 2: tæt 600 px-layout. Disse regler ligger sidst og erstatter runde 1's kortlayout.
  STIL += '.lcak-top{box-sizing:border-box;display:flex;flex-direction:column;align-items:stretch;gap:0;padding:0!important;margin:0 0 8px!important;overflow:visible}.lcak-top-main{display:flex;align-items:flex-end;gap:6px;min-width:0}.lcak-faner{flex:1 1 auto;min-width:0;display:flex;flex-wrap:wrap!important;gap:0;overflow:visible}.lcak-faner button{flex:0 0 auto;padding:7px 6px!important;font-size:12px!important;white-space:nowrap}.lcak-top-action{flex:0 0 auto;display:flex;align-items:center;padding:0 2px 2px 0}.lcak-top-status{padding:2px 6px 4px;font-size:11px;line-height:1.35;color:var(--muted,#666);overflow-wrap:anywhere}.lcak-link{padding:4px 6px!important;font-size:11px!important;white-space:nowrap}' +
    '.lca-overblik{max-height:150px;box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px 12px;padding:10px 12px;margin:0 0 10px}.lca-overblik-hoved{min-width:0}.lca-overblik-hoved>div{display:flex;align-items:baseline;gap:4px;white-space:nowrap}.lca-overblik-hoved b{font-size:30px;line-height:1}.lca-overblik-status{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em}.lca-overblik.mangler .lca-overblik-hoved{opacity:.68}.lca-overblik>.primary{align-self:center;white-space:nowrap}.lca-graensebar{grid-column:1/-1;height:9px;overflow:visible;margin-top:8px}.lca-graensebar span{border-radius:99px}.lca-graensebar i{top:-4px;bottom:-4px}.lca-graensebar em{position:absolute;top:11px;left:0;transform:translateX(-50%);font-size:10px;font-style:normal;white-space:nowrap;color:var(--muted,#666)}.lca-overblik p{font-size:12px;margin-top:7px!important}.lca-overblik-tom{min-height:75px;max-height:110px}.lca-overblik-tom>div{display:flex;flex-direction:column;gap:3px}' +
    '.lca-starttrin{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin:8px 0 12px}.lca-starttrin section{min-width:0;padding:9px;border:1px solid var(--border,#d5d5d5);border-radius:var(--r-sm,4px);background:var(--bg-paper,#fff);display:flex;flex-direction:column;gap:7px}.lca-starttrin section>b{display:flex;align-items:center;gap:6px}.lca-starttrin i{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--accent,#0f4c4c);color:var(--accent-ink,#fff);font-style:normal;font-size:11px}.lca-starttrin select,.lca-starttrin input,.lca-bibliotek input,.lca-bibliotek select{box-sizing:border-box;width:100%;min-width:0;padding:7px 9px;border:1px solid var(--border,#d5d5d5);border-radius:var(--r-sm,4px);background:var(--bg-paper,#fff);color:inherit;font:inherit}.lca-areal{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.lca-areal input{width:90px}.lca-senere{margin-top:8px}' +
    '.lca-mangelgrupper{display:flex;flex-direction:column;gap:4px}.lca-mangelgruppe{min-height:34px;box-sizing:border-box;padding:3px 5px!important;margin:0!important;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:start}.lca-mangelgruppe details{min-width:0}.lca-mangelgruppe summary{min-height:26px;display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;padding:1px 3px}.lca-mangelgruppe>button{margin-top:1px;white-space:nowrap}.lca-mangler{padding-left:0;list-style:none;margin:5px 0}.lca-mangler li{min-height:28px;display:flex;align-items:center;justify-content:space-between;gap:6px;border-top:1px solid var(--line-soft,#ecefec);padding:2px 3px;font-size:12px}.lca-mangler li>span{min-width:0;overflow-wrap:anywhere}.lca-mangler li .lca-raekke{flex-basis:100%}' +
    '.lca-sektion{margin:14px 0}.lca-sektion-hoved{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.lca-sektion-hoved h3{margin:0 0 5px}.lca-sektion-hoved span{font-size:11px;color:var(--muted,#666)}.lca-hotspots{gap:2px}.lca-hotspot{border:0;border-radius:0;border-bottom:1px solid var(--line-soft,#ecefec)}.lca-hotspot>summary,.lca-hotspot-fast{min-height:30px;box-sizing:border-box;display:grid;grid-template-columns:minmax(110px,1fr) minmax(80px,2fr) 48px;gap:8px;align-items:center;padding:3px 4px}.lca-hotspot>summary{list-style:none}.lca-hotspot>summary::-webkit-details-marker{display:none}.lca-hotspot-spor{grid-column:auto;height:9px}.lca-hotspot-tal,.lca-hotspot-fast>b{text-align:right;font-variant-numeric:tabular-nums}.lca-hotspot-kons{padding:3px 4px 6px 118px}.lca-hotspot-kon{min-height:27px;padding:3px 7px}.lca-hotspot-nul{min-height:29px;display:flex;align-items:center;padding:2px 4px;color:var(--muted,#666);font-size:12px}.lca-tom{padding:10px;background:var(--bg-elev,#ecefec);border-radius:var(--r-sm,4px)}' +
    '.lca-faser{gap:2px}.lca-fase{min-height:28px;grid-template-columns:minmax(155px,1fr) minmax(80px,2fr) 70px;gap:8px;border-bottom:1px solid var(--line-soft,#ecefec)}.lca-fase> b{text-align:right;font-variant-numeric:tabular-nums}.lca-fase.nul{opacity:.45}.lca-fase-d{min-height:34px;margin-top:4px;padding:4px 7px}.lca-resultat-detaljer{margin:12px 0}' +
    '.lca-bibliotek-hoved{gap:10px}.lca-bibliotek-hoved label{min-width:210px}.lca-bib-filtre{display:flex;gap:4px;overflow-x:auto;margin:8px 0}.lca-bib-filtre button{flex:0 0 auto;border:1px solid var(--border,#d5d5d5);border-radius:999px;padding:5px 9px;background:var(--bg-paper,#fff);color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.lca-bib-filtre button[aria-pressed="true"]{background:var(--accent,#0f4c4c);color:var(--accent-ink,#fff);border-color:var(--accent,#0f4c4c)}.lca-bib-resultater{display:flex;flex-direction:column;gap:2px}.lca-bib-post{display:block;padding:0;margin:0;border-width:0 0 1px;border-radius:0}.lca-bib-post>summary{min-height:35px;box-sizing:border-box;display:flex;align-items:center;padding:4px 6px;cursor:pointer}.lca-bib-post>summary span{display:flex;flex-direction:column}.lca-bib-indhold{padding:6px 10px 9px;background:var(--bg-elev,#ecefec);display:flex;flex-direction:column;gap:5px;font-size:12px}.lca-bib-indhold>div{display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid var(--line-soft,#ecefec);padding:3px 0}.lca-bib-import,.lca-import-projekt{margin-top:10px}.lca-importguide ol{padding-left:20px}.lca-importguide li{margin:4px 0}' +
    '@container (max-width:620px){.lca-starttrin{grid-template-columns:1fr}.lca-overblik-hoved b{font-size:26px}.lca-bibliotek-hoved{align-items:stretch}.lca-hotspot-kons{padding-left:12px}}@container (max-width:420px){.lca-overblik{grid-template-columns:1fr}.lca-overblik>.primary{justify-self:start}.lca-hotspot>summary,.lca-hotspot-fast{grid-template-columns:minmax(90px,1fr) minmax(55px,1.2fr) 42px}.lca-fase{grid-template-columns:minmax(120px,1fr) minmax(45px,1fr) 58px}}';
  // Runde 3: Model som arbejdsflade, databaserækker med værdi og ens tæthed på tværs af fanerne.
  STIL += '.lca-forslag-venter{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:7px 9px;margin:5px 0;border:1px solid var(--accent,#0f4c4c);border-radius:var(--r-sm,4px);background:var(--ok-bg,#e9f0ea)}' +
    '.lca-tekstlink{all:unset;color:var(--accent,#0f4c4c);text-decoration:underline;cursor:pointer}.lcak-model-hoved{display:flex;justify-content:space-between;align-items:end;gap:10px;margin-bottom:4px}.lcak-model-hoved h3,.lcak-model-hoved p{margin:0}.lcak-model-hoved .lca-raekke{margin:0!important}.lcak-omfang{font-size:13px}.lcak-omfang label{display:flex;align-items:baseline;gap:8px}.lcak-omfang select{font-size:13px}.lcak-kildelinje{margin:5px 0 7px;font-size:12px;color:var(--muted,#666)}' +
    '.lcak-bv-bar,.lca-mini-bar{display:block;height:4px;margin-top:3px;background:var(--line-soft,#ecefec);border-radius:99px;overflow:hidden}.lcak-bv-bar i,.lca-mini-bar i{display:block;height:100%;background:var(--accent,#0f4c4c)}' +
    '.lca-bib-post>summary{display:grid!important;grid-template-columns:minmax(0,1fr) auto;gap:10px}.lca-bib-post>summary span{min-width:0}.lca-bib-post>summary b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:600}.lca-bib-post>summary strong{font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}.lca-kildemaerke{display:inline-block;border:1px solid var(--border,#d5d5d5);border-radius:999px;padding:0 5px;font-style:normal}.lca-bib-indhold table{width:100%;border-collapse:collapse}.lca-bib-indhold th,.lca-bib-indhold td{padding:2px 5px;border-bottom:1px solid var(--line-soft,#ecefec);text-align:left}.lca-opb-lag{display:grid!important;grid-template-columns:minmax(100px,1fr) minmax(60px,1fr) auto;align-items:center}.lca-kilder{margin-top:12px}' +
    '.lca-bp-hoved{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.lca-bp-hoved label{display:flex;flex-direction:column;gap:3px}.lca-bp-hoved label>small{font-size:11px;color:var(--muted,#666)}.lca-bp-hoved label>span{display:flex;height:34px;border:1px solid var(--border,#d5d5d5);border-radius:var(--r-sm,4px);overflow:hidden;background:var(--bg-paper,#fff)}.lca-bp-hoved input{min-width:0;width:100%;border:0;padding:5px 7px;background:transparent;color:inherit;font:inherit}.lca-bp-hoved i{display:flex;align-items:center;padding:0 7px;background:var(--bg-elev,#ecefec);font-style:normal;font-size:11px}' +
    '.lcak-boks small,.lca-graensebar em,.lcak-gruppe{font-size:11px!important}.lcak-pane[data-lca-pane="spild"] .lca-tote{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.lcak-pane[data-lca-pane="spild"] .lca-card{min-width:0}' +
    '@container (max-width:620px){.lcak-flade{margin-top:4px}.lca-bib-post>summary strong{font-size:11px}}@container (max-width:420px){.lca-bp-hoved,.lcak-pane[data-lca-pane="spild"] .lca-tote{grid-template-columns:1fr}.lca-forslag-venter{grid-template-columns:1fr auto}.lca-forslag-venter button{grid-column:1/-1}.lca-opb-lag{grid-template-columns:1fr auto}.lca-opb-lag .lca-mini-bar{grid-column:1/-1}.lcak-model-hoved{align-items:stretch;flex-direction:column}}';
  // Runde 4: valgbrowseren prioriterer træet og lader produkter og faser følge indholdet.
  STIL += '.lcak-navn{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lcak-u{display:flex;align-items:center;gap:5px;min-width:0;font-size:11px}.lcak-chip{flex:0 0 auto}.lcak-mangler-tal{color:var(--warn,#8a6d1f);font-weight:700;white-space:nowrap}' +
    '.lcak-vis-tomme{display:block;width:100%;border:0;border-top:1px solid var(--line-soft,#ecefec);padding:6px;background:transparent;color:var(--muted,#666);font:inherit;font-size:11px;text-align:left;cursor:pointer}.lcak-bv-tools{display:flex;flex-direction:column;align-items:stretch;gap:2px;min-width:0;overflow:hidden;padding-right:3px}.lcak-naeste{position:static;align-self:flex-start;flex:0 0 auto;margin:0 3px 3px;padding:3px 5px;font-size:11px;white-space:nowrap;max-width:calc(100% - 6px)}.lcak-alle-data{margin:5px 7px;color:var(--ok,#4a7c59);font-size:11px}.lcak-gem-opb{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:7px 0}.lcak-gem-opb span{font-size:12px;color:var(--ok,#4a7c59)}' +
    '.lcak-model-hoved select{padding:6px 8px;border:1px solid var(--border,#d5d5d5);border-radius:var(--r-sm,4px);background:var(--bg-paper,#fff);color:inherit;font:inherit}.lca-opb-kolonne{font-size:11px;color:var(--muted,#666);text-transform:uppercase;letter-spacing:.04em}.lca-knyt{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.lca-bp-under{margin:12px 0 5px}.lca-bp-under small{font-weight:400;color:var(--muted,#666)}.lca-bp-affald{display:grid;grid-template-columns:minmax(90px,.6fr) minmax(130px,1fr) minmax(100px,.7fr) minmax(160px,1.4fr);gap:8px}.lca-bp-affald label{display:flex;flex-direction:column;gap:3px}.lca-bp-affald label>span{display:flex;height:34px;border:1px solid var(--border,#d5d5d5);border-radius:var(--r-sm,4px);overflow:hidden;background:var(--bg-paper,#fff)}.lca-bp-affald input,.lca-bp-affald select{min-width:0;width:100%;border:0;padding:5px 7px;background:transparent;color:inherit;font:inherit}.lca-bp-affald i{display:flex;align-items:center;padding:0 7px;background:var(--bg-elev,#ecefec);font-style:normal;font-size:11px}.lca-proces-besked{width:100%;box-sizing:border-box;margin:6px 0 12px;font-size:12px}.lca-mangelgruppe[data-lca-proces] summary{display:grid;grid-template-columns:minmax(0,1fr) auto auto}.lca-mangelgruppe[data-lca-proces] summary span,.lca-mangelgruppe[data-lca-proces] summary strong{text-align:right;white-space:nowrap;font-size:11px}' +
    '@container (max-width:620px){.lca-bp-affald{grid-template-columns:1fr 1fr}.lca-mangelgruppe[data-lca-proces] summary{grid-template-columns:minmax(0,1fr) auto}.lca-mangelgruppe[data-lca-proces] summary strong{grid-column:2}}@container (max-width:420px){.lca-bp-affald{grid-template-columns:1fr}}';
  // Tre-trinsdesignet: fire kolonner ved ca. 1100 px; ved 600 px vises én kolonne ad gangen uden vandret rul.
  STIL += '.lca-trin>header{margin:8px 0 16px}.lca-trin>header h2,.lca-trin>header p{margin:2px 0}.lca-trin-nr{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--accent,#0f4c4c)}.lca-trin-kort{margin:14px 0;padding:12px;border:1px solid var(--border,#d5d5d5);border-radius:var(--r-md,8px);background:var(--bg-paper,#fff)}.lca-trin-naeste{display:flex;justify-content:flex-end;margin:18px 0}.lca-status-mangler{margin:0 0 10px;padding:10px;border:1px solid var(--warn,#8a6d1f);border-radius:var(--r-sm,4px);background:var(--bg-paper,#fff)}.lca-status-mangler h3{margin:0}.lca-status-mangler ul{list-style:none;padding:0;margin:5px 0}.lca-status-mangler li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 0;border-top:1px solid var(--line-soft,#ecefec)}' +
    '.lcak-top-status{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px}.lcak-top-status span:last-child{text-align:right}.lcak-top-status button{font-weight:700;text-align:center}.lcak-flade{grid-template-columns:repeat(4,minmax(0,1fr));gap:0;border:1px solid var(--border,#d5d5d5);border-radius:var(--r-md,8px);overflow:hidden}.lcak-nav{display:contents}.lcak-flade>.lcak-detalje{border:0;border-left:1px solid var(--border,#d5d5d5);border-radius:0;max-height:650px;overflow-y:auto}.lcak-mobil-sti{display:none}.lcak-faser-detalje{display:flex;flex-direction:column;gap:4px}.lcak-faser-detalje .lcak-fase{grid-template-columns:8px minmax(0,1fr) auto}.lcak-faser-detalje .lcak-hoved{margin-bottom:4px}' +
    '.lca-maengde-kilde{display:grid;grid-template-columns:1fr auto;gap:5px 8px;align-items:end}.lca-maengde-kilde>b,.lca-maengde-kilde>.lcak-chips{grid-column:1}.lca-maengde-kilde label{grid-column:2;grid-row:1/3;display:flex;flex-direction:column;gap:3px}.lca-maengde-kilde select{padding:5px;border:1px solid var(--border,#d5d5d5);border-radius:4px;background:var(--bg-paper,#fff);color:inherit}.lca-ai-forslag{padding:9px;border:1px solid var(--accent,#0f4c4c);border-radius:var(--r-sm,4px);background:var(--ok-bg,#e9f0ea)}.lca-ai-forslag>div{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:6px 0}.lca-ai-forslag button{margin:3px 4px 0 0}.lca-analyse-skift{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}.lca-analyse-skift button{padding:5px 9px;border:1px solid var(--border,#d5d5d5);border-radius:999px;background:var(--bg-paper,#fff);color:inherit}.lca-analyse-skift button[aria-pressed="true"]{background:var(--accent,#0f4c4c);color:var(--accent-ink,#fff)}.lca-analyse-bars>div{display:grid;grid-template-columns:minmax(150px,1fr) minmax(120px,2fr) 68px;gap:8px;align-items:center;padding:4px 0}.lca-analyse-bars i{height:12px;background:var(--line-soft,#ecefec);border-radius:99px;overflow:hidden}.lca-analyse-bars i b{display:block;height:100%;background:var(--accent,#0f4c4c)}.lca-analyse-bars strong,.lca-top-fem b{text-align:right;font-variant-numeric:tabular-nums}.lca-top-fem{padding-left:22px}.lca-top-fem li{display:grid;grid-template-columns:1fr auto;gap:8px;padding:4px}.lca-analyse-tabel>button{margin:7px 0}' +
    'button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid var(--accent,#0f4c4c);outline-offset:2px}' +
    '@container (max-width:620px){.lcak-flade{display:block;border:0;overflow:visible}.lcak-nav{display:block}.lcak-mobil-sti{display:flex;align-items:center;gap:10px;margin:5px 0 8px}.lcak-flade .lcak-kol,.lcak-flade>.lcak-detalje{display:none;border:1px solid var(--border,#d5d5d5);border-radius:var(--r-md,8px);max-height:none;overflow:visible}.lcak-vis-0 .lcak-kol:nth-child(1),.lcak-vis-1 .lcak-kol:nth-child(2),.lcak-vis-2 .lcak-kol:nth-child(3),.lcak-vis-3>.lcak-detalje{display:flex}.lcak-kaede-auto{display:none}.lcak-top-status{grid-template-columns:1fr 1fr}.lcak-top-status button{grid-column:1/-1;grid-row:2}.lcak-top-status span:last-child{text-align:right}.lca-maengde-kilde{grid-template-columns:1fr}.lca-maengde-kilde label{grid-column:1;grid-row:auto}.lca-analyse-bars>div{grid-template-columns:minmax(100px,1fr) 55px}.lca-analyse-bars i{grid-column:1/-1;grid-row:2}.lca-ai-forslag>div{grid-template-columns:1fr}}';
  STIL += '.lca-ai-hjaelp{margin:7px 0;padding:8px 10px;border-left:4px solid var(--accent,#0f4c4c);background:var(--bg-elev,#ecefec)}.lca-ai-hjaelp p{margin:2px 0;font-size:12px}.lca-produkt-spild{margin:10px 0}';
  // Runde 8: kompakt top, læsbare småtekster, faste tabeller og semantisk resultatbjælke.
  STIL += '.lcak-pane,.lca-status-mangler{box-sizing:border-box;width:100%;max-width:1500px;margin-left:auto;margin-right:auto}.lcak-faner button:last-child{margin-left:auto;border-left:1px solid var(--border,#d5d5d5)}' +
    '.lca-status-gruppe{margin-top:8px;padding-top:6px;border-top:1px solid var(--line-soft,#ecefec)}.lca-status-gruppe>ul{margin:3px 0}.lca-status-gruppe li>span{display:flex;flex-direction:column;min-width:0}.lca-status-gruppe li small{font-size:11px;color:var(--muted,#666)}' +
    '.lcak-dataset,.lca-analyse-bars span small{display:block;min-width:0;font-size:11px;font-weight:400;color:var(--muted,#666);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lca-analyse-bars span>b{display:block;overflow-wrap:anywhere}' +
    'table.lca th,.lca-maengde-kilde>small{font-size:11px!important}' +
    'table.lca.lcak-tabel{width:100%;min-width:0;max-width:100%;table-layout:fixed}table.lca.lcak-tabel th,table.lca.lcak-tabel td{min-width:0;overflow-wrap:anywhere;word-break:normal}' +
    '.lca-graensebar .lca-bar-grund{position:absolute;left:0;background:var(--ink-soft,#8a968f)!important}.lca-graensebar .lca-bar-grund.endelig-ok{background:var(--ok,#4a7c59)!important}.lca-graensebar .lca-bar-over{position:absolute;background:var(--warn,#b06b12)!important}.lca-overblik.fejl .lca-graensebar .lca-bar-grund,.lca-graensebar.foreloebig .lca-bar-grund{background:var(--ink-soft,#8a968f)!important}' +
    '.lca-rapport-fold{margin-top:9px}.lca-opdater-struktur{margin:8px 0}.lcak-top{max-width:1500px;margin-left:auto!important;margin-right:auto!important}' +
    '@container (max-width:620px){.lcak-top-main{align-items:center}.lcak-faner{flex-wrap:nowrap!important}.lcak-faner button{min-width:0;padding:6px 4px!important;font-size:11px!important}.lcak-top-status{display:flex!important;flex-wrap:nowrap;justify-content:space-between;gap:5px;white-space:nowrap;overflow:hidden}.lcak-top-status span,.lcak-top-status button{min-width:0;grid-column:auto!important;grid-row:auto!important;font-size:11px;overflow:hidden;text-overflow:ellipsis}.lcak-top-status button{flex:1 1 auto}.lcak-top-status span{flex:0 1 auto}.lcak-faner button:last-child{margin-left:auto}}';
  STIL += '.lcak-pane[data-lca-pane="bygning"],.lcak-pane[data-lca-pane="analyse"],.lcak-pane[data-lca-pane="bibliotek"]{max-width:1100px}.lcak-pane[data-lca-pane="model"]{max-width:none}' +
    '.lca-card .k{font-size:11px!important}.lcak-faner button{box-sizing:border-box;min-height:32px;font-size:13px!important}.lcak-faner button[aria-selected="true"]{background:var(--ok-bg,#e9f0ea);box-shadow:inset 0 -2px 0 var(--accent,#0f4c4c)}' +
    '.lcak-post:disabled,.lcak-tom-under{opacity:.45}.lcak-post:disabled{cursor:not-allowed}.lcak-flade>.lcak-detalje{align-self:start;height:auto;min-height:0}' +
    '@container (max-width:620px){.lcak-faner button{font-size:13px!important;min-height:32px}.lcak-flade>.lcak-detalje{height:auto;min-height:0}}';
  function stil() {
    if (typeof document === 'undefined' || !document.head || !document.createElement || document.getElementById('issana-lca-stil')) return;
    var el = document.createElement('style'); el.id = 'issana-lca-stil'; el.textContent = STIL; document.head.appendChild(el);
  }
  function tegn(body, source, motor) {
    stil();
    motor = motor || (typeof window !== 'undefined' ? window.issanaLca : null);
    var state = body.lcaValg || (body.lcaValg = {del:0, type:0, levetidFor:null, besked:null, fejl:null, imp:null, impNavn:null, ret:null, retFane:'datasaet', filterDel:'', kunMangler:false});
    // EPD-databaserne gemmes i browserens lager (pr. bruger); motor.epdLager i tests.
    var lager = motor && motor.epdLager ? motor.epdLager : (typeof localStorage !== 'undefined' ? localStorage : null);
    // LCAbyg-biblioteket vises som en ekstra EPD-liste ved siden af databaserne; indekset i listen følger alleDatabaser().
    function alleDatabaser() {
      var bib = motor && motor.bibliotek ? motor.bibliotek() : null, Bm = bibModul({ bibliotekModul: motor && motor.bibliotekModul });
      if (!bib || !Bm) return epdDatabaser(lager);
      if (state.bibDbKilde !== bib) { state.bibDbKilde = bib; state.bibDb = Bm.somEpdDatabase(bib); }
      return epdDatabaser(lager).concat([state.bibDb]);
    }
    if (motor && motor.bibliotekHent && !state.bibHentet) { state.bibHentet = true; motor.bibliotekHent().then(function () { draw(); }, function () {}); }
    function t() { return { erRevit: !!(motor && motor.erRevit && motor.erRevit()), igang: !!(motor && motor.igang && motor.igang()), info: state.info || null, fejl: state.fejl || (motor && motor.fejl ? motor.fejl() : null), besked: state.besked, aabenDrift: !!state.aabenDrift, forslagForsoegt: state.forslagForsoegt || null }; }
    function fagKoblinger() {
      if (typeof document === 'undefined' || !document.querySelector) return [];
      return ['lyd', 'varmetab', 'energi', 'pris'].filter(function (id) { return !!document.querySelector('#tabs [data-tab="' + id + '"]'); }).map(function (id) { return { id: id, findes: true }; });
    }
    // Tabellens valg: Rusts sidste svar (eller projektet uden tal før første beregning), filtre og den åbne «Ret»-række.
    function tabelValg() {
      var tb = motor && motor.tabel ? motor.tabel(state.omfang || undefined) : null, fane = state.retFane || 'datasaet', sid = motor && motor.sidste ? motor.sidste() : null;
      return { epdForslag: motor && motor.antalEpdForslag ? motor.antalEpdForslag() : 0, levetidFor: state.levetidFor,
        omfang: state.omfang || null, udsnit: tb && tb.udsnit || null, venter: !!(tb && tb.venter), etager: motor.etager ? motor.etager() : [],
        ret: state.ret, fane: fane, filterDel: state.filterDel, kunMangler: state.kunMangler, beregning: tb ? tb.b : null, foraeldet: !!(tb && tb.foraeldet), regnet: !!(tb && tb.regnet),
        kDel: state.kDel, kUnder: state.kUnder || null, kKon: state.kKon, kBv: state.kBv,
        mobileKol: state.mobileKol == null ? 0 : state.mobileKol, kBvValgtAfBruger: !!state.kBvValgtAfBruger,
        bvFilter: state.bvFilter || 'alle', fEdit: state.fEdit || null, faktorGemt: state.faktorGemt || null,
        retKilde: state.retKilde || null, tabelAaben: !!state.tabelAaben, visTommeDele: !!state.visTommeDele,
        aiTilgaengelig: !!(motor && motor.aiTilgaengelig && motor.aiTilgaengelig()), visStatusMangler: !!state.visStatusMangler, statusVisAlle: state.statusVisAlle || {},
        sammeFag: fagKoblinger(),
        bygningsdeleKatalog: typeof window !== 'undefined' && window.IssanaLcaBygningsdele || (motor && motor.bygningsdeleKatalog) || null,
        epdDatabaser: epdDatabaser(lager), alleEpdDb: alleDatabaser(), dbSoeg: state.dbSoeg || '', egenForslag: state.egenForslag || null,
        bibliotek: motor && motor.bibliotek ? motor.bibliotek() : null, bibliotekModul: motor && motor.bibliotekModul || null,
        opbSoeg: state.opbSoeg || '', opbVis: state.opbVis || null, opbGemt: !!state.opbGemt,
        bibliotekSoeg: state.bibliotekSoeg || '', bibFilter: state.bibFilter || 'alle', bibLimit: state.bibLimit || 20,
        harValgtBv: !!state.kBvValgtAfBruger,
        projektNavn: sid && sid.rust && sid.rust.project_name || (typeof document !== 'undefined' && document.title) || 'projekt',
        kandidater: state.ret && fane === 'datasaet' && motor.kandidater ? motor.kandidater(state.ret) : [], datasaet: motor.datasaet ? motor.datasaet() : [] };
    }
    // En ny tegning (fx når ISSANA LCA er færdig med at regne) må ikke slette det, brugeren er ved at taste i «Ret»-rækken.
    function gemFelter() {
      if (!state.ret || !body.querySelectorAll) return null;
      var ud = { ret: state.ret, fane: state.retFane, felter: [] };
      Array.prototype.forEach.call(body.querySelectorAll('.lca-ret-boks input,.lca-ret-boks select'), function (el) {
        for (var i = 0; el.attributes && i < el.attributes.length; i++) { var a = el.attributes[i]; if (/^data-lca-t-/.test(a.name)) { ud.felter.push({ sel: '[' + a.name + (a.value ? '="' + a.value + '"' : '') + ']', v: el.value, c: el.checked }); return; } }
      });
      return ud;
    }
    function genskabFelter(g) {
      if (!g || g.ret !== state.ret || g.fane !== state.retFane || !body.querySelector) return;
      g.felter.forEach(function (f) { var el = body.querySelector(f.sel); if (!el) return; if (el.type === 'checkbox') el.checked = f.c; else el.value = f.v; });
    }
    function rapportModul() { return (motor && motor.typstRapport) || (typeof window !== 'undefined' ? window.IssanaTypstRapport : null) || null; }
    function rapportInfo(s) { return { projekt: (s && s.rust && s.rust.project_name) || (typeof document !== 'undefined' ? document.title : '') || 'projekt', dato: new Date().toLocaleDateString('da-DK') }; }
    function draw() {
      var gemt = gemFelter();
      var sidste = motor && motor.sidste ? motor.sidste() : null;
      var forslag = motor && motor.forslagReferenceareal ? motor.forslagReferenceareal() : null;
      var tv = motor ? tabelValg() : {};
      // Kolonnernes valg holdes fast (også standardvalget), så en ny beregning, hvor en anden bygningsdel er størst, ikke flytter det.
      if (tv.beregning) {
        var v0 = kolonneValg(tv.beregning, tv);
        state.kDel = tv.kDel = v0.d ? v0.d.id : null;
        state.kUnder = tv.kUnder = v0.under || null;
        state.kKon = tv.kKon = v0.k ? v0.k.id : null;
        state.kBv = tv.kBv = v0.bv ? v0.bv.id : null;
        tv.valgtBv = v0.bv;
        tv.valgtKonstruktion = v0.k;
        tv.mistænkeligeTypeIds = mistænkeligeForslag(tv.beregning);
        tv.bulkEpdForslag = motor && motor.antalEpdForslag ? motor.antalEpdForslag(tv.mistænkeligeTypeIds) : Math.max(0, tv.epdForslag - tv.mistænkeligeTypeIds.length);
      }
      tv.projektNavn = sidste && sidste.rust && sidste.rust.project_name || (typeof document !== 'undefined' && document.title) || 'projekt';
      var struktur = '<div class="lca-opdater-struktur"><button class="tbtn" data-lca-opdater>Opdater struktur</button></div>';
      if (!motor) { body.innerHTML = '<p class="issana-mangler">ISSANA LCA-koblingen er ikke indlæst (arbejdsrum-ai.js).</p>' + struktur; return; }
      // Alle trin ligger i siden (de skjulte med hidden), så felter og valg bevares.
      var o0 = sidste && sidste.oversigt, fane = state.lcaFane || 'bygning', g0 = motor.indstillinger ? motor.indstillinger() : {}, tt = t();
      if (fane === 'resultat' || fane === 'rapport') fane = state.lcaFane = 'analyse';
      if (fane === 'spild') fane = state.lcaFane = 'bygning';
      tv.iFane = true;
      tv.udenDataAntal = udenDataAntal(o0, tv.beregning, tv);
      tv.handling = primaerHandling(g0, o0, tt, tv.bulkEpdForslag == null ? tv.epdForslag : tv.bulkEpdForslag);
      body.innerHTML = '<div data-lca-dialog-host></div>' + toppenHtml(tt, o0, fane, g0, tv.beregning, tv) + (state.visStatusMangler ? statusManglerHtml(g0, o0, tv.beregning, tv) : '') +
        panel('bygning', fane, bygningTrinHtml(g0, forslag, tt, tv.beregning, o0)) +
        panel('model', fane, (tv.beregning || tv.venter ? kolonnerHtml(tv.beregning, tv) : '<p class="v3-hint">Hent modellen fra Revit, så vises bygningsdelene her.</p>') + importHtml(state.imp, state.impNavn) + struktur) +
        panel('bibliotek', fane, bibliotekListeHtml(tv)) +
        panel('analyse', fane, analyseTrinHtml(tv, o0, sidste && sidste.ud, rapportInfo(sidste), rapportModul(), state.analyseNiveau || 'dele')) + statusHtml(tt);
      // Retain the dialog DOM and its answers across calculation redraws.
      var dialogSlot=body.querySelector && body.querySelector('[data-lca-dialog-host]');
      var Dialog=typeof window!=='undefined' && window.IssanaLcaDialog;
      if(dialogSlot && Dialog && motor.dialogSend && motor.dialogModel && body.ownerDocument){
        if(!state.dialogHost){
          state.dialogHost=body.ownerDocument.createElement('div');
          state.dialog=Dialog.mount(state.dialogHost,{model:motor.dialogModel,settings:motor.indstillinger,save:motor.dialogGem || motor.indstillinger,
            areaSuggestion:motor.forslagReferenceareal,send:motor.dialogSend},BYGNINGSTYPER);
        }
        state.dialog.sync();
        dialogSlot.appendChild(state.dialogHost);
      }
      genskabFelter(gemt);
    }
    function vaerdi(sel) { var el = body.querySelector ? body.querySelector(sel) : null; return el ? el.value : ''; }
    function svarRet(r, tekst) {
      if (!r || !r.ok) { state.fejl = (r && r.fejl) || 'Ændringen kunne ikke gemmes.'; draw(); return; }
      state.fejl = null; state.besked = tekst; state.ret = null; draw();
    }
    var EGEN_FELTER = ['navn', 'enhed', 'A1A3', 'C3', 'C4', 'D', 'densitet', 'scenarieC3', 'scenarieC4', 'registreringsnr', 'programoperatoer', 'producent', 'url', 'placering', 'verificeret', 'en15804', 'gwpIndikator', 'type', 'udstedt', 'udloeb', 'anvendt'];
    function egenEpdFraFelter() {
      var v = {}; EGEN_FELTER.forEach(function (k) { v[k] = String(vaerdi('[data-lca-t-egen="' + k + '"]') || '').trim(); });
      var dk = body.querySelector ? body.querySelector('[data-lca-t-egen="daekker"]') : null, dn = body.querySelector ? body.querySelector('[data-lca-t-egen="dNul"]') : null;
      return { navn: v.navn, enhed: v.enhed, densitet: tal0(v.densitet), gwp: { A1A3: tal0(v.A1A3), C3: tal0(v.C3), C4: tal0(v.C4), D: tal0(v.D) },
        epd: { registreringsnr: v.registreringsnr || null, programoperatoer: v.programoperatoer || null, producent: v.producent || null, url: v.url || null, placering: v.placering || null,
          verificeret: v.verificeret || 'unknown', en15804: v.en15804 || 'unknown', gwpIndikator: v.gwpIndikator || 'unknown', type: v.type || 'unknown',
          udstedt: v.udstedt || null, udloeb: v.udloeb || null, anvendt: v.anvendt || null, scenarieC3: v.scenarieC3 || null, scenarieC4: v.scenarieC4 || null, daekker: !!(dk && dk.checked), dNul: !!(dn && dn.checked) } };
    }
    function koer(p, efter) { state.fejl = null; state.besked = null; draw(); return p.then(function (r) { if (efter) efter(r); draw(); return r; }, function (e) { state.fejl = e && e.message || String(e); draw(); }); }
    function hentInfo() { if (motor && motor.info && motor.erRevit && motor.erRevit()) motor.info().then(function (i) { state.info = i; draw(); }, function () {}); }
    // Den valgte byggevare i kolonnerne (samme valg som tegningen).
    function valgtBv() { var tv = tabelValg(); if (!tv.beregning) return null; var v = kolonneValg(tv.beregning, tv); return v.bv ? v : null; }
    function vaelgMangel(hit) {
      if (!hit) return false;
      state.lcaFane = 'model';
      state.bvFilter = 'uden';
      state.kDel = hit.d.id;
      state.kUnder = hit.under;
      state.kKon = hit.k.id;
      state.kBv = hit.bv.id;
      state.kBvValgtAfBruger = true;
      state.fEdit = null;
      if (motor.vaelg && hit.bv.elementIds) motor.vaelg(hit.bv.elementIds);
      draw();
      var detalje = body.querySelector && body.querySelector('[data-lca-k-detalje="' + hit.bv.id + '"]');
      if (detalje && detalje.scrollIntoView) detalje.scrollIntoView({ block: 'nearest' });
      return true;
    }
    function tilfoejBiblioteksFiler(filer) {
      if (!motor.bibliotekTilfoej || !filer || !filer.length) return;
      Promise.all(Array.prototype.slice.call(filer).map(function (f) { return new Promise(function (ok) { var r = new FileReader(); r.onload = function () { ok({ navn: f.name, tekst: String(r.result || '') }); }; r.onerror = function () { ok({ navn: f.name, tekst: '' }); }; r.readAsText(f, 'utf-8'); }); }))
        .then(function (l) { return motor.bibliotekTilfoej(l); })
        .then(function (r) {
          state.fejl = r.afvist.length ? r.afvist.map(function (a) { return a.navn + ': ' + a.fejl; }).join(' ') : null;
          state.besked = r.ok.length ? r.nyeProdukter + ' nye byggevarer og ' + r.nyeKonstruktioner + ' nye opbygninger fra ' + r.ok.length + ' filer.' + (r.ufuldstaendige ? ' ' + r.ufuldstaendige + ' opbygninger er sprunget over, fordi eksporten kun henviser til LCAbygs egne byggevarer.' : '') : null;
          draw();
        }, function (x) { state.fejl = x.message; draw(); });
    }
    body.onclick = function(e) {
      // «Alle byggevarer i én tabel» huskes åben, så en ny tegning ikke lukker den.
      var sm = e.target.closest('[data-lca-tabel-ud]>summary'); if (sm && sm.tagName === 'SUMMARY') { state.tabelAaben = !sm.parentNode.open; return; }
      var b = e.target.closest('[data-lca-del],[data-lca-type],[data-lca-opdater],[data-lca-beregn],[data-lca-aabn],[data-lca-import],[data-lca-vaelg],[data-lca-brug-areal],[data-lca-levetid],[data-lca-foreslaa],[data-lca-bekraeft],[data-lca-udfyld],[data-lca-udfyld-bygning],[data-lca-lv-gem],' +
        '[data-lca-ret],[data-lca-ret-fane],[data-lca-brug-ds],[data-lca-brug-soeg],[data-lca-egen-gem],[data-lca-fjern],[data-lca-t-m-gem],[data-lca-t-m-fjern],[data-lca-t-lv-gem],[data-lca-t-lv-fjern],' +
        '[data-lca-k-del],[data-lca-k-under],[data-lca-k-kon],[data-lca-k-bv],[data-lca-k-ret],[data-lca-bv-filter],[data-lca-f-form],[data-lca-f-lag],[data-lca-f-gem],[data-lca-f-gem-alle],[data-lca-f-fjern],' +
        '[data-lca-bib-fil],[data-lca-bib-toem],[data-lca-bib-filter],[data-lca-bib-flere],[data-lca-opb-vis],[data-lca-opb-brug],[data-lca-opb-fjern],[data-lca-gem-opb],[data-lca-brug-bib-ds],[data-lca-vaelg-data],[data-lca-vis-mangel],[data-lca-vis-produkt],[data-lca-naeste-mangel],[data-lca-vis-tomme],[data-lca-db-fil],[data-lca-db-kobl],[data-lca-db-opdater],[data-lca-db-fjern],[data-lca-db-brug],[data-lca-rapport],[data-lca-rapport-print],[data-lca-fane],' +
        '[data-lca-status-mangler],[data-lca-status-vis-alle],[data-lca-mobile-tilbage],[data-lca-analyse-niveau],[data-lca-analyse-kon],[data-lca-kopier-analyse],[data-lca-bekraeft-produkt],[data-lca-fortryd-forslag],[data-lca-brug-alle-materiale],[data-lca-samme-fag]'); if (!b) return;
      if (b.hasAttribute('data-lca-status-mangler')) { state.visStatusMangler = !state.visStatusMangler; draw(); return; }
      if (b.hasAttribute('data-lca-status-vis-alle')) { var sgid = b.getAttribute('data-lca-status-vis-alle'); state.statusVisAlle = state.statusVisAlle || {}; state.statusVisAlle[sgid] = !state.statusVisAlle[sgid]; draw(); return; }
      if (b.hasAttribute('data-lca-mobile-tilbage')) { state.mobileKol = Math.max(0, (state.mobileKol || 0) - 1); draw(); return; }
      if (b.hasAttribute('data-lca-analyse-niveau')) { state.analyseNiveau = b.getAttribute('data-lca-analyse-niveau'); draw(); return; }
      if (b.hasAttribute('data-lca-analyse-kon')) {
        var tvA = tabelValg(), kidA = b.getAttribute('data-lca-analyse-kon'), hitA = null;
        (tvA.beregning && tvA.beregning.dele || []).some(function (d) { return (d.konstruktioner || []).some(function (k) { if (k.id !== kidA) return false; hitA = { d: d, under: k.underkategori || null, k: k, bv: (k.byggevarer || [])[0] || null }; return true; }); });
        if (hitA) { state.lcaFane = 'model'; state.kDel = hitA.d.id; state.kUnder = hitA.under; state.kKon = hitA.k.id; state.kBv = hitA.bv && hitA.bv.id; state.mobileKol = 2; draw(); }
        return;
      }
      if (b.hasAttribute('data-lca-kopier-analyse')) {
        var rows = analysePoster(tabelValg().beregning, 'konstruktioner').sort(function (x, y) { return y.rate - x.rate; });
        var txt = ['Konstruktion\tkg CO2e/m2/år'].concat(rows.map(function (x) { return x.navn + '\t' + x.rate; })).join('\n');
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt);
        state.besked = 'Tallene bag diagrammet er kopieret.'; draw(); return;
      }
      if (b.hasAttribute('data-lca-samme-fag')) {
        var fag = b.getAttribute('data-lca-samme-fag'), fvFag = valgtBv();
        if (fvFag && motor.vaelg) motor.vaelg(fvFag.bv.elementIds || fvFag.k.elementIds || []);
        if (motor.aabnFag) motor.aabnFag(fag, state.kKon);
        else if (typeof window !== 'undefined' && window.issanaArbejdsrum && window.issanaArbejdsrum.api && window.issanaArbejdsrum.api.skiftFane) window.issanaArbejdsrum.api.skiftFane(fag);
        return;
      }
      if (b.hasAttribute('data-lca-fane')) {
        state.lcaFane = b.getAttribute('data-lca-fane');
        state.opbGemt = null;
        draw();
        return;
      }
      if (b.hasAttribute('data-lca-udfyld-bygning')) { state.lcaFane = 'bygning'; draw(); return; }
      if (b.hasAttribute('data-lca-bib-filter')) { state.bibFilter = b.getAttribute('data-lca-bib-filter'); state.bibLimit = 20; draw(); return; }
      if (b.hasAttribute('data-lca-bib-flere')) { state.bibLimit = (state.bibLimit || 20) + 20; draw(); return; }
      if (b.hasAttribute('data-lca-bv-filter')) { state.bvFilter = b.getAttribute('data-lca-bv-filter'); draw(); return; }
      if (b.hasAttribute('data-lca-vis-tomme')) { state.visTommeDele = !state.visTommeDele; draw(); return; }
      if (b.hasAttribute('data-lca-vis-produkt')) {
        var tvP = tabelValg();
        vaelgMangel(tvP.beregning && modelValgForProdukt(tvP.beregning, tvP, b.getAttribute('data-lca-vis-produkt')));
        return;
      }
      if (b.hasAttribute('data-lca-naeste-mangel')) {
        var tvN = tabelValg();
        vaelgMangel(tvN.beregning && modelValgForMangel(tvN.beregning, tvN, null, state.kBv));
        return;
      }
      if (b.hasAttribute('data-lca-vaelg-data') || b.hasAttribute('data-lca-vis-mangel')) {
        var tvM = tabelValg(), pidM = null;
        if (b.hasAttribute('data-lca-vis-mangel')) { var sM = motor.sidste && motor.sidste(), gM = sM && sM.oversigt && (sM.oversigt.grupper || []).filter(function (x) { return x.id === b.getAttribute('data-lca-vis-mangel'); })[0], iM = gM && gM.mangler && gM.mangler[0]; pidM = iM && (iM.id || iM.target_id); }
        vaelgMangel(tvM.beregning && modelValgForMangel(tvM.beregning, tvM, pidM));
        return;
      }
      if (b.hasAttribute('data-lca-gem-opb')) {
        var tvG = tabelValg(), vG = tvG.beregning ? kolonneValg(tvG.beregning, tvG) : null;
        if (!vG || !vG.k || !motor.bibliotekGemProjekt) return;
        koer(motor.bibliotekGemProjekt(vG.k, tvG.projektNavn || 'projekt'), function () {
          state.bibFilter = 'mine';
          state.opbGemt = true;
        });
        return;
      }
      if (b.hasAttribute('data-lca-brug-bib-ds')) { var vb = valgtBv(); if (vb) svarRet(motor.vaelgEpd(vb.bv.id, { datasaet: b.getAttribute('data-lca-brug-bib-ds') }), 'Datasættet er valgt på byggevaren.'); return; }
      if (b.hasAttribute('data-lca-rapport-print')) {
        var Rq = rapportModul(), vis = body.querySelector ? body.querySelector('[data-lca-rapport-visning]') : null;
        if (Rq && Rq.html && vis) Rq.html.print(vis.innerHTML, 'LCA-rapport');
        return;
      }
      if (b.hasAttribute('data-lca-rapport')) {
        var Rp = rapportModul(), s0 = motor.sidste ? motor.sidste() : null, tv0 = tabelValg();
        if (!Rp) { state.fejl = 'Rapportmodulet er ikke indlæst (rapport-typst.js).'; draw(); return; }
        if (!s0 || !s0.oversigt || !tv0.beregning) { state.fejl = 'Tryk «Beregn med ISSANA LCA» først.'; draw(); return; }
        var ri = rapportInfo(s0), filn = 'ISSANA-LCA-rapport-' + String(ri.projekt).replace(/[^A-Za-z0-9æøåÆØÅ_-]+/g, '-').replace(/^-+|-+$/g, '') + '.typ';
        var typ = lcaRapportTypst(tv0.beregning, s0.oversigt, ri, Rp, tv0);
        Rp.gem(filn, typ); state.fejl = null; state.besked = 'Rapporten er gemt som ' + filn + ' i Overførsler. Åbn den i ISSANA Compose, eller lav en PDF med «typst compile».'; draw(); return;
      }
      // Kolonnerne: vælg bygningsdel (et nyt klik på den valgte viser alle dens underkategorier), underkategori, konstruktion og byggevare.
      if (b.hasAttribute('data-lca-k-del')) {
        var nyDel = b.getAttribute('data-lca-k-del');
        if (nyDel !== state.kDel || !state.kUnder) { state.kDel = nyDel; state.kKon = null; state.kBv = null; state.kBvValgtAfBruger = false; }
        state.kUnder = null;
        var tvD = tabelValg(), delD = tvD.beregning && kolonneValg(tvD.beregning, Object.assign({}, tvD, { kDel: nyDel, kUnder: null, kKon: null, kBv: null })).d;
        var medIndhold = delD ? (delD.underkategorier || []).filter(function (u) { return delD.konstruktioner.some(function (k) { return k.underkategori === u; }); }) : [];
        if (medIndhold.length === 1) state.kUnder = medIndhold[0];
        state.mobileKol = delD && (delD.underkategorier || []).length && medIndhold.length !== 1 ? 0 : 1;
        state.fEdit = null; draw(); return;
      }
      if (b.hasAttribute('data-lca-k-under')) { var nu = b.getAttribute('data-lca-k-under'); state.kUnder = state.kUnder === nu ? null : nu; state.kKon = null; state.kBv = null; state.kBvValgtAfBruger = false; state.mobileKol = state.kUnder ? 1 : 0; state.fEdit = null; draw(); return; }
      // EPD-databaser: tilføj fil, kobl til adresse, opdatér, fjern; «Brug» fylder «Egen EPD» ud for den valgte byggevare.
      if (b.hasAttribute('data-lca-bib-fil')) { var bibInp = body.querySelector && body.querySelector('[data-lca-bib-input]'); if (bibInp) bibInp.click(); return; }
      if (b.hasAttribute('data-lca-bib-toem')) { motor.bibliotekRyd().then(function () { state.fejl = null; state.besked = 'LCAbyg-biblioteket er tømt. Opbygninger, du allerede har brugt, står stadig på konstruktionerne.'; draw(); }, function (x) { state.fejl = x.message; draw(); }); return; }
      if (b.hasAttribute('data-lca-opb-vis')) { var ov = b.getAttribute('data-lca-opb-vis'); state.opbVis = state.opbVis === ov ? null : ov; draw(); return; }
      if (b.hasAttribute('data-lca-opb-brug') || b.hasAttribute('data-lca-opb-fjern')) {
        var tvO = tabelValg(), vO = tvO.beregning ? kolonneValg(tvO.beregning, tvO) : null, kO = vO && vO.k;
        if (!kO || kO.typeId == null || !motor.opbygning) return;
        if (b.hasAttribute('data-lca-opb-fjern')) { svarRet(motor.opbygning(kO.typeId, null), 'Revit-typens egne lag bruges igen. ISSANA LCA regner igen.'); return; }
        var opbNy = bibModul(tvO).opbygning(tvO.bibliotek, b.getAttribute('data-lca-opb-brug'));
        if (!opbNy) return;
        state.kBv = null; state.fEdit = null; state.opbVis = null;
        svarRet(motor.opbygning(kO.typeId, opbNy), '«' + opbNy.navn + '» bruges nu på «' + kO.navn + '». ISSANA LCA regner igen.');
        return;
      }
      if (b.hasAttribute('data-lca-db-fil')) { var dbInp = body.querySelector && body.querySelector('[data-lca-db-input]'); if (dbInp) dbInp.click(); return; }
      if (b.hasAttribute('data-lca-db-kobl') || b.hasAttribute('data-lca-db-opdater')) {
        var dbs0 = epdDatabaser(lager), oi = b.hasAttribute('data-lca-db-opdater') ? +b.getAttribute('data-lca-db-opdater') : -1;
        var url = oi >= 0 ? (dbs0[oi] || {}).url : String(vaerdi('[data-lca-db-url]') || '').trim();
        if (!/^https?:\/\//i.test(url || '')) { state.fejl = 'Skriv en adresse, der begynder med https://.'; draw(); return; }
        if (typeof fetch !== 'function') { state.fejl = 'Denne visning kan ikke hente adresser.'; draw(); return; }
        koer(fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('svar ' + r.status); return r.text(); }).then(function (tekst) {
          var dbNy = laesEpdDatabase(tekst, url.split('/').pop() || url); if (dbNy.fejl) throw new Error(dbNy.fejl);
          var post0 = { navn: dbNy.navn, url: url, hentet: new Date().toISOString(), epd: dbNy.epd, sprunget: dbNy.sprunget.length };
          if (oi >= 0) dbs0[oi] = post0; else dbs0.push(post0);
          gemEpdDatabaser(lager, dbs0);
          return '«' + dbNy.navn + '»: ' + dbNy.epd.length + ' EPD\'er ' + (oi >= 0 ? 'opdateret' : 'koblet til') + (dbNy.sprunget.length ? ' (' + dbNy.sprunget.length + ' sprunget over, fx ' + dbNy.sprunget[0].grund + ')' : '') + '.';
        }).catch(function (e) { throw new Error('Kunne ikke hente ' + url + ': ' + (e && e.message || e) + '. Serveren skal tillade, at ISSANA 3D henter filen; ellers hent filen, og brug «Tilføj EPD-database».'); }),
          function (besked) { state.besked = besked; });
        return;
      }
      if (b.hasAttribute('data-lca-db-fjern')) { var dbs1 = epdDatabaser(lager), fi = +b.getAttribute('data-lca-db-fjern'), fjernet = dbs1.splice(fi, 1)[0]; gemEpdDatabaser(lager, dbs1); state.besked = fjernet ? '«' + fjernet.navn + '» er fjernet fra EPD-databaserne. Byggevarer, der allerede bruger en EPD derfra, beholder den.' : null; draw(); return; }
      if (b.hasAttribute('data-lca-db-brug')) {
        var bk0 = String(b.getAttribute('data-lca-db-brug')).split(':'), dbs2 = alleDatabaser(), db2 = dbs2[+bk0[0]], x2 = db2 && db2.epd[+bk0[1]], bvv = valgtBv();
        if (!x2 || !bvv) return;
        state.egenForslag = { pid: bvv.bv.id, post: epdTilEgen(x2, new Date().toISOString().slice(0, 10)), db: db2.navn };
        state.ret = bvv.bv.id; state.retFane = 'egen'; state.retKilde = 'kolonner'; state.fejl = null;
        state.besked = 'Felterne er udfyldt fra «' + db2.navn + '». Tjek dem, sæt «EPD\'en dækker netop denne byggevare», og tryk «Brug den egne EPD».';
        draw(); return;
      }
      if (b.hasAttribute('data-lca-k-kon')) { state.kKon = b.getAttribute('data-lca-k-kon'); state.kBv = null; state.kBvValgtAfBruger = false; state.mobileKol = 2; state.fEdit = null; state.faktorGemt = null; draw(); return; }
      if (b.hasAttribute('data-lca-k-bv')) { state.kBv = b.getAttribute('data-lca-k-bv'); state.kBvValgtAfBruger = true; state.mobileKol = 3; state.fEdit = null; state.faktorGemt = null; draw(); return; }
      if (b.hasAttribute('data-lca-k-ret')) {
        var kv = valgtBv(), kf = b.getAttribute('data-lca-k-ret'); if (!kv) return;
        if (state.ret === kv.bv.id && state.retKilde === 'kolonner' && state.retFane === kf) state.ret = null;
        else { state.ret = kv.bv.id; state.retFane = kf; state.retKilde = 'kolonner'; }
        state.fejl = null; draw(); return;
      }
      // Omregningsfaktoren: enhed, lagtype og gem (motor.maengde med faktor og kilde); ISSANA LCA regner igen.
      if (b.hasAttribute('data-lca-f-form') || b.hasAttribute('data-lca-f-lag')) {
        var fv = valgtBv(); if (!fv) return;
        var fr0 = Object.assign({}, faktorRedigering(fv.bv, state.fEdit));
        if (b.hasAttribute('data-lca-f-form')) { fr0.form = b.getAttribute('data-lca-f-form'); if (fr0.t == null && (fv.bv.ref || {}).tykkelseMm != null) fr0.t = fv.bv.ref.tykkelseMm; if (fr0.form === 'm2direkte' && fr0.v == null) fr0.v = 1; }
        else fr0.lagtype = b.getAttribute('data-lca-f-lag');
        state.fEdit = fr0; state.faktorGemt = null; draw(); return;
      }
      if (b.hasAttribute('data-lca-bekraeft-produkt') || b.hasAttribute('data-lca-fortryd-forslag') || b.hasAttribute('data-lca-brug-alle-materiale')) {
        var pv = valgtBv(); if (!pv) return;
        if (b.hasAttribute('data-lca-fortryd-forslag')) { svarRet(motor.fjernEpd(pv.bv.id), 'Forslaget er fortrudt.'); return; }
        var keyP = pv.bv.datasaet && (pv.bv.datasaet.key || pv.bv.datasaet.id); if (!keyP) return;
        if (b.hasAttribute('data-lca-bekraeft-produkt')) { svarRet(motor.vaelgEpd(pv.bv.id, { datasaet: keyP }), 'Forslaget er bekræftet og bruges nu i beregningen.'); return; }
        var matP = String((pv.bv.ref || {}).materiale || pv.bv.navn), antalP = 0, tvP2 = tabelValg();
        (tvP2.beregning.dele || []).forEach(function (d) { (d.konstruktioner || []).forEach(function (k) { (k.byggevarer || []).forEach(function (x) { if (String((x.ref || {}).materiale || x.navn) === matP && x.ref && x.ref.kanAendres) { var rP = motor.vaelgEpd(x.id, { datasaet: keyP }); if (rP && rP.ok) antalP++; } }); }); });
        state.besked = 'Forslaget bruges nu på ' + antalP + ' lag med «' + matP + '».'; draw(); return;
      }
      if (b.hasAttribute('data-lca-f-gem') || b.hasAttribute('data-lca-f-gem-alle')) {
        var gv = valgtBv(); if (!gv || !motor.maengde) return;
        var rr = faktorRedigering(gv.bv, state.fEdit), ff = omregningsfaktor(faktorBv(gv.bv), gv.k, rr);
        if (ff.fejl) { state.fejl = ff.fejl; draw(); return; }
        state.fEdit = null;
        state.faktorGemt = gv.bv.id;
        setTimeout(function () {
          if (state.faktorGemt === gv.bv.id) { state.faktorGemt = null; draw(); }
        }, 1600);
        if (ff.form === 'model' && ff.andel === 1) { svarRet(motor.maengde(gv.bv.id, null), 'Modellens mængde bruges. ISSANA LCA regner igen.'); return; }
        var felter = {}; ['t', 'rho', 'bb', 'hh', 'ccl', 'qm', 'v', 'vk', 'M', 'lagtype', 'b', 'cc'].forEach(function (n) { if (rr[n] != null && rr[n] !== '') felter[n] = rr[n]; });
        if (ff.form === 'model') felter.grund = ff.grund;
        if (b.hasAttribute('data-lca-f-gem-alle')) {
          var mat = String((gv.bv.ref || {}).materiale || gv.bv.navn), tvAlle = tabelValg(), nAlle = 0;
          (tvAlle.beregning.dele || []).forEach(function (d) { (d.konstruktioner || []).forEach(function (k) { (k.byggevarer || []).forEach(function (x) { if (String((x.ref || {}).materiale || x.navn) === mat && x.ref && (x.ref.kanAendres || x.ref.kanAendreMaengde)) { var fx = omregningsfaktor(faktorBv(x), k, rr); if (!fx.fejl) { var rrA = motor.maengde(x.id, { faktor: fx.gem, kilde: faktorKilde(fx, rr), form: fx.form, felter: felter }); if (rrA && rrA.ok) nAlle++; } } }); }); });
          state.fEdit = null; state.besked = 'Mængden bruges nu på ' + nAlle + ' lag med «' + mat + '». ISSANA LCA regner igen.'; draw(); return;
        }
        svarRet(motor.maengde(gv.bv.id, { faktor: ff.gem, kilde: faktorKilde(ff, rr), form: ff.form, felter: felter }),
          'Omregningsfaktoren ' + sig(ff.vaerdi, 5) + ' ' + enhedPen(ff.taeller) + '/' + enhedPen(ff.naevner) + ' er gemt for «' + gv.bv.navn + '». ISSANA LCA regner igen.');
        return;
      }
      if (b.hasAttribute('data-lca-f-fjern')) { var fj = valgtBv(); if (!fj || !motor.maengde) return; state.fEdit = null; svarRet(motor.maengde(fj.bv.id, null), 'Modellens mængde bruges igen. ISSANA LCA regner igen.'); return; }
      // Tabellen: «Ret» åbner/lukker rækken; et valg gemmes af motoren (forslag → bekræft på typen), og ISSANA LCA regner igen.
      if (b.hasAttribute('data-lca-ret')) { var rp = b.getAttribute('data-lca-ret'); state.ret = state.ret === rp && state.retKilde !== 'kolonner' ? null : rp; state.retKilde = 'tabel'; state.retFane = 'datasaet'; state.fejl = null; draw(); return; }
      if (b.hasAttribute('data-lca-ret-fane')) { state.retFane = b.getAttribute('data-lca-ret-fane'); draw(); return; }
      if (state.ret && (b.hasAttribute('data-lca-brug-ds') || b.hasAttribute('data-lca-brug-soeg'))) {
        var key = b.hasAttribute('data-lca-brug-ds') ? b.getAttribute('data-lca-brug-ds') : null;
        if (!key) { var ds = findDatasaet(motor.datasaet ? motor.datasaet() : [], vaerdi('[data-lca-t-soeg]')); key = ds ? ds.key : null; }
        if (!key) { state.fejl = 'Vælg et datasæt fra listen (skriv fx «beton» og vælg en linje).'; draw(); return; }
        svarRet(motor.vaelgEpd(state.ret, { datasaet: key }), 'Datasæt ' + key + ' er valgt af dig og gemt på Revit-typen (ændringslisten; gem det i Revit under Ændringer). ISSANA LCA regner igen.');
        return;
      }
      if (state.ret && b.hasAttribute('data-lca-egen-gem')) { state.egenForslag = null; svarRet(motor.vaelgEpd(state.ret, { egenEpd: egenEpdFraFelter() }), 'Den egne EPD er gemt på Revit-typen (ændringslisten). ISSANA LCA regner igen og tjekker dokumentationen.'); return; }
      if (state.ret && b.hasAttribute('data-lca-fjern')) { var rf = motor.fjernEpd(state.ret); svarRet(rf, 'Valget er fjernet; byggevaren står uden datasæt.' + (rf && rf.somFoer ? ' Typen er igen som i Revit, så ændringen er taget ud af ændringslisten.' : '') + ' ISSANA LCA regner igen.'); return; }
      if (state.ret && b.hasAttribute('data-lca-t-m-gem')) { svarRet(motor.maengde(state.ret, { maengde: tal0(vaerdi('[data-lca-t-m-vaerdi]')), kilde: vaerdi('[data-lca-t-m-kilde]') }), 'Mængden er gemt med kilde. ISSANA LCA regner igen.'); return; }
      if (state.ret && b.hasAttribute('data-lca-t-m-fjern')) { svarRet(motor.maengde(state.ret, null), 'Modellens mængde bruges igen. ISSANA LCA regner igen.'); return; }
      if (state.ret && b.hasAttribute('data-lca-t-lv-gem')) { svarRet(motor.levetid(state.ret, { aar: tal0(vaerdi('[data-lca-t-lv-aar]')), kilde: vaerdi('[data-lca-t-lv-kilde]') }), 'Levetiden er gemt med kilde. ISSANA LCA regner igen.'); return; }
      if (state.ret && b.hasAttribute('data-lca-t-lv-fjern')) { svarRet(motor.levetid(state.ret, null), 'BUILD-levetiden bruges igen. ISSANA LCA regner igen.'); return; }
      if (b.hasAttribute('data-lca-del')) { state.del = +b.getAttribute('data-lca-del'); state.type = 0; }
      if (b.hasAttribute('data-lca-type')) state.type = +b.getAttribute('data-lca-type');
      if (b.hasAttribute('data-lca-vaelg')) { if (motor && motor.vaelg) motor.vaelg(String(b.getAttribute('data-lca-vaelg')).split(',').filter(Boolean).map(Number)); return; }
      if (b.hasAttribute('data-lca-brug-areal')) { var f = motor.forslagReferenceareal(); motor.indstillinger({referenceareal: f}); }
      if (b.hasAttribute('data-lca-beregn')) { koer(motor.beregn()); return; }
      if (b.hasAttribute('data-lca-aabn')) {
        // Ingen dialog oven på 3D: projektet gemmes altid som ny fil, og appen startes, når den findes på pc'en.
        koer(motor.info().then(function (i) { return motor.gem(!!(i && i.lcaApp && i.lcaApp.findes)); }),
          function (r) { state.besked = 'Gemt som ' + r.gemt + '.' + (r.besked ? ' ' + r.besked : '') + ' Åbn projektet i ISSANA LCA under Projekter.'; });
        return;
      }
      if (b.hasAttribute('data-lca-import')) { var inp = body.querySelector('[data-lca-fil]'); if (inp) inp.click(); return; }
      if (b.hasAttribute('data-lca-foreslaa')) {
        var sf = motor.sidste && motor.sidste(), sg = sf && sf.oversigt && (sf.oversigt.grupper || []).filter(function (x) { return x.id === 'miljoedata'; })[0];
        state.forslagForsoegt = state.forslagForsoegt && typeof state.forslagForsoegt === 'object' ? state.forslagForsoegt : {};
        ((sg && sg.mangler) || []).forEach(function (m, i) { state.forslagForsoegt[m.id || m.target_id || m.navn || m.tekst || i] = true; });
        var fr = motor.foreslaaEpd ? motor.foreslaaEpd() : { forslag: 0, fejl: 'Motoren kan ikke foreslå (gammel arbejdsrum-ai.js).' };
        if (fr.fejl) state.fejl = fr.fejl;
        else state.besked = fr.forslag + ' forslag fra BR18 tabel 7 er lagt på byggevarerne' + (fr.ingen ? '; ' + fr.ingen + ' kunne ikke matches (vælg datasæt i Data-fanen)' : '') + '. Tjek dem, og tryk «Bekræft alle forslag».';
        state.aabenDrift = false; draw(); return;
      }
      if (b.hasAttribute('data-lca-bekraeft')) {
        var tvB = tabelValg(), bk = motor.bekraeftEpd ? motor.bekraeftEpd(mistænkeligeForslag(tvB.beregning)) : { bekraeftet: 0 };
        state.besked = bk.bekraeftet + ' forslag er bekræftet som officielle BR18 tabel 7-data og lagt i ændringslisten (gem dem i Revit under Ændringer). ISSANA LCA regner igen.';
        draw(); return;
      }
      if (b.hasAttribute('data-lca-udfyld')) { state.aabenDrift = true; state.lcaFane = b.getAttribute('data-lca-udfyld') === 'proces' ? 'spild' : 'bygning'; draw(); var dd = body.querySelector && body.querySelector('[data-lca-drift]'); if (dd && dd.scrollIntoView) dd.scrollIntoView({ block: 'start' }); return; }
      if (b.hasAttribute('data-lca-levetid')) state.levetidFor = b.getAttribute('data-lca-levetid');
      if (b.hasAttribute('data-lca-lv-gem')) {
        var pid = b.getAttribute('data-lca-lv-gem'), aar = Number((body.querySelector('[data-lca-lv-aar]') || {}).value), kilde = String((body.querySelector('[data-lca-lv-kilde]') || {}).value || '').trim();
        if (!(aar > 0) || !kilde) { state.fejl = 'Angiv levetid i år og en kilde (fx BUILD-levetidstabellen); uden kilde bruges levetiden ikke.'; draw(); return; }
        var lv = (motor.indstillinger().levetider) || {}; lv[pid] = {aar: aar, kilde: kilde}; motor.indstillinger({levetider: lv}); state.levetidFor = null; koer(motor.beregn()); return;
      }
      draw();
    };
    body.onchange = function(e) {
      var s = e.target;
      if (s.hasAttribute('data-lca-maengde-enhed')) {
        var uv = valgtBv(); if (!uv) return;
        var ur = Object.assign({}, faktorRedigering(uv.bv, state.fEdit)); ur.form = s.value; if (ur.t == null && (uv.bv.ref || {}).tykkelseMm != null) ur.t = uv.bv.ref.tykkelseMm; if (ur.form === 'm2direkte' && ur.v == null) ur.v = 1;
        state.fEdit = ur; state.faktorGemt = null; draw(); return;
      }
      if (s.hasAttribute('data-lca-bibliotek-soeg')) { state.bibliotekSoeg = String(s.value || ''); state.bibLimit = 20; draw(); var bs = body.querySelector ? body.querySelector('[data-lca-bibliotek-soeg]') : null; if (bs && bs.focus) bs.focus(); return; }
      if (s.hasAttribute('data-lca-opb-soeg')) { state.opbSoeg = String(s.value || ''); draw(); var sfO = body.querySelector ? body.querySelector('[data-lca-opb-soeg]') : null; if (sfO && sfO.focus) sfO.focus(); return; }
      if (s.hasAttribute('data-lca-bib-input') && s.files && s.files.length) {
        tilfoejBiblioteksFiler(s.files);
        s.value = '';
        return;
      }
      if (s.hasAttribute('data-lca-db-soeg')) { state.dbSoeg = String(s.value || ''); draw(); var sf = body.querySelector ? body.querySelector('[data-lca-db-soeg]') : null; if (sf && sf.focus) sf.focus(); return; }
      if (s.hasAttribute('data-lca-db-input') && s.files && s.files[0]) {
        var dbFil = s.files[0], dbRd = new FileReader();
        dbRd.onload = function () {
          var dbNy = laesEpdDatabase(String(dbRd.result || ''), dbFil.name.replace(/\.(json|csv)$/i, ''));
          if (dbNy.fejl) { state.fejl = dbFil.name + ': ' + dbNy.fejl; state.besked = null; draw(); return; }
          var dbs = epdDatabaser(lager); dbs.push({ navn: dbNy.navn, fil: dbFil.name, hentet: new Date().toISOString(), epd: dbNy.epd, sprunget: dbNy.sprunget.length });
          if (!gemEpdDatabaser(lager, dbs)) { state.fejl = 'EPD-databasen kunne ikke gemmes i browserens lager (for stor?).'; draw(); return; }
          state.fejl = null; state.besked = '«' + dbNy.navn + '»: ' + dbNy.epd.length + ' EPD\'er tilføjet' + (dbNy.sprunget.length ? ' (' + dbNy.sprunget.length + ' sprunget over, fx ' + dbNy.sprunget[0].grund + ')' : '') + '. Vælg en byggevare, og tryk «Fra EPD-database».';
          draw();
        };
        dbRd.readAsText(dbFil); return;
      }
      if (s.hasAttribute('data-lca-f')) {
        var cv = valgtBv(); if (!cv) return;
        var rf = Object.assign({}, faktorRedigering(cv.bv, state.fEdit)), fn = s.getAttribute('data-lca-f');
        rf[fn] = String(s.value).trim() === '' ? null : talF(s.value); state.fEdit = rf; state.faktorGemt = null; draw();
        var nf = body.querySelector ? body.querySelector('[data-lca-f="' + fn + '"]') : null; if (nf && nf.focus) nf.focus();
        return;
      }
      if (s.hasAttribute('data-lca-select')) { if (s.getAttribute('data-lca-select') === 'del') { state.del = +s.value; state.type = 0; } else state.type = +s.value; draw(); return; }
      if (s.hasAttribute('data-lca-filter')) {
        var fl = s.getAttribute('data-lca-filter');
        if (fl === 'omfang') {
          // Et udsnit regnes af ISSANA LCA for netop de elementer (motor.beregnUdsnit); hele bygningen bruger den sidste beregning.
          state.omfang = omfangFra(s.value, state.omfang); state.filterDel = ''; state.ret = null;
          if (state.omfang && motor.beregnUdsnit) koer(motor.beregnUdsnit(state.omfang)); else draw();
          return;
        }
        if (fl === 'del') state.filterDel = s.value || ''; else state.kunMangler = !!s.checked;
        draw(); return;
      }
      if (s.getAttribute('data-lca-felt') === 'bygningstype') { motor.indstillinger({bygningstype: s.value || null}); draw(); return; }
      if (s.getAttribute('data-lca-felt') === 'referenceareal') { var parsed=window.IssanaFagInput.tal(s.value,{navn:'Referencearealet',positiv:true,valgfri:true}); if(s.setCustomValidity)s.setCustomValidity(parsed.ok?'':parsed.fejl); if(!parsed.ok){if(s.reportValidity)s.reportValidity();return;} motor.indstillinger({referenceareal:parsed.vaerdi!=null?{m2:parsed.vaerdi,kilde:'Angivet af brugeren i ISSANA 3D.',origin:'user',sourceType:'manual'}:null}); draw(); return; }
      if (s.getAttribute('data-lca-felt') === 'installationer') { motor.indstillinger({installationer: s.checked ? null : false}); motor.genberegnSnart && motor.genberegnSnart(); draw(); return; }
      if (s.hasAttribute('data-lca-b6')) {
        var b6 = Object.assign({}, motor.indstillinger().b6 || {}), k6 = s.getAttribute('data-lca-b6');
        if(k6!=='forsyning'&&k6!=='kilde'){var n6=window.IssanaFagInput.tal(s.value,{navn:'Drift',min:0,valgfri:true});if(s.setCustomValidity)s.setCustomValidity(n6.ok?'':n6.fejl);if(!n6.ok){if(s.reportValidity)s.reportValidity();return;}}
        b6[k6] = k6 === 'forsyning' || k6 === 'kilde' ? (String(s.value).trim() || null) : n6.vaerdi;
        motor.indstillinger({b6: b6}); motor.genberegnSnart && motor.genberegnSnart(); draw(); return;
      }
      if (s.hasAttribute('data-lca-bp')) {
        var bp = Object.assign({}, motor.indstillinger().byggeplads || {}), kb = s.getAttribute('data-lca-bp'), a = Object.assign({}, (bp.affald || [])[0] || {});
        if(kb!=='fraktion'&&kb!=='kilde'){var nb=window.IssanaFagInput.tal(s.value,{navn:'Byggeplads',min:0,valgfri:true});if(s.setCustomValidity)s.setCustomValidity(nb.ok?'':nb.fejl);if(!nb.ok){if(s.reportValidity)s.reportValidity();return;}}
        if (kb === 'fraktion') a.fraktion = s.value || null; else if (kb === 'affaldKg') a.kg = nb.vaerdi;
        else bp[kb] = kb === 'kilde' ? (String(s.value).trim() || null) : nb.vaerdi;
        if (kb === 'fraktion' || kb === 'affaldKg') bp.affald = a.fraktion || a.kg != null ? [a] : [];
        motor.indstillinger({byggeplads: bp}); motor.genberegnSnart && motor.genberegnSnart(); draw(); return;
      }
      if (s.hasAttribute('data-lca-fil') && s.files && s.files[0]) {
        var fil = s.files[0], rd = new FileReader();
        rd.onload = function () { koer(motor.importer(fil.name, String(rd.result)), function (imp) { state.imp = imp; state.impNavn = fil.name; }); };
        rd.readAsText(fil);
      }
    };
    body.ondragover = function (e) { if (e && e.target && e.target.closest && e.target.closest('[data-lca-slip]')) e.preventDefault(); };
    body.ondrop = function (e) { if (!e || !e.target || !e.target.closest || !e.target.closest('[data-lca-slip]')) return; e.preventDefault(); tilfoejBiblioteksFiler(e.dataTransfer && e.dataTransfer.files); };
    // Et udsnit, som en ændring har gjort forældet, regnes igen (én ad gangen), når hele bygningen ikke regner.
    function opdaterUdsnit() {
      if (!state.omfang || state.udsnitIgang || !motor.beregnUdsnit || !motor.tabel) return;
      var tb = motor.tabel(state.omfang);
      if (!tb || !tb.foraeldet || (motor.igang && motor.igang())) return;
      state.udsnitIgang = true;
      motor.beregnUdsnit(state.omfang).then(function () { state.udsnitIgang = false; draw(); }, function (e) { state.udsnitIgang = false; state.fejl = e && e.message || String(e); draw(); });
    }
    if (motor && motor.paaAendring && !body.lcaAfmeld) body.lcaAfmeld = motor.paaAendring(function () { if (body.isConnected !== false) { opdaterUdsnit(); draw(); } });
    draw();
    hentInfo();
  }
  return {html:html, opsaetningHtml:opsaetningHtml, resultatHtml:resultatHtml, overblikHtml:overblikHtml, primaerHandling:primaerHandling, samletMangler:samletMangler, manglerHtml:manglerHtml, hotspotData:hotspotData, hotspotNulgrupper:hotspotNulgrupper, hotspotHtml:hotspotHtml, faserOverblikHtml:faserOverblikHtml, bibliotekListeHtml:bibliotekListeHtml, importHtml:importHtml, tegn:tegn, BYGNINGSTYPER:BYGNINGSTYPER,
    beregningTabelHtml:beregningTabelHtml, findDatasaet:findDatasaet, KOLONNER:KOLONNER.slice(), epdStatus:epdStatus, omfangFra:omfangFra, STIL:STIL,
    kolonnerHtml:kolonnerHtml, omregningsfaktor:omregningsfaktor, faktorKilde:faktorKilde, faktorRedigering:faktorRedigering, FORMER:FORMER, tilladteFormer:tilladteFormer, opbygningBlokHtml:opbygningBlokHtml,
    lcaRapportTypst:lcaRapportTypst, delListe:delListe, manglendeByggevarer:manglendeByggevarer,
    modelValgForMangel:modelValgForMangel, modelValgForProdukt:modelValgForProdukt, sorterBygningsdele:sorterBygningsdele,
    udenDataAntal:udenDataAntal, br18BibliotekHtml:br18BibliotekHtml, spildTransportHtml:spildTransportHtml, toppenHtml:toppenHtml,
    lagfunktionDansk:lagfunktionDansk, enhedMedVed:enhedMedVed, laesEpdDatabase:laesEpdDatabase, trinMangler:trinMangler,
    analysePoster:analysePoster, analyseDiagramHtml:analyseDiagramHtml, analyseTrinHtml:analyseTrinHtml, rapportFaneHtml:rapportFaneHtml, statusManglerHtml:statusManglerHtml, serForkertUd:serForkertUd, mistænkeligeForslag:mistænkeligeForslag, sammeBygningsdelHtml:sammeBygningsdelHtml,
    epdTilEgen:epdTilEgen, epdSoeg:epdSoeg, EPD_NOEGLE:EPD_NOEGLE};
});
