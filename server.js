import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createAccounts } from './accounts.js';
import { appOrigin, allowsHost, allowsOrigin, clientAddress } from './runtime.js';

const assets = {
  '/': ['landing.html', 'text/html; charset=utf-8'],
  '/app': ['index.html', 'text/html; charset=utf-8'],
  '/admin': ['admin.html', 'text/html; charset=utf-8'],
  '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
  '/admin.css': ['admin.css', 'text/css; charset=utf-8'],
  '/restablecer': ['reset.html', 'text/html; charset=utf-8'],
  '/reset.js': ['reset.js', 'text/javascript; charset=utf-8'],
  '/landing.css': ['landing.css', 'text/css; charset=utf-8'],
  '/landing.js': ['landing.js', 'text/javascript; charset=utf-8'],
  '/appearance.js': ['appearance.js', 'text/javascript; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/account.js': ['account.js', 'text/javascript; charset=utf-8'],
  '/search.js': ['search.js', 'text/javascript; charset=utf-8'],
  '/threads.js': ['threads.js', 'text/javascript; charset=utf-8'],
  '/view.js': ['view.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const instructions = 'responde de forma directa, breve y muy tecnica.';
const maxBytes = 1_000_000;
const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJSON(response, status, data) {
  response.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

async function readJSON(request, limit = maxBytes) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new RequestError(415, 'La solicitud debe usar JSON.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      request.resume();
      throw new RequestError(413, 'El historial excede el tamaño admitido.');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'La solicitud contiene JSON inválido.');
  }
}

function getInput(messages) {
  if (!Array.isArray(messages) || messages.at(-1)?.role !== 'user') {
    throw new RequestError(400, 'Envía una pregunta para continuar.');
  }
  return messages.map((message) => {
    if (!['user', 'assistant'].includes(message?.role) ||
        typeof message.content !== 'string' || !message.content.trim()) {
      throw new RequestError(400, 'El historial contiene un mensaje inválido.');
    }
    return { role: message.role, content: message.content };
  });
}

function requestFor(provider, model, apiKey, input) {
  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/responses',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: { model, input, store: false, max_output_tokens: 4096, instructions },
    };
  }

  const contents = [];
  for (const message of input) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const part = { text: message.content };
    const previous = contents.at(-1);
    if (previous?.role === role) previous.parts.push(part);
    else contents.push({ role, parts: [part] });
  }
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: { 'x-goog-api-key': apiKey },
    body: {
      contents,
      systemInstruction: { parts: [{ text: instructions }] },
      generationConfig: { maxOutputTokens: 4096 },
    },
  };
}

function readProviderAnswer(provider, result) {
  if (provider === 'gemini') {
    const candidate = result.candidates?.[0];
    const answer = candidate?.content?.parts?.filter((part) => !part.thought && typeof part.text === 'string')
      .map((part) => part.text).join('') ?? '';
    if (!answer.trim() && (result.promptFeedback?.blockReason || candidate?.finishReason === 'SAFETY')) {
      throw new RequestError(422, 'Gemini bloqueó esta solicitud. Prueba con una pregunta distinta.');
    }
    return { answer, incomplete: candidate?.finishReason === 'MAX_TOKENS' };
  }
  const segments = (result.output ?? []).filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .map((item) => item.type === 'output_text' ? item.text : item.type === 'refusal' ? item.refusal : '')
    .filter(Boolean);
  return { answer: segments.join('\n\n'), incomplete: result.status === 'incomplete' };
}

async function getProviderError(upstream, provider, name) {
  const status = upstream.status;
  let invalidKey = status === 401;
  if (provider === 'gemini' && status === 400) {
    const payload = await upstream.json().catch(() => null);
    const details = payload?.error?.details;
    invalidKey = Array.isArray(details) && details.some((entry) => entry?.reason === 'API_KEY_INVALID');
  } else {
    await upstream.body?.cancel().catch(() => {});
  }
  if (invalidKey) return `${name} rechazó la clave. Revisa la configuración de la API.`;
  if (status === 403 || status === 404) return `La clave no tiene acceso al modelo configurado de ${name}.`;
  if (status === 429) return `${name} alcanzó un límite de uso. Revisa la cuota o inténtalo más tarde.`;
  if (status === 400 || status === 413) return `${name} rechazó el historial o la configuración del modelo.`;
  return `${name} no pudo responder. Inténtalo de nuevo.`;
}

export function createThreadMapServer({
  platformKey = process.env.OPENAI_API_KEY?.trim(),
  model = process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini',
  geminiPlatformKey = process.env.GEMINI_API_KEY?.trim(),
  geminiModel = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
  fetchProvider = fetch,
  accounts,
  publicURL = process.env.APP_URL,
  trustProxy = process.env.TRUST_PROXY === 'loopback',
} = {}) {
  const origin = appOrigin(publicURL);
  const providers = {
    openai: { name: 'OpenAI', platformKey, model },
    gemini: { name: 'Gemini', platformKey: geminiPlatformKey, model: geminiModel.replace(/^models\//, '') },
  };
  const publicConfig = Object.fromEntries(Object.entries(providers).map(([id, config]) => [
    id, { platformAvailable: Boolean(config.platformKey), model: config.model },
  ]));
  let platformInFlight = 0;
  let accountPromise;
  const getAccounts = () => accountPromise ||= Promise.resolve(accounts || createAccounts());
  const server = createServer({ requestTimeout: 30_000 }, async (request, response) => {
    try {
      if (!allowsHost(request.headers.host, origin)) {
        throw new RequestError(403, 'Servidor no permitido.');
      }
      const url = new URL(request.url, 'http://localhost');
      const path = url.pathname;
      if (['GET', 'HEAD'].includes(request.method) && request.headers.cookie &&
          (path === '/' || (path === '/app' && url.searchParams.has('modo')))) {
        const session = await (await getAccounts()).getSession(request);
        if (session) {
          response.writeHead(302, { ...securityHeaders, Location: url.searchParams.get('next') === 'admin' ? '/admin' : '/app', Vary: 'Cookie' });
          return response.end();
        }
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        if (!allowsOrigin(request.headers.origin, request.headers.host, origin)) {
          throw new RequestError(403, 'Origen no permitido.');
        }
        if (request.headers['sec-fetch-site'] === 'cross-site') throw new RequestError(403, 'Origen no permitido.');
      }
      if (path.startsWith('/api/auth/')) {
        if (path === '/api/auth/request-password-reset') throw new RequestError(403, 'Solicita un enlace de recuperación al administrador de la demo.');
        // Never trust a client-provided IP header for authentication rate limits.
        request.headers['x-threadmap-ip'] = clientAddress(request, trustProxy);
        if (!['GET', 'HEAD'].includes(request.method)) request.body = await readJSON(request, 16_384);
        if (path === '/api/auth/sign-up/email' && request.body) {
          if (typeof request.body.name !== 'string' || !request.body.name.trim() || request.body.name.length > 80) {
            throw new RequestError(400, 'Introduce un nombre de hasta 80 caracteres.');
          }
          request.body.name = request.body.name.trim();
        }
        for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
        return await (await getAccounts()).authHandler(request, response);
      }
      if (request.method === 'GET' && path === '/health') return sendJSON(response, 200, { status: 'ok' });
      if (request.method === 'GET' && path === '/api/me') {
        const store = await getAccounts();
        const session = await store.getSession(request);
        const user = session ? { id: session.user.id, name: session.user.name, email: session.user.email, admin: Boolean(store.administration?.eligible(session.user)) } : null;
        return sendJSON(response, 200, { user });
      }
      if (path === '/admin' && ['GET', 'HEAD'].includes(request.method)) {
        const session = await (await getAccounts()).getSession(request);
        if (!session) {
          response.writeHead(302, { ...securityHeaders, Location: '/app?modo=login&next=admin' });
          return response.end();
        }
      }
      if (path.startsWith('/api/admin/')) {
        const store = await getAccounts();
        const session = await store.getSession(request);
        if (!session) throw new RequestError(401, 'Inicia sesión para continuar.');
        const admin = store.administration;
        admin.status(session);
        const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1];
        if (request.method === 'GET' && path === '/api/admin/status') return sendJSON(response, 200, admin.status(session));
        if (request.method === 'GET' && path === '/api/admin/users') return sendJSON(response, 200, admin.users(session, token));
        if (request.method !== 'POST') throw new RequestError(405, 'Método no permitido.');
        const actions = { setup: 'setup', unlock: 'unlock', lock: 'lock', grant: 'grant', 'reset-link': 'resetLink', password: 'changePassword' };
        const name = path.slice('/api/admin/'.length);
        if (!Object.hasOwn(actions, name)) throw new RequestError(404, 'Acción no encontrada.');
        const action = actions[name];
        if (!['setup', 'unlock', 'lock'].includes(action)) admin.authorize(session, token);
        const body = await readJSON(request, 4096);
        const result = action === 'setup' || action === 'unlock' ? await admin[action](session, body)
          : action === 'lock' ? admin.lock(session, token) : await admin[action](session, token, body);
        return sendJSON(response, 200, result ?? { status: 'ok' });
      }
      let user;
      if (path === '/api/workspace' || path === '/api/chat' || path === '/api/usage') {
        const session = await (await getAccounts()).getSession(request);
        if (!session) throw new RequestError(401, 'Inicia sesión para continuar.');
        user = session.user;
      }
      if (path === '/api/usage' && request.method === 'GET') {
        return sendJSON(response, 200, { usage: (await getAccounts()).getUsage(user.id) });
      }
      if (path === '/api/workspace' && request.method === 'GET') {
        return sendJSON(response, 200, (await getAccounts()).loadWorkspace(user.id));
      }
      if (path === '/api/workspace' && request.method === 'PUT') {
        const body = await readJSON(request, 8_100_000);
        const revision = (await getAccounts()).saveWorkspace(user.id, body?.revision, body?.workspace);
        return sendJSON(response, 200, { revision });
      }
      if (request.method === 'GET' && path === '/api/config') {
        return sendJSON(response, 200, { ...publicConfig.openai, providers: publicConfig });
      }
      if (request.method === 'POST' && path === '/api/chat') {
        const body = await readJSON(request);
        const mode = body?.mode;
        if (mode !== 'platform' && mode !== 'personal') {
          throw new RequestError(400, 'Selecciona un modo de conexión.');
        }
        const provider = body.provider ?? 'openai';
        if (typeof provider !== 'string' || !Object.hasOwn(providers, provider)) {
          throw new RequestError(400, 'Selecciona OpenAI o Gemini.');
        }
        const config = providers[provider];
        const input = getInput(body.messages);
        const authorization = request.headers.authorization;
        const apiKey = mode === 'platform' ? config.platformKey : /^Bearer ([\x21-\x7e]{1,512})$/.exec(authorization ?? '')?.[1];
        if (!apiKey) {
          throw new RequestError(401, mode === 'platform'
            ? `La clave de plataforma de ${config.name} todavía no está configurada.`
            : `Introduce tu clave personal de ${config.name} en la configuración.`);
        }
        if (mode === 'platform' && platformInFlight >= 4) {
          throw new RequestError(429, 'Hay varias solicitudes en curso. Inténtalo en unos segundos.');
        }
        const cancellation = new AbortController();
        response.once('close', () => cancellation.abort());
        const store = await getAccounts();
        if (mode === 'platform' && !store.reserveMessage(user.id)) {
          const usage = store.getUsage(user.id);
          return sendJSON(response, 403, {
            error: `Agotaste tus ${usage.limit} mensajes de plataforma. Añade tu API key o solicita más mensajes al administrador.`,
            code: 'FREE_MESSAGES_EXHAUSTED', usage,
          });
        }
        let completed = false;
        if (mode === 'platform') platformInFlight++;
        try {
          const apiRequest = requestFor(provider, config.model, apiKey, input);
          const upstream = await fetchProvider(apiRequest.url, {
            method: 'POST',
            headers: { ...apiRequest.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(apiRequest.body),
            redirect: 'error',
            signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(95_000)]),
          });
          if (!upstream.ok) {
            throw new RequestError(upstream.status === 429 ? 429 : 502, await getProviderError(upstream, provider, config.name));
          }
          const result = readProviderAnswer(provider, await upstream.json());
          if (!result.answer.trim()) {
            throw new RequestError(502, `${config.name} devolvió una respuesta vacía. Inténtalo de nuevo.`);
          }
          completed = true;
          return sendJSON(response, 200, { ...result, usage: store.getUsage(user.id) });
        } catch (error) {
          if (error instanceof RequestError) throw error;
          if (error.name === 'TimeoutError') throw new RequestError(504, `${config.name} tardó demasiado en responder. Puedes reintentar.`);
          throw new RequestError(502, `No se pudo conectar con ${config.name}. Puedes reintentar.`);
        } finally {
          if (mode === 'platform') {
            platformInFlight--;
            if (!completed) store.refundMessage(user.id);
          }
        }
      }
      const asset = Object.hasOwn(assets, path) ? assets[path] : null;
      if (['GET', 'HEAD'].includes(request.method) && /^\/vendor\/(?:katex\/(?:katex\.mjs|katex\.min\.css|fonts\/[A-Za-z0-9_-]+\.(?:woff2?|ttf))|highlight\/highlight\.js)$/.test(path)) {
        const type = path.endsWith('.css') ? 'text/css' : /\.m?js$/.test(path) ? 'text/javascript' : path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.woff') ? 'font/woff' : 'font/ttf';
        try {
          const bytes = await readFile(new URL(`./public${path}`, import.meta.url));
          response.writeHead(200, { ...securityHeaders, 'Content-Type': type });
          return response.end(request.method === 'HEAD' ? undefined : bytes);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (asset && ['GET', 'HEAD'].includes(request.method)) {
        const [filename, type] = asset;
        const bytes = await readFile(new URL(`./public/${filename}`, import.meta.url));
        response.writeHead(200, { ...securityHeaders, 'Content-Type': type });
        return response.end(request.method === 'HEAD' ? undefined : bytes);
      }
      sendJSON(response, 404, { error: 'Ruta no encontrada.' });
    } catch (error) {
      if (!response.destroyed) {
        sendJSON(response, error.status ?? 500, { error: error.status ? error.message : 'Error interno de ThreadMap.' });
      }
    }
  });
  server.once('close', () => { if (accountPromise) accountPromise.then((store) => store.close?.()).catch(() => {}); });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  appOrigin();
  const port = Number(process.env.PORT || 3000);
  const accounts = await createAccounts();
  createThreadMapServer({ accounts }).listen(port, '127.0.0.1', () => {
    console.log(`ThreadMap disponible en http://127.0.0.1:${port}`);
  });
}
