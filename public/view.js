import { branchPreview, branchTitle, rankChildren } from './threads.js';
import katex from './vendor/katex/katex.mjs';
import hljs from './vendor/highlight/highlight.js';

const shapes = {
  trash: '<path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7m4-7v7"/>',
  'panel-right-open': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16m-5-7-3-3 3-3"/>',
  'panel-right-close': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16m-8-7 3-3-3-3"/>',
  logout: '<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m6-13 5 5-5 5m-7-5h12"/>',
  brand: '<path d="M12 2.3C10.6 7.8 6.7 12 2 13c4.8.6 8.8 3.9 10 8.7 1.2-4.8 5.2-8.1 10-8.7-4.7-1-8.6-5.2-10-10.7Zm0 0v19.4" stroke-width="1.05"/><g fill="currentColor" stroke="none"><circle cx="12" cy="2.3" r="1.65"/><circle cx="2" cy="13" r="1.25"/><circle cx="22" cy="13" r="1.25"/><circle cx="12" cy="15.3" r="1.25"/><circle cx="12" cy="21.7" r="1.35"/></g>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 7v10m0-5h6a6 6 0 0 0 6-4"/>',
  network: '<rect x="8.5" y="3" width="7" height="5" rx="1.3"/><rect x="3" y="16" width="6" height="5" rx="1.3"/><rect x="15" y="16" width="6" height="5" rx="1.3"/><path d="M12 8v4m-6 4v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/>',
  chat: '<path d="M20 11.5a7.8 7.8 0 0 1-8 7.5h-2l-4 2v-4A7.3 7.3 0 0 1 4 11.5 7.8 7.8 0 0 1 12 4a7.8 7.8 0 0 1 8 7.5Z"/><path d="M8.5 10h7m-7 4H13"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 4 9 5 9-5"/>',
  'panel-left': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  'panel-right': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  moon: '<path d="M20 15a8 8 0 0 1-11-11 8.5 8.5 0 1 0 11 11Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/>',
  settings: '<path d="M10 3h4l.6 2.3 1.2.7 2.4-.6 2 3.5-1.7 1.7v1.7l1.7 1.7-2 3.5-2.4-.6-1.2.7L14 20h-4l-.6-2.4-1.2-.7-2.4.6-2-3.5 1.7-1.7v-1.7L3.8 9l2-3.5 2.4.6 1.2-.7L10 3Z"/><circle cx="12" cy="11.5" r="2.5"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'arrow-up': '<path d="M12 19V5M6 11l6-6 6 6"/>',
  maximize: '<path d="M14 4h6v6m-6 10h6v-6M4 14v6h6M4 10V4h6"/>',
  minimize: '<path d="M20 10h-6V4m6 10h-6v6M4 14h6v6M4 10h6V4"/>',
  focus: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/><circle cx="12" cy="12" r="2.5"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  key: '<circle cx="8" cy="8" r="4.5"/><path d="m11.2 11.2 8.3 8.3m-2.4-2.4 2.1-2.1m-4.6-.4 2.1-2.1"/>',
  eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.3"/>',
  'eye-off': '<path d="m3 3 18 18m-4-4c-1.5.7-3.1 1-5 1-6 0-9.5-6-9.5-6a16 16 0 0 1 3.3-3.7M10 6.2a10 10 0 0 1 2-.2c6 0 9.5 6 9.5 6a17 17 0 0 1-2.2 2.7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  sparkle: '<path d="M12 2c.5 6 4 9.5 10 10-6 .5-9.5 4-10 10C11.5 16 8 12.5 2 12c6-.5 9.5-4 10-10Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};

export function icon(name) {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] ?? ''}</svg>`;
}

export function setIcon(element, name) {
  element.innerHTML = icon(name);
}

export function el(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

export function action(label, glyph, handler, className = 'icon-button small') {
  const button = el('button', className);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  setIcon(button, glyph);
  button.addEventListener('click', handler);
  return button;
}

function mathExpression(source, displayMode) {
  const expression = el(displayMode ? 'div' : 'span', `math-expression${displayMode ? ' math-display' : ''}`);
  katex.render(source, expression, { displayMode, throwOnError: false, trust: false, strict: 'ignore', maxExpand: 500, maxSize: 20 });
  return expression;
}

function appendInline(element, text) {
  const parts = text.split(/(`[^`\n]+`|\$\$[^\n]+?\$\$|\\\([^\n]+?\\\)|(?<!\\)\$(?!\s|\$)(?:\\.|[^$\\\n])+?(?<!\\)\$|\*\*[^\n]+?\*\*|\*[^*\n]+\*)/g);
  for (const part of parts) {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      element.append(el('code', '', part.slice(1, -1)));
    } else if (part.startsWith('$$') && part.endsWith('$$') && part.length > 4) {
      element.append(mathExpression(part.slice(2, -2), false));
    } else if (part.startsWith('\\(') && part.endsWith('\\)')) {
      element.append(mathExpression(part.slice(2, -2), false));
    } else if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      element.append(mathExpression(part.slice(1, -1), false));
    } else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      const strong = el('strong');
      appendInline(strong, part.slice(2, -2));
      element.append(strong);
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      element.append(el('em', '', part.slice(1, -1)));
    } else {
      element.append(part);
    }
  }
}

function codeBlock(source, language) {
  const block = el('section', 'code-block');
  const header = el('div', 'code-header');
  const code = el('code', 'hljs', source);
  let highlighted;
  if (source.length <= 100_000 && !/^(?:text|txt|plaintext|plain)$/i.test(language)) {
    highlighted = hljs.getLanguage(language) ? hljs.highlight(source, { language, ignoreIllegals: true })
      : hljs.highlightAuto(source, ['javascript', 'typescript', 'python', 'json', 'bash', 'sql', 'xml', 'css', 'java', 'cpp', 'rust', 'go', 'yaml']);
    code.innerHTML = highlighted.value;
  }
  const label = el('span', 'code-language', language || highlighted?.language || 'texto');
  const copy = action('Copiar código', 'copy', async () => {
    try {
      await navigator.clipboard.writeText(source);
      feedback.textContent = 'Copiado';
      setIcon(copy.firstElementChild, 'check');
    } catch {
      feedback.textContent = 'No se pudo copiar';
    }
    setTimeout(() => { feedback.textContent = 'Copiar'; setIcon(copy.firstElementChild, 'copy'); }, 2200);
  }, 'code-copy');
  const glyph = el('span');
  setIcon(glyph, 'copy');
  const feedback = el('span', '', 'Copiar');
  feedback.setAttribute('role', 'status');
  copy.replaceChildren(glyph, feedback);
  header.append(label, copy);
  const pre = el('pre');
  pre.append(code);
  block.append(header, pre);
  return block;
}

export function responseText(content) {
  const container = el('div', 'response-text');
  let paragraph = null;
  let list = null;
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^\s{0,3}(`{3,}|~{3,})([^\s`]*)[^\n]*$/.exec(line);
    if (fence) {
      const code = [];
      const closing = new RegExp(`^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      while (++index < lines.length && !closing.test(lines[index])) code.push(lines[index]);
      container.append(codeBlock(code.join('\n'), fence[2].toLowerCase()));
      paragraph = null;
      list = null;
    } else if (/^\s*(\$\$|\\\[)/.test(line)) {
      const start = line.trimStart();
      const close = start.startsWith('$$') ? '$$' : '\\]';
      let source = start.slice(2);
      while (!source.includes(close) && index + 1 < lines.length) source += '\n' + lines[++index];
      const end = source.indexOf(close);
      if (end < 0) container.append(el('p', '', line + source.slice(start.length - 2)));
      else {
        container.append(mathExpression(source.slice(0, end), true));
        const suffix = source.slice(end + 2).trim();
        if (suffix) { const after = el('p'); appendInline(after, suffix); container.append(after); }
      }
      paragraph = null;
      list = null;
    } else if (!line.trim()) {
      paragraph = null;
      list = null;
    } else if (/^#{1,6}\s/.test(line)) {
      const heading = el('h3');
      appendInline(heading, line.replace(/^#{1,6}\s+/, ''));
      container.append(heading);
      paragraph = null;
      list = null;
    } else {
      const item = /^(\d+\.|[-*])\s+(.+)$/.exec(line.trimStart());
      if (item) {
        const tag = /\d/.test(item[1]) ? 'OL' : 'UL';
        if (list?.tagName !== tag) {
          list = el(tag.toLowerCase());
          if (tag === 'OL') list.start = parseInt(item[1], 10);
          container.append(list);
        }
        const entry = el('li');
        appendInline(entry, item[2]);
        list.append(entry);
        paragraph = null;
      } else {
        if (!paragraph) {
          paragraph = el('p');
          container.append(paragraph);
        } else {
          paragraph.append('\n');
        }
        list = null;
        appendInline(paragraph, line);
      }
    }
  }
  return container;
}

export function revealResponse(body, scrollArea, onFinish) {
  // Keep equations, highlighted tokens and copy controls intact while revealing rich responses.
  if (body.querySelector('.math-expression, .code-block')) {
    body.animate([{ opacity: .4 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    onFinish();
    return;
  }
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const pieces = [];
  let total = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const characters = Array.from(node.data);
    if (!characters.length) continue;
    total += characters.length;
    pieces.push({ node, characters, end: total });
    node.data = '';
  }
  const blocks = body.querySelectorAll(':scope > *, li');
  for (const block of blocks) block.hidden = true;
  const caret = el('span', 'typing-caret');
  caret.setAttribute('aria-hidden', 'true');
  const duration = Math.max(360, Math.min(7000, total * 10));
  const started = performance.now();
  let index = 0;
  let written = 0;

  function paint(now) {
    if (!body.isConnected) return onFinish();
    const target = Math.min(total, 1 + Math.floor(total * (now - started) / duration));
    if (target > written) {
      const follow = scrollArea.scrollHeight - scrollArea.clientHeight - scrollArea.scrollTop < 100;
      while (index < pieces.length && written < target) {
        const { node, characters, end } = pieces[index];
        const depth = Math.min(characters.length, target - (end - characters.length));
        for (let ancestor = node.parentElement; ancestor !== body; ancestor = ancestor.parentElement) {
          if (ancestor.hidden) ancestor.hidden = false;
        }
        node.data = characters.slice(0, depth).join('');
        node.after(caret);
        written = Math.min(end, target);
        if (target >= end) index++;
      }
      if (follow) scrollArea.scrollTop = scrollArea.scrollHeight;
    }
    if (written >= total) {
      caret.remove();
      for (const block of blocks) block.hidden = false;
      onFinish();
    } else requestAnimationFrame(paint);
  }
  requestAnimationFrame(paint);
}

export function renderBranchPreview(container, { question, excerpt, origin, answer }) {
  const title = el('h3', 'branch-preview-question', question);
  container.replaceChildren(title);

  function section(label, content) {
    const group = el('div', 'branch-preview-section');
    group.append(el('h4', '', label), content);
    container.append(group);
  }

  if (excerpt) section('Fragmento marcado', el('blockquote', '', excerpt));
  if (origin) {
    section('Rama de origen', el('p', '', origin.question));
    const source = el('details', 'branch-preview-source');
    const label = origin.role === 'assistant' ? 'Ver respuesta de origen' : 'Ver pregunta de origen';
    source.append(el('summary', '', label), responseText(origin.content));
    container.append(source);
  }
  section('Respuesta', answer ? responseText(answer) : el('p', 'branch-preview-empty', 'Aún no hay una respuesta.'));
  return title;
}

function createBranchPreview(stage, popup) {
  const panel = popup.parentElement;
  let anchor = null;
  let closeTimer;

  function hide() {
    clearTimeout(closeTimer);
    anchor?.removeAttribute('aria-details');
    anchor = null;
    popup.hidden = true;
  }

  function hideSoon() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!popup.matches(':hover, :focus-within') && !anchor?.matches(':hover, :focus-visible')) hide();
    }, 260);
  }

  function position(button) {
    const stageBox = stage.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    const node = button.getBoundingClientRect();
    const inset = 9;
    const gap = 8;
    const width = Math.min(330, stageBox.width - inset * 2);
    const bottom = stageBox.bottom - inset;
    const top = stageBox.top + inset;
    popup.style.width = `${Math.max(0, width)}px`;
    popup.style.maxHeight = `${Math.max(0, Math.min(330, bottom - top))}px`;
    const maxLeft = stageBox.right - inset - width;
    const minLeft = stageBox.left + inset;
    let x = Math.max(minLeft, Math.min(maxLeft, node.left));
    let y;
    if (node.right + gap <= maxLeft || node.left - gap - width >= minLeft) {
      x = node.right + gap <= maxLeft ? node.right + gap : node.left - gap - width;
      y = Math.max(top, Math.min(bottom - popup.offsetHeight, node.top));
    } else {
      const below = Math.max(0, bottom - node.bottom - gap);
      const above = Math.max(0, node.top - gap - top);
      const placeBelow = below >= popup.offsetHeight || below >= above;
      popup.style.maxHeight = `${Math.min(330, placeBelow ? below : above)}px`;
      y = placeBelow ? node.bottom + gap : node.top - gap - popup.offsetHeight;
    }
    popup.style.left = `${x - panelBox.left - panel.clientLeft}px`;
    popup.style.top = `${y - panelBox.top - panel.clientTop}px`;
  }

  function show(button, preview) {
    clearTimeout(closeTimer);
    if (anchor === button && !popup.hidden) return;
    anchor?.removeAttribute('aria-details');
    anchor = button;
    anchor.setAttribute('aria-details', popup.id);
    const title = renderBranchPreview(popup, preview);
    title.id = 'branch-preview-title';
    popup.hidden = false;
    popup.scrollTop = 0;
    position(button);
  }

  popup.addEventListener('pointerenter', () => clearTimeout(closeTimer));
  popup.addEventListener('pointerleave', hideSoon);
  popup.addEventListener('focusout', hideSoon);
  popup.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    anchor?.focus({ preventScroll: true });
    hide();
  });
  return {
    hide,
    bind(button, thread, branchId) {
      const open = () => show(button, branchPreview(thread, branchId));
      button.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'touch') open(); });
      button.addEventListener('pointerleave', hideSoon);
      button.addEventListener('focus', () => { if (button.matches(':focus-visible')) open(); });
      button.addEventListener('blur', hideSoon);
      button.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          open();
          popup.focus({ preventScroll: true });
        } else if (event.key === 'Escape' && anchor === button) {
          event.stopPropagation();
          hide();
        }
      });
    },
  };
}

const nodeWidth = 118;
const nodeHeight = 79;
const colPitch = 139;
const rowPitch = 105;
const padding = 19;

export function createMap(stage, scene, canvas, nodeLayer, zoomLabel, previewElement, onNavigate) {
  let graph = { width: 0, height: 0 };
  let view = { x: 0, y: 0, zoom: 1 };
  let drag = null;
  let autoFit = true;
  const collapsed = new Set();
  const context = canvas.getContext('2d');
  const preview = createBranchPreview(stage, previewElement);

  function updateView() {
    preview.hide();
    scene.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    zoomLabel.value = `${Math.round(view.zoom * 100)}%`;
  }

  function fit() {
    const { clientWidth: width, clientHeight: height } = stage;
    if (!width || !height || !graph.width) return;
    const availableHeight = Math.max(120, height - 84);
    const zoom = Math.max(.24, Math.min(1.1, width / graph.width, availableHeight / graph.height));
    view = {
      zoom,
      x: (width - graph.width * zoom) / 2,
      y: (availableHeight - graph.height * zoom) / 2 + 18,
    };
    autoFit = true;
    updateView();
  }

  function zoomBy(factor, x = stage.clientWidth / 2, y = stage.clientHeight / 2) {
    const next = Math.max(.24, Math.min(2.5, view.zoom * factor));
    const ratio = next / view.zoom;
    view = { zoom: next, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio };
    autoFit = false;
    updateView();
  }

  function draw(positions, links, activePath) {
    const styles = getComputedStyle(stage);
    const ratio = Math.max(1, Math.min(2, devicePixelRatio, 4096 / Math.max(graph.width, graph.height)));
    canvas.width = Math.min(graph.width * ratio, 8192);
    canvas.height = Math.min(graph.height * ratio, 8192);
    canvas.style.width = `${graph.width}px`;
    canvas.style.height = `${graph.height}px`;
    context.scale(canvas.width / graph.width, canvas.height / graph.height);
    for (const { from, to } of links) {
      const source = positions.get(from);
      const target = positions.get(to);
      const x1 = source.x + nodeWidth;
      const x2 = target.x;
      const y1 = source.y + nodeHeight / 2;
      const y2 = target.y + nodeHeight / 2;
      const mid = (x1 + x2) / 2;
      const active = activePath.has(from) && activePath.has(to);
      context.strokeStyle = styles.getPropertyValue(active ? '--path-active' : '--path').trim();
      context.lineWidth = active ? 2.5 : 1.5;
      context.beginPath();
      context.moveTo(x1, y1);
      context.bezierCurveTo(mid, y1, mid, y2, x2, y2);
      context.stroke();
    }
  }

  function render(thread, activeId, activePath) {
    preview.hide();
    nodeLayer.replaceChildren();
    if (!thread?.branches[thread.rootId].messages.length) {
      graph = { width: 0, height: 0 };
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    const { nodes, links, rows } = rankChildren(thread, collapsed);
    const positions = new Map(nodes.map(({ id, depth, row }) => [id, {
      x: padding + depth * colPitch,
      y: padding + row * rowPitch,
    }]));
    graph = {
      width: padding * 2 + nodes.at(-1).depth * colPitch + nodeWidth,
      height: padding * 2 + (rows - 1) * rowPitch + nodeHeight,
    };
    draw(positions, links, activePath);
    for (const { id, depth, hasChildren } of nodes) {
      const { x, y } = positions.get(id);
      const wrapper = el('div', `node-wrap depth-${Math.min(depth, 2)}`);
      wrapper.style.left = `${x}px`;
      wrapper.style.top = `${y}px`;
      const question = branchTitle(thread.branches[id]);
      const button = el('button', 'map-node');
      if (id === activeId) button.setAttribute('aria-current', 'true');
      const glyph = el('span', 'node-glyph');
      setIcon(glyph, depth === 0 ? 'chat' : 'branch');
      button.append(glyph, el('span', 'node-question', question));
      preview.bind(button, thread, id);
      button.onclick = () => onNavigate(id);
      wrapper.append(button);
      if (hasChildren) {
        const isClosed = collapsed.has(id);
        const toggle = action(isClosed ? 'Expandir descendientes' : 'Contraer descendientes', isClosed ? 'plus' : 'minus', () => {
          if (isClosed) collapsed.delete(id);
          else collapsed.add(id);
          render(thread, activeId, activePath);
          nodeLayer.querySelector(`[data-toggle="${id}"]`)?.focus({ preventScroll: true });
        }, 'node-toggle');
        toggle.setAttribute('aria-expanded', String(!isClosed));
        toggle.dataset.toggle = id;
        wrapper.append(toggle);
      }
      nodeLayer.append(wrapper);
    }
    if (autoFit) fit();
  }

  stage.addEventListener('wheel', (event) => {
    if (!graph.width) return;
    event.preventDefault();
    const box = stage.getBoundingClientRect();
    zoomBy(Math.exp(-event.deltaY * .002), event.clientX - box.left, event.clientY - box.top);
  }, { passive: false });
  stage.addEventListener('pointerdown', (event) => {
    if (!graph.width || event.button !== 0 || event.target.closest('button, .map-tools')) return;
    drag = { id: event.pointerId, x: event.clientX - view.x, y: event.clientY - view.y };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (event) => {
    if (drag?.id !== event.pointerId) return;
    view.x = event.clientX - drag.x;
    view.y = event.clientY - drag.y;
    autoFit = false;
    updateView();
  });
  stage.addEventListener('lostpointercapture', () => {
    drag = null;
    stage.classList.remove('dragging');
  });
  new ResizeObserver(() => { if (autoFit) fit(); }).observe(stage);
  return {
    render, fit, zoomBy, hidePreview: preview.hide,
    reveal: (ids) => ids.forEach((id) => collapsed.delete(id)),
    getView: () => ({ view: { ...view }, autoFit }),
    restoreView(snapshot) {
      if (snapshot.autoFit) {
        fit();
      } else {
        view = snapshot.view;
        autoFit = false;
        updateView();
      }
    },
  };
}
