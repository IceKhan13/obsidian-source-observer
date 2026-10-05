import { statSync } from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRepo } from '../src/git/GitRepo';
import { loadDiffSides } from '../src/git/diffSources';
import { groupChanges, ChangeEntry } from '../src/git/status';
import { git, makeRepo, remove, tempDir, write } from './helpers';

const cleanup: string[] = [];
afterEach(() => { while (cleanup.length) remove(cleanup.pop() ?? ''); });

function repoWith(files: Record<string, string>): string {
	const root = makeRepo(files);
	cleanup.push(root);
	return root;
}

async function open(folder: string): Promise<GitRepo> {
	const result = await GitRepo.open(folder);
	if (result.kind !== 'repo') throw new Error(`expected a repo, got ${result.kind}`);
	return result.repo;
}

function text(content: { kind: string; text?: string }): string | null {
	return content.kind === 'text' ? content.text ?? '' : null;
}

describe('GitRepo.open', () => {
	it('reports a plain folder as not a repository', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		expect((await GitRepo.open(dir)).kind).toBe('not-repo');
	});

	it('resolves root, git dir and prefix from a subfolder', async () => {
		const root = repoWith({ 'src/a.ts': 'a\n' });
		const repo = await open(path.join(root, 'src'));
		expect(repo.root).toBe(root);
		expect(repo.gitDir).toBe(path.join(root, '.git'));
		expect(repo.commonDir).toBe(path.join(root, '.git'));
		expect(repo.prefix).toBe('src/');
	});

	it('distinguishes the per-worktree git dir from the common dir in linked worktrees', async () => {
		const root = repoWith({ 'a.txt': 'a\n' });
		const wt = path.join(tempDir(), 'wt');
		cleanup.push(path.dirname(wt));
		git(root, 'worktree', 'add', '-q', wt);
		const repo = await open(wt);
		expect(repo.commonDir).toBe(path.join(root, '.git'));
		expect(repo.gitDir).toBe(path.join(root, '.git', 'worktrees', 'wt'));
	});
});

describe('status in a subfolder (regression: paths were joined twice)', () => {
	it('lists only changes inside the opened folder and maps them to real files', async () => {
		const root = repoWith({ 'src/a.ts': 'a\n', 'root.txt': 'r\n' });
		write(root, 'src/a.ts', 'a\nb\n');
		write(root, 'src/new.ts', 'n\n');
		write(root, 'root.txt', 'r\nx\n');

		const repo = await open(path.join(root, 'src'));
		const status = await repo.status();
		expect(status.files.map((f) => f.path).sort()).toEqual(['src/a.ts', 'src/new.ts']);
		for (const f of status.files) {
			expect(statSync(repo.absPath(f.path)).isFile()).toBe(true);
		}
		expect(repo.absPath('src/a.ts')).toBe(path.join(root, 'src', 'a.ts'));
	});

	it('produces a real diff for a modified file in the subfolder', async () => {
		const root = repoWith({ 'src/a.ts': 'a\n' });
		write(root, 'src/a.ts', 'a\nb\n');
		const repo = await open(path.join(root, 'src'));
		const [entry] = groupChanges((await repo.status()).files);
		expect(entry).toBeDefined();
		const sides = await loadDiffSides(repo, entry as ChangeEntry);
		expect(text(sides.original)).toBe('a\n');
		expect(text(sides.modified)).toBe('a\nb\n');
	});
});

describe('status does not rewrite the index (regression: watcher died, index.lock races)', () => {
	it('leaves .git/index untouched even when stat info is stale', async () => {
		const root = repoWith({ 'a.txt': 'a\n' });
		const index = path.join(root, '.git', 'index');
		// Make the cached stat data stale so a locking `git status` would refresh it.
		await new Promise((r) => setTimeout(r, 1100));
		write(root, 'a.txt', 'a\n');
		const before = statSync(index);
		const repo = await open(root);
		await repo.status();
		const after = statSync(index);
		expect(after.ino).toBe(before.ino);
		expect(after.mtimeMs).toBe(before.mtimeMs);
	});
});

describe('diff sides', () => {
	it('uses HEAD → index for staged changes and index → worktree for unstaged ones', async () => {
		const root = repoWith({ 'f.txt': 'one\n' });
		write(root, 'f.txt', 'two\n');
		git(root, 'add', 'f.txt');
		write(root, 'f.txt', 'three\n');
		const repo = await open(root);
		const entries = groupChanges((await repo.status()).files);
		const staged = entries.find((e) => e.group === 'staged');
		const unstaged = entries.find((e) => e.group === 'unstaged');
		expect(staged && unstaged).toBeTruthy();

		const s = await loadDiffSides(repo, staged as ChangeEntry);
		expect([text(s.original), text(s.modified)]).toEqual(['one\n', 'two\n']);
		const u = await loadDiffSides(repo, unstaged as ChangeEntry);
		expect([text(u.original), text(u.modified)]).toEqual(['two\n', 'three\n']);
	});

	it('compares a staged rename against the original path', async () => {
		const root = repoWith({ 'old.txt': 'same\n' });
		git(root, 'mv', 'old.txt', 'new.txt');
		write(root, 'new.txt', 'same\nmore\n');
		git(root, 'add', 'new.txt');
		const repo = await open(root);
		const entries = groupChanges((await repo.status()).files);
		const rename = entries.find((e) => e.kind === 'renamed');
		expect(rename?.file.origPath).toBe('old.txt');
		const sides = await loadDiffSides(repo, rename as ChangeEntry);
		expect([text(sides.original), text(sides.modified)]).toEqual(['same\n', 'same\nmore\n']);
	});

	it('treats untracked files as added and deleted files as removed', async () => {
		const root = repoWith({ 'gone.txt': 'bye\n' });
		write(root, 'fresh.txt', 'hi\n');
		remove(path.join(root, 'gone.txt'));
		const repo = await open(root);
		const entries = groupChanges((await repo.status()).files);

		const fresh = await loadDiffSides(repo, entries.find((e) => e.kind === 'untracked') as ChangeEntry);
		expect(fresh.original.kind).toBe('missing');
		expect(text(fresh.modified)).toBe('hi\n');

		const gone = await loadDiffSides(repo, entries.find((e) => e.kind === 'deleted') as ChangeEntry);
		expect(text(gone.original)).toBe('bye\n');
		expect(gone.modified.kind).toBe('missing');
	});

	it('works before the first commit', async () => {
		const root = repoWith({});
		write(root, 'a.txt', 'a\n');
		git(root, 'add', 'a.txt');
		const repo = await open(root);
		const status = await repo.status();
		expect(status.branch.oid).toBeNull();
		const [entry] = groupChanges(status.files);
		const sides = await loadDiffSides(repo, entry as ChangeEntry);
		expect(sides.original.kind).toBe('missing');
		expect(text(sides.modified)).toBe('a\n');
	});

	it('refuses binary blobs', async () => {
		const root = repoWith({});
		write(root, 'bin.dat', Buffer.from([1, 0, 2, 0, 3]));
		git(root, 'add', 'bin.dat');
		git(root, 'commit', '-q', '-m', 'bin');
		const repo = await open(root);
		expect((await repo.readBlob('HEAD:bin.dat')).kind).toBe('binary');
	});

	it('handles paths with glob characters literally', async () => {
		const root = repoWith({ 'a[1].txt': 'x\n', 'a1.txt': 'y\n' });
		write(root, 'a[1].txt', 'x\nz\n');
		const repo = await open(root);
		const status = await repo.status();
		expect(status.files.map((f) => f.path)).toEqual(['a[1].txt']);
	});
});

describe('listFiles', () => {
	it('honours .gitignore, includes untracked files and is relative to the opened folder', async () => {
		const root = repoWith({ '.gitignore': 'dist/\n', 'src/a.ts': 'a\n', 'other.txt': 'o\n' });
		write(root, 'src/new.ts', 'n\n');
		write(root, 'src/dist/out.js', 'x\n');
		write(root, 'dist/out.js', 'x\n');
		const repo = await open(path.join(root, 'src'));
		expect((await repo.listFiles()).sort()).toEqual(['a.ts', 'new.ts']);
	});
});
