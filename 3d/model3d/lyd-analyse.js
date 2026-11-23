/* ISSANA – lydanalyse af modellen: placering → enheder → relevans → forslag. Bruges af Lyd-fanen (arbejdsrum-lyd.js).
   Rent modul uden DOM. Browser: <script src="lyd-analyse.js"> giver window.IssanaLydAnalyse. Node: module.exports.

   Hvad den gør:
   1. Placering: hvilke rum ligger på hver side af hver væg og hvert dæk. Det kommer fra det fælles placeringsmodul
      (window.IssanaPlacering.analyser(model)). Er modulet ikke indlæst, bruges rummenes grænser, og alt mærkes «ikke sikkert».
   2. Enheder: hvilke rum hører til samme bolig. Findes af dørene: rum forbundet med døre er én enhed; fælles trapper og gange deler.
      DS 490 stiller krav «mellem en bolig og rum uden for boligen», så det er enheden, der afgør kravet.
   3. Relevans: hvilke bygningsdele der indgår i beregningen, og hvilke der ikke gør, hver med en kort begrundelse.
   4. Forslag: rumbrug og rummets lyddata til ændringslisten. Modulet skriver intet selv.

   Rumnavne er kun forslag (kilde 'rumnavn'). Usikre afgørelser er mærket og står i listen `uafklaret`. */
(function(root, factory){
  "use strict";
  var erNode = typeof module==='object' && module && module.exports;
  var api = factory(root, erNode);
  if(erNode) module.exports=api; else root.IssanaLydAnalyse=api;
})(typeof self!=='undefined' ? self : this, function(root, erNode){
  "use strict";

  var K = erNode ? require('./lydkrav.js') : root.IssanaLydkrav;
  var H = K ? K.hjaelp : null;
  function placeringsModul(){
    if(erNode){ try{ return require('./bygningsdel-placering.js'); }catch(e){ return null; } }
    return root.IssanaPlacering||null;
  }
  function erTal(v){ return typeof v==='number' && isFinite(v); }
  function lav(s){ return String(s==null?'':s).trim().toLowerCase(); }
  function klon(o){ return o==null ? o : JSON.parse(JSON.stringify(o)); }

  var FAELLES_ORD=/(fælles|faelles|opgang|svalegang|trapperum|korridor|elevator|cykelrum|barnevogn|vaskeri|reception|lobby)/;
  var ENTRE_ORD=/(entré|entre\b|forstue|vindfang)/;

  /* ---------- 1. Placering ---------- */
  // Rummenes grænser, når det fælles modul ikke er indlæst. Væggens side kan ikke ses her, så intet er «sikkert».
  function fraGraenser(ix){
    var dele={};
    ix.rum.forEach(function(r){ (r.graenser||[]).forEach(function(g){
      var e=ix.els[String(g.id)]; if(!e) return;
      var d=dele[String(g.id)]||(dele[String(g.id)]={id:g.id, kategori:e.category, rum:[], par:[], udeRum:[], mod:null, kilde:'rummenes grænser (uden placeringsmodul)', sikker:false});
      d.rum.push({rumId:r.id, side:g.side, areal:erTal(g.areal) ? g.areal : null});
    }); });
    Object.keys(dele).forEach(function(k){
      var d=dele[k], e=ix.els[k];
      function parAf(a,b){ a.forEach(function(x){ b.forEach(function(y){ if(x.rumId!==y.rumId) d.par.push({aRumId:x.rumId, bRumId:y.rumId, areal:(x.areal!=null&&y.areal!=null) ? Math.min(x.areal,y.areal) : (x.areal!=null ? x.areal : y.areal), sikker:false}); }); }); }
      if(d.kategori==='Gulve'){
        var top=d.rum.filter(function(x){ return x.side==='top'; }), bund=d.rum.filter(function(x){ return x.side==='bund'; });
        if(top.length&&bund.length){ d.mod='rum'; parAf(bund,top); }                 // a = rummet over dækket, b = rummet under
      } else if(d.kategori==='Vægge'){
        var s=d.rum.filter(function(x){ return x.side==='side'; });
        if(H.erFacade(ix,e)){ d.mod='det_fri'; d.udeRum=s.map(function(x){ return x.rumId; }); return; }
        for(var i=0;i<s.length;i++) for(var j=i+1;j<s.length;j++) parAf([s[i]],[s[j]]);
        if(s.length>=2) d.mod='rum';
      }
    });
    return dele;
  }
  // bygningsdel-placering.js → {delId: {id, kategori, par:[{aRumId,bRumId,areal,sikker}], udeRum, mod, udenfor, kilde, sikker}}.
  // For dæk er a rummet over og b rummet under. Et «rum» af typen ude (gårdrum, terrasse) tæller som det fri.
  function sideArt(s){ if(!s) return 'ukendt'; return s.art==='rum'&&s.tilstand==='ude' ? 'ude' : s.art; }
  function fraModul(res, ix){
    var ud={}, areal={};
    ix.rum.forEach(function(r){ (r.graenser||[]).forEach(function(g){ var k=String(r.id)+'|'+g.id; areal[k]=(areal[k]||0)+(erTal(g.areal) ? g.areal : 0); }); });
    ((res&&res.elementer)||[]).forEach(function(el){
      var d={id:el.id, kategori:el.kategori, par:[], udeRum:[], mod:null, udenfor:el.udenfor||null, kilde:'fælles placeringsmodul', sikker:true}, sider={};
      (el.flader||[]).forEach(function(f){
        var aa=sideArt(f.a), ab=sideArt(f.b), aR=aa==='rum', bR=ab==='rum';
        if(f.sikkerhed==='lav') d.sikker=false;
        if(aR&&bR){
          var ga=areal[String(f.a.rumId)+'|'+el.id], gb=areal[String(f.b.rumId)+'|'+el.id];
          d.par.push({aRumId:f.a.rumId, bRumId:f.b.rumId, areal:(ga>0&&gb>0) ? Math.min(ga,gb) : (erTal(el.areal)&&erTal(f.andel) ? el.areal*f.andel : (ga>0 ? ga : (gb>0 ? gb : null))), sikker:f.sikkerhed!=='lav'});
        } else if(aR||bR){
          var mod=aR ? ab : aa; sider[mod]=1;
          if(mod==='ude'){ var rid=(aR ? f.a : f.b).rumId; if(d.udeRum.indexOf(rid)<0) d.udeRum.push(rid); }
        }
      });
      d.mod=d.par.length ? 'rum' : (d.udeRum.length ? 'det_fri' : (sider.jord ? 'jord' : (sider.ukendt ? 'ukendt' : null)));
      ud[String(el.id)]=d;
    });
    return ud;
  }
  function placeringAf(model, ix, valg){
    var res=valg.placering||null, M=null;
    if(!res){ M=placeringsModul(); if(M&&typeof M.analyser==='function'){ try{ res=M.analyser(model); }catch(e){ if(typeof console!=='undefined') console.warn('ISSANA Lyd: placeringsmodulet fejlede', e); } } }
    var ude={}; ((res&&res.rum)||[]).forEach(function(r){ if(r.tilstand==='ude') ude[String(r.id)]=1; });
    return res ? {dele:fraModul(res,ix), kilde:'modul', ude:ude} : {dele:fraGraenser(ix), kilde:'graenser', ude:ude};
  }

  /* ---------- 2. Rumfunktion og enheder ---------- */
  function rumInfo(ix, t, valgte, bruger){
    var ud={};
    ix.rum.forEach(function(r){
      var rb=H.rumbrugAf(r), rf=K.rumfunktionFraRumbrug(rb, r.name, t), id=null, kilde=null, data=H.rumData(r), p=data&&data.lyd&&data.lyd.placering;
      if(valgte&&valgte[r.id]){ id=valgte[r.id]; kilde='valgt'; }
      else if(rf.id){ id=rf.id; kilde='rumbrug'; }
      else if(rf.forslag){ id=rf.forslag.id; kilde='rumnavn'; }
      ud[String(r.id)]={id:r.id, r:r, navn:H.rumNavn(r), navnLav:lav(r.name), niveau:r.level||null, areal:erTal(r.area) ? r.area : null, rumbrug:rb, rfId:id, rfKilde:kilde, ord:rf.forslag ? rf.forslag.ord : null, ukendtRumbrug:!!rf.ukendtRumbrug,
        faelles:false, enhed:null, enhedKilde:null, sikker:false, adgang:0, bruger:(bruger&&bruger[r.id]) || ((p&&p.kilde==='bruger') ? p : null)};
    });
    return ud;
  }
  function doerePar(ix, info){
    var ud=[];
    Object.keys(ix.els).forEach(function(k){ var e=ix.els[k]; if(e.category==='Døre'&&Array.isArray(e.rum)&&e.rum.length===2&&info[String(e.rum[0])]&&info[String(e.rum[1])]) ud.push({id:e.id, a:String(e.rum[0]), b:String(e.rum[1])}); });
    return ud;
  }
  function komponenter(ids, doere, medtag){
    var fra={}; ids.forEach(function(id){ if(medtag(id)) fra[id]=[]; });
    doere.forEach(function(d){ if(fra[d.a]&&fra[d.b]){ fra[d.a].push(d.b); fra[d.b].push(d.a); } });
    var set={}, ud=[];
    Object.keys(fra).forEach(function(s){ if(set[s]) return; var k=[], st=[s]; set[s]=1; while(st.length){ var x=st.pop(); k.push(x); fra[x].forEach(function(y){ if(!set[y]){ set[y]=1; st.push(y); } }); } ud.push(k); });
    return ud;
  }
  function boligNok(k, info, streng){
    var fn=k.map(function(id){ return info[id].rfId; }), har=function(x){ return fn.indexOf(x)>=0; };
    var ophold=har('opholdsrum')||har('koekken');
    return (streng ? ophold : ophold||har('soverum')) && (har('bad')||har('koekken'));
  }
  function findEnheder(ix, info){
    var ids=Object.keys(info), doere=doerePar(ix,info), harDoerdata=doere.length>0;
    ids.forEach(function(id){ var x=info[id]; if(FAELLES_ORD.test(x.navnLav)){ x.faelles=true; x.sikker=true; x.faellesGrund='rumnavnet'; } });
    // Gange og trapper uden fælles-ord: de er fælles, hvis der på flere sider af dem ligger noget, der ligner en hel bolig.
    var kand=ids.filter(function(id){ var x=info[id]; return !x.faelles && !x.ude && (x.rfId==='gang'||x.rfId==='trappe') && !ENTRE_ORD.test(x.navnLav); });
    if(harDoerdata&&kand.length){
      var uden=komponenter(ids,doere,function(id){ return !info[id].faelles && !info[id].ude && kand.indexOf(id)<0; }), hvor={};
      uden.forEach(function(k,n){ k.forEach(function(id){ hvor[id]=n; }); });
      kand.forEach(function(id){
        var naboK={}, antal=0; doere.forEach(function(d){ var o=d.a===id ? d.b : (d.b===id ? d.a : null); if(!o) return; antal++; if(hvor[o]!=null) naboK[hvor[o]]=1; });
        var liste=Object.keys(naboK).map(function(n){ return uden[n]; }), x=info[id];
        var strenge=liste.filter(function(k){ return boligNok(k,info,true); }).length, loese=liste.filter(function(k){ return boligNok(k,info,false); }).length;
        var vaerelser=liste.filter(function(k){ return k.some(function(y){ return info[y].rfId==='soverum'; }) && k.every(function(y){ return info[y].rfId==='soverum'||info[y].rfId==='bad'; }); }).length;
        // En rigtig bolig har ikke en gang med mange værelser langs sig, otte døre eller 40 m²: så er det en hotel- eller kollegiegang.
        if(strenge>=2||loese>=3||vaerelser>=4||antal>=8||(x.areal!=null&&x.areal>=40)){ x.faelles=true; x.faellesGrund='dørene'; }
      });
    }
    var enheder=[];
    if(harDoerdata){
      var komp=komponenter(ids,doere,function(id){ return !info[id].faelles && !info[id].ude; });
      komp.sort(function(a,b){ var x=info[a[0]], y=info[b[0]]; return String(x.niveau||'').localeCompare(String(y.niveau||''),'da',{numeric:true})||x.navn.localeCompare(y.navn,'da',{numeric:true}); });
      var nr=0;
      komp.forEach(function(k){
        var enRum=k.length===1, x=info[k[0]], mod=doere.some(function(d){ var o=d.a===k[0] ? d.b : (d.b===k[0] ? d.a : null); return o&&info[o].faelles; });
        // Ingen beboelse i gruppen (kælderrum, teknik, cykelrum, toiletter): rum uden for boligerne.
        if(!k.some(function(id){ return ['soverum','opholdsrum','koekken'].indexOf(info[id].rfId)>=0; })){
          if(!enRum||mod||x.rfId==='teknikrum'||x.rfId==='depot') k.forEach(function(id){ info[id].faelles=true; info[id].faellesGrund='rum uden for boligen'; });
          return;
        }
        if(enRum&&!mod) return;                                                                                                   // ingen døre: enheden kan ikke afgøres
        var navn='Enhed '+(++nr);
        k.forEach(function(id){ info[id].enhed=navn; info[id].enhedKilde='dørforbindelser'; info[id].sikker=!enRum; });
        enheder.push({navn:navn, rumIds:k.map(function(id){ return info[id].id; }), niveauer:k.map(function(id){ return info[id].niveau; }).filter(function(v,i,a){ return v&&a.indexOf(v)===i; })});
      });
    }
    // Brugerens egen angivelse går altid forud
    ids.forEach(function(id){ var x=info[id], p=x.bruger; if(!p) return; x.faelles=!!p.faelles; x.enhed=p.faelles ? null : (p.enhed||null); x.enhedKilde='bruger'; x.sikker=true; });
    // Adgang: hvor mange enheder en fælles gang eller trappe har døre til (gennem andre fælles rum)
    ids.forEach(function(id){
      var x=info[id]; if(!x.faelles) return;
      var set={}, st=[id], fundet={}; set[id]=1;
      while(st.length){ var c=st.pop(); doere.forEach(function(d){ var o=d.a===c ? d.b : (d.b===c ? d.a : null); if(!o||set[o]) return; if(info[o].faelles){ set[o]=1; st.push(o); } else if(info[o].enhed) fundet[info[o].enhed]=1; }); }
      x.adgang=Object.keys(fundet).length;
    });
    return {enheder:enheder, harDoerdata:harDoerdata, doere:doere};
  }

  function foreslaaBygningstype(info, enh, t, ix){
    if(!t) return null;
    var tael={}, ids=Object.keys(info), niveauer={};
    ids.forEach(function(id){ var f=info[id].rfId; if(f) tael[f]=(tael[f]||0)+1; if(info[id].niveau) niveauer[info[id].niveau]=1; });
    var bt=function(id,hvorfor,sikker){ return t.bygningstyper[id] ? {id:id, navn:t.bygningstyper[id].navn, begrundelse:hvorfor, sikker:sikker} : null; };
    if((tael.undervisningsrum||0)>0) return bt('undervisning', tael.undervisningsrum+' undervisningsrum i modellen', true);
    if((tael.kontor||0)+(tael.moederum||0)>0 && !tael.soverum) return bt('kontor', ((tael.kontor||0)+(tael.moederum||0))+' kontorer og møderum i modellen', true);
    if(!tael.soverum && !tael.opholdsrum) return null;
    if(tael.soverum>=6 && (tael.koekken||0)<=2 && !tael.opholdsrum) return bt('hotel', tael.soverum+' værelser og '+(tael.koekken||0)+' køkkener, ingen stuer', false);
    var n=enh.enheder.length, stablet=enh.enheder.length>1 && enh.enheder.some(function(e){ return e.niveauer.length===1; }) && Object.keys(niveauer).length>1;
    var faelles=ids.some(function(id){ return info[id].faelles; });
    if(n>=2&&(faelles||stablet)) return bt('etagebolig', n+' enheder'+(faelles ? ' med fælles trappe eller gang' : ' på flere etager'), true);
    if(n>=2) return bt('raekkehus', n+' enheder side om side uden fælles rum', true);
    if(n===1) return null;                                                     // én bolig: der er ingen skel at regne, og bygningstypen er brugerens
    return bt('etagebolig', 'boligrum på flere etager; enhederne kan ikke ses af dørene', false);
  }

  /* ---------- 3. Relevans ---------- */
  var GRUPPER={
    skel_enhed:{navn:'Vægge mellem enheder', med:true, hvorfor:'Luftlyd mod rum uden for boligen', kilde:'DS 490:2018 tabel 1'},
    skel_faelles:{navn:'Vægge mod fælles rum', med:true, hvorfor:'Luftlyd mod trappe, gang og andre fællesrum', kilde:'DS 490:2018 tabel 1'},
    skel_rum:{navn:'Vægge mellem rum', med:true, hvorfor:'Luftlyd mellem rum efter bygningstypens krav', kilde:'lydkrav.json'},
    skel_ukendt:{navn:'Vægge mellem rum, enhed ikke afklaret', med:true, hvorfor:'Regnes som skel, indtil enhederne er afklaret', kilde:'Rummenes døre mangler i eksporten'},
    facade:{navn:'Facadevægge mod det fri', med:true, hvorfor:'Støj udefra', kilde:'DS 490:2018 tabel 5'},
    facade_aabning:{navn:'Vinduer og døre i facaden', med:true, hvorfor:'Indgår i facadens samlede lydisolation', kilde:'DS 490:2018 tabel 5'},
    doer_faelles:{navn:'Døre mod fælles rum', med:true, hvorfor:'Eget krav til døren', kilde:'DS 490:2018 tabel 1'},
    daek_enhed:{navn:'Dæk mellem enheder', med:true, hvorfor:'Luftlyd og trinlyd', kilde:'DS 490:2018 tabel 1 og 2'},
    daek_faelles:{navn:'Dæk mod fælles rum', med:true, hvorfor:'Luftlyd og trinlyd', kilde:'DS 490:2018 tabel 1 og 2'},
    daek_rum:{navn:'Dæk mellem rum', med:true, hvorfor:'Luftlyd og trinlyd efter bygningstypens krav', kilde:'lydkrav.json'},
    daek_ukendt:{navn:'Dæk mellem rum, enhed ikke afklaret', med:true, hvorfor:'Regnes som skel, indtil enhederne er afklaret', kilde:'Rummenes døre mangler i eksporten'},
    indvendig:{navn:'Vægge inden for samme enhed', med:false, hvorfor:'Der stilles ikke krav inden for samme bolig', kilde:'DS 490:2018 tabel 1'},
    daek_indvendig:{navn:'Dæk inden for samme enhed', med:false, hvorfor:'Der stilles ikke krav inden for samme bolig', kilde:'DS 490:2018 tabel 1 og 2'},
    doer_indvendig:{navn:'Indvendige døre', med:false, hvorfor:'Ligger inden for samme enhed; ingen skelkrav', kilde:'DS 490:2018 tabel 1'},
    aabning_indvendig:{navn:'Vinduer i indervægge', med:false, hvorfor:'Ikke en del af facaden', kilde:'Placeringen'},
    mod_jord:{navn:'Vægge og dæk mod jord', med:false, hvorfor:'Ingen rum eller støj udefra på den anden side', kilde:'Placeringen'},
    daek_uden_rum:{navn:'Dæk uden rum på begge sider', med:false, hvorfor:'Fx terrændæk: der er intet naborum at regne mod', kilde:'Placeringen'},
    uden_rum:{navn:'Vægge uden rum i eksporten', med:false, hvorfor:'Væggen afgrænser ikke et rum, så den har ingen lydrolle', kilde:'Placeringen'},
    ukendt_side:{navn:'Vægge med ét rum og ukendt modside', med:false, hvorfor:'Revit siger ikke, hvad der er på den anden side. Ret væggens type, eller placér rummet', kilde:'Placeringen'},
    nedrevet:{navn:'Nedrevne bygningsdele', med:false, hvorfor:'Findes ikke i den færdige bygning', kilde:'Revits faser'},
    tag:{navn:'Tage', med:false, hvorfor:'Den forenklede facademodel regner kun facadevægge og deres åbninger', kilde:'lyd-12354.js (DS/EN ISO 12354-3, forenklet)'},
    soejle:{navn:'Søjler', med:false, hvorfor:'Punktformet element uden skilleflade; lyden går gennem vægge og dæk omkring den', kilde:'DS/EN ISO 12354-1 (regner på skillende flader)'},
    bjaelke:{navn:'Bjælker', med:false, hvorfor:'Linjeelement uden skilleflade; indgår i dækket eller væggen', kilde:'DS/EN ISO 12354-1 (regner på skillende flader)'},
    trappe:{navn:'Trapper', med:false, hvorfor:'Selve trappen skiller ikke rum. Trinlyd fra fælles trappe vurderes i naborummet', kilde:'DS 490:2018 tabel 2'},
    rampe:{navn:'Ramper', med:false, hvorfor:'Skiller ikke rum', kilde:'Placeringen'},
    raekvaerk:{navn:'Rækværk', med:false, hvorfor:'Skiller ikke rum', kilde:'Placeringen'},
    fundament:{navn:'Fundamenter', med:false, hvorfor:'Under terræn; ingen rum på den anden side', kilde:'Placeringen'},
    loft:{navn:'Lofter', med:false, hvorfor:'Indgår først, når loftets forbedring er dokumenteret på dækket', kilde:'ISSANA_CalculationEngine: acoustics.impact.direct_floor_with_covering (uden nedhængt loft)'},
    glasfacade:{navn:'Glasfacadepaneler', med:false, hvorfor:'Regnes med facadevæggen; paneler har ingen egen lydværdi i eksporten', kilde:'Placeringen'},
    andet:{navn:'Andre bygningsdele', med:false, hvorfor:'Har ingen rolle som skillende flade', kilde:'Placeringen'}
  };
  var KAT_GRUPPE={'Søjler':'soejle','Bjælker':'bjaelke','Trapper':'trappe','Ramper':'rampe','Rækværk':'raekvaerk','Fundamenter':'fundament','Lofter':'loft','Glasfacader':'glasfacade','Tage':'tag'};

  function rolleFraRelationer(rel, praefiks, inde){
    var har=function(x){ return rel.indexOf(x)>=0; };
    if(har('anden_enhed')) return praefiks+'_enhed';
    if(har('mod_faelles')) return praefiks+'_faelles';
    if(har('ukendt')) return praefiks+'_ukendt';
    if(har('rum_mod_rum')) return praefiks+'_rum';
    return rel.length ? inde : null;
  }
  function gruppeFor(e, d, an){
    var kat=e.category;
    if(d&&d.udenfor==='nedrevet') return 'nedrevet';
    if(KAT_GRUPPE[kat]) return KAT_GRUPPE[kat];
    if(kat==='Vægge'||kat==='Gulve'){
      var vaeg=kat==='Vægge', rel=d&&d.par ? d.par.map(function(p){ return an.relation(p.aRumId,p.bRumId); }) : [];
      var g=rolleFraRelationer(rel, vaeg ? 'skel' : 'daek', vaeg ? 'indvendig' : 'daek_indvendig');
      if(g) return g;
      if(d&&d.mod==='jord') return 'mod_jord';
      if(d&&d.mod==='det_fri') return vaeg ? 'facade' : 'daek_uden_rum';
      if(d&&d.mod==='ukendt'&&vaeg) return 'ukendt_side';
      return vaeg ? 'uden_rum' : 'daek_uden_rum';
    }
    if(kat==='Vinduer'||kat==='Døre'){
      var host=e.hostId!=null ? an.dele[String(e.hostId)] : null, facade=!!(host&&host.mod==='det_fri');
      if(kat==='Døre'&&Array.isArray(e.rum)&&e.rum.length===2){ var r=an.relation(e.rum[0],e.rum[1]); if(r==='mod_faelles') return 'doer_faelles'; if(!facade) return 'doer_indvendig'; }
      if(facade) return 'facade_aabning';
      return kat==='Døre' ? 'doer_indvendig' : 'aabning_indvendig';
    }
    return 'andet';
  }
  function relevans(ix, an){
    var ud={}, antalMed=0, antalIkke=0;
    Object.keys(ix.els).forEach(function(k){
      var e=ix.els[k], g=gruppeFor(e, an.dele[k], an), def=GRUPPER[g]||GRUPPER.andet, r=ud[g]||(ud[g]={id:g, navn:def.navn, med:def.med, hvorfor:def.hvorfor, kilde:def.kilde, antal:0, ids:[]});
      r.antal++; r.ids.push(e.id); if(def.med) antalMed++; else antalIkke++;
      if(an.dele[k]) an.dele[k].gruppe=g;
    });
    var liste=Object.keys(ud).map(function(k){ return ud[k]; }).sort(function(a,b){ return (b.med-a.med)||(b.antal-a.antal)||a.navn.localeCompare(b.navn,'da'); });
    return {grupper:liste, antalMed:antalMed, antalIkke:antalIkke};
  }

  /* ---------- 4. Forslag til ændringslisten ---------- */
  var FORUDSAETNINGER=[
    {noegle:'udenFlanker', vaerdi:true, hvorfor:'Kun den direkte vej regnes; resultatet mærkes «med forbehold»', kilde:'Som BygFys (GENNEMGANG-lyd-beregning.md, punkt 7)'},
    {noegle:'brugSkoen', vaerdi:true, hvorfor:'Rw og Ln,w skønnes ud fra lagene, hvor der ikke er dokumentation', kilde:'ISSANA_CalculationEngine: acoustics.mass_law.single_leaf_rw og acoustics.impact.homogeneous_floor_equivalent'},
    {noegle:'trinK', vaerdi:2, hvorfor:'Fast flanketillæg, typisk 0 til 4 dB i tungt byggeri', kilde:'BygFys, beregnTrinlyd i 05-beregningskerne.js'},
    {noegle:'trinDeltaLw', vaerdi:0, hvorfor:'Ingen trinlydforbedring, før gulvsystemet er dokumenteret', kilde:'ISSANA_CalculationEngine: acoustics.impact.direct_floor_with_covering'},
    {noegle:'deltaLfs', vaerdi:0, hvorfor:'Plan facade uden altaner', kilde:'DS/EN ISO 12354-3, forenklet (lyd-12354.js: 0 er gyldigt for en plan facade)'}
  ];
  function kravFraVurdering(v){
    var ud={};
    function tag(noegle, krav, gaelder){ if(krav&&krav.vaerdi!=null&&!krav.egetMaal&&!ud[noegle]) ud[noegle]={stoerrelse:krav.stoerrelse, vaerdi:krav.vaerdi, enhed:krav.enhed, retning:krav.retning, kilde:krav.kilde, status:krav.status, gaelder:gaelder}; }
    (v.dele.luftlyd.dele||[]).forEach(function(p){ if(p.krav&&p.status!=='ikke_relevant') tag(p.krav.type, p.krav, p.doer ? 'dør mod fælles rum' : (p.relation==='mod_faelles' ? 'mod fælles rum' : 'mod anden enhed')); });
    (v.dele.trinlyd.dele||[]).forEach(function(p){ if(p.krav) tag(p.krav.type, p.krav, 'fra '+p.fra); });
    ['facade','efterklang','installation'].forEach(function(k){ var x=v.dele[k]; if(x.status!=='ikke_relevant') tag(k, x.krav, 'i rummet'); });
    return ud;
  }
  function forslag(ix, an, t, bt){
    var ud=[];
    ix.rum.forEach(function(r){
      var x=an.rum[String(r.id)];
      if(!x.rumbrug && x.rfId && t.rumfunktioner[x.rfId]){
        ud.push({type:'rumbrug', rumId:r.id, rumfunktion:x.rfId, rumbrug:t.rumfunktioner[x.rfId].rumbrug, navn:t.rumfunktioner[x.rfId].navn,
          begrundelse:x.rfKilde==='rumnavn' ? 'Rumnavnet «'+(r.name||'')+'» indeholder «'+x.ord+'»' : 'Valgt i Lyd-fanen', kilde:x.rfKilde==='rumnavn' ? 'lydkrav.json, rumnavnMoenstre' : 'Lyd-fanen', sikker:true});
      }
      var v=bt&&x.rfId ? K.vurderRum(r, ix, bt, {analyse:an, rumfunktion:x.rfId, tabel:t}) : null, krav=v ? kravFraVurdering(v) : {};
      var lyd={placering:{enhed:x.enhed, faelles:x.faelles, grundlag:x.enhed ? x.enhedKilde : (x.faelles ? (x.faellesGrund||'rumnavnet') : 'ikke afklaret'), sikker:x.sikker, kilde:'analyse'}};
      if(Object.keys(krav).length) lyd.krav=krav;
      if(x.enhed||x.faelles||lyd.krav) ud.push({type:'data', rumId:r.id, lyd:lyd, begrundelse:(x.enhed ? x.enhed : (x.faelles ? 'Fælles rum' : 'Enhed ikke afklaret'))+(lyd.krav ? ', '+Object.keys(krav).length+' krav' : ''), kilde:'Placering og lydkrav.json', sikker:x.sikker});
    });
    return ud;
  }

  /* ---------- Samlet analyse ---------- */
  function analyser(model, valg){
    valg=valg||{};
    var t=valg.tabel||(K&&K.tabel())||null, ix=K.lavIndeks(model), info=rumInfo(ix,t,valg.rumfunktioner,valg.bruger);
    var pl=placeringAf(model,ix,valg);
    Object.keys(pl.ude).forEach(function(id){ if(info[id]) info[id].ude=true; });  // gårdrum og terrasser er ikke rum i lydens forstand
    var enh=findEnheder(ix,info);
    var btForslag=foreslaaBygningstype(info,enh,t,ix), btId=valg.bygningstype||(btForslag ? btForslag.id : null);
    var def=t&&btId ? t.bygningstyper[btId] : null, brugEnheder=!def||!!def.brugEnheder;
    function relation(aId,bId){
      var a=info[String(aId)], b=info[String(bId)];
      if(!a||!b) return 'ukendt';
      if(!brugEnheder) return 'rum_mod_rum';
      if(a.faelles&&b.faelles) return 'faelles_faelles';
      if(a.faelles||b.faelles) return 'mod_faelles';
      if(a.enhed&&b.enhed) return a.enhed===b.enhed ? 'samme_enhed' : 'anden_enhed';
      return 'ukendt';
    }
    var an={dele:pl.dele, rum:info, relation:relation, parFor:{}, overFor:{}, doerFor:{}, enheder:enh.enheder, harDoerdata:enh.harDoerdata, brugEnheder:brugEnheder, placeringKilde:pl.kilde, bygningstype:btForslag};
    Object.keys(pl.dele).forEach(function(k){
      var d=pl.dele[k]; if(d.kategori!=='Vægge'&&d.kategori!=='Gulve') return;
      (d.par||[]).forEach(function(p){
        [[p.aRumId,p.bRumId],[p.bRumId,p.aRumId]].forEach(function(s){
          var fra=String(s[0]), nabo=info[String(s[1])]; if(!info[fra]||!nabo) return;
          (an.parFor[fra]||(an.parFor[fra]=[])).push({delId:d.id, nabo:nabo.r, areal:erTal(p.areal) ? p.areal : Infinity, relation:relation(s[0],s[1])});
        });
        if(d.kategori==='Gulve'&&info[String(p.aRumId)]&&info[String(p.bRumId)]){
          var l=an.overFor[String(p.bRumId)]||(an.overFor[String(p.bRumId)]=[]), x=l.filter(function(y){ return y.delId===d.id; })[0];
          if(!x){ x={delId:d.id, over:[]}; l.push(x); }
          if(x.over.indexOf(p.aRumId)<0) x.over.push(p.aRumId);
        }
      });
    });
    enh.doere.forEach(function(d){
      if(relation(d.a,d.b)!=='mod_faelles') return;
      var bolig=info[d.a].faelles ? d.b : d.a, f=info[d.a].faelles ? d.a : d.b;
      (an.doerFor[bolig]||(an.doerFor[bolig]=[])).push({id:d.id, fra:info[f].navn});
    });
    an.relevans=relevans(ix,an);
    an.forudsaetninger=klon(FORUDSAETNINGER);
    an.forslag=t ? forslag(ix,an,t,btId) : [];
    var uden=Object.keys(info).filter(function(id){ return !info[id].rfId&&!info[id].ude; }).map(function(id){ return info[id].navn; });
    var ukEnhed=Object.keys(info).filter(function(id){ var x=info[id]; return !x.faelles&&!x.enhed&&!x.ude&&x.rfId&&x.rfId!=='teknikrum'&&x.rfId!=='depot'; }).map(function(id){ return info[id].navn; });
    an.uafklaret=[];
    if(uden.length) an.uafklaret.push('Rumfunktion ikke fundet for '+uden.length+' rum: '+uden.slice(0,6).join(', ')+(uden.length>6 ? ', …' : ''));
    if(!enh.harDoerdata) an.uafklaret.push('Eksporten har ingen døre mellem rum, så enhederne kan ikke findes; væggene regnes som skel');
    else if(ukEnhed.length) an.uafklaret.push('Enhed ikke fundet for '+ukEnhed.length+' rum uden døre: '+ukEnhed.slice(0,6).join(', ')+(ukEnhed.length>6 ? ', …' : ''));
    if(pl.kilde==='graenser') an.uafklaret.push('Det fælles placeringsmodul er ikke indlæst; hvilken side en væg vender, kan ikke ses');
    var usikre=Object.keys(pl.dele).filter(function(k){ var d=pl.dele[k]; return (d.kategori==='Vægge'||d.kategori==='Gulve')&&!d.sikker; }).length;
    if(pl.kilde==='modul'&&usikre) an.uafklaret.push(usikre+' vægge og dæk har en usikker placering; de står under «Bygningsdele i beregningen»');
    if(!btId) an.uafklaret.push('Bygningstypen kan ikke afgøres ud fra rummene; vælg den øverst');
    return an;
  }

  return {analyser:analyser, GRUPPER:GRUPPER, FORUDSAETNINGER:FORUDSAETNINGER};
});
