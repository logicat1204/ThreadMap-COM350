import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createThreadMapServer as createServer } from '../server.js';
import { branchPreview, contextFor, createBranch, createThread, message, modelInput, persistentWorkspace, rankChildren } from '../public/threads.js';

// Provider unit tests use an authenticated session; real cookies are covered in accounts.test.js.
function createThreadMapServer(options = {}) {
  let used = 0;
  return createServer({ accounts: {
    getSession: async () => ({ user: { id: 'provider-test' } }),
    getUsage: () => ({ limit: 5, used, remaining: 5 - used }),
    reserveMessage: () => used < 5 && ++used > 0,
    refundMessage: () => { used--; },
  }, ...options });
}

test('a branch inherits up to its origin, even after later turns in other branches', () => {
  const thread = createThread();
  const root = thread.branches[thread.rootId];
  const first = message('user', 'Pregunta original');
  const anchor = message('assistant', 'Primera respuesta');
  root.messages.push(first, anchor);
  const child = createBranch(thread, root.id, anchor.id, 'respuesta', 'Pregunta derivada');
  const childAnswer = message('assistant', 'Respuesta de la rama');
  child.messages.push(childAnswer);
  const nested = createBranch(thread, child.id, childAnswer.id, null, 'Pregunta anidada');
  const sibling = createBranch(thread, root.id, first.id, null, 'Pregunta hermana');
  root.messages.push(message('user', 'Continuación en la raíz'));
  child.messages.push(message('user', 'Continuación en la rama'));

  const restored = JSON.parse(JSON.stringify(thread));
  assert.deepEqual(contextFor(restored, nested.id).map(({ content }) => content), [
    'Pregunta original', 'Primera respuesta', 'Pregunta derivada', 'Respuesta de la rama', 'Pregunta anidada',
  ]);
  assert.deepEqual(contextFor(restored, sibling.id).map(({ content }) => content), ['Pregunta original', 'Pregunta hermana']);
  assert.equal(modelInput(restored, nested.id)[2].content, 'Fragmento de referencia:\n“respuesta”\n\nPregunta:\nPregunta derivada');
  assert.equal(contextFor(restored, root.id).length, 3);
  assert.throws(() => createBranch(thread, child.id, first.id, null, 'Origen inválido'));
});

test('collapsing a node hides its descendants and retains its siblings', () => {
  const thread = createThread();
  const root = thread.branches[thread.rootId];
  root.messages.push(message('user', 'Raíz'));
  const child = createBranch(thread, root.id, root.messages[0].id, null, 'Hija');
  const sister = createBranch(thread, root.id, root.messages[0].id, null, 'Hermana');
  const grandchild = createBranch(thread, child.id, child.messages[0].id, null, 'Nieta');
  const result = rankChildren(thread, new Set([child.id]));
  assert.equal(result.nodes.find(({ id }) => id === child.id).hasChildren, true);
  assert.equal(result.links.length, 2);
  assert.equal(result.nodes.some(({ id }) => id === sister.id), true);
  assert.equal(result.nodes.some(({ id }) => id === grandchild.id), false);
});

test('temporary conversations and their branches are excluded from the saved workspace', () => {
  const regular = createThread();
  regular.branches[regular.rootId].messages.push(message('user', 'Pregunta permanente'));
  const temporary = createThread();
  temporary.temporary = true;
  const first = message('user', 'Pregunta privada');
  temporary.branches[temporary.rootId].messages.push(first);
  const branch = createBranch(temporary, temporary.rootId, first.id, null, 'Rama privada');
  const saved = persistentWorkspace({
    threads: [regular, temporary],
    threadId: temporary.id,
    branchId: branch.id,
  });
  assert.deepEqual(saved, { threads: [regular], threadId: regular.id, branchId: regular.rootId });
  assert.doesNotMatch(JSON.stringify(saved), /privada/);
  assert.equal(temporary.branches[branch.id].messages[0].content, 'Rama privada');
});

test('a branch preview uses its exact source message and its own first answer', () => {
  const thread = createThread();
  const root = thread.branches[thread.rootId];
  root.messages.push(message('user', 'Pregunta original'));
  const source = message('assistant', 'Respuesta con un término de referencia');
  root.messages.push(source, message('assistant', 'Otra respuesta distinta'));
  const branch = createBranch(thread, root.id, source.id, 'término de referencia', '¿Qué significa?');
  branch.messages.push(message('assistant', 'Explicación propia de la rama'));
  branch.messages.push(message('user', 'Siguiente pregunta'), message('assistant', 'Siguiente respuesta'));

  assert.deepEqual(branchPreview(thread, branch.id), {
    question: '¿Qué significa?',
    excerpt: 'término de referencia',
    origin: { question: 'Pregunta original', role: 'assistant', content: source.content },
    answer: 'Explicación propia de la rama',
  });
  assert.equal(branchPreview(thread, root.id).origin, null);
});

test('empty conversations stay out of persistence until their first message', () => {
  const blank = createThread();
  assert.deepEqual(persistentWorkspace({ threads: [blank], threadId: blank.id, branchId: blank.rootId }), {
    threads: [], threadId: null, branchId: null,
  });
  blank.branches[blank.rootId].messages.push(message('user', 'Mi primera pregunta'));
  assert.equal(persistentWorkspace({ threads: [blank], threadId: blank.id, branchId: blank.rootId }).threads.length, 1);
});

async function callRoute(server, { method = 'POST', path = '/api/chat', body, authorization, origin } = {}) {
  const request = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  request.method = method;
  request.url = path;
  request.headers = { host: '127.0.0.1:3000', 'content-type': 'application/json', authorization, origin };
  const response = new EventEmitter();
  response.writeHead = (status, headers) => Object.assign(response, { status, headers });
  response.end = (content) => { response.data = JSON.parse(content); };
  await server.listeners('request')[0](request, response);
  return { status: response.status, data: response.data };
}

const messages = [{ role: 'user', content: 'Una pregunta' }];

test('platform and personal credentials reach OpenAI only in their own modes', async () => {
  const requests = [];
  const server = createThreadMapServer({
    platformKey: 'fixture-platform',
    model: 'gpt-5-mini',
    geminiPlatformKey: '',
    geminiModel: 'gemini-3.5-flash-lite',
    fetchProvider: async (url, options) => {
      requests.push({ url, authorization: options.headers.Authorization, input: JSON.parse(options.body) });
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Una respuesta' }] }] });
    },
  });
  const config = await callRoute(server, { method: 'GET', path: '/api/config' });
  assert.deepEqual(config, {
    status: 200,
    data: {
      platformAvailable: true,
      model: 'gpt-5-mini',
      providers: {
        openai: { platformAvailable: true, model: 'gpt-5-mini' },
        gemini: { platformAvailable: false, model: 'gemini-3.5-flash-lite' },
      },
    },
  });
  const authorization = 'Bearer fixture-personal';
  const platform = await callRoute(server, { authorization, body: { mode: 'platform', messages } });
  const personal = await callRoute(server, { authorization, body: { mode: 'personal', messages } });
  assert.deepEqual(platform, personal);
  assert.deepEqual(personal, { status: 200, data: { answer: 'Una respuesta', incomplete: false, usage: { limit: 5, used: 1, remaining: 4 } } });
  assert.deepEqual(requests.map((request) => request.authorization), ['Bearer fixture-platform', authorization]);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(requests[0].input.instructions, 'responde de forma directa, breve y muy tecnica.');
  assert.equal(requests[0].input.store, false);
  assert.deepEqual(requests[0].input.input, messages);
});

test('a missing credential never falls back to the other connection mode', async () => {
  const rejectCall = () => assert.fail('OpenAI should not receive this request');
  const noPlatformKey = createThreadMapServer({ platformKey: '', fetchProvider: rejectCall });
  const withPlatformKey = createThreadMapServer({ platformKey: 'fixture-platform', fetchProvider: rejectCall });
  const platform = await callRoute(noPlatformKey, { authorization: 'Bearer fixture-personal', body: { mode: 'platform', messages } });
  const personal = await callRoute(withPlatformKey, { body: { mode: 'personal', messages } });
  assert.equal(platform.status, 401);
  assert.equal(personal.status, 401);
  assert.equal((await callRoute(withPlatformKey, {
    origin: 'https://example.com',
    body: { mode: 'platform', messages },
  })).status, 403);
});

test('Gemini receives the selected key and ordered branch history in its native format', async () => {
  const requests = [];
  const server = createThreadMapServer({
    platformKey: 'fixture-openai-platform',
    geminiPlatformKey: 'fixture-gemini-platform',
    geminiModel: 'models/gemini-3.5-flash-lite',
    fetchProvider: async (url, options) => {
      requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return Response.json({
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [
          { text: 'Razonamiento interno', thought: true },
          { text: 'Respuesta' },
          { text: ' de Gemini.' },
        ] } }],
      });
    },
  });
  const history = [
    { role: 'user', content: 'Pregunta original' },
    { role: 'assistant', content: 'Respuesta anterior' },
    { role: 'user', content: 'Fragmento de referencia:\n“anterior”\n\nPregunta:\n¿Puedes ampliarlo?' },
    { role: 'user', content: 'Dame un ejemplo.' },
  ];
  const authorization = 'Bearer fixture-gemini-personal';
  for (const mode of ['platform', 'personal']) {
    const result = await callRoute(server, { authorization, body: { provider: 'gemini', mode, messages: history } });
    assert.deepEqual(result, { status: 200, data: { answer: 'Respuesta de Gemini.', incomplete: true, usage: { limit: 5, used: 1, remaining: 4 } } });
  }
  assert.deepEqual(requests.map((request) => request.headers['x-goog-api-key']), ['fixture-gemini-platform', 'fixture-gemini-personal']);
  for (const request of requests) {
    assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    assert.equal(request.headers.Authorization, undefined);
    assert.deepEqual(request.body.contents, [
      { role: 'user', parts: [{ text: history[0].content }] },
      { role: 'model', parts: [{ text: history[1].content }] },
      { role: 'user', parts: [{ text: history[2].content }, { text: history[3].content }] },
    ]);
    assert.equal(request.body.systemInstruction.parts[0].text, 'responde de forma directa, breve y muy tecnica.');
  }
  const { data } = await callRoute(server, { method: 'GET', path: '/api/config' });
  assert.deepEqual(data.providers.gemini, { platformAvailable: true, model: 'gemini-3.5-flash-lite' });
  assert.doesNotMatch(JSON.stringify(data), /fixture/);
});

test('an unavailable Gemini key never falls back to the OpenAI platform key', async () => {
  let called = false;
  const server = createThreadMapServer({
    platformKey: 'fixture-openai-platform',
    geminiPlatformKey: '',
    fetchProvider: () => { called = true; },
  });
  const missing = await callRoute(server, { body: { provider: 'gemini', mode: 'platform', messages } });
  assert.equal(missing.status, 401);
  assert.match(missing.data.error, /Gemini/);
  const invalid = await callRoute(server, { body: { provider: '__proto__', mode: 'platform', messages } });
  assert.equal(invalid.status, 400);
  assert.equal(called, false);
});

test('Gemini key errors and blocked prompts receive messages without upstream details', async () => {
  const responses = [
    Response.json({ error: { message: 'fixture-private-body', details: [{ reason: 'API_KEY_INVALID' }] } }, { status: 400 }),
    Response.json({ promptFeedback: { blockReason: 'SAFETY' } }),
  ];
  const server = createThreadMapServer({ geminiPlatformKey: 'fixture-platform', fetchProvider: async () => responses.shift() });
  const request = { body: { provider: 'gemini', mode: 'platform', messages } };
  const invalid = await callRoute(server, request);
  assert.equal(invalid.status, 502);
  assert.match(invalid.data.error, /Gemini rechazó la clave/);
  assert.doesNotMatch(invalid.data.error, /fixture/);
  const blocked = await callRoute(server, request);
  assert.equal(blocked.status, 422);
  assert.match(blocked.data.error, /bloqueó esta solicitud/);
});

test('provider errors return a retryable message without reflecting the upstream body', async () => {
  const server = createThreadMapServer({
    platformKey: 'fixture-platform',
    fetchProvider: async () => new Response('fixture-private-provider-body', { status: 429 }),
  });
  const result = await callRoute(server, { body: { mode: 'platform', messages } });
  assert.equal(result.status, 429);
  assert.match(result.data.error, /límite de uso/);
  assert.doesNotMatch(result.data.error, /fixture/);
});
