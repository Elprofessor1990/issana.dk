/* ISSANA 3D: rapport i Typst for fanen Energi: resultatet mod kravet, alle inddata mærket med, hvor de kommer fra (læst i modellen,
   antaget, tastet eller fra en XML-fil), mellemregningerne for transmissionstab og ventilation, måned for måned og fanens forbehold.
   Regner intet nyt: tallene kommer fra energi-beregning.js (beregn, krav, transmission, netAreal), så rapporten viser det samme som fanen.
   Rækkerne i transmissionstabellen er de samme led, som transmission() lægger sammen; testen holder summen op mod den.
   Paragraffer: kun BR18 § 264 citeres, med den tekst varmetabsrapporten også bruger. Resten er mærket som formler i ISSANA's beregning.
   Browser: window.IssanaEnergiRapport. Node: module.exports. R er rapport-typst.js (window.IssanaTypstRapport). */
(function (root, factory) {
  "use strict";
  var erNode = typeof module === 'object' && module && module.exports;
  var api = factory();
  if (erNode) module.exports = api; else root.IssanaEnergiRapport = api;
})(typeof self !== 'undefined' ? self : this, function () {
  "use strict";

  var KILDE = { model: 'Læst i modellen', antaget: 'Antaget', tastet: 'Tastet', xml: 'Fra XML-fil', beregnet: 'Beregnet', mangler: 'Mangler i modellen', luft: 'Beregnet af lufttætheden' };
  var PAR264 = 'BR18 § 264, affattet ved BEK nr. 606 af 29/05/2018: dimensionerende transmissionstab pr. m² opvarmet etageareal, vinduer og døre medregnet.';
  var IKKE_SLAAET_OP = "Formlen i ISSANA's beregning (energi-beregning.js); paragraffen er ikke slået op her.";
  var JA = 'Ja', KUN_XML = 'Nej, kun i XML-filen';

  function liste(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' og ' + a[a.length - 1]; }
  function stort(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function lig(a, b) { return Object.keys(b).every(function (k) { return (a && a[k]) === b[k]; }); }

  // d: {p, res, beregning (energi-beregning.js), kilde ('revit' eller 'xml'), info, std (energi-fra-model.js STD), faste (B.fasteFelter(p)),
  //     ikkeSkrevet (B.IKKE_SKREVET), forbehold {note, linjer, afklares:[{tekst, antal}]} (fanens egne), model, dato}
  function lav(R, d) {
    var p = d.p, res = d.res, Rb = d.beregning, revit = d.kilde === 'revit';
    if (!p || !res || !Rb) throw new Error('Rapporten kræver fanens beregning.');
    var tal = R.tal, mt = R.mt, ov = R.overskrift, afs = R.afsnit, tb = R.tabel, eks = R.regneeksempel;
    var kr = Rb.krav(p), tr = Rb.transmission(p), b = p.bygning, v = p.ventilation, n = res.netto, bi = res.bidrag, F = Rb.FAKTOR, A = b.ae;
    var parMt = function (x) { return x < 0 ? '(' + mt(x) + ')' : mt(x); };
    var std = (d.std && d.std.skygge) || {};

    // Hvor et felt kommer fra. Rettet i panelet slår alt; ellers fra modellen, antaget af ISSANA eller fra den importerede fil.
    function kildeAf(o, felt, fraModel) {
      if (o && o.rettet && o.rettet[felt]) return 'tastet';
      if (o && o.kilde === 'antaget' && !fraModel) return 'antaget';
      if (!revit) return 'xml';
      return fraModel ? 'model' : 'antaget';
    }
    // Flere felter i én celle: «Læst i modellen: areal og b. Antaget: U.»
    function kildeTekst(o, felter) {
      var gr = {}, orden = [];
      felter.forEach(function (f) { var k = f[3] || kildeAf(o, f[0], f[2]); if (!gr[k]) { gr[k] = []; orden.push(k); } gr[k].push(f[1]); });
      if (orden.length === 1) return KILDE[orden[0]];
      return orden.map(function (k) { return KILDE[k] + ': ' + liste(gr[k]); }).join('. ') + '.';
    }
    // En række i en inddatatabel: [navn, værdi, enhed, kilde, bruges]
    function raekke(navn, o, felt, enhed, fraModel, bruges, dec) {
      var x = o ? o[felt] : null, k = x == null && revit && fraModel ? 'mangler' : kildeAf(o, felt, fraModel);
      return [navn, x == null ? '–' : tal(x, dec), enhed, KILDE[k], bruges];
    }
    // Rumhøjde og opvarmet kælder står ikke i Energy Designs fil, og importen henter dem ikke. Uden en rettelse er de derfor ikke «fra XML-fil».
    function ikkeIFil(navn, felt, enhed, fraModel, bruges, dec, regnes) {
      if (revit || (b.rettet && b.rettet[felt]) || b[felt] != null) return raekke(navn, b, felt, enhed, fraModel, bruges, dec);
      return [navn, '–', enhed, 'Ikke i filen; ' + regnes, bruges];
    }
    var KOL = { kolonner: ['Inddata', 'Værdi', 'Enhed', 'Kilde', 'Bruges i beregningen'], justering: ['left', 'right', 'left', 'left', 'left'], bredder: ['2.2fr', 'auto', 'auto', '1.3fr', '1.3fr'] };
    function inddata(rk) { return tb({ kolonner: KOL.kolonner, justering: KOL.justering, bredder: KOL.bredder, raekker: rk }); }
    function retNavn(c) {
      var o = c.orient;
      if (c.slope === 0 || c.rolle === 'tag') return 'Vandret';
      if (o === '0' || o === 0) return c.grader != null ? Rb.retningNavn(c.grader) : (c.rolle ? '–' : 'Nord');
      return Rb.retningNavn(Rb.retning(o));
    }

    var t = '';
    t += R.note('Forhåndsberegning lavet af ISSANA 3D. Den er ikke en Be18-beregning og kan ikke bruges som dokumentation over for myndighederne. Det endelige tal laves i Energy Design med XML-filen fra fanen.');
    t += afs('Rapporten viser de tal, fanen Energi viser. Hvert inddata er mærket med, hvor det kommer fra: «Læst i modellen» er hentet fra Revit-modellen, «Antaget» er en standardværdi, ISSANA har sat, «Tastet» er rettet i panelet, og «Fra XML-fil» er importeret fra Energy Design. «Beregnet» er regnet ud fra andre inddata.');
    t += afs(revit ? 'Data: Revit-modellen, åbnet i ISSANA 3D.' : 'Data: en XML-fil fra Energy Design, importeret i ISSANA 3D.');

    /* ---------- 1. Resultat ---------- */
    var er = res.energiramme, ts = res.transmission;
    var status = function (ok) { return ok ? 'Overholdt' : 'Ikke overholdt'; };
    t += ov('Resultat', 1);
    t += tb({ kolonner: ['Post', 'Resultat', 'Krav', 'Status', '2020-mål', 'Status 2020'], justering: ['left', 'right', 'right', 'left', 'right', 'left'],
      raekker: [
        ['Energiramme, kWh/m² pr. år', tal(er.resultat, 1), tal(er.krav, 1), status(er.ok), tal(er.krav2020, 1), er.ok2020 ? 'Nået' : 'Ikke nået'],
        ['Transmissionstab, W/m² etageareal', tal(ts.resultat, 1), tal(ts.krav, 1), status(ts.ok), tal(ts.krav2020, 1), ts.ok2020 ? 'Nået' : 'Ikke nået']
      ] });
    t += afs('2020-målene sammenlignes med det samme resultat. Beregningen bruger ikke egne primærenergifaktorer for 2020.');

    t += ov('Hvad energirammen består af', 2);
    var sumVarme = n.rumvarme + n.brugsvand + n.tabInstallation;
    t += tb({ kolonner: ['Post', 'Netto, kWh/m² pr. år', 'Faktor', 'Bidrag, kWh/m² pr. år'], justering: ['left', 'right', 'right', 'right'],
      raekker: [
        ['Rumvarme', tal(n.rumvarme, 1), '', ''],
        ['Varmt brugsvand', tal(n.brugsvand, 1), '', ''],
        ['Tab i fjernvarmeveksler', tal(n.tabInstallation, 1), '', ''],
        ['Varme i alt (fjernvarme)', tal(sumVarme, 1), tal(F.fjernvarme, 2), tal(bi.varme, 1)],
        ['El til ventilation, pumpe og automatik', tal(n.elBygning, 1), '', ''],
        ['Solcellestrøm, der regnes med', tal(n.solceller, 1), '', ''],
        ['El til bygningsdrift efter solceller', '', tal(F.el, 1), tal(bi.el, 1)],
        ['Overtemperatur: varme, der skal fjernes', tal(n.koel, 1), '÷ 2,5 og × ' + tal(F.el, 1), tal(bi.overtemperatur, 1)],
        ['Energiramme i alt', '', '', tal(er.resultat, 1)]
      ] });
    t += afs('Solcellestrømmen trækkes først fra elforbruget til bygningsdrift. Det, der er tilbage, trækkes fra elbehovet til overtemperatur. Overtemperaturen regnes om til el med en køleeffektfaktor (COP) på 2,5.');
    t += eks({ titel: 'Varme: netto gange primærenergifaktor', hvorfor: 'Varmebehovet pr. m² ganges med faktoren for fjernvarme.',
      formel: 'E_"varme" = f_"fjv" dot (Q_"rum" + Q_"bv" + Q_"tab")',
      symboler: [['f_"fjv"', 'primærenergifaktor for fjernvarme'], ['Q_"rum"', 'rumvarme (kWh/m² pr. år)'], ['Q_"bv"', 'varmt brugsvand (kWh/m² pr. år)'], ['Q_"tab"', 'tab i fjernvarmeveksleren (kWh/m² pr. år)']],
      indsat: mt(F.fjernvarme, 3) + ' dot (' + mt(n.rumvarme) + ' + ' + mt(n.brugsvand) + ' + ' + mt(n.tabInstallation) + ')', resultat: mt(bi.varme) + ' "kWh/m²"',
      kilde: "Faktoren er den, ISSANA's beregning bruger (energi-beregning.js); paragraffen er ikke slået op her." }, 3);
    t += eks({ titel: 'Kravet til energirammen', hvorfor: 'Kravet afhænger af det opvarmede etageareal.',
      formel: 'E_"krav" = 30 + 1000 / A', symboler: [['A', 'opvarmet etageareal (m²)']],
      indsat: '30 + 1000 / ' + mt(A), resultat: mt(kr.energiramme) + ' "kWh/m² pr. år"',
      kilde: IKKE_SLAAET_OP + ' 2020-målet på ' + tal(kr.energiramme2020, 0) + ' kWh/m² pr. år står også i beregningen og er heller ikke slået op.' }, 3);

    /* ---------- 2. Inddata ---------- */
    t += ov('Inddata', 1);
    t += ov('Bygning', 2);
    var bRk = [
      raekke('Opvarmet etageareal A', b, 'ae', 'm²', true, JA, 1),
      raekke('Bebygget areal, største opvarmede etage', b, 'ae4', 'm²', true, 'Kun kravet (E)', 1),
      ikkeIFil('Gennemsnitlig rumhøjde', 'rumhoejde', 'm', true, 'Kun kravet (tillæg over 4 m)', 2, 'regnet uden tillæg'),
      ikkeIFil('Opvarmet kælder uden for etagearealet', 'kaelderAreal', 'm²', false, 'Kun transmissionskravet', 1, 'regnet som 0 m²'),
      raekke('Varmekapacitet', b, 'heat_cap', 'Wh/K pr. m²', false, JA),
      raekke('Bygningens drejning', b, 'rotation', 'grader', false, 'Ja (solens retning)'),
      ['Etager E', tal(kr.etager, 2), '–', KILDE.beregnet, 'Kun kravet'],
      ['Areal i transmissionskravet', tal(kr.areal, 1), 'm²', KILDE.beregnet, 'Kun transmissionskravet']
    ];
    if (p.unheated) {
      var viaB = revit ? 'Via b for bygningsdele mod det uopvarmede rum' : 'Via b, når det rettes her';
      bRk.push(raekke('Uopvarmet rum, bruttoareal', p.unheated, 'gross_area', 'm²', true, viaB, 1));
      bRk.push(raekke('Uopvarmet rum, luftskifte', p.unheated, 'vent', 'l/s pr. m²', false, viaB));
    }
    t += inddata(bRk);
    t += afs('Areal i transmissionskravet er det opvarmede etageareal plus 40 % af en opvarmet kælder uden for etagearealet. E er det areal delt med det bebyggede areal, mindst 1.');

    t += ov('Ventilation, brug og varmt vand', 2);
    // Panelet sætter infiltrationen ud fra lufttætheden, når den rettes (0,04 + 0,06 · q50), uden at mærke qid som rettet.
    var qidKilde = v && v.rettet && v.rettet.air_tightness && Math.abs(v.qid - Math.round((0.04 + 0.06 * v.air_tightness) * 1000) / 1000) < 1e-9 ? KILDE.luft : null;
    var vRk = [
      raekke('Mekanisk ventilation, vinter', v, 'qvm', 'l/s pr. m²', false, JA),
      raekke('Driftsfaktor for ventilationen', v, 'fo', '–', false, JA),
      raekke('Varmegenvinding', v, 'nvgv', '0-1', false, JA),
      qidKilde ? ['Infiltration', tal(v.qid), 'l/s pr. m²', qidKilde, JA] : raekke('Infiltration', v, 'qid', 'l/s pr. m²', false, JA),
      raekke('SEL', v, 'sel', 'kJ/m³', false, JA),
      raekke('Mekanisk ventilation, sommer', v, 'qvm_day', 'l/s pr. m²', false, 'Kun overtemperatur'),
      raekke('Naturlig ventilation, sommer', v, 'qid_day', 'l/s pr. m²', false, 'Kun overtemperatur'),
      raekke('Indblæsningstemperatur', v, 'tin', '°C', false, KUN_XML),
      raekke('Lufttæthed q50', v, 'air_tightness', 'l/s pr. m²', false, KUN_XML),
      raekke('Personer', p.brug, 'ppers', 'W/m²', false, JA),
      raekke('Apparater', p.brug, 'papp', 'W/m²', false, JA),
      raekke('Varmt brugsvand', p, 'brugsvand', 'l/m² pr. år', false, JA)
    ];
    t += inddata(vRk);
    if (qidKilde) t += afs('Infiltrationen er sat af panelet, da lufttætheden blev rettet: 0,04 + 0,06 · q50.');

    t += ov('Forsyning', 2);
    var fv = p.fjernvarme || {}, pu = p.pumpe || {};
    t += inddata([
      raekke('Fjernvarmeveksler, effekt', fv, 'nom_eff', 'kW', false, KUN_XML),
      raekke('Fjernvarmeveksler, tab', fv, 'heat_loss', 'W/K', false, JA),
      raekke('Fjernvarmeveksler, mindste temperatur', fv, 'min_temp', '°C', false, JA),
      raekke('Fjernvarmeveksler, b-faktor', fv, 'b_factor', '–', false, JA),
      raekke('Automatik, standby', fv, 'auto_stb', 'W', false, JA),
      raekke('Fremløbstemperatur', p, 'fremloeb', '°C', false, KUN_XML),
      raekke('Returtemperatur', p, 'retur', '°C', false, KUN_XML),
      raekke('Pumper, antal', pu, 'no', 'stk.', false, 'Ja (måneder med varmebehov)'),
      raekke('Pumpe, effekt', pu, 'pnom', 'W', false, 'Ja (måneder med varmebehov)'),
      raekke('Pumpe, faktor', pu, 'fp', '0-1', false, 'Ja (måneder med varmebehov)')
    ]);

    t += ov('Solceller', 2);
    var pv = p.solceller;
    if (pv) t += inddata([
      raekke('Areal', pv, 'area', 'm²', false, JA),
      raekke('Retning, syd = 180', pv, 'orient', 'grader', false, JA),
      raekke('Hældning', pv, 'slope', 'grader', false, JA),
      raekke('Horisont', pv, 'horizon', 'grader', false, KUN_XML),
      raekke('Peak effekt', pv, 'peak_power', 'kW pr. m²', false, JA),
      raekke('Virkningsgrad', pv, 'efficiency', '0-1', false, JA)
    ]);
    else t += afs('Bygningen har ingen solceller i beregningen.');

    t += ov('Klima', 2);
    var kl = p.klima || {}, kl12 = kl.months && kl.months.length === 12;
    t += afs(kl12 ? 'Udetemperaturer: «' + (kl.name || 'uden navn') + '» (' + (revit ? KILDE.antaget.toLowerCase() + ', Energy Designs klimadata' : KILDE.xml.toLowerCase()) + '). Temperaturen for hver måned står i tabellen måned for måned.'
      : 'Filen har ingen udetemperaturer for alle 12 måneder, så beregningen bruger sine egne standardværdier. De står i tabellen måned for måned.');
    t += afs('Solindfald: PVGIS for København (fast i beregningen). Det gælder også solcellerne.');

    t += ov('Bygningsdele', 2);
    t += tb({ kolonner: ['Bygningsdel', 'Retning', 'Brutto m²', 'Netto m²', 'U W/m²K', 'b', 'Kold side °C', 'Kilde'], justering: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'left'],
      bredder: ['1.6fr', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', '1.8fr'],
      raekker: p.konstruktioner.map(function (c) {
        // Fra modellen: hvilken side bygningsdelen vender mod. Temperaturen der er en standardværdi; b mod jord eller et uopvarmet rum er regnet ud.
        var bRegnet = revit && (c.rolle === 'jord' || !!c.mod_uopvarmet) && !(c.rettet && c.rettet.b) ? 'beregnet' : null;
        return [c.id, retNavn(c), tal(c.total_area, 1), tal(Rb.netAreal(c), 1), tal(c.u, 3), tal(c.b, 2), tal(c.td_out == null ? -12 : c.td_out, 1),
          kildeTekst(c, [['total_area', 'areal', true], ['u', 'U', c.uKilde === 'revit'], ['b', 'b', false, bRegnet], ['td_out', 'kold side', false]])];
      }) });
    t += afs('Netto er bruttoarealet minus vinduer og døre i bygningsdelen. b er en reduktionsfaktor: 1 mod det fri, mindre mod jord og uopvarmede rum. «Kold side» er temperaturen på den kolde side i det dimensionerende transmissionstab.');
    if (revit) t += afs('Hvilken side en bygningsdel vender mod (det fri, jord eller et uopvarmet rum), er læst i modellen. Temperaturen på den kolde side er en standardværdi, ISSANA sætter. b mod jord er regnet ud fra den temperatur; b mod et uopvarmet rum er regnet ud fra rummets flader og luftskifte.');

    var aab = [];
    p.konstruktioner.forEach(function (c) { c.aabninger.forEach(function (o) { aab.push({ c: c, o: o }); }); });
    t += ov('Vinduer og døre', 2);
    if (aab.length) {
      t += tb({ kolonner: ['Vindue eller dør', 'I bygningsdel', 'Antal', 'm² stk.', 'U W/m²K', 'g', 'Ff', 'Fc', 'Kilde'], justering: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'left'],
        bredder: ['1.5fr', '1.2fr', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', '1.8fr'],
        raekker: aab.map(function (x) {
          var o = x.o, fc = o.fc == null ? 1 : o.fc, fcAendret = revit && !(o.rettet && o.rettet.fc) && fc !== 1;
          return [o.id, x.c.id, tal(o.no, 0), tal(o.area, 2), tal(o.u, 2), tal(o.g, 2), tal(o.ff, 2), tal(Math.abs(fc), 2) + (fc < 0 ? ' (kun sommer)' : ''),
            kildeTekst(o, [['no', 'antal', true], ['area', 'areal', true], ['u', 'U', false], ['g', 'g', false], ['ff', 'Ff', false], ['fc', 'Fc', false, fcAendret ? 'tastet' : null]])];
        }) });
      t += afs('Ff er glasandelen, g er glassets solenergitransmittans, og Fc er solafskærmningens faktor (1 er ingen afskærmning).');
      t += ov('Skygger', 3);
      t += tb({ kolonner: ['Vindue eller dør', 'Horisont °', 'Udhæng °', 'Side venstre °', 'Side højre °', 'Kilde'], justering: ['left', 'right', 'right', 'right', 'right', 'left'],
        raekker: aab.map(function (x) {
          var s = x.o.skygge || {};
          return [x.o.id, tal(s.horizon, 0), tal(s.overhang, 0), tal(s.sidefin_left, 0), tal(s.sidefin_right, 0), revit ? (lig(s, std) ? KILDE.antaget : KILDE.tastet) : KILDE.xml];
        }) });
      if (!revit) t += afs('Panelet mærker ikke skyggevinkler og valget «kun om sommeren», når de rettes. Her står de derfor som «Fra XML-fil».');
    } else t += afs('Ingen vinduer eller døre i beregningen.');

    t += ov('Linjetab', 2);
    if (p.kuldebroer.length) t += tb({ kolonner: ['Samling', 'Længde m', 'ψ W/mK', 'ψ · L W/K', 'Kilde'], justering: ['left', 'right', 'right', 'right', 'left'],
      raekker: p.kuldebroer.map(function (k) {
        return [k.id, tal(k.laengde, 1), tal(k.psi, 3), tal(k.psi * k.laengde, 1), kildeTekst(k, [['laengde', 'længde', k.laengde > 0], ['psi', 'ψ', false]])];
      }) });
    else t += afs('Ingen linjetab i beregningen.');

    /* ---------- 3. Transmissionstab ---------- */
    t += ov('Dimensionerende transmissionstab', 1);
    t += afs('Hver bygningsdel regnes med temperaturforskellen fra 20 °C inde til den kolde side. Vinduer, døre og linjetab regnes altid med 32 K (20 °C mod −12 °C), også når de sidder i en bygningsdel mod jord eller et uopvarmet rum.');
    var tRk = [];
    p.konstruktioner.forEach(function (c) {
      var na = Rb.netAreal(c), dT = 20 - (c.td_out == null ? -12 : c.td_out);
      tRk.push([c.id + ', netto', tal(c.u, 3), tal(na, 1) + ' m²', tal(dT, 1), tal(c.u * na * dT, 0)]);
      c.aabninger.forEach(function (o) { tRk.push(['– ' + o.id + ' ('+ tal(o.no, 0) + ' stk.)', tal(o.u, 2), tal(o.no * o.area, 1) + ' m²', '32', tal(o.u * o.no * o.area * 32, 0)]); });
    });
    p.kuldebroer.forEach(function (k) { tRk.push([k.id, tal(k.psi, 3), tal(k.laengde, 1) + ' m', '32', tal(k.psi * k.laengde * 32, 0)]); });
    tRk.push(['I alt', '', '', '', tal(tr.dim, 0)]);
    t += tb({ kolonner: ['Post', 'U eller ψ', 'Areal eller længde', 'ΔT K', 'Tab W'], justering: ['left', 'right', 'right', 'right', 'right'], bredder: ['2fr', 'auto', 'auto', 'auto', 'auto'], raekker: tRk });
    t += eks({ titel: 'Transmissionstab pr. m²', hvorfor: 'Det samlede tab deles med arealet i kravet.',
      formel: 'q_"t" = Phi_"dim" / A_"krav"',
      symboler: [['Phi_"dim"', 'dimensionerende transmissionstab, summen ovenfor (W)'], ['A_"krav"', 'opvarmet etageareal plus 40 % af en opvarmet kælder uden for etagearealet (m²)']],
      indsat: mt(tr.dim) + ' / ' + mt(kr.areal), resultat: mt(ts.resultat) + ' "W/m²"', kilde: PAR264 }, 2);
    var eE = b.ae4 > 0 ? { formel: 'E = max(1, A_"krav" / A_"bebygget")', indsat: 'max(1, ' + mt(kr.areal) + ' / ' + mt(b.ae4) + ')' } : null;
    t += eks({ titel: 'Kravet til transmissionstab', hvorfor: 'Kravet afhænger af arealet og af, hvor mange etager bygningen svarer til.' + (eE ? '' : ' Det bebyggede areal mangler, så beregningen deler etagearealet med antallet af etager for at finde E.'),
      formel: 'q_"krav" = 12 + 6 / E + 300 / A_"krav" + Delta q_"h"',
      symboler: [['E', 'antal etager: arealet i kravet delt med det bebyggede areal, mindst 1'], ['A_"krav"', 'arealet i kravet (m²)'], ['Delta q_"h"', 'tillæg for gennemsnitlig rumhøjde over 4 m: 1 W/m² pr. meter']],
      indsat: (eE ? 'E = ' + eE.indsat + ' = ' + mt(kr.etager) + ' quad ' : '') + 'q_"krav" = 12 + 6 / ' + mt(kr.etager) + ' + 300 / ' + mt(kr.areal) + ' + ' + mt(kr.tillaeg), resultat: mt(kr.transmission) + ' "W/m²"',
      kilde: "Formlen i ISSANA's beregning (energi-beregning.js). Kravet om dimensionerende transmissionstab står i " + PAR264 + ' Tallene i formlen og 2020-målet (11 i stedet for 12) er ikke slået op her.' }, 2);

    /* ---------- 4. Varmetabskoefficient og ventilation ---------- */
    var H = tr.h + res.Hv, m0 = res.maaneder[0];
    t += ov('Varmetabskoefficient og ventilation', 1);
    t += afs('Til energirammen regnes med varmetabskoefficienten H. Her bruges b, så en bygningsdel mod jord eller et uopvarmet rum taber mindre end en mod det fri. Vinduer og linjetab regnes uden b.');
    t += tb({ kolonner: ['Del', 'W/K'], justering: ['left', 'right'], raekker: [
      ['Bygningsdele, b · U · A netto', tal(tr.hOp, 1)], ['Vinduer og døre, U · A', tal(tr.hVin, 1)], ['Linjetab, ψ · L', tal(tr.hPsi, 1)], ['Ventilation og infiltration', tal(res.Hv, 1)], ['I alt, H', tal(H, 1)]] });
    t += eks({ titel: 'Ventilationstab', hvorfor: 'Den mekaniske ventilation taber kun den del, varmegenvindingen ikke tager. Infiltrationen taber det hele.',
      formel: 'H_"v" = "1,2" dot (q_"m" dot f_"o" dot (1 - eta_"vgv") + q_"i") dot A',
      symboler: [['"1,2"', 'luftens varmekapacitet (kJ/m³K)'], ['q_"m"', 'mekanisk ventilation, vinter (l/s pr. m²)'], ['f_"o"', 'driftsfaktor'], ['eta_"vgv"', 'varmegenvinding'], ['q_"i"', 'infiltration (l/s pr. m²)'], ['A', 'opvarmet etageareal (m²)']],
      indsat: '"1,2" dot (' + mt(v.qvm) + ' dot ' + mt(v.fo) + ' dot (1 - ' + mt(v.nvgv) + ') + ' + mt(v.qid) + ') dot ' + mt(A), resultat: mt(res.Hv) + ' "W/K"',
      kilde: "Formlen i ISSANA's beregning (energi-beregning.js), efter princippet i DS/EN ISO 13790." }, 2);
    t += eks({ titel: 'Tidskonstant', hvorfor: 'Tidskonstanten siger, hvor godt bygningen gemmer varme. Den styrer, hvor meget af solen og den interne varme der kan udnyttes.',
      formel: 'tau = c dot A / H', symboler: [['c', 'varmekapacitet (Wh/K pr. m²)'], ['H', 'varmetabskoefficient i alt (W/K)']],
      indsat: mt(b.heat_cap) + ' dot ' + mt(A) + ' / ' + mt(H), resultat: mt(res.tau) + ' "h"', kilde: "Formlen i ISSANA's beregning (energi-beregning.js), efter princippet i DS/EN ISO 13790." }, 2);
    if (m0) t += eks({ titel: 'Varmetab i januar', hvorfor: 'Hver måned regnes tabet fra 20 °C inde til månedens udetemperatur. Januar har 31 døgn, altså 744 timer.',
      formel: 'Q_"tab" = H dot (20 - theta_"e") dot t / 1000', symboler: [['theta_"e"', 'månedens udetemperatur (°C)'], ['t', 'timer i måneden']],
      indsat: mt(H) + ' dot (20 - ' + parMt(m0.ude) + ') dot 744 / 1000', resultat: mt(m0.tab) + ' "kWh"', kilde: "Formlen i ISSANA's beregning (energi-beregning.js), månedsmetoden efter DS/EN ISO 13790." }, 2);
    t += eks({ titel: 'Varmt brugsvand', hvorfor: 'Vandet varmes altid fra 10 °C til 55 °C.',
      formel: 'Q_"bv" / A = V / 1000 dot "1,16" dot (55 - 10)', symboler: [['V', 'forbrug af varmt brugsvand (l/m² pr. år)'], ['"1,16"', 'vands varmekapacitet (kWh/m³K)']],
      indsat: mt(p.brugsvand) + ' / 1000 dot "1,16" dot 45', resultat: mt(n.brugsvand) + ' "kWh/m²"', kilde: "Formlen i ISSANA's beregning (energi-beregning.js)." }, 2);

    /* ---------- 5. Måned for måned ---------- */
    t += ov('Måned for måned', 1);
    t += afs('Hele bygningen, kWh pr. måned. Udnyttelse er den del af sol og intern varme, der kan bruges til at dække varmetabet.');
    t += tb({ kolonner: ['Måned', 'Ude °C', 'Tab', 'Sol', 'Intern', 'Udnyttelse', 'Varme', 'Overtemp.', 'El drift', 'Solceller'], justering: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
      raekker: res.maaneder.map(function (m) { return [m.maaned, tal(m.ude, 1), tal(m.tab, 0), tal(m.sol, 0), tal(m.intern, 0), tal(m.udnyttelse, 2), tal(m.varme, 0), tal(m.koel, 0), tal(m.elBygning, 0), tal(m.solceller, 0)]; }) });

    /* ---------- 6. Forbehold ---------- */
    var fb = d.forbehold || {};
    t += ov('Forbehold', 1);
    if (fb.note) t += afs(fb.note);
    t += R.punkter([
      'Solindfaldet er fra PVGIS for København. Be18 bruger det danske referenceår.',
      'Skygger regnes forenklet: solens bane midt i måneden for direkte sol og himmelkig for diffus sol.',
      'Overtemperatur er et skøn: en månedsbalance ved 25 °C, regnet om til el med en køleeffektfaktor på 2,5.',
      'Sommerkomfort kræver en timeberegning og er ikke regnet her. Det gøres i Energy Design.',
      'Opvarmet kælder uden for etagearealet tæller kun i kravet til transmissionstab. Energirammen regnes ud fra etagearealet alene.'
    ]);
    if (fb.linjer && fb.linjer.length) { t += ov('Skal afklares før aflevering', 2) + R.punkter(fb.linjer); }
    if (fb.afklares && fb.afklares.length) {
      var nIkke = fb.afklares.reduce(function (s, x) { return s + x.antal; }, 0);
      t += ov('Ikke regnet med', 2) + afs(nIkke + ' bygningsdele fra modellen er ikke regnet med:') + R.punkter(fb.afklares.map(function (x) { return x.tekst + ' (' + x.antal + ')'; }));
    }
    var faste = d.faste || [];
    if (faste.length) {
      t += ov('Det skriver XML-filen med fast værdi', 2);
      t += afs('Panelet har ingen felter til disse værdier, så XML-filen til Energy Design får dem, der står her. Ret dem i Energy Design, hvis projektet har andre. Navnet i parentes er læst ud fra feltnavnet.');
      var fRk = [];
      faste.forEach(function (g) { g.felter.forEach(function (f, i) { fRk.push([i ? '' : g.post, f.felt + (f.navn ? ' (' + f.navn + ')' : ''), f.tekst]); }); });
      t += tb({ kolonner: ['Post', 'Felt', 'Værdi'], justering: ['left', 'left', 'right'], raekker: fRk });
    }
    if (d.ikkeSkrevet && d.ikkeSkrevet.length) t += afs(stort('XML-filen har slet ikke: ' + d.ikkeSkrevet.join(', ') + '. Det skal tastes i Energy Design.'));

    return R.dokument({ titel: 'Energiramme og transmissionstab', undertitel: 'Forhåndsberegning efter månedsmetoden. Ikke dokumentation efter Be18.', projekt: d.model || '', dato: d.dato || '', tekst: t, kilder: [
      PAR264,
      'DS/EN ISO 13790, månedsmetoden (princippet; standardens tekst er ikke gengivet).',
      'PVGIS 5.3, PVGIS-SARAH3, 2005-2023, 55,68° N 12,57° Ø: månedligt solindfald.',
      revit ? 'Energy Designs klimadata «Københavns Lufthavn»: udetemperaturer.' : 'Klimadata fra den importerede XML-fil.',
      "ISSANA MCP: energi-beregning.js (beregningen), energi-fra-model.js (data fra modellen) og energi-be18.js (XML-filen)."
    ] });
  }
  function filnavn(model) { return 'energi-' + (String(model || 'model').replace(/[^\wæøåÆØÅ-]+/g, '_').replace(/^_+|_+$/g, '') || 'model') + '.typ'; }
  return { lav: lav, filnavn: filnavn, KILDE: KILDE };
});
