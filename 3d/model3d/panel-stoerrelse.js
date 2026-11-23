/* Justerbare fagpaneler. Bredder gemmes pr. panel; modellen beholder mindst 320 px.
   «Fuld skærm» (ejer, 2026-11-14) er undtagelsen: panelet får hele vinduet, og 3D er skjult, til brugeren trykker
   «Vis 3D igen», vælger en bredde eller lukker panelet. Det huskes ikke: næste gang står 3D der igen. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.IssanaPanelStoerrelse=api;})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  function graense(width,workspace){var max=Math.max(140,workspace-320);return Math.max(Math.min(280,max),Math.min(max,width));}
  function installer(workspace){
    var state=workspace.__issanaPanelStoerrelse||(workspace.__issanaPanelStoerrelse={panels:[],resizeInstalleret:false});
    var panels=state.panels, key='issana-fagpanel-width-v1', saved={};
    try{saved=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch(e){}
    function gem(){try{localStorage.setItem(key,JSON.stringify(saved));}catch(e){}}
    function width(){return workspace.getBoundingClientRect().width;}
    workspace.querySelectorAll('.dock').forEach(function(panel){
      if(panel.dataset.stoerrelse)return;panel.dataset.stoerrelse='1';
      var normal=panel.classList.contains('bred')||panel.id==='page-lca'?600:440;
      var requested=Number(saved[panel.id])||normal;
      // Panelets egen standardbredde tager højst halvdelen af arbejdsfladen (ved 1024 px fik 3D kun 341 px ved siden af LCA).
      // En bredde, brugeren selv har valgt eller trukket, bruges, som den er.
      var brugerValgt=!!Number(saved[panel.id]);
      var handle=document.createElement('div');handle.className='fagpanel-greb';handle.tabIndex=0;
      handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');
      handle.setAttribute('aria-label','Juster panelets bredde');handle.title='Træk for at ændre bredde. Piletaster justerer, dobbeltklik nulstiller.';
      panel.parentNode.insertBefore(handle,panel);
      var tools=document.createElement('div');tools.className='fagpanel-tools';
      tools.innerHTML='<span>Panelbredde</span><button type="button" data-size="360">Smal</button><button type="button" data-size="normal">Normal</button><button type="button" data-size="bred">Bred</button><button type="button" data-size="fuld" aria-pressed="false" title="Giv panelet hele vinduet og skjul 3D">Fuld skærm</button><output></output>';
      var fuld=false, fuldKnap=tools.querySelector('[data-size="fuld"]');
      // Fuld skærm: panelet fylder arbejdsfladen, og 3D (med bjælken) er skjult. Klassen på arbejdsfladen skjuler dem i stilen.
      function saetFuld(til){
        fuld=!!til;
        if(panel.classList&&panel.classList.toggle)panel.classList.toggle('fagpanel-fuld',fuld);
        if(workspace.classList&&workspace.classList.toggle)workspace.classList.toggle('fagpanel-fuld',fuld);
        if(fuldKnap&&fuldKnap.setAttribute){fuldKnap.setAttribute('aria-pressed',fuld?'true':'false');fuldKnap.textContent=fuld?'Vis 3D igen':'Fuld skærm';fuldKnap.title=fuld?'Vis 3D ved siden af panelet igen':'Giv panelet hele vinduet og skjul 3D';}
        update();
        // 3D får sin plads tilbage: visningen måler sig selv igen.
        if(!fuld&&typeof window!=='undefined'&&window.dispatchEvent&&typeof Event==='function'){try{window.dispatchEvent(new Event('resize'));}catch(e){}}
      }
      panel.insertBefore(tools,panel.firstChild);
      function update(){
        var visible=!panel.classList.contains('hidden');handle.hidden=!visible||fuld;
        // Et lukket panel tager ikke 3D med sig: fuld skærm slutter, når panelet lukkes.
        if(!visible){if(fuld)saetFuld(false);return;}
        if(fuld){panel.style.setProperty('width','auto','important');tools.querySelector('output').textContent='hele vinduet';return;}
        var oensket=brugerValgt?requested:Math.min(requested,Math.max(280,Math.floor(width()*0.5)));
        var n=Math.round(graense(oensket,width()));panel.style.setProperty('width',n+'px','important');
        handle.setAttribute('aria-valuemin',Math.min(280,Math.max(140,width()-320)));
        handle.setAttribute('aria-valuemax',Math.max(140,width()-320));handle.setAttribute('aria-valuenow',n);
        tools.querySelector('output').textContent=n+' px';
      }
      function set(n){requested=n;brugerValgt=true;saved[panel.id]=n;gem();update();}
      tools.onclick=function(e){var b=e.target.closest('[data-size]');if(!b)return;var s=b.dataset.size;
        if(s==='fuld'){saetFuld(!fuld);return;}
        if(fuld)saetFuld(false);   // en bredde vælges: 3D kommer tilbage
        set(s==='normal'?normal:s==='bred'?Math.min(900,width()-320):Number(s));};
      handle.ondblclick=function(){set(normal);};
      handle.onkeydown=function(e){var n=parseFloat(panel.style.width)||normal;if(e.key==='ArrowLeft')set(n+24);else if(e.key==='ArrowRight')set(n-24);else if(e.key==='Home')set(normal);else if(e.key==='End')set(width()-320);else return;e.preventDefault();};
      handle.onpointerdown=function(e){if(e.button!==0)return;e.preventDefault();var x=e.clientX,n=panel.getBoundingClientRect().width;handle.setPointerCapture(e.pointerId);
        handle.onpointermove=function(ev){brugerValgt=true;requested=graense(n+x-ev.clientX,width());update();};
        function end(){handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null;set(requested);}
        handle.onpointerup=end;handle.onpointercancel=end;
      };
      panels.push(update);
      new MutationObserver(update).observe(panel,{attributes:true,attributeFilter:['class']});update();
    });
    if(!state.resizeInstalleret){
      window.addEventListener('resize',function(){panels.forEach(function(f){f();});});
      state.resizeInstalleret=true;
    }
  }
  return {graense:graense,installer:installer};
});
