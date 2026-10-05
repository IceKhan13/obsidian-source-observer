import { symlinkSync } from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { IndexedFile, isHiddenPath, rankMatches, walkFolder } from '../src/services/FileIndex';
import { remove, tempDir, write } from './helpers';

const cleanup: string[] = [];
afterEach(() => { while (cleanup.length) remove(cleanup.pop() ?? ''); });

function indexed(rels: string[]): IndexedFile[] {
	return rels.map((rel) => {
		const relLower = rel.toLowerCase();
		return { rel, relLower, nameLower: relLower.slice(relLower.lastIndexOf('/') + 1) };
	});
}

describe('rankMatches', () => {
	const files = indexed([
		'src/components/Button.tsx',
		'src/button.ts',
		'docs/buttons-guide.md',
		'test/my-button.test.ts',
		'.github/button.yml',
	]);

	it('ranks exact and prefix name matches first', () => {
		const { matches } = rankMatches(files, 'button.ts', { showHidden: true, limit: 10 });
		expect(matches[0]).toBe('src/button.ts');
	});

	it('matches names, not directories, unless the query has a slash', () => {
		expect(rankMatches(files, 'src', { showHidden: true, limit: 10 }).total).toBe(0);
		expect(rankMatches(files, 'src/', { showHidden: true, limit: 10 }).total).toBe(2);
	});

	it('hides dotted paths unless requested', () => {
		expect(rankMatches(files, 'button', { showHidden: false, limit: 10 }).matches).not.toContain('.github/button.yml');
		expect(rankMatches(files, 'button', { showHidden: true, limit: 10 }).matches).toContain('.github/button.yml');
	});

	it('caps results but reports the total', () => {
		const { matches, total } = rankMatches(files, 'button', { showHidden: true, limit: 2 });
		expect(matches).toHaveLength(2);
		expect(total).toBe(5);
	});

	it('detects hidden paths by any segment', () => {
		expect(isHiddenPath('a/.b/c')).toBe(true);
		expect(isHiddenPath('a/b.c/d')).toBe(false);
	});
});

describe('walkFolder', () => {
	it('skips VCS and dependency folders and does not follow symlinked directories', async () => {
		const root = tempDir();
		cleanup.push(root);
		write(root, 'a.txt', '');
		write(root, 'src/b.ts', '');
		write(root, 'node_modules/pkg/index.js', '');
		write(root, '.git/HEAD', '');
		symlinkSync(path.join(root, 'src'), path.join(root, 'loop'), 'dir');
		const { rels, truncated } = await walkFolder(root);
		expect(truncated).toBe(false);
		// The symlink itself is listed as an entry, but never descended into.
		expect(rels.sort()).toEqual(['a.txt', 'loop', 'src/b.ts']);
	});

	it('stops at the limit', async () => {
		const root = tempDir();
		cleanup.push(root);
		for (let i = 0; i < 10; i++) write(root, `f${i}.txt`, '');
		const { rels, truncated } = await walkFolder(root, 4);
		expect(rels).toHaveLength(4);
		expect(truncated).toBe(true);
	});
});
