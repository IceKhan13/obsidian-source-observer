import { diff } from '@codemirror/merge';

export interface DiffStats {
	added: number;
	removed: number;
}

/** Above this many distinct lines, fall back to a cheap count instead of diffing. */
const MAX_DISTINCT_LINES = 60000;
/** First code unit used to encode lines; skips control and ASCII ranges. */
const CODE_BASE = 0x100;

/**
 * Counts added and removed lines the way `git diff --stat` does. Each
 * distinct line is mapped to one character so the character-level diff from
 * `@codemirror/merge` becomes a line-level diff. (The merge view's own
 * chunks are character-based and can span extra, partially matched lines.)
 */
export function diffStats(original: string, modified: string): DiffStats {
	if (original === modified) return { added: 0, removed: 0 };
	const a = original.split(/\r?\n/);
	const b = modified.split(/\r?\n/);
	const ids = new Map<string, number>();
	const encode = (lines: string[]) => {
		let out = '';
		for (const line of lines) {
			let id = ids.get(line);
			if (id === undefined) {
				id = ids.size;
				ids.set(line, id);
			}
			out += String.fromCharCode(CODE_BASE + id);
		}
		return out;
	};
	const encA = encode(a);
	const encB = encode(b);
	if (ids.size > MAX_DISTINCT_LINES) {
		return { added: Math.max(0, b.length - a.length), removed: Math.max(0, a.length - b.length) };
	}
	let added = 0;
	let removed = 0;
	for (const change of diff(encA, encB)) {
		removed += change.toA - change.fromA;
		added += change.toB - change.fromB;
	}
	return { added, removed };
}
