import { branchTitle, contextFor, createBranch, createThread, lineage, message, modelInput, seedThreads } from './threads.js';
import { action, createMap, el, responseText, setIcon } from './view.js';

const byId = (id) => document.getElementById(id);
const workspace = byId('workspace');
const prompt = byId('prompt');
const chatScroll = byId('chat-scroll');
const messages = byId('messages');
const settings = byId('settings');
const settingsForm = byId('settings-form');
const personalInput = byId('personal-key');
const ask = byId('ask-selection');
const search = byId('history-search');
const narrowMap = matchMedia('(max-width: 1050px)');
const narrowSidebar = matchMedia('(max-width: 730px)');
const storeKey = 'threadmap.workspace.v1';
const requests = new Set();
const errors = new Map();
const drafts = new Map();
const shownContext = new Set();
const providerNames = { openai: 'OpenAI', gemini: 'Gemini' };
let providerConfig = {};
let mapWidth = null;
let activeSelection = null;
let flashId = null;
let toastTimer;

function readPreference(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; }
  catch { return fallback; }
}

function writePreference(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch { return false; }
}

function initialState() {
  try {
    const saved = JSON.parse(readPreference(storeKey));
    if (saved?.threads?.length && saved.threads.every((thread) => thread.branches?.[thread.rootId])) return saved;
  } catch { /* Start the workspace with the examples if its saved data cannot be read. */ }
  const threads = seedThreads();
  return { threads, threadId: threads[0].id, branchId: threads[0].rootId };
}

const state = initialState();
if (!state.threads.some((thread) => thread.id === state.threadId)) state.threadId = state.threads[0].id;
if (!currentThread().branches[state.branchId]) state.branchId = currentThread().rootId;
let connection = {
  provider: readPreference('threadmap.provider') === 'gemini' ? 'gemini' : 'openai',
  mode: readPreference('threadmap.connection') === 'personal' ? 'personal' : 'platform',
  key: '',
};
let theme = readPreference('threadmap.theme', 'light');
let mapVisible = !narrowMap.matches;
let sidebarVisible = !narrowSidebar.matches;
let expanded = false;

document.querySelectorAll('[data-icon]').forEach((element) => setIcon(element, element.dataset.icon));
const graph = createMap(byId('map-stage'), byId('map-scene'), byId('map-lines'), byId('map-nodes'), byId('zoom-level'), (id) => {
  navigate(state.threadId, id);
  if (narrowMap.matches) {
    showMap(false, false);
    byId('map-open').focus();
  } else {
    if (expanded) showMap(true, false);
    byId('map-nodes').querySelector('[aria-current="true"]')?.focus({ preventScroll: true });
  }
});

function currentThread() {
  return state.threads.find((thread) => thread.id === state.threadId);
}

function currentBranch() {
  return currentThread().branches[state.branchId];
}

function draft() {
  if (!drafts.has(state.branchId)) drafts.set(state.branchId, { text: '', source: null });
  return drafts.get(state.branchId);
}

function notify(text) {
  const toast = byId('toast');
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}

function save() {
  if (!writePreference(storeKey, JSON.stringify(state))) notify('El navegador no pudo guardar los cambios de esta sesión.');
}

function renderHistory() {
  const history = byId('history');
  history.replaceChildren();
  const query = search.value.trim().toLocaleLowerCase('es');
  const list = state.threads.filter((thread) => thread.title.toLocaleLowerCase('es').includes(query))
    .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
  const today = new Date().toDateString();
  const groups = [
    ['Hoy', list.filter((thread) => new Date(thread.updatedAt).toDateString() === today)],
    ['Anteriores', list.filter((thread) => new Date(thread.updatedAt).toDateString() !== today)],
  ];
  for (const [label, threads] of groups) {
    if (!threads.length) continue;
    const group = el('section', 'history-group');
    group.append(el('h3', 'history-group-label', label));
    for (const thread of threads) {
      const button = el('button', 'history-item');
      button.title = thread.title;
      const glyph = el('span');
      setIcon(glyph, 'chat');
      button.append(glyph, el('span', 'history-name', thread.title));
      if (thread.id === state.threadId) button.setAttribute('aria-current', 'true');
      button.onclick = () => {
        navigate(thread.id, thread.rootId);
        if (narrowSidebar.matches) showSidebar(false);
      };
      group.append(button);
    }
    history.append(group);
  }
  if (!list.length) history.append(el('p', 'history-no-results', 'No se encontraron conversaciones.'));
}

function renderHeader() {
  const thread = currentThread();
  const branch = currentBranch();
  const title = byId('chat-title');
  title.textContent = branch.parentId ? branchTitle(branch) : thread.title;
  title.title = title.textContent;
  const subtitle = byId('chat-subtitle');
  subtitle.replaceChildren();
  const glyph = el('span');
  setIcon(glyph, 'branch');
  if (branch.parentId) {
    const root = action('Volver a la rama principal', 'chevron-right', () => navigate(thread.id, thread.rootId), 'return-root');
    root.append(el('span', '', 'Rama principal'));
    subtitle.replaceChildren(root, glyph, el('span', '', 'Rama derivada'));
  } else {
    subtitle.append(glyph, el('span', '', 'Rama principal'));
  }
}

function canReply({ provider, mode, key } = connection) {
  return mode === 'personal' ? Boolean(key) : Boolean(providerConfig[provider]?.platformAvailable);
}

function renderConnection() {
  const { provider, mode } = connection;
  const live = canReply();
  const name = providerNames[provider];
  byId('connection').classList.toggle('connected', live);
  const label = byId('connection-label');
  if (live) label.textContent = `${name} · ${mode === 'personal' ? 'Personal' : 'Plataforma'}`;
  else if (mode === 'personal') label.textContent = `Conecta ${name}`;
  else label.textContent = provider === 'openai' ? 'Modo demo' : 'Gemini · Demo';
}

function selectReference(entry, excerpt = null, excerptRange = null) {
  const selection = draft();
  selection.source = { branchId: entry.branchId, messageId: entry.id, excerpt, excerptRange, content: entry.content };
  dismissSelection();
  window.getSelection()?.removeAllRanges();
  updateComposer();
  prompt.focus();
}

function addHighlights(thread) {
  if (!globalThis.Highlight || !CSS.highlights) return;
  const ranges = [];
  for (const branch of Object.values(thread.branches)) {
    if (!branch.excerpt) continue;
    const target = document.getElementById(`message-${branch.originMessageId}`)?.querySelector('.response-text');
    if (!target) continue;
    const start = branch.excerptRange?.start ?? target.textContent.indexOf(branch.excerpt);
    if (start < 0) continue;
    const end = branch.excerptRange?.end ?? start + branch.excerpt.length;
    const range = document.createRange();
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let cursor;
    let started = false;
    while ((cursor = walker.nextNode())) {
      const next = offset + cursor.length;
      if (!started && start < next) {
        range.setStart(cursor, start - offset);
        started = true;
      }
      if (started && end <= next) {
        range.setEnd(cursor, end - offset);
        ranges.push(range);
        break;
      }
      offset = next;
    }
  }
  CSS.highlights.set('branch-excerpt', new Highlight(...ranges));
}

function renderMessage(entry) {
  const row = el('article', `message ${entry.role}`);
  row.id = `message-${entry.id}`;
  const isFork = entry.role === 'user' && currentThread().branches[entry.branchId].parentId &&
    currentThread().branches[entry.branchId].messages[0].id === entry.id;
  const branchAction = () => selectReference(entry);
  if (entry.role === 'user') {
    const userContent = el('div', 'user-content');
    const bubble = el('div', `user-bubble${isFork ? ' fork-bubble' : ''}${entry.id === flashId ? ' new-fork' : ''}`);
    if (isFork) {
      const label = el('span', 'fork-label');
      setIcon(label, 'branch');
      label.append('Nueva rama');
      bubble.append(label);
      if (entry.reference) bubble.append(el('blockquote', 'user-reference', entry.reference));
    }
    bubble.append(el('p', '', entry.content));
    userContent.append(bubble, action('Crear rama desde la pregunta', 'branch', branchAction, 'icon-button small user-action'));
    row.append(userContent);
  } else {
    const avatar = el('span', 'assistant-avatar');
    setIcon(avatar, 'brand');
    const body = el('div', 'message-body');
    body.append(el('div', 'assistant-name', 'ThreadMap'), responseText(entry.content));
    if (entry.incomplete) body.append(el('p', 'incomplete', 'La respuesta alcanzó su límite de longitud.'));
    const actions = el('div', 'message-actions');
    actions.append(
      action('Copiar respuesta', 'copy', async () => {
        try { await navigator.clipboard.writeText(entry.content); notify('Respuesta copiada'); }
        catch { notify('No se pudo copiar la respuesta.'); }
      }),
      action('Crear rama desde la respuesta', 'branch', branchAction),
    );
    body.append(actions);
    row.append(avatar, body);
  }
  return row;
}

function renderChat() {
  dismissSelection();
  const thread = currentThread();
  const entries = contextFor(thread, state.branchId);
  messages.replaceChildren();
  messages.classList.toggle('is-empty', !entries.length);
  if (!entries.length) {
    const welcome = el('div', 'welcome');
    const brand = el('span', 'welcome-mark');
    setIcon(brand, 'brand');
    welcome.append(brand, el('h2', '', '¿Qué quieres explorar?'), el('p', '', 'Empieza con una pregunta y abre una rama cuando quieras profundizar en una respuesta.'));
    messages.append(welcome);
  } else {
    const inherited = entries.filter((entry) => entry.inherited);
    if (inherited.length) {
      const details = el('details', 'inherited');
      details.open = shownContext.has(state.branchId);
      const selectedId = state.branchId;
      const label = el('summary');
      const glyph = el('span');
      setIcon(glyph, 'layers');
      label.append(glyph, el('span', '', 'Contexto heredado'), el('small', '', `${inherited.length} mensajes`));
      details.append(label, ...inherited.map(renderMessage));
      details.addEventListener('toggle', () => {
        if (details.open) shownContext.add(selectedId);
        else shownContext.delete(selectedId);
      });
      messages.append(details);
    }
    messages.append(...entries.filter((entry) => !entry.inherited).map(renderMessage));
    if (requests.has(state.branchId)) {
      const pending = el('div', 'pending');
      pending.setAttribute('role', 'status');
      pending.append(el('span', 'pending-dot'), el('span', '', 'ThreadMap está pensando…'));
      messages.append(pending);
    }
  }
  addHighlights(thread);
  updateError();
  updateComposer();
}

function renderMap(reveal = false) {
  const thread = currentThread();
  const path = lineage(thread, state.branchId).map(({ id }) => id);
  const count = thread.branches[thread.rootId].messages.length ? Object.keys(thread.branches).length : 0;
  byId('map-count').textContent = `${count} ${count === 1 ? 'nodo' : 'nodos'}`;
  byId('map-empty').hidden = count > 0;
  byId('map-stage').classList.toggle('has-graph', count > 0);
  byId('zoom-out').disabled = count === 0;
  byId('zoom-in').disabled = count === 0;
  byId('zoom-fit').disabled = count === 0;
  if (reveal) graph.reveal(path);
  graph.render(thread, state.branchId, new Set(path));
}

function navigate(threadId, branchId, { end = false, fit = false } = {}) {
  const changedThread = threadId !== state.threadId;
  state.threadId = threadId;
  state.branchId = branchId;
  renderHistory();
  renderHeader();
  renderChat();
  renderMap(true);
  if (changedThread || fit) graph.fit();
  chatScroll.scrollTop = end ? chatScroll.scrollHeight : 0;
  save();
}

function autoSize() {
  prompt.style.height = 'auto';
  prompt.style.height = `${prompt.scrollHeight}px`;
}

function updateComposer() {
  const { text, source } = draft();
  if (prompt.value !== text) prompt.value = text;
  autoSize();
  byId('send').disabled = !text.trim() || requests.has(state.branchId);
  byId('composer-quote').hidden = !source;
  if (source) {
    const excerpt = byId('composer-excerpt');
    excerpt.textContent = source.excerpt || source.content;
    excerpt.title = excerpt.textContent;
  }
}

function updateError() {
  const branch = currentBranch();
  const waiting = branch.messages.at(-1)?.role === 'user' && !requests.has(branch.id);
  const issue = errors.get(branch.id);
  byId('chat-error').hidden = !waiting;
  if (!waiting) return;
  const hasKey = canReply();
  byId('error-text').textContent = issue || (hasKey
    ? 'La pregunta está pendiente de respuesta.'
    : `Conecta ${providerNames[connection.provider]} para responder a esta pregunta.`);
  byId('error-action').textContent = hasKey ? 'Reintentar' : 'Configurar API';
  byId('error-action').onclick = () => hasKey ? reply(currentThread(), currentBranch()) : openSettings();
}

async function reply(thread, branch) {
  if (requests.has(branch.id) || branch.messages.at(-1)?.role !== 'user') return;
  const activeConnection = connection;
  if (!canReply(activeConnection)) {
    errors.delete(branch.id);
    updateError();
    return;
  }
  const { provider, mode, key } = activeConnection;
  const headers = { 'Content-Type': 'application/json' };
  if (mode === 'personal') headers.Authorization = `Bearer ${key}`;
  requests.add(branch.id);
  errors.delete(branch.id);
  if (state.branchId === branch.id) {
    renderChat();
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider, mode, messages: modelInput(thread, branch.id) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const answer = message('assistant', data.answer);
    if (data.incomplete) answer.incomplete = true;
    branch.messages.push(answer);
    save();
  } catch (error) {
    if (activeConnection === connection) {
      errors.set(branch.id, error instanceof TypeError ? 'No se pudo conectar con el servidor de ThreadMap.' : error.message);
    }
  } finally {
    requests.delete(branch.id);
    if (state.branchId === branch.id) {
      const atBottom = chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 130;
      renderChat();
      if (atBottom) chatScroll.scrollTop = chatScroll.scrollHeight;
    }
  }
}

function sendQuestion(event) {
  event.preventDefault();
  const { text, source } = draft();
  const question = text.trim();
  if (!question || requests.has(state.branchId)) return;
  const thread = currentThread();
  let branch = currentBranch();
  drafts.delete(branch.id);
  if (source) {
    branch = createBranch(thread, source.branchId, source.messageId, source.excerpt, question, source.excerptRange);
    flashId = branch.messages[0].id;
    setTimeout(() => { flashId = null; }, 750);
  } else {
    if (branch.id === thread.rootId && !branch.messages.length) {
      thread.title = question.length > 58 ? `${question.slice(0, 55)}…` : question;
    }
    branch.messages.push(message('user', question));
  }
  thread.updatedAt = new Date().toISOString();
  navigate(thread.id, branch.id, { end: true, fit: Boolean(source) });
  reply(thread, branch);
  prompt.focus({ preventScroll: true });
}

function dismissSelection() {
  activeSelection = null;
  ask.hidden = true;
}

function locateSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return dismissSelection();
  const range = selection.getRangeAt(0);
  const getAnswer = (node) => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('.response-text');
  const answer = getAnswer(range.startContainer);
  const excerpt = selection.toString().trim();
  if (!excerpt || !answer || answer !== getAnswer(range.endContainer) || !messages.contains(answer)) return dismissSelection();
  const id = answer.closest('.message').id.slice(8);
  const entry = contextFor(currentThread(), state.branchId).find((item) => item.id === id);
  const box = range.getBoundingClientRect();
  if (!entry || !box.width) return dismissSelection();
  const prefix = document.createRange();
  prefix.selectNodeContents(answer);
  prefix.setEnd(range.startContainer, range.startOffset);
  const raw = range.toString();
  const offset = prefix.toString().length;
  activeSelection = {
    entry,
    excerpt,
    excerptRange: {
      start: offset + raw.length - raw.trimStart().length,
      end: offset + raw.trimEnd().length,
    },
  };
  ask.hidden = false;
  const left = Math.max(8, Math.min(innerWidth - ask.offsetWidth - 8, box.left + box.width / 2 - ask.offsetWidth / 2));
  ask.style.left = `${left}px`;
  ask.style.top = `${box.top > 58 ? box.top - 43 : Math.min(innerHeight - 44, box.bottom + 7)}px`;
}

function updateSettingsFields() {
  const provider = settingsForm.elements.provider.value;
  const isPersonal = settingsForm.elements.mode.value === 'personal';
  const config = providerConfig[provider];
  const isGemini = provider === 'gemini';
  byId('personal-fields').hidden = !isPersonal;
  personalInput.required = isPersonal;
  personalInput.placeholder = isGemini ? 'Pega tu clave de Google AI Studio' : 'sk-…';
  byId('personal-key-label').textContent = isGemini ? 'Clave API de Google AI Studio' : 'Clave API de OpenAI';
  byId('platform-note').textContent = config?.platformAvailable
    ? `Usa la clave de ${providerNames[provider]} configurada por el equipo.`
    : 'Pendiente de configuración en el servidor.';
  byId('personal-note').textContent = isGemini
    ? 'Usa la cuota del proyecto asociado a tu clave de Google AI Studio.'
    : 'El uso se carga a tu cuenta de OpenAI.';
  byId('model-label').textContent = config?.model || providerNames[provider];
}

function setKeyVisibility(visible) {
  personalInput.type = visible ? 'text' : 'password';
  const button = byId('reveal-key');
  setIcon(button, visible ? 'eye-off' : 'eye');
  button.title = visible ? 'Ocultar clave' : 'Mostrar clave';
  button.setAttribute('aria-label', button.title);
}

function openSettings() {
  const { provider, mode, key } = connection;
  settingsForm.elements.provider.value = provider;
  settingsForm.elements.mode.value = providerConfig[provider]?.platformAvailable ? mode : 'personal';
  personalInput.value = key;
  setKeyVisibility(false);
  byId('settings-error').hidden = true;
  updateSettingsFields();
  if (!settings.open) settings.showModal();
}

function applyTheme() {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  setIcon(byId('theme-control').firstElementChild, dark ? 'sun' : 'moon');
  byId('theme-label').textContent = dark ? 'Modo claro' : 'Modo oscuro';
  renderMap();
}

function updatePanels() {
  workspace.classList.toggle('map-hidden', !mapVisible);
  workspace.classList.toggle('sidebar-hidden', !sidebarVisible);
  workspace.classList.toggle('map-expanded', mapVisible && expanded);
  byId('map-panel').inert = !mapVisible;
  byId('sidebar').inert = !sidebarVisible;
  const overlayOpen = sidebarVisible && narrowSidebar.matches || mapVisible && narrowMap.matches;
  byId('scrim').hidden = !overlayOpen;
  document.querySelector('.chat').inert = overlayOpen;
  byId('map-open').setAttribute('aria-expanded', String(mapVisible));
  byId('sidebar-open').setAttribute('aria-expanded', String(sidebarVisible));
  byId('map-expand').setAttribute('aria-pressed', String(expanded));
  setIcon(byId('map-expand'), expanded ? 'minimize' : 'maximize');
  byId('map-expand').title = expanded ? 'Restaurar ancho del mapa' : 'Expandir mapa';
  byId('map-expand').setAttribute('aria-label', byId('map-expand').title);
}

function showMap(visible, wide = expanded) {
  mapVisible = visible;
  expanded = wide;
  if (visible && narrowSidebar.matches) sidebarVisible = false;
  updatePanels();
  if (visible) requestAnimationFrame(graph.fit);
}

function showSidebar(visible) {
  sidebarVisible = visible;
  if (visible && narrowMap.matches) mapVisible = false;
  updatePanels();
}

function resizeMap(width) {
  mapWidth = Math.round(Math.max(320, Math.min(innerWidth * .55, width)));
  workspace.style.setProperty('--map-width', `${mapWidth}px`);
  byId('map-resize').setAttribute('aria-valuenow', mapWidth);
}

byId('composer').addEventListener('submit', sendQuestion);
prompt.addEventListener('input', () => { draft().text = prompt.value; updateComposer(); });
prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !byId('send').disabled) {
    event.preventDefault();
    byId('composer').requestSubmit();
  }
});
byId('quote-remove').onclick = () => { draft().source = null; updateComposer(); prompt.focus(); };
byId('new-chat').onclick = () => {
  const unused = state.threads.find((thread) => !thread.branches[thread.rootId].messages.length && !drafts.get(thread.rootId)?.text);
  const thread = unused || createThread();
  if (!unused) state.threads.unshift(thread);
  navigate(thread.id, thread.rootId);
  if (narrowSidebar.matches) showSidebar(false);
  prompt.focus();
};
byId('search-toggle').onclick = () => {
  search.hidden = !search.hidden;
  byId('search-toggle').setAttribute('aria-expanded', String(!search.hidden));
  if (search.hidden) { search.value = ''; renderHistory(); }
  else search.focus();
};
search.addEventListener('input', renderHistory);
byId('theme-control').onclick = () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  writePreference('threadmap.theme', theme);
  applyTheme();
};
byId('settings-open').onclick = openSettings;
byId('connection').onclick = openSettings;
byId('settings-close').onclick = () => settings.close();
settings.addEventListener('close', () => { personalInput.value = ''; setKeyVisibility(false); });
settingsForm.addEventListener('change', (event) => {
  if (event.target.name === 'provider') {
    personalInput.value = event.target.value === connection.provider ? connection.key : '';
    setKeyVisibility(false);
  }
  byId('settings-error').hidden = true;
  updateSettingsFields();
});
byId('reveal-key').onclick = () => setKeyVisibility(personalInput.type === 'password');
settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const provider = settingsForm.elements.provider.value;
  const mode = settingsForm.elements.mode.value;
  const key = personalInput.value.trim();
  const validKey = provider === 'gemini'
    ? /^[\x21-\x7e]{1,512}$/.test(key) && !key.startsWith('sk-')
    : /^sk-[\x21-\x7e]{8,509}$/.test(key);
  if (mode === 'personal' && !validKey) {
    byId('settings-error').textContent = provider === 'gemini'
      ? 'Introduce una clave de Gemini de Google AI Studio.'
      : 'Introduce una clave de OpenAI que empiece con sk-.';
    byId('settings-error').hidden = false;
    personalInput.focus();
    return;
  }
  connection = { provider, mode, key: mode === 'personal' ? key : '' };
  writePreference('threadmap.provider', provider);
  writePreference('threadmap.connection', mode);
  errors.clear();
  settings.close();
  renderConnection();
  updateError();
  notify('Conexión guardada');
});

document.addEventListener('selectionchange', locateSelection);
chatScroll.addEventListener('scroll', dismissSelection, { passive: true });
ask.addEventListener('pointerdown', (event) => event.preventDefault());
ask.onclick = () => {
  if (activeSelection) selectReference(activeSelection.entry, activeSelection.excerpt, activeSelection.excerptRange);
};
byId('map-open').onclick = () => { showMap(true, false); byId('map-close').focus(); };
byId('map-close').onclick = () => {
  showMap(false, false);
  byId('map-open').focus();
};
byId('composer-map').onclick = () => {
  showMap(!mapVisible, false);
  if (mapVisible && narrowMap.matches) byId('map-close').focus();
};
byId('map-expand').onclick = () => showMap(true, !expanded);
byId('sidebar-open').onclick = () => { showSidebar(true); byId('sidebar-close').focus(); };
byId('sidebar-close').onclick = () => {
  showSidebar(false);
  byId('sidebar-open').focus();
};
function closeOverlay() {
  if (mapVisible && narrowMap.matches) {
    showMap(false, false);
    byId('map-open').focus();
  } else if (sidebarVisible && narrowSidebar.matches) {
    showSidebar(false);
    byId('sidebar-open').focus();
  }
}
byId('scrim').onclick = closeOverlay;
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !settings.open) closeOverlay();
});
byId('zoom-in').onclick = () => graph.zoomBy(1.2);
byId('zoom-out').onclick = () => graph.zoomBy(1 / 1.2);
byId('zoom-fit').onclick = graph.fit;
narrowMap.addEventListener('change', () => showMap(!narrowMap.matches, false));
narrowSidebar.addEventListener('change', () => showSidebar(!narrowSidebar.matches));
const separator = byId('map-resize');
separator.addEventListener('pointerdown', (event) => {
  separator.setPointerCapture(event.pointerId);
  workspace.classList.add('resizing');
});
separator.addEventListener('pointermove', (event) => {
  if (separator.hasPointerCapture(event.pointerId)) resizeMap(innerWidth - event.clientX);
});
separator.addEventListener('lostpointercapture', () => workspace.classList.remove('resizing'));
separator.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  resizeMap((mapWidth || byId('map-panel').offsetWidth) + (event.key === 'ArrowLeft' ? 24 : -24));
});

applyTheme();
updatePanels();
navigate(state.threadId, state.branchId);
renderConnection();
fetch('/api/config')
  .then(async (response) => {
    if (!response.ok) return;
    const { providers, platformAvailable, model } = await response.json();
    providerConfig = providers ?? { openai: { platformAvailable, model } };
  })
  .catch(() => {})
  .finally(() => {
    renderConnection();
    updateError();
    if (settings.open) updateSettingsFields();
  });
