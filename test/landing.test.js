import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('static tour and node previews stay usable when motion preferences change', async (t) => {
  const html = await readFile(new URL('../public/landing.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  const media = new window.EventTarget();
  media.matches = false;
  let observing = false;
  Object.assign(globalThis, {
    window, document,
    localStorage: window.localStorage,
    matchMedia: () => media,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    ResizeObserver: class {
      observe() { observing = true; }
      disconnect() { observing = false; }
    },
  });
  t.after(() => window.close());
  await import('../public/landing.js');

  await t.test('reduced motion keeps all four closeups and an expandable source', () => {
    const tour = document.querySelector('.tour');
    const scenes = [...document.querySelectorAll('.tour-step .demo-closeup')];
    assert.equal(tour.hasAttribute('data-motion'), false);
    assert.equal(scenes.length, 4);
    assert.ok(scenes[0].querySelector('.demo-turn-root'));
    assert.equal(scenes[0].querySelector('.demo-map'), null);
    assert.ok(scenes[1].querySelector('.demo-selection'));
    assert.equal(scenes[2].querySelector('.demo-chat'), null);
    assert.ok(scenes[2].querySelector('.demo-node-certificate'));
    assert.equal(scenes[3].querySelector('.demo-graph'), null);
    assert.equal(scenes[3].hasAttribute('inert'), false);
    assert.equal(scenes[3].hasAttribute('aria-hidden'), false);
    scenes[3].querySelector('summary').click();
    assert.equal(scenes[3].querySelector('details').open, true);

    media.matches = true;
    media.dispatchEvent(new window.Event('change'));
    assert.equal(tour.hasAttribute('data-motion'), true);
    assert.equal(observing, true);
    window.dispatchEvent(new window.Event('scroll'));
    media.matches = false;
    media.dispatchEvent(new window.Event('change'));
    assert.equal(tour.hasAttribute('data-motion'), false);
    assert.equal(observing, false);
    assert.equal(tour.style.getPropertyValue('--tour-board-height'), '');
    assert.equal(document.querySelector('.tour-board .demo-screen').dataset.scene, 'chat');
    assert.equal(document.querySelectorAll('.demo-closeup').length, 4);
  });

  await t.test('selecting nodes preserves their own source and expanded answer', () => {
    const detail = document.querySelector('#explorer-detail');
    const certificate = document.querySelector('[data-branch="certificate"]');
    certificate.click();
    assert.equal(document.querySelectorAll('.explorer-node[aria-pressed="true"]').length, 1);
    assert.equal(certificate.getAttribute('aria-pressed'), 'true');
    assert.equal(detail.querySelector('blockquote').textContent, 'certificado digital');
    detail.querySelector('summary').click();
    assert.equal(detail.querySelector('details').open, true);
    certificate.click();
    assert.equal(detail.querySelector('details').open, true, 'reselecting must not collapse the source');
    document.querySelector('[data-branch="encryption"]').click();
    assert.equal(detail.querySelector('h3').textContent, '¿Qué datos se cifran?');
    assert.match(detail.querySelector('details').textContent, /TLS protege la conexión/);
    document.querySelector('[data-branch="https"]').click();
    assert.equal(detail.querySelector('details'), null);
  });
});
