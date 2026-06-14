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

export async function fetchAssets(
  url: string,
  fallbackUrls: null | undefined | string[] | readonly string[],
  processLine = false,
  allowEmpty = false
) {
  const controller = new AbortController();

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

    let stream = nullthrow(res.body, url + ' has an empty body')
      .pipeThrough(new TextDecoderStream(getTextEncodingFromHeaders(res.headers)))
      .pipeThrough(new TextLineStream({ skipEmptyLines: processLine }));
    if (processLine) {
      stream = stream.pipeThrough(new ProcessLineStream());
    }
    const arr = await Array.fromAsync(stream);

    if (arr.length < 1 && !allowEmpty) {
      throw new ResponseError(res, url, 'empty response w/o 304');
    }
    assertRuleTextResponse(res, url, arr);

    controller.abort();
    return arr;
  };

  const candidates: string[] = [];
  for (const candidate of buildProxyUrlCandidates(url, { preferDirect: true })) {
    pushUnique(candidates, candidate);
  }

  for (const fallbackUrl of fallbackUrls ?? []) {
    for (const candidate of buildProxyUrlCandidates(fallbackUrl, { preferDirect: true })) {
      pushUnique(candidates, candidate);
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
