/** Object name git uses for lines that are not committed yet. */
const UNCOMMITTED = /^0{40}$/;

export interface BlameCommit {
	hash: string;
	author: string;
	/** Author time, in seconds since the epoch. */
	time: number;
	summary: string;
	/** Root-relative path of the file in this commit. */
	filename: string;
	/** Root-relative path in the parent commit, when git reports one. */
	previousFilename: string | null;
	/** True for lines changed in the working tree or index. */
	uncommitted: boolean;
}

/**
 * Parses `git blame --porcelain`. Returns one entry per line of the
 * blamed file (index 0 is line 1); commits are shared between lines.
 */
export function parseBlame(out: string): BlameCommit[] {
	const commits = new Map<string, BlameCommit>();
	const lines: BlameCommit[] = [];
	let current: BlameCommit | null = null;
	let finalLine = 0;
	for (const row of out.split('\n')) {
		if (row.startsWith('\t')) {
			if (current && finalLine > 0) lines[finalLine - 1] = current;
			continue;
		}
		const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(row);
		if (header) {
			const hash = header[1] ?? '';
			finalLine = Number(header[2]);
			current = commits.get(hash) ?? null;
			if (!current) {
				current = {
					hash,
					author: '',
					time: 0,
					summary: '',
					filename: '',
					previousFilename: null,
					uncommitted: UNCOMMITTED.test(hash),
				};
				commits.set(hash, current);
			}
			continue;
		}
		if (!current) continue;
		const space = row.indexOf(' ');
		const key = space < 0 ? row : row.slice(0, space);
		const value = space < 0 ? '' : row.slice(space + 1);
		switch (key) {
			case 'author': current.author = value; break;
			case 'author-time': current.time = Number(value) || 0; break;
			case 'summary': current.summary = value; break;
			case 'filename': current.filename = value; break;
			case 'previous': {
				const sep = value.indexOf(' ');
				current.previousFilename = sep < 0 ? null : value.slice(sep + 1);
				break;
			}
		}
	}
	// Fill gaps (should not happen with well-formed output) so callers can index safely.
	for (let i = 0; i < lines.length; i++) lines[i] ??= lines[i - 1] as BlameCommit;
	return lines;
}
