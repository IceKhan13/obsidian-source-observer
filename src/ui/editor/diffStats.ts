import { lineDiff } from '../../utils/lineDiff';

export interface DiffStats {
	added: number;
	removed: number;
}

/** Counts added and removed lines the way `git diff --stat` does. */
export function diffStats(original: string, modified: string): DiffStats {
	if (original === modified) return { added: 0, removed: 0 };
	let added = 0;
	let removed = 0;
	for (const change of lineDiff(original.split(/\r?\n/), modified.split(/\r?\n/))) {
		removed += change.toA - change.fromA;
		added += change.toB - change.fromB;
	}
	return { added, removed };
}
