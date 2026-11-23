/* ISSANA 3D: arbejdsrummet (2.12).
   Bygger ovenpå 3D-visningen gennem window.IssanaVisning (Revit-modelviewer.html) og gør 3D til stedet, hvor man
   registrerer og ser bygningsdata: tags (bærende, stabiliserende, ophold …), handlingsstatus i renovering, rummenes
   anvendelse, støj udefra, lyd- og branddata med kilde, og kontrol. Kravene står i
   docs/issana-mcp/3D-FILTER-ANALYSE-OG-SIGMA.md og docs/issana-mcp/BYGNINGSDATA.md.

   Principper (fra kravlisten):
   - Brugeren er kilde til mål, funktion, handlingsstatus og valg. Intet udledes af navn, tykkelse eller geometri.
   - Tom, ukendt og ikke relevant er forskellige ting. Tom bliver aldrig til 0 eller "nej".
   - Lag og farver ændrer aldrig noget i Revit. Kun «Gem i Revit» skriver, og først efter en forhåndsvisning:
     issana_apply_plan validerer hver værdi (BygDataRules), skriver i én transaktion og læser værdierne tilbage.
   - Sammenligning er neutral: dokumenteret mod mål, forskel fra mål, mangler input, ikke kontrolleret, ikke relevant.

   Faner i skuffen: Lag (filtre og farver), Data (redigér det valgte), Ændringer (forhåndsvisning og gem). Graf, Lyd,
   Sol og Produkter lægger sig til med IssanaArbejdsrum.fane(...) fra deres egne filer. */
(function(){
  "use strict";

  /* ---------- Faste værdier (samme som plugin/Core/BygData/BygDataRules.cs) ---------- */
  var P={
    typeTags:'ISSANA Tags', typeStatus:'ISSANA Action Status', typeData:'ISSANA Data',
    tags:'ISSANA Instance Tags', status:'ISSANA Instance Action Status', data:'ISSANA Instance Data',
    rum:'ISSANA Instance Room Use', stoej:'ISSANA Instance Outdoor Noise', rumnavn:'Rumnavn (Revit)'
  };
  var P_CCI='ISSANA CCI Code';   // typeparameter (IssanaParameterSet); AI-feltets CCI-forslag skrives her efter bekræftelse
  var SCHEMA='issana-bygdata/1';
  var HANDLING=[
    {v:'existing_not_assessed',t:'Eksisterende, ikke vurderet'},{v:'retain_unchanged',t:'Bevares uændret'},
    {v:'maintain',t:'Vedligeholdes'},{v:'repair',t:'Repareres'},{v:'renovate',t:'Renoveres'},{v:'rebuild',t:'Genopbygges'},
    {v:'dismantle_for_reuse',t:'Demonteres til genbrug'},{v:'demolish',t:'Rives ned'},{v:'replace',t:'Udskiftes'},
    {v:'new_element',t:'Nyt element'}
  ];
  var UNSET='unset';
  var STATUS_TEKST={
    documented_against_target:'Dokumenteret mod mål', difference_from_target:'Forskel fra mål',
    needs_input:'Mangler input', not_reviewed:'Ikke kontrolleret', not_applicable:'Ikke relevant'
  };
  var STATUS_FARVE={
    documented_against_target:'#4a7c59', difference_from_target:'#c65a2e', needs_input:'#c99a2e',
    not_reviewed:'#6f8796', not_applicable:'#c9cec9'
  };
  var HANDLING_FARVE={
    existing_not_assessed:'#9aa5a0', retain_unchanged:'#4a7c59', maintain:'#7fae8a', repair:'#b9c46a',
    renovate:'#e0b07a', rebuild:'#c98e4e', dismantle_for_reuse:'#7aa3c9', demolish:'#c0504a', replace:'#b39ddb',
    new_element:'#3f7cac', unset:'#d6d9d6'
  };
  var RUMANVENDELSER=['ophold','soverum','hotelværelse','køkken/alrum','bad/wc','gang/entré','trapperum','teknik','depot',
    'kontor','undervisning','mødelokale','andet'];
  var KONSTRUKTION_TAGS=['bærende','ikke-bærende','stabiliserende'];
  var STANDARD_TAGS=['bærende','ikke-bærende','stabiliserende','facade','skillevæg','etageadskillelse','brandvæg','installation','ophold'];
  var ANSVAR='Sammenligningen bygger på brugerdefinerede mål og registrerede data. Den er ikke en automatisk myndighedsgodkendelse.';
  var BYGNINGSDELE={'Vægge':1,'Gulve':1,'Tage':1,'Lofter':1,'Søjler':1,'Bjælker':1,'Trapper':1,'Vinduer':1,'Døre':1};
  var LYD_KAT={'Vægge':1,'Gulve':1,'Tage':1,'Vinduer':1,'Døre':1};
  var BAERENDE_KAT={'Vægge':1,'Gulve':1,'Tage':1,'Søjler':1,'Bjælker':1};

  var V=null;                 // window.IssanaVisning
  var infos=[];               // pr. element-indeks: beregnet info
  var byRevitId={};           // Revit-id -> element-indeks
  var aendringer={};          // uniqueId|parameter -> {uniqueId, param, fra, til, navn, kraeverOpsaetning}
  var faner=[], aktivFane='lag', skuffeAaben=false;
  var filterValg={};          // lag-id -> {værdi:true}
  var farveLag='', visRum=false;
  var initialer='';
  try{ initialer=localStorage.getItem('issana-arbejdsrum-af')||''; }catch(e){}

  /* ---------- Små hjælpere ---------- */
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function klon(o){ return o==null? o : JSON.parse(JSON.stringify(o)); }
  function lav(s){ return String(s||'').trim().toLowerCase(); }
  function tal(v){ if(v==null) return null; var s=String(v).trim().replace(',','.'); if(s==='') return null; var n=Number(s); return isFinite(n)? n : null; }
  function fmt(n,dec){ if(n==null||!isFinite(n)) return '–'; try{ return Number(n).toLocaleString('da-DK',{minimumFractionDigits:dec||0,maximumFractionDigits:dec==null?1:dec}); }catch(e){ return String(n); } }
  function idag(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
  function handlingTekst(v){ if(v===UNSET) return 'Ikke angivet'; for(var i=0;i<HANDLING.length;i++) if(HANDLING[i].v===v) return HANDLING[i].t; return v; }
  function splitTags(v){ var r=[], set={}; String(v||'').split(/[;,\r\n]/).forEach(function(t){ t=t.trim(); if(t && !set[t.toLowerCase()]){ set[t.toLowerCase()]=1; r.push(t); } }); return r; }
  function joinTags(a){ return splitTags((a||[]).join(';')).join('; '); }
  function stoejTal(v){ var m=/^\s*(-?\d+(?:[.,]\d+)?)/.exec(String(v||'')); return m? Number(m[1].replace(',','.')) : null; }
  function tagNorm(t){ return lav(t).replace('ae','æ').replace('baerende','bærende'); }
  function flet(a,b){   // b oven på a (element oven på type); lister erstattes, objekter flettes
    if(a==null) return klon(b); if(b==null) return klon(a);
    if(typeof a!=='object'||typeof b!=='object'||Array.isArray(a)||Array.isArray(b)) return klon(b);
    var r=klon(a); Object.keys(b).forEach(function(k){ r[k]=flet(a[k],b[k]); }); return r;
  }
  function parseData(s){ if(!s) return null; try{ var o=JSON.parse(s); return (o&&typeof o==='object'&&!Array.isArray(o))? o : null; }catch(e){ return null; } }

  /* ---------- Bygningsdata pr. element ---------- */
  function typeAf(ed){ var t=V.typer(); return ed&&ed.typeId!=null? t[String(ed.typeId)] : null; }

  // Byg bygdata-objektet ud fra de rå parameterværdier (samme som Model3dFormat.BygdataObject i pluginnet).
  function bygdataFraRaw(raw,instans){
    var g=function(n){ var v=raw[n]; return v==null||String(v).trim()===''? null : String(v).trim(); };
    var b={raw:raw};
    var tg=g(instans?P.tags:P.typeTags); if(tg) b.tags=splitTags(tg);
    b.status=g(instans?P.status:P.typeStatus)||undefined;
    var d=g(instans?P.data:P.typeData); if(d){ b.data=parseData(d); if(!b.data) b.dataFejl=d; }
    if(instans){ b.roomUse=g(P.rum)||undefined; b.noise=g(P.stoej)||undefined; }
    return b;
  }

  function effektivStatus(egen,type){
    var gyldig=function(v){ for(var i=0;i<HANDLING.length;i++) if(HANDLING[i].v===v) return true; return false; };
    if(egen&&gyldig(egen)) return {v:egen,kilde:'element'};
    if(type&&gyldig(type)) return {v:type,kilde:'type'};
    return {v:UNSET,kilde:null};
  }

  function sammenlignLyd(d,kontrolleret){
    var l=d&&d.lyd, m=[];
    if(l&&l.ikkeRelevant) return {status:'not_applicable',mangler:[]};
    var maal=l&&l.maal, dok=l&&l.dokumenteret;
    if(!maal||maal.vaerdi==null) m.push({felt:'lyd.maal',tekst:'Lydmål for elementet'});
    if(!dok||dok.vaerdi==null) m.push({felt:'lyd.dokumenteret',tekst:'Dokumenteret lydværdi'});
    else if(!dok.kilde) m.push({felt:'lyd.dokumenteret.kilde',tekst:'Kilde til lydværdien'});
    if(m.length) return {status:'needs_input',mangler:m};
    var r=null;
    if(window.IssanaLyd&&IssanaLyd.sammenlign){
      r=IssanaLyd.sammenlign({vaerdi:{vaerdi:dok.vaerdi,stoerrelse:dok.stoerrelse||null,enhed:dok.enhed||'dB'},
        maal:{vaerdi:maal.vaerdi,stoerrelse:maal.stoerrelse||null,enhed:maal.enhed||'dB'},retning:maal.retning||retningFor(maal.stoerrelse)});
    }
    if(!r) r={status:(dok.stoerrelse&&maal.stoerrelse&&dok.stoerrelse!==maal.stoerrelse)?'needs_input':'documented_against_target'};
    if(r.status==='needs_input') return {status:'needs_input',mangler:r.mangler&&r.mangler.length? r.mangler : [{felt:'lyd',tekst:'Målet og værdien er ikke samme størrelse ('+(maal.stoerrelse||'?')+' / '+(dok.stoerrelse||'?')+')'}],resultat:r};
    if(!kontrolleret) return {status:'not_reviewed',mangler:[],resultat:r};
    return {status:r.status,mangler:[],resultat:r};
  }
  function retningFor(st){ return /^L/.test(String(st||''))? 'max' : 'min'; }   // niveauer (L…) højst, isolation (R…, D…) mindst

  function sammenlignBrand(d,kontrolleret){
    var b=d&&d.brand, m=[];
    if(b&&b.ikkeRelevant) return {status:'not_applicable',mangler:[]};
    var maal=b&&b.maal&&b.maal.klasse, dok=b&&b.dokumenteret&&b.dokumenteret.klasse;
    if(!maal) m.push({felt:'brand.maal',tekst:'Brandkrav (dit mål)'});
    if(!dok) m.push({felt:'brand.dokumenteret',tekst:'Dokumenteret brandklasse'});
    else if(!b.dokumenteret.kilde) m.push({felt:'brand.dokumenteret.kilde',tekst:'Kilde til brandklassen'});
    if(m.length) return {status:'needs_input',mangler:m};
    var norm=function(s){ return String(s).toUpperCase().replace(/\s+/g,' ').trim(); };
    if(norm(maal)!==norm(dok)){
      // EI og REI reduceres ikke til tal: uden din egen sammenligningsregel kan to forskellige klasser ikke holdes op mod hinanden.
      if(!b.regel) return {status:'needs_input',mangler:[{felt:'brand.regel',tekst:'Klasserne er forskellige ('+dok+' / '+maal+'). Angiv din sammenligningsregel'}]};
      return {status:kontrolleret?'difference_from_target':'not_reviewed',mangler:[],tekst:b.regel};
    }
    return {status:kontrolleret?'documented_against_target':'not_reviewed',mangler:[]};
  }

  function erFacade(info){ return (info.revit&&info.revit.funktion==='Exterior') || info.tagSet['facade']; }

  function beregnInfo(rec,idx){
    var ed=rec.data, t=typeAf(ed), bi=ed.bygdata||{}, bt=(t&&t.bygdata)||{};
    var tags=[], tagSet={};
    (bt.tags||[]).forEach(function(x){ var k=tagNorm(x); if(!tagSet[k]){ tagSet[k]='type'; tags.push({tag:x,kilde:'type'}); } });
    (bi.tags||[]).forEach(function(x){ var k=tagNorm(x); if(!tagSet[k]){ tagSet[k]='element'; tags.push({tag:x,kilde:'element'}); } else if(tagSet[k]==='type'){ tagSet[k]='begge'; } });
    var st=effektivStatus(bi.status,bt.status);
    var data=flet(bt.data||null,bi.data||null);
    var info={idx:idx,rec:rec,ed:ed,type:t,erRum:!!ed.erRum,tags:tags,tagSet:tagSet,status:st.v,statusKilde:st.kilde,
      data:data,dataType:bt.data||null,dataElement:bi.data||null,dataFejl:bi.dataFejl||bt.dataFejl||null,
      rumanvendelse:bi.roomUse||null,stoej:stoejTal(bi.noise),stoejTekst:bi.noise||null,
      cci:(ed.issana&&ed.issana.cciCode)||(t&&t.issana&&t.issana.cciCode)||'',revit:ed.revit||null};
    info.kontrolleret=!!(data&&data.kontrol&&data.kontrol.kontrolleret===true);
    info.lyd=LYD_KAT[ed.category]? sammenlignLyd(data,info.kontrolleret) : {status:'not_applicable',mangler:[],kategori:true};
    info.brand=BYGNINGSDELE[ed.category]? sammenlignBrand(data,info.kontrolleret) : {status:'not_applicable',mangler:[],kategori:true};
    var m=[];
    if(BAERENDE_KAT[ed.category] && !info.tagSet['bærende'] && !info.tagSet['ikke-bærende']) m.push({felt:'tags',tekst:'Bærende eller ikke-bærende er ikke angivet'});
    if(BYGNINGSDELE[ed.category] && !info.cci) m.push({felt:'cci',tekst:'CCI-kode'});
    if(!info.lyd.kategori) info.lyd.mangler.forEach(function(x){ m.push(x); });
    if(!info.brand.kategori) info.brand.mangler.forEach(function(x){ m.push(x); });
    if(info.erRum && !info.rumanvendelse) m.push({felt:'rum',tekst:'Rumanvendelse'});
    if(ed.category==='Vægge' && erFacade(info) && info.stoej==null) m.push({felt:'stoej',tekst:'Støj udefra ved facaden'});
    if(renoveringsprojekt() && !info.erRum && BYGNINGSDELE[ed.category] && st.v===UNSET) m.push({felt:'handlingsstatus',tekst:'Handlingsstatus'});
    if(info.dataFejl) m.push({felt:'data',tekst:'Dataposten i Revit er ikke gyldig JSON'});
    info.mangler=m;
    return info;
  }

  var _renovering=null;
  function renoveringsprojekt(){
    if(_renovering!=null) return _renovering;
    var gemt=null; try{ gemt=localStorage.getItem('issana-renovering-'+modelNoegle()); }catch(e){}
    if(gemt!=null) return gemt==='1';
    var els=V.elementer(), t=V.typer();
    for(var i=0;i<els.length;i++){ var b=els[i].data.bygdata; if(b&&b.status) return true; }
    for(var k in t){ if(t[k].bygdata&&t[k].bygdata.status) return true; }
    return false;
  }
  function modelNoegle(){ var d=V&&V.data(); return (d&&(d.modelKey||d.model))||'model'; }

  function opdaterAlt(){
    _renovering=null; _renovering=renoveringsprojekt();
    var els=V.elementer(); infos=new Array(els.length); byRevitId={};
    for(var i=0;i<els.length;i++){ infos[i]=beregnInfo(els[i],i); if(typeof els[i].data.id==='number' && !els[i].data.erRum) byRevitId[els[i].data.id]=i; }
    els.forEach(function(r,i){ if(r.data.erRum) byRevitId['rum:'+r.data.id]=i; });
    A.infos=infos; A.byRevitId=byRevitId;
  }

  /* ---------- Lag: filtre og farver (ændrer aldrig Revit) ---------- */
  var LAG=[
    {id:'kategori',titel:'Kategori',v:function(i){ return [i.ed.category||'Andet']; }},
    {id:'etage',titel:'Etage',v:function(i){ return [i.ed.level||'(uden etage)']; }},
    {id:'konstruktion',titel:'Konstruktion',v:function(i){
      if(!BAERENDE_KAT[i.ed.category]) return ['(ikke relevant)'];
      var r=KONSTRUKTION_TAGS.filter(function(t){ return i.tagSet[t]; }); return r.length? r : ['ikke angivet']; }},
    {id:'lyd',titel:'Lyd (sammenligning)',v:function(i){ return [i.lyd.status]; },tekst:function(v){ return STATUS_TEKST[v]||v; },farve:function(v){ return STATUS_FARVE[v]; }},
    {id:'brand',titel:'Brand (sammenligning)',v:function(i){ return [i.brand.status]; },tekst:function(v){ return STATUS_TEKST[v]||v; },farve:function(v){ return STATUS_FARVE[v]; }},
    {id:'information',titel:'Information',v:function(i){ return [i.mangler.length? 'mangler data' : (i.kontrolleret? 'komplet og kontrolleret' : 'komplet, ikke kontrolleret')]; },
      farve:function(v){ return v==='mangler data'? '#c99a2e' : v==='komplet og kontrolleret'? '#4a7c59' : '#6f8796'; }},
    {id:'mangler',titel:'Manglende felter',v:function(i){ return i.mangler.length? i.mangler.map(function(m){ return m.tekst; }) : ['(intet mangler)']; }},
    {id:'klassifikation',titel:'Klassifikation',v:function(i){ return [i.cci? 'med CCI-kode' : 'mangler CCI-kode']; },
      farve:function(v){ return v==='med CCI-kode'? '#4a7c59' : '#c0504a'; }},
    {id:'renovering',titel:'Renovering (handlingsstatus)',v:function(i){ return [i.status]; },tekst:handlingTekst,farve:function(v){ return HANDLING_FARVE[v]; }},
    {id:'scope',titel:'Arbejdsscope',v:function(i){ var a=(i.data&&i.data.analyse)||{}, r=[];
      if(a.aktuel===true) r.push('indgår i analysen'); if(a.lca===true) r.push('valgt til LCA'); if(a.maengder===true) r.push('valgt til mængder'); if(a.sigma===true) r.push('valgt til Sigma');
      return r.length? r : ['ikke valgt']; }},
    {id:'tags',titel:'Tags',v:function(i){ return i.tags.length? i.tags.map(function(t){ return t.tag; }) : ['(ingen tags)']; }},
    {id:'rumanvendelse',titel:'Rumanvendelse',v:function(i){ return i.erRum? [i.rumanvendelse||'ikke angivet'] : ['(ikke et rum)']; }},
    {id:'fase',titel:'Revit-fase',v:function(i){ var r=[]; if(i.ed.faseOprettet) r.push('oprettet: '+i.ed.faseOprettet); if(i.ed.faseNedrevet) r.push('nedrevet: '+i.ed.faseNedrevet); return r.length? r : ['(uden fase)']; }}
  ];
  function lagAf(id){ for(var i=0;i<LAG.length;i++) if(LAG[i].id===id) return LAG[i]; return null; }
  var PALET=['#7fc7c1','#e0b07a','#7fc99a','#c98e8e','#b39ddb','#80cbc4','#ffcc80','#9fa8da','#a5d6a7','#ce93d8','#90caf9','#bcaaa4','#f48fb1','#c5e1a5'];
  function hashFarve(s){ var h=0; s=String(s); for(var i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return PALET[h%PALET.length]; }
  function vaerdiFarve(lag,v){ return (lag.farve&&lag.farve(v))||hashFarve(v); }

  function passer(rec,i){
    var info=infos[i]; if(!info) return true;
    var rumValgt=filterValg.kategori&&filterValg.kategori['Rum'];
    if(info.erRum && !visRum && !rumValgt) return false;
    for(var k in filterValg){
      var valg=filterValg[k], nogle=Object.keys(valg); if(!nogle.length) continue;
      var lag=lagAf(k); if(!lag) continue;
      var vs=lag.v(info), ok=false;
      for(var j=0;j<vs.length;j++) if(valg[vs[j]]){ ok=true; break; }
      if(!ok) return false;
    }
    return true;
  }
  function antalFiltre(){ var n=0; for(var k in filterValg) n+=Object.keys(filterValg[k]).length; return n; }
  function anvendFilter(){ V.filter(passer); opdaterFarvning(); }
  function opdaterFarvning(){
    var lag=farveLag? lagAf(farveLag) : null;
    if(!lag){ V.farve(null); return; }
    V.farve({
      farve:function(rec,i){ var info=infos[i]; if(!info) return null; var v=lag.v(info)[0]; return vaerdiFarve(lag,v); },
      legend:function(){
        var t={}; infos.forEach(function(info,i){ if(!info||!passer(info.rec,i)) return; var v=lag.v(info)[0]; t[v]=(t[v]||0)+1; });
        var ks=Object.keys(t).sort(function(a,b){ return t[b]-t[a]; }).slice(0,24);
        return '<h4>'+esc(lag.titel)+'</h4>'+ks.map(function(v){ return '<div class="legrow"><span class="sw" style="background:'+vaerdiFarve(lag,v)+'"></span>'+esc(lag.tekst? lag.tekst(v) : v)+' ('+t[v]+')</div>'; }).join('')+
          (lag.id==='lyd'||lag.id==='brand'? '<div class="legrow arb-note">Beskrivende status, ikke en vurdering af overholdelse.</div>' : '');
      }
    });
  }
  function synlige(){ var r=[]; infos.forEach(function(info,i){ if(info&&passer(info.rec,i)) r.push(i); }); return r; }

  function renderLag(el){
    if(!infos.length){ el.innerHTML='<div class="arb-tom">Hent modellen fra Revit først.</div>'; return; }
    var h='<div class="arb-row"><label class="arb-chk"><input type="checkbox" id="arbVisRum"'+(visRum?' checked':'')+'> Vis rum</label>'+
      '<label class="arb-chk"><input type="checkbox" id="arbReno"'+(_renovering?' checked':'')+'> Renoveringsprojekt</label></div>';
    h+='<div class="arb-row"><span class="arb-tal">'+synlige().length+' af '+infos.length+' vises</span>'+
      '<button class="tbtn" id="arbVaelgViste">Vælg de viste</button><button class="tbtn" id="arbNulstil"'+(antalFiltre()?'':' disabled')+'>Nulstil filtre</button></div>';
    if(_renovering) h+='<div class="arb-row"><button class="tbtn" id="arbFaser" title="Lægger forslag (ikke værdier) i ændringslisten. Du bekræfter dem pr. element under Egenskaber.">Foreslå handlingsstatus fra Revit-faser</button></div>';
    h+='<div class="arb-hint">Flere valg i samme lag giver ELLER, flere lag giver OG. Prikken farver 3D efter laget.</div>';
    LAG.forEach(function(lag){
      var t={}; infos.forEach(function(info){ if(!info) return; lag.v(info).forEach(function(v){ t[v]=(t[v]||0)+1; }); });
      var ks=Object.keys(t).sort(function(a,b){ return String(a).localeCompare(String(b),'da',{numeric:true}); });
      var valg=filterValg[lag.id]||{}, n=Object.keys(valg).length;
      h+='<details class="arb-lag"'+(n||lag.id==='konstruktion'||lag.id==='renovering'?' open':'')+'><summary><label class="arb-farv" title="Farv 3D efter dette lag"><input type="radio" name="arbFarve" value="'+lag.id+'"'+(farveLag===lag.id?' checked':'')+'></label>'+
        esc(lag.titel)+(n?' <span class="arb-pille">'+n+'</span>':'')+'</summary><div class="arb-vals">';
      ks.forEach(function(v){
        h+='<label class="arb-val"><input type="checkbox" data-lag="'+lag.id+'" data-v="'+esc(v)+'"'+(valg[v]?' checked':'')+'>'+
          '<span class="sw" style="background:'+vaerdiFarve(lag,v)+'"></span>'+esc(lag.tekst? lag.tekst(v) : v)+' <span class="arb-n">'+t[v]+'</span></label>';
      });
      h+='</div></details>';
    });
    h+='<div class="arb-row"><label class="arb-chk"><input type="radio" name="arbFarve" value=""'+(farveLag?'':' checked')+'> Ingen lagfarve (visningens egen farve)</label></div>';
    el.innerHTML=h;
    el.querySelectorAll('input[data-lag]').forEach(function(cb){ cb.onchange=function(){
      var l=cb.getAttribute('data-lag'), v=cb.getAttribute('data-v'); var s=filterValg[l]||(filterValg[l]={});
      if(cb.checked) s[v]=true; else delete s[v]; anvendFilter(); renderLag(el); }; });
    el.querySelectorAll('input[name=arbFarve]').forEach(function(r){ r.onchange=function(){ farveLag=r.value; opdaterFarvning(); }; });
    $('arbVisRum').onchange=function(e){ visRum=e.target.checked; anvendFilter(); renderLag(el); };
    $('arbReno').onchange=function(e){ try{ localStorage.setItem('issana-renovering-'+modelNoegle(),e.target.checked?'1':'0'); }catch(x){} opdaterAlt(); anvendFilter(); renderLag(el); };
    $('arbVaelgViste').onclick=function(){ var s=synlige(); if(!s.length){ V.fejl('Ingen elementer vises.'); return; } V.vaelgFlere(s); visFane('data'); };
    $('arbNulstil').onclick=function(){ filterValg={}; anvendFilter(); renderLag(el); };
    if($('arbFaser')) $('arbFaser').onclick=function(){ var n=foreslaaFraFaser(); if(n) { V.info(n+' forslag i ændringslisten. Gem dem i Revit, og bekræft dem pr. element.'); visFane('aendringer'); } else V.info('Ingen elementer uden handlingsstatus har faser at foreslå ud fra.'); };
  }

  /* ---------- Egenskaber: bygningsdata for det valgte ---------- */
  function row(k,v,klasse){ return '<div class="prow"><div class="k">'+esc(k)+'</div><div class="v'+(klasse?' '+klasse:'')+'">'+v+'</div></div>'; }
  function kilde(k){ return k==='type'? ' <span class="arb-kilde">type</span>' : k==='element'? ' <span class="arb-kilde">element</span>' : k==='begge'? ' <span class="arb-kilde">type + element</span>' : ''; }
  function statusChip(s){ return '<span class="arb-status" style="--c:'+(STATUS_FARVE[s]||'#999')+'">'+esc(STATUS_TEKST[s]||s)+'</span>'; }
  function vaerdiTekst(o){ if(!o||o.vaerdi==null) return 'mangler'; return esc((o.stoerrelse?o.stoerrelse+' ':'')+fmt(o.vaerdi)+' '+(o.enhed||'dB')); }

  function propsHtml(ed,idx){
    var info=infos[idx]; if(!info||ed.uniqueId==null) return '';
    var h='<div class="pgroup">Bygningsdata</div>';
    h+=row('Tags',info.tags.length? info.tags.map(function(t){ return '<span class="badge">'+esc(t.tag)+kilde(t.kilde)+'</span>'; }).join('') : '<span class="issana-mangler">ingen</span>');
    if(info.erRum){
      var nuv=info.data&&info.data.rum&&info.data.rum.nuvaerendeAnvendelse;
      h+=row(nuv?'Anvendelse (planlagt)':'Anvendelse',info.rumanvendelse? esc(info.rumanvendelse) : '<span class="issana-mangler">ikke angivet</span>');
      if(nuv) h+=row('Anvendelse i dag',esc(nuv));
      if(ed.volume!=null) h+=row('Volumen',fmt(ed.volume)+' m³');
      if(ed.graenser&&ed.graenser.length) h+=row('Afgrænses af',ed.graenser.length+' bygningsdele');
    }
    if(!info.erRum) h+=row('Handlingsstatus',esc(handlingTekst(info.status))+kilde(info.statusKilde));
    if(ed.faseOprettet||ed.faseNedrevet) h+=row('Revit-fase',esc([ed.faseOprettet&&('oprettet: '+ed.faseOprettet),ed.faseNedrevet&&('nedrevet: '+ed.faseNedrevet)].filter(Boolean).join(' · ')));
    if(ed.category==='Vægge'&&(erFacade(info)||info.stoejTekst)){
      var st=info.data&&info.data.stoej;
      h+=row('Støj udefra',info.stoejTekst? esc(info.stoejTekst)+(st&&st.kilde?' <span class="arb-kilde">'+esc(st.kilde)+'</span>':'') : '<span class="issana-mangler">mangler</span>');
    }
    if(info.revit){
      var rv=[]; if(info.revit.funktion) rv.push('funktion '+info.revit.funktion); if(info.revit.baerende!=null) rv.push('Structural '+(info.revit.baerende?'ja':'nej'));
      if(rv.length) h+=row('Revit siger',esc(rv.join(' · '))+(info.revit.baerende===true&&!info.tagSet['bærende']?' <button class="tbtn arb-mini" data-arb="brug-baerende">Brug som tag</button>':''));
    }
    if(!info.lyd.kategori){
      var l=(info.data&&info.data.lyd)||{};
      h+='<div class="pgroup">Lyd</div>'+row('Status',statusChip(info.lyd.status));
      h+=row('Mål',vaerdiTekst(l.maal))+row('Dokumenteret',vaerdiTekst(l.dokumenteret)+(l.dokumenteret&&l.dokumenteret.metode?' ('+esc(l.dokumenteret.metode)+')':''));
      var r=info.lyd.resultat; if(r&&r.forskel&&r.forskel.tekst) h+=row('Forskel',esc(r.forskel.tekst));
      if(l.dokumenteret&&l.dokumenteret.kilde) h+=row('Kilde',esc(l.dokumenteret.kilde));
      if(l.dokumenteret&&l.dokumenteret.forudsaetninger) h+=row('Forudsætninger',esc(l.dokumenteret.forudsaetninger));
      if(l.dokumenteret&&l.dokumenteret.metode==='lab') h+='<div class="arb-note">En laboratorieværdi beskriver kun den prøvede prøve, ikke den færdige bygning.</div>';
    }
    if(!info.brand.kategori){
      var b=(info.data&&info.data.brand)||{};
      h+='<div class="pgroup">Brand</div>'+row('Status',statusChip(info.brand.status));
      h+=row('Mål',b.maal&&b.maal.klasse? esc(b.maal.klasse) : '<span class="issana-mangler">mangler</span>')+row('Dokumenteret',b.dokumenteret&&b.dokumenteret.klasse? esc(b.dokumenteret.klasse) : '<span class="issana-mangler">mangler</span>');
      if(b.dokumenteret&&b.dokumenteret.kilde) h+=row('Kilde',esc(b.dokumenteret.kilde));
      if(b.dokumenteret&&b.dokumenteret.forudsaetninger) h+=row('Forudsætninger',esc(b.dokumenteret.forudsaetninger));
    }
    var d=info.data||{};
    if(d.linjetab&&d.linjetab.psi!=null) h+=row('Linjetab ψ',fmt(d.linjetab.psi,3)+' W/mK'+(d.linjetab.kilde?' <span class="arb-kilde">'+esc(d.linjetab.kilde)+'</span>':''));
    if(Array.isArray(d.begraensninger)&&d.begraensninger.length) h+=row('Begrænsninger',d.begraensninger.map(function(x){ return esc((x.type?x.type+': ':'')+(x.tekst||'')); }).join('<br>'));
    var fl=forslagListe(info);
    if(fl.length) h+=row('Forslag',fl.map(function(f,k){ return esc(f.f.felt+': '+(typeof f.f.vaerdi==='string'? (f.f.felt==='handlingsstatus'? handlingTekst(f.f.vaerdi) : f.f.vaerdi) : JSON.stringify(f.f.vaerdi)))+
      ' <span class="arb-kilde">foreslået'+(f.paa==='type'?' på typen':'')+(f.f.af?' af '+esc(f.f.af):'')+'</span>'+(f.f.begrundelse?'<div class="arb-n">'+esc(f.f.begrundelse)+'</div>':'')+
      '<button class="tbtn arb-mini" data-arb="bekraeft:'+k+'">Bekræft</button><button class="tbtn arb-mini" data-arb="afvis:'+k+'">Afvis</button>'; }).join('<br>'));
    var k=d.kontrol||{};
    h+=row('Kontrol',k.kontrolleret? 'kontrolleret'+(k.dato?' '+esc(k.dato):'')+(k.af?' af '+esc(k.af):'') : '<span class="issana-mangler">ikke kontrolleret</span>');
    if(info.mangler.length) h+=row('Mangler',info.mangler.map(function(m){ return esc(m.tekst); }).join('<br>'),'issana-mangler');
    if(!info.lyd.kategori||!info.brand.kategori) h+='<div class="arb-note">'+esc(ANSVAR)+'</div>';
    h+='<div class="arb-row"><button class="tbtn primary" data-arb="rediger">Rediger bygningsdata</button>'+(V.valgte().length>1?' <span class="arb-n">'+V.valgte().length+' valgt</span>':'')+'</div>';
    return h;
  }
  // Forslag (AI eller Revit-faser) ligger i dataposten med status "proposed" på typen eller elementet. Bekræft gør dem til
  // værdier gennem ændringslisten; afvis fjerner dem. Intet bliver en værdi uden dit klik.
  function forslagListe(info){
    var r=[];
    [['type',info.dataType],['element',info.dataElement]].forEach(function(x){ var d=x[1]; if(d&&Array.isArray(d.forslag)) d.forslag.forEach(function(f,i){ if(f&&f.status==='proposed') r.push({paa:x[0],i:i,f:f}); }); });
    return r;
  }
  function behandlForslag(info,item,bekraeft){
    var m=maal(info,item.paa), rec=dataFor(m), f=item.f;
    // Et bekræftet/afvist EPD-forslag ændrer ISSANA LCA-projektet: lad Rust regne igen (debounced, kun når panelet er klar).
    if(f&&f.felt==='epd'&&window.issanaLca&&typeof window.issanaLca.genberegnSnart==='function') window.issanaLca.genberegnSnart();
    if(Array.isArray(rec.forslag)) rec.forslag=rec.forslag.filter(function(x){ return !(x&&x.felt===f.felt&&JSON.stringify(x.vaerdi)===JSON.stringify(f.vaerdi)&&x.tid===f.tid); });
    if(rec.forslag&&!rec.forslag.length) delete rec.forslag;
    if(bekraeft){
      if(f.felt==='handlingsstatus') saet(m,m.instans?P.status:P.typeStatus,String(f.vaerdi||''),'handlingsstatus');
      else if(f.felt==='tags') laegTags([info],item.paa,[].concat(f.vaerdi||[]),[]);
      else if(f.felt==='rumanvendelse'&&m.instans) saet(m,P.rum,String(f.vaerdi||''),'rumanvendelse');
      else if(f.felt==='stoej'&&m.instans) saet(m,P.stoej,String(f.vaerdi||''),'støj');
      // Konstruktiv funktion (AI-feltet): bærende og ikke-bærende udelukker hinanden.
      else if(f.felt==='konstruktiv'){ var kv=String(f.vaerdi||''); laegTags([info],item.paa,[kv],kv==='bærende'?['ikke-bærende']:kv==='ikke-bærende'?['bærende']:[]); }
      // CCI-klasse (AI-feltet): skrives i ISSANA CCI Code på typen. Den nuværende kode kendes fra modelfilen (issana.cciCode),
      // så previousValue passer; findes parameteren ikke på typen endnu, sættes den op først (kraeverOpsaetning).
      else if(f.felt==='cci'&&!m.instans){ var nuv=(m.obj.issana&&m.obj.issana.cciCode)||''; var bd=m.obj.bygdata||(m.obj.bygdata={raw:{}}); bd.raw=bd.raw||{}; if(nuv&&bd.raw[P_CCI]==null) bd.raw[P_CCI]=nuv; saet(m,P_CCI,String(f.vaerdi||''),'CCI-kode'); }
      else if(f.felt==='data'&&f.vaerdi&&typeof f.vaerdi==='object'){ var fl=flet(rec,f.vaerdi); Object.keys(fl).forEach(function(k){ rec[k]=fl[k]; }); }
      // LCA (AI-feltet, 3.0): CO₂ for typen som helhed (lca) eller en EPD pr. byggevare/lag (lca.byggevarer[lag-id]); kilden følger med.
      else if(f.felt==='lca'&&f.vaerdi&&typeof f.vaerdi==='object'){ var lc=flet(rec.lca||{},f.vaerdi); delete lc.byggevarer; if(rec.lca&&rec.lca.byggevarer) lc.byggevarer=rec.lca.byggevarer; lc.status='bekraeftet'; rec.lca=lc; }
      else if(f.felt==='epd'&&f.vaerdi&&typeof f.vaerdi==='object'&&f.vaerdi.lag!=null){ rec.lca=rec.lca||{}; var bv=rec.lca.byggevarer||(rec.lca.byggevarer={}); var post=klon(f.vaerdi); post.status='bekraeftet'; bv[String(f.vaerdi.lag)]=post; }
    }
    gemData(m,rec,bekraeft?'forslag bekræftet':'forslag afvist');
    V.info((bekraeft?'Forslaget er bekræftet':'Forslaget er afvist')+' og lagt i ændringslisten.');
  }
  // Renovering: foreslå handlingsstatus ud fra Revits faser (nedrevet → rives ned, oprettet i første fase → eksisterende,
  // ikke vurderet, ellers nyt element). Kun forslag; du bekræfter dem pr. element i Egenskaber.
  function foreslaaFraFaser(){
    var faser=(V.data()&&V.data().faser)||[], foerste=faser[0], n=0;
    infos.forEach(function(i){
      if(!i||i.erRum||!BYGNINGSDELE[i.ed.category]||i.status!==UNSET) return;
      if(forslagListe(i).some(function(x){ return x.f.felt==='handlingsstatus'; })) return;
      var v=null, hvorfor='';
      if(i.ed.faseNedrevet){ v='demolish'; hvorfor='Revit: nedrevet i fasen «'+i.ed.faseNedrevet+'»'; }
      else if(i.ed.faseOprettet&&foerste&&i.ed.faseOprettet===foerste&&faser.length>1){ v='existing_not_assessed'; hvorfor='Revit: oprettet i den første fase «'+foerste+'»'; }
      else if(i.ed.faseOprettet&&foerste&&i.ed.faseOprettet!==foerste){ v='new_element'; hvorfor='Revit: oprettet i fasen «'+i.ed.faseOprettet+'»'; }
      if(!v) return;
      var m=maal(i,'element'), rec=dataFor(m);
      (rec.forslag||(rec.forslag=[])).push({felt:'handlingsstatus',vaerdi:v,begrundelse:hvorfor,af:'Revit-faser',tid:new Date().toISOString(),status:'proposed'});
      gemData(m,rec,'forslag'); n++;
    });
    return n;
  }
  function propsVist(ed,body,idx){
    body.querySelectorAll('[data-arb]').forEach(function(b){ b.onclick=function(){
      var a=b.getAttribute('data-arb');
      if(a==='rediger'){ aabenSkuffe('data'); }
      else if(a.indexOf('bekraeft:')===0||a.indexOf('afvis:')===0){ var info2=infos[idx]; var k=Number(a.split(':')[1]); var item=forslagListe(info2)[k]; if(item) behandlForslag(info2,item,a.indexOf('bekraeft:')===0); V.visProps(); }
      else if(a==='brug-baerende'){ var info=infos[idx]; laegTags([info],'element',['bærende'],[]); V.info('«bærende» er lagt i ændringslisten. Gem i Revit, når du er klar.'); V.visProps(); }
    }; });
  }

  /* ---------- Ændringer: forhåndsvisning og gem i Revit ---------- */
  function maal(info,paa){   // hvor skrives: elementet (eller rummet) eller typen
    if(paa==='type'&&info.type&&info.type.uniqueId) return {uniqueId:info.type.uniqueId,instans:false,navn:'Type: '+(info.type.name||info.ed.type||''),obj:info.type};
    return {uniqueId:info.ed.uniqueId,instans:true,navn:(info.erRum?'Rum ':'')+(info.ed.name||info.ed.type||'Element')+' ('+info.ed.id+')',obj:info.ed};
  }
  function raa(m,param){ var b=m.obj.bygdata; var v=b&&b.raw? b.raw[param] : undefined; return v; }
  function nu(m,param){ var k=m.uniqueId+'|'+param; if(aendringer[k]) return aendringer[k].til; var v=raa(m,param); return v==null? '' : v; }
  function saet(m,param,vaerdi,hvad,af){
    var k=m.uniqueId+'|'+param, fra=raa(m,param);
    var x=aendringer[k]||(aendringer[k]={uniqueId:m.uniqueId,param:param,fra:fra==null?'':fra,kraeverOpsaetning:fra==null,navn:m.navn,obj:m.obj,instans:m.instans,hvad:[]});
    x.til=vaerdi; if(hvad&&x.hvad.indexOf(hvad)<0) x.hvad.push(hvad); if(af) x.af=af;
    if(x.til===x.fra) delete aendringer[k];
    if(param===P.rum&&m.instans) rumnavnFraAnvendelse(m,vaerdi);
    opdaterAendringTal();
  }
  // Rumanvendelsen er det navn, brugeren har givet et rum uden navn i Revit: den følger med som Revit-rumnavn. Et rum med et
  // rigtigt navn røres ikke, og rum uden anvendelse får intet. Har brugeren selv skrevet et navn i listen, står det urørt.
  function erStandardRumnavn(navn){ var P2=window.IssanaPlacering; return P2&&P2.erStandardNavn? P2.erStandardNavn(navn) : String(navn==null?'':navn).trim()===''; }
  function rumnavnFraAnvendelse(m,vaerdi){
    var fra=raa(m,P.rumnavn); if(fra===undefined||!erStandardRumnavn(fra)) return;   // ikke et rum, eller rummet har allerede et navn
    var k=m.uniqueId+'|'+P.rumnavn, x=aendringer[k]; if(x&&x.egetNavn) return;
    var v=String(vaerdi==null?'':vaerdi).trim();
    if(!v){ if(x) delete aendringer[k]; return; }
    var navn=v.charAt(0).toUpperCase()+v.slice(1);
    saet(m,P.rumnavn,navn,'rumnavn fra rumanvendelsen');
  }
  // 3.0: sporene (Statik, AI, Lyd) lægger en ændring i listen med ét objekt i samme form som listen selv bruger:
  // {uniqueId, param, til, navn, obj, instans, hvad:[…], af}. fra og kraeverOpsaetning udledes af obj.bygdata.raw (ikke af kalderen),
  // så forhåndsvisningen altid viser Revits nuværende værdi. Returnerer true, når ændringen ligger i listen.
  function tilfoej(x){
    if(!x||!x.uniqueId||!x.param){ console.warn('ISSANA arbejdsrum: tilfoej mangler uniqueId eller param', x); return false; }
    var hvad=Array.isArray(x.hvad)? x.hvad.filter(Boolean) : (x.hvad? [String(x.hvad)] : []);
    var m={uniqueId:x.uniqueId,instans:x.instans!==false,navn:x.navn||String(x.uniqueId),obj:x.obj||{}};
    saet(m,x.param,x.til==null? '' : String(x.til),hvad[0]||'sporet',x.af||null);
    for(var i=1;i<hvad.length;i++){ var e=aendringer[m.uniqueId+'|'+x.param]; if(e&&e.hvad.indexOf(hvad[i])<0) e.hvad.push(hvad[i]); }
    return true;
  }
  function dataFor(m){ var s=nu(m,m.instans?P.data:P.typeData); return parseData(s)||{schema:SCHEMA}; }
  function gemData(m,rec,hvad,af){
    rec.schema=SCHEMA;
    (rec.historik||(rec.historik=[])).push({tid:new Date().toISOString(),felt:hvad,af:initialer||null});
    if(rec.historik.length>50) rec.historik=rec.historik.slice(-50);
    saet(m,m.instans?P.data:P.typeData,JSON.stringify(rec),hvad,af);
  }
  function unikkeMaal(liste,paa){ var set={}, r=[]; liste.forEach(function(info){ var m=maal(info,paa); if(!set[m.uniqueId]){ set[m.uniqueId]=1; r.push(m); } }); return r; }
  function laegTags(liste,paa,til,fra){
    unikkeMaal(liste,paa).forEach(function(m){
      var p=m.instans?P.tags:P.typeTags, tags=splitTags(nu(m,p)), fl={};
      (fra||[]).forEach(function(t){ fl[tagNorm(t)]=1; });
      tags=tags.filter(function(t){ return !fl[tagNorm(t)]; });
      (til||[]).forEach(function(t){ if(!tags.some(function(x){ return tagNorm(x)===tagNorm(t); })) tags.push(t); });
      saet(m,p,joinTags(tags),'tags');
    });
  }
  function antalAendringer(){ return Object.keys(aendringer).length; }
  function opdaterAendringTal(){ var b=$('arbFaneaendringer'); if(b) b.textContent='Ændringer'+(antalAendringer()?' ('+antalAendringer()+')':''); var k=$('arbKnap'); if(k) k.classList.toggle('har',antalAendringer()>0); udsend('aendringer',antalAendringer()); }
  // 3.0: små hændelser til layoutet (arbejdsrum-layout.js): 'aendringer' (antal i listen), 'gemt' (antal skrevet i Revit), 'skuffe' (åben/lukket, fane).
  var lyttere={};
  function udsend(navn){ var a=Array.prototype.slice.call(arguments,1); (lyttere[navn]||[]).forEach(function(fn){ try{ fn.apply(null,a); }catch(e){ console.error('ISSANA arbejdsrum ('+navn+'):',e); } }); }

  function visVaerdi(param,v){
    if(v==null||v==='') return '<span class="issana-mangler">tom</span>';
    if(param===P.data||param===P.typeData){ var o=parseData(v); return o? esc(Object.keys(o).filter(function(k){ return k!=='schema'&&k!=='historik'; }).join(', ')||'(tom post)') : '<span class="issana-mangler">ugyldig</span>'; }
    if(param===P.status||param===P.typeStatus) return esc(handlingTekst(v));
    return esc(v);
  }
  var PARAM_TEKST={}; PARAM_TEKST[P.tags]='Tags'; PARAM_TEKST[P.typeTags]='Tags (type)'; PARAM_TEKST[P.status]='Handlingsstatus'; PARAM_TEKST[P.typeStatus]='Handlingsstatus (type)';
  PARAM_TEKST[P.data]='Data'; PARAM_TEKST[P.typeData]='Data (type)'; PARAM_TEKST[P.rum]='Rumanvendelse'; PARAM_TEKST[P.stoej]='Støj udefra'; PARAM_TEKST[P_CCI]='CCI-kode (type)'; PARAM_TEKST[P.rumnavn]='Rumnavn (Revit)';

  function renderAendringer(el){
    var ks=Object.keys(aendringer);
    if(!ks.length){ el.innerHTML='<div class="arb-tom">Ingen ændringer endnu. Vælg elementer i 3D, og brug «Rediger bygningsdata».</div>'; return; }
    var h='<div class="arb-hint">Forhåndsvisning. Intet er skrevet i Revit endnu. «Gem i Revit» skriver alt i én transaktion, kontrollerer hver værdi og læser den tilbage.</div><div class="arb-liste">';
    ks.forEach(function(k){ var x=aendringer[k];
      h+='<div class="arb-aendr"><div class="arb-aendr-h"><b>'+esc(x.navn)+'</b> · '+esc(PARAM_TEKST[x.param]||x.param)+(x.hvad.length?' <span class="arb-kilde">'+esc(x.hvad.join(', '))+'</span>':'')+(x.af?' <span class="arb-kilde">af '+esc(x.af)+'</span>':'')+
        '<button class="arb-x" data-fjern="'+esc(k)+'" title="Fjern ændringen">×</button></div>'+
        '<div class="arb-aendr-v">'+visVaerdi(x.param,x.fra)+' → '+visVaerdi(x.param,x.til)+'</div></div>';
    });
    h+='</div><div class="arb-row"><button class="tbtn primary" id="arbGem">Gem i Revit ('+ks.length+')</button><button class="tbtn" id="arbKasser">Kassér alle</button></div>';
    if(ks.some(function(k){ return aendringer[k].kraeverOpsaetning; })) h+='<div class="arb-note">Nogle ISSANA-parametre findes ikke i modellen endnu. De bliver sat op først (issana_parameters).</div>';
    el.innerHTML=h;
    el.querySelectorAll('[data-fjern]').forEach(function(b){ b.onclick=function(){ delete aendringer[b.getAttribute('data-fjern')]; opdaterAendringTal(); renderAendringer(el); }; });
    $('arbKasser').onclick=function(){ aendringer={}; opdaterAendringTal(); renderAendringer(el); };
    $('arbGem').onclick=function(){ gemIRevit(); };
  }

  var gemmer=false;
  function gemIRevit(){
    if(gemmer) return;
    var ks=Object.keys(aendringer); if(!ks.length) return;
    if(!V.erRevit()){ V.fejl('Ikke i Revit: åbn ISSANA 3D fra Analyse bygningsdele.'); return; }
    var d=V.data(); if(!d||!d.modelKey){ V.fejl('Hent modellen fra Revit igen (filen mangler modelKey fra 2.12).'); return; }
    var rows=ks.map(function(k){ var x=aendringer[k]; return {uniqueId:x.uniqueId,parameterName:x.param,previousValue:x.fra,value:x.til}; });
    var behov=ks.some(function(k){ return aendringer[k].kraeverOpsaetning; });
    gemmer=true; var b=$('arbGem'); if(b){ b.disabled=true; b.textContent='Gemmer…'; }
    (behov? V.kald('issana_parameters',{operation:'ensure'},{timeoutMs:300000}) : Promise.resolve())
      .then(function(){ return V.kald('issana_apply_plan',{recipe:'apply_parameter_plan',recipeVersion:1,planId:'issana3d-'+Date.now(),expectedModelKey:d.modelKey,rows:rows},{timeoutMs:600000}); })
      .then(function(svar){
        ks.forEach(function(k){ var x=aendringer[k]; var b2=x.obj.bygdata||(x.obj.bygdata={raw:{}}); var raw=b2.raw||{}; raw[x.param]=x.til;
          var ny=bygdataFraRaw(raw,x.instans); x.obj.bygdata=ny;
          if(x.param===P_CCI){ (x.obj.issana||(x.obj.issana={})).cciCode=x.til; }
          if(x.param===P.rumnavn) rumnavnGemt(x); });   // CCI-laget og «mangler CCI-kode» følger med uden ny hentning
        aendringer={}; opdaterAendringTal(); opdaterAlt(); anvendFilter(); V.visProps(); renderFane();
        V.info('Gemt i Revit: '+((svar&&svar.written)||rows.length)+' værdier, kontrolleret efter skrivning.');
        log('lavet','Gemt i Revit',rows.length+' værdier'); udsend('gemt',rows.length);
      })
      .catch(function(e){ V.fejl('Intet er gemt: '+((e&&e.message)||e)); })
      .then(function(){ gemmer=false; var b3=$('arbGem'); if(b3){ b3.disabled=false; b3.textContent='Gem i Revit ('+antalAendringer()+')'; } });
  }
  // Rumnavnet er skrevet i Revit: rummet i modelfilen og elementet i 3D skal vise det nye navn uden ny hentning.
  function rumnavnGemt(x){
    var d=V.data(); if(!d) return;
    (d.rooms||[]).forEach(function(r){ if(r.uniqueId===x.uniqueId){ r.name=x.til; if(r.bygdata&&r.bygdata.raw) r.bygdata.raw[P.rumnavn]=x.til; } });
    (d.elements||[]).forEach(function(e){ if(e.erRum&&e.uniqueId===x.uniqueId){ var num=(d.rooms||[]).filter(function(r){ return r.uniqueId===x.uniqueId; })[0]; e.name=((num&&num.number?num.number+' ':'')+x.til).trim(); if(e.bygdata&&e.bygdata.raw) e.bygdata.raw[P.rumnavn]=x.til; } });
  }
  function log(){ /* plads til en senere log; ingen data forlader siden */ }

  /* ---------- Data: redigér det valgte ---------- */
  function valgteInfos(){ return V.valgte().map(function(i){ return infos[i]; }).filter(function(x){ return x&&x.ed.uniqueId!=null; }); }
  function sel(id,opts,val){ return '<select id="'+id+'" class="arb-in">'+opts.map(function(o){ return '<option value="'+esc(o.v)+'"'+(o.v===val?' selected':'')+'>'+esc(o.t)+'</option>'; }).join('')+'</select>'; }
  function inp(id,val,ph,w){ return '<input id="'+id+'" class="arb-in'+(w?' '+w:'')+'" value="'+esc(val==null?'':val)+'" placeholder="'+esc(ph||'')+'">'; }
  function felt(t,html){ return '<label class="arb-felt"><span>'+esc(t)+'</span>'+html+'</label>'; }

  function renderData(el){
    var liste=valgteInfos();
    if(!liste.length){ el.innerHTML='<div class="arb-tom">Vælg et eller flere elementer i 3D (Ctrl-klik for flere), eller brug «Vælg de viste» under Lag.</div>'; return; }
    var en=liste.length===1? liste[0] : null, harRum=liste.some(function(i){ return i.erRum; }), harDele=liste.some(function(i){ return !i.erRum; });
    var harVaeg=liste.some(function(i){ return i.ed.category==='Vægge'; }), harLyd=liste.some(function(i){ return LYD_KAT[i.ed.category]; });
    var d=en? (en.data||{}) : {}, l=d.lyd||{}, b=d.brand||{}, s=d.stoej||{}, a=d.analyse||{}, lm=l.maal||{}, ld=l.dokumenteret||{};
    var typer={}; liste.forEach(function(i){ if(i.type) typer[i.type.uniqueId]=1; });
    var h='<div class="arb-hint">'+liste.length+' valgt'+(harDele? ' · '+Object.keys(typer).length+' typer' : '')+'. Tomme felter ændrer intet. Alt lægges i ændringslisten først.</div>';
    var antalForslag=liste.reduce(function(n,i){ return n+forslagListe(i).length; },0);
    if(antalForslag) h+='<div class="arb-row"><span class="arb-tal">'+antalForslag+' forslag på de valgte</span><button class="tbtn" id="arbBekraeftAlle">Bekræft alle</button><button class="tbtn" id="arbAfvisAlle">Afvis alle</button></div>';
    if(harDele) h+=felt('Gem på',sel('arbPaa',[{v:'element',t:'Elementerne (gælder kun dem)'},{v:'type',t:'Typerne (gælder alle af typen)'}],'element'));
    h+='<div class="arb-sek">Tags</div><div class="arb-chips">'+STANDARD_TAGS.concat(egneTags()).map(function(t){
      var n=liste.filter(function(i){ return i.tagSet[tagNorm(t)]; }).length;
      return '<button class="arb-chip'+(n===liste.length?' on':n?' delvis':'')+'" data-tag="'+esc(t)+'">'+esc(t)+'</button>'; }).join('')+'</div>';
    h+=felt('Nyt tag',inp('arbNytTag','','fx tung skillevæg'));
    if(harDele) h+=felt('Handlingsstatus',sel('arbStatus',[{v:'',t:'– uændret –'},{v:'__ryd',t:'Ikke angivet (ryd)'}].concat(HANDLING),en&&en.statusKilde==='element'? en.status : ''));
    if(harRum&&en) h+=felt('Rumnavn (skrives i Revit med «Gem i Revit»)',inp('arbRumnavn',raa(maal(en,'element'),P.rumnavn),'fx Bad 1.03'));
    if(harRum) h+=felt(_renovering?'Rumanvendelse efter renovering (planlagt)':'Rumanvendelse',sel('arbRum',[{v:'',t:'– uændret –'},{v:'__ryd',t:'Ryd'}].concat(RUMANVENDELSER.map(function(r){ return {v:r,t:r}; })),en&&en.rumanvendelse||''));
    if(harRum&&_renovering) h+=felt('Nuværende anvendelse (før renovering)',sel('arbRumNu',[{v:'',t:'– ikke angivet –'}].concat(RUMANVENDELSER.map(function(r){ return {v:r,t:r}; })),en&&en.data&&en.data.rum&&en.data.rum.nuvaerendeAnvendelse||''));
    if(harVaeg){
      h+='<div class="arb-sek">Støj udefra (facade)</div><div class="arb-grid">'+felt('dB',inp('arbStoej',en&&en.stoej,'fx 68','kort'))+
        felt('Størrelse',sel('arbStoejSt',[{v:'Lden',t:'Lden'},{v:'LAeq,24h',t:'LAeq,24h'},{v:'LAeq,dag',t:'LAeq dag'}],s.stoerrelse||'Lden'))+
        felt('Metode',sel('arbStoejM',[{v:'indtastet',t:'Indtastet'},{v:'beregnet',t:'Beregnet'},{v:'maalt',t:'Målt'}],s.metode||'indtastet'))+'</div>'+
        felt('Kilde',inp('arbStoejK',s.kilde,'fx støjkort 2022, støjrapport'));
    }
    if(harLyd){
      h+='<div class="arb-sek">Lyd</div><div class="arb-grid">'+felt('Dokumenteret',sel('arbLydSt',[{v:'Rw',t:'Rw'},{v:"R'w",t:"R'w"},{v:'Ln,w',t:'Ln,w'},{v:"L'n,w",t:"L'n,w"},{v:'Dn,e,w',t:'Dn,e,w'}],ld.stoerrelse||'Rw'))+
        felt('Værdi dB',inp('arbLydV',ld.vaerdi,'','kort'))+felt('Ctr',inp('arbLydCtr',ld.Ctr,'','kort'))+
        felt('Metode',sel('arbLydM',[{v:'lab',t:'Laboratorie'},{v:'felt',t:'Felt'},{v:'beregnet',t:'Beregnet'}],ld.metode||'lab'))+'</div>'+
        felt('Kilde',inp('arbLydK',ld.kilde,'fx prøvningsrapport, produktblad'))+felt('Forudsætninger',inp('arbLydF',ld.forudsaetninger,''))+
        '<div class="arb-grid">'+felt('Dit mål',sel('arbMaalSt',[{v:"R'w",t:"R'w (min)"},{v:'Rw',t:'Rw (min)'},{v:"L'n,w",t:"L'n,w (max)"},{v:"D'nT,w",t:"D'nT,w (min)"}],lm.stoerrelse||"R'w"))+
        felt('Mål dB',inp('arbMaalV',lm.vaerdi,'','kort'))+'</div>'+
        '<label class="arb-chk"><input type="checkbox" id="arbLydIR"'+(l.ikkeRelevant?' checked':'')+'> Lyd er ikke relevant her</label>';
      h+='<div class="arb-sek">Brand</div><div class="arb-grid">'+felt('Dit krav',inp('arbBrandM',b.maal&&b.maal.klasse,'fx EI 60'))+felt('Dokumenteret',inp('arbBrandD',b.dokumenteret&&b.dokumenteret.klasse,'fx EI 60'))+'</div>'+
        felt('Kilde',inp('arbBrandK',b.dokumenteret&&b.dokumenteret.kilde,''))+felt('Din sammenligningsregel (hvis klasserne er forskellige)',inp('arbBrandR',b.regel,''))+
        '<label class="arb-chk"><input type="checkbox" id="arbBrandIR"'+(b.ikkeRelevant?' checked':'')+'> Brand er ikke relevant her</label>';
      h+='<div class="arb-sek">Linjetab</div><div class="arb-grid">'+felt('ψ W/mK',inp('arbPsi',d.linjetab&&d.linjetab.psi,'','kort'))+felt('Kilde',inp('arbPsiK',d.linjetab&&d.linjetab.kilde,''))+'</div>';
    }
    if(harRum){
      var rm=(l.maal&&l.maal.facade)||{};
      h+='<div class="arb-sek">Lydmål for rummet (dine egne)</div><div class="arb-grid">'+
        felt('Indendørs fra trafik, max dB',inp('arbRumInde',rm.vaerdi,'','kort'))+
        felt("Luftlyd R'w, min dB",inp('arbRumLuft',l.maal&&l.maal.luftlyd&&l.maal.luftlyd.vaerdi,'','kort'))+
        felt("Trinlyd L'nT,w, max dB",inp('arbRumTrin',l.maal&&l.maal.trinlyd&&l.maal.trinlyd.vaerdi,'','kort'))+
        felt('Installationer, max dB(A)',inp('arbRumInst',l.maal&&l.maal.installation&&l.maal.installation.vaerdi,'','kort'))+'</div>';
    }
    h+='<div class="arb-sek">Analyse og kontrol</div><div class="arb-grid">'+
      ['aktuel:Indgår i analysen','lca:LCA','maengder:Mængder','sigma:Sigma'].map(function(x){ var p=x.split(':'); return felt(p[1],sel('arbAn_'+p[0],[{v:'',t:'– uændret –'},{v:'ja',t:'Ja'},{v:'nej',t:'Nej'}],en&&a[p[0]]!=null?(a[p[0]]?'ja':'nej'):'')); }).join('')+'</div>';
    h+=felt('Begrænsning (dør, gennembrydning, samling …)',inp('arbBegr','','fx gennembrydning for ventilation'));
    h+='<div class="arb-grid">'+felt('Kontrolleret',sel('arbKontrol',[{v:'',t:'– uændret –'},{v:'ja',t:'Ja, i dag'},{v:'nej',t:'Nej'}],''))+felt('Af (initialer)',inp('arbAf',initialer,'','kort'))+'</div>';
    h+='<div class="arb-row"><button class="tbtn primary" id="arbLaeg">Læg i ændringslisten</button></div>';
    el.innerHTML=h;
    el.querySelectorAll('.arb-in').forEach(function(e){ e.setAttribute('data-foer',e.value); });
    el.querySelectorAll('input[type=checkbox]').forEach(function(e){ e.setAttribute('data-foer',String(e.checked)); });
    var valgteTags={};
    el.querySelectorAll('[data-tag]').forEach(function(c){ c.onclick=function(){ var t=c.getAttribute('data-tag');
      var st=valgteTags[t]; valgteTags[t]= st==='til'? 'fra' : st==='fra'? undefined : 'til';
      c.classList.toggle('til',valgteTags[t]==='til'); c.classList.toggle('fra',valgteTags[t]==='fra'); }; });
    $('arbLaeg').onclick=function(){ laegIListen(liste,valgteTags,en); };
    var alle=function(ja){ liste.forEach(function(i){ var fl=forslagListe(i); fl.forEach(function(item){ behandlForslag(i,item,ja); }); }); visFane('aendringer'); };
    if($('arbBekraeftAlle')){ $('arbBekraeftAlle').onclick=function(){ alle(true); }; $('arbAfvisAlle').onclick=function(){ alle(false); }; }
  }
  function egneTags(){ var set={}, r=[]; STANDARD_TAGS.forEach(function(t){ set[tagNorm(t)]=1; }); infos.forEach(function(i){ if(i) i.tags.forEach(function(t){ var k=tagNorm(t.tag); if(!set[k]){ set[k]=1; r.push(t.tag); } }); }); return r.slice(0,30); }
  function vaerdi(id){ var e=$(id); return e? e.value : ''; }
  // Et felt er ændret, når det afviger fra det, formularen viste (data-foer sættes ved visning). Ved flere valgte er
  // felterne tomme fra start, så kun udfyldte felter tæller. Uændrede felter skrives aldrig, heller ikke typens værdier.
  function aendret(id){ var e=$(id); if(!e) return false; return e.type==='checkbox'? String(e.checked)!==e.getAttribute('data-foer') : e.value!==e.getAttribute('data-foer'); }

  function laegIListen(liste,valgteTags,en){
    var paa=vaerdi('arbPaa')||'element', af=vaerdi('arbAf').trim(), n0=antalAendringer();
    if(af!==initialer){ initialer=af; try{ localStorage.setItem('issana-arbejdsrum-af',af); }catch(e){} }
    var til=[], fra=[]; Object.keys(valgteTags).forEach(function(t){ if(valgteTags[t]==='til') til.push(t); else if(valgteTags[t]==='fra') fra.push(t); });
    var nyt=vaerdi('arbNytTag').trim(); if(nyt) splitTags(nyt).forEach(function(t){ til.push(t); });
    var dele=liste.filter(function(i){ return !i.erRum; }), rum=liste.filter(function(i){ return i.erRum; });

    // Tjek tal før noget lægges i listen.
    var tjek=['arbStoej','arbLydV','arbLydCtr','arbMaalV','arbPsi','arbRumInde','arbRumLuft','arbRumTrin','arbRumInst'];
    for(var t=0;t<tjek.length;t++){ var raw=vaerdi(tjek[t]).trim(); if(aendret(tjek[t])&&raw!==''&&tal(raw)==null){ V.fejl('«'+raw+'» er ikke et tal.'); return; } }

    if(til.length||fra.length){ if(dele.length) laegTags(dele,paa,til,fra); if(rum.length) laegTags(rum,'element',til,fra); }
    var st=vaerdi('arbStatus');
    if(st&&aendret('arbStatus')) unikkeMaal(dele,paa).forEach(function(m){ saet(m,m.instans?P.status:P.typeStatus,st==='__ryd'?'':st,'handlingsstatus'); });
    var ru=vaerdi('arbRum');
    if(ru&&aendret('arbRum')) rum.forEach(function(i){ saet(maal(i,'element'),P.rum,ru==='__ryd'?'':ru,'rumanvendelse'); });
    // Rumnavnet: kun når du har skrevet et. Tomt felt ændrer intet (et rum uden navn skal ikke have et skrevet i Revit).
    var nyNavn=vaerdi('arbRumnavn').trim();
    if(en&&en.erRum&&nyNavn&&aendret('arbRumnavn')){ var mN=maal(en,'element'); saet(mN,P.rumnavn,nyNavn,'rumnavn'); var xN=aendringer[mN.uniqueId+'|'+P.rumnavn]; if(xN) xN.egetNavn=true; }

    // Støj udefra: altid på væg-elementet (instans); værdien i parameteren, kilde og metode i dataposten.
    var stoejAendret=['arbStoej','arbStoejSt','arbStoejM','arbStoejK'].some(aendret);
    if(stoejAendret){
      var sv=tal(vaerdi('arbStoej'));
      dele.filter(function(i){ return i.ed.category==='Vægge'; }).forEach(function(i){ var m=maal(i,'element'), rec=dataFor(m);
        if(sv==null){ saet(m,P.stoej,'','støj'); if(rec.stoej){ delete rec.stoej; gemData(m,rec,'støj'); } return; }
        saet(m,P.stoej,String(sv).replace('.',',')+' dB '+vaerdi('arbStoejSt'),'støj');
        rec.stoej={vaerdi:sv,stoerrelse:vaerdi('arbStoejSt'),metode:vaerdi('arbStoejM'),kilde:vaerdi('arbStoejK').trim()||null}; gemData(m,rec,'støj'); });
    }

    var ændr=function(rec,i){
      var r=false, set=function(sti,v){ var o=rec; for(var k=0;k<sti.length-1;k++) o=o[sti[k]]||(o[sti[k]]={}); var sidst=sti[sti.length-1];
        if(v==null){ if(o[sidst]!==undefined){ delete o[sidst]; r=true; } return; }
        if(JSON.stringify(o[sidst])!==JSON.stringify(v)){ o[sidst]=v; r=true; } };
      var tekst=function(id,sti){ if(aendret(id)){ var v=vaerdi(id).trim(); set(sti,v===''?null:v); } };
      var nr=function(id,sti){ if(aendret(id)) set(sti,tal(vaerdi(id))); };
      if(LYD_KAT[i.ed.category]){
        if(['arbLydV','arbLydSt','arbLydM','arbLydCtr'].some(aendret)){
          var lv=tal(vaerdi('arbLydV'));
          set(['lyd','dokumenteret','vaerdi'],lv);
          if(lv!=null){ set(['lyd','dokumenteret','stoerrelse'],vaerdi('arbLydSt')); set(['lyd','dokumenteret','metode'],vaerdi('arbLydM')); set(['lyd','dokumenteret','enhed'],'dB'); }
          set(['lyd','dokumenteret','Ctr'],tal(vaerdi('arbLydCtr')));
        }
        tekst('arbLydK',['lyd','dokumenteret','kilde']); tekst('arbLydF',['lyd','dokumenteret','forudsaetninger']);
        if(['arbMaalV','arbMaalSt'].some(aendret)){
          var mv=tal(vaerdi('arbMaalV')), ms=vaerdi('arbMaalSt');
          set(['lyd','maal','vaerdi'],mv);
          if(mv!=null){ set(['lyd','maal','stoerrelse'],ms); set(['lyd','maal','enhed'],'dB'); set(['lyd','maal','retning'],/^L/.test(ms)?'max':'min'); }
        }
        if(aendret('arbLydIR')) set(['lyd','ikkeRelevant'],$('arbLydIR').checked||null);
        tekst('arbBrandM',['brand','maal','klasse']); tekst('arbBrandD',['brand','dokumenteret','klasse']); tekst('arbBrandK',['brand','dokumenteret','kilde']); tekst('arbBrandR',['brand','regel']);
        if(aendret('arbBrandIR')) set(['brand','ikkeRelevant'],$('arbBrandIR').checked||null);
        nr('arbPsi',['linjetab','psi']); tekst('arbPsiK',['linjetab','kilde']);
      }
      if(i.erRum&&aendret('arbRumNu')){ var nu2=vaerdi('arbRumNu'); set(['rum','nuvaerendeAnvendelse'],nu2===''?null:nu2); }
      if(i.erRum){
        var rumMaal=function(id,del,stoerrelse,retning){ if(!aendret(id)) return; var v=tal(vaerdi(id));
          if(v==null){ set(['lyd','maal',del],null); return; } set(['lyd','maal',del],{stoerrelse:stoerrelse,vaerdi:v,enhed:'dB',retning:retning}); };
        rumMaal('arbRumInde','facade','L_inde','max'); rumMaal('arbRumLuft','luftlyd',"R'w",'min');
        rumMaal('arbRumTrin','trinlyd',"L'nT,w",'max'); rumMaal('arbRumInst','installation','L_p,A','max');
      }
      ['aktuel','lca','maengder','sigma'].forEach(function(k){ if(aendret('arbAn_'+k)){ var v=vaerdi('arbAn_'+k); set(['analyse',k],v===''?null:v==='ja'); } });
      var bg=vaerdi('arbBegr').trim(); if(bg){ (rec.begraensninger||(rec.begraensninger=[])).push({tekst:bg}); r=true; }
      var ko=vaerdi('arbKontrol');
      if(ko==='ja'){ set(['kontrol','kontrolleret'],true); set(['kontrol','dato'],idag()); set(['kontrol','af'],initialer||null); }
      else if(ko==='nej'){ set(['kontrol','kontrolleret'],false); }
      return r;
    };
    var mDele=unikkeMaal(dele,paa), mRum=unikkeMaal(rum,'element');
    mDele.concat(mRum).forEach(function(m){
      var i=liste.filter(function(x){ return maal(x,m.instans?'element':'type').uniqueId===m.uniqueId; })[0];
      var rec=dataFor(m); if(ændr(rec,i)) gemData(m,rec,'data');
    });
    var n=antalAendringer()-n0;
    if(antalAendringer()===n0) V.info('Intet at ændre: udfyld eller ret et felt først.');
    else { V.info((n>0?n+' ':'')+'ændring'+(n===1?'':'er')+' i listen. Se Ændringer, og gem i Revit.'); visFane('aendringer'); }
  }

  /* ---------- Skuffen ---------- */
  var CSS='\
#arbKnap.har{box-shadow:inset 0 0 0 2px var(--warn)}\
#arb{position:absolute;right:10px;top:10px;bottom:10px;width:min(400px,calc(100% - 120px));display:none;flex-direction:column;background:var(--bg-paper);border:1px solid var(--border);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.14);z-index:6;font-size:12.5px;color:var(--text)}\
#arb.aaben{display:flex}#arb.bred{width:min(860px,calc(100% - 120px))}\
#arb .arb-hd{display:flex;align-items:center;gap:4px;padding:8px 8px 0;border-bottom:1px solid var(--border);flex-wrap:wrap}\
#arb .arb-fane{border:0;background:none;color:var(--muted);padding:6px 9px;border-bottom:2px solid transparent;cursor:pointer;font:inherit}\
#arb .arb-fane.on{color:var(--text);border-bottom-color:var(--accent);font-weight:600}\
#arb .arb-luk{margin-left:auto;border:0;background:none;font-size:18px;color:var(--muted);cursor:pointer}\
#arb .arb-bd{flex:1;overflow:auto;padding:10px 12px}\
.arb-tom{color:var(--muted);padding:18px 4px;text-align:center}\
.arb-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0}\
.arb-hint,.arb-note{color:var(--muted);font-size:11.5px;margin:6px 0;line-height:1.4}\
#pBody .arb-note{padding:4px 14px}#pBody .arb-row{padding:4px 14px}\
.arb-tal{font-weight:600;margin-right:auto}\
.arb-lag{border-top:1px solid var(--line-soft);padding:4px 0}.arb-lag summary{cursor:pointer;padding:4px 0;font-weight:600;display:flex;align-items:center;gap:6px}\
.arb-vals{display:flex;flex-direction:column;gap:1px;padding:2px 0 4px 22px}\
.arb-val{display:flex;align-items:center;gap:6px;cursor:pointer}.arb-val .sw{width:10px;height:10px;border-radius:3px;display:inline-block}\
.arb-n{color:var(--muted);font-size:11px}.arb-pille{background:var(--accent);color:var(--accent-ink);border-radius:9px;padding:0 6px;font-size:10.5px}\
.arb-chk{display:inline-flex;align-items:center;gap:5px;margin-right:10px;cursor:pointer}\
.arb-kilde{color:var(--muted);font-size:10.5px;border:1px solid var(--border);border-radius:5px;padding:0 4px;margin-left:3px}\
.arb-status{display:inline-block;border-left:4px solid var(--c);padding:0 6px;background:var(--bg-elev);border-radius:3px}\
.arb-mini{padding:0 6px!important;height:20px!important;font-size:11px!important;margin-left:4px}\
.arb-sek{font-weight:700;color:var(--accent);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;margin:12px 0 4px}\
.arb-felt{display:flex;flex-direction:column;gap:2px;margin:4px 0}.arb-felt span{color:var(--muted);font-size:11px}\
.arb-in{font:inherit;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);min-width:0}\
.arb-in.kort{width:80px}.arb-grid{display:flex;gap:8px;flex-wrap:wrap}.arb-grid .arb-felt{flex:1;min-width:90px}\
.arb-chips{display:flex;flex-wrap:wrap;gap:4px}\
.arb-chip{border:1px solid var(--border);background:var(--bg);border-radius:12px;padding:2px 9px;cursor:pointer;font:inherit;color:var(--text)}\
.arb-chip.on{background:var(--ok-bg)}.arb-chip.delvis{background:linear-gradient(90deg,var(--ok-bg) 50%,var(--bg) 50%)}\
.arb-chip.til{outline:2px solid var(--ok)}.arb-chip.fra{outline:2px solid var(--red);text-decoration:line-through}\
.arb-aendr{border:1px solid var(--border);border-radius:8px;padding:6px 8px;margin:5px 0}\
.arb-aendr-h{display:flex;align-items:center;gap:4px}.arb-aendr-v{color:var(--muted);margin-top:2px;word-break:break-word}\
.arb-x{margin-left:auto;border:0;background:none;cursor:pointer;color:var(--muted);font-size:15px}\
#arbAi{position:absolute;left:96px;right:10px;bottom:10px;z-index:5;display:none;gap:6px;align-items:center}\
#arbAi.vis{display:flex}#arb.aaben~#arbAi{right:calc(min(400px,100% - 120px) + 20px)}#arb.aaben.bred~#arbAi{right:calc(min(860px,100% - 120px) + 20px)}\
#arbAi input{flex:1;font:inherit;padding:7px 10px;border:1px solid var(--border);border-radius:18px;background:var(--chip-bg);color:var(--text);backdrop-filter:blur(4px)}\
#arbAiSvar{position:absolute;left:96px;bottom:52px;max-width:min(560px,60%);max-height:50%;overflow:auto;z-index:7;display:none;background:var(--bg-paper);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:12.5px;box-shadow:0 6px 20px rgba(0,0,0,.12)}\
#arbAiSvar.vis{display:block}\
.arb-tab{border-collapse:collapse;width:100%;font-size:12px}.arb-tab th{text-align:left;color:var(--muted);font-weight:600;padding:4px 6px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg-paper)}\
.arb-tab td{padding:4px 6px;border-bottom:1px solid var(--line-soft);vertical-align:top}.arb-tab tr[data-rum]{cursor:pointer}.arb-tab tr.on td{background:var(--ok-bg)}\
';
  function byggSkuffe(){
    var st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);
    var view=$('view');
    var s=document.createElement('aside'); s.id='arb'; s.setAttribute('aria-label','Arbejdsrum');
    s.innerHTML='<div class="arb-hd" id="arbHd"></div><div class="arb-bd" id="arbBd"></div>';
    view.appendChild(s);
    // Knap i værktøjs-railen
    var rail=$('rail');
    if(rail){
      var k=document.createElement('button'); k.className='rknap'; k.id='arbKnap'; k.title='Arbejdsrum: lag og filtre, bygningsdata, graf, lyd, sol og produkter';
      k.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h6"/><circle cx="18" cy="15" r="3"/><path d="m20.2 17.2 1.8 1.8"/></svg>';
      k.onclick=function(){ skuffeAaben? lukSkuffe() : aabenSkuffe(aktivFane); };
      var spacer=rail.querySelector('.rspacer'); rail.insertBefore(k,spacer||null);
    }
    var ai=document.createElement('div'); ai.id='arbAi';
    ai.innerHTML='<input id="arbAiTekst" placeholder="Skriv til ISSANA, fx «alle ydervægge på 1. sal skal have tagget bærende» eller «vis vægge uden branddata»" autocomplete="off"><button class="tbtn primary" id="arbAiSend">Send</button>';
    view.appendChild(ai);
    var sv=document.createElement('div'); sv.id='arbAiSvar'; view.appendChild(sv);
    $('arbAiSend').onclick=function(){ A.ai&&A.ai($('arbAiTekst').value); };
    $('arbAiTekst').addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); A.ai&&A.ai(e.target.value); } if(e.key==='Escape'){ $('arbAiSvar').classList.remove('vis'); } e.stopPropagation(); });
    if(A.aiMonter) try{ A.aiMonter(); }catch(e){ console.error(e); }   // arbejdsrum-ai.js: vælgeren for forbindelse, model og intensitet
    s.addEventListener('keydown',function(e){ e.stopPropagation(); });   // visningens genvejstaster (F, I, M …) må ikke fange tastning i felterne
  }
  function renderHoved(){
    var hd=$('arbHd'); if(!hd) return;
    hd.innerHTML=faner.map(function(f){ return '<button class="arb-fane'+(f.id===aktivFane?' on':'')+'" id="arbFane'+f.id+'" data-fane="'+f.id+'">'+esc(f.titel)+'</button>'; }).join('')+
      '<button class="arb-luk" id="arbLuk" title="Luk">×</button>';
    hd.querySelectorAll('[data-fane]').forEach(function(b){ b.onclick=function(){ visFane(b.getAttribute('data-fane')); }; });
    $('arbLuk').onclick=lukSkuffe; opdaterAendringTal();
  }
  function fane(id){ for(var i=0;i<faner.length;i++) if(faner[i].id===id) return faner[i]; return null; }
  function renderFane(){ if(!skuffeAaben) return; var f=fane(aktivFane)||faner[0]; var bd=$('arbBd'); if(!f||!bd) return;
    $('arb').classList.toggle('bred',!!f.bred); try{ f.render(bd); }catch(e){ bd.innerHTML='<div class="arb-tom">Fejl: '+esc(e.message)+'</div>'; console.error(e); } }
  function visFane(id){ aktivFane=id; if(!skuffeAaben){ aabenSkuffe(id); return; } renderHoved(); renderFane(); }
  function aabenSkuffe(id){ if(id) aktivFane=id; skuffeAaben=true; $('arb').classList.add('aaben'); var k=$('arbKnap'); if(k) k.classList.add('on'); renderHoved(); renderFane(); udsend('skuffe',true,aktivFane); }
  function lukSkuffe(){ skuffeAaben=false; $('arb').classList.remove('aaben','bred'); var k=$('arbKnap'); if(k) k.classList.remove('on'); udsend('skuffe',false,aktivFane); }

  /* ---------- Rummene som elementer ---------- */
  function forIndlaes(data){
    if(!data||!Array.isArray(data.rooms)||!Array.isArray(data.elements)||data.__rumIndlagt) return;
    data.materials=data.materials||[];
    var mi=data.materials.length; data.materials.push({name:'Rum (volumen)',color:'#6fa8c9',transparency:0.8});
    data.rooms.forEach(function(r){
      var bd=r.bygdata||(r.bygdata={}); bd.raw=bd.raw||{}; if(bd.raw[P.rumnavn]==null) bd.raw[P.rumnavn]=r.name||'';
      data.elements.push({id:r.id,uniqueId:r.uniqueId,category:'Rum',builtInCategory:'OST_Rooms',
        type:(r.bygdata&&r.bygdata.roomUse)||'Rum uden anvendelse',name:((r.number?r.number+' ':'')+(r.name||'')).trim(),
        level:r.level,area:r.area,volume:r.volume,faseOprettet:r.faseOprettet,bygdata:r.bygdata,graenser:r.graenser||[],erRum:true,
        meshes:(r.meshes||[]).map(function(m){ return {pos:m.pos,idx:m.idx,mat:mi}; })});
    });
    data.__rumIndlagt=true;
  }
  function vedModel(){ aendringer={}; filterValg={}; opdaterAlt(); anvendFilter(); $('arbAi').classList.add('vis'); renderHoved(); renderFane(); faner.forEach(function(f){ if(f.model) try{ f.model(V.data()); }catch(e){ console.error(e); } }); }

  /* ---------- Offentlig flade til fanerne (graf, lyd, sol, produkter, AI) ---------- */
  var A=window.IssanaArbejdsrum={
    P:P, SCHEMA:SCHEMA, HANDLING:HANDLING, UNSET:UNSET, STATUS_TEKST:STATUS_TEKST, STATUS_FARVE:STATUS_FARVE, HANDLING_FARVE:HANDLING_FARVE,
    RUMANVENDELSER:RUMANVENDELSER, ANSVAR:ANSVAR, infos:infos, byRevitId:byRevitId,
    V:function(){ return V; },
    fane:function(def){ faner.push(def); if(V) renderHoved(); },
    visFane:visFane, aabenSkuffe:aabenSkuffe, renderFane:renderFane,
    maal:maal, saet:saet, tilfoej:tilfoej, dataFor:dataFor, gemData:gemData, laegTags:laegTags, nu:nu,
    forslagListe:forslagListe, behandlForslag:behandlForslag, P_CCI:P_CCI,
    passer:passer, synlige:synlige, opdater:function(){ opdaterAlt(); anvendFilter(); },
    handlingTekst:handlingTekst, esc:esc, fmt:fmt, tal:tal, flet:flet, parseData:parseData, splitTags:splitTags, tagNorm:tagNorm,
    erFacade:erFacade, renoveringsprojekt:function(){ return _renovering; }, modelNoegle:modelNoegle,
    filterValg:function(){ return filterValg; },
    // En fane kan tilføje sit eget lag (fx lydresultat pr. rum); samme id erstatter det gamle.
    tilfoejLag:function(def){ for(var i=0;i<LAG.length;i++) if(LAG[i].id===def.id){ LAG[i]=def; return; } LAG.push(def); },
    downloadCsv:function(navn,rows){ var csv='﻿'+rows.map(function(r){ return r.map(function(c){ c=c==null?'':String(c); return /[;"\n]/.test(c)? '"'+c.replace(/"/g,'""')+'"' : c; }).join(';'); }).join('\r\n');
      var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); a.download=navn; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },500); },
    saetFilter:function(fv,farve){ filterValg=fv||{}; if(farve!==undefined) farveLag=farve; anvendFilter(); if(aktivFane==='lag') renderFane(); },
    // 3.0: hændelser og læseadgang til ændringslisten (layoutets statuslinje og registrerings-API)
    paa:function(navn,fn){ (lyttere[navn]||(lyttere[navn]=[])).push(fn); },
    antalAendringer:antalAendringer,
    aendringer:function(){ return Object.keys(aendringer).map(function(k){ var x=aendringer[k]; return {noegle:k,uniqueId:x.uniqueId,param:x.param,fra:x.fra,til:x.til,navn:x.navn,instans:x.instans,kraeverOpsaetning:x.kraeverOpsaetning,hvad:x.hvad.slice(),af:x.af||null}; }); },
    lukSkuffe:lukSkuffe, aktivFane:function(){ return aktivFane; }, skuffeAaben:function(){ return skuffeAaben; }, faner:function(){ return faner.map(function(f){ return {id:f.id,titel:f.titel,bred:!!f.bred}; }); }
  };

  function start(api){
    V=api;
    faner.unshift({id:'lag',titel:'Lag',render:renderLag},{id:'data',titel:'Data',render:renderData},{id:'aendringer',titel:'Ændringer',render:renderAendringer});
    byggSkuffe();
    V.paa('forIndlaes',forIndlaes);
    V.paa('model',vedModel);
    V.paa('props',propsHtml);
    V.paa('propsVist',propsVist);
    V.paa('valg',function(){ if(skuffeAaben&&(aktivFane==='data'||(fane(aktivFane)||{}).valg)) renderFane(); });
    if(window.issanaBro&&window.issanaBro.paa) window.issanaBro.paa('approval_pending',function(p){ V.info('Godkend ændringen i ISSANA-panelet i Revit ('+((p&&p.command)||'')+').'); });
    if(V.data()) vedModel();
  }
  if(window.IssanaVisning) start(window.IssanaVisning); else window.issanaVisningKlar=start;
})();
