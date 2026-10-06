// @vitest-environment jsdom
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { GitRepo } from '../src/git/GitRepo';
import type { FileCommit } from '../src/git/history';
import { FileIndex } from '../src/services/FileIndex';
import { ContentPane } from '../src/ui/pane/ContentPane';
import { HistorySection } from '../src/ui/sidebar/HistorySection';
import { SearchSection } from '../src/ui/sidebar/SearchSection';
import { git, makeRepo, remove, write } from './helpers';

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

async function openRepo(folder: string): Promise<GitRepo> {
	const opened = await GitRepo.open(folder);
	if (opened.kind !== 'repo') throw new Error('not a repo');
	return opened.repo;
}

/** A repo where `a.ts` has two commits by different authors. */
async function repoWithHistory(): Promise<{ root: string; repo: GitRepo }> {
	const root = makeRepo({ 'a.ts': 'const first = 1;\n', 'b.ts': 'const second = first;\n' });
	cleanup.push(root);
	write(root, 'a.ts', 'const first = 1;\nconst third = 3;\n');
	git(root, 'add', '-A');
	git(root, '-c', 'user.name=Other', '-c', 'user.email=o@x', 'commit', '-q', '--author=Other <o@x>', '-m', 'Add third');
	return { root, repo: await openRepo(root) };
}

describe('SearchSection', () => {
	it('starts collapsed, searches on Enter and opens a match at its line', async () => {
		const { root, repo } = await repoWithHistory();
		const { owner, el } = host();
		const onOpenMatch = vi.fn();
		const section = owner.addChild(new SearchSection(el, { index: new FileIndex(), showHidden: false, onOpenMatch }));
		expect(el.querySelector('.so-section')?.classList.contains('so-section-collapsed')).toBe(true);
		section.setFolder(root);
		section.setRepo(repo);

		section.focus('first');
		expect(el.querySelector('.so-section')?.classList.contains('so-section-collapsed')).toBe(false);
		await vi.waitFor(() => expect(el.querySelectorAll('.so-search-line')).toHaveLength(2));
		expect(el.querySelector('.so-search-summary')?.textContent).toBe('2 results in 2 files');
		const marks = Array.from(el.querySelectorAll('mark')).map((m) => m.textContent);
		expect(marks).toEqual(['first', 'first']);

		const bLine = Array.from(el.querySelectorAll<HTMLElement>('.so-search-line')).find((r) => r.title === 'b.ts:1');
		bLine?.click();
		expect(onOpenMatch).toHaveBeenCalledWith(path.join(root, 'b.ts'), 'b.ts', 1);
	});

	it('collapses a file group and reports invalid regular expressions', async () => {
		const { root, repo } = await repoWithHistory();
		const { owner, el } = host();
		const section = owner.addChild(new SearchSection(el, { index: new FileIndex(), showHidden: false, onOpenMatch: () => undefined }));
		section.setFolder(root);
		section.setRepo(repo);
		section.focus('third');
		await vi.waitFor(() => expect(el.querySelectorAll('.so-search-file')).toHaveLength(1));
		const group = el.querySelector<HTMLElement>('.so-search-file');
		group?.querySelector<HTMLElement>('.so-search-file-row')?.click();
		expect(group?.classList.contains('is-collapsed')).toBe(true);

		const regexBtn = el.querySelector<HTMLElement>('[aria-label="Use regular expression"]');
		const input = el.querySelector<HTMLInputElement>('.so-search-input');
		if (!input || !regexBtn) throw new Error('missing controls');
		input.value = '(';
		regexBtn.click();
		await vi.waitFor(() => expect(el.querySelector('.so-search-summary')?.textContent).toMatch(/^Invalid regular expression/));
		expect(el.querySelectorAll('.so-search-file')).toHaveLength(0);
	});
});

describe('HistorySection', () => {
	it('loads only when expanded and opens the selected commit', async () => {
		const { root, repo } = await repoWithHistory();
		const { owner, el } = host();
		const onOpenCommit = vi.fn();
		const history = owner.addChild(new HistorySection(el, { onOpenCommit }));
		history.setRepo(repo);
		history.setFile(path.join(root, 'a.ts'));
		await Promise.resolve();
		expect(el.querySelectorAll('.so-commit-row')).toHaveLength(0);
		expect(el.querySelector('.so-history-file')?.textContent).toBe('a.ts');

		history.expand();
		await vi.waitFor(() => expect(el.querySelectorAll('.so-commit-row')).toHaveLength(2));
		const subjects = Array.from(el.querySelectorAll('.so-commit-subject')).map((s) => s.textContent);
		expect(subjects).toEqual(['Add third', 'init']);
		expect(el.querySelector('.so-commit-meta')?.textContent).toContain('Other');

		el.querySelector<HTMLElement>('.so-commit-row')?.click();
		const [, commit, absPath, label] = onOpenCommit.mock.calls[0] as [GitRepo, FileCommit, string, string];
		expect(commit.subject).toBe('Add third');
		expect(absPath).toBe(path.join(root, 'a.ts'));
		expect(label).toBe('a.ts');
		expect(el.querySelector('.so-commit-row')?.classList.contains('is-active')).toBe(true);
	});

	it('explains files without history', async () => {
		const { root, repo } = await repoWithHistory();
		write(root, 'new.ts', 'x\n');
		const { owner, el } = host();
		const history = owner.addChild(new HistorySection(el, { onOpenCommit: () => undefined }));
		expect(el.querySelector('.so-empty')?.textContent).toBe('Open a file to see its history');
		history.expand();
		history.setRepo(repo);
		history.setFile(path.join(root, 'new.ts'));
		await vi.waitFor(() => expect(el.querySelector('.so-empty')?.textContent).toBe('No commits for this file'));
	});
});

describe('ContentPane history and blame', () => {
	it('shows a commit diff with its hash in the header', async () => {
		const { root, repo } = await repoWithHistory();
		const [latest] = await repo.fileHistory('a.ts', 10);
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13 }));
		await pane.showCommit(repo, latest!, path.join(root, 'a.ts'), 'a.ts');
		expect(el.querySelectorAll('.so-diff-view')).toHaveLength(1);
		expect(el.querySelector('.so-path-label')?.textContent).toBe(`a.ts @ ${latest!.short} · Add third`);
		expect(el.querySelector('.so-pane-stats')?.textContent).toBe('+1−0');
		expect(el.querySelector('[aria-label="Copy commit hash"]')).not.toBeNull();
		expect(pane.currentPath()).toBe(path.join(root, 'a.ts'));
	});

	it('toggles a blame gutter that survives switching files and opens commits on click', async () => {
		const { root, repo } = await repoWithHistory();
		const { owner, el } = host();
		const shown: string[] = [];
		const pane = owner.addChild(new ContentPane(el, {
			fontSize: 13,
			getRepo: () => repo,
			onShowHistory: () => undefined,
			onShow: (t) => shown.push(t.type),
		}));
		await pane.showFile(path.join(root, 'a.ts'), 'a.ts');
		expect(pane.canBlame()).toBe(true);
		expect(el.querySelector('[aria-label="Show file history"]')).not.toBeNull();
		const toggle = el.querySelector<HTMLElement>('.so-blame-toggle');
		expect(toggle?.getAttribute('aria-pressed')).toBe('false');

		expect(pane.toggleBlame()).toBe(true);
		await vi.waitFor(() => expect(el.querySelectorAll('.so-blame-start')).toHaveLength(2));
		const authors = Array.from(el.querySelectorAll('.so-blame-author')).map((a) => a.textContent);
		expect(authors).toEqual(['Test', 'Other']);
		expect(el.querySelector('.so-blame-toggle')?.getAttribute('aria-pressed')).toBe('true');

		await pane.showFile(path.join(root, 'b.ts'), 'b.ts');
		await vi.waitFor(() => expect(Array.from(el.querySelectorAll('.so-blame-author')).map((a) => a.textContent)).toEqual(['Test']));

		const gutterLine = el.querySelector('.so-blame-gutter .cm-gutterElement:not(.cm-gutterElement:first-child)') ??
			el.querySelector('.so-blame-start')?.parentElement;
		gutterLine?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await vi.waitFor(() => expect(el.querySelectorAll('.so-diff-view')).toHaveLength(1));
		expect(el.querySelector('.so-path-label')?.textContent).toMatch(/^b\.ts @ [0-9a-f]{7} · init$/);
		expect(shown).toEqual(['file', 'file', 'commit']);

		await pane.showFile(path.join(root, 'a.ts'), 'a.ts');
		pane.toggleBlame();
		expect(el.querySelectorAll('.so-blame-gutter')).toHaveLength(0);
	});

	it('does not offer blame outside a repository', async () => {
		const { root } = await repoWithHistory();
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13, getRepo: () => null }));
		await pane.showFile(path.join(root, 'a.ts'), 'a.ts');
		expect(pane.canBlame()).toBe(false);
		expect(pane.toggleBlame()).toBe(false);
		expect(el.querySelector('.so-blame-toggle')).toBeNull();
	});
});
