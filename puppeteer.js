const fs = require("fs");
const puppeteer = require("puppeteer");
const fetch = require("node-fetch");

let browser;

async function getNewPage(debug) {
  if (!browser) {
    browser = await puppeteer.launch({ignoreHTTPSErrors: true, acceptInsecureCerts: true, executablePath: '/usr/bin/google-chrome-stable', headless: !debug });
  }
  return await browser.newPage();
}

async function runOnLinkedPages(url, shortname, debug =false) {
  const page = await getNewPage(debug);
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  const urls = (await page.evaluate('[...document.querySelectorAll("a[href]")].map(a => a.href)'))
        // make this configurable?
        .filter(u => u.endsWith('.html'));
  const resultList = await Promise.all(
    urls.map(u =>
             runWithProxy(u, shortname, debug, true)
             .catch(e => { console.error("Error processing " + u + ": " + e); return {};})
            )
  );
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
