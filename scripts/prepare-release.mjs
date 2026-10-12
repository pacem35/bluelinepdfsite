#!/usr/bin/env node
// Usage: npm run release:prepare -- <installer-path> <platform> <version>
// Prints the wrangler command to upload the file to the private R2 bucket and the SQL to publish it.
import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';

const [file, platform, version] = process.argv.slice(2);
if (!file || !platform || !version) {
  console.error('Usage: npm run release:prepare -- <installer-path> <platform> <version>');
  console.error('Example: npm run release:prepare -- ./out/BluelinePDF-Setup-1.0.0.exe windows 1.0.0');
  process.exit(1);
}
if (!/^[a-z0-9-]{2,32}$/.test(platform)) {
  console.error('platform must be lowercase letters, digits or dashes (e.g. windows, macos, linux)');
  process.exit(1);
}

const filename = basename(file);
const size = statSync(file).size;
const hash = createHash('sha256');
await new Promise((resolve, reject) => {
  createReadStream(file).on('data', (c) => hash.update(c)).on('end', resolve).on('error', reject);
});
const sha256 = hash.digest('hex');
const key = `${platform}/${version}/${filename}`;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

console.log(`\n1) Upload to the private bucket:\n`);
console.log(`npx wrangler r2 object put blueline-installers/${key} --file ${JSON.stringify(file)} --remote\n`);
console.log(`2) Publish it (Supabase SQL editor):\n`);
console.log(
  `insert into public.releases (platform, version, r2_key, filename, sha256, size_bytes, published)\n` +
    `values (${q(platform)}, ${q(version)}, ${q(key)}, ${q(filename)}, ${q(sha256)}, ${size}, true);\n`,
);
