import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const tsxLoader = pathToFileURL(require.resolve('tsx')).href;
const envModule = pathToFileURL(resolve(process.cwd(), 'src/env.ts')).href;
const mainModule = pathToFileURL(resolve(process.cwd(), 'src/main.ts')).href;
const requiredEnv = [
  ['MONGODB_URI', 'mongodb://127.0.0.1:27018/env_test?replicaSet=rs0'],
  ['PORT', '3543'],
  ['SERVICE_URL', 'http://localhost:3543'],
  ['MCP_AUTH_MODE', 'trusted_local'],
  ['LEASE_MINUTES', '30']
] as const;

function runEntry(entry: string, cwd: string, script = `await import(${JSON.stringify(entry)})`) {
  return spawnSync(process.execPath, [
    '--import', tsxLoader,
    '--input-type=module',
    '--eval', script
  ], {
    cwd,
    env: {
      ...process.env,
      MONGODB_URI: 'mongodb://process.invalid/from-process',
      PORT: '4567',
      SERVICE_URL: 'http://process.invalid',
      MCP_AUTH_MODE: 'bearer',
      LEASE_MINUTES: '99'
    },
    encoding: 'utf8',
    timeout: 10_000
  });
}

test('configuração do servidor vem somente do .env', () => {
  const directory = mkdtempSync(join(tmpdir(), 'project-tasks-env-valid-'));
  try {
    writeFileSync(join(directory, '.env'), [
      ...requiredEnv.map(([key, value]) => `${key}=${value}`),
      'ALLOWED_ORIGINS=http://localhost:3543',
      'LOG_LEVEL=warn'
    ].join('\n'));
    const result = runEntry(envModule, directory, `
      const { env } = await import(${JSON.stringify(envModule)});
      process.stdout.write(JSON.stringify({ port: env.port, serviceUrl: env.serviceUrl, authMode: env.authMode, leaseMinutes: env.leaseMinutes }));
    `);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, JSON.stringify({ port: 3543, serviceUrl: 'http://localhost:3543', authMode: 'trusted_local', leaseMinutes: 30 }));
    assert.equal(result.stderr, '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [missingKey] of requiredEnv) {
  test(`falha se ${missingKey} estiver ausente do .env mesmo presente no processo`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'project-tasks-env-single-missing-'));
    try {
      writeFileSync(join(directory, '.env'), requiredEnv
        .filter(([key]) => key !== missingKey)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'));
      const result = runEntry(envModule, directory);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(`Configuração incompleta no .env. Defina: ${missingKey}.`), result.stderr);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('MCP encerra antes de conectar ou escutar se faltam variáveis obrigatórias no .env', () => {
  const directory = mkdtempSync(join(tmpdir(), 'project-tasks-env-missing-'));
  try {
    const result = runEntry(mainModule, directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Configuração incompleta no \.env/);
    assert.match(result.stderr, /MONGODB_URI, PORT, SERVICE_URL, MCP_AUTH_MODE, LEASE_MINUTES/);
    assert.doesNotMatch(result.stderr, /MongoServerSelectionError|ECONNREFUSED|Project Tasks MCP ready/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
