// @vitest-environment jsdom
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { GitRepo } from '../src/git/GitRepo';
import { parseWorktreeList } from '../src/git/worktrees';
import { RepoState } from '../src/services/RepoState';
import { equivalentFolder, loadWorktreeSummaries, WorktreeSummary } from '../src/services/Worktrees';
import { ChangesSection } from '../src/ui/sidebar/ChangesSection';
import { showWorktreeMenu, worktreeDetails, worktreeLocation, worktreeName } from '../src/ui/worktreeMenu';
import { git, makeRepo, remove, tempDir, write } from './helpers';
import { Menu } from './obsidian-shim';

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

/** main repo + linked worktrees: `feat` (dirty), `detached` (locked), `gone` (folder deleted). */
function repoWithWorktrees(): { main: string; feat: string; detached: string } {
	const main = makeRepo({ 'src/a.ts': 'a\n', 'README.md': 'r\n' });
	const dir = tempDir();
	cleanup.push(main, dir);
	const feat = path.join(dir, 'feat');
	const detached = path.join(dir, 'detached');
	const gone = path.join(dir, 'gone');
	git(main, 'worktree', 'add', '-q', '-b', 'feat', feat);
	git(main, 'worktree', 'add', '-q', '--detach', detached);
	git(main, 'worktree', 'lock', '--reason', 'agent busy', detached);
	git(main, 'worktree', 'add', '-q', '-b', 'gone', gone);
	remove(gone);
	write(feat, 'src/a.ts', 'changed\n');
	write(feat, 'src/new.ts', 'n\n');
	return { main, feat, detached };
}

const H = 'c'.repeat(40);

describe('parseWorktreeList', () => {
	it('parses branches, detached heads, bare repositories, locks and prunable entries', () => {
		const out = [
			'worktree /repo', 'bare', '',
			'worktree /repo/wt-a', `HEAD ${H}`, 'branch refs/heads/feature/x', '',
			'worktree /tmp/wt b', `HEAD ${H}`, 'detached', 'locked', '',
			'worktree /tmp/gone', `HEAD ${H}`, 'branch refs/heads/gone', 'locked busy agent', 'prunable gitdir file points to non-existent location', '',
		].join('\n');
		expect(parseWorktreeList(out)).toEqual([
			{ path: '/repo', head: '', branch: null, bare: true, locked: null, prunable: null },
			{ path: '/repo/wt-a', head: H, branch: 'feature/x', bare: false, locked: null, prunable: null },
			{ path: '/tmp/wt b', head: H, branch: null, bare: false, locked: '', prunable: null },
			{ path: '/tmp/gone', head: H, branch: 'gone', bare: false, locked: 'busy agent', prunable: 'gitdir file points to non-existent location' },
		]);
	});
});

describe('loadWorktreeSummaries', () => {
	it('summarises every worktree and marks the current one, from a subfolder of a linked worktree', async () => {
		const { main, feat } = repoWithWorktrees();
		const repo = await open(path.join(feat, 'src'));
		expect(repo.isLinkedWorktree).toBe(true);
		const list = await loadWorktreeSummaries(repo);
		// The main worktree comes first; git orders linked worktrees by path.
		expect(list[0]).toMatchObject({ path: main, branch: 'main', current: false, main: true, available: true, changed: 0 });
		const byName = new Map(list.slice(1).map((w) => [path.basename(w.path), w]));
		expect(byName.get('feat')).toMatchObject({ branch: 'feat', current: true, main: false, available: true, changed: 2 });
		expect(byName.get('detached')).toMatchObject({ branch: null, current: false, available: true, locked: 'agent busy' });
		expect(byName.get('gone')).toMatchObject({ available: false, changed: null });
		expect(byName.get('gone')?.prunable).not.toBeNull();
		expect((await open(main)).isLinkedWorktree).toBe(false);
	});

	it('keeps the same subfolder when switching, falling back to the root', async () => {
		const { feat } = repoWithWorktrees();
		expect(await equivalentFolder(feat, 'src/')).toBe(path.join(feat, 'src'));
		expect(await equivalentFolder(feat, 'missing/')).toBe(feat);
		expect(await equivalentFolder(feat, '')).toBe(feat);
	});
});

function summary(over: Partial<WorktreeSummary>): WorktreeSummary {
	return {
		path: '/code/app', head: H, branch: 'main', bare: false, locked: null, prunable: null,
		current: false, main: false, changed: 0, ahead: 0, behind: 0, available: true, ...over,
	};
}

describe('worktree menu', () => {
	it('describes names, locations and details briefly', () => {
		expect(worktreeName(summary({ branch: null }))).toBe(`detached at ${H.slice(0, 7)}`);
		expect(worktreeLocation(summary({ path: '/code/app/.claude/worktrees/x' }), '/code/app', '/home/me')).toBe('.claude/worktrees/x');
		expect(worktreeLocation(summary({ path: '/home/me/wt/x' }), '/code/app', '/home/me')).toBe('~/wt/x');
		expect(worktreeLocation(summary({ path: '/home/me/app', main: true }), '/home/me/app', '/home/me')).toBe('~/app');
		expect(worktreeDetails(summary({ changed: 3, ahead: 1, behind: 2, locked: 'agent' }))).toBe('3 changed · ↑1 ↓2 · locked: agent');
		expect(worktreeDetails(summary({ changed: null, available: false, prunable: 'gone' }))).toBe('missing — run git worktree prune');
		expect(worktreeDetails(summary({}))).toBe('clean');
	});

	it('checks the current worktree, disables unavailable ones and opens the chosen one', () => {
		const onChoose = vi.fn();
		const list = [
			summary({ path: '/code/app', main: true, current: true }),
			summary({ path: '/code/app/wt/feat', branch: 'feat', changed: 2 }),
			summary({ path: '/code/gone', branch: 'gone', available: false, prunable: 'x', changed: null }),
			summary({ path: '/code/bare', bare: true }),
		];
		showWorktreeMenu(document, { x: 0, y: 0 }, list, onChoose);
		const items = Menu.last?.items ?? [];
		expect(items).toHaveLength(3);
		expect(items.map((i) => [i?.checked, i?.disabled])).toEqual([[true, false], [false, false], [false, true]]);
		expect(items[0]?.fragment?.querySelector('.so-wt-tag')?.textContent).toBe('main worktree');
		// Native menus use the title's plain text (regression: lines ran together).
		expect(items[0]?.fragment?.textContent).toBe('main (main worktree) — /code/app · clean');
		expect(items[1]?.fragment?.textContent).toBe('feat — wt/feat · 2 changed');
		expect(items[2]?.fragment?.textContent).toBe('gone — /code/gone · missing — run git worktree prune');
		void items[0]?.callback();
		expect(onChoose).not.toHaveBeenCalled();
		void items[1]?.callback();
		expect(onChoose).toHaveBeenCalledWith(list[1]);
	});
});

describe('ChangesSection branch line', () => {
	it('opens the switcher on click or Enter and shows the worktree count', async () => {
		const { feat } = repoWithWorktrees();
		const owner = new Component();
		owner.load();
		roots.push(owner);
		const el = document.body.createDiv();
		const onBranchClick = vi.fn();
		const changes = owner.addChild(new ChangesSection(el, { onOpenDiff: () => undefined, onRefresh: () => undefined, onBranchClick }));
		const state = new RepoState();
		state.onChange((s) => changes.update(s));
		await state.open(feat);
		state.dispose();

		const branch = el.querySelector<HTMLElement>('.so-branch');
		expect(branch?.getAttribute('role')).toBe('button');
		expect(el.querySelector('.so-branch-worktrees')).toBeNull();
		changes.setWorktreeCount(4);
		expect(el.querySelector('.so-branch-worktrees')?.textContent).toBe('4');
		expect(el.querySelector('.so-branch-name')?.textContent).toBe('feat');

		branch?.click();
		branch?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		expect(onBranchClick).toHaveBeenCalledTimes(2);
		expect(changes.branchAnchor()).toBe(branch);
	});

	it('stays a plain label without a handler', async () => {
		const root = makeRepo({ 'a.txt': 'a\n' });
		cleanup.push(root);
		const owner = new Component();
		owner.load();
		roots.push(owner);
		const el = document.body.createDiv();
		const changes = owner.addChild(new ChangesSection(el, { onOpenDiff: () => undefined, onRefresh: () => undefined }));
		const state = new RepoState();
		state.onChange((s) => changes.update(s));
		await state.open(root);
		state.dispose();
		changes.setWorktreeCount(3);
		expect(el.querySelector('.so-branch')?.getAttribute('role')).toBeNull();
		expect(el.querySelector('.so-branch-worktrees')).toBeNull();
		expect(el.querySelector('.so-branch-chevron')).toBeNull();
	});
});

describe('linked worktrees inside the repository', () => {
	it('are left out of changes and the file list, unlike unrelated nested repositories', async () => {
		const root = makeRepo({ 'a.txt': 'a\n' });
		const other = makeRepo({ 'x.txt': 'x\n' });
		cleanup.push(root, other);
		git(root, 'worktree', 'add', '-q', '-b', 'agent', '.claude/worktrees/agent');
		git(root, 'init', '-q', 'vendor/lib');
		// A worktree of a different repository that happens to live in this one.
		git(other, 'worktree', 'add', '-q', '-b', 'stray', path.join(root, 'stray'));
		write(root, 'new.txt', 'n\n');

		const repo = await open(root);
		const untracked = (await repo.status()).files.map((f) => f.path).sort();
		expect(untracked).toEqual(['new.txt', 'stray/', 'vendor/lib/']);
		const files = (await repo.listFiles()).sort();
		expect(files).toEqual(['a.txt', 'new.txt', 'stray/', 'vendor/lib/']);

		const summaries = await loadWorktreeSummaries(repo);
		expect(summaries[0]?.changed).toBe(3);
	});
});

