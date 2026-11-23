/* ISSANA 3D, arbejdsrummet: fanen Sol.
   Skygge for en valgt dato og et klokkeslæt ud fra projektets placering og sand nord (sol.js, NOAA's solberegning). Placering
   og sand nord læses fra Revit (Manage > Location); mangler de, skriver brugeren dem selv. Der bruges aldrig en
   standard-placering. Skyggen er en visning, ikke en dagslys- eller overophedningsberegning; resultatet viser altid sine
   input. Overophedning er en særskilt analyse: her vises kun mangellisten (overophedning.js); motoren er ikke bygget. */
(function(){
  "use strict";
  var A=window.IssanaArbejdsrum, S=window.IssanaSol, O=window.IssanaOverophedning;
  if(!A||!S) return;
  var esc=A.esc, fmt=A.fmt;
  var aktiv=false, gemtLys=null, sidste=null;

  function noegle(){ return 'issana-sol-'+A.modelNoegle(); }
  function indstillinger(){
    var d=(A.V().data()||{}).placering||null, g=null;
    try{ g=JSON.parse(localStorage.getItem(noegle())||'null'); }catch(e){}
    var nu=new Date(), dato=nu.getFullYear()+'-06-21';
    var r={breddegrad:d?d.breddegrad:null,laengdegrad:d?d.laengdegrad:null,tidszone:d?d.tidszone:null,sandNordVinkel:d?d.sandNordVinkel:null,
      stednavn:d?d.stednavn:null,fraRevit:!!d,dato:dato,minut:13*60,sommertid:true};
    if(g) for(var k in g) if(g[k]!==undefined&&g[k]!==null&&g[k]!=='') r[k]=g[k];
    return r;
  }
  function gem(i){ try{ localStorage.setItem(noegle(),JSON.stringify(i)); }catch(e){} }
  function klok(min){ var h=Math.floor(min/60), m=Math.round(min%60); return ('0'+h).slice(-2)+':'+('0'+m).slice(-2); }

  function anvend(i){
    var T=A.V().three(), V=A.V();
    var p={placering:{breddegrad:i.breddegrad,laengdegrad:i.laengdegrad,tidszone:i.tidszone==null?null:Number(i.tidszone)+(i.sommertid?1:0),sandNordVinkel:i.sandNordVinkel,stednavn:i.stednavn},
      dato:i.dato,klokkeslaet:klok(i.minut),geometri:A.synlige().length};
    var tjek=S.skyggeInput(p);
    if(!tjek.klar){ sidste={klar:false,mangler:tjek.mangler}; return sidste; }
    var pos=S.solposition({breddegrad:tjek.input.breddegrad,laengdegrad:tjek.input.laengdegrad,tidspunkt:tjek.input.tidspunkt});
    sidste={klar:true,input:tjek.input,sol:pos};
    if(!T.keyLight||!T.modelBox||T.modelBox.isEmpty()) return sidste;
    if(!gemtLys) gemtLys={pos:T.keyLight.position.clone(),intens:T.keyLight.intensity};
    if(pos.hoejde<=0){ T.keyLight.intensity=0; sidste.underHorisont=true; V.skygge(); return sidste; }
    var dir=S.solretning({azimut:pos.azimut,hoejde:pos.hoejde,sandNordVinkel:tjek.input.sandNordVinkel});
    var c=T.modelBox.getCenter(new T.THREE.Vector3()), d=T.modelBox.getSize(new T.THREE.Vector3()).length()||10;
    T.keyLight.position.set(c.x+dir[0]*d*1.4,c.y+dir[1]*d*1.4,c.z+dir[2]*d*1.4);
    T.keyLight.intensity=gemtLys.intens; T.keyLight.target.position.copy(c); T.keyLight.target.updateMatrixWorld();
    aktiv=true; V.skygge(); return sidste;
  }
  function stop(){
    var T=A.V().three(); if(gemtLys&&T.keyLight){ T.keyLight.position.copy(gemtLys.pos); T.keyLight.intensity=gemtLys.intens; }
    gemtLys=null; aktiv=false; A.V().skygge();
  }

  function overophedning(){
    if(!O) return '';
    var rum=A.infos.filter(function(i){ return i&&i.erRum; });
    var p={projekt:{},rum:rum.map(function(i){ var o=(i.data&&i.data.overophedning)||{};
      var vind=A.infos.filter(function(x){ return x&&x.ed.category==='Vinduer'&&Array.isArray(x.ed.rum)&&x.ed.rum.indexOf(i.ed.id)>=0; })
        .map(function(x){ var w=(x.data&&x.data.overophedning)||{}; return {areal:x.ed.area,orientering:w.orientering,glastype:w.glastype,gVaerdi:w.gVaerdi,solafskaermning:w.solafskaermning}; });
      return {id:i.ed.id,navn:i.ed.name,areal:i.ed.area,volumen:i.ed.volume,vinduer:vind,ventilation:o.ventilation,interneTilskud:o.interneTilskud,brugstid:o.brugstid,termiskMasse:o.termiskMasse}; })};
    var r=O.status(p), tael={};
    (r.mangler||[]).forEach(function(m){ var k=String(m.felt).replace(/\[\d+\]/g,'[]'); tael[k]=(tael[k]||0)+1; });
    var h='<div class="arb-sek">Overophedning</div><div class="arb-hint">'+esc(r.besked||'')+'</div>';
    h+='<div class="arb-hint">'+r.antalKlar+' af '+r.antalRum+' rum har alle input. Ingen input bliver gættet.</div>';
    var ks=Object.keys(tael).sort(function(a,b){ return tael[b]-tael[a]; }).slice(0,12);
    if(ks.length) h+='<table class="arb-tab"><thead><tr><th>Mangler</th><th>Antal</th></tr></thead><tbody>'+ks.map(function(k){ return '<tr><td>'+esc(k)+'</td><td>'+tael[k]+'</td></tr>'; }).join('')+'</tbody></table>';
    h+='<div class="arb-note">'+esc(O.MAERKAT)+'. Beregningsmotoren til overophedning er ikke bygget endnu.</div>';
    return h;
  }

  function render(el){
    var V=A.V(); if(!A.infos.length){ el.innerHTML='<div class="arb-tom">Hent modellen fra Revit først.</div>'; return; }
    var i=indstillinger();
    var forloeb=[]; try{ if(i.breddegrad!=null&&i.laengdegrad!=null&&i.tidszone!=null) forloeb=S.dagsforloeb({breddegrad:Number(i.breddegrad),laengdegrad:Number(i.laengdegrad),dato:i.dato,tidszone:Number(i.tidszone)+(i.sommertid?1:0),trinMinutter:30}); }catch(e){}
    var h='<div class="arb-sek">Placering</div><div class="arb-hint">'+(i.fraRevit? 'Fra Revit (Manage › Location)'+(i.stednavn?': '+esc(i.stednavn):'')+'. Du kan rette her.' : 'Revit har ingen placering. Skriv den selv; der bruges ingen standard.')+'</div>'+
      '<div class="arb-grid">'+
      '<label class="arb-felt"><span>Breddegrad °N</span><input id="solB" class="arb-in kort" value="'+(i.breddegrad==null?'':i.breddegrad)+'"></label>'+
      '<label class="arb-felt"><span>Længdegrad °Ø</span><input id="solL" class="arb-in kort" value="'+(i.laengdegrad==null?'':i.laengdegrad)+'"></label>'+
      '<label class="arb-felt"><span>Tidszone (UTC+)</span><input id="solTz" class="arb-in kort" value="'+(i.tidszone==null?'':i.tidszone)+'"></label>'+
      '<label class="arb-felt"><span>Sand nord °</span><input id="solN" class="arb-in kort" value="'+(i.sandNordVinkel==null?'':i.sandNordVinkel)+'" title="Revits vinkel fra projektnord til sand nord"></label></div>'+
      '<div class="arb-sek">Tidspunkt</div><div class="arb-grid">'+
      '<label class="arb-felt"><span>Dato</span><input id="solD" type="date" class="arb-in" value="'+esc(i.dato)+'"></label>'+
      '<label class="arb-felt"><span>Klokken</span><input id="solM" type="range" min="0" max="1439" step="10" value="'+i.minut+'"><b id="solMv">'+klok(i.minut)+'</b></label></div>'+
      '<label class="arb-chk"><input type="checkbox" id="solSt"'+(i.sommertid?' checked':'')+'> Sommertid (+1 time)</label>'+
      '<div class="arb-row"><button class="tbtn primary" id="solVis">'+(aktiv?'Opdater skyggen':'Vis skygge')+'</button><button class="tbtn" id="solStop"'+(aktiv?'':' disabled')+'>Normalt lys</button></div>';
    if(forloeb.length) h+='<div class="arb-hint">Sol op '+esc(forloeb[0].tid)+' · sol ned '+esc(forloeb[forloeb.length-1].tid)+'</div>';
    if(sidste){
      if(!sidste.klar) h+='<div class="arb-hint issana-mangler">Mangler: '+sidste.mangler.map(function(m){ return esc(m.tekst); }).join(' · ')+'</div>';
      else {
        h+='<div class="arb-sek">Resultat</div><div class="arb-aendr">Sol: azimut '+fmt(sidste.sol.azimut,1)+'° · højde '+fmt(sidste.sol.hoejde,1)+'°'+(sidste.underHorisont?' (under horisonten, ingen skygge)':'')+
          '<div class="arb-n">Input: '+esc(sidste.input.tidspunkt)+' · '+fmt(sidste.input.breddegrad,4)+'° N, '+fmt(sidste.input.laengdegrad,4)+'° Ø · sand nord '+fmt(sidste.input.sandNordVinkel,2)+'° · modeludsnit: '+A.synlige().length+' synlige elementer</div></div>'+
          '<div class="arb-note">Skyggevisning i 3D, ikke en dagslys- eller overophedningsberegning. Nabobygninger og terræn er kun med, hvis de er i modellen. Fortegnet for sand nord følger Revits ProjectPosition og er ikke kontrolleret mod en model med kendt sand nord endnu.</div>';
      }
    }
    h+=overophedning();
    el.innerHTML=h;
    var laes=function(){ var t=A.tal, n=indstillinger();
      n.breddegrad=t(document.getElementById('solB').value); n.laengdegrad=t(document.getElementById('solL').value);
      n.tidszone=t(document.getElementById('solTz').value); n.sandNordVinkel=t(document.getElementById('solN').value);
      n.dato=document.getElementById('solD').value; n.minut=Number(document.getElementById('solM').value); n.sommertid=document.getElementById('solSt').checked;
      var g={breddegrad:n.breddegrad,laengdegrad:n.laengdegrad,tidszone:n.tidszone,sandNordVinkel:n.sandNordVinkel,dato:n.dato,minut:n.minut,sommertid:n.sommertid};
      gem(g); n.stednavn=indstillinger().stednavn; return n; };
    document.getElementById('solM').oninput=function(e){ document.getElementById('solMv').textContent=klok(Number(e.target.value)); if(aktiv){ anvend(laes()); } };
    document.getElementById('solM').onchange=function(){ if(aktiv) render(el); };
    document.getElementById('solVis').onclick=function(){ anvend(laes()); render(el); };
    document.getElementById('solStop').onclick=function(){ stop(); sidste=null; render(el); };
    ['solB','solL','solTz','solN','solD','solSt'].forEach(function(id){ document.getElementById(id).onchange=function(){ var n=laes(); if(aktiv) anvend(n); render(el); }; });
  }

  A.fane({id:'sol',titel:'Sol',render:render,model:function(){ if(aktiv) stop(); sidste=null; }});
})();
