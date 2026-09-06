import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { promises as fsp } from 'fs';

const execFileAsync = promisify(execFile);

export interface ChangedFile {
	code: string; // XY status code
	file: string; // relative path
}

/** Number of diff lines appended to the DOM per render batch. */
const DIFF_BATCH_SIZE = 500;

/** Runs a git command in `cwd` and returns stdout/stderr, swallowing non-zero exit codes. */
async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	try {
		const { stdout, stderr } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
		return { stdout, stderr };
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string };
		return { stdout: e.stdout ?? '', stderr: e.stderr ?? String(err) };
	}
}

/** Returns true when `repoPath` is inside a git working tree. */
export async function isGitRepo(repoPath: string): Promise<boolean> {
	const { stdout } = await runGit(repoPath, ['rev-parse', '--is-inside-work-tree']);
	return stdout.trim() === 'true';
}

/**
 * Returns all changed files in the repo according to `git status --porcelain -z`.
 * The NUL-separated format avoids quoting of non-ASCII/whitespace paths, and
 * for renames the destination path is used as `file`.
 */
export async function getChangedFiles(repoPath: string): Promise<ChangedFile[]> {
	const { stdout } = await runGit(repoPath, ['status', '--porcelain=v1', '-z', '-u']);
	const entries = stdout.split('\0');
	const results: ChangedFile[] = [];
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i] ?? '';
		if (!entry.trim()) continue;
		const code = entry.slice(0, 2);
		const file = entry.slice(3);
		// Renames/copies in -z mode are followed by the original path as a
		// separate NUL-terminated entry; skip it and keep the new path.
		if (code.includes('R') || code.includes('C')) i++;
		results.push({ code, file });
	}
	return results;
}

/**
 * Returns a unified diff string for `filePath` relative to `repoPath`.
 * Falls back to `git diff --cached` for staged-only files, and to a
 * synthetic all-additions diff for untracked files.
 */
export async function getFileDiff(repoPath: string, filePath: string): Promise<string> {
	const rel = path.relative(repoPath, filePath) || filePath;

	const { stdout: diffHead } = await runGit(repoPath, ['diff', 'HEAD', '--', rel]);
	if (diffHead.trim()) return diffHead;

	const { stdout: diffCached } = await runGit(repoPath, ['diff', '--cached', '--', rel]);
	if (diffCached.trim()) return diffCached;

	// Untracked / new file — render entire content as additions
	try {
		const content = await fsp.readFile(filePath, 'utf-8');
		const lines = content.split('\n');
		const header = `diff --git a/${rel} b/${rel}\n--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n`;
		return header + lines.map((l) => '+' + l).join('\n');
	} catch {
		return '';
	}
}

function diffLineClass(line: string): string | null {
	if (line.startsWith('\\')) return 'so-diff-nonewline';
	if (line.startsWith('+++') || line.startsWith('---')) return 'so-diff-file';
	if (line.startsWith('+')) return 'so-diff-add';
	if (line.startsWith('-')) return 'so-diff-del';
	if (line.startsWith('@@')) return 'so-diff-hunk';
	if (line.startsWith('diff --git')) return 'so-diff-header';
	return null;
}

/**
 * Renders a unified diff string into `container` with syntax-coloured spans.
 * Large diffs are appended in batches as the user scrolls instead of
 * building one span per line up front.
 */
export function renderDiff(container: HTMLElement, diff: string) {
	container.empty();
	if (!diff.trim()) {
		container.createEl('p', { cls: 'so-diff-clean', text: 'No diff to show' });
		return;
	}

	const pre = container.createEl('pre', { cls: 'so-diff-pre' });
	const lines = diff.split('\n');
	let rendered = 0;

	const sentinel = container.createDiv({ cls: 'so-diff-more' });

	const renderBatch = () => {
		const end = Math.min(rendered + DIFF_BATCH_SIZE, lines.length);
		for (; rendered < end; rendered++) {
			const line = lines[rendered] ?? '';
			const span = pre.createEl('span');
			span.setText(line + '\n');
			const cls = diffLineClass(line);
			if (cls) span.addClass(cls);
		}
		if (rendered < lines.length) {
			sentinel.setText(`… ${lines.length - rendered} more lines (scroll to load) …`);
		} else {
			sentinel.remove();
			container.removeEventListener('scroll', onScroll);
		}
	};

	const onScroll = () => {
		if (rendered >= lines.length) return;
		if (container.scrollTop + container.clientHeight >= container.scrollHeight - 400) {
			renderBatch();
		}
	};

	renderBatch();
	if (rendered < lines.length) container.addEventListener('scroll', onScroll, { passive: true });
}
