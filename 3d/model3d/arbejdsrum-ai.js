/* ISSANA 3D, arbejdsrummet: AI-feltet nederst i 3D.
   To veje:
   1) Faste danske sætninger forstås lokalt uden netværk (regex), fx «alle ydervægge på 1. sal skal have tagget bærende»,
      «ydervæggene på stueetagen skal renoveres», «støj 68 dB på facaderne mod vejen», «vis vægge uden branddata» og «alle
      ydervægge på 1. sal skal være typen «Let facade 300»». Fortolkningen vises som et forslag med elementerne markeret i 3D.
   2) Alt andet går til den valgte AI gennem pluginet (issana_ai_foreslaa, plugin/Core/Model3d/Model3dAi.cs): prompten og de
      tilladte handlinger står i ai-regler.json (én læsbar fil). Svaret er forslag (tag, handlingsstatus, konstruktiv funktion,
      CCI-kode på typen, rumanvendelse) eller vis/isolér. Forslag lægges i dataposten som «foreslået af AI» (status proposed)
      og bliver først værdier, når du bekræfter dem (Forhåndsvis → Godkend → «Gem i Revit»). AI'en skriver aldrig selv i Revit.
   Knappen ved feltet («Claude Sonnet 5.5 · Mellem») åbner en række INDE i feltet med Forbindelse (Claude-abonnement via
   Claude Code, API-nøgle, Ollama, Codex), Model og Intensitet; valget gemmes i de samme indstillinger som Indstillinger →
   AI-forbindelse (issana_ai_indstillinger). Uden for Revit kan kommandoen stadig kopieres til Claude.
   Layout-sporet leverer window.issanaArbejdsrum.api (valgte, vaelg, isoler, model, aendringsliste.tilfoej); findes det ikke,
   bruges dagens IssanaVisning-kald. Layoutets api regner i elementindekser (som IssanaVisning); AI'en og pluginet taler i
   Revit-id'er, så der oversættes her (A.byRevitId / A.infos). */
(function(){
  "use strict";
  var A=window.IssanaArbejdsrum; if(!A) return;
  var esc=A.esc;
  var STATUS_ORD=[
    [/bevares|bevar(e)? uændret/,'retain_unchanged'],[/vedligehold/,'maintain'],[/repar/,'repair'],[/renover/,'renovate'],
    [/genopbyg/,'rebuild'],[/demonter/,'dismantle_for_reuse'],[/rives? ned|nedriv/,'demolish'],[/udskift/,'replace'],
    [/(er|bliver) nye?\b|nyt element|nybyg/,'new_element'],[/eksisterende,? ikke vurderet|ikke vurderet/,'existing_not_assessed']];

  function lav(s){ return String(s||'').toLowerCase().replace(/\s+/g,' ').trim(); }
  function niveauer(){ var set={}; A.infos.forEach(function(i){ if(i&&i.ed.level) set[i.ed.level]=1; }); return Object.keys(set); }
  function findNiveau(s){
    var lv=niveauer(), hit=null;
    lv.forEach(function(l){ var n=lav(l).replace(/^\(\d+\)\s*/,''); if(n&&s.indexOf(n)>=0&&(!hit||n.length>hit.n.length)) hit={l:l,n:n}; });
    if(hit) return hit.l;
    var m=/(\d+)\.?\s*(sal|etage)/.exec(s);
    if(m){ var re=new RegExp('(^|[^0-9])'+m[1]+'\\.?\\s*(sal|etage)'); for(var i=0;i<lv.length;i++) if(re.test(lav(lv[i]))) return lv[i]; }
    var ord=[['stue','stue'],['kælder','kælder'],['tagetage','tag']];
    for(var j=0;j<ord.length;j++) if(s.indexOf(ord[j][0])>=0) for(var k=0;k<lv.length;k++) if(lav(lv[k]).indexOf(ord[j][1])>=0) return lv[k];
    return null;
  }
  function citat(t){ var m=/[«"“']([^»"”']{2,})[»"”']/.exec(t); return m? m[1].trim() : null; }

  function fortolk(tekst){
    var s=lav(tekst), r={tekst:tekst,kat:null,ydre:null,niveau:null,typeFra:null,handling:null};
    if(/ydervæg|facadevæg|facader?n?e?\b/.test(s)){ r.kat='Vægge'; r.ydre=true; }
    else if(/indervæg|skillevæg/.test(s)){ r.kat='Vægge'; r.ydre=false; }
    else if(/væg/.test(s)) r.kat='Vægge';
    else if(/etageadskillelse|dæk|gulv/.test(s)) r.kat='Gulve';
    else if(/\btage(ne)?\b|tagflade/.test(s)) r.kat='Tage';
    else if(/vindue/.test(s)) r.kat='Vinduer';
    else if(/\bdør/.test(s)) r.kat='Døre';
    else if(/\brum(mene|met)?\b/.test(s)) r.kat='Rum';
    r.niveau=findNiveau(s);
    // «Analyser»: analysen af modellen (placering, randbetingelser), ikke et spørgsmål til AI'en. Hvilken analyse afgøres af ordene eller fanen.
    if(/^\s*(kør |lav |start )?(en |den )?analys(e|er|ér)\b|analys(e|er|ér).*(varmetab|placering|u-?værdi|bygningsdel|model)|(varmetab|u-?værdi).*analys/.test(s)){ r.handling={type:'analyse',hvad:/\blyd/.test(s)?'lyd':/varme|u-?værdi|placering|temperatur/.test(s)?'varmetab':null}; return r; }
    r.kunValgte=/\bvalgte\b/.test(s);
    var tf=/af typen\s+[«"“']([^»"”']+)[»"”']/.exec(tekst); if(tf) r.typeFra=tf[1].trim();

    var skift=/(skal være|skal ændres til|ændres til|skiftes? til|udskiftes? (med|til))\s+(en |et |typen |til typen )?(.+)$/i.exec(tekst);
    var navn=skift? (citat(skift[4])||skift[4].replace(/[.!]$/,'').trim()) : null;
    var maalType=navn? findType(r.kat,navn) : null;
    if(skift&&(maalType||citat(skift[4]))){ r.handling={type:'skiftType',navn:navn,maalType:maalType}; return r; }

    var db=/(\d+(?:[.,]\d+)?)\s*db/.exec(s);
    if(db&&/støj/.test(s)){ r.kat=r.kat||'Vægge'; r.ydre=true; r.handling={type:'stoej',vaerdi:Number(db[1].replace(',','.')),stoerrelse:/laeq/.test(s)?'LAeq,24h':'Lden'}; return r; }
    if(r.kat==='Rum'){ for(var i=0;i<A.RUMANVENDELSER.length;i++){ var a=A.RUMANVENDELSER[i]; if(s.indexOf(a.split('/')[0])>=0&&/anvendelse|er |som |skal være/.test(s)){ r.handling={type:'rum',vaerdi:a}; return r; } } }
    if((r.kat||r.kunValgte) && /liste|oversigt|oplysninger|informationer/.test(s) && !/\b(sæt|saet|udfyld|tildel)\b/.test(s)){ r.handling={type:'oversigt'}; return r; }
    if(/\b(vis|vise|vises|find|isolér|isolere?|hvilke|hvor er)\b/.test(s)){ r.handling={type:'vis',isoler:/isol[eé]r|\bkun\b/.test(s)||!!(r.kat&&/\bvis(?:e|es)?\b/.test(s)),uden:/uden branddata|mangler brand/.test(s)?'brand':/uden lyddata|mangler lyd/.test(s)?'lyd':/mangler|uden data/.test(s)?'data':null,
      tag:/bærende/.test(s)&&!/ikke-bærende|ikke bærende/.test(s)?'bærende':/stabiliserende/.test(s)?'stabiliserende':null}; return r; }
    var tagM=/\b(tag(?:get)?|marker(?:es)? som|mærk(?:es)? som)\s+[«"“']?([a-zæøå\- ]{3,40}?)[»"”']?\s*$/i.exec(tekst);
    var kendt=['ikke-bærende','ikke bærende','bærende','stabiliserende','brandvæg','facade','skillevæg','etageadskillelse'].filter(function(t){ return s.indexOf(t)>=0; })[0];
    if(tagM||(kendt&&/\b(er|skal være|tag|marker)\b/.test(s))){ var tg=(tagM? tagM[2] : kendt).trim(); if(tg==='ikke bærende') tg='ikke-bærende'; r.handling={type:'tag',vaerdi:tg}; return r; }
    for(var j=0;j<STATUS_ORD.length;j++) if(STATUS_ORD[j][0].test(s)){ r.handling={type:'status',vaerdi:STATUS_ORD[j][1]}; return r; }
    return r;
  }
  function findType(kat,navn){
    var t=A.V().typer(), n=lav(navn), bedst=null;
    Object.keys(t).forEach(function(k){ var x=t[k], tn=lav(x.name);
      if(!tn) return; if(kat&&kat!=='Rum'&&x.category&&lav(x.category).indexOf(lav(kat).slice(0,4))<0&&!(kat==='Vægge'&&/wall|væg/i.test(x.category))&&!(kat==='Gulve'&&/floor|gulv|etage/i.test(x.category))) return;
      if(tn===n) bedst={t:x,s:3}; else if(!bedst||bedst.s<2){ if(tn.indexOf(n)>=0||n.indexOf(tn)>=0) bedst={t:x,s:2}; } });
    return bedst? bedst.t : null;
  }

  function findElementer(r){
    return A.infos.filter(function(i){
      if(!i) return false;
      if(r.kunValgte&&!valgteInfos().some(function(v){return v.idx===i.idx;}))return false;
      if(r.kat&&i.ed.category!==r.kat) return false;
      if(!r.kat&&i.erRum) return false;
      if(r.ydre===true&&!A.erFacade(i)) return false;
      if(r.ydre===false&&vaegPlacering(i)!=='indre') return false;
      if(r.niveau&&i.ed.level!==r.niveau) return false;
      if(r.typeFra&&lav(i.ed.type).indexOf(lav(r.typeFra))<0) return false;
      var h=r.handling;
      if(h&&h.type==='vis'){
        if(h.uden==='brand'&&i.brand.status!=='needs_input') return false;
        if(h.uden==='lyd'&&i.lyd.status!=='needs_input') return false;
        if(h.uden==='data'&&!i.mangler.length) return false;
        if(h.tag&&!i.tagSet[h.tag]) return false;
      }
      return true;
    }).map(function(i){ return i.idx; });
  }

  function vaegPlacering(i){
    var r=i.revit||i.ed.revit||{},t=i.tagSet||{};
    var outer=!!A.erFacade(i)||r.funktion==='Exterior',inner=r.funktion==='Interior'||!!t['skillevæg']||!!t['indervæg'];
    return outer===!!inner?null:outer?'ydre':'indre';
  }

  function beskriv(r,n){
    var hvad=(r.kat? ({'Vægge':r.ydre===true?'ydervægge':r.ydre===false?'indervægge':'vægge','Gulve':'dæk/gulve','Tage':'tage','Vinduer':'vinduer','Døre':'døre','Rum':'rum'}[r.kat]) : 'elementer');
    return n+' '+hvad+(r.niveau?' på '+r.niveau:'')+(r.typeFra?' af typen «'+r.typeFra+'»':'');
  }

  function $(id){ return document.getElementById(id); }
  function svar(html){ var b=$('arbAiSvar'); b.innerHTML=html+'<button class="arb-x" id="arbAiLuk" title="Luk" style="position:absolute;right:6px;top:4px">×</button>'; b.classList.add('vis'); $('arbAiLuk').onclick=lukSvar; if(A.aiSvarVis) A.aiSvarVis(); return b; }
  function lukSvar(){ var b=$('arbAiSvar'); if(b) b.classList.remove('vis'); if(A.aiSvarLuk) A.aiSvarLuk(); }

  // Oplysninger fra udtrækket, ikke tal gættet af modellen. 0 er en værdi; null/tom er en mangel.
  function modelOplysninger(i){
    var e=i.ed||{},d=i.data||{},s=e.suite||{};
    return {id:e.id,type:e.type||e.name||'',etage:e.level||'',cci:i.cci||'',uValue:e.uValue,rw:s.rw,areal:e.area,revit:i.revit||e.revit||null,vaegPlacering:e.category==='Vægge'?vaegPlacering(i):null,
      lyd:d.lyd||null,brand:d.brand||null,lca:d.lca||null,produkt:d.produkt||null,mangler:(i.mangler||[]).slice()};
  }
  function oversigtHtml(idx){
    var h='<b>'+idx.length+' elementer · oplysninger fra det hentede modeludtræk</b><p class="arb-hint">Mangler betyder, at oplysningen ikke findes i udtrækket. Åbn Rediger data for at udfylde registreringer, eller Alle hentede parametre for at se flere felter.</p><label><input type="checkbox" id="aiKunMangler"> Kun elementer med mangler</label><div class="ai-model-liste" id="aiModelListe">';
    idx.forEach(function(n){var i=A.infos[n];if(!i)return;var e=i.ed,o=modelOplysninger(i),missing=0;
      function row(k,v,unit){var empty=v==null||v===''||(typeof v==='object'&&!Object.keys(v).length);if(empty)missing++;return '<dt>'+esc(k)+'</dt><dd'+(empty?' class="ai-mangler"':'')+'>'+(empty?'Mangler':esc(typeof v==='object'?JSON.stringify(v):v)+(unit?' '+esc(unit):''))+'</dd>';}
      var fields=row('CCI',o.cci)+row('U-værdi',o.uValue,'W/m²K')+row('Rw (koblet data)',o.rw,'dB')+row('Lyddata',o.lyd)+row('Branddata',o.brand)+row('LCA-data',o.lca)+row('Produkt',o.produkt);
      var params=Array.isArray(e.allParams)?e.allParams.map(function(p){return {navn:p.n,vaerdi:p.v};}):Object.keys(e.params||{}).map(function(k){return {navn:k,vaerdi:e.params[k]};});
      h+='<article class="ai-model-post" data-mangler="'+missing+'"><h3>'+esc(o.type)+' · ID '+esc(e.id)+'</h3><div class="arb-n">'+esc(o.etage)+(o.areal!=null?' · '+esc(o.areal)+' m²':'')+' · '+missing+' mangler i oversigten</div><dl>'+fields+'</dl><button class="tbtn" data-ai-edit="'+esc(e.id)+'">Rediger data</button> <button class="tbtn" data-ai-focus="'+esc(e.id)+'">Isolér dette element</button><details><summary>Alle hentede parametre ('+params.length+')</summary><table>'+params.map(function(p){return '<tr><td>'+esc(p.navn)+'</td><td>'+esc(p.vaerdi==null?'Mangler':p.vaerdi)+'</td></tr>';}).join('')+'</table></details></article>';
    });return h+'</div>';
  }
  function visOversigt(idx){
    var b=svar(oversigtHtml(idx)), filter=$('aiKunMangler'),list=$('aiModelListe');
    if(filter&&list)filter.onchange=function(){list.classList.toggle('ai-model-kun-mangler',filter.checked);};
    b.querySelectorAll('[data-ai-edit],[data-ai-focus]').forEach(function(btn){btn.onclick=function(){var id=btn.getAttribute('data-ai-edit')||btn.getAttribute('data-ai-focus'),i=idxAfId(id);if(i==null)return;
      A.V().vaelgFlere([i]);
      if(btn.hasAttribute('data-ai-focus')){isolerIds([A.infos[i].ed.id]);return;}
      var a=api();if(a&&a.aabenSkuffe)a.aabenSkuffe('data');else A.aabenSkuffe('data');
    };});
  }

  /* ---------- Uden for Revit: kopiér til Claude ---------- */
  function hjaelp(tekst,hvorfor){
    var b=svar('<b>'+esc(hvorfor||'Det forstod jeg ikke helt.')+'</b><div class="arb-hint">Faste sætninger, der virker uden AI:<br>«alle ydervægge på 1. sal skal have tagget bærende»<br>«ydervæggene på stueetagen skal renoveres»<br>'+
      '«støj 68 dB på facaderne»<br>«vis vægge uden branddata»<br>«alle ydervægge på 1. sal skal være typen «Let facade 300»»<br>«rum 1.01 er ophold» (vælg rummene først)</div>'+
      '<div class="arb-hint">Alt andet sendes til den valgte AI, når siden kører i Revit. Her kan du i stedet spørge Claude: Claude Desktop og Claude Code har ISSANA MCP og kan læse og ændre modellen med samme kontrol.</div>'+
      '<div class="arb-row"><button class="tbtn" id="arbAiKopier">Kopiér til Claude</button></div>');
    $('arbAiKopier').onclick=function(){
      var d=modelData(), valgte=valgteInfos().map(function(i){ return i.ed.id; });
      var prompt='I Revit-modellen «'+(d.model||'')+'»: '+tekst+(valgte.length?'\nValgte element-id\'er i ISSANA 3D: '+valgte.slice(0,200).join(', '):'')+'\nBrug ISSANA MCP. Vis mig først, hvad du vil ændre.';
      try{ navigator.clipboard.writeText(prompt).then(function(){ A.V().info('Kopieret. Indsæt det i Claude.'); },function(){ A.V().fejl('Kunne ikke kopiere.'); }); }catch(e){ A.V().fejl('Kunne ikke kopiere.'); }
    };
    b.dataset.sidst=tekst;
  }

  /* ---------- Layout-sporets API (window.issanaArbejdsrum.api) med fald tilbage til IssanaVisning ---------- */
  function api(){ var w=window.issanaArbejdsrum; return (w&&w.api&&typeof w.api==='object')? w.api : null; }
  // Revit-id → indeks/info. Rum ligger under 'rum:'+id i arbejdsrum.js (så AI'ens rumforslag også finder rummene).
  function idxAfId(id){ var i=A.byRevitId[id]; if(i==null) i=A.byRevitId['rum:'+id]; return i==null? null : i; }
  function infoAfId(id){ var i=idxAfId(id); return i==null? null : A.infos[i]||null; }
  function idxAf(ids){ return (ids||[]).map(idxAfId).filter(function(i){ return i!=null; }); }
  function valgteInfos(){
    var a=api();
    var idx=(a&&typeof a.valgte==='function')? (a.valgte()||[]) : A.V().valgte();   // elementindekser i begge tilfælde
    return idx.map(function(i){ return A.infos[i]; }).filter(Boolean);
  }
  function vaelgIds(ids){ var a=api(); if(a&&typeof a.vaelg==='function') return a.vaelg(idxAf(ids)); A.V().vaelgFlere(idxAf(ids)); }
  function isolerIds(ids){ var a=api(); if(a&&typeof a.isoler==='function') return a.isoler(idxAf(ids)); A.V().isoler(new Set(idxAf(ids))); A.V().fokus(); }
  function modelData(){ var a=api(); if(a&&typeof a.model==='function') return a.model()||{}; return A.V().data()||{}; }
  // Én ændring i ændringslisten: layout-sporets liste får det samme objekt, som arbejdsrum.js bruger; ellers A.saet.
  // af: afsenderen i listen («AI», eller brugeren for LCA-tabellens knapper).
  function tilfoejAendring(m,param,vaerdi,hvad,af){
    af=af||'AI';
    var a=api();
    if(a&&a.aendringsliste&&typeof a.aendringsliste.tilfoej==='function'){
      var raw=m.obj.bygdata&&m.obj.bygdata.raw? m.obj.bygdata.raw[param] : undefined;
      a.aendringsliste.tilfoej({uniqueId:m.uniqueId,param:param,fra:raw==null?'':raw,til:vaerdi,navn:m.navn,obj:m.obj,instans:m.instans,kraeverOpsaetning:raw==null,hvad:[hvad],af:af});
      return;
    }
    A.saet(m,param,vaerdi,hvad,af);
  }
  function gemDataAi(m,rec,hvad){
    rec.schema=A.SCHEMA;
    (rec.historik||(rec.historik=[])).push({tid:new Date().toISOString(),felt:hvad,af:'AI'});
    if(rec.historik.length>50) rec.historik=rec.historik.slice(-50);
    tilfoejAendring(m,m.instans?A.P.data:A.P.typeData,JSON.stringify(rec),hvad);
  }

  /* ---------- Rigtig AI: ruting, kontekst, forslag ---------- */
  var HANDLING_TEKST={saet_tag:'tag',saet_handlingsstatus:'handlingsstatus',saet_konstruktiv:'konstruktiv funktion',saet_cci:'CCI-kode (på typen)',saet_rumbrug:'rumanvendelse',vis:'markér i 3D',isoler:'isolér i 3D',svar:'svar',
    saet_stoej:'støj udefra',saet_data:'datapost',saet_produkt:'produkt (på typen)',saet_lca:'CO₂ pr. m² (på typen)',saet_epd:'EPD pr. byggevare',saet_bygningstype:'bygningstype (Lyd)',lca_status:'LCA-status',lca_struktur:'LCAbyg-struktur',lca_beregn:'LCA-beregning (ISSANA LCA)',foreslaa_produkt:'CO₂-kandidater'};
  // 3.0: de nye felter (saet_stoej → stoej, saet_data/saet_produkt → data, saet_lca → lca, saet_epd → epd) behandles i laegForslagNy/behandlForslag.
  var FELT_AF={saet_tag:'tags',saet_handlingsstatus:'handlingsstatus',saet_konstruktiv:'konstruktiv',saet_cci:'cci',saet_rumbrug:'rumanvendelse',saet_stoej:'stoej',saet_data:'data',saet_produkt:'data',saet_lca:'lca',saet_epd:'epd'};
  var KALD_TIMEOUT_MS=150000;   // ai-regler.json: timeoutSekunder 120 + margen til broen
  // «Min AI-app»: pluginet venter 15 min + 30 s (Model3dAi.QueueTimeoutSeconds, sendt som ventetidSekunder); broen får lidt mere.
  var KOE_TIMEOUT_MS=16*60000;
  function ventetid(t){ return t&&t.koe? Math.max(KOE_TIMEOUT_MS,((+t.ventetidSekunder||0)+30)*1000) : KALD_TIMEOUT_MS; }

  // 'fast' = en fast sætning (ingen netværk); 'ai' = alt andet (til issana_ai_foreslaa, kun i Revit).
  function ruting(tekst){ return fortolk(tekst).handling? 'fast' : 'ai'; }

  // Det, AI'en får at se: de valgte elementer (ellers de synlige), etagerne og de typer, der er i brug blandt dem.
  function kontekst(liste,ekstra){
    var udvalg='valgte';
    if(!liste){ liste=valgteInfos(); if(!liste.length){ udvalg='synlige'; liste=(A.synlige? A.synlige() : []).map(function(i){ return A.infos[i]; }).filter(Boolean); } }
    var typer={};
    var valgte=liste.map(function(i){
      if(i.type&&i.type.id!=null&&!typer[i.type.id]) typer[i.type.id]={id:i.type.id,navn:i.type.name||'',kategori:i.type.category||i.ed.category,cci:(i.type.issana&&i.type.issana.cciCode)||''};
      return {id:i.ed.id,typeId:i.type&&i.type.id!=null? i.type.id : null,type:i.ed.type||i.ed.name||'',kategori:i.ed.category,niveau:i.ed.level||null,
        cci:i.cci||'',tags:i.tags.map(function(t){ return t.tag; }),konstruktiv:(i.revit&&i.revit.konstruktiv)||null,
        status:i.status&&i.status!==A.UNSET? i.status : null,rumanvendelse:i.rumanvendelse||null,oplysninger:modelOplysninger(i)};
    });
    var d=modelData();
    return kontekstTillaeg({valgte:valgte,etager:niveauer(),typer:Object.keys(typer).map(function(k){ return typer[k]; }),udvalg:udvalg,model:d.model||''},ekstra);
  }

  // Sidens egen kontrol af svaret (pluginet gør det samme): kun kendte handlinger og id'er fra konteksten overlever.
  function valider(res,k){
    var ids={}, rum={}, typeIds={}, typeAfElement={};
    (k&&k.valgte||[]).forEach(function(e){ ids[e.id]=1; if(e.kategori==='Rum') rum[e.id]=1; if(e.typeId!=null){ typeIds[e.typeId]=1; typeAfElement[e.id]=e.typeId; } });
    (k&&k.typer||[]).forEach(function(t){ typeIds[t.id]=1; });
    var ud=[], afvist=[].concat(res&&res.afvist||[]);
    (res&&res.forslag||[]).forEach(function(f){
      if(!f||!HANDLING_TEKST[f.handling]){ afvist.push({handling:f&&f.handling||'',grund:'ukendt handling'}); return; }
      if(f.handling==='svar') return;
      if(validerNy(f,k,ud,afvist,typeIds,typeAfElement,ids)) return;   // 3.0: nye handlinger og 'maal'
      var g={handling:f.handling,vaerdi:f.vaerdi,begrundelse:f.begrundelse||''};
      if(f.handling==='saet_cci'){
        var t=[]; (f.typeIds||[]).forEach(function(x){ if(typeIds[x]&&t.indexOf(x)<0) t.push(x); });
        (f.elementIds||[]).forEach(function(x){ var ty=typeAfElement[x]; if(ty!=null&&t.indexOf(ty)<0) t.push(ty); });
        if(!t.length){ afvist.push({handling:f.handling,grund:'ingen kendte typer'}); return; }
        if(!/^\[L\]%[A-Z]{2,3}(\.\d{3})?$/.test(String(f.vaerdi||''))){ afvist.push({handling:f.handling,grund:'ikke en CCI-kode'}); return; }
        g.typeIds=t;
      } else {
        var e=[]; (f.elementIds||[]).forEach(function(x){ if(ids[x]&&e.indexOf(x)<0&&(f.handling!=='saet_rumbrug'||rum[x])) e.push(x); });
        if(!e.length){ afvist.push({handling:f.handling,grund:'ingen kendte elementer'}); return; }
        if(f.handling==='saet_handlingsstatus'&&!A.HANDLING.some(function(h){ return h.v===f.vaerdi; })){ afvist.push({handling:f.handling,grund:'ukendt handlingsstatus'}); return; }
        if(f.handling==='saet_konstruktiv'&&['bærende','ikke-bærende','stabiliserende'].indexOf(f.vaerdi)<0){ afvist.push({handling:f.handling,grund:'ukendt konstruktiv funktion'}); return; }
        if(f.handling==='saet_rumbrug'&&A.RUMANVENDELSER.indexOf(f.vaerdi)<0){ afvist.push({handling:f.handling,grund:'ukendt rumanvendelse'}); return; }
        if(f.handling==='saet_tag'&&!(typeof f.vaerdi==='string'&&f.vaerdi.trim().length>=2)){ afvist.push({handling:f.handling,grund:'tomt tag'}); return; }
        g.elementIds=e;
      }
      ud.push(g);
    });
    var r={forslag:ud,svar:String(res&&res.svar||''),afvist:afvist,model:res&&res.model||'',afkortet:!!(res&&res.afkortet)};
    if(VALG()){ r.valg=VALG().normaliserValg(res&&res.valg); if(res&&res.spoergsmaal) r.spoergsmaal=String(res.spoergsmaal); }
    return r;
  }

  // Et forslag → poster i dataposten (status proposed) på elementet eller typen. Returnerer antal poster.
  function laegForslag(f,af){
    var ny=laegForslagNy(f,af); if(ny!=null) return ny;   // 3.0: støj, datapost, produkt, LCA, EPD
    var felt=FELT_AF[f.handling]; if(!felt) return 0;
    var n=0, tid=new Date().toISOString();
    var skriv=function(info,paa,vaerdi){
      var m=A.maal(info,paa), rec=A.dataFor(m);
      var fl=rec.forslag||(rec.forslag=[]);
      if(fl.some(function(x){ return x&&x.status==='proposed'&&x.felt===felt&&JSON.stringify(x.vaerdi)===JSON.stringify(vaerdi); })) return;
      fl.push({felt:felt,vaerdi:vaerdi,begrundelse:f.begrundelse||'',af:af,tid:tid,status:'proposed'});
      gemDataAi(m,rec,'forslag fra AI'); n++;
    };
    if(f.handling==='saet_cci'){
      var set={};
      (f.typeIds||[]).forEach(function(tid2){ if(set[tid2]) return; var info=null; for(var i=0;i<A.infos.length&&!info;i++){ var x=A.infos[i]; if(x&&x.type&&x.type.id===tid2) info=x; }
        if(info){ set[tid2]=1; skriv(info,'type',String(f.vaerdi)); } });
    } else {
      (f.elementIds||[]).forEach(function(id){ var info=infoAfId(id); if(!info) return;
        skriv(info,'element',felt==='tags'? [String(f.vaerdi)] : String(f.vaerdi)); });
    }
    return n;
  }

  function forslagTekst(f){
    var n=(f.elementIds||f.typeIds||[]).length, hvad=f.handling==='saet_cci'? (n===1?'1 type':n+' typer') : (n===1?'1 element':n+' elementer');
    return '<b>'+esc(HANDLING_TEKST[f.handling]||f.handling)+'</b>'+(f.vaerdi!=null?' «'+esc(f.handling==='saet_handlingsstatus'? A.handlingTekst(f.vaerdi) : String(f.vaerdi))+'»':'')+' · '+hvad+(f.begrundelse?'<div class="arb-n">'+esc(f.begrundelse)+'</div>':'');
  }

  var igang=null;   // {id} for det kald, der venter
  var koeUr=null;   // «Min AI-app»: tjekker hvert 3. sekund, om AI'en har hentet opgaven
  function stopKoeUr(){ if(koeUr!=null&&typeof clearInterval==='function') clearInterval(koeUr); koeUr=null; }
  function udvalgTekst(k,koe){
    var n=k.valgte.length;
    return k.udvalg==='valgte'? n+' valgte elementer '+(koe?'ligger i opgaven.':'sendes med.') : n? 'Intet valgt: de '+n+' synlige elementer '+(koe?'ligger i opgaven.':'sendes med.') : 'Ingen elementer '+(koe?'ligger i opgaven.':'sendes med.');
  }
  // «Min AI-app» (køen i pluginet): AI'en i Claude- eller Codex-appen henter opgaven gennem issana-revit, må slå mere op i
  // modellen og svarer med complete_sketch_request. Pluginet venter op til 15 min; siden viser, om opgaven er hentet.
  function visKoeVent(id,k){
    var V=A.V(), navn=tilstand.appNavn||'AI-appen', lytter=tilstand.provider==='mcp', start=Date.now(), modtaget=false;
    var hvem=lytter? 'din AI' : /appen$/.test(navn)? navn : navn+'-appen';
    svar('<b>Venter på '+esc(hvem)+' …</b>'+
      '<div class="arb-hint" id="arbAiKoeStatus">'+esc(lytter? 'Opgaven venter i Revit. Bed din AI om at lytte efter opgaver fra Revit (wait_for_sketch_request).' : hvem.charAt(0).toUpperCase()+hvem.slice(1)+' åbnes med en kort besked uden modeldata. Tryk Enter dér, hvis den ikke sendes af sig selv.')+'</div>'+
      '<div class="arb-hint">'+esc(udvalgTekst(k,true))+' AI\'en henter den gennem issana-revit, må slå mere op i modellen og skriver ikke i Revit. Du godkender forslagene her. Den venter højst 15 minutter.</div>'+
      '<div class="arb-row"><button class="tbtn" id="arbAiAfbryd">Afbryd</button><button class="tbtn" id="arbAiKopier">Kopiér besked</button>'+(lytter?'':'<button class="tbtn" id="arbAiAabn">Åbn appen igen</button>')+'</div>'+
      '<textarea id="arbAiBesked" readonly rows="3" aria-label="Beskeden til AI-appen" style="display:none;width:100%;font:inherit;font-size:11px"></textarea>');
    var info={prompt:'',hjaelp:''};
    var status=function(t){ var s=$('arbAiKoeStatus'); if(s) s.textContent=t; };
    V.kald('issana_ai_indstillinger',{operation:'aiapp'},{timeoutMs:15000}).then(function(r){ if(r) info=r; var t=$('arbAiBesked'); if(t) t.value=info.prompt||''; }).catch(function(){});
    var kop=$('arbAiKopier'); if(kop) kop.onclick=function(){
      var t=$('arbAiBesked'), besked=info.prompt||(t&&t.value)||'';
      var visFelt=function(){ if(t){ t.style.display='block'; if(t.select) t.select(); } status('Kopiér beskeden herunder med Ctrl+C, indsæt den i '+navn+' og tryk Enter.'); };
      try{ if(besked&&typeof navigator!=='undefined'&&navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(besked).then(function(){ status('Beskeden er kopieret. Indsæt den i '+navn+' og tryk Enter.'); },visFelt); return; } }catch(e){}
      visFelt();
    };
    var aabn=$('arbAiAabn'); if(aabn) aabn.onclick=function(){
      V.kald('issana_ai_indstillinger',{operation:'aiapp_aabn'},{timeoutMs:15000}).then(function(r){ status((r&&r.besked)||'Appen er åbnet igen.'); })
        .catch(function(e){ status('Appen kunne ikke åbnes: '+((e&&e.message)||e)+' Brug Kopiér besked.'); });
    };
    stopKoeUr();
    if(typeof setInterval==='function') koeUr=setInterval(function(){
      if(!igang||igang.id!==id){ stopKoeUr(); return; }
      V.kald('issana_ai_indstillinger',{operation:'aiapp_status'},{timeoutMs:10000}).then(function(r){
        if(!igang||igang.id!==id||!r) return;
        if(r.stage==='modtaget'){ if(!modtaget){ modtaget=true; status((r.tekst||'Modtaget')+'. Svaret vises her, når det er klar.'); } }
        else if(!modtaget&&Date.now()-start>60000&&info.hjaelp) status(info.hjaelp);
      }).catch(function(){});
    },3000);
  }
  function spoergAi(tekst,fastKontekst,ekstra){
    var V=A.V();
    if(!V.erRevit()){ hjaelp(tekst,'Det er ikke en fast sætning, og AI\'en kan kun spørges inde i Revit.'); return; }
    var k=kontekst(fastKontekst,ekstra), id='ai-'+Date.now().toString(36), koe=!!tilstand.koe;
    if(ekstra&&ekstra.byggeplan) k.byggeplan=ekstra.byggeplan; // eget datafelt; overskriv aldrig model, valgte eller typer
    if(VALG()) historik=VALG().historikTilfoej(historik,{rolle:'bruger',tekst:tekst,valgtId:ekstra&&ekstra.valgtId});
    igang={id:id};
    if(koe) visKoeVent(id,k);
    else svar('<b>Spørger '+esc(tilstand.etiket||'AI')+'…</b><div class="arb-hint">'+udvalgTekst(k,false)+' Ingen nøgler forlader pluginet.</div>'+
      '<div class="arb-row"><button class="tbtn" id="arbAiAfbryd">Afbryd</button></div>');
    $('arbAiAfbryd').onclick=function(){ stopKoeUr(); igang=null; V.kald('issana_ai_foreslaa',{afbryd:true,id:id},{timeoutMs:10000}).catch(function(){}); lukSvar(); V.info('Afbrudt.'); };
    V.kald('issana_ai_foreslaa',{tekst:tekst,kontekst:k,id:id},{timeoutMs:ventetid(tilstand)})
      .then(function(res){ if(!igang||igang.id!==id) return; stopKoeUr(); igang=null; visSvar(valider(res,k),k,tekst); })   // valider tager valg/spoergsmaal med
      .catch(function(e){ if(!igang||igang.id!==id) return; stopKoeUr(); igang=null;
        svar('<b>AI\'en svarede ikke.</b><div class="arb-hint">'+esc((e&&e.message)||String(e))+'</div><div class="arb-row"><button class="tbtn" id="arbAiIgen">Prøv igen</button><button class="tbtn" id="arbAiValgAabn">Skift forbindelse</button></div>');
        $('arbAiIgen').onclick=function(){ spoergAi(tekst,fastKontekst,ekstra); }; $('arbAiValgAabn').onclick=function(){ lukSvar(); visValg(true); }; });
  }

  function visSvar(res,k,tekst){
    if(VALG()&&LCA()) return visSvarValg(res,k,tekst);   // 3.0: valgknapper, Brug/Spring over, LCA (arbejdsrum-ai-valg.js, ai-lca.js)
    var V=A.V();
    // vis/isolér ændrer intet: de udføres med det samme.
    var markeret=[]; res.forslag.forEach(function(f){ if(f.handling==='vis'||f.handling==='isoler') f.elementIds.forEach(function(id){ if(markeret.indexOf(id)<0) markeret.push(id); }); });
    var iso=res.forslag.some(function(f){ return f.handling==='isoler'; });
    if(markeret.length){ vaelgIds(markeret); if(iso) isolerIds(markeret); }
    var forslag=res.forslag.filter(function(f){ return FELT_AF[f.handling]; });
    var h='<div style="white-space:pre-wrap">'+esc(res.svar||(forslag.length?'Forslag:':'Ingen forslag.'))+'</div>';
    if(markeret.length) h+='<div class="arb-hint">'+markeret.length+' elementer er '+(iso?'isoleret':'markeret')+' i 3D.</div>';
    if(forslag.length){
      h+='<div class="arb-sek">Forslag (intet skrives før du godkender)</div>';
      forslag.forEach(function(f,i){ h+='<label class="arb-row" style="align-items:flex-start;gap:6px"><input type="checkbox" checked data-ai-f="'+i+'"><span>'+forslagTekst(f)+'</span></label>'; });
      h+='<div class="arb-row"><button class="tbtn primary" id="arbAiLaeg">Læg i ændringslisten som forslag</button><button class="tbtn" id="arbAiMark">Markér i 3D</button><button class="tbtn" id="arbAiNej">Annullér</button></div>';
    }
    if(res.afvist&&res.afvist.length) h+='<div class="arb-hint">Afvist af kontrollen: '+esc(res.afvist.map(function(a){ return (a.handling||'?')+' ('+a.grund+')'; }).join('; '))+'</div>';
    if(res.afkortet) h+='<div class="arb-hint">Svaret blev afkortet. Vælg højere intensitet eller færre elementer.</div>';
    h+='<div class="arb-hint" style="opacity:.7">'+esc(res.model||'')+' · forslag, ikke facit. Du bekræfter pr. element under Egenskaber, før noget gemmes i Revit.</div>';
    svar(h);
    var mark=$('arbAiMark'); if(mark) mark.onclick=function(){ var ids=[]; valgteForslag(forslag).forEach(function(f){ (f.elementIds||[]).forEach(function(id){ if(ids.indexOf(id)<0) ids.push(id); });
      (f.typeIds||[]).forEach(function(t){ A.infos.forEach(function(x){ if(x&&x.type&&x.type.id===t&&ids.indexOf(x.ed.id)<0) ids.push(x.ed.id); }); }); }); if(ids.length) vaelgIds(ids); };
    var nej=$('arbAiNej'); if(nej) nej.onclick=lukSvar;
    var laeg=$('arbAiLaeg'); if(laeg) laeg.onclick=function(){
      var valgt=valgteForslag(forslag), n=0, af='AI'+(res.model?' ('+res.model+')':'');
      valgt.forEach(function(f){ n+=laegForslag(f,af); });
      lukSvar();
      if(!n){ V.info('Ingen nye forslag (de lå der allerede).'); return; }
      V.info(n+' forslag lagt i ændringslisten som «foreslået af AI». Bekræft dem under Egenskaber (eller Data → Bekræft alle), og gem i Revit.');
      A.visFane('aendringer');
    };
  }
  function valgteForslag(forslag){ var r=[]; document.querySelectorAll('#arbAiSvar [data-ai-f]').forEach(function(c){ if(c.checked) r.push(forslag[Number(c.getAttribute('data-ai-f'))]); }); return r; }

  // Klassifikation → «Foreslå med AI»: CCI-klasse til de valgte (eller givne) elementers typer, samme vej som alt andet.
  function foreslaaCci(ids){
    var liste=ids&&ids.length? ids.map(infoAfId).filter(Boolean) : valgteInfos();
    if(!liste.length){ A.V().fejl('Vælg først de elementer, hvis typer skal have en CCI-kode.'); return; }
    if(ids&&ids.length) vaelgIds(ids);
    spoergAi('Giv de valgte elementers typer en CCI-klasse (handlingen saet_cci). Brug kun klasser fra cci_klasser, og foreslå kun hovedtype, når typens navn tydeligt siger det. Typer, der allerede har en kode, springes over.',liste);
  }

  /* ---------- 3.0: valg, historik, masseforslag og LCA (arbejdsrum-ai-valg.js, ai-lca.js, epd-match.js) ---------- */
  // De rene moduler indlæses af denne fil (så Revit-modelviewer.html er uændret); mangler de, virker feltet som før.
  var EKSTRA=['arbejdsrum-ai-valg.js','ai-lca.js','epd-match.js','lca-bygningsdele.js','epd-synonymer.js','data/br18-tabel-7-2025.js','data/br18-tabel-8-2025.js','lca-projekt.js','rapport-typst.js','lca-dialog.js'];
  function VALG(){ return window.IssanaAiValg||null; }
  function LCA(){ return window.IssanaAiLca||null; }
  function EPD(){ return window.IssanaEpdMatch||null; }
  function indlaesEkstra(){
    if(typeof document==='undefined'||!document.createElement||!document.head) return;
    EKSTRA.forEach(function(f){ var navn=f.replace(/^.*\//,'').replace(/\.js$/,'');
      if(document.querySelector('script[data-ai-ekstra="'+navn+'"]')) return;
      var s=document.createElement('script'); s.src=f+'?t='+Date.now(); s.async=false; s.setAttribute('data-ai-ekstra',navn); // tidsstempel: ellers kan browseren bruge en gammel kopi efter en installation
      s.onerror=function(){ console.warn('ISSANA AI: kunne ikke indlæse '+f); }; document.head.appendChild(s); });
  }
  var NY_HANDLING={saet_stoej:1,saet_data:1,saet_produkt:1,saet_lca:1,saet_epd:1,saet_bygningstype:1,lca_status:1,lca_struktur:1,lca_beregn:1,foreslaa_produkt:1};
  var historik=[];   // de sidste 6 ture (IssanaAiValg.historikTilfoej)

  function bibliotek(){ try{ var t=localStorage.getItem('issana-produkter-v1'); if(!t) return null; var b=JSON.parse(t); return b&&Array.isArray(b.produkter)? b : null; }catch(e){ return null; } }
  function tabel7(){ return window.ISSANA_BR18_TABEL7||null; }
  function tabel8(){ return window.ISSANA_BR18_TABEL8||null; }
  function synonymer(){ return window.IssanaEpdSynonymer||{grupper:[]}; }
  function mapping(){ return window.IssanaLcaBygningsdele||{bygningsdele:[],regler:[]}; }
  function aktivFane(){ try{ if(typeof A.aktivFane==='function') return A.aktivFane(); var e=document.querySelector&&document.querySelector('.arb-fane.on[data-fane]'); return e? e.getAttribute('data-fane') : null; }catch(x){ return null; } }
  function alleInfos(){ return A.infos.filter(Boolean); }
  function lcaValg(){ return {model:modelData(),mapping:mapping(),tabel:tabel7(),synonymer:synonymer(),M:EPD(),bibliotek:bibliotek(),P:window.IssanaProdukter||null,valgteIdx:valgteInfos().map(function(i){ return i.idx; })}; }
  function strukturNu(maal){ var L=LCA(); if(!L) return null; var liste=maal? L.udvalg(maal,alleInfos(),lcaValg().valgteIdx) : alleInfos(); return L.bygLcaStruktur(L.modelAf(liste,modelData()),mapping(),{kilder:L.kilder(liste,{bibliotek:bibliotek()})}); }
  function statusNu(maal){ var L=LCA(); if(!L) return null; var liste=maal? L.udvalg(maal,alleInfos(),lcaValg().valgteIdx) : alleInfos(); return L.status(liste,{bibliotek:bibliotek(),struktur:strukturNu(maal)}); }

  // Tillæg til konteksten (regel: aktiv fane, bibliotek/ISSANA-data, LCA-kandidater pr. type, struktur-tal, historik, valgtId).
  function kontekstTillaeg(k,ekstra){
    var L=LCA(), b=bibliotek(), V2=VALG();
    k.aktivFane=aktivFane();
    k.bibliotek={indlaest:!!b,navn:b&&b.navn||null,antal:b? b.produkter.length : 0,ids:b? b.produkter.slice(0,150).map(function(p){ return p.id; }) : []};
    var liste=k.valgte.map(function(e){ return infoAfId(e.id); }).filter(Boolean);
    if(L){
      var kil=L.kilder(liste,{bibliotek:b});
      k.issanaData={indlaest:A.infos.some(function(i){ return i&&i.ed&&i.ed.suite&&typeof i.ed.suite.co2==='number'; }),antalTyper:kil.filter(function(t){ return typeof t.suite==='number'; }).length};
      var prType={}; kil.forEach(function(t){ prType[t.typeId]=t; });
      k.typer.forEach(function(t){ var x=prType[t.id]; if(x) t.lca={co2PrM2:x.co2PrM2,kilde:x.kilde,status:x.status}; });
      var kand=L.kandidaterPrType(liste,{bibliotek:b,P:window.IssanaProdukter||null}), ud={};
      Object.keys(kand).slice(0,40).forEach(function(tid){ ud[tid]=kand[tid].map(function(c){ return {id:c.id,navn:c.navn,co2PrM2:c.co2PrM2,kilde:c.kilde,status:c.status}; }); });
      k.lcaKandidater=ud;
      var s=strukturNu(); if(s) k.lcaStruktur=s.tal;
      k.lcaKilder={tabel7:!!tabel7(),epdMatch:!!EPD()};
      k.lcaRust=lcaRustKontekst();
    } else { k.issanaData={indlaest:false,antalTyper:0}; k.lcaKandidater={}; }
    try{ var K=window.IssanaLydkrav; if(K&&typeof K.bygningstyper==='function') k.bygningstyper=K.bygningstyper().map(function(x){ return {id:x.id,navn:x.navn}; }); }catch(e){}
    if(V2){ var t=V2.kontekstTillaeg(historik,ekstra&&ekstra.valgtId); k.historik=t.historik; if(t.valgtId) k.valgtId=t.valgtId; }
    return k;
  }

  // Sidens kontrol af de nye handlinger og af 'maal'. Returnerer true, når forslaget er håndteret (lagt i ud eller afvist).
  function validerNy(f,k,ud,afvist,typeIds,typeAfElement,ids){
    var L=LCA(), maal=f.maal&&typeof f.maal==='object'? f.maal : null;
    if(!NY_HANDLING[f.handling]&&!maal) return false;
    var g={handling:f.handling,vaerdi:f.vaerdi,begrundelse:f.begrundelse||''};
    var t=[]; (f.typeIds||[]).forEach(function(x){ if(typeIds[x]&&t.indexOf(x)<0) t.push(x); });
    (f.elementIds||[]).forEach(function(x){ var ty=typeAfElement[x]; if(ty!=null&&t.indexOf(ty)<0) t.push(ty); });
    var e=[]; (f.elementIds||[]).forEach(function(x){ if(ids[x]&&e.indexOf(x)<0) e.push(x); });
    if(maal){
      if(!L){ afvist.push({handling:f.handling,grund:'ai-lca.js er ikke indlæst (maal kan ikke udfoldes)'}); return true; }
      var liste=L.udvalg(maal,alleInfos(),valgteInfos().map(function(i){ return i.idx; }));
      if(!liste.length){ afvist.push({handling:f.handling,grund:'udvalget «'+L.maalTekst(maal)+'» rammer ingen elementer'}); return true; }
      g.maal=maal; g.antal=liste.length;
      if(!t.length) liste.forEach(function(i){ var ty=i.type&&i.type.id; if(ty!=null&&t.indexOf(ty)<0) t.push(ty); });
      if(!e.length) e=liste.map(function(i){ return i.ed.id; });
    }
    var typeH=/^(saet_cci|saet_produkt|saet_lca|saet_epd|foreslaa_produkt)$/.test(f.handling);
    if(f.handling==='lca_status'||f.handling==='lca_struktur'||f.handling==='lca_beregn'||f.handling==='saet_bygningstype'){ if(f.handling==='saet_bygningstype'&&!(typeof f.vaerdi==='string'&&f.vaerdi)){ afvist.push({handling:f.handling,grund:'ingen bygningstype'}); return true; } ud.push(g); return true; }
    if(typeH){ if(!t.length){ afvist.push({handling:f.handling,grund:'ingen kendte typer'}); return true; } g.typeIds=t; }
    else { if(!e.length){ afvist.push({handling:f.handling,grund:'ingen kendte elementer'}); return true; } g.elementIds=e; if(f.handling==='saet_data'&&t.length&&!(f.elementIds||[]).length&&(f.typeIds||[]).length) { g.typeIds=t; delete g.elementIds; } }
    if(f.handling==='saet_stoej'){ var m=/^(\d+(?:[.,]\d+)?)/.exec(String(f.vaerdi||'')); if(!m){ afvist.push({handling:f.handling,grund:'ikke et støjtal'}); return true; } g.vaerdi=m[1].replace('.',',')+' dB '+(/laeq/i.test(String(f.vaerdi))?'LAeq,24h':'Lden'); g.elementIds=g.elementIds.filter(function(id){ var i=infoAfId(id); return i&&i.ed.category==='Vægge'; }); if(!g.elementIds.length){ afvist.push({handling:f.handling,grund:'ingen vægge i udvalget'}); return true; } }
    else if(f.handling==='saet_data'){ if(!f.felt||f.vaerdi==null){ afvist.push({handling:f.handling,grund:'felt eller vaerdi mangler'}); return true; } g.felt=String(f.felt); }
    else if(f.handling==='saet_produkt'){ var b=bibliotek(); if(!b||!b.produkter.some(function(p){ return p.id===f.vaerdi; })){ afvist.push({handling:f.handling,grund:'produktet findes ikke i det indlæste bibliotek'}); return true; } }
    else if(f.handling==='saet_lca'||f.handling==='foreslaa_produkt'){
      if(f.handling==='foreslaa_produkt'&&(f.vaerdi==null||f.vaerdi==='')) { ud.push(g); return true; }
      if(f.vaerdi==='generisk'){ afvist.push({handling:f.handling,grund:L? L.generiske().tekst : 'mangler'}); return true; }
      var strategi=maal&&!(f.typeIds||[]).length&&['bibliotek','issana-konstruktion'].indexOf(f.vaerdi)>=0;
      if(!strategi){ var ok=false; if(L){ var kand=L.kandidaterPrType(g.typeIds.map(function(tid){ for(var i=0;i<A.infos.length;i++){ var x=A.infos[i]; if(x&&x.type&&x.type.id===tid) return x; } return null; }).filter(Boolean),{bibliotek:bibliotek(),P:window.IssanaProdukter||null}); ok=g.typeIds.some(function(tid){ return L.validerKilde(f.vaerdi,kand[tid]||[]).ok; }); }
        if(!ok){ afvist.push({handling:f.handling,grund:'ukendt kilde «'+f.vaerdi+'»'}); return true; } }
    }
    else if(f.handling==='saet_epd'){ if(!(['auto','br18-tabel7','bibliotek'].indexOf(f.vaerdi)>=0||/^#[A-Z]\d{4}$/.test(String(f.vaerdi||'')))){ afvist.push({handling:f.handling,grund:'hverken strategi eller datasæt-id'}); return true; } if(f.lag!=null) g.lag=String(f.lag); }
    else if(!NY_HANDLING[f.handling]){
      // En gammel handling med maal: samme værdikontrol som i valider.
      if(f.handling==='saet_cci'&&!/^\[L\]%[A-Z]{2,3}(\.\d{3})?$/.test(String(f.vaerdi||''))){ afvist.push({handling:f.handling,grund:'ikke en CCI-kode'}); return true; }
      if(f.handling==='saet_handlingsstatus'&&!A.HANDLING.some(function(h){ return h.v===f.vaerdi; })){ afvist.push({handling:f.handling,grund:'ukendt handlingsstatus'}); return true; }
      if(f.handling==='saet_konstruktiv'&&['bærende','ikke-bærende','stabiliserende'].indexOf(f.vaerdi)<0){ afvist.push({handling:f.handling,grund:'ukendt konstruktiv funktion'}); return true; }
      if(f.handling==='saet_rumbrug'){ g.elementIds=g.elementIds.filter(function(id){ var i=infoAfId(id); return i&&i.erRum; }); if(!g.elementIds.length||A.RUMANVENDELSER.indexOf(f.vaerdi)<0){ afvist.push({handling:f.handling,grund:'ukendt rumanvendelse eller ingen rum'}); return true; } }
      if(f.handling==='saet_tag'&&!(typeof f.vaerdi==='string'&&f.vaerdi.trim().length>=2)){ afvist.push({handling:f.handling,grund:'tomt tag'}); return true; }
    }
    ud.push(g); return true;
  }

  // Et forslag med strategi (saet_epd auto/br18-tabel7/bibliotek, saet_lca strategi, foreslaa_produkt uden værdi) → konkrete forslag
  // pr. byggevare/type (deterministisk, i siden). Andre forslag går uændret igennem. Hvert konkret forslag har gruppe til listen.
  function udfold(f){
    var L=LCA(); if(!L) return [f];
    var maal=f.maal||(f.typeIds? {typeIds:f.typeIds} : null);
    if(f.handling==='saet_epd'&&!/^#/.test(String(f.vaerdi||''))){
      var v=lcaValg(); if(f.vaerdi==='bibliotek'){ v.tabel=null; v.M=null; } if(f.vaerdi==='br18-tabel7'){ v.bibliotek=null; }
      var r=L.masseForslag(maal||{alle:true},alleInfos(),v);
      var ud=r.forslag.map(function(l){ return {handling:l.handling,typeIds:[l.typeId],vaerdi:l.handling==='saet_epd'? l.post.datasaet : l.kandidat.id,lag:l.byggevare.id,post:l.post,begrundelse:l.begrundelse,gruppe:{bygningsdel:l.bygningsdel,type:l.typeNavn,typeId:l.typeId},tekst:(l.byggevare.navn||'')+(l.byggevare.tykkelseMm!=null?' '+l.byggevare.tykkelseMm+' mm':'')+' → '+(l.kandidat.navn||l.kandidat.id)+(l.post&&l.post.maengde!=null?' · '+A.fmt(l.post.maengde,2)+' '+(l.post.maengdeEnhed||''):'')+(l.status==='generisk'?' · generisk':'')+(l.kandidat.mangler?' · '+l.kandidat.mangler:'')}; });
      ud.masse=r; return ud;
    }
    if(f.handling==='saet_lca'&&['bibliotek','issana-konstruktion'].indexOf(f.vaerdi)>=0){
      var liste=L.udvalg(maal||{alle:true},alleInfos(),lcaValg().valgteIdx), kand=L.kandidaterPrType(liste,{bibliotek:bibliotek(),P:window.IssanaProdukter||null}), ud2=[];
      Object.keys(kand).forEach(function(tid){ var c=kand[tid].filter(function(x){ return f.vaerdi==='issana-konstruktion'? x.kildeType==='issana-konstruktion' : x.kildeType==='produktbibliotek'&&x.status==='dokumenteret'; })[0]; if(!c) return;
        var info=liste.filter(function(i){ return i.type&&String(i.type.id)===tid; })[0];
        ud2.push({handling:'saet_lca',typeIds:[Number(tid)],vaerdi:c.id,post:L.lcaPost(c,bibliotek(),{status:'proposed'}),begrundelse:c.navn+' ('+c.kilde+')',gruppe:{bygningsdel:'',type:info&&info.type.name||tid,typeId:Number(tid)},tekst:(info&&info.type.name||tid)+' → '+c.navn+' · '+A.fmt(c.co2PrM2,1)+' kg CO₂e/m²'}); });
      return ud2;
    }
    if(f.handling==='saet_epd'&&/^#/.test(String(f.vaerdi||''))&&EPD()&&tabel7()){
      // Et bestemt datasæt til en bestemt byggevare (lag) på typen.
      var M=EPD(), ds=M.datasaetAf(tabel7(),f.vaerdi), s=strukturNu({typeIds:f.typeIds}), ud3=[];
      if(!ds||!s) return [];
      s.bygningsdele.forEach(function(d){ d.konstruktioner.forEach(function(kon){ kon.byggevarer.forEach(function(b){ if(f.lag!=null&&String(b.id)!==String(f.lag)) return;
        var kand=M.match({materiale:b.materiale||b.navn,tykkelseMm:b.tykkelseMm,areal:kon.areal},tabel7(),synonymer(),{antal:1}).kandidater[0]||null;
        var q=M.maengde({tykkelseMm:b.tykkelseMm,areal:kon.areal},ds);
        var c={id:ds.id,key:ds.key,navn:ds.name_da,enhed:ds.declared_unit,score:kand&&kand.id===ds.id? kand.score : 0.5,begrundelse:'Valgt af AI/bruger: '+ds.name_da+(q.omregning?'; mængde = '+q.omregning:'')+(q.mangler?'; '+q.mangler:''),gwp:{A1A3:ds.a1a3,C3:ds.c3,C4:ds.c4,D:ds.d},maengde:q.maengde,maengdeEnhed:q.enhed,omregning:q.omregning||null,mangler:q.mangler||null,kilde:M.KILDE_NAVN+', datasæt '+ds.id};
        ud3.push({handling:'saet_epd',typeIds:[kon.typeId],vaerdi:ds.id,lag:b.id,post:M.post(c,b,{af:'AI'}),begrundelse:c.begrundelse,gruppe:{bygningsdel:d.navn,type:kon.navn,typeId:kon.typeId},tekst:(b.navn||'')+' → '+ds.name_da}); }); }); });
      return ud3;
    }
    if(f.maal&&f.handling!=='lca_status'&&f.handling!=='lca_struktur'&&f.handling!=='lca_beregn'&&f.handling!=='foreslaa_produkt'){ var g=JSON.parse(JSON.stringify(f)); g.tekst=null; return [g]; }
    return [f];
  }

  // Et nyt forslag → poster i dataposten (proposed). Returnerer antal, eller null når det ikke er en ny handling.
  function laegForslagNy(f,af){
    if(!NY_HANDLING[f.handling]) return null;
    var n=0, tid=new Date().toISOString(), L=LCA();
    var skriv=function(info,paa,felt,vaerdi){
      var m=A.maal(info,paa), rec=A.dataFor(m), fl=rec.forslag||(rec.forslag=[]);
      if(fl.some(function(x){ return x&&x.status==='proposed'&&x.felt===felt&&JSON.stringify(x.vaerdi)===JSON.stringify(vaerdi); })) return;
      fl.push({felt:felt,vaerdi:vaerdi,begrundelse:f.begrundelse||'',af:af,tid:tid,status:'proposed'});
      gemDataAi(m,rec,'forslag fra AI'); n++;
    };
    var typeInfo=function(tid2){ for(var i=0;i<A.infos.length;i++){ var x=A.infos[i]; if(x&&x.type&&x.type.id===tid2) return x; } return null; };
    if(f.handling==='saet_stoej'){ (f.elementIds||[]).forEach(function(id){ var info=infoAfId(id); if(info&&info.ed.category==='Vægge') skriv(info,'element','stoej',String(f.vaerdi)); }); return n; }
    if(f.handling==='saet_data'){
      var obj={}, o=obj, sti=String(f.felt).split('.'); for(var i=0;i<sti.length-1;i++) o=o[sti[i]]=o[sti[i]]||{}; o[sti[sti.length-1]]=f.vaerdi;
      if(f.typeIds&&f.typeIds.length&&!(f.elementIds||[]).length){ var set={}; f.typeIds.forEach(function(t){ var info=typeInfo(t); if(info&&!set[t]){ set[t]=1; skriv(info,'type','data',obj); } }); }
      else (f.elementIds||[]).forEach(function(id){ var info=infoAfId(id); if(info) skriv(info,'element','data',obj); });
      return n;
    }
    if(f.handling==='saet_produkt'){ var b=bibliotek(), p=b&&b.produkter.filter(function(x){ return x.id===f.vaerdi; })[0]; if(!p) return 0;
      (f.typeIds||[]).forEach(function(t){ var info=typeInfo(t); if(info) skriv(info,'type','data',{produkt:{id:p.id,navn:p.navn,bibliotek:b.navn||null,valgt:tid.slice(0,10),eksempel:!!p.eksempel}}); }); return n; }
    if(f.handling==='saet_lca'){
      (f.typeIds||[]).forEach(function(t){ var info=typeInfo(t); if(!info) return; var post=f.post;
        if(!post&&L){ var kand=L.kandidaterPrType([info],{bibliotek:bibliotek(),P:window.IssanaProdukter||null})[t]||[]; var c=L.findKandidat(kand,f.vaerdi); if(!c) return; post=L.lcaPost(c,bibliotek(),{status:'proposed'}); }
        if(post) skriv(info,'type','lca',post); }); return n; }
    if(f.handling==='saet_epd'){ if(!f.post) return 0; (f.typeIds||[]).forEach(function(t){ var info=typeInfo(t); if(info) skriv(info,'type','epd',f.post); }); return n; }
    if(f.handling==='saet_bygningstype'){ try{ var key='issana-lyd-'+((modelData().modelKey||modelData().model)||'model'); var g=JSON.parse(localStorage.getItem(key)||'{}'); g.bygningstype=f.vaerdi; localStorage.setItem(key,JSON.stringify(g)); A.V().info('Bygningstypen «'+f.vaerdi+'» er sat i Lyd-fanen (lokalt valg, ikke Revit).'); }catch(e){} return 0; }
    return 0;   // lca_status, lca_struktur, lca_beregn, foreslaa_produkt: ingen poster
  }

  // Tekst for ét forslag i listen (de nye handlinger har ofte en færdig tekst fra udfold).
  function forslagTekstNy(f){
    if(f.tekst) return '<b>'+esc(HANDLING_TEKST[f.handling]||f.handling)+'</b> '+esc(f.tekst)+(f.begrundelse?'<div class="arb-n">'+esc(f.begrundelse)+'</div>':'');
    var h=forslagTekst(f);
    if(f.felt) h+='<div class="arb-n">'+esc(f.felt)+' = '+esc(typeof f.vaerdi==='string'? f.vaerdi : JSON.stringify(f.vaerdi))+'</div>';
    if(f.maal&&LCA()) h+='<div class="arb-n">udvalg: '+esc(LCA().maalTekst(f.maal))+(f.antal?' ('+f.antal+' elementer)':'')+'</div>';
    return h;
  }

  function statusHtml(s){
    if(!s) return '';
    var h='<div class="arb-sek">LCA-status</div><div style="white-space:pre-wrap">'+esc(s.tekst)+'</div>';
    var mangler=s.typer.filter(function(t){ return t.status!=='har'; }), har=s.typer.filter(function(t){ return t.status==='har'; });
    if(har.length) h+='<details class="arb-lag"><summary>Typer med CO₂-data ('+har.length+'; kildens tal pr. m², vejledende, ikke ISSANA LCA)</summary>'+har.map(function(t){ return '<div class="arb-n">'+esc(t.navn)+': '+A.fmt(t.co2PrM2,1)+' kg CO₂e/m² <span class="arb-kilde">'+esc(t.kilde||'')+'</span></div>'; }).join('')+'</details>';
    if(mangler.length) h+='<details class="arb-lag" open><summary>Typer uden CO₂-data ('+mangler.length+')</summary>'+mangler.slice(0,40).map(function(t){ return '<div class="arb-n">'+esc(t.navn)+' ('+t.antal+' stk, '+A.fmt(t.areal,0)+' m²)</div>'; }).join('')+'</details>';
    return h;
  }
  function strukturHtml(s){
    if(!s) return '';
    var h='<div class="arb-sek">LCAbyg-struktur fra modellen: '+s.tal.bygningsdele+' bygningsdele · '+s.tal.konstruktioner+' konstruktioner · '+s.tal.byggevarer+' byggevarer · '+s.tal.udenEpd+' uden EPD</div>';
    s.bygningsdele.forEach(function(d){ h+='<details class="arb-lag"><summary><b>'+esc(d.navn)+'</b> · '+d.konstruktioner.length+' konstruktioner'+(d.mangler?' · <span class="issana-mangler">'+d.mangler+' mangler</span>':'')+'</summary>'+
      d.konstruktioner.map(function(k){ return '<div class="arb-n"><b>'+esc(k.navn)+'</b> · '+k.antal+' stk · '+A.fmt(k.areal,0)+' m²'+(k.co2PrM2!=null?' · '+A.fmt(k.co2PrM2,1)+' kg CO₂e/m²':'')+'<div style="padding-left:10px">'+k.byggevarer.map(function(b){ if(b.medregnes===false)return esc(b.navn)+' - luftlag, medregnes ikke i LCA'; return esc(b.navn)+(b.tykkelseMm!=null?' '+b.tykkelseMm+' mm':'')+' · '+A.fmt(b.maengde,2)+' '+esc(b.enhed)+' · '+(b.status==='har'? '<span class="arb-kilde">'+esc(b.kilde||'EPD')+'</span>' : '<span class="issana-mangler">'+(b.opbygningMangler?'opbygning mangler':'EPD mangler')+'</span>'); }).join('<br>')+'</div></div>'; }).join('')+'</details>'; });
    return h;
  }
  function kandidatHtml(typeIds){
    var L=LCA(); if(!L) return '';
    var liste=(typeIds||[]).map(function(t){ for(var i=0;i<A.infos.length;i++){ var x=A.infos[i]; if(x&&x.type&&x.type.id===t) return x; } return null; }).filter(Boolean);
    var kand=L.kandidaterPrType(liste,{bibliotek:bibliotek(),P:window.IssanaProdukter||null}), h='<div class="arb-sek">CO₂-kandidater pr. type</div>', nogen=false;
    liste.forEach(function(info){ var tid=info.type.id, k=kand[tid]||[]; h+='<div class="arb-n"><b>'+esc(info.type.name||'')+'</b>'+(k.length?'':' <span class="issana-mangler">ingen kandidater (indlæs bibliotek eller ISSANA-data, eller brug saet_epd pr. lag)</span>')+'</div>';
      k.forEach(function(c){ nogen=true; h+='<div class="arb-row" style="gap:6px;padding-left:10px"><span style="flex:1">'+esc(c.navn)+' · '+A.fmt(c.co2PrM2,1)+' kg CO₂e/m² · '+esc(c.status)+' <span class="arb-kilde">'+esc(c.kilde||'')+'</span></span><button class="tbtn arb-mini" data-ai-kand="'+esc(tid+'|'+c.id)+'">Brug</button></div>'; }); });
    return h;
  }

  var visning=null;   // {forslag, tilstand, res, k, tekst}
  function visSvarValg(res,k,tekst){
    var V=A.V(), V2=VALG(), L=LCA();
    var markeret=[]; res.forslag.forEach(function(f){ if((f.handling==='vis'||f.handling==='isoler')&&f.elementIds) f.elementIds.forEach(function(id){ if(markeret.indexOf(id)<0) markeret.push(id); }); });
    var iso=res.forslag.some(function(f){ return f.handling==='isoler'; });
    if(markeret.length){ vaelgIds(markeret); if(iso) isolerIds(markeret); }
    // Udfold strategier og maal til konkrete forslag; status/struktur/kandidater renderes lokalt.
    var forslag=[], lokal='', masse=null, rustVist=false;
    res.forslag.forEach(function(f){
      if(f.handling==='lca_status'){ lokal+=statusHtml(statusNu(f.maal)); var s=statusNu(f.maal); if(s&&!(res.valg&&res.valg.length)) res.valg=s.valg; if(!rustVist&&lcaKlar()){ rustVist=true; lokal+=RUST_PLADS; } return; }
      if(f.handling==='lca_beregn'){ if(!rustVist){ rustVist=true; lokal+=RUST_PLADS; } return; }
      if(f.handling==='lca_struktur'){ lokal+=strukturHtml(strukturNu(f.maal)); return; }
      if(f.handling==='foreslaa_produkt'&&(f.vaerdi==null||f.vaerdi==='')){ var t=f.typeIds||[]; if(!t.length&&f.maal&&L) L.udvalg(f.maal,alleInfos(),lcaValg().valgteIdx).forEach(function(i){ if(i.type&&t.indexOf(i.type.id)<0) t.push(i.type.id); }); lokal+=kandidatHtml(t); return; }
      if(f.handling==='foreslaa_produkt'){ f=JSON.parse(JSON.stringify(f)); f.handling='saet_lca'; }
      if(!FELT_AF[f.handling]&&!NY_HANDLING[f.handling]) return;
      var u=udfold(f); if(u.masse) masse=u.masse; u.forEach(function(x){ forslag.push(x); });
    });
    var h='<div style="white-space:pre-wrap">'+esc(res.svar||(forslag.length?'Forslag:':lokal?'':'Ingen forslag.'))+'</div>';
    if(markeret.length) h+='<div class="arb-hint">'+markeret.length+' elementer er '+(iso?'isoleret':'markeret')+' i 3D.</div>';
    if(masse&&L) h+='<div class="arb-hint">'+esc(L.masseTekst(masse))+'</div>';
    h+=lokal;
    var tilstand=V2.forslagTilstand(forslag);
    h+='<div data-ai-liste>'+V2.forslagHtml(forslag,tilstand,forslagTekstNy)+'</div>';
    h+=V2.valgHtml(res.valg,res.spoergsmaal);
    if(res.afvist&&res.afvist.length) h+='<div class="arb-hint">Afvist af kontrollen: '+esc(res.afvist.map(function(a){ return (a.handling||'?')+' ('+a.grund+')'; }).join('; '))+'</div>';
    if(res.afkortet) h+='<div class="arb-hint">Svaret blev afkortet. Vælg højere intensitet eller færre elementer.</div>';
    h+='<div class="arb-hint" style="opacity:.7">'+esc(res.model||'')+' · forslag, ikke facit. Du bekræfter under Egenskaber (eller Data → Bekræft alle), før noget gemmes i Revit.</div>';
    svar(h);
    visning={forslag:forslag,tilstand:tilstand,res:res,k:k,tekst:tekst,af:'AI'+(res.model?' ('+res.model+')':'')};
    if(rustVist) visRustISvar();
    historik=V2.historikTilfoej(historik,{rolle:'ai',tekst:res.svar||res.spoergsmaal||'',valgIds:(res.valg||[]).map(function(v){ return v.id; }),handlinger:res.forslag.map(function(f){ return f.handling; })});
    bindKnapper();
  }
  function laegEn(i){
    var f=visning.forslag[i], n=laegForslag(f,visning.af);
    if(n&&f&&f.handling==='saet_epd') genberegnSnart();
    VALG().brug(visning.tilstand,i); return n;
  }
  function genTegnListe(){
    var b=$('arbAiSvar'), boks=b&&b.querySelector? b.querySelector('[data-ai-liste]') : null; if(!boks||!visning) return;
    boks.innerHTML=VALG().forslagHtml(visning.forslag,visning.tilstand,forslagTekstNy);
    bindKnapper();
  }
  function bindKnapper(){
    var b=$('arbAiSvar'); if(!b||!b.querySelectorAll) return;
    var V=A.V(), V2=VALG();
    var faerdig=function(n,tekst){ if(n>0){ V.info(n+' forslag lagt i ændringslisten som «foreslået af AI». Bekræft dem under Egenskaber (eller Data → Bekræft alle), og gem i Revit.'); } else if(tekst) V.info(tekst); genTegnListe(); };
    b.querySelectorAll('[data-ai-brug]').forEach(function(k){ k.onclick=function(){ faerdig(laegEn(Number(k.getAttribute('data-ai-brug')))); }; });
    b.querySelectorAll('[data-ai-spring]').forEach(function(k){ k.onclick=function(){ V2.springOver(visning.tilstand,Number(k.getAttribute('data-ai-spring'))); genTegnListe(); }; });
    var alle=b.querySelector('[data-ai-brug-alle]'); if(alle) alle.onclick=function(){ var n=0; V2.aabne(visning.tilstand).forEach(function(i){ n+=laegEn(i); }); faerdig(n,'Ingen nye forslag (de lå der allerede).'); if(n) A.visFane('aendringer'); };
    var spring=b.querySelector('[data-ai-spring-alle]'); if(spring) spring.onclick=function(){ V2.aabne(visning.tilstand).forEach(function(i){ V2.springOver(visning.tilstand,i); }); genTegnListe(); };
    b.querySelectorAll('[data-ai-brug-gruppe]').forEach(function(k){ k.onclick=function(ev){ ev.preventDefault(); var gi=Number(k.getAttribute('data-ai-brug-gruppe')), g=V2.grupper(visning.forslag)[gi], n=0; (g?g.indeks:[]).forEach(function(i){ if(V2.aabne(visning.tilstand).indexOf(i)>=0) n+=laegEn(i); }); faerdig(n); }; });
    b.querySelectorAll('[data-ai-kand]').forEach(function(k){ k.onclick=function(){ var p=k.getAttribute('data-ai-kand').split('|'); var n=laegForslag({handling:'saet_lca',typeIds:[Number(p[0])],vaerdi:p.slice(1).join('|'),begrundelse:'Valgt af brugeren blandt kandidaterne.'},visning? visning.af : 'AI'); faerdig(n,'Lå der allerede.'); }; });
    b.querySelectorAll('[data-ai-valg]').forEach(function(k){ k.onclick=function(){ klikValg(k.getAttribute('data-ai-valg')); }; });
  }
  // Et klik på et valg: lokale handlinger udføres her; alt andet sendes til AI'en med valgtId og historik.
  function klikValg(id){
    var V2=VALG(), res=visning&&visning.res, valg=V2.normaliserValg(res&&res.valg), v=V2.valgKlik(valg,id); if(!v) return;
    historik=V2.historikTilfoej(historik,{rolle:'bruger',tekst:v.tekst,valgtId:v.valgtId});
    var V=A.V();
    if(v.handling==='aabn_produkter'){ lukSvar(); A.visFane('produkter'); V.info('Indlæs produktbiblioteket under Produkter → «Indlæs fil…», og spørg igen.'); return; }
    if(v.handling==='hent_issana'){ lukSvar(); var knap=document.getElementById('fysikImport'); if(knap&&knap.click){ knap.click(); V.info('Vælg ISSANA Konstruktion-eksporten (JSON); den kobles på modellens typer.'); } else V.info('Åbn fanen ISSANA Konstruktion og brug «Hent data» for at koble ISSANA-eksporten på modellen.'); return; }
    if(v.handling==='generisk'){ var L=LCA(); svar('<b>Generiske værdier</b><div class="arb-hint">'+esc(L? L.generiske().tekst : 'mangler')+'</div>'+(tabel7()&&EPD()? '<div class="arb-hint">BR18 bilag 2 tabel 7 (2025) er indlæst og kan bruges pr. byggevare (lag): vælg herunder.</div>'+V2.valgHtml([{id:'t7_alle',tekst:'Tabel 7 for alle bygningsdele (udkast)',handling:'saet_epd',maal:{alle:true},vaerdi:'br18-tabel7'},{id:'t7_valgte',tekst:'Tabel 7 for de valgte',handling:'saet_epd',maal:{valgte:true},vaerdi:'br18-tabel7'}]) : '')); visning={forslag:[],tilstand:V2.forslagTilstand([]),res:{valg:[{id:'t7_alle',tekst:'Tabel 7 for alle bygningsdele (udkast)',handling:'saet_epd',maal:{alle:true},vaerdi:'br18-tabel7'},{id:'t7_valgte',tekst:'Tabel 7 for de valgte',handling:'saet_epd',maal:{valgte:true},vaerdi:'br18-tabel7'}]},af:'AI'}; bindKnapper(); return; }
    if(v.handling&&(NY_HANDLING[v.handling]||FELT_AF[v.handling])&&(v.maal||v.vaerdi!=null||v.handling==='lca_status'||v.handling==='lca_struktur'||v.handling==='lca_beregn')){
      // Valget bærer selv en handling: udfør den lokalt gennem den samme kontrol som et AI-svar.
      var vo=valg.filter(function(x){ return x.id===id; })[0]||{}, f={handling:v.handling,maal:v.maal||undefined,vaerdi:v.vaerdi,elementIds:vo.elementIds,typeIds:vo.typeIds,felt:vo.felt,lag:vo.lag,begrundelse:'Valgt af brugeren: '+v.tekst};
      if(!f.maal&&!f.elementIds&&!f.typeIds&&v.handling!=='lca_status'&&v.handling!=='lca_struktur'&&v.handling!=='lca_beregn'&&v.handling!=='saet_bygningstype') f.maal={valgte:true};
      var k=kontekst(); var r=valider({forslag:[f],svar:res&&res.svar&&/\?$/.test(res.svar)? '' : (v.tekst),model:res&&res.model},k);
      if(!r.forslag.length&&r.afvist.length){ visSvarValg({forslag:[],svar:'',afvist:r.afvist,model:res&&res.model,valg:[]},k,v.tekst); return; }
      r.svar=''; visSvarValg(r,k,v.tekst); return;
    }
    spoergAi(v.tekst,null,{valgtId:v.valgtId});
  }
  // Det, LCA-fanen (næste runde) og andre spor kan læse: strukturen, status og masseforslag.
  /* ---------- ISSANA LCA (Rust-kernen) gennem pluginet: issana_lca_beregn/_info/_gem/_importer_lcabyg (Model3dLca.cs) ----------
     3D regner aldrig selv CO₂. lca-projekt.js bygger ISSANA LCA-projektet (v3) af strukturen og EPD-valgene; Rust regner; panelet og
     AI'en viser Rusts svar uændret. Referenceareal, bygningstype og levetider (med kilde) gemmes lokalt pr. model (issana-lca-<model>). */
  function PROJ(){ return window.IssanaLcaProjekt||null; }
  var lcaT={sidste:null,info:null,fejl:null,igang:false,timer:null,lyttere:[]};
  var RUST_PLADS='<div data-ai-lca-rust class="arb-hint">ISSANA LCA regner …</div>';
  function lcaNoegle(){ var m=modelData(); return 'issana-lca-'+((m.modelKey||m.model)||'model'); }
  function lcaIndstillinger(ny){
    var k=lcaNoegle(), g={}; try{ g=JSON.parse(localStorage.getItem(k)||'{}')||{}; }catch(e){ g={}; }
    if(ny&&typeof ny==='object'){ Object.keys(ny).forEach(function(x){ if(ny[x]==null) delete g[x]; else g[x]=ny[x]; }); try{ localStorage.setItem(k,JSON.stringify(g)); }catch(e){} meldLca(); }
    return g;
  }
  // EPD-valg pr. lag: bekræftede (dataposten lca.byggevarer) og «Brug»-forslag (forslag felt epd, status proposed), pr. type.
  function epdValgNu(){
    var ud={}, set={};
    A.infos.forEach(function(i){
      if(!i||i.erRum||!i.type||i.type.id==null||set[i.type.id]) return; set[i.type.id]=1;
      var rec; try{ rec=A.dataFor(A.maal(i,'type')); }catch(e){ return; }
      var t={};
      (rec&&rec.forslag||[]).forEach(function(f){ if(f&&f.status==='proposed'&&f.felt==='epd'&&f.vaerdi&&f.vaerdi.lag!=null) t[String(f.vaerdi.lag)]={post:f.vaerdi,status:'proposed'}; });
      var bv=rec&&rec.lca&&rec.lca.byggevarer||{}; Object.keys(bv).forEach(function(lag){ t[lag]={post:bv[lag],status:'bekraeftet'}; });
      if(Object.keys(t).length) ud[i.type.id]=t;
    });
    return ud;
  }
  function katalogNu(){ var i=lcaT.info; return i&&i.katalog&&i.katalog.sha256? {sha256:i.katalog.sha256,source_workbook_sha256:i.katalog.source_workbook_sha256||null} : null; }
  function projektNu(){
    var P=PROJ(); if(!P) return {klar:false,projekt:null,mangler:[{kode:'modul_mangler',tekst:'lca-projekt.js er ikke indlæst.'}],noter:[],kort:{},tal:{}};
    var g=lcaIndstillinger();
    return P.bygProjekt(strukturNu(),{tabel:tabel7(),katalog:katalogNu(),epdValg:epdValgNu(),levetider:g.levetider||null,maengder:g.maengder||null,opbygninger:g.opbygninger||null,
      referenceareal:g.referenceareal&&g.referenceareal.m2>0? g.referenceareal : null,bygningstype:g.bygningstype||null,model:modelData(),
      tabel8:tabel8(),b6:g.b6||null,byggeplads:g.byggeplads||null,installationer:g.installationer!==false});
  }
  function lcaKlar(){ var g=lcaIndstillinger(); return !!(g.bygningstype&&g.referenceareal&&g.referenceareal.m2>0&&A.V().erRevit&&A.V().erRevit()); }
  function meldLca(){ lcaT.lyttere.slice().forEach(function(f){ try{ f(lcaT); }catch(e){} }); }
  function ikkeRevit(){ return Promise.reject(new Error('ISSANA LCA regner i Revit: pluginet kører Rust-kernen (issana_lca_beregn). Åbn ISSANA 3D fra Revit.')); }
  function lcaInfo(frisk){
    if(lcaT.info&&!frisk) return Promise.resolve(lcaT.info);
    var V=A.V(); if(!V.erRevit||!V.erRevit()) return ikkeRevit();
    return V.kald('issana_lca_info',{},{timeoutMs:40000}).then(function(i){ lcaT.info=i; return i; });
  }
  function klartProjekt(){ return lcaInfo().then(function(){ var ud=projektNu(); if(!ud.klar){ var e=new Error(ud.mangler.map(function(m){ return m.tekst; }).join(' ')); e.ud=ud; throw e; } return ud; }); }
  function lcaBeregn(){
    lcaT.igang=true; meldLca();
    var nr=lcaT.aendring||0;   // en ændring under beregningen gør svaret forældet igen
    return klartProjekt().then(function(ud){
      return A.V().kald('issana_lca_beregn',{projekt:ud.projekt},{timeoutMs:120000}).then(function(rust){
        lcaT.sidste={rust:rust,ud:ud,oversigt:PROJ().oversigt(rust,ud),tid:new Date().toISOString()}; lcaT.fejl=null; lcaT.igang=false; lcaT.foraeldet=(lcaT.aendring||0)!==nr; meldLca(); return lcaT.sidste; });
    }).catch(function(e){ lcaT.fejl=e&&e.message||String(e); lcaT.igang=false; meldLca(); throw e; });
  }
  function genberegnSnart(){
    if(typeof setTimeout!=='function') return;   // uden tidsstyring (testens sandkasse): ingen automatisk genberegning
    if(lcaT.timer) clearTimeout(lcaT.timer);
    lcaT.timer=setTimeout(function(){ lcaT.timer=null; if(lcaKlar()) lcaBeregn().catch(function(){}); },900);
  }
  function lcaGem(start){ return klartProjekt().then(function(ud){ return A.V().kald('issana_lca_gem',{projekt:ud.projekt,start:!!start},{timeoutMs:120000}); }); }
  function lcaImporter(navn,indhold){ var V=A.V(); if(!V.erRevit||!V.erRevit()) return ikkeRevit(); return V.kald('issana_lca_importer_lcabyg',{navn:navn,indhold:indhold},{timeoutMs:120000}); }
  // Til AI-konteksten: kun Rusts tal og mangler (eller null, når ISSANA LCA ikke har regnet).
  function lcaRustKontekst(){
    var o=lcaT.sidste&&lcaT.sidste.oversigt; if(!o) return null;
    return {status:o.status,total:o.total,graense:o.graense,overholdt:o.overholdt,moduler:o.moduler,tekst:PROJ().oversigtTekst(o),daekning:o.daekning||null,
      manglerEfterType:(o.grupper||[]).map(function(g){ return {type:g.titel,antal:g.antal}; }),mangler:o.mangler.slice(0,12).map(function(m){ return m.tekst; }),antalMangler:o.mangler.length,tid:lcaT.sidste.tid};
  }
  // Rusts svar i AI-feltets svar (lca_beregn, lca_status): samme visning som LCA-panelet (IssanaLcaPanel.resultatHtml).
  function visRustISvar(){
    var fyld=function(html){ var b=$('arbAiSvar'), el=b&&b.querySelector? b.querySelector('[data-ai-lca-rust]') : null; if(!el) return; el.className=''; el.innerHTML=html;
      Array.prototype.forEach.call(el.querySelectorAll('[data-lca-vaelg]'),function(x){ x.onclick=function(){ vaelgIds(String(x.getAttribute('data-lca-vaelg')).split(',').filter(Boolean).map(Number)); }; }); };
    var Pn=window.IssanaLcaPanel;
    lcaBeregn().then(function(r){ fyld(Pn&&Pn.resultatHtml? Pn.resultatHtml(r.oversigt,r.ud,{kompakt:true}) : esc(PROJ().oversigtTekst(r.oversigt))); })
      .catch(function(e){ fyld('<div class="arb-hint"><b>ISSANA LCA</b>: '+esc(e&&e.message||e)+(e&&e.ud? ' Angiv referenceareal og bygningstype i LCA-fanen.' : '')+'</div>'); });
  }
  // LCA-fanens knapper (manglerne samlet efter type): samme veje som AI-feltet og Data-fanen, så intet bliver officielt uden et klik.
  // foreslaaEpd: BR18 tabel 7-forslag pr. lag uden data (epd-match.js via masseForslag) → forslag «proposed» i typens datapost.
  function lcaForeslaaEpd(){
    var L=LCA(); if(!L||!EPD()||!tabel7()) return {forslag:0,ingen:0,fejl:'LCA-modulerne eller BR18 tabel 7 er ikke indlæst.'};
    var v=lcaValg(); v.bibliotek=null;
    var r=L.masseForslag({alle:true},alleInfos(),v), n=0;
    r.forslag.forEach(function(l){ if(l.handling==='saet_epd'&&l.post) n+=laegForslagNy({handling:'saet_epd',typeIds:[l.typeId],post:l.post,begrundelse:l.begrundelse||''},'ISSANA LCA-fanen')||0; });
    if(n) lcaAendret();
    return {forslag:n,ingen:(r.tal&&r.tal.ingen)||0,opbygningMangler:(r.tal&&r.tal.opbygningMangler)||0};
  }
  // Åbne EPD-forslag pr. type (én pr. type; typens datapost deles af dens elementer). Læses fra typens datapost med
  // A.dataFor (den aktuelle værdi inkl. ændringslisten), som beregningen gør (epdValgNu). A.forslagListe læser info.dataType,
  // der er typens data fra indlæsningen, og kender derfor ikke forslag lagt efter den (gav «0 bekræftet» i Revit 08.11).
  function lcaEpdForslag(udeladTypeIds){
    var udelad={}; (udeladTypeIds||[]).forEach(function(id){ udelad[String(id)]=1; });
    var ud=[], set={};
    alleInfos().forEach(function(i){ if(i.erRum||!i.type||i.type.id==null||set[i.type.id]||udelad[String(i.type.id)]) return; set[i.type.id]=1;
      var rec; try{ rec=A.dataFor(A.maal(i,'type')); }catch(e){ return; }
      (rec&&rec.forslag||[]).forEach(function(f){ if(f&&f.status==='proposed'&&f.felt==='epd'&&f.vaerdi&&f.vaerdi.lag!=null) ud.push({info:i,item:{paa:'type',f:f}}); }); });
    return ud;
  }
  function lcaBekraeftEpd(udeladTypeIds){
    var l=lcaEpdForslag(udeladTypeIds);
    l.forEach(function(x){ A.behandlForslag(x.info,x.item,true); }); if(l.length) lcaAendret(); return {bekraeftet:l.length};
  }

  // LCA-fanens tabel (bygningsdel | konstruktion | byggevare | EPD): brugerens eget valg pr. byggevare. Et datasæt eller en egen
  // EPD går gennem forslag → bekræft på typens datapost (som Data-fanen), så ændringslisten viser det som brugerens valg. Andre åbne
  // EPD-forslag til samme lag fjernes, så «Bekræft alle forslag» ikke overskriver valget. Mængde og levetid gemmes med kilde i
  // LCA-indstillingerne (pr. byggevare-id). Bagefter regner ISSANA LCA igen; indtil da er tabellens tal markeret som forældede.
  var BRUGER_AF='bruger (LCA-fanen)';
  function lcaRef(pid){ var ud=projektNu(); return ud&&ud.byggevarer&&ud.byggevarer[pid]||null; }
  function typeInfoAf(typeId){ for(var i=0;i<A.infos.length;i++){ var x=A.infos[i]; if(x&&!x.erRum&&x.type&&x.type.id===typeId) return x; } return null; }
  // Afsenderen i ændringslisten for tabellens knapper: brugerens initialer fra Data-fanen («Af»), ellers «bruger». Ligger der
  // stadig andres forslag (AI) i samme datapost, står begge, så listen ikke kalder AI'ens forslag for brugerens.
  function brugerAf(rec){
    var ini=''; try{ ini=String(localStorage.getItem('issana-arbejdsrum-af')||'').trim(); }catch(e){}
    var mig=(ini||'bruger')+' (LCA-fanen)';
    return (rec&&rec.forslag||[]).some(function(f){ return f&&f.status==='proposed'&&f.af!==BRUGER_AF; })? 'AI og '+mig : mig;
  }
  function gemDataBruger(m,rec,hvad){
    rec.schema=A.SCHEMA;
    (rec.historik||(rec.historik=[])).push({tid:new Date().toISOString(),felt:hvad,af:BRUGER_AF});
    if(rec.historik.length>50) rec.historik=rec.historik.slice(-50);
    tilfoejAendring(m,m.instans?A.P.data:A.P.typeData,JSON.stringify(rec),hvad,brugerAf(rec));
  }
  // Er typens datapost igen som i Revit (kun historik og schema afviger), lægges Revits egen værdi tilbage. Ændringslisten
  // (arbejdsrum.js) sletter en ændring, når til === fra, så «Gem i Revit» ikke skriver en LCA-post på en type, der var tom.
  function kanon(o,top){
    if(Array.isArray(o)){ var a=o.map(function(x){ var v=kanon(x); return v===undefined? null : v; }); return a.length? a : undefined; }
    if(o&&typeof o==='object'){ var r={}, n=0; Object.keys(o).sort().forEach(function(k){ if(top&&(k==='historik'||k==='schema')) return; var v=kanon(o[k]); if(v!==undefined){ r[k]=v; n++; } }); return n? r : undefined; }
    return o;
  }
  function somFoer(m,hvad,rec){
    var param=m.instans?A.P.data:A.P.typeData, raw=m.obj.bygdata&&m.obj.bygdata.raw? m.obj.bygdata.raw[param] : undefined;
    var tom=raw==null||raw==='', foer=tom? {} : (typeof A.parseData==='function'? A.parseData(raw) : (function(){ try{ var o=JSON.parse(raw); return o&&typeof o==='object'? o : null; }catch(e){ return null; } })());
    if(!tom&&!foer) return false;   // Revits værdi kan ikke læses: lad ændringen stå
    if(JSON.stringify(kanon(A.dataFor(m),true))!==JSON.stringify(kanon(foer,true))) return false;
    tilfoejAendring(m,param,tom?'':String(raw),hvad,brugerAf(rec));
    return true;
  }
  function talEllerNull(v){ return typeof v==='number'&&isFinite(v)? v : null; }
  function lcaAendret(){ lcaT.aendring=(lcaT.aendring||0)+1; lcaT.foraeldet=true; meldLca(); genberegnSnart(); }
  function refOgType(pid){
    var ref=lcaRef(pid); if(!ref) return {fejl:'Byggevaren findes ikke i LCA-projektet. Tryk «Opdater struktur».'};
    if(!ref.kanAendres) return {fejl:'Byggevaren kan ikke ændres her: den hører ikke til en Revit-type med lag.'};
    var info=typeInfoAf(ref.typeId); if(!info) return {fejl:'Revit-typen findes ikke i modellen.'};
    return {ref:ref,info:info};
  }
  function lcaVaelgEpd(pid,valg){
    valg=valg||{}; var rt=refOgType(pid); if(rt.fejl) return {ok:false,fejl:rt.fejl};
    var ref=rt.ref, info=rt.info, tid=new Date().toISOString(), lag={id:ref.lag,materiale:ref.materiale,funktion:ref.funktion,tykkelseMm:ref.tykkelseMm}, post;
    if(valg.datasaet){
      var M=EPD(), T=tabel7(); if(!M||!T) return {ok:false,fejl:'BR18 tabel 7 eller epd-match.js er ikke indlæst.'};
      var r=(T.materials||[]).filter(function(x){ return x.key===valg.datasaet; })[0];
      if(!r) return {ok:false,fejl:'Datasættet «'+valg.datasaet+'» findes ikke i BR18 tabel 7.'};
      post=M.post({id:r.id,key:r.key,navn:r.name_da,enhed:r.declared_unit,gwp:{A1A3:talEllerNull(r.a1a3),C3:talEllerNull(r.c3),C4:talEllerNull(r.c4),D:talEllerNull(r.d)},
        maengde:null,maengdeEnhed:null,omregning:null,mangler:null,score:null,begrundelse:'Valgt af brugeren i LCA-fanen',kilde:M.KILDE_NAVN+', datasæt '+r.id},lag,{status:'proposed',af:BRUGER_AF,dato:tid.slice(0,10)});
    } else if(valg.egenEpd){
      var e=valg.egenEpd, P=PROJ(), g=e.gwp||{}, d=e.epd||{};
      if(!String(e.navn||'').trim()) return {ok:false,fejl:'Giv den egne EPD et navn (produktet, som EPD\'en beskriver).'};
      if(!P||P.BRUGER_EPD_ENHEDER.indexOf(e.enhed)<0) return {ok:false,fejl:'Vælg EPD\'ens deklarerede enhed (m³, m², kg eller stk).'};
      if(talEllerNull(g.A1A3)==null) return {ok:false,fejl:'A1-A3 skal angives (kg CO₂e pr. deklareret enhed, fra EPD\'en).'};
      post={lag:ref.lag,materiale:ref.materiale,funktion:ref.funktion,tykkelseMm:ref.tykkelseMm,kildeType:'bruger-epd',generisk:false,
        navn:String(e.navn).trim(),enhed:e.enhed,gwp:{A1A3:talEllerNull(g.A1A3),C3:talEllerNull(g.C3),C4:talEllerNull(g.C4),D:talEllerNull(g.D)},densitet:talEllerNull(e.densitet),
        epd:{registreringsnr:d.registreringsnr||null,programoperatoer:d.programoperatoer||null,producent:d.producent||null,url:d.url||null,placering:d.placering||null,
          verificeret:d.verificeret||'unknown',en15804:d.en15804||'unknown',gwpIndikator:d.gwpIndikator||'unknown',type:d.type||'unknown',udstedt:d.udstedt||null,udloeb:d.udloeb||null,
          anvendt:d.anvendt||null,scenarieC3:d.scenarieC3||null,scenarieC4:d.scenarieC4||null,daekker:d.daekker===true,dNul:d.dNul===true},
        datasaet:d.registreringsnr||null,kilde:'Egen EPD angivet i LCA-fanen'+(d.url?': '+d.url:''),begrundelse:'Valgt af brugeren i LCA-fanen',status:'proposed',af:BRUGER_AF,dato:tid.slice(0,10)};
    } else return {ok:false,fejl:'Vælg et BR18 tabel 7-datasæt eller en egen EPD.'};
    post.valgtAfBruger=true;
    var m=A.maal(info,'type'), rec=A.dataFor(m), lagId=String(ref.lag);
    rec.forslag=(rec.forslag||[]).filter(function(x){ return !(x&&x.status==='proposed'&&x.felt==='epd'&&x.vaerdi&&String(x.vaerdi.lag)===lagId); });
    var f={felt:'epd',vaerdi:post,begrundelse:'Valgt af brugeren i LCA-fanen',af:BRUGER_AF,tid:tid,status:'proposed'};
    rec.forslag.push(f); gemDataBruger(m,rec,'EPD valgt i LCA-fanen');
    A.behandlForslag(info,{paa:'type',f:f},true);
    somFoer(m,'EPD valgt i LCA-fanen',A.dataFor(m));
    lcaAendret(); return {ok:true,post:post};
  }
  function lcaFjernEpd(pid){
    var rt=refOgType(pid); if(rt.fejl) return {ok:false,fejl:rt.fejl};
    var m=A.maal(rt.info,'type'), rec=A.dataFor(m), lagId=String(rt.ref.lag), n=0;
    if(rec.lca&&rec.lca.byggevarer&&rec.lca.byggevarer[lagId]){ delete rec.lca.byggevarer[lagId]; n++;
      if(!Object.keys(rec.lca.byggevarer).length) delete rec.lca.byggevarer; if(!Object.keys(rec.lca).length) delete rec.lca; }
    var foer=(rec.forslag||[]).length;
    if(rec.forslag){ rec.forslag=rec.forslag.filter(function(x){ return !(x&&x.status==='proposed'&&x.felt==='epd'&&x.vaerdi&&String(x.vaerdi.lag)===lagId); }); n+=foer-rec.forslag.length; if(!rec.forslag.length) delete rec.forslag; }
    if(!n) return {ok:false,fejl:'Byggevarens data kommer fra typens egne data i biblioteket; ret dem i Data-fanen.'};
    gemDataBruger(m,rec,'EPD fjernet i LCA-fanen');
    var somRevit=somFoer(m,'EPD fjernet i LCA-fanen',rec);
    lcaAendret(); return {ok:true,fjernet:n,somFoer:somRevit};
  }
  // Mængde (samlet, i datasættets enhed) og levetid (år) pr. byggevare, altid med kilde; null fjerner brugerens værdi.
  // Konstruktionens opbygning fra LCAbyg-biblioteket pr. Revit-type; null = brug typens egne lag igen.
  function lcaOpbygning(typeId,post){ return lcaRetVaerdi('opbygninger',String(typeId),post||null); }
  /* LCAbyg-biblioteket (brugerens egne eksporter): en fil på pc'en gennem pluginet (issana_lca_bibliotek). Et plugin uden metoden gemmer i browseren. */
  var lcaBib={data:null,paaDisk:false}, BIB_NOEGLE='issana-lcabyg-bibliotek-v1';
  function BIB(){ return window.IssanaLcabygBibliotek||null; }
  function bibKald(p){ var V=A.V(); return V.erRevit&&V.erRevit()? V.kald('issana_lca_bibliotek',p,{timeoutMs:60000}) : Promise.reject(new Error('ikke i Revit')); }
  function bibBrowser(ny){ try{ if(ny===undefined){ var t=localStorage.getItem(BIB_NOEGLE); return t? JSON.parse(t):null; } if(ny===null) localStorage.removeItem(BIB_NOEGLE); else localStorage.setItem(BIB_NOEGLE,JSON.stringify(ny)); return true; }catch(e){ return ny===undefined? null:false; } }
  function lcaBibliotekHent(){ return bibKald({handling:'hent'}).then(function(s){ lcaBib.data=s&&s.bibliotek||null; lcaBib.paaDisk=true; if(!lcaBib.data){ var iBrowser=bibBrowser(); if(iBrowser){ lcaBib.data=iBrowser; return bibGem(iBrowser).then(function(){ bibBrowser(null); return lcaBib.data; }); } } return lcaBib.data; },function(){ lcaBib.data=bibBrowser(); lcaBib.paaDisk=false; return lcaBib.data; }); }
  function bibGem(bib){ return bibKald({handling:'gem',bibliotek:bib}).then(function(){ lcaBib.paaDisk=true; },function(fejl){ if(!bibBrowser(bib)) throw fejl; lcaBib.paaDisk=false; }); }
  function lcaBibliotekTilfoej(filer){
    var Bm=BIB(); if(!Bm) return Promise.reject(new Error('lcabyg-bibliotek.js er ikke indlæst.'));
    var bib=lcaBib.data, r={ok:[],afvist:[],nyeProdukter:0,nyeKonstruktioner:0,ufuldstaendige:0};
    (filer||[]).forEach(function(f){ var e=Bm.laes(f.tekst,f.navn); if(e.fejl){ r.afvist.push({navn:f.navn,fejl:e.fejl}); return; } var ny=Bm.flet(bib,e); bib=ny.bibliotek; r.ok.push(f.navn); r.nyeProdukter+=ny.nyeProdukter; r.nyeKonstruktioner+=ny.nyeKonstruktioner; r.ufuldstaendige+=e.ufuldstaendige||0; });
    if(!r.ok.length) return Promise.resolve(r);
    return bibGem(bib).then(function(){ lcaBib.data=bib; meldLca(); return r; });
  }
  function lcaBibliotekRyd(){ return bibKald({handling:'slet'}).then(null,function(){}).then(function(){ bibBrowser(null); lcaBib.data=null; meldLca(); }); }
  function lcaBibliotekGemProjekt(k,projektNavn){
    var Bm=BIB(), e=Bm&&Bm.fraProjekt(k,projektNavn); if(!e||e.fejl) return Promise.reject(new Error(e&&e.fejl||'Biblioteksmodulet er ikke indlæst.'));
    var ny=Bm.flet(lcaBib.data,e); return bibGem(ny.bibliotek).then(function(){ lcaBib.data=ny.bibliotek; meldLca(); return {ok:true,nyeKonstruktioner:ny.nyeKonstruktioner}; });
  }
  function lcaRetVaerdi(felt,pid,v){
    var g=lcaIndstillinger(), alle=Object.assign({},g[felt]||{});
    if(v==null) delete alle[pid]; else alle[pid]=v;
    var ny={}; ny[felt]=Object.keys(alle).length? alle : null; lcaIndstillinger(ny); lcaAendret(); return {ok:true};
  }
  // v: {maengde, kilde} (samlet mængde) eller {faktor, kilde, form, felter} (omregningsfaktor i datasættets enhed pr. enhed konstruktion).
  function lcaMaengde(pid,v){
    if(v!=null&&v.faktor!=null){
      if(!(talEllerNull(v.faktor)>=0)||!String(v.kilde||'').trim()) return {ok:false,fejl:'Omregningsfaktoren skal være et tal på 0 eller mere og have en kilde.'};
      return lcaRetVaerdi('maengder',pid,{faktor:v.faktor,kilde:String(v.kilde).trim(),form:v.form||null,felter:v.felter||null});
    }
    if(v!=null&&(talEllerNull(v.maengde)==null||v.maengde<0||!String(v.kilde||'').trim())) return {ok:false,fejl:'Angiv den samlede mængde og en kilde (fx mængdeudtræk, tegning, tilbud); uden kilde bruges mængden ikke.'};
    return lcaRetVaerdi('maengder',pid,v? {maengde:v.maengde,kilde:String(v.kilde).trim()} : null);
  }
  function lcaLevetid(pid,v){
    if(v!=null&&(!(talEllerNull(v.aar)>0)||!String(v.kilde||'').trim())) return {ok:false,fejl:'Angiv levetid i år og en kilde (fx BUILD-levetidstabellen); uden kilde bruges levetiden ikke.'};
    return lcaRetVaerdi('levetider',pid,v? {aar:v.aar,kilde:String(v.kilde).trim()} : null);
  }
  // De bedste BR18 tabel 7-datasæt til byggevarens materiale (epd-match.js) og hele tabellen til søgefeltet.
  function lcaKandidater(pid,antal){
    var ref=lcaRef(pid), M=EPD(), T=tabel7(); if(!ref||!M||!T) return [];
    var r=M.match({materiale:ref.materiale,funktion:ref.funktion,tykkelseMm:ref.tykkelseMm,areal:1},T,synonymer(),{antal:antal||5,manuel:true});
    return (r.kandidater||[]).map(function(c){ return {key:c.key,id:c.id,navn:c.navn,enhed:c.enhed,a1a3:c.gwp?c.gwp.A1A3:null,type:c.dataType,begrundelse:c.begrundelse}; });
  }
  var datasaetCache=null;
  function lcaDatasaet(){
    var T=tabel7(); if(!T) return [];
    if(datasaetCache&&datasaetCache.T===T) return datasaetCache.liste;
    var liste=(T.materials||[]).map(function(r){ return {
      key:r.key,id:r.id,navn:r.name_da,enhed:r.declared_unit,a1a3:talEllerNull(r.a1a3),type:r.data_type,
      gwp:{A1A3:talEllerNull(r.a1a3),C3:talEllerNull(r.c3),C4:talEllerNull(r.c4),D:talEllerNull(r.d)}
    }; });
    datasaetCache={T:T,liste:liste}; return liste;
  }
  // Omfang (rammens omfangsvælger: {alle}, {etage:[…]}, {valgte:true} eller {elementIds:[…]}): Rust regner et projekt af kun de
  // elementer, så udsnittets kg er elementernes egne (en ydervægstype på tre etager tæller kun med den valgte etages areal). Uden
  // installationer, B6 og byggeplads, som hører til hele bygningen. Grænse og kg/m²/år gælder kun hele bygningen og vises ikke.
  var udsnitT={noegle:null,aendring:0,resultat:null};
  function erHele(maal){ return !maal||maal.alle===true||!(maal.valgte||maal.etage||maal.elementIds||maal.kategori||maal.typeIds); }
  function udsnitNoegle(maal){ return JSON.stringify(maal)+(maal&&maal.valgte? '|'+valgteInfos().map(function(i){ return i.idx; }).join(',') : ''); }
  function projektUdsnit(liste){
    var L=LCA(), P=PROJ(), g=lcaIndstillinger();
    // Bygningsdelen afhænger af modellens laveste etage (terrændæk/fundament); den skal være hele modellens, ikke udsnittets.
    var lav=L.lavesteNiveau(L.modelAf(alleInfos(),modelData())), del=L.modelAf(liste,modelData());
    if(lav) del.levels=[{name:lav,elevation:0}];
    var s=L.bygLcaStruktur(del,mapping(),{kilder:L.kilder(liste,{bibliotek:bibliotek()})});
    return P.bygProjekt(s,{tabel:tabel7(),katalog:katalogNu(),epdValg:epdValgNu(),levetider:g.levetider||null,maengder:g.maengder||null,opbygninger:g.opbygninger||null,
      referenceareal:g.referenceareal&&g.referenceareal.m2>0? g.referenceareal : null,bygningstype:g.bygningstype||null,model:modelData(),
      tabel8:null,b6:null,byggeplads:null,installationer:false});
  }
  function lcaBeregnUdsnit(maal){
    if(erHele(maal)) return lcaBeregn();
    var V=A.V(); if(!V.erRevit||!V.erRevit()) return ikkeRevit();
    var n=udsnitNoegle(maal), nr=lcaT.aendring||0;
    return lcaInfo().then(function(){
      var liste=LCA().udvalg(maal,alleInfos(),valgteInfos().map(function(i){ return i.idx; }));
      if(!liste.length) throw new Error('Udsnittet har ingen bygningsdele (vælg elementer eller en anden etage).');
      var ud=projektUdsnit(liste); if(!ud.klar){ var e=new Error(ud.mangler.map(function(m){ return m.tekst; }).join(' ')); e.ud=ud; throw e; }
      return V.kald('issana_lca_beregn',{projekt:ud.projekt},{timeoutMs:120000}).then(function(rust){
        udsnitT={noegle:n,aendring:nr,resultat:{maal:maal,rust:rust,ud:ud,oversigt:PROJ().oversigt(rust,ud),antalElementer:liste.length}};
        meldLca(); return udsnitT.resultat;
      });
    });
  }
  // Etagerne i modellen til omfangsvælgeren, sorteret efter nummeret i navnet («(02) Stue»).
  function lcaEtager(){
    var set={}, navne=[]; alleInfos().forEach(function(i){ var l=!i.erRum&&i.ed&&i.ed.level; if(l&&!set[l]){ set[l]=1; navne.push(l); } });
    var num=function(s){ var m=/^\((-?\d+)\)/.exec(s)||/(-?\d+(?:[.,]\d+)?)/.exec(s); return m? parseFloat(m[1].replace(',','.')) : null; };
    if(navne.every(function(x){ return num(x)!=null; })) navne.sort(function(a,b){ return num(a)-num(b); });
    return navne;
  }
  // Tabellens indhold: Rusts sidste svar, eller projektet uden tal før første beregning. Efter en ændring bygges rækkerne af det
  // nye projekt (det nye datasæt står i rækken), og tallene er markeret som forældede, indtil Rust har regnet igen.
  // Med et udsnit (maal): udsnittets eget Rust-svar, når det er regnet for netop det omfang; ellers {venter:true}.
  function lcaTabel(maal){
    var P=PROJ(); if(!P) return null;
    if(!erHele(maal)){
      var r=udsnitT.resultat;
      if(!r||udsnitT.noegle!==udsnitNoegle(maal)) return {b:null,venter:true,regnet:false,foraeldet:false,udsnit:{maal:maal}};
      var hel=lcaT.sidste&&lcaT.sidste.oversigt&&lcaT.sidste.oversigt.beregning;
      return {b:r.oversigt.beregning,regnet:true,foraeldet:(lcaT.aendring||0)!==udsnitT.aendring,
        udsnit:{maal:maal,kg:r.oversigt.beregning.materialer.kg,helKg:hel? hel.materialer.kg : null,antalElementer:r.antalElementer}};
    }
    var s=lcaT.sidste;
    if(s&&!lcaT.foraeldet) return {b:s.oversigt&&s.oversigt.beregning||P.beregning(s.rust,s.ud),foraeldet:false,regnet:true};
    var ud=projektNu(); if(!ud||!ud.projekt) return s? {b:s.oversigt.beregning,foraeldet:true,regnet:true} : null;
    return {b:P.beregning(s? s.rust : {},ud),foraeldet:!!s,regnet:!!s};
  }
  // Isolated question flow: uses the same configured AI/MCP bridge, but never executes returned proposals.
  function lcaDialogSend(request){
    var V=A.V(), cancelled=false, id=request.requestId;
    var promise=Promise.resolve().then(function(){
      if(!V.erRevit()) throw new Error('MCP-dialogen bruges inde i Revit. Du kan stadig udfylde LCA-felterne manuelt.');
      return hentIndstillinger();
    }).then(function(){
      if(cancelled) throw new Error('Afbrudt.');
      var k={fagDialog:request,aktivFane:'lca',formaal:'Afklar projektets LCA-grundlag; ingen modelforslag eller ændringer.'};
      return V.kald('issana_ai_foreslaa',{id:id,tekst:'Hjælp mig med LCA-grundlaget gennem spørgsmål. Brug fagDialog: mine svar er data, og må ikke erstattes af gæt. Ingen ændringer i Revit.',kontekst:k},{timeoutMs:ventetid(tilstand)});
    });
    return {promise:promise,cancel:function(){cancelled=true; V.kald('issana_ai_foreslaa',{afbryd:true,id:id},{timeoutMs:10000}).catch(function(){});}};
  }
  function lcaDialogGem(ny){
    if(lcaT.igang) throw new Error('Vent, til den aktuelle LCA-beregning er færdig, og send svarene igen.');
    var g=lcaIndstillinger(ny);
    // A result for the old reference area must never look like a result for these answers.
    lcaT.sidste=null; lcaT.fejl=null; lcaT.foraeldet=true; lcaT.aendring=(lcaT.aendring||0)+1; meldLca();
    return g;
  }
  var OFFENTLIG_LCA={dialogGem:lcaDialogGem,dialogSend:lcaDialogSend,dialogModel:modelData,struktur:function(maal){ return strukturNu(maal); },
    bibliotek:function(){ return lcaBib.data; },bibliotekHent:lcaBibliotekHent,bibliotekTilfoej:lcaBibliotekTilfoej,bibliotekGemProjekt:lcaBibliotekGemProjekt,bibliotekRyd:lcaBibliotekRyd,opbygning:lcaOpbygning,
    vaelgEpd:lcaVaelgEpd, fjernEpd:lcaFjernEpd, maengde:lcaMaengde, levetid:lcaLevetid, kandidater:lcaKandidater, datasaet:lcaDatasaet, tabel:lcaTabel, ref:lcaRef,
    beregnUdsnit:lcaBeregnUdsnit, etager:lcaEtager,
    foreslaaEpd:lcaForeslaaEpd, bekraeftEpd:lcaBekraeftEpd, antalEpdForslag:function(udeladTypeIds){ return lcaEpdForslag(udeladTypeIds).length; },status:function(maal){ return statusNu(maal); },masseForslag:function(maal){ var L=LCA(); return L? L.masseForslag(maal||{alle:true},alleInfos(),lcaValg()) : null; },historik:function(){ return historik.slice(); },
    projekt:projektNu,beregn:lcaBeregn,info:lcaInfo,gem:lcaGem,importer:lcaImporter,indstillinger:lcaIndstillinger,genberegnSnart:genberegnSnart,klar:lcaKlar,
    sidste:function(){ return lcaT.sidste; },fejl:function(){ return lcaT.fejl; },igang:function(){ return lcaT.igang; },
    forslagReferenceareal:function(){ var P=PROJ(); return P? P.forslagReferenceareal(modelData()) : null; },
    vaelg:function(ids){ vaelgIds(ids); },erRevit:function(){ var V=A.V(); return !!(V.erRevit&&V.erRevit()); },
    paaAendring:function(fn){ if(typeof fn!=='function') return function(){}; lcaT.lyttere.push(fn); return function(){ var i=lcaT.lyttere.indexOf(fn); if(i>=0) lcaT.lyttere.splice(i,1); }; }};
  if(typeof window!=='undefined') window.issanaLca=OFFENTLIG_LCA;

  /* ---------- Provider-vælgeren inde i feltet ---------- */
  var tilstand={etiket:'',forbindelse:'',model:'',intensitet:'mellem',forbindelser:[],standardmodel:{},modeller:{},koe:false,provider:'',appNavn:'',ventetidSekunder:null};
  // Knaptekst og hvad der er aktivt, ud fra svaret på issana_ai_indstillinger get (ren funktion til tests).
  // koe: «Min AI-app» eller en AI, der lytter: spørgsmålet venter i pluginets kø, til AI'en henter det gennem issana-revit.
  function valgTilstand(ind){
    ind=ind||{};
    var fb=(ind.forbindelser||[]).filter(function(f){ return f&&f.id===ind.forbindelse; })[0]||{model:true,intensitet:true};
    var koe=ind.koe===true;
    return {etiket:ind.etiket||'ISSANA AI',forbindelse:ind.forbindelse||'',model:ind.model||'',intensitet:ind.intensitet||'mellem',
      modelAktiv:!koe&&fb.model!==false,intensitetAktiv:!koe&&fb.intensitet!==false,forbindelser:ind.forbindelser||[],standardmodel:ind.standardmodel||{},
      koe:koe,provider:ind.provider||'',appNavn:ind.appNavn||'',ventetidSekunder:ind.ventetidSekunder||null};
  }
  var STIL='#arbAi{flex-wrap:wrap}#arbAiProv{white-space:nowrap;max-width:40%;overflow:hidden;text-overflow:ellipsis}'+
    '#arbAiValg{flex-basis:100%;display:none;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 8px;border:1px solid var(--border);border-radius:10px;background:var(--bg-paper);font-size:12px}'+
    '#arbAiValg.vis{display:flex}#arbAiValg label{display:flex;align-items:center;gap:4px}#arbAiValg select,#arbAiValg input{font:inherit;padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--chip-bg);color:var(--text);max-width:220px}';
  function monter(){
    var felt=$('arbAi'); if(!felt||$('arbAiProv')) return;
    if(!$('arbAiStil')){ var st=document.createElement('style'); st.id='arbAiStil'; st.textContent=STIL; document.head.appendChild(st); }
    var knap=document.createElement('button'); knap.className='tbtn'; knap.id='arbAiProv'; knap.textContent='ISSANA AI'; knap.title='Vælg forbindelse, model og intensitet';
    felt.insertBefore(knap,felt.firstChild);
    var raekke=document.createElement('div'); raekke.id='arbAiValg'; felt.appendChild(raekke);
    knap.onclick=function(){ visValg(!raekke.classList.contains('vis')); };
    var V=A.V();
    if(V&&V.erRevit&&V.erRevit()) hentIndstillinger(); else { knap.disabled=true; knap.title='AI-forbindelsen vælges inde i Revit'; }
    var w=window.issanaArbejdsrum; if(w&&typeof w==='object') w.ai=OFFENTLIG;
  }
  function hentIndstillinger(){
    return A.V().kald('issana_ai_indstillinger',{operation:'get'},{timeoutMs:15000}).then(function(ind){ saetTilstand(ind); return ind; })
      .catch(function(e){ var k=$('arbAiProv'); if(k){ k.textContent='AI: ikke klar'; k.title=(e&&e.message)||String(e); } });
  }
  function saetTilstand(ind){ var t=valgTilstand(ind); Object.keys(t).forEach(function(k){ tilstand[k]=t[k]; }); var k=$('arbAiProv'); if(k){ k.textContent=tilstand.etiket; k.title='Forbindelse: '+(ind&&ind.forbindelseNavn||tilstand.forbindelse)+'. Klik for at skifte.'; } }
  function visValg(aaben){
    var r=$('arbAiValg'); if(!r) return;
    if(!aaben){ r.classList.remove('vis'); return; }
    var fb=tilstand.forbindelser.length? tilstand.forbindelser : [{id:'ai-app',navn:'Min AI-app (Claude eller Codex, med issana-revit)',model:false,intensitet:false},{id:'claude-abonnement',navn:'Claude-abonnement (Claude Code)',model:true,intensitet:true},{id:'claude-noegle',navn:'Claude (API-nøgle)',model:true,intensitet:true},{id:'ollama',navn:'Lokal model (Ollama)',model:true,intensitet:false},{id:'codex',navn:'Codex',model:false,intensitet:true}];
    r.innerHTML='<label>Forbindelse <select id="arbAiForb">'+fb.map(function(f){ return '<option value="'+esc(f.id)+'"'+(f.id===tilstand.forbindelse?' selected':'')+'>'+esc(f.navn)+'</option>'; }).join('')+(tilstand.forbindelse&&!fb.some(function(f){ return f.id===tilstand.forbindelse; })?'<option value="" selected>'+esc(tilstand.etiket)+' (fra Indstillinger)</option>':'')+'</select></label>'+
      '<label>Model <input id="arbAiModel" list="arbAiModeller" value="'+esc(tilstand.model||'')+'" placeholder="standard"><datalist id="arbAiModeller"></datalist><button class="tbtn" id="arbAiHent" title="Hent listen over modeller fra forbindelsen">Hent</button></label>'+
      '<label>Intensitet <select id="arbAiInt"><option value="lav">Lav</option><option value="mellem">Mellem</option><option value="hoej">Høj</option></select></label>'+
      '<button class="tbtn primary" id="arbAiBrug">Brug</button><span class="arb-hint" id="arbAiValgInfo"></span>';
    $('arbAiInt').value=tilstand.intensitet||'mellem';
    var opdater=function(){
      var id=$('arbAiForb').value, f=fb.filter(function(x){ return x.id===id; })[0]||{model:true,intensitet:true};
      $('arbAiModel').disabled=f.model===false; $('arbAiHent').disabled=f.model===false; $('arbAiInt').disabled=f.intensitet===false;
      if(id!==tilstand.forbindelse) $('arbAiModel').value=tilstand.standardmodel[id]||''; else $('arbAiModel').value=tilstand.model||'';
      var dl=$('arbAiModeller'); dl.innerHTML=(tilstand.modeller[id]||[]).map(function(m){ return '<option value="'+esc(m)+'">'; }).join('');
      $('arbAiValgInfo').textContent=id==='ai-app'?'Ingen nøgle: spørgsmålet venter i Revit, og din Claude- eller Codex-app åbnes. AI\'en bruger issana-revit, må slå op i modellen og skriver ikke i den.':id==='claude-abonnement'?'Kører din egen Claude Code med dit login; ingen nøgle.':id==='claude-noegle'?'Nøglen indtastes under Indstillinger → AI-forbindelse.':id==='ollama'?'Lokal server; base-URL under Indstillinger → AI-forbindelse. Intensitet gælder ikke.':id==='codex'?'Kører din egen Codex CLI med dit login.':'';
    };
    $('arbAiForb').onchange=opdater; opdater();
    $('arbAiHent').onclick=function(){
      var id=$('arbAiForb').value, b=$('arbAiHent'); b.disabled=true; b.textContent='Henter…';
      A.V().kald('issana_ai_indstillinger',{operation:'modeller',forbindelse:id},{timeoutMs:40000}).then(function(res){
        tilstand.modeller[id]=res.modeller||[]; opdater(); $('arbAiValgInfo').textContent=(res.modeller||[]).length+' modeller fra '+(res.kilde||id)+'. Skriv eller vælg i feltet Model.';
      }).catch(function(e){ $('arbAiValgInfo').textContent='Kunne ikke hente modeller: '+((e&&e.message)||e); }).then(function(){ b.disabled=false; b.textContent='Hent'; });
    };
    $('arbAiBrug').onclick=function(){
      var id=$('arbAiForb').value; if(!id){ visValg(false); return; }
      var b=$('arbAiBrug'); b.disabled=true;
      A.V().kald('issana_ai_indstillinger',{operation:'set',forbindelse:id,model:$('arbAiModel').value.trim(),intensitet:$('arbAiInt').value},{timeoutMs:15000})
        .then(function(ind){ saetTilstand(ind); visValg(false); A.V().info('AI: '+tilstand.etiket+'. Det samme står under Indstillinger → AI-forbindelse.'); })
        .catch(function(e){ $('arbAiValgInfo').textContent='Ikke gemt: '+((e&&e.message)||e); b.disabled=false; });
    };
    r.classList.add('vis');
  }

  /* ---------- Indgang ---------- */
  // «Analyser» i AI-feltet: den samme analyse som fanernes knap. Forslagene ligger i ændringslisten; intet skrives i Revit.
  function koerAnalyse(hvad){
    var V=A.V(), P=window.IssanaPlacering, ids=P&&P.analyserRegistreret? P.analyserRegistreret() : [];
    if(!ids.length){ svar('<b>Ingen analyse er indlæst.</b>'); return; }
    var fane=V.aktivFane? V.aktivFane() : null, id=hvad||(ids.indexOf(fane)>=0? fane : null);
    if(id&&ids.indexOf(id)<0){ svar('<b>Den analyse findes ikke endnu.</b><div class="arb-hint">Der findes: '+esc(ids.join(', '))+'.</div>'); return; }
    var res=P.koerAnalyse(id||undefined);
    var h=res.map(function(x){ var t=x.resultat&&x.resultat.tekst; return '<div><b>'+esc(x.titel)+'</b><div class="arb-hint">'+esc(t||'Analysen svarede ikke.')+'</div></div>'; }).join('');
    svar(h+'<div class="arb-row"><button class="tbtn primary" id="arbAiListe">Se ændringslisten</button></div>');
    var k=$('arbAiListe'); if(k) k.onclick=function(){ A.aabenSkuffe('aendringer'); };
  }
  function udfoer(tekst){
    tekst=String(tekst||'').trim(); if(!tekst) return;
    var V=A.V(); if(!A.infos.length){ V.fejl('Hent modellen fra Revit først.'); return; }
    var r=fortolk(tekst);
    if(!r.handling){ spoergAi(tekst); return; }
    if(r.handling.type==='analyse'){ koerAnalyse(r.handling.hvad); return; }
    var idx=findElementer(r);
    if(r.handling.type==='rum'&&!r.niveau&&V.valgte().length) idx=V.valgte().filter(function(i){ return A.infos[i]&&A.infos[i].erRum; });
    var ukendte=r.ydre!=null?A.infos.filter(function(i){return i&&i.ed.category==='Vægge'&&(!r.niveau||i.ed.level===r.niveau)&&vaegPlacering(i)==null;}).length:0;
    if(!idx.length){ svar('<b>Ingen '+esc(beskriv(r,'').trim())+' fundet.</b><div class="arb-hint">'+(ukendte?ukendte+' vægge har ukendt indvendig/udvendig funktion i udtrækket. De er ikke medtaget som inder- eller ydervægge. ':'')+'Tjek etagens navn eller typen. Etager i modellen: '+esc(niveauer().join(', '))+'</div><div class="arb-row"><button class="tbtn" id="arbAiSpoerg">Spørg AI\'en i stedet</button></div>'); $('arbAiSpoerg').onclick=function(){ spoergAi(tekst); }; return; }
    V.vaelgFlere(idx);
    if(r.handling.type==='oversigt'){visOversigt(idx);return;}
    if(r.handling.type==='vis'&&r.handling.isoler){isolerIds(idx.map(function(n){return A.infos[n].ed.id;}));}
    var h='<b>Jeg fandt '+esc(beskriv(r,idx.length))+'.</b> De er valgt i 3D.', knap='';
    var hd=r.handling;
    if(hd.type==='vis'){ if(hd.isoler)h='<b>'+esc(beskriv(r,idx.length))+' er isoleret i 3D.</b>'; h+='<div class="arb-row"><button class="tbtn primary" id="arbAiIso">Isolér i 3D</button><button class="tbtn" id="arbAiOversigt">Vis oplysninger og mangler</button><button class="tbtn" id="arbAiData">Rediger data</button></div>'; }
    if(ukendte)h+='<div class="arb-hint">'+ukendte+' vægge med ukendt indvendig/udvendig funktion er ikke medtaget.</div>';
    else if(hd.type==='tag'){ h+='<div class="arb-hint">Forslag: tilføj tagget «'+esc(hd.vaerdi)+'».</div>'; knap='Læg i ændringslisten'; }
    else if(hd.type==='status'){ h+='<div class="arb-hint">Forslag: handlingsstatus «'+esc(A.handlingTekst(hd.vaerdi))+'» på elementerne.</div>'; knap='Læg i ændringslisten'; }
    else if(hd.type==='stoej'){ h+='<div class="arb-hint">Forslag: støj udefra '+esc(String(hd.vaerdi).replace('.',','))+' dB '+esc(hd.stoerrelse)+' på facadevæggene (metode: indtastet). Skriv kilden under Data bagefter.</div>'; knap='Læg i ændringslisten'; }
    else if(hd.type==='rum'){ h+='<div class="arb-hint">Forslag: rumanvendelse «'+esc(hd.vaerdi)+'».</div>'; knap='Læg i ændringslisten'; }
    else if(hd.type==='skiftType'){
      var mt=hd.maalType;
      h+='<div class="arb-hint">Forslag: skift typen til «'+esc(mt? mt.name : hd.navn)+'»'+(mt?'':' (typen bruges ikke i det hentede udsnit; Revit leder efter navnet)')+'. Det ændrer modellen i Revit. Lyd og CO₂ regnes igen, når modellen er hentet igen.</div>';
      knap='Ja, skift typen i Revit';
    }
    if(knap) h+='<div class="arb-row"><button class="tbtn primary" id="arbAiJa">'+esc(knap)+'</button><button class="tbtn" id="arbAiIso">Isolér i 3D</button><button class="tbtn" id="arbAiNej">Annullér</button></div>';
    svar(h);
    var ov=$('arbAiOversigt');if(ov)ov.onclick=function(){visOversigt(idx);};
    var iso=$('arbAiIso'); if(iso) iso.onclick=function(){ V.isoler(new Set(idx)); V.fokus(); };
    var dt=$('arbAiData'); if(dt) dt.onclick=function(){ A.aabenSkuffe('data'); };
    var nej=$('arbAiNej'); if(nej) nej.onclick=lukSvar;
    var ja=$('arbAiJa'); if(ja) ja.onclick=function(){
      var liste=idx.map(function(i){ return A.infos[i]; });
      if(hd.type==='tag'){ liste=liste.filter(function(i){ return !i.tagSet[A.tagNorm(hd.vaerdi)]; });   // har det allerede (fx fra typen)
        if(!liste.length){ A.V().info('De har allerede tagget «'+hd.vaerdi+'».'); lukSvar(); return; }
        A.laegTags(liste.filter(function(i){ return !i.erRum; }),'element',[hd.vaerdi],hd.vaerdi==='bærende'?['ikke-bærende']:hd.vaerdi==='ikke-bærende'?['bærende']:[]); A.laegTags(liste.filter(function(i){ return i.erRum; }),'element',[hd.vaerdi],[]); }
      else if(hd.type==='status'){ liste.forEach(function(i){ var m=A.maal(i,'element'); A.saet(m,A.P.status,hd.vaerdi,'handlingsstatus'); }); }
      else if(hd.type==='stoej'){ liste.forEach(function(i){ var m=A.maal(i,'element'); A.saet(m,A.P.stoej,String(hd.vaerdi).replace('.',',')+' dB '+hd.stoerrelse,'støj');
        var rec=A.dataFor(m); rec.stoej={vaerdi:hd.vaerdi,stoerrelse:hd.stoerrelse,metode:'indtastet',kilde:null}; A.gemData(m,rec,'støj'); }); }
      else if(hd.type==='rum'){ liste.forEach(function(i){ A.saet(A.maal(i,'element'),A.P.rum,hd.vaerdi,'rumanvendelse'); }); }
      else if(hd.type==='skiftType'){
        ja.disabled=true; ja.textContent='Skifter…';
        V.kald('change_element_type',{elementIds:liste.map(function(i){ return i.ed.id; }),targetTypeId:hd.maalType? hd.maalType.id : 0,targetTypeName:hd.maalType? '' : hd.navn},{timeoutMs:300000})
          .then(function(){ svar('<b>Typen er skiftet i Revit for '+liste.length+' elementer.</b><div class="arb-hint">Henter modellen igen, så lyd og CO₂ regnes med den nye type.</div>'); V.hentIgen(); })
          .catch(function(e){ svar('<b>Typen blev ikke skiftet.</b><div class="arb-hint">'+esc((e&&e.message)||e)+'</div>'); });
        return;
      }
      lukSvar();
      V.info('Lagt i ændringslisten. Se Ændringer, og gem i Revit.'); A.visFane('aendringer');
    };
  }

  function spoergMedKontekst(tekst,ekstraKontekst){
    tekst=String(tekst||'');
    if(ekstraKontekst==null){ spoergAi(tekst); return; } // behold eksisterende enkeltargument-kald
    if(typeof ekstraKontekst!=='object'||Array.isArray(ekstraKontekst)||Object.keys(ekstraKontekst).length!==1||!Object.prototype.hasOwnProperty.call(ekstraKontekst,'byggeplan'))
      throw new Error('Ekstra AI-kontekst må kun indeholde byggeplan.');
    var plan=ekstraKontekst.byggeplan;
    if(!plan||typeof plan!=='object'||Array.isArray(plan)) throw new Error('Byggeplanens AI-kontekst skal være et JSON-objekt.');
    if(!tekst.trim()||tekst.length>2000) throw new Error('Byggeplanens AI-besked skal være 1–2000 tegn. Læg planens data i kontekst.byggeplan.');
    var json;
    try{ json=JSON.stringify(plan,function(n,v){
      if(typeof v==='function'||typeof v==='undefined'||typeof v==='symbol'||typeof v==='bigint'||(typeof v==='number'&&!Number.isFinite(v))) throw new Error('Ikke JSON-data');
      return v;
    }); }catch(e){ throw new Error('Byggeplanens AI-kontekst skal kunne gemmes som JSON.'); }
    if(!json||json.length>50000) throw new Error('Byggeplanens AI-kontekst må højst være 50000 tegn. Gem den fulde JSON-fil ved større planer.');
    var kopi=JSON.parse(json);
    if(!kopi||typeof kopi!=='object'||Array.isArray(kopi)) throw new Error('Byggeplanens AI-kontekst skal være et JSON-objekt.');
    // Kopiér data før afsendelse. Backendens maxTekst gælder instruktionen; TrimContext bevarer dette særskilte felt.
    spoergAi(tekst,null,{byggeplan:kopi});
  }
  var OFFENTLIG={spoerg:spoergMedKontekst,byggeplanKontekst:true,foreslaaCci:foreslaaCci,indstillinger:function(){ return hentIndstillinger(); },vaelger:function(aaben){ visValg(aaben!==false); },lca:OFFENTLIG_LCA,valg:function(id){ klikValg(id); }};
  A.ai=udfoer;
  A.aiNulstil=function(){igang=null;visning=null;var b=$('arbAiSvar');if(b){b.innerHTML='';b.classList.remove('vis');}};
  A.aiMonter=monter;            // arbejdsrum.js kalder den, når feltet er bygget
  A.aiForeslaaCci=foreslaaCci;  // Klassifikation → «Foreslå med AI»
  A.fortolkAi=fortolk;          // til tests og fejlfinding
  A.aiIntern={oversigtHtml:oversigtHtml,modelOplysninger:modelOplysninger,ruting:ruting,kontekst:kontekst,valider:valider,valgTilstand:valgTilstand,laegForslag:laegForslag,HANDLING_TEKST:HANDLING_TEKST,FELT_AF:FELT_AF,
    saetTilstand:saetTilstand,ventetid:function(){ return ventetid(tilstand); },
    udfold:udfold,validerNy:validerNy,laegForslagNy:laegForslagNy,NY_HANDLING:NY_HANDLING,historik:function(){ return historik.slice(); },visSvar:visSvar,klikValg:klikValg,visning:function(){ return visning; },statusNu:statusNu,strukturNu:strukturNu};
  indlaesEkstra();   // de rene 3.0-moduler (valg, LCA, EPD-match, tabel 7) fra samme mappe
  var w=window.issanaArbejdsrum; if(w&&typeof w==='object') w.ai=OFFENTLIG;
  else (window.issanaArbejdsrumVentende=window.issanaArbejdsrumVentende||[]).push(function(ar){ if(ar&&typeof ar==='object') ar.ai=OFFENTLIG; });   // layoutet indlæses efter os
  if(typeof document!=='undefined'&&document.getElementById&&document.getElementById('arbAi')) monter();
})();
