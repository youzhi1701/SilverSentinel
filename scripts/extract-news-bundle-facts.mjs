import fs from 'node:fs';

const files = [
  'analysis/official-apk/rongtonggold.js',
  'analysis/official-apk/jin10-oem-flash.js',
];
const needles = [
  '59dce26c11704fc293c6607e3fa7dad4.z3c.jin10.com/api/flash',
  'rtgold.oem.jin10.com/flash',
  'getDatas',
  'last_id',
  'max_time',
  'vip',
  'important',
  'trend',
  'relevance',
  'event',
  'content',
  'time_view',
];

const report = { files: [], contexts: [] };
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  report.files.push({ file, size: text.length });
  for (const needle of needles) {
    let cursor = 0;
    let count = 0;
    while (count < 10) {
      const at = text.toLowerCase().indexOf(needle.toLowerCase(), cursor);
      if (at < 0) break;
      report.contexts.push({
        file,
        needle,
        at,
        context: text.slice(Math.max(0, at - 1100), Math.min(text.length, at + needle.length + 2300)),
      });
      cursor = at + needle.length;
      count += 1;
    }
  }
}

fs.writeFileSync('analysis/official-apk/rongtonggold-news-facts.json', JSON.stringify(report, null, 2));
const selected = report.contexts.filter((item) => [
  '59dce26c11704fc293c6607e3fa7dad4.z3c.jin10.com/api/flash',
  'rtgold.oem.jin10.com/flash',
  'getDatas',
  'last_id',
].includes(item.needle));
console.log(JSON.stringify({ files: report.files, selected }, null, 2));
