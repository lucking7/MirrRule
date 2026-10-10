import { createHash } from 'node:crypto';
import picocolors from 'picocolors';
import { $$fetch, defaultRequestInit, ResponseError } from './fetch-retry';
import { waitWithAbort } from 'foxts/wait';
import { nullthrow } from 'foxts/guard';
import { TextLineStream } from 'foxts/text-line-stream';
import { ProcessLineStream } from '../../lib/process-line';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { buildProxyUrlCandidates } from './proxy';
import { getTextEncodingFromHeaders } from './charset';
import { assertRuleTextResponse } from './rule-text-response';
import { getSourceDownloadObserver } from '../../lib/output-audit';

class CustomAbortError extends Error {
  // eslint-disable-next-line sukka/unicorn/custom-error-definition -- intentionally mimics built-in AbortError
  public readonly name = 'AbortError';
  public readonly digest = 'AbortError';
}

const reusedCustomAbortError = new CustomAbortError();

function pushUnique(items: string[], item: string): void {
  if (!items.includes(item)) {
    items.push(item);
  }
}

/** Which configured URL produced the accepted response; reported from the same download. */
export interface FetchAssetsSelection {
  /** The configured primary or fallback URL, never the proxy-prefixed request URL. */
  sourceUrl: string;
  /** -1 for the primary URL, otherwise the index in fallbackUrls. */
  fallbackIndex: number;
  viaProxy: boolean;
  /** HTTP Age header in seconds when present. */
  responseAgeSeconds: number | null;
  /** sha256 of the response body bytes before decoding and line cleaning. */
  rawContentSha256: string;
  /** Line counts of the accepted body before cleaning; `kept` lines are returned. */
  rawLines: { total: number; emptyLines: number; commentsOrMarkers: number; kept: number };
}

type FetchAssetsObserver = (selection: FetchAssetsSelection) => void;

/** Count lines like TextLineStream: only `\n` ends a line and a non-empty trailing remainder counts. */
class RawLineCounter {
  private newlines = 0;
  private partial = false;

  update(text: string): void {
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        this.newlines++;
        this.partial = false;
      } else {
        this.partial = true;
      }
    }
  }

  finish(): number {
    return this.newlines + (this.partial ? 1 : 0);
  }
}

function parseAgeHeader(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

export async function fetchAssets(
  url: string,
  fallbackUrls: null | undefined | string[] | readonly string[],
  processLine = false,
  allowEmpty = false,
  onSelected: FetchAssetsObserver | undefined = getSourceDownloadObserver()
) {
  const controller = new AbortController();
  const origins = new Map<string, { sourceUrl: string; fallbackIndex: number }>();
  let selectionReported = false;

  const createFetchFallbackPromise = async (url: string, index: number) => {
    if (index >= 0) {
      // To avoid wasting bandwidth, we will wait for a few time before downloading from the fallback URL.
      try {
        await waitWithAbort(200 + (index + 1) * 400, controller.signal);
      } catch {
        console.log(picocolors.gray('[fetch cancelled early]'), picocolors.gray(url));
        throw reusedCustomAbortError;
      }
    }
    if (controller.signal.aborted) {
      console.log(picocolors.gray('[fetch cancelled]'), picocolors.gray(url));
      throw reusedCustomAbortError;
    }
    const res = await $$fetch(url, { signal: controller.signal, ...defaultRequestInit });

    // Pass-through taps record the raw digest and pre-cleaning line counts of this same response.
    const rawHash = createHash('sha256');
    const rawLineCounter = new RawLineCounter();
    let linesAfterSplit = 0;
    let stream = nullthrow(res.body, url + ' has an empty body')
      .pipeThrough(new TransformStream<Uint8Array, ArrayBufferView | ArrayBuffer>({
        transform(chunk, streamController) {
          rawHash.update(chunk);
          streamController.enqueue(chunk);
        },
      }))
      .pipeThrough(new TextDecoderStream(getTextEncodingFromHeaders(res.headers)))
      .pipeThrough(new TransformStream<string, string>({
        transform(chunk, streamController) {
          rawLineCounter.update(chunk);
          streamController.enqueue(chunk);
        },
      }))
      .pipeThrough(new TextLineStream({ skipEmptyLines: processLine }))
      .pipeThrough(new TransformStream<string, string>({
        transform(line, streamController) {
          linesAfterSplit++;
          streamController.enqueue(line);
        },
      }));
    if (processLine) {
      stream = stream.pipeThrough(new ProcessLineStream());
    }
    const arr = await Array.fromAsync(stream);

    if (!allowEmpty && arr.length < 1) {
      throw new ResponseError(res, url, 'empty response w/o 304');
    }
    assertRuleTextResponse(res, url, arr);

    // Only the first accepted response reports provenance; later candidates are aborted.
    if (onSelected && !selectionReported) {
      selectionReported = true;
      const origin = origins.get(url);
      if (origin) {
        onSelected({
          ...origin,
          viaProxy: url !== origin.sourceUrl,
          responseAgeSeconds: parseAgeHeader(res.headers.get('age')),
          rawContentSha256: rawHash.digest('hex'),
          rawLines: (() => {
            const total = Math.max(rawLineCounter.finish(), linesAfterSplit);
            return {
              total,
              emptyLines: total - linesAfterSplit,
              commentsOrMarkers: linesAfterSplit - arr.length,
              kept: arr.length,
            };
          })(),
        });
      }
    }
    controller.abort();
    return arr;
  };

  const candidates: string[] = [];
  for (const candidate of buildProxyUrlCandidates(url, { preferDirect: true })) {
    pushUnique(candidates, candidate);
    if (!origins.has(candidate)) origins.set(candidate, { sourceUrl: url, fallbackIndex: -1 });
  }

  for (const [fallbackIndex, fallbackUrl] of (fallbackUrls ?? []).entries()) {
    for (const candidate of buildProxyUrlCandidates(fallbackUrl, { preferDirect: true })) {
      pushUnique(candidates, candidate);
      if (!origins.has(candidate)) origins.set(candidate, { sourceUrl: fallbackUrl, fallbackIndex });
    }
  }

  const [primaryUrl, ...fallbackCandidates] = candidates;
  const primaryPromise = createFetchFallbackPromise(primaryUrl, -1);

  if (fallbackCandidates.length === 0) {
    return primaryPromise;
  }
  return Promise.any(
    appendArrayInPlace([primaryPromise], fallbackCandidates.map(createFetchFallbackPromise))
  );
}
