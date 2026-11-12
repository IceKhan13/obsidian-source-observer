import { Notice } from 'obsidian';
import type { GitRepo } from '../git/GitRepo';
import { loadDiffSides } from '../git/diffSources';
import type { ChangeEntry, RepoStatus } from '../git/status';
import { referenceList } from '../links/agentFormat';
import { changedFileList, changesPatch, entryPatch, uncommittedEntries } from '../services/ChangesPatch';
import { copyToClipboard } from '../utils/system';
import type { FileMenuItem } from './fileMenu';
import type { ListedChanges } from './sidebar/ChangesSection';

/**
 * Menu items for copying code and changes to paste into a coding agent.
 * Paths are repository-relative, matching an agent started at the root.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Copy references" for one file's search matches and for all results. */
export function searchReferenceItems(
	agentPath: string,
	lines: number[],
	all: { path: string; line: number }[],
): FileMenuItem[] {
	const items: FileMenuItem[] = [];
	if (lines.length > 0) {
		items.push({
			title: lines.length === 1 ? 'Copy reference to match' : `Copy references to ${lines.length} matches`,
			icon: 'at-sign',
			run: () => {
				void copyToClipboard(referenceList(lines.map((line) => ({ path: agentPath, line }))), `Copied ${plural(lines.length, 'reference')}`);
			},
		});
	}
	if (all.length > lines.length) {
		items.push({
			title: `Copy references to all ${all.length} results`,
			icon: 'at-sign',
			run: () => { void copyToClipboard(referenceList(all), `Copied ${plural(all.length, 'reference')}`); },
		});
	}
	return items;
}

/** "Copy diff" for one change in the Changes list. */
export function changeDiffItem(repo: GitRepo, entry: ChangeEntry): FileMenuItem {
	return {
		title: 'Copy diff',
		icon: 'file-diff',
		run: () => {
			void loadDiffSides(repo, entry).then((sides) => {
				const patch = entryPatch(entry, sides);
				if (patch) void copyToClipboard(patch, `Copied diff of ${entry.file.path}`);
				else new Notice('No textual changes to copy');
			}, (err: unknown) => {
				new Notice(`Cannot copy diff: ${err instanceof Error ? err.message : String(err)}`);
			});
		},
	};
}

/** Builds a diff of `entries` and copies it, reporting how many files it covers. */
async function copyPatch(repo: GitRepo, entries: ChangeEntry[], preamble = '') {
	let result;
	try {
		result = await changesPatch(repo, entries, preamble);
	} catch (err) {
		new Notice(`Cannot copy changes: ${err instanceof Error ? err.message : String(err)}`);
		return;
	}
	if (result.files === 0) {
		new Notice('No textual changes to copy');
		return;
	}
	const left = result.omitted > 0 ? ` (${result.omitted} more left out: the diff is too large)` : '';
	await copyToClipboard(result.text, `Copied diff of ${plural(result.files, 'file')}${left}`);
}

/**
 * Every listed change, one entry per file: uncommitted changes from HEAD to
 * the working tree, or changes against the base branch with a comment
 * naming both branches.
 */
function allChanges(status: RepoStatus, listed: ListedChanges): { entries: ChangeEntry[]; preamble: string } {
	const { base } = listed;
	if (!base) return { entries: uncommittedEntries(status.files), preamble: '' };
	const head = status.branch.head ?? 'HEAD';
	return { entries: listed.entries, preamble: `# ${head} compared with ${base.ref} (merge base ${base.commit.slice(0, 7)})\n` };
}

/** Copies every listed change as one diff. */
export function copyAllChanges(repo: GitRepo, status: RepoStatus, listed: ListedChanges) {
	const { entries, preamble } = allChanges(status, listed);
	void copyPatch(repo, entries, preamble);
}

/** The Changes header menu: all changes, staged changes, or the list of changed files. */
export function changesCopyItems(repo: GitRepo, status: RepoStatus, listed: ListedChanges): FileMenuItem[][] {
	const { base } = listed;
	const all = allChanges(status, listed).entries;
	const staged = base ? [] : listed.entries.filter((e) => e.group === 'staged');
	const diffs: FileMenuItem[] = [{
		title: base ? `Copy all changes against ${base.ref} as diff` : 'Copy all changes as diff',
		icon: 'file-diff',
		run: () => copyAllChanges(repo, status, listed),
	}];
	if (staged.length > 0) {
		diffs.push({ title: 'Copy staged changes as diff', icon: 'file-diff', run: () => { void copyPatch(repo, staged); } });
	}
	const list: FileMenuItem = {
		title: 'Copy list of changed files',
		icon: 'list',
		run: () => {
			if (all.length === 0) new Notice('No changes to copy');
			else void copyToClipboard(changedFileList(all), `Copied ${plural(all.length, 'changed file')}`);
		},
	};
	return [diffs, [list]];
}
