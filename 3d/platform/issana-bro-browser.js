/* ============================================================
   ISSANA Platform – broen til Revit fra en almindelig browser (issana-bro-browser.js)

   I Revit sætter pluginnet selv window.issanaBro ind (issana-bro.js over WebView2). I en browser gør
   denne fil det samme, men sender kaldene til ISSANA Platform på brugerens egen pc (http://127.0.0.1:4111),
   som taler med pluginnet i Revit. Siden kan derfor ligge på issana.dk og stadig hente modellen fra Revit.
   Filen sætter også en lille chat med ISSANA-agenten (Mastra) på siden.

   Adressen til platformen kan ændres med localStorage «issana-platform-url».
   ============================================================ */
(function () {
  "use strict";
  if (typeof window === "undefined" || window.issanaBro) return;
  if (window.chrome && window.chrome.webview) return; // inde i Revit: pluginnets egen bro bruges

  var lokal = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.protocol === "http:";
  var gemt = null;
  try { gemt = localStorage.getItem("issana-platform-url"); } catch (e) { /* privat tilstand */ }
  var BASE = (gemt || (lokal ? location.origin : "http://127.0.0.1:4111")).replace(/\/$/, "");
  var AGENT = "revit-agent";
  var forbundet = false, platform = false, harNoegle = null;
  var lyttere = {};

  function udsend(navn, data) {
    (lyttere[navn] || []).forEach(function (h) { try { h(data); } catch (e) { console.error("[issanaBro]", e); } });
  }
  function fejl(besked, code, method) { return Object.assign(new Error(besked), { code: code, method: method }); }

  function hent(sti, valg, ms) {
    var styr = new AbortController();
    var ur = ms > 0 ? setTimeout(function () { styr.abort(); }, ms) : null;
    return fetch(BASE + sti, Object.assign({ signal: styr.signal }, valg || {})).finally(function () { if (ur) clearTimeout(ur); });
  }

  /** Samme kontrakt som issana-bro.js: et Promise med kommandoens result, afvist med {code, message, method}. */
  function kald(method, params, valg) {
    valg = valg || {};
    if (!method || typeof method !== "string") return Promise.reject(fejl("method mangler", -32600));
    var ms = typeof valg.timeoutMs === "number" ? valg.timeoutMs : 180000;
    return hent("/revit/kald", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: method, params: params || {}, timeoutMs: ms })
    }, ms + 5000).then(function (svar) {
      return svar.json().catch(function () { return { error: { code: -32002, message: "Platformen svarede ikke med JSON (" + svar.status + ")." } }; });
    }, function (e) {
      throw fejl(e && e.name === "AbortError"
        ? "Revit svarede ikke inden " + Math.round(ms / 1000) + " s (" + method + ")."
        : "ISSANA Platform svarer ikke på " + BASE + ". Start den på din pc (npm run dev i mappen platform).", -32001, method);
    }).then(function (data) {
      if (data && data.error) throw fejl(data.error.message || "Ukendt fejl fra Revit", data.error.code, method);
      var r = data ? data.result : undefined;
      if (r && typeof r.url === "string" && r.url.charAt(0) === "/") r.url = BASE + r.url;
      return r;
    });
  }

  function tjek() {
    return hent("/revit/status", {}, 4000).then(function (s) { return s.json(); }).then(function (s) {
      platform = true; forbundet = !!(s && s.forbundet);
      harNoegle = s && typeof s.noegle === "boolean" ? s.noegle : null;
    }, function () { platform = false; forbundet = false; }).then(function () { visStatus(); udsend("status", { platform: platform, revit: forbundet }); });
  }

  window.issanaBro = {
    erRevit: function () { return forbundet; },
    kald: kald,
    paa: function (navn, handler) {
      if (typeof handler !== "function") return function () {};
      (lyttere[navn] = lyttere[navn] || []).push(handler);
      return function () { var l = lyttere[navn] || [], i = l.indexOf(handler); if (i >= 0) l.splice(i, 1); };
    },
    ping: function () { return tjek().then(function () { return { ok: platform, revit: forbundet, client: "browser", connected: forbundet }; }); },
    platform: { url: BASE, tjek: tjek, spoerg: spoerg }
  };

  // ---------- chat med agenten ----------
  var samtale = [];
  function spoerg(tekst) {
    samtale.push({ role: "user", content: tekst });
    return hent("/api/agents/" + AGENT + "/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: samtale })
    }, 300000).then(function (svar) {
      return svar.json().then(function (d) {
        if (!svar.ok) throw new Error((d && (d.error || d.message)) || ("Fejl " + svar.status));
        return d;
      });
    }).then(function (d) {
      var t = (d && d.text) || "(tomt svar)";
      samtale.push({ role: "assistant", content: t });
      return t;
    }, function (e) { samtale.pop(); throw e; });
  }

  var chip, panel, log, felt, send, noegleBoks, noegleFelt, noegleVist = false;
  function el(tag, stil, tekst) { var e = document.createElement(tag); if (stil) e.style.cssText = stil; if (tekst) e.textContent = tekst; return e; }
  function visStatus() {
    // Siden skjuler knapperne «Hent fra Revit» og «Vis i Revit» uden denne klasse (ellers sættes den kun i Revits WebView).
    if (document.body && !window.ISSANA_STUDENT_MODE) document.body.classList.toggle("issana-i-revit", forbundet);
    if (!chip) return;
    if (noegleBoks) noegleBoks.style.display = platform && (harNoegle === false || noegleVist) ? "block" : "none";
    chip.textContent = !platform ? "Platform: ikke startet" : forbundet ? "Revit: forbundet" : "Revit: ikke forbundet";
    chip.style.background = forbundet ? "#1f6f43" : platform ? "#8a6d1a" : "#7a2e2e";
    chip.title = !platform ? "ISSANA Platform kører ikke på " + BASE : forbundet ? "«Hent fra Revit» og «Gem i Revit» virker" : "Åbn Revit, og slå ISSANA MCP-forbindelsen til";
  }
  /** Viser agentens svar med enkel formatering (fed, kode, punktlister, overskrifter). Bygger kun tekstnoder, aldrig HTML. */
  function formater(b, tekst) {
    b.textContent = ""; b.style.whiteSpace = "normal";
    String(tekst).replace(/\r/g, "").split("\n").forEach(function (l) {
      var m, r = el("div");
      if (!l.trim()) { r.style.height = "6px"; b.appendChild(r); return; }
      if ((m = /^\s*#{1,6}\s+(.*)$/.exec(l))) { r.style.fontWeight = "600"; l = m[1]; }
      else if ((m = /^(\s*)(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(l))) {
        r.style.cssText = "display:flex;gap:6px;padding-left:" + (4 + m[1].length * 6) + "px";
        r.appendChild(el("span", "flex:none", m[2] ? m[2] + "." : "•"));
        var ind = el("span", "min-width:0"); r.appendChild(ind); b.appendChild(r); r = ind; l = m[3];
      }
      l.split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach(function (d) {
        if (!d) return;
        if (/^\*\*.+\*\*$/.test(d)) r.appendChild(el("b", "", d.slice(2, -2)));
        else if (/^`.+`$/.test(d)) r.appendChild(el("code", "background:#3a3a42;border-radius:4px;padding:0 4px;font-size:12px", d.slice(1, -1)));
        else r.appendChild(document.createTextNode(d));
      });
      if (!r.parentNode) b.appendChild(r);
    });
  }
  function linje(hvem, tekst) {
    var b = el("div", "margin:6px 0;padding:7px 9px;border-radius:8px;white-space:pre-wrap;word-break:break-word;" +
      (hvem === "du" ? "background:#2b4a6f;margin-left:28px" : hvem === "fejl" ? "background:#5a2626" : "background:#2d2d33;margin-right:28px"), tekst);
    log.appendChild(b); log.scrollTop = log.scrollHeight; return b;
  }
  function afsend() {
    var t = felt.value.trim(); if (!t || send.disabled) return;
    felt.value = ""; linje("du", t);
    var venter = linje("agent", "…"); send.disabled = true;
    spoerg(t).then(function (svar) { formater(venter, svar); }, function (e) {
      venter.remove(); linje("fejl", "Agenten kunne ikke svare: " + (e && e.message || e) + "\nTjek, at platformen kører, og at du har sat en API-nøgle ind (knappen «Nøgle» øverst).");
    }).then(function () { send.disabled = false; log.scrollTop = log.scrollHeight; felt.focus(); });
  }
  /** Nøglen sendes kun til platformen på denne pc, som gemmer den i platform\.env. Den gemmes ikke i browseren. */
  function gemNoegle() {
    var n = noegleFelt.value.trim(); if (!n) return;
    hent("/revit/noegle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ noegle: n }) }, 10000)
      .then(function (svar) { return svar.json().then(function (d) { if (!svar.ok) throw new Error((d && d.error && d.error.message) || ("Fejl " + svar.status)); }); })
      .then(function () { noegleFelt.value = ""; harNoegle = true; noegleVist = false; visStatus(); linje("agent", "Nøglen er gemt på din pc. Du kan skrive til agenten nu."); felt.focus(); },
        function (e) { linje("fejl", "Nøglen blev ikke gemt: " + (e && e.message || e) + (platform ? "" : "\nStart platformen på din pc først.")); });
  }
  function byg() {
    if (!document.body || window.ISSANA_STUDENT_MODE) return;
    var boks = el("div", "position:fixed;right:14px;bottom:64px;z-index:99999;font:13px/1.4 system-ui,Segoe UI,sans-serif;color:#f1f1f1;display:flex;flex-direction:column;align-items:flex-end;gap:6px");
    boks.id = "issanaPlatform";
    panel = el("div", "display:none;width:340px;max-width:90vw;height:420px;max-height:70vh;background:#1c1c20;border:1px solid #44444c;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.45);flex-direction:column;overflow:hidden");
    var hoved = el("div", "display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-bottom:1px solid #3a3a42;font-weight:600", "ISSANA-agent");
    var noegleKnap = el("button", "background:none;color:#9fc3ee;border:0;cursor:pointer;font:inherit;font-weight:400;font-size:12px;padding:0", "Nøgle");
    noegleKnap.title = "Sæt eller skift API-nøglen til agenten";
    noegleKnap.onclick = function () { noegleVist = !noegleVist; visStatus(); if (noegleBoks.style.display !== "none") noegleFelt.focus(); };
    hoved.appendChild(noegleKnap); panel.appendChild(hoved);
    log = el("div", "flex:1;overflow:auto;padding:8px 10px");
    panel.appendChild(log);
    noegleBoks = el("div", "display:none;padding:8px;border-top:1px solid #3a3a42;background:#232329");
    noegleBoks.appendChild(el("div", "font-size:12px;margin-bottom:6px;color:#c9c9d1", "Indsæt din Anthropic API-nøgle. Den gemmes kun på din egen pc (platform\\.env)."));
    var nr = el("div", "display:flex;gap:6px");
    noegleFelt = el("input", "flex:1;min-width:0;background:#26262b;color:#f1f1f1;border:1px solid #44444c;border-radius:6px;padding:6px;font:inherit");
    noegleFelt.type = "password"; noegleFelt.autocomplete = "off"; noegleFelt.placeholder = "sk-ant-…";
    noegleFelt.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); gemNoegle(); } ev.stopPropagation(); });
    var gem = el("button", "background:#2f6fb5;color:#fff;border:0;border-radius:6px;padding:0 12px;cursor:pointer;font:inherit", "Gem");
    gem.onclick = gemNoegle;
    nr.appendChild(noegleFelt); nr.appendChild(gem); noegleBoks.appendChild(nr); panel.appendChild(noegleBoks);
    linje("agent", "Spørg om den åbne Revit-model, fx «hvor mange vægge er der?». Ændringer i modellen skal du altid selv godkende i Revit.");
    var bund = el("div", "display:flex;gap:6px;padding:8px;border-top:1px solid #3a3a42");
    felt = el("textarea", "flex:1;resize:none;height:44px;background:#26262b;color:#f1f1f1;border:1px solid #44444c;border-radius:6px;padding:6px;font:inherit");
    felt.placeholder = "Skriv til agenten …";
    felt.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); afsend(); } ev.stopPropagation(); });
    send = el("button", "background:#2f6fb5;color:#fff;border:0;border-radius:6px;padding:0 12px;cursor:pointer;font:inherit", "Send");
    send.onclick = afsend;
    bund.appendChild(felt); bund.appendChild(send); panel.appendChild(bund);
    var raekke = el("div", "display:flex;gap:6px;align-items:center");
    chip = el("span", "padding:5px 9px;border-radius:999px;font-size:12px;cursor:pointer");
    chip.onclick = tjek;
    var knap = el("button", "background:#2f6fb5;color:#fff;border:0;border-radius:999px;padding:7px 14px;cursor:pointer;font:inherit;font-weight:600", "Agent");
    knap.id = "issanaAgentKnap";
    knap.onclick = function () { panel.style.display = panel.style.display === "none" ? "flex" : "none"; if (panel.style.display !== "none") felt.focus(); };
    raekke.appendChild(chip); raekke.appendChild(knap);
    boks.appendChild(panel); boks.appendChild(raekke); document.body.appendChild(boks);
    visStatus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", byg); else byg();
  tjek();
  setInterval(function () { if (!document.hidden) tjek(); }, 8000);
})();
