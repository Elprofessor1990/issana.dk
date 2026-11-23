/* ISSANA 3D: fanen «Laster og redegørelse» i Statik og pilene i 3D. arbejdsrum-statik.js monterer den i Statik-docken.
   Reglerne, geometrien og tegningerne ligger i statik-lastmodel.js (ren logik, testet); vindens zoner i statik-vindzoner.js;
   rapporten i statik-rapport.js. Her er kun panelet, three-gruppen og knapperne. Filen indlæser selv modulerne fra sin egen mappe.

   Pilene ligger i sin egen gruppe i scenen og fjernes, så snart fanen forlades, eller docken lukkes. De tegnes ud fra modellens højdekort, så de følger
   bygningens virkelige omrids og tag. Forenklet vurdering; ingeniøren skal godkende. Intet skrives i Revit herfra. */
(function () {
  "use strict";
  var FILER = ["statik-lastmodel.js", "statik-vindzoner.js", "statik-rapport.js"];
  var mappe = (function () { var s = document.currentScript && document.currentScript.src; return s ? s.slice(0, s.lastIndexOf("/") + 1) : ""; })();
  var FORBEHOLD = "Forenklet vurdering til undervisning og tidlige faser. Ingeniøren skal godkende.";

  function advar(t) { try { console.warn("ISSANA Laster: " + t); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ---------- Tilstand ---------- */
  var L = null, V = null, S = null, api = null, kropp = null;
  var ind = null, tilf = "vind-n", etageValg = null, aaben = false;
  // Vind kan vises på to måder i 3D: som zoner (tryk og sug på hver del) eller som den samlede vandrette last.
  var vindVis = "zoner", zon = null, tagf = null, zone3d = null;
  var form = null, formFor = null, felt = null, geo = null, valg = null, res = null, gruppe = null, sidsteTerraen;

  function model() { return api && api.model ? api.model() : null; }
  function modelNoegle() { var d = model(); return (d && (d.modelKey || d.model)) || "model"; }
  function noegle() { return "issana-statik-laster-" + modelNoegle(); }
  function hentInd() {
    var g = null; try { g = JSON.parse(localStorage.getItem(noegle()) || "null"); } catch (e) {}
    ind = L.flet(L.standard(), g);
  }
  function gemInd() { try { localStorage.setItem(noegle(), JSON.stringify(ind)); } catch (e) {} }
  function hentValg() { try { var g = JSON.parse(localStorage.getItem("issana-statik-" + modelNoegle()) || "null"); return g && g.spaend ? (g.rolle = {}, g) : { spaend: {}, vaegtype: {}, rolle: {} }; } catch (e) { return { spaend: {}, vaegtype: {}, rolle: {} }; } }

  // Geometri og spændretning: fra Statik-sporets tilstand, hvis den findes, ellers fra statik.js og det, Statik har gemt.
  function opdaterGeometri() {
    var m = model(); if (!m) { form = null; return; }
    S = window.IssanaStatik || null;
    var A = window.IssanaArbejdsrumStatik, st = null;
    try { st = A && typeof A.tilstand === "function" ? A.tilstand() : null; } catch (e) { advar("Statiks tilstand kunne ikke læses: " + e.message); }
    if (formFor !== m || sidsteTerraen !== ind.terraenKote) {
      geo = (st && st.geo) || (S ? S.geometri(m) : null);
      form = L.bygningsform(m, { geo: geo, terraen: ind.terraenKote });
      formFor = m; sidsteTerraen = ind.terraenKote;
      tagf = null;
      try { tagf = V && form ? V.tagform(form, m) : null; } catch (e) { advar("Tagets form kunne ikke læses: " + e.message); }
    }
    if (!form) return;
    valg = (st && st.valg) || hentValg();
    felt = L.felter(form, st, geo, valg);
    res = L.beregn(form, m, ind, felt);
    zon = null;
    if (V) { zon = {}; ["n", "o", "s", "v"].forEach(function (r) { try { if (V.vind) res.vind[r] = V.vind(form, ind, r); zon[r] = V.zoner(form, ind, r, tagf); } catch (e) { advar("Vindzonerne kunne ikke regnes: " + e.message); } }); }
    var etager = etagerMedDaek();
    if (!etageValg || etager.indexOf(etageValg) < 0) etageValg = etager[0] || null;
  }
  function etagerMedDaek() { var e = []; (felt || []).forEach(function (f) { if (!f.terraen && e.indexOf(f.etage) < 0) e.push(f.etage); }); return e; }

  /* ---------- 3D ---------- */
  function fjernPile() {
    if (!gruppe) return;
    var T = api && api.three && api.three();
    if (T && T.scene) T.scene.remove(gruppe);
    gruppe.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    gruppe = null;
    if (api && api.render) api.render();
  }
  function pilelag(T, A, farve, aabenLag) {
    var THREE = T.THREE, n = A.pile.length, L0 = A.L, rSkaft = L0 * 0.038, rHoved = L0 * 0.11, lHoved = L0 * 0.3, Y = new THREE.Vector3(0, 1, 0), g = new THREE.Group();
    var skaftG = new THREE.CylinderGeometry(1, 1, 1, 10); skaftG.translate(0, 0.5, 0);
    var hovedG = new THREE.ConeGeometry(1, 1, 18); hovedG.translate(0, 0.5, 0);
    function lav(geom, mat) { var m = new THREE.InstancedMesh(geom, mat, n); m.frustumCulled = false; m.renderOrder = mat.depthTest ? 3 : 8; return m; }
    function matr(o) { return new THREE.MeshBasicMaterial(Object.assign({ color: farve }, o)); }
    var skaft = lav(skaftG, matr(aabenLag ? { depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 } : {})), hoved = lav(hovedG, matr(aabenLag ? { depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 } : {}));
    var bagSkaft = aabenLag ? null : lav(skaftG, matr({ depthTest: false, depthWrite: false, transparent: true, opacity: 0.25 })), bagHoved = aabenLag ? null : lav(hovedG, matr({ depthTest: false, depthWrite: false, transparent: true, opacity: 0.25 }));
    var M = new THREE.Matrix4(), q = new THREE.Quaternion(), S1 = new THREE.Vector3(), P = new THREE.Vector3();
    A.pile.forEach(function (p, i) {
      var fra = new THREE.Vector3(p.fra[0], p.fra[1], p.fra[2]), dir = new THREE.Vector3(p.til[0] - p.fra[0], p.til[1] - p.fra[1], p.til[2] - p.fra[2]), l = dir.length(); dir.normalize();
      q.setFromUnitVectors(Y, dir);
      S1.set(rSkaft, Math.max(0.01, l - lHoved), rSkaft); M.compose(fra, q, S1); skaft.setMatrixAt(i, M); if (bagSkaft) bagSkaft.setMatrixAt(i, M);
      P.copy(fra).addScaledVector(dir, l - lHoved); S1.set(rHoved, lHoved, rHoved); M.compose(P, q, S1); hoved.setMatrixAt(i, M); if (bagHoved) bagHoved.setMatrixAt(i, M);
    });
    [skaft, hoved, bagSkaft, bagHoved].forEach(function (m) { if (m) { m.instanceMatrix.needsUpdate = true; g.add(m); } });
    return g;
  }
  function etiket(T, e, farve, verdenHoejde) {
    var THREE = T.THREE, c = document.createElement("canvas"), x = c.getContext("2d"); if (!x) return null;
    var fH = 44, f2 = 34, pad = 22, l1 = String(e.tekst || ""), l2 = String(e.tekst2 || "");
    x.font = "700 " + fH + "px 'Segoe UI',Arial,sans-serif"; var w1 = x.measureText(l1).width;
    x.font = "500 " + f2 + "px 'Segoe UI',Arial,sans-serif"; var w2 = x.measureText(l2).width;
    var W = Math.ceil(Math.max(w1, w2) + pad * 2), H = Math.ceil(fH + f2 + pad * 2 + 12); c.width = W; c.height = H;
    x.fillStyle = "rgba(255,255,255,0.94)"; x.strokeStyle = farve; x.lineWidth = 5;
    x.beginPath(); if (x.roundRect) x.roundRect(3, 3, W - 6, H - 6, 18); else x.rect(3, 3, W - 6, H - 6); x.fill(); x.stroke();
    x.textAlign = "center"; x.textBaseline = "top"; x.fillStyle = "#1a1a1a"; x.font = "700 " + fH + "px 'Segoe UI',Arial,sans-serif"; x.fillText(l1, W / 2, pad);
    x.fillStyle = "#333"; x.font = "500 " + f2 + "px 'Segoe UI',Arial,sans-serif"; x.fillText(l2, W / 2, pad + fH + 10);
    var tx = new THREE.CanvasTexture(c); tx.anisotropy = 4; if (THREE.SRGBColorSpace) tx.colorSpace = THREE.SRGBColorSpace;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
    sp.renderOrder = 12; sp.position.set(e.pos[0], e.pos[1], e.pos[2]); sp.scale.set(verdenHoejde * W / H, verdenHoejde, 1);
    return sp;
  }
  // Visningen flytter modellen ind om sceneorigo (bbox-midten). Vi læser forskydningen af modellens egne trekanter, så pilene står på samme sted som bygningen.
  function sceneForskydning(m) {
    var els = api.elementer ? api.elementer() : [];
    for (var i = 0; i < els.length; i++) {
      var r = els[i], d = r && r.data, md = d && d.meshes && d.meshes[0], mm = r && r.meshes && r.meshes[0], p = md && md.pos, g = mm && mm.geometry && mm.geometry.attributes && mm.geometry.attributes.position;
      if (p && g && g.array && p.length === g.array.length) return [p[0] - g.array[0], p[1] - g.array[1], p[2] - g.array[2]];
    }
    var b = m && m.bbox;
    return b && b.min && b.max ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] : [0, 0, 0];
  }
  // Zonerne for det valgte vindtilfælde, når vinden vises som zoner; ellers null.
  function zonerNu() {
    var t = L.TILFAELDE.filter(function (x) { return x.id === tilf; })[0];
    return t && t.art === "vind" && vindVis === "zoner" && V && zon && zon[t.ret] ? zon[t.ret] : null;
  }
  // En tagzone som farvet flade, der ligger på taget.
  function zoneflade(T, f) {
    var THREE = T.THREE; if (!THREE.BufferGeometry || !THREE.Float32BufferAttribute || !THREE.Mesh) return null;
    var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(f.pos, 3));
    var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: f.farve, transparent: true, opacity: f.alfa, depthWrite: false, side: THREE.DoubleSide }));
    m.name = "zone-" + f.zone; m.renderOrder = 2; m.frustumCulled = false;
    return m;
  }
  function tegnPile() {
    fjernPile();
    zone3d = null;
    if (!aaben || !form) return;
    var T = api.three && api.three(); if (!T || !T.THREE || !T.scene) return;
    var A = L.pileFor(form, felt, tilf), t = L.TILFAELDE.filter(function (x) { return x.id === tilf; })[0], z = zonerNu();
    if (z) { try { zone3d = V.pile3d(form, z, { kamera: VINKLER[tilf] }); } catch (e) { advar("Zonernes pile kunne ikke tegnes: " + e.message); zone3d = null; } }
    if (!zone3d && !A.pile.length) return;
    var THREE = T.THREE, fv = L.FARVE[t.art], grp = new THREE.Group(), fs = sceneForskydning(model()), mp = T.modelGroup ? T.modelGroup.position : { x: 0, y: 0, z: 0 };
    grp.name = "issana-statik-laster";
    grp.position.set(mp.x - fs[0], mp.y - fs[1], mp.z - fs[2]);
    var vH = Math.min(6.5, Math.max(1.8, form.laengde * 0.13));
    if (zone3d) {
      zone3d.flader.forEach(function (f) { var m = zoneflade(T, f); if (m) grp.add(m); });
      if (zone3d.kanter.length && THREE.LineSegments && THREE.LineBasicMaterial && THREE.BufferGeometry && THREE.Float32BufferAttribute) {
        var kg = new THREE.BufferGeometry(); kg.setAttribute("position", new THREE.Float32BufferAttribute(zone3d.kanter, 3));
        var kl = new THREE.LineSegments(kg, new THREE.LineBasicMaterial({ color: 0x20262b, transparent: true, opacity: 0.8 }));
        kl.name = "zone-kanter"; kl.renderOrder = 4; kl.frustumCulled = false; grp.add(kl);
      }
      zone3d.lag.forEach(function (lag) { if (lag.pile.length) { var g = pilelag(T, lag, lag.farve, false); g.name = "pile-" + lag.art; grp.add(g); } });
      zone3d.etiketter.forEach(function (e) { var s = etiket(T, e, V.FARVE[e.art], vH * 0.66); if (s) grp.add(s); });
    } else {
      grp.add(pilelag(T, A, fv, !!A.gjennem));
      L.etiketter3d(form, felt, tilf, res).forEach(function (e) { var s = etiket(T, e, fv, vH); if (s) grp.add(s); });
    }
    T.scene.add(grp); gruppe = grp;
    if (api.render) api.render();
  }
  // Kameraet vender den side, lasten kommer fra, mod brugeren og får bygning, pile og etiketter med i billedet.
  var VINKLER = { "vind-n": [0.45, 0.8, 0.5], "vind-o": [0.85, -0.4, 0.5], "vind-s": [0.45, -0.8, 0.5], "vind-v": [-0.85, -0.4, 0.5], sne: [0.6, -0.75, 0.8], nytte: [0.6, -0.75, 0.5], egen: [0.6, -0.75, 0.5] };
  function visLasten() {
    var V = window.IssanaVisning, T = api && api.three && api.three(), d = VINKLER[tilf];
    if (!gruppe || !form || !d || !V || !V.tilpas || !T || !T.THREE) return;
    var THREE = T.THREE, b = new THREE.Box3(), o = gruppe.position, m = Math.min(6.5, Math.max(1.8, form.laengde * 0.13)) * 1.7;
    if (T.modelBox && !T.modelBox.isEmpty()) b.copy(T.modelBox);
    function med(x, y, z) { if (isFinite(x + o.x) && isFinite(y + o.y) && isFinite(z + o.z)) b.expandByPoint(new THREE.Vector3(x + o.x, y + o.y, z + o.z)); }
    var pile = zone3d ? [].concat.apply([], zone3d.lag.map(function (l) { return l.pile; })) : L.pileFor(form, felt, tilf).pile;
    var etk = zone3d ? zone3d.etiketter : L.etiketter3d(form, felt, tilf, res);
    if (zone3d) m *= 0.66;
    pile.forEach(function (p) { med(p.fra[0], p.fra[1], p.fra[2]); med(p.til[0], p.til[1], p.til[2]); });
    etk.forEach(function (e) { med(e.pos[0] - m, e.pos[1] - m, e.pos[2]); med(e.pos[0] + m, e.pos[1] + m, e.pos[2]); });
    V.tilpas(b, new THREE.Vector3(d[0], d[1], d[2]));
  }

  /* ---------- Panelet ---------- */
  var CSS = ".sl{font-size:12.5px;color:var(--text,#222)}.sl h3{font-size:12.5px;font-weight:700;margin:14px 0 6px}.sl-hint{color:var(--muted,#666);font-size:12px;margin:4px 0}" +
    ".sl-forbehold{background:#FDF1E0;color:#7A4A00;border-radius:8px;padding:6px 9px;margin:0 0 8px;font-weight:600}.sl-chips{display:flex;flex-wrap:wrap;gap:6px}" +
    ".sl-chip{border:1px solid var(--border,#ccd);background:var(--bg,#fff);color:var(--text,#222);border-radius:8px;padding:5px 9px;font:inherit;cursor:pointer}.sl-chip[aria-pressed=true]{background:var(--ok-bg,#e6f4ea);border-color:var(--ok,#4a7c59);font-weight:700}" +
    ".sl-felt{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(70px,.8fr) minmax(0,1fr);gap:2px 8px;align-items:center;padding:4px 0;border-bottom:1px solid var(--line-soft,#eee)}.sl-felt label{font-weight:600;overflow-wrap:anywhere}" +
    ".sl-in{width:100%;box-sizing:border-box;border:1px solid var(--border,#ccd);background:var(--bg,#fff);color:var(--text,#222);border-radius:6px;padding:3px 6px;font:inherit}.sl-in.sl-mangler{border-color:#c98a1a;background:#FFF7E6}" +
    ".sl-kilde{color:var(--muted,#666);font-size:11px;grid-column:1/-1}.sl-maeng{color:var(--muted,#666);font-size:11.5px}.sl-tag{display:inline-block;background:#FDF1E0;color:#7A4A00;border-radius:6px;padding:1px 6px;font-size:11px;font-weight:600}" +
    ".sl-tab{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11.5px;margin-top:6px}.sl-tab th,.sl-tab td{padding:3px 4px;border-bottom:1px solid var(--line-soft,#eee);text-align:right;overflow-wrap:anywhere}.sl-tab th:first-child,.sl-tab td:first-child{text-align:left}.sl-tab tr.sl-aktiv td{background:var(--ok-bg,#e6f4ea);font-weight:700}" +
    ".sl-fig{background:var(--bg-paper,#fff);border:1px solid var(--border,#e1e6e8);border-radius:8px;padding:6px;margin-top:6px;overflow:hidden}.sl-fig svg{width:100%;height:auto;display:block}.sl-knapper{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.sl-knap{border:1px solid var(--border,#ccd);background:var(--bg,#fff);color:var(--text,#222);border-radius:8px;padding:6px 10px;font:inherit;cursor:pointer;font-weight:600}.sl-knap:disabled{opacity:.5;cursor:default}" +
    ".sl-org{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:4px 8px;align-items:center;margin-top:6px}.sl details>summary{cursor:pointer;font-weight:700;margin:12px 0 4px}.sl-lag{font-size:11.5px;margin:4px 0 8px}.sl-lag td{padding:1px 4px}.sl-lag input{width:64px}";
  var cssSat = false;
  function sikrCss() { if (cssSat) return; var s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); cssSat = true; }

  function sti(a) { return esc(JSON.stringify(a)); }
  function tal(v, d) { return v == null || !isFinite(+v) ? "" : String(+(+v).toFixed(d == null ? 3 : d)).replace(".", ","); }
  function mk(v) { return v == null || v === ""; }
  function felt1(a, navn, vaerdi, enhed, kilde, opts) {
    opts = opts || {};
    var manglerTag = opts.krav && mk(vaerdi) && mk(opts.ph) ? '<span class="sl-tag">' + L.SKAL + "</span>" : "";
    return '<div class="sl-felt"><label>' + esc(navn) + '</label><input class="sl-in' + (opts.krav && mk(vaerdi) ? " sl-mangler" : "") + '" data-sti="' + sti(a) + '" inputmode="decimal" value="' + esc(tal(vaerdi)) + '"' + (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : "") + '><span class="sl-maeng">' + esc(enhed || "") + " " + manglerTag + '</span><span class="sl-kilde">Kilde: ' + esc(kilde) + (opts.note ? " · " + esc(opts.note) : "") + "</span></div>";
  }
  function vaelg1(a, navn, vaerdi, liste, kilde, opts) {
    opts = opts || {};
    var o = '<option value=""' + (vaerdi ? "" : " selected") + ">Vælg …</option>" + liste.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (vaerdi === x[0] ? " selected" : "") + ">" + esc(x[1]) + "</option>"; }).join("");
    return '<div class="sl-felt"><label>' + esc(navn) + '</label><select class="sl-in' + (vaerdi ? "" : " sl-mangler") + '" style="grid-column:2/-1" data-sti="' + sti(a) + '" data-tekst="1">' + o + '</select><span class="sl-kilde">' + (vaerdi ? "" : '<span class="sl-tag">' + L.SKAL + "</span> ") + "Kilde: " + esc(kilde) + (opts.note ? " · " + esc(opts.note) : "") + "</span></div>";
  }
  // Et valg, der ikke skal udfyldes: den tomme plads har sin egen tekst (det, modellen siger).
  function vaelgFri(a, navn, vaerdi, tom, liste, kilde, opts) {
    opts = opts || {};
    var o = '<option value=""' + (vaerdi ? "" : " selected") + ">" + esc(tom) + "</option>" + liste.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (vaerdi === x[0] ? " selected" : "") + ">" + esc(x[1]) + "</option>"; }).join("");
    return '<div class="sl-felt"><label>' + esc(navn) + '</label><select class="sl-in" style="grid-column:2/-1" data-sti="' + sti(a) + '" data-tekst="1">' + o + '</select><span class="sl-kilde">Kilde: ' + esc(kilde) + (opts.note ? " · " + esc(opts.note) : "") + "</span></div>";
  }
  function saet(a, v) { var o = ind; for (var i = 0; i < a.length - 1; i++) { if (!o[a[i]] || typeof o[a[i]] !== "object") o[a[i]] = {}; o = o[a[i]]; } if (v === "" || v == null) { if (Array.isArray(a)) delete o[a[a.length - 1]]; } else o[a[a.length - 1]] = v; }
  function hentSti(a) { var o = ind; for (var i = 0; i < a.length; i++) { if (o == null) return undefined; o = o[a[i]]; } return o; }

  function sandNordAdvar() { var m = model(), v = m && m.placering && m.placering.sandNordVinkel; return typeof v === "number" && Math.abs(v) > 1 ? "Modellens nord er drejet " + tal(v, 1) + "° fra sand nord; ret værdierne, så de passer til de sande retninger." : ""; }
  function vindDel() {
    var K = L.K, v = ind.vind, h = form.h, h1 = "";
    h1 += vaelg1(["vind", "terraen"], "Terrænkategori", v.terraen, Object.keys(L.TERRAEN).map(function (k) { return [k, L.TERRAEN[k].navn]; }), K.terraen, { note: "Afgøres af stedet, kan ikke læses af modellen" });
    h1 += felt1(["vind", "vb0"], "Basisvindhastighed v_b,0", v.vb0, "m/s", K.vb0, { note: "I Jylland under 25 km fra Vesterhavet og Ringkøbing Fjord op til 27 m/s" });
    h1 += felt1(["vind", "cseason2"], "Årstidsfaktor c_season²", v.cseason2, "", K.cseason);
    h1 += felt1(["vind", "rho"], "Luftens densitet ρ", v.rho, "kg/m³", K.rho);
    h1 += felt1(["vind", "co"], "Orografifaktor c_o", v.co, "", K.co, { note: "1,0 er fladt terræn. Står bygningen på en bakke, skal den rettes" });
    h1 += felt1(["vind", "ze"], "Referencehøjde z_e", v.ze, "m", "Bygningens højde over terræn er brugt, pkt. 7.2.2(1)", { ph: L.dk(h, 2) });
    h1 += felt1(["vind", "cscd"], "Konstruktionsfaktor c_s·c_d", v.cscd, "", L.K.cscd, { ph: h < 15 ? "1,0" : "", krav: h >= 15, note: h >= 15 ? "Bygningen er over 15 m" : "" });
    h1 += '<div style="margin-top:6px"><b>Retningsfaktor c_dir²</b></div><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:4px 0">' +
      ["n", "o", "s", "v"].map(function (r) { return '<label style="font-weight:600">Fra ' + L.RETNING[r].navn + '<input class="sl-in" data-sti="' + sti(["vind", "cdir2", r]) + '" inputmode="decimal" value="' + esc(tal(v.cdir2[r])) + '"></label>'; }).join("") + "</div>" +
      '<span class="sl-kilde">Kilde: ' + esc(K.cdir) + ". Gælder sand nord." + (sandNordAdvar() ? " " + sandNordAdvar() : "") + "</span>";
    var aktiv = tilf.slice(5);
    h1 += '<table class="sl-tab"><colgroup><col style="width:17%"><col><col><col><col><col></colgroup><thead><tr><th>Vind fra</th><th>q_p<br>kN/m²</th><th>Tryk<br>kN/m²</th><th>Sug<br>kN/m²</th><th>Netto<br>kN/m²</th><th>F<br>kN</th></tr></thead><tbody>' +
      ["n", "o", "s", "v"].map(function (r) { var x = res.vind[r]; return '<tr class="' + (r === aktiv ? "sl-aktiv" : "") + '"><td>' + L.RETNING[r].navn + "</td><td>" + (x.qp == null ? "–" : L.dk(x.qp)) + "</td><td>" + (x.wD == null ? "–" : L.dk(x.wD)) + "</td><td>" + (x.wE == null ? "–" : L.dk(x.wE)) + "</td><td>" + (x.wN == null ? "–" : L.dk(x.wN)) + "</td><td>" + (x.F == null ? "–" : L.dk(x.F, 0)) + "</td></tr>"; }).join("") + "</tbody></table>";
    h1 += '<p class="sl-hint">F er nettolasten gange facadens areal mod vinden, med faktoren for manglende samtidighed mellem tryk og sug. Vindsug på taget er ikke med i F; det står som zoner nedenfor. Formfaktorerne gælder egentlig rektangulære bygninger.</p>';
    return h1 + zoneDel(aktiv);
  }
  // Vindzoner: tryk og sug på hver del af bygningen (zone A til E på væggene, F til J på taget) og friktion.
  function cpTal(x) { return V.fortegn(x, Math.abs(x * 10 - Math.round(x * 10)) < 1e-9 ? 1 : 2); }
  function zoneDel(ret) {
    if (!V || !zon || !zon[ret]) return "";
    var z = zon[ret], v = ind.vind, fr = z.friktion, m1 = function (x) { return L.dk(x, 1); }, h = "<h3>Vindzoner: tryk og sug på hver del</h3>";
    h += '<p class="sl-hint">Eurocodens metode for en bygning med rektangulær plan. Væggene deles i zone A til E og taget i zone F til J. Plus er tryk mod fladen, minus er sug væk fra den.</p>';
    h += '<div class="sl-chips" style="margin:6px 0">' + [["zoner", "Vis zoner i 3D"], ["samlet", "Vis samlet last i 3D"]].map(function (x) { return '<button class="sl-chip" data-vindvis="' + x[0] + '" aria-pressed="' + (vindVis === x[0]) + '">' + x[1] + "</button>"; }).join("") + "</div>";
    var fraModel = tagf ? V.TAGART[tagf.art] + (tagf.art === "fladt" ? "" : ", " + L.dk(tagf.alfa, 0) + "°") : "fladt tag";
    h += vaelgFri(["vind", "tagart"], "Tagets form", v.tagart, "Fra modellen: " + fraModel, Object.keys(V.TAGART).map(function (k) { return [k, V.TAGART[k].charAt(0).toUpperCase() + V.TAGART[k].slice(1)]; }), v.tagart ? V.K.bruger : V.K.model, { note: "En anden skrå tagform kræver, at dens kip- eller faldretning kan aflæses af modellen. Valmtag og andre former er ikke med" });
    if (z.tagart !== "fladt" || v.tagart) h += felt1(["vind", "tagalfa"], "Taghældning α", v.tagalfa, "grader", v.tagalfa != null ? V.K.bruger : V.K.model, { ph: tagf && tagf.art !== "fladt" && tagf.alfa ? String(tagf.alfa) : "" });
    if (z.mangler.length) h += '<p class="sl-forbehold">Vindtryk er ikke beregnet. Manglende eller ugyldigt grundlag: ' + esc(z.mangler.join(", ")) + ". Kun formfaktorer vises.</p>";
    if (z.tagMangler && z.tagMangler.length) h += '<p class="sl-forbehold">' + esc(z.tagMangler.join(" ")) + " Vægzonerne vises fortsat.</p>";
    if (!fr.kanUdelades && fr.laengde > 0) h += vaelg1(["vind", "overflade"], "Overflade (friktion)", v.overflade, Object.keys(V.OVERFLADE).map(function (k) { return [k, V.OVERFLADE[k].navn + " (c_fr = " + tal(V.OVERFLADE[k].cfr) + ")"]; }), V.K.cfr, { note: "Afgøres af beklædningen på facader og tag" });
    h += '<table class="sl-tab" id="slZoner"><colgroup><col style="width:13%"><col><col style="width:22%"><col style="width:24%"></colgroup><thead><tr><th>Zone</th><th style="text-align:left">Hvor</th><th>c_pe,10</th><th>w<br>kN/m²</th></tr></thead><tbody>' +
      V.raekker(z).map(function (x) { return "<tr><td><b>" + esc(x.zone) + '</b></td><td style="text-align:left">' + esc(V.hvor(z, x)) + "</td><td>" + cpTal(x.cpe) + (x.cpeAlt != null ? " / " + cpTal(x.cpeAlt) : "") + "</td><td>" + (x.w == null ? "–" : V.fortegn(x.w) + (x.wAlt != null ? " / " + V.fortegn(x.wAlt) : "")) + "</td></tr>"; }).join("") +
      (fr.aktiv ? '<tr><td><b>fr</b></td><td style="text-align:left">siderne og taget, ' + m1(fr.start) + "–" + m1(z.d) + " m fra vindsiden</td><td>" + (fr.cfr == null ? "–" : "c_fr " + tal(fr.cfr)) + "</td><td>" + (fr.w == null ? "–" : L.dk(fr.w, 3)) + "</td></tr>" : "") + "</tbody></table>";
    h += '<span class="sl-kilde">Kilde: ' + esc(V.K.vaeg) + "; " + esc(z.tagKilde) + "; " + esc(V.K.zoner) + (fr.aktiv ? "; " + esc(V.K.cfr) : "") + ".</span>";
    var frTekst = fr.kanUdelades ? "Friktion kan udelades: fladerne langs vinden (" + L.dk(fr.Alangs, 0) + " m²) er højst 4 gange fladerne på tværs (" + L.dk(fr.Atvaers, 0) + " m²), " + V.K.udelad + "."
      : fr.laengde <= 0 ? "Friktion: ingen flade ligger længere fra vindsiden end " + m1(fr.start) + " m (det mindste af 2b og 4h)."
      : "Friktion virker langs vinden på siderne og taget bag " + m1(fr.start) + " m fra vindsiden (det mindste af 2b og 4h): A_fr = " + L.dk(fr.A, 0) + " m²" + (fr.F == null ? "" : ", F_fr = " + L.dk(fr.F, 1) + " kN") + ".";
    h += '<p class="sl-hint">' + esc(V.tagTekst(z)) + ". e = " + m1(z.e) + " m (det mindste af b og 2h). " + esc(frTekst) + "</p>";
    h += '<ul class="sl-hint" style="margin:4px 0;padding-left:18px">' + z.noter.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>";
    return h;
  }
  function sneDel() {
    var K = L.K, s = ind.sne, r = res.sne, h = "";
    h += vaelg1(["sne", "topografi"], "Topografi", s.topografi, Object.keys(L.TOPOGRAFI).map(function (k) { return [k, L.TOPOGRAFI[k].navn + " (C_top = " + tal(L.TOPOGRAFI[k].ctop) + ")"]; }), K.ce, { note: "Afgøres af stedet" });
    h += felt1(["sne", "sk"], "Terrænværdi s_k", s.sk, "kN/m²", K.sk);
    h += felt1(["sne", "ct"], "Termisk faktor C_t", s.ct, "", K.ct);
    h += felt1(["sne", "alfa"], "Taghældning α", s.alfa, "grader", K.model, { ph: form.alfa == null ? "" : String(form.alfa), krav: form.alfa == null });
    h += '<table class="sl-tab"><thead><tr><th>μ₁</th><th>C_top</th><th>C_s</th><th>C_e</th><th>s (kN/m²)</th></tr></thead><tbody><tr><td style="text-align:right">' + (r.mu == null ? "–" : L.dk(r.mu)) + "</td><td>" + (r.ctop == null ? "–" : L.dk(r.ctop)) + "</td><td>" + (r.cs == null ? "–" : L.dk(r.cs)) + "</td><td>" + (r.ce == null ? "–" : L.dk(r.ce)) + "</td><td><b>" + (r.s == null ? "–" : L.dk(r.s)) + "</b></td></tr></tbody></table>";
    h += '<p class="sl-hint">Formfaktoren μ₁ er taget fra DS/EN 1991-1-3 tabel 5.2. Ophobning ved brystninger, ovenlys og niveauspring er ikke med.</p>';
    return h;
  }
  function nytteDel() {
    var etager = Object.keys(res.nytte), h = "";
    if (!etager.length) return '<p class="sl-hint">Der er ingen dæk at sætte nyttelast på. Sæt spændretning under fanen Stabilitet, eller hent modellen igen.</p>';
    etager.forEach(function (e) {
      var n = res.nytte[e];
      h += vaelg1(["nytte", e, "kat"], e, n.kat, L.NYTTE.map(function (k) { return [k.id, k.navn + " (" + tal(k.q) + " kN/m²)"]; }), L.K.nytte, { note: "Afgøres af rummenes brug" });
      h += felt1(["nytte", e, "skille"], "Tillæg for lette skillevægge", n.skille, "kN/m²", L.K.skille, { note: "Mindst 0,5 kN/m², hvis der er lette skillevægge" });
    });
    h += '<table class="sl-tab"><thead><tr><th>Etage</th><th>q_k</th><th>Q_k</th><th>Tillæg</th><th>I alt kN/m²</th></tr></thead><tbody>' + etager.map(function (e) { var n = res.nytte[e]; return "<tr><td>" + esc(e) + "</td><td>" + (n.q == null ? "–" : L.dk(n.q, 1)) + "</td><td>" + (n.Q == null ? "–" : L.dk(n.Q, 1)) + "</td><td>" + (n.skille == null ? "–" : L.dk(n.skille, 1)) + "</td><td><b>" + (n.ialt == null ? "–" : L.dk(n.ialt, 1)) + "</b></td></tr>"; }).join("") + "</tbody></table>";
    return h;
  }
  function egenDel() {
    var ids = Object.keys(res.egen.pr), h = "";
    if (!ids.length) return '<p class="sl-hint">Modellen har ingen dæk med lag. Hent modellen igen, eller skriv egenlasten i rapporten.</p>';
    ids.forEach(function (id) {
      var e = res.egen.pr[id];
      h += felt1(["egen", String(id), "g"], e.navn, ind.egen[id] && ind.egen[id].g, "kN/m²", e.lag.length ? "Summen af lagene nedenfor" : L.K.bruger, { ph: e.hul ? "" : L.dk(e.delsum, 2), krav: e.g == null, note: e.hul ? e.hul + " lag mangler effektiv tyngde" : "" });
      if (e.lag.length) h += '<details><summary style="font-weight:600;font-size:12px;margin:2px 0">' + esc(e.navn) + ": lag</summary><table class=\"sl-lag\">" + e.lag.map(function (l) { return "<tr><td>" + esc(l.navn) + "</td><td>" + tal(l.mm) + ' mm</td><td><input class="sl-in' + (l.mangler ? " sl-mangler" : "") + '" data-sti="' + sti(["egen", String(id), "lag", String(l.i)]) + '" inputmode="decimal" value="' + esc(tal(l.gamma)) + '" title="' + esc(l.kilde || L.SKAL) + '"></td><td>kN/m³</td><td>' + (l.last == null ? "–" : L.dk(l.last, 2) + " kN/m²") + (l.mangler ? ' <span class="sl-tag">' + L.SKAL + "</span>" : "") + "</td></tr>"; }).join("") + "</table></details>";
    });
    h += '<p class="sl-hint">Egenlast er summen af lag gange effektiv tyngde. Normalbeton står med 25 kN/m³ fra DS/EN 1991-1-1 anneks A, ud fra materialenavnet; ret den. Lag uden værdi skal angives af ingeniøren. Væggenes egenlast er ikke med i pilene.</p>';
    return h;
  }

  function etageVaelger() {
    var e = etagerMedDaek(); if (e.length < 2) return "";
    return '<label class="sl-hint" style="display:block;margin-top:6px">Etage i planen: <select class="sl-in" style="width:auto" id="slEtage">' + e.map(function (x) { return '<option value="' + esc(x) + '"' + (x === etageValg ? " selected" : "") + ">" + esc(x) + "</option>"; }).join("") + "</select></label>";
  }
  function figurer() {
    var t = L.TILFAELDE.filter(function (x) { return x.id === tilf; })[0], et = t.art === "nytte" || t.art === "egen" ? etageValg : null;
    var sp = L.spaendmaerker(form, felt, geo, valg, et);
    var plan = L.planSvg(form, felt, res, { tilf: tilf, etage: et, spaend: sp.length ? sp : null }), fac = L.facadeSvg(form, felt, res, { tilf: tilf, etage: et });
    var zt = null;
    if (t.art === "vind" && V && zon && zon[t.ret]) { try { zt = V.svg(form, zon[t.ret]); } catch (e) { advar("Tegningen af vindzonerne kunne ikke laves: " + e.message); } }
    return (zt ? '<h3>Vindzoner: bygningen foldet ud</h3><div class="sl-fig" id="slZoneFig">' + zt.svg + "</div>" : "") +
      '<h3>Plan</h3>' + etageVaelger() + '<div class="sl-fig">' + plan.svg + '</div><h3>Facade og snit</h3><div class="sl-fig">' + (fac ? fac.svg : "") + "</div>";
  }
  function orgDel() {
    var o = ind.org || {};
    var lin = [["bygherre", "Bygherre"], ["byggeri", "Bygværkets navn"], ["adresse", "Adresse"], ["funktion", "Anvendelse"], ["arkitekt", "Arkitekt"], ["ingenioer", "Rådgivende ingeniør"], ["statiker", "Certificeret statiker"], ["ansvarlig", "Ansvarlig statiker"], ["klasse", "Konstruktionsklasse"], ["sag", "Sagsnummer"]];
    return '<details open><summary>Felter til rapporten</summary><p class="sl-hint">Udfyldes af jer. Tomme felter står som tomme linjer i rapporten.</p><div class="sl-org">' + lin.map(function (x) { return "<label>" + esc(x[1]) + '</label><input class="sl-in" data-tekst="1" data-sti="' + sti(["org", x[0]]) + '" value="' + esc(o[x[0]] || "") + '">'; }).join("") + "</div></details>";
  }
  function kraeverRevit(hvad) { var r = api && api.revit; if (r && r.erRevit && r.erRevit()) return true; if (api) api.fejl(hvad + " kræver, at ISSANA 3D er åbnet fra Revit. Du kan gemme Typst-filen i stedet."); return false; }

  function render() {
    if (!kropp) return;
    sikrCss();
    var scroll = kropp.scrollTop;
    opdaterGeometri();
    if (!form) { kropp.innerHTML = '<div class="sl"><div class="sl-forbehold">' + esc(FORBEHOLD) + '</div><p class="sl-hint">Hent modellen fra Revit først. Lasterne bruger væggenes, dækkenes og tagets geometri.</p></div>'; fjernPile(); return; }
    var t = L.TILFAELDE.filter(function (x) { return x.id === tilf; })[0], h = '<div class="sl"><div class="sl-forbehold">' + esc(FORBEHOLD) + "</div>";
    h += '<div class="sl-chips">' + L.TILFAELDE.map(function (x) { return '<button class="sl-chip" data-tilf="' + x.id + '" aria-pressed="' + (x.id === tilf) + '">' + esc(x.navn) + "</button>"; }).join("") + "</div>";
    var d = t.art === "vind" ? vindDel() : t.art === "sne" ? sneDel() : t.art === "nytte" ? nytteDel() : egenDel();
    h += "<h3>" + esc(t.navn) + "</h3>" + d;
    h += figurer();
    h += felt1(["terraenKote"], "Terrænkote", ind.terraenKote, "m", "Modellen: første dæk over kælder eller lavest liggende væg", { ph: L.dk(form.terraen, 2), note: "Pilene starter her" });
    h += orgDel();
    h += '<div class="sl-knapper"><button class="sl-knap" id="slRap">Statisk redegørelse (Typst-fil)</button><button class="sl-knap" id="slPdf">PDF</button><button class="sl-knap" id="slCompose">Send til Compose</button></div></div>';
    kropp.innerHTML = h;
    kropp.scrollTop = scroll;
    kropp.querySelectorAll("[data-tilf]").forEach(function (b) { b.onclick = function () { tilf = b.getAttribute("data-tilf"); render(); visLasten(); }; });
    kropp.querySelectorAll("[data-vindvis]").forEach(function (b) { b.onclick = function () { vindVis = b.getAttribute("data-vindvis"); render(); visLasten(); }; });
    var ev = kropp.querySelector("#slEtage"); if (ev) ev.onchange = function () { etageValg = ev.value; render(); };
    kropp.querySelectorAll("[data-sti]").forEach(function (e) {
      e.onchange = function () {
        var a = JSON.parse(e.getAttribute("data-sti")), v;
        if (e.getAttribute("data-tekst")) v = e.value;
        else { v = String(e.value).trim().replace(",", "."); v = v === "" ? "" : parseFloat(v); if (v !== "" && !isFinite(v)) { render(); return; } }
        saet(a, v); gemInd(); render();
      };
    });
    kropp.querySelector("#slRap").onclick = function () { var r = rapportTekst(); if (r) { window.IssanaTypstRapport.gem(r.fil, r.tekst); api.info("Typst-filen er gemt som " + r.fil + "."); } };
    kropp.querySelector("#slPdf").onclick = rapportPdf;
    kropp.querySelector("#slCompose").onclick = rapportCompose;
    tegnPile();
  }

  /* ---------- Rapport ---------- */
  function rapportTekst() {
    var R = window.IssanaTypstRapport, SR = window.IssanaStatikRapport;
    if (!R || !SR) { if (api) api.fejl("Rapportmodulet er ikke indlæst endnu. Prøv igen om et øjeblik."); return null; }
    opdaterGeometri(); if (!form) { if (api) api.fejl("Hent modellen fra Revit først."); return null; }
    var m = model(), Vd = S && geo ? S.vurder(geo, valg) : null;
    var tekst = SR.lav(R, { model: m, form: form, felt: felt, res: res, ind: ind, geo: geo, valg: valg, vurdering: Vd, S: S, L: L, vindzoner: V, zoner: zon, dato: new Date().toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" }) });
    return { tekst: tekst, fil: SR.filnavn(m.model), model: m.model || "" };
  }
  function optaget(id, tekst) { var b = kropp.querySelector("#" + id); if (!b) return function () {}; var t = b.textContent; b.disabled = true; b.textContent = tekst; return function () { b.disabled = false; b.textContent = t; }; }
  function gemPdf(fil, base64) {
    var bin = atob(base64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([u], { type: "application/pdf" })), a = document.createElement("a");
    a.href = url; a.download = fil; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }
  function rapportPdf() {
    if (!kraeverRevit("PDF'en")) return Promise.resolve(null);
    var r = rapportTekst(); if (!r) return Promise.resolve(null);
    var slut = optaget("slPdf", "Laver PDF…");
    return api.revit.kald("issana_rapport_pdf", { typst: r.tekst, filnavn: r.fil }, { timeoutMs: 180000 }).then(function (s) { gemPdf(s.filnavn, s.pdfBase64); api.info("PDF'en er gemt som " + s.filnavn + "."); return s; }).catch(function (e) { api.fejl("PDF'en blev ikke lavet: " + ((e && e.message) || e)); return null; }).then(function (s) { slut(); return s; });
  }
  function rapportCompose() {
    if (!kraeverRevit("Send til Compose")) return Promise.resolve(null);
    var r = rapportTekst(); if (!r) return Promise.resolve(null);
    var slut = optaget("slCompose", "Sender…");
    return api.revit.kald("issana_rapport_compose", { typst: r.tekst, navn: "Statisk redegørelse " + r.model }, { timeoutMs: 120000 }).then(function (s) { api.info("Rapporten ligger nu i ISSANA Compose som projektet «" + s.projekt + "». Åbn det fra projektoversigten, og markér det som betroet, for at se PDF'en."); return s; }).catch(function (e) { api.fejl("Rapporten blev ikke sendt: " + ((e && e.message) || e)); return null; }).then(function (s) { slut(); return s; });
  }

  /* ---------- Montering ---------- */
  function monter(container, api0) {
    api = api0; kropp = container; L = window.IssanaStatikLast; V = window.IssanaStatikVind || null; S = window.IssanaStatik || null;
    if (!L) { container.innerHTML = '<div class="sl-hint">Lastmodulet er ikke indlæst.</div>'; advar("statik-lastmodel.js mangler"); return; }
    hentInd();
    aaben = true;
    if (api.paa) api.paa("model", function () { form = null; formFor = null; felt = null; res = null; hentInd(); if (aaben) render(); else fjernPile(); });
    render();
    setTimeout(visLasten, 400);   // efter panelet har gjort billedet smallere
    return { opdater: render, luk: function () { aaben = false; fjernPile(); }, vis: vis };
  }
  function vis() { aaben = true; if (L && api && kropp) { render(); setTimeout(visLasten, 400); } }
  window.IssanaStatikLaster = { monter: monter, render: function () { render(); }, rapportTekst: rapportTekst, tilstand: function () { return { form: form, felt: felt, res: res, ind: ind, tilf: tilf, gruppe: gruppe, zoner: zon, tag: tagf, vindVis: vindVis, zone3d: zone3d }; }, vaelg: function (t) { tilf = t; render(); visLasten(); },
    visVind: function (v) { vindVis = v === "samlet" ? "samlet" : "zoner"; render(); visLasten(); }, saet: function (a, v) { saet(a, v); gemInd(); render(); }, hent: hentSti, FORBEHOLD: FORBEHOLD };

  function indlaes(i, klar) {
    if (i >= FILER.length) { klar(); return; }
    var s = document.createElement("script"); s.src = mappe + FILER[i];
    s.onload = function () { indlaes(i + 1, klar); };
    s.onerror = function () { advar("kunne ikke indlæse " + FILER[i]); indlaes(i + 1, klar); };
    document.head.appendChild(s);
  }
  indlaes(0, function () {});
})();
