import * as path from 'path';
import type { GitRepo } from '../../git/GitRepo';
import type { FileCommit } from '../../git/history';
import type { ChangeEntry } from '../../git/status';
import { loadCommitSides, loadDiffSides } from '../../git/diffSources';
import type { LineRange } from '../../links/sourceLink';
import { entryPaths } from '../../services/ChangesPatch';
import { formatBytes, LoadedContent, readViewableFile } from '../../utils/content';
import type { PatchPaths } from '../../utils/patch';

/** Something the content pane can show. */
export type PaneTarget =
	| { type: 'file'; absPath: string; label: string; lines: LineRange | null }
	| { type: 'diff'; repo: GitRepo; entry: ChangeEntry; label: string }
	/** A file's change in one commit; `absPath` is the file in the working tree. */
	| { type: 'commit'; repo: GitRepo; commit: FileCommit; absPath: string; label: string };

/** Which version each side of a diff shows, for citing lines from it; null for the file on disk. */
export interface DiffRevisions {
	a: string | null;
	b: string | null;
}

/** What to render once a target's data has loaded. */
export type Plan =
	| { kind: 'code'; text: string; fileName: string; repo: GitRepo | null; repoPath: string | null }
	| {
		kind: 'diff';
		original: string;
		modified: string;
		fileName: string;
		worktreePath: string | null;
		/** Repository-relative paths of both sides, for patches and citations. */
		paths: PatchPaths;
		revisions: DiffRevisions;
		/** Comment line put before a copied patch, e.g. naming the commit. */
		preamble: string;
	}
	| { kind: 'message'; icon: string; text: string; detail?: string };

/** Versions compared by a change in the Changes list (see `loadDiffSides`). */
function changeRevisions(entry: ChangeEntry): DiffRevisions {
	switch (entry.group) {
		case 'staged': return { a: '@ HEAD', b: '(staged)' };
		case 'unstaged': return { a: '(staged)', b: null };
		case 'conflicts': return { a: '@ HEAD', b: null };
		case 'base': return { a: entry.base ? `@ ${entry.base.commit.slice(0, 7)}` : null, b: null };
	}
}

/** Turns a non-text load result into a message, or returns null for text/missing. */
function contentProblem(content: LoadedContent, what: string): Plan | null {
	switch (content.kind) {
		case 'binary':
			return { kind: 'message', icon: 'file-x', text: `Binary ${what}`, detail: formatBytes(content.size) };
		case 'too-large':
			return { kind: 'message', icon: 'file-warning', text: `${what} is too large to display`, detail: formatBytes(content.size) };
		case 'error':
			return { kind: 'message', icon: 'alert-triangle', text: `Cannot read ${what}`, detail: content.message };
		default:
			return null;
	}
}

function textOf(content: LoadedContent): string {
	return content.kind === 'text' ? content.text : '';
}

/** Loads what `target` needs to be rendered; `getRepo` gives the opened folder's repository. */
export async function loadPlan(target: PaneTarget, getRepo: () => GitRepo | null): Promise<Plan> {
	if (target.type === 'file') {
		const fileName = path.basename(target.absPath);
		const content = await readViewableFile(target.absPath);
		if (content.kind === 'missing') return { kind: 'message', icon: 'file-question', text: 'File not found' };
		const repo = getRepo();
		const repoPath = repo?.repoPath(target.absPath) ?? null;
		return contentProblem(content, 'file') ?? { kind: 'code', text: textOf(content), fileName, repo, repoPath };
	}

	if (target.type === 'commit') {
		const { repo, commit } = target;
		const { original, modified } = await loadCommitSides(repo, commit);
		const problem = contentProblem(original, 'file') ?? contentProblem(modified, 'file');
		if (problem) return problem;
		const before = textOf(original);
		const after = textOf(modified);
		if (before === after) {
			const detail = commit.origPath ? `Renamed from ${commit.origPath}` : 'The file content did not change in this commit';
			return { kind: 'message', icon: 'check', text: 'No textual changes', detail };
		}
		return {
			kind: 'diff',
			original: before,
			modified: after,
			fileName: path.basename(commit.path),
			worktreePath: target.absPath,
			paths: {
				oldPath: original.kind === 'missing' ? null : commit.origPath ?? commit.path,
				newPath: modified.kind === 'missing' ? null : commit.path,
			},
			revisions: { a: `@ ${commit.short}^`, b: `@ ${commit.short}` },
			preamble: `# Commit ${commit.short}: ${commit.subject}\n`,
		};
	}

	const { repo, entry } = target;
	const fileName = path.basename(entry.file.path);
	const sides = await loadDiffSides(repo, entry);
	const { original, modified } = sides;
	const problem = contentProblem(original, 'file') ?? contentProblem(modified, 'file');
	if (problem) return problem;
	const before = textOf(original);
	const after = textOf(modified);
	if (before === after) {
		return { kind: 'message', icon: 'check', text: 'No textual changes', detail: 'Both versions have identical content' };
	}
	const worktreePath = entry.group !== 'staged' && modified.kind === 'text' ? repo.absPath(entry.file.path) : null;
	return {
		kind: 'diff',
		original: before,
		modified: after,
		fileName,
		worktreePath,
		paths: entryPaths(entry, sides),
		revisions: changeRevisions(entry),
		preamble: '',
	};
}
