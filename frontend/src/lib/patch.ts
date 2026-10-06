/** Parser de patch unificado (saída de `git diff`) para exibição por arquivo. */

export type DiffLine = { kind: 'context' | 'add' | 'del' | 'note'; text: string; oldNumber?: number; newNumber?: number };
export type DiffHunk = { header: string; lines: DiffLine[] };
export type FileStatus = 'added' | 'deleted' | 'renamed' | 'modified' | 'binary';
export type FileDiff = { path: string; oldPath?: string; status: FileStatus; additions: number; deletions: number; hunks: DiffHunk[]; binary: boolean };

const hunkPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

function unquote(path: string) {
  const trimmed = path.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
}

function stripPrefix(path: string) {
  return /^[ab]\//.test(path) ? path.slice(2) : path;
}

export function parsePatch(patch: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | undefined;
  let hunk: DiffHunk | undefined;
  let oldNumber = 0;
  let newNumber = 0;

  const startFile = (path: string, oldPath?: string) => {
    file = { path, oldPath: oldPath && oldPath !== path ? oldPath : undefined, status: 'modified', additions: 0, deletions: 0, hunks: [], binary: false };
    files.push(file);
    hunk = undefined;
  };

  for (const raw of patch.replace(/\r\n/g, '\n').split('\n')) {
    const header = raw.match(/^diff --git (.+?) (.+)$/);
    if (header) {
      const left = stripPrefix(unquote(header[1]));
      const right = stripPrefix(unquote(header[2]));
      startFile(right, left);
      continue;
    }
    if (!file) {
      // Patch sem cabeçalho `diff --git`: o primeiro `---`/`+++` abre o arquivo.
      if (raw.startsWith('+++ ')) startFile(stripPrefix(unquote(raw.slice(4))));
      else if (raw.startsWith('--- ') || !raw.trim()) continue;
      else if (hunkPattern.test(raw)) startFile('patch');
      else continue;
    }
    const current = file!;
    const match = raw.match(hunkPattern);
    if (match) {
      oldNumber = Number(match[1]);
      newNumber = Number(match[2]);
      hunk = { header: raw, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      if (raw.startsWith('new file mode')) current.status = 'added';
      else if (raw.startsWith('deleted file mode')) current.status = 'deleted';
      else if (raw.startsWith('rename from ')) { current.status = 'renamed'; current.oldPath = unquote(raw.slice(12)); }
      else if (raw.startsWith('rename to ')) { current.status = 'renamed'; current.path = unquote(raw.slice(10)); }
      else if (raw.startsWith('Binary files') || raw.startsWith('GIT binary patch')) { current.binary = true; current.status = 'binary'; }
      else if (raw.startsWith('+++ ')) { const target = unquote(raw.slice(4)); if (target !== '/dev/null') current.path = stripPrefix(target); }
      continue;
    }
    if (raw.startsWith('+')) { current.additions++; hunk.lines.push({ kind: 'add', text: raw.slice(1), newNumber: newNumber++ }); }
    else if (raw.startsWith('-')) { current.deletions++; hunk.lines.push({ kind: 'del', text: raw.slice(1), oldNumber: oldNumber++ }); }
    else if (raw.startsWith('\\')) hunk.lines.push({ kind: 'note', text: raw.slice(1).trim() });
    else if (raw.startsWith(' ')) hunk.lines.push({ kind: 'context', text: raw.slice(1), oldNumber: oldNumber++, newNumber: newNumber++ });
    else if (raw === '') continue;
  }
  return files;
}

export const statusLabels: Record<FileStatus, string> = { added: 'Novo', deleted: 'Removido', renamed: 'Renomeado', modified: 'Modificado', binary: 'Binário' };

export function diffTotals(files: FileDiff[]) {
  return files.reduce((total, item) => ({ additions: total.additions + item.additions, deletions: total.deletions + item.deletions }), { additions: 0, deletions: 0 });
}
