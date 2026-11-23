(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else if (root && !root.issanaByggeplanBridge) root.issanaByggeplanBridge = factory(root);
})(typeof window !== 'undefined' ? window : null, function createByggeplanBridge(win) {
  'use strict';
  var doc = win.document, ar = null, api = null, frame = null, status = null;
  var registered = false, ready = false, initialized = false, disposed = false;
  var expected = new URL('byggeplan/index.html', doc.baseURI || win.location.href);
  expected.searchParams.set('v','execution-20261116c');
  var allowed = /^https?:$/.test(expected.protocol) && expected.origin === win.location.origin;

  function info(text) { if (status) status.textContent = text; }
  function aiStatus(ok, text) { info(text); frame.contentWindow.postMessage({type:'issana-byggeplan-ai-status',ok:ok,message:text},expected.origin); }
  function active() { return !!(api && typeof api.aktivtPanel === 'function' && api.aktivtPanel() === 'byggeplan'); }
  function sendModel() {
    if (!allowed || !ready || initialized || !active() || !frame || !api || typeof api.model !== 'function') return false;
    try {
      var model = api.model();
      if (!model) { info('Hent en model fra Revit for at starte byggeplanen.'); return false; }
      // postMessage takes a structured clone: the child never receives the live
      // model object, workspace API, or any Revit write capability from this bridge.
      frame.contentWindow.postMessage({type: 'issana-byggeplan-init', model: model}, expected.origin);
      initialized = true;
      info('Lokalt modeludsnit · ændringer i byggeplanen ændrer ikke Revit-modellen.');
      return true;
    } catch (error) { info('Modellen kunne ikke overføres: ' + error.message); return false; }
  }
  function userActivatedChild() {
    try { return !!(frame.contentWindow.navigator.userActivation && frame.contentWindow.navigator.userActivation.isActive); }
    catch (_) { return false; }
  }
  function message(event) {
    if (disposed || !allowed || !frame || event.source !== frame.contentWindow || event.origin !== expected.origin) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    if (data.type === 'issana-byggeplan-ready') { ready = true; sendModel(); return; }
    if(data.type==='issana-byggeplan-download'){
      if(!initialized||!active()||!(frame.contentWindow.navigator.userActivation?.hasBeenActive||userActivatedChild()))return;
      if(typeof data.name!=='string'||!/^ISSANA-[\w.-]+\.(html|json|xml|csv|tar)$/.test(data.name)||!(data.blob instanceof win.Blob)||data.blob.size>200000000){info('Eksportfilen kunne ikke modtages.');return;}
      var href=win.URL.createObjectURL(data.blob),link=doc.createElement('a');link.href=href;link.download=data.name;doc.body.appendChild(link);link.click();link.remove();win.setTimeout(function(){win.URL.revokeObjectURL(href);},60000);info('Eksporten er sendt til browserens downloads.');return;
    }
    if (data.type !== 'issana-byggeplan-ai' || !initialized || !active() || !userActivatedChild()) return;
    if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 50000) { aiStatus(false,'AI-beskeden er tom eller for lang.'); return; }
    if (!ar || !ar.ai || typeof ar.ai.spoerg !== 'function') { aiStatus(false,'AI-forbindelsen er ikke klar. Vælg en forbindelse i ISSANA AI.'); return; }
    if(ar.ai.byggeplanKontekst!==true){aiStatus(false,'Denne ISSANA AI-version understøtter ikke byggeplankontekst. Gem AI-kontekst som JSON og giv filen til Claude/Codex.');return;}
    try {
      var context=JSON.parse(data.text);
      if(context.schema!=='issana-plan-context/1'||typeof context.projectId!=='string'||!Number.isInteger(context.baseRevision))throw new Error('Ugyldig byggeplankontekst.');
      var instruction='Brug den strukturerede byggeplan i kontekst.byggeplan. Returnér normal ISSANA-envelope med forslag:[] og svar som en JSON-streng med et komplet issana-plan-proposal/1 efter responseContract. Hele svar-strengen må højst være 1900 tegn: foreslå kun 1–3 ændringer ad gangen. Ingen Revit-handlinger. Bevar ukendte værdier. Brugerens opgave: '+String(context.request||'Gennemgå fag, områder, ufordelte modeldele og afhængigheder.').slice(0,1400);
      var pending=ar.ai.spoerg(instruction,{byggeplan:context});
      if(pending&&typeof pending.catch==='function')pending.catch(function(error){aiStatus(false,'AI-beskeden kunne ikke sendes: '+error.message);});
      aiStatus(true,'Opgaven er overdraget til ISSANA AI. Se status og svar i AI-panelet.');
    } catch (error) { aiStatus(false,'AI-beskeden kunne ikke sendes: ' + error.message); }
  }
  function mount(container, workspaceApi) {
    if (disposed || frame) return;
    api = workspaceApi;
    status = doc.createElement('p');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'margin:0 0 8px;font-size:12px;line-height:1.5';
    container.appendChild(status);
    if (!allowed) { info('Byggeplanens integration kræver ISSANAs lokale HTTPS-vært. Åbn den inde i ISSANA 3D.'); return; }
    var restart = doc.createElement('button');
    restart.type = 'button'; restart.textContent = 'Start ny plan fra modellen';
    restart.style.cssText = 'margin:0 0 10px';
    restart.onclick = function () {
      if (!active() || !win.confirm('Gem din byggeplan først. Denne handling starter en ny plan fra den aktuelle model. Fortsæt?')) return;
      ready = false; initialized = false; info('Henter byggeplanen…'); frame.src = expected.href;
    };
    container.appendChild(restart);
    var expand=doc.createElement('button'),expanded=false,originalContainerStyle=container.style.cssText;
    expand.type='button';expand.textContent='Udvid byggeplan';expand.style.cssText='margin:0 0 10px 8px';expand.setAttribute('aria-pressed','false');
    expand.onclick=function(){expanded=!expanded;container.style.cssText=expanded?'position:fixed;inset:0;z-index:10000;background:#f5f7f8;padding:12px;overflow:auto':originalContainerStyle;frame.style.height=expanded?'calc(100vh - 84px)':'calc(100vh - 245px)';expand.textContent=expanded?'Tilbage til delt visning':'Udvid byggeplan';expand.setAttribute('aria-pressed',String(expanded));};
    container.appendChild(expand);
    frame = doc.createElement('iframe');
    frame.title = 'ISSANA Byggeplan · tidsplan, taktplan og 3D';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads allow-modals');
    frame.style.cssText = 'display:block;width:100%;height:calc(100vh - 245px);min-height:540px;border:0;background:#f5f7f8';
    frame.src = expected.href; container.appendChild(frame);
    info('Åbner byggeplanen…');
    if (typeof api.paa === 'function') api.paa('model', function () {
      if (disposed) return;
      if (!initialized) sendModel();
      else info('Modellen er opdateret. Gem byggeplanen, før du starter en ny plan fra modellen.');
    });
  }
  function register(workspace) {
    if (disposed || registered || !workspace || typeof workspace.registrerFane !== 'function') return false;
    ar = workspace; registered = true;
    workspace.registrerFane({id: 'byggeplan', titel: 'Byggeplan', bred: true, monter: mount, vis: function () { sendModel(); }});
    return true;
  }
  win.addEventListener('message', message);
  if (!register(win.issanaArbejdsrum)) (win.issanaArbejdsrumVentende = win.issanaArbejdsrumVentende || []).push(register);
  return {registrer: register, destroy: function () { disposed = true; win.removeEventListener('message', message); }};
});
