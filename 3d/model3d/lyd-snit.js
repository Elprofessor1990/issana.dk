/* ISSANA 3D: pixelbaseret lydsnit. Regner ikke lyd; sammenstiller relationer fra
   lyd-analyse.js med de eksisterende resultater fra lydkrav.js. */
(function(root, factory) {
  "use strict";
  var node = typeof module === "object" && module && module.exports;
  var api = factory();
  if (node) module.exports = api;
  else root.IssanaLydSnit = api;
})(typeof self !== "undefined" ? self : this, function() {
  "use strict";

  var FARVE = {
    opfyldt: "#4a7c59", opfyldt_forbehold: "#4a7c59", ikke_opfyldt: "#c65a2e",
    mangler_input: "#c99a2e", ikke_relevant: "#98a29c"
  };
  var RANG = { ikke_opfyldt: 4, mangler_input: 3, opfyldt_forbehold: 2, opfyldt: 1, ikke_relevant: 0 };
  var CSS = [
    ".lyd-snit-boks{display:grid;gap:7px;min-width:0;max-width:100%;overflow:hidden;container-type:inline-size}",
    ".ls-snitoverskrift{font-size:12px;font-weight:700;color:var(--text)}",
    ".ls-overblik{display:grid;grid-template-columns:minmax(0,1fr) 92px;gap:7px}",
    ".ls-oversigt,.ls-noeglefelt,.ls-detalje{border:1px solid var(--border);border-radius:8px;background:var(--bg-paper);overflow:hidden}",
    ".ls-oversigt{min-height:150px}.ls-oversigt svg{height:auto}.ls-noeglefelt{height:70px;align-self:start}.ls-detalje{height:200px}",
    ".lyd-snit-boks svg{width:100%;height:100%;display:block}.ls-oversigt svg{min-height:150px}",
    ".lyd-snit-boks text{fill:var(--text);font-family:system-ui,-apple-system,\"Segoe UI\",sans-serif}",
    ".ls-rum{stroke:var(--border);stroke-width:1.5;cursor:pointer}",
    ".ls-rum.on{stroke:var(--accent);stroke-width:4}.ls-rum.aktiv{stroke:var(--accent);stroke-width:3}",
    ".ls-rumtype-mangler{stroke:#c99a2e;stroke-dasharray:5 4}",
    ".ls-detailrum{fill:var(--bg-elev);stroke:var(--border);stroke-width:1.5;cursor:pointer}",
    ".ls-detailrum.on{stroke:var(--accent);stroke-width:3}.ls-detailrum.aktiv{stroke:var(--accent);stroke-width:3}",
    ".ls-daek{stroke:var(--border)}.ls-pil{fill:none;stroke-width:3}.ls-pil.mangler{stroke-dasharray:6 5}",
    ".ls-muted{fill:var(--muted)!important}.ls-typeknap{fill:#c99a2e!important;font-weight:700}",
    ".ls-signatur{font-size:11px;color:var(--muted);display:flex;flex-wrap:wrap;gap:5px 10px}",
    ".ls-signatur span{display:inline-flex;align-items:center;gap:4px}",
    ".ls-signaturfarve{width:11px;height:11px;border-radius:2px;border:1px solid var(--border)}",
    ".ls-signaturkant{width:12px;height:10px;border:2px solid var(--text);border-radius:2px}",
    ".ls-signaturstiplet{width:12px;height:10px;border:2px dashed #c99a2e;border-radius:2px}",
    ".ls-resultater{display:grid;gap:4px;min-width:0;max-width:100%;overflow:hidden}",
    ".ls-resultat-titel{font-size:11px;color:var(--muted);margin-top:3px}",
    ".ls-resultat{display:grid;grid-template-columns:minmax(105px,.8fr) minmax(130px,1fr) minmax(130px,1fr) auto}",
    ".ls-resultat{gap:7px;align-items:center;padding:6px;border:1px solid var(--border);border-radius:6px}",
    ".ls-resultat{background:var(--bg-elev);font-size:11px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden}",
    ".ls-resultat:hover,.ls-resultat.on{border-color:var(--accent)}",
    ".ls-resultat-navn{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".ls-maaling{display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px;align-items:center;min-width:0}",
    ".ls-maalingtop{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}",
    ".ls-maalingstekst{min-width:0;color:var(--muted);overflow-wrap:normal;word-break:normal}",
    ".ls-status{display:inline-grid;place-items:center;flex:0 0 18px;width:18px;height:18px;border-radius:50%;color:white;font-weight:800;font-size:11px}",
    ".ls-handling{white-space:nowrap}",
    ".ls-ov-smal,.ls-ov-mellem{display:none}",
    "@container (max-width:1000px){.ls-ov-bred{display:none}.ls-ov-mellem{display:block}}",
    "@container (max-width:700px){.ls-ov-mellem{display:none}.ls-ov-smal{display:block}}",
    "@container (max-width:559px){.ls-overblik{grid-template-columns:1fr}.ls-noeglefelt{width:90px;justify-self:end}}",
    "@container (max-width:559px){.ls-resultat{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}",
    "@container (max-width:559px){.ls-resultat-navn{grid-column:1/-1}.ls-maaling{grid-template-columns:1fr;gap:2px}}",
    "@container (max-width:559px){.ls-handling{grid-column:1/-1;justify-self:end}.ls-detalje{height:200px}}"
  ].join("");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>\"]/g, function(c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c];
    });
  }
  function fmt(n, d) {
    if (n == null || !isFinite(n)) return "?";
    try {
      return Number(n).toLocaleString("da-DK", {
        minimumFractionDigits: d || 0, maximumFractionDigits: d == null ? 1 : d
      });
    } catch (e) { return String(n); }
  }
  function pts(r) {
    var ud = [];
    (r && r.meshes || []).forEach(function(m) {
      var p = m && m.pos || [];
      for (var i = 0; i + 2 < p.length; i += 3) ud.push([p[i], p[i + 1], p[i + 2]]);
    });
    return ud;
  }
  function boks(r) {
    var p = pts(r), x0 = Infinity, y0 = Infinity, z0 = Infinity;
    var x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    p.forEach(function(q) {
      x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]);
      y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
      z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
    });
    if (x0 === Infinity) return null;
    return { x0: x0, x1: x1, y0: y0, y1: y1, z0: z0, z1: z1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  function navn(r) {
    return ((r.number ? r.number + " " : "") + (r.name || "")).trim() || "Rum " + r.id;
  }
  function bedom(v, k, mangler, forbehold) {
    if (mangler && mangler.length || v == null || !k || k.vaerdi == null && !k.kraevesIkke) return "mangler_input";
    if (k.kraevesIkke) return "ikke_relevant";
    var ok = k.retning === "max" ? v <= k.vaerdi : v >= k.vaerdi;
    return ok ? (forbehold && forbehold.length ? "opfyldt_forbehold" : "opfyldt") : "ikke_opfyldt";
  }
  function tegn(status) {
    if (status === "opfyldt" || status === "opfyldt_forbehold") return "✓";
    return status === "ikke_opfyldt" ? "✕" : "?";
  }
  function rmMap(resultater) {
    var map = {};
    (resultater || []).forEach(function(r) { map[String(r.rumId)] = r; });
    return map;
  }
  function rumtype(info, id) {
    var x = info[String(id)] || {};
    return { id: x.rfId || null, navn: x.rumfunktion && x.rumfunktion.navn || x.rfNavn || null };
  }
  function mangelTekst(del, x, manglerType) {
    if (manglerType) return "vælg rumtype";
    var m = x && x.mangler && x.mangler[0];
    if (m) {
      if (/Ln,w|dæk|daek/i.test(m)) return del === "trin" ? "mangler dækkets L’n,w" : "dokumentér R’w for dækket";
      return m;
    }
    if (!x || !x.krav || x.krav.vaerdi == null) return "kravet er ikke fastlagt";
    return null;
  }
  function lyd(del, x, manglerType) {
    var mangel = mangelTekst(del, x, manglerType);
    if (mangel) return { status: "mangler_input", tekst: mangel, mangler: true, tegn: "?" };
    var k = x.krav, retning = k.retning === "max" ? "≤" : "≥";
    return {
      status: x.status, tekst: fmt(x.vaerdi, 1) + " dB · krav " + retning + " " + fmt(k.vaerdi, 0),
      mangler: false, tegn: tegn(x.status)
    };
  }

  function standardRum(rum, bokse, resultater) {
    var med = rum.filter(function(r) { return bokse[String(r.id)]; });
    var kandidater = med.map(function(r) {
      var q = resultater[String(r.id)], t = q && q.dele && q.dele.trinlyd;
      var margin = t && t.vaerdi != null && t.krav && t.krav.vaerdi != null ? t.vaerdi - t.krav.vaerdi : -Infinity;
      return { rum: r, status: t && t.status || "ikke_relevant", margin: margin };
    }).filter(function(x) { return x.status !== "ikke_relevant"; });
    kandidater.sort(function(a, b) { return RANG[b.status] - RANG[a.status] || b.margin - a.margin; });
    if (kandidater.length) return kandidater[0].rum;
    var levels = {};
    med.forEach(function(r) {
      var b = bokse[String(r.id)], x = levels[String(r.level || "")];
      if (!x) x = levels[String(r.level || "")] = { z: b.z0, rum: [] };
      x.rum.push(r);
    });
    var ls = Object.keys(levels).map(function(k) { return levels[k]; }).sort(function(a, b) { return a.z - b.z; });
    var midt = ls[Math.floor((ls.length - 1) / 2)] || { rum: med };
    return midt.rum.slice().sort(function(a, b) { return (Number(b.area) || 0) - (Number(a.area) || 0); })[0] || null;
  }
  function elementNavne(model) {
    var map = {};
    (model && model.elements || []).forEach(function(e) {
      map[String(e.id)] = e.type || e.name || e.category || "Etageadskillelse";
    });
    return map;
  }

  function byg(model, resultater, analyse, valg) {
    valg = valg || {};
    var alle = model && model.rooms ? model.rooms.slice() : [];
    var rm = rmMap(resultater), info = analyse && analyse.rum || {}, bokse = {}, delnavne = elementNavne(model), elementer = {};
    (model&&model.elements||[]).forEach(function(e){elementer[String(e.id)]=e;});
    alle.forEach(function(r) { bokse[String(r.id)] = boks(r); });
    var valgt = alle.filter(function(r) { return String(r.id) === String(valg.rumId); })[0];
    valgt = valgt || standardRum(alle, bokse, rm);
    if (!valgt) return { rumId: null, rum: [], etager: [], sager: [], detail: { over: [], midt: null, under: [] } };
    var retning = valg.retning === "y" ? "y" : "x", vb = bokse[String(valgt.id)];
    var snitlinje = retning === "x" ? vb.cy : vb.cx;
    function rammer(b) {
      if (!b) return false;
      return retning === "x" ? snitlinje >= b.y0 - .01 && snitlinje <= b.y1 + .01 : snitlinje >= b.x0 - .01 && snitlinje <= b.x1 + .01;
    }
    function rumData(r) {
      var b = bokse[String(r.id)], t = rumtype(info, r.id);
      return {
        id: r.id, navn: navn(r), niveau: r.level || "", a: retning === "x" ? b.x0 : b.y0,
        b: retning === "x" ? b.x1 : b.y1, z0: b.z0, z1: b.z1, areal: r.area || 0,
        rumfunktion: t.id, rumfunktionNavn: t.navn, manglerType: !t.id,
        resultat: rm[String(r.id)] || null, boks: b
      };
    }
    var rum = alle.filter(function(r) { return rammer(bokse[String(r.id)]); }).map(rumData);
    var rumDataMap = {};
    alle.forEach(function(r) { rumDataMap[String(r.id)] = rumData(r); });
    var stakke = [], set = {};
    if (analyse && analyse.overFor) {
      Object.keys(analyse.overFor).forEach(function(ned) {
        (analyse.overFor[ned] || []).forEach(function(x) {
          (x.over || []).forEach(function(over) {
            var del=elementer[String(x.delId)], key=[ned,over,x.delId].map(String).join('|');
            if(String(ned)!==String(over)&&!set[key]&&rumDataMap[ned]&&rumDataMap[String(over)]&&(!del||del.category==='Gulve'||del.category==='Tage')&&!/trappe|repose|landing/i.test(del&&(del.type||del.name)||'')){set[key]=1;stakke.push({ ned: rumDataMap[ned].id, over: over, daekId: x.delId });}
          });
        });
      });
    }
    var sager = stakke.map(function(p) { return lavSag(p, rumDataMap, delnavne); });
    function unikke(liste){var set={};return liste.filter(function(r){if(!r||set[String(r.id)])return false;set[String(r.id)]=1;return true;});}
    var over = unikke(stakke.filter(function(x) { return String(x.ned) === String(valgt.id); })
      .map(function(x) { return rumDataMap[String(x.over)]; }));
    var under = unikke(stakke.filter(function(x) { return String(x.over) === String(valgt.id); })
      .map(function(x) { return rumDataMap[String(x.ned)]; }));
    var etageMap = {};
    rum.forEach(function(r) {
      var e = etageMap[r.niveau] || (etageMap[r.niveau] = { navn: r.niveau, z: r.z0, rum: [] });
      e.rum.push(r);
    });
    var etager = Object.keys(etageMap).map(function(k) { return etageMap[k]; }).sort(function(a, b) { return b.z - a.z; });
    return {
      retning: retning, snit: snitlinje, rumId: valgt.id, rum: rum, alleRum: rumDataMap,
      etager: etager, stakke: stakke, sager: sager,
      detail: { over: over, midt: rumDataMap[String(valgt.id)], under: under }
    };
  }

  function lavSag(p, rumDataMap, delnavne) {
    var ned = rumDataMap[String(p.ned)], q = ned.resultat, trinDel = q && q.dele && q.dele.trinlyd;
    var t = (trinDel && trinDel.dele || []).filter(function(x) {
      return String(x.daekId) === String(p.daekId) && (x.overIds || []).map(String).indexOf(String(p.over)) >= 0;
    })[0];
    var luftDel = q && q.dele && q.dele.luftlyd;
    var lu = (luftDel && luftDel.dele || []).filter(function(x) {
      return String(x.naboId) === String(p.over) && String(x.vaegId) === String(p.daekId);
    })[0];
    var tv = t && (t.Lnw_mark != null ? t.Lnw_mark : t.LnTw_mark);
    var trin = {
      vaerdi: tv, krav: t && (t.krav || trinDel.krav),
      status: bedom(tv, t && (t.krav || trinDel.krav), t && t.mangler || [], trinDel && trinDel.forbeholdKort),
      mangler: (t && t.mangler || []).map(function(m) { return m.tekst; })
    };
    var luft = lu ? {
      vaerdi: lu.Rw_mark, krav: lu.krav,
      status: lu.status === "opfyldt" && luftDel.forbeholdKort.length ? "opfyldt_forbehold" : lu.status,
      mangler: (lu.alleMangler || []).map(function(m) { return m.tekst; })
    } : {
      vaerdi: null, krav: luftDel && luftDel.krav, status: "mangler_input", mangler: ["dækkets luftlydisolation"]
    };
    return {
      ned: p.ned, over: p.over, daekId: p.daekId,
      daekNavn: delnavne[String(p.daekId)] || "Etageadskillelse", trin: trin, luft: luft
    };
  }
  function sag(snit, ned, over) {
    return (snit.sager || []).filter(function(s) {
      return String(s.ned) === String(ned) && String(s.over) === String(over);
    })[0] || {
      daekId: null, daekNavn: "Etageadskillelse",
      trin: { status: "mangler_input", mangler: ["dækkets opbygning"] },
      luft: { status: "mangler_input", mangler: ["dækkets opbygning"] }
    };
  }
  function resultatRaekker(snit) {
    var d = snit.detail, midt = d.midt, ud = [];
    (d.over || []).forEach(function(r) {
      ud.push({ retning: "over", rum: r, fra: r, til: midt, sag: sag(snit, midt.id, r.id) });
    });
    (d.under || []).forEach(function(r) {
      ud.push({ retning: "under", rum: r, fra: midt, til: r, sag: sag(snit, r.id, midt.id) });
    });
    return ud;
  }
  function standardNabo(snit) {
    var r = resultatRaekker(snit).slice();
    r.sort(function(a, b) {
      var sa = Math.max(RANG[a.sag.trin.status] || 0, RANG[a.sag.luft.status] || 0);
      var sb = Math.max(RANG[b.sag.trin.status] || 0, RANG[b.sag.luft.status] || 0);
      return sb - sa;
    });
    return r.length ? r[0].rum.id : null;
  }

  function kort(s, max) {
    s = String(s || "");
    return s.length > max ? s.slice(0, Math.max(1, max - 1)) + "…" : s;
  }
  function statusFyld(status) {
    return { farve: FARVE[status] || FARVE.ikke_relevant, opacity: .65 };
  }
  // Tegningen skaleres med panelet. Derfor findes den i tre bredder, så etagenavnene er mindst 10 px på skærmen.
  var OVERSIGT_BREDDER = [{ W: 460, navn: 140, tegn: 22, kl: "ls-ov-smal" }, { W: 640, navn: 170, tegn: 27, kl: "ls-ov-mellem" },
    { W: 900, navn: 190, tegn: 27, kl: "ls-ov-bred" }];
  function oversigtHtml(snit) {
    return OVERSIGT_BREDDER.map(function(b) { return '<div class="' + b.kl + '">' + oversigtSvg(snit, b) + '</div>'; }).join("");
  }
  function oversigtSvg(snit, bredde) {
    bredde = bredde || OVERSIGT_BREDDER[2];
    var W = bredde.W, NAVN = bredde.navn, H = Math.max(150,18+Math.max(1,snit.etager.length)*32), x0 = Infinity, x1 = -Infinity;
    snit.rum.forEach(function(r) { x0 = Math.min(x0, r.a); x1 = Math.max(x1, r.b); });
    if (x0 === Infinity) { x0 = 0; x1 = 1; }
    var rh = 32, top = 18;
    var scale = function(x) { return NAVN + (x - x0) / (x1 - x0 || 1) * (W - NAVN - 10); }, statusNed = {};
    snit.sager.forEach(function(s) { statusNed[String(s.over)] = s.trin.status; });
    var h = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Oversigt over lydsnittets etager">';
    snit.etager.forEach(function(e, i) {
      var y = top + i * rh;
      h += '<text x="4" y="' + (y + rh * .62) + '" font-size="11" class="ls-muted">' + esc(kort(e.navn, bredde.tegn)) +
        '<title>' + esc(e.navn) + '</title></text>';
      e.rum.forEach(function(r) {
        var a = scale(r.a), b = scale(r.b), status = statusNed[String(r.id)] || "ikke_relevant", fyld = statusFyld(status);
        var on = String(r.id) === String(snit.rumId);
        h += '<rect class="ls-rum' + (on ? ' on' : '') + (r.manglerType ? ' ls-rumtype-mangler' : '') + '" data-rum="' +
          esc(r.id) + '" x="' + a + '" y="' + y + '" width="' + Math.max(3, b - a) + '" height="' + (rh - 4) +
          '" rx="2" fill="' + fyld.farve + '" fill-opacity="' + fyld.opacity + '"><title>' + esc(r.navn) + '</title></rect>';
      });
      if (i < snit.etager.length - 1) {
        h += '<line x1="' + (NAVN - 2) + '" x2="' + (W - 6) + '" y1="' + (y + rh - 2) + '" y2="' + (y + rh - 2) + '" stroke="var(--text)" stroke-width="3"/>';
      }
    });
    return h + '</svg>';
  }

  function rumFelter(liste) {
    var gap = 6, x = 8, w = (420 - 16 - gap * (liste.length - 1)) / Math.max(1, liste.length);
    return liste.map(function(r, i) { return { rum: r, x: x + i * (w + gap), w: w }; });
  }
  function rumNavn(r) {
    var dele = String(r.navn || "").trim().split(/\s+/);
    return { nummer: dele.shift() || "", navn: dele.join(" ") };
  }
  function rumRaekke(liste, y, hgt, valgt, aktiv, tomTekst) {
    if (!liste.length) {
      var tag = tomTekst === "Tag", lineY = tag ? y + hgt - 1 : y + 1, textY = tag ? y + hgt - 4 : y + 9;
      return '<line x1="8" x2="412" y1="' + lineY + '" y2="' + lineY + '" stroke="var(--border)"/>' +
        '<text x="210" y="' + textY + '" text-anchor="middle" font-size="11" class="ls-muted">' + esc(tomTekst) + '</text>';
    }
    return rumFelter(liste).map(function(felt) {
      var r = felt.rum, xx = felt.x, w = felt.w;
      var on = String(r.id) === String(valgt), act = String(r.id) === String(aktiv), navn = rumNavn(r);
      var tegnMax = Math.max(8, Math.floor(w / 7)), cy = y + hgt / 2;
      return '<g data-rum="' + esc(r.id) + '" data-detail-nabo="' + esc(r.id) + '"><rect class="ls-detailrum' +
        (on ? ' on' : '') + (act ? ' aktiv' : '') + '" x="' + xx + '" y="' + y + '" width="' + w + '" height="' + hgt +
        '" rx="5"/><text x="' + (xx + w / 2) + '" y="' + (cy - 11) + '" text-anchor="middle" font-size="11" font-weight="700">' +
        esc(navn.nummer) + '<title>' + esc(r.navn) + '</title></text><text x="' + (xx + w / 2) + '" y="' + (cy + 2) +
        '" text-anchor="middle" font-size="11">' + esc(kort(navn.navn, tegnMax)) + '</text><text x="' + (xx + w / 2) + '" y="' +
        (cy + 16) + '" text-anchor="middle" font-size="11" class="' + (r.manglerType ? 'ls-typeknap' : 'ls-muted') + '">' +
        esc(kort(r.manglerType ? "Vælg rumtype" : r.rumfunktionNavn || r.rumfunktion, tegnMax)) + '</text></g>';
    }).join("");
  }
  function daekBaand(s, y) {
    var titel = s && s.daekNavn || "Etageadskillelse";
    return '<g data-del="' + esc(s && s.daekId || "") + '"><rect class="ls-daek" x="8" y="' + y +
      '" width="404" height="20" fill="url(#lsSkraver)"/><text x="210" y="' + (y + 14) + '" text-anchor="middle" font-size="11">' +
      esc(kort(titel, 42)) + '<title>' + esc(titel) + '</title></text></g>';
  }
  function statusCirkel(x, y, data) {
    return '<circle cx="' + x + '" cy="' + y + '" r="10" fill="' + (FARVE[data.status] || FARVE.mangler_input) + '"/>' +
      '<text x="' + x + '" y="' + (y + 4) + '" text-anchor="middle" font-size="11" font-weight="800" fill="white">' + esc(data.tegn) + '</text>';
  }
  function aktivtFelt(liste, aktiv, y, h) {
    var felter = rumFelter(liste), felt = felter.filter(function(x) { return String(x.rum.id) === String(aktiv); })[0];
    if (!felt) return null;
    return { x: felt.x, y: y, w: felt.w, h: h };
  }
  function pile(s, daekY, felt, aktiv, manglerType) {
    if (!s || !felt) return "";
    var tr = lyd("trin", s.trin, manglerType), lu = lyd("luft", s.luft, manglerType);
    var xStatus=felt.x+13, xTrin = felt.x + felt.w * .46, xLuft = felt.x + felt.w * .64;
    var top = daekY + 3, bund = daekY + 17;
    var h = '<g class="ls-lydpar" data-nabo="' + esc(aktiv) + '" data-x-status="' + xStatus + '" data-x-trin="' + xTrin + '" data-x-luft="' + xLuft + '">';
    h += '<g aria-label="Fodtrin" data-fodtrin-rum="over"><ellipse cx="' + (xTrin - 4) + '" cy="' + (top - 2) +
      '" rx="5" ry="7" fill="' + FARVE[tr.status] + '"/><ellipse cx="' + (xTrin + 7) + '" cy="' + (top - 8) +
      '" rx="4" ry="5" fill="' + FARVE[tr.status] + '"/></g>';
    h += '<path data-pil="trin" class="ls-pil' + (tr.mangler ? ' mangler' : '') + '" d="M' + xTrin + ' ' + top + ' L' + xTrin + ' ' + bund +
      '" stroke="' + FARVE[tr.status] + '" marker-end="url(#lsPil)"/>';
    h += '<path data-pil="luft" class="ls-pil' + (lu.mangler ? ' mangler' : '') + '" d="M' + xLuft + ' ' + bund + ' L' + xLuft + ' ' + top +
      '" stroke="' + FARVE[lu.status] + '" marker-end="url(#lsPil)"/>';
    var samlet=(RANG[tr.status]||0)>=(RANG[lu.status]||0)?tr:lu;
    return h + '<g data-statusmark="samlet">'+statusCirkel(xStatus, daekY + 10, samlet) + '</g></g>';
  }
  function detaljeLayout(d) {
    if (d.over.length && d.under.length) {
      return { over: [2, 48], daekOver: 52, midt: [76, 46], daekUnder: 126, under: [150, 48] };
    }
    if (d.over.length) return { over: [8, 70], daekOver: 82, midt: [106, 82], under: [188, 16] };
    if (d.under.length) return { over: [0, 16], midt: [18, 62], daekUnder: 84, under: [108, 84] };
    return { over: [0, 16], midt: [18, 164], under: [184, 16] };
  }
  function detaljeSvg(snit, aktivId) {
    var d = snit.detail, midt = d.midt;
    if (!midt) return '<svg viewBox="0 0 420 200"><text x="210" y="100" text-anchor="middle" font-size="13" class="ls-muted">Vælg et rum</text></svg>';
    var aktiv = aktivId == null ? standardNabo(snit) : aktivId;
    var raekke = resultatRaekker(snit).filter(function(r) { return String(r.rum.id) === String(aktiv); })[0];
    var overSag = raekke && raekke.retning === "over" ? raekke.sag : (d.over[0] ? sag(snit, midt.id, d.over[0].id) : null);
    var underSag = raekke && raekke.retning === "under" ? raekke.sag : (d.under[0] ? sag(snit, d.under[0].id, midt.id) : null);
    var l = detaljeLayout(d);
    var h = '<svg viewBox="0 0 420 200" role="img" aria-label="Detalje af trinlyd og luftlyd ved det valgte rum"><defs>' +
      '<pattern id="lsSkraver" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<line x1="0" y1="0" x2="0" y2="8" stroke="var(--border)" stroke-width="3"/></pattern>' +
      '<marker id="lsPil" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L0 6L7 3Z" fill="context-stroke"/></marker></defs>';
    h += rumRaekke(d.over, l.over[0], l.over[1], snit.rumId, aktiv, "Tag");
    if (d.over.length) h += daekBaand(overSag, l.daekOver);
    h += rumRaekke([midt], l.midt[0], l.midt[1], snit.rumId, aktiv, "");
    if (d.under.length) h += daekBaand(underSag, l.daekUnder);
    h += rumRaekke(d.under, l.under[0], l.under[1], snit.rumId, aktiv, "Terræn");
    if (raekke) {
      var liste = raekke.retning === "over" ? d.over : d.under;
      var pos = raekke.retning === "over" ? l.over : l.under;
      var felt = aktivtFelt(liste, aktiv, pos[0], pos[1]);
      h += pile(raekke.sag, raekke.retning === "over" ? l.daekOver : l.daekUnder, felt, aktiv,
        midt.manglerType || raekke.rum.manglerType);
    }
    return h + '</svg>';
  }

  function noegleplanSvg(model, snit) {
    var map = snit.alleRum || {}, r = map[String(snit.rumId)];
    if (!r) return "";
    var same = Object.keys(map).map(function(k) { return map[k]; }).filter(function(x) { return x.niveau === r.niveau; });
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    same.forEach(function(x) {
      var b = x.boks; x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x1); y0 = Math.min(y0, b.y0); y1 = Math.max(y1, b.y1);
    });
    var sx = function(x) { return 5 + (x - x0) / (x1 - x0 || 1) * 80; };
    var sy = function(y) { return 65 - (y - y0) / (y1 - y0 || 1) * 60; };
    var h = '<svg viewBox="0 0 90 70" aria-label="Nøgleplan med snitlinje">';
    same.forEach(function(x) {
      var b = x.boks;
      h += '<rect x="' + sx(b.x0) + '" y="' + sy(b.y1) + '" width="' + Math.max(1, sx(b.x1) - sx(b.x0)) +
        '" height="' + Math.max(1, sy(b.y0) - sy(b.y1)) + '" fill="' + (String(x.id) === String(r.id) ? 'var(--accent)' : 'var(--bg-elev)') +
        '" fill-opacity=".3" stroke="var(--border)" stroke-width=".7"/>';
    });
    if (snit.retning === "x") {
      h += '<line x1="5" x2="85" y1="' + sy(snit.snit) + '" y2="' + sy(snit.snit) + '" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 3"/>';
    } else {
      h += '<line y1="5" y2="65" x1="' + sx(snit.snit) + '" x2="' + sx(snit.snit) + '" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 3"/>';
    }
    h += '<text x="3" y="10" font-size="11" font-weight="700">A</text><text x="79" y="67" font-size="11" font-weight="700">A</text>';
    return h + '</svg>';
  }

  function maalingHtml(navn, data) {
    return '<div class="ls-maaling"><span class="ls-maalingtop"><span class="ls-status" style="background:' +
      (FARVE[data.status] || FARVE.mangler_input) + '">' + esc(data.tegn) + '</span><b>' + esc(navn) +
      '</b></span><span class="ls-maalingstekst">' + esc(data.tekst) + '</span></div>';
  }
  function resultatHtml(snit) {
    var midt = snit.detail.midt, rows = resultatRaekker(snit), aktiv = standardNabo(snit), h = '<div class="ls-resultater">';
    ["over", "under"].forEach(function(retning) {
      var gruppe = rows.filter(function(r) { return r.retning === retning; });
      if (!gruppe.length) return;
      h += '<div class="ls-resultat-titel">' + (retning === "under" ? 'Fra ' + esc(midt.navn) + ' ned til' :
        'Fra rum ovenover ned til ' + esc(midt.navn)) + '</div>';
      gruppe.forEach(function(r) {
        var manglerType = midt.manglerType || r.rum.manglerType;
        var trin = lyd("trin", r.sag.trin, manglerType), luft = lyd("luft", r.sag.luft, manglerType);
        var handling = r.rum.manglerType ? '<button class="tbtn ls-handling" data-vaelg-rumtype="' + esc(r.rum.id) + '">Vælg rumtype</button>' :
          (trin.mangler || luft.mangler) && r.sag.daekId != null ?
            '<button class="tbtn ls-handling" data-vis-daek="' + esc(r.sag.daekId) + '">Vis dæk</button>' : '';
        h += '<div class="ls-resultat' + (String(r.rum.id) === String(aktiv) ? ' on' : '') + '" data-nabo="' + esc(r.rum.id) + '">' +
          '<div class="ls-resultat-navn" title="' + esc(r.rum.navn) + '">' + esc(r.rum.navn) + '</div>' + maalingHtml("Trinlyd", trin) +
          maalingHtml("Luftlyd", luft) + handling + '</div>';
      });
    });
    return h + '</div>';
  }
  function svg(snit) {
    var midt = snit.detail.midt, n = midt ? midt.navn : "valgt rum";
    var opfyldt = statusFyld("opfyldt"), ikke = statusFyld("ikke_opfyldt");
    var mangler = statusFyld("mangler_input"), ude = statusFyld("ikke_relevant");
    return '<div class="ls-snitoverskrift">Snit gennem ' + esc(n) + '</div><div class="ls-overblik"><div class="ls-oversigt">' +
      oversigtHtml(snit) + '</div><div class="ls-noeglefelt">' + noegleplanSvg(null, snit) + '</div></div>' +
      '<div class="ls-signatur"><span><i class="ls-signaturfarve" data-status="opfyldt" style="background:' + opfyldt.farve +
      ';opacity:' + opfyldt.opacity + '"></i>✓ Opfyldt</span><span><i class="ls-signaturfarve" data-status="ikke_opfyldt" style="background:' +
      ikke.farve + ';opacity:' + ikke.opacity + '"></i>✕ Ikke i mål</span><span><i class="ls-signaturfarve" data-status="mangler_input" style="background:' +
      mangler.farve + ';opacity:' + mangler.opacity + '"></i>? Mangler data</span>' +
      '<span><i class="ls-signaturfarve" data-status="ikke_relevant" style="background:' +
      ude.farve + ';opacity:' + ude.opacity + '"></i>Ikke med</span>' +
      '<span><i class="ls-signaturstiplet"></i>mangler rumtype</span><span><i class="ls-signaturkant"></i>valgt rum</span></div>' +
      '<div class="ls-detalje" id="lydSnitDetalje">' + detaljeSvg(snit) + '</div>' + resultatHtml(snit);
  }

  return {
    CSS: CSS, FARVE: FARVE, byg: byg, svg: svg, oversigtSvg: oversigtSvg, oversigtHtml: oversigtHtml,
    detaljeSvg: detaljeSvg, noegleplanSvg: noegleplanSvg, resultatHtml: resultatHtml,
    resultatRaekker: resultatRaekker, standardNabo: standardNabo, statusFyld: statusFyld, lyd: lyd
  };
});
