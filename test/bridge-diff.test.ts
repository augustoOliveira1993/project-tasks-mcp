import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DIFF_FLAGS, limitPatch } from '../src/bridge/diff.js';

const section = (path: string, size: number) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-${'a'.repeat(size)}\n+${'b'.repeat(size)}\n`;

test('patch dentro do limite passa intacto', () => {
  const patch = section('src/a.ts', 10);
  assert.deepEqual(limitPatch(patch, 1024), { patch, truncated: false, omittedFiles: 0 });
});

test('arquivo grande é omitido inteiro sem derrubar os demais', () => {
  const small = section('src/small.ts', 20);
  const huge = section('src/huge.ts', 5000);
  const other = section('src/other.ts', 20);
  const result = limitPatch(small + huge + other, 1024);
  assert.equal(result.truncated, true);
  assert.equal(result.omittedFiles, 1);
  assert.equal(result.patch, small + other);
  assert.ok(!result.patch.includes('huge.ts'));
});

test('quando nenhum arquivo cabe, não há patch mas o corte é sinalizado', () => {
  const result = limitPatch(section('src/huge.ts', 5000), 1024);
  assert.deepEqual(result, { patch: '', truncated: true, omittedFiles: 1 });
});

test('limite é medido em bytes, não em caracteres', () => {
  const accented = section('src/a.ts', 400).replace(/a/g, 'á');
  assert.equal(limitPatch(accented, 800).truncated, true);
});

test('as flags tornam a saída do Git independente da configuração do usuário', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ptm-diff-'));
  const run = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  try {
    run('init', '-q');
    run('config', 'user.email', 't@t.com');
    run('config', 'user.name', 'T');
    run('config', 'diff.noprefix', 'true');
    run('config', 'diff.mnemonicPrefix', 'true');
    run('config', 'color.ui', 'always');
    writeFileSync(join(dir, 'a.ts'), 'um\ndois\n');
    writeFileSync(join(dir, 'velho.ts'), 'conteudo longo o bastante para ser detectado como renomeado\nsegunda linha igual\n');
    run('add', '.');
    run('commit', '-qm', 'base');
    const base = run('rev-parse', 'HEAD').trim();
    writeFileSync(join(dir, 'a.ts'), 'um\ntres\n');
    run('mv', 'velho.ts', 'novo.ts');
    run('add', '.');
    run('commit', '-qm', 'mudanca');
    const patch = run('diff', ...DIFF_FLAGS, `${base}..HEAD`);
    assert.ok(patch.startsWith('diff --git a/a.ts b/a.ts'), 'prefixos a/ e b/ fixos');
    assert.ok(!patch.includes('\u001b['), 'sem cores ANSI');
    assert.match(patch, /rename from velho\.ts\nrename to novo\.ts/);
    assert.deepEqual(run('diff', '--name-only', ...DIFF_FLAGS, `${base}..HEAD`).split('\n').filter(Boolean), ['a.ts', 'novo.ts']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
