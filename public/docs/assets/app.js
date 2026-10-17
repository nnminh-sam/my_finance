(function () {
  "use strict";

  var root = document.documentElement;
  var content = document.getElementById("content");
  var markdown = JSON.parse(document.getElementById("md-source").textContent);

  /* ------------------------------------------------------------------ */
  /* Markdown rendering                                                  */
  /* ------------------------------------------------------------------ */

  // Inline math ($...$) is tokenized before markdown escapes (e.g. "\%") are applied.
  var mathExtension = {
    extensions: [{
      name: "inlineMath",
      level: "inline",
      start: function (src) { var i = src.indexOf("$"); return i < 0 ? undefined : i; },
      tokenizer: function (src) {
        var m = /^\$(?!\s)([^$\n]*?[^\s\\])\$/.exec(src);
        if (m) return { type: "inlineMath", raw: m[0], text: m[1] };
      },
      renderer: function (token) {
        if (!window.katex) return "<code>" + token.text + "</code>";
        try { return katex.renderToString(token.text, { throwOnError: false }); }
        catch (e) { return "<code>" + token.text + "</code>"; }
      },
    }],
  };

  if (window.marked) {
    marked.use({ gfm: true }, mathExtension);
    content.insertAdjacentHTML("beforeend", marked.parse(markdown));
  } else {
    var pre = document.createElement("pre");
    pre.textContent = markdown;
    content.appendChild(pre);
  }

  // Heading anchors.
  var used = Object.create(null);
  function slugify(text) {
    var base = text.toLowerCase().trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-") || "section";
    var slug = base, n = 1;
    while (used[slug]) slug = base + "-" + n++;
    used[slug] = true;
    return slug;
  }
  var headings = Array.prototype.slice.call(content.querySelectorAll("h1, h2, h3, h4"));
  headings.forEach(function (h) {
    h.dataset.title = h.textContent.trim();
    h.id = slugify(h.dataset.title);
    var a = document.createElement("a");
    a.className = "anchor";
    a.href = "#" + h.id;
    a.setAttribute("aria-label", "Link to this section");
    a.textContent = "#";
    h.appendChild(a);
  });

  // Rewrite links: sibling .md docs -> .html, repo-relative paths go one level deeper.
  content.querySelectorAll("a[href]").forEach(function (a) {
    var href = a.getAttribute("href");
    if (/^(?:[a-z]+:|#|\/\/)/i.test(href)) return;
    var m = /^(?:\.\/)?([\w.-]+)\.md(#.*)?$/.exec(href);
    if (m) {
      a.setAttribute("href", (m[1] === "README" ? "index" : m[1]) + ".html" + (m[2] || ""));
      return;
    }
    if (href.indexOf("../") === 0) a.setAttribute("href", "../" + href);
  });

  // Horizontal scrolling for wide tables.
  content.querySelectorAll("table").forEach(function (table) {
    var wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });

  /* ------------------------------------------------------------------ */
  /* Mermaid                                                             */
  /* ------------------------------------------------------------------ */

  var diagrams = [];
  var diagramControllers = [];
  var activeFullscreenCard = null;

  content.querySelectorAll("pre > code.language-mermaid").forEach(function (code, index) {
    var card = document.createElement("div");
    card.className = "diagram-card";

    var toolbar = document.createElement("div");
    toolbar.className = "diagram-toolbar";
    toolbar.innerHTML =
      '<span class="diagram-hint">Drag to pan · Scroll to zoom · Double-click to reset</span>' +
      '<div class="diagram-actions" role="toolbar" aria-label="Diagram zoom controls">' +
        '<button type="button" class="diagram-btn" data-action="zoom-out" title="Zoom out (−)" aria-label="Zoom out">−</button>' +
        '<button type="button" class="diagram-btn diagram-zoom-readout" data-action="zoom-100" title="Reset to 100% natural size" aria-label="Reset zoom to 100%">100%</button>' +
        '<button type="button" class="diagram-btn" data-action="zoom-in" title="Zoom in (+)" aria-label="Zoom in">+</button>' +
        '<button type="button" class="diagram-btn" data-action="zoom-fit" title="Fit diagram to view" aria-label="Fit diagram">Fit</button>' +
        '<button type="button" class="diagram-btn diagram-btn-expand" data-action="toggle-expand" title="Toggle fullscreen view (Esc to close)" aria-label="Toggle fullscreen">⛶ Expand</button>' +
      '</div>';

    var viewport = document.createElement("div");
    viewport.className = "diagram-viewport";
    viewport.tabIndex = 0;
    viewport.setAttribute("aria-label", "Interactive diagram " + (index + 1) + " — drag to pan, scroll to zoom");

    var stage = document.createElement("div");
    stage.className = "diagram-stage";

    var div = document.createElement("div");
    div.className = "mermaid";
    div.dataset.src = code.textContent;
    div.textContent = code.textContent;

    stage.appendChild(div);
    viewport.appendChild(stage);
    card.appendChild(toolbar);
    card.appendChild(viewport);
    code.parentNode.replaceWith(card);

    diagrams.push(div);
    diagramControllers.push(createDiagramController(card, toolbar, viewport, stage, div));
  });

  function createDiagramController(card, toolbar, viewport, stage, mermaidEl) {
    var MIN_SCALE = 0.15;
    var MAX_SCALE = 6;
    var scale = 1;
    var tx = 0;
    var ty = 0;
    var naturalW = 800;
    var naturalH = 450;
    var readoutBtn = toolbar.querySelector('[data-action="zoom-100"]');
    var expandBtn = toolbar.querySelector('[data-action="toggle-expand"]');

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function applyTransform() {
      stage.style.transform = "translate(" + tx.toFixed(1) + "px, " + ty.toFixed(1) + "px) scale(" + scale.toFixed(4) + ")";
      if (readoutBtn) readoutBtn.textContent = Math.round(scale * 100) + "%";
    }

    function measureSvg() {
      var svg = mermaidEl.querySelector("svg");
      if (!svg) return false;
      svg.style.maxWidth = "none";
      svg.style.height = "auto";
      var vb = svg.viewBox && svg.viewBox.baseVal;
      var w = (vb && vb.width) ? vb.width : 0;
      var h = (vb && vb.height) ? vb.height : 0;
      if (!w || !h) {
        var attrW = parseFloat(svg.getAttribute("width")) || 0;
        var attrH = parseFloat(svg.getAttribute("height")) || 0;
        w = attrW;
        h = attrH;
      }
      if (!w || !h) {
        try {
          var bbox = svg.getBBox();
          w = bbox.width + 24;
          h = bbox.height + 24;
        } catch (e) {}
      }
      naturalW = Math.max(120, w || 800);
      naturalH = Math.max(80, h || 450);
      svg.setAttribute("width", String(naturalW));
      svg.setAttribute("height", String(naturalH));
      stage.style.width = naturalW + "px";
      stage.style.height = naturalH + "px";

      // Give inline viewport a comfortable height proportional to the diagram
      if (!card.classList.contains("is-expanded")) {
        var vw = viewport.clientWidth || 960;
        var fitScale = Math.min(1, (vw - 48) / naturalW);
        var desiredH = Math.round(naturalH * Math.max(fitScale, 0.55) + 48);
        viewport.style.height = clamp(desiredH, 280, 680) + "px";
      } else {
        viewport.style.height = "";
      }
      return true;
    }

    function fitToView(allowUpscale) {
      if (!measureSvg()) return;
      var pad = 40;
      var vw = Math.max(200, viewport.clientWidth - pad);
      var vh = Math.max(160, viewport.clientHeight - pad);
      var fit = Math.min(vw / naturalW, vh / naturalH);
      if (!allowUpscale) fit = Math.min(fit, 1.25);
      scale = clamp(fit, MIN_SCALE, MAX_SCALE);
      tx = Math.round((viewport.clientWidth - naturalW * scale) / 2);
      ty = Math.round((viewport.clientHeight - naturalH * scale) / 2);
      applyTransform();
    }

    function resetTo100() {
      if (!measureSvg()) return;
      scale = 1;
      tx = Math.round((viewport.clientWidth - naturalW) / 2);
      ty = Math.max(20, Math.round((viewport.clientHeight - naturalH) / 2));
      applyTransform();
    }

    function zoomAt(nextScale, cx, cy) {
      var clamped = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      var ratio = clamped / scale;
      tx = cx - (cx - tx) * ratio;
      ty = cy - (cy - ty) * ratio;
      scale = clamped;
      applyTransform();
    }

    function zoomStep(factor) {
      var cx = viewport.clientWidth / 2;
      var cy = viewport.clientHeight / 2;
      zoomAt(scale * factor, cx, cy);
    }

    function setExpanded(expanded) {
      if (expanded && activeFullscreenCard && activeFullscreenCard !== card) {
        activeFullscreenCard.classList.remove("is-expanded");
      }
      card.classList.toggle("is-expanded", expanded);
      document.body.classList.toggle("diagram-modal-open", expanded);
      activeFullscreenCard = expanded ? card : null;
      if (expandBtn) {
        expandBtn.textContent = expanded ? "✕ Close" : "⛶ Expand";
        expandBtn.setAttribute("aria-expanded", String(expanded));
      }
      requestAnimationFrame(function () {
        fitToView(expanded);
      });
    }

    toolbar.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action]");
      if (!btn) return;
      var action = btn.dataset.action;
      if (action === "zoom-in") zoomStep(1.25);
      else if (action === "zoom-out") zoomStep(1 / 1.25);
      else if (action === "zoom-100") resetTo100();
      else if (action === "zoom-fit") fitToView(card.classList.contains("is-expanded"));
      else if (action === "toggle-expand") setExpanded(!card.classList.contains("is-expanded"));
    });

    // Wheel zoom centered at cursor position
    viewport.addEventListener("wheel", function (e) {
      e.preventDefault();
      var rect = viewport.getBoundingClientRect();
      var cx = e.clientX - rect.left;
      var cy = e.clientY - rect.top;
      var delta = -e.deltaY;
      if (e.deltaMode === 1) delta *= 16;
      else if (e.deltaMode === 2) delta *= 100;
      var factor = Math.exp(clamp(delta, -120, 120) * 0.0022);
      zoomAt(scale * factor, cx, cy);
    }, { passive: false });

    // Pointer drag panning
    var dragging = false;
    var startX = 0, startY = 0, originTx = 0, originTy = 0;

    viewport.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      originTx = tx;
      originTy = ty;
      viewport.classList.add("is-dragging");
      try { viewport.setPointerCapture(e.pointerId); } catch (err) {}
    });

    viewport.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      tx = originTx + (e.clientX - startX);
      ty = originTy + (e.clientY - startY);
      applyTransform();
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      viewport.classList.remove("is-dragging");
      try { viewport.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);

    // Double-click toggles between 100% (or 150% detail view) and Fit
    viewport.addEventListener("dblclick", function (e) {
      e.preventDefault();
      var rect = viewport.getBoundingClientRect();
      var cx = e.clientX - rect.left;
      var cy = e.clientY - rect.top;
      if (Math.abs(scale - 1) > 0.12) {
        zoomAt(1, cx, cy);
      } else {
        fitToView(card.classList.contains("is-expanded"));
      }
    });

    // Keyboard shortcuts when diagram viewport is focused
    viewport.addEventListener("keydown", function (e) {
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomStep(1.25); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomStep(1 / 1.25); }
      else if (e.key === "0") { e.preventDefault(); resetTo100(); }
      else if (e.key.toLowerCase() === "f") { e.preventDefault(); fitToView(card.classList.contains("is-expanded")); }
    });

    return {
      refresh: function () { fitToView(card.classList.contains("is-expanded")); },
      closeExpanded: function () { if (card.classList.contains("is-expanded")) setExpanded(false); },
    };
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && activeFullscreenCard) {
      diagramControllers.forEach(function (c) { c.closeExpanded(); });
    }
  });

  function renderDiagrams() {
    if (!window.mermaid || !diagrams.length) return;
    diagrams.forEach(function (d) {
      d.removeAttribute("data-processed");
      d.textContent = d.dataset.src;
    });
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: root.dataset.theme === "dark" ? "dark" : "default",
      flowchart: { htmlLabels: true, useMaxWidth: false },
      sequence: { useMaxWidth: false },
      er: { useMaxWidth: false },
      class: { useMaxWidth: false },
      state: { useMaxWidth: false },
    });
    mermaid.run({ nodes: diagrams }).then(function () {
      diagramControllers.forEach(function (c) { c.refresh(); });
    }).catch(function (err) { console.error(err); });
  }
  renderDiagrams();

  /* ------------------------------------------------------------------ */
  /* Sidebar table of contents + scrollspy                               */
  /* ------------------------------------------------------------------ */

  var toc = document.getElementById("toc");
  var tocLinks = [];
  var tocHeadings = headings.filter(function (h) { return h.tagName !== "H1"; });
  var list = document.createElement("ul");
  tocHeadings.forEach(function (h) {
    var li = document.createElement("li");
    li.className = "toc-" + h.tagName.toLowerCase();
    var a = document.createElement("a");
    a.href = "#" + h.id;
    a.textContent = h.dataset.title;
    a.title = a.textContent;
    a.addEventListener("click", function () { if (isMobile()) setSidebar(false); });
    li.appendChild(a);
    list.appendChild(li);
    tocLinks.push(a);
  });
  toc.appendChild(list);

  var activeIndex = -1;
  function updateScrollspy() {
    var offset = 90, index = -1;
    for (var i = 0; i < tocHeadings.length; i++) {
      if (tocHeadings[i].getBoundingClientRect().top - offset <= 0) index = i; else break;
    }
    if (index === -1 && tocHeadings.length) index = 0;
    if (index === activeIndex) return;
    if (tocLinks[activeIndex]) tocLinks[activeIndex].classList.remove("active");
    activeIndex = index;
    var link = tocLinks[index];
    if (link) {
      link.classList.add("active");
      var box = toc.getBoundingClientRect(), r = link.getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom) link.scrollIntoView({ block: "nearest" });
    }
  }
  var ticking = false;
  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { ticking = false; updateScrollspy(); });
  }, { passive: true });
  updateScrollspy();

  /* ------------------------------------------------------------------ */
  /* Sidebar toggle                                                      */
  /* ------------------------------------------------------------------ */

  var backdrop = document.getElementById("sidebar-backdrop");
  var toggleBtn = document.getElementById("sidebar-toggle");
  function isMobile() { return window.matchMedia("(max-width: 900px)").matches; }
  function sidebarOpen() {
    return isMobile() ? root.classList.contains("sidebar-mobile-open") : !root.classList.contains("sidebar-closed");
  }
  function setSidebar(open) {
    if (isMobile()) {
      root.classList.toggle("sidebar-mobile-open", open);
      backdrop.hidden = !open;
    } else {
      root.classList.toggle("sidebar-closed", !open);
      try { localStorage.setItem("docs-sidebar", open ? "open" : "closed"); } catch (e) {}
    }
    toggleBtn.setAttribute("aria-expanded", String(open));
  }
  toggleBtn.setAttribute("aria-expanded", String(sidebarOpen()));
  toggleBtn.addEventListener("click", function () { setSidebar(!sidebarOpen()); });
  backdrop.addEventListener("click", function () { setSidebar(false); });

  /* ------------------------------------------------------------------ */
  /* Theme toggle                                                        */
  /* ------------------------------------------------------------------ */

  document.getElementById("theme-toggle").addEventListener("click", function () {
    var next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("docs-theme", next); } catch (e) {}
    renderDiagrams();
  });

  /* ------------------------------------------------------------------ */
  /* In-page search                                                      */
  /* ------------------------------------------------------------------ */

  var input = document.getElementById("search-input");
  var countEl = document.getElementById("search-count");
  var resultsEl = document.getElementById("search-results");
  var marks = [];
  var current = -1;
  var timer;

  function clearMarks() {
    var parents = new Set();
    content.querySelectorAll("mark.search-hit").forEach(function (m) {
      var parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parents.add(parent);
    });
    parents.forEach(function (p) { p.normalize(); });
    marks = [];
    current = -1;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function search(query) {
    clearMarks();
    resultsEl.innerHTML = "";
    var q = query.trim().toLowerCase();
    if (q.length < 2) {
      countEl.textContent = "";
      resultsEl.hidden = true;
      return;
    }

    // Walk elements and text in document order so each hit knows its section heading.
    var walker = document.createTreeWalker(content, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (node.nodeType === 1) {
          if (node.matches(".mermaid, .diagram-toolbar, .katex, script, style, a.anchor")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
        return node.nodeValue.toLowerCase().indexOf(q) >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });

    // Headings are rejected/skipped as elements, so track them by position instead.
    var hits = [];
    var node;
    while ((node = walker.nextNode())) hits.push(node);

    var results = [];
    hits.forEach(function (textNode) {
      var text = textNode.nodeValue;
      var lower = text.toLowerCase();
      var heading = sectionFor(textNode);
      var frag = document.createDocumentFragment();
      var last = 0, idx;
      while ((idx = lower.indexOf(q, last)) >= 0) {
        if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
        var mark = document.createElement("mark");
        mark.className = "search-hit";
        mark.textContent = text.slice(idx, idx + q.length);
        frag.appendChild(mark);
        marks.push(mark);
        var start = Math.max(0, idx - 40), end = Math.min(text.length, idx + q.length + 50);
        results.push({
          heading: heading,
          html: (start > 0 ? "…" : "") + escapeHtml(text.slice(start, idx)) +
            "<mark>" + escapeHtml(text.slice(idx, idx + q.length)) + "</mark>" +
            escapeHtml(text.slice(idx + q.length, end)) + (end < text.length ? "…" : ""),
        });
        last = idx + q.length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode.replaceChild(frag, textNode);
    });

    if (!marks.length) {
      countEl.textContent = "0";
      resultsEl.innerHTML = '<div class="search-empty">No matches on this page</div>';
      resultsEl.hidden = false;
      return;
    }

    var limit = 60;
    results.slice(0, limit).forEach(function (r, i) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "search-result";
      item.setAttribute("role", "option");
      item.innerHTML = '<span class="search-result-section">' + escapeHtml(r.heading || "Top of page") +
        '</span><span class="search-result-snippet">' + r.html + "</span>";
      item.addEventListener("mousedown", function (e) { e.preventDefault(); });
      item.addEventListener("click", function () { goTo(i); resultsEl.hidden = true; });
      resultsEl.appendChild(item);
    });
    if (results.length > limit) {
      var more = document.createElement("div");
      more.className = "search-empty";
      more.textContent = "+" + (results.length - limit) + " more — use Enter to step through all matches";
      resultsEl.appendChild(more);
    }
    resultsEl.hidden = false;
    goTo(0, true);
  }

  function sectionFor(node) {
    var title = "";
    for (var i = 0; i < headings.length; i++) {
      // DOCUMENT_POSITION_PRECEDING (2): heading comes before node.
      if (node.compareDocumentPosition(headings[i]) & Node.DOCUMENT_POSITION_PRECEDING) {
        title = headings[i].dataset.title;
      } else break;
    }
    return title;
  }

  function goTo(i, noScrollResults) {
    if (!marks.length) return;
    if (marks[current]) marks[current].classList.remove("current");
    current = (i + marks.length) % marks.length;
    var mark = marks[current];
    mark.classList.add("current");
    mark.scrollIntoView({ block: "center", behavior: "smooth" });
    countEl.textContent = current + 1 + "/" + marks.length;
    var items = resultsEl.querySelectorAll(".search-result");
    items.forEach(function (el, k) { el.classList.toggle("active", k === current); });
    if (!noScrollResults && items[current]) items[current].scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(function () { search(input.value); }, 150);
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(timer);
      if (!marks.length && input.value.trim().length >= 2) { search(input.value); return; }
      goTo(current + (e.shiftKey ? -1 : 1));
    } else if (e.key === "ArrowDown") {
      e.preventDefault(); goTo(current + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); goTo(current - 1);
    } else if (e.key === "Escape") {
      if (input.value) { input.value = ""; search(""); } else input.blur();
    }
  });
  input.addEventListener("focus", function () {
    if (resultsEl.childNodes.length) resultsEl.hidden = false;
  });
  input.addEventListener("blur", function () {
    setTimeout(function () { resultsEl.hidden = true; }, 120);
  });
  document.getElementById("search-next").addEventListener("click", function () { goTo(current + 1); });
  document.getElementById("search-prev").addEventListener("click", function () { goTo(current - 1); });

  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    var typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;
    if ((e.key === "/" && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  // Re-apply hash scroll after content rendered.
  if (location.hash) {
    var target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) target.scrollIntoView();
  }
})();
