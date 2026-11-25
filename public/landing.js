import { renderBranchPreview, responseText, setIcon } from './view.js';
import { toggleTheme } from './appearance.js';

document.querySelectorAll('[data-icon]').forEach((element) => setIcon(element, element.dataset.icon));

const themeButton = document.querySelector('#site-theme');
function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const label = dark ? 'Modo claro' : 'Modo oscuro';
  setIcon(themeButton, dark ? 'sun' : 'moon');
  themeButton.setAttribute('aria-label', label);
  themeButton.title = label;
}

themeButton.addEventListener('click', () => {
  toggleTheme();
  updateThemeButton();
});
updateThemeButton();
themeButton.hidden = false;

const branches = {
  https: {
    question: '¿Cómo funciona HTTPS?',
    answer: [
      '**HTTPS** protege la comunicación entre tu navegador y un servidor mediante TLS.',
      '',
      '1. El navegador verifica el certificado digital del sitio.',
      '2. El navegador y el servidor acuerdan claves de sesión.',
      '3. La conexión cifra los datos que ambos intercambian.',
    ].join('\n'),
  },
  certificate: {
    parent: 'https',
    question: '¿Qué pasa si el certificado caduca?',
    excerpt: 'certificado digital',
    answer: 'El navegador comprueba la fecha de validez del certificado. Si ya caducó, **muestra una advertencia de seguridad** y puede bloquear el acceso al sitio.',
  },
  tls: {
    parent: 'https',
    question: '¿Qué es TLS?',
    excerpt: 'mediante TLS',
    answer: 'TLS protege la conexión. Autentica al servidor y permite acordar claves para cifrar los datos que se intercambian.',
  },
  encryption: {
    parent: 'tls',
    question: '¿Qué datos se cifran?',
    excerpt: 'los datos que se intercambian',
    answer: 'TLS cifra el contenido de la solicitud y la respuesta HTTP, como la ruta, las cabeceras y el cuerpo.',
  },
};

function showExample(container, id) {
  const { question, excerpt, answer, parent } = branches[id];
  const origin = parent ? { question: branches[parent].question, role: 'assistant', content: branches[parent].answer } : null;
  renderBranchPreview(container, { question, excerpt, answer, origin });
}

const tour = document.querySelector('.tour');
const board = tour.querySelector('.tour-board');
const preview = board.querySelector('.demo-screen');
const steps = [...tour.querySelectorAll('.tour-step')];
const motion = matchMedia('(min-width: 981px) and (min-height: 650px) and (prefers-reduced-motion: no-preference)');

showExample(preview.querySelector('.demo-node-preview'), 'certificate');
for (const step of steps) {
  const scene = preview.cloneNode(true);
  scene.dataset.scene = step.dataset.scene;
  scene.classList.add('demo-closeup');
  scene.querySelector('.demo-sidebar').remove();
  scene.querySelector('.demo-window-tools').remove();
  if (step.dataset.scene === 'chat' || step.dataset.scene === 'selection') {
    scene.querySelector('.demo-map').remove();
    scene.querySelector('.demo-turn-branch').remove();
    if (step.dataset.scene === 'selection') {
      scene.querySelector('.demo-answer > p').remove();
      scene.querySelectorAll('.demo-answer li:not(:first-child)').forEach((item) => item.remove());
      scene.querySelector('.demo-question').remove();
    }
  } else {
    scene.querySelector('.demo-chat').remove();
    scene.querySelector('.demo-map-footer').remove();
    if (step.dataset.scene === 'branch') {
      scene.querySelector('.demo-node-preview').remove();
    } else {
      scene.querySelector('.demo-graph').remove();
      // The static preview can expand its source answer, just like the explorer.
      scene.removeAttribute('inert');
      scene.removeAttribute('aria-hidden');
    }
  }
  step.append(scene);
}

let pendingFrame = null;
function updateTour() {
  pendingFrame = null;
  const { top, height } = board.getBoundingClientRect();
  const focusLine = top + height / 2;
  const step = steps.findLast((element) => element.querySelector('h2').getBoundingClientRect().top <= focusLine) ?? steps[0];
  if (preview.dataset.scene !== step.dataset.scene) preview.dataset.scene = step.dataset.scene;
}

function scheduleTourUpdate() {
  if (pendingFrame === null) pendingFrame = requestAnimationFrame(updateTour);
}

function measureBoard() {
  tour.style.setProperty('--tour-board-height', `${board.getBoundingClientRect().height}px`);
}

const boardObserver = new ResizeObserver(() => {
  measureBoard();
  scheduleTourUpdate();
});

function setTourLayout() {
  tour.toggleAttribute('data-motion', motion.matches);
  if (motion.matches) {
    measureBoard();
    updateTour();
    boardObserver.observe(board);
    window.addEventListener('scroll', scheduleTourUpdate, { passive: true });
    window.addEventListener('resize', scheduleTourUpdate);
  } else {
    boardObserver.disconnect();
    tour.style.removeProperty('--tour-board-height');
    window.removeEventListener('scroll', scheduleTourUpdate);
    window.removeEventListener('resize', scheduleTourUpdate);
    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
    preview.dataset.scene = 'chat';
  }
}

motion.addEventListener('change', setTourLayout);
setTourLayout();

const nodes = [...document.querySelectorAll('.explorer-node')];
const explorer = document.querySelector('#explorer-detail');
showExample(explorer, 'https');

for (const node of nodes) {
  const open = () => {
    if (node.getAttribute('aria-pressed') === 'true') return;
    for (const item of nodes) item.setAttribute('aria-pressed', String(item === node));
    showExample(explorer, node.dataset.branch);
  };
  node.addEventListener('click', open);
  node.addEventListener('focus', () => {
    if (node.matches(':focus-visible')) open();
  });
  node.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse') open();
  });
}

const sample = [
  '$F = m \\cdot a$',
  '',
  '~~~javascript',
  'const fuerza = masa * aceleracion;',
  '~~~',
].join('\n');
document.querySelector('[data-rich-example]').replaceChildren(responseText(sample));
