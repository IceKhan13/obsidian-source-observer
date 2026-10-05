import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitRepo } from '../src/git/GitRepo';
import { RepoSnapshot, RepoState } from '../src/services/RepoState';
import { git, makeRepo, remove, tempDir, write } from './helpers';

const cleanup: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	while (cleanup.length) remove(cleanup.pop() ?? '');
});

describe('RepoState', () => {
	it('classifies folders', async () => {
		const plain = tempDir();
		const repo = makeRepo({ 'a.txt': 'a\n' });
		cleanup.push(plain, repo);
		const state = new RepoState();

		await state.open(path.join(plain, 'nope'));
		expect(state.snapshot.kind).toBe('missing-folder');
		await state.open(plain);
		expect(state.snapshot.kind).toBe('not-repo');
		await state.open(repo);
		expect(state.snapshot.kind).toBe('repo');
	});

	it('coalesces concurrent refreshes into at most one extra run', async () => {
		const root = makeRepo({ 'a.txt': 'a\n' });
		cleanup.push(root);
		const state = new RepoState();
		await state.open(root);

		const spy = vi.spyOn(GitRepo.prototype, 'status');
		await Promise.all([state.refresh(), state.refresh(), state.refresh(), state.refresh(), state.refresh()]);
		expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
	});

	it('drops results from a folder that was replaced mid-refresh', async () => {
		const a = makeRepo({ 'a.txt': 'a\n' });
		const b = makeRepo({ 'b.txt': 'b\n' });
		cleanup.push(a, b);
		write(a, 'a.txt', 'changed\n');

		const state = new RepoState();
		const seen: RepoSnapshot[] = [];
		state.onChange((s) => seen.push(s));
		const first = state.open(a);
		const second = state.open(b);
		await Promise.all([first, second]);

		expect(state.snapshot.kind === 'repo' && state.snapshot.folder).toBe(b);
		// Nothing from `a` was ever published.
		expect(seen.every((s) => s.kind === 'repo' && s.folder === b)).toBe(true);
	});

	it('only notifies when the status actually changes', async () => {
		const root = makeRepo({ 'a.txt': 'a\n' });
		cleanup.push(root);
		const state = new RepoState();
		const listener = vi.fn();
		state.onChange(listener);
		await state.open(root);
		await state.refresh();
		await state.refresh();
		expect(listener).toHaveBeenCalledTimes(1);

		write(root, 'a.txt', 'b\n');
		await state.refresh();
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it('notices a repository created after the folder was opened', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		const state = new RepoState();
		await state.open(dir);
		expect(state.snapshot.kind).toBe('not-repo');
		git(dir, 'init', '-q');
		await state.refresh();
		expect(state.snapshot.kind).toBe('repo');
	});
});
