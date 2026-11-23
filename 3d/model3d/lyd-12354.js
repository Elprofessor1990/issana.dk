/* ISSANA – lydberegning efter DS/EN ISO 12354 (forenklede metoder) til 3D-visningen i Revit-pluginnet.
   Rent modul uden afhængigheder. Browser (WebView2): <script src="lyd-12354.js"> giver window.IssanaLyd.
   Node: module.exports (testene ligger i tests/web-model3d/lyd-12354.test.mjs).

   Dataprincipper (brugerens kravspec):
   1. Modulet udleder aldrig krav eller lydklasser. Brugeren angiver selv sit mål; sammenlign() er neutral.
   2. Manglende input gættes ikke og erstattes ikke af en standardværdi. null/undefined/'' = mangler,
      0 er gyldigt, hvor det giver fysisk mening (Rw, ΔR, Kij, K, ΔLw, ΔLfs, Ctr). Status bliver da
      "needs_input" med en liste mangler: [{felt, tekst}]. Delresultater med komplet input beregnes stadig.
   3. Alle resultater bærer metode, input (de brugte værdier), mellemregninger og forbehold.
   Der regnes uden afrunding; tal i output afrundes til 0,1 dB. */
(function(root, factory){
  "use strict";
  var api=factory();
  if(typeof module==='object' && module && module.exports) module.exports=api;   // Node
  else root.IssanaLyd=api;                                                       // browser
})(typeof self!=='undefined' ? self : this, function(){
  "use strict";

  /* ---------- Status og danske etiketter ---------- */
  var STATUS=Object.freeze({
    DOCUMENTED_AGAINST_TARGET:'documented_against_target',
    DIFFERENCE_FROM_TARGET:'difference_from_target',
    NEEDS_INPUT:'needs_input',
    NOT_REVIEWED:'not_reviewed',          // beregnet, men ikke sammenholdt med et mål
    NOT_APPLICABLE:'not_applicable'
  });
  var TEKST=Object.freeze({
    documented_against_target:'Dokumenteret mod mål',
    difference_from_target:'Forskel fra mål',
    needs_input:'Mangler input',
    not_reviewed:'Ikke kontrolleret',
    not_applicable:'Ikke relevant'
  });

  var METODE={
    luftlyd:'DS/EN ISO 12354-1:2017, forenklet model (afsnit 4.4)',
    trinlyd:'DS/EN ISO 12354-2:2017, forenklet model',
    facade:'DS/EN ISO 12354-3:2017, forenklet model (enkelttalsværdier)',
    installation:'Forenklet rumakustisk model (diffust lydfelt) efter principperne i DS/EN 12354-5; ikke standardens fulde metode',
    sammenlign:'Neutral sammenligning med brugerens eget mål'
  };

  var FB_BEREGNING='Beregnet med en forenklet model ud fra de angivne enkelttalsværdier. Resultatet er en beregning, ikke en målt værdi og ikke en myndighedsgodkendelse.';
  var FB_LAB='Laboratorieværdier (fx Rw, Ln,w og ΔLw) beskriver kun den prøvede konstruktion, ikke den færdige bygning. Udførelse, samlinger og utætheder kan give andre værdier i bygningen.';
  var FB_MAAL='Målet er angivet af brugeren. ISSANA udleder ikke krav eller lydklasser; sammenligningen beskriver kun forskellen mellem værdien og målet og er ikke en myndighedsvurdering.';

  var A0=10;        // referenceabsorptionsareal for små elementer, m² (12354-3)
  var L0=1;         // referencelængde for flankevejene, m (12354-1)
  var T0_REF=0.5;   // referenceefterklangstid, s (defineret i standarden, ikke et gæt)
  var VEJE=['Ff','Df','Fd'];

  /* ---------- Hjælpere ---------- */
  function erObjekt(v){ return v!==null && typeof v==='object' && !Array.isArray(v); }
  function erAngivet(v){ return v!==null && v!==undefined && v!==''; }
  function erTal(v){ return typeof v==='number' && isFinite(v); }
  function lg(x){ return Math.log(x)/Math.LN10; }
  function afrund(x){ if(!erTal(x)) return null; var r=Math.round(x*10)/10; return r===0 ? 0 : r; }   // 0,1 dB, aldrig -0
  function fmt(x, dec){                                                                              // dansk decimalkomma
    if(dec===undefined) dec=1;
    var f=Math.pow(10,dec), r=Math.round(x*f)/f; if(r===0) r=0;
    return r.toFixed(dec).replace('.',',');
  }
  function navnPaa(v, std){ return (typeof v==='string' && v.trim()) ? v.trim() : std; }
  function statusFor(mangler){ return mangler.length ? STATUS.NEEDS_INPUT : STATUS.NOT_REVIEWED; }

  // Læs et påkrævet tal. Mangler eller ugyldigt → post i mangler og null tilbage.
  // 0 er gyldigt, medmindre positiv er sand (areal, volumen, tid, længde).
  function talFelt(v, felt, navn, mangler, positiv, hjaelp){
    if(!erAngivet(v)){ mangler.push({felt:felt, tekst:navn+' mangler'+(hjaelp ? ' ('+hjaelp+')' : '')}); return null; }
    if(!erTal(v)){ mangler.push({felt:felt, tekst:navn+' er ikke et gyldigt tal'}); return null; }
    if(positiv && !(v>0)){ mangler.push({felt:felt, tekst:navn+' skal være større end 0'}); return null; }
    return v;
  }

  // T0 er standardens referenceværdi 0,5 s; er den udeladt, bruges den og dokumenteres i input.
  function refT0(v, input, mangler){
    if(v===undefined || v===null){ input.T0=T0_REF; input.T0_note='0,5 s (referenceværdi, ikke angivet)'; return T0_REF; }
    var t=talFelt(v,'T0','Referenceefterklangstiden T0',mangler,true); input.T0=t; return t;
  }

  /* ---------- 1. Luftlyd mellem rum, DS/EN ISO 12354-1 (forenklet) ----------
     R_ij,w = (R_i,w + R_j,w)/2 + ΔR_ij,w + K_ij + 10·lg(S_s/(l_0·l_f))
     R'w    = −10·lg(10^(−R_Dd,w/10) + Σ 10^(−R_ij,w/10))
     D'nT,w = R'w + 10·lg(0,16·V/(T0·S_s)) */

  // Værdi for én vej: et objekt {Ff:…, Df:…, Fd:…} slås op pr. vej; ét tal gælder kun, når posten har netop én vej.
  function forVej(v, vej, antal){
    if(erObjekt(v)) return {v:v[vej], felt:'.'+vej, tekst:' for vej '+vej};
    if(antal===1) return {v:v, felt:'', tekst:''};
    return null;
  }

  // ΔR_ij er valgfri: et udeladt felt regnes som 0 og dokumenteres; null/'' betyder ukendt og er et manglende input.
  function deltaR(v, felt, navn, mangler, inp){
    if(v===undefined){ inp.deltaR_ij=0; inp.deltaR_ij_note='0 (ikke angivet, ingen efterbeklædning)'; return 0; }
    if(!erAngivet(v)){ mangler.push({felt:felt, tekst:navn+' er angivet som ukendt (angiv 0, hvis der ingen efterbeklædning er, eller udelad feltet)'}); inp.deltaR_ij=null; return null; }
    var d=talFelt(v,felt,navn,mangler); inp.deltaR_ij=d; return d;
  }

  // Lav flankevejene for én post i p.flanker og læg dem i ud.
  // Returnerer false, hvis postens eget input er ufuldstændigt.
  function flankeveje(f, k, Rs, Ss, mangler, ud){
    var base='flanker['+k+']';
    if(!erObjekt(f)){ mangler.push({felt:base, tekst:'Flanke '+(k+1)+' er ikke angivet som et objekt'}); return false; }
    var navn=navnPaa(f.navn,'Flanke '+(k+1)), n0=mangler.length, j;
    var lf=talFelt(f.laengde, base+'.laengde', navn+': koblingslængden', mangler, true);

    // Form 1: én vej pr. post. Form 2: veje: ["Ff","Df","Fd"], hvor Rw_i = flankeelementet i senderummet (F),
    // Rw_j = flankeelementet i modtagerrummet (f), og skillevæggens Rw bruges som R_D/R_d.
    var liste=null;
    if(f.veje!==undefined && f.veje!==null){
      if(!Array.isArray(f.veje) || f.veje.length===0){
        mangler.push({felt:base+'.veje', tekst:navn+': veje skal være en liste med Ff, Df og/eller Fd'}); return false;
      }
      liste=[];
      for(j=0;j<f.veje.length;j++){
        var vj=f.veje[j];
        if(VEJE.indexOf(vj)<0){ mangler.push({felt:base+'.veje', tekst:navn+': vejen «'+vj+'» er ukendt (brug Ff, Df eller Fd)'}); return false; }
        if(liste.indexOf(vj)>=0){ mangler.push({felt:base+'.veje', tekst:navn+': vejen '+vj+' står der to gange'}); return false; }
        liste.push(vj);
      }
    }

    if(!liste){
      var inp={navn:navn, vej:(typeof f.vej==='string' && f.vej) ? f.vej : null};
      inp.Rw_i=talFelt(f.Rw_i, base+'.Rw_i', navn+': Rw_i', mangler);
      inp.Rw_j=talFelt(f.Rw_j, base+'.Rw_j', navn+': Rw_j', mangler);
      var d=deltaR(f.deltaR_ij, base+'.deltaR_ij', navn+': ΔR_ij', mangler, inp);
      inp.Kij=talFelt(f.Kij, base+'.Kij', navn+': Kij', mangler);
      inp.laengde=lf;
      ud.push(lavVej(inp, inp.Rw_i, inp.Rw_j, d, inp.Kij, lf, Ss));
      return mangler.length===n0;
    }

    var brugerF=liste.indexOf('Ff')>=0 || liste.indexOf('Fd')>=0;
    var brugerf=liste.indexOf('Ff')>=0 || liste.indexOf('Df')>=0;
    var RF=brugerF ? talFelt(f.Rw_i, base+'.Rw_i', navn+': Rw_i (flankeelementet i senderummet)', mangler) : null;
    var Rf=brugerf ? talFelt(f.Rw_j, base+'.Rw_j', navn+': Rw_j (flankeelementet i modtagerrummet)', mangler) : null;

    // Kij og ΔR_ij er normalt forskellige for hver vej, så ét tal for flere veje accepteres ikke.
    var kFlertydig=false, dFlertydig=false;
    if(liste.length>1 && !erObjekt(f.Kij)){
      kFlertydig=true;
      mangler.push({felt:base+'.Kij', tekst: erAngivet(f.Kij)
        ? navn+': Kij er angivet som ét tal, men flanken har flere veje; angiv Kij for hver vej, fx {'+liste.join(': …, ')+': …}'
        : navn+': Kij mangler (angiv for hver vej: '+liste.join(', ')+')'});
    }
    if(liste.length>1 && f.deltaR_ij!==undefined && !erObjekt(f.deltaR_ij)){
      dFlertydig=true;
      mangler.push({felt:base+'.deltaR_ij', tekst: erAngivet(f.deltaR_ij)
        ? navn+': ΔR_ij er angivet som ét tal, men flanken har flere veje; angiv ΔR_ij for hver vej eller udelad feltet'
        : navn+': ΔR_ij er angivet som ukendt (angiv 0, hvis der ingen efterbeklædning er, eller udelad feltet)'});
    }

    for(j=0;j<liste.length;j++){
      var vej=liste[j], vi={navn:navn+' ('+vej+')', vej:vej, flanke:navn};
      if(vej==='Ff'){ vi.Rw_i=RF; vi.Rw_j=Rf; }
      if(vej==='Df'){ vi.Rw_i=Rs; vi.Rw_i_note='skillevæggens Rw (D)'; vi.Rw_j=Rf; }
      if(vej==='Fd'){ vi.Rw_i=RF; vi.Rw_j=Rs; vi.Rw_j_note='skillevæggens Rw (d)'; }
      var dv=null, kv=null, r;
      if(!dFlertydig){
        if(f.deltaR_ij===undefined) dv=deltaR(undefined, '', '', mangler, vi);
        else { r=forVej(f.deltaR_ij, vej, liste.length); dv=deltaR(r.v, base+'.deltaR_ij'+r.felt, navn+': ΔR_ij'+r.tekst, mangler, vi); }
      } else vi.deltaR_ij=null;
      if(!kFlertydig){ r=forVej(f.Kij, vej, liste.length); kv=talFelt(r.v, base+'.Kij'+r.felt, navn+': Kij'+r.tekst, mangler); }
      vi.Kij=kv; vi.laengde=lf;
      ud.push(lavVej(vi, vi.Rw_i, vi.Rw_j, dv, kv, lf, Ss));
    }
    return mangler.length===n0;
  }

  // Én flankevej: R_ij beregnes kun, når alle led er kendt.
  function lavVej(inp, Ri, Rj, dR, K, lf, Ss){
    var R=null;
    if(Ri!==null && Rj!==null && dR!==null && K!==null && lf!==null && Ss!==null)
      R=(Ri+Rj)/2 + dR + K + 10*lg(Ss/(L0*lf));
    return {navn:inp.navn, vej:inp.vej, R:R, input:inp};
  }

  function luftlydMellemRum(p){
    p=erObjekt(p) ? p : {};
    var mangler=[], forbehold=[FB_BEREGNING, FB_LAB,
      'Kun den direkte vej og de angivne flankeveje indgår. Andre transmissionsveje (fx kanaler, gennemføringer og utætheder) er ikke med.'];
    var input={l0:L0};
    var sv=erObjekt(p.skillevaeg) ? p.skillevaeg : {};
    var Rs=talFelt(sv.Rw,'skillevaeg.Rw','Skillevæggens Rw',mangler);           // R_Dd,w: Rw for den direkte vej
    var Ss=talFelt(sv.areal,'skillevaeg.areal','Skillevæggens areal',mangler,true);
    input.skillevaeg={Rw:Rs, areal:Ss};

    var veje=[], flankerOk=true, k;
    if(!erAngivet(p.flanker)){
      flankerOk=false;
      mangler.push({felt:'flanker', tekst:'Flankerne mangler (angiv en tom liste, hvis kun den direkte transmission skal regnes)'});
    } else if(!Array.isArray(p.flanker)){
      flankerOk=false;
      mangler.push({felt:'flanker', tekst:'Flankerne skal angives som en liste'});
    } else {
      if(p.flanker.length===0) forbehold.push("Ingen flankeveje er angivet. R'w omfatter kun den direkte transmission gennem skillevæggen og overvurderer derfor typisk lydisolationen.");
      for(k=0;k<p.flanker.length;k++){ if(!flankeveje(p.flanker[k], k, Rs, Ss, mangler, veje)) flankerOk=false; }
    }
    input.flankeveje=veje.map(function(v){ return v.input; });

    var V=talFelt(p.modtagerVolumen,'modtagerVolumen','Modtagerrummets volumen',mangler,true);
    input.modtagerVolumen=V;
    var T0=refT0(p.T0,input,mangler);

    var Rmark=null, volLed=null, DnTw=null;
    if(Rs!==null && Ss!==null && flankerOk){
      var sum=Math.pow(10,-Rs/10);
      for(k=0;k<veje.length;k++) sum+=Math.pow(10,-veje[k].R/10);
      Rmark=-10*lg(sum);
    }
    if(V!==null && T0!==null && Ss!==null) volLed=10*lg(0.16*V/(T0*Ss));
    if(Rmark!==null && volLed!==null) DnTw=Rmark+volLed;

    var status=statusFor(mangler);
    return {
      status:status, statusTekst:TEKST[status],
      Rw_mark:afrund(Rmark), DnTw:afrund(DnTw),
      stoerrelser:{Rw_mark:{navn:"R'w", enhed:'dB'}, DnTw:{navn:"D'nT,w", enhed:'dB'}},
      metode:METODE.luftlyd, input:input,
      mellemregninger:{
        RDd:afrund(Rs),
        flankeveje:veje.map(function(v){ return {navn:v.navn, vej:v.vej, R:afrund(v.R)}; }),
        volumenLed:afrund(volLed)                                      // 10·lg(0,16·V/(T0·S_s))
      },
      mangler:mangler, forbehold:forbehold
    };
  }

  /* ---------- 2. Trinlyd, DS/EN ISO 12354-2 (forenklet) ----------
     L'n,w = L_n,w,eq − ΔL_w + K ;  L'nT,w = L'n,w − 10·lg(0,032·V) */
  function trinlyd(p){
    p=erObjekt(p) ? p : {};
    var mangler=[], forbehold=[FB_BEREGNING, FB_LAB,
      'K (flanketillæg) og ΔLw er brugerens egne input; modulet slår ikke K op i standardens tabeller.'];
    var L=talFelt(p.Lnw_eq,'Lnw_eq','Etagedækkets Ln,w,eq',mangler);
    var dL=talFelt(p.deltaLw,'deltaLw','Trinlydsforbedringen ΔLw',mangler,false,'0 er gyldigt, hvis der ingen gulvbelægning er');
    var K=talFelt(p.K,'K','Flanketillægget K',mangler);
    var V=talFelt(p.modtagerVolumen,'modtagerVolumen','Modtagerrummets volumen',mangler,true);
    var Lmark=null, volLed=null, LnT=null;
    if(L!==null && dL!==null && K!==null) Lmark=L-dL+K;
    if(V!==null) volLed=10*lg(0.032*V);
    if(Lmark!==null && volLed!==null) LnT=Lmark-volLed;
    var status=statusFor(mangler);
    return {
      status:status, statusTekst:TEKST[status],
      Lnw_mark:afrund(Lmark), LnTw_mark:afrund(LnT),
      stoerrelser:{Lnw_mark:{navn:"L'n,w", enhed:'dB'}, LnTw_mark:{navn:"L'nT,w", enhed:'dB'}},
      metode:METODE.trinlyd,
      input:{Lnw_eq:L, deltaLw:dL, K:K, modtagerVolumen:V},
      mellemregninger:{Lnw_mark:afrund(Lmark), volumenLed:afrund(volLed)},   // volumenLed = 10·lg(0,032·V)
      mangler:mangler, forbehold:forbehold
    };
  }

  /* ---------- 3. Facade, DS/EN ISO 12354-3 (forenklet) ----------
     R'w = −10·lg(Σ (S_i/S)·10^(−R_i/10) + Σ (A_0/S)·10^(−D_n,e,i/10)),  A_0 = 10 m²
     D2m,nT,w = R'w + ΔL_fs + 10·lg(V/(6·T0·S)) ;  L_inde = L_ude − D2m,nT */
  function facade(p){
    p=erObjekt(p) ? p : {};
    var mangler=[], forbehold=[FB_BEREGNING, FB_LAB,
      'L_ude skal være niveauet 2 m foran facaden (inkl. refleksion fra facaden), som D2m,nT er defineret ud fra. Er L_ude et frifeltsniveau uden facaderefleksion (som i mange støjkort), skal det korrigeres, før det bruges her; modulet korrigerer ikke selv.',
      'Facadeformens ΔLfs er brugerens eget input; modulet slår ikke værdien op.'];
    var input={A0:A0}, i;

    var brugCtr=false;
    if(p.brugCtr===undefined || p.brugCtr===null){ input.brugCtr=false; input.brugCtr_note='false (ikke angivet, regnet uden Ctr)'; }
    else if(typeof p.brugCtr!=='boolean') mangler.push({felt:'brugCtr', tekst:'brugCtr skal være sand eller falsk'});
    else { brugCtr=p.brugCtr; input.brugCtr=brugCtr; }

    var el=[], elOk=true;
    if(!erAngivet(p.elementer)){ elOk=false; mangler.push({felt:'elementer', tekst:'Facadens elementer mangler'}); }
    else if(!Array.isArray(p.elementer) || p.elementer.length===0){
      elOk=false; mangler.push({felt:'elementer', tekst:'Facaden skal have mindst ét element (væg, vindue, dør eller ventil)'});
    } else for(i=0;i<p.elementer.length;i++){
      var e=p.elementer[i], b='elementer['+i+']';
      if(!erObjekt(e)){ elOk=false; mangler.push({felt:b, tekst:'Element '+(i+1)+' er ikke angivet som et objekt'}); continue; }
      var navn=navnPaa(e.navn,'Element '+(i+1)), n0=mangler.length;
      // Lille element (ventil o.l.) med Dn,e,w; ellers fladeelement med Rw og areal
      var x={navn:navn, type:(e.type===undefined ? null : e.type), lille:erAngivet(e.Dnew) || (e.type==='ventil' && !erAngivet(e.Rw))};
      if(erAngivet(e.Dnew) && erAngivet(e.Rw)) mangler.push({felt:b, tekst:navn+': angiv enten Rw og areal eller Dnew, ikke begge'});
      else if(x.lille) x.Dnew=talFelt(e.Dnew, b+'.Dnew', navn+': Dn,e,w', mangler);
      else { x.Rw=talFelt(e.Rw, b+'.Rw', navn+': Rw', mangler); x.areal=talFelt(e.areal, b+'.areal', navn+': areal', mangler, true); }
      if(brugCtr) x.Ctr=talFelt(e.Ctr, b+'.Ctr', navn+': Ctr', mangler, false, 'skal angives, når der regnes med Ctr');
      if(mangler.length>n0) elOk=false;
      el.push(x);
    }
    input.elementer=el.map(function(x){
      var o={navn:x.navn, type:x.type};
      if(x.lille) o.Dnew=(x.Dnew===undefined ? null : x.Dnew); else { o.Rw=x.Rw; o.areal=x.areal; }
      if(brugCtr) o.Ctr=x.Ctr;
      return o;
    });

    var S=talFelt(p.facadeAreal,'facadeAreal','Facadearealet (set indefra)',mangler,true);
    var V=talFelt(p.rumVolumen,'rumVolumen','Rummets volumen',mangler,true);
    var dLfs=talFelt(p.deltaLfs,'deltaLfs','Facadeformens ΔLfs',mangler,false,'0 er gyldigt, fx for en plan facade');
    input.facadeAreal=S; input.rumVolumen=V; input.deltaLfs=dLfs;
    var T0=refT0(p.T0,input,mangler);
    var Lude=talFelt(p.Lude,'Lude','Udendørs støjniveau L_ude',mangler);
    var st=navnPaa(p.stoerrelse,null);
    if(st===null) mangler.push({felt:'stoerrelse', tekst:'Størrelsen for udendørsniveauet (fx Lden eller LAeq,24h) mangler'});
    input.Lude=Lude; input.stoerrelse=st;
    if(!brugCtr) forbehold.push('Der er regnet uden Ctr. For vejtrafikstøj beskriver D2m,nT,w + Ctr normalt det A-vægtede indendørsniveau bedre; L_inde er derfor kun et overslag.');

    var Rmark=null, volLed=null, D2m=null, Linde=null, andele=null, dom=null, sumAreal=null, sum=null;
    if(elOk && S!==null){
      sum=0; sumAreal=0;
      for(i=0;i<el.length;i++){
        var x2=el[i], ctr=brugCtr ? x2.Ctr : 0;
        if(x2.lille){ x2.Dne_brugt=x2.Dnew+ctr; x2.tau=(A0/S)*Math.pow(10,-x2.Dne_brugt/10); }
        else { x2.R_brugt=x2.Rw+ctr; x2.tau=(x2.areal/S)*Math.pow(10,-x2.R_brugt/10); sumAreal+=x2.areal; }
        sum+=x2.tau;
      }
      Rmark=-10*lg(sum);
      andele=el.map(function(x){ return {navn:x.navn, type:x.type, andel:afrund(100*x.tau/sum)}; });   // % af transmitteret energi
      for(i=0;i<el.length;i++) if(!dom || el[i].tau>dom.tau) dom=el[i];
      dom={navn:dom.navn, type:dom.type, andel:afrund(100*dom.tau/sum)};
      if(Math.abs(sumAreal-S)>0.01*S)
        forbehold.push('Elementernes samlede areal ('+fmt(sumAreal,2)+' m²) svarer ikke til facadearealet ('+fmt(S,2)+' m²). Resultatet bygger på de angivne arealer.');
    }
    if(V!==null && T0!==null && S!==null) volLed=10*lg(V/(6*T0*S));
    if(Rmark!==null && dLfs!==null && volLed!==null) D2m=Rmark+dLfs+volLed;
    if(D2m!==null && Lude!==null) Linde=Lude-D2m;

    var tillaeg=brugCtr ? ' + Ctr' : '';
    var status=statusFor(mangler);
    return {
      status:status, statusTekst:TEKST[status],
      Rw_mark:afrund(Rmark), D2mnTw:afrund(D2m), L_ude:Lude, L_inde:afrund(Linde),
      andele:andele, dominerende:dom,
      stoerrelser:{
        Rw_mark:{navn:"R'w"+tillaeg, enhed:'dB'}, D2mnTw:{navn:'D2m,nT,w'+tillaeg, enhed:'dB'},
        L_ude:{navn:(st || 'L')+' udendørs', enhed:'dB'}, L_inde:{navn:(st || 'L')+' indendørs', enhed:'dB'}
      },
      metode:METODE.facade, input:input,
      mellemregninger:{
        elementer:el.map(function(x){
          var o={navn:x.navn, type:x.type, andel:(sum ? afrund(100*x.tau/sum) : null)};
          if(x.lille) o.Dne=(sum ? afrund(x.Dne_brugt) : null); else o.R=(sum ? afrund(x.R_brugt) : null);
          return o;
        }),
        sumElementAreal:sumAreal, volumenLed:afrund(volLed)          // volumenLed = 10·lg(V/(6·T0·S))
      },
      mangler:mangler, forbehold:forbehold
    };
  }

  /* ---------- 4. Installationsstøj, forenklet rumakustisk model (jf. DS/EN 12354-5) ----------
     Kilde i samme rum: L_p = L_WA + 10·lg(4/A), A = 0,16·V/T.  Nabo-rum: L_p,modtager = L_p,kilderum − DnT */
  function installation(p){
    p=erObjekt(p) ? p : {};
    var mangler=[], forbehold=[FB_BEREGNING,
      'Forenklet rumakustisk model: kun det diffuse lydfelt indgår, ikke den direkte lyd tæt ved kilden. Det er ikke den fulde metode i DS/EN 12354-5.',
      'Strukturlyd fra installationer (vibrationer, der forplanter sig gennem konstruktionerne) er ikke med; kun luftbåren lyd indgår.',
      'L_WA er brugerens eget input (fx producentens data) og beskriver kilden, ikke den færdige installation.'];
    var LWA=talFelt(p.LWA,'LWA','Installationens lydeffektniveau L_WA',mangler);
    var V=talFelt(p.rumVolumen,'rumVolumen','Volumen af rummet med kilden',mangler,true);
    var T=talFelt(p.efterklangstid,'efterklangstid','Efterklangstiden i rummet med kilden',mangler,true);
    var input={LWA:LWA, rumVolumen:V, efterklangstid:T};

    var DnT=null, medTransmission=p.transmission!==undefined && p.transmission!==null;
    if(medTransmission){
      if(!erObjekt(p.transmission)) mangler.push({felt:'transmission', tekst:'transmission skal angives som et objekt med DnT'});
      else DnT=talFelt(p.transmission.DnT,'transmission.DnT','Lydisolationen DnT til nabo-rummet',mangler);
      input.transmission={DnT:DnT};
      forbehold.push('Niveauet i nabo-rummet er L_p,kilderum − DnT og er dermed standardiseret til T0 = 0,5 s i modtagerrummet.');
    }

    var A=null, rumLed=null, Lp=null, Lmod=null;
    if(V!==null && T!==null){ A=0.16*V/T; rumLed=10*lg(4/A); }
    if(LWA!==null && rumLed!==null) Lp=LWA+rumLed;
    if(Lp!==null && DnT!==null) Lmod=Lp-DnT;
    var status=statusFor(mangler);
    return {
      status:status, statusTekst:TEKST[status],
      Lp_kilderum:afrund(Lp), Lp_modtager:afrund(Lmod),
      stoerrelser:{Lp_kilderum:{navn:'Lp,A (rummet med kilden)', enhed:'dB'}, Lp_modtager:{navn:'Lp,A,nT (nabo-rum)', enhed:'dB'}},
      metode:METODE.installation, input:input,
      mellemregninger:{A:(A===null ? null : Math.round(A*100)/100), rumLed:afrund(rumLed)},   // A i m² Sabine, rumLed = 10·lg(4/A)
      mangler:mangler, forbehold:forbehold
    };
  }

  /* ---------- 5. Neutral sammenligning med brugerens mål ----------
     vaerdi og maal er tal eller {vaerdi, stoerrelse, enhed}; p.stoerrelse/p.enhed gælder for begge, hvis de ikke har deres egen.
     retning "min": værdien skal være mindst målet; "max": højst målet. Sammenligningen sker med 0,1 i opløsning (som output). */
  function delOp(x){ return erObjekt(x) ? {tal:x.vaerdi, stoerrelse:x.stoerrelse, enhed:x.enhed} : {tal:x}; }
  function normNavn(s){ return String(s).replace(/[’′´`]/g,"'").replace(/\s+/g,'').toLowerCase(); }

  // Find fælles størrelse/enhed for værdi og mål. Mangler eller forskellige → post i mangler.
  function faelles(nogle, egenV, egenM, top, mangler, navn, eksempel){
    var v=navnPaa(erAngivet(egenV) ? egenV : top, null), m=navnPaa(erAngivet(egenM) ? egenM : top, null);
    if(v===null && m===null){ mangler.push({felt:nogle, tekst:navn+' mangler (fx '+eksempel+')'}); return null; }
    if(v===null){ mangler.push({felt:'vaerdi.'+nogle, tekst:navn+' for værdien mangler'}); return null; }
    if(m===null){ mangler.push({felt:'maal.'+nogle, tekst:navn+' for målet mangler'}); return null; }
    if(normNavn(v)!==normNavn(m)){
      mangler.push({felt:nogle, tekst:'Værdien er angivet som '+v+', men målet som '+m+'; forskellige '+(nogle==='enhed' ? 'enheder' : 'størrelser')+' kan ikke sammenholdes direkte'});
      return null;
    }
    return v;
  }

  function sammenlign(p){
    p=erObjekt(p) ? p : {};
    var forbehold=[FB_MAAL], mangler=[];
    var dv=delOp(p.vaerdi), dm=delOp(p.maal);
    var ud={metode:METODE.sammenlign, input:{vaerdi:p.vaerdi, maal:p.maal, stoerrelse:p.stoerrelse, enhed:p.enhed, retning:p.retning}};

    if(p.ikkeRelevant===true){
      ud.status=STATUS.NOT_APPLICABLE; ud.statusTekst=TEKST[ud.status];
      ud.forskel=null; ud.beskrivelse='Markeret som ikke relevant af brugeren.';
      ud.mellemregninger={}; ud.mangler=[]; ud.forbehold=forbehold;
      return ud;
    }

    var v=talFelt(dv.tal,'vaerdi','Værdien',mangler);
    var m=talFelt(dm.tal,'maal','Målet',mangler);
    var st=faelles('stoerrelse', dv.stoerrelse, dm.stoerrelse, p.stoerrelse, mangler, 'Størrelsen', "R'w eller L'nT,w");
    var en=faelles('enhed', dv.enhed, dm.enhed, p.enhed, mangler, 'Enheden', 'dB');
    var r=p.retning;
    if(!erAngivet(r)) mangler.push({felt:'retning', tekst:'Retningen mangler (min: værdien skal være mindst målet; max: værdien skal være højst målet)'});
    else if(r!=='min' && r!=='max'){ mangler.push({felt:'retning', tekst:'Retningen «'+r+'» er ukendt (brug min eller max)'}); r=null; }

    ud.stoerrelse=st; ud.enhed=en; ud.retning=(r==='min' || r==='max') ? r : null; ud.vaerdi=v; ud.maal=m;
    ud.mangler=mangler; ud.forbehold=forbehold;
    if(mangler.length){
      ud.status=STATUS.NEEDS_INPUT; ud.statusTekst=TEKST[ud.status];
      ud.forskel=null; ud.beskrivelse=null; ud.mellemregninger={};
      return ud;
    }

    var d=afrund(v-m);                                       // fortegn: værdi − mål
    var forkert=(r==='min') ? d<0 : d>0;                     // målbar forskel i den forkerte retning
    var abs=fmt(Math.abs(d))+' '+en;
    var side=d>0 ? 'over' : 'under';
    ud.status=forkert ? STATUS.DIFFERENCE_FROM_TARGET : STATUS.DOCUMENTED_AGAINST_TARGET;
    ud.statusTekst=TEKST[ud.status];
    ud.forskel={vaerdi:d, enhed:en, tekst: forkert ? abs+' fra målet' : (d===0 ? 'Lig med målet' : abs+' '+side+' målet')};
    ud.beskrivelse=st+' = '+fmt(v)+' '+en+(d===0 ? ' er lig med målet' : ' ligger '+abs+' '+side+' målet')+' ('+fmt(m)+' '+en+
      ', angivet som '+(r==='min' ? 'mindsteværdi' : 'højesteværdi')+').';
    ud.mellemregninger={forskel:d, oploesning:0.1};
    return ud;
  }

  /* ---------- 6. Skøn ud fra massen (samme formler og id'er som ISSANA_CalculationEngine, Formulas/Acoustics) ----------
     Bruges kun, når der ikke er en dokumenteret værdi. Masseformlerne gælder én tung skal: en kaldende kode må ikke bruge dem
     på dobbeltkonstruktioner, lette vægge eller huldæk. */
  var MAKS_MASSELOV=700, TUNG_KNAE=Math.pow(10,(13.3+42)/(37.5-13.3));
  var FB_SKOEN='Skøn ud fra massen (konceptniveau). Endelig dokumentation kræver prøvningsdata, producentdata eller en projektspecifik beregning.';

  function skoen(id, metode, stoerrelse, enhed, vaerdi, input, grund){
    return {formelId:id, metode:metode, stoerrelse:stoerrelse, enhed:enhed, vaerdi:vaerdi, input:input, grund:grund||null, forbehold:[FB_SKOEN]};
  }
  // acoustics.layers.mass_per_area: m' = Σ ρ·d. lag: [{rho (kg/m³), tykkelseM (m)}]
  function flademasse(lag){
    var ok=Array.isArray(lag)&&lag.length>0&&lag.every(function(l){ return erObjekt(l)&&erTal(l.rho)&&l.rho>0&&erTal(l.tykkelseM)&&l.tykkelseM>0; });
    var m=ok ? lag.reduce(function(s,l){ return s+l.rho*l.tykkelseM; },0) : null;
    return skoen('acoustics.layers.mass_per_area',"m' = Σ ρ·d","m'",'kg/m²',m,{lag:lag},ok ? null : 'Alle lag skal have densitet og tykkelse');
  }
  // acoustics.mass_law.single_leaf_rw: Rw = 37,5·lg(m') − 42 for m' ≥ 192,8 kg/m², ellers 13,3·lg(m') + 13,3. Kalibreret op til 700 kg/m².
  function rwMasselov(m){
    var metode="R_w = 37,5·lg(m') − 42 for m' ≥ 192,8 kg/m²; R_w = 13,3·lg(m') + 13,3 under";
    if(!erTal(m)||m<=0) return skoen('acoustics.mass_law.single_leaf_rw',metode,'Rw','dB',null,{m:m},'Flademassen skal være større end 0');
    if(m>MAKS_MASSELOV) return skoen('acoustics.mass_law.single_leaf_rw',metode,'Rw','dB',null,{m:m},'Masseloven er kalibreret op til 700 kg/m²');
    return skoen('acoustics.mass_law.single_leaf_rw',metode,'Rw','dB',Math.max(0,(m>=TUNG_KNAE ? 37.5*lg(m)-42 : 13.3*lg(m)+13.3)),{m:m});
  }
  // acoustics.impact.homogeneous_floor_equivalent: L_n,eq,0,w = 164 − 35·lg(m'), kun homogene tunge dæk fra 100 til 600 kg/m² (anneks B).
  function lnwMasse(m){
    var metode="L_n,eq,0,w = 164 − 35·lg(m'), homogene tunge dæk fra 100 til 600 kg/m²";
    if(!erTal(m)||m<100||m>600) return skoen('acoustics.impact.homogeneous_floor_equivalent',metode,'Ln,w','dB',null,{m:m},'Dækkets bærende lag skal veje 100 til 600 kg/m²');
    return skoen('acoustics.impact.homogeneous_floor_equivalent',metode,'Ln,w','dB',164-35*lg(m),{m:m});
  }

  return {
    STATUS:STATUS, TEKST:TEKST,
    luftlydMellemRum:luftlydMellemRum,
    trinlyd:trinlyd,
    facade:facade,
    installation:installation,
    sammenlign:sammenlign,
    flademasse:flademasse, rwMasselov:rwMasselov, lnwMasse:lnwMasse
  };
});
