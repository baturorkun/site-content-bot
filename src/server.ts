// The HTTP side: the page, the login (OAuth, to the platform and back), the
// session cookie and the JSON API the page uses. createApp() wires it from
// its parts (so a test can hand it fakes); serve() in cli.ts builds the parts
// from the environment and the site's config.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentBot, Session } from './bot.js';
import type { Config } from './config.js';
import type { Auth, DeployState } from './platform.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// The page ships beside dist/: assets/page.html.
export const PAGE_FILE = join(HERE, '..', 'assets', 'page.html');
const COOKIE = 'content_bot_session';
// The OAuth state between /auth/login and /auth/callback. Lax: the callback is
// a navigation from the platform, which a Strict cookie would not come with.
const STATE_COOKIE = 'content_bot_login';
const MAX_BODY = 64 * 1024;

const json = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
};

const readBody = (request: IncomingMessage): Promise<any> => new Promise((resolve, reject) => {
  let size = 0;
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      reject(Object.assign(new Error('the request is too large'), { status: 413 }));
      request.destroy();
    } else chunks.push(chunk);
  });
  request.on('end', () => {
    try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('the request is not JSON'), { status: 400 })); }
  });
  request.on('error', reject);
});

const cookieOf = (request: IncomingMessage, name = COOKIE): string | undefined => {
  const match = (request.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${name}=([a-f0-9]{48,64})`));
  return match?.[1];
};

const CHAT_ID = /^[\w-]{1,64}$/;

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

// The login's facts for the page: the platform's name ('GitLab', 'GitHub'),
// its host, the project and the access a person needs, as the platform names it.
export interface Login { platform: string; host: string; project: string; access: string }

// The page with the site's brand and the login's facts filled in, once.
export const renderPage = (template: string, config: Config, login: Login): string => {
  const values: Record<string, string> = {
    title: config.brand.title,
    mark: config.brand.mark,
    name: config.brand.name,
    subtitle: config.brand.subtitle,
    platform: login.platform,
    host: login.host,
    project: login.project,
    access: login.access,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => (key in values ? escapeHtml(values[key]!) : whole));
};

export interface AppOptions {
  auth: Auth;
  bot: ContentBot;
  deploy: (sha: string) => Promise<DeployState>;
  config: Config;
  // Shown on the page: { provider, model }.
  llm: { provider: string; model: string };
  login: Login;
  pageFile?: string;
}

type Route = (request: IncomingMessage, response: ServerResponse, session: Session, token: string, url: URL) => Promise<void>;

export const createApp = ({ auth, bot, deploy, config, llm, login, pageFile = PAGE_FILE }: AppOptions): Server => {
  const sessions = new Map<string, Session>();
  const page = renderPage(readFileSync(pageFile, 'utf8'), config, login);
  const me = { testUrl: config.urls.test, prodUrl: config.urls.production, llm, brand: config.brand, policy: bot.policy.label, platform: login.platform };

  const routes: Record<string, Route> = {
    'POST /api/logout': async (request, response, session, token) => {
      sessions.delete(token);
      json(response, 200, {}, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    },
    'GET /api/me': async (request, response, session) => json(response, 200, { user: session.user, ...me }),
    'POST /api/message': async (request, response, session) => {
      const { text, chat = 'default' } = await readBody(request);
      if (typeof text !== 'string' || !text.trim()) return json(response, 400, { error: 'The message is empty.' });
      if (typeof chat !== 'string' || !CHAT_ID.test(chat)) return json(response, 400, { error: 'The chat id is not valid.' });
      json(response, 200, await bot.propose(session, text.trim(), chat));
    },
    'POST /api/apply': async (request, response, session) => {
      const { id } = await readBody(request);
      json(response, 200, await bot.apply(session, id));
    },
    'POST /api/discard': async (request, response, session) => {
      bot.discard(session);
      json(response, 200, {});
    },
    'GET /api/undo': async (request, response) => json(response, 200, { change: (await bot.undoable()) ?? null }),
    'POST /api/undo': async (request, response, session) => {
      const { sha } = await readBody(request);
      json(response, 200, await bot.undo(session.user, sha));
    },
    'GET /api/changes': async (request, response) => json(response, 200, await bot.changes()),
    'GET /api/release': async (request, response, session) => json(response, 200, await bot.releasePreview(session.user)),
    'POST /api/release': async (request, response, session) => json(response, 200, await bot.release(session.user, await readBody(request))),
    'GET /api/release/state': async (request, response, session, token, url) => json(response, 200, await bot.releaseState(url.searchParams.get('tag'))),
    'GET /api/status': async (request, response) => json(response, 200, await bot.status()),
    'GET /api/deploy': async (request, response, session, token, url) => {
      const sha = url.searchParams.get('sha') ?? '';
      if (!/^[0-9a-f]{40}$/.test(sha)) return json(response, 400, { error: 'sha?' });
      json(response, 200, await deploy(sha));
    },
  };

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://bot');
    try {
      if (request.method === 'GET' && url.pathname === '/healthz') {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        return response.end('ok\n');
      }
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return response.end(page);
      }
      // The login: to the platform and back; a failure comes back to the page as ?login_error=.
      if (request.method === 'GET' && url.pathname === '/auth/login') {
        const { state, location } = auth.start();
        response.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Set-Cookie': `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600` });
        return response.end();
      }
      if (request.method === 'GET' && url.pathname === '/auth/callback') {
        const clear = `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0`;
        try {
          if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error_description') || `${login.platform} said: ${url.searchParams.get('error')}`);
          const user = await auth.finish({ code: url.searchParams.get('code'), state: url.searchParams.get('state'), cookieState: cookieOf(request, STATE_COOKIE) });
          const token = randomBytes(32).toString('hex');
          sessions.set(token, { user, chats: new Map(), proposal: undefined });
          response.writeHead(302, { Location: '/', 'Cache-Control': 'no-store', 'Set-Cookie': [clear, `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`] });
        } catch (error) {
          response.writeHead(302, { Location: `/?login_error=${encodeURIComponent(error.message)}`, 'Cache-Control': 'no-store', 'Set-Cookie': clear });
        }
        return response.end();
      }
      const route = routes[`${request.method} ${url.pathname}`];
      if (!route) return json(response, 404, { error: 'Not found.' });
      const token = cookieOf(request);
      const session = token && sessions.get(token);
      if (!session) return json(response, 401, { error: 'Log in first.' });
      await route(request, response, session, token!, url);
    } catch (error) {
      if (!response.headersSent) json(response, error.status ?? 500, { error: error.message });
    }
  });
};
