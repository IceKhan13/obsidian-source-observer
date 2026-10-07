// @vitest-environment jsdom
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { Component } from 'obsidian';
import { GitRepo } from '../src/git/GitRepo';
import { groupChanges } from '../src/git/status';
import { sanitizeSettings } from '../src/settings';
import { ContentPane } from '../src/ui/pane/ContentPane';
import { makeRepo, remove, write } from './helpers';

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

/** Number of editors whose content wraps lines. */
const wrapped = (el: HTMLElement) => el.querySelectorAll('.cm-content.cm-lineWrapping').length;

describe('word wrap setting', () => {
	it('defaults to off and only accepts booleans', () => {
		expect(sanitizeSettings({}).wordWrap).toBe(false);
		expect(sanitizeSettings({ wordWrap: true }).wordWrap).toBe(true);
		expect(sanitizeSettings({ wordWrap: 'yes' }).wordWrap).toBe(false);
	});

	it('wraps the code view and follows changes, including across files', async () => {
		const root = makeRepo({ 'a.ts': 'const a = 1;\n', 'b.ts': 'const b = 2;\n' });
		cleanup.push(root);
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13, wordWrap: true }));
		await pane.showFile(path.join(root, 'a.ts'), 'a.ts');
		expect(wrapped(el)).toBe(1);
		pane.setWordWrap(false);
		expect(wrapped(el)).toBe(0);
		pane.setWordWrap(true);
		await pane.showFile(path.join(root, 'b.ts'), 'b.ts');
		expect(wrapped(el)).toBe(1);
	});

	it('wraps both sides of a side-by-side diff', async () => {
		const root = makeRepo({ 'a.ts': 'const a = 1;\n' });
		cleanup.push(root);
		write(root, 'a.ts', 'const a = 2;\n');
		const opened = await GitRepo.open(root);
		if (opened.kind !== 'repo') throw new Error('not a repo');
		const [entry] = groupChanges((await opened.repo.status()).files);
		const { owner, el } = host();
		const pane = owner.addChild(new ContentPane(el, { fontSize: 13, diffLayout: 'split' }));
		await pane.showDiff(opened.repo, entry!, 'a.ts');
		expect(wrapped(el)).toBe(0);
		pane.setWordWrap(true);
		expect(wrapped(el)).toBe(2);
	});
});
