import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatPatch, formatPatchNote, patchHunks } from '../src/utils/patch';
import { lineDiff } from '../src/utils/lineDiff';
import { git, makeRepo, remove, write } from './helpers';

const cleanup: string[] = [];
afterEach(() => {
	while (cleanup.length) remove(cleanup.pop() ?? '');
});

const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`);

describe('lineDiff', () => {
	it('reports replaced, inserted and deleted runs of lines', () => {
		expect(lineDiff(['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual([{ fromA: 1, toA: 2, fromB: 1, toB: 2 }]);
		expect(lineDiff(['a', 'c'], ['a', 'b', 'c'])).toEqual([{ fromA: 1, toA: 1, fromB: 1, toB: 2 }]);
		expect(lineDiff(['a', 'b'], ['a', 'b'])).toEqual([]);
	});
});

describe('patchHunks and formatPatch', () => {
	it('formats a change with three lines of context, like git diff', () => {
		const a = numbered(10);
		const b = [...a];
		b[4] = 'line five';
		const patch = formatPatch({ oldPath: 'src/a.ts', newPath: 'src/a.ts' }, patchHunks(a.join('\n') + '\n', b.join('\n') + '\n'));
		expect(patch).toBe([
			'diff --git a/src/a.ts b/src/a.ts',
			'--- a/src/a.ts',
			'+++ b/src/a.ts',
			'@@ -2,7 +2,7 @@',
			' line 2',
			' line 3',
			' line 4',
			'-line 5',
			'+line five',
			' line 6',
			' line 7',
			' line 8',
			'',
		].join('\n'));
	});

	it('merges nearby changes into one hunk and keeps distant ones apart', () => {
		const a = numbered(40);
		const near = [...a];
		near[4] = 'x';
		near[9] = 'y';
		expect(patchHunks(a.join('\n'), near.join('\n'))).toHaveLength(1);
		const far = [...a];
		far[2] = 'x';
		far[30] = 'y';
		const hunks = patchHunks(a.join('\n'), far.join('\n'));
		expect(hunks.map((h) => h.header)).toEqual(['@@ -1,6 +1,6 @@', '@@ -28,7 +28,7 @@']);
		expect(hunks.map((h) => h.anchor)).toEqual([3, 31]);
	});

	it('marks a missing newline at the end of the file', () => {
		const hunks = patchHunks('a\nb', 'a\nb\n');
		expect(hunks[0]?.lines).toEqual([' a', '-b', '\\ No newline at end of file', '+b']);
		expect(patchHunks('a\nb', 'a\nc')[0]?.lines).toEqual([' a', '-b', '\\ No newline at end of file', '+c', '\\ No newline at end of file']);
	});

	it('uses /dev/null for new and deleted files', () => {
		const added = formatPatch({ oldPath: null, newPath: 'n.txt' }, patchHunks('', 'one\ntwo\n'));
		expect(added.split('\n').slice(0, 5)).toEqual([
			'diff --git a/n.txt b/n.txt',
			'new file mode 100644',
			'--- /dev/null',
			'+++ b/n.txt',
			'@@ -0,0 +1,2 @@',
		]);
		const deleted = formatPatch({ oldPath: 'd.txt', newPath: null }, patchHunks('x\n', ''));
		expect(deleted).toContain('--- a/d.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n');
	});

	it('describes renames, and is empty when nothing changed', () => {
		expect(formatPatch({ oldPath: 'old.ts', newPath: 'new.ts' }, [])).toBe(
			'diff --git a/old.ts b/new.ts\nrename from old.ts\nrename to new.ts\n',
		);
		expect(formatPatch({ oldPath: 'a.ts', newPath: 'a.ts' }, patchHunks('same\n', 'same\n'))).toBe('');
		expect(formatPatchNote({ oldPath: 'i.png', newPath: 'i.png' }, 'Binary files differ')).toBe(
			'diff --git a/i.png b/i.png\nBinary files differ\n',
		);
	});

	it('produces patches that git apply accepts', () => {
		const before = numbered(60);
		const after = [...before];
		after[0] = 'first';
		after.splice(20, 3, 'replaced');
		after.splice(45, 0, 'inserted', 'twice');
		after.push('no newline at the end');
		const root = makeRepo({ 'src/f.ts': before.join('\n') + '\n', 'gone.txt': 'bye\n', 'crlf.txt': 'a\r\nb\r\n' });
		cleanup.push(root);
		const files = [
			{ paths: { oldPath: 'src/f.ts', newPath: 'src/f.ts' }, from: before.join('\n') + '\n', to: after.join('\n') },
			{ paths: { oldPath: 'gone.txt', newPath: null }, from: 'bye\n', to: '' },
			{ paths: { oldPath: null, newPath: 'new/file.md' }, from: '', to: '# New\n' },
			{ paths: { oldPath: 'crlf.txt', newPath: 'crlf.txt' }, from: 'a\r\nb\r\n', to: 'a\r\nc\r\n' },
		];
		const patch = files.map((f) => formatPatch(f.paths, patchHunks(f.from, f.to))).join('');
		write(root, 'change.patch', patch);
		git(root, 'apply', 'change.patch');
		expect(readFileSync(path.join(root, 'src/f.ts'), 'utf-8')).toBe(after.join('\n'));
		expect(existsSync(path.join(root, 'gone.txt'))).toBe(false);
		expect(readFileSync(path.join(root, 'new/file.md'), 'utf-8')).toBe('# New\n');
		expect(readFileSync(path.join(root, 'crlf.txt'), 'utf-8')).toBe('a\r\nc\r\n');
	});
});
