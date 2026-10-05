import { readViewableFile, LoadedContent } from '../utils/content';
import type { GitRepo } from './GitRepo';
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
