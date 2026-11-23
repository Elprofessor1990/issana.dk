/* ISSANA 3D: rapport i Typst for fanen Lyd: resultat, hvilket krav der gælder for hver adskillelse og hvorfor, formler med regneeksempler
   (modellens egne tal), tabeller pr. bygningsdel, hvad der ikke er regnet på og hvorfor, og kilder. Regner intet selv: tallene kommer fra
   lydkrav.js og lyd-analyse.js, så rapporten altid viser det samme som fanen. Formlerne står i egen notation; standardens tekst er ikke kopieret.
   Browser: window.IssanaLydRapport. Node: module.exports. R er rapport-typst.js (window.IssanaTypstRapport). */
(function(root, factory){
  "use strict";
  var erNode = typeof module==='object' && module && module.exports;
  var api = factory();
  if(erNode) module.exports=api; else root.IssanaLydRapport=api;
})(typeof self!=='undefined' ? self : this, function(){
  "use strict";

  var REL={anden_enhed:'Bolig mod bolig', mod_faelles:'Mod fælles rum', ukendt:'Enhed ikke afklaret', rum_mod_rum:'Rum mod rum', samme_enhed:'Samme enhed'};
  var KAT_ORDEN=['Vægge','Gulve','Vinduer','Døre'];

  function filnavn(navn){ return 'ISSANA-lydrapport-'+String(navn||'model').replace(/[^\wæøåÆØÅ-]+/g,'_')+'.typ'; }
  function unik(l){ return l.filter(function(x,i){ return x && l.indexOf(x)===i; }); }
  // Det dårligste tilfælde med et fastlagt krav, ellers det første. Så viser regneeksemplet, hvorfor det går galt. margin > 0 er for dårligt.
  function vaelg(l, margin){
    var medKrav=l.filter(function(x){ return x.p.krav&&x.p.krav.vaerdi!=null; });
    return medKrav.length ? medKrav.reduce(function(a,b){ return margin(b.p)>margin(a.p) ? b : a; }) : (l[0]||null);
  }
  function luftMargin(p){ return p.krav.vaerdi-p.Rw_mark; }
  function trinMargin(p){ return p.Lnw_mark-p.krav.vaerdi; }
  function densiteter(kilde){ return String(kilde||'').replace(/^Skøn med [^;]*; /,''); }

  function lav(R, d){
    var K=d.K, an=d.analyse||null, res=d.resultater||[], f=d.forudsaetninger||{}, T=d.tabel||{}, m=d.model||{};
    var tal=R.tal, mt=R.mt, ov=R.overskrift, afs=R.afsnit, tb=R.tabel, nt=R.note, pkt=R.punkter, eks=R.regneeksempel;
    var ix=K.lavIndeks(m), bt=d.bygningstype&&T.bygningstyper ? T.bygningstyper[d.bygningstype] : null;
    var vis=function(s,fb){ return s==='opfyldt'&&fb&&fb.length ? 'opfyldt_forbehold' : s; };
    var stTekst=function(s,fb){ return K.TEKST[vis(s,fb)]||s; };
    var dB=function(n){ return n==null ? '–' : tal(n,1); };
    var kravT=function(k){ return !k ? '' : (k.kraevesIkke ? 'intet krav' : (k.vaerdi==null ? 'ikke fastlagt' : (k.retning==='max' ? '≤ ' : '≥ ')+tal(k.vaerdi,k.enhed==='s'?1:0)+' '+k.enhed)); };
    var celle=function(x){ if(!x||x.status==='ikke_relevant') return '–'; return (x.vaerdi!=null ? tal(x.vaerdi,1) : 'mangler')+(x.krav&&x.krav.vaerdi!=null ? ' ('+kravT(x.krav)+')' : ''); };
    var h='', i;

    /* ---------- 1. Resultat ---------- */
    h+=ov('Resultat',1);
    h+=afs('Bygningstype: '+(bt ? bt.navn : 'ikke valgt')+'. Modellen har '+res.length+' rum'+(an ? ', '+an.enheder.length+' enheder og '+Object.keys(an.rum).filter(function(k){ return an.rum[k].faelles; }).length+' fælles rum' : '')+'.');
    h+=nt(K.FORBEHOLD+' Kravtabellen har status '+(T.status||'udkast')+' (version '+(T.version||'')+') og skal godkendes fagligt.');
    var tael={}; res.forEach(function(r){ var s=stTekst(r.samlet,r.forbeholdKort); tael[s]=(tael[s]||0)+1; });
    h+=tb({kolonner:['Samlet status','Rum'], raekker:Object.keys(tael).map(function(k){ return [k,String(tael[k])]; }), justering:['left','right']});
    var sorteret=res.slice().sort(function(a,b){ return String(a.niveau||'').localeCompare(String(b.niveau||''),'da',{numeric:true})||String(a.navn).localeCompare(String(b.navn),'da',{numeric:true}); });
    h+=tb({kolonner:['Rum','Etage','Funktion','Enhed',"Luftlyd R'w",'Trinlyd L\'n,w','Støj udefra','Status'], bredder:['2fr','1fr','1.2fr','0.9fr','1.1fr','1.1fr','1.1fr','1.2fr'],
      raekker:sorteret.map(function(r){ return [r.navn, r.niveau||'', r.rumfunktion.navn||'ikke angivet', r.faelles ? 'Fælles' : (r.enhed||'–'), celle(r.dele.luftlyd), celle(r.dele.trinlyd), celle(r.dele.facade), stTekst(r.samlet,r.forbeholdKort)]; })});

    /* ---------- 2. Krav efter placering ---------- */
    h+=ov('Hvilket krav gælder, og hvorfor',1);
    h+=afs('Kravet til en væg eller et dæk afgøres af, hvad der ligger på hver side. Det læses af modellens rum, deres grænser og dørene.');
    h+=pkt(['Bolig mod bolig: kravet mellem en bolig og rum uden for boligen.','Mod fælles rum: samme krav gælder mod trappe, gang og andre rum uden for boligen. Døren har sit eget krav.','Samme enhed: der stilles ikke krav inde i en bolig, så væggen regnes ikke.','Enhed ikke afklaret: dørene viser ikke, hvilken enhed rummet hører til. Væggen regnes som skel.']);
    var set={}, luft=[], dore=[];
    res.forEach(function(r){ (r.dele.luftlyd.dele||[]).forEach(function(p){
      if(p.doer){ dore.push({r:r,p:p}); return; }
      if(!p.krav||p.krav.kraevesIkke) return;
      var ids=[String(r.rumId),String(p.naboId)].sort(), k=ids.join('|')+'|'+p.vaegId;
      if(set[k]&&set[k].p.krav.vaerdi!=null) return;
      var post={r:r,p:p}; if(set[k]) luft[luft.indexOf(set[k])]=post; else luft.push(post); set[k]=post;
    }); });
    h+=ov('Luftlyd mellem rum',2);
    h+=luft.length ? tb({kolonner:['Mellem','Bygningsdel','Placering','Krav',"R'w",'Status','Kravets kilde'], bredder:['1.8fr','1.2fr','0.9fr','0.8fr','0.6fr','1.1fr','2.2fr'],
      raekker:luft.map(function(x){ var p=x.p; return [x.r.navn+' og '+p.fra, p.vaeg, REL[p.relation]||'Rum mod rum', kravT(p.krav), dB(p.Rw_mark), stTekst(p.status,x.r.dele.luftlyd.forbeholdKort), p.krav.kilde||p.krav.note||'Rummets funktion er ikke angivet']; })}) : afs('Ingen vægge eller dæk med luftlydkrav.');
    if(dore.length){ h+=ov('Døre mod fælles rum',2);
      h+=tb({kolonner:['Rum','Mod','Dør','Krav','Rw','Status'], bredder:['1.5fr','1.5fr','1.5fr','0.8fr','0.6fr','1.2fr'], raekker:dore.map(function(x){ var p=x.p; return [x.r.navn, p.fra, p.vaeg, kravT(p.krav), dB(p.Rw_mark), stTekst(p.status)]; })}); }
    var trin=[]; res.forEach(function(r){ (r.dele.trinlyd.dele||[]).forEach(function(p){ if(p.krav&&!p.krav.kraevesIkke) trin.push({r:r,p:p}); }); });
    h+=ov('Trinlyd',2);
    h+=trin.length ? tb({kolonner:['Rummet under','Rummet over','Dæk','Krav',"L'n,w",'Kravets kilde'], bredder:['1.3fr','1.5fr','1.2fr','0.8fr','0.6fr','2.2fr'],
      raekker:trin.map(function(x){ var p=x.p; return [x.r.navn, p.fra, p.daek, kravT(p.krav), dB(p.Lnw_mark), p.krav.kilde||p.krav.note||'Rummets funktion er ikke angivet']; })}) : afs('Ingen dæk med trinlydkrav.');

    /* ---------- 3. Enheder ---------- */
    if(an&&an.brugEnheder){
      h+=ov('Enheder og fælles rum',1);
      h+=afs(an.harDoerdata ? 'Rum, der er forbundet med døre, er én enhed. Trapper, fælles gange og rum uden beboelse skiller enhederne.' : 'Eksporten har ingen døre mellem rum, så enhederne kan ikke findes. Væggene er regnet som skel.');
      if(an.enheder.length) h+=tb({kolonner:['Enhed','Rum'], bredder:['1fr','5fr'], raekker:an.enheder.map(function(e){ return [e.navn, e.rumIds.map(function(id){ return an.rum[String(id)].navn; }).join(', ')]; })});
      var fl=Object.keys(an.rum).map(function(k){ return an.rum[k]; }).filter(function(x){ return x.faelles; });
      if(fl.length) h+=tb({kolonner:['Fælles rum','Hvorfor'], bredder:['2fr','3fr'], raekker:fl.map(function(x){ return [x.navn, x.faellesGrund==='dørene' ? 'Gangen har døre til flere enheder eller er for stor til en bolig' : (x.faellesGrund==='rumnavnet' ? 'Rumnavnet siger det' : (x.enhedKilde==='bruger' ? 'Angivet af brugeren' : 'Ingen beboelse i rummet eller gruppen af rum'))]; })});
    }

    /* ---------- 4. Formler ---------- */
    h+=ov('Formler og regneeksempler',1);
    h+=afs('Eksemplerne bruger modellens egne tal. Er noget ikke opfyldt, vises det dårligste tilfælde, så man kan se hvorfor.');
    var luftP=[], trinP=[], facP=[];
    res.forEach(function(r){
      (r.dele.luftlyd.dele||[]).forEach(function(p){ if(!p.doer&&p.Rw_mark!=null&&p.status!=='ikke_relevant') luftP.push({r:r,p:p}); });
      (r.dele.trinlyd.dele||[]).forEach(function(p){ if(p.Lnw_mark!=null) trinP.push({r:r,p:p}); });
      (r.dele.facade.dele||[]).forEach(function(p){ if(p.L_inde!=null) facP.push({r:r,p:p}); });
    });
    // Luftlyd vises helst på en væg; findes ingen, bruges et dæk.
    var vaegFoer=function(l){ var v=l.filter(function(x){ var e=ix.els[String(x.p.vaegId)]; return e&&e.category==='Vægge'; }); return v.length ? v : l; };
    var skoenP=luftP.filter(function(x){ return x.p.skoen; }), ex=vaelg(vaegFoer(skoenP),luftMargin);
    if(ex){
      var p0=ex.p, lag=p0.skoen.lag||[];
      h+=eks({titel:'Flademasse', hvorfor:'Skønnet af Rw bygger på, hvor meget konstruktionen vejer pr. m². Her '+p0.vaeg+'.', formel:"m' = sum_i rho_i dot d_i", symboler:[['rho_i','lagets densitet (kg/m³)'],['d_i','lagets tykkelse (m)']],
        indsat:lag.map(function(l){ return mt(l.rho)+' dot '+mt(l.tykkelseM); }).join(' + '), resultat:mt(p0.skoen.m,4)+' "kg/m²"', kilde:'F#-motoren: acoustics.layers.mass_per_area; '+densiteter(p0.skoen.kilde)},2);
      var tung=p0.skoen.m>=Math.pow(10,(13.3+42)/(37.5-13.3));
      h+=eks({titel:'Rw ud fra massen', hvorfor:'Masseloven giver et skøn af laboratorieværdien for én tung skal. Dobbeltkonstruktioner og lette vægge skønnes ikke.', formel:tung ? "R_w = \"37,5\" dot lg(m') - 42" : "R_w = \"13,3\" dot lg(m') + \"13,3\"", symboler:[["m'",'flademassen (kg/m²)']],
        indsat:(tung ? '"37,5" dot lg('+mt(p0.skoen.m,4)+') - 42' : '"13,3" dot lg('+mt(p0.skoen.m,4)+') + "13,3"'), resultat:mt(p0.Rw_mark,3)+' "dB"', kilde:'F#-motoren: acoustics.mass_law.single_leaf_rw'},2);
    }
    var ly=vaelg(vaegFoer(luftP),luftMargin);
    if(ly){
      var p=ly.p, Rd=p.input.skillevaeg.Rw, S=p.input.skillevaeg.areal, V=p.input.modtagerVolumen, T0=p.input.T0;
      h+=eks({titel:"Luftlydisolation R'w", hvorfor:'Lyden går gennem skillevæggen og langs de tilstødende bygningsdele. Her regnes '+ly.r.navn+' mod '+p.fra+' gennem '+p.vaeg+'. '+(f.udenFlanker ? 'Flankevejene er ikke regnet med, så kun det første led er med. Det rigtige tal er derfor lavere.' : ''),
        formel:"R'_w = -10 dot lg(10^(-R_\"Dd,w\" / 10) + sum_(i j) 10^(-R_(i j,w) / 10))", symboler:[['R_"Dd,w"','skillekonstruktionens reduktionstal'],['R_(i j,w)','reduktionstal for en flankevej']],
        indsat:'-10 dot lg(10^(-'+mt(Rd,3)+' / 10))', resultat:mt(p.Rw_mark,3)+' "dB"', kilde:'DS/EN ISO 12354-1, forenklet model (lyd-12354.js)'},2);
      if(p.DnTw!=null&&V!=null&&S!=null) h+=eks({titel:"Standardiseret lydtrykniveaudifferens D'nT,w", hvorfor:'Tager højde for rummets størrelse og skillefladens areal.', formel:"D'_\"nT,w\" = R'_w + 10 dot lg((\"0,16\" dot V) / (T_0 dot S_s))", symboler:[['V','modtagerrummets volumen (m³)'],['T_0','referenceefterklangstid (s)'],['S_s','skillefladens areal (m²)']],
        indsat:mt(p.Rw_mark,3)+' + 10 dot lg(("0,16" dot '+mt(V,4)+') / ('+mt(T0,2)+' dot '+mt(S,4)+'))', resultat:mt(p.DnTw,3)+' "dB"', kilde:'DS/EN ISO 12354-1, forenklet model (lyd-12354.js)'},2);
      if(p.krav&&p.krav.vaerdi!=null) h+=eks({titel:'Sammenligning med kravet', hvorfor:REL[p.relation] ? 'Placering: '+REL[p.relation].toLowerCase()+'. '+(p.krav.note||'') : '', formel:"Delta = R'_w - R'_\"krav\"", symboler:[],
        indsat:mt(p.Rw_mark,3)+' - '+mt(p.krav.vaerdi,3), resultat:mt(p.Rw_mark-p.krav.vaerdi,3)+' "dB"', kilde:p.krav.kilde},2);
    } else h+=afs('Ingen vægge har en R\'w, der kan regnes: Rw mangler. Se afsnittet om det, der ikke er regnet på.');
    var tr=vaelg(trinP,trinMargin);
    if(tr){
      var q=tr.p, inp=q.input;
      if(q.skoen) h+=eks({titel:'Trinlyd fra det bare dæk', hvorfor:'Skønnet bygger på det bærende lag i '+q.daek+' og gælder kun homogene tunge dæk.', formel:'L_"n,eq,0,w" = 164 - 35 dot lg(m\')', symboler:[["m'",'det bærende lags flademasse (kg/m²)']],
        indsat:'164 - 35 dot lg('+mt(q.skoen.m,4)+')', resultat:mt(inp.Lnw_eq,3)+' "dB"', kilde:'F#-motoren: acoustics.impact.homogeneous_floor_equivalent; '+densiteter(q.skoen.kilde)},2);
      h+=eks({titel:"Trinlyd L'n,w", hvorfor:tr.r.navn+' med '+q.fra+' ovenover.', formel:'L\'_"n,w" = L_"n,w,eq" - Delta L_w + K', symboler:[['Delta L_w','trinlydforbedring fra gulvbelægning'],['K','tillæg for flanketransmission']],
        indsat:mt(inp.Lnw_eq,3)+' - '+mt(inp.deltaLw,3)+' + '+mt(inp.K,3), resultat:mt(q.Lnw_mark,3)+' "dB"', kilde:'DS/EN ISO 12354-2, forenklet model; F#-motoren: acoustics.impact.direct_floor_with_covering'},2);
      if(q.LnTw_mark!=null&&inp.modtagerVolumen!=null) h+=eks({titel:"Standardiseret trinlydniveau L'nT,w", hvorfor:'Tager højde for modtagerrummets størrelse.', formel:'L\'_"nT,w" = L\'_"n,w" - 10 dot lg("0,032" dot V)', symboler:[['V','modtagerrummets volumen (m³)']],
        indsat:mt(q.Lnw_mark,3)+' - 10 dot lg("0,032" dot '+mt(inp.modtagerVolumen,4)+')', resultat:mt(q.LnTw_mark,3)+' "dB"', kilde:'DS/EN ISO 12354-2, forenklet model (lyd-12354.js)'},2);
    } else h+=afs('Ingen dæk har en L\'n,w, der kan regnes.');
    var fa=facP[0]||null;
    if(fa){
      var g=fa.p, gi=g.input, S2=gi.facadeAreal, el=(gi.elementer||[]).filter(function(x){ return x.Rw!=null&&x.areal!=null; });
      h+=eks({titel:'Støj udefra gennem facaden', hvorfor:fa.r.navn+' gennem '+(g.vaeg||'facaden')+'. Mest lyd går gennem '+((g.dominerende&&g.dominerende.navn)||'det svageste element')+'.', formel:"R'_w = -10 dot lg(sum_i S_i / S dot 10^(-R_i / 10))", symboler:[['S_i','elementets areal (m²)'],['S','facadens areal (m²)'],['R_i','elementets reduktionstal']],
        indsat:'-10 dot lg('+el.map(function(x){ return mt(x.areal,4)+' / '+mt(S2,4)+' dot 10^(-'+mt(x.Rw+(f.brugCtr&&x.Ctr ? x.Ctr : 0),3)+' / 10)'; }).join(' + ')+')', resultat:mt(g.Rw_mark,3)+' "dB"', kilde:'DS/EN ISO 12354-3, forenklet model; F#-motoren: acoustics.facade.composite_reduction'},2);
      h+=eks({formel:'L_"inde" = L_"ude" - (R\'_w + Delta L_"fs" + 10 dot lg(V / (6 dot T_0 dot S)))', symboler:[['L_"ude"','støj 2 m foran facaden'],['Delta L_"fs"','tillæg for facadens form']],
        indsat:mt(g.L_ude,3)+' - ('+mt(g.Rw_mark,3)+' + '+mt(gi.deltaLfs,3)+' + 10 dot lg('+mt(gi.rumVolumen,4)+' / (6 dot '+mt(gi.T0,2)+' dot '+mt(S2,4)+')))', resultat:mt(g.L_inde,3)+' "dB"', kilde:'DS/EN ISO 12354-3, forenklet model (lyd-12354.js)'},2);
    } else h+=afs('Støj udefra er ikke regnet: støjen ved facaden eller Rw for vinduerne mangler i modellen.');

    /* ---------- 5. Bygningsdele ---------- */
    h+=ov('Bygningsdele i beregningen',1);
    var pr={};
    if(an) an.relevans.grupper.filter(function(g){ return g.med; }).forEach(function(g){ g.ids.forEach(function(id){
      var e=ix.els[String(id)]; if(!e) return;
      var k=(e.category||'')+'|'+(e.typeId!=null ? e.typeId : e.type), x=pr[k]||(pr[k]={e:e, antal:0, roller:[]});
      x.antal++; if(x.roller.indexOf(g.navn)<0) x.roller.push(g.navn);
    }); });
    var vaerdi=function(e){
      var u=[], gr=[], rv=K.rwVaerdi(ix,e,f,T), lv=e.category==='Gulve' ? K.lnwVaerdi(ix,e,f,T) : null;
      function med(navn,v){ if(v.d){ u.push(navn+' '+tal(v.d.vaerdi,1)+' dB'); gr.push(v.d.skoen ? 'Skøn ud fra massen' : (v.d.kilde||'Dokumenteret')); } else { u.push(navn+' mangler'); gr.push(v.grund||'Ingen dokumentation'); } }
      med('Rw',rv); if(lv) med('Ln,w',lv);
      return [u.join(', '), unik(gr).join('; ')];
    };
    KAT_ORDEN.forEach(function(kat){
      var rk=Object.keys(pr).map(function(k){ return pr[k]; }).filter(function(x){ return x.e.category===kat; });
      if(!rk.length) return;
      h+=ov(kat,2);
      h+=tb({kolonner:['Type','Antal','Rolle i lydberegningen','Værdi','Grundlag'], bredder:['1.8fr','0.5fr','2fr','1fr','2fr'], justering:['left','right'], raekker:rk.map(function(x){ var v=vaerdi(x.e); return [x.e.type||x.e.name||'', String(x.antal), x.roller.join(', '), v[0], v[1]]; })});
    });

    /* ---------- 6. Ikke regnet ---------- */
    h+=ov('Det, der ikke er regnet på',1);
    if(an){
      var ikke=an.relevans.grupper.filter(function(g){ return !g.med; });
      if(ikke.length) h+=tb({kolonner:['Bygningsdele','Antal','Hvorfor','Kilde'], bredder:['1.7fr','0.5fr','3fr','1.7fr'], justering:['left','right'], raekker:ikke.map(function(g){ return [g.navn,String(g.antal),g.hvorfor,g.kilde]; })});
    }
    h+=pkt(['Flankeveje: '+(f.udenFlanker ? 'ikke regnet med. Resultaterne er derfor mærket med forbehold.' : 'kræver data for samlingerne.'),'Lokaler med særligt støjende aktiviteter har et skærpet krav, som ikke er modelleret.','Lavfrekvent støj, kanaler, gennemføringer og utætheder er ikke med.','Strukturlyd fra installationer er ikke med.']);
    if(an){
      h+=ov('Forudsætninger',2);
      h+=tb({kolonner:['Forudsætning','Værdi','Hvorfor','Kilde'], bredder:['1fr','0.5fr','2.5fr','2.5fr'], raekker:an.forudsaetninger.map(function(x){ var v=f[x.noegle]; return [x.noegle, v==null ? 'ikke sat' : (v===true ? 'ja' : (v===false ? 'nej' : String(v))), x.hvorfor, x.kilde]; })});
      if(an.uafklaret.length){ h+=ov('Uafklaret',2); h+=pkt(an.uafklaret); }
    }
    var ml={}; res.forEach(function(r){ r.mangler.forEach(function(x){ var k=x.tekst; ml[k]=(ml[k]||0)+1; }); });
    var mk=Object.keys(ml).sort(function(a,b){ return ml[b]-ml[a]; });
    if(mk.length){ h+=ov('Det mangler for at gøre beregningen færdig',2);
      h+=tb({kolonner:['Mangel','Rum'], bredder:['5fr','0.6fr'], justering:['left','right'], raekker:mk.map(function(k){ return [k,String(ml[k])]; })}); }

    var kilder=['BR18 kapitel 17 Lydforhold, §§ 368-376','Bygningsreglementets vejledning om lydforhold, afsnit 2.0 (boliger og andre bygninger til overnatning) og tabel 2.1-2.4','DS 490:2018 Lydklassifikation af boliger, tabel 1-5, lydklasse C','DS/EN ISO 12354-1, -2 og -3:2017, forenklede modeller (lyd-12354.js)',
      'ISSANA_CalculationEngine: acoustics.layers.mass_per_area, acoustics.mass_law.single_leaf_rw, acoustics.impact.homogeneous_floor_equivalent, acoustics.impact.direct_floor_with_covering, acoustics.facade.composite_reduction','BygFys: densiteter (02-materialedata.js) og fast flanketillæg på trinlyd (05-beregningskerne.js)','Kravtabellen lydkrav.json, version '+(T.version||'')+', status '+(T.status||'udkast')];
    return R.dokument({titel:'Lydanalyse', undertitel:bt ? bt.navn : 'Bygningstype ikke valgt', projekt:m.model||'', dato:d.dato, tekst:h, kilder:kilder});
  }

  return {lav:lav, filnavn:filnavn};
});
