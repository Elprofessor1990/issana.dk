/* ISSANA 3D: rapport i Typst for fanen Varmetabsberegning: resultat, randbetingelser, formler med regneeksempler (modellens egne tal),
   tabeller pr. bygningsdel, hvad der ikke er regnet med og hvorfor, og kilder. Regner intet selv: tallene kommer fra fanens beregning,
   så rapporten altid viser det samme som fanen. Formlerne står i egen notation; standardens tekst er ikke kopieret.
   Browser: window.IssanaVarmetabRapport. Node: module.exports. R er rapport-typst.js (window.IssanaTypstRapport). */
(function(root, factory){
  "use strict";
  var erNode = typeof module==='object' && module && module.exports;
  var api = factory();
  if(erNode) module.exports=api; else root.IssanaVarmetabRapport=api;
})(typeof self!=='undefined' ? self : this, function(){
  "use strict";

  var KATEGORI_ORDEN=['Vægge','Gulve','Tage','Lofter','Glasfacader','Vinduer','Døre'];
  var TILSTAND={opvarmet:'Opvarmet',uopvarmet:'Uopvarmet',ude:'Ude',afhaenger:'Efter etage'};

  function storst(rk,fn){ var bedst=null; rk.forEach(function(r){ if(fn(r)&&(!bedst||r.l.H>bedst.l.H)) bedst=r; }); return bedst; }
  function grp(rk,fn){ var t={}; rk.forEach(function(r){ var k=fn(r); (t[k]||(t[k]=[])).push(r); }); return t; }

  function lav(R,d){
    var res=d.res, o=d.o, ti=o.ti, te=o.te, dT=res.dTi;
    var tal=R.tal, sig=R.sig, mt=R.mt, afs=R.afsnit, ov=R.overskrift, tb=R.tabel, eks=R.regneeksempel;
    var rk=(res.linjer||[]).map(function(l,i){ return {l:l,t:(d.typer&&d.typer[i])||{}}; });
    var med=rk.filter(function(r){ return r.l.med; });
    var parMt=function(n){ return n<0? '('+mt(n)+')' : mt(n); };
    var gTekst=function(n,enh){ return tal(n,n<10?2:1)+(enh?' '+enh:''); };
    var gTemp=function(n){ return tal(n,Number.isInteger(n)?0:1)+' °C'; };
    var artAf=function(r){ return r.t.plac? r.t.plac.art : (r.t.jord? 'jord' : 'ude'); };
    var koldAf=function(r){ return r.t.plac? (r.t.thetaKold!=null? r.t.thetaKold : r.t.plac.thetaB) : ti-(r.l.b||0)*dT; };
    var varmAf=function(r){ return r.t.plac? r.t.plac.thetaA : ti; };
    var t='';

    /* ---------- Resultat ---------- */
    t+=ov('Resultat',1);
    t+=afs('Bygningens dimensionerende varmetab er '+tal(res.phi,0)+' W ved '+tal(ti,0)+' °C inde og '+tal(te,0)+' °C ude'+(res.spec!=null? ', svarende til '+tal(res.spec,1)+' W pr. m² opvarmet etageareal.' : '.'));
    t+=R.note('Vejledende beregning ud fra Revit-modellen. U-værdierne er læst fra modellen og er ikke regnet om her; kontrollér arealer, U-værdier og kuldebroer mod projektet, før tallet bruges.');
    t+=tb({kolonner:['Størrelse','Værdi'],justering:['left','right'],raekker:[
      ['Temperaturforskel θi − θe',gTekst(dT,'K')],
      ['Opvarmet etageareal A',gTekst(o.Agulv,'m²')],['Etager E',tal(o.E,2)],
      ['Klimaskærmens areal',gTekst(res.Aklima,'m²')],
      ['H_T flader, Σ b·A·U',gTekst(res.Hflader,'W/K')],
      ['Kuldebrotillæg ΔU·A',gTekst(res.Hkuldebro,'W/K')],
      ['Linjetab, Σ b·ψ·l',gTekst(res.Hlinje,'W/K')],
      ['Punkttab, Σ b·χ·n',gTekst(res.Hpunkt,'W/K')],
      ['H_T transmission i alt',gTekst(res.Ht,'W/K')],
      ['H_V ventilation, 0,34·n·V',gTekst(res.Hv,'W/K')],
      ['Φ transmission',tal(res.phiT,0)+' W'],['Φ ventilation',tal(res.phiV,0)+' W'],
      ['Φ i alt',tal(res.phi,0)+' W']
    ].concat(res.br18Tab!=null? [['Dim. transmissionstab, BR18 § 264',gTekst(res.br18Tab,'W/m² etageareal')],['Krav, BR18 § 264',gTekst(res.br18Graense,'W/m²')+(res.br18OK?', overholdt':', ikke overholdt')]] : [])});

    /* ---------- Randbetingelser ---------- */
    t+=ov('Randbetingelser: hvilken temperatur er der på hver side',1);
    t+=afs('Varmetabet afhænger af forskellen mellem den varme og den kolde side af hver bygningsdel. Derfor er det afgjort for hver flade, hvad der ligger på hver side.');
    if(d.harPlacering) t+=R.punkter([
      'Hvert rum tælles på sin side af bygningsdelen ud fra rummets og bygningsdelens geometri i modellen.',
      'Uden rum på den ene side afgør Revits funktion (ydervæg, indervæg, fundament) siden.',
      'Rumtypen læses af rumanvendelsen eller af rumnavnet. Et ukendt navn gættes ikke; det regnes efter etagen.',
      'Rækker uden en sikker side regnes ikke med, før de er valgt i fanen.']);
    var rand=d.rand||{};
    t+=tb({kolonner:['Side','Temperatur','Kilde'],justering:['left','right','left'],raekker:[
      ['Det fri',gTemp(te),(d.KILDE&&d.KILDE.ude)||'DS 418:2026 pkt. 4.2'],
      ['Jord under terrændæk og kældergulv',gTemp(rand.thetaJ),(d.KILDE&&d.KILDE.jord)||'DS 418:2026 pkt. 4.2 og 5.2'],
      ['Kælderydervæg (dybde '+tal(rand.kdybde,1)+' m)',gTemp(d.jordVaegTheta),(d.KILDE&&d.KILDE.jord)||''],
      ['Uopvarmede rum',gTemp(rand.thetaU),(d.KILDE&&d.KILDE.uopvarmet)||'']
    ]});
    t+=R.note('Udetemperaturen er −12 °C efter DS 418:2026 pkt. 4.2, ikke −20 °C. En anden værdi bruges kun i særlige tilfælde og sættes i fanen. Badet regnes med samme temperatur som resten af bygningen, fordi pkt. 7 siger, at der ses bort fra, at enkelte rum som baderum har en anden temperatur.');
    if(d.rumtyper&&d.rumtyper.length){
      t+=ov('Rumtyper i modellen',2);
      t+=tb({kolonner:['Rumtype','Rum','Antal','Tilstand','θi (°C)','Kilde'],justering:['left','left','right','left','right','left'],
        raekker:d.rumtyper.map(function(x){ var ts=x.tilstand||Object.keys(x.tilstande||{}).join(' og '); return [x.navn,(x.rum||[]).join(', ')+(x.antal>(x.rum||[]).length?', …':''),String(x.antal),(TILSTAND[ts]||(ts? ts.charAt(0).toUpperCase()+ts.slice(1) : '')),x.theta==null?'–':tal(x.theta,0),x.kilde||'']; })});
    }

    /* ---------- Plantegninger ---------- */
    var KAT=d.planFarver||null, RUM=d.rumFarver||null;
    if(d.planer&&d.planer.length&&KAT){
      var flag=function(f,tx){ return '#box(fill: rgb("'+f+'"), stroke: 0.4pt + luma(150), width: 8pt, height: 8pt, baseline: 1pt) #h(3pt) #text(8.5pt)['+R.esc(tx)+'] #h(10pt) '; };
      var fig=function(p,tx){ return '#figure(image(bytes("'+R.str(p.svg)+'"), format: "svg", width: '+(p.bredde||Math.round(Math.min(166,105*p.w/p.h)))+'mm), caption: ['+R.esc(tx)+'])\n\n'; };
      t+=ov('Bygningsdelene på plantegninger',1);
      t+=afs('Planerne viser, hvad hver bygningsdel vender mod. Det er samme vurdering som i tabellerne. Rummene står med nummer og navn, hvor der er plads. En væg, der vender flere veje, har farven for det, den mest vender mod af det, der regnes med. Projektnord er opad.');
      t+=(d.planOrden||Object.keys(KAT)).map(function(k){ return flag(KAT[k].f,KAT[k].t); }).join('')+'\n\n';
      if(RUM) t+=Object.keys(RUM).map(function(k){ return flag(RUM[k].f,RUM[k].t); }).join('')+flag('#ffffff','Vindue og glasfacade')+flag('#e9ecef','Dør')+'\n\n';
      d.planer.forEach(function(p){
        t+=ov(p.niveau,2);
        if(p.vaegge) t+=fig(p.vaegge,p.niveau+': vægge, vinduer og døre');
        if(p.daek) t+=fig(p.daek,p.niveau+': dæk og tag, efter hvad der er over og under');
      });
    } else if(d.planFejl) t+=R.note('Plantegningerne kunne ikke laves: '+d.planFejl);

    /* ---------- Formler og regneeksempler ---------- */
    t+=ov('Formler og regneeksempler med modellens egne tal',1);
    t+=afs('Hvert eksempel er taget fra en af posterne i tabellerne nedenfor, så tallene kan genfindes dér.');

    // U-værdi: hvad står tallet for
    var ude=storst(med,function(r){ return artAf(r)==='ude'&&r.l.u>0&&r.t.kategori==='Vægge'; })||storst(med,function(r){ return artAf(r)==='ude'&&r.l.u>0; });
    var etU=ude||storst(med,function(r){ return r.l.u>0; });
    if(etU){
      var U=etU.l.uKonstr||etU.l.u;
      t+=eks({titel:'U-værdi: hvad tallet betyder',hvorfor:'U-værdien siger, hvor meget varme der går gennem 1 m² ved 1 K temperaturforskel. Den er summen af lagenes modstand vendt om. Her er den læst fra modellen («'+etU.t.label+'»), så eksemplet viser den samlede modstand, tallet svarer til.',
        formel:'U = 1 / (R_"si" + sum_i R_i + R_"se") quad "dvs." quad R_"T" = 1 / U',
        symboler:[['R_"si"','indvendig overgangsisolans (m²K/W): 0,13 vandret, 0,10 opad og 0,17 nedad'],['R_i','isolansen af hvert lag, tykkelse divideret med varmeledningsevne d/λ (m²K/W)'],['R_"se"','udvendig overgangsisolans, 0,04 m²K/W'],['U','transmissionskoefficient (W/m²K)']],
        indsat:'R_"T" = 1 / '+mt(U,3),resultat:mt(1/U,3)+' "m²K/W"',kilde:'DS 418:2026 pkt. 8.1 formel (12), pkt. 8.2 formel (13), pkt. 8.3 tabel 1, pkt. 8.4 formel (14)'},2);
    } else t+=R.note('Ingen af de medregnede bygningsdele har en U-værdi, så der er ingen regneeksempler.');

    if(ude) t+=eks({titel:'Transmissionstab mod det fri',hvorfor:'Eksemplet er «'+ude.t.label+'» ('+ude.t.kategori+'), den '+(ude.t.kategori==='Vægge'?'ydervæg':'flade')+' med det største tab. Tabet er U gange areal gange forskellen mellem inde og ude.',
      formel:'Phi_"t" = U dot A dot (theta_"i" - theta_"e")',
      symboler:[['Phi_"t"','transmissionstabet (W)'],['U','transmissionskoefficient (W/m²K)'],['A','transmissionsareal (m²)'],['theta_"i"','dimensionerende indetemperatur (°C)'],['theta_"e"','dimensionerende udetemperatur (°C)']],
      indsat:mt(ude.l.u,3)+' dot '+mt(ude.l.areal,5)+' dot ('+parMt(varmAf(ude))+' - '+parMt(koldAf(ude))+')',resultat:mt(ude.l.H*dT,5)+' "W"',kilde:'DS 418:2026 pkt. 5.1 formel (1)'},2);

    // Mod jord: først U med jordens isolans, så tabet
    var jord=storst(med,function(r){ return artAf(r)==='jord'&&r.l.u>0; });
    if(jord){
      var rolle=jord.t.plac? jord.t.plac.rolle : jord.t.jord, rolleTekst=rolle==='kaeldervaeg'?'kælderydervæg':rolle==='kaeldergulv'?'kældergulv':'terrændæk';
      if(!jord.l.inklRj&&jord.l.uKonstr) t+=eks({titel:'Jordens isolans ('+rolleTekst+')',hvorfor:'Jord isolerer selv. Jordens isolans R_j lægges til konstruktionens modstand i stedet for den udvendige overgangsisolans.',
        formel:'U_"e" = 1 / (1 / U + R_"j")',
        symboler:[['U','konstruktionens U-værdi (W/m²K), læst fra modellen'],['R_"j"','jordens isolans (m²K/W) fra tabel 13'],['U_"e"','U-værdi mod jord (W/m²K)']],
        indsat:'1 / (1 / '+mt(jord.l.uKonstr,3)+' + '+mt(jord.l.rj,3)+')',resultat:mt(jord.l.u,3)+' "W/m²K"',kilde:'DS 418:2026 pkt. 8.11 formel (20) og tabel 13'},2);
      else if(jord.l.inklRj) t+=afs('«'+jord.t.label+'» kommer fra ISSANA Konstruktion, og U-værdien indeholder allerede jordens isolans, så den er ikke lagt til igen.');
      t+=eks({titel:'Transmissionstab mod jord ('+rolleTekst+')',hvorfor:rolle==='kaeldervaeg'&&rand.kdybde<=2? 'En kælderydervæg ned til 2 m regnes mod udetemperaturen.' : 'Under terrændæk, kældergulv og i dybde over 2 m er jorden varmere end udeluften, så den kolde side er 10 °C.',
        formel:'Phi_"t" = U_"e" dot A dot (theta_"i" - theta_"j")',
        symboler:[['theta_"j"','dimensionerende jordtemperatur (°C)'],['A','transmissionsareal (m²)']],
        indsat:mt(jord.l.u,3)+' dot '+mt(jord.l.areal,5)+' dot ('+parMt(varmAf(jord))+' - '+parMt(koldAf(jord))+')',resultat:mt(jord.l.H*dT,5)+' "W"',kilde:rolle==='kaeldervaeg'? 'DS 418:2026 pkt. 4.2 og 5.2 formel (2)' : 'DS 418:2026 pkt. 4.2 og 5.2 formel (3)'},2);
    }

    var uopv=storst(med,function(r){ return artAf(r)==='uopvarmet'&&r.l.u>0; });
    if(uopv) t+=eks({titel:'Transmissionstab mod uopvarmet rum',hvorfor:'«'+uopv.t.label+'» vender mod et uopvarmet rum, så temperaturforskellen er mindre end mod det fri. I beregningen står det som faktoren b, der gør forskellen til en andel af den fulde forskel.',
      formel:'b = (theta_"i" - theta_"u") / (theta_"i" - theta_"e") quad quad Phi_"t" = b dot U dot A dot (theta_"i" - theta_"e")',
      symboler:[['theta_"u"','temperaturen i det uopvarmede rum (°C), et skøn'],['b','temperaturfaktor']],
      indsat:'b = ('+parMt(varmAf(uopv))+' - '+parMt(koldAf(uopv))+') / ('+parMt(ti)+' - '+parMt(te)+') = '+mt(uopv.l.b,3)+' quad Phi_"t" = '+mt(uopv.l.b,3)+' dot '+mt(uopv.l.u,3)+' dot '+mt(uopv.l.areal,5)+' dot '+mt(dT,3),resultat:mt(uopv.l.H*dT,5)+' "W"',kilde:'DS 418:2026 pkt. 4.1 og 5.3 formel (4)'},2);

    var lb=null; (d.kuldebroer||[]).forEach(function(L){ if(+L.psi>0&&+L.laengde>0&&(!lb||(+L.psi)*(+L.laengde)>(+lb.psi)*(+lb.laengde))) lb=L; });
    if(lb){ var bl=typeof lb.b==='number'?lb.b:1; t+=eks({titel:'Linjetab: '+lb.navn,hvorfor:'Samlinger og fundamenter har en kuldebro langs deres længde. Længden er anslået fra geometrien, og ψ er en standardværdi, indtil den rettes i fanen.',
      formel:'Phi_"l" = b dot psi dot l dot (theta_"i" - theta_"e")',
      symboler:[['psi','linjetabskoefficient (W/mK)'],['l','længde (m)'],['b','temperaturfaktor']],
      indsat:mt(bl,3)+' dot '+mt(+lb.psi,3)+' dot '+mt(+lb.laengde,5)+' dot '+mt(dT,3),resultat:mt(bl*(+lb.psi)*(+lb.laengde)*dT,5)+' "W"',kilde:'DS 418:2026 pkt. 5.4 formel (5) og pkt. 5.5 formel (6)'},2); }

    t+=eks({titel:'Det samlede varmetab',hvorfor:'Alle flader, kuldebroer og ventilationen lægges sammen som varmetabskoefficienter og ganges med den fulde temperaturforskel.',
      formel:'Phi = (H_"T" + H_"V") dot (theta_"i" - theta_"e")',
      symboler:[['H_"T"','transmission, Σ b·A·U + ΔU·A + Σ b·ψ·l + Σ b·χ·n (W/K)'],['H_"V"','ventilation (W/K)']],
      indsat:'('+mt(res.Ht,6)+' + '+mt(res.Hv,6)+') dot ('+parMt(ti)+' - '+parMt(te)+')',resultat:mt(res.phi,6)+' "W"',kilde:'DS 418:2026 pkt. 5 og 7'},2);
    if(res.Hv>0) t+=eks({titel:'Ventilationstab',hvorfor:'Luftskiftet er angivet i fanen. Tallet 0,34 er luftens densitet gange varmekapacitet, omregnet fra sekunder til timer.',
      formel:'H_"V" = 0.34 dot n dot V',symboler:[['n','luftskifte (1/h)'],['V','opvarmet volumen (m³)']],indsat:'"0,34" dot '+mt(o.n,3)+' dot '+mt(o.V,6),resultat:mt(res.Hv,5)+' "W/K"',kilde:'DS 418:2026 pkt. 6.1 formel (7), skrevet om til luftskifte'},2);
    else t+=afs('Ventilationstabet er 0, fordi luftskiftet ikke er angivet i fanen. Det skal sættes, før Φ er det samlede varmetab.');

    /* ---------- Tabeller pr. bygningsdel ---------- */
    t+=ov('Bygningsdele, der indgår',1);
    var pr=grp(med,function(r){ return r.t.kategori||'Andet'; });
    var kat=KATEGORI_ORDEN.filter(function(k){ return pr[k]; }).concat(Object.keys(pr).filter(function(k){ return KATEGORI_ORDEN.indexOf(k)<0; }));
    if(!kat.length) t+=afs('Ingen bygningsdele indgår endnu.');
    kat.forEach(function(k){
      var l=pr[k], sumA=0, sumH=0;
      t+=ov(k,2);
      var raekker=l.map(function(r){ sumA+=r.l.areal; sumH+=r.l.H; return [r.t.label,(r.t.plac?r.t.plac.tekst:'antaget mod det fri'),tal(r.l.areal,1),sig(r.l.u,3),tal(r.l.b,2),tal(varmAf(r),0)+' / '+tal(koldAf(r),0),tal(r.l.H,1),tal(r.l.H*dT,0)]; });
      raekker.push(['I alt','',tal(sumA,1),'','','',tal(sumH,1),tal(sumH*dT,0)]);
      t+=tb({kolonner:['Type','Placering','A (m²)','U (W/m²K)','b','θ varm/kold (°C)','H (W/K)','Φ (W)'],justering:['left','left','right','right','right','right','right','right'],raekker:raekker});
    });
    if((d.kuldebroer||[]).length||(d.punkter||[]).length){
      t+=ov('Kuldebroer',2);
      if((d.kuldebroer||[]).length) t+=tb({kolonner:['Linje','ψ (W/mK)','Længde (m)','b','b·ψ·l (W/K)'],justering:['left','right','right','right','right'],raekker:d.kuldebroer.map(function(L){ var b=typeof L.b==='number'?L.b:1; return [L.navn,tal(+L.psi,3),tal(+L.laengde,1),tal(b,2),tal(b*(+L.psi)*(+L.laengde),2)]; })});
      if((d.punkter||[]).length) t+=tb({kolonner:['Punkt','χ (W/K)','Antal','b','b·χ·n (W/K)'],justering:['left','right','right','right','right'],raekker:d.punkter.map(function(P){ var b=typeof P.b==='number'?P.b:1, n=+P.antal>0?+P.antal:1; return [P.navn,tal(+P.chi,3),String(n),tal(b,2),tal(b*(+P.chi)*n,2)]; })});
    }

    /* ---------- Det, der ikke er regnet med ---------- */
    t+=ov('Det, der ikke er regnet med, og hvorfor',1);
    var rel=d.relevans, rkIkke=rk.filter(function(r){ return !r.l.med; });
    if(rel&&rel.afklares&&rel.afklares.length){
      t+=ov('Skal afklares',2);
      t+=afs('Disse flader har ikke en sikker side. De indgår ikke, før de er valgt i fanen, så varmetabet kan være for lavt, hvis de reelt er en del af klimaskærmen.');
      t+=tb({kolonner:['Bygningsdel','Placering','Antal','m²','Hvorfor'],justering:['left','left','right','right','left'],raekker:rel.afklares.map(function(x){ return [x.kategori,x.tekst||'',String(x.antal),tal(x.areal,0),x.grund||'']; })});
    }
    var uDel=rkIkke.filter(function(r){ return r.t.uMangler; });
    if(uDel.length){ t+=ov('Mangler U-værdi',2); t+=afs('Typerne står i modellen, men uden U-værdi, så de er ikke regnet med.'); t+=tb({kolonner:['Type','Kategori','m²'],justering:['left','left','right'],raekker:uDel.map(function(r){ return [r.t.label,r.t.kategori,tal(r.l.areal,1)]; })}); }
    if(rel&&rel.indgaarIkke&&rel.indgaarIkke.length){
      t+=ov('Indgår ikke',2);
      t+=tb({kolonner:['Bygningsdel','Hvad','Antal','m²','Hvorfor'],justering:['left','left','right','right','left'],raekker:rel.indgaarIkke.map(function(x){ return [x.kategori,x.tekst||'',String(x.antal),x.areal>0?tal(x.areal,0):'–',x.grund||'']; })});
    }
    if(!rel) t+=afs('Modellen har ingen placerede rum, så der er ikke regnet på placeringen. Bygningsdelene er vurderet type for type ud fra navnene, og fluebenene i fanen afgør, hvad der indgår.');

    /* ---------- Forudsætninger ---------- */
    t+=ov('Forudsætninger og usikkerhed',1);
    var stor=med.filter(function(r){ return res.phiT>0&&r.l.H*dT>=0.25*res.phiT; }).sort(function(a,b){ return b.l.H-a.l.H; });
    if(stor.length) t+=R.note(stor.map(function(r){ return '«'+r.t.label+'» ('+r.t.kategori+') står for '+tal(100*r.l.H*dT/res.phiT,0)+' % af transmissionstabet med U = '+sig(r.l.u,3)+' W/m²K.'; }).join(' ')+' Kontrollér U-værdien i modellen først: den betyder mest for resultatet.');
    t+=R.punkter([
      'U-værdierne kommer fra modellen (Revit eller ISSANA Konstruktion). Vinduer og døre uden U-værdi får 1,4 W/m²K som vejledende værdi.',
      'Arealerne er modellens arealer, fordelt efter hvor stor en del af bygningsdelen der vender mod hvert rum. De er ikke målt op efter DS 418:2026 pkt. 5.6.',
      'U-værdien er ikke rettet for lavere overgangsisolans mod uopvarmede rum.',
      'Dele af en kældervæg over terræn er regnet som resten af væggen, selv om DS 418:2026 pkt. 8.11 regner dem som ydervæg.',
      'Linje- og punkttab er standardværdier og anslåede længder, indtil de er rettet i fanen.',
      'Opvarmet kælder, der ikke indgår i etagearealet, tæller 40 % i A og E efter BR18 § 264. Reglen er ikke indbygget; ret A og E i fanen, hvis bygningen har sådan en kælder.',
      'DS 418:2026/Ret.1:2026 er ikke kontrolleret.']);

    return R.dokument({titel:'Varmetabsberegning',undertitel:'Dimensionerende varmetab efter DS 418:2026 ud fra bygningsdelenes placering',projekt:d.model||'',dato:d.dato||'',tekst:t,kilder:[
      'DS 418:2026, Beregning af bygningers varmetab, 8. udgave (2026-04-14): pkt. 4 (temperaturer), 5 (transmissionstab), 6 (ventilation), 7 (samlet varmetab), 8 (U-værdier), 8.11 og tabel 13 (jord).',
      'BR18 § 264, affattet ved BEK nr. 606 af 29/05/2018: dimensionerende transmissionstab pr. m² opvarmet etageareal, vinduer og døre medregnet.',
      'ISSANA MCP: 3D-eksport (issana-3d) og placeringsanalysen i bygningsdel-placering.js og varmetab-placering.js.']});
  }

  function filnavn(model){ return 'varmetab-'+(String(model||'model').replace(/[^\wæøåÆØÅ-]+/g,'_').replace(/^_+|_+$/g,'')||'model')+'.typ'; }
  return {lav:lav, filnavn:filnavn};
});
