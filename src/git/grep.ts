/** Longest line kept from `git grep` output, in characters; minified files can have huge lines. */
export const MAX_GREP_LINE_CHARS = 10_000;

export type GrepSyntax = 'fixed' | 'perl' | 'extended';

export interface GrepOptions {
	pattern: string;
	syntax: GrepSyntax;
	caseSensitive: boolean;
	wholeWord: boolean;
}

export interface GrepHit {
	/** Root-relative path. */
	path: string;
	/** 1-based line number. */
	line: number;
	text: string;
}

const SYNTAX_FLAG: Record<GrepSyntax, string> = { fixed: '-F', perl: '-P', extended: '-E' };

/**
 * Arguments for `git grep`, with config that would change the output format
 * (column numbers, colours) overridden. Untracked, non-ignored files are
 * searched too; binary files are skipped.
 */
export function grepArgs(opts: GrepOptions, scope: string[]): string[] {
	return [
		'-c', 'grep.column=false',
		'-c', 'grep.fullName=true',
		'grep', '-z', '-n', '-I', '--no-color', '--full-name', '--untracked',
		SYNTAX_FLAG[opts.syntax],
		...(opts.caseSensitive ? [] : ['-i']),
		...(opts.wholeWord ? ['-w'] : []),
		'-e', opts.pattern,
		...scope,
	];
}

/** Parses one output line of `git grep -z -n`: `path\0line\0text`. */
export function parseGrepLine(row: string): GrepHit | null {
	const a = row.indexOf('\0');
	const b = a < 0 ? -1 : row.indexOf('\0', a + 1);
	if (b < 0) return null;
	const line = Number(row.slice(a + 1, b));
	if (!Number.isInteger(line) || line < 1) return null;
	const text = row.slice(b + 1);
	return {
		path: row.slice(0, a),
		line,
		text: text.length > MAX_GREP_LINE_CHARS ? text.slice(0, MAX_GREP_LINE_CHARS) : text,
	};
}

/** True when git rejected `-P` because it was built without PCRE. */
export function isPcreUnsupported(message: string): boolean {
	return /perl|pcre/i.test(message) && /not (compiled|supported)|cannot use/i.test(message);
}
