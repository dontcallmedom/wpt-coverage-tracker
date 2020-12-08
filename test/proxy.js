const assert = require('assert');
const proxyquire = require('proxyquire');
const {parseIdl} = require('reffy');

const mockFetchIdlData = (idl) => async () => {
  return {
    async json() {
      return {idlparsed: await parseIdl(idl)};
    }
  };
};

const baseResult = {
  "RTCPeerConnection": { "_constructor": 1 }
};

const baseIdl = `interface RTCPeerConnection {
  constructor(optional RTCConfiguration config);
};`

const addToBaseInterface = l => baseIdl.replace('};', l + '\n' + '};');

const tests = [
  {
    title: 'tracks interface constructor',
    idl: baseIdl,
    js: 'new RTCPeerConnection();',
    results: baseResult
  },
  {
    title: 'ignore inexistant interface attributes',
    idl: baseIdl,
    js: 'const pc = new RTCPeerConnection(); pc.inexistantProp',
    results: {
      "RTCPeerConnection": { "_constructor": 1 }
    }
  },
  {
    title: 'tracks interface attribute with primitive type',
    idl: addToBaseInterface(`readonly attribute boolean? canTrickleIceCandidates;`),
    js: `
const pc = new RTCPeerConnection();
pc.canTrickleIceCandidates;
`,
    results: {
      "RTCPeerConnection": { "_constructor": 1, "canTrickleIceCandidates": 1 }
    }
  },
  {
    title: 'tracks dictionary as a return type of interface method',
    idl: addToBaseInterface(`  RTCConfiguration getConfiguration(); `) + `
dictionary RTCConfiguration { octet iceCandidatePoolSize = 0;};`,
    js: `
const pc = new RTCPeerConnection();
pc.getConfiguration().iceCandidatePoolSize
`,
    results: {
      "RTCPeerConnection": { "_constructor": 1, "getConfiguration": 1 },
      "RTCConfiguration": {"iceCandidatePoolSize": 1}
    }
  },
  {
    title: 'tracks dictionary with trackable fields as a return type of interface method',
    idl: addToBaseInterface(`  RTCConfiguration getConfiguration(); `) + `
dictionary RTCConfiguration { sequence<RTCIceServer> iceServers;};
dictionary RTCIceServer { DOMString username;};
`,
    js: `
const pc = new RTCPeerConnection({iceServers: [{urls: 'stun:stun1.example.net', username: 'example'}]});
pc.getConfiguration().iceServers[0].username;
`,
    results: {
      "RTCPeerConnection": { "_constructor": 1, "getConfiguration": 1 },
      "RTCConfiguration": {"iceServers": 2},
      "RTCIceServer": {"username": 2}
    }
  },
];

describe('puppeteer', () => {
  tests.forEach(t => {
    it(t.title, async () => {
      const url = 'file://' + __dirname + '/loadFromQS.html?' + encodeURIComponent(t.js);
      const puppeteer = proxyquire('../puppeteer.js', {
        'node-fetch': mockFetchIdlData(t.idl)
      });
      const res = await puppeteer.runWithProxy(url, 'shortname', process.env.DEBUG);
      assert.deepEqual(res, t.results);
    });
  });
});
