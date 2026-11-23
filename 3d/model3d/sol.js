/* ISSANA – solens position til skyggeanalysen i 3D-visningen (Revit-pluginnet).
   Rent JavaScript uden afhængigheder. I browseren giver <script src="sol.js"> window.IssanaSol;
   i Node giver require/createRequire module.exports.

   Solberegningen følger NOAA's solberegner (Julian day, tidsligning, deklination, timevinkel,
   refraktion). Nøjagtighed som NOAA: få hundrededele grad i højde og azimut, sol op/ned inden for
   ca. 1 minut mellem 72° S og 72° N.

   Konventioner:
   - Vinkler i grader. Azimut måles fra SAND nord med uret (0 = nord, 90 = øst, 180 = syd, 270 = vest).
   - Visningens koordinater: meter, Z op, X og Y er Revits projektkoordinater (projektnord = +Y).
   - Tidszone i timer fra UTC (fx 1 for dansk normaltid, 2 for sommertid).
   - Manglende værdier gættes aldrig: ingen standardplacering, ingen standard-nordretning. */
(function (root, fabrik) {
  var api = fabrik();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else root.IssanaSol = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var RAD = Math.PI / 180;
  var MIN_MS = 60000, TIME_MS = 3600000, DOEGN_MS = 86400000;

  /* ---------- Små hjælpere ---------- */
  function sinD(x){ return Math.sin(x*RAD); }
  function cosD(x){ return Math.cos(x*RAD); }
  function tanD(x){ return Math.tan(x*RAD); }
  function asinD(x){ return Math.asin(Math.max(-1,Math.min(1,x)))/RAD; }
  function acosD(x){ return Math.acos(Math.max(-1,Math.min(1,x)))/RAD; }
  function atan2D(y,x){ return Math.atan2(y,x)/RAD; }
  function mod(a,b){ return ((a%b)+b)%b; }
  function r2(x){ var v=Math.round(x*100)/100; return v===0? 0 : v; }   // 0,01-afrunding uden -0
  function pad2(n){ return (n<10?"0":"")+n; }
  function dk(x){ return String(x).replace(".",","); }                 // dansk decimaltegn i tekster
  function fejl(tekst){ return new Error(tekst); }

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
  // Tidszone som tal (timer) eller tekst «+02:00». Ugyldigt giver NaN.
  function tidszoneTal(v){
    if(typeof v==="string"){
      var m=/^\s*([+-])(\d{1,2}):?(\d{2})\s*$/.exec(v);
      if(m) return (m[1]==="-"?-1:1)*(parseInt(m[2],10)+parseInt(m[3],10)/60);
    }
    return tal(v);
  }
  // Kræv et tal i et interval; ellers en dansk fejl.
  function kraevTal(v, navn, min, max, laes){
    if(tom(v)) throw fejl(navn+" mangler.");
    var x=(laes||tal)(v);
    if(isNaN(x)) throw fejl(navn+" skal være et tal, men er «"+v+"».");
    if(x<min || x>max) throw fejl(navn+" er "+dk(x)+", men skal ligge mellem "+dk(min)+" og "+dk(max)+".");
    return x;
  }

  /* ---------- Dato og tid ---------- */
  // «ÅÅÅÅ-MM-DD» → UTC-midnat (ms) for kalenderdatoen, eller null hvis ugyldig.
  function laesDato(s){
    if(typeof s!=="string") return null;
    var m=/^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(s); if(!m) return null;
    var y=+m[1], mo=+m[2], d=+m[3], ms=Date.UTC(y,mo-1,d), t=new Date(ms);
    if(t.getUTCFullYear()!==y || t.getUTCMonth()!==mo-1 || t.getUTCDate()!==d) return null;
    return ms;
  }
  // «TT:MM», «TT:MM:SS» eller «TT.MM» → minutter efter midnat, eller null hvis ugyldig.
  function laesKlokkeslaet(s){
    if(typeof s!=="string") return null;
    var m=/^\s*(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*$/.exec(s); if(!m) return null;
    var h=+m[1], mi=+m[2], se=m[3]? +m[3] : 0;
    if(h>23 || mi>59 || se>59) return null;
    return h*60+mi+se/60;
  }
  // Tidszone (timer) → «+02:00».
  function offsetTekst(tz){
    var min=Math.round(Math.abs(tz)*60);
    return (tz<0?"-":"+")+pad2(Math.floor(min/60))+":"+pad2(min%60);
  }
  // Tidspunkt (ISO-tekst med tidszone eller Date) → {ms (UTC), tz (timer)}.
  // En ISO-tekst uden tidszone afvises: den ville blive læst i maskinens tidszone, altså gættet.
  function laesTidspunkt(t, tidszone){
    if(t instanceof Date){
      var ms=t.getTime();
      if(!isFinite(ms)) throw fejl("Tidspunktet er ikke en gyldig dato.");
      // Et Date-objekt er et entydigt øjeblik; tidszonen bruges kun til at vise sol op/ned.
      // Uden tidszone vises de i UTC (tidszone 0), og det står i resultatet.
      var tz=tom(tidszone)? 0 : kraevTal(tidszone,"Tidszone",-12,14,tidszoneTal);
      return {ms:ms, tz:tz};
    }
    if(tom(t)) throw fejl("Tidspunkt mangler.");
    if(typeof t!=="string") throw fejl("Tidspunkt skal være en ISO-tekst med tidszone eller et Date-objekt.");
    var m=/^\s*(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})\s*$/i.exec(t);
    if(!m) throw fejl("Tidspunktet «"+t+"» skal være en ISO-tekst med tidszone, fx 2026-06-21T13:00:00+02:00.");
    var dato=laesDato(m[1]+"-"+m[2]+"-"+m[3]);
    var kl=laesKlokkeslaet(m[4]+":"+m[5]+(m[6]? ":"+m[6] : ""));
    if(dato===null || kl===null) throw fejl("Tidspunktet «"+t+"» er ikke en gyldig dato og tid.");
    var tz2=m[7].toUpperCase()==="Z"? 0 : tidszoneTal(m[7]);
    return {ms:dato+Math.round(kl*MIN_MS)-tz2*TIME_MS, tz:tz2};
  }
  // UTC-ms → «TT:MM» i tidszonen (afrundet til nærmeste minut).
  function klokken(ms, tz){
    var min=mod(Math.round(ms/MIN_MS+tz*60),1440);
    return pad2(Math.floor(min/60))+":"+pad2(min%60);
  }
  // UTC-midnat (ms) for den lokale kalenderdato, som øjeblikket ms har i tidszonen tz.
  function lokalDato(ms, tz){
    var d=new Date(ms+tz*TIME_MS);
    return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
  }

  /* ---------- NOAA-solberegning ---------- */
  // Deklination (°) og tidsligning (min) i øjeblikket ms (UTC).
  function solData(ms){
    var jd=ms/DOEGN_MS+2440587.5;                                     // Julian day
    var jc=(jd-2451545)/36525;                                        // Julian century fra J2000
    var l0=mod(280.46646+jc*(36000.76983+jc*0.0003032),360);           // solens middellængde
    var m=357.52911+jc*(35999.05029-0.0001537*jc);                    // middelanomali
    var e=0.016708634-jc*(0.000042037+0.0000001267*jc);               // jordbanens excentricitet
    var c=sinD(m)*(1.914602-jc*(0.004817+0.000014*jc))
         +sinD(2*m)*(0.019993-0.000101*jc)+sinD(3*m)*0.000289;        // centerligning
    var omega=125.04-1934.136*jc;
    var lambda=l0+c-0.00569-0.00478*sinD(omega);                      // tilsyneladende længde
    var eps0=23+(26+(21.448-jc*(46.815+jc*(0.00059-jc*0.001813)))/60)/60;
    var eps=eps0+0.00256*cosD(omega);                                 // ekliptikas hældning, korrigeret
    var dekl=asinD(sinD(eps)*sinD(lambda));
    var y=Math.pow(tanD(eps/2),2);
    var eot=4/RAD*(y*sinD(2*l0)-2*e*sinD(m)+4*e*y*sinD(m)*cosD(2*l0)
                   -0.5*y*y*sinD(4*l0)-1.25*e*e*sinD(2*m));           // tidsligning i minutter
    return {deklination:dekl, tidsligning:eot};
  }
  // Atmosfærisk refraktion (NOAA) i grader. Kun når solen geometrisk står over horisonten (højde > 0).
  function refraktion(h){
    if(h<=0 || h>85) return 0;
    var t=tanD(h), r;
    if(h>5) r=58.1/t-0.07/(t*t*t)+0.000086/Math.pow(t,5);
    else r=1735+h*(-518.2+h*(103.4+h*(-12.79+h*0.711)));
    return r/3600;
  }
  // Solens azimut og højde (med refraktion) for breddegrad lat, længdegrad lon (øst positiv) i øjeblikket ms.
  function beregnPosition(lat, lon, ms){
    var s=solData(ms);
    var tst=mod(ms/MIN_MS+s.tidsligning+4*lon,1440);                  // sand soltid, minutter
    var ha=tst/4-180;                                                 // timevinkel, + om eftermiddagen
    var zen=acosD(sinD(lat)*sinD(s.deklination)+cosD(lat)*cosD(s.deklination)*cosD(ha));
    var h0=90-zen;
    // Azimut som NOAA, skrevet med atan2 så den også er defineret i zenit og ved polerne
    // (vinkel fra syd mod vest, + 180° giver fra nord med uret).
    var az=mod(atan2D(sinD(ha), cosD(ha)*sinD(lat)-tanD(s.deklination)*cosD(lat))+180,360);
    return {azimut:az, hoejde:h0+refraktion(h0), deklination:s.deklination, tidsligning:s.tidsligning};
  }
  // cos(timevinkel) ved sol op/ned (solens øverste kant i horisonten, zenit 90,833°).
  // > 1: solen står ikke op (polarnat). < -1: solen går ikke ned (midnatssol).
  function cosTimevinkelHorisont(lat, dekl){
    var n=cosD(lat)*cosD(dekl);
    if(Math.abs(n)<1e-12) return (lat>0?dekl:-dekl)>-0.833? -2 : 2;   // på polen
    return cosD(90.833)/n-tanD(lat)*tanD(dekl);
  }
  // Sol op (retning -1) eller ned (+1) for den lokale dato med UTC-midnat datoMs. Itererer, så
  // deklination og tidsligning tages ved selve begivenheden.
  function begivenhed(lat, lon, datoMs, retning){
    var t=datoMs+(720-4*lon)*MIN_MS;
    for(var i=0;i<4;i++){
      var s=solData(t);
      var ha=acosD(cosTimevinkelHorisont(lat,s.deklination));
      t=datoMs+(720-4*lon-s.tidsligning+retning*4*ha)*MIN_MS;
    }
    return t;
  }
  // Dagens forløb for den lokale dato: forhold (normal/polarnat/midnatssol) og sol op/ned (UTC-ms).
  function dagInfo(lat, lon, datoMs){
    var middag=datoMs+(720-4*lon)*MIN_MS;
    middag=datoMs+(720-4*lon-solData(middag).tidsligning)*MIN_MS;    // sand middag
    var x=cosTimevinkelHorisont(lat,solData(middag).deklination);
    if(x>1) return {forhold:"polarnat", op:null, ned:null};
    if(x<-1) return {forhold:"midnatssol", op:null, ned:null};
    return {forhold:"normal", op:begivenhed(lat,lon,datoMs,-1), ned:begivenhed(lat,lon,datoMs,1)};
  }

  /* ---------- 1. Solens position ----------
     solposition({breddegrad, laengdegrad, tidspunkt[, tidszone]})
     tidspunkt: ISO-tekst med tidszone («2026-06-21T13:00:00+02:00») eller Date.
     Sol op/ned vises i tidspunktets tidszone (ved Date: tidszone, ellers UTC).
     solForhold: «normal», «polarnat» eller «midnatssol» (så er solOp/solNed null). */
  function solposition(p){
    p=p||{};
    var lat=kraevTal(p.breddegrad,"Breddegrad",-90,90);
    var lon=kraevTal(p.laengdegrad,"Længdegrad",-180,180);
    var t=laesTidspunkt(p.tidspunkt,p.tidszone);
    var pos=beregnPosition(lat,lon,t.ms);
    var dag=dagInfo(lat,lon,lokalDato(t.ms,t.tz));
    return {
      azimut:r2(pos.azimut)%360, hoejde:r2(pos.hoejde),
      deklination:r2(pos.deklination), tidsligning:r2(pos.tidsligning),   // tidsligning i minutter
      solOp:dag.op===null? null : klokken(dag.op,t.tz),
      solNed:dag.ned===null? null : klokken(dag.ned,t.tz),
      solForhold:dag.forhold, tidszone:t.tz
    };
  }

  /* ---------- 2. Retning mod solen i visningens koordinater ----------
     solretning({azimut, hoejde, sandNordVinkel}) → enhedsvektor [x, y, z], der peger FRA modellen MOD solen.

     Trin 1, sand nord-system (Ø, N, op):  Ø = sin(az)·cos(h),  N = cos(az)·cos(h),  op = sin(h).
     Trin 2, drejning fra sand nord til projektnord.
       sandNordVinkel θ har fortegn som Revits ProjectPosition.Angle: projekt → sand nord (delte
       koordinater) er en drejning på +θ om Z, mod uret set ovenfra, som i Revit-API'ets omregning
       interne → delte koordinater: Transform.CreateRotation(XYZ.BasisZ, Angle).
       Sand nord ligger derfor i projektet langs (sin θ, cos θ, 0): positiv θ betyder, at sand nord
       ligger θ grader MED uret fra projektnord (mod +X); negativ θ, at den ligger mod uret (mod −X).
       Sand → projekt er den modsatte drejning (−θ):
         x =  Ø·cos θ + N·sin θ
         y = −Ø·sin θ + N·cos θ
         z =  op
       Eksempel: θ = 90° → sand nord = +X i projektet. Sol i syd (az 180°, h 0°) → [−1, 0, 0];
       sol i øst (az 90°, h 0°) → [0, −1, 0]. Med θ = 0 er sand nord = projektnord = +Y.
       Visningens manuelle nordpil (northOffset) drejer nord MOD uret, så northOffset = −θ (mod 360).
       Fortegnet bør efterprøves på en Revit-model med kendt sand nord, når eksporten er bygget.
     Er solen under horisonten (h < 0), peger vektoren nedad (z < 0); kalderen afgør, hvad der så vises. */
  function solretning(p){
    p=p||{};
    var az=kraevTal(p.azimut,"Azimut",-360,360);
    var h=kraevTal(p.hoejde,"Højde",-90,90);
    var th=kraevTal(p.sandNordVinkel,"Sand nord-vinkel",-360,360);
    var oest=sinD(az)*cosD(h), nord=cosD(az)*cosD(h), op=sinD(h);
    var x=oest*cosD(th)+nord*sinD(th);
    var y=-oest*sinD(th)+nord*cosD(th);
    var l=Math.sqrt(x*x+y*y+op*op)||1;
    function ren(v){ return Math.abs(v)<1e-12? 0 : v; }   // fjern regnestøj som 1e-16
    return [ren(x/l), ren(y/l), ren(op/l)];
  }

  /* ---------- 3. Validering før skyggeanalysen ----------
     skyggeInput({placering:{breddegrad, laengdegrad, tidszone, sandNordVinkel, stednavn}, dato, klokkeslaet, geometri})
     Placeringsfelterne læses fra p.placering (som Revit-eksporten leverer dem) eller, hvis den mangler,
     direkte fra p. geometri = antal synlige elementer i visningen eller {antalElementer}.
     Analysen må først køre, når placering, sand nord, dato, klokkeslæt og geometri er defineret.
     input er de normaliserede værdier, som resultatet skal bære i sine metadata (null = mangler). */
  function skyggeInput(p){
    p=p||{};
    var pl=(p.placering && typeof p.placering==="object")? p.placering : p;
    var mangler=[];
    var input={breddegrad:null, laengdegrad:null, tidszone:null, sandNordVinkel:null, stednavn:null,
               dato:null, klokkeslaet:null, tidspunkt:null, geometri:null};
    function mangel(felt, tekst){ mangler.push({felt:felt, tekst:tekst}); }
    // Tal i interval. Manglende tal gives teksten tekstMangler; 0 er gyldigt, hvis det ligger i intervallet.
    function tjekTal(felt, v, navn, min, max, tekstMangler, enhed, laes){
      if(tom(v)){ mangel(felt,tekstMangler); return; }
      var x=(laes||tal)(v);
      if(isNaN(x)){ mangel(felt,navn+" skal være et tal ("+enhed+"), men er «"+v+"»."); return; }
      if(x<min || x>max){ mangel(felt,navn+" er "+dk(x)+", men skal ligge mellem "+dk(min)+" og "+dk(max)+" ("+enhed+")."); return; }
      input[felt]=x;
    }
    tjekTal("breddegrad",pl.breddegrad,"Breddegrad",-90,90,
      "Breddegrad mangler. Angiv projektets placering i Revit, og hent modellen igen.","grader, nord positiv");
    tjekTal("laengdegrad",pl.laengdegrad,"Længdegrad",-180,180,
      "Længdegrad mangler. Angiv projektets placering i Revit, og hent modellen igen.","grader, øst positiv");
    tjekTal("tidszone",pl.tidszone,"Tidszone",-12,14,
      "Tidszone mangler. Den skal kendes for at omregne dato og klokkeslæt til solens position.","timer fra UTC",tidszoneTal);
    tjekTal("sandNordVinkel",pl.sandNordVinkel,"Sand nord-vinkel",-360,360,
      "Sand nord mangler. Vinklen fra projektnord til sand nord skal komme fra Revit; 0 er gyldigt, men antages ikke.","grader");
    if(!tom(pl.stednavn)) input.stednavn=String(pl.stednavn);

    if(tom(p.dato)) mangel("dato","Dato mangler (ÅÅÅÅ-MM-DD).");
    else if(laesDato(p.dato)===null) mangel("dato","Datoen «"+p.dato+"» er ugyldig. Brug formatet ÅÅÅÅ-MM-DD, fx 2026-06-21.");
    else input.dato=p.dato.trim();

    var kl=tom(p.klokkeslaet)? null : laesKlokkeslaet(String(p.klokkeslaet));
    if(tom(p.klokkeslaet)) mangel("klokkeslaet","Klokkeslæt mangler (TT:MM).");
    else if(kl===null) mangel("klokkeslaet","Klokkeslættet «"+p.klokkeslaet+"» er ugyldigt. Brug formatet TT:MM, fx 13:00.");
    else input.klokkeslaet=pad2(Math.floor(kl/60))+":"+pad2(Math.floor(kl%60));

    var g=p.geometri, n=(g && typeof g==="object")? tal(g.antalElementer) : (tom(g)? NaN : tal(g));
    if(!(n>0)) mangel("geometri","Geometri mangler. Der er ingen elementer i visningen; hent modellen fra Revit først.");
    else input.geometri={antalElementer:n};

    if(input.dato!==null && input.klokkeslaet!==null && input.tidszone!==null)
      input.tidspunkt=input.dato+"T"+input.klokkeslaet+":00"+offsetTekst(input.tidszone);
    return {klar:mangler.length===0, mangler:mangler, input:input};
  }

  /* ---------- 4. Dagsforløb til tidsslideren ----------
     dagsforloeb({breddegrad, laengdegrad, dato, tidszone, trinMinutter}) → [{tid, azimut, hoejde}]
     Fra solopgang til solnedgang på datoen (lokal tid i tidszone). Mellempunkterne ligger på hele trin
     (fx 05:00, 05:30 …), så slideren viser pæne klokkeslæt. trinMinutter er kun visningens opløsning
     (standard 30). Polarnat giver en tom liste; midnatssol giver hele døgnet fra 00:00. */
  function dagsforloeb(p){
    p=p||{};
    var lat=kraevTal(p.breddegrad,"Breddegrad",-90,90);
    var lon=kraevTal(p.laengdegrad,"Længdegrad",-180,180);
    var tz=kraevTal(p.tidszone,"Tidszone",-12,14,tidszoneTal);
    if(tom(p.dato)) throw fejl("Dato mangler (ÅÅÅÅ-MM-DD).");
    var datoMs=laesDato(p.dato);
    if(datoMs===null) throw fejl("Datoen «"+p.dato+"» er ugyldig. Brug formatet ÅÅÅÅ-MM-DD.");
    var trin=tom(p.trinMinutter)? 30 : kraevTal(p.trinMinutter,"Trin i minutter",1,1440);

    var dag=dagInfo(lat,lon,datoMs);
    if(dag.forhold==="polarnat") return [];
    // Lokale minutter efter midnat ↔ UTC-ms.
    function tilMs(min){ return datoMs+(min-tz*60)*MIN_MS; }
    function tilMin(ms){ return (ms-datoMs)/MIN_MS+tz*60; }
    function punkt(ms){
      var pos=beregnPosition(lat,lon,ms);
      return {tid:klokken(ms,tz), azimut:r2(pos.azimut)%360, hoejde:r2(pos.hoejde)};
    }
    var liste=[], start, slut, k;
    if(dag.forhold==="midnatssol"){
      for(k=0;k<1440;k+=trin) liste.push(punkt(tilMs(k)));
      return liste;
    }
    start=tilMin(dag.op); slut=tilMin(dag.ned);
    liste.push(punkt(dag.op));
    for(k=Math.ceil(start/trin)*trin;k<slut;k+=trin){
      if(k-start<1 || slut-k<1) continue;    // undgå dobbelt klokkeslæt ved sol op/ned
      liste.push(punkt(tilMs(k)));
    }
    liste.push(punkt(dag.ned));
    return liste;
  }

  return {
    solposition:solposition,
    solretning:solretning,
    skyggeInput:skyggeInput,
    dagsforloeb:dagsforloeb
  };
});
