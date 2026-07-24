import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { transitionSourceHealth } from '../lib/source-health-state';

describe('source health three-strike state', () => {
  it('opens on three dead observations, ignores unknown, and closes on recovery', () => {
    let transition = transitionSourceHealth(undefined, 'source', 'dead', 't1');
    assert.equal(transition.issueAction, 'none');
    transition = transitionSourceHealth(transition.state, 'source', 'unknown', 't2');
    assert.equal(transition.state.deadStreak, 1);
    transition = transitionSourceHealth(transition.state, 'source', 'dead', 't3');
    assert.equal(transition.issueAction, 'none');
    transition = transitionSourceHealth(transition.state, 'source', 'dead', 't4');
    assert.equal(transition.issueAction, 'open-or-update');
    transition = transitionSourceHealth(transition.state, 'source', 'ok', 't5');
    assert.equal(transition.issueAction, 'close');
    assert.equal(transition.state.deadStreak, 0);
  });
});
