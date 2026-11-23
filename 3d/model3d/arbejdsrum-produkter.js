/* ISSANA 3D, arbejdsrummet: fanen Produkter.
   Fra generisk til konkret: et produktbibliotek (issana-produkter/1, JSON eller CSV, som I selv udfylder; skabelon i
   docs/issana-mcp/produktbibliotek-skabelon.csv) indlæses her. For det valgte elements type foreslås produkter, der har
   DOKUMENTEREDE værdier, som kan holdes op mod målet (produkter.js). «Knyt til typen» lægger produktet i typens datapost
   gennem ændringslisten; produktets lyd- og brandværdier overtages kun, hvis du vælger det, og med produktets kilde.
   LCA summeres HOLDT ADSKILT pr. handlingsstatus; totalen tæller kun de statusser, du selv vælger (aldrig hele bygningen
   som om alt udskiftes). Idéfase bruger den generiske CO₂ fra ISSANA Konstruktion-data, projektforslag de knyttede produkter.
   VEJLEDENDE, IKKE ISSANA LCA: summen her (produkter.js lcaSum) er en produktsammenligning pr. handlingsstatus, som ISSANA LCA ikke
   har; BR18-tallet regnes kun af ISSANA LCA's Rust-kerne i LCA-fanen (docs/issana-mcp/LCA-MOTOR-3.0.md). */
(function(){
  "use strict";
  var A=window.IssanaArbejdsrum, P=window.IssanaProdukter;
  if(!A||!P) return;
  var esc=A.esc, fmt=A.fmt;
  var NOEGLE='issana-produkter-v1', bibliotek=null, indlaesning=null;
  var KAT={'Vægge':'vaeg','Gulve':'daek','Tage':'tag','Vinduer':'vindue','Døre':'dor'};
  var valg={fase:'projekt',moduler:{A1A3:true,C1C4:true},medtag:{},sorter:'co2'};

  function hentGemt(){
    if(bibliotek) return bibliotek;
    try{ var t=localStorage.getItem(NOEGLE); if(t){ var r=P.indlaesJson(t); bibliotek=r.bibliotek; } }catch(e){}
    return bibliotek;
  }
  function produktAf(id){ var b=hentGemt(); if(!b||!id) return null; for(var i=0;i<b.produkter.length;i++) if(b.produkter[i].id===id) return b.produkter[i]; return null; }
  function produktFor(info){
    var p=info.data&&info.data.produkt, prod=p&&p.id? produktAf(p.id) : null;
    if(prod) return prod;
    // 3.0: CO₂ bekræftet i typens datapost (AI-feltets saet_lca, felt lca) i samme form som et produkts lca → regnes som produkt uden bibliotek.
    var l=info.data&&info.data.lca;
    if(l&&l.gwp&&l.enhed&&l.status!=='proposed') return {id:l.produktId||'datapost',navn:l.produktNavn||('LCA fra dataposten'+(l.kilde?' ('+l.kilde+')':'')),lca:{enhed:l.enhed,gwp:l.gwp,epd:l.epd||{kilde:l.kilde||null}},eksempel:!!l.eksempel};
    return null;
  }
  // Idéfase: generisk CO₂ pr. m² = koblet ISSANA-data (suite.co2), ellers det tal dataposten bærer (lca.co2PrM2, fx fra «issana-konstruktion»).
  function co2Generisk(i){ var s=i.ed.suite&&typeof i.ed.suite.co2==='number'? i.ed.suite.co2 : null; if(s!=null) return s; var l=i.data&&i.data.lca; return l&&typeof l.co2PrM2==='number'&&l.status!=='proposed'? l.co2PrM2 : null; }

  function indlaesFil(fil,el){
    var r=new FileReader();
    r.onload=function(){
      var tekst=String(r.result||''), res=/\.csv$/i.test(fil.name)? P.indlaesCsv(tekst,{navn:fil.name}) : P.indlaesJson(tekst);
      indlaesning={fil:fil.name,fejl:res.fejl||[],advarsler:res.advarsler||[]};
      if(res.bibliotek&&res.bibliotek.produkter&&res.bibliotek.produkter.length){
        bibliotek=res.bibliotek; try{ localStorage.setItem(NOEGLE,JSON.stringify(bibliotek)); }catch(e){ A.V().fejl('Biblioteket er for stort til at blive husket mellem sessioner; det virker indtil siden lukkes.'); }
      }
      render(el);
    };
    r.readAsText(fil,'utf-8');
  }

  function forslagHtml(info){
    var b=hentGemt(); if(!b) return '';
    var kat=KAT[info.ed.category]; if(!kat) return '<div class="arb-hint">Produktforslag findes for vægge, dæk, tage, vinduer og døre.</div>';
    var l=(info.data&&info.data.lyd)||{}, maalLyd=l.maal&&l.maal.vaerdi!=null&&/^Rw|^Ln/.test(l.maal.stoerrelse||'')? l.maal : null;
    var rwKrav=document.getElementById('prRw'), uKrav=document.getElementById('prU');
    var rw=rwKrav&&rwKrav.value!==''? A.tal(rwKrav.value) : (maalLyd? maalLyd.vaerdi : null), u=uKrav&&uKrav.value!==''? A.tal(uKrav.value) : null;
    var maal={}; if(rw!=null) maal.lyd={stoerrelse:(maalLyd&&maalLyd.stoerrelse)||'Rw',vaerdi:rw,retning:/^L/.test((maalLyd&&maalLyd.stoerrelse)||'')?'max':'min'}; if(u!=null) maal.uVaerdi={vaerdi:u,retning:'max'};
    var f=P.foreslaa({bibliotek:b,kategori:kat,maal:maal,sorter:valg.sorter,antal:3});
    var h='';
    (f.forslag||[]).forEach(function(x){
      h+='<div class="arb-aendr"><b>'+x.rang+'. '+esc(x.navn)+'</b>'+(x.eksempel?' <span class="arb-kilde">eksempel</span>':'')+
        '<div class="arb-n">'+(x.sammenligning||[]).map(function(s){ return esc(s.tekst); }).join(' · ')+
        (x.co2&&x.co2.vaerdi!=null? ' · CO₂ '+fmt(x.co2.vaerdi,1)+' '+esc(x.co2.enhedTekst||'') : '')+
        (x.pris&&x.pris.beloeb!=null? ' · '+fmt(x.pris.beloeb,0)+' '+esc(x.pris.valuta||'')+'/'+esc(x.pris.enhed||'') : '')+'</div>'+
        '<div class="arb-row"><button class="tbtn" data-knyt="'+esc(x.id)+'">Knyt til typen</button><button class="tbtn" data-knyt="'+esc(x.id)+'" data-overtag="1">Knyt og brug produktets lyd og brand</button></div></div>';
    });
    if(!(f.forslag||[]).length) h+='<div class="arb-hint">Ingen produkter i biblioteket har dokumenterede værdier, der kan holdes op mod målet.</div>';
    if((f.udeladt||[]).length) h+='<details class="arb-lag"><summary>Udeladt ('+f.udeladt.length+')</summary>'+f.udeladt.map(function(u){ return '<div class="arb-n">'+esc(u.navn||u.id)+': '+esc(u.grund)+'</div>'; }).join('')+'</details>';
    (f.fejl||[]).forEach(function(x){ h+='<div class="arb-hint issana-mangler">'+esc(x.tekst||x)+'</div>'; });
    [].concat(f.forbehold||[]).forEach(function(t){ h+='<div class="arb-note">'+esc(t)+'</div>'; });
    return h;
  }

  function knyt(info,id,overtag){
    var p=produktAf(id); if(!p) return;
    if(!info.type||!info.type.uniqueId){ A.V().fejl('Elementet har ingen type at knytte produktet til.'); return; }
    var m=A.maal(info,'type'), rec=A.dataFor(m), b=hentGemt();
    rec.produkt={id:p.id,navn:p.navn,bibliotek:(b&&b.navn)||null,valgt:new Date().toISOString().slice(0,10),eksempel:!!p.eksempel};
    if(overtag){
      if(p.lyd&&p.lyd.Rw!=null&&p.lyd.kilde){ rec.lyd=rec.lyd||{}; rec.lyd.dokumenteret={stoerrelse:'Rw',vaerdi:p.lyd.Rw,Ctr:p.lyd.Ctr!=null?p.lyd.Ctr:null,enhed:'dB',metode:p.lyd.metode||null,kilde:p.lyd.kilde+' (produkt '+p.id+')'}; }
      if(p.lyd&&p.lyd.Lnw!=null&&p.lyd.kilde&&!(p.lyd.Rw!=null)){ rec.lyd=rec.lyd||{}; rec.lyd.dokumenteret={stoerrelse:'Ln,w',vaerdi:p.lyd.Lnw,enhed:'dB',metode:p.lyd.metode||null,kilde:p.lyd.kilde+' (produkt '+p.id+')'}; }
      if(p.brand&&p.brand.klasse&&p.brand.kilde){ rec.brand=rec.brand||{}; rec.brand.dokumenteret={klasse:p.brand.klasse,kilde:p.brand.kilde+' (produkt '+p.id+')'}; }
    }
    A.gemData(m,rec,'produkt');
    A.V().info('Produktet er lagt i ændringslisten for typen «'+(info.type.name||'')+'». Gem i Revit, når du er klar.');
    A.visFane('aendringer');
  }

  function lca(){
    var dele=A.infos.filter(function(i){ return i&&!i.erRum&&KAT[i.ed.category]; });
    var moduler=Object.keys(valg.moduler).filter(function(k){ return valg.moduler[k]; });
    var medtag=Object.keys(valg.medtag).filter(function(k){ return valg.medtag[k]; });
    if(valg.fase==='ide'){
      // Generisk: CO₂ pr. m² fra ISSANA Konstruktion-data (ed.suite.co2) × areal, holdt adskilt pr. status.
      var pr={}, total=0, med=0;
      dele.forEach(function(i){ var s=pr[i.status]||(pr[i.status]={kg:0,n:0,uden:0});
        s.n++; var co2=co2Generisk(i);
        if(co2==null||typeof i.ed.area!=='number'){ s.uden++; return; } s.kg+=co2*i.ed.area; });
      Object.keys(pr).forEach(function(k){ if(medtag.indexOf(k)>=0){ total+=pr[k].kg; med++; } });
      return {ide:true,pr:pr,total:med?total:null};
    }
    var b=hentGemt();
    return P.lcaSum({elementer:dele.map(function(i){ return {id:i.ed.id,handlingsstatus:i.status,produkt:produktFor(i),maengde:{areal:i.ed.area,volumen:i.ed.volume,antal:1}}; }),
      moduler:moduler,medtagStatus:medtag.length? medtag : undefined,bibliotek:b});
  }

  function lcaHtml(){
    var r=lca(), h='<div class="arb-sek">LCA pr. handlingsstatus · vejledende, ikke ISSANA LCA</div>';
    h+='<div class="arb-grid"><label class="arb-felt"><span>Fase</span><select id="prFase" class="arb-in"><option value="ide"'+(valg.fase==='ide'?' selected':'')+'>Idéfase: generisk (ISSANA Konstruktion-data)</option><option value="projekt"'+(valg.fase==='projekt'?' selected':'')+'>Projektforslag: knyttede produkter</option></select></label></div>';
    if(valg.fase==='projekt') h+='<div class="arb-row">'+['A1A3','A4','A5','B4','C1C4'].map(function(m){ return '<label class="arb-chk"><input type="checkbox" data-modul="'+m+'"'+(valg.moduler[m]?' checked':'')+'> '+m.replace(/(\w)(\d)(\w)(\d)/,'$1$2-$3$4')+'</label>'; }).join('')+'</div>';
    h+='<table class="arb-tab"><thead><tr><th>Medtag</th><th>Handlingsstatus</th><th>Elementer</th><th>kg CO₂e</th><th>Ikke beregnet</th></tr></thead><tbody>';
    var statusser=A.HANDLING.map(function(x){ return x.v; }).concat([A.UNSET]);
    statusser.forEach(function(s){
      var x=r.ide? r.pr[s] : r.prStatus&&r.prStatus[s]; if(!x) return;
      var n=r.ide? x.n : x.antalElementer; if(!n) return;
      var kg=r.ide? x.kg : x.kgCO2e, ikke=r.ide? x.uden : (x.antalIkkeBeregnet!=null? x.antalIkkeBeregnet : 0);
      var hvorfor=r.ide? '' : [x.antalUdenProdukt?x.antalUdenProdukt+' uden produkt':'',x.antalUdenMaengde?x.antalUdenMaengde+' uden mængde':'',x.antalManglerLcaData?x.antalManglerLcaData+' uden LCA-data':''].filter(Boolean).join(', ');
      h+='<tr><td><input type="checkbox" data-medtag="'+s+'"'+(valg.medtag[s]?' checked':'')+'></td><td>'+esc(A.handlingTekst(s))+'</td><td>'+n+'</td><td>'+(kg==null?'–':fmt(kg,0))+'</td><td>'+(ikke?ikke+(hvorfor?' ('+esc(hvorfor)+')':''):'')+'</td></tr>';
    });
    var tot=r.ide? r.total : (r.total&&r.total.kgCO2e);
    h+='</tbody></table><div class="arb-row"><span class="arb-tal">I alt for de valgte statusser: '+(tot==null? 'vælg mindst én status (eller noget mangler)' : fmt(tot,0)+' kg CO₂e')+'</span><button class="tbtn" id="prCsv">CSV</button></div>';
    if(!r.ide&&r.total&&r.total.komplet===false) h+='<div class="arb-hint">Totalen er ikke komplet: nogle elementer i de valgte statusser er ikke beregnet. Se kolonnen «Ikke beregnet».</div>';
    h+='<div class="arb-note">Summerne holdes adskilt pr. handlingsstatus. Modul D tælles aldrig med i totalen. Vejledende produktsammenligning til renovering (handlingsstatus), ikke ISSANA LCA: BR18-beregningen sker kun i LCA-fanen (ISSANA LCA\'s Rust-kerne).</div>';
    return {html:h,r:r};
  }

  function render(el){
    var V=A.V(); if(!A.infos.length){ el.innerHTML='<div class="arb-tom">Hent modellen fra Revit først.</div>'; return; }
    var b=hentGemt();
    var h='<div class="arb-sek">Produktbibliotek</div>';
    h+=b? '<div class="arb-hint"><b>'+esc(b.navn||'Bibliotek')+'</b>: '+b.produkter.length+' produkter'+(b.produkter.some(function(p){ return p.eksempel; })?' (indeholder eksempler, ikke rigtige data)':'')+'.</div>' : '<div class="arb-hint">Intet bibliotek indlæst. Indlæs jeres produktdata som JSON eller CSV (skabelonen ligger i docs/issana-mcp/produktbibliotek-skabelon.csv).</div>';
    h+='<div class="arb-row"><button class="tbtn" id="prIndlaes">Indlæs fil…</button>'+(b?'<button class="tbtn" id="prGlem">Glem biblioteket</button>':'')+'<input type="file" id="prFil" accept=".json,.csv" hidden></div>';
    if(indlaesning){ h+='<div class="arb-hint">'+esc(indlaesning.fil)+': '+indlaesning.fejl.length+' fejl, '+indlaesning.advarsler.length+' advarsler.</div>';
      if(indlaesning.fejl.length) h+='<details class="arb-lag"><summary>Fejl</summary>'+indlaesning.fejl.slice(0,40).map(function(f){ return '<div class="arb-n">Linje '+esc(f.linje)+': '+esc(f.tekst)+'</div>'; }).join('')+'</details>'; }
    if(b){ var vr=P.valider(b); if(vr.advarsler.length||vr.fejl.length) h+='<details class="arb-lag"><summary>Kontrol af biblioteket ('+(vr.fejl.length+vr.advarsler.length)+')</summary>'+vr.fejl.concat(vr.advarsler).slice(0,40).map(function(f){ return '<div class="arb-n">'+esc(f.id||'')+': '+esc(f.tekst)+'</div>'; }).join('')+'</details>'; }
    var valgte=V.valgte(), info=valgte.length===1? A.infos[valgte[0]] : null;
    h+='<div class="arb-sek">Det valgte</div>';
    if(!info||info.erRum) h+='<div class="arb-hint">Vælg én bygningsdel i 3D for at se og knytte produkter til dens type.</div>';
    else {
      var p=produktFor(info), pr=info.data&&info.data.produkt;
      h+='<div class="arb-hint"><b>'+esc(info.ed.type||info.ed.name||'')+'</b> ('+esc(info.ed.category)+'). '+(pr? 'Knyttet til «'+esc(pr.navn||pr.id)+'»'+(p?'':' (ikke i det indlæste bibliotek)') : 'Generisk: intet produkt knyttet.')+'</div>';
      if(b){
        h+='<div class="arb-grid"><label class="arb-felt"><span>Lydkrav Rw ≥ (dB)</span><input id="prRw" class="arb-in kort"></label><label class="arb-felt"><span>U ≤ (W/m²K)</span><input id="prU" class="arb-in kort"></label>'+
          '<label class="arb-felt"><span>Sortér efter</span><select id="prSort" class="arb-in"><option value="co2"'+(valg.sorter==='co2'?' selected':'')+'>CO₂</option><option value="pris"'+(valg.sorter==='pris'?' selected':'')+'>Pris</option><option value="lyd"'+(valg.sorter==='lyd'?' selected':'')+'>Lyd</option></select></label></div>'+
          '<div class="arb-row"><button class="tbtn primary" id="prForeslaa">Foreslå produkter</button></div><div id="prForslag"></div>';
      }
    }
    var l=lcaHtml(); h+=l.html;
    el.innerHTML=h;
    document.getElementById('prIndlaes').onclick=function(){ document.getElementById('prFil').click(); };
    document.getElementById('prFil').onchange=function(e){ if(e.target.files&&e.target.files[0]) indlaesFil(e.target.files[0],el); };
    var gl=document.getElementById('prGlem'); if(gl) gl.onclick=function(){ bibliotek=null; indlaesning=null; try{ localStorage.removeItem(NOEGLE); }catch(x){} render(el); };
    var fs=document.getElementById('prForeslaa'); if(fs) fs.onclick=function(){ valg.sorter=document.getElementById('prSort').value;
      var box=document.getElementById('prForslag'); box.innerHTML=forslagHtml(info);
      box.querySelectorAll('[data-knyt]').forEach(function(k){ k.onclick=function(){ knyt(info,k.getAttribute('data-knyt'),!!k.getAttribute('data-overtag')); }; }); };
    document.getElementById('prFase').onchange=function(e){ valg.fase=e.target.value; render(el); };
    el.querySelectorAll('[data-modul]').forEach(function(c){ c.onchange=function(){ valg.moduler[c.getAttribute('data-modul')]=c.checked; render(el); }; });
    el.querySelectorAll('[data-medtag]').forEach(function(c){ c.onchange=function(){ valg.medtag[c.getAttribute('data-medtag')]=c.checked; render(el); }; });
    document.getElementById('prCsv').onclick=function(){
      var r=l.r, rows=[['Handlingsstatus','Elementer','kg CO2e','Ikke beregnet','Medtaget i total']];
      A.HANDLING.map(function(x){ return x.v; }).concat([A.UNSET]).forEach(function(s){ var x=r.ide? r.pr[s] : r.prStatus&&r.prStatus[s]; if(!x) return; var n=r.ide? x.n : x.antalElementer; if(!n) return;
        rows.push([A.handlingTekst(s),n,r.ide? Math.round(x.kg) : (x.kgCO2e==null?'':Math.round(x.kgCO2e)),r.ide? x.uden : x.antalIkkeBeregnet,valg.medtag[s]?'ja':'nej']); });
      A.downloadCsv('ISSANA-LCA-pr-status.csv',rows); };
  }

  A.fane({id:'produkter',titel:'Produkter',bred:true,valg:true,render:render});
})();
