import { promises as fsp } from 'fs';
import * as path from 'path';
import { GitRepo } from '../git/GitRepo';
import type { WorktreeInfo } from '../git/worktrees';
import { isDirectory } from '../utils/paths';

export interface WorktreeSummary extends WorktreeInfo {
	/** True for the worktree containing the opened folder. */
	current: boolean;
	/** True for the first (main) worktree. */
	main: boolean;
	/** Number of changed files, or null when the status could not be read. */
	changed: number | null;
	ahead: number;
	behind: number;
	/** Whether the worktree can be opened: not bare, not prunable, and its folder exists. */
	available: boolean;
}

async function realpathOrSelf(p: string): Promise<string> {
	try {
		return await fsp.realpath(p);
	} catch {
		return path.resolve(p);
	}
}

/**
 * Every worktree of `repo` with its change count and ahead/behind, read
 * with one `git status` per worktree. Worktrees that cannot be opened are
 * listed with `available: false`.
 */
export async function loadWorktreeSummaries(repo: GitRepo): Promise<WorktreeSummary[]> {
	const list = await repo.worktrees();
	const root = await realpathOrSelf(repo.root);
	return Promise.all(list.map(async (wt, i): Promise<WorktreeSummary> => {
		const real = await realpathOrSelf(wt.path);
		const summary: WorktreeSummary = {
			...wt,
			current: real === root,
			main: i === 0,
			changed: null,
			ahead: 0,
			behind: 0,
			available: false,
		};
		if (wt.bare || wt.prunable !== null) return summary;
		const opened = await GitRepo.open(wt.path);
		if (opened.kind !== 'repo') return summary;
		summary.available = true;
		try {
			const status = await opened.repo.status();
			summary.changed = status.files.length;
			summary.ahead = status.branch.ahead;
			summary.behind = status.branch.behind;
		} catch {
			// Listed without counts.
		}
		return summary;
	}));
}

/**
 * The folder to open in `target` so that the same subfolder stays open,
 * falling back to the worktree root when it does not exist there.
 */
export async function equivalentFolder(target: string, prefix: string): Promise<string> {
	if (!prefix) return target;
	const candidate = path.resolve(target, prefix);
	return (await isDirectory(candidate)) ? candidate : target;
}
