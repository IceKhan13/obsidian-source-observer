/**
 * Pure parser for `git status --porcelain=v2 -z --branch`. Kept free of
 * Obsidian and Node imports so it can be unit tested in isolation.
 */

/** One-letter status code as git reports it ('.' means unchanged). */
export type StatusCode = '.' | 'M' | 'T' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';

/**
 * Which side of the comparison a change belongs to; `base` compares a base
 * branch's merge base with the working tree.
 */
export type ChangeGroup = 'conflicts' | 'staged' | 'unstaged' | 'base';

/** Coarse classification used for badges, counts and tree colours. */
export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';

export interface ChangedFile {
	/** Path relative to the repository root, '/'-separated. */
	path: string;
	/** Original path for renames and copies (index side only). */
	origPath?: string;
	/** Index (staged) status — the X in XY. */
	index: StatusCode;
	/** Worktree (unstaged) status — the Y in XY. */
	worktree: StatusCode;
	untracked: boolean;
	conflicted: boolean;
}

export interface BranchInfo {
	/** Branch name, or null when HEAD is detached. */
	head: string | null;
	/** Commit id, or null before the first commit. */
	oid: string | null;
	upstream: string | null;
	ahead: number;
	behind: number;
}

export interface RepoStatus {
	branch: BranchInfo;
	files: ChangedFile[];
}

/** A changed file as it appears in one group of the Changes list. */
export interface ChangeEntry {
	group: ChangeGroup;
	kind: ChangeKind;
	file: ChangedFile;
	/** For the `base` group: the base branch and its merge base with HEAD. */
	base?: { ref: string; commit: string };
}

function asCode(ch: string | undefined): StatusCode {
	switch (ch) {
		case 'M': case 'T': case 'A': case 'D': case 'R': case 'C': case 'U': case '?':
			return ch;
		default:
			return '.';
	}
}

/** Joins the fields from `start` onwards — paths may contain spaces. */
function rest(fields: string[], start: number): string {
	return fields.slice(start).join(' ');
}

/** Parses the NUL-separated output of `git status --porcelain=v2 -z --branch`. */
export function parseStatusV2(stdout: string): RepoStatus {
	const branch: BranchInfo = { head: null, oid: null, upstream: null, ahead: 0, behind: 0 };
	const files: ChangedFile[] = [];
	const entries = stdout.split('\0');

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i] ?? '';
		if (!entry) continue;
		const fields = entry.split(' ');
		const type = fields[0];

		if (type === '#') {
			const key = fields[1];
			const value = rest(fields, 2);
			if (key === 'branch.oid') branch.oid = value === '(initial)' ? null : value;
			else if (key === 'branch.head') branch.head = value === '(detached)' ? null : value;
			else if (key === 'branch.upstream') branch.upstream = value;
			else if (key === 'branch.ab') {
				const m = /^\+(\d+) -(\d+)$/.exec(value);
				if (m) {
					branch.ahead = Number(m[1]);
					branch.behind = Number(m[2]);
				}
			}
			continue;
		}

		const xy = fields[1] ?? '..';
		if (type === '1') {
			// 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
			files.push({
				path: rest(fields, 8),
				index: asCode(xy[0]),
				worktree: asCode(xy[1]),
				untracked: false,
				conflicted: false,
			});
		} else if (type === '2') {
			// 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path>\0<origPath>
			const origPath = entries[++i] ?? '';
			files.push({
				path: rest(fields, 9),
				origPath: origPath || undefined,
				index: asCode(xy[0]),
				worktree: asCode(xy[1]),
				untracked: false,
				conflicted: false,
			});
		} else if (type === 'u') {
			// u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
			files.push({
				path: rest(fields, 10),
				index: 'U',
				worktree: 'U',
				untracked: false,
				conflicted: true,
			});
		} else if (type === '?') {
			files.push({
				path: rest(fields, 1),
				index: '?',
				worktree: '?',
				untracked: true,
				conflicted: false,
			});
		}
		// '!' (ignored) entries are not requested and are skipped.
	}

	return { branch, files };
}

function kindFor(code: StatusCode): ChangeKind {
	switch (code) {
		case 'A': return 'added';
		case 'D': return 'deleted';
		case 'R': case 'C': return 'renamed';
		default: return 'modified';
	}
}

/**
 * Splits files into the groups shown in the Changes list. A file with both
 * staged and unstaged edits (e.g. `MM`) appears once in each group.
 */
export function groupChanges(files: ChangedFile[]): ChangeEntry[] {
	const out: ChangeEntry[] = [];
	for (const file of files) {
		if (file.conflicted) {
			out.push({ group: 'conflicts', kind: 'conflicted', file });
			continue;
		}
		if (file.untracked) {
			out.push({ group: 'unstaged', kind: 'untracked', file });
			continue;
		}
		if (file.index !== '.') out.push({ group: 'staged', kind: kindFor(file.index), file });
		if (file.worktree !== '.') out.push({ group: 'unstaged', kind: kindFor(file.worktree), file });
	}
	return out;
}

/** The single kind used to colour a file in the tree and count it in the header. */
export function primaryKind(file: ChangedFile): ChangeKind {
	if (file.conflicted) return 'conflicted';
	if (file.untracked) return 'untracked';
	if (file.worktree === 'D' || (file.index === 'D' && file.worktree === '.')) return 'deleted';
	if (file.index === 'A') return 'added';
	if (file.index === 'R' || file.index === 'C') return 'renamed';
	return 'modified';
}

export interface ChangeCounts {
	added: number;
	modified: number;
	deleted: number;
	conflicted: number;
}

/** Counts each file exactly once, by its primary kind. */
export function countChanges(files: ChangedFile[]): ChangeCounts {
	return countKinds(files.map(primaryKind));
}

/** Counts change kinds for the header badges; untracked files count as added. */
export function countKinds(kinds: ChangeKind[]): ChangeCounts {
	const counts: ChangeCounts = { added: 0, modified: 0, deleted: 0, conflicted: 0 };
	for (const kind of kinds) {
		if (kind === 'added' || kind === 'untracked') counts.added++;
		else if (kind === 'deleted') counts.deleted++;
		else if (kind === 'conflicted') counts.conflicted++;
		else counts.modified++;
	}
	return counts;
}

/** Badge letter for a change kind. */
export function badgeFor(kind: ChangeKind): string {
	switch (kind) {
		case 'added': return 'A';
		case 'modified': return 'M';
		case 'deleted': return 'D';
		case 'renamed': return 'R';
		case 'untracked': return 'U';
		case 'conflicted': return '!';
	}
}
