/* Isolated teaching mode. The host owns only the fixed exercise assets and a namespaced draft. */
(function(root){
 'use strict';
 var boot=root.ISSANA_STUDENT_BOOTSTRAP, doc=root.document;
 var allowedAssets=['lydkrav.json'];
 function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function clone(x){return JSON.parse(JSON.stringify(x));}
 function validateBundle(p){
  if(!p||!p.manifest||p.manifest.schema!=='issana-student-exercise/1'||!/^[-a-z0-9]{1,60}$/.test(p.manifest.id||''))throw Error('Filen mangler en gyldig øvelsesbeskrivelse.');
  if(p.manifest.id!=='to-rum-01')throw Error('Denne visning åbner to-rumsøvelsen (to-rum-01).');
  if(p.manifest.version!==2)throw Error('Denne version af øvelsen understøttes ikke.');
  if(!p.model||!Array.isArray(p.model.elements)||!Array.isArray(p.model.rooms)||!Array.isArray(p.model.types))throw Error('Øvelsen mangler 3D-model, rum eller typer.');
  if(!p.model.exercise||p.model.exercise.synthetic!==true)throw Error('Kun tydeligt markerede, syntetiske øvelsesmodeller kan åbnes her.');
  if(p.model.elements.length>10000)throw Error('Øvelsen er for stor til denne visning.');
  if(!p.reference||p.reference.schema!=='issana-student-reference/1'||p.reference.exerciseId!==p.manifest.id)throw Error('Øvelsens reference mangler.');
  if(!p.manifest.steps||!['lyd','energi','lca'].every(function(id){return p.manifest.steps.some(function(s){return s.id===id&&s.calculation;});}))throw Error('Øvelsens beregningsgrundlag mangler.');
  return p;
 }
 function normalizeLca(rust){
  if(!rust||typeof rust!=='object'||!rust.modules_kgco2e)throw Error('LCA-motoren returnerede ikke et beregningsresultat.');
  var modules={};['A1-A3','A4','A5','B4','B6','C3','C4','D'].forEach(function(k){var n=rust.modules_kgco2e[k];if(typeof n==='number'&&isFinite(n))modules[k]=n;});
  if(!Object.keys(modules).length)throw Error('LCA-motorens svar indeholder ingen tal.');
  function messages(items){return Array.isArray(items)?items.slice(0,40).map(function(x){return String(typeof x==='string'?x:x&&(x.message||x.text)||JSON.stringify(x)).slice(0,2000);}):[];}
  var missing=messages(rust.missing_items);if(!missing.length)missing=messages(rust.missing);
  return {modules:modules,status:typeof rust.status==='string'?rust.status:'ukendt',warnings:messages(rust.warnings),missing:missing,missingCount:Array.isArray(rust.missing_items)||Array.isArray(rust.missing)?missing.length:null};
 }
 // The sandbox selects only a bundled dataset key. The host constructs a fixed material slice;
 // all numerical CO2 calculation remains in the existing Rust engine.
 var MATERIAL_KEYS=['#B1425@24','#B1433@25'];
 function materialProject(template,catalogue,key){
  if(MATERIAL_KEYS.indexOf(key)<0)throw Error('Materialet findes ikke i øvelsens valg.');
  var row=catalogue&&Array.isArray(catalogue.materials)&&catalogue.materials.find(function(x){return x.key===key;});
  if(!row||row.declared_unit!=='m³'||row.declared_factor!==1||!Number.isFinite(row.a1a3))throw Error('Øvelsens materialedatasæt mangler eller har en anden enhed.');
  var p=clone(template), bm=p.building_model;
  if(!bm)throw Error('Øvelsens LCA-skabelon mangler.');
  var construction=bm.constructions.find(function(x){return x.id==='k-indervaegge-3002';});
  var product=bm.products.find(function(x){return x.id==='p-indervaegge-3002-0';});
  if(!construction||!product||construction.quantity!==14||product.amount!==0.2)throw Error('Øvelsens faste mængdegrundlag er ændret.');
  var source=bm.environmental_data.find(function(x){return x.id===product.environmental_data_id;});
  if(!source)throw Error('Øvelsens miljødata mangler.');
  source.dataset_id=source.catalogue_key=key;source.dataset_name=product.name=row.name_da;
  var P=typeof module==='object'&&module.exports?require('./lca-projekt.js'):root.IssanaLcaProjekt;
  if(!P)throw Error('LCA-projektmodulet er ikke indlæst.');
  source.source=P.kildeTekst(catalogue,row);
  source.modules={};['a1a3','c3','c4','d'].forEach(function(k){source.modules[k]=Number.isFinite(row[k])?{status:'declared',value:row[k]}:{status:'not_declared'};});
  bm.parts=bm.parts.filter(function(x){return x.id===construction.part_id;});bm.constructions=[construction];bm.products=[product];bm.environmental_data=[source];
  p.name='ØVELSE · materialeudsnit · '+row.name_da;p.energy=[];p.b6_supplies=[];p.installations=null;p.process=null;p.process_defaults=null;
  p.b6_not_applicable_reason=null;
  return p;
 }
 if(typeof module==='object'&&module.exports){module.exports={validateBundle:validateBundle,normalizeLca:normalizeLca,materialProject:materialProject};return;}
 if(!doc)return;
 if(boot){
  // A sandboxed frame has an opaque origin: no parent DOM, cookies or native localStorage.
  // Existing discipline modules receive a private in-memory store, persisted by the host under ONE exercise key.
  root.ISSANA_STUDENT_MODE=true;
  var memory=boot.storage&&typeof boot.storage==='object'?clone(boot.storage):{};
  var store={getItem:function(k){return Object.prototype.hasOwnProperty.call(memory,k)?memory[k]:null;},setItem:function(k,v){memory[String(k)]=String(v);persist();},removeItem:function(k){delete memory[k];persist();},clear:function(){memory={};persist();},key:function(i){return Object.keys(memory)[i]||null;}};
  Object.defineProperty(store,'length',{get:function(){return Object.keys(memory).length;}});
  Object.defineProperty(root,'localStorage',{value:store,configurable:false});
  var blocked=function(){return Promise.reject(Error('Øvelsestilstand har ingen forbindelse til Revit.'));};
  Object.defineProperty(root,'issanaBro',{value:Object.freeze({erRevit:function(){return false;},kald:blocked}),writable:false,configurable:false});
  root.fetch=function(url){var name=String(url).split('/').pop().split('?')[0];if(allowedAssets.indexOf(name)>=0&&boot.assets&&boot.assets[name])return Promise.resolve(new Response(JSON.stringify(boot.assets[name]),{headers:{'Content-Type':'application/json'}}));return Promise.resolve(new Response('{}',{status:404}));};
  root.ISSANA_LYDKRAV=boot.assets&&boot.assets['lydkrav.json'];
  function persist(){var text=JSON.stringify(memory);if(text.length<=2000000)root.parent.postMessage({type:'issana-student-store',token:boot.token,storage:memory},'*');}
  function leave(){root.parent.postMessage({type:'issana-student-close',token:boot.token},'*');}
  var answers={};try{answers=JSON.parse(store.getItem('student.answers')||'{}');}catch(e){}
  var exercise=clone(boot.model), api=null, pane=null, step=1, subject='lyd', selected='1001', result=null, error='',teacher={pending:false,result:null,error:null},requestNo=0,material={pending:false,requestId:null,product:null};
  function lesson(id){return boot.manifest.steps.find(function(s){return s.id===id;});}
  function field(id){return boot.manifest.steps.flatMap(function(s){return s.fields;}).find(function(f){return f.id===id;});}
  function number(n,digits){return n.toLocaleString('da-DK',{maximumFractionDigits:digits==null?2:digits});}
  exercise.modelKey='student:'+boot.manifest.id+':v'+boot.manifest.version;exercise.model='ØVELSE · '+boot.manifest.title;
  function save(){store.setItem('student.answers',JSON.stringify(answers));}
  function apply(){
   var t=exercise.types.find(function(t){return t.id===field('wallRw').targetId;}),w=exercise.elements.find(function(e){return e.id===field('wallU').targetId;}),r=exercise.rooms.find(function(r){return r.id===field('roomT').targetId;});
   if(t&&answers.wallRw!=null){t.bygdata=t.bygdata||{};var td=t.bygdata.data=t.bygdata.data||{schema:'issana-bygdata/1'};td.lyd=td.lyd||{};td.lyd.dokumenteret={vaerdi:answers.wallRw,enhed:'dB',kilde:'Syntetisk øvelsesværdi – ingen prøvningsrapport',metode:'undervisningsantagelse',origin:'exercise'};(t.bygdata.raw||(t.bygdata.raw={}))['ISSANA Data']=JSON.stringify(td);}
   if(w&&answers.wallU!=null){w.uValue=answers.wallU;w.uValueSource='exercise';}
   if(r&&answers.roomT!=null){r.bygdata=r.bygdata||{};var rd=r.bygdata.data=r.bygdata.data||{schema:'issana-bygdata/1'};rd.lyd=rd.lyd||{};rd.lyd.efterklang={vaerdi:answers.roomT,enhed:'s',kilde:'Syntetisk øvelsesværdi',origin:'exercise'};(r.bygdata.raw||(r.bygdata.raw={}))['ISSANA Instance Data']=JSON.stringify(rd);}
   exercise.exercise.lca=exercise.exercise.lca||{};exercise.exercise.lca.selectedCatalogueKey=answers.product||null;
  }
  function tag(kind,text){return '<span class="oe-origin oe-'+kind+'">'+esc(text)+'</span>';}
  function teacherHtml(){
   var h='<section class="oe-teacher"><h3>Gennemregnet eksempel (lærerens reference)</h3><p class="oe-note">En særskilt beregning af lærerens faste model med alle bygningsdele og oplyste A5/B6-antagelser. Den ændres ikke af dine svar ovenfor.</p>';
   if(!boot.lcaAvailable)return h+'<p class="oe-note">Den fulde ISSANA LCA-motor er ikke tilsluttet her. Åbn øvelsen i den installerede ISSANA-app for at køre lærerprojektet. Materialeudsnittet kræver også LCA-motoren.</p></section>';
   h+='<button id="oe-teacher-lca" class="oe-secondary"'+(teacher.pending?' disabled':'')+'>'+(teacher.pending?'Beregner lærerprojektet …':'Beregn lærerprojekt med ISSANA LCA')+'</button>';
   if(teacher.error)h+='<p class="oe-error" role="alert">'+esc(teacher.error)+'</p>';
   if(teacher.result){var r=teacher.result;h+='<p class="oe-note"><strong>Udkast · øvelsesdata</strong><br>Nyt svar fra ISSANA LCA-motoren. Motorstatus: '+esc(r.status)+'. '+esc(r.missingCount===0?'Ingen manglende input rapporteret':r.missingCount==null?'Mangellisten er ikke oplyst':r.missingCount+' mangler rapporteret')+'. Dette er ikke en godkendelse af bygningen.</p>';if(r.warnings.length||r.missing.length)h+='<ul class="oe-note">'+r.warnings.concat(r.missing).map(function(w){return '<li>'+esc(w)+'</li>';}).join('')+'</ul>';h+='<dl class="oe-compare">';Object.keys(r.modules).forEach(function(k){h+='<div><dt>'+esc(k)+'</dt><dd>'+esc(number(r.modules[k]))+' kg CO₂e</dd></div>';});h+='</dl>';}
   return h+'</section>';
  }
  function teacherCalculate(){if(teacher.pending||material.pending||!boot.lcaAvailable)return;teacher.pending=true;teacher.error=null;teacher.requestId='lca-'+(++requestNo);render();root.parent.postMessage({type:'issana-student-lca',token:boot.token,exerciseId:boot.manifest.id,version:boot.manifest.version,requestId:teacher.requestId,purpose:'reference'},'*');}
  function updateCalculateState(){var b=pane&&pane.querySelector('#oe-calculate');if(b){var busy=subject==='lca'&&(teacher.pending||material.pending);b.disabled=busy;b.textContent=busy?'Beregning i gang …':'Beregn og sammenlign →';}}
  root.addEventListener('message',function(e){
   var m=e.data;if(e.source!==root.parent||!m||m.token!==boot.token||m.type!=='issana-student-lca-result')return;
   if(m.requestId===teacher.requestId){teacher.pending=false;teacher.result=m.result||null;teacher.error=m.error||null;updateCalculateState();if(step===4&&subject==='lca')render();return;}
   if(m.requestId!==material.requestId)return;
   material.pending=false;updateCalculateState();
   if(subject!=='lca'||step!==3)return;
   if(m.error){error=m.error;render();return;}
   var value=m.result&&m.result.modules&&m.result.modules['A1-A3'];
   if(!Number.isFinite(value)){error='LCA-motoren returnerede ikke A1–A3 for udsnittet.';render();return;}
   var lca=lesson('lca').calculation,choice=lca.choices.find(function(x){return x.key===material.product;});
   result={title:'Materialeudsnittets klimaaftryk',value:number(value),unit:lca.unitResult,reference:number(boot.reference.lca.A1A3kgCO2e),scope:lesson('lca').scope,note:'Beregnet af ISSANA LCA (Rust): '+number(lca.quantity)+' m³ '+choice.name+'. Gennemregnet reference: 2,8 m³ × 215 kg CO₂e/m³ = 602 kg CO₂e (C20/25 SCC). Historiske 2025-data. Kun A1–A3; transport, levetid og resten af bygningen vurderes ikke her. Motorstatus: '+m.result.status+'. '+m.result.missing.concat(m.result.warnings).join(' ')};
   root.issanaLoadModel(clone(exercise));step=4;render();target();
  });
  function input(id,label,unit){return '<label class="oe-field"><span>'+esc(label)+' <small>'+esc(unit)+'</small></span><input id="oe-'+id+'" inputmode="decimal" value="'+esc(answers[id]==null?'':String(answers[id]).replace('.',','))+'" aria-describedby="oe-error">'+tag('assumed','Øvelsesantagelse')+'</label>';}
  function viewExercise(){if(!api)return;var roof=api.indeks(2008);if(roof>=0)api.skjul([roof]);setTimeout(function(){api.tilpas();},100);}
  var resizeTimer;root.addEventListener('resize',function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(viewExercise,100);});
  function target(){if(!api)return;var ids=subject==='lca'?[2007]:subject==='energi'?[2001]:(exercise.rooms.find(function(r){return String(r.id)===selected;}).graenser||[]).filter(function(g){return g.side!=='top';}).map(function(g){return g.id;});api.vaelg(ids.map(function(id){return api.indeks(id);}).filter(function(i){return i>=0;}));viewExercise();}
  function render(){if(!pane)return;
   var names={lyd:'Lyd mellem to rum',energi:'Transmission gennem en væg',lca:'Klimaaftryk for en skillevæg'};
   var h='<div class="oe-shell"><div class="oe-eyebrow">ISSANA · LÆRINGSRUM</div><h1>'+esc(boot.manifest.title)+'</h1><p class="oe-lead">En lille model. Ét fagligt valg ad gangen.</p><div class="oe-steps" aria-label="Øvelsens trin">'+['Vælg øvelse','Vælg del','Udfyld','Sammenlign'].map(function(n,i){return '<span'+(step===i+1?' class="on" aria-current="step"':'')+'><b>'+(i+1)+'</b>'+n+'</span>';}).join('')+'</div>';
   if(step===1)h+='<h2>Hvad vil du undersøge?</h2><div class="oe-choices">'+Object.keys(names).map(function(k){return '<button data-subject="'+k+'"><span>'+names[k]+'</span><span aria-hidden="true">→</span></button>';}).join('')+'</div><p class="oe-note">Alle tre øvelser bruger samme to rum. Modellen og materialetallene er til undervisning.</p>';
   if(step===2){h+='<h2>'+names[subject]+'</h2><label class="oe-field"><span>'+ (subject==='lyd'?'Modtagerrum':'Bygningsdel')+'</span><select id="oe-target">'+(subject==='lyd'?'<option value="1001"'+(selected==='1001'?' selected':'')+'>Rum A · 20 m²</option><option value="1002"'+(selected==='1002'?' selected':'')+'>Rum B · 20 m²</option>':subject==='energi'?'<option value="2001">Sydvæg A · 9,48 m² netto</option>':'<option value="2007">Skillevæg · 14 m²</option>')+'</select></label>'+tag('model','Geometri fra øvelsesmodellen')+'<p class="oe-note">Valget markeres i 3D. Træk for at dreje, og brug hjulet til at zoome.</p><button class="oe-primary" data-next>Udfyld de manglende data →</button>';}
   if(step===3){h+='<h2>Det mangler for at regne</h2><p class="oe-note">Værdierne her er dine antagelser til øvelsen. De er ikke dokumenterede produktdata.</p>';if(subject==='lyd')h+=input('wallRw','Skillevæggens Rw','dB')+input('roomT','Efterklangstid i rum A','s')+'<p class="oe-note">Lydøvelsen ser bort fra flanketransmission. Efterklangstiden gemmes som en separat rumoplysning og ændrer ikke isolationstallet her. Standardiseringens T0 = 0,5 s er et andet tal. ISSANA beregner ikke rummets efterklang.</p>';if(subject==='energi')h+=input('wallU','Sydvæggens U-værdi','W/m²K')+'<p class="oe-note">Øvelsesforudsætning: 20 °C inde og −12 °C ude. Kun den valgte væg indgår.</p>';if(subject==='lca')h+='<label class="oe-field"><span>Materialedatasæt</span><select id="oe-product"><option value="">Vælg materiale …</option>'+lesson('lca').calculation.choices.map(function(c){return '<option value="'+esc(c.key)+'"'+(answers.product===c.key?' selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select>'+tag('generic','Generiske data · ikke en produktspecifik EPD')+'</label><p class="oe-note">'+esc(number(lesson('lca').calculation.quantity))+' m³ beton. Beregnes med ISSANA LCA-motoren. Kun A1–A3 for dette materialeudsnit; ingen vurdering af hele bygningen.</p>';h+='<p id="oe-error" class="oe-error" role="alert">'+esc(error)+'</p><button class="oe-primary" id="oe-calculate"'+(subject==='lca'&&(material.pending||teacher.pending)?' disabled':'')+'>'+(subject==='lca'&&(material.pending||teacher.pending)?'Beregning i gang …':'Beregn og sammenlign →')+'</button>';}
   if(step===4&&result){h+='<h2>'+esc(result.title)+'</h2><div class="oe-result"><strong>'+esc(result.value)+'</strong><span>'+esc(result.unit)+'</span></div><p>'+esc(result.scope)+'</p><dl class="oe-compare"><div><dt>Din beregning</dt><dd>'+esc(result.value)+' '+esc(result.unit)+'</dd></div><div><dt>Reference i øvelsen</dt><dd>'+esc(result.reference)+' '+esc(result.unit)+'</dd></div></dl><p class="oe-note">'+esc(result.note)+'</p><button id="oe-edit" class="oe-primary">Prøv en anden værdi</button>'+(subject==='lca'?teacherHtml():'<button id="oe-details" class="oe-secondary">Åbn det almindelige fagpanel</button>');}
   h+='<div class="oe-footer">'+(step>1?'<button id="oe-back">← Tilbage</button>':'')+'<span>Gemt lokalt som øvelse</span><button id="oe-leave">Luk øvelse</button></div><details class="oe-sources"><summary>Hvor kommer data fra?</summary><p>'+tag('model','Model')+' Geometri i den syntetiske model.</p><p>'+tag('documented','Dokumenteret')+' Kræver en navngiven kilde; der er ingen prøvningsrapport i denne øvelse.</p><p>'+tag('generic','Generisk')+' Materialedatasæt til tidlige sammenligninger.</p><p>'+tag('assumed','Øvelsesantagelse')+' De tal, du skriver ind her.</p></details></div>';pane.innerHTML=h;pane.scrollTop=0;if(pane.parentElement)pane.parentElement.scrollTop=0;
   pane.querySelectorAll('[data-subject]').forEach(function(b){b.onclick=function(){subject=b.dataset.subject;step=2;result=null;render();target();};});
   var e=pane.querySelector('#oe-target');if(e)e.onchange=function(){if(subject==='lyd')selected=e.value;target();};
   e=pane.querySelector('[data-next]');if(e)e.onclick=function(){step=3;error='';render();};
   e=pane.querySelector('#oe-calculate');if(e)e.onclick=calculate;
   e=pane.querySelector('#oe-teacher-lca');if(e)e.onclick=teacherCalculate;
   e=pane.querySelector('#oe-back');if(e)e.onclick=function(){step--;error='';render();};
   e=pane.querySelector('#oe-edit');if(e)e.onclick=function(){step=3;render();};
   e=pane.querySelector('#oe-details');if(e)e.onclick=function(){doc.body.classList.add('student-advanced');api.skiftFane(subject);};
   pane.querySelector('#oe-leave').onclick=leave;
  }
  function calculate(){
   if(subject==='lca'&&(teacher.pending||material.pending))return;
   var fields=subject==='lyd'?[['wallRw','Rw',false],['roomT','Efterklangstid',true]]:subject==='energi'?[['wallU','U-værdi',true]]:[],values={};
   for(var i=0;i<fields.length;i++){var f=fields[i],e=pane.querySelector('#oe-'+f[0]),v=root.IssanaFagInput.tal(e.value,{navn:f[1],positiv:f[2]});if(!v.ok){pane.querySelector('#oe-error').textContent=v.fejl;e.setAttribute('aria-invalid','true');e.focus();return;}values[f[0]]=v.vaerdi;}
   if(subject==='lca'){values.product=pane.querySelector('#oe-product').value;if(MATERIAL_KEYS.indexOf(values.product)<0){pane.querySelector('#oe-error').textContent='Vælg et materialedatasæt først.';return;}}
   Object.keys(values).forEach(function(k){answers[k]=values[k];});apply();save();
   if(subject==='lyd'){
    var sound=clone(lesson('lyd').calculation.input);sound.skillevaeg.Rw=answers.wallRw;
    var r=root.IssanaLyd.luftlydMellemRum(sound);
    result={title:'Luftlyd til modtagerrummet',value:number(r.DnTw,1),unit:'dB',reference:number(boot.reference.sound.DnTwDisplayed,1),scope:lesson('lyd').scope,note:'Reference: Rw '+number(field('wallRw').answer)+' dB uden flanker. Et match med referencen er ikke en faglig godkendelse.'};
   }else if(subject==='energi'){
    var energy=clone(lesson('energi').calculation.input);energy.konstruktioner[0].u=answers.wallU;
    var en=root.IssanaEnergiBeregning.transmission(energy);
    result={title:'Varmetab gennem sydvæggen',value:number(en.dim),unit:'W',reference:number(boot.reference.energy.heatLossW),scope:lesson('energi').scope,note:'Reference: U = '+number(field('wallU').answer)+' W/m²K. Dette er ikke bygningens energiramme.'};
   }else{
    if(material.pending)return;
    if(!boot.lcaAvailable){error='ISSANA LCA-motoren er ikke tilsluttet. Åbn øvelsen i den installerede ISSANA-app for at beregne.';render();return;}
    material.pending=true;material.product=answers.product;material.requestId='lca-'+(++requestNo);error='';render();
    root.parent.postMessage({type:'issana-student-lca',token:boot.token,exerciseId:boot.manifest.id,version:boot.manifest.version,requestId:material.requestId,purpose:'material',productKey:material.product},'*');return;
   }
   root.issanaLoadModel(clone(exercise));step=4;render();target();
  }
  doc.addEventListener('DOMContentLoaded',function(){doc.body.classList.add('student-session');var home=doc.createElement('button');home.id='student-return';home.textContent='← Til øvelsen';home.onclick=function(){doc.body.classList.remove('student-advanced');api.skiftFane('oevelse');};doc.body.appendChild(home);});
  function register(ar){ar.registrerFane({id:'oevelse',titel:'Øvelse',bred:true,monter:function(el,a){pane=el;api=a;render();},vis:function(){render();}});}
  (root.issanaArbejdsrumVentende||(root.issanaArbejdsrumVentende=[])).push(register);
  var timer=setInterval(function(){if(root.issanaArbejdsrum&&root.issanaArbejdsrum.klar&&root.issanaLoadModel){clearInterval(timer);apply();root.issanaLoadModel(clone(exercise));root.issanaArbejdsrum.api.skiftFane('oevelse');viewExercise();}},100);
  return;
 }
 // Host: never replace its currently open model. A close simply removes the sandbox.
 doc.addEventListener('DOMContentLoaded',function(){var b=doc.createElement('button');b.id='btnStudent';b.className='tbtn';b.textContent='Øvelser';b.onclick=openPicker;(doc.querySelector('.tools-universal')||doc.body).appendChild(b);});
 var overlay=null,frame=null,token=null,exerciseId=null,exerciseVersion=null,lcaPending=false,lcaSeen=new Set();
 function close(){if(overlay)overlay.remove();overlay=null;frame=null;token=null;exerciseId=null;exerciseVersion=null;lcaPending=false;lcaSeen=new Set();}
 async function asset(path){var r=await fetch(path);if(!r.ok)throw Error('Øvelsesfilen kunne ikke åbnes: '+path);return r.json();}
 function openPicker(){if(overlay)return;overlay=doc.createElement('div');overlay.className='oe-overlay';overlay.innerHTML='<section class="oe-picker" role="dialog" aria-modal="true" aria-labelledby="oe-title"><div class="oe-eyebrow">ISSANA · LÆRINGSRUM</div><h1 id="oe-title">Start med to rum.</h1><p>Undersøg lyd, varmetab og et materialeudsnit i en lille 3D-model.</p><p class="oe-note">Øvelsen gemmes separat. Din åbne model bliver liggende, som den er.</p><button class="oe-primary" id="oe-start">Åbn to-rumsøvelsen →</button><p id="oe-host-error" role="alert"></p><button id="oe-cancel">Tilbage til modellen</button></section>';doc.body.appendChild(overlay);overlay.querySelector('#oe-cancel').onclick=close;overlay.querySelector('#oe-start').onclick=async function(){try{var base='data/oevelser/to-rum/',m=await asset(base+'manifest.json'),model=await asset(base+'elev.issana3d.json'),ref=await asset(base+'facit.json');await launch({manifest:m,model:model,reference:ref});}catch(e){overlay.querySelector('#oe-host-error').textContent=e.message;}};overlay.querySelector('#oe-start').focus();}
 async function launch(p){validateBundle(p);var storage={};exerciseId=p.manifest.id;exerciseVersion=p.manifest.version;try{storage=JSON.parse(localStorage.getItem('issana-student-work-v1:'+exerciseId+':v'+exerciseVersion)||'{}');}catch(e){}token=crypto.randomUUID();var assets={};for(var i=0;i<allowedAssets.length;i++)assets[allowedAssets[i]]=await asset(allowedAssets[i]);var html=await (await fetch('Revit-modelviewer.html')).text();var cfg={manifest:p.manifest,model:p.model,reference:p.reference||null,storage:storage,assets:assets,token:token,lcaAvailable:!!(root.issanaBro&&root.issanaBro.erRevit&&root.issanaBro.erRevit())};var literal=JSON.stringify(cfg).replace(/</g,'\\u003c');html=html.replace('<head>',function(){return '<head><base href="'+esc(new URL('.',location.href).href)+'"><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'; form-action \'none\'"><script>window.ISSANA_STUDENT_BOOTSTRAP='+literal+';</script>';});frame=doc.createElement('iframe');frame.id='student-frame';frame.title='Isoleret ISSANA-øvelse';frame.setAttribute('sandbox','allow-scripts');frame.srcdoc=html;overlay.innerHTML='';overlay.appendChild(frame);}
 function lcaRequest(m){
  if(m.exerciseId!==exerciseId||m.version!==exerciseVersion||typeof m.requestId!=='string'||!/^lca-[1-9][0-9]{0,5}$/.test(m.requestId))return;
  if(Object.keys(m).some(function(k){return ['type','token','exerciseId','version','requestId','purpose','productKey'].indexOf(k)<0;})||lcaSeen.has(m.requestId))return;
  if(m.purpose!=='reference'&&m.purpose!=='material')return;
  if(m.purpose==='material'&&MATERIAL_KEYS.indexOf(m.productKey)<0)return;
  if(m.purpose==='reference'&&m.productKey!=null)return;
  var destination=frame,sessionToken=token;
  if(lcaPending){destination.contentWindow.postMessage({type:'issana-student-lca-result',token:sessionToken,requestId:m.requestId,result:null,error:'En LCA-beregning er allerede i gang. Vent på svaret, og prøv igen.'},'*');return;}
  lcaPending=true;lcaSeen.add(m.requestId);
  function reply(result,error){if(frame!==destination||token!==sessionToken)return;lcaPending=false;destination.contentWindow.postMessage({type:'issana-student-lca-result',token:sessionToken,requestId:m.requestId,result:result,error:error},'*');}
  if(!root.issanaBro||!root.issanaBro.erRevit||!root.issanaBro.erRevit()){reply(null,'Den fulde LCA-motor er ikke tilsluttet.');return;}
  Promise.all([asset('data/oevelser/to-rum/laerer-lca.projekt.json'),m.purpose==='material'?asset('data/br18-tabel-7-2025.json'):Promise.resolve(null)]).then(function(values){
   var project=m.purpose==='material'?materialProject(values[0],values[1],m.productKey):values[0];
   if(!project||typeof project!=='object'||Array.isArray(project)||!project.building_model)throw Error('Lærerens LCA-projekt mangler eller er ugyldigt.');
   if(frame!==destination||token!==sessionToken)throw Error('Øvelsen er lukket.');
   return root.issanaBro.kald('issana_lca_beregn',{projekt:project},{timeoutMs:120000});
  }).then(function(rust){
   reply(normalizeLca(rust),null);
  }).catch(function(err){reply(null,err&&err.message||'Lærerprojektet kunne ikke beregnes.');});
 }
 root.addEventListener('message',function(e){
  if(!frame||e.source!==frame.contentWindow)return;
  e.stopImmediatePropagation();
  var m=e.data;if(!m||m.token!==token)return;
  if(m.type==='issana-student-close'){close();return;}
  if(m.type==='issana-student-lca'){lcaRequest(m);return;}
  if(m.type!=='issana-student-store'||!m.storage||typeof m.storage!=='object'||Array.isArray(m.storage))return;
  var keys=Object.keys(m.storage);if(keys.length>500||keys.some(function(k){return typeof m.storage[k]!=='string';}))return;
  var json=JSON.stringify(m.storage);if(json.length>2000000)return;
  try{localStorage.setItem('issana-student-work-v1:'+exerciseId+':v'+exerciseVersion,json);}catch(err){}
 },true);
})(typeof window!=='undefined'?window:this);
