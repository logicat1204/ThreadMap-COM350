import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { renderBranchPreview, responseText, revealResponse } from '../public/view.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.document = dom.window.document;
globalThis.NodeFilter = dom.window.NodeFilter;

test('quantum notation, inline math and multiline display math render without changing code literals', () => {
  const source = String.raw`- **Superposición:** Un cúbit $|0\rangle$ y $|1\rangle$, $|\psi\rangle = \alpha|0\rangle + \beta|1\rangle$, $|\alpha|^2 + |\beta|^2 = 1$.

$$
\frac{a_1}{b_2} + x^{2}
$$

\[
\int_0^1 x\,dx = \frac12
\]

También \(x_i * y_j\) y ` + '`$raw_math$`.';
  const result = responseText(source);
  assert.equal(result.querySelectorAll('.katex').length, 7);
  assert.equal(result.querySelectorAll('.math-display').length, 2);
  assert.equal(result.querySelector('strong').textContent, 'Superposición:');
  assert.equal(result.querySelector('code').textContent, '$raw_math$');
  assert.equal(result.querySelectorAll('.katex-error').length, 0);
});

test('code is highlighted and copied in full without executing model HTML or interpreting its math', async () => {
  let copied;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (text) => { copied = text; } } } });
  const code = 'const html = "<img src=x onerror=alert(1)>";\nconsole.log("$x_i$", html);';
  const result = responseText('```javascript\n' + code + '\n```\n\n<img src=x onerror=alert(1)>');
  assert.ok(result.querySelector('.hljs-keyword'));
  assert.equal(result.querySelector('pre code').textContent, code);
  assert.equal(result.querySelector('img'), null);
  assert.equal(result.querySelector('.katex'), null);
  result.querySelector('.code-copy').click();
  await Promise.resolve();
  assert.equal(copied, code);
  assert.match(result.querySelector('.code-copy').textContent, /Copiado/);
});

test('untrusted math cannot create executable links or HTML', () => {
  const result = responseText(String.raw`$\href{javascript:alert(1)}{click}$ $\htmlClass{evil}{x}$`);
  assert.equal(result.querySelector('a, .evil, script'), null);
  assert.match(result.textContent, /click/);
});

test('rich responses keep their equations and code intact during reveal', () => {
  const result = responseText('Una fórmula $x^2$.\n\n```python\nprint(42)\n```');
  result.animate = () => {};
  const before = result.innerHTML;
  let finished = false;
  revealResponse(result, {}, () => { finished = true; });
  assert.ok(finished);
  assert.equal(result.innerHTML, before);
});

test('branch previews show the exact fragment, original reply and branch answer', () => {
  const popup = document.createElement('div');
  const title = renderBranchPreview(popup, {
    question: '¿Y si caduca?',
    excerpt: 'certificado digital',
    origin: { question: '¿Cómo funciona HTTPS?', role: 'assistant', content: 'El sitio presenta un **certificado digital**.' },
    answer: 'El navegador muestra una **advertencia**.',
  });
  assert.equal(popup.firstElementChild, title);
  assert.equal(title.textContent, '¿Y si caduca?');
  assert.deepEqual([...popup.querySelectorAll('h4')].map((heading) => heading.textContent), ['Fragmento marcado', 'Rama de origen', 'Respuesta']);
  assert.equal(popup.querySelector('blockquote').textContent, 'certificado digital');
  assert.equal(popup.querySelector('details summary').textContent, 'Ver respuesta de origen');
  assert.equal(popup.querySelector('details strong').textContent, 'certificado digital');
  assert.equal(popup.querySelector('.branch-preview-section:last-child strong').textContent, 'advertencia');

  renderBranchPreview(popup, { question: 'Conversación principal', answer: 'Respuesta inicial.' });
  assert.equal(popup.querySelector('blockquote, details'), null);
  assert.equal(popup.querySelector('h4').textContent, 'Respuesta');
});
