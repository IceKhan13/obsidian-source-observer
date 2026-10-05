// @vitest-environment jsdom
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { Component } from 'obsidian';
import { GitRepo } from '../src/git/GitRepo';
import { ChangeEntry, groupChanges } from '../src/git/status';
import type { RepoSnapshot } from '../src/services/RepoState';
import { ContentPane } from '../src/ui/pane/ContentPane';
import { ChangesSection } from '../src/ui/sidebar/ChangesSection';
import { FileTree } from '../src/ui/sidebar/FileTree';
import { makeRepo, remove, tempDir, write } from './helpers';

const cleanup: string[] = [];
const roots: Component[] = [];
afterEach(() => {
	for (const c of roots.splice(0)) c.unload();
	document.body.innerHTML = '';
	while (cleanup.length) remove(cleanup.pop() ?? '');
});

function host(): { owner: Component; el: HTMLElement } {
	const owner = new Component();
	owner.load();
	roots.push(owner);
	return { owner, el: document.body.createDiv() };
}

async function repoWithChange(): Promise<{ root: string; repo: GitRepo; entry: ChangeEntry }> {
	const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
	const root = makeRepo({ 'big.ts': lines, 'other.ts': 'export const x = 1;\n' });
	cleanup.push(root);
	write(root, 'big.ts', lines.replace('line 100', 'line one hundred'));
	const opened = await GitRepo.open(root);
	if (opened.kind !== 'repo') throw new Error('not a repo');
	const [entry] = groupChanges((await opened.repo.status()).files);
	return { root, repo: opened.repo, entry: entry as ChangeEntry };
}

describe('ContentPane', () => {
	it('fully replaces a diff when a file is opened (regression: diff stayed above the editor)', async () => {
		const { root, repo, entry } = await repoWithChange();
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, 13));
		const body = el.querySelector('.so-pane') as HTMLElement;

		await pane.showDiff(repo, entry, 'big.ts');
		expect(body.querySelectorAll('.so-diff-view')).toHaveLength(1);
		expect(el.querySelector('.so-pane-stats')?.textContent).toBe('+1−1');

		await pane.showFile(path.join(root, 'other.ts'), 'other.ts');
		expect(body.querySelectorAll('.so-renderer')).toHaveLength(1);
		expect(body.querySelectorAll('.so-diff-view')).toHaveLength(0);
		expect(body.querySelectorAll('.cm-editor')).toHaveLength(1);
		expect(body.textContent).toContain('export const x = 1;');
		expect(el.querySelector('.so-path-label')?.textContent).toBe('other.ts');
	});

	it('never lets a slower earlier load overwrite a newer one (regression: label and content disagreed)', async () => {
		const { root, repo, entry } = await repoWithChange();
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, 13));

		// The diff needs several git calls; the file read is a single fs call.
		const slow = pane.showDiff(repo, entry, 'big.ts');
		const fast = pane.showFile(path.join(root, 'other.ts'), 'other.ts');
		await Promise.all([slow, fast]);

		expect(el.querySelector('.so-path-label')?.textContent).toBe('other.ts');
		expect(el.querySelectorAll('.so-diff-view')).toHaveLength(0);
		expect(el.querySelector('.so-pane')?.textContent).toContain('export const x = 1;');
	});

	it('reuses one editor across files and destroys it on unload', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		write(dir, 'a.py', 'print(1)\n');
		write(dir, 'b.go', 'package main\n');
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, 13));

		await pane.showFile(path.join(dir, 'a.py'), 'a.py');
		const editor = el.querySelector('.cm-editor');
		await pane.showFile(path.join(dir, 'b.go'), 'b.go');
		expect(el.querySelector('.cm-editor')).toBe(editor);
		expect(el.textContent).toContain('package main');

		owner.removeChild(pane);
		expect(el.querySelectorAll('.cm-editor')).toHaveLength(0);
	});

	it('shows a message instead of loading binary files', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		write(dir, 'img.png', Buffer.from([0x89, 0x50, 0, 0, 1]));
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, 13));
		await pane.showFile(path.join(dir, 'img.png'), 'img.png');
		expect(el.querySelectorAll('.cm-editor')).toHaveLength(0);
		expect(el.querySelector('.so-message-text')?.textContent).toBe('Binary file');
	});
});

describe('ChangesSection', () => {
	it('keeps the selected row across refreshes (regression: highlight was wiped every poll)', async () => {
		const { repo } = await repoWithChange();
		const status = await repo.status();
		const { owner, el } = host();
		const opened: ChangeEntry[] = [];
		const section = owner.addChild(new ChangesSection(el, { onOpenDiff: (e) => opened.push(e), onRefresh: () => {} }));
		const snapshot: RepoSnapshot = { kind: 'repo', folder: repo.folder, repo, status };

		section.update(snapshot);
		const row = el.querySelector<HTMLElement>('.so-change-row');
		row?.click();
		expect(opened).toHaveLength(1);

		section.update({ ...snapshot, status: { ...status } });
		const active = el.querySelectorAll('.so-change-row.is-active');
		expect(active).toHaveLength(1);
		expect(active[0]?.textContent).toContain('big.ts');
	});

	it('shows a clear message per state', () => {
		const { owner, el } = host();
		const section = owner.addChild(new ChangesSection(el, { onOpenDiff: () => {}, onRefresh: () => {} }));
		section.update({ kind: 'no-git', folder: '/x' });
		expect(el.querySelector('.so-empty')?.textContent).toBe('Git is not installed or not on PATH');
		section.update({ kind: 'not-repo', folder: '/x' });
		expect(el.querySelector('.so-empty')?.textContent).toBe('Not a git repository');
	});
});

describe('FileTree', () => {
	it('picks up new files on refresh and keeps folders expanded', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		write(dir, 'src/a.ts', '');
		const { owner, el } = host();
		const tree = new FileTree(owner, el, true, () => {});
		await tree.load(dir);

		const srcRow = [...el.querySelectorAll<HTMLElement>('.so-tree-dir')].find((r) => r.textContent === 'src');
		srcRow?.click();
		await new Promise((r) => setTimeout(r, 20));
		expect(el.textContent).toContain('a.ts');

		write(dir, 'src/b.ts', '');
		await tree.refresh();
		expect(el.textContent).toContain('b.ts');
		expect(srcRow?.getAttribute('aria-expanded')).toBe('true');
	});

	it('decorates changed files and their folders', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		write(dir, 'src/a.ts', '');
		const { owner, el } = host();
		const tree = new FileTree(owner, el, true, () => {});
		await tree.load(dir);
		tree.setDecorations(new Map(), new Set([dir, path.join(dir, 'src')]));
		const srcRow = [...el.querySelectorAll<HTMLElement>('.so-tree-dir')].find((r) => r.textContent === 'src');
		expect(srcRow?.classList.contains('so-git-dirty')).toBe(true);
	});

	it('navigates with the keyboard', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		write(dir, 'src/a.ts', '');
		write(dir, 'z.txt', '');
		const selected: string[] = [];
		const { owner, el } = host();
		const tree = new FileTree(owner, el, true, (p) => selected.push(p));
		await tree.load(dir);

		const key = (k: string) => (el.ownerDocument.activeElement ?? el).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
		el.focus();
		key('ArrowDown'); // root → src
		key('ArrowRight'); // expand src
		await new Promise((r) => setTimeout(r, 20));
		key('ArrowRight'); // move into src → a.ts
		key('Enter');
		expect(selected).toEqual([path.join(dir, 'src', 'a.ts')]);
	});
});
