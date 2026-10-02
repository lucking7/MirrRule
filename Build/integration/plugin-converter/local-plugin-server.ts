import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';

import { identifyPluginSource } from './plugin-identity';
import type { PluginInfo } from './types';

export interface LocalPluginSource {
  plugin: PluginInfo;
  content: string
}

export interface LocalPluginServer {
  sourceUrls: ReadonlyMap<string, string>;
  close: () => Promise<void>
}

/** Serve an in-memory, allow-listed set of plugin bodies on loopback. */
export async function startLocalPluginServer(
  sources: LocalPluginSource[]
): Promise<LocalPluginServer> {
  const routes = sources.map(({ plugin, content }) => {
    const { sourceId } = identifyPluginSource(plugin);
    const extension = plugin.extension === 'lpx' ? '.lpx' : '.plugin';
    return { sourceId, path: `/plugins/${sourceId}${extension}`, content };
  });
  const contentByPath = new Map(routes.map(route => [route.path, route.content]));

  const server = createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }

    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const content = contentByPath.get(requestUrl.pathname);
    if (content === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(content),
      'Content-Type': 'text/plain; charset=utf-8',
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Local plugin server did not bind a TCP port');
  }

  const sourceUrls = new Map(routes.map(route => [
    route.sourceId, `http://127.0.0.1:${address.port}${route.path}`,
  ]));

  let closing: Promise<void> | undefined;
  return {
    sourceUrls,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) reject(error);
          else resolve();
        });
      });
      return closing;
    },
  };
}
