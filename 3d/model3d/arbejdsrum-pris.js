/* ISSANA 3D: prices copied unchanged from the last accepted Sigma plan. No price calculation lives here. */
/* The panel has a second view, «Manglende oplysninger» (arbejdsrum-pris-oplysninger.js): what the model lacks to pick the
   right price. It is shown when that module is loaded and the model has types. */
(function (root) {
  "use strict";

  var PRICE_COLORS = ["#b9d6ee", "#83b6dc", "#4f94ca", "#246fae", "#124b80"];
  var WITHOUT_PRICE_COLOR = "#b8b2a7";
  var NOT_IN_PLAN_COLOR = "#7d8790";
  var PRICE_ICON = "M4 7V4h3l11 11-7 7L4 15zM8 8h.01M14.5 7.5a3 3 0 1 1 0 6M17.5 7.5a3 3 0 1 1 0 6";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>\"]/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character];
    });
  }

  function number(value, digits) {
    if (typeof value !== "number" || !isFinite(value)) return "–";
    return new Intl.NumberFormat("da-DK", { maximumFractionDigits: digits == null ? 2 : digits }).format(value);
  }

  function kr(value) {
    return typeof value === "number" && isFinite(value) ? number(value, 0) + " kr." : "uden pris";
  }

  function mio(value) {
    return typeof value === "number" && isFinite(value) ? number(value / 1000000, 1) + " mio. kr." : "ukendt beløb";
  }

  function dato(value) {
    var parsed = new Date(value);
    return isNaN(parsed.getTime()) ? String(value || "") : parsed.toLocaleDateString("da-DK");
  }

  function extract(model) {
    var prices = model && model.sigmaPrices;
    return prices && prices.schema === "issana-sigma-prices/1" && Array.isArray(prices.types) ? prices : null;
  }

  function pricedTypes(prices) {
    return prices.types
      .map(function (type, index) { return { type: type, index: index }; })
      .filter(function (entry) { return typeof entry.type.amount === "number" && isFinite(entry.type.amount) && entry.type.amount > 0; })
      .sort(function (a, b) { return b.type.amount - a.type.amount; });
  }

  function withoutPriceTypes(prices) {
    return prices.types
      .map(function (type, index) { return { type: type, index: index }; })
      .filter(function (entry) { return typeof entry.type.amount !== "number" || !isFinite(entry.type.amount) || entry.type.amount <= 0; });
  }

  function missingReason(type) {
    if (type.amount === 0) return "Beløbet er 0 kr. (mængde eller enhedspris er 0)";
    return type.reason || "Pris mangler i planen";
  }

  function category(type) {
    return type.category || type.familyName || "Ukendt kategori";
  }

  function selectedIds(api) {
    return (api.valgte ? api.valgte() : []).map(function (index) {
      if (api.elementId) return api.elementId(index);
      var element = api.elementer && api.elementer()[index];
      return element && element.data ? element.data.id : null;
    }).filter(function (id) { return id != null; });
  }

  function typeIsSelected(type, ids) {
    return (type.elementIds || []).some(function (id) { return ids.indexOf(id) >= 0; });
  }

  function selectedInfo(api, prices) {
    var ids = selectedIds(api);
    if (!ids.length) return { kind: "none", type: null };
    var type = prices.types.filter(function (candidate) { return typeIsSelected(candidate, ids); })[0];
    return type ? { kind: "type", type: type } : { kind: "outside", type: null };
  }

  function detail(info) {
    if (!info || info.kind === "none") {
      return '<div class="v3-hint">Vælg et element i 3D for at se typens pris.</div>';
    }
    if (info.kind === "outside") {
      return '<div class="sigma-pris-detalje sigma-pris-mangler">Denne type var ikke med i Sigma-planen.</div>';
    }
    var type = info.type;
    var unit = type.units || "enhed";
    var formula = number(type.quantity) + " " + esc(unit) + " × " + esc(kr(type.unitPrice)) + "/" + esc(unit);
    var price = typeof type.amount === "number" && isFinite(type.amount) && type.amount > 0
      ? '<div class="sigma-pris-formel">' + formula + ' = <b>' + esc(kr(type.amount)) + "</b></div>"
      : '<div class="sigma-pris-mangler">Uden pris: ' + esc(missingReason(type)) + "</div>";
    var molio = type.molioNumber || type.text
      ? '<div class="sigma-pris-molio">' + (type.molioNumber ? "Molio " + esc(type.molioNumber) : "") +
        (type.molioNumber && type.text ? " · " : "") + esc(type.text || "") + "</div>"
      : "";
    return '<div class="sigma-pris-detalje"><b>' + esc(type.typeName) + '</b><div class="sigma-pris-kategori">' +
      esc(category(type)) + "</div>" + price + molio + "</div>";
  }

  function top(prices, state) {
    var missing = withoutPriceTypes(prices).length;
    var max = Math.max.apply(Math, pricedTypes(prices).map(function (entry) { return entry.type.amount; }).concat([1]));
    var html = '<div class="sigma-pris-head"><div class="sigma-pris-top"><b>Overslag fra Sigma: ' +
      esc(mio(prices.expectedTotal)) + "</b> · sendt " + esc(dato(prices.submittedAt));
    if (missing) {
      html += ' · <button type="button" id="sigmaPrisUdenLink" class="sigma-pris-status">' + missing +
        (missing === 1 ? " type" : " typer") + " uden pris</button>";
    }
    html += '</div><button type="button" class="tbtn' + (state.colorsOn ? " on" : "") + '" id="sigmaPrisFarv">' +
      (state.colorsOn ? "Fjern farver" : "Farv efter pris") + "</button></div>";
    if (state.colorsOn) html += '<div class="sigma-pris-skala">' + colorLegend(max) + "</div>";
    return html;
  }

  function warning(prices) {
    if (!prices.modelMayHaveChanged) return "";
    return '<div class="sigma-pris-advarsel">Priserne er fra ' + esc(dato(prices.submittedAt)) +
      ". Modellen kan være ændret siden. Send mængderne til Sigma igen for at opdatere.</div>";
  }

  function share(amount, total) {
    if (!(typeof amount === "number") || !(total > 0)) return 0;
    return amount / total * 100;
  }

  function percent(value) {
    if (typeof value !== "number" || !isFinite(value)) return "0,0";
    return new Intl.NumberFormat("da-DK", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
  }

  function priceRow(entry, max, total, ids) {
    var type = entry.type;
    var width = max > 0 ? Math.max(2, Math.round(100 * type.amount / max)) : 0;
    var selected = typeIsSelected(type, ids) ? " valgt" : "";
    return '<button type="button" class="sigma-pris-r' + selected + '" data-sigma-type="' + entry.index + '">' +
      '<span class="sigma-pris-navn">' + esc(type.typeName) + '<small>' + esc(category(type)) + " · " +
      percent(share(type.amount, total)) + " %</small></span>" +
      '<i aria-hidden="true" style="width:' + width + '%"></i><b>' + esc(kr(type.amount)) + "</b></button>";
  }

  function priceList(prices, state, ids) {
    var entries = pricedTypes(prices);
    var shown = state.expanded ? entries : entries.slice(0, 10);
    var max = entries.length ? entries[0].type.amount : 1;
    var total = entries.reduce(function (sum, entry) { return sum + entry.type.amount; }, 0);
    var html = '<div class="sigma-pris-sek">Hvad koster mest?</div>';
    html += shown.map(function (entry) { return priceRow(entry, max, total, ids); }).join("");
    if (!entries.length) html += '<div class="v3-hint">Ingen typer har en gemt pris.</div>';
    if (!state.expanded && entries.length > 10) {
      html += '<button type="button" class="sigma-pris-flere" id="sigmaPrisFlere">Vis alle ' + entries.length + " typer</button>";
    }
    return html;
  }

  function withoutPrice(prices, state, ids) {
    var entries = withoutPriceTypes(prices);
    if (!entries.length || !state.showMissing) return "";
    var html = '<div class="sigma-pris-uden"><div class="sigma-pris-sek">Uden pris (' + entries.length + ")</div>";
    html += entries.slice(0, 8).map(function (entry) {
      var type = entry.type;
      var selected = typeIsSelected(type, ids) ? " valgt" : "";
      return '<button type="button" class="sigma-pris-uden-r' + selected + '" data-sigma-type="' + entry.index + '">' +
        "<b>" + esc(type.typeName) + "</b><span>" + esc(category(type)) + " · " + esc(missingReason(type)) + "</span></button>";
    }).join("");
    if (entries.length > 8) html += '<div class="v3-hint">Viser de første 8 af ' + entries.length + " typer.</div>";
    return html + "</div>";
  }

  function priceBounds(max) {
    if (max >= 1000000) return [100000, 250000, 500000, 1000000];
    return [max * 0.1, max * 0.25, max * 0.5, max * 0.8];
  }

  function priceColor(amount, max) {
    if (typeof amount !== "number" || !isFinite(amount) || amount <= 0) return WITHOUT_PRICE_COLOR;
    var bounds = priceBounds(Math.max(max || 0, 1));
    var step = amount < bounds[0] ? 0 : amount < bounds[1] ? 1 : amount < bounds[2] ? 2 : amount < bounds[3] ? 3 : 4;
    return PRICE_COLORS[step];
  }

  function legendLabel(index, bounds) {
    if (index === 0) return "under " + kr(bounds[0]);
    if (index === 4) return "over " + kr(bounds[3]);
    return kr(bounds[index - 1]) + "–" + kr(bounds[index]);
  }

  function colorLegend(max) {
    var bounds = priceBounds(max);
    var rows = PRICE_COLORS.map(function (color, index) {
      return '<span class="sigma-pris-leg"><i style="background:' + color + '"></i>' + esc(legendLabel(index, bounds)) + "</span>";
    }).join("");
    return '<b>Pris pr. Revit-type</b><span class="sigma-pris-legender">' + rows +
      '<span class="sigma-pris-leg"><i style="background:' + WITHOUT_PRICE_COLOR + '"></i>uden pris</span></span>';
  }

  function emptyState() {
    return '<div class="v3-tom sigma-pris-tom"><b>Ingen priser endnu.</b>' +
      "<ol><li>Åbn ISSANA → Sigma i Revit.</li><li>Send mængderne.</li><li>Åbn 3D igen.</li></ol></div>";
  }

  function normalizeState(state) {
    if (typeof state === "boolean") return { expanded: state, showMissing: false, colorsOn: false };
    return state || { expanded: false, showMissing: false, colorsOn: false };
  }

  function body(api, state) {
    var prices = extract(api.model());
    if (!prices) return emptyState();
    state = normalizeState(state);
    var ids = selectedIds(api);
    return top(prices, state) + warning(prices) + '<div id="sigmaPrisValg">' + detail(selectedInfo(api, prices)) + "</div>" +
      withoutPrice(prices, state, ids) + priceList(prices, state, ids);
  }

  function colorMap(api, prices) {
    var entries = pricedTypes(prices);
    var max = Math.max.apply(Math, entries.map(function (entry) { return entry.type.amount; }).concat([1]));
    var map = {};
    (api.elementer ? api.elementer() : []).forEach(function (element) {
      if (element && element.data && element.data.id != null) map[element.data.id] = NOT_IN_PLAN_COLOR;
    });
    prices.types.forEach(function (type) {
      var color = priceColor(type.amount, max);
      (type.elementIds || []).forEach(function (id) { map[id] = color; });
    });
    return { map: map, max: max };
  }

  function information() {
    return root.IssanaPrisOplysninger || null;
  }

  // The switch between the two views; empty when there is nothing to fill in (no module or no types in the model).
  function views(api, state) {
    var info = information();
    if (!info || !info.hasTypes(api.model())) return "";
    var gaps = info.gapCount(api);
    var button = function (id, text) {
      return '<button type="button" class="tbtn' + (state.view === id ? " on" : "") + '" data-sigma-visning="' + id + '">' + text + "</button>";
    };
    return '<div class="sigma-pris-visninger">' + button("priser", "Priser") +
      button("oplysninger", "Manglende oplysninger" + (gaps ? " (" + gaps + ")" : "")) + "</div>";
  }

  function monter(container, api) {
    var state = { expanded: false, showMissing: false, colorsOn: false, view: "priser", info: null };

    function selectType(type) {
      var ids = (type.elementIds || []).map(api.indeks).filter(function (index) { return index >= 0; });
      api.vaelg(ids);
      if (ids.length) api.fokus();
    }

    function bindViews() {
      Array.prototype.forEach.call(container.querySelectorAll("[data-sigma-visning]"), function (button) {
        button.onclick = function () { state.view = button.getAttribute("data-sigma-visning"); render(); };
      });
    }

    function render() {
      var info = information();
      if (state.info && state.info.busy) return;
      var switcher = views(api, state);
      if (switcher && state.view === "oplysninger") {
        state.info = state.info || info.newState();
        container.innerHTML = switcher + info.html(api, state.info);
        bindViews();
        info.bind(container, api, state.info, render);
        return;
      }
      var prices = extract(api.model());
      container.innerHTML = switcher + body(api, state);
      bindViews();
      if (!prices) return;
      Array.prototype.forEach.call(container.querySelectorAll("[data-sigma-type]"), function (button) {
        button.onclick = function () { selectType(prices.types[Number(button.getAttribute("data-sigma-type"))]); };
      });
      var more = container.querySelector("#sigmaPrisFlere");
      if (more) more.onclick = function () { state.expanded = true; render(); };
      var missing = container.querySelector("#sigmaPrisUdenLink");
      if (missing) missing.onclick = function () { state.showMissing = !state.showMissing; render(); };
      var color = container.querySelector("#sigmaPrisFarv");
      if (color) color.onclick = function () {
        state.colorsOn = !state.colorsOn;
        if (!state.colorsOn) api.farvelaeg(null);
        else {
          var colors = colorMap(api, prices);
          api.farvelaeg(colors.map, { ids: true, titel: "Pris", legend: function () { return colorLegend(colors.max); } });
        }
        render();
      };
    }

    api.paa("valg", render);
    api.paa("model", function () { state.info = null; render(); });
    // The change list was saved or discarded: «i ændringslisten» / «gemt i Revit» must follow.
    api.paa("aendringer", function () { if (state.view === "oplysninger") render(); });
    render();
  }

  var mod = {
    extract: extract,
    body: body,
    monter: monter,
    priceColor: priceColor,
    colorMap: colorMap,
    colorLegend: colorLegend,
    share: share,
    percent: percent,
    colors: { priced: PRICE_COLORS.slice(), withoutPrice: WITHOUT_PRICE_COLOR, notInPlan: NOT_IN_PLAN_COLOR }
  };
  root.IssanaSigmaPris = mod;
  var install = function (workspace) {
    if (workspace && workspace.registrerPanel) {
      workspace.registrerPanel({
        id: "pris",
        titel: "Pris",
        ikon: PRICE_ICON,
        gruppe: "data",
        bred: true,
        monter: monter,
        hint: "Gemte priser fra den seneste Sigma-plan, og de oplysninger modellen mangler for at vælge pris"
      });
    }
  };
  (root.issanaArbejdsrumVentende = root.issanaArbejdsrumVentende || []).push(install);
})(window);
