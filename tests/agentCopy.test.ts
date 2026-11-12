// @vitest-environment jsdom
import { readFileSync } from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { GitRepo } from '../src/git/GitRepo';
import { ChangeEntry, groupChanges } from '../src/git/status';
import { agentReference, agentSnippet, referenceList } from '../src/links/agentFormat';
import { compareWithBase } from '../src/services/BaseComparison';
import { changedFileList, changesPatch, MAX_PATCH_CHARS, uncommittedEntries } from '../src/services/ChangesPatch';
import { FileIndex } from '../src/services/FileIndex';
import type { RepoSnapshot } from '../src/services/RepoState';
import { changesCopyItems, searchReferenceItems } from '../src/ui/agentCopy';
import { ContentPane } from '../src/ui/pane/ContentPane';
import { ChangesSection } from '../src/ui/sidebar/ChangesSection';
import { SearchSection } from '../src/ui/sidebar/SearchSection';
import { git, makeRepo, remove, tempDir, write } from './helpers';

const cleanup: string[] = [];
const roots: Component[] = [];
let clipboard: string[] = [];

beforeEach(() => {
	clipboard = [];
	Object.defineProperty(navigator, 'clipboard', {
		value: { writeText: (text: string) => { clipboard.push(text); return Promise.resolve(); } },
		configurable: true,
	});
});

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

const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

describe('agent formats', () => {
	it('cites a path with lines and an optional revision', () => {
		expect(agentReference({ path: 'src/a.ts', lines: { from: 97, to: 103 }, revision: null })).toBe('src/a.ts:97-103');
		expect(agentReference({ path: 'src/a.ts', lines: { from: 4, to: 4 }, revision: '@ e69affc' })).toBe('src/a.ts:4 @ e69affc');
		expect(agentReference({ path: '/abs/notes.md', lines: null, revision: null })).toBe('/abs/notes.md');
	});

	it('puts the reference above a fenced code block, without an obsidian:// link', () => {
		const snippet = agentSnippet({ path: 'src/a.ts', lines: { from: 1, to: 2 }, revision: null }, 'const a = 1;\nconst b = `x`;\n');
		expect(snippet).toBe('src/a.ts:1-2\n```ts\nconst a = 1;\nconst b = `x`;\n```');
		expect(agentSnippet({ path: 'x.md', lines: null, revision: null }, 'has ``` inside')).toBe('x.md\n````md\nhas ``` inside\n````');
	});

	it('lists one path:line per line', () => {
		expect(referenceList([{ path: 'a.ts', line: 3 }, { path: 'b/c.ts', line: 10 }])).toBe('a.ts:3\nb/c.ts:10');
	});
});

describe('changesPatch', () => {
	/** A repository with a modified, staged, renamed, deleted, untracked and binary change. */
	function changedRepo(): string {
		const root = makeRepo({
			'src/a.ts': numbered(20),
			'old.ts': 'export const moved = true;\n',
			'gone.txt': 'bye\n',
			'staged.txt': 'one\n',
			'img.bin': Buffer.from([1, 0, 2]).toString('latin1'),
		});
		cleanup.push(root);
		write(root, 'src/a.ts', numbered(20).replace('line 10\n', 'line ten\n'));
		git(root, 'mv', 'old.ts', 'new.ts');
		git(root, 'rm', '-q', 'gone.txt');
		write(root, 'staged.txt', 'one\ntwo\n');
		git(root, 'add', 'staged.txt');
		write(root, 'staged.txt', 'one\ntwo\nthree\n');
		write(root, 'notes/new.md', '# New\n');
		write(root, 'img.bin', Buffer.from([1, 0, 3]));
		return root;
	}

	it('copies every uncommitted change as a diff that git apply turns into the working tree', async () => {
		const root = changedRepo();
		const repo = await openRepo(root);
		const status = await repo.status();
		const result = await changesPatch(repo, uncommittedEntries(status.files));
		expect(result.omitted).toBe(0);
		expect(result.text).toContain('Binary files a/img.bin and b/img.bin differ');
		expect(result.text).toContain('diff --git a/old.ts b/new.ts\nrename from old.ts\nrename to new.ts\n');

		// Apply everything except the binary file to a fresh clone of HEAD.
		const clone = path.join(tempDir(), 'clone');
		cleanup.push(path.dirname(clone));
		git(path.dirname(clone), 'clone', '-q', root, clone);
		const textOnly = result.text.split(/(?=^diff --git )/m).filter((p) => !p.includes('Binary files')).join('');
		write(clone, 'changes.patch', textOnly);
		git(clone, 'apply', 'changes.patch');
		for (const file of ['src/a.ts', 'new.ts', 'staged.txt', 'notes/new.md']) {
			expect(readFileSync(path.join(clone, file), 'utf-8')).toBe(readFileSync(path.join(root, file), 'utf-8'));
		}
		expect(() => readFileSync(path.join(clone, 'gone.txt'))).toThrow();
	});

	it('copies only staged changes, from HEAD to the index', async () => {
		const root = changedRepo();
		const repo = await openRepo(root);
		const staged = groupChanges((await repo.status()).files).filter((e) => e.group === 'staged');
		const { text } = await changesPatch(repo, staged);
		expect(text).toContain('--- a/staged.txt\n+++ b/staged.txt\n@@ -1 +1,2 @@\n one\n+two\n');
		expect(text).not.toContain('+three');
		expect(text).not.toContain('src/a.ts');
	});

	it('stops at the size limit and says how many files were left out', async () => {
		const root = makeRepo({ 'a.txt': 'a\n' });
		cleanup.push(root);
		write(root, 'a.txt', 'b\n');
		write(root, 'b-big.txt', 'x'.repeat(MAX_PATCH_CHARS) + '\n');
		write(root, 'c.txt', 'c\n');
		const repo = await openRepo(root);
		const result = await changesPatch(repo, uncommittedEntries((await repo.status()).files), '# preamble\n');
		expect(result.files).toBe(1);
		expect(result.omitted).toBe(2);
		expect(result.text.startsWith('# preamble\ndiff --git a/a.txt b/a.txt\n')).toBe(true);
		expect(result.text.endsWith('# 2 more changed files are not included: the diff reached its size limit\n')).toBe(true);
	});

	it('lists changed files once each, with renames', async () => {
		const root = changedRepo();
		const repo = await openRepo(root);
		const list = changedFileList(uncommittedEntries((await repo.status()).files)).split('\n');
		expect(list).toContain('R old.ts → new.ts');
		expect(list).toContain('D gone.txt');
		expect(list).toContain('M src/a.ts');
		expect(list.filter((l) => l.endsWith('staged.txt'))).toHaveLength(1);
		expect(list).toContain('U notes/new.md');
	});

	it('offers base changes with a comment naming both branches', async () => {
		const root = makeRepo({ 'a.txt': 'a\n' });
		cleanup.push(root);
		git(root, 'checkout', '-q', '-b', 'feature');
		write(root, 'a.txt', 'b\n');
		git(root, 'commit', '-qam', 'Change a');
		const repo = await openRepo(root);
		const status = await repo.status();
		const base = await compareWithBase(repo, 'main', status);
		if (base.kind !== 'ok') throw new Error(base.message);
		const groups = changesCopyItems(repo, status, { entries: base.entries, base: { ref: base.ref, commit: base.commit } });
		expect(groups.map((g) => g.map((i) => i.title))).toEqual([
			['Copy all changes against main as diff'],
			['Copy list of changed files'],
		]);
		groups[0]?.[0]?.run();
		await vi.waitFor(() => expect(clipboard).toHaveLength(1));
		expect(clipboard[0]).toMatch(/^# feature compared with main \(merge base [0-9a-f]{7}\)\ndiff --git a\/a.txt b\/a.txt\n/);
	});
});

describe('copying from the content pane', () => {
	it('cites code by its repository path when a subfolder is opened (not the folder-relative path)', async () => {
		const root = makeRepo({ 'pkg/src/a.ts': numbered(10) });
		cleanup.push(root);
		const repo = await openRepo(path.join(root, 'pkg'));
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13, getRepo: () => repo }));
		await pane.showFile(path.join(root, 'pkg/src/a.ts'), 'src/a.ts', { from: 2, to: 3 });
		expect(pane.agentCitation()).toEqual({
			citation: { path: 'pkg/src/a.ts', lines: { from: 2, to: 3 }, revision: null },
			text: 'line 2\nline 3',
		});
		expect(pane.diffPatch()).toBeNull();
	});

	it('cites files outside a repository by their absolute path', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		write(dir, 'a.py', 'print(1)\n');
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13, getRepo: () => null }));
		await pane.showFile(path.join(dir, 'a.py'), 'a.py');
		expect(pane.agentCitation()?.citation).toEqual({ path: path.join(dir, 'a.py'), lines: null, revision: null });
	});

	it('copies a diff, one change from its gutter button, and cites the new side', async () => {
		const original = numbered(40);
		const root = makeRepo({ 'src/a.ts': original });
		cleanup.push(root);
		write(root, 'src/a.ts', original.replace('line 3\n', 'line three\n').replace('line 30\n', 'line thirty\n'));
		const repo = await openRepo(root);
		const [entry] = groupChanges((await repo.status()).files);
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13, onLinkMenu: () => undefined }));
		await pane.showDiff(repo, entry as ChangeEntry, 'src/a.ts');

		expect(el.querySelector('.so-pane-action[aria-label="Copy"]')).not.toBeNull();
		const patch = pane.diffPatch() ?? '';
		expect(patch.startsWith('diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,6 +1,6 @@\n')).toBe(true);
		expect(patch).toContain('@@ -27,7 +27,7 @@\n');
		expect(pane.diffPatch(1)).toBe([
			'diff --git a/src/a.ts b/src/a.ts',
			'--- a/src/a.ts',
			'+++ b/src/a.ts',
			'@@ -27,7 +27,7 @@',
			' line 27', ' line 28', ' line 29', '-line 30', '+line thirty', ' line 31', ' line 32', ' line 33',
			'',
		].join('\n'));

		const button = el.querySelector<HTMLElement>('.so-hunk-copy[aria-label="Copy change"]');
		expect(button).not.toBeNull();
		button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await vi.waitFor(() => expect(clipboard).toHaveLength(1));
		expect(clipboard[0]).toContain('+line three\n');
		expect(clipboard[0]).not.toContain('thirty');

		const cited = pane.agentCitation();
		expect(cited?.citation).toEqual({ path: 'src/a.ts', lines: null, revision: null });
	});

	it('marks lines from a commit with its hash, and names the commit above its diff', async () => {
		const root = makeRepo({ 'a.ts': 'one\n' });
		cleanup.push(root);
		write(root, 'a.ts', 'one\ntwo\n');
		git(root, 'commit', '-qam', 'Add two');
		const repo = await openRepo(root);
		const [commit] = await repo.fileHistory('a.ts', 10);
		if (!commit) throw new Error('no history');
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13 }));
		await pane.showCommit(repo, commit, path.join(root, 'a.ts'), 'a.ts');
		expect(pane.agentCitation()?.citation).toEqual({ path: 'a.ts', lines: null, revision: `@ ${commit.short}` });
		expect(pane.diffPatch()).toBe(`# Commit ${commit.short}: Add two\ndiff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n one\n+two\n`);
	});

	it('cites the staged version of a staged change', async () => {
		const root = makeRepo({ 'a.ts': 'one\n' });
		cleanup.push(root);
		write(root, 'a.ts', 'one\ntwo\n');
		git(root, 'add', 'a.ts');
		const repo = await openRepo(root);
		const [entry] = groupChanges((await repo.status()).files);
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13 }));
		await pane.showDiff(repo, entry as ChangeEntry, 'a.ts');
		expect(pane.agentCitation()?.citation.revision).toBe('(staged)');
	});
});

describe('sidebar copy actions', () => {
	it('shows a copy button in Changes and lists changes only once they are known', async () => {
		const root = makeRepo({ 'a.txt': 'a\n' });
		cleanup.push(root);
		write(root, 'a.txt', 'b\n');
		const repo = await openRepo(root);
		const status = await repo.status();
		const { owner, el } = host();
		const onCopyMenu = vi.fn();
		const section = owner.addChild(new ChangesSection(el, { onOpenDiff: () => undefined, onRefresh: () => undefined, onCopyMenu }));
		expect(section.listed()).toBeNull();
		const snapshot: RepoSnapshot = { kind: 'repo', folder: root, repo, status };
		section.update(snapshot);
		expect(section.listed()?.entries.map((e) => e.file.path)).toEqual(['a.txt']);
		section.setBase({ kind: 'loading', ref: 'main' });
		expect(section.listed()).toBeNull();
		section.setBase(null);

		el.querySelector<HTMLElement>('.so-changes-copy')?.click();
		expect(onCopyMenu).toHaveBeenCalledTimes(1);
		expect(changesCopyItems(repo, status, section.listed()!).map((g) => g.map((i) => i.title))).toEqual([
			['Copy all changes as diff'],
			['Copy list of changed files'],
		]);
	});

	it('passes a file\'s matching lines to the search context menu', async () => {
		const root = makeRepo({ 'a.ts': 'needle\nhay\nneedle\n', 'b.ts': 'needle\n' });
		cleanup.push(root);
		const repo = await openRepo(root);
		const { owner, el } = host();
		const onContextMenu = vi.fn();
		const section = owner.addChild(new SearchSection(el, { index: new FileIndex(), showHidden: false, onOpenMatch: () => undefined, onContextMenu }));
		section.setFolder(root);
		section.setRepo(repo);
		section.focus('needle');
		await vi.waitFor(() => expect(el.querySelectorAll('.so-search-line')).toHaveLength(3));
		expect(section.resultLines()).toEqual([{ rel: 'a.ts', line: 1 }, { rel: 'a.ts', line: 3 }, { rel: 'b.ts', line: 1 }]);
		el.querySelector<HTMLElement>('.so-search-line')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
		expect(onContextMenu).toHaveBeenCalledWith(expect.anything(), path.join(root, 'a.ts'), 'a.ts', [1, 3]);

		const all = [{ path: 'a.ts', line: 1 }, { path: 'a.ts', line: 3 }, { path: 'b.ts', line: 1 }];
		const items = searchReferenceItems('a.ts', [1, 3], all);
		expect(items.map((i) => i.title)).toEqual(['Copy references to 2 matches', 'Copy references to all 3 results']);
		items[1]?.run();
		await vi.waitFor(() => expect(clipboard).toEqual(['a.ts:1\na.ts:3\nb.ts:1']));
		expect(searchReferenceItems('b.ts', [1], [{ path: 'b.ts', line: 1 }]).map((i) => i.title)).toEqual(['Copy reference to match']);
	});
});
