import picocolors from 'picocolors';
import { $$fetch, defaultRequestInit, ResponseError } from './fetch-retry';
import { waitWithAbort } from 'foxts/wait';
import { nullthrow } from 'foxts/guard';
import { TextLineStream } from 'foxts/text-line-stream';
import { ProcessLineStream } from '../../lib/process-line';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { applyProxyIfNeeded } from './proxy';

class CustomAbortError extends Error {
  // eslint-disable-next-line sukka/unicorn/custom-error-definition -- intentionally mimics built-in AbortError
  public readonly name = 'AbortError';
  public readonly digest = 'AbortError';
}

const reusedCustomAbortError = new CustomAbortError();

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
    // 应用代理（如果需要，例如 kelee.one 域名）
    const finalUrl = applyProxyIfNeeded(url);
    const res = await $$fetch(finalUrl, { signal: controller.signal, ...defaultRequestInit });

    let stream = nullthrow(res.body, url + ' has an empty body')
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream({ skipEmptyLines: processLine }));
    if (processLine) {
      stream = stream.pipeThrough(new ProcessLineStream());
    }
    const arr = await Array.fromAsync(stream);

    if (arr.length < 1 && !allowEmpty) {
      throw new ResponseError(res, url, 'empty response w/o 304');
    }

    controller.abort();
    return arr;
  };

  const primaryPromise = createFetchFallbackPromise(url, -1);

  if (!fallbackUrls || fallbackUrls.length === 0) {
    return primaryPromise;
  }
  return Promise.any(
    appendArrayInPlace([primaryPromise], fallbackUrls.map(createFetchFallbackPromise))
  );
}
