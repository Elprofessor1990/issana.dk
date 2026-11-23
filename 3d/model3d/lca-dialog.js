/* Guided LCA input. AI explains and asks; only validated, explicit user answers
   can populate local calculation settings. No AI-generated numbers or Revit writes. */
(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports ? require('./fag-input.js') : root.IssanaFagInput);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IssanaLcaDialog = api;
})(typeof window !== 'undefined' ? window : globalThis, function (F) {
  'use strict';
  var SCHEMA = 'issana-lca-dialog/1', seq = 0;
  var FIELDS = ['bygningstype', 'referenceareal', 'arealkilde'];
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function validate(raw, types) {
    raw = raw || {};
    var errors = {}, area = null, text = String(raw.referenceareal == null ? '' : raw.referenceareal).trim();
    if (!types.some(function (t) { return t.id === raw.bygningstype; })) errors.bygningstype = 'Vælg den anvendelse, projektet har.';
    var parsed = F ? F.tal(raw.referenceareal, {navn:'Referencearealet',positiv:true}) : {ok:false,fejl:'Talvalidering mangler. Genindlæs 3D.'};
    if (!parsed.ok) errors.referenceareal=parsed.fejl; else area=parsed.vaerdi;
    var choice=raw.arealkildeValg || 'andet', source=String(raw.arealkilde || '').trim();
    var labels={arealskema:'Brugeroplyst: kontrolleret arealskema',model:'Brugeroplyst: kontrolleret modelforslag',skoen:'Brugeroplyst: eget skøn'};
    if (!labels[choice] && choice!=='andet') errors.arealkilde='Vælg en kilde.';
    if (choice==='andet' && (!source || source.length>500)) errors.arealkilde='Beskriv din kilde eller antagelse (højst 500 tegn).';
    source=labels[choice] || 'Brugeroplyst: '+source.replace(/^Brugeroplyst: /,'');
    return {ok:Object.keys(errors).length===0, errors:errors, values:{bygningstype:raw.bygningstype,referenceareal:area,arealkilde:source}, sourceType:choice};
  }

  function create(adapter, types) {
    var state = { phase:'idle', message:'', errors:{}, raw:{}, fields:FIELDS.slice(), busy:false }, pending = null, generation = 0;
    var saving=false, model, baseline, applied = null, previous = null;
    var changed = function () {};
    function notify() { changed(state); }
    function current() { return adapter.model() === model && JSON.stringify(adapter.settings()) === JSON.stringify(baseline); }
    function cancel() { generation++; if (pending && pending.cancel) pending.cancel(); pending = null; state.busy = false; }
    function start() {
      cancel(); model = adapter.model(); baseline = copy(adapter.settings()); applied = previous = null;
      state.raw = { bygningstype:baseline.bygningstype || '', referenceareal:baseline.referenceareal && baseline.referenceareal.m2 != null ? String(baseline.referenceareal.m2).replace('.', ',') : '', arealkilde:baseline.referenceareal && baseline.referenceareal.kilde || '', arealkildeValg:baseline.referenceareal && ['model','arealskema','skoen'].indexOf(baseline.referenceareal.sourceType)>=0 ? baseline.referenceareal.sourceType : 'andet' };
      state.phase = 'questions'; state.errors = {}; state.fields = FIELDS.slice(); state.message = '';
      return ask('start');
    }
    function ask(phase) {
      if (!current()) { state.message = 'Modellen eller LCA-grundlaget er ændret. Start forfra med de aktuelle oplysninger.'; state.phase = 'stale'; notify(); return Promise.resolve(false); }
      var check = validate(state.raw, types);
      if (phase === 'svar' && !check.ok) { state.errors = check.errors; notify(); return Promise.resolve(false); }
      var id = 'lca-dialog-' + Date.now().toString(36) + '-' + (++seq), gen = ++generation;
      var request = { schema:SCHEMA, requestId:id, fase:phase, fag:'lca', omfang:'Hele projektets LCA-grundlag',
        felter:FIELDS.slice(), bygningstyper:types.map(function (t) { return {id:t.id, navn:t.navn}; }),
        grundlag:{bygningstype:baseline.bygningstype || null,referenceareal:baseline.referenceareal || null}, arealforslag:adapter.areaSuggestion(), svar:phase === 'svar' ? copy(check.values) : null };
      state.busy = true; state.errors = {}; state.message = 'Venter på den valgte AI-forbindelse i ISSANA. Hvis AI-appen åbnes med en besked, skal den sendes dér.'; notify();
      try { pending = adapter.send(request); } catch (e) { pending = { promise:Promise.reject(e) }; }
      return pending.promise.then(function (reply) {
        if (generation !== gen) return false;
        state.busy = false; pending = null;
        if (!current()) { state.phase = 'stale'; state.message = 'Grundlaget blev ændret, mens AI’en svarede. Start forfra; svaret er ikke anvendt.'; notify(); return false; }
        var a = reply && reply.afklaring;
        if (!a || a.requestId !== id || ['spoerg','klar'].indexOf(a.status) < 0) throw new Error('AI-svaret indeholder ikke en gyldig afklaring. Prøv igen, eller udfyld de almindelige LCA-felter.');
        state.message = String(reply.spoergsmaal || reply.svar || '').slice(0,2000);
        var fields = Array.isArray(a.felter) ? a.felter.filter(function (f) { return FIELDS.indexOf(f) >= 0; }) : [];
        state.fields = fields.length ? fields : FIELDS.slice();
        if (a.status === 'klar' && phase === 'svar') {
          // The response carries no values. Use the exact validated answers sent in this request.
          previous = copy(baseline);
          saving=true;
          try { adapter.save({bygningstype:check.values.bygningstype,referenceareal:{m2:check.values.referenceareal,kilde:check.values.arealkilde,origin:'user',sourceType:check.sourceType}}); } finally {saving=false;}
          var saved = adapter.settings();
          if (saved.bygningstype !== check.values.bygningstype || !saved.referenceareal || saved.referenceareal.m2 !== check.values.referenceareal || saved.referenceareal.kilde !== check.values.arealkilde)
            throw new Error('Svarene kunne ikke gemmes i LCA-grundlaget. Kontrollér felterne i Bygning.');
          baseline = copy(adapter.settings()); applied = copy(baseline); state.raw.arealkilde=check.values.arealkilde; state.phase = 'done';
          state.message = 'Dine svar er udfyldt i LCA-grundlaget. Kontrollér dem nedenfor, og ret videre i Bygning. Materialer, drift og øvrige mangler kontrolleres særskilt.';
        } else {
          state.phase = 'questions';
          // Locally missing fields must stay visible, even when the AI omits them.
          Object.keys(check.errors).forEach(function (f) { if (state.fields.indexOf(f) < 0) state.fields.push(f); });
        }
        notify(); return true;
      }).catch(function (e) {
        if (generation !== gen) return false;
        pending = null; state.busy = false; state.phase = 'questions'; state.fields = FIELDS.slice();
        state.message = (e && e.message) || String(e); notify(); return false;
      });
    }
    function undo() {
      if (!applied || !current()) { state.message = 'Der er rettet i grundlaget siden udfyldningen. Ret felterne i Bygning; nyere ændringer bliver bevaret.'; notify(); return false; }
      saving=true; try { adapter.save({ bygningstype:previous.bygningstype || null, referenceareal:previous.referenceareal || null }); } finally {saving=false;}
      baseline = copy(adapter.settings()); applied = null; state.phase = 'idle'; state.message = 'Udfyldningen er fortrudt.'; notify(); return true;
    }
    return { state:state, start:start, submit:function () { if (state.busy) return Promise.resolve(false); return ask('svar'); },
      stop:function () { cancel(); state.phase = 'idle'; state.message = 'Afbrudt. Ingen nye svar anvendes.'; notify(); }, undo:undo,
      sync:function () { if(saving) return; if (model && adapter.model() !== model) { cancel(); model=adapter.model(); applied=previous=null; state.raw={}; state.phase='idle'; state.message='Projektet er skiftet. Start med oplysningerne fra den aktuelle model.'; notify(); } else if (baseline && state.phase!=='idle' && !current()) {cancel(); applied=previous=null; state.raw={}; baseline=copy(adapter.settings()); state.phase='stale'; state.message='Grundlaget er rettet i Bygning. De tidligere dialogsvar er ryddet; dine aktuelle rettelser er bevaret.'; notify();} },
      edit:function (field, value) { if ((FIELDS.indexOf(field) >= 0 || field==='arealkildeValg') && !state.busy) state.raw[field] = value; },
      onChange:function (fn) { changed = fn; }, suggestion:function () { return adapter.areaSuggestion(); } };
  }
  var STYLE = '.lca-dialog{margin:12px 0;padding:16px;border:1px solid var(--line,#dce4e3);border-left:4px solid var(--accent,#115457);border-radius:8px;background:var(--panel,#fff);color:inherit}.lca-dialog h3{margin:0 0 6px}.lca-dialog p{margin:6px 0 12px;line-height:1.5}.lca-dialog label{display:block;margin:12px 0}.lca-dialog label>span{display:block;font-weight:600;margin-bottom:5px}.lca-dialog input,.lca-dialog select{display:block;box-sizing:border-box;width:100%;min-width:0;font:inherit;padding:9px;border:1px solid #b5c5c5;border-radius:5px;background:var(--panel,#fff);color:inherit}.lca-dialog small{display:block;margin-top:5px;line-height:1.5}.lca-dialog .ld-error{color:#a13226}.lca-dialog .ld-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.lca-dialog button{white-space:normal;border:1px solid #b5c5c5;border-radius:5px;padding:8px 12px;font:inherit;color:inherit;background:var(--panel,#fff)}.lca-dialog button.primary{background:#115457;color:white;border-color:#115457}.lca-dialog :focus-visible{outline:2px solid #15757a;outline-offset:2px}.lca-dialog dl{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,2fr);gap:8px}.lca-dialog dd{margin:0;overflow-wrap:anywhere}.lca-dialog [role=status]{overflow-wrap:anywhere}';
  function mount(host, adapter, types) {
    var controller = create(adapter, types), doc = host.ownerDocument;
    if (!doc.getElementById('lcaDialogStyle')) { var style = doc.createElement('style'); style.id='lcaDialogStyle'; style.textContent=STYLE; doc.head.appendChild(style); }
    function field(id, title, input, hint) {
      return '<label><span>'+title+'</span>'+input+(hint?'<small>'+hint+'</small>':'')+(controller.state.errors[id]?'<small class="ld-error" role="alert">'+esc(controller.state.errors[id])+'</small>':'')+'</label>';
    }
    function render(s) {
      var h='<section class="lca-dialog" aria-label="LCA med spørgsmål"><h3>Udfyld med ISSANA</h3>';
      if(s.phase==='idle'||s.phase==='stale') h+='<p>Tag udgangspunkt i modellen. Besvar spørgsmål om bygningstype og areal, og få svarene udfyldt i LCA. Du kan rette dem bagefter.</p><button class="tbtn" data-ld="start">Start med spørgsmål</button>';
      if(s.message) h+='<p role="status">'+esc(s.message)+'</p>';
      if(s.busy) h+='<button class="tbtn" data-ld="stop">Afbryd</button>';
      else if(s.phase==='questions') {
        h+='<p><small>Svarene gælder hele projektet. Udfyldning gemmer ikke i Revit.</small></p><form data-ld-form>';
        if(s.fields.indexOf('bygningstype')>=0) h+=field('bygningstype','Hvad bruges bygningen til?', '<select name="bygningstype"><option value="">Vælg anvendelse …</option>'+types.map(function(t){return '<option value="'+esc(t.id)+'"'+(s.raw.bygningstype===t.id?' selected':'')+'>'+esc(t.navn)+'</option>';}).join('')+'</select>');
        if(s.fields.indexOf('referenceareal')>=0) {
          var suggestion=controller.suggestion(), hint=suggestion&&suggestion.m2>0?'Modellens forslag: '+esc(String(suggestion.m2).replace('.', ','))+' m². Kontrollér, at det er det relevante referenceareal.':'';
          h+=field('referenceareal','Hvilket referenceareal skal bruges?', '<input name="referenceareal" inputmode="decimal" value="'+esc(s.raw.referenceareal)+'" autocomplete="off">', 'm²'+(hint?' · '+hint:''));
        }
        if(s.fields.indexOf('arealkilde')>=0) h+=field('arealkilde','Hvor kommer arealet fra?', '<select name="arealkildeValg">'+[['arealskema','Kontrolleret arealskema'],['model','Modelforslag kontrolleret af mig'],['skoen','Eget skøn'],['andet','Andet']].map(function(x){return '<option value="'+x[0]+'"'+(s.raw.arealkildeValg===x[0]?' selected':'')+'>'+x[1]+'</option>';}).join('')+'</select><input name="arealkilde" maxlength="500" value="'+esc(s.raw.arealkilde)+'" placeholder="Beskrivelse ved Andet">','Kilden er oplyst af dig og kontrolleres ikke automatisk.');
        h+='<div class="ld-actions"><button class="tbtn primary" type="submit">Send svar og udfyld</button><button class="tbtn" type="button" data-ld="stop">Afbryd</button></div></form>';
      } else if(s.phase==='done') {
        var label=types.filter(function(t){return t.id===s.raw.bygningstype;})[0];
        h+='<dl><dt>Bygningstype</dt><dd>'+esc(label?label.navn:s.raw.bygningstype)+'</dd><dt>Referenceareal</dt><dd>'+esc(s.raw.referenceareal)+' m²</dd><dt>Kilde</dt><dd>'+esc(s.raw.arealkilde)+'</dd><dt>Udfyldt fra</dt><dd>Dine svar</dd></dl><div class="ld-actions"><button class="tbtn" data-ld="edit">Ret svar</button><button class="tbtn" data-ld="undo">Fortryd udfyldning</button></div>';
      }
      host.innerHTML=h+'</section>';
      host.querySelectorAll('[data-ld]').forEach(function(b){b.onclick=function(){var action=b.getAttribute('data-ld'); if(action==='start'||action==='edit') controller.start(); else if(action==='undo') controller.undo(); else controller.stop();};});
      var form=host.querySelector('form');
      if(form) { form.oninput=function(e){controller.edit(e.target.name,e.target.value);}; form.onchange=form.oninput;
        form.onsubmit=function(e){e.preventDefault(); form.querySelectorAll('[name]').forEach(function(el){controller.edit(el.name,el.value);}); controller.submit();}; }
    }
    controller.onChange(render); render(controller.state); return controller;
  }
  return {schema:SCHEMA,validate:validate,create:create,mount:mount};
});
