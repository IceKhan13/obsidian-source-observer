import { describe, expect, it } from 'vitest';
import { countChanges, groupChanges, parseStatusV2, primaryKind } from '../src/git/status';

const Z = '\0';

describe('parseStatusV2', () => {
	it('parses branch headers', () => {
		const out = [
			'# branch.oid 0123456789abcdef0123456789abcdef01234567',
			'# branch.head feature/x',
			'# branch.upstream origin/feature/x',
			'# branch.ab +2 -5',
		].join(Z) + Z;
		expect(parseStatusV2(out).branch).toEqual({
			oid: '0123456789abcdef0123456789abcdef01234567',
			head: 'feature/x',
			upstream: 'origin/feature/x',
			ahead: 2,
			behind: 5,
		});
	});

	it('handles detached HEAD and the initial commit', () => {
		const out = ['# branch.oid (initial)', '# branch.head (detached)'].join(Z) + Z;
		const { branch } = parseStatusV2(out);
		expect(branch.oid).toBeNull();
		expect(branch.head).toBeNull();
	});

	it('parses ordinary, renamed, unmerged and untracked entries with spaces in paths', () => {
		const out = [
			'1 .M N... 100644 100644 100644 aaa aaa src/my file.ts',
			'1 A. N... 000000 100644 100644 000 bbb new.ts',
			'2 R. N... 100644 100644 100644 ccc ccc R100 dir/new name.ts',
			'dir/old name.ts',
			'u UU N... 100644 100644 100644 100644 d1 d2 d3 conflict.ts',
			'? untracked file.txt',
		].join(Z) + Z;
		const { files } = parseStatusV2(out);
		expect(files).toEqual([
			{ path: 'src/my file.ts', index: '.', worktree: 'M', untracked: false, conflicted: false },
			{ path: 'new.ts', index: 'A', worktree: '.', untracked: false, conflicted: false },
			{ path: 'dir/new name.ts', origPath: 'dir/old name.ts', index: 'R', worktree: '.', untracked: false, conflicted: false },
			{ path: 'conflict.ts', index: 'U', worktree: 'U', untracked: false, conflicted: true },
			{ path: 'untracked file.txt', index: '?', worktree: '?', untracked: true, conflicted: false },
		]);
	});

	it('returns nothing for empty output', () => {
		expect(parseStatusV2('').files).toEqual([]);
	});
});

describe('grouping and counting', () => {
	const files = parseStatusV2([
		'1 MM N... 100644 100644 100644 a b both.ts',
		'1 AM N... 000000 100644 100644 0 b added-then-edited.ts',
		'1 .D N... 100644 100644 000000 a a gone.ts',
		'2 R. N... 100644 100644 100644 a a R90 moved.ts',
		'was.ts',
		'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
		'? new.txt',
	].join(Z) + Z).files;

	it('puts a file with staged and unstaged edits in both groups', () => {
		const groups = groupChanges(files).filter((e) => e.file.path === 'both.ts').map((e) => e.group);
		expect(groups).toEqual(['staged', 'unstaged']);
	});

	it('keeps conflicts and untracked files in a single group', () => {
		const entries = groupChanges(files);
		expect(entries.filter((e) => e.file.path === 'conflict.ts').map((e) => e.group)).toEqual(['conflicts']);
		expect(entries.filter((e) => e.file.path === 'new.txt').map((e) => [e.group, e.kind])).toEqual([['unstaged', 'untracked']]);
	});

	it('counts every file exactly once', () => {
		// Previously "AM" was counted as both new and modified.
		const counts = countChanges(files);
		expect(counts).toEqual({ added: 2, modified: 2, deleted: 1, conflicted: 1 });
		expect(counts.added + counts.modified + counts.deleted + counts.conflicted).toBe(files.length);
	});

	it('classifies renames', () => {
		const moved = files.find((f) => f.path === 'moved.ts');
		expect(moved && primaryKind(moved)).toBe('renamed');
	});
});
