import { diff } from '@codemirror/merge';

/** Lines `[fromA, toA)` of the old text were replaced by lines `[fromB, toB)` of the new one (0-based). */
export interface LineChange {
	fromA: number;
	toA: number;
	fromB: number;
	toB: number;
}

/** Above this many distinct lines, fall back to one change between the common prefix and suffix. */
const MAX_DISTINCT_LINES = 60000;
/** First code unit used to encode lines; skips control and ASCII ranges. */
const CODE_BASE = 0x100;

/**
 * Line-level diff of two lists of lines, in order. Each distinct line is
 * mapped to one character so the character-level diff from
 * `@codemirror/merge` becomes a line-level diff. (The merge view's own
 * chunks are character-based and can span extra, partially matched lines.)
 */
export function lineDiff(a: readonly string[], b: readonly string[]): LineChange[] {
	const ids = new Map<string, number>();
	const encode = (lines: readonly string[]) => {
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
	if (encA === encB) return [];
	if (ids.size > MAX_DISTINCT_LINES) return [trimmedChange(a, b)];
	return diff(encA, encB).map(({ fromA, toA, fromB, toB }) => ({ fromA, toA, fromB, toB }));
}

/** A single change covering everything between the common first and last lines. */
function trimmedChange(a: readonly string[], b: readonly string[]): LineChange {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	return { fromA: start, toA: endA, fromB: start, toB: endB };
}
