import type { ChangeKind } from './status';

/** A file that differs between a base commit and the working tree. */
export interface BaseChange {
	/** Root-relative path in the working tree. */
	path: string;
	/** Root-relative path at the base commit, for renames and copies. */
	origPath?: string;
	kind: ChangeKind;
}

function kindOf(status: string): ChangeKind {
	switch (status.charAt(0)) {
		case 'A': return 'added';
		case 'D': return 'deleted';
		case 'R': case 'C': return 'renamed';
		case 'U': return 'conflicted';
		default: return 'modified';
	}
}

/** Parses `git diff --name-status -z`: `status\0path\0`, or `R100\0old\0new\0` for renames and copies. */
export function parseNameStatus(out: string): BaseChange[] {
	const tokens = out.split('\0');
	const changes: BaseChange[] = [];
	for (let i = 0; i < tokens.length;) {
		const status = tokens[i++] ?? '';
		if (!status) continue;
		if (/^[RC]/.test(status)) {
			const origPath = tokens[i++] ?? '';
			const path = tokens[i++] ?? '';
			if (path) changes.push({ path, origPath, kind: kindOf(status) });
		} else {
			const path = tokens[i++] ?? '';
			if (path) changes.push({ path, kind: kindOf(status) });
		}
	}
	return changes;
}
