import { execFile, spawn } from 'child_process';
import * as path from 'path';
import { decodeContent, LoadedContent, MAX_VIEW_BYTES } from '../utils/content';
import { BlameCommit, parseBlame } from './blame';
import { GrepHit, grepArgs, GrepOptions, parseGrepLine } from './grep';
import { FileCommit, LOG_FORMAT, parseLog } from './history';
import { parseStatusV2, RepoStatus } from './status';

/**
 * Global options for every git invocation:
 * - `--no-optional-locks` stops `git status` from rewriting `.git/index`,
 *   which would otherwise wake our own index watcher and race with the
 *   user's git commands for `index.lock`.
 * - `--literal-pathspecs` makes paths containing `*`, `?` or `:` safe.
 */
const GLOBAL_ARGS = ['--no-optional-locks', '--literal-pathspecs', '-c', 'core.quotepath=off'];

/** Upper bound for text output (status, ls-files) from git, in bytes. */
const MAX_TEXT_OUTPUT = 64 * 1024 * 1024;

export class GitError extends Error {
	constructor(message: string, readonly missingGit = false) {
		super(message);
	}
}

interface ExecResult { stdout: Buffer; stderr: string }

function exec(cwd: string, args: string[], maxBuffer: number): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		execFile(
			'git',
			[...GLOBAL_ARGS, ...args],
			{ cwd, maxBuffer, encoding: 'buffer', windowsHide: true },
			(err, stdout, stderr) => {
				if (err) {
					const code = (err as NodeJS.ErrnoException).code;
					const missingGit = code === 'ENOENT';
					const msg = missingGit ? 'Git is not installed or not on PATH' : stderr.toString().trim() || err.message;
					reject(new GitError(msg, missingGit));
					return;
				}
				resolve({ stdout, stderr: stderr.toString() });
			},
		);
	});
}

async function execText(cwd: string, args: string[]): Promise<string> {
	return (await exec(cwd, args, MAX_TEXT_OUTPUT)).stdout.toString('utf-8');
}

/**
 * Runs `git grep` and parses hits as they stream in, stopping git once
 * `limit` hits were read or `signal` is aborted. Exit code 1 means no matches.
 */
function streamGrep(
	cwd: string,
	args: string[],
	limit: number,
	signal?: AbortSignal,
): Promise<{ hits: GrepHit[]; truncated: boolean }> {
	return new Promise((resolve, reject) => {
		const hits: GrepHit[] = [];
		let truncated = false;
		let settled = false;
		let pending: Buffer = Buffer.alloc(0);
		let stderr = '';
		const child = spawn('git', [...GLOBAL_ARGS, ...args], { cwd, windowsHide: true });

		const finish = (err?: Error) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener('abort', onAbort);
			if (err) reject(err);
			else resolve({ hits, truncated });
		};
		const stop = () => {
			child.stdout.removeAllListeners('data');
			child.kill();
		};
		const onAbort = () => {
			stop();
			finish(new GitError('Search cancelled'));
		};
		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener('abort', onAbort);

		child.stdout.on('data', (chunk: Buffer) => {
			pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
			let start = 0;
			for (let nl = pending.indexOf(10); nl >= 0; nl = pending.indexOf(10, start)) {
				const hit = parseGrepLine(pending.toString('utf-8', start, nl));
				start = nl + 1;
				if (!hit) continue;
				if (hits.length >= limit) {
					truncated = true;
					stop();
					finish();
					return;
				}
				hits.push(hit);
			}
			pending = pending.subarray(start);
		});
		child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
		child.on('error', (err: NodeJS.ErrnoException) => {
			finish(new GitError(err.code === 'ENOENT' ? 'Git is not installed or not on PATH' : err.message, err.code === 'ENOENT'));
		});
		child.on('close', (code) => {
			if (code === 0 || code === 1 || truncated) finish();
			else finish(new GitError(stderr.trim() || `git grep exited with code ${code ?? 'unknown'}`));
		});
	});
}

export type OpenResult =
	| { kind: 'repo'; repo: GitRepo }
	| { kind: 'not-repo' }
	| { kind: 'no-git' };

/**
 * A git working tree as seen from a folder the user opened, which may be the
 * repository root or any folder below it. All commands run from the
 * repository root and are limited to the opened folder with a pathspec.
 */
export class GitRepo {
	private constructor(
		/** Folder the user opened. */
		readonly folder: string,
		/** Absolute repository root (`--show-toplevel`). */
		readonly root: string,
		/** Absolute git dir; a per-worktree dir for linked worktrees. */
		readonly gitDir: string,
		/** Absolute common dir holding refs and packed-refs. */
		readonly commonDir: string,
		/** Opened folder relative to the root, '/'-separated with trailing '/', or ''. */
		readonly prefix: string,
	) {}

	/** Resolves the repository containing `folder`. */
	static async open(folder: string): Promise<OpenResult> {
		let out: string;
		try {
			out = await execText(folder, [
				'rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir', '--show-prefix',
			]);
		} catch (err) {
			if (err instanceof GitError && err.missingGit) return { kind: 'no-git' };
			return { kind: 'not-repo' };
		}
		const [root = '', gitDir = '', commonDir = '', prefix = ''] = out.split('\n');
		if (!root || !gitDir) return { kind: 'not-repo' };
		return {
			kind: 'repo',
			repo: new GitRepo(
				folder,
				path.resolve(root),
				path.resolve(gitDir),
				path.resolve(folder, commonDir || gitDir),
				prefix.trim(),
			),
		};
	}

	/** Pathspec limiting a command to the opened folder. */
	private scope(): string[] {
		return this.prefix ? ['--', this.prefix] : [];
	}

	/** Runs `git status` for the opened folder. */
	async status(): Promise<RepoStatus> {
		const out = await execText(this.root, [
			'status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', ...this.scope(),
		]);
		return parseStatusV2(out);
	}

	/** Lists tracked and untracked (non-ignored) files, relative to the opened folder. */
	async listFiles(): Promise<string[]> {
		const out = await execText(this.root, [
			'ls-files', '-z', '--cached', '--others', '--exclude-standard', ...this.scope(),
		]);
		const seen = new Set<string>();
		for (const p of out.split('\0')) {
			if (p) seen.add(this.toFolderRelative(p));
		}
		return [...seen];
	}

	/**
	 * Searches file contents in the opened folder, including untracked files,
	 * returning at most `limit` matching lines.
	 */
	grep(opts: GrepOptions, limit: number, signal?: AbortSignal): Promise<{ hits: GrepHit[]; truncated: boolean }> {
		return streamGrep(this.root, grepArgs(opts, this.scope()), limit, signal);
	}

	/**
	 * Commits touching `repoPath`, newest first, following renames. Returns
	 * an empty list for untracked files and repositories without commits.
	 */
	async fileHistory(repoPath: string, limit: number): Promise<FileCommit[]> {
		let out: string;
		try {
			out = await execText(this.root, [
				'log', '--follow', '-z', '--name-status', '--no-color', '--no-show-signature',
				`--max-count=${limit}`, `--format=${LOG_FORMAT}`, '--', repoPath,
			]);
		} catch {
			return [];
		}
		return parseLog(out, repoPath);
	}

	/** Blames the working-tree version of `repoPath`; one entry per line. */
	async blame(repoPath: string): Promise<BlameCommit[]> {
		return parseBlame(await execText(this.root, ['blame', '--porcelain', '--', repoPath]));
	}

	/**
	 * Reads a blob such as `HEAD:path` or `:path` (index). Returns `missing`
	 * when the object does not exist, e.g. a file added since HEAD.
	 */
	async readBlob(spec: string): Promise<LoadedContent> {
		let size: number;
		try {
			size = Number((await execText(this.root, ['cat-file', '-s', spec])).trim());
		} catch {
			return { kind: 'missing' };
		}
		if (size > MAX_VIEW_BYTES) return { kind: 'too-large', size };
		try {
			const { stdout } = await exec(this.root, ['cat-file', 'blob', spec], MAX_VIEW_BYTES + 1);
			return decodeContent(stdout);
		} catch (err) {
			return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
		}
	}

	/** Root-relative git path for a file under the opened folder, or null outside it. */
	repoPath(absPath: string): string | null {
		const rel = path.relative(this.folder, absPath);
		if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
		return this.prefix + rel.split(path.sep).join('/');
	}

	/** Converts a root-relative git path to one relative to the opened folder. */
	toFolderRelative(repoPath: string): string {
		return this.prefix && repoPath.startsWith(this.prefix) ? repoPath.slice(this.prefix.length) : repoPath;
	}

	/** Absolute on-disk path, under the opened folder, for a root-relative git path. */
	absPath(repoPath: string): string {
		return path.join(this.folder, this.toFolderRelative(repoPath));
	}
}
