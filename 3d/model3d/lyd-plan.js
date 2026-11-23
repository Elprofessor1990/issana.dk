/* ISSANA 3D: plantegning for fanen Lyd: pr. etage ses, hvilket krav hver væg har, og hvad værdien er. Regner intet selv: krav og værdier kommer
   fra lydkrav.js (vurderAlle) og grupperne fra lyd-analyse.js, så planen altid viser det samme som tabellen. Geometrien er 3D-eksportens meshes.
   Rent modul uden DOM. Browser: window.IssanaLydPlan. Node: module.exports. */
(function(root, factory){
  "use strict";
  var erNode = typeof module==='object' && module && module.exports;
  var api = factory(root, erNode);
  if(erNode) module.exports=api; else root.IssanaLydPlan=api;
})(typeof self!=='undefined' ? self : this, function(root, erNode){
  "use strict";

  var K = erNode ? require('./lydkrav.js') : root.IssanaLydkrav;
  // Farverne er valideret for farveblinde på panelets lyse og mørke flade (tre kategorier må stå side om side på en plan). Resten er grå.
  var KATEGORIER={
    skel:{navn:'Mellem enheder', css:'--lp-skel'}, faelles:{navn:'Mod fælles rum', css:'--lp-faelles'}, facade:{navn:'Mod det fri', css:'--lp-facade'},
    ingen:{navn:'Intet krav (samme enhed)', css:'--lp-ingen'}, ikke:{navn:'Ikke med i beregningen', css:'--lp-ikke'}
  };
  var FRA_GRUPPE={skel_enhed:'skel', skel_ukendt:'skel', skel_rum:'skel', skel_faelles:'faelles', doer_faelles:'faelles', facade:'facade', facade_aabning:'facade', indvendig:'ingen', doer_indvendig:'ingen'};
  var ALVOR={ikke_opfyldt:4, mangler_input:3, opfyldt_forbehold:2, opfyldt:1};
  var TEGN={ikke_opfyldt:'✕', mangler_input:'?', opfyldt_forbehold:'✓*', opfyldt:'✓'};
  var CSS='#lydPlanBoks{--lp-skel:#2a78d6;--lp-faelles:#eb6834;--lp-facade:#1baf7a;--lp-ingen:#98a29c;--lp-ikke:#d3d8d3}'+
    'body.morke #lydPlanBoks{--lp-skel:#3987e5;--lp-faelles:#d95926;--lp-facade:#199e70;--lp-ingen:#66736d;--lp-ikke:#35423d}'+
    '.lyd-plan-boks{height:350px;border:1px solid var(--border);border-radius:6px;background:var(--bg-paper);overflow:hidden;touch-action:none;cursor:grab}'+
    '.lyd-plan-boks svg{width:100%;height:100%;display:block}.lyd-plan-boks text{fill:var(--text);pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}.lyd-plan-boks text.lp-rumtekst{fill:var(--muted)}'+
    '.lyd-plan-boks .lp-rumflade{fill:var(--bg-elev);stroke:var(--border);stroke-width:1;vector-effect:non-scaling-stroke}.lyd-plan-boks .lp-rumflade.mangler{fill:#d9a323;fill-opacity:.12;stroke:#d9a323;stroke-dasharray:6 4}.lyd-plan-boks svg:has(.lp-rumflade.on) .lp-rumflade:not(.on){opacity:.38}.lyd-plan-boks .lp-rumflade.on{fill:color-mix(in srgb,var(--accent) 32%,var(--bg-elev));fill-opacity:1;stroke:#172321;stroke-width:3.5;stroke-dasharray:none}.lyd-plan-boks .lp-snitlinje{stroke:var(--accent);stroke-width:2;stroke-dasharray:8 5;vector-effect:non-scaling-stroke;pointer-events:none}'+
    '.lyd-plan-boks svg:has(.lp-del.on) .lp-del:not(.on){opacity:.32}.lyd-plan-boks .lp-del.on{stroke:#172321;stroke-width:4px;opacity:1;vector-effect:non-scaling-stroke}.lyd-plan-boks .lp-hit{stroke:transparent;fill:none;cursor:pointer;pointer-events:stroke;vector-effect:non-scaling-stroke;stroke-width:14px}'+
    '.lyd-plan-tal{font-variant-numeric:tabular-nums}.lyd-plan-tal button{all:unset;cursor:pointer;text-decoration:underline}';

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function tal(n){ try{ return Number(n).toLocaleString('da-DK',{minimumFractionDigits:1,maximumFractionDigits:1}); }catch(e){ return String(n); } }
  function f(n){ return Math.round(n*1000)/1000; }

  /* ---------- Geometri ---------- */
  function punkter(meshes){ var ud=[]; (meshes||[]).forEach(function(m){ var p=m&&m.pos; if(!p) return; for(var i=0;i+2<p.length;i+=3) ud.push([p[i],p[i+1],p[i+2]]); }); return ud; }
  function zInterval(meshes){ var z0=Infinity, z1=-Infinity; punkter(meshes).forEach(function(q){ if(q[2]<z0) z0=q[2]; if(q[2]>z1) z1=q[2]; }); return z0===Infinity ? null : {z0:z0, z1:z1}; }
  // Vandrette trekanter i toppen (vægge) eller bunden (rum): planens omrids, også for L-formede rum og vægge med knæk.
  function flade(meshes, top){
    var zi=zInterval(meshes), ud=[]; if(!zi) return ud;
    (meshes||[]).forEach(function(m){ var p=m&&m.pos, ix=m&&m.idx; if(!p||!ix) return;
      for(var i=0;i+2<ix.length;i+=3){
        var a=ix[i]*3,b=ix[i+1]*3,c=ix[i+2]*3, ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2], vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
        var nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx, l=Math.sqrt(nx*nx+ny*ny+nz*nz); if(l<1e-9||Math.abs(nz/l)<0.7) continue;
        var z=(p[a+2]+p[b+2]+p[c+2])/3, midt=(zi.z0+zi.z1)/2;
        if(top ? z<midt : z>midt+0.01) continue;
        ud.push([p[a],p[a+1],p[b],p[b+1],p[c],p[c+1]]);
      } });
    return ud;
  }
  function skrog(pkt){
    var p=pkt.map(function(q){ return [q[0],q[1]]; }).sort(function(a,b){ return a[0]-b[0]||a[1]-b[1]; }); if(p.length<3) return p;
    function kryds(o,a,b){ return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]); }
    var ned=[], op=[], i;
    for(i=0;i<p.length;i++){ while(ned.length>=2&&kryds(ned[ned.length-2],ned[ned.length-1],p[i])<=0) ned.pop(); ned.push(p[i]); }
    for(i=p.length-1;i>=0;i--){ while(op.length>=2&&kryds(op[op.length-2],op[op.length-1],p[i])<=0) op.pop(); op.push(p[i]); }
    return ned.slice(0,-1).concat(op.slice(0,-1));
  }
  function stiTrekanter(t){ return t.map(function(x){ return 'M'+f(x[0])+' '+f(-x[1])+'L'+f(x[2])+' '+f(-x[3])+'L'+f(x[4])+' '+f(-x[5])+'Z'; }).join(''); }
  function stiOmrids(t){
    var kanter={}, punkter={};
    function nk(x,y){ return f(x)+','+f(y); }
    function kant(a,b){ var ka=nk(a[0],a[1]), kb=nk(b[0],b[1]), k=ka<kb?ka+'|'+kb:kb+'|'+ka; punkter[ka]=a; punkter[kb]=b; if(!kanter[k]) kanter[k]={a:ka,b:kb,n:0}; kanter[k].n++; }
    t.forEach(function(q){ var a=[q[0],q[1]],b=[q[2],q[3]],c=[q[4],q[5]]; kant(a,b);kant(b,c);kant(c,a); });
    var nabo={}; Object.keys(kanter).forEach(function(k){ var e=kanter[k]; if(e.n!==1) return; (nabo[e.a]||(nabo[e.a]=[])).push(e.b); (nabo[e.b]||(nabo[e.b]=[])).push(e.a); });
    var brugt={}, ud=[];
    Object.keys(nabo).forEach(function(start){ var foerste=nabo[start][0], ek=start+'|'+foerste, rk=foerste+'|'+start; if(brugt[ek]||brugt[rk]) return; var sti=[], forrige=null, nu=start, vagt=0;
      do { sti.push(punkter[nu]); var ns=nabo[nu]||[], naeste=ns.filter(function(x){ return x!==forrige&&!brugt[nu+'|'+x]&&!brugt[x+'|'+nu]; })[0]; if(!naeste) naeste=ns.filter(function(x){ return x!==forrige; })[0]; if(!naeste) break; brugt[nu+'|'+naeste]=1;brugt[naeste+'|'+nu]=1; forrige=nu;nu=naeste;vagt++; } while(nu!==start&&vagt<10000);
      if(sti.length>=3) ud.push('M'+sti.map(function(p){ return f(p[0])+' '+f(-p[1]); }).join('L')+'Z');
    });
    return ud.join('');
  }
  function triBoks(t){ var x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity; t.forEach(function(q){ for(var i=0;i<6;i+=2){ if(q[i]<x0)x0=q[i];if(q[i]>x1)x1=q[i];if(q[i+1]<y0)y0=q[i+1];if(q[i+1]>y1)y1=q[i+1]; } }); return x0===Infinity?null:{x:x0,y:y0,x1:x1,y1:y1}; }
  function stiPolygon(p){ return p.length<3 ? '' : 'M'+p.map(function(q){ return f(q[0])+' '+f(-q[1]); }).join('L')+'Z'; }
  // Elementets længdeakse: midtpunkt, længde, tykkelse og vinkel (model, grader).
  function akse(pkt){
    var n=pkt.length, mx=0, my=0, i; for(i=0;i<n;i++){ mx+=pkt[i][0]; my+=pkt[i][1]; } mx/=n; my/=n;
    var sxx=0, syy=0, sxy=0; for(i=0;i<n;i++){ var dx=pkt[i][0]-mx, dy=pkt[i][1]-my; sxx+=dx*dx; syy+=dy*dy; sxy+=dx*dy; }
    var v=0.5*Math.atan2(2*sxy,sxx-syy), c=Math.cos(v), s=Math.sin(v), a0=Infinity, a1=-Infinity, b0=Infinity, b1=-Infinity;
    for(i=0;i<n;i++){ var u=(pkt[i][0]-mx)*c+(pkt[i][1]-my)*s, w=-(pkt[i][0]-mx)*s+(pkt[i][1]-my)*c; if(u<a0) a0=u; if(u>a1) a1=u; if(w<b0) b0=w; if(w>b1) b1=w; }
    var m=(a0+a1)/2, q=(b0+b1)/2;
    return {x:mx+m*c-q*s, y:my+m*s+q*c, laengde:a1-a0, tykkelse:b1-b0, vinkel:v*180/Math.PI};
  }
  function centroide(t){ var A=0, x=0, y=0; t.forEach(function(q){ var a=Math.abs((q[2]-q[0])*(q[5]-q[1])-(q[4]-q[0])*(q[3]-q[1]))/2; A+=a; x+=a*(q[0]+q[2]+q[4])/3; y+=a*(q[1]+q[3]+q[5])/3; }); return A>0 ? {x:x/A, y:y/A, areal:A} : null; }

  /* ---------- Krav og værdi pr. bygningsdel ---------- */
  function linjerPrDel(res){
    var pr={};
    function saet(id, l){ if(id!=null) (pr[String(id)]||(pr[String(id)]=[])).push(l); }
    res.forEach(function(r){
      var fb=r.dele.luftlyd.forbeholdKort||[];
      (r.dele.luftlyd.dele||[]).forEach(function(p){
        if(!p.krav||p.status==='ikke_relevant') return;
        saet(p.vaegId,{art:p.doer ? 'dør' : 'luft', navn:"R'w", krav:p.krav, vaerdi:p.Rw_mark, status:(p.status==='opfyldt'&&fb.length&&!p.doer) ? 'opfyldt_forbehold' : p.status, mellem:r.navn+' og '+p.fra, relation:p.relation||null, skoen:!!p.skoen, kilde:p.krav.kilde||null});
      });
      var kf=r.dele.facade.krav, ffb=r.dele.facade.forbeholdKort||[];
      (r.dele.facade.dele||[]).forEach(function(p){
        if(!kf||kf.kraevesIkke) return;
        var s=p.L_inde==null ? 'mangler_input' : (kf.vaerdi==null ? 'mangler_input' : (p.L_inde>kf.vaerdi ? 'ikke_opfyldt' : (ffb.length ? 'opfyldt_forbehold' : 'opfyldt')));
        saet(p.vaegId,{art:'facade', navn:'Lden inde', krav:kf, vaerdi:p.L_inde, rw:p.Rw_mark, status:s, mellem:r.navn+' og det fri', relation:null, skoen:false, kilde:kf.kilde||null});
      });
    });
    return pr;
  }
  function kravTekst(k){ return !k||k.vaerdi==null ? 'ikke fastlagt' : (k.retning==='max' ? '≤ ' : '≥ ')+Number(k.vaerdi).toLocaleString('da-DK'); }
  function hoved(l){
    return l.slice().sort(function(a,b){ return (ALVOR[b.status]||0)-(ALVOR[a.status]||0) || ((a.krav&&a.krav.vaerdi!=null ? 0 : 1)-(b.krav&&b.krav.vaerdi!=null ? 0 : 1)); })[0];
  }

  function byg(model, res, an){
    var ix=K.lavIndeks(model), linjer=linjerPrDel(res||[]), resultat={};
    (res||[]).forEach(function(r){ resultat[String(r.rumId)]=r; });
    var niv={};
    ix.rum.forEach(function(r){ var z=zInterval(r.meshes); if(r.level&&z&&(niv[r.level]==null||z.z0<niv[r.level])) niv[r.level]=z.z0; });
    var gruppe={}; if(an) an.relevans.grupper.forEach(function(g){ g.ids.forEach(function(id){ gruppe[String(id)]=g.id; }); });
    var etager=Object.keys(niv).map(function(navn){ return {navn:navn, z:niv[navn]}; }).sort(function(a,b){ return a.z-b.z; });
    etager.forEach(function(et){
      var snit=et.z+1.2, dele=[], x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
      function se(x,y){ if(x<x0) x0=x; if(x>x1) x1=x; if(y<y0) y0=y; if(y>y1) y1=y; }
      Object.keys(ix.els).forEach(function(k){
        var e=ix.els[k]; if(e.category!=='Vægge'&&e.category!=='Døre'&&e.category!=='Vinduer') return;
        var z=zInterval(e.meshes); if(!z||snit<z.z0||snit>z.z1) return;
        var aabning=e.category!=='Vægge', tri=aabning ? [] : flade(e.meshes,true), pk=tri.length ? tri.reduce(function(a,q){ a.push([q[0],q[1]],[q[2],q[3]],[q[4],q[5]]); return a; },[]) : punkter(e.meshes);
        var g=gruppe[k]||null, kat=FRA_GRUPPE[g]||'ikke', ls=linjer[k]||[], h=ls.length ? hoved(ls) : null, ax=akse(pk), status=h ? h.status : null;
        pk.forEach(function(q){ se(q[0],q[1]); });
        if(aabning&&!h&&kat==='ikke'&&e.category==='Vinduer') return;                 // vinduer uden krav ville kun støje
        if(aabning&&!h&&kat==='ingen') return;
        dele.push({id:e.id, navn:e.type||e.name||e.category, kategori:e.category, gruppe:g, kat:kat, aabning:aabning, sti:tri.length ? stiTrekanter(tri) : stiPolygon(skrog(pk)), x:ax.x, y:ax.y, laengde:ax.laengde, tykkelse:ax.tykkelse, vinkel:ax.vinkel, status:status,
          krav:h ? h.navn+' '+kravTekst(h.krav) : null, vaerdi:h ? (h.vaerdi!=null ? tal(h.vaerdi) : 'mangler') : null, etiket:h ? h.navn+' '+kravTekst(h.krav)+' · '+(h.vaerdi!=null ? tal(h.vaerdi) : 'mangler')+' '+TEGN[status] : null, linjer:ls});
      });
      var rum=ix.rum.filter(function(r){ return r.level===et.navn; }).map(function(r){
        var t=flade(r.meshes,false), c=centroide(t); t.forEach(function(q){ se(q[0],q[1]); se(q[2],q[3]); se(q[4],q[5]); });
        var x=an&&an.rum[String(r.id)], rr=resultat[String(r.id)], eft=rr&&rr.dele&&rr.dele.efterklang;
        return {id:r.id, navn:((r.number ? r.number+' ' : '')+(r.name||'')).trim(), sti:stiOmrids(t), boks:triBoks(t), x:c ? c.x : null, y:c ? c.y : null, areal:c ? c.areal : 0,
          enhed:x ? (x.faelles ? 'Fælles' : (x.enhed||'')) : '', rumfunktion:x&&x.rfId||null, rumfunktionNavn:x&&x.rfNavn||null, manglerType:!(x&&x.rfId),
          efterklang:eft ? {vaerdi:eft.vaerdi, krav:eft.krav, status:eft.status, mangler:(eft.mangler||[]).map(function(m){return m.tekst;})} : null};
      });
      var m=.35;
      et.dele=dele; et.rum=rum; et.boks=x0===Infinity ? {x:0,y:-1,b:1,h:1} : {x:x0-m, y:-y1-m, b:x1-x0+2*m, h:y1-y0+2*m};
    });
    return {etager:etager};
  }

  /* ---------- Etiketter: kun dem, der er plads til. De alvorligste først ---------- */
  function etiketter(et, pxPrM, px){
    px=px||11;
    var brugt=[], ud=[];
    et.dele.filter(function(d){ return d.etiket; }).slice().sort(function(a,b){ return (ALVOR[b.status]||0)-(ALVOR[a.status]||0)||b.laengde-a.laengde; }).forEach(function(d){
      var b=d.etiket.length*px*0.56;
      if(d.laengde*pxPrM<b*0.9) return;
      var v=-d.vinkel; if(v>90) v-=180; if(v<=-90) v+=180;
      var r=v*Math.PI/180, afst=d.tykkelse/2*pxPrM+px*0.9, cx=d.x*pxPrM+Math.sin(r)*afst, cy=-d.y*pxPrM-Math.cos(r)*afst;
      var w=Math.abs(Math.cos(r))*b+Math.abs(Math.sin(r))*px*1.3, h=Math.abs(Math.sin(r))*b+Math.abs(Math.cos(r))*px*1.3;
      if(brugt.some(function(q){ return Math.abs(q.x-cx)<(q.w+w)/2&&Math.abs(q.y-cy)<(q.h+h)/2; })) return;
      brugt.push({x:cx,y:cy,w:w,h:h});
      ud.push({id:d.id, tekst:d.etiket, x:cx/pxPrM, y:cy/pxPrM, vinkel:v});
    });
    return ud;
  }
  function etiketterSvg(et, pxPrM, px){
    px=px||11;
    var fs=f(px/pxPrM), hl=f(3/pxPrM);
    var h=etiketter(et,pxPrM,px).map(function(e){ return '<text x="'+f(e.x)+'" y="'+f(e.y)+'" text-anchor="middle" dominant-baseline="middle" font-size="'+fs+'" stroke-width="'+hl+'" transform="rotate('+f(e.vinkel)+' '+f(e.x)+' '+f(e.y)+')">'+esc(e.tekst)+'</text>'; }).join('');
    // Rumnavne kun, hvor der er plads
    et.rum.forEach(function(r){ if(r.x==null) return; var b=r.navn.length*(px-1)*0.56; if(Math.sqrt(r.areal)*pxPrM<b*1.1) return; h+='<text class="lp-rumtekst" x="'+f(r.x)+'" y="'+f(-r.y)+'" text-anchor="middle" dominant-baseline="middle" font-size="'+f((px-1)/pxPrM)+'" stroke-width="'+hl+'">'+esc(r.navn)+'</text>'; });
    return h;
  }
  function rumTekstSvg(et,pxPrM){
    var fs=f(11/pxPrM), h='';
    et.rum.forEach(function(r){ if(r.x==null) return; var nummer=r.navn.split(/\s+/)[0], e=r.efterklang, tekst=null, st=null;
      if(r.manglerType){ tekst='?'; st='mangler_input'; }
      else if(e&&e.vaerdi!=null){ tekst=tal(e.vaerdi)+' s '+(e.status==='opfyldt'?'✓':e.status==='ikke_opfyldt'?'✕':'?'); st=e.status||'mangler_input'; }
      if(Math.sqrt(r.areal)*pxPrM>nummer.length*6.2) h+='<text class="lp-rumtekst" x="'+f(r.x)+'" y="'+f(-r.y-.12)+'" text-anchor="middle" font-size="'+fs+'">'+esc(nummer)+'</text>';
      if(!tekst) return;
      var bred=tekst.length*6.1/pxPrM;
      if(Math.sqrt(r.areal)*pxPrM>tekst.length*6.5) h+='<g class="lp-rumbadge"><rect x="'+f(r.x-bred/2)+'" y="'+f(-r.y+.02)+'" width="'+f(bred)+'" height="'+f(18/pxPrM)+'" rx="'+f(5/pxPrM)+'" fill="'+(K.FARVE[st]||K.FARVE.mangler_input)+'"/><text x="'+f(r.x)+'" y="'+f(-r.y+13/pxPrM)+'" text-anchor="middle" font-size="'+fs+'" fill="white">'+esc(tekst)+'</text></g>';
      else h+='<circle cx="'+f(r.x)+'" cy="'+f(-r.y)+'" r="'+f(5/pxPrM)+'" fill="'+(K.FARVE[st]||K.FARVE.mangler_input)+'"/>';
    }); return h;
  }
  function vaegEtiket(d){ if(!d||!d.linjer||!d.linjer.length) return ''; var l=hoved(d.linjer), mod=l.relation==='facade'?'Mod det fri':l.relation&&l.relation.indexOf('faelles')>=0?'Mod gang':'Mellem rum'; return mod+': '+l.navn+' '+(l.vaerdi==null?'mangler':tal(l.vaerdi)+' dB')+' · krav '+kravTekst(l.krav)+' '+(TEGN[l.status]||''); }
  function farveAf(d, farve){
    if(farve==='status') return d.status ? (K.FARVE[d.status]||'#ccc') : 'var(--lp-ikke)';
    return 'var('+KATEGORIER[d.kat].css+')';
  }
  function titel(d){ return d.navn+(d.krav ? ': '+d.krav+', værdi '+d.vaerdi+', '+K.TEKST[d.status] : (d.kat==='ingen' ? ': intet krav' : ': ikke med i beregningen')); }
  function svg(et, valg){
    valg=valg||{}; var b=valg.vis||et.boks, pxPrM=valg.pxPrM||30, tekstPxPrM=Math.max(.1,Math.min((valg.breddePx||400)/(b.b||1),(valg.hoejdePx||350)/(b.h||1))), farve=valg.farve||'krav', valgte=(valg.valgteRum||[]).map(String);
    var vaegge=et.dele.filter(function(d){ return !d.aabning; }), aab=et.dele.filter(function(d){ return d.aabning; });
    var h='<svg viewBox="'+f(b.x)+' '+f(b.y)+' '+f(b.b)+' '+f(b.h)+'" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="'+esc('Plantegning '+et.navn+': krav og værdi pr. væg')+'">';
    h+='<g class="lp-rum">'+et.rum.map(function(r){ var on=valgte.indexOf(String(r.id))>=0; return '<path class="lp-rumflade'+(on?' on':'')+(r.manglerType?' mangler':'')+'" d="'+r.sti+'" data-rum="'+esc(r.id)+'"><title>'+esc(r.navn+(r.enhed ? ' · '+r.enhed : '')+(r.manglerType?' · Vælg rumtype':''))+'</title></path>'; }).join('')+'</g>';
    function del(d){ var on=valg.valgtDel!=null&&String(d.id)===String(valg.valgtDel);return '<path class="lp-del'+(on?' on':'')+'" d="'+d.sti+'" fill="'+farveAf(d,farve)+'" data-del="'+esc(d.id)+'"'+(d.aabning ? ' stroke="var(--bg-paper)" stroke-width="1" vector-effect="non-scaling-stroke"' : '')+'><title>'+esc(titel(d))+'</title></path>'; }
    h+='<g>'+vaegge.map(del).join('')+aab.map(del).join('')+'</g>';
    // Vægge med krav ligger øverst, så et klik ikke fanges af en badkabine eller andet uden krav ved siden af.
    h+='<g>'+et.dele.slice().sort(function(a,b){ return (a.krav?1:0)-(b.krav?1:0); }).map(function(d){ var r=d.vinkel*Math.PI/180, dx=Math.cos(r)*d.laengde/2, dy=Math.sin(r)*d.laengde/2; return '<line class="lp-hit" x1="'+f(d.x-dx)+'" y1="'+f(-d.y+dy)+'" x2="'+f(d.x+dx)+'" y2="'+f(-d.y-dy)+'" data-del="'+esc(d.id)+'"><title>'+esc(titel(d))+'</title></line>'; }).join('')+'</g>';
    h+='<g class="lp-tekst">'+rumTekstSvg(et,tekstPxPrM)+'</g>';
    var vr=et.rum.filter(function(r){return valgte.indexOf(String(r.id))>=0&&r.boks;})[0]; if(vr){ var lod=valg.snitRetning==='y', sx=lod?(vr.boks.x+vr.boks.x1)/2:vr.boks.x, sy=lod?vr.boks.y:(vr.boks.y+vr.boks.y1)/2, ex=lod?sx:vr.boks.x1, ey=lod?vr.boks.y1:sy, af=11/pxPrM; h+='<line class="lp-snitlinje" x1="'+f(sx)+'" y1="'+f(-sy)+'" x2="'+f(ex)+'" y2="'+f(-ey)+'"/><text x="'+f(sx)+'" y="'+f(-sy-af*.35)+'" font-size="'+f(af)+'" font-weight="700">A</text><text x="'+f(ex-af*.75)+'" y="'+f(-ey-af*.35)+'" font-size="'+f(af)+'" font-weight="700">A</text>'; }
    var vd=valg.valgtDel!=null?et.dele.filter(function(d){return String(d.id)===String(valg.valgtDel);})[0]:null, vt=vaegEtiket(vd); if(vt&&valg.visVaeglabel!==false) h+='<g class="lp-vaeglabel"><rect x="'+f(b.x+.15)+'" y="'+f(b.y+.15)+'" width="'+f(Math.min(b.b-.3,vt.length*6.2/pxPrM))+'" height="'+f(22/pxPrM)+'" rx="'+f(4/pxPrM)+'" fill="var(--bg-elev)" stroke="var(--border)"/><text x="'+f(b.x+.25)+'" y="'+f(b.y+.15+15/pxPrM)+'" font-size="'+f(11/pxPrM)+'">'+esc(vt)+'</text></g>';
    h+='</svg>';
    return h;
  }
  function forklaring(et, farve){
    var t={};
    et.dele.forEach(function(d){ var k=farve==='status' ? (d.status||'ikke') : d.kat; t[k]=(t[k]||0)+1; });
    if(farve==='status') return ['ikke_opfyldt','mangler_input','opfyldt_forbehold','opfyldt','ikke'].map(function(k){
      return {id:k, navn:k==='ikke' ? 'Intet krav eller ikke med' : K.TEKST[k], tegn:TEGN[k]||'',
        farve:k==='ikke' ? 'var(--lp-ikke)' : K.FARVE[k], antal:t[k]||0};
    });
    return ['skel','faelles','facade','ingen','ikke'].map(function(k){
      return {id:k, navn:KATEGORIER[k].navn, tegn:'', farve:'var('+KATEGORIER[k].css+')', antal:t[k]||0};
    });
  }

  return {KATEGORIER:KATEGORIER, CSS:CSS, byg:byg, svg:svg, etiketter:etiketter, etiketterSvg:etiketterSvg, rumTekstSvg:rumTekstSvg, stiOmrids:stiOmrids, forklaring:forklaring};
});
