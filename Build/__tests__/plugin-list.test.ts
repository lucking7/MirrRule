import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractPluginUrls } from '../integration/plugin-converter/plugin-list';

describe('plugin catalog URL extraction', () => {
  it('unwraps Loon installation links without dropping query parameters or source identity', () => {
    const source = 'https://kelee.one/Tool/Loon/Lpx/example.lpx?version=2';
    const catalog = JSON.stringify({ lists: [
      { url: `loon://install-plugin?url=${encodeURIComponent(source)}` },
      { nested: [source, 'https://plugins.test/another.plugin#description'] },
      { url: 'https://plugins.test/not-a-plugin.js' },
      { url: 'https://plugins.test/fake.plugin/not-plugin' },
    ] });

    assert.deepEqual(extractPluginUrls(catalog), [
      source,
      'https://plugins.test/another.plugin#description',
    ]);
  });

  it('rejects HTML and invalid catalog JSON before extracting URLs', () => {
    assert.throws(() => extractPluginUrls('<html>https://plugins.test/fake.plugin</html>'));
    assert.deepEqual(extractPluginUrls('{"lists":[]}'), []);
  });
});
