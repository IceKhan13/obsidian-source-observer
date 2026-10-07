// @vitest-environment jsdom
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { parseNameStatus } from '../src/git/baseDiff';
import { loadDiffSides } from '../src/git/diffSources';
import { GitRepo } from '../src/git/GitRepo';
import { compareWithBase } from '../src/services/BaseComparison';
import { RepoState } from '../src/services/RepoState';
import { sanitizeSettings, setBaseBranch, MAX_BASE_BRANCHES } from '../src/settings';
import { ChangesSection } from '../src/ui/sidebar/ChangesSection';
import { git, makeRepo, remove, tempDir, write } from './helpers';

const cleanup: string[] = [];
const roots: Component[] = [];
afterEach(() => {
	for (const c of roots.splice(0)) c.unload();
	document.body.innerHTML = '';
	while (cleanup.length) remove(cleanup.pop() ?? '');
});

async function open(folder: string): Promise<GitRepo> {
	const result = await GitRepo.open(folder);
	if (result.kind !== 'repo') throw new Error(`expected a repo, got ${result.kind}`);
	return result.repo;
}

function commit(root: string, message: string) {
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', message);
}

/**
 * `main` with a few files, and a `feature` branch two commits ahead that
 * renames, edits and deletes files, plus staged, unstaged and untracked work.
 */
function featureRepo(): string {
	const body = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n';
	const root = makeRepo({ 'keep.txt': 'keep\n', 'edit.txt': 'v1\n', 'gone.txt': 'g\n', 'old.txt': body, 'sub/s.txt': 's\n' });
	cleanup.push(root);
	git(root, 'checkout', '-q', '-b', 'feature');
	write(root, 'edit.txt', 'v2\n');
	commit(root, 'Edit');
	git(root, 'mv', 'old.txt', 'new.txt');
	git(root, 'rm', '-q', 'gone.txt');
	commit(root, 'Rename and delete');
	// main moves on too; that must not show up as changes.
	git(root, 'checkout', '-q', 'main');
	write(root, 'main-only.txt', 'm\n');
	commit(root, 'Main moves on');
	git(root, 'checkout', '-q', 'feature');
	write(root, 'staged.txt', 'st\n');
	git(root, 'add', 'staged.txt');
	write(root, 'sub/s.txt', 's2\n');
	write(root, 'untracked.txt', 'u\n');
	return root;
}

describe('parseNameStatus', () => {
	it('parses statuses, renames and copies', () => {
		expect(parseNameStatus('M\0a.ts\0A\0b.ts\0D\0c.ts\0R087\0old.ts\0new.ts\0C100\0x.ts\0y.ts\0T\0link\0')).toEqual([
			{ path: 'a.ts', kind: 'modified' },
			{ path: 'b.ts', kind: 'added' },
			{ path: 'c.ts', kind: 'deleted' },
			{ path: 'new.ts', origPath: 'old.ts', kind: 'renamed' },
			{ path: 'y.ts', origPath: 'x.ts', kind: 'renamed' },
			{ path: 'link', kind: 'modified' },
		]);
		expect(parseNameStatus('')).toEqual([]);
	});
});

describe('base branch git helpers', () => {
	it('finds a local default branch, lists branches and counts commits since the merge base', async () => {
		const root = featureRepo();
		const repo = await open(root);
		expect(await repo.defaultBase()).toBe('main');
		expect(await repo.branches()).toEqual(['feature', 'main']);
		const base = await repo.mergeBase('main');
		expect(await repo.commitsSince(base)).toBe(2);
		expect(await repo.hasCommit('main')).toBe(true);
		expect(await repo.hasCommit('nope')).toBe(false);
	});

	it('prefers the remote default branch', async () => {
		const origin = makeRepo({ 'a.txt': 'a\n' });
		const dir = tempDir();
		cleanup.push(origin, dir);
		const clone = path.join(dir, 'clone');
		git(dir, 'clone', '-q', origin, clone);
		const repo = await open(clone);
		expect(await repo.defaultBase()).toBe('origin/main');
		expect(await repo.branches()).toEqual(['main', 'origin/main']);
	});
});

describe('compareWithBase', () => {
	it('lists committed, staged, unstaged and untracked changes since the merge base', async () => {
		const root = featureRepo();
		const repo = await open(root);
		const result = await compareWithBase(repo, 'main', await repo.status());
		if (result.kind !== 'ok') throw new Error(result.message);
		expect(result.ahead).toBe(2);
		expect(result.entries.map((e) => [e.file.path, e.kind, e.file.origPath ?? null])).toEqual([
			['edit.txt', 'modified', null],
			['gone.txt', 'deleted', null],
			['new.txt', 'renamed', 'old.txt'],
			['staged.txt', 'added', null],
			['sub/s.txt', 'modified', null],
			['untracked.txt', 'untracked', null],
		]);
		expect(result.entries.every((e) => e.group === 'base' && e.base?.commit === result.commit)).toBe(true);
	});

	it('is limited to the opened subfolder', async () => {
		const root = featureRepo();
		const repo = await open(path.join(root, 'sub'));
		const result = await compareWithBase(repo, 'main', await repo.status());
		if (result.kind !== 'ok') throw new Error(result.message);
		expect(result.entries.map((e) => e.file.path)).toEqual(['sub/s.txt']);
	});

	it('explains a missing base, an unknown branch and unrelated history', async () => {
		const root = featureRepo();
		const repo = await open(root);
		const status = await repo.status();
		expect(await compareWithBase(repo, null, status)).toMatchObject({ kind: 'error', message: expect.stringMatching(/No base branch/) as unknown });
		expect(await compareWithBase(repo, 'nope', status)).toMatchObject({ kind: 'error', message: 'Branch nope not found' });
		git(root, 'checkout', '-q', '--orphan', 'island');
		git(root, 'commit', '-q', '-m', 'island');
		expect(await compareWithBase(repo, 'main', await repo.status())).toMatchObject({ kind: 'error', message: 'No common history with main' });
	});

	it('diffs a file from the merge base to the working tree', async () => {
		const root = featureRepo();
		const repo = await open(root);
		const result = await compareWithBase(repo, 'main', await repo.status());
		if (result.kind !== 'ok') throw new Error(result.message);
		const byPath = new Map(result.entries.map((e) => [e.file.path, e]));
		const edit = await loadDiffSides(repo, byPath.get('edit.txt')!);
		expect(edit).toEqual({ original: { kind: 'text', text: 'v1\n' }, modified: { kind: 'text', text: 'v2\n' } });
		const renamed = await loadDiffSides(repo, byPath.get('new.txt')!);
		expect(renamed.original).toEqual(renamed.modified);
		expect((await loadDiffSides(repo, byPath.get('untracked.txt')!)).original.kind).toBe('missing');
		expect((await loadDiffSides(repo, byPath.get('gone.txt')!)).modified.kind).toBe('missing');
	});
});

describe('base branch settings', () => {
	it('sanitizes stored values and keeps the per-repository map bounded', () => {
		expect(sanitizeSettings({}).compareWithBase).toBe(false);
		expect(sanitizeSettings({ baseBranches: { '/a/.git': 'main', '/b/.git': 3, '': 'x' } }).baseBranches).toEqual({ '/a/.git': 'main' });
		let map: Record<string, string> = {};
		for (let i = 0; i < MAX_BASE_BRANCHES + 5; i++) map = setBaseBranch(map, `/r${i}`, 'main');
		map = setBaseBranch(map, '/r10', 'develop');
		expect(Object.keys(map)).toHaveLength(MAX_BASE_BRANCHES);
		expect(map['/r10']).toBe('develop');
		expect(Object.keys(map).at(-1)).toBe('/r10');
	});
});

describe('ChangesSection in base mode', () => {
	it('shows the comparison, its base line and the toggle state, and switches back', async () => {
		const root = featureRepo();
		const owner = new Component();
		owner.load();
		roots.push(owner);
		const el = document.body.createDiv();
		const onToggleBase = vi.fn();
		const onBaseClick = vi.fn();
		const changes = owner.addChild(new ChangesSection(el, { onOpenDiff: () => undefined, onRefresh: () => undefined, onToggleBase, onBaseClick }));
		const state = new RepoState();
		state.onChange((s) => changes.update(s));
		await state.open(root);
		state.dispose();
		const snapshot = state.snapshot;
		if (snapshot.kind !== 'repo') throw new Error('not a repo');

		const toggle = el.querySelector<HTMLElement>('.so-base-toggle');
		expect(toggle?.getAttribute('aria-pressed')).toBe('false');
		expect(el.querySelectorAll('.so-group-header').length).toBeGreaterThan(0);

		changes.setBase({ kind: 'loading', ref: 'main' });
		expect(el.querySelector('.so-changes')?.textContent).toBe('Comparing…');

		const result = await compareWithBase(snapshot.repo, 'main', snapshot.status);
		changes.setBase(result);
		expect(toggle?.getAttribute('aria-pressed')).toBe('true');
		expect(el.querySelector('.so-base')?.textContent).toBe('Againstmain2 commits');
		expect(el.querySelectorAll('.so-group-header')).toHaveLength(0);
		expect(el.querySelectorAll('.so-change-row')).toHaveLength(6);
		expect(Array.from(el.querySelectorAll('.so-count-badge')).map((b) => b.textContent)).toEqual(['2', '3', '1']);

		el.querySelector<HTMLElement>('.so-base')?.click();
		toggle?.click();
		expect(onBaseClick).toHaveBeenCalledTimes(1);
		expect(onToggleBase).toHaveBeenCalledTimes(1);

		changes.setBase({ kind: 'error', ref: 'nope', message: 'Branch nope not found' });
		expect(el.querySelector('.so-base-error')?.textContent).toBe('Branch nope not found');

		changes.setBase(null);
		expect(el.querySelector('.so-base')?.classList.contains('so-hidden')).toBe(true);
		expect(el.querySelectorAll('.so-group-header').length).toBeGreaterThan(0);
	});
});
