/* figma-ru:rail-button */
// Adds an entry to Figma's left rail — the strip holding Файл / Ресурсы /
// Инструменты / Переменные — that opens the assistant plugin.
//
// WHY IT IS BUILT THIS WAY
// The rail is Figma's own UI and the plugin API offers no way into it, so the
// button is injected by the same preload layer that does the translation. Two
// things were established by experiment before writing any of this, in Figma's
// own devtools console:
//
//   * Synthetic keyboard events are ignored. Dispatching Shift+1 (zoom to fit)
//     returned true and changed nothing, so a shortcut like Ctrl+Alt+P cannot be
//     used to launch anything.
//   * Programmatic clicks DO work. Calling .click() on a rail button switched
//     the panel exactly as a real click would.
//
// So the button drives Figma's own interface: it clicks the plugin's pinned
// entry when there is one, and otherwise opens the plugin browser.
//
// The button is CLONED from an existing rail entry rather than styled from
// scratch. Figma's class names are generated (x1v9usgg, x4oah1p, …) and change
// between builds; cloning inherits whatever they currently are, so the button
// keeps matching the rail through redesigns instead of drifting out of step.
(function () {
  'use strict';

  var PLUGIN_NAME = 'Свой ассистент';
  var MARK = 'data-figma-ru-rail';
  var LABEL = 'Ассистент';

  // Rail labels in both languages: the patch translates them, but the layer can
  // be switched off, and a fresh build may add a label we do not translate yet.
  var RAIL_LABELS = [
    'Файл', 'Ресурсы', 'Инструменты', 'Переменные',
    'File', 'Assets', 'Tools', 'Variables',
  ];

  // Labels are truncated in the narrow rail ("Инструм"), so match by prefix.
  function matchesRailLabel(text) {
    for (var i = 0; i < RAIL_LABELS.length; i++) {
      var label = RAIL_LABELS[i];
      if (text === label) return true;
      if (label.length > 4 && text.length >= 4 && label.indexOf(text) === 0) return true;
    }
    return false;
  }

  function leafElements() {
    return document.querySelectorAll('span,div');
  }

  /** The <button> of a rail entry whose label matches, or null. */
  function findRailButton(predicate) {
    var nodes = leafElements();
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.children.length) continue;
      var text = (node.textContent || '').trim();
      if (!text || !predicate(text)) continue;
      var button = node.closest ? node.closest('button') : null;
      if (button) return button;
    }
    return null;
  }

  function findToolsButton() {
    return findRailButton(function (text) {
      return text === 'Инструменты' || text === 'Tools' ||
        (text.length >= 6 && 'Инструменты'.indexOf(text) === 0);
    });
  }

  /** A clickable element whose visible text is exactly the plugin's name. */
  function findPluginEntry() {
    var nodes = leafElements();
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.children.length) continue;
      if ((node.textContent || '').trim() !== PLUGIN_NAME) continue;
      var target = node.closest ? node.closest('button,[role="button"],[role="menuitem"]') : null;
      if (target) return target;
    }
    return null;
  }

  function launch() {
    var pinned = findPluginEntry();
    if (pinned) {
      pinned.click();
      return;
    }
    // Not pinned and not on screen: open the plugin browser so it is one click
    // away rather than doing nothing.
    var tools = findToolsButton();
    if (tools) tools.click();
  }

  var ICON =
    '<path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5 10.1 7.6z" ' +
    'fill="currentColor"/><path d="M18 14l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 ' +
    '2.1-.9z" fill="currentColor"/>';

  function buildButton(template) {
    var clone = template.cloneNode(true);
    clone.setAttribute(MARK, '1');
    clone.removeAttribute('id');
    clone.removeAttribute('aria-current');
    clone.removeAttribute('aria-selected');
    clone.setAttribute('aria-label', LABEL);
    clone.setAttribute('title', LABEL + ' — свой API, кредиты Figma не тратятся');

    // Swap the icon in place so sizing and spacing classes are kept.
    var svg = clone.querySelector('svg');
    if (svg) {
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.innerHTML = ICON;
    }

    // Replace the label text, leaving every wrapper element untouched.
    var replaced = false;
    var walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var text = (node.nodeValue || '').trim();
      if (!text) continue;
      node.nodeValue = replaced ? '' : LABEL;
      replaced = true;
    }

    clone.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      try {
        launch();
      } catch (e) {
        /* Figma's UI moved; better to do nothing than to throw */
      }
    }, true);

    return clone;
  }

  function ensureButton() {
    if (document.querySelector('[' + MARK + ']')) return;

    var template = findRailButton(matchesRailLabel);
    if (!template || !template.parentElement) return;

    var button = buildButton(template);
    template.parentElement.appendChild(button);
  }

  function start() {
    if (readFlagOff()) return;

    // React re-renders the rail on navigation and panel switches, which drops
    // anything injected into it. A cheap presence check on an interval survives
    // that without observing the whole document a second time — the translation
    // layer already has an observer, and this is one querySelector per tick.
    try {
      ensureButton();
    } catch (e) {
      /* ignore */
    }
    window.setInterval(function () {
      try {
        ensureButton();
      } catch (e) {
        /* ignore */
      }
    }, 3000);
  }

  function readFlagOff() {
    try {
      return window.localStorage.getItem('figma-ru:no-rail-button') === '1';
    } catch (e) {
      return false;
    }
  }

  function onFigmaOrigin() {
    try {
      var host = window.location.hostname;
      return /(^|\.)figma\.com$/.test(host);
    } catch (e) {
      return false;
    }
  }

  try {
    if (!onFigmaOrigin()) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  } catch (e) {
    /* leave the app untouched on failure */
  }
})();
