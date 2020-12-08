const assert = require('assert');
const proxyquire = require('proxyquire');

describe('puppeteer', () => {
  it('loads the proxy script and idl data', async () => {
    const url = 'file://' + __dirname + '/minimal.html';
    const shortname = 'anyshortname';
    const puppeteer = proxyquire('../puppeteer.js', {
      'node-fetch': async (url) => {
        assert.equal(url, `https://w3c.github.io/webref/ed/idlparsed/${shortname}.json`);
        return {
          async json() {
            return {idlparsed: {}}
          }
        };
      }
    });
    const res = await puppeteer.runWithProxy(url, shortname);
    assert.deepEqual(res, {});
  });
});
