import type { GitRepo } from '../git/GitRepo';
import { DiffSides, loadDiffSides } from '../git/diffSources';
import { badgeFor, ChangedFile, ChangeEntry, primaryKind } from '../git/status';
import { formatBytes, LoadedContent } from '../utils/content';
import { formatPatch, formatPatchNote, patchHunks, PatchPaths } from '../utils/patch';

/** Files are no longer added once the diff is this long, in characters. */
export const MAX_PATCH_CHARS = 1_000_000;
/** At most this many files go into one diff. */
export const MAX_PATCH_FILES = 500;
/** Files whose two versions are read at the same time. */
const LOAD_BATCH = 8;

export interface ChangesPatch {
	text: string;
	/** Files in the diff. */
	files: number;
	/** Changed files left out because the diff reached its limits. */
	omitted: number;
}

/**
 * Every uncommitted change, from HEAD to the working tree, with one entry
 * per file. They use the `base` group with HEAD as the base, so
 * `loadDiffSides` compares HEAD with the working tree.
 */
export function uncommittedEntries(files: ChangedFile[]): ChangeEntry[] {
	const base = { ref: 'HEAD', commit: 'HEAD' };
	return files.map((file) => ({ group: 'base', kind: primaryKind(file), file, base }));
}

/** Paths of both sides of a change; see `loadDiffSides` for what each group compares. */
export function entryPaths(entry: ChangeEntry, sides: DiffSides): PatchPaths {
	const { file, group } = entry;
	// Unstaged and conflict diffs start from the index or HEAD at the current path.
	const oldPath = group === 'unstaged' || group === 'conflicts' ? file.path : file.origPath ?? file.path;
	return {
		oldPath: sides.original.kind === 'missing' ? null : oldPath,
		newPath: sides.modified.kind === 'missing' ? null : file.path,
	};
}

function textOf(content: LoadedContent): string {
	return content.kind === 'text' ? content.text : '';
}

/** Why a side's content cannot be included, or null when it can. */
function problemOf(content: LoadedContent): string | null {
	switch (content.kind) {
		case 'binary': return 'binary';
		case 'too-large': return `too large to include (${formatBytes(content.size)})`;
		case 'error': return `cannot be read: ${content.message}`;
		default: return null;
	}
}

/** The unified diff of one change, as `git diff` prints it; '' when nothing changed. */
export function entryPatch(entry: ChangeEntry, sides: DiffSides): string {
	const paths = entryPaths(entry, sides);
	const problem = problemOf(sides.original) ?? problemOf(sides.modified);
	if (problem === 'binary') {
		const a = paths.oldPath === null ? '/dev/null' : `a/${paths.oldPath}`;
		const b = paths.newPath === null ? '/dev/null' : `b/${paths.newPath}`;
		return formatPatchNote(paths, `Binary files ${a} and ${b} differ`);
	}
	if (problem) return formatPatchNote(paths, `# Not included: the file is ${problem}`);
	return formatPatch(paths, patchHunks(textOf(sides.original), textOf(sides.modified)));
}

/**
 * One unified diff for `entries`, preceded by `preamble`. Stops adding files
 * at `MAX_PATCH_FILES` or `MAX_PATCH_CHARS` and ends with a note saying how
 * many were left out.
 */
export async function changesPatch(repo: GitRepo, entries: ChangeEntry[], preamble = ''): Promise<ChangesPatch> {
	const parts: string[] = [];
	let length = preamble.length;
	let files = 0;
	let omitted = 0;
	for (let i = 0; i < entries.length && omitted === 0; i += LOAD_BATCH) {
		const batch = entries.slice(i, i + LOAD_BATCH);
		const patches = await Promise.all(batch.map(async (entry) => entryPatch(entry, await loadDiffSides(repo, entry))));
		for (const [j, patch] of patches.entries()) {
			if (!patch) continue;
			if (files >= MAX_PATCH_FILES || length + patch.length > MAX_PATCH_CHARS) {
				omitted = entries.length - (i + j);
				break;
			}
			parts.push(patch);
			length += patch.length;
			files++;
		}
	}
	if (omitted > 0) {
		parts.push(`# ${omitted} more changed ${omitted === 1 ? 'file is' : 'files are'} not included: the diff reached its size limit\n`);
	}
	return { text: preamble + parts.join(''), files, omitted };
}

/** One line per changed file, such as `M src/a.ts` or `R old.ts → new.ts`; a file listed twice appears once. */
export function changedFileList(entries: ChangeEntry[]): string {
	const lines = new Map<string, string>();
	for (const { file, kind } of entries) {
		if (lines.has(file.path)) continue;
		const where = file.origPath && file.origPath !== file.path ? `${file.origPath} → ${file.path}` : file.path;
		lines.set(file.path, `${badgeFor(kind)} ${where}`);
	}
	return [...lines.values()].join('\n');
}
