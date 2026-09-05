/* figma-ru:editor-layer */
// Russian translation layer for the Figma editor UI.
//
// The editor is a web app served from figma.com and Figma ships no Russian
// build, so there is no locale to switch: the only place the English text can be
// reached is the DOM. This layer is appended to web_app_binding_renderer.js, the
// preload for the web view. Preloads run sandboxed (sandbox: true,
// contextIsolation: true, nodeIntegration: false) — no `fs`, no `require` of
// local files — but they share the page's DOM, which is all this needs.
//
// WHAT IS AND IS NOT AT RISK
// Text drawn on the canvas is not in the DOM, so a design's own content is out
// of reach by construction. What IS in the DOM is layer, page, style and file
// names. Figma auto-names layers with a number ("Frame 22340"), which never
// matches a bare dictionary key, so a collision needs someone to name a layer
// exactly "Search". Two things bound the damage when that happens: the effect is
// display-only — verified by opening Figma's rename field on a translated file
// name, which is seeded "Untitled" from the model rather than "Без названия"
// from the DOM — and words that designers plausibly use verbatim as layer names
// are marked chrome-only, so they are translated in tooltips and labels but
// never in page text.
//
// SAFETY RULES, in order of importance:
//
//   1. Replace only when a text node's ENTIRE trimmed content matches. Never
//      substring-replace.
//   2. Never rewrite text the user is editing: a <textarea>'s child node IS its
//      value, and contenteditable regions are live input. Figma also keeps
//      off-screen containers to measure text while a layer is being edited;
//      those are NOT detected, because the cheap proxies for "hidden" also match
//      visible UI. What makes that acceptable is rule 1 — a measurement node
//      holds what the user typed, which would have to equal a dictionary phrase
//      exactly before anything could happen.
//   3. Never throw. Any failure here must leave the app exactly as it was.
//
// Re-translation is idempotent: no translation is itself an English key (the
// build tool enforces this), so the observer settles instead of looping.
(function () {
  'use strict';

  var PHRASES = __PHRASES__;
  // Translated in attributes only — see "WHAT IS AND IS NOT AT RISK" above.
  var CHROME_ONLY = __CHROME_ONLY__;

  var ATTRS = ['aria-label', 'title', 'placeholder', 'aria-placeholder', 'alt', 'aria-valuetext'];
  var ATTR_SELECTOR = '[aria-label],[title],[placeholder],[aria-placeholder],[alt],[aria-valuetext]';

  // Ancestors whose text is machinery or user input. Matched with closest(), so
  // this is one attribute-based call per node rather than an isContentEditable
  // read at every level — the latter forces a style recalculation, and this runs
  // on every text node in the document.
  //
  // aria-hidden is deliberately NOT in this list: Figma marks visible field
  // labels aria-hidden when the input beside them carries the accessible name,
  // so excluding it silently drops real UI copy ("Opacity", "Corner radius").
  var OPAQUE_SELECTOR =
    'script,style,textarea,input,canvas,noscript,option,select,' +
    '[contenteditable=""],[contenteditable="true"]';

  // The preload is attached to whatever the web view loads, including SSO pages
  // on other origins. Nothing outside Figma should be touched.
  function onFigmaOrigin() {
    try {
      var host = window.location.hostname;
      return /(^|\.)figma\.com$/.test(host) || /(^|\.)figma\.site$/.test(host);
    } catch (e) {
      return false;
    }
  }

  function readFlag(name) {
    try {
      return window.localStorage.getItem(name);
    } catch (e) {
      return null; // storage can be unavailable; treat as unset
    }
  }

  // Relative timestamps are generated, so they need rules rather than entries.
  // Russian plural forms read poorly in a dense file list, so the abbreviated
  // forms native to Russian UI are used instead.
  var UNITS = {
    second: 'с',
    minute: 'мин.',
    hour: 'ч.',
    day: 'дн.',
    week: 'нед.',
    month: 'мес.',
    year: 'г.',
  };

  var PATTERNS = [
    [/^Edited (\d+) (second|minute|hour|day|week|month|year)s? ago$/, 'Изменено $N $U назад'],
    [/^Viewed (\d+) (second|minute|hour|day|week|month|year)s? ago$/, 'Просмотрено $N $U назад'],
    [/^Created (\d+) (second|minute|hour|day|week|month|year)s? ago$/, 'Создано $N $U назад'],
    [/^Updated (\d+) (second|minute|hour|day|week|month|year)s? ago$/, 'Обновлено $N $U назад'],
    [/^(\d+) (second|minute|hour|day|week|month|year)s? ago$/, '$N $U назад'],
  ];

  // Figma renders typographic punctuation (’ “ ” …) where a dictionary is
  // naturally written with ASCII, so both spellings resolve to one entry.
  function normalise(text) {
    return text
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/…/g, '...')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ');
  }

  var anywhere = new Map();
  var chromeOnly = new Set(CHROME_ONLY);

  function register(map, key, value) {
    map.set(key, value);
    var alt = normalise(key);
    if (alt !== key && !map.has(alt)) map.set(alt, value);
  }

  var attrDict = new Map();
  for (var key in PHRASES) {
    if (!Object.prototype.hasOwnProperty.call(PHRASES, key)) continue;
    register(attrDict, key, PHRASES[key]);
    if (!chromeOnly.has(key)) register(anywhere, key, PHRASES[key]);
  }

  function lookup(dict, text) {
    var hit = dict.get(text);
    if (hit !== undefined) return hit;
    hit = dict.get(normalise(text));
    if (hit !== undefined) return hit;

    for (var i = 0; i < PATTERNS.length; i++) {
      var m = text.match(PATTERNS[i][0]);
      if (m) {
        var unit = UNITS[m[2]];
        if (!unit) continue;
        return PATTERNS[i][1].replace('$N', m[1]).replace('$U', unit);
      }
    }
    return undefined;
  }

  // Opt-in collection of untranslated UI text, to grow the dictionary against a
  // real session. The collected list can contain names from the user's own
  // files, so it is written only on request and README says to review it before
  // sharing. Persisting is debounced: serialising the whole set on every new
  // string is quadratic and this runs on the main thread.
  var collecting = readFlag('figma-ru:collect') === '1';
  var missing = new Set();
  var persistQueued = false;

  function persistMissing() {
    persistQueued = false;
    try {
      window.localStorage.setItem('figma-ru:missing', JSON.stringify(Array.from(missing)));
    } catch (e) {
      /* quota or unavailable; keep the in-memory set */
    }
  }

  function noteMissing(text) {
    if (!collecting) return;
    if (text.length > 60 || missing.size > 4000) return;
    if (!/[A-Za-z]/.test(text) || /^[\d\s.,:%×°+-]+$/.test(text)) return;
    if (missing.has(text)) return;
    missing.add(text);
    if (persistQueued) return;
    persistQueued = true;
    window.setTimeout(persistMissing, 1000);
  }

  // Text nodes arrive in document order, so sibling nodes under one parent share
  // a verdict — caching the last parent collapses the common case to one
  // closest() call per element rather than per text node.
  var lastParent = null;
  var lastParentOpaque = false;

  function parentIsOpaque(node) {
    var el = node.parentElement;
    if (!el) return true;
    if (el === lastParent) return lastParentOpaque;
    lastParent = el;
    lastParentOpaque = Boolean(el.closest && el.closest(OPAQUE_SELECTOR));
    return lastParentOpaque;
  }

  function translateTextNode(node) {
    var raw = node.nodeValue;
    if (!raw) return;
    var text = raw.trim();
    if (!text || text.length > 120) return;
    if (parentIsOpaque(node)) return;

    var hit = lookup(anywhere, text);
    if (hit === undefined) {
      noteMissing(text);
      return;
    }

    // Preserve the original surrounding whitespace; Figma's layout sometimes
    // relies on it for spacing between inline nodes.
    var lead = raw.slice(0, raw.indexOf(text.charAt(0)));
    var next = lead + hit + raw.slice(lead.length + text.length);
    if (next !== raw) node.nodeValue = next;
  }

  function translateAttributes(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.closest && el.closest('[contenteditable=""],[contenteditable="true"]')) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var name = ATTRS[i];
      if (!el.hasAttribute(name)) continue;
      var value = el.getAttribute(name);
      if (!value) continue;
      var text = value.trim();
      if (!text || text.length > 120) continue;
      var hit = lookup(attrDict, text);
      if (hit === undefined) noteMissing(text);
      else if (hit !== value) el.setAttribute(name, hit);
    }
  }

  function walkText(root) {
    if (root.nodeType === 3) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && root.closest && root.closest(OPAQUE_SELECTOR)) return;

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) translateTextNode(node);
  }

  function walkAttributes(root) {
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && root.matches && root.matches(ATTR_SELECTOR)) {
      translateAttributes(root);
    }
    if (!root.querySelectorAll) return;
    var found = root.querySelectorAll(ATTR_SELECTOR);
    for (var i = 0; i < found.length; i++) translateAttributes(found[i]);
  }

  function walk(root) {
    if (!root) return;
    walkText(root);
    walkAttributes(root);
  }

  // Mutations arrive in bursts while panels open and the canvas updates.
  // Coalescing them into one frame keeps the observer off the critical path;
  // the queue is deduplicated and time-boxed so one big burst degrades into
  // several frames instead of a single long stall.
  var MAX_QUEUE = 2000;
  var FRAME_BUDGET_MS = 8;
  var queue = new Set();
  var scheduled = false;
  var observer = null;

  function flush(deadline) {
    scheduled = false;
    var started = deadline && typeof deadline === 'number' ? deadline : 0;
    var processed = 0;

    var nodes = Array.from(queue);
    queue.clear();

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      try {
        if (node.isConnected === false) continue;
        walk(node);
      } catch (e) {
        /* one bad node must not stop the rest */
      }
      processed++;

      // performance.now() is available in the renderer; guard anyway.
      if ((processed & 31) === 0 && typeof performance !== 'undefined' && performance.now) {
        if (started === 0) started = performance.now();
        else if (performance.now() - started > FRAME_BUDGET_MS) {
          for (var j = i + 1; j < nodes.length; j++) queue.add(nodes[j]);
          break;
        }
      }
    }

    // Discard the records our own writes generated, so a translation never
    // schedules another pass over the same subtree.
    if (observer) observer.takeRecords();
    if (queue.size) schedule(null);
  }

  function schedule(node) {
    if (node) {
      if (queue.size >= MAX_QUEUE) return;
      queue.add(node);
    }
    if (scheduled) return;
    scheduled = true;
    if (window.requestAnimationFrame) window.requestAnimationFrame(flush);
    else window.setTimeout(flush, 0);
  }

  function observe() {
    try {
      walk(document.body);
    } catch (e) {
      /* initial pass is best-effort */
    }

    observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        if (record.type === 'childList') {
          // A whole subtree may have been added: it needs a full walk.
          for (var j = 0; j < record.addedNodes.length; j++) schedule(record.addedNodes[j]);
        } else if (record.type === 'attributes') {
          // Only this element's attributes changed — no subtree work needed.
          try {
            translateAttributes(record.target);
          } catch (e) {
            /* ignore */
          }
        } else {
          try {
            translateTextNode(record.target);
          } catch (e) {
            /* ignore */
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  }

  function start() {
    try {
      if (!onFigmaOrigin()) return;
      if (readFlag('figma-ru:off') === '1') return;
      observe();
    } catch (e) {
      /* leave the app untouched on failure */
    }
  }

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  } catch (e) {
    /* leave the app untouched on failure */
  }
})();
