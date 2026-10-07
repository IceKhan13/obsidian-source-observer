import type { GitRepo } from '../git/GitRepo';
import type { ChangeEntry, RepoStatus } from '../git/status';

export type BaseComparison =
	| { kind: 'ok'; ref: string; commit: string; ahead: number; entries: ChangeEntry[] }
	| { kind: 'error'; ref: string | null; message: string };

/**
 * Everything the working tree changed since it branched off `ref`: tracked
 * files that differ from the merge base of HEAD and `ref` (committed,
 * staged or not), plus untracked files from `status`.
 */
export async function compareWithBase(repo: GitRepo, ref: string | null, status: RepoStatus): Promise<BaseComparison> {
	if (!ref) return { kind: 'error', ref, message: 'No base branch found — select one above' };
	if (!(await repo.hasCommit(ref))) return { kind: 'error', ref, message: `Branch ${ref} not found` };
	let commit: string;
	try {
		commit = await repo.mergeBase(ref);
	} catch {
		return { kind: 'error', ref, message: `No common history with ${ref}` };
	}
	const [changes, ahead] = await Promise.all([repo.diffAgainst(commit), repo.commitsSince(commit)]);
	const base = { ref, commit };
	const entries: ChangeEntry[] = changes.map((c) => ({
		group: 'base',
		kind: c.kind,
		base,
		file: {
			path: c.path,
			origPath: c.origPath,
			index: '.',
			worktree: '.',
			untracked: false,
			conflicted: c.kind === 'conflicted',
		},
	}));
	const seen = new Set(changes.map((c) => c.path));
	for (const file of status.files) {
		if (file.untracked && !seen.has(file.path)) entries.push({ group: 'base', kind: 'untracked', base, file });
	}
	entries.sort((a, b) => a.file.path.localeCompare(b.file.path));
	return { kind: 'ok', ref, commit, ahead, entries };
}
