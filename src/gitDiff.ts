import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

export interface ChangedFile {
	code: string; // XY status code
	file: string; // relative path
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	try {
		const { stdout, stderr } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
		return { stdout, stderr };
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string };
		return { stdout: e.stdout ?? '', stderr: e.stderr ?? String(err) };
	}
}

export async function getChangedFiles(repoPath: string): Promise<ChangedFile[]> {
	const { stdout } = await runGit(repoPath, ['status', '--short', '-u']);
	return stdout
		.split('\n')
		.filter((l) => l.trim())
		.map((l) => ({ code: l.slice(0, 2), file: l.slice(3).trim() }));
}

export async function getFileDiff(repoPath: string, filePath: string): Promise<string> {
	const rel = path.relative(repoPath, filePath) || filePath;

	const { stdout: diffHead } = await runGit(repoPath, ['diff', 'HEAD', '--', rel]);
	if (diffHead.trim()) return diffHead;

	const { stdout: diffCached } = await runGit(repoPath, ['diff', '--cached', '--', rel]);
	if (diffCached.trim()) return diffCached;

	// Untracked / new file — render entire content as additions
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		const lines = content.split('\n');
		const header = `diff --git a/${rel} b/${rel}\n--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n`;
		return header + lines.map((l) => '+' + l).join('\n');
	} catch {
		return '';
	}
}

export function renderDiff(container: HTMLElement, diff: string) {
	container.empty();
	if (!diff.trim()) {
		container.createEl('p', { cls: 'so-diff-clean', text: 'No diff to show' });
		return;
	}
	const pre = container.createEl('pre', { cls: 'so-diff-pre' });
	for (const line of diff.split('\n')) {
		const span = pre.createEl('span');
		span.setText(line + '\n');
		if (line.startsWith('+++') || line.startsWith('---')) {
			span.addClass('so-diff-file');
		} else if (line.startsWith('+')) {
			span.addClass('so-diff-add');
		} else if (line.startsWith('-')) {
			span.addClass('so-diff-del');
		} else if (line.startsWith('@@')) {
			span.addClass('so-diff-hunk');
		} else if (line.startsWith('diff --git')) {
			span.addClass('so-diff-header');
		}
	}
}
