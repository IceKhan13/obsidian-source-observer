export interface WorktreeInfo {
	/** Absolute path of the working tree. */
	path: string;
	/** Commit checked out, or '' for a repository without commits. */
	head: string;
	/** Short branch name, or null when detached. */
	branch: string | null;
	/** True for the bare repository entry, which has no working tree. */
	bare: boolean;
	/** Lock reason ('' when locked without one), or null when not locked. */
	locked: string | null;
	/** Why git considers the worktree prunable (e.g. its folder is gone), or null. */
	prunable: string | null;
}

/** Parses `git worktree list --porcelain`. The first entry is the main worktree. */
export function parseWorktreeList(out: string): WorktreeInfo[] {
	const worktrees: WorktreeInfo[] = [];
	let current: WorktreeInfo | null = null;
	for (const line of out.split('\n')) {
		const space = line.indexOf(' ');
		const key = space < 0 ? line : line.slice(0, space);
		const value = space < 0 ? '' : line.slice(space + 1);
		if (key === 'worktree') {
			current = { path: value, head: '', branch: null, bare: false, locked: null, prunable: null };
			worktrees.push(current);
			continue;
		}
		if (!current) continue;
		switch (key) {
			case 'HEAD': current.head = value; break;
			case 'branch': current.branch = value.replace(/^refs\/heads\//, ''); break;
			case 'bare': current.bare = true; break;
			case 'locked': current.locked = value; break;
			case 'prunable': current.prunable = value; break;
		}
	}
	return worktrees;
}
