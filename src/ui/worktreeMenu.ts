import { Menu } from 'obsidian';
import { homedir } from 'os';
import * as path from 'path';
import type { WorktreeSummary } from '../services/Worktrees';

/** Branch name, or "detached at abc1234". */
export function worktreeName(wt: WorktreeSummary): string {
	if (wt.bare) return '(bare repository)';
	if (wt.branch) return wt.branch;
	return wt.head ? `detached at ${wt.head.slice(0, 7)}` : 'no commits yet';
}

/**
 * Where the worktree lives, as briefly as possible: relative to the main
 * worktree when inside it (e.g. `.claude/worktrees/x`), else with `~`.
 */
export function worktreeLocation(wt: WorktreeSummary, mainPath: string, home = homedir()): string {
	if (wt.main) return wt.path.replace(home, '~');
	const rel = path.relative(mainPath, wt.path);
	if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
	return wt.path.startsWith(home + path.sep) ? `~${wt.path.slice(home.length)}` : wt.path;
}

/** "3 changed · ↑1 ↓2 · locked: reason", or "" when there is nothing to say. */
export function worktreeDetails(wt: WorktreeSummary): string {
	const parts: string[] = [];
	if (wt.prunable !== null) parts.push('missing — run git worktree prune');
	else if (!wt.available && !wt.bare) parts.push('unavailable');
	if (wt.changed !== null) parts.push(wt.changed === 0 ? 'clean' : `${wt.changed} changed`);
	const ab = [wt.ahead ? `↑${wt.ahead}` : '', wt.behind ? `↓${wt.behind}` : ''].filter(Boolean).join(' ');
	if (ab) parts.push(ab);
	if (wt.locked !== null) parts.push(wt.locked ? `locked: ${wt.locked}` : 'locked');
	return parts.join(' · ');
}

/**
 * Shows the worktrees of a repository at `position`. The current worktree
 * is checked; bare, missing and unreadable worktrees are listed but disabled.
 */
export function showWorktreeMenu(
	doc: Document,
	position: { x: number; y: number },
	worktrees: WorktreeSummary[],
	onChoose: (wt: WorktreeSummary) => void,
): Menu {
	const menu = new Menu();
	const mainPath = worktrees.find((wt) => wt.main)?.path ?? '';
	for (const wt of worktrees) {
		if (wt.bare) continue;
		const title = doc.createDocumentFragment();
		const name = title.createDiv({ cls: 'so-wt-name', text: worktreeName(wt) });
		if (wt.main) name.createSpan({ cls: 'so-wt-tag', text: 'main' });
		title.createDiv({ cls: 'so-wt-location', text: worktreeLocation(wt, mainPath) });
		const details = worktreeDetails(wt);
		if (details) title.createDiv({ cls: 'so-wt-details', text: details });
		menu.addItem((item) => {
			item.setTitle(title)
				.setIcon(wt.locked !== null ? 'lock' : 'git-branch')
				.setChecked(wt.current)
				.setDisabled(!wt.available)
				.onClick(() => { if (!wt.current) onChoose(wt); });
		});
	}
	menu.showAtPosition(position, doc);
	return menu;
}
