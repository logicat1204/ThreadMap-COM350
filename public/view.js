import { branchTitle, rankChildren } from './threads.js';

const shapes = {
  brand: '<path d="M4 12h4m8-7h4m-4 14h4M8 12c5 0 3-7 8-7m-8 7c5 0 3 7 8 7"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="20" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="20" cy="19" r="1.5" fill="currentColor" stroke="none"/>',
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

function appendInline(element, text) {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g);
  for (const part of parts) {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      element.append(el('code', '', part.slice(1, -1)));
    } else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      element.append(el('strong', '', part.slice(2, -2)));
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      element.append(el('em', '', part.slice(1, -1)));
    } else {
      element.append(part);
    }
  }
}

export function responseText(content) {
  const container = el('div', 'response-text');
  let paragraph = null;
  let list = null;
  let code = null;
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith('```')) {
      const opening = !code;
      if (opening) {
        code = el('code');
        const block = el('pre');
        block.append(code);
        container.append(block);
      } else {
        code.textContent = code.textContent.replace(/\n$/, '');
        code = null;
      }
      paragraph = null;
      list = null;
    } else if (code) {
      code.append(line + '\n');
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

const nodeWidth = 118;
const nodeHeight = 79;
const colPitch = 139;
const rowPitch = 105;
const padding = 19;

export function createMap(stage, scene, canvas, nodeLayer, zoomLabel, onNavigate) {
  let graph = { width: 0, height: 0 };
  let view = { x: 0, y: 0, zoom: 1 };
  let drag = null;
  let autoFit = true;
  const collapsed = new Set();
  const context = canvas.getContext('2d');

  function updateView() {
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
      button.title = question;
      if (id === activeId) button.setAttribute('aria-current', 'true');
      const glyph = el('span', 'node-glyph');
      setIcon(glyph, depth === 0 ? 'chat' : 'branch');
      button.append(glyph, el('span', 'node-question', question));
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
  return { render, fit, zoomBy, reveal: (ids) => ids.forEach((id) => collapsed.delete(id)) };
}
