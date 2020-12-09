This tool tracks usage of objects emerging from a given IDL fragment.

Its main use case is to measure how much WPT tests exercise a given IDL fragment.

It relies on [parsed IDL fragments](https://w3c.github.io/webref/ed/idlparsed/) from [webref](https://github.com/w3c/webref/).

It reports its results as a JSON structure where each of the IDL item is matched to the number of access it received.

The tool is based on Puppeteer and JS proxies.

# Usage

```sh
node [-l] puppeteer.js <url> <shortname>
```


Run on a single page
```sh
node puppeteer.js https://wpt.live/mediacapture-record/ mediastream-recording
```

Run on all linked HTML pages
```sh
node puppeteer.js -l https://wpt.live/mediacapture-record/ mediastream-recording
```

# Tests
```sh
mocha
```