import { LineChange, lineDiff } from './lineDiff';

/** Unchanged lines shown around each change, as in `git diff`. */
export const PATCH_CONTEXT = 3;

const NO_NEWLINE = '\\ No newline at end of file';
/** Appended to a last line without a newline, so it differs from the same line with one. */
const NO_NEWLINE_KEY = '\0no-newline';

interface SplitText {
	lines: string[];
	/** The text does not end with a newline. */
	missingNewline: boolean;
}

/** Lines of `text` without their '\n'; a '\r' is kept so CRLF files round-trip. */
function splitText(text: string): SplitText {
	if (text === '') return { lines: [], missingNewline: false };
	const lines = text.split('\n');
	const missingNewline = lines[lines.length - 1] !== '';
	if (!missingNewline) lines.pop();
	return { lines, missingNewline };
}

function diffKeys({ lines, missingNewline }: SplitText): string[] {
	if (!missingNewline) return lines;
	return lines.map((line, i) => (i === lines.length - 1 ? line + NO_NEWLINE_KEY : line));
}

/** One `@@` section of a unified diff. */
export interface Hunk {
	/** The `@@ -a,b +c,d @@` line. */
	header: string;
	/** Body lines, each starting with ' ', '-' or '+', plus "\ No newline" markers. */
	lines: string[];
	/** 1-based line in the new text where the hunk's first change is shown. */
	anchor: number;
}

/** `start,count` as git prints it: 0-based start for an empty range, count omitted when 1. */
function range(start: number, count: number): string {
	if (count === 0) return `${start},0`;
	return count === 1 ? String(start + 1) : `${start + 1},${count}`;
}

function buildHunk(group: LineChange[], a: SplitText, b: SplitText, context: number): Hunk {
	const first = group[0] as LineChange;
	const last = group[group.length - 1] as LineChange;
	const oldStart = Math.max(0, first.fromA - context);
	const oldEnd = Math.min(a.lines.length, last.toA + context);
	// Unchanged lines are the same on both sides, so the context lengths match.
	const newStart = first.fromB - (first.fromA - oldStart);
	const newEnd = last.toB + (oldEnd - last.toA);

	const lines: string[] = [];
	const push = (prefix: string, text: SplitText, i: number) => {
		lines.push(prefix + (text.lines[i] ?? ''));
		if (text.missingNewline && i === text.lines.length - 1) lines.push(NO_NEWLINE);
	};
	let pos = oldStart;
	for (const change of group) {
		for (; pos < change.fromA; pos++) push(' ', a, pos);
		for (let i = change.fromA; i < change.toA; i++) push('-', a, i);
		for (let i = change.fromB; i < change.toB; i++) push('+', b, i);
		pos = change.toA;
	}
	for (; pos < oldEnd; pos++) push(' ', a, pos);

	return {
		header: `@@ -${range(oldStart, oldEnd - oldStart)} +${range(newStart, newEnd - newStart)} @@`,
		lines,
		anchor: Math.max(1, Math.min(first.fromB + 1, b.lines.length)),
	};
}

/**
 * The hunks of a unified diff from `original` to `modified`. Changes closer
 * than twice the context are merged into one hunk, as git does.
 */
export function patchHunks(original: string, modified: string, context = PATCH_CONTEXT): Hunk[] {
	if (original === modified) return [];
	const a = splitText(original);
	const b = splitText(modified);
	const groups: LineChange[][] = [];
	for (const change of lineDiff(diffKeys(a), diffKeys(b))) {
		const group = groups[groups.length - 1];
		const prev = group?.[group.length - 1];
		if (group && prev && change.fromA - prev.toA <= 2 * context) group.push(change);
		else groups.push([change]);
	}
	return groups.map((group) => buildHunk(group, a, b, context));
}

/** Repository-relative paths of a file before and after a change; null for a side that does not exist. */
export interface PatchPaths {
	oldPath: string | null;
	newPath: string | null;
}

/** The `diff --git` line and the new, deleted or renamed file lines below it. */
function fileHeader({ oldPath, newPath }: PatchPaths): string[] {
	const before = oldPath ?? newPath ?? '';
	const after = newPath ?? oldPath ?? '';
	const out = [`diff --git a/${before} b/${after}`];
	if (oldPath === null) out.push('new file mode 100644');
	else if (newPath === null) out.push('deleted file mode 100644');
	else if (oldPath !== newPath) out.push(`rename from ${oldPath}`, `rename to ${newPath}`);
	return out;
}

/**
 * A unified diff of one file, as `git diff` prints it, or '' when there is
 * nothing to show. Each line ends with '\n'.
 */
export function formatPatch(paths: PatchPaths, hunks: Hunk[]): string {
	const renamed = !!paths.oldPath && !!paths.newPath && paths.oldPath !== paths.newPath;
	if (hunks.length === 0 && !renamed) return '';
	const out = fileHeader(paths);
	if (hunks.length > 0) {
		out.push(paths.oldPath === null ? '--- /dev/null' : `--- a/${paths.oldPath}`);
		out.push(paths.newPath === null ? '+++ /dev/null' : `+++ b/${paths.newPath}`);
		for (const hunk of hunks) out.push(hunk.header, ...hunk.lines);
	}
	return out.join('\n') + '\n';
}

/** A file whose content is not included, e.g. a binary file, with `note` in place of the hunks. */
export function formatPatchNote(paths: PatchPaths, note: string): string {
	return [...fileHeader(paths), note].join('\n') + '\n';
}
