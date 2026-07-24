import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { boundedMap, DEFAULT_CONCURRENCY_LIMIT } from '../utils/concurrency';

function deferred() {
  let resolveDeferred!: () => void;
  const promise = new Promise<void>(resolve => {
    resolveDeferred = resolve;
  });
  return { promise, resolve: resolveDeferred };
}

describe('boundedMap', () => {
  it('uses the default limit and never exceeds an explicit limit', async () => {
    const gates = Array.from({ length: 10 }, deferred);
    let active = 0;
    let maximumActive = 0;
    const mapping = boundedMap(gates, async gate => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await gate.promise;
      active--;
      return active;
    });

    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
    assert.equal(maximumActive, DEFAULT_CONCURRENCY_LIMIT);
    gates.forEach(gate => gate.resolve());
    await mapping;

    active = 0;
    maximumActive = 0;
    await boundedMap([1, 2, 3, 4], async value => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active--;
      return value;
    }, { limit: 2 });
    assert.ok(maximumActive <= 2);
  });

  it('returns results in input order when completion order is inverted', async () => {
    const gates = Array.from({ length: 3 }, deferred);
    const mapping = boundedMap([0, 1, 2], async index => {
      await gates[index].promise;
      return `result-${index}`;
    });
    gates[2].resolve();
    gates[1].resolve();
    gates[0].resolve();
    assert.deepEqual(await mapping, ['result-0', 'result-1', 'result-2']);
  });

  it('runs serially with limit 1', async () => {
    const events: string[] = [];
    const results = await boundedMap([1, 2, 3], async value => {
      events.push(`start-${value}`);
      await Promise.resolve();
      events.push(`end-${value}`);
      return value * 2;
    }, { limit: 1 });
    assert.deepEqual(events, ['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
    assert.deepEqual(results, [2, 4, 6]);
  });

  it('rejects invalid limits', async () => {
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      // eslint-disable-next-line no-await-in-loop -- verify each invalid boundary independently
      await assert.rejects(boundedMap([], () => Promise.resolve(0), { limit }), RangeError);
    }
  });

  it('rejects the overall mapping when one item rejects', async () => {
    await assert.rejects(
      boundedMap([1, 2, 3], value => {
        if (value === 2) return Promise.reject(new Error('mapper failed'));
        return Promise.resolve(value);
      }, { limit: 2 }),
      /mapper failed/
    );
  });
});
