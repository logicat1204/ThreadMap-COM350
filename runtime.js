import { isIP } from 'node:net';

const loopbackHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
const loopbackPeer = (address) => address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';

export function appOrigin(value = process.env.APP_URL) {
  if (!value?.trim()) {
    if (process.env.NODE_ENV === 'production') throw new Error('Configura APP_URL con la dirección HTTPS pública.');
    return null;
  }
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('APP_URL debe ser un origen HTTP o HTTPS, sin ruta ni credenciales.');
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('APP_URL debe usar HTTPS en producción.');
  return url.origin;
}

export function allowsHost(host, origin) {
  if (typeof host !== 'string' || /[\s,/@\\?#]/.test(host)) return false;
  if (loopbackHost.test(host)) return true;
  if (!origin) return false;
  const publicURL = new URL(origin);
  return host.toLowerCase() === publicURL.host ||
    (publicURL.protocol === 'https:' && host.toLowerCase() === `${publicURL.hostname}:443`);
}

export function allowsOrigin(originHeader, host, origin) {
  if (!originHeader) return true;
  if (loopbackHost.test(host ?? '')) return originHeader === `http://${host}` || originHeader === `https://${host}`;
  return originHeader === origin;
}

export function clientAddress(request, trustProxy = false) {
  const peer = request.socket?.remoteAddress || '127.0.0.1';
  const forwarded = request.headers['x-threadmap-client-ip'];
  // This header is overwritten by our local Caddy instance. Other peers cannot assert an IP.
  if (trustProxy && loopbackPeer(peer) && typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
  return peer;
}
