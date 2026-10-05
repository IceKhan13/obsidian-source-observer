// @vitest-environment jsdom
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { Component } from 'obsidian';
import { GitRepo } from '../src/git/GitRepo';
import { ChangeEntry, groupChanges } from '../src/git/status';
import type { RepoSnapshot } from '../src/services/RepoState';
import { ContentPane } from '../src/ui/pane/ContentPane';
import { CodeEmbed, sliceLines } from '../src/ui/embed/CodeEmbed';
import { fileMenuGroups, showFileMenu } from '../src/ui/fileMenu';
import { ChangesSection } from '../src/ui/sidebar/ChangesSection';
import { FileTree } from '../src/ui/sidebar/FileTree';
import { makeRepo, remove, tempDir, write } from './helpers';
// Same module instance as `obsidian` under vitest's alias, with the recording API typed.
import { Menu } from './obsidian-shim';

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
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13 }));
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
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13 }));

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
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13 }));

		await pane.showFile(path.join(dir, 'a.py'), 'a.py');
		const editor = el.querySelector('.cm-editor');
		await pane.showFile(path.join(dir, 'b.go'), 'b.go');
		expect(el.querySelector('.cm-editor')).toBe(editor);
		expect(el.textContent).toContain('package main');

		owner.removeChild(pane);
		expect(el.querySelectorAll('.cm-editor')).toHaveLength(0);
	});

	it('renders a side-by-side diff and switches layout without reloading', async () => {
		const { repo, entry } = await repoWithChange();
		const { owner, el } = host();
		const layouts: string[] = [];
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13, diffLayout: 'split', onDiffLayoutChange: (l) => layouts.push(l) }));

		await pane.showDiff(repo, entry, 'big.ts');
		expect(el.querySelectorAll('.so-diff-split .cm-mergeView .cm-editor')).toHaveLength(2);
		expect(el.querySelector('.cm-merge-a')?.textContent).toContain('line 100');
		expect(el.querySelector('.cm-merge-b')?.textContent).toContain('line one hundred');
		expect(el.querySelector('.so-pane-stats')?.textContent).toBe('+1−1');

		const toggle = el.querySelector<HTMLElement>('.so-pane-action[aria-label="Show unified"]');
		toggle?.click();
		expect(layouts).toEqual(['unified']);
		expect(el.querySelectorAll('.so-diff-view')).toHaveLength(1);
		expect(el.querySelectorAll('.so-diff-unified .cm-editor')).toHaveLength(1);
		expect(el.querySelector('.so-pane-action[aria-label="Show side by side"]')).not.toBeNull();

		owner.removeChild(pane);
		expect(el.querySelectorAll('.cm-editor')).toHaveLength(0);
	});

	it('opens find and go-to-line only when a file or diff is shown', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		write(dir, 'a.ts', 'const needle = 1;\n');
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13 }));

		expect(pane.hasEditor()).toBe(false);
		expect(pane.openSearch()).toBe(false);

		await pane.showFile(path.join(dir, 'a.ts'), 'a.ts');
		expect(pane.hasEditor()).toBe(true);
		el.querySelector<HTMLElement>('.so-pane-action[aria-label="Find in file"]')?.click();
		expect(el.querySelector('.cm-panel.cm-search')).not.toBeNull();
		expect(pane.goToLine()).toBe(true);
		expect(el.querySelector('.cm-goto-line, .cm-gotoLine')).not.toBeNull();
	});

	it('highlights and selects linked lines, and reports the selection for links', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		write(dir, 'a.ts', Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n'));
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13, onLinkMenu: () => {} }));

		await pane.showFile(path.join(dir, 'a.ts'), 'a.ts', { from: 3, to: 5 });
		expect(el.querySelectorAll('.so-linked-line')).toHaveLength(3);
		expect(pane.currentFile()?.selection).toEqual({ lines: { from: 3, to: 5 }, text: 'line 3\nline 4\nline 5' });
		expect(el.querySelector('.so-pane-action[aria-label="Copy link"]')).not.toBeNull();

		// Opening the file normally clears the highlight and links to the whole file.
		await pane.showFile(path.join(dir, 'a.ts'), 'a.ts');
		expect(el.querySelectorAll('.so-linked-line')).toHaveLength(0);
		expect(pane.currentFile()?.selection.lines).toBeNull();
	});

	it('clamps linked lines past the end of the file', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		write(dir, 'a.ts', 'one\ntwo');
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13 }));
		await pane.showFile(path.join(dir, 'a.ts'), 'a.ts', { from: 2, to: 99 });
		expect(el.querySelectorAll('.so-linked-line')).toHaveLength(1);
		await pane.showFile(path.join(dir, 'a.ts'), 'a.ts', { from: 50, to: 60 });
		expect(el.querySelectorAll('.so-linked-line')).toHaveLength(0);
		expect(el.querySelector('.so-pane-action[aria-label="Copy link"]')).toBeNull();
	});

	it('shows a message instead of loading binary files', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		write(dir, 'img.png', Buffer.from([0x89, 0x50, 0, 0, 1]));
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13 }));
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

describe('CodeEmbed', () => {
	const until = async (check: () => boolean, ms = 3000) => {
		for (const start = Date.now(); !check() && Date.now() - start < ms;) await new Promise((r) => setTimeout(r, 25));
	};

	it('slices lines, ignoring a trailing newline', () => {
		expect(sliceLines('a\nb\nc\n', 2, 9)).toEqual({ text: 'b\nc', to: 3 });
		expect(sliceLines('a\nb\n', 3, 4)).toBeNull();
	});

	it('renders the embedded lines with their real line numbers and opens on click', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		write(dir, 'src/a.ts', Array.from({ length: 30 }, (_, i) => `const v${i + 1} = ${i + 1};`).join('\n'));
		const { owner, el } = host();
		const location = { folder: dir, file: 'src/a.ts', lines: { from: 11, to: 12 } };
		const opened: unknown[] = [];
		owner.addChild(new CodeEmbed(el, { absPath: path.join(dir, 'src/a.ts'), location }, (l) => opened.push(l)));

		await until(() => !!el.querySelector('.cm-content'));
		expect(el.querySelector('.cm-content')?.textContent).toBe('const v11 = 11;const v12 = 12;');
		expect(el.querySelector('.cm-lineNumbers')?.textContent).toContain('11');
		expect(el.querySelector('.so-embed-label')?.textContent).toBe('src/a.ts:11-12');

		el.querySelector<HTMLElement>('.so-embed-header')?.click();
		expect(opened).toEqual([location]);
	});

	it('updates when the file changes and explains missing files', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		write(dir, 'a.ts', 'before');
		const { owner, el } = host();
		const embed = owner.addChild(new CodeEmbed(el, {
			absPath: path.join(dir, 'a.ts'),
			location: { folder: dir, file: 'a.ts', lines: null },
		}, () => {}));
		await until(() => el.querySelector('.cm-content')?.textContent === 'before');

		write(dir, 'a.ts', 'after');
		await until(() => el.querySelector('.cm-content')?.textContent === 'after');
		expect(el.querySelector('.cm-content')?.textContent).toBe('after');

		remove(path.join(dir, 'a.ts'));
		await until(() => !!el.querySelector('.so-embed-message'));
		expect(el.querySelector('.so-embed-message')?.textContent).toContain('File not found');
		expect(el.querySelectorAll('.cm-editor')).toHaveLength(0);

		owner.removeChild(embed);
	});
});

describe('file menu', () => {
	const file = { absPath: '/repo/src/a.ts', relPath: 'src/a.ts', isDir: false, exists: true };
	const titles = (groups: ReturnType<typeof fileMenuGroups>) => groups.map((g) => g.map((i) => i.title));

	it('offers copy, reveal and open for existing files', () => {
		expect(titles(fileMenuGroups(file))).toEqual([
			['Copy path', 'Copy relative path'],
			['Show in system explorer', 'Open in default app'],
		]);
	});

	it('cannot open folders in an app, or deleted files at all', () => {
		expect(titles(fileMenuGroups({ ...file, isDir: true }))[1]).toEqual(['Show in system explorer']);
		expect(titles(fileMenuGroups({ ...file, exists: false }))).toEqual([['Copy path', 'Copy relative path']]);
	});

	it('puts extra items first and separates groups', () => {
		const evt = new MouseEvent('contextmenu', { cancelable: true });
		showFileMenu(evt, file, [[{ title: 'Open file', icon: 'file-text', run: () => {} }]]);
		expect(evt.defaultPrevented).toBe(true);
		expect(Menu.last?.items.map((i) => i?.title ?? '---')).toEqual([
			'Open file', '---', 'Copy path', 'Copy relative path', '---', 'Show in system explorer', 'Open in default app',
		]);
	});
});

describe('FileTree', () => {
	it('reports right-clicks on files and folders', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		write(dir, 'src/a.ts', '');
		const { owner, el } = host();
		const clicked: [string, boolean][] = [];
		const tree = new FileTree(owner, el, true, () => {}, (_evt, p, isDir) => clicked.push([p, isDir]));
		await tree.load(dir);
		const srcRow = [...el.querySelectorAll<HTMLElement>('.so-tree-dir')].find((r) => r.textContent === 'src');
		srcRow?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
		expect(clicked).toEqual([[path.join(dir, 'src'), true]]);
	});

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
