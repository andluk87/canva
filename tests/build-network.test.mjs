import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
// Use the actual image policy with empty caches and a real integrity-pinned
// tarball, without contacting a public registry.
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const command = dockerfile.match(/npm ci\s+([\s\S]+?)\s*&&/);
assert.ok(command, 'Dockerfile must contain the npm ci install command');
const installArgs = ['ci', ...command[1].replaceAll('\\', ' ').trim().split(/\s+/)];

async function fixture(mode) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'forma-build-network-'));
  mkdirSync(path.join(dir, 'package'));
  writeFileSync(path.join(dir, 'package', 'package.json'), JSON.stringify({
    name: 'forma-network-fixture', version: '1.0.0', main: 'index.js',
  }));
  writeFileSync(path.join(dir, 'package', 'index.js'), 'module.exports = "download-verified";\n');
  await run('tar', ['-czf', path.join(dir, 'fixture.tgz'), '-C', dir, 'package']);
  const archive = readFileSync(path.join(dir, 'fixture.tgz'));
  const integrity = 'sha512-' + createHash('sha512').update(archive).digest('base64');
  let downloads = 0, payload = archive;
  if (mode === 'corrupt') {
    // Still a valid archive; only the lockfile integrity must reject it.
    writeFileSync(path.join(dir, 'package', 'index.js'), 'module.exports = "tampered";\n');
    await run('tar', ['-czf', path.join(dir, 'changed.tgz'), '-C', dir, 'package']);
    payload = readFileSync(path.join(dir, 'changed.tgz'));
  }
  const server = createServer((req, res) => {
    if (req.url !== '/fixture.tgz') { res.writeHead(404).end(); return; }
    downloads++;
    if (mode === 'reset' && downloads <= 2) { req.socket.destroy(); return; }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.end(payload);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const resolved = `http://127.0.0.1:${server.address().port}/fixture.tgz`;
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'forma-install-test', version: '1.0.0', private: true,
    dependencies: { 'forma-network-fixture': '1.0.0' },
  }));
  const lock = JSON.stringify({
    name: 'forma-install-test', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'forma-install-test', version: '1.0.0', dependencies: { 'forma-network-fixture': '1.0.0' } },
      'node_modules/forma-network-fixture': { version: '1.0.0', resolved, integrity },
    },
  });
  writeFileSync(path.join(dir, 'package-lock.json'), lock);
  return {
    dir, lock, downloads: () => downloads,
    install: (name, extra = []) => run('npm', [
      ...installArgs, '--cache=' + path.join(dir, name), '--ignore-scripts',
      '--noproxy=127.0.0.1', ...extra,
    ], { cwd: dir, timeout: 45000, maxBuffer: 1024 * 1024 }),
    close: async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('Docker install recovers from two real connection resets; retry-zero control fails', { timeout: 45000 }, async () => {
  const control = await fixture('reset');
  try {
    await assert.rejects(control.install('control-cache', ['--fetch-retries=0']),
      error => error.code !== 0 && /ECONNRESET|socket hang up/.test(error.stderr));
    assert.equal(control.downloads(), 1);
  } finally { await control.close(); }
  const recovery = await fixture('reset');
  try {
    await recovery.install('recovery-cache');
    assert.equal(recovery.downloads(), 3);
    assert.equal(createRequire(path.join(recovery.dir, 'package.json'))('forma-network-fixture'), 'download-verified');
    assert.equal(readFileSync(path.join(recovery.dir, 'package-lock.json'), 'utf8'), recovery.lock);
  } finally { await recovery.close(); }
});

test('Docker retry policy still rejects a tarball with the wrong lockfile integrity', { timeout: 45000 }, async () => {
  const broken = await fixture('corrupt');
  try {
    // Shorten only backoff for this negative case; integrity stays enforced.
    await assert.rejects(broken.install('corrupt-cache', [
      '--fetch-retry-mintimeout=10', '--fetch-retry-maxtimeout=20',
    ]), error => error.code !== 0 && /EINTEGRITY/.test(error.stderr));
    assert.ok(broken.downloads() >= 1);
    assert.equal(readFileSync(path.join(broken.dir, 'package-lock.json'), 'utf8'), broken.lock);
  } finally { await broken.close(); }
});
