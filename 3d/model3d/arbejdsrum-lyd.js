/* ISSANA 3D, arbejdsrummet: fanen Lyd (3.0).
   Lydkrav pr. rum ud fra bygningstype og rumfunktion (lydkrav.json via lydkrav.js), sammenholdt med den forenklede
   ISO 12354-beregning i lyd-12354.js: luftlyd fra naborum (del 1), trinlyd ovenfra (del 2), udefra gennem facaden
   (del 3), installationer (del 5, forenklet) og en dokumenteret efterklangstid. Pr. rum vises krav, resultat, status
   (opfyldt / ikke opfyldt / mangler input / ikke relevant) og det, der mangler; nederst en samlet mangler-liste.

   Montering: window.issanaArbejdsrum.registrerFane({id:'lyd', titel:'Lyd', bred:true, monter(container, api)}) med
   api.model() (issana-3d/1.2), api.vaelg(indekser) + api.indeks(revitId), api.aendringsliste.tilfoej(aendring),
   api.aendringsliste.data/gemData(idx, …) og api.farvelaeg(map, {ids:true, legend}). Layoutets api regner i
   elementindekser; lydkrav.js regner i Revit-id'er, så api.indeks oversætter. Indlæses filen før layoutet, lægges
   registreringen i window.issanaArbejdsrumVentende. Findes layoutet ikke, når siden er færdigindlæst, bruges dagens
   IssanaArbejdsrum.fane(...) gennem en adapter; findes ingen af delene, advares der i konsollen, og fanen kan monteres
   manuelt med window.IssanaLydFane.monter(container, api).

   Hvad gemmes hvor:
   - Bygningstype og forudsætninger (ΔLfs, K, ΔLw, Ctr, uden flanker) gemmes lokalt i browserprofilen pr. model
     (localStorage, nøgle issana-lyd-<modelKey>). De overlever «Hent fra Revit», men følger ikke med modellen til en anden pc.
   - Rumfunktion skrives som rumbrug i «ISSANA Instance Room Use», egne lydmål, efterklangstid og installationskilde i
     rummets datapost «ISSANA Instance Data» – altid gennem ændringslisten; intet skrives i Revit uden «Gem i Revit».
   «Analyser» (knappen og AI-feltet) bruger lyd-analyse.js: placering, enheder og relevans. Forslagene (rumbrug, enhed, krav med kilde)
   lægges i ændringslisten; bygningstype og forudsætninger gemmes lokalt som før. */
(function(){
  "use strict";
  var K=window.IssanaLydkrav||null, L=window.IssanaLyd||null, A=window.IssanaLydAnalyse||null, PL=window.IssanaLydPlan||null, LS=window.IssanaLydSnit||null, LV=window.IssanaLydVisninger||null;
  var P_RUM='ISSANA Instance Room Use', P_DATA='ISSANA Instance Data', SCHEMA='issana-bygdata/1';
  var DELE=['luftlyd','trinlyd','facade','efterklang','installation'];
  var KOLONNE={luftlyd:"Luftlyd R'w", trinlyd:"Trinlyd L'n,w", facade:'Udefra (Lden)', efterklang:'Efterklang T', installation:'Installation LAeq'};
  var MAAL_FELT={luftlyd:{st:"R'w", retning:'min'}, trinlyd:{st:"L'n,w", retning:'max'}, facade:{st:'Lden', retning:'max'}, efterklang:{st:'T', retning:'max'}, installation:{st:'LAeq', retning:'max'}};
  var FARVE=(K&&K.FARVE)||{opfyldt:'#4a7c59', ikke_opfyldt:'#c65a2e', mangler_input:'#c99a2e', ikke_relevant:'#c9cec9'};
  var TEKST=(K&&K.TEKST)||{opfyldt:'Opfyldt', ikke_opfyldt:'Ikke opfyldt', mangler_input:'Mangler input', ikke_relevant:'Ikke relevant'};

  var AF='Lyd-fanen (Analyser)';
  var REL={anden_enhed:'anden enhed', mod_faelles:'fælles rum', samme_enhed:'samme enhed', ukendt:'enhed ikke afklaret', rum_mod_rum:''};
  var S={api:null, el:null, bygningstype:null, valgtRum:null, valgteRum:[], valgtDel:null, resultater:[], rumfunktionValg:{}, enhedValg:{}, alleTal:false, tabelFejl:null, henter:false, besked:null, an:null, anNoegle:null, anModel:null, analyseSvar:null, visning:'plan', plan:null, planEtage:null, planFarve:'krav', planVis:null, planValgt:null, snitRetning:'x', facadeId:null, facadeStoej:{}, rumKunMangler:false, rumFlade:null, kandidatId:null, stedCtx:null};

  /* ---------- Små hjælpere (uden afhængighed af arbejdsrum.js) ---------- */
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function fmt(n,dec){ if(n==null||!isFinite(n)) return '–'; try{ return Number(n).toLocaleString('da-DK',{minimumFractionDigits:dec||0,maximumFractionDigits:dec==null?1:dec}); }catch(e){ return String(n); } }
  function tal(v){var x=window.IssanaFagInput&&window.IssanaFagInput.tal(v,{valgfri:true});return x&&x.ok?x.vaerdi:null;}
  function $(id){ return S.el ? S.el.querySelector('#'+id) : null; }
  function vaerdi(id){ var e=$(id); return e ? e.value : ''; }
  function feltFejl(id, tekst){
    var e=$(id), besked=$(id+'Fejl');
    if(e){ if(tekst) e.setAttribute('aria-invalid','true'); else e.removeAttribute('aria-invalid'); }
    if(besked){ besked.textContent=tekst||''; besked.hidden=!tekst; }
  }
  function validerFelter(felter){
    var vaerdier={}, foerste=null, ugyldig=false;
    felter.forEach(function(f){
      var v=window.IssanaFagInput ? window.IssanaFagInput.tal(vaerdi(f.id),{navn:f.navn,positiv:!!f.positiv,valgfri:true}) : {ok:false,fejl:'Talvalideringen er ikke indlæst. Genindlæs 3D.'};
      feltFejl(f.id,v.ok?'':v.fejl);
      if(v.ok) vaerdier[f.id]=v.vaerdi; else { ugyldig=true; if(!foerste) foerste=$(f.id); }
    });
    // Bevar de indtastede felter og hele køen: ingen dataFor, mutation eller render ved fejl.
    if(ugyldig){ if(foerste&&foerste.focus) foerste.focus(); return null; }
    return vaerdier;
  }
  function talInputHtml(id, vaerdi, placeholder){
    return '<input id="'+id+'" class="arb-in kort" inputmode="decimal" aria-describedby="'+id+'Fejl" value="'+esc(vaerdi==null?'':vaerdi)+'"'+(placeholder?' placeholder="'+esc(placeholder)+'"':'')+'><span id="'+id+'Fejl" class="arb-hint issana-mangler" role="alert" hidden></span>';
  }
  function model(){ try{ return (S.api&&S.api.model&&S.api.model())||null; }catch(e){ return null; } }
  function modelNoegle(){ var m=model(); return (m&&(m.modelKey||m.model))||'model'; }
  function hent(){ try{ return JSON.parse(localStorage.getItem('issana-lyd-'+modelNoegle())||'null')||{}; }catch(e){ return {}; } }
  function gem(aendr){ var g=hent(); Object.keys(aendr).forEach(function(k){ g[k]=aendr[k]; }); try{ localStorage.setItem('issana-lyd-'+modelNoegle(),JSON.stringify(g)); }catch(e){} }
  function forudsaetninger(){ var f={deltaLfs:null,brugCtr:false,udenFlanker:false,trinK:null,trinDeltaLw:null,brugSkoen:false}, g=hent(); Object.keys(f).forEach(function(k){ if(g[k]!==undefined) f[k]=g[k]; }); return f; }
  function info(t){ if(S.api&&S.api.info) S.api.info(t); else { S.besked=t; console.info('ISSANA Lyd: '+t); } }
  function fejl(t){ if(S.api&&S.api.fejl) S.api.fejl(t); else { S.besked=t; console.warn('ISSANA Lyd: '+t); } }
  function rumNavn(r){ return ((r.number ? r.number+' ' : '')+(r.name||'')).trim()||('Rum '+r.id); }
  function parseData(s){ if(!s) return null; if(typeof s==='object') return s; try{ var o=JSON.parse(s); return o&&typeof o==='object'&&!Array.isArray(o) ? o : null; }catch(e){ return null; } }

  /* ---------- Ændringslisten: samme ændringsobjekt som arbejdsrum.js ---------- */
  function aendring(rum, param, til, hvad){
    var raw=(rum.bygdata&&rum.bygdata.raw)||{}, fra=raw[param];
    return {uniqueId:rum.uniqueId, param:param, fra:fra==null?'':String(fra), til:til, navn:'Rum '+rumNavn(rum)+' ('+rum.id+')', kraeverOpsaetning:fra==null, obj:rum, instans:true, hvad:[hvad]};
  }
  // Enhed og krav fra analysen: kun en ændring, når indholdet er nyt, så «Analyser» kan køres igen uden at fylde listen op.
  function laegLyd(rum, lyd){
    var rec=dataFor(rum); rec.lyd=rec.lyd||{};
    if(JSON.stringify([rec.lyd.placering||null,rec.lyd.krav||null])===JSON.stringify([lyd.placering||null,lyd.krav||null])) return false;
    rec.lyd.placering=lyd.placering; if(lyd.krav) rec.lyd.krav=lyd.krav; else delete rec.lyd.krav;
    rec.schema=SCHEMA; (rec.historik||(rec.historik=[])).push({tid:new Date().toISOString(), felt:'lydanalyse', af:AF});
    if(rec.historik.length>50) rec.historik=rec.historik.slice(-50);
    var x=aendring(rum, P_DATA, JSON.stringify(rec), 'lydanalyse'); x.af=AF;
    return tilfoej(x);
  }
  function tilfoej(x){
    if(!S.api||!S.api.aendringsliste||typeof S.api.aendringsliste.tilfoej!=='function'){ fejl('Ændringslisten er ikke tilgængelig; intet er lagt i den.'); return false; }
    if(!x.uniqueId){ fejl('Rummet har ingen uniqueId og kan ikke ændres.'); return false; }
    S.api.aendringsliste.tilfoej(x); return true;
  }
  // Rummets indeks i layoutets api (−1 uden api eller uden rummet)
  function idxAf(id){ var a=S.api; if(!a||typeof a.indeks!=='function') return -1; var i=a.indeks(id); return i==null? -1 : i; }
  function dataFor(rum){
    if(S.api&&S.api.dataFor) return S.api.dataFor(rum);
    var a=S.api, i=idxAf(rum.id);
    if(a&&a.aendringsliste&&typeof a.aendringsliste.data==='function'&&i>=0){ var d=a.aendringsliste.data(i,'element'); if(d) return d; }   // ser også det, der ligger i ændringslisten
    var raw=(rum.bygdata&&rum.bygdata.raw)||{};
    return parseData(raw[P_DATA])||(rum.bygdata&&rum.bygdata.data ? JSON.parse(JSON.stringify(rum.bygdata.data)) : null)||{schema:SCHEMA};
  }
  function gemData(rum, rec, hvad){
    if(S.api&&S.api.gemData) return S.api.gemData(rum, rec, hvad);
    var a=S.api, i=idxAf(rum.id);
    if(a&&a.aendringsliste&&typeof a.aendringsliste.gemData==='function'&&i>=0) return a.aendringsliste.gemData(i, rec, hvad, 'element')!==false;
    rec.schema=SCHEMA;
    (rec.historik||(rec.historik=[])).push({tid:new Date().toISOString(), felt:hvad, af:null});
    if(rec.historik.length>50) rec.historik=rec.historik.slice(-50);
    return tilfoej(aendring(rum, P_DATA, JSON.stringify(rec), hvad));
  }

  /* ---------- Beregning ---------- */
  function kanFarve(){ return !!(S.api&&(S.api.saetFilter||typeof S.api.farvelaeg==='function')); }
  function farvRum(){
    var a=S.api; if(!a) return;
    if(a.saetFilter){ a.saetFilter({kategori:{'Rum':true}},'lydrum'); return; }
    // 3.0: rummene farves efter samlet status gennem layoutets farvelaeg (opslag pr. Revit-id)
    var map={}, tael={}; S.resultater.forEach(function(r){ var s=visStatus(r.samlet,r.forbeholdKort); map[r.rumId]=FARVE[s]||null; tael[s]=(tael[s]||0)+1; });
    a.farvelaeg(map,{ids:true, titel:'Lyd i rum', legend:function(){ return '<h4>Lyd i rum (krav og beregning)</h4>'+Object.keys(tael).map(function(k){ return '<div class="legrow"><span class="sw" style="background:'+FARVE[k]+'"></span>'+esc(TEKST[k]||k)+' ('+tael[k]+')</div>'; }).join('')+'<div class="legrow arb-note">Forenklet beregning, ikke en lydberegning efter standardens fulde metode.</div>'; }});
  }
  // Placering og enheder regnes én gang pr. model og valg; analysen ændrer intet i modellen.
  function analyse(){
    var m=model(); if(!A||!K||!m||!Array.isArray(m.elements)) return null;
    var n=JSON.stringify([S.bygningstype, S.rumfunktionValg, S.enhedValg]);
    if(S.an && S.anModel===m && S.anNoegle===n) return S.an;
    try{ S.an=A.analyser(m, {bygningstype:S.bygningstype, rumfunktioner:S.rumfunktionValg, bruger:S.enhedValg}); }
    catch(e){ console.warn('ISSANA Lyd: analysen fejlede', e); S.an=null; }
    S.anModel=m; S.anNoegle=n;
    return S.an;
  }
  function beregn(){
    var m=model(); S.resultater=[];
    if(!K||!L||!m) return;
    S.resultater=K.vurderAlle(m, S.bygningstype, {forudsaetninger:forudsaetninger(), rumfunktioner:S.rumfunktionValg, analyse:analyse()});
    S.plan=null;
    if(PL&&S.an){ try{ S.plan=PL.byg(m, S.resultater, S.an); }catch(e){ console.warn('ISSANA Lyd: plantegningen kunne ikke laves', e); } }
    if(S.api&&S.api.tilfoejLag){
      var pr={}; S.resultater.forEach(function(r){ pr[String(r.rumId)]=r.samlet; });
      S.api.tilfoejLag({id:'lydrum', titel:'Lyd i rum (krav og beregning)', v:function(i){ return i.erRum ? [pr[String(i.ed.id)]||'ikke_relevant'] : ['(ikke et rum)']; },
        tekst:function(v){ return TEKST[v]||v; }, farve:function(v){ return FARVE[v]; }});
    }
  }
  function resultatFor(rumId){ for(var i=0;i<S.resultater.length;i++) if(S.resultater[i].rumId===rumId) return S.resultater[i]; return null; }

  /* ---------- Visning ---------- */
  function chip(status){ return '<span class="arb-status" style="--c:'+(FARVE[status]||'#ccc')+'" title="'+esc(TEKST[status]||status)+'">'+esc(TEKST[status]||status)+'</span>'; }
  // «Opfyldt», men kun ud fra et skøn eller uden flanker: vises som «med forbehold», ikke som rent grønt (BygFys-reglen).
  function visStatus(status, forbehold){ return status==='opfyldt'&&forbehold&&forbehold.length ? 'opfyldt_forbehold' : status; }
  function kravTekst(k){
    if(!k) return '';
    if(k.kraevesIkke) return '<div class="arb-n">intet krav</div>';
    if(k.vaerdi==null) return '<div class="arb-n issana-mangler">krav ikke fastlagt</div>';
    return '<div class="arb-n" title="'+esc(k.kilde||'')+'">krav '+(k.retning==='max' ? '≤ ' : '≥ ')+fmt(k.vaerdi,k.enhed==='s'?1:0)+' '+esc(k.enhed)+(k.egetMaal ? ' <b>(eget mål)</b>' : (k.status==='udkast' ? ' <i>udkast</i>' : ''))+'</div>';
  }
  function celle(x){
    if(!x) return '<td></td>';
    var v=x.vaerdi!=null ? fmt(x.vaerdi,1)+' '+esc(x.enhed||'') : (x.tekst&&x.status==='ikke_relevant' ? esc(x.tekst) : '–'), s=visStatus(x.status,x.forbeholdKort);
    return '<td><span class="arb-status" style="--c:'+(FARVE[s]||'#ccc')+'" title="'+esc(TEKST[s]||s)+(x.mangler&&x.mangler.length ? ': '+x.mangler.map(function(m){ return m.tekst; }).join(' · ') : '')+(x.forbeholdKort&&x.forbeholdKort.length ? ': '+x.forbeholdKort.join(' · ') : '')+'">'+v+'</span>'+kravTekst(x.krav)+'</td>';
  }
  function enhedTekst(r){ return r.faelles ? 'Fælles rum' : (r.enhed||''); }
  // Feltet «Bygningsdele i beregningen»: hvad der regnes med, og hvad der ikke gør, med grund og kilde.
  function relevansHtml(an){
    if(!an||!an.relevans) return '';
    var r=an.relevans, raekke=function(g){ return '<div class="arb-aendr" data-grp="'+esc(g.id)+'" role="button" tabindex="0" title="Vælg dem i 3D" style="cursor:pointer"><b>'+esc(g.navn)+'</b> ('+g.antal+')<div class="arb-n">'+esc(g.hvorfor)+' · '+esc(g.kilde)+'</div></div>'; };
    var med=r.grupper.filter(function(g){ return g.med; }), ikke=r.grupper.filter(function(g){ return !g.med; });
    return '<details class="arb-lag" id="lydRelevans"><summary>Bygningsdele i beregningen ('+r.antalMed+' med, '+r.antalIkke+' ikke med)</summary>'+
      '<div class="arb-sek">Regnes med</div>'+(med.map(raekke).join('')||'<div class="arb-hint">Ingen.</div>')+
      '<div class="arb-sek">Regnes ikke med</div>'+(ikke.map(raekke).join('')||'<div class="arb-hint">Ingen.</div>')+
      '<div class="arb-hint">Klik på en gruppe for at vælge den i 3D.</div></details>';
  }
  // Plantegningen: krav og værdi pr. væg, etage for etage (lyd-plan.js). Zoom med hjulet, træk for at flytte, klik for at se og vælge væggen.
  function planEtage(){
    if(!S.plan||!S.plan.etager.length) return null;
    var e=S.plan.etager.filter(function(x){ return x.navn===S.planEtage; })[0];
    if(e) return e;
    S.planVis=null;
    var bedst=S.plan.etager.reduce(function(a,b){ return b.dele.filter(function(d){ return d.krav; }).length>a.dele.filter(function(d){ return d.krav; }).length ? b : a; });
    S.planEtage=bedst.navn; return bedst;
  }
  function alleManglerRum(){
    var ud=[];
    (S.plan&&S.plan.etager||[]).forEach(function(et){ et.rum.forEach(function(r){ if(r.manglerType&&r.boks) ud.push({etage:et,rum:r}); }); });
    return ud;
  }
  function manglerRumtypeTekst(){
    var mangler=alleManglerRum(); if(!mangler.length) return 'Alle rum har en rumtype ✓';
    var i=mangler.map(function(x){return String(x.rum.id);}).indexOf(String(S.valgtRum)); if(i<0)i=0;
    return 'Rum '+(i+1)+' af '+mangler.length+' uden rumtype';
  }
  function flytManglerRum(retning){
    var ms=alleManglerRum(); if(!ms.length)return null;
    var nu=ms.map(function(x){return String(x.rum.id);}).indexOf(String(S.valgtRum));if(nu<0)nu=retning>0?-1:0;
    var x=ms[(nu+retning+ms.length)%ms.length], r=x.rum, et=x.etage;
    S.planEtage=et.navn;S.valgteRum=[r.id];S.valgtRum=r.id;
    S.planValgt=null;S.valgtDel=null;
    S.planVis=planVisForRum(et,r);
    return x;
  }
  function naesteManglerRum(){return flytManglerRum(1);}
  function forrigeManglerRum(){return flytManglerRum(-1);}
  function planVisForRum(et,r){
    var rw=r.boks.x1-r.boks.x, rh=r.boks.y1-r.boks.y, bredde=400, hoejde=350;
    var helSkala=Math.min(bredde/et.boks.b,hoejde/et.boks.h);
    if(Math.min(rw,rh)*helSkala>=40)return null;
    var skala=40/Math.max(.01,Math.min(rw,rh)), vw=bredde/skala, vh=hoejde/skala;
    vw=Math.max(vw,rw/.4);vh=Math.max(vh,rh/.4);
    if(vw>=et.boks.b&&vh>=et.boks.h)return null;
    return {x:(r.boks.x+r.boks.x1-vw)/2,y:-(r.boks.y+r.boks.y1+vh)/2,b:vw,h:vh};
  }
  function planVisForRumOgNaboer(et,r){
    var mr=rumAf(r.id),gra=(mr&&mr.graenser||[]).map(function(g){return String(g.id);}),ids={};ids[String(r.id)]=1;
    (model().rooms||[]).forEach(function(x){if((x.graenser||[]).some(function(g){return gra.indexOf(String(g.id))>=0;}))ids[String(x.id)]=1;});
    var rs=et.rum.filter(function(x){return ids[String(x.id)]&&x.boks;});if(!rs.length)rs=[r];
    var q={x:Infinity,y:Infinity,x1:-Infinity,y1:-Infinity};rs.forEach(function(x){q.x=Math.min(q.x,x.boks.x);q.y=Math.min(q.y,x.boks.y);q.x1=Math.max(q.x1,x.boks.x1);q.y1=Math.max(q.y1,x.boks.y1);});
    var rw=Math.max(.1,q.x1-q.x),rh=Math.max(.1,q.y1-q.y),vw=rw*1.35,vh=rh*1.35,format=400/350;
    if(vw/vh<format)vw=vh*format;else vh=vw/format;
    return {x:(q.x+q.x1-vw)/2,y:-(q.y+q.y1+vh)/2,b:vw,h:vh};
  }
  function planHtml(){
    var e=planEtage(); if(!e) return '';
    var fk=PL.forklaring(e,S.planFarve), med=e.dele.filter(function(d){ return d.krav; }).slice().sort(function(a,b){ return String(a.navn).localeCompare(String(b.navn),'da'); }), mangler=alleManglerRum();
    return '<style>'+PL.CSS+'</style><section class="arb-lag" id="lydPlanBoks"><div class="arb-sek">Plan · efterklang i rum og luftlyd mellem rum</div>'+
      '<div class="arb-grid"><label class="arb-felt"><span>Etage</span><select id="lydPlanEtage" class="arb-in">'+S.plan.etager.map(function(x){ return '<option value="'+esc(x.navn)+'"'+(x.navn===e.navn?' selected':'')+'>'+esc(x.navn)+'</option>'; }).join('')+'</select></label>'+
      '<label class="arb-felt"><span>Farv efter</span><select id="lydPlanFarve" class="arb-in"><option value="krav"'+(S.planFarve==='krav'?' selected':'')+'>Hvilket krav</option><option value="status"'+(S.planFarve==='status'?' selected':'')+'>Status</option></select></label></div>'+
      '<div class="lyd-plan-boks" id="lydPlanSvg">'+PL.svg(e,{vis:S.planVis||e.boks,farve:S.planFarve,pxPrM:30,valgteRum:S.valgteRum,valgtDel:S.valgtDel,snitRetning:S.snitRetning})+'</div>'+
      valgtRumHtml()+
      '<div class="arb-row">'+fk.map(function(x){ return '<span class="legrow" style="display:inline-flex;opacity:'+(x.antal?1:.42)+'"><span class="sw" style="background:'+x.farve+'"></span>'+(x.tegn ? esc(x.tegn)+' ' : '')+esc(x.navn)+' ('+x.antal+')</span>'; }).join('')+'</div>'+
      '<div class="arb-row"><button class="tbtn" id="lydPlanHel">Hele planen</button><span class="arb-status" style="--c:'+(mangler.length?'#d9a323':FARVE.opfyldt)+'">'+manglerRumtypeTekst()+'</span>'+(mangler.length?'<button class="tbtn" id="lydPlanForrige">Forrige</button><button class="tbtn" id="lydPlanNaeste">Næste</button>':'')+'</div>'+
      '<div class="arb-hint" id="lydPlanInfo">Klik på et rum; Ctrl-klik vælger flere. Klik på en væg for krav. Hjul zoomer, træk flytter. Den stiplede linje A–A er snittet under fanen Snit.</div>'+
      '<details class="arb-lag"><summary>Tabel over vægge med krav ('+med.length+')</summary><table class="arb-tab lyd-plan-tal"><thead><tr><th>Bygningsdel</th><th>Krav</th><th>Værdi</th><th>Status</th></tr></thead><tbody>'+
      med.map(function(d){ return '<tr><td><button data-pdel="'+esc(d.id)+'">'+esc(d.navn)+'</button></td><td>'+esc(d.krav)+' dB</td><td>'+esc(d.vaerdi)+'</td><td>'+esc(TEKST[d.status]||d.status)+'</td></tr>'; }).join('')+'</tbody></table></details></section>';
  }
  function planDel(id){ var e=planEtage(); return e ? e.dele.filter(function(d){ return String(d.id)===String(id); })[0] : null; }
  function planInfoHtml(){
    var d=S.planValgt!=null ? planDel(S.planValgt) : null;
    if(!d) return 'Klik på en væg for at se dens krav, værdi og kilde.';
    if(!d.linjer.length) return '<b>'+esc(d.navn)+'</b>: '+(d.kat==='ingen' ? 'intet krav inden for samme enhed.' : 'ikke med i beregningen.');
    var set={};
    return '<b>'+esc(d.navn)+'</b>'+d.linjer.filter(function(l){ var k=l.mellem+l.navn; if(set[k]) return false; set[k]=1; return true; }).map(function(l){
      return '<div>'+esc(l.mellem)+': '+esc(l.navn)+' '+esc(l.krav.vaerdi==null ? 'krav ikke fastlagt' : (l.krav.retning==='max'?'≤ ':'≥ ')+fmt(l.krav.vaerdi,0)+' dB')+', værdi '+(l.vaerdi!=null ? fmt(l.vaerdi,1)+' dB' : 'mangler')+(l.skoen ? ' (skøn)' : '')+'. '+esc(TEKST[l.status]||l.status)+(l.kilde ? ' <span class="arb-n">'+esc(l.kilde)+'</span>' : '')+'</div>'; }).join('');
  }
  function valgtRumHtml(){
    var ids=S.valgteRum||[], rf=K.rumfunktioner();
    if(!ids.length) return '<div class="arb-note" id="lydRumkort"><b>Udpeg rum</b><div class="arb-hint">Klik på et rum i tegningen. Hold Ctrl nede for at vælge flere.</div></div>';
    var navne=ids.map(function(id){var r=rumAf(id);return r?rumNavn(r):String(id);}), rr=resultatFor(ids[0]);
    var forslag=ids.map(function(id){var x=resultatFor(id),f=x&&x.rumfunktion&&!x.rumfunktion.id&&x.rumfunktion.forslag;return f?{id:id,rf:f.id,navn:f.navn}:null;}).filter(Boolean);
    var typer=ids.map(function(id){var x=resultatFor(id);return x&&x.rumfunktion&&x.rumfunktion.id||'';});
    var blandet=typer.some(function(x){return x!==typer[0];}), valgt=blandet?null:typer[0], forslagIds=forslag.map(function(x){return x.rf;});
    var korte={opholdsrum:'Opholdsrum',soverum:'Værelse',koekken:'Køkken',bad:'Bad/wc',gang:'Gang',trappe:'Trappe',undervisningsrum:'Undervisning',kontor:'Kontor',moederum:'Møderum',teknikrum:'Teknik',depot:'Depot',andet:'Andet'}, bt=K.tabel()&&K.tabel().bygningstyper&&K.tabel().bygningstyper[S.bygningstype], relevante=bt&&bt.rumfunktioner||{};
    rf=rf.slice().sort(function(a,b){return (a.id===valgt?-3:relevante[a.id]?-2:0)-(b.id===valgt?-3:relevante[b.id]?-2:0)||a.navn.localeCompare(b.navn,'da');});
    var valgtType=rf.filter(function(x){return x.id===valgt;})[0];
    function manglerTekst(x){
      var ud=[];
      function tag(q){var t=q&&q.tekst!=null?q.tekst:q;if(t&&ud.indexOf(String(t))<0)ud.push(String(t));}
      (x.mangler||[]).forEach(tag);
      (x.dele||[]).forEach(function(d){(d.mangler||d.alleMangler||[]).forEach(tag);});
      return ud.filter(function(t){return !/^mangler dokumentation$/i.test(t);})[0]||null;
    }
    function vaegId(x){
      var d=(x.dele||[]).filter(function(q){return q&&q.vaegId!=null;})[0];
      return d&&d.vaegId;
    }
    function statusRaekke(navn,tekst,handling){
      return '<div class="lyd-rumstatuslinje"><span class="lyd-rumstatusnavn">'+esc(navn)+':</span>'+
        '<span class="lyd-rumstatustekst">'+tekst+'</span><span class="lyd-rumstatushandling">'+
        (handling||'')+'</span></div>';
    }
    function linje(navn,x,art){
      if(!x) return statusRaekke(navn,'mangler beregningsdata','');
      if(x.status==='ikke_relevant') return statusRaekke(navn,esc(TEKST.ikke_relevant||'Ikke relevant'),'');
      var s=visStatus(x.status,x.forbeholdKort), harKrav=x.krav&&x.krav.vaerdi!=null;
      var k=harKrav?'krav '+(x.krav.retning==='max'?'≤ ':'≥ ')+fmt(x.krav.vaerdi,x.krav.enhed==='s'?1:0)+' '+esc(x.krav.enhed||''):'krav ikke fastlagt for denne rumtype';
      if(x.vaerdi!=null){
        var t=harKrav?(s==='opfyldt'||s==='opfyldt_forbehold'?'✓':s==='ikke_opfyldt'?'✕':'?'):'';
        return statusRaekke(navn,fmt(x.vaerdi,1)+' '+esc(x.enhed||'')+' · '+k+(t?' '+t:''),'');
      }
      var m=manglerTekst(x), handling='', vid;
      if(art==='efterklang'){m='mangler dokumenteret efterklangstid';handling='<button class="tbtn" data-angiv="lydEft">Angiv</button>';}
      else if(art==='trin'){handling='<button class="tbtn" data-vis-snit="'+esc(ids[0])+'">Vis i snit</button>';}
      else if(art==='luft'&&(vid=vaegId(x))!=null){handling='<button class="tbtn" data-vis-vaeg="'+esc(vid)+'">Vis væg</button>';}
      if(!m)m=harKrav?'mangler beregningsdata':'krav ikke fastlagt for denne rumtype';
      var krav=(!harKrav&&m==='krav ikke fastlagt for denne rumtype')?'':k+' · ';
      return statusRaekke(navn,krav+esc(m),handling);
    }
    return '<style>#lydRumkort{container-type:inline-size}.lyd-rumchips{display:grid;grid-template-columns:repeat(2,1fr);gap:5px;margin:6px 0 8px}.lyd-rumchips button{text-align:left;min-height:30px}.lyd-rumchips button.on{outline:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 12%,var(--bg-elev))}.lyd-rumchips button.forslag:not(.on){border-style:dashed}.lyd-rumtype-valg{margin-top:8px}.lyd-rumstatus{display:grid;gap:7px;margin-top:7px}.lyd-rumstatuslinje{display:grid;grid-template-columns:104px minmax(0,1fr) auto;gap:8px;align-items:center;min-width:0}.lyd-rumstatusnavn{font-weight:600;text-align:left}.lyd-rumstatustekst{min-width:0;overflow-wrap:anywhere}.lyd-rumstatushandling{justify-self:end;min-width:0}.lyd-rumstatushandling:empty{width:0}@container (min-width:560px){.lyd-rumchips{grid-template-columns:repeat(3,1fr)}}</style><div class="arb-note" id="lydRumkort"><b>'+ids.length+' rum valgt</b><div class="arb-n">'+esc(navne.slice(0,4).join(', '))+(navne.length>4?' …':'')+'</div><div class="arb-sek">Rumtype</div>'+(blandet?'<div class="arb-n">Forskellige rumtyper</div>':valgtType?'<div><b>Rumtype: '+esc(valgtType.navn)+'</b><button class="tbtn lyd-rumtype-valg" data-fortryd-rumtype-valgte>Fortryd</button></div>':'<div class="arb-n"><b>Rumtype: ikke valgt</b></div>')+(forslag.length?'<div class="arb-note"><b>Forslag:</b> '+esc(forslag.map(function(x){return x.navn;}).join(', '))+' <button class="tbtn primary lyd-rumtype-valg" data-godkend-forslag>Bekræft'+(forslag.length>1?' forslag for '+forslag.length+' rum':'')+'</button></div>':'')+'<div class="arb-n">Bruges på alle valgte rum</div><div class="lyd-rumchips">'+rf.map(function(x){return '<button class="tbtn lyd-rumchip'+(x.id===valgt?' on':'')+(forslagIds.indexOf(x.id)>=0&&x.id!==valgt?' forslag':'')+'" data-rumtype="'+esc(x.id)+'">'+esc(korte[x.id]||x.navn)+'</button>';}).join('')+'</div><div class="lyd-rumstatus">'+linje('Efterklang',rr&&rr.dele&&rr.dele.efterklang,'efterklang')+linje('Trin fra oven',rr&&rr.dele&&rr.dele.trinlyd,'trin')+linje('Luft fra naboer',rr&&rr.dele&&rr.dele.luftlyd,'luft')+'</div></div>';
  }
  function visningsSkiftHtml(){
    if(LV) return '<style>'+LV.CSS+'</style>'+LV.tabsHtml(S.visning);
    var css='<style>.lyd-visningsskift{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:6px 0}.lyd-visningsskift button{height:36px;font-size:11px;font-weight:700;border:1px solid var(--border);border-radius:5px;background:var(--bg-elev);color:var(--text);cursor:pointer;white-space:nowrap}.lyd-visningsskift button.on{border-color:var(--accent);box-shadow:inset 0 -2px 0 var(--accent)}</style>';
    return css+'<div class="lyd-visningsskift" role="tablist"><button id="lydVisPlan" class="'+(S.visning==='plan'?'on':'')+'" aria-selected="'+(S.visning==='plan')+'">Plan · efterklang og naborum</button><button id="lydVisSnit" class="'+(S.visning==='snit'?'on':'')+'" aria-selected="'+(S.visning==='snit')+'">Snit · trinlyd mellem etager</button></div>';
  }
  function snitHtml(){
    if(!LS||!S.an) return '<div class="arb-tom">Snitvisningen kunne ikke indlæses.</div>';
    var rumId=S.valgteRum[0]||S.valgtRum, snit=LS.byg(model(),S.resultater,S.an,{rumId:rumId,retning:S.snitRetning}); S.snit=snit; S.valgtRum=snit.rumId; if(!S.valgteRum.length&&snit.rumId!=null) S.valgteRum=[snit.rumId];
    return '<style>'+LS.CSS+'</style><section class="arb-lag" id="lydSnitBoks"><div class="arb-sek">Snit · trinlyd og lodret luftlyd</div><div class="arb-row"><span>Retning:</span><button class="tbtn '+(S.snitRetning==='x'?'primary':'')+'" id="lydSnitX">På langs</button><button class="tbtn '+(S.snitRetning==='y'?'primary':'')+'" id="lydSnitY">På tværs</button></div><div class="lyd-snit-boks" id="lydSnitSvg">'+LS.svg(snit)+'</div><div class="arb-hint">Pil ned: trinlydniveau L’n,w. Pil op: luftlydisolation R’w.</div></section>';
  }
  function etageVaelgerHtml(){
    var e=planEtage(); if(!e) return '';
    return '<label class="arb-felt"><span>Valgt etage</span><select id="lydPlanEtage" class="arb-in">'+S.plan.etager.map(function(x){return '<option value="'+esc(x.navn)+'"'+(x.navn===e.navn?' selected':'')+'>'+esc(x.navn)+'</option>';}).join('')+'</select></label>';
  }
  function miniPlan(et,vis,valgtDel){
    if(!PL||!et) return '';
    return '<style>'+PL.CSS+'</style><div class="lyd-plan-boks">'+PL.svg(et,{vis:vis||et.boks,farve:'status',pxPrM:30,breddePx:320,hoejdePx:350,valgteRum:S.valgteRum,valgtDel:valgtDel,snitRetning:S.snitRetning,visVaeglabel:false})+'</div>';
  }
  function facadeHtml(){
    var et=planEtage(); if(!LV||!et) return '<div class="arb-tom">Facadevisningen kunne ikke indlæses.</div>';
    var fs=LV.facader(model(),S.resultater,et.navn,S.facadeStoej); S.facadeListe=fs;
    if(!fs.some(function(x){return String(x.id)===String(S.facadeId);})) S.facadeId=fs.length?fs[0].id:null;
    return '<section class="arb-lag" id="lydFacadeBoks">'+etageVaelgerHtml()+LV.facadeHtml(fs,S.facadeId,miniPlan(et,et.boks,S.facadeId))+LV.signaturHtml()+'</section>';
  }
  function rumHtml(){
    var et=planEtage(); if(!LV||!et) return '<div class="arb-tom">Rumvisningen kunne ikke indlæses.</div>';
    var liste=LV.rumliste(model(),S.resultater,et.navn); S.rumListe=liste;
    if(!liste.some(function(x){return String(x.id)===String(S.valgtRum);})) S.valgtRum=liste.length?liste[0].id:null;
    if(S.valgtRum!=null) S.valgteRum=[S.valgtRum];
    var flader=LV.rumflader(model(),S.resultater,S.plan,et.navn,S.valgtRum); S.rumFlader=flader;
    if(!flader.some(function(x){return String(x.id)===String(S.rumFlade);})) S.rumFlade=flader.length?flader[0].id:null;
    var pr=et.rum.filter(function(r){return String(r.id)===String(S.valgtRum);})[0], vis=pr?planVisForRumOgNaboer(et,pr):et.boks;
    var rr=resultatFor(S.valgtRum), ef=rr&&rr.dele&&rr.dele.efterklang, eft=ef&&ef.krav?(ef.vaerdi==null?'Efterklang: lydmål mangler.':'Efterklang '+fmt(ef.vaerdi,1)+' '+esc(ef.enhed||'s')+' · '+kravTekst(ef.krav)):'Efterklang: intet krav for det valgte rum.';
    return '<section class="arb-lag" id="lydRumVisning">'+etageVaelgerHtml()+LV.rumHtml(liste,flader,S.valgtRum,S.rumFlade,miniPlan(et,vis,S.rumFlade),S.rumKunMangler,eft)+'</section>';
  }
  function kravFraLinje(l,fallback){
    if(!l||!l.krav) return {tekst:'Intet krav valgt',tal:null,retning:'min'};
    var navn=fallback||l.navn||'Lydmål';
    return {tekst:navn+' '+kravTekst(l.krav),tal:l.krav.vaerdi,retning:l.krav.retning||'min'};
  }
  function elementAf(id){ return (model().elements||[]).filter(function(e){return String(e.id)===String(id);})[0]||null; }
  function stedData(){
    if(!LV) return null;
    var m=model(), et=planEtage(), e=null, k=null, ctx=null, alle=[], stoerrelse='Rw', kategori=null;
    if(S.visning==='plan'&&et){
      if(S.planValgt==null&&S.valgtRum!=null){var pr=et.rum.filter(function(r){return String(r.id)===String(S.valgtRum);})[0];if(pr){var rf=resultatFor(pr.id),rt=rf&&rf.rumfunktion||{},fl=LV.rumflader(m,S.resultater,S.plan,et.navn,pr.id);return {rum:{id:pr.id,navn:pr.navn||('Rum '+pr.id),rumfunktionNavn:rt.id?rt.navn:null,forslag:!rt.id&&rt.forslag?{id:rt.forslag.id,navn:rt.forslag.navn}:null,manglerType:pr.manglerType},flader:fl};}}
      var d=planDel(S.planValgt); if(!d)return null;
      e=elementAf(d.id); var l=d.linjer&&d.linjer[0], p=kravFraLinje(l);
      alle=et.dele.filter(function(x){return x.krav&&x.kat===d.kat&&x.kategori===d.kategori;}).map(function(x){return elementAf(x.id);}).filter(Boolean);
      var alleNavn=d.kat==='skel'?'vægge mellem rum':d.kat==='faelles'?'vægge mod fælles rum':d.kat==='facade'?'facader':'vægge med samme krav';
      ctx={kicker:'Valgt væg · luftlyd',titel:l&&l.mellem?'Mellem '+l.mellem:(e&&e.type||d.navn),fra:l&&l.mellem||'Lyd i det ene rum',til:'Høres i naborummet',fagord:"R'w er, hvor mange dB væggen dæmper. Højere tal er bedre.",krav:p.tekst,kravTal:p.tal,retning:p.retning,element:e,enhed:'væg',alleTekst:alleNavn,antalAlle:alle.length||1,alleElementer:alle,stoerrelse:'Rw'};
    } else if(S.visning==='snit'&&S.snit){
      var sag=S.snit.sager.filter(function(x){return String(x.daekId)===String(S.valgtDel);})[0]||S.snit.sager.filter(function(x){return String(x.ned)===String(S.snit.rumId);})[0]||S.snit.sager.filter(function(x){return String(x.over)===String(S.snit.rumId);})[0]; if(!sag)return null;
      e=elementAf(sag.daekId); var kp=kravFraLinje(sag.trin,"L'n,w"), op=S.snit.alleRum[String(sag.over)], ned=S.snit.alleRum[String(sag.ned)];
      alle=S.snit.sager.map(function(x){return x.daekId;}).filter(function(id,i,a){return a.map(String).indexOf(String(id))===i;}).map(elementAf).filter(Boolean);
      ctx={kicker:'Valgt dæk · trinlyd',titel:'Mellem '+(op?op.navn:'rummet ovenover')+' og '+(ned?ned.navn:'rummet nedenunder'),fra:'Trin ovenpå',til:'Høres nedenunder',fagord:"L'n,w er, hvor meget trin høres nedenunder. Lavere tal er bedre.",krav:kp.tekst,kravTal:kp.tal,retning:'max',element:e,enhed:'dæk',alleTekst:'dæk mellem rum',antalAlle:alle.length||1,alleElementer:alle,stoerrelse:'Ln,w'};
    } else if(S.visning==='facade'){
      var f=(S.facadeListe||[]).filter(function(x){return String(x.id)===String(S.facadeId);})[0]; if(!f)return null;
      e=f.element; alle=(S.facadeListe||[]).map(function(x){return x.element;}); stoerrelse='Rw+Ctr'; kategori='Vinduer';
      var alleVinduer=[]; (S.facadeListe||[]).forEach(function(x){alleVinduer=alleVinduer.concat(x.vinduer||[]);});
      ctx={kicker:'Valgt facade · støj udefra',titel:f.navn+' · '+f.rum.length+' rum',fra:'Ude · støjen',til:'Inde · rummet',fagord:'Rw + Ctr er, hvor mange dB vinduet dæmper trafikstøj. Højere tal er bedre.',krav:f.kravInde==null?(S.bygningstype==='hotel'?'BR18-vejledningen har ingen særskilte tal for hoteller; vælg et projektkrav.':'Intet krav valgt'):'Højst '+fmt(f.kravInde,1)+' dB inde',kravTal:f.daempning,retning:'min',element:e,enhed:'facade',alleTekst:'facader og gavle på etagen',antalAlle:alle.length||1,alleElementer:alle,anvendEn:f.vinduer,anvendAlle:alleVinduer,stoerrelse:stoerrelse,kandidatKategori:kategori,facade:f,vinduer:f.vinduer.length};
    } else if(S.visning==='rum'){
      var fl=(S.rumFlader||[]).filter(function(x){return String(x.id)===String(S.rumFlade);})[0]; if(!fl)return null;
      e=fl.element; var kl=kravFraLinje(fl.linje), mang=(S.rumFlader||[]).filter(function(x){return x.status==='mangler';});
      stoerrelse=fl.side==='top'||fl.side==='bund'?'Ln,w':'Rw';
      var valgtNavn=((S.rumListe||[]).filter(function(x){return String(x.id)===String(S.valgtRum);})[0]||{}).navn||'det valgte rum';
      ctx={kicker:'Valgt flade',titel:fl.navn,fra:fl.art==='Loft'?'Trin i rummet ovenover':fl.art==='Gulv'?'Trin i '+valgtNavn:'Lyd i '+valgtNavn,til:fl.art==='Gulv'?'Høres i rummet nedenunder':fl.nabo?'Høres i '+fl.nabo:'Høres i '+valgtNavn,fagord:stoerrelse==='Ln,w'?"L'n,w er, hvor meget trin høres nedenunder. Lavere tal er bedre.":"R'w er, hvor mange dB væggen dæmper. Højere tal er bedre.",krav:kl.tekst,kravTal:kl.tal,retning:stoerrelse==='Ln,w'?'max':'min',element:e,enhed:'flade',alleTekst:'flader, der mangler lydmål',antalAlle:mang.length||1,alleElementer:mang.map(function(x){return x.element;}).filter(Boolean),stoerrelse:stoerrelse};
    }
    if(!ctx||!e)return ctx;
    ctx.type=LV.typeAf(m,e); ctx.maal=LV.lydMaal(m,e); ctx.lag=LV.lagTekst(m,e); ctx.kandidatId=S.kandidatId;
    if(ctx.facade&&ctx.facade.vinduer.length) ctx.maal=LV.lydMaal(m,ctx.facade.vinduer[0]);
    var prod=LV.bibliotekProdukter(typeof localStorage==='undefined'?null:localStorage,window.IssanaProdukter);ctx.bibliotekTomt=!prod.length;
    ctx.kandidater=LV.kandidater(prod,ctx.kandidatKategori||e.category,ctx.stoerrelse); ctx.produkter=prod;
    if(!ctx.kandidater.some(function(x){return String(x.id)===String(S.kandidatId);})) S.kandidatId=ctx.kandidatId=null;
    return ctx;
  }
  function visningHtml(){
    var hoved=S.visning==='snit'?snitHtml():S.visning==='facade'?facadeHtml():S.visning==='rum'?rumHtml():planHtml();
    if(!LV) return visningsSkiftHtml()+hoved;
    var et=planEtage(), kontekst=S.visning==='snit'?'Snit gennem '+esc(S.snit&&S.snit.detail&&S.snit.detail.midt?S.snit.detail.midt.navn:'det valgte rum'):'Etage '+esc(et?et.navn:'ikke valgt');
    var uden='';
    if(S.visning==='plan'&&et) uden=et.dele.filter(function(d){return !d.krav;}).length+' vægge er ikke med, fordi der ikke er krav til dem.';
    else if(S.visning==='snit'&&S.snit) uden=S.snit.sager.filter(function(s){return s.trin&&s.trin.status==='ikke_relevant';}).length+' dæk er ikke med, fordi der ikke er krav til dem.';
    else if(S.visning==='rum'&&S.rumFlader) uden=LV.optael(S.rumFlader).uden_krav+' flader er uden krav.';
    if(S.visning!=='facade') hoved+=LV.signaturHtml(uden);
    S.stedCtx=stedData();
    return '<div class="lyd-fire">'+visningsSkiftHtml()+'<div class="lyd-fire-kontekst">'+kontekst+'</div><div class="lyd-fire-layout"><div class="lyd-fire-main">'+hoved+'</div>'+LV.panelHtml(S.stedCtx)+'</div></div>';
  }
  function anvendKandidat(alle){
    var c=S.stedCtx, id=S.kandidatId; if(!c||!id||!S.api||!S.api.aendringsliste||typeof S.api.aendringsliste.tilfoej!=='function') return 0;
    var k=(c.kandidater||[]).filter(function(x){return String(x.id)===String(id);})[0]; if(!k)return 0;
    var elementer=alle?(c.anvendAlle||c.alleElementer||[]):(c.anvendEn||[c.element]), typer={}, tm={};
    (model().types||[]).forEach(function(t){tm[String(t.id)]=t;});
    elementer.filter(Boolean).forEach(function(e){var t=tm[String(e.typeId)];if(t)typer[String(t.id)]=t;});
    Object.keys(typer).forEach(function(tid){
      var t=typer[tid], b=t.bygdata||{}, raa=b.raw&&b.raw['ISSANA Data']||'', rec;
      try{rec=JSON.parse(raa||'{}');}catch(x){rec={};}
      if(!rec||typeof rec!=='object'||Array.isArray(rec))rec={}; rec.schema=rec.schema||SCHEMA; rec.lyd=rec.lyd||{};
      var l=k.produkt.lyd||{}, stoerrelse=c.stoerrelse==='Ln,w'?'Ln,w':'Rw', vaerdi=stoerrelse==='Ln,w'?l.Lnw:l.Rw;
      rec.lyd.dokumenteret={stoerrelse:stoerrelse,vaerdi:vaerdi,enhed:'dB',metode:l.metode||'produktdata',kilde:l.kilde};
      if(stoerrelse==='Rw'&&l.Ctr!=null)rec.lyd.dokumenteret.Ctr=l.Ctr;
      rec.produkt={id:k.produkt.id,navn:k.produkt.navn};
      S.api.aendringsliste.tilfoej({obj:t,uniqueId:t.uniqueId,instans:false,param:'ISSANA Data',fra:raa,til:JSON.stringify(rec),hvad:['Lyd: vælg '+k.produkt.navn]});
    });
    var n=Object.keys(typer).length; if(n)info(k.produkt.navn+' er lagt i ændringslisten for '+n+' type'+(n===1?'':'r')+'. Intet er gemt i Revit.');
    return n;
  }
  function bindPlan(){
    var boks=$('lydPlanSvg'), et=planEtage(); if(!boks||!et||!boks.querySelector) return;
    var svg=boks.querySelector('svg'), tekst=svg&&svg.querySelector('.lp-tekst'); if(!svg||!tekst||typeof boks.getBoundingClientRect!=='function') return;
    function vis(){ return S.planVis||et.boks; }
    function pxPrM(v){ var r=boks.getBoundingClientRect(); return r.width>0&&r.height>0 ? Math.min(r.width/v.b, r.height/v.h) : 30; }
    function tegn(){ var v=vis(); svg.setAttribute('viewBox',v.x+' '+v.y+' '+v.b+' '+v.h); tekst.innerHTML=PL.rumTekstSvg(et,pxPrM(v)); }
    function markerDel(id){ S.planValgt=id; S.valgtDel=id; S.valgteRum=[]; S.valgtRum=null; vaelgIds([id]); render(); }
    function markerRum(id,tilfoej){ vaelgRum(id,tilfoej); }
    tegn();
    if(S.planValgt!=null) svg.querySelectorAll('.lp-del').forEach(function(p){ p.classList.toggle('on', String(p.getAttribute('data-del'))===String(S.planValgt)); });
    boks.addEventListener('wheel',function(e){ e.preventDefault(); var v=vis(), r=boks.getBoundingClientRect(), k=e.deltaY>0 ? 1.2 : 1/1.2, s=pxPrM(v), mx=v.x+(e.clientX-r.left-(r.width-v.b*s)/2)/s, my=v.y+(e.clientY-r.top-(r.height-v.h*s)/2)/s; S.planVis={x:mx-(mx-v.x)*k, y:my-(my-v.y)*k, b:v.b*k, h:v.h*k}; tegn(); },{passive:false});
    var tr=null;
    boks.onpointerdown=function(e){ var v=vis(); tr={x:e.clientX,y:e.clientY,v:v,s:pxPrM(v),flyttet:false}; try{ boks.setPointerCapture(e.pointerId); }catch(x){} };
    boks.onpointermove=function(e){ if(!tr) return; var dx=e.clientX-tr.x, dy=e.clientY-tr.y; if(Math.abs(dx)+Math.abs(dy)>4) tr.flyttet=true; if(!tr.flyttet) return; S.planVis={x:tr.v.x-dx/tr.s, y:tr.v.y-dy/tr.s, b:tr.v.b, h:tr.v.h}; tegn(); };
    boks.onpointerup=function(e){ var t=tr; tr=null; try{ boks.releasePointerCapture(e.pointerId); }catch(x){} if(!t||t.flyttet) return; var m=document.elementFromPoint(e.clientX,e.clientY), hit=m&&m.closest?m.closest('[data-del],[data-rum]'):m, did=hit&&hit.getAttribute&&hit.getAttribute('data-del'), rid=hit&&hit.getAttribute&&hit.getAttribute('data-rum'); if(did) markerDel(isNaN(Number(did)) ? did : Number(did)); else if(rid) markerRum(isNaN(Number(rid)) ? rid : Number(rid),!!(e.ctrlKey||e.metaKey||e.shiftKey)); };
    S.el.querySelectorAll('button[data-pdel]').forEach(function(b){ b.onclick=function(){ var v=b.getAttribute('data-pdel'); markerDel(isNaN(Number(v)) ? v : Number(v)); }; });
  }
  function vaelgRum(id,tilfoej){
    id=isNaN(Number(id))?id:Number(id); var liste=tilfoej?(S.valgteRum||[]).slice():[];
    var i=liste.map(String).indexOf(String(id)); if(i>=0&&tilfoej) liste.splice(i,1); else if(i<0) liste.push(id);
    S.valgteRum=liste; S.valgtRum=liste[0]||null; S.planValgt=null; S.valgtDel=null; vaelgIds(liste); render();
  }
  function bindSnit(){
    var b=$('lydSnitSvg'); if(!b||!b.querySelector) return;
    function fremhaev(id){ var d=$('lydSnitDetalje'); if(d&&S.snit) d.innerHTML=LS.detaljeSvg(S.snit,id); b.querySelectorAll('[data-nabo]').forEach(function(r){r.classList.toggle('on',String(r.getAttribute('data-nabo'))===String(id));}); }
    b.querySelectorAll('[data-nabo]').forEach(function(r){ r.onmouseenter=function(){fremhaev(r.getAttribute('data-nabo'));}; r.onclick=function(e){e.stopPropagation();fremhaev(r.getAttribute('data-nabo'));}; });
    b.querySelectorAll('[data-vaelg-rumtype]').forEach(function(knap){ knap.onclick=function(e){e.stopPropagation();var id=knap.getAttribute('data-vaelg-rumtype');vaelgRum(isNaN(Number(id))?id:Number(id),false);requestAnimationFrame(function(){var k=$('lydRumkort');if(k&&k.scrollIntoView)k.scrollIntoView({behavior:'smooth',block:'start'});});}; });
    b.querySelectorAll('[data-vis-daek]').forEach(function(knap){ knap.onclick=function(e){e.stopPropagation();var id=knap.getAttribute('data-vis-daek');S.valgtDel=isNaN(Number(id))?id:Number(id);vaelgIds([S.valgtDel]);}; });
    b.onclick=function(e){ var hit=e.target&&e.target.closest?e.target.closest('[data-rum],[data-del]'):e.target, rid=hit&&hit.getAttribute&&hit.getAttribute('data-rum'), did=hit&&hit.getAttribute&&hit.getAttribute('data-del'); if(rid) vaelgRum(isNaN(Number(rid))?rid:Number(rid),false); else if(did){ S.valgtDel=isNaN(Number(did))?did:Number(did); vaelgIds([S.valgtDel]); } };
  }
  function analyseSvarHtml(){
    var x=S.analyseSvar; if(!x) return '';
    var nr=S.an&&S.an.rum?Object.keys(S.an.rum).length:S.resultater.length, ne=S.an&&S.an.enheder?S.an.enheder.length:0, nm=S.an&&S.an.rum?Object.keys(S.an.rum).filter(function(k){return !S.an.rum[k].rfId;}).length:0;
    return '<details class="arb-lag" id="lydAnalyseSvar"><summary><b>'+nr+' rum · '+ne+' enheder · '+nm+' rum mangler rumtype</b> <span class="arb-n">Vis detaljer</span></summary><div class="arb-hint">'+esc(x.tekst)+'</div>'+(x.uafklaret.length ? '<ul class="arb-hint">'+x.uafklaret.map(function(t){ return '<li>'+esc(t)+'</li>'; }).join('')+'</ul>' : '')+'<div class="arb-n">Forslagene ligger i ændringslisten. Intet er gemt i Revit.</div></details>';
  }
  function rumtypeForslag(ids){
    var valgte=ids&&ids.length?ids.map(String):null;
    return (S.resultater||[]).map(function(r){var f=r.rumfunktion&&r.rumfunktion.forslag;if(!f||r.rumfunktion.id||(valgte&&valgte.indexOf(String(r.rumId))<0))return null;return {id:r.rumId,rf:f.id,navn:f.navn};}).filter(Boolean);
  }
  function rumtypeAdvarselHtml(){
    var n=(S.resultater||[]).filter(function(r){return !(r.rumfunktion&&r.rumfunktion.id);}).length;if(!n)return '';
    var forslag=rumtypeForslag(),grupper={};forslag.forEach(function(f){var g=grupper[f.rf]||(grupper[f.rf]={navn:f.navn,antal:0});g.antal++;});
    var oversigt=Object.keys(grupper).sort(function(a,b){return grupper[b].antal-grupper[a].antal;}).map(function(k){var g=grupper[k];return '<span>'+esc(g.navn)+' · '+g.antal+' rum</span>';}).join('');
    return '<div class="arb-note issana-mangler" id="lydRumtypeAdvarsel"><b>'+n+' rum mangler rumtype. Kravene kan først findes, når rumtypen er valgt.</b> <button type="button" class="tbtn" id="lydVaelgRumtyper">Vælg rumtyper</button>'+(oversigt?'<div class="lyd-rumtypeforslag">'+oversigt+'</div><button type="button" class="tbtn primary" data-godkend-alle-forslag>Bekræft alle forslag ('+forslag.length+')</button>':'')+'<div class="arb-n">'+(n-forslag.length)+' rum uden forslag. Forslag anvendes først efter bekræftelse og kan fortrydes i ændringslisten.</div></div>';
  }
  function kilderHtml(){
    var g=hent().analyseKilder; if(!g||!Object.keys(g).length) return '';
    var navn={udenFlanker:'Uden flanker', brugSkoen:'Skøn fra lag', trinK:'Trinlyd K', trinDeltaLw:'Trinlyd ΔLw', deltaLfs:'ΔLfs'};
    return '<div class="arb-hint">Sat af Analyser:</div><ul class="arb-hint">'+Object.keys(g).map(function(k){ var x=g[k]; return '<li><b>'+esc(navn[k]||k)+'</b>: '+esc(String(x.vaerdi))+'. '+esc(x.hvorfor)+' <span class="arb-n">('+esc(x.kilde)+')</span></li>'; }).join('')+'</ul>';
  }
  function rumfunktionSelect(r){
    var rf=K.rumfunktioner(), valgt=r.rumfunktion.id||'', h='<select class="arb-in" aria-label="Rumtype for '+esc(r.navn)+'" data-rf="'+esc(r.rumId)+'"><option value="">– vælg –</option>';
    rf.forEach(function(x){ h+='<option value="'+esc(x.id)+'"'+(x.id===valgt?' selected':'')+'>'+esc(x.navn)+'</option>'; });
    h+='</select>';
    if(r.rumfunktion.kilde==='valgt') h+='<div class="arb-n">i ændringslisten (rumbrug «'+esc(K.tabel().rumfunktioner[r.rumfunktion.id].rumbrug)+'»)</div>';
    else if(r.rumfunktion.kilde==='rumbrug') h+='<div class="arb-n">fra rumbrug «'+esc(r.rumbrug)+'»</div>';
    else if(r.rumfunktion.ukendtRumbrug) h+='<div class="arb-n issana-mangler">rumbrug «'+esc(r.rumbrug)+'» kendes ikke i lydkrav.json</div>';
    else if(r.rumfunktion.forslag) h+='<div class="arb-n">forslag fra navnet: '+esc(r.rumfunktion.forslag.navn)+' <button class="tbtn" aria-label="Bekræft rumtypeforslag for '+esc(r.navn)+'" data-godkend="'+esc(r.rumId)+'" data-id="'+esc(r.rumfunktion.forslag.id)+'">Godkend</button></div>';
    else h+='<div class="arb-n issana-mangler">ikke angivet</div>';
    return h;
  }

  function render(){
    var el=S.el; if(!el) return;
    if(!K||!L){ el.innerHTML='<div class="arb-tom">Lyd-fanen kræver lyd-12354.js og lydkrav.js. Tjek, at begge er indlæst i Revit-modelviewer.html.</div>'; return; }
    var m=model(), h='';
    if(m&&m.exercise&&m.exercise.synthetic)h+='<div class="arb-note"><b>Øvelse</b> · Lydværdierne er undervisningsantagelser, ikke dokumenterede produkt- eller Revit-data.</div>';
    if(S.besked){ h+='<div class="arb-hint">'+esc(S.besked)+'</div>'; S.besked=null; }
    if(!K.tabel()){
      h+='<div class="arb-note"><b>Kravtabellen lydkrav.json er ikke indlæst.</b> '+(S.henter ? 'Henter…' : (S.tabelFejl ? esc(S.tabelFejl)+' ' : ''))+
        'Åbnes siden direkte fra en fil (file://), kan browseren ikke hente den selv; vælg filen her: <input type="file" id="lydTabelFil" accept=".json"> eller åbn 3D fra Revit.</div>';
    }
    if(!m||!Array.isArray(m.elements)){ el.innerHTML=h+'<div class="arb-tom">Hent modellen fra Revit først.</div>'; bindTabelFil(); return; }
    var rum=K.lavIndeks(m).rum;
    if(!rum.length){ el.innerHTML=h+'<div class="arb-tom">Modellen har ingen placerede rum. Lydkravene gælder pr. rum, så rummene skal være tegnet i Revit.</div>'; bindTabelFil(); return; }
    beregn();
    var f=forudsaetninger(), bt=K.bygningstyper(), valgtBt=null;
    bt.forEach(function(b){ if(b.id===S.bygningstype) valgtBt=b; });

    h+='<style>.lyd-toplinje{display:grid;grid-template-columns:minmax(180px,1fr) auto;gap:7px;align-items:end}.lyd-toplinje .arb-felt{margin:0}#v3dock-lyd .arb-sek{font-size:11px}.lyd-rumtypeforslag{display:flex;flex-wrap:wrap;gap:5px 12px;margin:8px 0;font-size:11px}</style><div class="lyd-toplinje">'+
      '<label class="arb-felt"><span>Bygningstype (BR18 kap. 17)</span><select id="lydBt" class="arb-in"><option value="">– vælg –</option>'+
      bt.map(function(b){ return '<option value="'+esc(b.id)+'"'+(b.id===S.bygningstype?' selected':'')+'>'+esc(b.navn)+'</option>'; }).join('')+'</select></label>'+(A?'<button class="tbtn primary" id="lydAnalyser">Analyser</button>':'')+'</div>'+
      (valgtBt ? '<details class="arb-hint"><summary>Grundlag: '+esc(valgtBt.kilde)+'</summary>Kravene er standardmål fra lydkrav.json ('+esc(K.tabel().status||'')+', version '+esc(K.tabel().version||'')+'); dine egne lydmål på rummet går forud.</details>'
               : '<div class="arb-hint issana-mangler">Vælg bygningstypen for at slå kravene op. Valget gemmes lokalt pr. model.</div>');

    if(A) h+=analyseSvarHtml()+rumtypeAdvarselHtml()+((PL||LS)?visningHtml():'')+relevansHtml(S.an);

    h+='<details class="arb-lag"><summary>Forudsætninger (dine valg)</summary><div class="arb-grid">'+
      '<label class="arb-felt"><span>ΔLfs facadeform, dB</span>'+talInputHtml('lydDLfs',f.deltaLfs,'fx 0')+'</label>'+
      '<label class="arb-felt"><span>Trinlyd K, dB</span>'+talInputHtml('lydK',f.trinK)+'</label>'+
      '<label class="arb-felt"><span>Trinlyd ΔLw, dB</span>'+talInputHtml('lydDLw',f.trinDeltaLw,'0 uden belægning')+'</label></div>'+
      '<label class="arb-chk"><input type="checkbox" id="lydCtr"'+(f.brugCtr?' checked':'')+'> Brug Rw + Ctr (trafikstøj)</label>'+
      '<label class="arb-chk"><input type="checkbox" id="lydUdenFlank"'+(f.udenFlanker?' checked':'')+'> Luftlyd uden flanketransmission (kun direkte vej; giver for høj R\'w)</label>'+
      '<label class="arb-chk"><input type="checkbox" id="lydSkoen"'+(f.brugSkoen?' checked':'')+'> Skøn Rw og Ln,w ud fra typens lag, hvor der ikke er dokumentation (kun tunge enkeltvægge og homogene dæk)</label>'+
      '<div class="arb-hint">T0 = 0,5 s (referenceværdi). Støjen udefra sættes på facadevæggene (ISSANA Instance Outdoor Noise, fx «68 dB Lden»).</div>'+kilderHtml()+'</details>';

    var tael={}; S.resultater.forEach(function(r){ var s=visStatus(r.samlet,r.forbeholdKort); tael[s]=(tael[s]||0)+1; });
    h+='<div class="arb-row"><span class="arb-tal">'+S.resultater.length+' rum</span>'+Object.keys(tael).map(function(k){ return '<span class="arb-status" style="--c:'+FARVE[k]+'">'+esc(TEKST[k])+' '+tael[k]+'</span>'; }).join(' ')+'</div>';
    h+='<div class="arb-row">'+(kanFarve() ? '<button class="tbtn" id="lydVis">Farv rummene i 3D</button>' : '')+'<button class="tbtn" id="lydCsv">CSV</button><button class="tbtn" id="lydRapport">Rapport (Typst)</button><button class="tbtn" id="lydOpdater">Opdatér</button></div>';

    h+='<div class="arb-row"><button class="tbtn" id="lydAlleTal" aria-pressed="'+S.alleTal+'">'+(S.alleTal?'Vis kompakt oversigt':'Vis alle lydtal')+'</button><span class="arb-hint">Klik på et rum for detaljer.</span></div>';
    h+='<div class="lyd-overblik'+(S.alleTal?' alle-tal':'')+'"><table class="arb-tab"> <thead><tr><th>Rum</th><th>Rumfunktion</th>'+DELE.map(function(d){ return '<th class="lyd-tal">'+esc(KOLONNE[d])+'</th>'; }).join('')+'<th>Mangler</th></tr></thead><tbody>';
    var sorteret=S.resultater.slice().sort(function(a,b){ return String(a.niveau||'').localeCompare(String(b.niveau||''),'da',{numeric:true})||String(a.navn).localeCompare(String(b.navn),'da',{numeric:true}); });
    sorteret.forEach(function(r){
      h+='<tr data-rum="'+esc(r.rumId)+'"'+(S.valgtRum===r.rumId?' class="on"':'')+'><td>'+chip(visStatus(r.samlet,r.forbeholdKort))+' '+esc(r.navn)+'<div class="arb-n">'+esc(r.niveau||'')+(enhedTekst(r) ? ' · '+esc(enhedTekst(r)) : '')+'</div></td><td>'+rumfunktionSelect(r)+'</td>'+
        DELE.map(function(d){ return celle(r.dele[d]).replace('<td','<td class="lyd-tal"'); }).join('')+'<td>'+(r.mangler.length ? '<span class="issana-mangler">'+r.mangler.length+'</span>' : '0')+'</td></tr>';
    });
    h+='</tbody></table></div><div id="lydDetalje"></div>';

    // Samlet mangler-liste
    var alleM={}; S.resultater.forEach(function(r){ r.mangler.forEach(function(x){ var k=alleM[x.tekst]||(alleM[x.tekst]={tekst:x.tekst, rum:[]}); if(k.rum.indexOf(r.navn)<0) k.rum.push(r.navn); }); });
    var mk=Object.keys(alleM).sort(function(a,b){ return alleM[b].rum.length-alleM[a].rum.length; });
    h+='<details class="arb-lag"><summary>Mangler ('+mk.length+')</summary>';
    h+=mk.length ? '<ul class="arb-hint">'+mk.slice(0,5).map(function(k){ var x=alleM[k]; return '<li>'+esc(x.tekst)+' <span class="arb-n">('+x.rum.length+' rum: '+esc(x.rum.slice(0,6).join(', '))+(x.rum.length>6?', …':'')+')</span></li>'; }).join('')+'</ul>'+(mk.length>5?'<details><summary>Vis alle ('+mk.length+')</summary><ul class="arb-hint">'+mk.slice(5).map(function(k){var x=alleM[k];return '<li>'+esc(x.tekst)+' <span class="arb-n">('+x.rum.length+' rum)</span></li>';}).join('')+'</ul></details>':'')
                 : '<div class="arb-hint">Intet mangler.</div>';
    h+='</details>';
    h+='<div class="arb-note">Forenklet beregning efter DS/EN ISO 12354 (enkelttalsværdier) med de registrerede data, sammenholdt med kravtabellen lydkrav.json (BR18 kap. 17, Bygningsreglementets vejledning om lydforhold og DS 490 lydklasse C; status udkast, skal godkendes fagligt). Det er ikke en lydberegning efter standardens fulde metode, ikke en måling og ikke en myndighedsvurdering.</div>';
    el.innerHTML=h;
    bind();
    if(S.valgtRum!=null){ var rr=resultatFor(S.valgtRum); if(rr) detalje($('lydDetalje'), rr, rum.filter(function(x){ return x.id===S.valgtRum; })[0]); }
  }

  function bindTabelFil(){
    var fi=$('lydTabelFil'); if(!fi) return;
    fi.onchange=function(){ var fil=fi.files&&fi.files[0]; if(!fil) return; var rd=new FileReader();
      rd.onload=function(){ try{ var fejlListe=K.saetTabel(JSON.parse(String(rd.result))); S.tabelFejl=fejlListe.length ? 'Filen har fejl: '+fejlListe.join('; ') : null; }catch(e){ S.tabelFejl='Filen er ikke gyldig JSON: '+e.message; } render(); };
      rd.readAsText(fil,'utf-8'); };
  }
  function bind(){
    bindTabelFil();
    var sel=$('lydBt'); if(sel) sel.onchange=function(){ S.bygningstype=sel.value||null; gem({bygningstype:S.bygningstype}); render(); };
    var gemF=function(){
      var vals=validerFelter([{id:'lydDLfs',navn:'Facadekorrektion'},{id:'lydK',navn:'Trinlydkorrektion'},{id:'lydDLw',navn:'Trinlydforbedring'}]); if(!vals)return;
      var ny={deltaLfs:vals.lydDLfs, trinK:vals.lydK, trinDeltaLw:vals.lydDLw, brugCtr:!!($('lydCtr')&&$('lydCtr').checked), udenFlanker:!!($('lydUdenFlank')&&$('lydUdenFlank').checked), brugSkoen:!!($('lydSkoen')&&$('lydSkoen').checked)};
      var g=hent(), rettet=g.rettet||{}, kilder=g.analyseKilder||{}, f0=forudsaetninger();
      // Det, brugeren selv ændrer, skriver Analyser ikke over igen, og det står ikke længere som «sat af Analyser».
      Object.keys(ny).forEach(function(k){ if(ny[k]!==f0[k]){ rettet[k]=1; delete kilder[k]; } });
      ny.rettet=rettet; ny.analyseKilder=kilder; gem(ny); render(); };
    ['lydDLfs','lydK','lydDLw','lydCtr','lydUdenFlank','lydSkoen'].forEach(function(id){ var e=$(id); if(e) e.onchange=gemF; });
    var an=$('lydAnalyser'); if(an) an.onclick=koerAnalyse;
    S.el.querySelectorAll('[data-grp]').forEach(function(d){ d.onclick=function(){ vaelgGruppe(d.getAttribute('data-grp')); }; d.onkeydown=function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); vaelgGruppe(d.getAttribute('data-grp')); } }; });
    var vis=$('lydVis'); if(vis) vis.onclick=function(){ farvRum(); info(S.api.saetFilter ? 'Rummene er farvet efter lydstatus. Nulstil filtrene under Lag for at se hele modellen igen.' : 'Rummene er farvet efter lydstatus (Farve → «Fra sporet»). Vælg Materiale i Farve-vælgeren for at gå tilbage. Slå «Vis rum» til under Lag, hvis rummene ikke ses.'); };
    var opd=$('lydOpdater'); if(opd) opd.onclick=render;
    var alle=$('lydAlleTal'); if(alle) alle.onclick=function(){ S.alleTal=!S.alleTal; render(); };
    var csv=$('lydCsv'); if(csv) csv.onclick=eksporterCsv;
    var rp=$('lydRapport'); if(rp) rp.onclick=laegRapport;
    var vp=$('lydVisPlan'); if(vp) vp.onclick=function(){ S.visning='plan'; render(); };
    var vs=$('lydVisSnit'); if(vs) vs.onclick=function(){ S.visning='snit'; render(); };
    var vf=$('lydVisFacade'); if(vf) vf.onclick=function(){ S.visning='facade'; S.kandidatId=null; render(); };
    var vr=$('lydVisRum'); if(vr) vr.onclick=function(){ S.visning='rum'; S.kandidatId=null; render(); };
    var pe=$('lydPlanEtage'); if(pe) pe.onchange=function(){ S.planEtage=pe.value; S.planVis=null; S.planValgt=null; render(); };
    var pf=$('lydPlanFarve'); if(pf) pf.onchange=function(){ S.planFarve=pf.value; render(); };
    var ph=$('lydPlanHel'); if(ph) ph.onclick=function(){ S.planVis=null; render(); };
    var pp=$('lydPlanForrige'); if(pp) pp.onclick=function(){ if(forrigeManglerRum())render(); };
    var pn=$('lydPlanNaeste'); if(pn) pn.onclick=function(){ if(naesteManglerRum())render(); };
    var vt=$('lydVaelgRumtyper'); if(vt) vt.onclick=function(){var ms=alleManglerRum();if(!ms.length)return;var x=ms[0];S.visning='plan';S.planEtage=x.etage.navn;S.valgteRum=[x.rum.id];S.valgtRum=x.rum.id;S.planValgt=null;S.valgtDel=null;S.planVis=planVisForRum(x.etage,x.rum);render();};
    S.el.querySelectorAll('button[data-godkend-alle-forslag]').forEach(function(b){b.onclick=function(){bekraeftRumtypeForslag();};});
    bindPlan();
    bindSnit();
    var sx=$('lydSnitX'); if(sx) sx.onclick=function(){ S.snitRetning='x'; render(); };
    var sy=$('lydSnitY'); if(sy) sy.onclick=function(){ S.snitRetning='y'; render(); };
    S.el.querySelectorAll('[data-facade]').forEach(function(b){ b.onclick=function(){ S.facadeId=b.getAttribute('data-facade'); S.valgtDel=isNaN(Number(S.facadeId))?S.facadeId:Number(S.facadeId); S.kandidatId=null; vaelgIds([S.valgtDel]); render(); }; });
    var facadePlan=$('lydFacadePlan'); if(facadePlan)facadePlan.onclick=function(e){var hit=e.target&&e.target.closest&&e.target.closest('[data-del]'),id=hit&&hit.getAttribute('data-del');if(!id||!(S.facadeListe||[]).some(function(x){return String(x.id)===String(id);}))return;S.facadeId=id;S.valgtDel=isNaN(Number(id))?id:Number(id);S.kandidatId=null;vaelgIds([S.valgtDel]);render();requestAnimationFrame(function(){var kort=$('lydFacadeKort-'+id);if(kort&&kort.scrollIntoView)kort.scrollIntoView({behavior:'smooth',block:'nearest'});});};
    S.el.querySelectorAll('[data-stoej-id]').forEach(function(i){ i.onchange=function(){ var id=i.getAttribute('data-stoej-id'), x=S.facadeStoej[id]||{}, v=window.IssanaFagInput.tal(i.value,{navn:'Facadestøj',valgfri:true}); if(i.setCustomValidity)i.setCustomValidity(v.ok?'':v.fejl);if(!v.ok){if(i.reportValidity)i.reportValidity();return;}x.vaerdi=v.vaerdi; x.kilde='Skrevet ind'; S.facadeStoej[id]=x; render(); }; });
    S.el.querySelectorAll('[data-stoej-kilde]').forEach(function(s){ s.onchange=function(){ var id=s.getAttribute('data-stoej-kilde'), x=S.facadeStoej[id]||{}; x.kilde=s.value; S.facadeStoej[id]=x; render(); }; });
    var kun=$('lydRumKunMangler'); if(kun)kun.onchange=function(){S.rumKunMangler=kun.checked;render();};
    S.el.querySelectorAll('[data-lyd-rum]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-lyd-rum');S.valgtRum=isNaN(Number(id))?id:Number(id);S.valgteRum=[S.valgtRum];S.rumFlade=null;S.kandidatId=null;vaelgIds([S.valgtRum]);render();};});
    S.el.querySelectorAll('[data-lyd-flade]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-lyd-flade');S.rumFlade=isNaN(Number(id))?id:Number(id);S.valgtDel=S.rumFlade;S.kandidatId=null;vaelgIds([S.valgtDel]);render();};});
    var nf=$('lydNaesteFlade'); if(nf)nf.onclick=function(){var f=(S.rumFlader||[]).filter(function(x){return x.status==='mangler';});if(!f.length)return;var i=f.map(function(x){return String(x.id);}).indexOf(String(S.rumFlade));S.rumFlade=f[(i+1)%f.length].id;S.valgtDel=S.rumFlade;vaelgIds([S.valgtDel]);render();};
    S.el.querySelectorAll('[data-lyd-kandidat]').forEach(function(b){b.onclick=function(){S.kandidatId=b.getAttribute('data-lyd-kandidat');render();};});
    S.el.querySelectorAll('[data-lyd-brug]').forEach(function(b){b.onclick=function(){anvendKandidat(b.getAttribute('data-lyd-brug')==='alle');};});
    S.el.querySelectorAll('[data-skift-krav]').forEach(function(b){b.onclick=function(){var d=$('lydDetalje');if(d&&d.scrollIntoView)d.scrollIntoView({behavior:'smooth',block:'start'});info('Kravet vælges på det relevante rum i detaljerne. Intet er ændret.');};});
    S.el.querySelectorAll('[data-angiv-db]').forEach(function(b){b.onclick=function(){var d=$('lydDetalje');if(d&&d.scrollIntoView)d.scrollIntoView({behavior:'smooth',block:'start'});info('Angiv det dokumenterede lydmål på den fælles bygningsdel under Egenskaber.');};});
    S.el.querySelectorAll('button[data-rumtype]').forEach(function(b){ b.onclick=function(){ saetRumfunktioner(S.valgteRum.slice(),b.getAttribute('data-rumtype')); }; });
    S.el.querySelectorAll('button[data-godkend-forslag]').forEach(function(b){b.onclick=function(){bekraeftRumtypeForslag(S.valgteRum.slice());};});
    S.el.querySelectorAll('button[data-godkend-rumforslag]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-rum');saetRumfunktion(isNaN(Number(id))?id:Number(id),b.getAttribute('data-godkend-rumforslag'));};});
    S.el.querySelectorAll('button[data-fortryd-rumtype]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-fortryd-rumtype');saetRumfunktion(isNaN(Number(id))?id:Number(id),'');};});
    S.el.querySelectorAll('button[data-fortryd-rumtype-valgte]').forEach(function(b){b.onclick=function(){S.valgteRum.slice().forEach(function(id){saetRumfunktion(id,'');});};});
    S.el.querySelectorAll('button[data-angiv]').forEach(function(b){ b.onclick=function(){ var id=b.getAttribute('data-angiv'), detal=$('lydDetalje'); if(detal&&detal.scrollIntoView)detal.scrollIntoView({behavior:'smooth',block:'start'}); requestAnimationFrame(function(){var felt=$(id);if(felt&&felt.focus)felt.focus();}); }; });
    S.el.querySelectorAll('button[data-vis-snit]').forEach(function(b){ b.onclick=function(){ var id=b.getAttribute('data-vis-snit'); S.valgteRum=[isNaN(Number(id))?id:Number(id)]; S.valgtRum=S.valgteRum[0]; S.visning='snit'; render(); }; });
    S.el.querySelectorAll('button[data-vis-vaeg]').forEach(function(b){ b.onclick=function(){ var id=b.getAttribute('data-vis-vaeg'); S.valgtDel=isNaN(Number(id))?id:Number(id); S.planValgt=S.valgtDel; S.visning='plan'; vaelgIds([S.valgtDel]); render(); }; });
    S.el.querySelectorAll('select[data-rf]').forEach(function(s){ s.onchange=function(){ saetRumfunktion(Number(s.getAttribute('data-rf'))||s.getAttribute('data-rf'), s.value); }; s.onclick=function(e){ e.stopPropagation(); }; });
    S.el.querySelectorAll('button[data-godkend]').forEach(function(b){ b.onclick=function(e){ e.stopPropagation(); saetRumfunktion(Number(b.getAttribute('data-godkend'))||b.getAttribute('data-godkend'), b.getAttribute('data-id')); }; });
    S.el.querySelectorAll('tr[data-rum]').forEach(function(tr){ tr.onclick=function(){ var id=Number(tr.getAttribute('data-rum')); S.valgtRum=isFinite(id) ? id : tr.getAttribute('data-rum'); vaelgBygningsdele(S.valgtRum); render(); }; });
  }
  function rumAf(rumId){ var m=model(); if(!m) return null; var liste=K.lavIndeks(m).rum; for(var i=0;i<liste.length;i++) if(liste[i].id===rumId) return liste[i]; return null; }
  function vaelgIds(ids){
    if(!S.api||typeof S.api.vaelg!=='function') return;
    // Layoutets vaelg tager elementindekser (api.indeks oversætter fra Revit-id); 2.12-adapteren og stubs tager id'er
    var liste=ids;
    if(typeof S.api.indeks==='function'){ liste=[]; ids.forEach(function(id){ var i=S.api.indeks(id); if(i!=null&&i>=0) liste.push(i); }); }
    try{ S.api.vaelg(liste); }catch(e){ console.warn('ISSANA Lyd: kunne ikke vælge bygningsdele', e); }
  }
  function vaelgBygningsdele(rumId){ var r=resultatFor(rumId); if(r) vaelgIds(r.bygningsdele.slice()); }
  function vaelgGruppe(id){
    var g=S.an&&S.an.relevans.grupper.filter(function(x){ return x.id===id; })[0]; if(!g) return;
    vaelgIds(g.ids.slice()); info(g.antal+' bygningsdele valgt: '+g.navn+'.');
  }

  /* ---------- Analyser: placering og rumnavne bliver til forslag i ændringslisten ---------- */
  function koerAnalyse(){
    var m=model();
    if(!A||!K||!m||!Array.isArray(m.elements)){ fejl('Hent modellen fra Revit først.'); return null; }
    if(!K.tabel()){ fejl('Kravtabellen lydkrav.json er ikke indlæst.'); return null; }
    var an=analyse(); if(!an){ fejl('Analysen kunne ikke køres; se konsollen.'); return null; }
    var bt='';
    if(!S.bygningstype && an.bygningstype){ S.bygningstype=an.bygningstype.id; gem({bygningstype:S.bygningstype}); bt='Bygningstype: '+an.bygningstype.navn+' ('+an.bygningstype.begrundelse+(an.bygningstype.sikker ? '' : '; usikkert')+'). '; }
    var g=hent(), rettet=g.rettet||{}, kilder=g.analyseKilder||{}, sat={};
    an.forudsaetninger.forEach(function(x){ if(rettet[x.noegle]) return; if(g[x.noegle]===undefined||g[x.noegle]===null||g[x.noegle]===false){ sat[x.noegle]=x.vaerdi; kilder[x.noegle]={vaerdi:x.vaerdi, hvorfor:x.hvorfor, kilde:x.kilde}; } });
    sat.analyseKilder=kilder; gem(sat);
    S.an=null; an=analyse();                                                    // bygningstypen kan have ændret, om enhederne bruges, og hvilke krav der gælder
    var nRum=0, nData=0, rumMap={};
    K.lavIndeks(m).rum.forEach(function(r){ rumMap[String(r.id)]=r; });
    an.forslag.forEach(function(f){
      var rum=rumMap[String(f.rumId)]; if(!rum) return;
      if(f.type==='rumbrug'){ var x=aendring(rum, P_RUM, f.rumbrug, 'rumanvendelse'); x.af=AF; if(tilfoej(x)){ S.rumfunktionValg[f.rumId]=f.rumfunktion; nRum++; } }
      else if(f.type==='data'&&laegLyd(rum, f.lyd)) nData++;
    });
    S.an=null; an=analyse();
    var tekst=bt+Object.keys(an.rum).length+' rum, '+an.enheder.length+' enheder, '+Object.keys(an.rum).filter(function(k){ return an.rum[k].faelles; }).length+' fælles rum. '+nRum+' rumfunktioner og '+nData+' enheder og krav lagt i ændringslisten.';
    S.analyseSvar={tekst:tekst, uafklaret:an.uafklaret.slice()};
    render();
    info('Analyse færdig: '+nRum+' rumfunktioner og '+nData+' enheder og krav i ændringslisten. Intet er gemt i Revit.');
    return {tekst:tekst, uafklaret:an.uafklaret.slice(), antalRumfunktioner:nRum, antalData:nData};
  }
  function saetRumfunktion(rumId, rfId){
    var rum=rumAf(rumId); if(!rum) return;
    if(!rfId){ delete S.rumfunktionValg[rumId]; if(tilfoej(aendring(rum, P_RUM, '', 'rumanvendelse'))) info('Rumbrugen ryddes; ændringen ligger i ændringslisten.'); render(); return; }
    var rf=K.tabel().rumfunktioner[rfId]; if(!rf) return;
    if(tilfoej(aendring(rum, P_RUM, rf.rumbrug, 'rumanvendelse'))){ S.rumfunktionValg[rumId]=rfId; info('Rumfunktionen «'+rf.navn+'» er lagt i ændringslisten som rumbrug «'+rf.rumbrug+'». Intet er skrevet i Revit endnu.'); }
    render();
  }
  function saetRumfunktioner(ids,rfId){
    var rf=K.tabel()&&K.tabel().rumfunktioner[rfId], antal=0; if(!rf) return 0;
    (ids||[]).forEach(function(id){ var rum=rumAf(id); if(!rum) return; if(tilfoej(aendring(rum,P_RUM,rf.rumbrug,'rumanvendelse'))){ S.rumfunktionValg[id]=rfId; antal++; } });
    S.an=null; info('Rumfunktionen «'+rf.navn+'» er lagt i ændringslisten for '+antal+' rum. Intet er skrevet i Revit endnu.'); render(); return antal;
  }
  function bekraeftRumtypeForslag(ids){
    var forslag=rumtypeForslag(ids),antal=0;
    forslag.forEach(function(f){var rum=rumAf(f.id),rf=K.tabel()&&K.tabel().rumfunktioner[f.rf];if(rum&&rf&&tilfoej(aendring(rum,P_RUM,rf.rumbrug,'rumanvendelse'))){S.rumfunktionValg[f.id]=f.rf;antal++;}});
    if(antal){S.an=null;info(antal+' foreslåede rumtyper er lagt i ændringslisten. Intet er skrevet i Revit endnu.');render();}
    return antal;
  }

  function detalje(el, r, rum){
    if(!el||!rum) return;
    var d=dataFor(rum), lyd=d.lyd||{}, maal=lyd.maal||{}, inst=lyd.installation||{}, eft=lyd.efterklang||{};
    var h='<div class="arb-sek">'+esc(r.navn)+(r.rumfunktion.navn ? ' · '+esc(r.rumfunktion.navn) : '')+(r.bygningstype ? ' · '+esc(r.bygningstype.navn) : '')+'</div>';
    if(A&&S.an){ var eg=S.enhedValg[r.rumId]||{};
      h+='<div class="arb-grid"><label class="arb-felt"><span>Enhed (fx Bolig 3)</span><input id="lydEnhed" class="arb-in" value="'+esc(eg.enhed!=null ? eg.enhed : (r.enhed||''))+'"></label></div>'+
        '<label class="arb-chk"><input type="checkbox" id="lydFaelles"'+((eg.faelles!=null ? eg.faelles : r.faelles) ? ' checked' : '')+'> Fælles rum (trappe, gang eller rum uden for boligen)</label>'+
        '<div class="arb-row"><button class="tbtn" id="lydEnhedGem">Ret enhed</button></div>'; }
    DELE.forEach(function(k){
      var x=r.dele[k];
      h+='<details class="arb-lag" open><summary>'+esc(x.navn)+' '+chip(visStatus(x.status,x.forbeholdKort))+(x.vaerdi!=null ? ' <b>'+fmt(x.vaerdi,1)+' '+esc(x.enhed)+'</b>' : '')+'</summary>';
      if(x.forbeholdKort&&x.forbeholdKort.length) h+='<div class="arb-hint">Forbehold: '+esc(x.forbeholdKort.join(' · '))+'</div>';
      if(x.krav){ h+='<div class="arb-hint">Krav: '+(x.krav.kraevesIkke ? 'intet krav' : x.krav.vaerdi==null ? 'ikke fastlagt' : (x.krav.retning==='max'?'≤ ':'≥ ')+fmt(x.krav.vaerdi,x.krav.enhed==='s'?1:0)+' '+esc(x.krav.enhed)+' '+esc(x.krav.stoerrelse))+
        (x.krav.kilde ? ' <span class="arb-n">('+esc(x.krav.kilde)+(x.krav.status&&x.krav.status!=='eget' ? ', '+esc(x.krav.status) : '')+')</span>' : '')+(x.krav.note ? '<div class="arb-n">'+esc(x.krav.note)+'</div>' : '')+
        (x.krav.egetMaal&&x.krav.standard ? '<div class="arb-n">Standardkrav fra lydkrav.json: '+(x.krav.standard.vaerdi==null ? (x.krav.standard.kraevesIkke ? 'intet krav' : 'ikke fastlagt') : fmt(x.krav.standard.vaerdi,1))+'</div>' : '')+'</div>'; }
      if(x.forskel&&x.forskel.tekst) h+='<div class="arb-hint">'+esc(x.forskel.tekst)+'</div>';
      if(x.tekst&&x.status!=='ikke_relevant') h+='<div class="arb-n">'+esc(x.tekst)+'</div>';
      if(x.mangler&&x.mangler.length) h+='<div class="arb-hint">Mangler: '+x.mangler.map(function(q){ return esc(q.tekst); }).join(' · ')+'</div>';
      (x.dele||[]).forEach(function(p){
        if(k==='facade') h+='<div class="arb-aendr"><b>'+esc(p.vaeg||'Facade')+'</b>: R\'w '+fmt(p.Rw_mark,1)+' · D2m,nT,w '+fmt(p.D2mnTw,1)+' · ude '+fmt(p.L_ude,1)+' → inde '+fmt(p.L_inde,1)+' dB'+(p.dominerende ? '<div class="arb-n">Mest lyd gennem: '+esc(p.dominerende.navn)+(p.dominerende.andel!=null ? ' ('+fmt(p.dominerende.andel,0)+' %)' : '')+'</div>' : '')+'</div>';
        else if(k==='luftlyd') h+='<div class="arb-aendr">'+(p.doer ? 'Dør mod <b>' : 'Fra <b>')+esc(p.fra||'')+'</b> gennem '+esc(p.vaeg||'')+(p.relation&&REL[p.relation] ? ' <span class="arb-n">('+esc(REL[p.relation])+')</span>' : '')+': R\'w '+fmt(p.Rw_mark,1)+(p.doer ? ' dB ' : ' · D\'nT,w '+fmt(p.DnTw,1)+' dB ')+(p.krav ? '<span class="arb-n" title="'+esc(p.krav.kilde||'')+'">krav '+(p.krav.type==='luftlydGang' ? 'mod gang/trappe ' : (p.krav.type==='doerFaelles' ? 'til døren ' : ''))+(p.krav.vaerdi==null ? '–' : fmt(p.krav.vaerdi,0))+(p.krav.kilde ? ' ('+esc(p.krav.kilde)+')' : '')+'</span> ' : '')+chip(p.status)+(p.skoen ? '<div class="arb-n">Skøn: Rw ud fra m\' = '+fmt(p.skoen.m,0)+' kg/m². '+esc(p.skoen.kilde)+'</div>' : '')+'</div>';
        else if(k==='trinlyd') h+='<div class="arb-aendr">Fra <b>'+esc(p.fra||'')+'</b> gennem '+esc(p.daek||'')+': L\'n,w '+fmt(p.Lnw_mark,1)+' · L\'nT,w '+fmt(p.LnTw_mark,1)+' dB'+(p.krav&&p.krav.vaerdi!=null ? ' <span class="arb-n" title="'+esc(p.krav.kilde||'')+'">krav ≤ '+fmt(p.krav.vaerdi,0)+(p.krav.kilde ? ' ('+esc(p.krav.kilde)+')' : '')+'</span>' : '')+(p.skoen ? '<div class="arb-n">Skøn: Ln,w ud fra det bærende lag, m\' = '+fmt(p.skoen.m,0)+' kg/m². '+esc(p.skoen.kilde)+'</div>' : '')+'</div>';
        else if(k==='installation'&&p.Lp_kilderum!=null) h+='<div class="arb-aendr">L<sub>p,A</sub> i rummet '+fmt(p.Lp_kilderum,1)+' dB(A) (LWA '+fmt(p.input&&p.input.LWA,1)+', T '+fmt(p.input&&p.input.efterklangstid,2)+' s)</div>';
        else if(k==='efterklang') h+='<div class="arb-aendr">T = '+fmt(p.vaerdi,2)+' s · kilde: '+esc(p.kilde||'mangler')+'</div>';
        if(p.metode) h+='<div class="arb-n">'+esc(p.metode)+'</div>';
      });
      h+='</details>';
    });

    // Egne lydmål: overskriver standardkravene fra lydkrav.json for dette rum
    var mf=function(k){ var m=maal[k]||{}; return '<label class="arb-felt"><span>'+esc(KOLONNE[k])+' ('+(MAAL_FELT[k].retning==='max'?'højst':'mindst')+')</span>'+talInputHtml('lydMaal_'+k,m.vaerdi,'standard')+'</label>'; };
    h+='<div class="arb-sek">Egne lydmål for rummet (tomt = standardkrav)</div><div class="arb-grid">'+DELE.map(mf).join('')+
      '<label class="arb-felt"><span>Kilde til målene</span><input id="lydMaalKilde" class="arb-in" value="'+esc((maal.luftlyd&&maal.luftlyd.kilde)||'')+'" placeholder="fx bygherrens lydprogram"></label></div>'+
      '<div class="arb-row"><button class="tbtn" id="lydMaalGem">Læg målene i ændringslisten</button></div>';

    h+='<div class="arb-sek">Dokumenteret efterklangstid</div><div class="arb-grid">'+
      '<label class="arb-felt"><span>T, s</span>'+talInputHtml('lydEft',eft.vaerdi)+'</label>'+
      '<label class="arb-felt"><span>Kilde</span><input id="lydEftK" class="arb-in" value="'+esc(eft.kilde||'')+'" placeholder="fx akustikerens beregning eller måling"></label></div>';
    h+='<div class="arb-sek">Installationskilde i rummet</div><div class="arb-grid">'+
      '<label class="arb-felt"><span>LWA, dB(A)</span>'+talInputHtml('lydLWA',inst.LWA)+'</label>'+
      '<label class="arb-felt"><span>Efterklangstid, s</span>'+talInputHtml('lydT',inst.efterklangstid)+'</label>'+
      '<label class="arb-felt"><span>Kilde</span><input id="lydInstK" class="arb-in" value="'+esc(inst.kilde||'')+'" placeholder="fx produktblad for ventilationsaggregat"></label></div>'+
      '<label class="arb-chk"><input type="checkbox" id="lydInstIngen"'+(inst.ingen===true?' checked':'')+'> Ingen installation i rummet</label>'+
      '<div class="arb-row"><button class="tbtn" id="lydDataGem">Læg efterklang og installation i ændringslisten</button></div>';

    var forb={}; DELE.forEach(function(k){ (r.dele[k].dele||[]).forEach(function(p){ (p.forbehold||[]).forEach(function(t){ forb[t]=1; }); }); });
    forb[r.forbehold]=1;
    h+='<details class="arb-lag"><summary>Forbehold</summary><ul class="arb-hint">'+Object.keys(forb).map(function(t){ return '<li>'+esc(t)+'</li>'; }).join('')+'</ul></details>';
    el.innerHTML=h;

    var eg=$('lydEnhedGem'); if(eg) eg.onclick=function(){
      var f=!!($('lydFaelles')&&$('lydFaelles').checked), n=vaerdi('lydEnhed').trim();
      if(!f&&!n){ delete S.enhedValg[r.rumId]; info('Enheden følger igen analysen.'); render(); return; }
      S.enhedValg[r.rumId]={enhed:f ? null : n, faelles:f, kilde:'bruger'};
      laegLyd(rum, {placering:{enhed:f ? null : n, faelles:f, grundlag:'angivet af brugeren', sikker:true, kilde:'bruger'}, krav:(dataFor(rum).lyd||{}).krav});
      info('Enheden er rettet i ændringslisten. Intet er skrevet i Revit endnu.'); render(); };
    var gm=$('lydMaalGem'); if(gm) gm.onclick=function(){
      var vs=validerFelter(DELE.map(function(k){ return {id:'lydMaal_'+k,navn:KOLONNE[k],positiv:k==='efterklang'}; }));
      if(!vs) return;
      var rec=dataFor(rum); rec.lyd=rec.lyd||{}; rec.lyd.maal=rec.lyd.maal||{}; var kilde=vaerdi('lydMaalKilde').trim()||null, n=0;
      DELE.forEach(function(k){ var v=vs['lydMaal_'+k]; if(v==null) delete rec.lyd.maal[k]; else { rec.lyd.maal[k]={stoerrelse:MAAL_FELT[k].st, vaerdi:v, enhed:k==='efterklang'?'s':'dB', retning:MAAL_FELT[k].retning, kilde:kilde}; n++; } });
      if(gemData(rum, rec, 'lydmål')) info(n ? n+' egne lydmål er lagt i ændringslisten.' : 'Egne lydmål er ryddet i ændringslisten; standardkravene gælder.');
      render(); };
    var gd=$('lydDataGem'); if(gd) gd.onclick=function(){
      var ingen=!!($('lydInstIngen')&&$('lydInstIngen').checked), felter=[{id:'lydEft',navn:'Dokumenteret efterklangstid',positiv:true}];
      if(!ingen) felter.push({id:'lydLWA',navn:'LWA'}, {id:'lydT',navn:'Installationens efterklangstid',positiv:true});
      else { feltFejl('lydLWA',''); feltFejl('lydT',''); }
      var vs=validerFelter(felter); if(!vs) return;
      var rec=dataFor(rum); rec.lyd=rec.lyd||{};
      var t=vs.lydEft, tk=vaerdi('lydEftK').trim(); if(t==null) delete rec.lyd.efterklang; else rec.lyd.efterklang={vaerdi:t, enhed:'s', kilde:tk||null};
      var lwa=vs.lydLWA, it=vs.lydT, ik=vaerdi('lydInstK').trim();
      if(ingen) rec.lyd.installation={ingen:true}; else if(lwa==null&&it==null) delete rec.lyd.installation; else rec.lyd.installation={LWA:lwa, efterklangstid:it, kilde:ik||null};
      if(gemData(rum, rec, 'lyd')) info('Efterklang og installation er lagt i ændringslisten.');
      render(); };
  }

  // Rapporten viser fanens egne tal; se lyd-rapport.js og rapport-typst.js.
  function laegRapport(){
    var R=window.IssanaTypstRapport, LR=window.IssanaLydRapport, m=model();
    if(!R||!LR){ fejl('Rapportmodulet er ikke indlæst endnu. Prøv igen om et øjeblik.'); return null; }
    if(!m||!Array.isArray(m.elements)||!K||!K.tabel()){ fejl('Hent modellen fra Revit først.'); return null; }
    beregn();
    var tekst=LR.lav(R, {K:K, model:m, dato:new Date().toLocaleDateString('da-DK',{day:'numeric',month:'long',year:'numeric'}), bygningstype:S.bygningstype, resultater:S.resultater, analyse:S.an, forudsaetninger:forudsaetninger(), tabel:K.tabel()});
    var fil=LR.filnavn(m.model||modelNoegle());
    R.gem(fil, tekst);
    info('Rapporten er gemt som '+fil+'. Åbn den i ISSANA Compose (Typst), eller oversæt den med typst.');
    return tekst;
  }

  function eksporterCsv(){
    var rows=[['Rum','Etage','Bygningstype','Rumfunktion','Samlet']];
    DELE.forEach(function(d){ rows[0].push(KOLONNE[d]+' krav', KOLONNE[d]+' værdi', KOLONNE[d]+' status'); }); rows[0].push('Mangler');
    S.resultater.forEach(function(r){ var row=[r.navn, r.niveau, r.bygningstype ? r.bygningstype.navn : '', r.rumfunktion.navn||'', TEKST[r.samlet]];
      DELE.forEach(function(d){ var x=r.dele[d]; row.push(x.krav&&x.krav.vaerdi!=null ? x.krav.vaerdi : (x.krav&&x.krav.kraevesIkke ? 'intet krav' : ''), x.vaerdi!=null ? x.vaerdi : '', TEKST[x.status]); });
      row.push(r.mangler.map(function(m){ return m.tekst; }).join(' | ')); rows.push(row); });
    var csv='﻿'+rows.map(function(r){ return r.map(function(c){ c=c==null?'':String(c); return /[;"\n]/.test(c) ? '"'+c.replace(/"/g,'""')+'"' : c; }).join(';'); }).join('\r\n');
    var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); a.download='ISSANA-lydkrav-'+String(modelNoegle()).replace(/[^\wæøåÆØÅ-]+/g,'_')+'.csv';
    document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },500);
  }

  /* ---------- Montering ---------- */
  function hentTabel(){
    if(!K||K.tabel()||S.henter) return;
    S.henter=true;
    K.indlaes('lydkrav.json').then(function(){ S.henter=false; S.tabelFejl=null; render(); })
      .catch(function(e){ S.henter=false; S.tabelFejl='Kunne ikke hente lydkrav.json ('+((e&&e.message)||e)+').'; console.warn('ISSANA Lyd: '+S.tabelFejl); render(); });
  }
  function synkValgFra3d(liste){
    var m=model(), rum={}; (m&&m.rooms||[]).forEach(function(r){rum[String(r.id)]=r;});
    var ids=[], alle=[]; (liste||[]).forEach(function(i){ var id=S.api&&S.api.elementId?S.api.elementId(i):i; alle.push(id); if(rum[String(id)]&&ids.map(String).indexOf(String(id))<0) ids.push(id); });
    if(!ids.length){ if(alle.length&&String(S.valgtDel)!==String(alle[0])){ S.valgtDel=alle[0]; S.planValgt=alle[0]; render(); } return; }
    if(JSON.stringify(ids.map(String))===JSON.stringify((S.valgteRum||[]).map(String))) return;
    S.valgteRum=ids; S.valgtRum=ids[0]; var r=rum[String(ids[0])]; if(r&&r.level) S.planEtage=r.level; render();
  }
  function nulstil(){ S.valgtRum=null; S.valgteRum=[]; S.valgtDel=null; S.resultater=[]; S.rumfunktionValg={}; S.enhedValg={}; S.an=null; S.analyseSvar=null; S.plan=null; S.planEtage=null; S.planVis=null; S.planValgt=null; S.facadeId=null; S.facadeStoej={}; S.rumFlade=null; S.kandidatId=null; S.stedCtx=null; S.bygningstype=hent().bygningstype||null; }
  function monter(container, api){
    S.el=container; S.api=api||null;
    if(!api) console.warn('ISSANA Lyd: fanen er monteret uden arbejdsrummets API (valgte/vaelg/model/aendringsliste); der kan ikke vælges i 3D eller lægges ændringer i listen.');
    nulstil();
    if(api&&typeof api.paa==='function'){ try{ api.paa('model', function(){ nulstil(); render(); }); api.paa('valg',synkValgFra3d); }catch(e){} }
    hentTabel(); render();
  }

  // Adapter fra dagens IssanaArbejdsrum (2.12) til fanens API, så fanen også virker før 3.0-arbejdsrummet er på plads.
  function adapter(A){
    var V=A.V();
    return {
      valgte:function(){ return V.valgte().map(function(i){ var x=A.infos[i]; return x&&x.ed ? x.ed.id : null; }).filter(function(x){ return x!=null; }); },
      vaelg:function(ids){ var idx=[]; (ids||[]).forEach(function(id){ var i=A.byRevitId[id]; if(i==null) i=A.byRevitId['rum:'+id]; if(i!=null) idx.push(i); }); if(V.vaelgFlere) V.vaelgFlere(idx); else if(idx.length) V.vaelg(idx[0]); },
      model:function(){ return V.data(); },
      aendringsliste:{tilfoej:function(x){
        var i=A.byRevitId['rum:'+x.obj.id], m={uniqueId:x.uniqueId, instans:true, navn:x.navn, obj:(i!=null&&A.infos[i]) ? A.infos[i].ed : x.obj};
        A.saet(m, x.param, x.til, x.hvad&&x.hvad[0]); }},
      dataFor:function(rum){ var i=A.byRevitId['rum:'+rum.id]; return (i!=null&&A.infos[i]) ? A.dataFor(A.maal(A.infos[i],'element')) : null; },
      gemData:function(rum, rec, hvad){ var i=A.byRevitId['rum:'+rum.id]; if(i==null||!A.infos[i]) return false; A.gemData(A.maal(A.infos[i],'element'), rec, hvad); return true; },
      info:V.info, fejl:V.fejl, tilfoejLag:A.tilfoejLag, saetFilter:A.saetFilter
    };
  }

  var registreret=false;
  function registrerNy(ar){ if(registreret||!ar||typeof ar.registrerFane!=='function') return false; registreret=true; ar.registrerFane({id:'lyd', titel:'Lyd', bred:true, monter:monter}); return true; }
  function registrerGammel(){
    var gammelt=window.IssanaArbejdsrum;
    if(registreret) return; if(window.issanaArbejdsrum){ registrerNy(window.issanaArbejdsrum); return; }
    if(gammelt&&typeof gammelt.fane==='function'){
      registreret=true; var ad=null;
      gammelt.fane({id:'lyd', titel:'Lyd', bred:true, valg:false,
        render:function(el){ if(!ad) ad=adapter(gammelt); if(S.el!==el||S.api!==ad){ S.el=el; S.api=ad; if(!S.bygningstype) S.bygningstype=hent().bygningstype||null; hentTabel(); } render(); },
        model:function(){ nulstil(); }});
    } else {
      console.warn('ISSANA Lyd: hverken window.issanaArbejdsrum.registrerFane eller window.IssanaArbejdsrum.fane findes; Lyd-fanen er ikke monteret. Kald window.IssanaLydFane.monter(container, api) selv.');
    }
  }
  if(!registrerNy(window.issanaArbejdsrum)){
    // Layoutet (arbejdsrum-layout.js) indlæses efter os: det samler funktionerne i issanaArbejdsrumVentende op, når det starter.
    (window.issanaArbejdsrumVentende=window.issanaArbejdsrumVentende||[]).push(registrerNy);
    // Er siden færdigindlæst uden layout, bruges 2.12-skuffen (eller der advares).
    var d=typeof document!=='undefined'? document : null;
    if(d&&d.readyState&&d.readyState!=='complete'&&typeof window.addEventListener==='function') window.addEventListener('load', registrerGammel);
    else registrerGammel();
  }
  // AI-feltet («analyser lyd») kalder den samme analyse som knappen, også før fanen har været åbnet.
  function analyseFraAi(){
    if(!S.api&&window.issanaArbejdsrum&&window.issanaArbejdsrum.api){ S.api=window.issanaArbejdsrum.api; nulstil(); }
    if(K&&!K.tabel()){ hentTabel(); return {ok:false, tekst:'Lyd-fanen henter kravtabellen. Prøv igen om et øjeblik.'}; }
    var r=koerAnalyse();
    return r ? {ok:true, tekst:r.tekst+(r.uafklaret.length ? ' Uafklaret: '+r.uafklaret.join('; ')+'.' : '')+' Intet er gemt i Revit.', uafklaret:r.uafklaret} : {ok:false, tekst:'Hent modellen fra Revit først.'};
  }
  if(window.IssanaPlacering&&typeof window.IssanaPlacering.registrerAnalyse==='function') window.IssanaPlacering.registrerAnalyse('lyd','Lyd (placering, enheder og krav)',analyseFraAi);
  window.IssanaLydFane={monter:monter, opdater:render, tilstand:S, analyser:koerAnalyse, analyseFraAi:analyseFraAi, rapport:laegRapport, saetRumfunktioner:saetRumfunktioner, bekraeftRumtypeForslag:bekraeftRumtypeForslag, naesteManglerRum:naesteManglerRum, manglerRumtypeTekst:manglerRumtypeTekst, rumkortHtml:valgtRumHtml, planVisForRum:planVisForRum};
})();
