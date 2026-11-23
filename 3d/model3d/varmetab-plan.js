/* ISSANA 3D: plantegninger til varmetabsrapporten. Rent modul uden DOM: ud fra 3D-eksporten og placeringsanalysen laves én SVG
   pr. etage med vægge, vinduer og døre farvet efter, hvad de vender mod, og én med dæk og tag farvet efter hvad der er over og under.
   Farverne følger samme regel som tabellerne (varmetab-placering.js), så plan og tal ikke kan være uenige.
   SVG'en bruger kun enkelte anførselstegn, så den kan stå direkte i en Typst-streng.
   Browser: window.IssanaVarmetabPlan. Node: module.exports. */
(function(root, factory){
  "use strict";
  var erNode = typeof module==='object' && module && module.exports;
  var api = factory(root, erNode);
  if(erNode) module.exports=api; else root.IssanaVarmetabPlan=api;
})(typeof self!=='undefined' ? self : this, function(root, erNode){
  "use strict";
  var P = erNode ? require('./bygningsdel-placering.js') : root.IssanaPlacering;
  var VP = erNode ? require('./varmetab-placering.js') : root.IssanaVarmetabPlacering;
  var G = P.geo;

  var KAT={
    ude:{f:'#c8434e',t:'Mod det fri'},
    jord:{f:'#8a6a47',t:'Mod jord'},
    uopvarmet:{f:'#e7a33e',t:'Mod uopvarmet rum'},
    afklar:{f:'#7b4fa3',t:'Skal afklares (regnes ikke med)'},
    ikke:{f:'#aab3bb',t:'Indgår ikke (mellem opvarmede rum eller ingen opvarmet side)'},
    uden:{f:'#dfe3e6',t:'Afgrænser ikke noget rum'}
  };
  var ORDEN=['uden','ikke','uopvarmet','jord','ude','afklar'];   // klimaskærmen tegnes øverst
  var RUM={opvarmet:{f:'#fff3df',t:'Opvarmet rum'},uopvarmet:{f:'#e3edf6',t:'Uopvarmet rum'},ude:{f:'#e3f2e1',t:'Udendørs (gårdrum, terrasse)'}};

  function r2(n){ return Math.round(n*100)/100; }
  function xml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function nyBoks(){ return {x0:Infinity,x1:-Infinity,y0:Infinity,y1:-Infinity}; }
  function udvid(B,x,y){ if(x<B.x0)B.x0=x; if(x>B.x1)B.x1=x; if(y<B.y0)B.y0=y; if(y>B.y1)B.y1=y; }
  function gyldig(B){ return isFinite(B.x0)&&B.x1>B.x0&&B.y1>B.y0; }

  // Trekanterne, der vender op (planen set oppefra). Vendes en mesh den anden vej, bruges undersiden.
  function fodaftryk(meshes){
    var op=[], ned=[];
    G.hvertTrekant(meshes,function(ax,ay,az,bx,by,bz,cx,cy,cz){
      var ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az, nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.sqrt(nx*nx+ny*ny+nz*nz);
      if(l<1e-9) return; var k=nz/l, t=[ax,ay,bx,by,cx,cy];
      if(k>0.5) op.push(t); else if(k<-0.5) ned.push(t);
    });
    return op.length? op : ned;
  }
  function triSti(t,B){ udvid(B,t[0],t[1]); udvid(B,t[2],t[3]); udvid(B,t[4],t[5]); return 'M'+r2(t[0])+' '+r2(-t[1])+'L'+r2(t[2])+' '+r2(-t[3])+'L'+r2(t[4])+' '+r2(-t[5])+'Z'; }
  function iTri(t,x,y){ var d=function(a,b,c,d2){ return (x-c)*(b-d2)-(a-c)*(y-d2); }; var s1=d(t[0],t[1],t[2],t[3]),s2=d(t[2],t[3],t[4],t[5]),s3=d(t[4],t[5],t[0],t[1]); return !((s1<0||s2<0||s3<0)&&(s1>0||s2>0||s3>0)); }

  // Konveks hul af alle punkter (vinduers og døres fodaftryk).
  function hul(meshes,B){
    var p=[]; (meshes||[]).forEach(function(m){ var q=m&&m.pos; if(!q) return; for(var i=0;i+2<q.length;i+=3) p.push([q[i],q[i+1]]); });
    if(p.length<3) return null;
    p.sort(function(a,b){ return a[0]-b[0]||a[1]-b[1]; });
    var kryds=function(o,a,b){ return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]); }, ned=[], op=[];
    p.forEach(function(q){ while(ned.length>=2&&kryds(ned[ned.length-2],ned[ned.length-1],q)<=0) ned.pop(); ned.push(q); });
    p.slice().reverse().forEach(function(q){ while(op.length>=2&&kryds(op[op.length-2],op[op.length-1],q)<=0) op.pop(); op.push(q); });
    var h=ned.slice(0,-1).concat(op.slice(0,-1)); if(h.length<3) return null;
    h.forEach(function(q){ udvid(B,q[0],q[1]); });
    return 'M'+h.map(function(q){ return r2(q[0])+' '+r2(-q[1]); }).join('L')+'Z';
  }

  function katFlade(f,rand){ var v=VP.vurderFlade(f,rand); if(v.ikke) return 'ikke'; if(!v.med||v.art==='ukendt') return 'afklar'; return v.art; }
  // Elementets farve på denne etage: det, der fylder mest for etagens egne rum. Regnes mindst en fjerdedel med, vises det frem for «indgår ikke».
  function katElement(el,niveau,rand){
    if(!el||el.udenfor||!el.flader.length) return 'uden';
    var fl=el.flader.filter(function(f){ return (f.a.art==='rum'&&f.a.niveau===niveau)||(f.b.art==='rum'&&f.b.niveau===niveau); });
    if(!fl.length) fl=el.flader;
    var t={}, sum=0;
    fl.forEach(function(f){ var k=katFlade(f,rand), v=f.andel==null?1:f.andel; t[k]=(t[k]||0)+v; sum+=v; });
    var kl=Object.keys(t).sort(function(x,y){ return t[y]-t[x]; }), regnet=kl.filter(function(k){ return k!=='ikke'&&sum>0&&t[k]/sum>=0.25; })[0];
    return regnet||kl[0]||'uden';
  }

  function niveauListe(model,a){
    var l=a.ix.niveauer.slice(), kendt={}; l.forEach(function(n){ kendt[n.navn]=1; });
    (model.elements||[]).forEach(function(e){ if(e&&!e.erRum&&e.category==='Tage'&&e.level&&!kendt[e.level]){ var b=G.boks(e.meshes); if(b){ l.push({navn:e.level,z:b.z0}); kendt[e.level]=1; } } });
    l.sort(function(x,y){ return x.z-y.z; });
    return l.map(function(n,i){ return {navn:n.navn,z0:n.z,z1:i+1<l.length? l[i+1].z : Infinity}; });
  }
  function overlap(b,n){ return Math.min(b.z1,n.z1)-Math.max(b.z0,n.z0); }

  function rumPaaNiveau(a,navn){
    return (a.rum||[]).map(function(r){ var u=a.ix.rumAfId[String(r.id)]; return u&&u.boks&&r.niveau===navn? {r:r,u:u} : null; }).filter(Boolean);
  }
  function rumFodaftryk(u){
    var t=[], z=u.boks.z0;
    G.hvertTrekant(u.meshes,function(ax,ay,az,bx,by,bz,cx,cy,cz){
      var ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az, nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.sqrt(nx*nx+ny*ny+nz*nz);
      if(l<1e-9||Math.abs(nz/l)<0.7||(az+bz+cz)/3>z+0.1) return; t.push([ax,ay,bx,by,cx,cy]);
    });
    return t;
  }
  // Stedet til rummets tekst: tyngdepunktet, eller midten af den største trekant, hvis rummet er L-formet.
  function tekstSted(t){
    var A=0,sx=0,sy=0,stor=null,storA=0;
    t.forEach(function(q){ var a=Math.abs((q[2]-q[0])*(q[5]-q[1])-(q[4]-q[0])*(q[3]-q[1]))/2,cx=(q[0]+q[2]+q[4])/3,cy=(q[1]+q[3]+q[5])/3; A+=a; sx+=cx*a; sy+=cy*a; if(a>storA){ storA=a; stor=[cx,cy]; } });
    if(!(A>0)) return null;
    var c=[sx/A,sy/A];
    return t.some(function(q){ return iTri(q,c[0],c[1]); })? c : stor;
  }
  function rumLag(a,liste,rand,B,medNavn,fs){
    var flader='', tekst='';
    liste.forEach(function(x){
      var t=rumFodaftryk(x.u); if(!t.length) return;
      var s=VP.side({art:'rum',rumtype:x.r.rumtype.id,tilstand:x.r.tilstand,navn:x.r.navn},rand).art, f=(RUM[s]||RUM.opvarmet).f;
      flader+="<path d='"+t.map(function(q){ return triSti(q,B); }).join('')+"' fill='"+f+"' stroke='"+f+"' stroke-width='0.02'/>";
      var c=tekstSted(t); if(!c) return;
      var raa=x.r.kilde||{}, nr=String(raa.number||'').trim(), navn=String(raa.name||'').trim(), bredde=x.u.boks.x1-x.u.boks.x0;
      var linje1=nr||navn, linje2=nr&&navn&&medNavn&&navn.length*fs*0.5<=bredde*0.95? navn : '';
      if(!linje1) return;
      var y0=-c[1]+(linje2?-fs*0.15:fs*0.35);
      tekst+="<text x='"+r2(c[0])+"' y='"+r2(y0)+"' font-size='"+r2(fs)+"' text-anchor='middle' fill='#333'>"+xml(linje1)+"</text>";
      if(linje2) tekst+="<text x='"+r2(c[0])+"' y='"+r2(y0+fs*1.15)+"' font-size='"+r2(fs*0.85)+"' text-anchor='middle' fill='#555'>"+xml(linje2)+"</text>";
    });
    return {flader:flader,tekst:tekst};
  }
  function maalestok(B,fs){
    var w=B.x1-B.x0, l=[1,2,5,10,20,50,100].filter(function(v){ return v<=w/4; }).pop()||1, y=-B.y0+fs*1.6, x=B.x0;
    return "<path d='M"+r2(x)+" "+r2(y)+"h"+l+"' stroke='#333' stroke-width='"+r2(fs*0.25)+"' fill='none'/><text x='"+r2(x+l+fs*0.5)+"' y='"+r2(y+fs*0.35)+"' font-size='"+r2(fs)+"' fill='#333'>"+l+" m</text>";
  }
  function svg(B,fs,indhold,bredde){
    var m=Math.max(0.5,fs), x=r2(B.x0-m), y=r2(-B.y1-m), w=r2(B.x1-B.x0+2*m), h=r2(B.y1-B.y0+2*m+fs*2.6);
    return {w:w,h:h,bredde:bredde,svg:"<svg xmlns='http://www.w3.org/2000/svg' viewBox='"+x+" "+y+" "+w+" "+h+"' font-family='Libertinus Serif'>"+indhold+maalestok(B,fs)+"</svg>"};
  }
  // Tegningens bredde på papiret (mm) og skriften i meter, så teksten er ca. 5,5 pt uanset bygningens størrelse.
  function papir(B,maksB,maksH){ var w=B.x1-B.x0+2, h=B.y1-B.y0+4; return Math.round(Math.min(maksB,maksH*w/h)); }
  function skrift(B,bredde){ return Math.max(0.12,Math.min(2,1.95*(B.x1-B.x0+2)/bredde)); }
  // Rummets omrids: de kanter, kun én trekant har (ikke trekanternes indre diagonaler).
  function omrids(t){
    var k={}, nk=function(x,y){ return Math.round(x*100)+','+Math.round(y*100); };
    function add(a,b,c,d){ var p=nk(a,b), q=nk(c,d); if(p===q) return; var n=p<q? p+'|'+q : q+'|'+p; (k[n]||(k[n]={n:0,a:a,b:b,c:c,d:d})).n++; }
    t.forEach(function(q){ add(q[0],q[1],q[2],q[3]); add(q[2],q[3],q[4],q[5]); add(q[4],q[5],q[0],q[1]); });
    return Object.keys(k).filter(function(n){ return k[n].n===1; }).map(function(n){ var e=k[n]; return 'M'+r2(e.a)+' '+r2(-e.b)+'L'+r2(e.c)+' '+r2(-e.d); }).join('');
  }

  /* ---------- Vægge, vinduer og døre ---------- */
  function vaegPlan(n,els,a,rand){
    var vg=els.filter(function(e){ if(e.category!=='Vægge') return false; var b=G.boks(e.meshes); return b&&overlap(b,n)>=0.5; });
    var aab=els.filter(function(e){ if(e.category!=='Vinduer'&&e.category!=='Døre'&&e.category!=='Glasfacader') return false; var b=G.boks(e.meshes); if(!b) return false; var z=(b.z0+b.z1)/2; return z>=n.z0&&z<n.z1; });
    var rum=rumPaaNiveau(a,n.navn);
    if(!vg.length&&!rum.length) return null;
    var B=nyBoks(), lag={};
    vg.forEach(function(e){ var k=katElement(a.afId[String(e.id)],n.navn,rand); lag[k]=(lag[k]||'')+fodaftryk(e.meshes).map(function(t){ return triSti(t,B); }).join(''); });
    var vaegge=ORDEN.map(function(k){ return lag[k]? "<path d='"+lag[k]+"' fill='"+KAT[k].f+"' stroke='"+KAT[k].f+"' stroke-width='0.02'/>" : ''; }).join('');
    var aabninger=aab.map(function(e){ var d=hul(e.meshes,B); if(!d) return ''; var k=katElement(a.afId[String(e.id)],n.navn,rand);
      return "<path d='"+d+"' fill='"+(e.category==='Døre'?'#e9ecef':'#ffffff')+"' stroke='"+KAT[k].f+"' stroke-width='0.05'/>"; }).join('');
    rum.forEach(function(x){ udvid(B,x.u.boks.x0,x.u.boks.y0); udvid(B,x.u.boks.x1,x.u.boks.y1); });
    if(!gyldig(B)) return null;
    var bredde=papir(B,166,185), fs=skrift(B,bredde), r=rumLag(a,rum,rand,B,true,fs);
    return svg(B,fs,r.flader+vaegge+aabninger+r.tekst,bredde);
  }

  /* ---------- Dæk og tag: hvert stykke farves efter hvad der er over og under det ---------- */
  function daekPlan(n,els,a,rand,forrige){
    var dk=els.filter(function(e){ return (e.category==='Gulve'||e.category==='Tage')&&e.level===n.navn; });
    if(!dk.length) return null;
    var B=nyBoks(); dk.forEach(function(e){ var b=G.boks(e.meshes); if(b){ udvid(B,b.x0,b.y0); udvid(B,b.x1,b.y1); } });
    if(!gyldig(B)) return null;
    var c=Math.max(0.2,Math.max(B.x1-B.x0,B.y1-B.y0)/170), lag={};
    function rect(k,x0,x1,y){ lag[k]=(lag[k]||'')+'M'+r2(x0)+' '+r2(-(y+c))+'h'+r2(x1-x0)+'v'+r2(c+0.02)+'h'+r2(x0-x1)+'Z'; }
    dk.forEach(function(e){
      var el=a.afId[String(e.id)], bx=G.boks(e.meshes), tr=fodaftryk(e.meshes); if(!bx||!tr.length) return;
      var fast=e.category==='Tage'||!el||el.udenfor? katElement(el,n.navn,rand) : null;
      for(var yy=B.y0; yy<B.y1; yy+=c){ if(yy+c<bx.y0||yy>bx.y1) continue;
        var run=null, fra=0;
        for(var xx=B.x0; xx<=B.x1; xx+=c){
          var k=null, x=xx+c/2, y=yy+c/2;
          if(xx<B.x1&&x>=bx.x0&&x<=bx.x1&&tr.some(function(t){ return iTri(t,x,y); })){
            if(fast) k=fast; else { var f=P.daekCelle(a.ix,e,bx,x,y,bx.z1); k=f? katFlade(f,rand) : 'uden'; }
          }
          if(k!==run){ if(run) rect(run,fra,xx,yy); run=k; fra=xx; }
        }
      }
    });
    var rum=rumPaaNiveau(a,n.navn); if(!rum.length&&forrige) rum=rumPaaNiveau(a,forrige);
    var bredde=papir(B,120,110), fs=skrift(B,bredde), r=rumLag(a,rum,rand,nyBoks(),false,fs);
    var flade=ORDEN.map(function(k){ return lag[k]? "<path d='"+lag[k]+"' fill='"+KAT[k].f+"' fill-opacity='0.8'/>" : ''; }).join('');
    // Rumgrænser oven på farverne, så man kan se, hvor rummene ligger
    var streger=rum.map(function(x){ return "<path d='"+omrids(rumFodaftryk(x.u))+"' fill='none' stroke='#ffffff' stroke-width='"+r2(fs*0.12)+"' stroke-opacity='0.75'/>"; }).join('');
    return svg(B,fs,flade+streger+r.tekst,bredde);
  }

  function planer(model,a,rand){
    if(!a||!a.harRum||!a.ix) return [];
    var els=(model.elements||[]).filter(function(e){ return e&&!e.erRum&&e.meshes&&e.meshes.length; });
    var l=niveauListe(model,a);
    return l.map(function(n,i){ return {niveau:n.navn,vaegge:vaegPlan(n,els,a,rand),daek:daekPlan(n,els,a,rand,i>0?l[i-1].navn:null)}; }).filter(function(p){ return p.vaegge||p.daek; });
  }
  return {KAT:KAT, RUM:RUM, ORDEN:ORDEN, planer:planer};
});
