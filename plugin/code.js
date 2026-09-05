// Plugin main thread: turns a scene description into real Figma nodes.
//
// The split is forced by the plugin sandbox: only the UI iframe can make network
// requests, and only this thread can touch the document or clientStorage. So the
// UI talks to the model and posts back a plain JSON tree, and everything here is
// offline — which also means a failed request can never leave half a screen on
// the canvas.
//
// The API key never leaves this machine: the UI sends it straight to the
// provider, and it is stored in figma.clientStorage, which is local to this
// Figma installation.

const SETTINGS_KEY = 'figma-ru-assistant:settings';

figma.showUI(__html__, { width: 420, height: 620, themeColors: true });

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/** "#rrggbb" | "#rgb" -> Figma RGB, or null when unparseable. */
function parseColor(value) {
  if (typeof value !== 'string') return null;
  let hex = value.trim().replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16) / 255,
    g: parseInt(hex.slice(2, 4), 16) / 255,
    b: parseInt(hex.slice(4, 6), 16) / 255,
  };
}

function solid(color) {
  return [{ type: 'SOLID', color: color }];
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const WEIGHTS = {
  regular: 'Regular',
  medium: 'Medium',
  semibold: 'Semi Bold',
  bold: 'Bold',
};

/**
 * Load every font the tree needs before creating anything. Figma throws if text
 * is written before its font is loaded, and a throw halfway through would leave
 * a partial screen behind.
 */
async function loadFonts(spec) {
  const styles = new Set(['Regular']);

  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text') {
      const weight = WEIGHTS[String(node.fontWeight || 'regular').toLowerCase()];
      styles.add(weight || 'Regular');
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  })(spec);

  for (const style of styles) {
    try {
      await figma.loadFontAsync({ family: 'Inter', style: style });
    } catch (e) {
      // A weight the local Inter does not have; Regular is already loaded.
    }
  }
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

const ALIGN = { min: 'MIN', start: 'MIN', center: 'CENTER', max: 'MAX', end: 'MAX' };

function applyCommon(node, spec) {
  if (spec.name) node.name = String(spec.name);

  const fill = parseColor(spec.fill);
  if (fill && 'fills' in node) node.fills = solid(fill);
  else if (spec.fill === 'none' && 'fills' in node) node.fills = [];

  const stroke = parseColor(spec.stroke);
  if (stroke && 'strokes' in node) {
    node.strokes = solid(stroke);
    node.strokeWeight = typeof spec.strokeWidth === 'number' ? spec.strokeWidth : 1;
  }

  if (typeof spec.cornerRadius === 'number' && 'cornerRadius' in node) {
    node.cornerRadius = spec.cornerRadius;
  }
  if (typeof spec.opacity === 'number' && 'opacity' in node) {
    node.opacity = Math.max(0, Math.min(1, spec.opacity));
  }
}

function applyAutoLayout(frame, spec) {
  const layout = String(spec.layout || 'none').toLowerCase();
  if (layout !== 'vertical' && layout !== 'horizontal') return;

  frame.layoutMode = layout === 'vertical' ? 'VERTICAL' : 'HORIZONTAL';
  frame.itemSpacing = typeof spec.gap === 'number' ? spec.gap : 0;

  const padding = typeof spec.padding === 'number' ? spec.padding : 0;
  frame.paddingTop = typeof spec.paddingTop === 'number' ? spec.paddingTop : padding;
  frame.paddingBottom = typeof spec.paddingBottom === 'number' ? spec.paddingBottom : padding;
  frame.paddingLeft = typeof spec.paddingLeft === 'number' ? spec.paddingLeft : padding;
  frame.paddingRight = typeof spec.paddingRight === 'number' ? spec.paddingRight : padding;

  frame.primaryAxisAlignItems = ALIGN[String(spec.justify || 'min').toLowerCase()] || 'MIN';
  frame.counterAxisAlignItems = ALIGN[String(spec.align || 'min').toLowerCase()] || 'MIN';

  // Auto-layout frames size to their contents unless told otherwise.
  frame.primaryAxisSizingMode = spec.hugPrimary === false ? 'FIXED' : 'AUTO';
  frame.counterAxisSizingMode = spec.hugCounter === false ? 'FIXED' : 'AUTO';
}

function applySizing(node, spec, parentSpec) {
  const hasWidth = typeof spec.width === 'number';
  const hasHeight = typeof spec.height === 'number';

  if ((hasWidth || hasHeight) && 'resize' in node) {
    const width = hasWidth ? spec.width : node.width;
    const height = hasHeight ? spec.height : node.height;
    try {
      node.resize(Math.max(1, width), Math.max(1, height));
    } catch (e) {
      // Text nodes with auto-resize refuse an explicit size; harmless.
    }
  }

  // Only meaningful inside an auto-layout parent.
  const parentLayout = parentSpec && String(parentSpec.layout || '').toLowerCase();
  if (parentLayout !== 'vertical' && parentLayout !== 'horizontal') return;

  if (spec.grow) node.layoutGrow = 1;
  if (spec.stretch) node.layoutAlign = 'STRETCH';
}

async function build(spec, parentSpec) {
  const type = String(spec.type || 'frame').toLowerCase();

  if (type === 'text') {
    const node = figma.createText();
    const weight = WEIGHTS[String(spec.fontWeight || 'regular').toLowerCase()] || 'Regular';
    try {
      node.fontName = { family: 'Inter', style: weight };
    } catch (e) {
      node.fontName = { family: 'Inter', style: 'Regular' };
    }
    node.characters = String(spec.text == null ? '' : spec.text);
    if (typeof spec.fontSize === 'number') node.fontSize = spec.fontSize;
    if (typeof spec.lineHeight === 'number') {
      node.lineHeight = { value: spec.lineHeight, unit: 'PIXELS' };
    }
    const color = parseColor(spec.color) || parseColor(spec.fill);
    if (color) node.fills = solid(color);
    if (spec.textAlign) {
      node.textAlignHorizontal = String(spec.textAlign).toUpperCase();
    }
    if (spec.name) node.name = String(spec.name);
    applySizing(node, spec, parentSpec);
    return node;
  }

  if (type === 'rect' || type === 'rectangle') {
    const node = figma.createRectangle();
    node.resize(
      typeof spec.width === 'number' ? Math.max(1, spec.width) : 100,
      typeof spec.height === 'number' ? Math.max(1, spec.height) : 100
    );
    applyCommon(node, spec);
    applySizing(node, spec, parentSpec);
    return node;
  }

  if (type === 'ellipse') {
    const node = figma.createEllipse();
    node.resize(
      typeof spec.width === 'number' ? Math.max(1, spec.width) : 100,
      typeof spec.height === 'number' ? Math.max(1, spec.height) : 100
    );
    applyCommon(node, spec);
    applySizing(node, spec, parentSpec);
    return node;
  }

  // Default: a frame, optionally with auto-layout and children.
  const frame = figma.createFrame();
  frame.fills = [];
  applyCommon(frame, spec);
  applyAutoLayout(frame, spec);

  if (Array.isArray(spec.children)) {
    for (const childSpec of spec.children) {
      if (!childSpec || typeof childSpec !== 'object') continue;
      const child = await build(childSpec, spec);
      if (child) frame.appendChild(child);
    }
  }

  applySizing(frame, spec, parentSpec);
  return frame;
}

/** Place a new top-level node to the right of everything already on the page. */
function placeOnCanvas(node) {
  const siblings = figma.currentPage.children.filter((child) => child !== node);
  let x = 0;
  let y = 0;
  if (siblings.length) {
    x = Math.max.apply(null, siblings.map((s) => s.x + s.width)) + 120;
    y = Math.min.apply(null, siblings.map((s) => s.y));
  }
  node.x = Math.round(x);
  node.y = Math.round(y);
}

// ---------------------------------------------------------------------------
// Context for the model
// ---------------------------------------------------------------------------

function describeSelection() {
  const selection = figma.currentPage.selection;
  if (!selection.length) return null;

  function describe(node, depth) {
    const entry = {
      id: node.id,
      name: node.name,
      type: node.type,
      width: Math.round('width' in node ? node.width : 0),
      height: Math.round('height' in node ? node.height : 0),
    };
    if (node.type === 'TEXT') entry.text = node.characters.slice(0, 200);
    if (depth < 2 && 'children' in node && node.children.length) {
      entry.children = node.children.slice(0, 20).map((c) => describe(c, depth + 1));
    }
    return entry;
  }

  return selection.slice(0, 5).map((n) => describe(n, 0));
}

// ---------------------------------------------------------------------------
// Messages from the UI
// ---------------------------------------------------------------------------

figma.ui.onmessage = async (message) => {
  if (!message || typeof message !== 'object') return;

  try {
    if (message.type === 'load-settings') {
      const saved = await figma.clientStorage.getAsync(SETTINGS_KEY);
      figma.ui.postMessage({ type: 'settings', settings: saved || null });
      return;
    }

    if (message.type === 'save-settings') {
      await figma.clientStorage.setAsync(SETTINGS_KEY, message.settings || {});
      figma.ui.postMessage({ type: 'settings-saved' });
      return;
    }

    if (message.type === 'get-context') {
      figma.ui.postMessage({
        type: 'context',
        selection: describeSelection(),
        page: figma.currentPage.name,
      });
      return;
    }

    if (message.type === 'render') {
      const spec = message.spec;
      if (!spec || typeof spec !== 'object') {
        figma.ui.postMessage({ type: 'error', message: 'Модель вернула пустой макет.' });
        return;
      }

      await loadFonts(spec);
      const node = await build(spec, null);
      figma.currentPage.appendChild(node);
      placeOnCanvas(node);
      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);

      figma.ui.postMessage({ type: 'rendered', name: node.name });
      figma.notify('Готово: ' + node.name);
      return;
    }

    if (message.type === 'close') figma.closePlugin();
  } catch (e) {
    const text = e && e.message ? e.message : String(e);
    figma.ui.postMessage({ type: 'error', message: text });
    figma.notify('Не получилось: ' + text, { error: true });
  }
};
