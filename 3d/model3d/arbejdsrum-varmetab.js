/* ISSANA 3D: fanen Varmetabsberegning, delen der handler om placering.
   Binder bygningsdel-placering.js og varmetab-placering.js til fanen i Revit-modelviewer.html: randbetingelser pr. rumtype,
   feltet «Hvad indgår» og knappen/AI-kommandoen «Analyser», som lægger forslag i ændringslisten. Selve beregningen ligger
   stadig i Revit-modelviewer.html (openHeat, beregnVarmetabDS418). Intet skrives i Revit uden «Gem i Revit». */
(function(){
  "use strict";
  var VP=window.IssanaVarmetabPlacering, P=window.IssanaPlacering;
  if(!VP||!P){ console.warn('ISSANA Varmetab: bygningsdel-placering.js eller varmetab-placering.js mangler.'); return; }
  var cache=null, svar=null, randAaben=false;

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function fmt(n,d){ if(n==null||!isFinite(n)) return '–'; try{ return Number(n).toLocaleString('da-DK',{minimumFractionDigits:d||0,maximumFractionDigits:d==null?1:d}); }catch(e){ return String(n); } }
  function V(){ return window.IssanaVisning||null; }
  function model(){ var v=V(); return v&&v.data? v.data() : null; }
  function lager(){ var m=model(); return 'issana-varmetab-'+((m&&(m.modelKey||m.model))||'model'); }
  function gemt(){ try{ return JSON.parse(localStorage.getItem(lager())||'null')||{}; }catch(e){ return {}; } }
  function gemAendring(fn){ var g=gemt(); fn(g); try{ localStorage.setItem(lager(),JSON.stringify(g)); }catch(e){} }
  function feltTal(id){ var e=$(id); if(!e) return null; var n=parseFloat(String(e.value).replace(',','.')); return isFinite(n)? n : null; }

  function rand(){
    var r=VP.randbetingelser(gemt()), te=feltTal('hTe'), h=feltTal('hKdyb');
    if(te!=null) r.te=te;
    if(h!=null) r.kdybde=h;
    return r;
  }
  function analyse(){ var m=model(); if(!m||!Array.isArray(m.elements)) return null; if(!cache||cache.m!==m) cache={m:m,a:P.analyser(m)}; return cache.a; }
  function nulstil(){ cache=null; }
  function harPlacering(){ var a=analyse(); return !!(a&&a.harRum); }

  // Fanens tabelrækker. null = modellen har ingen rum, så fanen regner som før (type for type).
  function data(){
    var a=analyse(); if(!a||!a.harRum) return null;
    var r=rand(), b=VP.beregn(a,r);
    b.thetaJ=r.thetaJ;
    return b;
  }
  // Som data, men tegner også fanens felter (kaldes af openHeat).
  function raekker(){
    var b=data(); if(!b) return null;
    var a=analyse(); renderRand(a,rand()); renderRelevans(b.relevans,a);
    return b;
  }

  /* ---------- Randbetingelser ---------- */
  function renderRand(a,r){
    var el=$('heatRand'); if(!el) return;
    var typer=VP.rumtyperIModel(a,r);
    var h='<details class="heat-ground" id="heatRandD"'+(randAaben?' open':'')+'><summary>Randbetingelser pr. rumtype · DS 418:2026 (ret dem her)</summary>';
    h+='<div class="heat-in">'+
      '<div><label for="hrJord" title="'+esc(VP.KILDE.jord)+'">Jord, under terrændæk og over 2 m (°C)</label><input id="hrJord" type="number" step="1" value="'+r.thetaJ+'"></div>'+
      '<div><label for="hrUopv" title="'+esc(VP.KILDE.uopvarmet)+'">Uopvarmede rum, skøn (°C)</label><input id="hrUopv" type="number" step="1" value="'+r.thetaU+'"></div></div>';
    h+='<table class="qt heat-randtab"><thead><tr><th>Rumtype</th><th class="n">Rum</th><th>Tilstand</th><th class="n">θ<sub>i</sub> °C</th></tr></thead><tbody>';
    typer.forEach(function(t){
      var fast=t.tilstand||(t.tilstande.ude? 'ude' : t.tilstande.uopvarmet&&!t.tilstande.opvarmet? 'uopvarmet' : t.tilstande.opvarmet&&!t.tilstande.uopvarmet? 'opvarmet' : 'auto');
      var opt=function(v,tx){ return '<option value="'+v+'"'+(fast===v?' selected':'')+'>'+tx+'</option>'; };
      h+='<tr title="'+esc(t.kilde)+'"><td>'+esc(t.navn)+'<div class="heat-plac">'+esc(t.rum.join(', '))+(t.antal>t.rum.length?', …':'')+'</div></td><td class="n">'+t.antal+'</td>'+
        '<td><select class="heat-sel" data-rt="'+esc(t.id)+'" title="Automatisk: opvarmet over terræn, uopvarmet i kælder">'+(t.tilstande.opvarmet&&t.tilstande.uopvarmet?opt('auto','Efter etage'):'')+opt('opvarmet','Opvarmet')+opt('uopvarmet','Uopvarmet')+opt('ude','Ude')+'</select></td>'+
        '<td class="n"><input class="b" type="number" step="1" data-rt-t="'+esc(t.id)+'" value="'+(t.theta==null?'':t.theta)+'"'+(t.id==='ude'?' disabled':'')+'></td></tr>';
    });
    h+='</tbody></table><div class="heat-note">Hold musen over en række for kilden. <b>Bad</b>: DS 418:2026 pkt. 7 siger, at der ses bort fra, at baderum kan have en anden temperatur, så bad regnes med 20 °C i det dimensionerende varmetab. <b>Uopvarmede rum</b>: standarden giver ingen tabel, kun skøn eller varmebalance (pkt. 4.1). <b>Opvarmet/uopvarmet</b> for teknik, depot og ukendte rum er ISSANAs antagelse ud fra etagen; ret den her.</div></details>';
    el.innerHTML=h;
    var d=$('heatRandD'); if(d) d.addEventListener('toggle',function(){ randAaben=d.open; });
    var gemTal=function(id,felt){ var e=$(id); if(e) e.onchange=function(){ var n=parseFloat(e.value); gemAendring(function(g){ if(isFinite(n)) g[felt]=n; else delete g[felt]; }); opdater(); }; };
    gemTal('hrJord','thetaJ'); gemTal('hrUopv','thetaU');
    el.querySelectorAll('select[data-rt]').forEach(function(s){ s.onchange=function(){ var id=s.getAttribute('data-rt'); gemAendring(function(g){ g.rum=g.rum||{}; g.rum[id]=g.rum[id]||{}; if(s.value==='auto') delete g.rum[id].tilstand; else g.rum[id].tilstand=s.value; }); opdater(); }; });
    el.querySelectorAll('input[data-rt-t]').forEach(function(s){ s.onchange=function(){ var id=s.getAttribute('data-rt-t'), n=parseFloat(s.value); gemAendring(function(g){ g.rum=g.rum||{}; g.rum[id]=g.rum[id]||{}; if(isFinite(n)) g.rum[id].theta=n; else delete g.rum[id].theta; }); opdater(); }; });
  }
  function opdater(){ var v=V(); if(v&&v.varmetabOpdater) v.varmetabOpdater(); }

  /* ---------- Hvad indgår ---------- */
  function renderRelevans(rel,a){
    var el=$('heatRelevans'); if(!el) return;
    var linje=function(x,hvad){ return '<div class="r"><div class="t"><b>'+esc(x.kategori)+'</b>'+(hvad?' '+esc(hvad):'')+'<span class="heat-plac">'+x.antal+' stk.'+(x.areal>0?' · '+fmt(x.areal,0)+' m²':'')+'</span></div>'+(x.grund?'<div class="heat-plac">'+esc(x.grund)+'</div>':'')+'</div>'; };
    var h='<div class="heat-sub"><b>Hvad indgår i beregningen</b></div><div class="heat-rel">';
    h+='<div class="heat-rel-h">Indgår</div>'+(rel.indgaar.length? rel.indgaar.map(function(x){ return linje(x,x.tekst); }).join('') : '<div class="heat-plac">Ingen flader mod ude, jord eller uopvarmet.</div>');
    if(rel.afklares.length) h+='<div class="heat-rel-h warn">Skal afklares (regnes ikke med, før du sætter flueben)</div>'+rel.afklares.map(function(x){ return linje({kategori:x.kategori,antal:x.antal,areal:x.areal,grund:x.grund},x.tekst); }).join('');
    h+='<div class="heat-rel-h">Indgår ikke</div>'+rel.indgaarIkke.map(function(x){ return linje({kategori:x.kategori,antal:x.antal,areal:x.areal,grund:x.grund},x.tekst); }).join('');
    h+='</div>';
    if(!a.harRumMesh) h+='<div class="heat-note">Rummene har ingen geometri i eksporten, så placeringen er usikker. Hent modellen igen fra Revit.</div>';
    el.innerHTML=h;
  }

  /* ---------- Analyser ---------- */
  function iDag(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
  function analyser(){
    var v=V(), A=window.IssanaArbejdsrum;
    var m=model();
    if(!m||!Array.isArray(m.elements)||!m.elements.length){ var t0='Hent modellen fra Revit først.'; if(v) v.fejl(t0); return {ok:false,tekst:t0}; }
    nulstil();
    var a=analyse(), r=rand();
    if(!a.harRum){ var t1='Modellen har ingen placerede rum, så placeringen kan ikke analyseres. Tegn rummene i Revit, og hent modellen igen.'; if(v) v.fejl(t1); return {ok:false,tekst:t1}; }
    opdater();
    if(!A||typeof A.maal!=='function'){ var t2='Arbejdsrummet er ikke klar; intet er lagt i ændringslisten.'; if(v) v.fejl(t2); return {ok:false,tekst:t2}; }
    var byU={}; (A.infos||[]).forEach(function(i){ if(i&&i.ed&&i.ed.uniqueId!=null) byU[i.ed.uniqueId]=i; });
    var f=VP.forslag(a,r,iDag()), nRum=0, nEl=0, nBrug=0, nMangler=0;
    f.rum.forEach(function(x){ var i=byU[x.uniqueId]; if(!i){ nMangler++; return; } var mm=A.maal(i,'element');
      if(x.rumbrug&&!A.nu(mm,A.P.rum)){ A.saet(mm,A.P.rum,x.rumbrug,'rumanvendelse (fra rumnavnet)','Analyser'); nBrug++; }
      var rec=A.dataFor(mm); if(VP.ensForslag(rec.varmetab,x.data)) return; rec.varmetab=x.data; A.gemData(mm,rec,'varmetab (Analyser)','Analyser'); nRum++; });
    f.elementer.forEach(function(x){ var i=byU[x.uniqueId]; if(!i){ nMangler++; return; } var mm=A.maal(i,'element');
      var rec=A.dataFor(mm); if(VP.ensForslag(rec.varmetab,x.data)) return; rec.varmetab=x.data; A.gemData(mm,rec,'varmetab (Analyser)','Analyser'); nEl++; });
    var b=VP.beregn(a,r), ialt=nRum+nEl+nBrug;
    var tael=function(l){ return l.reduce(function(s,x){ return s+x.antal; },0); };
    var tekst='Analyseret: '+a.rum.length+' rum og '+a.elementer.length+' bygningsdele. '+tael(b.relevans.indgaar)+' indgår, '+tael(b.relevans.afklares)+' skal afklares, '+tael(b.relevans.indgaarIkke)+' indgår ikke. ';
    tekst+= ialt? ialt+' forslag ligger i ændringslisten. Intet er gemt i Revit endnu.' : 'Ingen nye forslag: ændringslisten er allerede opdateret.';
    if(nMangler) tekst+=' '+nMangler+' kunne ikke kobles til modellens elementer.';
    svar=tekst;
    var el=$('heatAnalyseSvar'); if(el){ el.innerHTML='<div class="heat-status"><b>'+esc(tekst)+'</b> <button class="tbtn" id="heatVisListe">Se ændringslisten</button></div>'; var k=$('heatVisListe'); if(k) k.onclick=function(){ A.aabenSkuffe('aendringer'); }; }
    if(v) v.info(tekst);
    return {ok:true,tekst:tekst,rum:nRum,elementer:nEl,rumbrug:nBrug,relevans:b.relevans};
  }
  P.registrerAnalyse('varmetab','Varmetab (placering og randbetingelser)',analyser);

  /* ---------- Rapport i Typst ---------- */
  // d: fanens egen beregning (res, poster-rækker, forudsætninger, kuldebroer) fra Revit-modelviewer.html.
  function rapportTekst(d){
    var v=V(), R=window.IssanaTypstRapport, VR=window.IssanaVarmetabRapport;
    if(!R||!VR){ var t0='Rapportmodulet er ikke indlæst endnu. Prøv igen om et øjeblik.'; if(v) v.fejl(t0); return null; }
    var m=model()||{}, a=analyse(), r=rand(), b=a&&a.harRum? VP.beregn(a,r) : null;
    var VPL=window.IssanaVarmetabPlan, planer=[], planFejl=null;
    if(b&&VPL){ try{ planer=VPL.planer(m,a,r); }catch(e){ planFejl=(e&&e.message)||String(e); console.error('ISSANA Varmetab: plantegninger',e); } }
    var tekst=VR.lav(R,Object.assign({},d,{planer:planer,planFejl:planFejl,planFarver:VPL&&VPL.KAT,rumFarver:VPL&&VPL.RUM,planOrden:VPL&&VPL.ORDEN.slice().reverse(),model:m.model||'',dato:new Date().toLocaleDateString('da-DK',{day:'numeric',month:'long',year:'numeric'}),
      rand:r,KILDE:VP.KILDE,jordVaegTheta:VP.jordTheta('kaeldervaeg',r),harPlacering:!!b,relevans:b?b.relevans:null,rumtyper:b?VP.rumtyperIModel(a,r):null}));
    return {tekst:tekst, fil:VR.filnavn(m.model), model:m.model||''};
  }
  function rapport(d){
    var r=rapportTekst(d); if(!r) return null;
    window.IssanaTypstRapport.gem(r.fil,r.tekst);
    var v=V(); if(v) v.info('Typst-filen er gemt som '+r.fil+'.');
    return r.tekst;
  }
  function optaget(id,tekst){ var b=$(id); if(!b) return function(){}; var t=b.textContent; b.disabled=true; b.textContent=tekst; return function(){ b.disabled=false; b.textContent=t; }; }
  function kraeverRevit(v,hvad){ if(v&&v.erRevit&&v.erRevit()&&v.kald) return true; if(v) v.fejl(hvad+' kræver, at ISSANA 3D er åbnet fra Revit. Du kan gemme Typst-filen i stedet.'); return false; }
  function gemPdf(fil,base64){
    var bin=atob(base64), u=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
    var url=URL.createObjectURL(new Blob([u],{type:'application/pdf'})), a=document.createElement('a');
    a.href=url; a.download=fil; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(url); },5000);
  }
  // PDF'en laves af typst.exe, der følger med pluginet; siden gemmer den som en almindelig hentet fil.
  function rapportPdf(d){
    var v=V(); if(!kraeverRevit(v,'PDF\'en')) return Promise.resolve(null);
    var r=rapportTekst(d); if(!r) return Promise.resolve(null);
    var slut=optaget('heatPdf','Laver PDF…');
    return v.kald('issana_rapport_pdf',{typst:r.tekst,filnavn:r.fil},{timeoutMs:180000}).then(function(s){
      gemPdf(s.filnavn,s.pdfBase64); v.info('PDF\'en er gemt som '+s.filnavn+'.'); return s;
    }).catch(function(e){ v.fejl('PDF\'en blev ikke lavet: '+((e&&e.message)||e)); return null; }).then(function(s){ slut(); return s; });
  }
  // Et nyt Typst-projekt i ISSANA Compose med rapporten som main.typ. Det projekt, der måske er åbent, røres ikke.
  function rapportCompose(d){
    var v=V(); if(!kraeverRevit(v,'Send til Compose')) return Promise.resolve(null);
    var r=rapportTekst(d); if(!r) return Promise.resolve(null);
    var slut=optaget('heatCompose','Sender…');
    return v.kald('issana_rapport_compose',{typst:r.tekst,navn:'Varmetab '+r.model},{timeoutMs:120000}).then(function(s){
      v.info('Rapporten ligger nu i ISSANA Compose som projektet «'+s.projekt+'». Åbn det fra projektoversigten, og markér det som betroet, for at se PDF\'en.'); return s;
    }).catch(function(e){ v.fejl('Rapporten blev ikke sendt: '+((e&&e.message)||e)); return null; }).then(function(s){ slut(); return s; });
  }

  window.IssanaVarmetabUI={raekker:raekker, data:data, rapport:rapport, rapportPdf:rapportPdf, rapportCompose:rapportCompose, analyser:analyser, nulstil:nulstil, harPlacering:harPlacering, rand:rand, sidsteSvar:function(){ return svar; }};
})();
