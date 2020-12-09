const fs = require("fs");
const puppeteer = require("puppeteer");
const fetch = require("node-fetch");
const atob = require('atob');
const btoa = require('btoa');

let browser;

async function getNewPage(debug) {
  if (!browser) {
    browser = await puppeteer.launch({ignoreHTTPSErrors: true, acceptInsecureCerts: true, executablePath: '/usr/bin/chromium-browser', headless: !debug });
    browser.on('targetcreated', async (target) => {
      const page = await target.page();
      intercept(page, ['*'], transform);
    });
  }
  return await browser.newPage();
}
const requestCache = new Map();

function transform(source) {
  // insert the magic ___orig owner for interface objects for idlharness
  // Brittle - this depends on stability of
  // https://github.com/web-platform-tests/wpt/blob/1357df60a2ab611f4389d1837a7f9fc10548ebc0/resources/idlharness.js#L1436
  return source.replace("return this.get_interface_object_owner()[this.name];", `
  const owner = this.get_interface_object_owner();
  if (owner.___orig[this.name]) return owner.___orig[this.name];
  return this.get_interface_object_owner()[this.name];
`);
}

// from https://gist.github.com/jsoverson/4fe67f835af8c64189a643b5c527d9dc#file-puppeteer-prettier-js-L42 per https://jsoverson.medium.com/using-chrome-devtools-protocol-with-puppeteer-737a1300bac0
async function intercept(page, patterns, transform) {
  const client = await page.target().createCDPSession();

  await client.send('Network.enable');

  await client.send('Network.setRequestInterception', { 
    patterns: patterns.map(pattern => ({
      urlPattern: pattern, resourceType: 'Script', interceptionStage: 'HeadersReceived'
    }))
  });

  client.on('Network.requestIntercepted', async ({ interceptionId, request, responseHeaders, resourceType }) => {

    const response = await client.send('Network.getResponseBodyForInterception',{ interceptionId });

    const contentTypeHeader = Object.keys(responseHeaders).find(k => k.toLowerCase() === 'content-type');
    let newBody, contentType = responseHeaders[contentTypeHeader];

    if (requestCache.has(response.body)) {
      newBody = requestCache.get(response.body);
    } else {
      const bodyData = response.base64Encoded ? atob(response.body) : response.body;
      try {
        if (resourceType === 'Script' && request.url.match(/\/resources\/idlharness.js$/)) newBody = transform(bodyData);
        else newBody = bodyData
      } catch(e) {
        newBody = bodyData
      }
  
      requestCache.set(response.body, newBody);
    }

    const newHeaders = [
      'Date: ' + (new Date()).toUTCString(),
      'Connection: closed',
      'Content-Length: ' + newBody.length,
      'Content-Type: ' + contentType
    ];

    client.send('Network.continueInterceptedRequest', {
      interceptionId,
      rawResponse: btoa('HTTP/1.1 200 OK' + '\r\n' + newHeaders.join('\r\n') + '\r\n\r\n' + newBody)
    });
  });
}


async function runOnLinkedPages(url, shortname, debug =false) {
  const page = await getNewPage(debug);
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  const urls = (await page.evaluate('[...document.querySelectorAll("a[href]")].map(a => a.href)'))
        // make this configurable?
        .filter(u => u.endsWith('.html'));
  page.close();
  let resultList = [];
  for (let u of urls) {
    resultList.push(
      await runWithProxy(u, shortname, debug, true)
        .catch(e => { console.error("Error processing " + u + ": " + e); return {};})
    )
  }
  const results = resultList.reduce((acc, res) => {
    Object.entries(res).forEach(([k, v]) => {
      if (!acc[k]) acc[k] = {};
      Object.entries(v).forEach(([member, count]) => {
        if (!acc[k][member]) acc[k][member] = 0;
        acc[k][member] += res[k][member];
      });
    });
    return acc;
  });
  await browser.close();
  return results;
}

async function runWithProxy(url, shortname, debug = false, noclose = false) {
  let results = {};
  const {idlparsed} = await fetch(`https://w3c.github.io/webref/ed/idlparsed/${shortname}.json`).then(r => r.json());

  const page = await getNewPage(debug);
  page.on('console', msg => {
    console.error(msg.args().map(o => JSON.stringify(o._remoteObject.value, null, 2)).join('\n'));
  });

  const proxyFile = "var idlData = " + JSON.stringify(idlparsed, null, 2) + ";\n" +
        fs.readFileSync('./proxy.js', 'utf-8');
  page.evaluateOnNewDocument(proxyFile);
  await page.goto(url);
  await page.waitForFunction('___puppeteerdone === true');
  results = await page.evaluate('___tracker');
  if (!debug) {
    await page.close();
  }
  if (!debug && !noclose) {
    await browser.close();
  }
  return await results;
}

module.exports = {runWithProxy, runOnLinkedPages};

if (require.main === module) {
  let action;
  if (process.argv.length === 5 && process.argv[2] === "-l") {
    action = runOnLinkedPages(process.argv[3], process.argv[4], !!process.env.DEBUG)
  } else {
    action = runWithProxy (process.argv[2], process.argv[3], !!process.env.DEBUG)
  }
  action.then(results => {
    console.log(results);
  })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
