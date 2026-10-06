/** Record separator and field separator used in the `git log` format. */
const RS = '\x1e';
const FS = '\x1f';

/** `--format` for `git log`; parsed by `parseLog`. Records end with NUL under `-z`. */
export const LOG_FORMAT = `${RS}%H${FS}%h${FS}%an${FS}%ae${FS}%at${FS}%s`;

export interface CommitInfo {
	hash: string;
	short: string;
	author: string;
	email: string;
	/** Author time, in seconds since the epoch. */
	time: number;
	subject: string;
}

/** A commit in a file's history, with the file's path at that commit. */
export interface FileCommit extends CommitInfo {
	/** Name-status letter for the file in this commit (M, A, D, R, C, …). */
	status: string;
	/** Root-relative path of the file in this commit. */
	path: string;
	/** Root-relative path in the parent when renamed or copied, else null. */
	origPath: string | null;
}

/**
 * Parses `git log --follow -z --name-status --format=LOG_FORMAT -- <path>`.
 * Commits without a name-status entry (e.g. merges) keep the path of the
 * newer commit; renames carry the older path forward to older commits.
 */
export function parseLog(out: string, currentPath: string): FileCommit[] {
	const commits: FileCommit[] = [];
	let path = currentPath;
	for (const record of out.split(RS)) {
		if (!record.trim()) continue;
		const end = record.indexOf('\0');
		const header = end < 0 ? record : record.slice(0, end);
		const [hash = '', short = '', author = '', email = '', time = '0', ...subject] = header.split(FS);
		if (!hash) continue;
		const tokens = (end < 0 ? '' : record.slice(end + 1))
			.split('\0')
			.map((t) => t.replace(/^\n+/, ''))
			.filter(Boolean);
		const status = tokens[0] ?? 'M';
		let origPath: string | null = null;
		if (/^[RC]/.test(status) && tokens.length >= 3) {
			origPath = tokens[1] ?? null;
			path = tokens[2] ?? path;
		} else if (tokens[1]) {
			path = tokens[1];
		}
		commits.push({
			hash,
			short,
			author,
			email,
			time: Number(time) || 0,
			subject: subject.join(FS),
			status: status.charAt(0),
			path,
			origPath,
		});
		path = origPath ?? path;
	}
	return commits;
}
