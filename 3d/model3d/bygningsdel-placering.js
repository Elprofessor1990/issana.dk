/* ISSANA 3D: hvor sidder hver bygningsdel? Rent modul uden DOM og uden three.js.
   Browser: window.IssanaPlacering. Node: module.exports. Bruges af Varmetabsberegning og af Lyd.

   For hver væg, hvert dæk, tag, loft, vindue, dør og glasfacade: hvad er på hver side (rum, ude, jord eller ukendt).
   Grundlaget er 3D-eksporten (issana-3d/1.2 eller nyere):
   - rooms[].graenser: de elementer, Revit siger afgrænser rummet (id, areal, side/top/bund). Det er det autoritative.
   - rummenes og elementernes meshes: hvilken side af elementet hvert rum ligger på, og hvor stor en del af elementet
     der vender mod hvert rum. Et prøvepunkt lige uden for elementets flade testes mod rummenes volumen.
   - revit.funktion (Exterior, Interior, Foundation, Retaining) afgør siden uden rum.
   Uden meshes falder analysen tilbage på graenser og funktion, og sikkerheden sættes ned.

   Rumtypen læses af brugerens rumanvendelse (ISSANA Instance Room Use) eller af rumnavnet. Et navn er kun et forslag,
   og ukendte navne bliver «ukendt», ikke et gæt. Modulet kender ingen temperaturer: det leverer varmetab-placering.js. */
(function(root, factory){
  "use strict";
  var erNode = typeof module==='object' && module && module.exports;
  var api = factory();
  if(erNode) module.exports=api; else root.IssanaPlacering=api;
})(typeof self!=='undefined' ? self : this, function(){
  "use strict";

  /* ---------- Rumtyper ---------- */
  // tilstand: opvarmet, uopvarmet, ude eller afhaenger (opvarmet over terræn, uopvarmet i kælder).
  var RUMTYPER={
    ophold:{navn:'Opholdsrum',rumbrug:'ophold',tilstand:'opvarmet'},
    soverum:{navn:'Soverum',rumbrug:'soverum',tilstand:'opvarmet'},
    hotelvaerelse:{navn:'Hotelværelse',rumbrug:'hotelværelse',tilstand:'opvarmet'},
    koekken:{navn:'Køkken/alrum',rumbrug:'køkken/alrum',tilstand:'opvarmet'},
    bad:{navn:'Bad/wc',rumbrug:'bad/wc',tilstand:'opvarmet',vaadrum:true},
    gang:{navn:'Gang/entré',rumbrug:'gang/entré',tilstand:'opvarmet'},
    trapperum:{navn:'Trapperum',rumbrug:'trapperum',tilstand:'opvarmet'},
    kontor:{navn:'Kontor',rumbrug:'kontor',tilstand:'opvarmet'},
    undervisning:{navn:'Undervisning',rumbrug:'undervisning',tilstand:'opvarmet'},
    moede:{navn:'Mødelokale',rumbrug:'mødelokale',tilstand:'opvarmet'},
    teknik:{navn:'Teknikrum',rumbrug:'teknik',tilstand:'afhaenger'},
    depot:{navn:'Depot',rumbrug:'depot',tilstand:'afhaenger'},
    parkering:{navn:'Garage/cykelparkering',rumbrug:'andet',tilstand:'uopvarmet'},
    ude:{navn:'Udendørs (gårdrum, terrasse)',rumbrug:'andet',tilstand:'ude'},
    andet:{navn:'Andet',rumbrug:'andet',tilstand:'opvarmet'},
    ukendt:{navn:'Ukendt',rumbrug:null,tilstand:'afhaenger'}
  };
  // Rumanvendelsen (samme ord som RUMANVENDELSER i arbejdsrum.js) → rumtype.
  var FRA_RUMBRUG={'ophold':'ophold','soverum':'soverum','hotelværelse':'hotelvaerelse','køkken/alrum':'koekken','bad/wc':'bad','gang/entré':'gang',
    'trapperum':'trapperum','teknik':'teknik','depot':'depot','kontor':'kontor','undervisning':'undervisning','mødelokale':'moede','andet':'andet'};
  // Rumnavn → rumtype. Først-til-mølle, så det mest specifikke står øverst («Reception/Gang» er en gang; «Gårdrum» er ude).
  var NAVNE=[
    [/g[åa]rdrum|terr?asse|altan|udend[øo]rs|carport|\bude\b/,'ude'],
    [/cykel|garage|parkering/,'parkering'],
    [/\bbad\b|baderum|toilet|\bwc\b|\bhc-?toilet|omkl[æa]dning|bryggers/,'bad'],
    [/k[øo]kken|alrum|tek[øo]kken|anretning/,'koekken'],
    [/v[æa]relse|sovev|soverum/,'soverum'],
    [/trapperum|\btrappe/,'trapperum'],
    [/kontor|administration/,'kontor'],
    [/m[øo]de|konference/,'moede'],
    [/klasse|undervisning|faglokale|auditorium/,'undervisning'],
    [/teknik|ventilation|vvs|el-?\s*og\s*hovedtavle|tavlerum|fyrrum|varmecentral|sprinkler|kedel/,'teknik'],
    [/depot|lager|pulter|k[æa]lderrum|rengøring|rengoring/,'depot'],
    [/gang|entr[ée]|forrum|forstue|vindfang|korridor|reception|lobby/,'gang'],
    [/stue|ophold|personalerum|f[æa]llesrum|restaurant|café|cafe|kantine|studio|yoga|bibliotek/,'ophold']
  ];
  var STANDARDNAVN=/^(room|rum|raum|pi[eè]ce|local|stanza|habitaci[oó]n)( ?\d+)?$/i;
  function erStandardNavn(navn){ var s=String(navn==null?'':navn).trim(); return s===''||STANDARDNAVN.test(s); }

  function rumtypeAf(rum){
    var b=rum&&rum.bygdata, brug=(b&&b.roomUse)||(b&&b.raw&&b.raw['ISSANA Instance Room Use'])||'';
    brug=String(brug).trim().toLowerCase();
    if(brug&&FRA_RUMBRUG[brug]) return {id:FRA_RUMBRUG[brug],fra:'rumanvendelse',navn:RUMTYPER[FRA_RUMBRUG[brug]].navn,ord:brug};
    var navn=String((rum&&rum.name)||'').toLowerCase();
    if(navn&&!erStandardNavn(navn)) for(var i=0;i<NAVNE.length;i++){ var m=NAVNE[i][0].exec(navn); if(m) return {id:NAVNE[i][1],fra:'navn',navn:RUMTYPER[NAVNE[i][1]].navn,ord:m[0]}; }
    return {id:'ukendt',fra:null,navn:RUMTYPER.ukendt.navn,ord:null};
  }
  function rumNavn(r){ return ((r.number?r.number+' ':'')+(r.name||'')).trim()||('Rum '+r.id); }

  /* ---------- Geometri ---------- */
  function boks(meshes){
    var b=null; (meshes||[]).forEach(function(m){ var p=m&&m.pos; if(!p) return;
      for(var i=0;i+2<p.length;i+=3){ if(!b) b={x0:p[i],x1:p[i],y0:p[i+1],y1:p[i+1],z0:p[i+2],z1:p[i+2]};
        else { if(p[i]<b.x0)b.x0=p[i]; if(p[i]>b.x1)b.x1=p[i]; if(p[i+1]<b.y0)b.y0=p[i+1]; if(p[i+1]>b.y1)b.y1=p[i+1]; if(p[i+2]<b.z0)b.z0=p[i+2]; if(p[i+2]>b.z1)b.z1=p[i+2]; } } });
    return b;
  }
  function hvertTrekant(meshes,fn){ (meshes||[]).forEach(function(m){ var p=m&&m.pos, ix=m&&m.idx; if(!p||!ix) return;
    for(var i=0;i+2<ix.length;i+=3){ var a=ix[i]*3,b=ix[i+1]*3,c=ix[i+2]*3; fn(p[a],p[a+1],p[a+2],p[b],p[b+1],p[b+2],p[c],p[c+1],p[c+2]); } }); }
  // Möller-Trumbore: afstand t>EPS langs (dx,dy,dz), ellers -1.
  function straale(ox,oy,oz,dx,dy,dz,ax,ay,az,bx,by,bz,cx,cy,cz){
    var e1x=bx-ax,e1y=by-ay,e1z=bz-az,e2x=cx-ax,e2y=cy-ay,e2z=cz-az;
    var px=dy*e2z-dz*e2y,py=dz*e2x-dx*e2z,pz=dx*e2y-dy*e2x, det=e1x*px+e1y*py+e1z*pz;
    if(det>-1e-12&&det<1e-12) return -1;
    var f=1/det,sx=ox-ax,sy=oy-ay,sz=oz-az,u=f*(sx*px+sy*py+sz*pz); if(u<0||u>1) return -1;
    var qx=sy*e1z-sz*e1y,qy=sz*e1x-sx*e1z,qz=sx*e1y-sy*e1x,v=f*(dx*qx+dy*qy+dz*qz); if(v<0||u+v>1) return -1;
    var t=f*(e2x*qx+e2y*qy+e2z*qz); return t>1e-7? t : -1;
  }
  // Er punktet inde i rummets lukkede volumen? Skæv stråleretning, så stråler ikke rammer samlinger mellem trekanter.
  function iRum(r,x,y,z){
    var b=r.boks; if(!b||x<b.x0||x>b.x1||y<b.y0||y>b.y1||z<b.z0||z>b.z1) return false;
    var n=0; hvertTrekant(r.meshes,function(ax,ay,az,bx,by,bz,cx,cy,cz){ if(straale(x,y,z,0.3847,0.2913,0.8755,ax,ay,az,bx,by,bz,cx,cy,cz)>=0) n++; });
    return n%2===1;
  }
  function rumVed(ix,x,y,z,kandidater){
    var l=kandidater||ix.rum;
    for(var i=0;i<l.length;i++) if(iRum(l[i],x,y,z)) return l[i];
    return null;
  }
  // Rum lige under/over (z): rummets volumen når ikke altid op til dækket (Revit: limit offset), så søges i højden.
  function rumILodlinje(ix,x,y,z,retning,maks){
    var bedst=null, bedstD=Infinity;
    ix.rum.forEach(function(r){ var b=r.boks; if(!b||x<b.x0||x>b.x1||y<b.y0||y>b.y1) return;
      var d=retning<0? z-b.z1 : b.z0-z; if(d>maks||d<-((b.z1-b.z0)+0.01)) return;
      if(retning<0&&b.z0>=z) return; if(retning>0&&b.z1<=z) return;
      var h=retning<0? Math.min(z-0.05,b.z1-0.05) : Math.max(z+0.05,b.z0+0.05); if(!iRum(r,x,y,h)) return;
      var a=Math.max(0,d); if(a<bedstD){ bedstD=a; bedst=r; } });
    return bedst;
  }

  // Prøvepunkter på elementets flader: {x,y,z,nx,ny,nz,v} med v = arealvægt. Store trekanter deles, så punkterne dækker fladen.
  function proever(meshes,filter,maksM2){
    var ud=[]; maksM2=maksM2||2.5;
    hvertTrekant(meshes,function(ax,ay,az,bx,by,bz,cx,cy,cz){
      var ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
      var nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.sqrt(nx*nx+ny*ny+nz*nz); if(l<1e-9) return;
      var areal=l/2; nx/=l; ny/=l; nz/=l; if(!filter(nx,ny,nz)) return;
      var n=Math.min(6,Math.max(1,Math.ceil(Math.sqrt(areal/maksM2)))), v=areal/(n*n);
      for(var i=0;i<n;i++) for(var j=0;j<n-i;j++){
        // Barycentriske midtpunkter af et trekantgitter (opad- og nedadvendte små trekanter vægtes ens nok til formålet)
        var s=(i+1/3)/n,t=(j+1/3)/n; if(s+t>=1) continue;
        ud.push({x:ax+s*ux+t*vx,y:ay+s*uy+t*vy,z:az+s*uz+t*vz,nx:nx,ny:ny,nz:nz,v:v}); }
    });
    return ud;
  }
  // Afstand gennem elementet fra punktet modsat normalen (lokal tykkelse); -1 uden træf.
  function tykkelse(meshes,p){
    var d=-1; hvertTrekant(meshes,function(ax,ay,az,bx,by,bz,cx,cy,cz){ var t=straale(p.x-p.nx*0.001,p.y-p.ny*0.001,p.z-p.nz*0.001,-p.nx,-p.ny,-p.nz,ax,ay,az,bx,by,bz,cx,cy,cz); if(t>=0&&(d<0||t<d)) d=t; });
    return d;
  }
  function median(l){ if(!l.length) return 0; var s=l.slice().sort(function(a,b){return a-b;}); return s[Math.floor(s.length/2)]; }

  // Væg: hvilke rum ligger på hver side, og med hvilke andele? Svarer {par:[{a,b,v}],daekning} eller null uden geometri.
  var AFSTAND=0.2, TYK_FAKTOR=1.5;
  function parForVaeg(ix,e){
    if(!ix.harRumMesh||!e.meshes||!e.meshes.length) return null;
    var pr=proever(e.meshes,function(nx,ny,nz){ return Math.abs(nz)<0.3; });
    if(!pr.length) return null;
    if(pr.length>400){ var trin=pr.length/400, tynd=[]; for(var q=0;q<400;q++) tynd.push(pr[Math.floor(q*trin)]); var f=pr.length/400; tynd.forEach(function(x){ x.v*=f; }); pr=tynd; }
    var boksE=boks(e.meshes), nabo=ix.rum.filter(function(r){ var b=r.boks; return b&&b.x0<=boksE.x1+1&&b.x1>=boksE.x0-1&&b.y0<=boksE.y1+1&&b.y1>=boksE.y0-1&&b.z0<=boksE.z1+0.5&&b.z1>=boksE.z0-0.5; });
    var t=pr.map(function(p){ return tykkelse(e.meshes,p); });
    var hits=t.filter(function(x){ return x>0; }), T=median(hits); if(!(T>0)) return null;
    var par={}, medRum=0, alt=0;
    pr.forEach(function(p,i){
      // Kun hovedfladerne: endeflader og lysninger har et langt stykke til modstående flade.
      if(!(t[i]>0)||t[i]>T*TYK_FAKTOR+0.02) return;
      alt+=p.v;
      var ra=rumVed(ix,p.x+p.nx*AFSTAND,p.y+p.ny*AFSTAND,p.z+p.nz*AFSTAND,nabo);
      var d=t[i]+AFSTAND, rb=rumVed(ix,p.x-p.nx*d,p.y-p.ny*d,p.z-p.nz*d,nabo);
      if(!ra&&!rb) return;
      medRum+=p.v;
      var ida=ra?ra.id:null, idb=rb?rb.id:null;
      if(ida===idb&&ida!=null) return;              // samme rum på begge sider: ikke en grænse (skakt, nedstik)
      var a=ra,b=rb; if(!a||(b&&String(a.id)>String(b.id))){ var x=a;a=b;b=x; }
      var k=String(a?a.id:'-')+'|'+String(b?b.id:'-');
      (par[k]||(par[k]={a:a,b:b,v:0})).v+=p.v;
    });
    var liste=Object.keys(par).map(function(k){ return par[k]; }).sort(function(x,y){ return y.v-x.v; });
    return {par:liste, daekning:alt>0?medRum/alt:0, tykkelse:T};
  }

  /* ---------- Indeks ---------- */
  function lavIndeks(model){
    var ix={els:{},rum:[],rumAfId:{},naboer:{},aabninger:{},harRumMesh:false};
    (model.elements||[]).forEach(function(e){ if(e&&!e.erRum&&!e.installation&&e.id!=null) ix.els[String(e.id)]=e; });
    var rum=Array.isArray(model.rooms)? model.rooms : [];
    if(!rum.length) (model.elements||[]).forEach(function(e){ if(e&&e.erRum) rum.push(e); });
    rum.forEach(function(r){
      var u={id:r.id,uniqueId:r.uniqueId||null,navn:rumNavn(r),rumnavn:r.name||'',niveau:r.level||null,areal:r.area,volumen:r.volume,meshes:r.meshes||[],boks:boks(r.meshes),
        rumtype:rumtypeAf(r),graenser:r.graenser||[],kilde:r};
      ix.rum.push(u); ix.rumAfId[String(r.id)]=u;
      if(u.boks) ix.harRumMesh=true;
      u.graenser.forEach(function(g){ (ix.naboer[String(g.id)]||(ix.naboer[String(g.id)]=[])).push({rum:u,areal:g.areal,side:g.side}); });
    });
    (model.elements||[]).forEach(function(e){ if(e&&e.hostId!=null) (ix.aabninger[String(e.hostId)]||(ix.aabninger[String(e.hostId)]=[])).push(e); });
    ix.niveauer=niveauer(model,ix);
    ix.terraenZ=terraen(ix);
    return ix;
  }
  function erKaelderNavn(s){ return /k[æa]lder|basement|\bu\.?\s*etage\b/i.test(String(s||'')); }
  // Niveauer med deres laveste z (gulve og rum), sorteret nedefra.
  function niveauer(model,ix){
    var t={};
    function se(navn,z){ if(navn==null||z==null) return; if(t[navn]==null||z<t[navn]) t[navn]=z; }
    ix.rum.forEach(function(r){ if(r.boks) se(r.niveau,r.boks.z0); });
    var medRum={}; Object.keys(t).forEach(function(k){ medRum[k]=1; });
    // Etager uden rum: dækkets overside er færdigt gulv.
    (model.elements||[]).forEach(function(e){ if(!e||e.erRum||e.category!=='Gulve'||medRum[e.level]) return; var b=boks(e.meshes); if(b) se(e.level,b.z1); });
    return Object.keys(t).map(function(n){ return {navn:n,z:t[n],kaelder:erKaelderNavn(n)}; }).sort(function(a,b){ return a.z-b.z; });
  }
  // Terrænets z: gulvet i den laveste etage, der ikke er en kælder. Uden kælder: den laveste etage.
  function terraen(ix){
    var l=ix.niveauer; for(var i=0;i<l.length;i++) if(!l[i].kaelder) return l[i].z;
    return l.length? l[l.length-1].z : null;
  }
  function rumtilstand(r){
    var t=RUMTYPER[r.rumtype.id]||RUMTYPER.ukendt;
    if(t.tilstand!=='afhaenger') return t.tilstand;
    return erKaelderNavn(r.niveau)? 'uopvarmet':'opvarmet';
  }

  /* ---------- Klassifikation af én bygningsdel ---------- */
  function sideRum(r){ return {art:'rum',rumId:r.id,navn:r.navn,rumtype:r.rumtype.id,rumtypeNavn:r.rumtype.navn,tilstand:rumtilstand(r),niveau:r.niveau}; }
  var UDE={art:'ude'}, JORD_VAEG={art:'jord',rolle:'kaeldervaeg'}, UKENDT={art:'ukendt'};
  function jordVaegSide(){ return JORD_VAEG; }
  function fundFunktion(f){ return f==='Foundation'||f==='Retaining'; }

  function vaegMod(e,ix,side2){
    // Væggen har rum på den ene side; hvad er på den anden?
    var f=e.revit&&e.revit.funktion;
    if(fundFunktion(f)) return {side:{art:'jord',rolle:'kaeldervaeg'},sikkerhed:'hoej',grund:'Revit: '+f};
    if(f==='Exterior'){
      var b=boks(e.meshes), under=ix.terraenZ!=null&&b&&b.z1<=ix.terraenZ+0.05;
      if(under||erKaelderNavn(e.level)) return {side:{art:'jord',rolle:'kaeldervaeg'},sikkerhed:'middel',grund:'Revit: ydervæg på en etage under terræn'};
      return {side:UDE,sikkerhed:'hoej',grund:'Revit: ydervæg (Exterior), og intet rum på den anden side'};
    }
    if(f==='Interior') return {side:UKENDT,sikkerhed:'lav',grund:'Revit: indervæg, men der er intet rum på den anden side. Ret typen, placér rummet, eller vælg selv'};
    return {side:UKENDT,sikkerhed:'lav',grund:'Revit siger ikke, om væggen er inder- eller ydervæg, og der er intet rum på den anden side'};
  }
  function flade(a,b,andel,sikkerhed,grund){ return {a:a,b:b,andel:andel,sikkerhed:sikkerhed,grund:grund}; }
  function retning(f,over,under){ f.over=over?over.id:null; f.under=under?under.id:null; return f; }

  function klassVaeg(e,ix){
    var naboer=ix.naboer[String(e.id)]||[], g=parForVaeg(ix,e), f=e.revit&&e.revit.funktion;
    var fl=[];
    if(g&&g.par.length){
      var sum=g.par.reduce(function(s,p){ return s+p.v; },0);
      g.par.forEach(function(p){
        var andel=sum>0? p.v/sum : 0;
        if(p.a&&p.b) fl.push(flade(sideRum(p.a),sideRum(p.b),andel,'hoej','Geometri: rum på begge sider'));
        else { var m=vaegMod(e,ix); fl.push(flade(sideRum(p.a||p.b),m.side,andel,m.sikkerhed,m.grund)); }
      });
      return fl;
    }
    if(naboer.length){
      // Uden brugbar geometri: rummene fra graenser. Et rum: den anden side afgøres af funktionen. Flere rum: ydervægge deler
      // rummene på samme side, indervægge har dem på hver sin side (kun de to største kendes).
      var alt=naboer.reduce(function(s,n){ return s+(n.areal||0); },0)||1;
      if(naboer.length===1||f==='Exterior'||fundFunktion(f)){
        var m2=vaegMod(e,ix);
        naboer.forEach(function(n){ fl.push(flade(sideRum(n.rum),m2.side,(n.areal||0)/alt,m2.sikkerhed==='hoej'?'middel':m2.sikkerhed,m2.grund+' (uden rummets geometri)')); });
        return fl;
      }
      var st=naboer.slice().sort(function(x,y){ return (y.areal||0)-(x.areal||0); });
      fl.push(flade(sideRum(st[0].rum),sideRum(st[1].rum),1,'middel','Revit: to rum afgrænses af væggen (uden rummets geometri)'));
      return fl;
    }
    if(f==='Exterior'){ var m3=vaegMod(e,ix); return [flade(UKENDT,m3.side,1,'lav','Revit: ydervæg, men intet rum afgrænses af den (fx brystning eller havemur). Regnes ikke med, før du vælger den')]; }
    if(fundFunktion(f)) return [flade(UKENDT,{art:'jord',rolle:'kaeldervaeg'},1,'lav','Revit: '+f+', men intet rum afgrænses af den. Regnes ikke med, før du vælger den')];
    return [];
  }

  // Ét punkt på et dæk (plantegningen): samme regler som klassDaek, men for ét sted i stedet for andele af hele dækket.
  function daekCelle(ix,e,bx,x,y,zTop){
    var T=bx? bx.z1-bx.z0 : 0.3, over=rumILodlinje(ix,x,y,zTop+0.02,1,1.2), under=rumILodlinje(ix,x,y,zTop-Math.min(T,1.0)-0.02,-1,2.0);
    if(!over&&!under) return null;
    if(over&&under) return retning(flade(sideRum(over),sideRum(under),1,'hoej',''),over,under);
    if(over) return retning(daekUnderUdenRum(e,ix,bx,over,1),over,null);
    var dk=harDaekOver(ix,e,x,y,zTop); if(dk) return retning(flade(sideRum(under),UKENDT,1,'lav',dk==='tag'?GRUND_TAG_PAA_DAEKKET:GRUND_DAEKKET),null,under);
    return retning(flade(sideRum(under),UDE,1,'middel',''),null,under);
  }
  function iTri2(t,x,y){ var d=function(a,b,c,e){ return (x-c)*(b-e)-(a-c)*(y-e); }, s1=d(t[0],t[1],t[2],t[3]), s2=d(t[2],t[3],t[4],t[5]), s3=d(t[4],t[5],t[0],t[1]); return !((s1<0||s2<0||s3<0)&&(s1>0||s2>0||s3>0)); }
  function daekFlader(ix){
    if(ix.daekFlader) return ix.daekFlader;
    var l=[];
    Object.keys(ix.els).forEach(function(id){ var e=ix.els[id]; if(e.category!=='Gulve'&&e.category!=='Tage') return; var b=boks(e.meshes), t=[]; if(!b) return;
      hvertTrekant(e.meshes,function(ax,ay,az,bx,by,bz,cx,cy,cz){ var nz=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax); if(Math.abs(nz)>1e-9) t.push([ax,ay,bx,by,cx,cy]); });
      l.push({id:e.id,b:b,t:t,tag:e.category==='Tage'}); });
    return (ix.daekFlader=l);
  }
  // Er der noget over dækket i punktet? Returnerer false, true (dæk eller tag mindst 0,5 m over) eller 'tag' (en tagopbygning, der
  // ligger direkte på dækket: den er tynd, så dens top er under 0,5 m over dækket, men taget dækker dækket, og tabet regnes i taget).
  function harDaekOver(ix,e,x,y,z){
    var fund=false, l=daekFlader(ix);
    for(var i=0;i<l.length&&fund!=='tag';i++){ var d=l[i], b=d.b; if(d.id===e.id||b.z1>z+9||x<b.x0||x>b.x1||y<b.y0||y>b.y1) continue;
      var paa=d.tag&&b.z0>=z-0.05&&b.z0<=z+0.5&&b.z1>z+0.02, over=b.z1>=z+0.5;
      if(!paa&&!over) continue;
      if(d.t.some(function(q){ return iTri2(q,x,y); })) fund=paa?'tag':true; }
    return fund;
  }
  var GRUND_TAG_PAA_DAEKKET='Taget ligger på dækket; tabet regnes i taget, så dækket regnes ikke mod det fri.';
  var GRUND_DAEKKET='Intet rum over dækket her, men bygningen fortsætter opad. Rummet mangler i modellen (fx en badekabine), så siden er uafklaret.';
  function erGulvHeltNede(ix,bx){
    var l=ix.niveauer; if(!l.length||!bx) return false;
    return bx.z1<=l[0].z+0.3;
  }
  // Dækket ligger i terrænhøjde: uden rum under er det terrændæk, også hvor kælderen kun ligger under en del af bygningen.
  function erVedTerraen(ix,bx){ return !!bx&&ix.terraenZ!=null&&Math.abs(bx.z1-ix.terraenZ)<=0.6; }
  function klassDaek(e,ix){
    var bx=boks(e.meshes), fl=[];
    // Prøvepunkter på oversiden; rummet over kendes fra Revit (bund) eller geometrien, rummet under fra lodlinjen.
    var pr=e.meshes&&e.meshes.length&&ix.harRumMesh? proever(e.meshes,function(nx,ny,nz){ return nz>0.7; },6) : [];
    var naboer=ix.naboer[String(e.id)]||[], overNabo=naboer.filter(function(n){ return n.side==='bund'; }), underNabo=naboer.filter(function(n){ return n.side==='top'; });
    if(pr.length){
      if(pr.length>300){ var tr=pr.length/300, ty=[]; for(var q=0;q<300;q++) ty.push(pr[Math.floor(q*tr)]); var fk=pr.length/300; ty.forEach(function(x){ x.v*=fk; }); pr=ty; }
      var T=bx? bx.z1-bx.z0 : 0.3, par={}, alt=0, medRum=0;
      pr.forEach(function(p){
        alt+=p.v;
        var over=rumILodlinje(ix,p.x,p.y,p.z+0.02,1,1.2), under=rumILodlinje(ix,p.x,p.y,p.z-Math.min(T,1.0)-0.02,-1,2.0);
        if(!over&&!under) return;
        medRum+=p.v;
        var daekket=!over&&!!under&&harDaekOver(ix,e,p.x,p.y,p.z);
        var k=String(over?over.id:(daekket?(daekket==='tag'?'t':'d'):'-'))+'|'+String(under?under.id:'-');
        (par[k]||(par[k]={a:over,b:under,v:0,daekket:daekket})).v+=p.v;
      });
      var liste=Object.keys(par).map(function(k){ return par[k]; }).sort(function(a,b){ return b.v-a.v; });
      if(liste.length){
        var sum=liste.reduce(function(s,p){ return s+p.v; },0);
        liste.forEach(function(p){
          var andel=p.v/sum;
          if(p.a&&p.b) fl.push(retning(flade(sideRum(p.a),sideRum(p.b),andel,'hoej','Geometri: rum både over og under dækket'),p.a,p.b));
          else if(p.a) fl.push(retning(daekUnderUdenRum(e,ix,bx,p.a,andel),p.a,null));
          else if(p.daekket) fl.push(retning(flade(sideRum(p.b),UKENDT,andel,'lav',p.daekket==='tag'?GRUND_TAG_PAA_DAEKKET:GRUND_DAEKKET),null,p.b));
          else fl.push(retning(flade(sideRum(p.b),UDE,andel,'middel','Geometri: rum under dækket og intet rum over (tag, loft eller tagrum). Kontrollér'),null,p.b));
        });
        return fl;
      }
    }
    if(overNabo.length){ overNabo.forEach(function(n){ fl.push(retning(daekUnderUdenRum(e,ix,bx,n.rum,1/overNabo.length),n.rum,null)); }); return fl; }
    if(underNabo.length){ underNabo.forEach(function(n){ fl.push(retning(flade(sideRum(n.rum),UDE,1/underNabo.length,'middel','Revit: dækket er loft i rummet, og intet rum er over det'),null,n.rum)); }); return fl; }
    return [];
  }
  function daekUnderUdenRum(e,ix,bx,rum,andel){
    if(erGulvHeltNede(ix,bx)){
      var kaelder=erKaelderNavn(e.level)||(bx&&ix.terraenZ!=null&&bx.z1<ix.terraenZ-0.5);
      return flade(sideRum(rum),{art:'jord',rolle:kaelder?'kaeldergulv':'terraendaek'},andel,'hoej','Laveste etage: dækket ligger på jord');
    }
    if(erVedTerraen(ix,bx)) return flade(sideRum(rum),{art:'jord',rolle:'terraendaek'},andel,'middel','Dæk i terrænhøjde uden kælder under: terrændæk');
    return flade(sideRum(rum),UDE,andel,'lav','Intet rum under dækket, selv om der er etager under. Kan være portrum eller uopvarmet rum uden rum tegnet: kontrollér');
  }
  function klassTag(e,ix){
    var naboer=ix.naboer[String(e.id)]||[];
    var under=naboer.filter(function(n){ return n.side==='top'; });
    if(under.length){ var alt=under.reduce(function(s,n){ return s+(n.areal||0); },0)||1; return under.map(function(n){ return retning(flade(sideRum(n.rum),UDE,(n.areal||0)/alt,'hoej','Revit: taget afgrænser rummet opad'),null,n.rum); }); }
    var bx=boks(e.meshes);
    if(bx){ var r=rumILodlinje(ix,(bx.x0+bx.x1)/2,(bx.y0+bx.y1)/2,bx.z0,-1,3); if(r) return [retning(flade(sideRum(r),UDE,1,'middel','Geometri: rum under taget'),null,r)]; }
    // Midten kan ligge på en væg eller i et rum, der ikke er tegnet. Prøv da punkter fordelt over tagets overside (som klassDaek), og lad taget høre til de rum, der rammes.
    if(bx&&ix.rum.length&&e.meshes&&e.meshes.length){
      var pr=proever(e.meshes,function(nx,ny,nz){ return nz>0.7; },6);
      if(pr.length>300){ var tr=pr.length/300, ty=[]; for(var q=0;q<300;q++) ty.push(pr[Math.floor(q*tr)]); ty.forEach(function(x){ x.v*=tr; }); pr=ty; }
      var T=bx.z1-bx.z0, antalHit=0;
      var alleV=0, treffer=0, hit={};
      pr.forEach(function(p){ alleV+=p.v; var rr=rumILodlinje(ix,p.x,p.y,p.z-Math.min(T,1.0)-0.02,-1,3); if(!rr) return; antalHit++; treffer+=p.v; (hit[String(rr.id)]||(hit[String(rr.id)]={r:rr,v:0})).v+=p.v; });
      if(antalHit){
        // Lille andel af taget (efter areal) over rum, eller kun ét eller to punkter: for tyndt til at regne taget til rummet uden at kontrollere det.
        var andelTreffer=alleV>0? treffer/alleV : antalHit/pr.length, tyndt=andelTreffer<0.25||antalHit<3;
        var tekst='Geometri: rum under taget i '+antalHit+' af '+pr.length+' prøvepunkter på taget (midten ramte intet rum)'+(tyndt? '. Kun '+Math.round(andelTreffer*100)+' % af tagets areal ligger over et rum: kontrollér' : '');
        return Object.keys(hit).map(function(k){ return hit[k]; }).sort(function(a1,b1){ return b1.v-a1.v; }).map(function(h){ return retning(flade(sideRum(h.r),UDE,h.v/treffer,tyndt?'lav':'middel',tekst),null,h.r); });
      }
    }
    if(!ix.rum.length) return [flade(UKENDT,UDE,1,'middel','Modellen har ingen rum; tag regnes mod det fri')];
    return [flade(UKENDT,UDE,1,'lav','Intet rum under taget. Kontrollér, om det dækker et opvarmet rum')];
  }
  function klassLoft(e,ix){
    var naboer=ix.naboer[String(e.id)]||[], under=naboer.filter(function(n){ return n.side==='top'; }); var bx=boks(e.meshes);
    if(!under.length) return [];
    if(bx){ var noget=false; ['Gulve','Tage'].forEach(function(k){ Object.keys(ix.els).forEach(function(id){ var x=ix.els[id]; if(x.category!==k||noget) return; var b=boks(x.meshes); if(b&&b.x0<bx.x1&&b.x1>bx.x0&&b.y0<bx.y1&&b.y1>bx.y0&&b.z0>=bx.z1-0.2&&b.z0<bx.z1+4) noget=true; }); });
      if(noget) return [];   // dæk eller tag over: nedhængt loft, varmetabet regnes i det, der er over
    }
    return under.map(function(n){ return retning(flade(sideRum(n.rum),{art:'ude',rolle:'tagrum'},1/under.length,'middel','Loft med tag/tagrum over og intet dæk tegnet'),null,n.rum); });
  }
  function klassAabning(e,ix,alle){
    // Vindue/dør: FromRoom/ToRoom fra Revit; ellers samme side som værtsvæggen. En glasfacade uden vært kendes ikke.
    if(e.category==='Glasfacader'){
      var g=parForVaeg(ix,e);
      if(g&&g.par.length){ var sum=g.par.reduce(function(s,p){ return s+p.v; },0);
        return g.par.map(function(p){ var andel=sum>0? p.v/sum : 0; return p.a&&p.b? flade(sideRum(p.a),sideRum(p.b),andel,'hoej','Geometri: rum på begge sider af glasfacaden') : flade(sideRum(p.a||p.b),UDE,andel,'middel','Geometri: rum på den ene side af glasfacaden, intet rum på den anden'); }); }
    }
    var rum=Array.isArray(e.rum)? e.rum.map(function(i){ return ix.rumAfId[String(i)]; }).filter(Boolean) : [];
    if(rum.length>=2) return [flade(sideRum(rum[0]),sideRum(rum[1]),1,'hoej','Revit: rum på begge sider af åbningen')];
    var vaert=e.hostId!=null? alle[String(e.hostId)] : null, vaertNabo=vaert&&vaert.flader&&vaert.flader[0];
    if(rum.length===1){
      if(vaertNabo){ var modsat=vaertNabo.b.art==='rum'&&vaertNabo.b.rumId===rum[0].id? vaertNabo.a : vaertNabo.b;
        if(modsat.art==='jord') return [flade(sideRum(rum[0]),UDE,1,'middel','Åbning i en kælderydervæg: fører til det fri (lyskasse, nedgang)')];
        if(modsat.art==='ukendt') return [flade(sideRum(rum[0]),UKENDT,1,'lav','Væggen har intet rum på den anden side af åbningen')];
        if(modsat.art!=='rum') return [flade(sideRum(rum[0]),modsat,1,'hoej','Revit: rummet på indersiden; værtsvæggen vender mod '+artNavn(modsat))];
        return [flade(sideRum(rum[0]),modsat,1,'middel','Værtsvæggens anden side')]; }
      return [flade(sideRum(rum[0]),UKENDT,1,'lav','Kun ét rum, og værtsvæggen kendes ikke')];
    }
    if(vaert&&vaert.flader&&vaert.flader.length){ var v=vaert.flader[0], ud2=function(s){ return s.art==='jord'? UDE : s; }; return [flade(ud2(v.a),ud2(v.b),1,'middel',v.a.art==='jord'||v.b.art==='jord'?'Åbning i en kælderydervæg: fører til det fri (lyskasse, nedgang)':'Som værtsvæggen')]; }
    // Glasfacadens væg har ingen mesh i eksporten, men rummene kender den som grænse (hostId er den samme væg).
    if(e.category==='Glasfacader'&&e.hostId!=null&&ix.naboer[String(e.hostId)]){ var nh=ix.naboer[String(e.hostId)], at=nh.reduce(function(s,n){ return s+(n.areal||0); },0)||1; return nh.map(function(n){ return flade(sideRum(n.rum),UDE,(n.areal||0)/at,'middel','Revit: glasfacaden afgrænser rummet. Regnes mod det fri: kontrollér indvendige glasvægge'); }); }
    if(e.category==='Glasfacader') return [flade(UKENDT,UDE,1,'lav','Glasfacade uden rum på nogen side. Kontrollér, om den er en del af klimaskærmen')];
    return [];
  }

  var UDEN_FLADE={'Søjler':'Søjlen er ikke en flade i klimaskærmen. Står den i ydervæggen, regnes den som kuldebro (linje-/punkttab).',
    'Bjælker':'Bjælken er ikke en flade i klimaskærmen. Går den gennem klimaskærmen, regnes den som kuldebro.',
    'Trapper':'Trappen ligger inde i bygningen og afgrænser ikke opvarmet mod koldt.',
    'Ramper':'Rampen afgrænser ikke opvarmet mod koldt.',
    'Rækværk':'Rækværk er ikke en del af klimaskærmen.',
    'Fundamenter':'Fundamentets tab regnes som linjetab ved samlingen (DS 418:2026 pkt. 8.13), ikke som flade.',
    'Rum':'Rummet selv er ikke en bygningsdel.'};
  function artNavn(s){ return s.art==='rum'? (s.navn||'rum') : s.art==='ude'? 'det fri' : s.art==='jord'? 'jord' : s.art==='uopvarmet'? 'uopvarmet rum' : 'noget ukendt'; }

  /* ---------- Hele modellen ---------- */
  function analyser(model){
    var ix=lavIndeks(model), alle={}, ud=[];
    function kategoriOrden(k){ return k==='Vinduer'||k==='Døre'||k==='Glasfacader' ? 1 : 0; }
    var liste=(model.elements||[]).filter(function(e){ return e&&!e.erRum&&!e.installation; }).slice().sort(function(a,b){ return kategoriOrden(a.category)-kategoriOrden(b.category); });
    liste.forEach(function(e){
      var r={id:e.id,uniqueId:e.uniqueId||null,kategori:e.category||'Andet',familie:e.family||'',type:e.type||e.name||'',typeId:e.typeId,niveau:e.level||null,areal:typeof e.area==='number'?e.area:null,flader:[],grund:null};
      alle[String(e.id)]=r; ud.push(r);
      r.rum=(ix.naboer[String(e.id)]||[]).map(function(n){ return {rumId:n.rum.id,side:n.side,areal:n.areal}; });
      if(e.faseNedrevet){ r.udenfor='nedrevet'; r.grund='Nedrevet i fasen «'+e.faseNedrevet+'».'; return; }
      if(UDEN_FLADE[e.category]){ r.udenfor='kategori'; r.grund=UDEN_FLADE[e.category]; return; }
      if(e.category==='Vægge') r.flader=klassVaeg(e,ix);
      else if(e.category==='Gulve') r.flader=klassDaek(e,ix);
      else if(e.category==='Tage') r.flader=klassTag(e,ix);
      else if(e.category==='Lofter') r.flader=klassLoft(e,ix);
      else if(e.category==='Vinduer'||e.category==='Døre'||e.category==='Glasfacader') r.flader=klassAabning(e,ix,alle);
      else { r.udenfor='kategori'; r.grund='Kategorien indgår ikke i klimaskærmen.'; return; }
      if(!r.flader.length){ r.udenfor='uden_rum'; r.grund= e.category==='Lofter'? 'Nedhængt loft eller loft uden rum: varmetabet regnes i det, der er over.' : 'Afgrænser ikke noget rum i modellen.'; }
    });
    return medIndeks(ix,{elementer:ud, afId:alle, rum:ix.rum.map(function(r){ return {id:r.id,uniqueId:r.uniqueId,navn:r.navn,rumnavn:r.rumnavn,niveau:r.niveau,rumtype:r.rumtype,tilstand:rumtilstand(r),kilde:r.kilde}; }), harRum:ix.rum.length>0, harRumMesh:ix.harRumMesh, terraenZ:ix.terraenZ, niveauer:ix.niveauer});
  }
  // Indekset følger med, men tælles ikke med, når svaret løbes igennem eller gemmes.
  function medIndeks(ix,svar){ Object.defineProperty(svar,'ix',{value:ix,enumerable:false}); return svar; }

  /* ---------- Samme analyse pr. bygningsdel, nøgle = Revit-id (bruges af Lyd) ---------- */
  var PLADS_KAT={'Vægge':1,'Gulve':1,'Tage':1,'Vinduer':1,'Døre':1,'Glasfacader':1};
  function modAf(f){
    var s=[f.a,f.b], er=function(fn){ return s.some(fn); };
    if(er(function(x){ return x.art==='jord'; })) return 'jord';
    if(er(function(x){ return x.art==='ude'||(x.art==='rum'&&x.tilstand==='ude'); })) return 'det_fri';
    if(f.a.art==='rum'&&f.b.art==='rum') return er(function(x){ return x.tilstand==='uopvarmet'; })? 'uopvarmet' : 'rum';
    return 'ukendt';
  }
  // mod: den side, der vender mod det meste af elementet; modAndele viser fordelingen, når elementet vender flere veje.
  // sikker: false, når placeringen skal kontrolleres (sikkerhed 'lav' eller ingen flader), så den kan meldes som manglende input.
  function pladser(model,analyse){
    var a=analyse||analyser(model), ud={}, rund2=function(n){ return Math.round(n*100)/100; };
    a.elementer.forEach(function(e){
      if(!PLADS_KAT[e.kategori]) return;
      var par=[], over=[], under=[], andele={}, bedst=null, rum=(e.rum||[]).slice(), medRum={};
      rum.forEach(function(r){ medRum[String(r.rumId)]=1; });
      e.flader.forEach(function(f){
        if(!bedst||f.andel>bedst.andel) bedst=f;
        var m=modAf(f); andele[m]=rund2((andele[m]||0)+(f.andel==null?1:f.andel));
        if(f.a.art==='rum'&&f.b.art==='rum') par.push({aRumId:f.a.rumId,bRumId:f.b.rumId,areal:e.areal==null? null : rund2(e.areal*(f.andel==null?1:f.andel))});
        if(f.over!=null&&over.indexOf(f.over)<0) over.push(f.over);
        if(f.under!=null&&under.indexOf(f.under)<0) under.push(f.under);
        [f.a,f.b].forEach(function(s){ if(s.art==='rum'&&!medRum[String(s.rumId)]){ medRum[String(s.rumId)]=1; rum.push({rumId:s.rumId,side:'side',areal:null}); } });
      });
      ud[String(e.id)]={id:e.id,uniqueId:e.uniqueId,kategori:e.kategori,rum:rum,mod:bedst?modAf(bedst):'ukendt',modAndele:andele,par:par,over:over,under:under,
        kilde:bedst?bedst.grund:(e.grund||'Afgrænser ikke noget rum i modellen'),sikker:!!bedst&&bedst.sikkerhed!=='lav',sikkerhed:bedst?bedst.sikkerhed:'lav',udenfor:e.udenfor||null};
    });
    return ud;
  }

  /* ---------- Fælles «Analyser»: hver fane melder sin analyse her, så knap og AI-felt kalder det samme ---------- */
  var analysefunktioner={};
  function registrerAnalyse(id,titel,fn){ if(id&&typeof fn==='function') analysefunktioner[id]={id:id,titel:titel||id,fn:fn}; }
  function koerAnalyse(id){
    var mål=id? [analysefunktioner[id]].filter(Boolean) : Object.keys(analysefunktioner).map(function(k){ return analysefunktioner[k]; });
    return mål.map(function(a){ return {id:a.id,titel:a.titel,resultat:a.fn()}; });
  }
  function analyserRegistreret(){ return Object.keys(analysefunktioner); }

  return {RUMTYPER:RUMTYPER, UDEN_FLADE:UDEN_FLADE, rumtypeAf:rumtypeAf, erStandardNavn:erStandardNavn, rumNavn:rumNavn, analyser:analyser, pladser:pladser, artNavn:artNavn, daekCelle:daekCelle, geo:{boks:boks,hvertTrekant:hvertTrekant,iRum:iRum,rumILodlinje:rumILodlinje},
    lavIndeks:lavIndeks, registrerAnalyse:registrerAnalyse, koerAnalyse:koerAnalyse, analyserRegistreret:analyserRegistreret};
});
