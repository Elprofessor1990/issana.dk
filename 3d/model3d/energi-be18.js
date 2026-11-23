/* ISSANA 3D: Be18/Energy Design XML (roden BE05). Rent modul uden DOM.
   Browser: window.IssanaEnergiBe18. Node: module.exports.

   skriv(p)  laver en importfil ud fra panelets model. laes(xml) læser en eksport fra Energy Design tilbage til samme model.
   Formatet er kortlagt fra Energy Designs egne eksporter (kerne 10.19.7.22), ikke fra programmets kode. Et projekt skrevet
   her og importeret i Energy Design gav samme energiramme, transmissionstab og sommerkomfort som originalen.

   Panelets model: bygning, areas, konstruktioner[aabninger[skygge]], unheated{intern,ekstern}, ventilation, brug, kuldebroer,
   solceller, fjernvarme, fremloeb, retur, pumpe, brugsvand, rum, klima.
   Kun fjernvarme kan skrives: kedel, varmepumpe og varmerør er ikke set udfyldt i en eksport endnu. laes() melder dem i
   advarsler i stedet for at tabe dem i stilhed. Kontaktoplysninger i en eksport læses aldrig.
   laes() sammenligner også filen felt for felt med det, skriv() ville lave, og melder i ikkeOverfoert hvert felt, der
   ikke kommer uændret med; noter er det, filen slet ikke har (rumhøjde og opvarmet kælder). FASTE er felterne, skriv() altid skriver med samme værdi; IKKE_SKREVET er det, den slet ikke skriver.
   Filhovedet (BE05.id) siger, at filen er lavet af ISSANA 3D. Det er endnu ikke prøvet, at Energy Design tager imod den tekst. */
(function (root, fabrik) {
  var api = fabrik();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else root.IssanaEnergiBe18 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var T = ".T.", F = ".F.", KERNE = "10.19.7.22";
  // Første sætning er som i Energy Designs egne eksporter. Anden sætning siger, hvem der har lavet filen.
  // Ikke afprøvet i Energy Design endnu: kernens version står også i feltet version.
  var OPHAV = "Be18, beregningskerneversion " + KERNE + ". Filen er lavet af ISSANA 3D som forhåndsberegning, ikke af ROCKWOOL Energy.";
  var ORDEN = "BE05 BUILDING AREA TX OPAQUE_CONST UNHEATED_SPACE ENVELOPE VENTILATION USAGE USAGE_LOAD COLD_BRIDGE HEATING_SYSTEMS SOLAR_COLLECTOR PV_CELL D_H_EXCH COOLING HEAT_DISTRIBUTION DIM_TEMP DIST_PUMP DHW_SYSTEM HEATER_GAS HEATER_EL DESCRIPT CONTACT COMMENTS HEATED_ROOM climateData month".split(" ");
  var PRIO = {};
  ORDEN.forEach(function (t, i) { PRIO[t] = i; });
  PRIO.SHADING = PRIO.TRANSP_CONSTR = PRIO.TX;

  function rund2(x) { var r = Math.round(x * 100) / 100; return r === 0 ? 0 : r; }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function afEsc(s) {
    return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, function (m, n) {
      var k = n.toLowerCase();
      if (k === "amp") return "&"; if (k === "lt") return "<"; if (k === "gt") return ">"; if (k === "quot") return '"'; if (k === "apos") return "'";
      return String.fromCodePoint(k.charAt(1) === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    });
  }
  function guidTilfaeldig() {
    var c = typeof crypto !== "undefined" ? crypto : null;
    if (c && typeof c.randomUUID === "function") return c.randomUUID().toUpperCase();
    return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, function () { return Math.floor(Math.random() * 16).toString(16).toUpperCase(); });
  }

  function Dok() { this.n = 0; this.poster = []; }
  Dok.prototype.alloc = function () { this.n++; return "#" + this.n; };
  Dok.prototype.add = function (tag, felter, rid) { rid = rid || this.alloc(); this.poster.push({ tag: tag, rid: rid, felter: felter }); return rid; };
  Dok.prototype.tekst = function () {
    var ud = ["<BE05>"];
    this.poster.map(function (p, i) { return { p: p, i: i }; })
      .sort(function (a, b) { return PRIO[a.p.tag] - PRIO[b.p.tag] || a.i - b.i; })
      .forEach(function (x) {
        ud.push("  <" + x.p.tag + ' rid="' + x.p.rid + '">');
        x.p.felter.forEach(function (f) {
          var s = f[1] == null ? "" : String(f[1]);
          ud.push(s === "" ? "    <" + f[0] + "/>" : "    <" + f[0] + ">" + esc(s) + "</" + f[0] + ">");
        });
        ud.push("  </" + x.p.tag + ">");
      });
    ud.push("</BE05>");
    return ud.join("\n") + "\n";
  };

  /* ---------- Skriv ---------- */
  function skriv(p, opt) {
    var guid = (opt && opt.guid) || guidTilfaeldig, d = new Dok();
    var be05 = d.alloc(), bld = d.alloc(), clim = d.alloc();
    var areas = p.areas.map(function (a) { return d.add("AREA", [["id", a.id], ["area", a.area], ["type", a.type]]); });
    var transp = [], opaque = [], unheated = p.unheated || null, uguid = unheated ? guid() : null;
    p.konstruktioner.forEach(function (c) {
      var g = guid(), netto = c.total_area;
      c.aabninger.forEach(function (o) {
        var s = o.skygge;
        var sh = d.add("SHADING", [["id", "Ny skygge"], ["horizon", s.horizon], ["overhang", s.overhang], ["sidefin_left", s.sidefin_left], ["sidefin_right", s.sidefin_right], ["opening", s.opening]]);
        var areal = o.area != null ? o.area : rund2(o.width * o.height);
        netto -= o.no * areal;
        transp.push(d.add("TRANSP_CONSTR", [["id", o.id], ["area", areal], ["u", o.u], ["no", o.no], ["td_in", 20], ["td_out", -12], ["sfb", null], ["has_b", 1], ["part", null], ["fab", o.fab], ["template_id", -1], ["type", o.type], ["defaultTdIn", T], ["defaultTdOut", T], ["revitSync", F], ["orient", c.orient], ["slope", 90], ["ff", o.ff], ["g", o.g], ["fc", o.fc], ["ot", o.ot ? T : F], ["has_shading", sh], ["parent", g], ["eref", o.eref], ["surface_temp", 0], ["width", o.width], ["height", o.height], ["data", null]]));
      });
      opaque.push(d.add("OPAQUE_CONST", [["id", c.id], ["area", rund2(netto)], ["u", c.u], ["no", 1], ["td_in", 20], ["td_out", c.td_out], ["sfb", null], ["has_b", c.b], ["part", null], ["fab", null], ["template_id", -1], ["type", c.type], ["defaultTdIn", T], ["defaultTdOut", T], ["revitSync", F], ["has_area_correction", null], ["GUID", g], ["orient", c.orient], ["slope", c.slope], ["unheatedGUID", c.mod_uopvarmet ? uguid : null], ["previous_loss", F], ["total_area", c.total_area], ["cons_data", null]]));
    });
    var uhRid = null;
    if (unheated) {
      var env = function (e) { return d.add("ENVELOPE", [["id", e.id], ["area", e.area], ["u", e.u]]); };
      var intern = unheated.intern.map(env), ekstern = unheated.ekstern.map(env);
      uhRid = d.add("UNHEATED_SPACE", [["GUID", uguid], ["id", unheated.id], ["gross_area", unheated.gross_area], ["vent", unheated.vent], ["has_int_const", intern.join(" ")], ["has_ext_const", ekstern.join(" ")]]);
    }
    var v = p.ventilation;
    var vent = d.add("VENTILATION", [["id", v.id], ["area", v.area], ["fo", v.fo], ["qvm", v.qvm], ["nvgv", v.nvgv], ["tin", v.tin], ["el_vf", F], ["qid", v.qid], ["qis", 0], ["sel", v.sel], ["qvm_day", v.qvm_day], ["qid_day", v.qid_day], ["qvm_night", 0], ["qis_night", 0], ["id_mec", null], ["fab", null], ["template_id", -1], ["air_tightness", v.air_tightness], ["mec_ventilation", T]]);
    var ul = p.brug;
    var ulRid = d.add("USAGE_LOAD", [["id", ul.id], ["area", ul.area], ["ppers", ul.ppers], ["papp", ul.papp], ["papp_night", 0]]);
    var usage = d.add("USAGE", [["id", null], ["app_use", 0], ["app_always", 0], ["has_usage_load", ulRid]]);
    var bridges = p.kuldebroer.map(function (k) { return d.add("COLD_BRIDGE", [["id", k.id], ["area", k.laengde], ["u", k.psi], ["no", 1], ["td_in", 20], ["td_out", -12], ["sfb", null], ["has_b", 1], ["part", null], ["fab", null], ["template_id", -1], ["type", k.type], ["defaultTdIn", T], ["defaultTdOut", T], ["revitSync", F], ["previous_loss", F], ["unheatedGUID", null]]); });
    var sol = d.add("SOLAR_COLLECTOR", [["id", null], ["has_type", ".B_TYPE."], ["area", 0], ["orient", 0], ["slope", 0], ["horizon", 0], ["sidefin_left", 0], ["sidefin_right", 0], ["heat_loss_coef", 0], ["heat_loss_coef2", 0], ["ang_fac", 0], ["ny0", 0.8], ["tube_length", 0], ["heat_loss", 0], ["ny_loop", 0], ["pump", 0], ["stand_by", 0], ["fab", null], ["template_id", -1]]);
    var pv = p.solceller || null;
    var pvRid = pv ? d.add("PV_CELL", [["id", pv.id], ["area", pv.area], ["orient", pv.orient], ["slope", pv.slope], ["horizon", pv.horizon], ["sidefin_left", 0], ["sidefin_right", 0], ["peak_power", pv.peak_power], ["efficiency", pv.efficiency], ["fab", null], ["template_id", -1]]) : null;
    var fv = p.fjernvarme;
    var dh = d.add("D_H_EXCH", [["id", fv.id], ["nom_eff", fv.nom_eff], ["heat_loss", fv.heat_loss], ["dhw", fv.dhw ? T : F], ["min_temp", fv.min_temp], ["b_factor", fv.b_factor], ["auto_stb", fv.auto_stb], ["fab", null], ["template_id", -1]]);
    var hs = d.add("HEATING_SYSTEMS", [["id", null], ["has_solar_collector", sol], ["has_pv_cell", pvRid], ["has_boiler", null], ["has_d_h_exch", dh], ["has_sup_room_heat", "$"], ["has_heat_pump", null], ["has_wind_mill", null]]);
    var cool = d.add("COOLING", [["id", null], ["load_fac", 0], ["el_dem", 0], ["heat_dem", 0], ["heat_cap_pc", 0], ["additional_cooling", 1.5], ["documentation", null], ["fab", null], ["template_id", -1]]);
    var t1 = d.add("DIM_TEMP", [["id", null], ["temp", p.fremloeb]]);
    var t2 = d.add("DIM_TEMP", [["id", null], ["temp", p.retur]]);
    var pu = p.pumpe;
    var pump = d.add("DIST_PUMP", [["id", pu.id], ["no", pu.no], ["pnom", pu.pnom], ["fp", pu.fp], ["fab", null], ["template_id", -1]]);
    var hd = d.add("HEAT_DISTRIBUTION", [["id", "Anlægstype"], ["tube_type", 2], ["inlet_temp", t1], ["return_temp", t2], ["pump_const_year", null], ["pump_const_hs", pump], ["pump_timereg_hs", null], ["pump_combi", null], ["has_tube", null]]);
    var dhw = d.add("DHW_SYSTEM", [["id", "Varmt brugsvand"], ["sfb", null], ["consumption", p.brugsvand], ["temp", 55], ["has_dhw_tank", null]]);
    var gas = d.add("HEATER_GAS", [["id", null], ["dhw_frac", 0], ["heat_loss", 0], ["b", 0], ["fab", null], ["template_id", -1], ["ny", 0], ["pilot_flame", 0]]);
    var el = d.add("HEATER_EL", [["id", null], ["dhw_frac", 0], ["heat_loss", 0], ["b", 0], ["fab", null], ["template_id", -1]]);
    function kontakt() { return d.add("CONTACT", "title first_name last_name company street number post_number city phone email".split(" ").map(function (k) { return [k, null]; }).concat([["template_id", -1]])); }
    var k1 = kontakt(), k2 = kontakt(), k3 = kontakt();
    var des = d.add("DESCRIPT", [["id", null], ["bbr", null], ["owner", null], ["addr1", null], ["addr2", null], ["addr3", null], ["builder", k1], ["architect", k2], ["consulting_engineer", k3]]);
    var com = d.add("COMMENTS", [["id", null], ["id0", null], ["reportComments", null], ["has_lines", null], ["template_id", -1], ["template_id0", -1]]);
    var r = p.rum;
    var room = d.add("HEATED_ROOM", [["area", r.area], ["vent_day", r.vent_day], ["vent_evening", r.vent_evening], ["vent_night", r.vent_night], ["vent_basic", r.vent_basic]]);
    var months = p.klima.months.map(function (m) { return d.add("month", [["id", null], ["monthId", 0], ["tempOut", m.tempOut], ["humidityOut", m.humidityOut], ["tempIn", m.tempIn], ["humidityIn", m.humidityIn]]); });
    d.add("climateData", [["id", null], ["name", p.klima.name], ["months", months.join(" ")], ["supp_start", p.klima.supp_start], ["supp_slope", p.klima.supp_slope]], clim);
    var b = p.bygning;
    d.add("BUILDING", [["id", b.id], ["ae", b.ae], ["ae2", 0], ["ae3", 0], ["th_heat", 20], ["th_store", 15], ["th_setp", 23], ["th_nv", 24], ["th_cool", 25], ["heat_cap", b.heat_cap], ["dim_room_temp", 20], ["dim_store_temp", 15], ["tb", 168], ["start_time", 0], ["end_time", 24], ["tu", -12], ["cooling_frac", 0], ["sup_heating", F], ["solarpanel", F], ["heatpump", F], ["pv_panel", pv ? T : F], ["rotation", b.rotation], ["add_eframe", 0], ["sup_oven", F], ["heat_dist", F], ["windmill", F], ["floors", 1], ["floors_avg_height", 0], ["ae4", b.ae4], ["dwellings", 1], ["comfort26Requirement", 100], ["comfort27Requirement", 25], ["has_btype", b.has_btype], ["basic_heat_supply", b.basic_heat_supply], ["calc_condition", ".actual."], ["has_areas", areas.join(" ")], ["has_transp_const", transp.join(" ")], ["has_disabled_transp_const", null], ["has_opaque_const", opaque.join(" ")], ["has_disabled_opaque_const", null], ["has_unheated_space", uhRid], ["has_heated_room", room], ["has_ventilation", vent], ["has_usage", usage], ["has_lighting", "$"], ["has_cold_bridge", bridges.join(" ")], ["has_heating_systems", hs], ["has_cooling", cool], ["has_heat_distribution", hd], ["has_hot_water", dhw], ["has_gas_heater", gas], ["has_el_heater", el], ["has_descript", des], ["has_comments", com], ["project_no", b.project_no], ["street", b.street], ["zip_code", b.zip_code], ["city", b.city], ["is_extension", F]], bld);
    d.add("BE05", [["id", OPHAV], ["has_building", bld], ["has_climate", "$"], ["climateData", clim], ["version", KERNE]], be05);
    return d.tekst();
  }

  /* ---------- Faste felter ---------- */
  // Felter, som skriv() altid skriver med samme værdi, uanset hvad panelet eller en importeret fil siger.
  // Navnet i parentes er læst ud fra feltnavnet. Det er ikke tjekket i Energy Designs vejledning.
  var POST = { BE05: "Filhoved", BUILDING: "Bygning", AREA: "Arealer", TRANSP_CONSTR: "Vinduer og døre", SHADING: "Skygge", OPAQUE_CONST: "Bygningsdele", UNHEATED_SPACE: "Uopvarmet rum", ENVELOPE: "Uopvarmet rum, flader", VENTILATION: "Ventilation", USAGE: "Brug", USAGE_LOAD: "Intern belastning", COLD_BRIDGE: "Linjetab", HEATING_SYSTEMS: "Varmeanlæg", SOLAR_COLLECTOR: "Solfanger", PV_CELL: "Solceller", D_H_EXCH: "Fjernvarmeveksler", COOLING: "Køling", HEAT_DISTRIBUTION: "Varmefordeling", DIM_TEMP: "Fremløb og retur", DIST_PUMP: "Pumpe", DHW_SYSTEM: "Varmt brugsvand", HEATER_GAS: "Gasvarmer", HEATER_EL: "Elvarmer", HEATED_ROOM: "Rum til sommerkomfort", climateData: "Klima", month: "Klima, måneder" };
  var FASTE = [
    ["BUILDING", "th_heat", 20, "temperatur ved opvarmning, °C"], ["BUILDING", "th_setp", 23, "setpunkt, °C"], ["BUILDING", "th_nv", 24, "temperatur for naturlig ventilation, °C"],
    ["BUILDING", "th_cool", 25, "temperatur for køling, °C"], ["BUILDING", "th_store", 15], ["BUILDING", "dim_room_temp", 20, "dimensionerende rumtemperatur, °C"],
    ["BUILDING", "dim_store_temp", 15], ["BUILDING", "tu", -12, "udetemperatur, °C"], ["BUILDING", "tb", 168, "brugstid, timer pr. uge"],
    ["BUILDING", "start_time", 0, "brugstid starter, kl."], ["BUILDING", "end_time", 24, "brugstid slutter, kl."], ["BUILDING", "ae2", 0], ["BUILDING", "ae3", 0],
    ["BUILDING", "floors", 1, "antal etager"], ["BUILDING", "floors_avg_height", 0, "gennemsnitlig etagehøjde"], ["BUILDING", "dwellings", 1, "antal boliger"],
    ["BUILDING", "add_eframe", 0, "tillæg til energirammen"], ["BUILDING", "cooling_frac", 0, "andel med køling"], ["BUILDING", "sup_heating", F, "supplerende opvarmning"],
    ["BUILDING", "solarpanel", F, "solfanger"], ["BUILDING", "heatpump", F, "varmepumpe"], ["BUILDING", "sup_oven", F], ["BUILDING", "heat_dist", F],
    ["BUILDING", "windmill", F, "vindmølle"], ["BUILDING", "comfort26Requirement", 100], ["BUILDING", "comfort27Requirement", 25],
    ["BUILDING", "calc_condition", ".actual."], ["BUILDING", "is_extension", F, "tilbygning"],
    ["VENTILATION", "qvm_night", 0, "mekanisk ventilation om natten"], ["VENTILATION", "qis", 0], ["VENTILATION", "qis_night", 0], ["VENTILATION", "el_vf", F],
    ["VENTILATION", "mec_ventilation", T, "mekanisk ventilation"],
    ["USAGE_LOAD", "papp_night", 0, "varme fra apparater om natten"], ["USAGE", "app_use", 0], ["USAGE", "app_always", 0],
    ["COOLING", "load_fac", 0], ["COOLING", "el_dem", 0], ["COOLING", "heat_dem", 0], ["COOLING", "heat_cap_pc", 0], ["COOLING", "additional_cooling", 1.5],
    ["DHW_SYSTEM", "temp", 55, "temperatur på varmt brugsvand, °C"], ["HEAT_DISTRIBUTION", "tube_type", 2],
    ["SOLAR_COLLECTOR", "area", 0, "solfangerens areal, m²"], ["HEATER_GAS", "dhw_frac", 0], ["HEATER_EL", "dhw_frac", 0],
    ["OPAQUE_CONST", "td_in", 20, "temperatur indenfor, °C"], ["OPAQUE_CONST", "no", 1, "antal"],
    ["TRANSP_CONSTR", "td_in", 20, "temperatur indenfor, °C"], ["TRANSP_CONSTR", "td_out", -12, "temperatur udenfor, °C"], ["TRANSP_CONSTR", "has_b", 1, "b-faktor"],
    ["TRANSP_CONSTR", "slope", 90, "hældning, grader"], ["TRANSP_CONSTR", "surface_temp", 0],
    ["COLD_BRIDGE", "td_in", 20, "temperatur indenfor, °C"], ["COLD_BRIDGE", "td_out", -12, "temperatur udenfor, °C"], ["COLD_BRIDGE", "has_b", 1, "b-faktor"], ["COLD_BRIDGE", "no", 1, "antal"],
    ["PV_CELL", "sidefin_left", 0, "skygge fra venstre side, grader"], ["PV_CELL", "sidefin_right", 0, "skygge fra højre side, grader"]
  ].map(function (x) { return { tag: x[0], post: POST[x[0]], felt: x[1], vaerdi: x[2], navn: x[3] || null }; });
  // Det, panelet slet ikke skriver. Energy Design har sine egne felter til det.
  var IKKE_SKREVET = ["belysning", "kedel", "varmepumpe", "vindmølle", "supplerende rumopvarmning", "varmerør", "varmtvandsbeholder", "andre pumper end den konstante", "rumhøjde", "opvarmet kælder", "beskrivelse, kontaktoplysninger og kommentarer"];
  var NAVN = { "TRANSP_CONSTR.orient": "retning, grader", "BE05.version": "beregningskernens version", "BUILDING.has_disabled_transp_const": "vinduer og døre, der er slået fra", "BUILDING.has_disabled_opaque_const": "bygningsdele, der er slået fra" };
  FASTE.forEach(function (f) { if (f.navn) NAVN[f.tag + "." + f.felt] = f.navn; });

  // De faste felter, grupperet efter post. Poster, som modellen ikke har (fx solceller), er udeladt.
  function fasteFelter(p) {
    var har = {
      TRANSP_CONSTR: !!(p && p.konstruktioner && p.konstruktioner.some(function (c) { return c.aabninger && c.aabninger.length; })),
      COLD_BRIDGE: !!(p && p.kuldebroer && p.kuldebroer.length), PV_CELL: !!(p && p.solceller)
    };
    var ud = [], efter = {};
    FASTE.forEach(function (f) {
      if (har[f.tag] === false) return;
      var g = efter[f.tag];
      if (!g) { g = efter[f.tag] = { tag: f.tag, post: f.post, felter: [] }; ud.push(g); }
      g.felter.push({ felt: f.felt, vaerdi: f.vaerdi, tekst: visV(f.vaerdi), navn: f.navn });
    });
    return ud;
  }
  // En værdi, som en studerende kan læse: komma som decimaltegn, ja/nej for flag.
  function visV(v) {
    if (v == null || v === "" || v === "$") return "ingen værdi";
    if (v === T) return "ja"; if (v === F) return "nej";
    var s = String(v);
    if (/^-?\d+\.\d+$/.test(s)) s = s.replace(".", ",");
    return s.length > 40 ? s.slice(0, 39) + "…" : s;
  }

  /* ---------- Læs ---------- */
  // Formatet er fladt: rodens børn har rid="#n" og felter uden egne børn. Det tåler den simple læsning, også i Node.
  function indlaes(xml) {
    var m = {}, liste = [], re = /<([A-Za-z_]\w*)\s+rid="(#\d+)"\s*>([\s\S]*?)<\/\1\s*>|<([A-Za-z_]\w*)\s+rid="(#\d+)"\s*\/>/g, h;
    while ((h = re.exec(xml))) {
      var tag = h[1] || h[4], rid = h[2] || h[5], f = {}, fr = /<([A-Za-z_]\w*)\s*(?:\/>|>([\s\S]*?)<\/\1\s*>)/g, x;
      if (h[3]) while ((x = fr.exec(h[3]))) { var t = x[2] == null ? "" : x[2].trim(); f[x[1]] = t === "" ? null : afEsc(t); }
      var e = { tag: tag, rid: rid, f: f };
      m[rid] = e; liste.push(e);
    }
    return { m: m, liste: liste };
  }
  function num(s) { if (s == null) return null; var n = Number(s); return s !== "" && isFinite(n) ? n : s; }
  function erBe05(xml) { return typeof xml === "string" && /<BE05[\s>]/.test(xml) && /<BUILDING\s+rid=/.test(xml); }
  function refs(m, s) { return (s || "").split(/\s+/).filter(Boolean).map(function (r) { return m[r]; }).filter(Boolean); }
  function tal(f, navne) { var u = {}; navne.forEach(function (k) { u[k] = num(f[k]); }); return u; }
  function medId(id, o) { var u = { id: id }; Object.keys(o).forEach(function (k) { u[k] = o[k]; }); return u; }

  function laes(xml) {
    if (!erBe05(xml)) throw new Error("Filen er ikke en Be18/Energy Design XML (roden BE05 mangler).");
    var d = indlaes(xml), m = d.m, adv = [];
    var be = d.liste.filter(function (e) { return e.tag === "BUILDING"; })[0];
    if (!be) throw new Error("Filen har ingen bygning (BUILDING).");
    var b = be.f, ref = function (k) { return b[k] && m[b[k]] ? m[b[k]].f : null; };
    var p = { bygning: { id: b.id, ae: num(b.ae), ae4: num(b.ae4), heat_cap: num(b.heat_cap), rotation: num(b.rotation), has_btype: b.has_btype, basic_heat_supply: b.basic_heat_supply, project_no: b.project_no, street: b.street, zip_code: b.zip_code, city: b.city } };
    p.areas = refs(m, b.has_areas).map(function (a) { return { id: a.f.id, area: num(a.f.area), type: a.f.type }; });
    var tr = refs(m, b.has_transp_const).map(function (t) { return t.f; }), brugt = {};
    p.konstruktioner = refs(m, b.has_opaque_const).map(function (o) {
      var f = o.f, ab = [];
      tr.forEach(function (t, i) {
        if (t.parent !== f.GUID) return;
        brugt[i] = 1;
        var sf = (m[t.has_shading] || { f: {} }).f;
        ab.push({ id: t.id, fab: t.fab, u: num(t.u), no: num(t.no), type: num(t.type), ff: num(t.ff), g: num(t.g), fc: num(t.fc), ot: t.ot === T, eref: num(t.eref), width: num(t.width), height: num(t.height), area: num(t.area), skygge: tal(sf, ["horizon", "overhang", "sidefin_left", "sidefin_right", "opening"]) });
      });
      return { id: f.id, u: num(f.u), b: num(f.has_b), td_out: num(f.td_out), type: num(f.type), orient: f.orient, slope: num(f.slope), total_area: num(f.total_area), mod_uopvarmet: !!f.unheatedGUID, aabninger: ab };
    });
    var uden = tr.filter(function (t, i) { return !brugt[i]; });
    if (uden.length) adv.push(uden.length + " vinduer/døre har ingen bygningsdel og er ikke læst.");
    var uh = ref("has_unheated_space");
    if (uh) {
      var env = function (s) { return refs(m, s).map(function (e) { return { id: e.f.id, area: num(e.f.area), u: num(e.f.u) }; }); };
      p.unheated = { id: uh.id, gross_area: num(uh.gross_area), vent: num(uh.vent), intern: env(uh.has_int_const), ekstern: env(uh.has_ext_const) };
    }
    var v = ref("has_ventilation");
    if (v) p.ventilation = medId(v.id, tal(v, ["area", "fo", "qvm", "nvgv", "tin", "qid", "sel", "qvm_day", "qid_day", "air_tightness"]));
    else adv.push("Ventilation mangler i filen.");
    var us = ref("has_usage"), ul = us && m[us.has_usage_load] ? m[us.has_usage_load].f : null;
    if (ul) p.brug = medId(ul.id, tal(ul, ["area", "ppers", "papp"]));
    if (b.has_lighting && b.has_lighting !== "$") adv.push("Belysning findes i filen, men panelet kan ikke skrive den endnu.");
    p.kuldebroer = refs(m, b.has_cold_bridge).map(function (k) { return { id: k.f.id, laengde: num(k.f.area), psi: num(k.f.u), type: num(k.f.type) }; });
    var hs = ref("has_heating_systems") || {};
    if (hs.has_pv_cell && m[hs.has_pv_cell]) { var pv = m[hs.has_pv_cell].f; p.solceller = medId(pv.id, tal(pv, ["area", "orient", "slope", "horizon", "peak_power", "efficiency"])); }
    if (hs.has_d_h_exch && m[hs.has_d_h_exch]) { var dh = m[hs.has_d_h_exch].f, fv = medId(dh.id, tal(dh, ["nom_eff", "heat_loss", "min_temp", "b_factor", "auto_stb"])); fv.dhw = dh.dhw === T; p.fjernvarme = fv; }
    else adv.push("Fjernvarmeveksler mangler. Panelet kan kun skrive fjernvarme.");
    [["has_boiler", "Kedel"], ["has_heat_pump", "Varmepumpe"], ["has_wind_mill", "Vindmølle"]].forEach(function (x) { if (hs[x[0]] && hs[x[0]] !== "$") adv.push(x[1] + " findes i filen, men panelet kan ikke skrive den endnu."); });
    if (hs.has_sup_room_heat && hs.has_sup_room_heat !== "$") adv.push("Supplerende rumopvarmning findes i filen, men panelet kan ikke skrive den endnu.");
    var hd = ref("has_heat_distribution");
    if (hd) {
      p.fremloeb = m[hd.inlet_temp] ? num(m[hd.inlet_temp].f.temp) : null;
      p.retur = m[hd.return_temp] ? num(m[hd.return_temp].f.temp) : null;
      if (hd.pump_const_hs && m[hd.pump_const_hs]) { var pu = m[hd.pump_const_hs].f; p.pumpe = medId(pu.id, tal(pu, ["no", "pnom", "fp"])); }
      if (hd.has_tube && hd.has_tube !== "$") adv.push("Varmerør findes i filen, men panelet kan ikke skrive dem endnu.");
      if (hd.pump_const_year || hd.pump_timereg_hs || hd.pump_combi) adv.push("Filen har andre pumper end den konstante varmepumpe; de skrives ikke.");
    }
    var dhw = ref("has_hot_water");
    if (dhw) { p.brugsvand = num(dhw.consumption); if (dhw.has_dhw_tank && dhw.has_dhw_tank !== "$") adv.push("Varmtvandsbeholder findes i filen, men panelet kan ikke skrive den endnu."); }
    var r = ref("has_heated_room");
    if (r) p.rum = tal(r, ["area", "vent_day", "vent_evening", "vent_night", "vent_basic"]);
    var c = d.liste.filter(function (e) { return e.tag === "climateData"; })[0];
    if (c) p.klima = { name: c.f.name, supp_start: num(c.f.supp_start), supp_slope: num(c.f.supp_slope), months: refs(m, c.f.months).map(function (x) { return tal(x.f, ["tempOut", "humidityOut", "tempIn", "humidityIn"]); }) };
    var ud = { linjer: [], tabt: [] };
    if (!mangler(p).length) ud = ikkeMed(d, indlaes(skriv(p)));
    else ud.linjer.push("Filen mangler " + mangler(p).join(", ") + ", så panelet kan ikke sammenligne den felt for felt.");
    // Rumhøjde og opvarmet kælder står ikke i filen. Det er en note, ikke et felt, der er tabt, så den står for sig.
    var noter = ["Panelet henter ikke rumhøjde og opvarmet kælder fra filen. Kravet regnes derfor uden tillæg for rumhøjde og uden opvarmet kælder. Ret dem på Klima-siden, hvis projektet har dem."];
    return { model: p, advarsler: adv, ikkeOverfoert: ud.linjer, noter: noter, tabt: ud.tabt };
  }

  /* ---------- Hvad kom ikke med? ---------- */
  // Sammenligner filen post for post med det, skriv() laver ud fra den læste model. Alt, hvad filen har, og som ikke
  // kommer uændret med, meldes. Kontaktoplysninger, beskrivelse og kommentarer gengives aldrig, kun at de findes.
  var DAEKKET = { "BE05.id": 1, "BUILDING.has_lighting": 1, "HEATING_SYSTEMS.has_boiler": 1, "HEATING_SYSTEMS.has_heat_pump": 1, "HEATING_SYSTEMS.has_wind_mill": 1, "HEATING_SYSTEMS.has_sup_room_heat": 1, "HEAT_DISTRIBUTION.has_tube": 1, "HEAT_DISTRIBUTION.pump_const_year": 1, "HEAT_DISTRIBUTION.pump_timereg_hs": 1, "HEAT_DISTRIBUTION.pump_combi": 1, "DHW_SYSTEM.has_dhw_tank": 1 };
  var PRIVAT = { DESCRIPT: 1, CONTACT: 1, COMMENTS: 1 }, GUIDFELT = { GUID: 1, parent: 1, unheatedGUID: 1 };
  function tom(v) { return v == null || v === "" || v === "$"; }
  function erRef(v) { return typeof v === "string" && /^#\d+(\s+#\d+)*$/.test(v); }
  function ens(a, b, tol) {
    if (tom(a) || tom(b)) return tom(a) && tom(b);
    var x = Number(a), y = Number(b);
    if (isFinite(x) && isFinite(y)) return Math.abs(x - y) <= tol + 1e-9 * Math.max(1, Math.abs(x));
    return String(a) === String(b);
  }
  function ikkeMed(fil, ny) {
    var set = {}, antal = {}, afv = {}, orden = [], ekstra = {}, eorden = [], privat = false;
    function rod(doc, tag) { return doc.liste.filter(function (e) { return e.tag === tag; })[0] || null; }
    function maerk(e) { if (!e || set[e.rid]) return; set[e.rid] = 1; Object.keys(e.f).forEach(function (k) { if (erRef(e.f[k])) refs(fil.m, e.f[k]).forEach(maerk); }); }
    function privatTrae(e) {
      if (!e || set[e.rid]) return; set[e.rid] = 1;
      Object.keys(e.f).forEach(function (k) { var v = e.f[k]; if (erRef(v)) refs(fil.m, v).forEach(privatTrae); else if (!tom(v) && !/^template_id/.test(k)) privat = true; });
    }
    function afvig(tag, k, va, vb) { var n = tag + "." + k; if (!afv[n]) { afv[n] = { tag: tag, felt: k, fil: [], ny: [] }; orden.push(n); } afv[n].fil.push(va); afv[n].ny.push(vb); }
    function overskud(tag, k, e) { var n = tag + "." + k; if (!ekstra[n]) { ekstra[n] = { tag: tag, felt: k, mål: e.tag, n: 0 }; eorden.push(n); } ekstra[n].n++; maerk(e); }
    function par(a, b) {
      if (!a || set[a.rid]) return;
      if (PRIVAT[a.tag]) { privatTrae(a); return; }
      set[a.rid] = 1; antal[a.tag] = (antal[a.tag] || 0) + 1;
      Object.keys(a.f).forEach(function (k) {
        var va = a.f[k], vb = b.f[k], n = a.tag + "." + k;
        if (DAEKKET[n]) { if (erRef(va)) refs(fil.m, va).forEach(maerk); return; }
        if (erRef(va)) { foelg(a, k, va, vb); return; }
        if (tom(va)) return;
        if (GUIDFELT[k]) { if (tom(vb)) afvig(a.tag, k, "en henvisning", null); return; }
        if (!ens(va, vb, a.tag === "OPAQUE_CONST" && k === "area" ? 0.011 : 0)) afvig(a.tag, k, va, vb);
      });
    }
    // Vinduer og døre parres efter bygningsdel og rækkefølge, ikke efter rid.
    function noegler(doc, liste) {
      var b = rod(doc, "BUILDING"), idx = {}, tael = {}, ud = {};
      refs(doc.m, b && b.f.has_opaque_const).forEach(function (o, i) { if (o.f.GUID && idx[o.f.GUID] == null) idx[o.f.GUID] = i; });
      liste.forEach(function (t) { var i = idx[t.f.parent]; if (i == null) return; tael[i] = (tael[i] || 0) + 1; ud[t.rid] = i + ":" + tael[i]; });
      return ud;
    }
    function foelg(a, k, va, vb) {
      var la = refs(fil.m, va), lb = erRef(vb) ? refs(ny.m, vb) : [];
      if (a.tag === "BUILDING" && k === "has_transp_const") {
        var kf = noegler(fil, la), kn = noegler(ny, lb), efter = {};
        lb.forEach(function (t) { efter[kn[t.rid]] = t; });
        la.forEach(function (t) { var n = kf[t.rid]; if (n == null) maerk(t); else if (efter[n]) par(t, efter[n]); else overskud(a.tag, k, t); });
        return;
      }
      la.forEach(function (x, i) { if (set[x.rid]) return; if (lb[i]) par(x, lb[i]); else overskud(a.tag, k, x); });
    }
    var be = rod(fil, "BE05"), bn = rod(ny, "BE05");
    if (be && bn) par(be, bn);
    par(rod(fil, "BUILDING"), rod(ny, "BUILDING"));
    par(rod(fil, "climateData"), rod(ny, "climateData"));

    var linjer = [], tabt = [];
    orden.forEach(function (n) {
      var g = afv[n], navn = NAVN[n], hoved = (POST[g.tag] || g.tag) + ", " + g.felt + (navn ? " (" + navn + ")" : ""), ialt = antal[g.tag] || g.fil.length;
      var nyEns = g.ny.every(function (v) { return ens(v, g.ny[0], 0); }), nyTekst = (nyEns ? "" : "fx ") + visV(g.ny[0]);
      if (ialt <= 1) linjer.push(hoved + ": filen har " + visV(g.fil[0]) + "; panelet skriver " + nyTekst + ".");
      else linjer.push(hoved + ": " + g.fil.length + " af " + ialt + " har en anden værdi i filen (fx " + visV(g.fil[0]) + "); panelet skriver " + nyTekst + ".");
      tabt.push({ post: POST[g.tag] || g.tag, tag: g.tag, felt: g.felt, navn: navn || null, fil: g.fil[0], panel: g.ny[0], antal: g.fil.length, ialt: ialt });
    });
    eorden.forEach(function (n) {
      var g = ekstra[n], navn = NAVN[n];
      linjer.push((POST[g.tag] || g.tag) + ", " + g.felt + (navn ? " (" + navn + ")" : "") + ": filen har " + g.n + (g.n === 1 ? " post" : " poster") + " (" + g.mål + "), som panelet ikke læser.");
      tabt.push({ post: POST[g.tag] || g.tag, tag: g.tag, felt: g.felt, navn: navn || null, fil: g.n + " " + g.mål, panel: null, antal: g.n, ialt: g.n });
    });
    if (privat) linjer.push("Filen har beskrivelse, kontaktoplysninger eller kommentarer. Panelet læser dem ikke, og de kommer ikke med i XML-filen.");
    var rest = fil.liste.filter(function (e) { return !set[e.rid]; });
    if (rest.length) linjer.push(rest.length + (rest.length === 1 ? " post" : " poster") + " i filen hænger ikke sammen med bygningen og er ikke læst (" + rest.map(function (e) { return e.tag; }).filter(function (t, i, l) { return l.indexOf(t) === i; }).join(", ") + ").");
    return { linjer: linjer, tabt: tabt };
  }

  // Hvad mangler, før modellen kan skrives? Tom liste = skriv() kan køre.
  function mangler(p) {
    var u = [];
    ["bygning", "areas", "konstruktioner", "ventilation", "brug", "kuldebroer", "fjernvarme", "pumpe", "rum", "klima"].forEach(function (k) { if (p == null || p[k] == null) u.push(k); });
    if (p && p.fremloeb == null) u.push("fremloeb");
    if (p && p.retur == null) u.push("retur");
    if (p && p.brugsvand == null) u.push("brugsvand");
    if (p && p.bygning && !(p.bygning.ae > 0)) u.push("bygning.ae");
    return u;
  }

  return { KERNE: KERNE, OPHAV: OPHAV, FASTE: FASTE, IKKE_SKREVET: IKKE_SKREVET, skriv: skriv, laes: laes, mangler: mangler, fasteFelter: fasteFelter, erBe05: erBe05, indlaes: indlaes };
});
