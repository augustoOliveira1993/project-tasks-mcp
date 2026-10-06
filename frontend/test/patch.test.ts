import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ configFile: resolve(process.cwd(), 'frontend/vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
const { parsePatch, diffTotals } = await vite.ssrLoadModule('/src/lib/patch.ts');
after(async () => { await vite.close(); });

const sample = [
  'diff --git a/src/auth.ts b/src/auth.ts',
  'index 111..222 100644',
  '--- a/src/auth.ts',
  '+++ b/src/auth.ts',
  '@@ -1,3 +1,4 @@ export function login',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' return a;',
  'diff --git a/src/novo.ts b/src/novo.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/novo.ts',
  '@@ -0,0 +1,2 @@',
  '+linha 1',
  '+linha 2',
  '\\ No newline at end of file',
  'diff --git a/velho.ts b/renomeado.ts',
  'similarity index 100%',
  'rename from velho.ts',
  'rename to renomeado.ts',
  'diff --git a/img.png b/img.png',
  'Binary files a/img.png and b/img.png differ',
  'diff --git a/gone.ts b/gone.ts',
  'deleted file mode 100644',
  '--- a/gone.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-adeus'
].join('\n');

test('separa o patch por arquivo com status, contagens e numeração de linhas', () => {
  const files = parsePatch(sample);
  assert.deepEqual(files.map((file: { path: string }) => file.path), ['src/auth.ts', 'src/novo.ts', 'renomeado.ts', 'img.png', 'gone.ts']);
  const [auth, novo, renomeado, imagem, removido] = files;
  assert.equal(auth.status, 'modified');
  assert.equal(auth.additions, 2);
  assert.equal(auth.deletions, 1);
  assert.deepEqual(auth.hunks[0].lines.map((line: { kind: string; oldNumber?: number; newNumber?: number }) => [line.kind, line.oldNumber, line.newNumber]), [
    ['context', 1, 1], ['del', 2, undefined], ['add', undefined, 2], ['add', undefined, 3], ['context', 3, 4]
  ]);
  assert.equal(novo.status, 'added');
  assert.equal(novo.hunks[0].lines.at(-1).kind, 'note');
  assert.equal(renomeado.status, 'renamed');
  assert.equal(renomeado.oldPath, 'velho.ts');
  assert.equal(imagem.binary, true);
  assert.equal(removido.status, 'deleted');
  assert.deepEqual(diffTotals(files), { additions: 4, deletions: 2 });
});

test('aceita patch sem cabeçalho diff --git e ignora texto vazio', () => {
  const [file] = parsePatch('--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n');
  assert.equal(file.path, 'x.ts');
  assert.equal(file.additions, 1);
  assert.deepEqual(parsePatch(''), []);
});
