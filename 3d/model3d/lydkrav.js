/* ISSANA – lydkrav pr. bygningstype og rumfunktion, koblet til lydberegningen i lyd-12354.js.
   Rent modul uden afhængigheder ud over lyd-12354.js og tabellen lydkrav.json.
   Browser (WebView2): <script src="lydkrav.js"> giver window.IssanaLydkrav; tabellen hentes med indlaes('lydkrav.json')
   (virker fra Revit's virtuelle host og fra en webserver; fra file:// må den gives med saetTabel(json)).
   Node: module.exports; tabellen læses fra lydkrav.json ved siden af filen (testene ligger i tests/web-model3d/lydkrav.test.mjs).

   Principper:
   1. Kravene står KUN i lydkrav.json (værdi, kilde, status). Koden kender ingen tal.
   2. Rumfunktionen kommer fra brugerens rumbrug (ISSANA Instance Room Use) via tabellen rumbrugTilRumfunktion.
      Et match på Revit-rumnavnet er kun et FORSLAG og bruges ikke til vurderingen, før brugeren har godkendt det.
   3. Brugerens egne lydmål i rummets datapost (lyd.maal) går forud for tabellens krav.
   4. Manglende input gættes ikke: status bliver «Mangler input» med listen over det, der mangler.
   5. Resultatet er en forenklet ISO 12354-beregning mod kravene, ikke en lydberegning efter standardens fulde metode
      og ikke en myndighedsvurdering.
   6. Placeringen afgør kravet: lyd-analyse.js fortæller, hvilke rum der ligger på hver side af en bygningsdel, og om de hører til
      samme enhed (valg.analyse). Uden analysen gælder det gamle opslag gennem rummenes grænser.
   7. Skøn af Rw og Ln,w ud fra lagene kræver, at brugeren har slået det til (forudsætningen brugSkoen), og er altid mærket. */
(function(root, factory){
  "use strict";
  var erNode = typeof module==='object' && module && module.exports;
  var api = factory(root, erNode);
  if(erNode) module.exports=api; else root.IssanaLydkrav=api;
})(typeof self!=='undefined' ? self : this, function(root, erNode){
  "use strict";

  var L = erNode ? require('./lyd-12354.js') : root.IssanaLyd;
  var tabel = null;
  if(erNode){ try{ tabel=require('./lydkrav.json'); }catch(e){ tabel=null; } }
  else if(root.ISSANA_LYDKRAV) tabel=root.ISSANA_LYDKRAV;

  var STATUS=Object.freeze({ OPFYLDT:'opfyldt', IKKE_OPFYLDT:'ikke_opfyldt', MANGLER_INPUT:'mangler_input', IKKE_RELEVANT:'ikke_relevant' });
  var TEKST=Object.freeze({ opfyldt:'Opfyldt (forenklet beregning)', ikke_opfyldt:'Ikke opfyldt', mangler_input:'Mangler input', ikke_relevant:'Ikke relevant', opfyldt_forbehold:'Opfyldt med forbehold' });
  var FARVE=Object.freeze({ opfyldt:'#4a7c59', ikke_opfyldt:'#c65a2e', mangler_input:'#c99a2e', ikke_relevant:'#c9cec9', opfyldt_forbehold:'#8a9a4e' });
  var ALVOR={ ikke_opfyldt:3, mangler_input:2, opfyldt:1, ikke_relevant:0 };
  var DELE=['luftlyd','trinlyd','facade','efterklang','installation'];
  var DEL_NAVN={ luftlyd:'Luftlyd fra naborum', trinlyd:'Trinlyd ovenfra', facade:'Udefra gennem facaden', efterklang:'Efterklangstid', installation:'Installationsstøj' };
  // Størrelse, enhed og retning pr. kravtype, når tabellen ikke er indlæst (ingen tal; egne mål skal stadig kunne sammenlignes).
  var STD_TYPER={ luftlyd:{navn:'Luftlydisolation mellem rum', stoerrelse:"R'w", enhed:'dB', retning:'min'}, luftlydGang:{navn:'Luftlydisolation mod fælles gang/trappe', stoerrelse:"R'w", enhed:'dB', retning:'min'},
    trinlyd:{navn:'Trinlydniveau', stoerrelse:"L'n,w", enhed:'dB', retning:'max'}, facade:{navn:'Indendørs støj udefra', stoerrelse:'Lden', enhed:'dB', retning:'max'},
    efterklang:{navn:'Efterklangstid', stoerrelse:'T', enhed:'s', retning:'max'}, installation:{navn:'Støj fra tekniske installationer', stoerrelse:'LAeq', enhed:'dB', retning:'max'} };
  function tomtKrav(del, t){ var kt=(t&&t.kravtyper&&t.kravtyper[del])||STD_TYPER[del]||STD_TYPER.luftlyd; return {type:del, navn:kt.navn, stoerrelse:kt.stoerrelse, enhed:kt.enhed, retning:kt.retning, vaerdi:null, kilde:null, status:null, note:null, kraevesIkke:false, egetMaal:false}; }
  var FORBEHOLD='Forenklet beregning efter DS/EN ISO 12354 (enkelttalsværdier) sammenholdt med kravtabellen lydkrav.json. Det er ikke en lydberegning efter standardens fulde metode og ikke en myndighedsvurdering.';
  var P_RUM='ISSANA Instance Room Use', P_STOEJ='ISSANA Instance Outdoor Noise', P_DATA='ISSANA Instance Data', P_TYPEDATA='ISSANA Data', P_TAGS='ISSANA Instance Tags', P_TYPETAGS='ISSANA Tags';

  /* ---------- Hjælpere ---------- */
  function erObjekt(v){ return v!==null && typeof v==='object' && !Array.isArray(v); }
  function erTal(v){ return typeof v==='number' && isFinite(v); }
  function lav(s){ return String(s==null?'':s).trim().toLowerCase(); }
  function normSt(s){ return String(s==null?'':s).replace(/[’′´`]/g,"'").replace(/\s+/g,'').toLowerCase(); }
  function klon(o){ return o==null ? o : JSON.parse(JSON.stringify(o)); }
  function parseData(s){ if(!s) return null; if(erObjekt(s)) return s; try{ var o=JSON.parse(s); return erObjekt(o) ? o : null; }catch(e){ return null; } }
  function flet(a,b){ if(a==null) return klon(b); if(b==null) return klon(a); if(!erObjekt(a)||!erObjekt(b)) return klon(b); var r=klon(a); Object.keys(b).forEach(function(k){ r[k]=flet(a[k],b[k]); }); return r; }
  function splitTags(v){ var r=[]; String(v||'').split(/[;,\r\n]/).forEach(function(t){ t=lav(t); if(t && r.indexOf(t)<0) r.push(t); }); return r; }
  function tilfoejMangel(liste, m){ if(!liste.some(function(x){ return x.tekst===m.tekst; })) liste.push(m); }
  function afrund(x){ return erTal(x) ? Math.round(x*10)/10 : null; }

  /* ---------- Tabellen ---------- */
  function tjekTabel(t){
    var fejl=[];
    if(!erObjekt(t)){ return ['Tabellen er ikke et objekt']; }
    if(t.schema!=='issana-lydkrav/1') fejl.push('schema skal være issana-lydkrav/1');
    if(!erObjekt(t.kravtyper)) fejl.push('kravtyper mangler');
    if(!erObjekt(t.rumfunktioner)) fejl.push('rumfunktioner mangler');
    if(!erObjekt(t.bygningstyper)) fejl.push('bygningstyper mangler');
    if(!erObjekt(t.rumbrugTilRumfunktion)) fejl.push('rumbrugTilRumfunktion mangler');
    if(fejl.length) return fejl;
    Object.keys(t.kravtyper).forEach(function(k){
      var kt=t.kravtyper[k];
      if(!erObjekt(kt)||!kt.stoerrelse||!kt.enhed||(kt.retning!=='min'&&kt.retning!=='max')) fejl.push('kravtyper.'+k+': stoerrelse, enhed og retning (min/max) skal være angivet');
    });
    Object.keys(t.rumfunktioner).forEach(function(k){ var rf=t.rumfunktioner[k]; if(!erObjekt(rf)||!rf.navn||!rf.rumbrug) fejl.push('rumfunktioner.'+k+': navn og rumbrug skal være angivet'); });
    Object.keys(t.rumbrugTilRumfunktion).forEach(function(k){ if(!t.rumfunktioner[t.rumbrugTilRumfunktion[k]]) fejl.push('rumbrugTilRumfunktion.'+k+' peger på en ukendt rumfunktion «'+t.rumbrugTilRumfunktion[k]+'»'); });
    (t.rumnavnMoenstre||[]).forEach(function(m,i){ if(!erObjekt(m)||!Array.isArray(m.indeholder)||!t.rumfunktioner[m.rumfunktion]) fejl.push('rumnavnMoenstre['+i+']: indeholder (liste) og en kendt rumfunktion skal være angivet'); });
    Object.keys(t.bygningstyper).forEach(function(b){
      var bt=t.bygningstyper[b];
      if(!erObjekt(bt)||!bt.navn||!bt.kilde||!erObjekt(bt.rumfunktioner)){ fejl.push('bygningstyper.'+b+': navn, kilde og rumfunktioner skal være angivet'); return; }
      Object.keys(bt.rumfunktioner).forEach(function(rf){
        if(!t.rumfunktioner[rf]) fejl.push('bygningstyper.'+b+'.rumfunktioner.'+rf+' er ikke en kendt rumfunktion');
        var krav=bt.rumfunktioner[rf]; if(!erObjekt(krav)){ fejl.push('bygningstyper.'+b+'.rumfunktioner.'+rf+' skal være et objekt'); return; }
        Object.keys(krav).forEach(function(k){
          var sti='bygningstyper.'+b+'.rumfunktioner.'+rf+'.'+k, x=krav[k];
          if(!t.kravtyper[k]){ fejl.push(sti+': ukendt kravtype'); return; }
          if(!erObjekt(x)||!('vaerdi' in x)){ fejl.push(sti+': skal være et objekt med vaerdi'); return; }
          if(x.vaerdi!==null && !erTal(x.vaerdi)) fejl.push(sti+': vaerdi skal være et tal eller null');
          if(x.vaerdi!==null && !x.kilde) fejl.push(sti+': kilde mangler');
          if(x.vaerdi!==null && x.status!=='udkast' && x.status!=='godkendt') fejl.push(sti+': status skal være udkast eller godkendt');
          if(x.vaerdi===null && !x.kraevesIkke && !x.note) fejl.push(sti+': vaerdi er null; skriv en note (eller kraevesIkke: true)');
        });
      });
    });
    return fejl;
  }
  function saetTabel(t){ var fejl=tjekTabel(t); if(!fejl.length) tabel=t; return fejl; }
  function hentTabel(){ return tabel; }
  function indlaes(url){
    url=url||'lydkrav.json';
    if(typeof fetch!=='function') return Promise.reject(new Error('fetch findes ikke i dette miljø'));
    return fetch(url,{cache:'no-store'}).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status+' for '+url); return r.json(); })
      .then(function(j){ var fejl=saetTabel(j); if(fejl.length) throw new Error('lydkrav.json har fejl: '+fejl.join('; ')); return tabel; });
  }
  function bygningstyper(t){ t=t||tabel; if(!t) return []; return Object.keys(t.bygningstyper).map(function(id){ var b=t.bygningstyper[id]; return {id:id, navn:b.navn, kilde:b.kilde}; }); }
  function rumfunktioner(t){ t=t||tabel; if(!t) return []; return Object.keys(t.rumfunktioner).map(function(id){ var r=t.rumfunktioner[id]; return {id:id, navn:r.navn, rumbrug:r.rumbrug}; }); }

  /* ---------- Krav for (bygningstype, rumfunktion) ---------- */
  function kravFor(bygningstype, rumfunktion, t){
    t=t||tabel;
    var ud={bygningstype:null, rumfunktion:null, krav:{}, mangler:[]};
    if(!t){ ud.mangler.push({felt:'tabel', tekst:'Kravtabellen lydkrav.json er ikke indlæst'}); return ud; }
    var bt=bygningstype ? t.bygningstyper[bygningstype] : null;
    var rf=rumfunktion ? t.rumfunktioner[rumfunktion] : null;
    if(bt) ud.bygningstype={id:bygningstype, navn:bt.navn, kilde:bt.kilde};
    else ud.mangler.push({felt:'bygningstype', tekst: bygningstype ? 'Bygningstypen «'+bygningstype+'» findes ikke i lydkrav.json' : 'Bygningstype (vælg øverst i Lyd-fanen)'});
    if(rf) ud.rumfunktion={id:rumfunktion, navn:rf.navn, rumbrug:rf.rumbrug};
    else ud.mangler.push({felt:'rumfunktion', tekst: rumfunktion ? 'Rumfunktionen «'+rumfunktion+'» findes ikke i lydkrav.json' : 'Rumfunktion for rummet'});
    var raekke=(bt && rf && bt.rumfunktioner[rumfunktion]) || null;
    if(bt && rf && !raekke) ud.mangler.push({felt:'krav', tekst:'lydkrav.json har ingen krav for «'+rf.navn+'» i «'+bt.navn+'»'});
    Object.keys(t.kravtyper).forEach(function(k){
      var kt=t.kravtyper[k], x=raekke ? raekke[k] : null;
      var krav={type:k, navn:kt.navn, stoerrelse:kt.stoerrelse, enhed:kt.enhed, retning:kt.retning, vaerdi:null, kilde:null, status:null, note:null, kraevesIkke:false, egetMaal:false};
      if(x){ krav.vaerdi=erTal(x.vaerdi) ? x.vaerdi : null; krav.kilde=x.kilde||null; krav.status=x.status||null; krav.note=x.note||null; krav.kraevesIkke=x.kraevesIkke===true; }
      else if(raekke){ krav.note='Kravtypen er ikke fastlagt for denne rumfunktion i lydkrav.json'; }
      ud.krav[k]=krav;
    });
    return ud;
  }

  /* ---------- Rumbrug/rumnavn -> rumfunktion ---------- */
  function rumfunktionFraRumbrug(roomUse, rumnavn, t){
    t=t||tabel;
    var ud={id:null, navn:null, kilde:null, rumbrug:(roomUse==null||String(roomUse).trim()==='') ? null : String(roomUse).trim(), ukendtRumbrug:false, forslag:null};
    if(!t) return ud;
    if(ud.rumbrug){
      var hit=null, noegle=lav(ud.rumbrug);
      Object.keys(t.rumbrugTilRumfunktion).forEach(function(k){ if(hit===null && lav(k)===noegle) hit=t.rumbrugTilRumfunktion[k]; });
      if(hit===null && t.rumfunktioner[noegle]) hit=noegle;      // rumfunktionens eget id accepteres også
      if(hit!==null && t.rumfunktioner[hit]){ ud.id=hit; ud.navn=t.rumfunktioner[hit].navn; ud.kilde='rumbrug'; return ud; }
      ud.ukendtRumbrug=true;
    }
    var navn=lav(rumnavn);
    if(navn && Array.isArray(t.rumnavnMoenstre)){
      // Det længste ord vinder, så «badeværelse» bliver bad og ikke værelse, og «forstue» bliver gang og ikke stue.
      t.rumnavnMoenstre.forEach(function(m){
        if(!t.rumfunktioner[m.rumfunktion]) return;
        m.indeholder.forEach(function(o){ var w=lav(o); if(w && navn.indexOf(w)>=0 && (!ud.forslag || w.length>ud.forslag.ord.length)) ud.forslag={id:m.rumfunktion, navn:t.rumfunktioner[m.rumfunktion].navn, fra:'rumnavn', ord:o}; });
      });
    }
    if(navn&&!ud.forslag){
      var engelsk=[
        {re:/(?:^|[^a-z])(?:restroom|toilet|wc|bath)(?:room)?(?:$|[^a-z])/,id:'bad'},
        {re:/(?:^|[^a-z])(?:mechanical|electrical|server|utility)(?:\s+room)?(?:$|[^a-z])/,id:'teknikrum'},
        {re:/(?:^|[^a-z])(?:conference|meeting)(?:\s+room)?(?:$|[^a-z])/,id:'moederum'},
        {re:/(?:^|[^a-z])classroom(?:$|[^a-z])/,id:'undervisningsrum'},
        {re:/(?:^|[^a-z])(?:corridor|hall(?:way)?)(?:$|[^a-z])/,id:'gang'},
        {re:/(?:^|[^a-z])office(?:$|[^a-z])/,id:'kontor'},
        {re:/(?:^|[^a-z])stair(?:well)?(?:$|[^a-z])/,id:'trappe'},
        {re:/(?:^|[^a-z])kitchen(?:$|[^a-z])/,id:'koekken'},
        {re:/(?:^|[^a-z])storage(?:$|[^a-z])/,id:'depot'}
      ];
      for(var ei=0;ei<engelsk.length;ei++){var em=engelsk[ei];if(em.re.test(navn)&&t.rumfunktioner[em.id]){ud.forslag={id:em.id,navn:t.rumfunktioner[em.id].navn,fra:'rumnavn',ord:rumnavn};break;}}
    }
    return ud;
  }

  /* ---------- Modellen (issana-3d/1.2) ---------- */
  function lavIndeks(model){
    if(model && model.__lydIndeks) return model;
    model=erObjekt(model) ? model : {};
    var typer={}, els={}, aab={}, rum=[];
    (model.types||[]).forEach(function(t){ if(t&&t.id!=null) typer[String(t.id)]=t; });
    (model.elements||[]).forEach(function(e){
      if(!e||e.id==null) return;
      if(e.erRum||e.category==='Rum'){ if(!Array.isArray(model.rooms)) rum.push(e); return; }
      if(e.installation) return;
      els[String(e.id)]=e;
      if(e.hostId!=null) (aab[String(e.hostId)]=aab[String(e.hostId)]||[]).push(e);
    });
    if(Array.isArray(model.rooms)) rum=model.rooms.filter(function(r){ return r&&r.id!=null; });
    return {__lydIndeks:true, model:model, typer:typer, els:els, aabninger:aab, rum:rum};
  }
  function raaAf(o){ return (o&&o.bygdata&&o.bygdata.raw)||{}; }
  function typeAf(ix,e){ return e&&e.typeId!=null ? ix.typer[String(e.typeId)]||null : null; }
  function dataAf(ix,e){
    var t=typeAf(ix,e), bt=t&&t.bygdata, bi=e&&e.bygdata;
    var dt=(bt&&(bt.data||parseData(raaAf(t)[P_TYPEDATA])))||null;
    var di=(bi&&(bi.data||parseData(raaAf(e)[P_DATA])))||null;
    return flet(dt,di);
  }
  function tagsAf(ix,e){
    var t=typeAf(ix,e), r=[];
    [[t&&t.bygdata, P_TYPETAGS, t],[e&&e.bygdata, P_TAGS, e]].forEach(function(p){
      var b=p[0]; var liste=(b&&Array.isArray(b.tags)) ? b.tags.map(lav) : splitTags(raaAf(p[2])[p[1]]);
      liste.forEach(function(x){ x=x.replace('ae','æ'); if(r.indexOf(x)<0) r.push(x); });
    });
    return r;
  }
  function erFacade(ix,e){ return !!(e && ((e.revit&&e.revit.funktion==='Exterior') || tagsAf(ix,e).indexOf('facade')>=0)); }
  function dokumenteret(ix,e){ var d=dataAf(ix,e); return d&&d.lyd&&erObjekt(d.lyd.dokumenteret) ? d.lyd.dokumenteret : null; }
  function rw(ix,e){ var d=dokumenteret(ix,e); return d&&d.vaerdi!=null&&(!d.stoerrelse||normSt(d.stoerrelse)==='rw') ? d : null; }
  function stoejAf(ix,e){
    var b=e&&e.bygdata, tekst=(b&&b.noise)||raaAf(e)[P_STOEJ]||null, d=dataAf(ix,e);
    if(tekst==null||String(tekst).trim()==='') return {vaerdi:null, stoerrelse:null, tekst:null};
    var m=/^\s*(-?\d+(?:[.,]\d+)?)/.exec(String(tekst)), st=/\b(Lden|Lnight|Lday|Levening|LAeq(?:,\s*\w+)?|LAmax|Lmax)\b/i.exec(String(tekst));
    return {vaerdi: m ? Number(m[1].replace(',','.')) : null, stoerrelse:(d&&d.stoej&&d.stoej.stoerrelse)||(st ? st[1].replace(/\s+/g,'') : null), tekst:String(tekst)};
  }
  function navnAf(e){ return (e&&(e.type||e.name||e.category))||'element'; }
  function rumData(r){ var b=r&&r.bygdata; return (b&&(b.data||parseData(raaAf(r)[P_DATA])))||null; }
  function rumbrugAf(r){ var b=r&&r.bygdata; var v=(b&&b.roomUse)||raaAf(r)[P_RUM]; return v==null||String(v).trim()==='' ? null : String(v).trim(); }
  function rumNavn(r){ return ((r.number ? r.number+' ' : '')+(r.name||'')).trim() || ('Rum '+r.id); }
  function maalFor(r,del){ var d=rumData(r), m=d&&d.lyd&&d.lyd.maal; return m&&erObjekt(m[del])&&m[del].vaerdi!=null ? m[del] : null; }

  /* ---------- Skøn af Rw og Ln,w ud fra typens lag (samme formler som ISSANA_CalculationEngine, se lyd-12354.js) ----------
     Masseformlerne gælder én tung skal. Dobbeltkonstruktioner, lette vægge og huldæk skønnes ikke; dér skal værdien dokumenteres. */
  function materialeAf(navn, t){
    var s=lav(navn), bedst=null;
    ((t&&t.materialer&&t.materialer.liste)||[]).forEach(function(m){ (m.indeholder||[]).forEach(function(o){ var w=lav(o); if(w && s.indexOf(w)>=0 && (!bedst || w.length>bedst.ord.length)) bedst={ord:w, art:m.art, rho:m.rho, kilde:m.kilde}; }); });
    return bedst;
  }
  function lagAf(ix, e, t){
    var ty=typeAf(ix,e), lag=(ty&&Array.isArray(ty.layers)) ? ty.layers : [];
    if(!lag.length) return {grund:'typen har ingen lag i eksporten'};
    var hel=materialeAf(ty.name||e.type, t);
    if(hel&&hel.art==='inhomogen') return {grund:'huldæk og andre inhomogene dæk kan ikke skønnes af massen'};
    var ud=[];
    for(var i=0;i<lag.length;i++){
      var l=lag[i], d=erTal(l.widthMm) ? l.widthMm/1000 : 0;
      if(!(d>0)) continue;                                                     // membraner uden tykkelse
      var m=materialeAf(l.material, t), tyk=d>=0.025;
      if(!m){ if(tyk) return {grund:'materialet «'+(l.material||'uden navn')+'» kendes ikke'}; continue; }    // tynde overflader tæller ikke
      if(m.art==='inhomogen') return {grund:'huldæk og andre inhomogene dæk kan ikke skønnes af massen'};
      if(m.art==='let'&&tyk) return {grund:'let konstruktion (træ eller metal) kan ikke skønnes af massen'};
      ud.push({navn:l.material, tykkelseM:d, art:m.art, rho:m.rho, kilde:m.kilde});
    }
    return {lag:ud};
  }
  function kilderAf(lag, formelId){ var k=[]; lag.forEach(function(x){ if(x.rho!=null && k.indexOf(x.kilde)<0) k.push(x.kilde); }); return 'Skøn med '+formelId+'; densiteter: '+k.join('; '); }
  function skoenRw(ix, e, t){
    var a=lagAf(ix,e,t); if(a.grund) return {vaerdi:null, grund:a.grund};
    var lag=a.lag, skal=function(x){ return (x.art==='tung'||x.art==='plade') && x.rho>=500 && x.rho*x.tykkelseM>=30; }, hul=function(x){ return (x.art==='isolering'||x.art==='hulrum') && x.tykkelseM>=0.025; };
    for(var i=0;i<lag.length;i++) if(hul(lag[i]) && lag.slice(0,i).some(skal) && lag.slice(i+1).some(skal)) return {vaerdi:null, grund:'dobbeltkonstruktion: dokumentér Rw'};
    var fast=lag.filter(function(x){ return x.rho!=null; });
    if(!fast.some(function(x){ return x.art==='tung'; })) return {vaerdi:null, grund:'ingen tung, massiv skal'};
    var m=L.flademasse(fast).vaerdi, r=L.rwMasselov(m);
    if(r.vaerdi==null) return {vaerdi:null, grund:r.grund};
    return {vaerdi:r.vaerdi, stoerrelse:'Rw', enhed:'dB', skoen:true, formelId:r.formelId, metode:r.metode, m:m, lag:fast.map(function(x){ return {navn:x.navn, rho:x.rho, tykkelseM:x.tykkelseM}; }), kilde:kilderAf(fast,r.formelId)};
  }
  function skoenLnw(ix, e, t){
    var a=lagAf(ix,e,t); if(a.grund) return {vaerdi:null, grund:a.grund};
    var tunge=a.lag.filter(function(x){ return x.art==='tung' && x.rho>=1800; });
    if(!tunge.length) return {vaerdi:null, grund:'intet tungt, homogent dæk'};
    var b=tunge.reduce(function(p,x){ return x.rho*x.tykkelseM>p.rho*p.tykkelseM ? x : p; });
    var r=L.lnwMasse(b.rho*b.tykkelseM);
    if(r.vaerdi==null) return {vaerdi:null, grund:r.grund};
    return {vaerdi:r.vaerdi, stoerrelse:'Ln,w', enhed:'dB', skoen:true, formelId:r.formelId, metode:r.metode, m:b.rho*b.tykkelseM, kilde:kilderAf([b],r.formelId)};
  }
  function rwVaerdi(ix, e, f, t){
    var d=rw(ix,e); if(d) return {d:d};
    if(!f.brugSkoen) return {d:null};
    var s=skoenRw(ix,e,t); return s.vaerdi!=null ? {d:s} : {d:null, grund:s.grund};
  }
  function lnwVaerdi(ix, e, f, t){
    var d=dokumenteret(ix,e); if(d&&d.vaerdi!=null&&/^l/i.test(d.stoerrelse||'')) return {d:d};
    if(!f.brugSkoen) return {d:null};
    var s=skoenLnw(ix,e,t); return s.vaerdi!=null ? {d:s} : {d:null, grund:s.grund};
  }
  function tilForbehold(liste, t){ if(t && liste.indexOf(t)<0) liste.push(t); }
  function rwMangelTekst(e, grund){ return 'Rw for «'+navnAf(e)+'»'+(grund ? ' ('+grund+')' : ''); }
  var FB_FLANKER='Flanketransmission er ikke regnet med; R\'w kan være lavere', FB_ENHED='Enhederne er ikke afklaret; kravet er regnet som mellem to enheder', FB_RW='Rw er skønnet ud fra massen, ikke dokumenteret', FB_LN='Ln,w er skønnet ud fra massen, ikke dokumenteret';

  /* ---------- Krav med brugerens eget mål lagt ovenpå ---------- */
  function effektivtKrav(standard, maal){
    if(!maal) return standard;
    var k=klon(standard);
    k.standard={vaerdi:standard.vaerdi, kilde:standard.kilde, status:standard.status, kraevesIkke:standard.kraevesIkke};
    k.vaerdi=maal.vaerdi; k.stoerrelse=maal.stoerrelse||standard.stoerrelse; k.enhed=maal.enhed||standard.enhed; k.retning=maal.retning||standard.retning;
    k.kilde='Eget mål'+(maal.kilde ? ' ('+maal.kilde+')' : ''); k.status='eget'; k.note=null; k.kraevesIkke=false; k.egetMaal=true;
    return k;
  }

  /* ---------- Sammenligning: værdi mod krav ---------- */
  function bedoem(vaerdi, krav, mangler, kravMangel){
    var ud={status:null, forskel:null, beskrivelse:null};
    if(krav && krav.kraevesIkke && !mangler.length){ ud.status=STATUS.IKKE_RELEVANT; ud.beskrivelse='Der stilles ikke krav'+(krav.note ? ': '+krav.note : '.'); return ud; }
    if(!krav || krav.vaerdi==null){
      if(kravMangel) tilfoejMangel(mangler, kravMangel);
      else if(krav && !krav.kraevesIkke) tilfoejMangel(mangler, {felt:'krav', tekst:'Kravet til '+krav.navn.toLowerCase()+' er ikke fastlagt i lydkrav.json'+(krav.note ? ' ('+krav.note+')' : '')});
    }
    if(mangler.length || vaerdi==null || !krav || krav.vaerdi==null){ ud.status=STATUS.MANGLER_INPUT; return ud; }
    var r=L.sammenlign({vaerdi:{vaerdi:vaerdi, stoerrelse:krav.stoerrelse, enhed:krav.enhed}, maal:{vaerdi:krav.vaerdi, stoerrelse:krav.stoerrelse, enhed:krav.enhed}, retning:krav.retning});
    if(r.status===L.STATUS.NEEDS_INPUT){ (r.mangler||[]).forEach(function(m){ tilfoejMangel(mangler,m); }); ud.status=STATUS.MANGLER_INPUT; return ud; }
    ud.status = r.status===L.STATUS.DIFFERENCE_FROM_TARGET ? STATUS.IKKE_OPFYLDT : STATUS.OPFYLDT;
    ud.forskel=r.forskel; ud.beskrivelse=r.beskrivelse;
    return ud;
  }
  function faerdig(del, krav, vaerdi, stoerrelse, enhed, mangler, dele, kravMangel, tekst){
    var b=bedoem(vaerdi, krav, mangler, kravMangel);
    return {del:del, navn:DEL_NAVN[del], krav:krav, vaerdi:afrund(vaerdi), stoerrelse:stoerrelse, enhed:enhed, status:b.status, statusTekst:TEKST[b.status],
      forskel:b.forskel, beskrivelse:b.beskrivelse, tekst:tekst||null, mangler:mangler, dele:dele||[]};
  }
  function ikkeRelevant(del, krav, tekst){ return {del:del, navn:DEL_NAVN[del], krav:krav, vaerdi:null, stoerrelse:null, enhed:null, status:STATUS.IKKE_RELEVANT, statusTekst:TEKST[STATUS.IKKE_RELEVANT], forskel:null, beskrivelse:null, tekst:tekst, mangler:[], dele:[]}; }

  /* ---------- Delene ---------- */
  function erFacadeVaeg(r, ix, e, an){
    if(!e||e.category!=='Vægge') return false;
    var p=an&&an.dele&&an.dele[String(e.id)];
    if(p&&p.mod) return !!(p.udeRum&&p.udeRum.indexOf(r.id)>=0);   // placeringen slår Revits funktion: en «ydervæg» med rum på begge sider er ikke facade
    return erFacade(ix,e);
  }
  function facade(r, ix, f, krav, kravMangel, t, an){
    var mangler=[], dele=[], stoerrelser=[], forbehold=[];
    var vaegge=(r.graenser||[]).filter(function(g){ var e=ix.els[String(g.id)]; return g.side==='side' && erFacadeVaeg(r,ix,e,an); });
    if(!vaegge.length) return ikkeRelevant('facade', krav, 'Ingen facadevæg');
    vaegge.forEach(function(g){
      var vaeg=ix.els[String(g.id)], aabninger=(ix.aabninger[String(g.id)]||[]).filter(function(a){ return Array.isArray(a.rum) ? a.rum.indexOf(r.id)>=0 : true; });
      var aabAreal=aabninger.reduce(function(s,a){ return s+(erTal(a.area) ? a.area : 0); },0);
      var rv=rwVaerdi(ix,vaeg,f,t), vd=rv.d, elementer=[{navn:navnAf(vaeg), type:'vaeg', Rw:vd ? vd.vaerdi : null, Ctr:vd&&vd.Ctr!=null ? vd.Ctr : null, areal:Math.max(0,(erTal(g.areal) ? g.areal : 0)-aabAreal)}];
      if(!vd) tilfoejMangel(mangler,{felt:'vaeg.Rw', tekst:rwMangelTekst(vaeg, rv.grund)});
      else if(vd.skoen) tilForbehold(forbehold, FB_RW);
      if(!erTal(g.areal)) tilfoejMangel(mangler,{felt:'vaeg.areal', tekst:'Areal af «'+navnAf(vaeg)+'» mod rummet'});
      aabninger.forEach(function(a){ var d=rw(ix,a);
        if(!d) tilfoejMangel(mangler,{felt:'aabning.Rw', tekst:'Rw for «'+navnAf(a)+'»'});
        if(!erTal(a.area)) tilfoejMangel(mangler,{felt:'aabning.areal', tekst:'Areal for «'+navnAf(a)+'»'});
        elementer.push({navn:navnAf(a), type:a.category==='Døre' ? 'dor' : 'vindue', Rw:d ? d.vaerdi : null, Ctr:d&&d.Ctr!=null ? d.Ctr : null, areal:a.area});
      });
      var st=stoejAf(ix,vaeg);
      if(st.vaerdi==null) tilfoejMangel(mangler,{felt:'stoej', tekst:'Støj udefra ved «'+navnAf(vaeg)+'» (ISSANA Instance Outdoor Noise, fx «68 dB Lden»)'});
      else if(!st.stoerrelse) tilfoejMangel(mangler,{felt:'stoej.stoerrelse', tekst:'Størrelsen for støjen ved «'+navnAf(vaeg)+'» (skriv fx «68 dB Lden»)'});
      else if(stoerrelser.indexOf(st.stoerrelse)<0) stoerrelser.push(st.stoerrelse);
      var res=L.facade({Lude:st.vaerdi, stoerrelse:st.stoerrelse, elementer:elementer, facadeAreal:g.areal, rumVolumen:r.volume, deltaLfs:f.deltaLfs, brugCtr:!!f.brugCtr});
      res.vaeg=navnAf(vaeg); res.vaegId=vaeg.id; res.aabningIds=aabninger.map(function(a){ return a.id; });
      // Beregningens egne mangler for felter, der allerede er meldt med rummets navne ovenfor, gentages ikke.
      (res.mangler||[]).forEach(function(m){ if(!/^(Lude|stoerrelse|elementer\[|facadeAreal|rumVolumen|deltaLfs)/.test(m.felt)) tilfoejMangel(mangler,m); });
      dele.push(res);
    });
    if(!erTal(r.volume)) tilfoejMangel(mangler,{felt:'volumen', tekst:'Rummets volumen'});
    if(f.deltaLfs==null) tilfoejMangel(mangler,{felt:'deltaLfs', tekst:'ΔLfs (facadeform) under Forudsætninger'});
    var inde=null;
    if(dele.length && dele.every(function(d){ return d.L_inde!=null; })) inde=10*Math.log10(dele.reduce(function(s,d){ return s+Math.pow(10,d.L_inde/10); },0));
    // Kravet gælder en bestemt størrelse (fx Lden). Er støjen udefra angivet i en anden, kan de ikke sammenholdes; der omregnes ikke.
    if(krav && krav.vaerdi!=null && !krav.egetMaal && stoerrelser.length && stoerrelser.some(function(s){ return normSt(s)!==normSt(krav.stoerrelse); }))
      tilfoejMangel(mangler,{felt:'stoej.stoerrelse', tekst:'Støjen udefra er angivet som '+stoerrelser.join('/')+', men kravet gælder '+krav.stoerrelse+'; angiv støjen som '+krav.stoerrelse+' (ISSANA omregner ikke)'});
    var ud=faerdig('facade', krav, inde, stoerrelser[0]||(krav&&krav.stoerrelse)||null, 'dB', mangler, dele, kravMangel);
    ud.forbeholdKort=forbehold;
    return ud;
  }

  function naboRum(r, ix, an){
    if(an&&an.parFor) return (an.parFor[String(r.id)]||[]).map(function(p){ return {nabo:p.nabo, vaeg:ix.els[String(p.delId)], areal:p.areal, relation:p.relation}; }).filter(function(n){ return n.nabo && n.vaeg && (n.vaeg.category==='Vægge'||n.vaeg.category==='Gulve'); });
    var ud=[];
    (r.graenser||[]).forEach(function(g){
      if(g.side!=='side') return; var vaeg=ix.els[String(g.id)]; if(!vaeg||vaeg.category!=='Vægge'||erFacade(ix,vaeg)) return;
      ix.rum.forEach(function(n){ if(n===r||n.id===r.id) return;
        (n.graenser||[]).forEach(function(g2){ if(g2.id===g.id && g2.side==='side') ud.push({nabo:n, vaeg:vaeg, areal:Math.min(erTal(g.areal)?g.areal:Infinity, erTal(g2.areal)?g2.areal:Infinity)}); }); });
    });
    return ud;
  }
  // Skel er ikke kun stue og soverum: entré, bad og depot i en bolig er også «boligen». Har rummets egen række intet krav, bruges opholdsrummets.
  function skelKrav(r, kravSet, bygningstype, t, an){
    if(!an||!kravSet) return kravSet;
    var info=an.rum[String(r.id)];
    if(!info||info.faelles||!info.enhed||!kravSet.luftlyd||!kravSet.luftlyd.kraevesIkke) return kravSet;
    var b=kravFor(bygningstype,'opholdsrum',t);
    if(!b.rumfunktion||!b.krav.luftlyd||b.krav.luftlyd.vaerdi==null) return kravSet;
    var ud=Object.assign({},kravSet);
    ['luftlyd','luftlydGang','doerFaelles'].forEach(function(k){ if(b.krav[k]) ud[k]=Object.assign({},b.krav[k],{note:'Rummet hører til boligen; kravet til skellet gælder hele boligen (DS 490:2018 tabel 1).'}); });
    return ud;
  }
  function doerRaekker(r, ix, f, kravSet, kravMangel, an, dele, mangler){
    var liste=(an&&an.doerFor&&an.doerFor[String(r.id)])||[], krav=kravSet&&kravSet.doerFaelles;
    if(!liste.length||!krav||krav.vaerdi==null) return;
    liste.forEach(function(d){
      var dor=ix.els[String(d.id)]; if(!dor) return;
      var rd=rw(ix,dor), m=[]; if(!rd) tilfoejMangel(m,{felt:'dor.Rw', tekst:'Rw for døren «'+navnAf(dor)+'»'});
      var b=bedoem(rd ? rd.vaerdi : null, krav, m, kravMangel);
      dele.push({doer:true, fra:d.fra, vaeg:navnAf(dor), vaegId:dor.id, Rw_mark:rd ? rd.vaerdi : null, DnTw:null, krav:krav, status:b.status, statusTekst:TEKST[b.status], forskel:b.forskel, alleMangler:m, relation:'mod_faelles', metode:'Dokumenteret Rw for døren mod kravet til R\'w; laboratorietal, ikke felt', mangler:[], forbehold:[]});
      m.forEach(function(x){ tilfoejMangel(mangler,x); });
    });
  }
  function luftlyd(r, ix, f, kravSet, kravMangel, t, an){
    var alleNaboer=naboRum(r, ix, an), naboer=alleNaboer.filter(function(n){ return n.relation!=='samme_enhed' && n.relation!=='faelles_faelles'; });
    if(!naboer.length) return ikkeRelevant('luftlyd', kravSet ? kravSet.luftlyd : null, alleNaboer.length ? 'Kun vægge inden for samme enhed; der stilles ikke krav' : 'Ingen naborum');
    var dele=[], mangler=[], forbehold=[], vaerst=null, egetMaal=maalFor(r,'luftlyd');
    naboer.forEach(function(n){
      var m=[], rv=rwVaerdi(ix,n.vaeg,f,t), d=rv.d;
      if(!d) tilfoejMangel(m,{felt:'vaeg.Rw', tekst:rwMangelTekst(n.vaeg, rv.grund)});
      if(!isFinite(n.areal)) tilfoejMangel(m,{felt:'vaeg.areal', tekst:'Areal af «'+navnAf(n.vaeg)+'» mod rummet'});
      if(!f.udenFlanker) tilfoejMangel(m,{felt:'flanker', tekst:'Flanketransmission (eller vælg «uden flanker» under Forudsætninger)'});
      var res=L.luftlydMellemRum({skillevaeg:{Rw:d ? d.vaerdi : null, areal:isFinite(n.areal) ? n.areal : null}, flanker:f.udenFlanker ? [] : undefined, modtagerVolumen:r.volume});
      (res.mangler||[]).forEach(function(x){ if(!/^(skillevaeg\.|flanker$|modtagerVolumen)/.test(x.felt)) tilfoejMangel(m,x); });
      if(!erTal(r.volume)) tilfoejMangel(m,{felt:'volumen', tekst:'Rummets volumen'});
      // Mod fælles gang/trappe gælder kravet luftlydGang, ellers luftlyd. Med analysen afgør placeringen det, ellers naboens rumbrug.
      var naboRf=rumfunktionFraRumbrug(rumbrugAf(n.nabo), null, t), gangagtig=(n.relation&&n.relation!=='rum_mod_rum') ? n.relation==='mod_faelles' : (naboRf.id==='gang'||naboRf.id==='trappe');
      var krav=kravSet ? (gangagtig && kravSet.luftlydGang && (kravSet.luftlydGang.vaerdi!=null||kravSet.luftlydGang.kraevesIkke) ? kravSet.luftlydGang : kravSet.luftlyd) : null;
      krav=effektivtKrav(krav||tomtKrav('luftlyd', t), egetMaal);
      if(krav.kraevesIkke && !krav.egetMaal) m.length=0;                    // der stilles ikke krav: manglende Rw er ikke en mangel
      var mm=m.slice(), b=bedoem(res.Rw_mark, krav, mm, kravMangel);
      res.fra=rumNavn(n.nabo); res.naboId=n.nabo.id; res.vaeg=navnAf(n.vaeg); res.vaegId=n.vaeg.id; res.krav=krav; res.status=b.status; res.statusTekst=TEKST[b.status]; res.forskel=b.forskel; res.alleMangler=mm; res.relation=n.relation||null;
      if(d&&d.skoen){ res.skoen={formelId:d.formelId, metode:d.metode, m:d.m, lag:d.lag, kilde:d.kilde}; if(b.status!==STATUS.IKKE_RELEVANT) tilForbehold(forbehold, FB_RW); }
      if(f.udenFlanker && b.status!==STATUS.IKKE_RELEVANT) tilForbehold(forbehold, FB_FLANKER);
      if(n.relation==='ukendt') tilForbehold(forbehold, FB_ENHED);
      dele.push(res);
      mm.forEach(function(x){ tilfoejMangel(mangler,x); });
      var margin=(res.Rw_mark!=null && krav.vaerdi!=null) ? res.Rw_mark-krav.vaerdi : null;
      if(!vaerst || ALVOR[b.status]>ALVOR[vaerst.status] || (ALVOR[b.status]===ALVOR[vaerst.status] && margin!=null && (vaerst.margin==null || margin<vaerst.margin))) vaerst={status:b.status, margin:margin, res:res};
    });
    doerRaekker(r, ix, f, kravSet, kravMangel, an, dele, mangler);
    var ud={del:'luftlyd', navn:DEL_NAVN.luftlyd, krav:vaerst.res.krav, vaerdi:afrund(vaerst.res.Rw_mark), stoerrelse:"R'w", enhed:'dB', status:vaerst.status, statusTekst:TEKST[vaerst.status],
      forskel:vaerst.res.forskel, beskrivelse:null, tekst:'Værst mod '+vaerst.res.fra, mangler:mangler, dele:dele, forbeholdKort:forbehold};
    dele.forEach(function(x){ if(x.doer && ALVOR[x.status]>ALVOR[ud.status]) ud.status=x.status; });
    if(mangler.length && ud.status!==STATUS.IKKE_OPFYLDT) ud.status=STATUS.MANGLER_INPUT;
    ud.statusTekst=TEKST[ud.status];
    return ud;
  }

  // Trinlyd: kravet afhænger af rummet ovenover (DS 490:2018 tabel 2 og afsnit 5.2). Med analysen tælles rum i samme enhed og rum under 2,5 m² ikke.
  // Dækkene over rummet: fra placeringen (finder også rum, hvis volumen ikke når op til dækket), ellers fra rummenes grænser.
  function daekOver(r, ix, an){
    if(an&&an.overFor) return (an.overFor[String(r.id)]||[]).map(function(x){ return {daek:ix.els[String(x.delId)], over:x.over.map(function(id){ return an.rum[String(id)].r; })}; });
    return (r.graenser||[]).filter(function(g){ return g.side==='top'; }).map(function(g){ return {daek:ix.els[String(g.id)], over:ix.rum.filter(function(n){ return n!==r && (n.graenser||[]).some(function(g2){ return g2.id===g.id && g2.side==='bund'; }); })}; });
  }
  function medKrav(r, over, an){
    return an ? over.filter(function(n){ return an.relation(r.id,n.id)!=='samme_enhed' && !(erTal(n.area) && n.area<2.5); }) : over;
  }
  function trinKravFor(r, over, ix, krav, kravSet, an){
    if(!an||!kravSet||krav.egetMaal) return krav;
    var alt=kravSet.trinlydFaelles; if(!alt||alt.vaerdi==null) return krav;
    // Er nogen af rummene ovenover «normale», gælder det strengeste krav for hele dækket.
    var alleLempelige=over.every(function(n){ var i=an.rum[String(n.id)]; return an.relation(r.id,n.id)==='mod_faelles' || (i&&i.rfId==='bad'); });
    return alleLempelige ? effektivtKrav(alt, null) : krav;
  }
  function trinlyd(r, ix, f, krav, kravMangel, t, an, kravSet){
    var dele=[], mangler=[], forbehold=[], setSammeEnhed=false;
    daekOver(r,ix,an).forEach(function(x){
      var daek=x.daek; if(!daek||daek.category!=='Gulve') return;
      var over=medKrav(r,x.over,an);
      if(x.over.length&&!over.length) setSammeEnhed=true;
      if(!over.length) return;
      var lv=lnwVaerdi(ix,daek,f,t), d=lv.d, ln=d ? d.vaerdi : null;
      var res=L.trinlyd({Lnw_eq:ln, deltaLw:f.trinDeltaLw, K:f.trinK, modtagerVolumen:r.volume});
      res.daek=navnAf(daek); res.daekId=daek.id; res.fra=over.map(rumNavn).join(', '); res.overIds=over.map(function(n){ return n.id; });
      res.krav=trinKravFor(r, over, ix, krav, kravSet, an);
      if(ln==null) tilfoejMangel(res.mangler||(res.mangler=[]),{felt:'daek.Lnw', tekst:'Ln,w for «'+navnAf(daek)+'»'+(lv.grund ? ' ('+lv.grund+')' : '')});
      else if(d.skoen){ res.skoen={formelId:d.formelId, metode:d.metode, m:d.m, kilde:d.kilde}; tilForbehold(forbehold, FB_LN); }
      if(f.trinK==null) tilfoejMangel(res.mangler,{felt:'K', tekst:'Trinlyd K (flanketillæg) under Forudsætninger'});
      if(f.trinDeltaLw==null) tilfoejMangel(res.mangler,{felt:'deltaLw', tekst:'Trinlyd ΔLw (gulvbelægning, 0 hvis ingen) under Forudsætninger'});
      if(an && over.some(function(n){ return an.relation(r.id,n.id)==='ukendt'; })) tilForbehold(forbehold, FB_ENHED);
      dele.push(res);
    });
    if(!dele.length) return ikkeRelevant('trinlyd', krav, setSammeEnhed ? 'Rummene ovenover udløser ikke krav (samme enhed eller under 2,5 m²)' : 'Intet rum ovenover');
    dele.forEach(function(x){ (x.mangler||[]).forEach(function(m){ tilfoejMangel(mangler,m); }); });
    // Kravet gælder L'n,w; et eget mål kan være sat som L'nT,w, og så bruges den.
    var brugNT=krav && krav.egetMaal && normSt(krav.stoerrelse)===normSt("L'nT,w");
    var noegle=brugNT ? 'LnTw_mark' : 'Lnw_mark';
    var regnet=dele.filter(function(x){ return x[noegle]!=null; });
    var margin=function(x){ return x[noegle]-(x.krav&&x.krav.vaerdi!=null ? x.krav.vaerdi : 0); };
    var vaerst=regnet.length ? regnet.reduce(function(a,b){ return margin(a)>=margin(b) ? a : b; }) : null;
    var ud=faerdig('trinlyd', vaerst ? vaerst.krav : krav, vaerst ? vaerst[noegle] : null, brugNT ? "L'nT,w" : "L'n,w", 'dB', mangler, dele, kravMangel, vaerst ? 'Fra '+vaerst.fra : null);
    ud.forbeholdKort=forbehold;
    return ud;
  }

  function efterklang(r, krav, kravMangel){
    var d=rumData(r), e=d&&d.lyd&&erObjekt(d.lyd.efterklang) ? d.lyd.efterklang : null, mangler=[];
    if(krav && krav.kraevesIkke) return ikkeRelevant('efterklang', krav, 'Der stilles ikke krav');
    if(!e||e.vaerdi==null) tilfoejMangel(mangler,{felt:'efterklang', tekst:'Efterklangstid for rummet (lyd.efterklang i rummets datapost med kilde; ISSANA beregner den ikke)'});
    else if(!e.kilde) tilfoejMangel(mangler,{felt:'efterklang.kilde', tekst:'Kilde til efterklangstiden'});
    return faerdig('efterklang', krav, e&&e.vaerdi!=null ? e.vaerdi : null, 'T', 's', mangler, e ? [{metode:'Dokumenteret værdi fra rummets datapost', vaerdi:e.vaerdi, kilde:e.kilde||null}] : [], kravMangel);
  }

  function installation(r, krav, kravMangel){
    var d=rumData(r), inst=d&&d.lyd&&erObjekt(d.lyd.installation) ? d.lyd.installation : null, mangler=[];
    if(inst && inst.ingen===true) return ikkeRelevant('installation', krav, 'Ingen installation i rummet (angivet af brugeren)');
    if(krav && krav.kraevesIkke && !inst) return ikkeRelevant('installation', krav, 'Der stilles ikke krav');
    if(!inst) tilfoejMangel(mangler,{felt:'installation', tekst:'Installationskilde i rummet (LWA og efterklangstid), eller markér «ingen installation i rummet»'});
    var res=L.installation({LWA:inst ? inst.LWA : null, rumVolumen:r.volume, efterklangstid:inst ? inst.efterklangstid : null});
    if(inst) (res.mangler||[]).forEach(function(m){ tilfoejMangel(mangler,m); });
    return faerdig('installation', krav, res.Lp_kilderum, 'LAeq', 'dB', mangler, [res], kravMangel);
  }

  /* ---------- Vurdering af ét rum ---------- */
  function vurderRum(rum, model, bygningstype, valg){
    valg=erObjekt(valg) ? valg : {};
    var t=valg.tabel||tabel, ix=lavIndeks(model), an=valg.analyse||null;
    var f={deltaLfs:null, brugCtr:false, udenFlanker:false, trinK:null, trinDeltaLw:null, brugSkoen:false};
    if(erObjekt(valg.forudsaetninger)) Object.keys(f).forEach(function(k){ if(valg.forudsaetninger[k]!==undefined) f[k]=valg.forudsaetninger[k]; });
    var rumbrug=rumbrugAf(rum), rf=rumfunktionFraRumbrug(rumbrug, rum.name, t);
    if(valg.rumfunktion && t && t.rumfunktioner[valg.rumfunktion]){ rf.id=valg.rumfunktion; rf.navn=t.rumfunktioner[valg.rumfunktion].navn; rf.kilde='valgt'; }
    var k=kravFor(bygningstype, rf.id, t);
    var kravSet=(k.bygningstype && k.rumfunktion) ? k.krav : null;
    var kravMangel=null;
    if(!t) kravMangel={felt:'tabel', tekst:'Kravtabellen lydkrav.json er ikke indlæst'};
    else if(!k.bygningstype) kravMangel={felt:'bygningstype', tekst:'Bygningstype (vælg øverst i Lyd-fanen)'};
    else if(!k.rumfunktion) kravMangel={felt:'rumfunktion', tekst:'Rumfunktion for rummet'+(rf.ukendtRumbrug ? ' (rumbrugen «'+rf.rumbrug+'» findes ikke i lydkrav.json)' : '')+(rf.forslag ? ' – forslag ud fra navnet: '+rf.forslag.navn+' (skal godkendes)' : '')};
    var kravEl=function(del){ return effektivtKrav((kravSet && kravSet[del]) || tomtKrav(del, t), maalFor(rum,del)); };
    var info=an&&an.rum[String(rum.id)]||null, efter=kravEl('efterklang');
    // DS 490 tabel 3 gælder gange og trapper med adgang til mere end 2 boliger; en gang inde i en bolig har intet krav.
    if(an && rf.id==='gang' && efter.vaerdi!=null && !efter.egetMaal && info && !(info.faelles && info.adgang>2)) efter=Object.assign({},efter,{vaerdi:null, kraevesIkke:true, note:'Gælder kun gange med adgang til mere end 2 boliger (DS 490:2018 tabel 3).'});
    var dele=(info&&info.ude) ? DELE.reduce(function(o,d){ o[d]=ikkeRelevant(d, null, 'Udendørs rum (gårdrum, terrasse)'); return o; },{}) : {
      luftlyd: luftlyd(rum, ix, f, skelKrav(rum, kravSet, bygningstype, t, an), kravMangel, t, an),
      trinlyd: trinlyd(rum, ix, f, kravEl('trinlyd'), kravMangel, t, an, kravSet),
      facade: facade(rum, ix, f, kravEl('facade'), kravMangel, t, an),
      efterklang: efterklang(rum, efter, kravMangel),
      installation: installation(rum, kravEl('installation'), kravMangel)
    };
    var samlet=STATUS.IKKE_RELEVANT, mangler=[], forbeholdKort=[];
    DELE.forEach(function(d){ var x=dele[d]; if(ALVOR[x.status]>ALVOR[samlet]) samlet=x.status; (x.mangler||[]).forEach(function(m){ if(!mangler.some(function(y){ return y.tekst===m.tekst; })) mangler.push({del:d, felt:m.felt, tekst:m.tekst}); }); (x.forbeholdKort||[]).forEach(function(b){ tilForbehold(forbeholdKort,b); }); });
    var bygdele=[]; (rum.graenser||[]).forEach(function(g){ if(bygdele.indexOf(g.id)<0) bygdele.push(g.id); });
    (dele.facade.dele||[]).forEach(function(x){ (x.aabningIds||[]).forEach(function(id){ if(bygdele.indexOf(id)<0) bygdele.push(id); }); });
    return {
      rumId:rum.id, uniqueId:rum.uniqueId||null, navn:rumNavn(rum), niveau:rum.level||null, volumen:erTal(rum.volume) ? rum.volume : null,
      bygningstype:k.bygningstype, rumbrug:rumbrug, rumfunktion:rf, forudsaetninger:f,
      dele:dele, samlet:samlet, samletTekst:TEKST[samlet], mangler:mangler, bygningsdele:bygdele, forbehold:FORBEHOLD, forbeholdKort:forbeholdKort,
      enhed:info ? info.enhed : null, faelles:info ? !!info.faelles : false
    };
  }
  function vurderAlle(model, bygningstype, valg){
    var ix=lavIndeks(model), v=erObjekt(valg) ? valg : {};
    return ix.rum.map(function(r){ var egen=Object.assign({}, v); if(v.rumfunktioner && v.rumfunktioner[r.id]) egen.rumfunktion=v.rumfunktioner[r.id]; return vurderRum(r, ix, bygningstype, egen); });
  }

  return {
    STATUS:STATUS, TEKST:TEKST, FARVE:FARVE, DELE:DELE, DEL_NAVN:DEL_NAVN, FORBEHOLD:FORBEHOLD,
    tjekTabel:tjekTabel, saetTabel:saetTabel, tabel:hentTabel, indlaes:indlaes,
    bygningstyper:bygningstyper, rumfunktioner:rumfunktioner,
    kravFor:kravFor, rumfunktionFraRumbrug:rumfunktionFraRumbrug,
    vurderRum:vurderRum, vurderAlle:vurderAlle, lavIndeks:lavIndeks,
    skoenRw:skoenRw, skoenLnw:skoenLnw, rwVaerdi:rwVaerdi, lnwVaerdi:lnwVaerdi,
    hjaelp:{rumbrugAf:rumbrugAf, rumData:rumData, rumNavn:rumNavn, navnAf:navnAf, erFacade:erFacade}
  };
});
