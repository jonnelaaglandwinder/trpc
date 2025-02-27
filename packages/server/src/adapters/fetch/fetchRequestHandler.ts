/**
 * If you're making an adapter for tRPC and looking at this file for reference, you should import types and functions from `@trpc/server` and `@trpc/server/http`
 *
 * @example
 * ```ts
 * import type { AnyTRPCRouter } from '@trpc/server'
 * import type { HTTPBaseHandlerOptions } from '@trpc/server/http'
 * ```
 */
// @trpc/server

import type { AnyRouter } from '../../@trpc/server';
import type {
  HTTPRequest,
  HTTPResponse,
  ResolveHTTPRequestOptionsContextFn,
  ResponseChunk,
} from '../../@trpc/server/http';
import {
  getBatchStreamFormatter,
  resolveHTTPResponse,
  toURL,
} from '../../@trpc/server/http';
import type { FetchHandlerOptions } from './types';

export type FetchHandlerRequestOptions<TRouter extends AnyRouter> =
  FetchHandlerOptions<TRouter> & {
    req: Request;
    endpoint: string;
  };

const trimSlashes = (path: string): string => {
  path = path.startsWith('/') ? path.slice(1) : path;
  path = path.endsWith('/') ? path.slice(0, -1) : path;

  return path;
};

export async function fetchRequestHandler<TRouter extends AnyRouter>(
  opts: FetchHandlerRequestOptions<TRouter>,
): Promise<Response> {
  const resHeaders = new Headers();

  const createContext: ResolveHTTPRequestOptionsContextFn<TRouter> = async (
    innerOpts,
  ) => {
    return opts.createContext?.({ req: opts.req, resHeaders, ...innerOpts });
  };

  const url = toURL(opts.req.url);

  const pathname = trimSlashes(url.pathname);
  const endpoint = trimSlashes(opts.endpoint);
  const path = trimSlashes(pathname.slice(endpoint.length));

  const req: HTTPRequest = {
    query: url.searchParams,
    method: opts.req.method,
    headers: Object.fromEntries(opts.req.headers),
    body: opts.req.headers.get('content-type')?.startsWith('application/json')
      ? await opts.req.text()
      : '',
  };

  let resolve: (value: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  let status = 200;

  let isStream = false;
  let controller: ReadableStreamController<any>;
  let encoder: TextEncoder;
  let formatter: ReturnType<typeof getBatchStreamFormatter>;
  const unstable_onHead = (head: HTTPResponse, isStreaming: boolean) => {
    for (const [key, value] of Object.entries(head.headers ?? {})) {
      /* istanbul ignore if -- @preserve */
      if (typeof value === 'undefined') {
        continue;
      }
      if (typeof value === 'string') {
        resHeaders.set(key, value);
        continue;
      }
      for (const v of value) {
        resHeaders.append(key, v);
      }
    }
    status = head.status;
    if (isStreaming) {
      resHeaders.set('Transfer-Encoding', 'chunked');
      resHeaders.append('Vary', 'trpc-batch-mode');
      const stream = new ReadableStream({
        start(c) {
          controller = c;
        },
      });
      const response = new Response(stream, {
        status,
        headers: resHeaders,
      });
      resolve(response);
      encoder = new TextEncoder();
      formatter = getBatchStreamFormatter();
      isStream = true;
    }
  };

  const unstable_onChunk = ([index, string]: ResponseChunk) => {
    if (index === -1) {
      // full response, no streaming
      const response = new Response(string || null, {
        status,
        headers: resHeaders,
      });
      resolve(response);
    } else {
      controller.enqueue(encoder.encode(formatter(index, string)));
    }
  };

  resolveHTTPResponse({
    req,
    createContext,
    path,
    router: opts.router,
    batching: opts.batching,
    responseMeta: opts.responseMeta,
    onError(o) {
      opts?.onError?.({ ...o, req: opts.req });
    },
    unstable_onHead,
    unstable_onChunk,
  })
    .then(() => {
      if (isStream) {
        controller.enqueue(encoder.encode(formatter.end()));
        controller.close();
      }
    })
    .catch(() => {
      if (isStream) {
        controller.close();
      }
    });

  return promise;
}
