const assert = require('assert');
const proxyquire = require('proxyquire');
const {parseIdl} = require('reffy');

const mockIdlFetch = (shortname, idl = '') => async (url) => {
  assert.equal(url, `https://w3c.github.io/webref/ed/idlparsed/${shortname}.json`);
  return {
    async json() {
      return {idlparsed: await parseIdl(idl)}
    }
  };
};

describe('puppeteer', () => {
  it('loads the proxy script and idl data', async () => {
    const url = 'file://' + __dirname + '/pages/minimal.html';
    const shortname = 'anyshortname';
    const puppeteer = proxyquire('../puppeteer.js', {
      'node-fetch': mockIdlFetch(shortname)
    });
    const {results, errors} = (await puppeteer.runWithProxy(url, shortname));
    assert.deepEqual(results, {});
    assert.deepEqual(errors, []);
  });

  it('works in linked-pages mode', async () => {
    const url = 'file://' + __dirname + '/pages/links.html';
    const shortname = 'anyshortname';
    const puppeteer = proxyquire('../puppeteer.js', {
      'node-fetch': mockIdlFetch(shortname, 'interface RTCPeerConnection { constructor();};')
    });
    const {results, errors} = (await puppeteer.runOnLinkedPages(url, shortname));
    const constructorRes = {};
    constructorRes[`file://${__dirname}/pages/test.window.html`] = 1;
    assert.deepEqual(results, {
      // comes from pages/test.window.html (linked from links.html)
      RTCPeerConnection: {
        _constructor:  constructorRes
      }
    }
                    );
    assert.deepEqual(errors, []);
  });
});
