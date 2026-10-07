import { readViewableFile, LoadedContent } from '../utils/content';
import type { GitRepo } from './GitRepo';
import type { FileCommit } from './history';
import type { ChangeEntry } from './status';

export interface DiffSides {
	original: LoadedContent;
	modified: LoadedContent;
}

/**
 * Loads the two documents to compare for a change:
 * - staged:    HEAD (original path for renames) → index
 * - unstaged:  index → working tree (empty → working tree when untracked)
 * - conflicts: HEAD → working tree, which shows the conflict markers
 * - base:      merge base with the base branch → working tree
 * A side that does not exist (added or deleted file) loads as `missing`
 * and is treated as an empty document by the renderer.
 */
export async function loadDiffSides(repo: GitRepo, entry: ChangeEntry): Promise<DiffSides> {
	const { file, group } = entry;
	const worktree = () => readViewableFile(repo.absPath(file.path));

	if (group === 'staged') {
		const [original, modified] = await Promise.all([
			repo.readBlob(`HEAD:${file.origPath ?? file.path}`),
			repo.readBlob(`:${file.path}`),
		]);
		return { original, modified };
	}
	if (group === 'base' && entry.base) {
		const original = file.untracked
			? { kind: 'missing' as const }
			: await repo.readBlob(`${entry.base.commit}:${file.origPath ?? file.path}`);
		return { original, modified: await worktree() };
	}
	if (group === 'conflicts') {
		const [original, modified] = await Promise.all([repo.readBlob(`HEAD:${file.path}`), worktree()]);
		return { original, modified };
	}
	if (file.untracked) {
		return { original: { kind: 'missing' }, modified: await worktree() };
	}
	const [original, modified] = await Promise.all([repo.readBlob(`:${file.path}`), worktree()]);
	return { original, modified };
}

/**
 * Loads the file before and after `commit`: its first parent (at the path
 * before a rename) → the commit. Either side is `missing` when the file was
 * added or deleted, or for the root commit.
 */
export async function loadCommitSides(repo: GitRepo, commit: FileCommit): Promise<DiffSides> {
	const [original, modified] = await Promise.all([
		repo.readBlob(`${commit.hash}^:${commit.origPath ?? commit.path}`),
		repo.readBlob(`${commit.hash}:${commit.path}`),
	]);
	return { original, modified };
}
