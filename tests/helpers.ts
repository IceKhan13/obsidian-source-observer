import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: 'Test',
	GIT_AUTHOR_EMAIL: 'test@example.com',
	GIT_COMMITTER_NAME: 'Test',
	GIT_COMMITTER_EMAIL: 'test@example.com',
	GIT_CONFIG_NOSYSTEM: '1',
};

/** Runs git synchronously in `cwd` and returns stdout. */
export function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
		cwd,
		env: GIT_ENV,
		encoding: 'utf-8',
	});
}

/** Creates a fresh temp directory (realpath, so macOS /var → /private/var is resolved). */
export function tempDir(prefix = 'so-test-'): string {
	return realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
}

/** Writes `content` to `rel` under `root`, creating parent folders. */
export function write(root: string, rel: string, content: string | Buffer) {
	const abs = path.join(root, rel);
	mkdirSync(path.dirname(abs), { recursive: true });
	writeFileSync(abs, content);
}

/** Creates a repository with the given committed files. */
export function makeRepo(files: Record<string, string> = {}): string {
	const root = tempDir();
	git(root, 'init', '-q');
	git(root, 'symbolic-ref', 'HEAD', 'refs/heads/main');
	for (const [rel, content] of Object.entries(files)) write(root, rel, content);
	if (Object.keys(files).length > 0) {
		git(root, 'add', '-A');
		git(root, 'commit', '-q', '-m', 'init');
	}
	return root;
}

export function remove(p: string) {
	rmSync(p, { recursive: true, force: true });
}
