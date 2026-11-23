/* ISSANA – inputvalidering (mangelliste) til den kommende overophedningsanalyse.
   Rent JavaScript uden afhængigheder. I browseren giver <script src="overophedning.js">
   window.IssanaOverophedning; i Node giver require/createRequire module.exports.

   Kravspec: Overophedning er en særskilt, inputstyret analyse og må ikke udledes af en
   skyggeberegning. Modulet bruger derfor IKKE sol.js. Mangler et input, kommer det på en
   maskinlæsbar mangelliste; modulet udfylder aldrig antagelser og ændrer aldrig input.
   Selve beregningsmotoren er ikke bygget endnu. */
(function (root, fabrik) {
  var api = fabrik();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else root.IssanaOverophedning = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAERKAT = "Ikke en endelig myndighedsgodkendelse";

  /* ---------- Påkrævede input ----------
     felt, navn, enhed og forklaring er til brugeren; type, min, max og stoerreEnd styrer valideringen.
     min/max er inklusive; stoerreEnd betyder, at værdien skal være større end tallet (0 er da ugyldigt).
     begrundelse bruges i fejlteksten, når en værdi ligger uden for intervallet. */
  var KRAV = {
    projekt: [
      {felt:"vejrdata", navn:"Vejrdata", enhed:"–", type:"tekst",
       forklaring:"Vejrdatasæt til timeberegningen, fx Danmarks referenceår (DRY) eller en navngiven vejrdatafil."},
      {felt:"beregningsperiode", navn:"Beregningsperiode", enhed:"dato", type:"periode",
       forklaring:"Perioden, der beregnes, som {fra, til} med datoer ÅÅÅÅ-MM-DD eller MM-DD."},
      {felt:"temperaturforudsaetninger", navn:"Temperaturforudsætninger", enhed:"°C, timer", type:"temperaturer",
       forklaring:"Temperaturgrænser og tilladt antal timer over hver grænse i brugstiden, som graenser: [{temperatur, maksTimer}], fx 27 °C i højst 100 timer."}
    ],
    rum: [
      {felt:"id", navn:"Rum-id", enhed:"–", type:"id",
       forklaring:"Entydigt id for rummet eller zonen, fx Revits element-id."},
      {felt:"navn", navn:"Rumnavn", enhed:"–", type:"tekst",
       forklaring:"Rummets navn eller nummer, som det står i Revit."},
      {felt:"areal", navn:"Gulvareal", enhed:"m²", type:"tal", stoerreEnd:0,
       forklaring:"Rummets gulvareal i m².",
       begrundelse:"et rum uden gulvareal kan ikke beregnes"},
      {felt:"volumen", navn:"Rumvolumen", enhed:"m³", type:"tal", stoerreEnd:0,
       forklaring:"Rummets luftvolumen i m³.",
       begrundelse:"et rum uden volumen kan ikke beregnes"},
      {felt:"vinduer", navn:"Vinduer", enhed:"–", type:"vinduer",
       forklaring:"Rummets vinduer med areal, orientering, glastype, g-værdi og solafskærmning; mindst ét vindue."},
      {felt:"ventilation", navn:"Ventilation/luftskifte", enhed:"h⁻¹", type:"tal", min:0,
       forklaring:"Samlet luftskifte i brugstiden (mekanisk ventilation, udluftning og infiltration) i gange pr. time. 0 er gyldigt.",
       begrundelse:"et luftskifte kan ikke være negativt"},
      {felt:"interneTilskud", navn:"Interne varmetilskud", enhed:"W/m²", type:"tal", min:0,
       forklaring:"Varmetilskud fra personer, udstyr og belysning i brugstiden, pr. m² gulvareal. 0 er gyldigt.",
       begrundelse:"varmetilskud kan ikke være negative"},
      {felt:"brugstid", navn:"Brugstid", enhed:"timer/døgn", type:"tal", stoerreEnd:0, max:24,
       forklaring:"Antal timer pr. døgn, rummet er i brug; overophedning vurderes i brugstiden.",
       begrundelse:"et døgn har 24 timer, og uden brugstid er der ingen timer at vurdere"},
      {felt:"termiskMasse", navn:"Termisk masse", enhed:"Wh/(K·m²)", type:"tal", stoerreEnd:0,
       forklaring:"Effektiv varmekapacitet af rummets konstruktioner pr. m² gulvareal (som i Be18).",
       begrundelse:"alle rum har en varmekapacitet større end 0"}
    ],
    vindue: [
      {felt:"areal", navn:"Vinduesareal", enhed:"m²", type:"tal", stoerreEnd:0,
       forklaring:"Vinduets areal i m² (karmydermål).",
       begrundelse:"et vindue uden areal giver intet solindfald og skal i stedet udelades"},
      {felt:"orientering", navn:"Orientering", enhed:"°", type:"tal", min:0, max:360,
       forklaring:"Retningen vinduet vender (udadvendt normal), i grader fra sand nord med uret: 0 = nord, 90 = øst, 180 = syd, 270 = vest.",
       begrundelse:"orienteringen er en vinkel fra sand nord med uret"},
      {felt:"glastype", navn:"Glastype", enhed:"–", type:"tekst",
       forklaring:"Rudens opbygning, fx 3-lags energirude."},
      {felt:"gVaerdi", navn:"g-værdi", enhed:"–", type:"tal", min:0, max:1,
       forklaring:"Glassets totale solenergitransmittans, 0-1.",
       begrundelse:"g-værdien er den andel af solenergien, der passerer ruden, og kan ikke være over 1"},
      {felt:"solafskaermning", navn:"Solafskærmning", enhed:"–", type:"tekst",
       forklaring:"Type og styring af solafskærmning, fx udvendig persienne med automatik. Er der ingen, skrives «ingen»."}
    ]
  };

  /* ---------- Små hjælpere ---------- */
  function tom(v){ return v===undefined || v===null || (typeof v==="string" && v.trim()===""); }
  // Tal fra tal eller tekst (accepterer dansk decimalkomma). Ugyldigt giver NaN.
  function tal(v){
    if(typeof v==="number") return isFinite(v)? v : NaN;
    if(typeof v==="string"){
      var s=v.trim().replace(",",".");
      if(/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return parseFloat(s);
    }
    return NaN;
  }
  function dk(x){ return String(x).replace(".",","); }
  function vis(v){ return typeof v==="string"? "«"+v+"»" : String(v); }
  function erObjekt(v){ return v!==null && typeof v==="object" && !Array.isArray(v); }
  // «ÅÅÅÅ-MM-DD» eller «MM-DD» → {aar, ms} eller null. MM-DD tjekkes mod et skudår (29-02 er gyldig).
  function laesDato(s){
    if(typeof s!=="string") return null;
    var m=/^\s*(?:(\d{4})-)?(\d{2})-(\d{2})\s*$/.exec(s); if(!m) return null;
    var y=m[1]? +m[1] : 2024, mo=+m[2], d=+m[3], ms=Date.UTC(y,mo-1,d), t=new Date(ms);
    if(t.getUTCFullYear()!==y || t.getUTCMonth()!==mo-1 || t.getUTCDate()!==d) return null;
    return {aar:!!m[1], ms:ms};
  }

  /* Tjekker én værdi mod et krav. Returnerer null, hvis den er gyldig, ellers fejlteksten.
     sted er den læsbare placering, fx « for rum «Stue» (id 101)». */
  function tjekVaerdi(k, v, sted){
    if(tom(v)) return k.navn+" mangler"+sted+". "+k.forklaring;
    if(k.type==="tekst"){
      if(typeof v!=="string") return k.navn+sted+" skal være en tekst, men er "+vis(v)+". "+k.forklaring;
      return null;
    }
    if(k.type==="id"){
      if(typeof v==="string" || (typeof v==="number" && isFinite(v))) return null;
      return k.navn+sted+" skal være en tekst eller et tal, men er "+vis(v)+".";
    }
    // type "tal"
    var x=tal(v), enhed=k.enhed==="–"? "" : k.enhed==="°"? "°" : " "+k.enhed;
    if(isNaN(x)) return k.navn+sted+" skal være et tal"+(enhed? " ("+k.enhed+")" : "")+", men er "+vis(v)+".";
    var hvorfor=k.begrundelse? ": "+k.begrundelse+"." : ".";
    if(k.stoerreEnd!==undefined && x<=k.stoerreEnd){
      var oevre=k.max!==undefined? " og højst "+dk(k.max) : "";
      return k.navn+" er "+dk(x)+enhed+sted+", men skal være større end "+dk(k.stoerreEnd)+oevre+hvorfor;
    }
    if((k.min!==undefined && x<k.min) || (k.max!==undefined && x>k.max)){
      var interval=k.min!==undefined && k.max!==undefined? "ligge mellem "+dk(k.min)+" og "+dk(k.max)
                 : k.min!==undefined? "være mindst "+dk(k.min) : "være højst "+dk(k.max);
      return k.navn+" er "+dk(x)+enhed+sted+", men skal "+interval+hvorfor;
    }
    return null;
  }
  function krav(liste, felt){ for(var i=0;i<liste.length;i++) if(liste[i].felt===felt) return liste[i]; return null; }

  /* ---------- Projektets input ---------- */
  function validerProjekt(projekt, mangler){
    var pr=erObjekt(projekt)? projekt : {}, sted=" for projektet";
    function mangel(felt, tekst){ mangler.push({rumId:null, felt:felt, tekst:tekst}); }

    var kv=krav(KRAV.projekt,"vejrdata"), t=tjekVaerdi(kv,pr.vejrdata,sted);
    if(t) mangel("vejrdata",t);

    var kp=krav(KRAV.projekt,"beregningsperiode"), per=pr.beregningsperiode;
    if(tom(per)) mangel("beregningsperiode",kp.navn+" mangler"+sted+". "+kp.forklaring);
    else if(!erObjekt(per)) mangel("beregningsperiode",kp.navn+sted+" skal angives som {fra, til}, men er "+vis(per)+".");
    else {
      var fra=null, til=null;
      ["fra","til"].forEach(function(n){
        var v=per[n], d=laesDato(v);
        if(tom(v)) mangel("beregningsperiode."+n,kp.navn+sted+": «"+n+"»-datoen mangler. Brug ÅÅÅÅ-MM-DD eller MM-DD.");
        else if(!d) mangel("beregningsperiode."+n,kp.navn+sted+": «"+n+"»-datoen "+vis(v)+" er ugyldig. Brug ÅÅÅÅ-MM-DD eller MM-DD.");
        else if(n==="fra") fra=d; else til=d;
      });
      if(fra && til && fra.aar && til.aar && fra.ms>til.ms)
        mangel("beregningsperiode",kp.navn+sted+": fra-datoen ligger efter til-datoen.");
    }

    var kt=krav(KRAV.projekt,"temperaturforudsaetninger"), tf=pr.temperaturforudsaetninger;
    if(tom(tf)) mangel("temperaturforudsaetninger",kt.navn+" mangler"+sted+". "+kt.forklaring);
    else if(!erObjekt(tf) || !Array.isArray(tf.graenser) || tf.graenser.length===0)
      mangel("temperaturforudsaetninger",kt.navn+sted+" skal indeholde mindst én grænse i graenser: [{temperatur, maksTimer}]. "+kt.forklaring);
    else {
      var kTemp={navn:"Temperaturgrænse", enhed:"°C", type:"tal", min:0, max:60,
                 forklaring:"Temperaturgrænsen i °C.", begrundelse:"grænsen angives i °C (er den angivet i kelvin?)"};
      var kTimer={navn:"Tilladte timer over grænsen", enhed:"timer", type:"tal", min:0, max:8784,
                  forklaring:"Højst tilladte antal timer over grænsen i perioden. 0 er gyldigt.", begrundelse:"et år har højst 8784 timer"};
      tf.graenser.forEach(function(g, i){
        var s=" i grænse "+(i+1)+sted, sti="temperaturforudsaetninger.graenser["+i+"].";
        if(!erObjekt(g)){ mangel(sti.slice(0,-1),"Grænse "+(i+1)+sted+" skal angives som {temperatur, maksTimer}."); return; }
        var a=tjekVaerdi(kTemp,g.temperatur,s); if(a) mangel(sti+"temperatur",a);
        var b=tjekVaerdi(kTimer,g.maksTimer,s); if(b) mangel(sti+"maksTimer",b);
      });
    }
  }

  /* ---------- Ét rums input ---------- */
  function validerRum(r, i, mangler, sete){
    var rum=erObjekt(r)? r : {};
    var harId=!tom(rum.id) && (typeof rum.id==="string" || (typeof rum.id==="number" && isFinite(rum.id)));
    var rumId=harId? rum.id : null;
    var navn=typeof rum.navn==="string" && rum.navn.trim()? rum.navn.trim() : null;
    var sted=" for rum "+(navn? "«"+navn+"» " : "nr. "+(i+1)+" ")+(harId? "(id "+rum.id+")" : "(uden id)");
    var foer=mangler.length;
    function mangel(felt, tekst){ mangler.push({rumId:rumId, rumIndeks:i, felt:felt, tekst:tekst}); }

    if(!erObjekt(r)){ mangel("rum","Rum nr. "+(i+1)+" skal være et objekt med rummets input, men er "+vis(r)+"."); return false; }

    KRAV.rum.forEach(function(k){
      if(k.type==="vinduer") return;   // tjekkes herunder
      var t=tjekVaerdi(k,rum[k.felt],sted); if(t) mangel(k.felt,t);
    });
    if(harId){
      var noegle=typeof rum.id+":"+rum.id;
      if(sete[noegle]) mangel("id","Rum-id "+rum.id+" er brugt af flere rum; id skal være entydigt.");
      sete[noegle]=true;
    }

    var kVin=krav(KRAV.rum,"vinduer"), vin=rum.vinduer;
    if(tom(vin)) mangel("vinduer",kVin.navn+" mangler"+sted+". "+kVin.forklaring);
    else if(!Array.isArray(vin)) mangel("vinduer",kVin.navn+sted+" skal være en liste, men er "+vis(vin)+".");
    else if(vin.length===0) mangel("vinduer","Ingen vinduer angivet"+sted+". "+kVin.forklaring);
    else vin.forEach(function(v, j){
      var sv=" for vindue "+(j+1)+sted.replace(/^ for/," i"), sti="vinduer["+j+"]";
      if(!erObjekt(v)){ mangel(sti,"Vindue "+(j+1)+sted+" skal være et objekt med vinduets input, men er "+vis(v)+"."); return; }
      KRAV.vindue.forEach(function(k){
        var t=tjekVaerdi(k,v[k.felt],sv); if(t) mangel(sti+"."+k.felt,t);
      });
    });
    return mangler.length===foer;
  }

  /* ---------- Validering ----------
     valider({projekt:{vejrdata, beregningsperiode, temperaturforudsaetninger},
              rum:[{id, navn, areal, volumen, vinduer:[{areal, orientering, glastype, gVaerdi, solafskaermning}],
                    ventilation, interneTilskud, brugstid, termiskMasse}]})
     → {klar, mangler:[{rumId, felt, tekst}], antalRum, antalKlar}
     Projektmangler har rumId null; rummangler har også rumIndeks (0-baseret plads i listen), så et rum
     uden id stadig kan findes. felt er en sti, fx «vinduer[0].gVaerdi». Tom tekst, null og undefined
     mangler; 0 er gyldigt, hvor kravet tillader det (fx interne tilskud), men ikke for areal og volumen. */
  function valider(p){
    var mangler=[], data=erObjekt(p)? p : {};
    validerProjekt(data.projekt,mangler);
    var rum=data.rum, antalRum=0, antalKlar=0;
    if(tom(rum)) mangler.push({rumId:null, felt:"rum", tekst:"Der er ingen rum eller zoner. Angiv mindst ét rum med dets input."});
    else if(!Array.isArray(rum)) mangler.push({rumId:null, felt:"rum", tekst:"Rum skal være en liste af rum/zoner, men er "+vis(rum)+"."});
    else if(rum.length===0) mangler.push({rumId:null, felt:"rum", tekst:"Listen over rum er tom. Angiv mindst ét rum med dets input."});
    else {
      var sete={};
      antalRum=rum.length;
      rum.forEach(function(r, i){ if(validerRum(r,i,mangler,sete)) antalKlar++; });
    }
    return {klar:mangler.length===0, mangler:mangler, antalRum:antalRum, antalKlar:antalKlar};
  }

  /* ---------- Status ----------
     status(p) → {status, besked, mangler, antalRum, antalKlar, maerkat}
     «needs_input», så længe noget mangler; ellers «klar_til_beregning». Motoren findes ikke endnu,
     så der gives aldrig et resultat herfra. */
  function status(p){
    var v=valider(p), n=v.mangler.length;
    var besked=v.klar
      ? "Alle påkrævede input er udfyldt for "+v.antalRum+" rum. Beregningsmotoren til overophedning er endnu ikke bygget, så der er ingen resultater."
      : "Overophedningsanalysen kan ikke køres: "+n+" input mangler eller er "+(n===1? "ugyldigt" : "ugyldige")+". ISSANA udfylder ikke antagelser; ret mangellisten først.";
    return {status:v.klar? "klar_til_beregning" : "needs_input", besked:besked, mangler:v.mangler,
            antalRum:v.antalRum, antalKlar:v.antalKlar, maerkat:MAERKAT};
  }

  return {KRAV:KRAV, MAERKAT:MAERKAT, valider:valider, status:status};
});
