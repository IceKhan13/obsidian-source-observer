import { afterEach, describe, expect, it } from 'vitest';
import { parseBlame } from '../src/git/blame';
import { grepArgs, isPcreUnsupported, parseGrepLine } from '../src/git/grep';
import { GitRepo } from '../src/git/GitRepo';
import { loadCommitSides } from '../src/git/diffSources';
import { parseLog } from '../src/git/history';
import { git, makeRepo, remove, write } from './helpers';

const cleanup: string[] = [];
afterEach(() => { while (cleanup.length) remove(cleanup.pop() ?? ''); });

async function open(folder: string): Promise<GitRepo> {
	const result = await GitRepo.open(folder);
	if (result.kind !== 'repo') throw new Error(`expected a repo, got ${result.kind}`);
	return result.repo;
}

function commit(root: string, message: string) {
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', message);
}

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);

describe('parseLog', () => {
	it('parses commits and carries the path across renames', () => {
		const out =
			`\x1e${H2}\x1fbbbbbbb\x1fAda\x1fada@x\x1f200\x1fRename it\0\nR090\0old.ts\0new.ts\0` +
			`\x1e${H1}\x1faaaaaaa\x1fBob\x1fbob@x\x1f100\x1fAdd\x1fwith separator\0\nA\0old.ts\0`;
		const commits = parseLog(out, 'new.ts');
		expect(commits).toHaveLength(2);
		expect(commits[0]).toMatchObject({ hash: H2, short: 'bbbbbbb', author: 'Ada', time: 200, status: 'R', path: 'new.ts', origPath: 'old.ts' });
		expect(commits[1]).toMatchObject({ hash: H1, subject: 'Add\x1fwith separator', status: 'A', path: 'old.ts', origPath: null });
	});

	it('keeps the newer path for commits without name-status (merges)', () => {
		const out = `\x1e${H2}\x1fbbbbbbb\x1fA\x1fa@x\x1f2\x1fMerge\0\n\x1e${H1}\x1faaaaaaa\x1fA\x1fa@x\x1f1\x1fEdit\0\nM\0f.ts\0`;
		const commits = parseLog(out, 'f.ts');
		expect(commits.map((c) => [c.status, c.path])).toEqual([['M', 'f.ts'], ['M', 'f.ts']]);
	});
});

describe('parseBlame', () => {
	it('maps every line to its commit, sharing metadata given once', () => {
		const out = [
			`${H1} 1 1 2`, 'author Ada', 'author-time 100', 'summary First', 'filename a.ts', '\tone',
			`${H1} 2 2`, '\ttwo',
			`${'0'.repeat(40)} 3 3 1`, 'author Not Committed Yet', 'author-time 300', 'summary Version of a.ts from a.ts',
			'previous ' + H1 + ' a.ts', 'filename a.ts', '\tthree',
		].join('\n');
		const lines = parseBlame(out);
		expect(lines).toHaveLength(3);
		expect(lines[0]).toBe(lines[1]);
		expect(lines[0]).toMatchObject({ hash: H1, author: 'Ada', time: 100, summary: 'First', filename: 'a.ts', uncommitted: false });
		expect(lines[2]).toMatchObject({ uncommitted: true, previousFilename: 'a.ts' });
	});
});

describe('grep helpers', () => {
	it('parses NUL-separated hits and rejects malformed rows', () => {
		expect(parseGrepLine('src/a.ts\x0012\x00  const x = 1;')).toEqual({ path: 'src/a.ts', line: 12, text: '  const x = 1;' });
		expect(parseGrepLine('a\x00b\x00c\x00d')).toBeNull();
		expect(parseGrepLine('no separators')).toBeNull();
	});

	it('maps options to flags and puts the pattern after -e', () => {
		const args = grepArgs({ pattern: '-v', syntax: 'fixed', caseSensitive: false, wholeWord: true }, ['--', 'src/']);
		expect(args).toEqual(expect.arrayContaining(['grep', '-F', '-i', '-w', '--untracked', '-I']));
		expect(args.slice(-4)).toEqual(['-e', '-v', '--', 'src/']);
		expect(grepArgs({ pattern: 'x', syntax: 'perl', caseSensitive: true, wholeWord: false }, [])).not.toContain('-i');
	});

	it('recognises a git built without PCRE', () => {
		expect(isPcreUnsupported('fatal: cannot use Perl-compatible regexes when not compiled with USE_LIBPCRE')).toBe(true);
		expect(isPcreUnsupported('fatal: command line, \'(\': Unmatched ( or \\(')).toBe(false);
	});
});

describe('GitRepo.grep', () => {
	it('finds tracked and untracked matches inside the opened subfolder only', async () => {
		const root = makeRepo({ 'src/a.ts': 'const needle = 1;\nother\n', 'root.txt': 'needle\n', 'src/bin.dat': 'x' });
		cleanup.push(root);
		write(root, 'src/new.ts', 'NEEDLE here\n');
		write(root, 'src/bin.dat', Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0, 1]));
		const repo = await open(`${root}/src`);
		const { hits, truncated } = await repo.grep({ pattern: 'needle', syntax: 'fixed', caseSensitive: false, wholeWord: false }, 100);
		expect(truncated).toBe(false);
		expect(hits.map((h) => [h.path, h.line]).sort()).toEqual([['src/a.ts', 1], ['src/new.ts', 1]]);
	});

	it('returns no hits (not an error) when nothing matches, and stops at the limit', async () => {
		const root = makeRepo({ 'a.txt': Array.from({ length: 50 }, () => 'match').join('\n') });
		cleanup.push(root);
		const repo = await open(root);
		const opts = { syntax: 'fixed' as const, caseSensitive: true, wholeWord: false };
		expect((await repo.grep({ ...opts, pattern: 'absent' }, 10)).hits).toEqual([]);
		const limited = await repo.grep({ ...opts, pattern: 'match' }, 10);
		expect(limited.hits).toHaveLength(10);
		expect(limited.truncated).toBe(true);
	});

	it('rejects an invalid regular expression with git\'s message', async () => {
		const root = makeRepo({ 'a.txt': 'a\n' });
		cleanup.push(root);
		const repo = await open(root);
		await expect(repo.grep({ pattern: '(', syntax: 'extended', caseSensitive: true, wholeWord: false }, 10)).rejects.toThrow();
	});
});

describe('GitRepo.fileHistory and blame', () => {
	it('lists commits newest first, following a rename, and loads each commit\'s diff', async () => {
		const body = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n';
		const root = makeRepo({ 'old.ts': body });
		cleanup.push(root);
		git(root, 'mv', 'old.ts', 'new.ts');
		commit(root, 'Rename');
		write(root, 'new.ts', body.replace('line 3', 'line three'));
		commit(root, 'Edit line 3');
		const repo = await open(root);

		const commits = await repo.fileHistory('new.ts', 50);
		expect(commits.map((c) => c.subject)).toEqual(['Edit line 3', 'Rename', 'init']);
		expect(commits[1]).toMatchObject({ status: 'R', path: 'new.ts', origPath: 'old.ts' });
		expect(commits[2]).toMatchObject({ status: 'A', path: 'old.ts' });

		const [edit, rename, init] = commits;
		const editSides = await loadCommitSides(repo, edit!);
		expect(editSides.original).toEqual({ kind: 'text', text: body });
		expect(editSides.modified.kind === 'text' && editSides.modified.text.includes('line three')).toBe(true);
		const renameSides = await loadCommitSides(repo, rename!);
		expect(renameSides.original).toEqual(renameSides.modified);
		expect((await loadCommitSides(repo, init!)).original.kind).toBe('missing');
	});

	it('returns an empty history for untracked files', async () => {
		const root = makeRepo({ 'a.txt': 'a\n' });
		cleanup.push(root);
		write(root, 'u.txt', 'u\n');
		expect(await (await open(root)).fileHistory('u.txt', 10)).toEqual([]);
	});

	it('blames committed and uncommitted lines of the working tree file', async () => {
		const root = makeRepo({ 'a.txt': 'one\ntwo\n' });
		cleanup.push(root);
		write(root, 'a.txt', 'one\ntwo\nthree\n');
		const repo = await open(root);
		const lines = await repo.blame('a.txt');
		expect(lines).toHaveLength(3);
		expect(lines[0]).toMatchObject({ author: 'Test', summary: 'init', uncommitted: false });
		expect(lines[2]?.uncommitted).toBe(true);
		write(root, 'u.txt', 'u\n');
		await expect(repo.blame('u.txt')).rejects.toThrow();
	});

	it('maps files under the opened folder to repository paths', async () => {
		const root = makeRepo({ 'src/a.ts': 'a\n' });
		cleanup.push(root);
		const repo = await open(`${root}/src`);
		expect(repo.repoPath(`${root}/src/a.ts`)).toBe('src/a.ts');
		expect(repo.repoPath(`${root}/other.ts`)).toBeNull();
		expect(repo.repoPath(`${root}/src`)).toBeNull();
	});
});
