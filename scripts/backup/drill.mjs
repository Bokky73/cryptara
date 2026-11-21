#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(await readFile(path.join(__dirname, 'policy.json'), 'utf8'));

const { values } = parseArgs({
  options: {
    sourceUrl: { type: 'string' },
    targetUrl: { type: 'string' },
    backupDir: { type: 'string', default: path.join(__dirname, '..', '..', 'backups') },
  },
});

if (!values.sourceUrl || !values.targetUrl) {
  console.error('--source-url and --target-url are required.');
  process.exit(1);
}

await mkdir(values.backupDir, { recursive: true });

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status || 1);
}

const start = Date.now();

const backupStart = Date.now();
run('node', [path.join(__dirname, 'backup.mjs'), '--url', values.sourceUrl, '--output', values.backupDir]);
const backupTime = Date.now() - backupStart;

const files = await readdir(values.backupDir);
const backups = files.filter(f => f.endsWith('.tar.gz')).sort();
if (backups.length === 0) {
  console.error('No backup file found.');
  process.exit(1);
}
const backupFile = path.join(values.backupDir, backups[backups.length - 1]);

const restoreStart = Date.now();
run('node', [path.join(__dirname, 'restore.mjs'), '--url', values.targetUrl, '--file', backupFile, '--allowProduction']);
const restoreTime = Date.now() - restoreStart;

const verifyStart = Date.now();
run('node', [path.join(__dirname, 'verify.mjs'), '--url', values.targetUrl, '--file', backupFile]);
const verifyTime = Date.now() - verifyStart;

const totalTime = Date.now() - start;
const rtoMs = (policy.recovery_objective?.rto_seconds || 900) * 1000;
console.log(`\nBackup time: ${backupTime}ms`);
console.log(`Restore time: ${restoreTime}ms`);
console.log(`Verify time: ${verifyTime}ms`);
console.log(`Total time: ${totalTime}ms`);

const summary = {
  status: totalTime <= rtoMs ? 'PASSED' : 'FAILED',
  backupTimeMs: backupTime,
  restoreTimeMs: restoreTime,
  verifyTimeMs: verifyTime,
  totalTimeMs: totalTime,
  rtoMs,
  backupFile: path.basename(backupFile),
  timestamp: new Date().toISOString(),
};
await writeFile(path.join(values.backupDir, 'drill-summary.json'), JSON.stringify(summary, null, 2));

if (totalTime > rtoMs) {
  console.error(`Recovery objective exceeded: ${totalTime}ms > ${rtoMs}ms`);
  process.exit(1);
}
console.log(`Recovery objective met: ${totalTime}ms <= ${rtoMs}ms`);
