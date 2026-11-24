import assert from 'node:assert/strict';
import test from 'node:test';
import { createBranch, createThread, message } from '../public/threads.js';
import { searchConversations, searchExcerpt } from '../public/search.js';

test('finds answer text in its exact nested branch without duplicating inherited matches', () => {
  const thread = createThread();
  thread.title = 'Redes de computadoras';
  const root = thread.branches[thread.rootId];
  root.messages.push(message('assistant', 'Los routers envían paquetes.'));
  const child = createBranch(thread, root.id, root.messages[0].id, null, '¿Qué es TCP?');
  child.messages.push(message('assistant', 'Una confirmación recupera los bytes perdidos.'));
  const nested = createBranch(thread, child.id, child.messages[1].id, null, 'Explícame los detalles');
  nested.messages.push(message('assistant', 'El receptor numera cada confirmación.'));
  const result = searchConversations([thread], 'NUMERA confirmacion');
  assert.equal(result.length, 1);
  assert.equal(result[0].threadId, thread.id);
  assert.equal(result[0].branchId, nested.id);
  assert.equal(result[0].messageId, nested.messages[1].id);
  assert.deepEqual(result[0].path, ['Principal', '¿Qué es TCP?', 'Explícame los detalles']);
  assert.deepEqual(searchConversations([thread], 'routers').map((entry) => entry.branchId), [root.id]);
});

test('search is accent-insensitive and highlights original characters without rendering HTML', () => {
  const text = '🧭 ¿Cómo funciona la confirmación? <script>texto</script>';
  const parts = searchExcerpt(text, 'como CONFIRMACION');
  assert.deepEqual(parts.filter((part) => part.match).map((part) => part.text), ['Cómo', 'confirmación']);
  assert.equal(parts.map((part) => part.text).join(''), text);
  assert.equal(searchExcerpt('¿Cómo funciona?', 'como').filter((part) => part.match)[0].text, 'Cómo');
});

test('search excludes temporary chats and returns recent roots for an empty query', () => {
  const old = createThread();
  old.title = 'Primera idea'; old.updatedAt = '2025-01-01T00:00:00.000Z';
  const recent = createThread();
  recent.title = 'Segunda idea'; recent.updatedAt = '2026-01-01T00:00:00.000Z';
  const temporary = createThread();
  temporary.title = 'Idea temporal'; temporary.temporary = true;
  assert.deepEqual(searchConversations([old, temporary, recent], '').map((entry) => entry.threadId), [recent.id, old.id]);
  assert.equal(searchConversations([old, temporary, recent], 'temporal').length, 0);
  assert.equal(searchConversations([recent], 'segunda').length, 1);
  assert.equal(searchConversations([recent], 'inexistente').length, 0);
});

test('snippets center on a distant match and merge overlapping highlights', () => {
  const parts = searchExcerpt(`${'inicio '.repeat(50)}recuperación final`, 'recupera recuperacion', 90);
  assert.equal(parts[0].text, '…');
  assert.deepEqual(parts.filter((part) => part.match).map((part) => part.text), ['recuperación']);
});
