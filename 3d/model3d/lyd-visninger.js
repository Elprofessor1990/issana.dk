/* Fire modelbaserede visninger til Lyd-fanen. Modulet er rent: det bygger data og HTML,
   men skriver aldrig i Revit eller i browserens lager. */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.IssanaLydVisninger=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';

  var STATUS={
    opfyldt:'holder', opfyldt_forbehold:'holder', ikke_opfyldt:'holder_ikke',
    mangler_input:'mangler', ikke_relevant:'uden_krav'
  };
  var RANG={uden_krav:0,holder:1,mangler:2,holder_ikke:3};
  var TEKST={holder:'Holder',holder_ikke:'Holder ikke',mangler:'Mangler lydmål',uden_krav:'Intet krav'};
  var DAMP_TEKST='Forenklet: støj ude minus krav inde. Rummets størrelse og vinduernes areal er ikke regnet med.';
  var CSS=[
    '.lyd-fire{container-type:inline-size;display:grid;gap:10px;min-width:0}',
    '.lyd-fire-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:3px}',
    '.lyd-fire-tabs button{min-height:40px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-elev);color:var(--text);font:inherit;font-size:11px;font-weight:700;cursor:pointer}',
    '.lyd-fire-tabs button[aria-selected="true"]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 13%,var(--bg-elev));box-shadow:inset 0 -3px 0 var(--accent)}',
    '.lyd-fire-kontekst{padding:2px 3px;color:var(--muted);font-size:12px}.lyd-fire-kontekst b{color:var(--text)}',
    '.lyd-fire button:focus-visible,.lyd-fire input:focus-visible,.lyd-fire select:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 55%,transparent);outline-offset:2px}',
    '.lyd-fire-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(330px,420px);gap:12px;align-items:start;min-width:0}',
    '.lyd-fire-main,.lyd-sted{min-width:0;max-width:100%;box-sizing:border-box}',
    '.lyd-sted{display:grid;gap:10px;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-elev);overflow-x:hidden}',
    '.lyd-sted h3,.lyd-fire h3{margin:0;font-size:16px}.lyd-kicker{font-size:11px;font-weight:700;letter-spacing:.055em;text-transform:uppercase;color:var(--muted)}',
    '.lyd-lydvej{display:grid;grid-template-columns:1fr 18px 1fr;min-height:70px;border:1px solid var(--border);border-radius:7px;overflow:hidden}',
    '.lyd-lydvej>span{display:grid;place-items:center;padding:8px;text-align:center;font-size:12px;background:var(--bg)}',
    '.lyd-lydvej>i{background:var(--accent);background-image:repeating-linear-gradient(135deg,rgba(255,255,255,.35) 0 2px,transparent 2px 7px)}',
    '.lyd-kort{padding:10px 11px;border:1px solid var(--border);border-radius:7px;background:var(--bg)}',
    '.lyd-kort-hoved{display:flex;gap:8px;align-items:start}.lyd-kort-hoved>div{flex:1;min-width:0}',
    '.lyd-kort small,.lyd-fagord,.lyd-delt{display:block;color:var(--muted);font-size:12px}.lyd-kort strong{overflow-wrap:anywhere}',
    '.lyd-sted .tbtn{min-height:32px}.lyd-handlinger{display:grid;gap:7px}',
    '.lyd-kandidater{display:grid;gap:6px}.lyd-kandidat{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;width:100%;padding:9px 10px;text-align:left;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);font:inherit;cursor:pointer}',
    '.lyd-kandidat.on{border:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--bg))}.lyd-kandidat span{color:var(--muted);font-size:12px}.lyd-kandidat b:last-child{text-align:right}',
    '.lyd-status{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700}.lyd-status:before{content:"";width:9px;height:9px;border-radius:50%;background:var(--border)}',
    '.lyd-status.holder:before{background:#2c7a4b}.lyd-status.holder_ikke:before{background:#b3261e}.lyd-status.mangler:before{background:#707c80}.lyd-status.uden_krav:before{background:var(--border)}',
    '.lyd-signatur{display:flex;flex-wrap:wrap;gap:8px 16px;padding:9px 11px;border:1px solid var(--border);border-radius:7px;background:var(--bg-elev)}',
    '.lyd-facade-top,.lyd-rum-top{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}',
    '.lyd-facade-sider{display:grid;gap:7px;margin-top:8px}.lyd-facade-side{border:1px solid var(--border);border-radius:7px;background:var(--bg)}.lyd-facade-side>summary{padding:9px 11px;cursor:pointer}.lyd-facade-side[open]>summary{border-bottom:1px solid var(--border)}',
    '.lyd-facade-kort{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:7px;padding:8px}.lyd-facade-kort details{grid-column:1/-1}.lyd-facade-kort details>summary{cursor:pointer;font-size:12px;font-weight:700}.lyd-facade-kort details[open]>summary{margin-bottom:7px}.lyd-facade-kort details .lyd-facade-kort{padding:0}',
    '.lyd-facade-kort button,.lyd-flade-knap,.lyd-rum-knap{border:1px solid var(--border);border-radius:7px;background:var(--bg-elev);color:var(--text);font:inherit;cursor:pointer;text-align:left}',
    '.lyd-facade-kort button{padding:9px;display:grid;gap:3px}.lyd-facade-kort small{display:block;font-size:11px}.lyd-facade-kort button.on,.lyd-flade-knap.on,.lyd-rum-knap.on{border:3px solid var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--bg-elev))}',
    '.lyd-stoej{height:8px;border-radius:3px;margin-top:7px}.s0{background:#dedaf0}.s1{background:#aaa1d2}.s2{background:#6f5fb3}.s3{background:#46357f}',
    '.lyd-stoejfelter{display:grid;grid-template-columns:minmax(110px,1fr) minmax(130px,1.5fr);gap:7px;margin-top:8px}.lyd-stoejfelter input,.lyd-stoejfelter select{width:100%;min-height:34px;box-sizing:border-box;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);font:inherit}',
    '.lyd-rum-visning{display:grid;grid-template-columns:minmax(180px,240px) minmax(0,1fr);gap:10px}.lyd-rumliste{display:grid;gap:4px;align-content:start}.lyd-rum-knap{display:grid;grid-template-columns:12px minmax(0,1fr);gap:8px;padding:8px}.lyd-rum-knaptekst{display:grid;gap:3px;min-width:0}.lyd-rum-knaptekst b,.lyd-rum-knaptekst small{display:block;min-width:0;overflow-wrap:anywhere}.lyd-rum-knaptekst small{font-size:11px}',
    '.lyd-rum-knap .prik{width:10px;height:10px;border-radius:50%;margin-top:3px}.prik.holder{background:#2c7a4b}.prik.holder_ikke{background:#b3261e}.prik.mangler{background:#707c80}.prik.uden_krav{background:var(--border)}',
    '.lyd-rum-midte{min-width:0}.lyd-rum-titel{display:grid;gap:3px}.lyd-rum-titel small{color:var(--muted);font-size:12px}.lyd-rum-flader{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px}.lyd-flade-knap{display:grid;gap:5px;padding:9px;min-height:58px;min-width:0;white-space:normal;overflow-wrap:anywhere}.lyd-flade-status{display:block}',
    '.lyd-rumflade-liste{display:grid;gap:5px;min-width:0}.lyd-rumflade-liste button{display:block;width:100%;max-width:100%;min-width:0;text-align:left;white-space:normal;overflow-wrap:anywhere;word-break:break-word}.lyd-rumflade-liste details{min-width:0}.lyd-rumflade-liste summary{cursor:pointer;font-size:11px}.lyd-kort>strong{display:block}.lyd-kort>strong+.tbtn,.lyd-kort>b+.tbtn,.lyd-rumtypehandling{display:block;margin-top:8px}.lyd-rumforslag{margin-top:8px;padding:8px;border:1px dashed var(--accent);border-radius:6px}',
    '.lyd-fire .arb-sek,.lyd-fire .lyd-kicker{font-size:11px}',
    '.lyd-optalt{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0}.lyd-optalt span{padding:3px 8px;border:1px solid var(--border);border-radius:12px;font-size:11px;font-weight:700}',
    '.lyd-stoej-signatur{display:flex;flex-wrap:wrap;gap:7px 14px;font-size:11px;color:var(--muted)}.lyd-stoej-signatur i{display:inline-block;width:22px;height:9px;border-radius:2px;margin-right:5px}',
    '@container (max-width:1099px){.lyd-fire-layout{grid-template-columns:1fr}.lyd-sted{grid-row:2}.lyd-rum-visning{grid-template-columns:1fr}.lyd-rumliste{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '@container (max-width:599px){.lyd-fire-tabs{grid-template-columns:1fr 1fr}.lyd-rum-flader,.lyd-rumliste{grid-template-columns:1fr}.lyd-stoejfelter{grid-template-columns:1fr}.lyd-lydvej{grid-template-columns:1fr 12px 1fr}}'
  ].join('');

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function fmt(n,d){ return n==null||!isFinite(n)?'ikke oplyst':Number(n).toLocaleString('da-DK',{maximumFractionDigits:d==null?1:d}); }
  function status(s){ return STATUS[s]||s||'mangler'; }
  function vaerste(liste){ return (liste||[]).map(status).sort(function(a,b){return (RANG[b]||0)-(RANG[a]||0);})[0]||'uden_krav'; }
  function typeMap(model){ var x={}; (model&&model.types||[]).forEach(function(t){x[String(t.id)]=t;}); return x; }
  function elementMap(model){ var x={}; (model&&model.elements||[]).forEach(function(e){x[String(e.id)]=e;}); return x; }
  function typeAf(model,e){ return e&&typeMap(model)[String(e.typeId)]||null; }
  function lydMaal(model,e){
    var t=typeAf(model,e)||e||{}, b=t.bygdata||{}, d=b.data||{}, l=d.lyd||{}, x=l.dokumenteret||l.maal||null;
    return x&&x.vaerdi!=null?x:null;
  }
  function lagTekst(model,e){ var t=typeAf(model,e), l=t&&t.layers||[]; return l.length?l.map(function(x){return (x.material||'Lag')+(x.widthMm!=null?' '+fmt(x.widthMm,0)+' mm':'');}).join(' · '):'Lag er ikke oplyst på typen'; }
  function navnRum(r){ return ((r&&r.number?r.number+' ':'')+(r&&r.name||'Rum')).trim(); }
  function parseStoej(v){ var m=String(v||'').replace(',','.').match(/-?\d+(?:\.\d+)?/); return m?Number(m[0]):null; }
  function xyBoks(x){var b={x0:Infinity,x1:-Infinity,y0:Infinity,y1:-Infinity};(x&&x.meshes||[]).forEach(function(m){for(var a=m&&m.pos||[],i=0;i+2<a.length;i+=3){b.x0=Math.min(b.x0,a[i]);b.x1=Math.max(b.x1,a[i]);b.y0=Math.min(b.y0,a[i+1]);b.y1=Math.max(b.y1,a[i+1]);}});return b.x0===Infinity?null:b;}
  function orientering(model,e){var eb=xyBoks(e),bb=model&&model.bbox,mb=bb&&bb.min&&bb.max?{x0:bb.min[0],y0:bb.min[1],x1:bb.max[0],y1:bb.max[1]}:null;if(!eb||!mb)return 'Facade';var d=[Math.abs(eb.y1-mb.y1),Math.abs(eb.x1-mb.x1),Math.abs(eb.y0-mb.y0),Math.abs(eb.x0-mb.x0)],n=Math.min.apply(Math,d);return ['Nord','Øst','Syd','Vest'][d.indexOf(n)];}
  function stoejTrin(n){ return n==null?-1:n<58?0:n<63?1:n<=68?2:3; }
  function forenkletDaempning(stoej,krav){ return stoej==null||krav==null?null:Math.round((stoej-krav)*10)/10; }
  function facadeResultat(resultater,rumId){
    var r=(resultater||[]).filter(function(x){return String(x.rumId)===String(rumId);})[0];
    return r&&r.dele&&r.dele.facade||null;
  }
  function facader(model,resultater,niveau,stoejValg){
    var rum=model&&model.rooms||[], em=elementMap(model), ud=[];
    (model&&model.elements||[]).forEach(function(e){
      if(e.category!=='Vægge'||String(e.level)!==String(niveau)||!(e.revit&&e.revit.funktion==='Exterior')) return;
      var rr=rum.filter(function(r){return (r.graenser||[]).some(function(g){return String(g.id)===String(e.id);});});
      var fr=rr.map(function(r){return facadeResultat(resultater,r.id);}).filter(Boolean), f=fr[0]||null;
      var ra=e.bygdata&&e.bygdata.raw||{}, gemt=stoejValg&&stoejValg[String(e.id)]||{}, st=gemt.vaerdi;
      if(st==null) st=parseStoej(e.bygdata&&e.bygdata.noise||ra['ISSANA Instance Outdoor Noise']);
      var krav=f&&f.krav&&f.krav.vaerdi!=null?f.krav.vaerdi:null;
      var vinduer=(model.elements||[]).filter(function(x){return x.category==='Vinduer'&&String(x.hostId)===String(e.id);});
      var side=orientering(model,e),numre=rr.map(function(r){return r.number||r.name;}).filter(Boolean);
      ud.push({id:e.id,element:e,navn:side+(numre.length?' · '+numre.join(', '):''),type:e.type||e.name||String(e.id),side:side,rum:rr,rumNavne:rr.map(navnRum),status:status(f&&f.status),stoej:st,kilde:gemt.kilde||(st==null?'':'Skrevet ind'),kravInde:krav,daempning:forenkletDaempning(st,krav),vinduer:vinduer,vindueMaal:vinduer.map(function(v){return lydMaal(model,v);}).filter(Boolean)});
    });
    return ud;
  }
  function planEtage(plan,niveau){ return plan&&plan.etager&&plan.etager.filter(function(e){return String(e.navn)===String(niveau);})[0]||null; }
  function rumliste(model,resultater,niveau){
    var rm={}; (resultater||[]).forEach(function(r){rm[String(r.rumId)]=r;});
    return (model&&model.rooms||[]).filter(function(r){return String(r.level)===String(niveau);}).map(function(r){
      var x=rm[String(r.id)], dele=x&&x.dele||{}, st=[]; Object.keys(dele).forEach(function(k){st.push(dele[k]&&dele[k].status);});
      return {id:r.id,navn:navnRum(r),status:vaerste(st),rum:r,resultat:x||null};
    }).sort(function(a,b){return a.navn.localeCompare(b.navn,'da',{numeric:true});});
  }
  function rumflader(model,resultater,plan,niveau,rumId){
    var rum=(model&&model.rooms||[]).filter(function(r){return String(r.id)===String(rumId);})[0]; if(!rum) return [];
    var em=elementMap(model), pe=planEtage(plan,niveau), pd={}; (pe&&pe.dele||[]).forEach(function(d){pd[String(d.id)]=d;});
    var rr=(resultater||[]).filter(function(r){return String(r.rumId)===String(rumId);})[0], luft=rr&&rr.dele&&rr.dele.luftlyd;
    var rumVed={};(model&&model.rooms||[]).forEach(function(r){(r.graenser||[]).forEach(function(g){(rumVed[String(g.id)]||(rumVed[String(g.id)]=[])).push(r);});});
    var ra=(rum.graenser||[]).map(function(g){
      var e=em[String(g.id)], d=pd[String(g.id)], art=g.side==='top'?'Loft':g.side==='bund'?'Gulv':(e&&e.revit&&e.revit.funktion==='Exterior'?'Facade':'Væg');
      var dore=(model.elements||[]).filter(function(x){return x.category==='Døre'&&String(x.hostId)===String(g.id);});
      var dstatus=d&&d.status, dlinje=d&&d.linjer&&d.linjer[0], trækker=dore.length&&luft&&(luft.dele||[]).some(function(x){return x.doer&&String(x.vaegId)===String(dore[0].id)&&status(x.status)==='holder_ikke';});
      var nabo=(rumVed[String(g.id)]||[]).filter(function(x){return String(x.id)!==String(rumId);})[0];
      var type=e&&(e.type||e.name||e.id), side=art==='Facade'?orientering(model,e):null;
      var navn=art==='Facade'?'Facade · '+side+' · '+type:art+(nabo?' mod '+navnRum(nabo):'')+' · '+type;
      return {id:g.id,ids:[g.id],side:g.side,art:art,element:e,type:type,orientering:side,status:status(dstatus),krav:d&&d.krav||null,vaerdi:d&&d.vaerdi,navn:navn,nabo:nabo&&navnRum(nabo),dore:dore,doerTraekkerNed:!!trækker,linje:dlinje||null,antal:1};
    }).filter(function(x){var e=x.element,t=e&&(e.type||e.name)||'',lodret=x.side==='top'||x.side==='bund';return e&&(lodret?(e.category==='Gulve'||e.category==='Tage'):e.category==='Vægge')&&!/nedhæng|suspended|finish|belægning|ACT|soffit|beam wrap/i.test(t);});
    return samlRumflader(ra);
  }
  function fladeNavn(x){
    var grund=x.art==='Facade'?'Facade · '+(x.orientering||'Facade')+' · '+x.type:x.art+(x.nabo?' mod '+x.nabo:'')+' · '+x.type;
    return grund+(x.antal>1?' · '+x.antal+' stk.':'');
  }
  function samlRumflader(liste){
    var grupper={},ud=[];
    (liste||[]).forEach(function(x){
      var k=x.art==='Facade'?[x.art,x.orientering||'',x.type]:x.art==='Væg'?[x.art,x.nabo||'',x.type]:[x.art,x.type,x.side||''];
      k=k.join('|'); var g=grupper[k],antal=Number(x.antal)||1;
      if(!g){g=Object.assign({},x,{ids:(x.ids||[x.id]).slice(),antal:antal});grupper[k]=g;ud.push(g);return;}
      g.antal+=antal; g.ids=g.ids.concat(x.ids||[x.id]); g.status=vaerste([g.status,x.status]);
      g.doerTraekkerNed=g.doerTraekkerNed||x.doerTraekkerNed;
    });
    ud.forEach(function(x){x.navn=fladeNavn(x);}); return ud;
  }
  function optael(liste){ var o={holder:0,holder_ikke:0,mangler:0,uden_krav:0}; (liste||[]).forEach(function(x){o[status(x.status)]++;}); return o; }
  function brugAlleAntal(liste,valgt,felt){ if(!valgt)return 0; felt=felt||'gruppe'; var v=valgt[felt]; return (liste||[]).filter(function(x){return v!=null?String(x[felt])===String(v):x.status!=='uden_krav';}).length; }
  function tabsHtml(visning){
    var t=[['plan','Plan · luftlyd og efterklang'],['snit','Snit · trinlyd'],['facade','Facade · støj udefra'],['rum','Rum for rum']];
    var ids={plan:'lydVisPlan',snit:'lydVisSnit',facade:'lydVisFacade',rum:'lydVisRum'};
    return '<div class="lyd-fire-tabs" role="tablist" aria-label="Lydvisning">'+t.map(function(x){return '<button type="button" id="'+ids[x[0]]+'" role="tab" data-lyd-visning="'+x[0]+'" aria-selected="'+(visning===x[0])+'">'+x[1]+'</button>';}).join('')+'</div>';
  }
  function statusHtml(s){ s=status(s); return '<span class="lyd-status '+s+'">'+TEKST[s]+'</span>'; }
  function signaturHtml(uden){ return '<div class="lyd-signatur">'+statusHtml('holder')+statusHtml('holder_ikke')+statusHtml('mangler')+statusHtml('uden_krav')+(uden?'<span>'+esc(uden)+'</span>':'')+'</div>'; }
  function facadeHtml(data,valgtId,planSvg){
    var valgt=data.filter(function(x){return String(x.id)===String(valgtId);})[0]||data[0];
    var h='<section><div class="lyd-facade-top"><div><div class="lyd-kicker">Etage</div><h3>Facader og gavle · støj udefra</h3></div><span class="lyd-fagord">Klik på et sted og skriv støjen ude.</span></div>';
    if(planSvg) h+='<div class="lyd-kort" id="lydFacadePlan">'+planSvg+'</div>';
    if(!data.length) return h+'<div class="arb-tom">Der er ingen facadevægge på den valgte etage.</div></section>';
    function kort(x){var tr=stoejTrin(x.stoej);return '<button type="button" id="lydFacadeKort-'+esc(x.id)+'" data-facade="'+esc(x.id)+'" class="'+(valgt&&String(valgt.id)===String(x.id)?'on':'')+'"><b>'+esc(x.navn)+'</b><small>'+esc(x.type)+'</small><span>'+statusHtml(x.status)+'</span><small>'+(x.stoej==null?'Støj ude · ikke skrevet':'Lden '+fmt(x.stoej)+' dB · '+esc(x.kilde))+'</small>'+(tr>=0?'<small>Støjniveau</small><div class="lyd-stoej s'+tr+'"></div>':'')+'</button>';}
    var grupper={},orden=['Nord','Øst','Syd','Vest']; data.forEach(function(x){(grupper[x.side||'Andre']||(grupper[x.side||'Andre']=[])).push(x);});
    var sider=Object.keys(grupper).sort(function(a,b){var ai=orden.indexOf(a),bi=orden.indexOf(b);return (ai<0?99:ai)-(bi<0?99:bi)||a.localeCompare(b,'da');});
    h+='<div class="lyd-facade-sider">'+sider.map(function(side){var xs=grupper[side],aabent=valgt&&String(valgt.side||'Andre')===String(side),mangler=xs.filter(function(x){return status(x.status)==='mangler';}).length;return '<details class="lyd-facade-side" data-facade-side="'+esc(side)+'"'+(aabent?' open':'')+'><summary><b>'+esc(side)+'</b> · '+xs.length+' steder · '+mangler+' mangler lydmål</summary><div class="lyd-facade-kort">'+xs.slice(0,6).map(kort).join('')+(xs.length>6?'<details><summary>Vis alle ('+xs.length+')</summary><div class="lyd-facade-kort">'+xs.slice(6).map(kort).join('')+'</div></details>':'')+'</div></details>';}).join('')+'</div>';
    h+='<div class="lyd-stoej-signatur"><span><i class="s0"></i>Under 58 dB</span><span><i class="s1"></i>58–63 dB</span><span><i class="s2"></i>63–68 dB</span><span><i class="s3"></i>Over 68 dB</span></div></section>';
    return h;
  }
  function rumHtml(liste,flader,valgtRum,valgtFlade,planSvg,kunMangler,efterklang){
    var vist=kunMangler?liste.filter(function(x){return x.status==='mangler'||x.status==='holder_ikke';}):liste, o=optael(flader);
    var h='<section class="lyd-rum-visning"><div class="lyd-rumliste"><label class="arb-chk"><input type="checkbox" id="lydRumKunMangler"'+(kunMangler?' checked':'')+'> Vis kun rum, der mangler noget</label>';
    if(kunMangler&&liste.length&&vist.length===liste.length)h+='<div class="arb-hint">Alle '+liste.length+' rum mangler noget.</div>';
    h+=vist.map(function(r){return '<button type="button" class="lyd-rum-knap '+(String(r.id)===String(valgtRum)?'on':'')+'" data-lyd-rum="'+esc(r.id)+'"><span class="prik '+r.status+'"></span><span class="lyd-rum-knaptekst"><b>'+esc(r.navn)+'</b><small>'+TEKST[r.status]+'</small></span></button>';}).join('')+'</div>';
    var vr=liste.filter(function(x){return String(x.id)===String(valgtRum);})[0]||{};
    h+='<div class="lyd-rum-midte"><div class="lyd-kicker">Valgt rum</div><div class="lyd-rum-titel"><h3>'+esc(vr.navn||'Vælg et rum')+'</h3>'+statusHtml(vr.status)+'</div>';
    h+='<div class="lyd-optalt"><span>'+o.holder+' holder</span><span>'+o.holder_ikke+' holder ikke</span><span>'+o.mangler+' mangler lydmål</span><span>'+o.uden_krav+' uden krav</span></div>';
    if(planSvg)h+='<div class="lyd-kort">'+planSvg+'</div>';
    h+='<div class="lyd-rum-flader">'+flader.map(function(f){return '<button type="button" class="lyd-flade-knap '+(String(f.id)===String(valgtFlade)?'on':'')+'" data-lyd-flade="'+esc(f.id)+'"><b>'+esc(f.navn)+'</b><span class="lyd-flade-status">'+statusHtml(f.status)+(f.doerTraekkerNed?' · døren trækker ned':'')+'</span></button>';}).join('')+'</div>';
    h+='<div class="lyd-fagord">'+(efterklang||'Efterklang: intet krav for det valgte rum.')+'</div><button type="button" class="tbtn" id="lydNaesteFlade">Næste flade, der mangler lydmål</button></div></section>';
    return h;
  }
  function bibliotekProdukter(storage,produktmodul){
    try{var t=storage&&storage.getItem('issana-produkter-v1');if(!t||!produktmodul||!produktmodul.indlaesJson)return[];var r=produktmodul.indlaesJson(t),b=r&&r.bibliotek;return b&&b.produkter||[];}catch(e){return[];}
  }
  function kandidater(produkter,kategori,stoerrelse){
    var kat={Vægge:'vaeg',Gulve:'daek',Tage:'tag',Vinduer:'vindue',Døre:'dor'}[kategori]||kategori;
    return (produkter||[]).filter(function(p){var l=p.lyd||{};return (!kat||p.kategori===kat)&&l.kilde&&((stoerrelse==='Ln,w'&&l.Lnw!=null)||(stoerrelse!=='Ln,w'&&l.Rw!=null));}).map(function(p){var l=p.lyd||{},v=stoerrelse==='Ln,w'?l.Lnw:l.Rw+(stoerrelse==='Rw+Ctr'&&l.Ctr!=null?l.Ctr:0);return {id:p.id,navn:p.navn,produkt:p,vaerdi:v,kilde:l.kilde};});
  }
  function deltTekst(type){
    var d=type&&type.bygdata&&type.bygdata.data||{}, faner=[];
    if(d.lca||d.produkt)faner.push('LCA'); if(d.varmetab||d.uVaerdi!=null)faner.push('Varmetab'); if(d.energi)faner.push('Energi'); if(d.pris)faner.push('Pris');
    return faner.length?'Samme bygningsdel i '+faner.join(' · ')+'. Ændringen følger med dér.':'';
  }
  function panelHtml(ctx){
    if(!ctx)return '<aside class="lyd-sted"><div class="arb-tom">Klik på et rum eller en væg i tegningen</div></aside>';
    if(ctx.rum){var fl=ctx.flader||[],r=ctx.rum,knap=function(f){return '<button type="button" class="tbtn" data-pdel="'+esc(f.id)+'">'+esc(f.navn)+'</button>';};var type=r.rumfunktionNavn?'<strong>Rumtype: '+esc(r.rumfunktionNavn)+'</strong><button type="button" class="tbtn lyd-rumtypehandling" data-fortryd-rumtype="'+esc(r.id)+'">Fortryd</button>':'<strong>Rumtype: ikke valgt</strong>'+(r.forslag?'<div class="lyd-rumforslag">Forslag: '+esc(r.forslag.navn)+'<button type="button" class="tbtn primary lyd-rumtypehandling" data-godkend-rumforslag="'+esc(r.forslag.id)+'" data-rum="'+esc(r.id)+'">Bekræft</button></div>':'<button type="button" class="tbtn primary lyd-rumtypehandling" data-vaelg-rumtype="'+esc(r.id)+'">Vælg rumtype</button>');return '<aside class="lyd-sted"><div><div class="lyd-kicker">Valgt rum</div><h3>'+esc(r.navn)+'</h3></div><div class="lyd-kort">'+type+'</div><div><div class="lyd-kicker">Vægge og dæk ved rummet</div><div class="lyd-rumflade-liste">'+fl.slice(0,6).map(knap).join('')+(fl.length>6?'<details><summary>Vis alle ('+fl.length+')</summary>'+fl.slice(6).map(knap).join('')+'</details>':'')+'</div></div></aside>';}
    var e=ctx.element||{}, maal=ctx.maal, krav=ctx.krav, k=ctx.kandidater||[], valgt=ctx.kandidatId;
    var h='<aside class="lyd-sted"><div><div class="lyd-kicker">'+esc(ctx.kicker||'Valgt sted')+'</div><h3>'+esc(ctx.titel||e.type||e.name||'Valgt sted')+'</h3></div>';
    h+='<div class="lyd-lydvej" aria-label="Lydens vej"><span>'+esc(ctx.fra||'Lyd her')+'</span><i aria-hidden="true"></i><span>'+esc(ctx.til||'Høres her')+'</span></div>';
    h+='<div class="lyd-kort"><div class="lyd-kort-hoved"><div><small>Krav, som du har valgt</small><strong>'+(krav||'Intet krav valgt')+'</strong></div><button type="button" class="tbtn" data-skift-krav>Skift krav</button></div></div>';
    h+='<span class="lyd-fagord">'+esc(ctx.fagord||'Vælg et sted for at se lydmålet.')+'</span>';
    if(ctx.facade){h+='<div class="lyd-kort"><div class="lyd-stoejfelter"><label><small>Støj ude ved facaden</small><input data-stoej-id="'+esc(e.id)+'" inputmode="decimal" value="'+(ctx.facade.stoej==null?'':esc(ctx.facade.stoej))+'" placeholder="ikke skrevet" aria-label="Støj ude i dB"></label><label><small>Hvor kommer tallet fra?</small><select data-stoej-kilde="'+esc(e.id)+'"><option'+(ctx.facade.kilde==='Støjkort'?' selected':'')+'>Støjkort</option><option'+(ctx.facade.kilde==='Støjberegning'?' selected':'')+'>Støjberegning</option><option'+(ctx.facade.kilde==='Skrevet ind'?' selected':'')+'>Skrevet ind</option></select></label></div>'+(ctx.facade.daempning==null?'<b>Den nødvendige dæmpning vises, når støj ude og krav inde er valgt.</b>':'<b>Nødvendig dæmpning: '+fmt(ctx.facade.daempning)+' dB</b>')+'<small>'+DAMP_TEKST+'</small></div>';}
    h+='<div class="lyd-kort"><small>I Revit nu</small><strong>'+esc(e.type||e.name||'Typen er ikke oplyst')+'</strong><small>'+esc(ctx.lag||'Lag er ikke oplyst på typen')+'</small>'+(maal?'<b>'+esc(maal.stoerrelse||ctx.stoerrelse||'Lydmål')+' '+fmt(maal.vaerdi)+' dB</b>':'<b>'+(ctx.stoerrelse==='Ln,w'?"L\'n,w":ctx.stoerrelse==='Rw'?"R\'w":'Lydmål')+' er ikke oplyst på typen</b><button type="button" class="tbtn primary" data-angiv-db>Angiv dB</button>')+(ctx.vinduer!=null?'<small>'+(ctx.vinduer===0?'Ingen vinduer fundet i denne facade':ctx.vinduer+' vindue'+(ctx.vinduer===1?'':'r')+' · det svageste sted')+'</small>':'')+'</div>';
    h+='<div><div class="lyd-kicker">Eller vælg en konstruktion med kendt lydmål</div><div class="lyd-kandidater">';
    h+=k.length?k.map(function(x){var holder=ctx.kravTal==null?null:(ctx.retning==='max'?x.vaerdi<=ctx.kravTal:x.vaerdi>=ctx.kravTal), bed=holder==null?'Intet krav':TEKST[holder?'holder':'holder_ikke'];return '<button type="button" class="lyd-kandidat '+(String(valgt)===String(x.id)?'on':'')+'" data-lyd-kandidat="'+esc(x.id)+'"><span><b>'+esc(x.navn)+'</b><br>'+esc(x.kilde)+'</span><b>'+fmt(x.vaerdi)+' dB<br>'+bed+'</b></button>';}).join(''):'<div class="arb-hint">'+(ctx.bibliotekTomt?'Produktbiblioteket er tomt.':'Produktbiblioteket har ingen matchende konstruktioner til dette sted.')+' Brug «Angiv dB».</div>';
    h+='</div></div>';
    var delt=deltTekst(ctx.type); if(delt)h+='<div class="lyd-delt">'+esc(delt)+'</div>';
    if(k.length)h+='<div class="lyd-handlinger"><button type="button" class="tbtn primary" data-lyd-brug="en"'+(valgt?'':' disabled')+'>Brug på '+(ctx.enhed==='dæk'?'dette ':'denne ')+esc(ctx.enhed||'bygningsdel')+'</button><button type="button" class="tbtn" data-lyd-brug="alle"'+(valgt?'':' disabled')+'>Brug på alle '+(ctx.antalAlle||1)+' '+esc(ctx.alleTekst||'tilsvarende bygningsdele')+'</button></div>';
    h+='</aside>';
    return h;
  }

  return {CSS:CSS,DAMP_TEKST:DAMP_TEKST,status:status,vaerste:vaerste,lydMaal:lydMaal,lagTekst:lagTekst,typeAf:typeAf,parseStoej:parseStoej,stoejTrin:stoejTrin,forenkletDaempning:forenkletDaempning,facader:facader,rumliste:rumliste,rumflader:rumflader,samlRumflader:samlRumflader,optael:optael,brugAlleAntal:brugAlleAntal,tabsHtml:tabsHtml,signaturHtml:signaturHtml,facadeHtml:facadeHtml,rumHtml:rumHtml,bibliotekProdukter:bibliotekProdukter,kandidater:kandidater,panelHtml:panelHtml};
});
