/* ============================================================================
   charts.js — dependency-free SVG charts
   ----------------------------------------------------------------------------
   Two builders, both returning an SVG string that the caller drops into a
   container. No library, no canvas, no inline styles: colours and type come
   from the .chart__* classes in styles.css, which read the live --accent of
   whichever panel the chart sits in.

   Geometry uses a fixed viewBox and `width: 100%` in CSS, so the charts scale
   with their card while staying crisp.
   ========================================================================== */
window.MHT = window.MHT || {};

(function (MHT) {
  'use strict';

  var esc = MHT.store.escapeHtml;

  /* --- shared helpers ----------------------------------------------------- */

  /** Round to 2dp — keeps the generated path data readable. */
  function r(n) { return Math.round(n * 100) / 100; }

  function svgOpen(width, height) {
    return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" ' +
           'preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">';
  }

  function emptyChart(width, height, message) {
    return svgOpen(width, height) +
      '<title>' + esc(message) + '</title>' +
      '<text class="chart__empty" x="' + (width / 2) + '" y="' + (height / 2) +
      '" text-anchor="middle" dominant-baseline="middle">' + esc(message) + '</text>' +
      '</svg>';
  }

  /* ------------------------------------------------------------------------
     Mood trend — line + area over a fixed 1..5 axis.

     points: [{ date: "YYYY-MM-DD", value: 1..5 | null }]
     Days with no entry carry value === null and break the line, so a gap in
     the record reads as a gap rather than an invented straight line.
     ---------------------------------------------------------------------- */
  function moodTrend(points) {
    var W = 720, H = 260;
    var pad = { top: 18, right: 14, bottom: 34, left: 34 };
    var plotW = W - pad.left - pad.right;
    var plotH = H - pad.top - pad.bottom;

    var logged = points.filter(function (p) { return p.value != null; });
    if (!logged.length) {
      return emptyChart(W, H, 'No check-ins in this range yet');
    }

    var MIN = 1, MAX = 5;
    var stepX = points.length > 1 ? plotW / (points.length - 1) : 0;

    function x(i) { return pad.left + (points.length > 1 ? i * stepX : plotW / 2); }
    function y(v) { return pad.top + plotH - ((v - MIN) / (MAX - MIN)) * plotH; }

    var out = svgOpen(W, H);
    out += '<title>Mood trend over ' + points.length + ' days</title>';

    /* Horizontal gridlines + y labels at every whole mood value. */
    for (var v = MIN; v <= MAX; v++) {
      var gy = r(y(v));
      out += '<line class="chart__grid" x1="' + pad.left + '" y1="' + gy +
             '" x2="' + (W - pad.right) + '" y2="' + gy + '"></line>';
      out += '<text class="chart__axis" x="' + (pad.left - 10) + '" y="' + (gy + 4) +
             '" text-anchor="end">' + v + '</text>';
    }

    /* Split into contiguous runs of logged days. */
    var segments = [];
    var current = [];
    points.forEach(function (p, i) {
      if (p.value == null) {
        if (current.length) { segments.push(current); current = []; }
      } else {
        current.push({ i: i, value: p.value, date: p.date });
      }
    });
    if (current.length) segments.push(current);

    segments.forEach(function (seg) {
      var line = seg.map(function (pt, k) {
        return (k ? 'L' : 'M') + r(x(pt.i)) + ' ' + r(y(pt.value));
      }).join(' ');

      /* Area under the segment, closed along the baseline. */
      if (seg.length > 1) {
        var base = r(pad.top + plotH);
        var area = line +
          ' L' + r(x(seg[seg.length - 1].i)) + ' ' + base +
          ' L' + r(x(seg[0].i)) + ' ' + base + ' Z';
        out += '<path class="chart__area" d="' + area + '"></path>';
        out += '<path class="chart__line" d="' + line + '"></path>';
      }
    });

    /* Dots last so they sit above the line. Each carries a tooltip title. */
    points.forEach(function (p, i) {
      if (p.value == null) return;
      out += '<circle class="chart__dot" cx="' + r(x(i)) + '" cy="' + r(y(p.value)) +
             '" r="' + (points.length > 45 ? 2.5 : 4) + '">' +
             '<title>' + esc(MHT.store.formatShort(p.date) + ' — mood ' + p.value) +
             '</title></circle>';
    });

    /* X labels: at most six, always including the first and last day.
       Labels near either edge are anchored inward so they cannot be clipped
       by the viewBox (locale date formats vary in width). */
    var maxLabels = 6;
    var stride = Math.max(1, Math.ceil(points.length / maxLabels));
    var EDGE = 44;
    points.forEach(function (p, i) {
      var isLast = i === points.length - 1;
      if (i % stride !== 0 && !isLast) return;
      // Skip a label that would crowd the final one. The last label is
      // anchored to the edge, so it needs a full stride of clearance.
      if (!isLast && points.length - 1 - i < stride) return;

      var px = x(i);
      var anchor = 'middle';
      if (px > W - EDGE) { anchor = 'end'; px = W; }
      else if (px < EDGE) { anchor = 'start'; px = 0; }

      out += '<text class="chart__axis" x="' + r(px) + '" y="' + (H - 12) +
             '" text-anchor="' + anchor + '">' + esc(MHT.store.formatShort(p.date)) + '</text>';
    });

    return out + '</svg>';
  }

  /* ------------------------------------------------------------------------
     Tag frequency — horizontal bars.

     rows: [{ label: "Sleep", value: 12 }]  (already sorted by the caller)
     ---------------------------------------------------------------------- */
  function tagBars(rows) {
    var W = 720;
    var rowH = 34, gap = 8, padTop = 8, padBottom = 8;
    var labelW = 140, valueW = 46;

    if (!rows.length) {
      return emptyChart(W, 140, 'No tags logged in this range yet');
    }

    var H = padTop + padBottom + rows.length * rowH + (rows.length - 1) * gap;
    var trackX = labelW;
    var trackW = W - labelW - valueW;
    var max = rows.reduce(function (m, row) { return Math.max(m, row.value); }, 0) || 1;

    var out = svgOpen(W, H);
    out += '<title>Tag frequency</title>';

    rows.forEach(function (row, i) {
      var top = padTop + i * (rowH + gap);
      var barH = 18;
      var barY = top + (rowH - barH) / 2;
      var width = Math.max(3, (row.value / max) * trackW);

      out += '<text class="chart__label" x="0" y="' + (top + rowH / 2 + 4) + '">' +
             esc(row.label) + '</text>';
      out += '<rect class="chart__track" x="' + trackX + '" y="' + barY +
             '" width="' + trackW + '" height="' + barH + '" rx="4"></rect>';
      out += '<rect class="chart__bar" x="' + trackX + '" y="' + barY +
             '" width="' + r(width) + '" height="' + barH + '" rx="4">' +
             '<title>' + esc(row.label + ': ' + row.value) + '</title></rect>';
      out += '<text class="chart__value" x="' + W + '" y="' + (top + rowH / 2 + 4) +
             '" text-anchor="end">' + row.value + '</text>';
    });

    return out + '</svg>';
  }

  MHT.charts = {
    moodTrend: moodTrend,
    tagBars: tagBars
  };
})(window.MHT);
