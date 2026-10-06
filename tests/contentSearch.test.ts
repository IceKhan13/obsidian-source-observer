import { afterEach, describe, expect, it } from 'vitest';
import { GitRepo } from '../src/git/GitRepo';
import { compileQuery, ContentSearch, makePreview, matchRanges, SearchQuery } from '../src/services/ContentSearch';
import { FileIndex } from '../src/services/FileIndex';
import { makeRepo, remove, tempDir, write } from './helpers';

const cleanup: string[] = [];
afterEach(() => { while (cleanup.length) remove(cleanup.pop() ?? ''); });

const q = (text: string, opts: Partial<SearchQuery> = {}): SearchQuery =>
	({ text, caseSensitive: false, wholeWord: false, regex: false, ...opts });

describe('query matching', () => {
	it('escapes plain text, honours case and whole-word options', () => {
		expect(matchRanges(compileQuery(q('a.b')), 'axb a.b A.B')).toEqual([[4, 7], [8, 11]]);
		expect(matchRanges(compileQuery(q('a.b', { caseSensitive: true })), 'a.b A.B')).toEqual([[0, 3]]);
		expect(matchRanges(compileQuery(q('cat', { wholeWord: true })), 'cat concat cat_ cat.')).toEqual([[0, 3], [16, 19]]);
	});

	it('supports regular expressions and skips empty matches', () => {
		expect(matchRanges(compileQuery(q('\\d+', { regex: true })), 'a1 b22')).toEqual([[1, 2], [4, 6]]);
		expect(matchRanges(compileQuery(q('x*', { regex: true })), 'abx')).toEqual([[2, 3]]);
		expect(() => compileQuery(q('(', { regex: true }))).toThrow(SyntaxError);
	});

	it('trims indentation and cuts long lines around the first match', () => {
		expect(makePreview(3, '\t\tfoo bar', [[6, 9]])).toEqual({ line: 3, preview: 'foo bar', ranges: [[4, 7]] });
		const long = `${'x'.repeat(300)}needle${'y'.repeat(300)}`;
		const preview = makePreview(1, long, [[300, 306]], 60);
		expect(preview.preview.startsWith('…')).toBe(true);
		expect(preview.preview.endsWith('…')).toBe(true);
		const [range] = preview.ranges;
		expect(preview.preview.slice(range![0], range![1])).toBe('needle');
	});
});

describe('ContentSearch', () => {
	it('searches a plain folder through the file index, in index order, skipping hidden and binary files', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		write(dir, 'a.txt', 'one needle\nnone\nneedle two\n');
		write(dir, 'sub/b.md', 'Needle\n');
		write(dir, '.hidden/c.txt', 'needle\n');
		write(dir, 'bin.dat', Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0]));
		const index = new FileIndex();
		index.reset(dir, null);
		const search = new ContentSearch(index);

		const results = await search.run(dir, null, q('needle'), { showHidden: false });
		expect(results.files.map((f) => [f.rel, f.lines.map((l) => l.line)])).toEqual([['a.txt', [1, 3]], ['sub/b.md', [1]]]);
		expect(results.matchCount).toBe(3);
		expect(results.files[0]?.lines[0]?.ranges).toEqual([[4, 10]]);

		const withHidden = await search.run(dir, null, q('needle', { caseSensitive: true }), { showHidden: true });
		expect(withHidden.files.map((f) => f.rel).sort()).toEqual(['.hidden/c.txt', 'a.txt']);
	});

	it('uses git grep in a repository, with folder-relative paths and regex fallback-safe highlighting', async () => {
		const root = makeRepo({ 'src/a.ts': 'const value = 42;\n', 'README.md': 'value\n' });
		cleanup.push(root);
		const opened = await GitRepo.open(`${root}/src`);
		if (opened.kind !== 'repo') throw new Error('not a repo');
		const search = new ContentSearch(new FileIndex());

		const results = await search.run(`${root}/src`, opened.repo, q('val\\w+', { regex: true }), { showHidden: false });
		expect(results.files).toHaveLength(1);
		expect(results.files[0]?.rel).toBe('a.ts');
		expect(results.files[0]?.lines[0]).toMatchObject({ line: 1, preview: 'const value = 42;', ranges: [[6, 11]] });
	});

	it('rejects invalid regular expressions before running git', async () => {
		const search = new ContentSearch(new FileIndex());
		await expect(search.run('/nowhere', null, q('[', { regex: true }), { showHidden: false })).rejects.toThrow(SyntaxError);
	});
});
