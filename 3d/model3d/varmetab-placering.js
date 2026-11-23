/* ISSANA 3D: randbetingelser og relevans for varmetabet ud fra bygningsdelens placering. Rent modul uden DOM.
   Browser: window.IssanaVarmetabPlacering. Node: module.exports. Placeringen kommer fra bygningsdel-placering.js.

   Tallene står her med kilde og kan rettes pr. model i fanen. Grundlag: DS 418:2026 (8. udgave), læst i den lokale kopi;
   DS 418:2026/Ret.1:2026 er ikke kontrolleret. Hvor standarden kun siger «skøn», står det i kilden.
   - Udetemperatur −12 °C (pkt. 4.2), ikke −20 °C. Særlige tilfælde sættes med hånden.
   - Bad regnes som resten af bygningen: pkt. 7 siger, at der ses bort fra, at enkelte rum som baderum har en anden temperatur.
     Badets «andre forhold» er fugten (vådrum), som hører til fugtberegningen, ikke til det dimensionerende varmetab.
   - Terrændæk og kældergulv regnes mod 10 °C, kælderydervæg ned til 2 m mod udetemperaturen (pkt. 4.2 og 5.2).
   - To opvarmede rum tæller ikke i bygningens samlede tab: tabet i det ene rum er tilskud i det andet (pkt. 5.3). */
(function(root, factory){
  "use strict";
  var erNode = typeof module==='object' && module && module.exports;
  var api = factory(root, erNode);
  if(erNode) module.exports=api; else root.IssanaVarmetabPlacering=api;
})(typeof self!=='undefined' ? self : this, function(root, erNode){
  "use strict";
  var P = erNode ? require('./bygningsdel-placering.js') : root.IssanaPlacering;

  var KILDE={
    ude:'DS 418:2026 pkt. 4.2: −12 °C i almindelighed. Kan nedsættes eller forhøjes i særlige tilfælde.',
    beboelse:'DS 418:2026 pkt. 4.1: normalt 20 °C i beboelsesrum.',
    arbejde:'DS 418:2026 pkt. 4.1: fastsættes efter arbejdets karakter. 20 °C er ISSANAs forslag; kontrollér.',
    bad:'DS 418:2026 pkt. 4.1 og 7: 20 °C. Der ses bort fra, at enkelte rum, fx baderum, kan være anderledes. Badets fugt hører til fugtberegningen.',
    uopvarmet:'DS 418:2026 pkt. 4.1: skøn eller varmebalance for rummet. Standarden har ingen tabel; 5 °C er ISSANAs skøn, ret det.',
    afhaenger:'Opvarmet over terræn, uopvarmet i kælder er ISSANAs antagelse. DS 418 afgør det ikke; vælg selv.',
    jord:'DS 418:2026 pkt. 4.2 og 5.2: 10 °C under terrændæk og kældergulv og i dybde over 2 m; udetemperaturen ned til 2 m. Jordens isolans R_j: pkt. 8.11 tabel 13.',
    kryberum:'DS 418:2026 pkt. 4.3: −5 °C for almindelige stærkt ventilerede kryberum.'
  };
  var STANDARD={te:-12, thetaJ:10, thetaU:5, kryberum:-5, kdybde:2};
  // θi og kilde pr. rumtype. tilstand kan rettes pr. model.
  var RUM={
    ophold:{theta:20,kilde:'beboelse'}, soverum:{theta:20,kilde:'beboelse'}, hotelvaerelse:{theta:20,kilde:'beboelse'}, koekken:{theta:20,kilde:'beboelse'},
    bad:{theta:20,kilde:'bad'}, gang:{theta:20,kilde:'beboelse'}, trapperum:{theta:20,kilde:'beboelse'},
    kontor:{theta:20,kilde:'arbejde'}, undervisning:{theta:20,kilde:'arbejde'}, moede:{theta:20,kilde:'arbejde'},
    teknik:{theta:20,kilde:'afhaenger'}, depot:{theta:20,kilde:'afhaenger'}, parkering:{theta:20,kilde:'uopvarmet'},
    ude:{theta:null,kilde:'ude'}, andet:{theta:20,kilde:'arbejde'}, ukendt:{theta:20,kilde:'beboelse'}
  };

  function randbetingelser(gemt){
    gemt=gemt||{};
    var r={te:STANDARD.te, thetaJ:STANDARD.thetaJ, thetaU:STANDARD.thetaU, kdybde:STANDARD.kdybde, rum:{}};
    ['te','thetaJ','thetaU','kdybde'].forEach(function(k){ if(typeof gemt[k]==='number'&&isFinite(gemt[k])) r[k]=gemt[k]; });
    Object.keys(RUM).forEach(function(id){ var g=(gemt.rum&&gemt.rum[id])||{}; r.rum[id]={theta:typeof g.theta==='number'&&isFinite(g.theta)?g.theta:RUM[id].theta, tilstand:g.tilstand||null}; });
    return r;
  }
  function tilstandAf(side,rand){ var o=rand.rum[side.rumtype]&&rand.rum[side.rumtype].tilstand; return o||side.tilstand; }
  function jordTheta(rolle,rand){
    if(rolle!=='kaeldervaeg') return rand.thetaJ;
    var h=rand.kdybde>0? rand.kdybde : 2;
    return h<=2? rand.te : (2*rand.te+(h-2)*rand.thetaJ)/h;     // ned til 2 m: θe; dybere: θj (arealvægtet over væggens dybde)
  }
  function side(s,rand){
    if(s.art==='rum'){ var t=tilstandAf(s,rand), o=rand.rum[s.rumtype]||{};
      if(t==='ude') return {art:'ude',theta:rand.te,navn:s.navn};
      if(t==='uopvarmet') return {art:'uopvarmet',theta:rand.thetaU,navn:s.navn};
      return {art:'opvarmet',theta:typeof o.theta==='number'?o.theta:20,navn:s.navn,rumtype:s.rumtype}; }
    if(s.art==='ude') return {art:'ude',theta:rand.te,rolle:s.rolle||null};
    if(s.art==='jord') return {art:'jord',theta:jordTheta(s.rolle,rand),rolle:s.rolle};
    return {art:'ukendt',theta:null};
  }
  var ROLLE_TEKST={terraendaek:'terrændæk',kaeldergulv:'kældergulv',kaeldervaeg:'kælderydervæg',tagrum:'tagrum'};
  function modTekst(s){ return s.art==='ude'? (s.rolle==='tagrum'?'mod tagrum/det fri':'mod det fri') : s.art==='jord'? 'mod jord ('+(ROLLE_TEKST[s.rolle]||'jord')+')' : s.art==='uopvarmet'? 'mod uopvarmet rum'+(s.navn?' («'+s.navn+'»)':'') : 'uafklaret side'; }
  function kildeAf(s){ return s.art==='ude'? KILDE.ude : s.art==='jord'? KILDE.jord : s.art==='uopvarmet'? KILDE.uopvarmet : ''; }

  // Én flade → en række i tabellen eller en begrundelse for, at den ikke indgår.
  function vurderFlade(f,rand){
    var a=side(f.a,rand), b=side(f.b,rand);
    if(a.art==='opvarmet'&&b.art==='opvarmet'){
      var ens=Math.abs(a.theta-b.theta)<0.01;
      return {ikke:true,tekst:ens? 'Mellem rum med samme temperatur ('+a.theta+' °C)' : 'Mellem opvarmede rum',grund: ens? 'Ingen temperaturforskel, ingen varmestrøm (DS 418:2026 pkt. 5.3).' : 'Tab fra det varme rum er tilskud til det kolde, så det tæller ikke i bygningens samlede tab (DS 418:2026 pkt. 5.3).'};
    }
    var varm=a.art==='opvarmet'? a : b.art==='opvarmet'? b : null, kold=varm===a? b : a;
    if(!varm){
      // Ingen opvarmet side: kun en række, hvis der er noget at afklare (element uden rum mod ude/jord).
      if(a.art==='ukendt'||b.art==='ukendt'){ var kend=a.art==='ukendt'? b : a; if(kend.art==='ude'||kend.art==='jord') return {art:kend.art,rolle:kend.rolle||null,thetaA:20,thetaB:kend.theta,med:false,sikkerhed:'lav',tekst:modTekst(kend),kilde:kildeAf(kend),grund:f.grund}; }
      return {ikke:true,tekst:'Ingen opvarmet side',grund:'Uopvarmet eller ude på begge sider: ingen opvarmet flade at regne tab fra.'};
    }
    if(kold.art==='ukendt') return {art:'ukendt',rolle:null,thetaA:varm.theta,thetaB:rand.thetaU,med:false,sikkerhed:'lav',tekst:'uafklaret side',kilde:KILDE.uopvarmet,grund:f.grund};
    if(kold.art==='opvarmet') return {ikke:true,tekst:'Mellem opvarmede rum',grund:'Intern varmestrøm.'};
    return {art:kold.art,rolle:kold.rolle||null,thetaA:varm.theta,thetaB:kold.theta,med:f.sikkerhed!=='lav',sikkerhed:f.sikkerhed,tekst:modTekst(kold),kilde:kildeAf(kold),grund:f.grund,rum:varm.navn};
  }
  function noegle(e){ return (e.kategori||'')+'¦'+(e.familie||'')+'¦'+(e.type||''); }

  function beregn(analyse,rand){
    var rk={}, ind={}, ikke={}, afklar={};
    function saml(t,k,post,e,areal){ var x=t[k]||(t[k]=Object.assign({ids:[],_set:{},antal:0,areal:0},post)); if(!x._set[e.id]){ x._set[e.id]=1; x.antal++; x.ids.push(e.id); } if(areal>0) x.areal+=areal; return x; }
    (analyse.elementer||[]).forEach(function(e){
      if(e.udenfor){ saml(ikke,e.kategori+'|'+e.grund,{kategori:e.kategori,grund:e.grund},e,e.areal||0); return; }
      e.flader.forEach(function(f){
        var v=vurderFlade(f,rand), areal=(e.areal||0)*(f.andel==null?1:f.andel);
        if(v.ikke){ saml(ikke,e.kategori+'|'+v.tekst,{kategori:e.kategori,tekst:v.tekst,grund:v.grund},e,areal); return; }
        var kn=noegle(e)+'|'+v.art+'|'+(v.rolle||'')+'|'+v.thetaA+'|'+v.thetaB+'|'+(v.med?1:0);
        var r=rk[kn]||(rk[kn]={noegle:noegle(e),kategori:e.kategori,type:e.type,art:v.art,rolle:v.rolle,thetaA:v.thetaA,thetaB:v.thetaB,med:v.med,sikkerhed:v.sikkerhed,tekst:v.tekst,kilde:v.kilde,grund:v.grund,areal:0,ids:[],_set:{},rum:[]});
        if(areal>0) r.areal+=areal; if(!r._set[e.id]){ r._set[e.id]=1; r.ids.push(e.id); } if(v.rum&&r.rum.indexOf(v.rum)<0) r.rum.push(v.rum);
        if(f.sikkerhed==='lav'||v.sikkerhed==='lav') r.sikkerhed='lav';
        if(v.med) saml(ind,e.kategori+'|'+v.tekst.split(' («')[0],{kategori:e.kategori,tekst:v.tekst.split(' («')[0],kilde:v.kilde},e,areal);
        else saml(afklar,e.kategori+'|'+v.grund,{kategori:e.kategori,tekst:v.tekst,grund:v.grund},e,areal);
      });
    });
    function liste(t){ return Object.keys(t).map(function(k){ var x=t[k]; delete x._set; x.areal=Math.round(x.areal*10)/10; return x; }).sort(function(a,b){ return (a.kategori||'').localeCompare(b.kategori||'','da')||b.areal-a.areal; }); }
    var raekker=Object.keys(rk).map(function(k){ var x=rk[k]; delete x._set; x.areal=Math.round(x.areal*100)/100; return x; })
      .filter(function(x){ return x.areal>0; })
      .sort(function(a,b){ return a.kategori.localeCompare(b.kategori,'da')||String(a.type).localeCompare(String(b.type),'da')||b.areal-a.areal; });
    return {raekker:raekker, relevans:{indgaar:liste(ind), indgaarIkke:liste(ikke), afklares:liste(afklar)}, opvarmet:opvarmet(analyse,rand)};
  }

  function opvarmet(analyse,rand){
    var a=0, v=0, n=0, pr={};
    (analyse.rum||[]).forEach(function(r){
      if(side({art:'rum',rumtype:r.rumtype.id,tilstand:r.tilstand,navn:r.navn},rand).art!=='opvarmet') return;
      var k=r.kilde||{}, areal=typeof k.area==='number'?k.area:0;
      a+=areal; v+=typeof k.volume==='number'&&k.volume>0? k.volume : areal*2.6; n++;
      if(r.niveau) pr[r.niveau]=(pr[r.niveau]||0)+areal;
    });
    // BR18 § 264: E = opvarmet etageareal / bebygget areal, som er den største opvarmede etage (BR-vejledningen pkt. 1.11).
    var niv=Object.keys(pr).map(function(k){ return pr[k]; }), stoerst=Math.max.apply(null,niv.concat(0)), sum=niv.reduce(function(s,x){ return s+x; },0);
    return {areal:Math.round(a*10)/10, volumen:Math.round(v), antal:n, etager:stoerst>0? sum/stoerst : niv.length};
  }
  // Den ene rumtype-kilde (til tabellen over randbetingelser)
  function rumKilde(id){ return KILDE[(RUM[id]||{}).kilde]||''; }
  function rumtyperIModel(analyse,rand){
    var t={}; (analyse.rum||[]).forEach(function(r){ var id=r.rumtype.id, x=t[id]||(t[id]={id:id,navn:r.rumtype.navn,antal:0,tilstande:{},rum:[]}); x.antal++; x.tilstande[r.tilstand]=(x.tilstande[r.tilstand]||0)+1; if(x.rum.length<4) x.rum.push(r.navn); });
    return Object.keys(t).map(function(k){ var x=t[k], o=rand.rum[k]||{}; x.theta=o.theta; x.tilstand=o.tilstand||null; x.kilde=rumKilde(k); return x; }).sort(function(a,b){ return b.antal-a.antal; });
  }

  // Ændringslistens forslag: rummenes rumtype/temperatur og elementernes placering. Skrives først ved «Gem i Revit».
  function forslag(analyse,rand,dato){
    var ud={rum:[],elementer:[]};
    (analyse.rum||[]).forEach(function(r){
      if(!r.uniqueId) return;
      var s={art:'rum',rumtype:r.rumtype.id,tilstand:r.tilstand,navn:r.navn}, v=side(s,rand), t=P.RUMTYPER[r.rumtype.id]||{};
      var data={rumtype:r.rumtype.id, tilstand:v.art==='opvarmet'?'opvarmet':v.art, theta_i:v.art==='ude'?null:v.theta, kilde:v.art==='uopvarmet'?KILDE.uopvarmet:v.art==='ude'?KILDE.ude:rumKilde(r.rumtype.id), fra:r.rumtype.fra==='navn'?('rumnavnet «'+r.rumtype.ord+'»'):r.rumtype.fra==='rumanvendelse'?'rumanvendelsen':'ukendt', analyseret:dato};
      if(t.vaadrum) data.vaadrum=true;
      // Rumanvendelsen foreslås kun, når navnet klart siger den, og rummet ikke har en i forvejen (kun rumtyper med en rumanvendelse).
      var brug=r.rumtype.fra==='navn'&&t.rumbrug&&t.rumbrug!=='andet'? t.rumbrug : null;
      ud.rum.push({uniqueId:r.uniqueId,id:r.id,rumbrug:brug,data:data});
    });
    (analyse.elementer||[]).forEach(function(e){
      if(!e.uniqueId||e.udenfor||!e.flader.length) return;
      var pr=e.flader.map(function(f){ var v=vurderFlade(f,rand); return v.ikke? {andel:rund(f.andel),med:false,mod:v.tekst} : {andel:rund(f.andel),med:!!v.med,mod:v.tekst,theta_a:v.thetaA,theta_b:v.thetaB,sikkerhed:v.sikkerhed}; });
      var med=pr.some(function(p){ return p.med; });
      var data={med:med,placering:pr,kilde:med? (pr.filter(function(p){return p.med;})[0]? 'DS 418:2026 pkt. 4 og 5' : '') : 'Indgår ikke i bygningens samlede transmissionstab',analyseret:dato};
      ud.elementer.push({uniqueId:e.uniqueId,id:e.id,data:data});
    });
    return ud;
  }
  function rund(n){ return Math.round((n==null?1:n)*100)/100; }
  // Samme forslag som sidst (dato tæller ikke)? Så skal der ikke ligge en ny post i ændringslisten.
  function ensForslag(a,b){ if(!a||!b) return false; var x=Object.assign({},a), y=Object.assign({},b); delete x.analyseret; delete y.analyseret; return JSON.stringify(x)===JSON.stringify(y); }

  return {KILDE:KILDE, STANDARD:STANDARD, RUM:RUM, ROLLE_TEKST:ROLLE_TEKST, randbetingelser:randbetingelser, side:side, vurderFlade:vurderFlade, beregn:beregn, jordTheta:jordTheta, rumtyperIModel:rumtyperIModel, forslag:forslag, ensForslag:ensForslag, rumKilde:rumKilde, noegle:noegle};
});
