import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('analysis/official-apk/quoteh5-assets');
const files = fs.readdirSync(root).filter((name) => name.endsWith('.js'));
const needles = [
  'QuoteMsgID',
  'QuotationFreq',
  'qryQuotation',
  'queryCondition',
  'getMinuteHistory',
  'getDayLineHistory',
  'getTick',
  'codes_info_json',
  'latestQuotation',
  'tradeStatus',
  'wss://',
  'kline',
  'history',
];

const contexts = [];
const urls = new Set();
const imports = new Set();
const definitions = {};
const generatedSymbols = new Set();

for (const name of files) {
  const text = fs.readFileSync(path.join(root, name), 'utf8');
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>\\)]+|wss?:\/\/[^\s"'<>\\)]+/g)) {
    urls.add(match[0]);
  }
  for (const match of text.matchAll(/(?:from\s*|import\s*\(|System\.register\()\s*[\[(]?\s*["'](\.\/[^"']+\.js)["']/g)) {
    imports.add(match[1]);
  }
  for (const match of text.matchAll(/e\.([A-Za-z][A-Za-z0-9_]*)=function\(\)/g)) {
    generatedSymbols.add(match[1]);
  }
  for (const needle of needles) {
    let start = 0;
    let count = 0;
    while (count < 8) {
      const at = text.toLowerCase().indexOf(needle.toLowerCase(), start);
      if (at < 0) break;
      contexts.push({
        file: name,
        needle,
        at,
        context: text.slice(Math.max(0, at - 420), Math.min(text.length, at + needle.length + 950)),
      });
      start = at + needle.length;
      count += 1;
    }
  }
  for (const symbol of ['QuoteMsgID', 'QuotationFreq', 'QuoteQueryCondition', 'QuotationRequest', 'QuotationResponse', 'QuotationField', 'RealtimeField', 'ExtraField', 'TradeStatus']) {
    const at = text.indexOf(`e.${symbol}=`);
    if (at >= 0) definitions[symbol] = text.slice(at, Math.min(text.length, at + 12000));
  }
}

const report = { files, urls: [...urls].sort(), imports: [...imports].sort(), generatedSymbols: [...generatedSymbols].sort(), definitions, contexts };
fs.writeFileSync('analysis/official-apk/quoteh5-bundle-facts.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  files,
  urls: report.urls,
  imports: report.imports,
  generatedSymbols: report.generatedSymbols,
  definitions: Object.fromEntries(Object.entries(definitions).map(([key, value]) => [key, value.slice(0, 2500)])),
  contextCount: contexts.length,
  selected: contexts.filter((item) => [
    'qryQuotation',
    'queryCondition',
    'getMinuteHistory',
    'getDayLineHistory',
    'getTick',
    'wss://',
  ].includes(item.needle)),
}, null, 2));
