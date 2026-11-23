/* ISSANA 3D: «Manglende oplysninger» in the price workspace (arbejdsrum-pris.js shows it as its second view).
   A model often lacks what decides the price (a C18 concrete costs something else than a C30). This module finds, per
   Revit type, which price-determining properties (pris-egenskaber.js) apply and whether the value is known, groups the
   gaps per property with the largest first, and lets the user set a value for a whole group or a selection at once.

   Where a value lives:
   - ISSANA data, at once: localStorage under "issana-pris-oplysninger-v1:<modelKey>", so it is there after a reload.
   - Revit, after the user's yes: the type's «ISSANA Data» record gets pris.oplysninger[key] = {vaerdi, kilde, tid}
     through the workspace's change list (api.aendringsliste). Nothing here writes to Revit itself.

   Sources of a value: "entered" (the user, here), "model" (read from material names, the type name, parameters or the
   model's own data), "assumed" (the default from the list, never a real value) and "missing" (no value, no default).
   Other workspaces read everything through IssanaPrisOplysninger.values(). */
(function (root) {
  "use strict";

  var SCHEMA = "issana-pris-oplysninger/1";
  var STORE_PREFIX = "issana-pris-oplysninger-v1:";
  var DATA_SCHEMA = "issana-bygdata/1";
  var TYPE_DATA = "ISSANA Data";
  var MAX_HISTORY = 50;
  var MAX_TEXT = 40;
  var SOURCE_TEXT = { entered: "indtastet", model: "aflæst", assumed: "antaget", missing: "mangler" };
  var REVIT_TEXT = { saved: "gemt i Revit", pending: "i ændringslisten", none: "ikke i Revit endnu" };
  var listeners = [];

  /* ---------- Small helpers ---------- */
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>\"]/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character];
    });
  }

  function lower(value) { return String(value == null ? "" : value).toLowerCase(); }

  function isNumber(value) { return typeof value === "number" && isFinite(value); }

  function number(value, digits) {
    return new Intl.NumberFormat("da-DK", { maximumFractionDigits: digits == null ? 2 : digits }).format(value);
  }

  function decimal(text) {
    var cleaned = String(text == null ? "" : text).trim().replace(",", ".");
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    return Number(cleaned);
  }

  function plural(count, one, many) { return number(count, 0) + " " + (count === 1 ? one : many); }

  function defs() { return (root.IssanaPrisEgenskaber && root.IssanaPrisEgenskaber.list) || []; }

  function defByKey(key) { return defs().filter(function (def) { return def.key === key; })[0] || null; }

  /* ---------- Does a property apply to a type? ---------- */
  // Short words (eps, pir) must stand alone; longer ones may be part of a compound («betonvæg», «mineraluldsplade»).
  function hasWord(text, word) {
    var haystack = lower(text), needle = lower(word);
    if (!needle) return false;
    if (needle.length > 3) return haystack.indexOf(needle) >= 0;
    return new RegExp("(^|[^a-zæøå0-9])" + needle + "($|[^a-zæøå])").test(haystack);
  }

  function isMaterial(name, appliesTo) {
    if (!(appliesTo.materials || []).some(function (word) { return hasWord(name, word); })) return false;
    return !(appliesTo.exclude || []).some(function (word) { return hasWord(name, word); });
  }

  function typeText(entry) {
    return [entry.type.name, entry.type.family].filter(Boolean).join(" ");
  }

  // Null when the property does not apply; otherwise the matching layers (thickest first), the texts a value can be read
  // from, and the volume of the matching layers (m³) when the type has layers and its elements an area.
  function scope(def, entry) {
    var appliesTo = def.appliesTo || {};
    if (appliesTo.categories && appliesTo.categories.indexOf(entry.category) < 0) return null;
    var name = typeText(entry);
    if (!appliesTo.materials) return { layers: [], texts: [name], volume: 0 };
    var matched = (entry.type.layers || []).filter(function (layer) { return layer && isMaterial(layer.material, appliesTo); });
    if (!matched.length) return isMaterial(name, appliesTo) ? { layers: [], texts: [name], volume: 0 } : null;
    matched = matched.slice().sort(function (a, b) { return (b.widthMm || 0) - (a.widthMm || 0); });
    var width = matched.reduce(function (sum, layer) { return sum + (isNumber(layer.widthMm) ? layer.widthMm : 0); }, 0);
    return {
      layers: matched,
      texts: matched.map(function (layer) { return layer.material; }).concat([name]),
      volume: entry.area * width / 1000
    };
  }

  /* ---------- Reading a value from a text (material name, type name, parameter value) ---------- */
  function inRange(value, low, high) { return isNumber(value) && value >= low && value <= high ? value : null; }

  var FIRE_SUFFIX = { c: "C", sa: "Sa", sm: "Sm", s200: "S200" };

  var READ = {
    // «Beton C30/37» → C30. A lower-case c only counts directly before the digits («c30», not «c/c 600»).
    concreteStrength: function (text) {
      var match = /(^|[^A-Za-z0-9])(?:C\s?|c)(\d{2})(?!\d)/.exec(text);
      return match ? "C" + match[2] : null;
    },
    // «isolering kl. 34», «λ = 0,037», «0,034 W/mK», «Mineraluld 37» → 34 / 37.
    insulationLambdaClass: function (text) {
      var match = /(^|[^a-zæøå])(?:kl(?:asse)?\.?|lambda|λ)\s*[=:]?\s*(?:0[.,]0)?(\d{2})(?!\d)/i.exec(text);
      if (match) return inRange(Number(match[2]), 20, 50);
      match = /(^|[^\d])0[.,]0(\d{2})(?!\d)/.exec(text);
      if (match) return inRange(Number(match[2]), 20, 50);
      match = /(?:uld|isolering|insulation)\s+(\d{2})(?![\d.,x×]|\s*mm)/i.exec(text);
      return match ? inRange(Number(match[1]), 20, 50) : null;
    },
    // «EI2 30-C», «EI 60», «REI60», «BD 30» → the class written the usual way.
    fireClass: function (text) {
      var match = /(^|[^A-Za-z])(REI|EI\s?2|EI|BD|BS)[\s-]?(\d{2,3})(?:\s?-?\s?(C|Sa|Sm|S200))?(?![A-Za-z0-9])/i.exec(text);
      if (!match) return null;
      var suffix = match[4] ? "-" + FIRE_SUFFIX[match[4].toLowerCase()] : "";
      return match[2].toUpperCase().replace(/\s/g, "") + " " + match[3] + suffix;
    },
    // «Rw 35», «35 dB» → 35.
    soundClass: function (text) {
      var match = /R['’]?w\s*[=:]?\s*(\d{2})(?!\d)/i.exec(text);
      if (match) return Number(match[1]);
      match = /(^|[^\d.,])(\d{2})\s*dB/i.exec(text);
      return match ? Number(match[2]) : null;
    },
    // «U=0,8», «U-værdi 1,1» → 0.8 / 1.1.
    uValue: function (text) {
      var match = /(^|[^A-Za-zÆØÅæøå])(?:U|[Uu]-?v(?:æ|ae)rdi)\s*[=:]?\s*(\d[.,]\d{1,2})(?!\d)/.exec(text);
      return match ? Number(match[2].replace(",", ".")) : null;
    },
    // «2 lag gips», «2x13 gips», «2 x 12,5 mm gips» → 2.
    gypsumLayers: function (text) {
      var match = /(^|[^\d.,])(\d)\s*(?:x|×|lag)\s*(?:\d+(?:[.,]\d+)?\s*(?:mm)?\s*)?(?:gips|gyps)/i.exec(text);
      return match ? inRange(Number(match[2]), 1, 6) : null;
    }
  };

  // What the user typed, as the stored value; null when it cannot be understood.
  function normalize(def, raw) {
    var text = String(raw == null ? "" : raw).trim().replace(/\s+/g, " ");
    if (!text || !def) return null;
    var value;
    switch (def.key) {
      case "concreteStrength":
        value = /^C?\s?(\d{2})(?:\s*\/\s*\d{2,3})?$/i.exec(text);
        return value ? "C" + value[1] : null;
      case "insulationLambdaClass":
        value = decimal(text);
        if (value != null && value > 0 && value < 1) value = Math.round(value * 1000);
        return value != null && value === Math.round(value) ? inRange(value, 20, 50) : null;
      case "gypsumLayers":
        value = decimal(text);
        return value != null && value === Math.round(value) ? inRange(value, 1, 6) : null;
      case "uValue":
        value = decimal(text);
        return value != null && value > 0 && value < 10 ? value : null;
      case "soundClass":
        value = decimal(text.replace(/^R['’]?w\s*[=:]?\s*/i, "").replace(/\s*dB$/i, ""));
        if (value != null) return inRange(value, 10, 80);
        return text.length <= MAX_TEXT ? text : null;
      case "fireClass":
        return READ.fireClass(text) || (text.length <= MAX_TEXT ? text : null);
      default:
        return text.length <= MAX_TEXT ? text : null;
    }
  }

  function display(def, value) {
    if (value == null || value === "") return "";
    var text = isNumber(value) ? number(value, 2) : String(value);
    return def && def.unit && isNumber(value) ? text + " " + def.unit : text;
  }

  // Gypsum boards per side: the run of gypsum layers at either face of the type; all of them when there is no core.
  function gypsumPerSide(layers, appliesTo) {
    var flags = (layers || []).filter(function (layer) { return layer && layer.widthMm !== 0; })
      .map(function (layer) { return isMaterial(layer.material, appliesTo); });
    var total = flags.filter(Boolean).length;
    if (!total || total === flags.length) return total || null;
    var start = 0, end = 0;
    while (flags[start]) start++;
    while (flags[flags.length - 1 - end]) end++;
    return Math.max(start, end) || total;
  }

  function fromParameters(def, entry) {
    var names = def.parameters || [];
    var bags = [entry.type.params].concat(entry.elements.length ? [entry.elements[0].params] : []);
    for (var b = 0; b < bags.length; b++) {
      for (var n = 0; bags[b] && n < names.length; n++) {
        var raw = bags[b][names[n]];
        var value = raw == null || raw === "" ? null : normalize(def, raw);
        if (value != null) return { value: value, detail: "parameteren «" + names[n] + "»" };
      }
    }
    return null;
  }

  function soundFromData(entry) {
    var documented = entry.type.bygdata && entry.type.bygdata.data && entry.type.bygdata.data.lyd &&
      entry.type.bygdata.data.lyd.dokumenteret;
    if (!documented || !isNumber(documented.vaerdi) || !/^R/.test(String(documented.stoerrelse || "R"))) return null;
    return { value: documented.vaerdi, detail: "ISSANA Data: dokumenteret lydværdi" };
  }

  // The value the model itself carries, with where it was found; null when the model says nothing.
  function readModel(def, entry, found) {
    var hit = fromParameters(def, entry);
    if (hit) return hit;
    if (def.key === "uValue") {
      var withU = entry.elements.filter(function (element) { return isNumber(element.uValue) && element.uValue > 0; })[0];
      if (withU) return { value: withU.uValue, detail: "U-værdien i modellen" };
    }
    if (def.key === "gypsumLayers" && found.layers.length) {
      var perSide = gypsumPerSide(entry.type.layers, def.appliesTo || {});
      if (perSide) return { value: perSide, detail: "typens lag" };
    }
    if (def.key === "soundClass") {
      hit = soundFromData(entry);
      if (hit) return hit;
    }
    var reader = READ[def.key];
    for (var i = 0; reader && i < found.texts.length; i++) {
      var value = reader(String(found.texts[i] || ""));
      if (value != null) return { value: value, detail: "«" + found.texts[i] + "»" };
    }
    return null;
  }

  /* ---------- ISSANA data: the user's values per type ---------- */
  function storage() {
    try { return root.localStorage || null; } catch (error) { return null; }
  }

  function modelKey(model) { return (model && (model.modelKey || model.model)) || "model"; }

  function emptyStore() { return { schema: SCHEMA, typer: {} }; }

  function load(model) {
    var store = storage();
    if (!store) return emptyStore();
    try {
      var parsed = JSON.parse(store.getItem(STORE_PREFIX + modelKey(model)) || "null");
      if (parsed && parsed.schema === SCHEMA && parsed.typer && typeof parsed.typer === "object") return parsed;
    } catch (error) { /* an unreadable entry is treated as no entry */ }
    return emptyStore();
  }

  function persist(model, data) {
    var store = storage();
    if (!store) return false;
    try { store.setItem(STORE_PREFIX + modelKey(model), JSON.stringify(data)); return true; } catch (error) { return false; }
  }

  function typeKey(type) { return type.uniqueId ? String(type.uniqueId) : "id:" + type.id; }

  function parsePost(text) {
    if (!text || typeof text !== "string") return null;
    try {
      var parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch (error) { return null; }
  }

  function typeParam(api) {
    var names = api && api.aendringsliste && api.aendringsliste.P;
    return (names && names.typeData) || TYPE_DATA;
  }

  function rawText(type, param) {
    var raw = type.bygdata && type.bygdata.raw;
    return raw && typeof raw[param] === "string" ? raw[param] : "";
  }

  // The record as Revit has it (the model file), and as it will be once the change list is saved.
  function savedPost(type, param) {
    var bygdata = type.bygdata;
    if (!bygdata) return null;
    if (bygdata.raw && typeof bygdata.raw[param] === "string") return parsePost(bygdata.raw[param]);
    return bygdata.data || null;
  }

  function currentPost(api, type) {
    var list = api && api.aendringsliste, param = typeParam(api);
    if (list && typeof list.nu === "function" && type.uniqueId) return parsePost(list.nu(type.uniqueId, param, type));
    return savedPost(type, param);
  }

  function postValue(post, key) {
    var values = post && post.pris && post.pris.oplysninger;
    var entry = values && values[key];
    return entry && typeof entry === "object" && entry.vaerdi != null && entry.vaerdi !== "" ? entry : null;
  }

  function same(a, b) { return String(a) === String(b); }

  // The user's value for one property of one type: ISSANA data and the Revit record, newest first. revit tells whether
  // Revit has the same value ("saved"), the change list holds it ("pending") or neither does ("none").
  function entered(def, type, store, posts) {
    var perType = store.typer[typeKey(type)];
    var local = perType && perType[def.key] && perType[def.key].vaerdi != null ? perType[def.key] : null;
    var saved = postValue(posts.saved, def.key);
    var current = postValue(posts.current, def.key);
    var chosen = local && current ? (String(current.tid || "") > String(local.tid || "") ? current : local) : (local || current);
    if (!chosen) return null;
    var revit = saved && same(saved.vaerdi, chosen.vaerdi) ? "saved" : current && same(current.vaerdi, chosen.vaerdi) ? "pending" : "none";
    return { value: chosen.vaerdi, revit: revit };
  }

  /* ---------- Analysis: types, properties and groups ---------- */
  function hasTypes(model) {
    return !!(model && Array.isArray(model.types) && model.types.length && Array.isArray(model.elements));
  }

  function typeEntries(model) {
    var byId = {}, entries = [];
    if (!hasTypes(model)) return entries;
    model.types.forEach(function (type) {
      if (!type || type.id == null) return;
      var entry = { type: type, elements: [], count: 0, area: 0, length: 0, category: null };
      byId[String(type.id)] = entry;
      entries.push(entry);
    });
    model.elements.forEach(function (element) {
      var entry = element && !element.erRum && element.typeId != null ? byId[String(element.typeId)] : null;
      if (!entry) return;
      entry.elements.push(element);
      entry.count++;
      if (isNumber(element.area)) entry.area += element.area;
      if (isNumber(element.length)) entry.length += element.length;
      if (!entry.category && element.category) entry.category = element.category;
    });
    return entries.filter(function (entry) { return entry.count > 0; });
  }

  // Amount per element id from the saved Sigma plan, when there is one: the best measure of what a gap means for the price.
  function amountsByElement(model) {
    var prices = model && model.sigmaPrices, map = {};
    if (!prices || !Array.isArray(prices.types)) return map;
    prices.types.forEach(function (type) {
      if (!isNumber(type.amount) || !(type.amount > 0)) return;
      (type.elementIds || []).forEach(function (id) { map[id] = type.amount; });
    });
    return map;
  }

  function property(def, entry, found, store, posts) {
    var user = entered(def, entry.type, store, posts);
    var read = readModel(def, entry, found);
    var result = { value: null, source: "missing", detail: null, revit: null, volume: found.volume, model: read ? read.value : null };
    if (user) { result.value = user.value; result.source = "entered"; result.revit = user.revit; }
    else if (read) { result.value = read.value; result.source = "model"; result.detail = read.detail; }
    else if (def.assumed != null) { result.value = def.assumed; result.source = "assumed"; }
    return result;
  }

  function isGap(prop) { return prop.source === "assumed" || prop.source === "missing"; }

  // Largest first: the Sigma amount when the plan has one, then volume, area and number of elements.
  function byWeight(a, b) {
    return (b.amount || 0) - (a.amount || 0) || (b.volume || 0) - (a.volume || 0) || (b.area || 0) - (a.area || 0) ||
      (b.count || 0) - (a.count || 0) || String(a.name || a.label).localeCompare(String(b.name || b.label), "da");
  }

  function groupFor(def, rows) {
    var members = rows.filter(function (row) { return row.properties[def.key]; }).map(function (row) {
      var prop = row.properties[def.key];
      return { row: row, prop: prop, name: row.name, amount: row.amount, volume: prop.volume, area: row.area, count: row.count };
    }).sort(byWeight);
    if (!members.length) return null;
    var missing = members.filter(function (member) { return isGap(member.prop); });
    var total = function (field) { return missing.reduce(function (sum, member) { return sum + (member[field] || 0); }, 0); };
    return {
      key: def.key, def: def, label: def.label, missing: missing,
      filled: members.filter(function (member) { return !isGap(member.prop); }),
      count: total("count"), area: total("area"), volume: total("volume"), amount: total("amount")
    };
  }

  function analyse(model, options) {
    options = options || {};
    var store = options.store || load(model), api = options.api || null, amounts = amountsByElement(model);
    var rows = typeEntries(model).map(function (entry) {
      var priced = entry.elements.filter(function (element) { return amounts[element.id] != null; })[0];
      var row = {
        uniqueId: typeKey(entry.type), id: entry.type.id, name: entry.type.name || "Type " + entry.type.id,
        category: entry.category, count: entry.count, area: entry.area, length: entry.length, type: entry.type,
        elementIds: entry.elements.map(function (element) { return element.id; }),
        amount: priced ? amounts[priced.id] : null, properties: {}
      };
      var posts = null;   // the type's record is parsed once, and only for types a property applies to
      defs().forEach(function (def) {
        var found = scope(def, entry);
        if (!found) return;
        posts = posts || { saved: savedPost(entry.type, typeParam(api)), current: currentPost(api, entry.type) };
        row.properties[def.key] = property(def, entry, found, store, posts);
      });
      return row;
    });
    var groups = defs().map(function (def) { return groupFor(def, rows); }).filter(Boolean).sort(function (a, b) {
      return (b.missing.length ? 1 : 0) - (a.missing.length ? 1 : 0) || byWeight(a, b);
    });
    return { rows: rows, groups: groups };
  }

  function gapCount(result) {
    return result.groups.reduce(function (sum, group) { return sum + group.missing.length; }, 0);
  }

  /* ---------- The exported accessor ---------- */
  function liveApi() {
    var workspace = root.issanaArbejdsrum;
    return workspace && workspace.api && typeof workspace.api.model === "function" ? workspace.api : null;
  }

  // Every type that has at least one price-determining property, with the value to calculate with and where it is from:
  // { schema, modelKey, types: { [typeUniqueId]: { typeId, typeName, category, elementIds,
  //     properties: { [key]: { label, value, unit, source, detail, revit } } } } }
  // source: "entered" | "model" | "assumed" | "missing" (value null). revit (entered only): "saved" | "pending" | "none".
  // Without arguments the loaded model and the change list of the page are used.
  function values(model, options) {
    var live = liveApi();
    options = options || {};
    if (!model && live) model = live.model();
    if (!options.api && live && live.model() === model) options = { store: options.store, api: live };
    var types = {};
    analyse(model, options).rows.forEach(function (row) {
      var keys = Object.keys(row.properties);
      if (!keys.length) return;
      var properties = {};
      keys.forEach(function (key) {
        var prop = row.properties[key], def = defByKey(key);
        properties[key] = {
          label: def.label, value: prop.value, unit: def.unit || null, source: prop.source, detail: prop.detail, revit: prop.revit
        };
      });
      types[row.uniqueId] = {
        typeId: row.id, typeName: row.name, category: row.category, elementIds: row.elementIds.slice(), properties: properties
      };
    });
    return { schema: SCHEMA, modelKey: modelKey(model), types: types };
  }

  function forType(uniqueId, model, options) {
    return values(model, options).types[String(uniqueId)] || null;
  }

  function onChange(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () { var index = listeners.indexOf(fn); if (index >= 0) listeners.splice(index, 1); };
  }

  function announce(model) {
    listeners.slice().forEach(function (fn) {
      try { fn(values(model)); } catch (error) { if (root.console) root.console.error("ISSANA pris-oplysninger:", error); }
    });
  }

  /* ---------- Writing: ISSANA data at once, Revit through the change list ---------- */
  function hasOwnContent(record) {
    return Object.keys(record).some(function (key) { return key !== "schema" && key !== "historik"; });
  }

  // Puts the type's «ISSANA Data» record, changed by mutate, in the change list. False when the page has no change list.
  function queue(api, type, mutate, what) {
    var list = api && api.aendringsliste;
    if (!list || typeof list.tilfoej !== "function" || !type.uniqueId) return false;
    var param = typeParam(api), raw = rawText(type, param);
    var record = parsePost(typeof list.nu === "function" ? list.nu(type.uniqueId, param, type) : raw) || { schema: DATA_SCHEMA };
    mutate(record);
    record.schema = DATA_SCHEMA;
    var text = raw;
    // A record that is empty again and was empty in Revit goes back to Revit's own value, so no empty change is left.
    if (hasOwnContent(record) || hasOwnContent(parsePost(raw) || {})) {
      record.historik = (Array.isArray(record.historik) ? record.historik : [])
        .concat([{ tid: new Date().toISOString(), felt: what, af: null }]).slice(-MAX_HISTORY);
      text = JSON.stringify(record);
    }
    return list.tilfoej({
      uniqueId: type.uniqueId, instans: false, param: param, til: text, navn: "Type: " + (type.name || type.id), obj: type, hvad: [what]
    }) !== false;
  }

  function setInRecord(record, key, value, time) {
    var pris = record.pris && typeof record.pris === "object" ? record.pris : (record.pris = {});
    var values = pris.oplysninger && typeof pris.oplysninger === "object" ? pris.oplysninger : (pris.oplysninger = {});
    if (value == null) delete values[key];
    else values[key] = { vaerdi: value, kilde: "bruger", tid: time };
    if (!Object.keys(values).length) delete pris.oplysninger;
    if (!Object.keys(pris).length) delete record.pris;
  }

  // Sets (value) or clears (null) one property on the given types. ISSANA data is saved first; the Revit write is only
  // queued. Returns { ok, value, count, queued, stored } or { ok: false, error }.
  function setValue(api, key, typeIds, raw) {
    var def = defByKey(key), model = api.model();
    if (!def) return { ok: false, error: "Ukendt oplysning: " + key };
    var value = raw == null ? null : normalize(def, raw);
    if (raw != null && value == null) return { ok: false, error: def.label + ": «" + String(raw).trim() + "» kan ikke bruges som værdi." };
    var store = load(model), time = new Date().toISOString(), wanted = {}, queued = 0, count = 0;
    (typeIds || []).forEach(function (id) { wanted[String(id)] = true; });
    var targets = typeEntries(model).filter(function (entry) { return wanted[typeKey(entry.type)] && scope(def, entry); });
    targets.forEach(function (entry) {
      var id = typeKey(entry.type), perType = store.typer[id] || (store.typer[id] = {});
      if (value == null) delete perType[key];
      else perType[key] = { vaerdi: value, tid: time };
      if (!Object.keys(perType).length) delete store.typer[id];
      count++;
    });
    var stored = persist(model, store);
    targets.forEach(function (entry) {
      if (queue(api, entry.type, function (record) { setInRecord(record, key, value, time); }, "pris: " + def.label)) queued++;
    });
    announce(model);
    return { ok: true, value: value, count: count, queued: queued, stored: stored };
  }

  // Values that are in ISSANA data but neither in Revit nor in the change list (the list was discarded, or the page was
  // reloaded before «Gem i Revit»): put them in the change list again.
  function queueUnsaved(api) {
    var queued = 0, time = new Date().toISOString();
    analyse(api.model(), { api: api }).rows.forEach(function (row) {
      var keys = Object.keys(row.properties).filter(function (key) { return row.properties[key].revit === "none"; });
      if (!keys.length) return;
      var done = queue(api, row.type, function (record) {
        keys.forEach(function (key) { setInRecord(record, key, row.properties[key].value, time); });
      }, "pris: " + keys.map(function (key) { return defByKey(key).label; }).join(", "));
      if (done) queued += keys.length;
    });
    return queued;
  }

  /* ---------- The view ---------- */
  function newState() { return { open: {}, picked: {}, value: {}, showFilled: {}, busy: false }; }

  function quantity(item) {
    var parts = [plural(item.count, "element", "elementer")];
    if (item.area > 0) parts.push(number(item.area, item.area < 10 ? 1 : 0) + " m²");
    if (item.volume > 0) parts.push(number(item.volume, item.volume < 10 ? 1 : 0) + " m³");
    return parts.join(", ");
  }

  function chip(def, prop) {
    var text = SOURCE_TEXT[prop.source] + (prop.value != null ? " " + display(def, prop.value) : "");
    var html = '<span class="sigma-pris-opl-kilde ' + prop.source + '"' + (prop.detail ? ' title="Aflæst fra ' + esc(prop.detail) + '"' : "") +
      ">" + esc(text) + "</span>";
    if (prop.source === "entered") html += '<span class="sigma-pris-opl-kilde revit-' + prop.revit + '">' + esc(REVIT_TEXT[prop.revit]) + "</span>";
    return html;
  }

  function nameButton(member) {
    var row = member.row, amount = isNumber(row.amount) ? " · " + number(row.amount, 0) + " kr." : "";
    return '<button type="button" class="sigma-pris-opl-navn" data-opl-vis="' + esc(row.uniqueId) + '" title="Vis typens elementer i 3D">' +
      esc(row.name) + "<small>" + esc((row.category || "Ukendt kategori") + " · " + quantity(member)) + esc(amount) + "</small></button>";
  }

  function missingRow(group, member, picked) {
    var id = member.row.uniqueId;
    return '<div class="sigma-pris-opl-r"><input type="checkbox" data-opl-type="' + esc(id) + '" data-opl-key="' + group.key + '"' +
      (picked[id] ? " checked" : "") + ' aria-label="Vælg ' + esc(member.row.name) + '">' + nameButton(member) + chip(group.def, member.prop) + "</div>";
  }

  function filledRow(group, member) {
    var detail = member.prop.detail ? '<small class="sigma-pris-opl-fra">fra ' + esc(member.prop.detail) + "</small>" : "";
    var remove = member.prop.source === "entered"
      ? '<button type="button" class="tbtn" data-opl-fjern="' + esc(member.row.uniqueId) + '" data-opl-key="' + group.key + '">Fjern</button>'
      : "";
    return '<div class="sigma-pris-opl-r udfyldt"><span></span>' + nameButton(member) + '<span class="sigma-pris-opl-v">' +
      chip(group.def, member.prop) + detail + remove + "</span></div>";
  }

  function pickedIn(group, state) {
    var picked = state.picked[group.key] || {};
    return group.missing.filter(function (member) { return picked[member.row.uniqueId]; });
  }

  function setBar(group, state) {
    var def = group.def, key = group.key, chosen = pickedIn(group, state).length;
    var options = (def.values || []).map(function (value) { return '<option value="' + esc(display(null, value)) + '">'; }).join("");
    var example = def.values && def.values.length ? "fx " + display(null, def.values[0]) : "skriv værdien";
    var html = '<div class="sigma-pris-opl-saet"><label><span>' + esc(def.label) + (def.unit ? " (" + esc(def.unit) + ")" : "") + "</span>" +
      '<input class="v3-in" data-opl-vaerdi="' + key + '" list="sigmaPrisOpl-' + key + '" value="' + esc(state.value[key] || "") +
      '" placeholder="' + esc(example) + '"></label><datalist id="sigmaPrisOpl-' + key + '">' + options + "</datalist>" +
      '<button type="button" class="tbtn primary" data-opl-alle="' + key + '">Sæt for alle ' + group.missing.length + "</button>" +
      '<button type="button" class="tbtn" data-opl-valgte="' + key + '"' + (chosen ? "" : " disabled") + ">Sæt for de valgte (" + chosen + ")</button></div>";
    if (def.assumed != null) {
      html += '<div class="v3-hint">Indtil værdien er sat, regnes der med ' + esc(display(def, def.assumed)) + ", mærket «antaget».</div>";
    }
    return html;
  }

  function groupHtml(group, state) {
    var open = !!state.open[group.key];
    var title = group.missing.length
      ? " – mangler på " + plural(group.missing.length, "type", "typer") + " <small>(" + esc(quantity(group)) + ")</small>"
      : " – udfyldt på " + plural(group.filled.length, "type", "typer");
    var html = '<div class="sigma-pris-opl-g' + (group.missing.length ? "" : " faerdig") + '"><button type="button" class="sigma-pris-opl-h" ' +
      'data-opl-gruppe="' + group.key + '" aria-expanded="' + open + '"><b>' + esc(group.label) + "</b>" + title + "</button>";
    if (!open) return html + "</div>";
    if (group.missing.length) {
      var picked = state.picked[group.key] || {};
      html += setBar(group, state) + group.missing.map(function (member) { return missingRow(group, member, picked); }).join("");
    }
    if (group.filled.length) {
      var shown = !group.missing.length || state.showFilled[group.key];
      if (group.missing.length) {
        html += '<button type="button" class="sigma-pris-flere" data-opl-udfyldt="' + group.key + '">' + (shown ? "Skjul" : "Vis") + " " +
          plural(group.filled.length, "udfyldt type", "udfyldte typer") + "</button>";
      }
      if (shown) html += group.filled.map(function (member) { return filledRow(group, member); }).join("");
    }
    return html + "</div>";
  }

  function countRevit(result, state) {
    var count = 0;
    result.rows.forEach(function (row) {
      Object.keys(row.properties).forEach(function (key) { if (row.properties[key].revit === state) count++; });
    });
    return count;
  }

  function summary(result) {
    var gaps = gapCount(result), types = result.rows.filter(function (row) {
      return Object.keys(row.properties).some(function (key) { return isGap(row.properties[key]); });
    }).length;
    var html = gaps
      ? '<div class="sigma-pris-opl-top"><b>' + plural(gaps, "oplysning mangler", "oplysninger mangler") + "</b> på " +
        plural(types, "type", "typer") + ". De største står øverst.</div>"
      : '<div class="v3-ok">Alle prisbestemmende oplysninger er udfyldt.</div>';
    html += '<div class="v3-hint">Sæt værdien for en hel gruppe eller for de typer, du vælger. Værdien gemmes straks i ISSANA-data ' +
      "og lægges i ændringslisten. Intet skrives i Revit, før du trykker «Gem i Revit».</div>";
    var unsaved = countRevit(result, "none"), pending = countRevit(result, "pending");
    if (unsaved || pending) {
      html += '<div class="v3-row">';
      if (unsaved) {
        html += '<button type="button" class="tbtn" id="sigmaPrisOplKoe">Læg ' + plural(unsaved, "værdi", "værdier") + " i ændringslisten</button>";
      }
      if (pending) {
        html += '<button type="button" class="tbtn" id="sigmaPrisOplAendringer">Se ændringer (' + pending + " fra pris)</button>";
      }
      html += "</div>";
    }
    return html;
  }

  function html(api, state) {
    var model = api.model();
    if (!hasTypes(model)) return '<div class="v3-tom">Hent modellen fra Revit først.</div>';
    if (!defs().length) return '<div class="v3-tom">Listen over prisbestemmende oplysninger er ikke indlæst.</div>';
    var result = analyse(model, { api: api });
    if (!result.groups.length) {
      return '<div class="v3-hint">Ingen af modellens typer har prisbestemmende oplysninger, der skal udfyldes her.</div>';
    }
    return summary(result) + result.groups.map(function (group) { return groupHtml(group, state); }).join("");
  }

  function selectIn3d(api, members) {
    var indices = [];
    members.forEach(function (member) {
      member.row.elementIds.forEach(function (id) { var index = api.indeks(id); if (index >= 0) indices.push(index); });
    });
    api.vaelg(indices);
    if (indices.length && api.fokus) api.fokus();
    return indices.length;
  }

  function tell(api, kind, text) {
    if (api && typeof api[kind] === "function") api[kind](text);
  }

  function reportSet(api, group, result) {
    if (!result.ok) { tell(api, "fejl", result.error); return; }
    var text = group.label + " " + display(group.def, result.value) + " er sat på " + plural(result.count, "type", "typer") +
      (result.stored ? " og gemt i ISSANA-data." : ". ISSANA-data kunne ikke gemmes i denne browser.");
    text += result.queued
      ? " Ændringen ligger i ændringslisten; intet er skrevet i Revit endnu."
      : " Ændringslisten er ikke tilgængelig, så intet er lagt til Revit.";
    tell(api, "info", text);
  }

  function all(container, selector, fn) {
    Array.prototype.forEach.call(container.querySelectorAll(selector), fn);
  }

  // Wires the view. render is the owner's redraw; state.busy keeps it quiet while several types are put in the change
  // list (each of them makes the workspace announce a change).
  function bind(container, api, state, render) {
    var result = analyse(api.model(), { api: api });
    var groupOf = function (key) { return result.groups.filter(function (group) { return group.key === key; })[0]; };
    var batch = function (work) {
      state.busy = true;
      try { return work(); } finally { state.busy = false; render(); }
    };
    var apply = function (key, members) {
      var input = container.querySelector('[data-opl-vaerdi="' + key + '"]');
      var raw = input ? input.value : state.value[key];
      if (!String(raw || "").trim()) { tell(api, "fejl", "Skriv eller vælg en værdi først."); return; }
      if (!members.length) { tell(api, "fejl", "Vælg mindst én type."); return; }
      batch(function () {
        var done = setValue(api, key, members.map(function (member) { return member.row.uniqueId; }), raw);
        if (done.ok) { state.value[key] = ""; state.picked[key] = {}; }
        reportSet(api, groupOf(key), done);
      });
    };

    all(container, "[data-opl-gruppe]", function (button) {
      button.onclick = function () {
        var key = button.getAttribute("data-opl-gruppe"), group = groupOf(key);
        state.open[key] = !state.open[key];
        if (state.open[key] && group) batch(function () { selectIn3d(api, group.missing.length ? group.missing : group.filled); });
        else render();
      };
    });
    all(container, "[data-opl-vaerdi]", function (input) {
      input.oninput = input.onchange = function () { state.value[input.getAttribute("data-opl-vaerdi")] = input.value; };
    });
    all(container, "[data-opl-type]", function (box) {
      box.onchange = function () {
        var key = box.getAttribute("data-opl-key"), picked = state.picked[key] || (state.picked[key] = {});
        if (box.checked) picked[box.getAttribute("data-opl-type")] = true;
        else delete picked[box.getAttribute("data-opl-type")];
        render();
      };
    });
    all(container, "[data-opl-alle]", function (button) {
      button.onclick = function () { var group = groupOf(button.getAttribute("data-opl-alle")); if (group) apply(group.key, group.missing); };
    });
    all(container, "[data-opl-valgte]", function (button) {
      button.onclick = function () { var group = groupOf(button.getAttribute("data-opl-valgte")); if (group) apply(group.key, pickedIn(group, state)); };
    });
    all(container, "[data-opl-vis]", function (button) {
      button.onclick = function () {
        var id = button.getAttribute("data-opl-vis");
        var row = result.rows.filter(function (candidate) { return candidate.uniqueId === id; })[0];
        if (row) batch(function () { selectIn3d(api, [{ row: row }]); });
      };
    });
    all(container, "[data-opl-udfyldt]", function (button) {
      button.onclick = function () { var key = button.getAttribute("data-opl-udfyldt"); state.showFilled[key] = !state.showFilled[key]; render(); };
    });
    all(container, "[data-opl-fjern]", function (button) {
      button.onclick = function () {
        var key = button.getAttribute("data-opl-key");
        batch(function () {
          var done = setValue(api, key, [button.getAttribute("data-opl-fjern")], null);
          if (done.ok) tell(api, "info", groupOf(key).label + " er fjernet fra typen" + (done.queued ? "; ændringen ligger i ændringslisten." : "."));
        });
      };
    });
    var again = container.querySelector("#sigmaPrisOplKoe");
    if (again) again.onclick = function () {
      batch(function () {
        var queued = queueUnsaved(api);
        tell(api, queued ? "info" : "fejl", queued
          ? plural(queued, "værdi", "værdier") + " er lagt i ændringslisten. Intet er skrevet i Revit endnu."
          : "Ændringslisten er ikke tilgængelig; intet er lagt i den.");
      });
    };
    var changes = container.querySelector("#sigmaPrisOplAendringer");
    if (changes) changes.onclick = function () { if (api.aendringsliste && api.aendringsliste.vis) api.aendringsliste.vis(); };
  }

  root.IssanaPrisOplysninger = {
    schema: SCHEMA,
    values: values,
    forType: forType,
    onChange: onChange,
    analyse: analyse,
    gapCount: function (api) { return gapCount(analyse(api.model(), { api: api })); },
    hasTypes: hasTypes,
    normalize: normalize,
    display: display,
    read: function (key, text) { return READ[key] ? READ[key](String(text == null ? "" : text)) : null; },
    setValue: setValue,
    queueUnsaved: queueUnsaved,
    newState: newState,
    html: html,
    bind: bind
  };
})(window);
