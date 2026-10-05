const fs = require('node:fs');
const path = require('node:path');

module.exports = async context => {
  const locales = path.join(context.appOutDir, 'locales');
  if (!fs.existsSync(locales)) return;
  const keep = new Set(['zh-CN.pak', 'en-US.pak']);
  for (const name of fs.readdirSync(locales)) {
    if (!keep.has(name)) fs.rmSync(path.join(locales, name), { force: true });
  }
};
