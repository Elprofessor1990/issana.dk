/* ISSANA 3D: fælles hjælper til analyserapporter i Typst (LCA, Lyd, Varmetab), så rapporterne har samme form:
   formlen, hvad symbolerne betyder, tallene sat ind, resultatet og kilden. Modulet regner intet; tallene kommer fra fanens beregning.
   Rapporten er en .typ-fil, der kan åbnes i ISSANA Compose (Typst) eller oversættes med «typst compile».
   Testes med den rigtige typst, når den findes: tests/web-model3d/rapport-typst.test.mjs.
   I browseren: window.IssanaTypstRapport; i Node: module.exports. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IssanaTypstRapport = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  // Tekst i Typst-markup: tegn med særlig betydning escapes; '=', '+', '-' og '/' kun først på en linje.
  // '//' midt i en tekst ville starte en kommentar og skjule resten af linjen; i en adresse (https://) er det et link.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[\\#$*_`<>@\[\]~]/g, '\\$&').replace(/(https?:)?\/(?=\/)/g, function (m, adr) { return adr ? m : '\\/'; }).replace(/^([=+\-/])/gm, '\\$1');
  }
  // Tekst i en Typst-streng ("…").
  function str(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' '); }
  function tal(n, d) { return typeof n === 'number' && isFinite(n) ? n.toLocaleString('da-DK', { minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 3 : d }) : '–'; }
  function sig(n, s) { return typeof n === 'number' && isFinite(n) ? Number(n.toPrecision(s || 5)).toLocaleString('da-DK', { maximumFractionDigits: 10 }) : '–'; }
  // Tal og tekst inde i en formel ($ … $): som strenge, så kommaet ikke bliver et skilletegn, og minus er et rigtigt minus.
  function mt(n, s) { return typeof n === 'number' && isFinite(n) ? '"' + sig(n, s || 5).replace('-', '−') + '"' : '"–"'; }
  function mtekst(s) { return '"' + str(s) + '"'; }
  function overskrift(tekst, niveau) { return new Array((niveau || 1) + 1).join('=') + ' ' + esc(tekst) + '\n\n'; }
  function afsnit(tekst) { return esc(tekst) + '\n\n'; }
  function punkter(liste) { return (liste || []).map(function (x) { return '- ' + esc(x).replace(/^\\-/, '-'); }).join('\n') + '\n\n'; }
  function note(tekst) { return '#block(fill: luma(240), inset: 8pt, radius: 3pt, width: 100%)[' + esc(tekst) + ']\n\n'; }
  // t: {kolonner:[…], raekker:[[…]], justering:['left','right',…]} Cellerne er tekst (escapes her).
  function tabel(t) {
    var n = t.kolonner.length, just = t.justering || [], kol = t.bredder ? t.bredder.join(', ') : new Array(n + 1).join('auto, ').replace(/, $/, '');
    var al = t.kolonner.map(function (_, i) { return just[i] || 'left'; }).join(', ');
    function celle(c, fed) { return '[' + (fed ? '*' + esc(c) + '*' : esc(c)) + ']'; }
    return '#table(\n  columns: (' + kol + (n === 1 ? ',' : '') + '),\n  align: (' + al + (n === 1 ? ',' : '') + '),\n  table.header(' + t.kolonner.map(function (c) { return celle(c, true); }).join(', ') + '),\n' +
      t.raekker.map(function (r) { return '  ' + r.map(function (c) { return celle(c); }).join(', ') + ','; }).join('\n') + '\n)\n\n';
  }
  // e: {titel, hvorfor, formel (Typst-matematik), symboler:[[matematik, forklaring]], indsat (Typst-matematik), resultat (Typst-matematik), kilde}
  // Et regneeksempel: hvorfor regnes det, formlen, symbolerne, tallene sat ind og kilden.
  function regneeksempel(e, niveau) {
    var h = e.titel ? overskrift(e.titel, niveau || 3) : '';
    if (e.hvorfor) h += afsnit(e.hvorfor);
    if (e.formel) h += '$ ' + e.formel + ' $\n\n';
    if (e.symboler && e.symboler.length) h += 'hvor\n\n' + e.symboler.map(function (s) { return '- $' + s[0] + '$: ' + esc(s[1]); }).join('\n') + '\n\n';
    if (e.indsat) h += 'Med tallene:\n\n$ ' + e.indsat + (e.resultat ? ' = ' + e.resultat : '') + ' $\n\n';
    if (e.kilde) h += '_Kilde: ' + esc(e.kilde) + '_\n\n';
    return h;
  }
  // d: {titel, undertitel, projekt, dato, tekst (færdig Typst-markup: afsnittene), kilder:[…]}
  function dokument(d) {
    var h = '#set document(title: "' + str(d.titel) + '", author: "ISSANA")\n' +
      '#set page(paper: "a4", margin: (x: 22mm, y: 24mm), numbering: "1 / 1", header: align(right)[#text(8pt, fill: luma(110))[' + esc(d.projekt || '') + ']])\n' +
      '#set text(lang: "da", size: 10.5pt)\n#set par(justify: false, leading: 0.65em)\n#set heading(numbering: "1.1")\n#set table(stroke: 0.4pt + luma(170), inset: 4pt)\n#show table: set text(8.5pt)\n\n';
    h += '#text(20pt, weight: "bold")[' + esc(d.titel) + ']\n\n';
    if (d.undertitel) h += '#text(12pt)[' + esc(d.undertitel) + ']\n\n';
    h += '#text(9pt, fill: luma(90))[' + esc([d.projekt, d.dato].filter(Boolean).join(' · ')) + ']\n\n#v(6pt)\n\n';
    h += d.tekst || '';
    if (d.kilder && d.kilder.length) h += overskrift('Kilder', 1) + punkter(d.kilder);
    return h;
  }
  // Gem som .typ-fil (samme vej som fanernes CSV-eksport).
  function gem(filnavn, tekst) {
    if (typeof Blob === 'undefined' || typeof document === 'undefined') return false;
    var blob = new Blob([tekst], { type: 'text/plain;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filnavn; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    return true;
  }
  /* ---------- Samme byggeklodser som HTML: visning i fanen og print ---------- */
  function hEsc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  // Den del af Typst-matematik, rapporterne bruger: "tekst", _"sænket"/_k, ceil(…), dot, sum, quad.
  function mathHtml(s) {
    return hEsc(s).replace(/"([^"]*)"|_("[^"]*"|[A-Za-z0-9])|ceil\(([^()]*)\)|\b(dot|sum|quad)\b/g, function (m, t, sub, ceil, ord) {
      if (t != null) return '<span class="r-t">' + t + '</span>';
      if (sub != null) return '<sub>' + sub.replace(/"/g, '') + '</sub>';
      if (ceil != null) return '⌈' + mathHtml(ceil) + '⌉';
      return ord === 'dot' ? '·' : ord === 'sum' ? 'Σ' : '&emsp;';
    });
  }
  var html = {
    esc: hEsc, str: str, tal: tal, sig: sig, mt: mt, mtekst: mtekst,
    CSS: '.r-dok{font:14px/1.5 Georgia,"Times New Roman",serif;color:#111;background:#fff;padding:16px 20px;max-width:800px}.r-dok h1{font-size:26px;margin:0 0 4px}.r-dok h2{font-size:19px;margin:20px 0 6px}.r-dok h3{font-size:16px;margin:16px 0 4px}.r-dok h4{font-size:14px;margin:12px 0 4px}' +
      '.r-dok .r-un{font-size:16px;margin:0}.r-dok .r-meta{font-size:12px;color:#666;margin:2px 0 12px}.r-dok p{margin:6px 0}.r-dok .r-note{background:#f0f0f0;border-radius:3px;padding:8px 10px}.r-dok .r-f{text-align:center;font-style:italic;margin:10px 0}.r-dok .r-f .r-t{font-style:normal}.r-dok .r-k{font-style:italic;font-size:13px}' +
      '.r-dok table{border-collapse:collapse;font-size:12px;margin:8px 0;color:#111}.r-dok th,.r-dok td{border:1px solid #bbb;padding:3px 6px;vertical-align:top;background:#fff;color:#111}@media print{.r-dok{max-width:none;padding:0}.r-dok h2{break-after:avoid}.r-dok table{break-inside:auto}}',
    overskrift: function (t, n) { var h = 'h' + Math.min(6, (n || 1) + 1); return '<' + h + '>' + hEsc(t) + '</' + h + '>'; },
    afsnit: function (t) { return '<p>' + hEsc(t) + '</p>'; },
    punkter: function (l) { return '<ul>' + (l || []).map(function (x) { return '<li>' + hEsc(x) + '</li>'; }).join('') + '</ul>'; },
    note: function (t) { return '<p class="r-note">' + hEsc(t) + '</p>'; },
    tabel: function (t) {
      var j = t.justering || [];
      function st(i) { return j[i] === 'right' ? ' style="text-align:right"' : ''; }
      return '<table><thead><tr>' + t.kolonner.map(function (c, i) { return '<th' + st(i) + '>' + hEsc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' + t.raekker.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td' + st(i) + '>' + hEsc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
    },
    regneeksempel: function (e, niveau) {
      var h = e.titel ? html.overskrift(e.titel, niveau || 3) : '';
      if (e.hvorfor) h += html.afsnit(e.hvorfor);
      if (e.formel) h += '<div class="r-f">' + mathHtml(e.formel) + '</div>';
      if (e.symboler && e.symboler.length) h += '<p>hvor</p><ul>' + e.symboler.map(function (s) { return '<li><i>' + mathHtml(s[0]) + '</i>: ' + hEsc(s[1]) + '</li>'; }).join('') + '</ul>';
      if (e.indsat) h += '<p>Med tallene:</p><div class="r-f">' + mathHtml(e.indsat + (e.resultat ? ' = ' + e.resultat : '')) + '</div>';
      if (e.kilde) h += '<p class="r-k">Kilde: ' + hEsc(e.kilde) + '</p>';
      return h;
    },
    dokument: function (d) {
      return '<article class="r-dok"><h1>' + hEsc(d.titel) + '</h1>' + (d.undertitel ? '<p class="r-un">' + hEsc(d.undertitel) + '</p>' : '') + '<p class="r-meta">' + hEsc([d.projekt, d.dato].filter(Boolean).join(' · ')) + '</p>' + (d.tekst || '') +
        (d.kilder && d.kilder.length ? html.overskrift('Kilder', 1) + html.punkter(d.kilder) : '') + '</article>';
    },
    // Print i en skjult ramme, så kun rapporten kommer med (printdialogen kan også gemme som PDF).
    print: function (indhold, titel) {
      if (typeof document === 'undefined') return false;
      var r = document.createElement('iframe'); r.setAttribute('aria-hidden', 'true'); r.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(r);
      var d = r.contentWindow.document; d.open(); d.write('<!doctype html><html lang="da"><head><meta charset="utf-8"><title>' + hEsc(titel || 'Rapport') + '</title><style>' + html.CSS + '</style></head><body>' + indhold + '</body></html>'); d.close();
      setTimeout(function () { r.contentWindow.focus(); r.contentWindow.print(); setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 60000); }, 250);
      return true;
    }
  };
  return { esc: esc, str: str, tal: tal, sig: sig, mt: mt, mtekst: mtekst, overskrift: overskrift, afsnit: afsnit, punkter: punkter, note: note, tabel: tabel, regneeksempel: regneeksempel, dokument: dokument, gem: gem, html: html, mathHtml: mathHtml };
});
