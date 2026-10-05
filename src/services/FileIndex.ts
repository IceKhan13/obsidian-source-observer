import { promises as fsp } from 'fs';
import * as path from 'path';
import type { GitRepo } from '../git/GitRepo';

/** Directories never descended into when walking a non-git folder. */
const IGNORED_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules']);

/** Hard cap on indexed files, so huge folders cannot exhaust memory. */
export const MAX_INDEXED_FILES = 50_000;

export interface IndexedFile {
	/** Path relative to the opened folder, '/'-separated. */
	rel: string;
	/** Lower-cased basename, precomputed for matching. */
	nameLower: string;
	/** Lower-cased `rel`. */
	relLower: string;
}

export interface FileList {
	files: IndexedFile[];
	truncated: boolean;
}

function toIndexed(rel: string): IndexedFile {
	const relLower = rel.toLowerCase();
	return { rel, relLower, nameLower: relLower.slice(relLower.lastIndexOf('/') + 1) };
}

/** True when any path segment starts with a dot. */
export function isHiddenPath(rel: string): boolean {
	return rel.split('/').some((seg) => seg.startsWith('.'));
}

/** Walks `folder` breadth-first without following symlinked directories. */
export async function walkFolder(folder: string, limit = MAX_INDEXED_FILES): Promise<{ rels: string[]; truncated: boolean }> {
	const rels: string[] = [];
	const queue: string[] = [''];
	while (queue.length > 0) {
		const relDir = queue.shift() ?? '';
		let entries;
		try {
			entries = await fsp.readdir(path.join(folder, relDir), { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (!IGNORED_DIRS.has(entry.name)) queue.push(rel);
			} else if (entry.isFile() || entry.isSymbolicLink()) {
				if (rels.length >= limit) return { rels, truncated: true };
				rels.push(rel);
			}
		}
	}
	return { rels, truncated: false };
}

/**
 * Lazily built, cached list of files under the opened folder. In a git
 * repository this is `git ls-files` (tracked + untracked, honouring
 * .gitignore); otherwise a bounded walk that skips VCS and dependency dirs.
 */
export class FileIndex {
	private folder = '';
	private repo: GitRepo | null = null;
	private cache: Promise<FileList> | null = null;

	/** Points the index at a new folder/repository and drops the cache. */
	reset(folder: string, repo: GitRepo | null) {
		this.folder = folder;
		this.repo = repo;
		this.cache = null;
	}

	/** Marks the cached list stale, e.g. after files were created or deleted. */
	invalidate() {
		this.cache = null;
	}

	/** Returns the cached list, building it once if needed. */
	list(): Promise<FileList> {
		if (!this.cache) {
			const build = this.build();
			this.cache = build;
			// Do not cache failures.
			build.catch(() => { if (this.cache === build) this.cache = null; });
		}
		return this.cache;
	}

	private async build(): Promise<FileList> {
		if (!this.folder) return { files: [], truncated: false };
		let rels: string[];
		let truncated = false;
		if (this.repo) {
			try {
				rels = await this.repo.listFiles();
			} catch {
				({ rels, truncated } = await walkFolder(this.folder));
			}
			if (rels.length > MAX_INDEXED_FILES) {
				rels = rels.slice(0, MAX_INDEXED_FILES);
				truncated = true;
			}
		} else {
			({ rels, truncated } = await walkFolder(this.folder));
		}
		return { files: rels.map(toIndexed), truncated };
	}
}

/**
 * Ranks files against `query`. A query containing '/' matches the relative
 * path; otherwise it matches the file name, preferring exact and prefix hits.
 */
export function rankMatches(
	files: IndexedFile[],
	query: string,
	options: { showHidden: boolean; limit: number },
): { matches: string[]; total: number } {
	const q = query.trim().toLowerCase();
	if (!q) return { matches: [], total: 0 };
	const byPath = q.includes('/');
	const scored: { rel: string; score: number }[] = [];
	for (const f of files) {
		if (!options.showHidden && isHiddenPath(f.rel)) continue;
		let score: number;
		if (byPath) {
			if (!f.relLower.includes(q)) continue;
			score = f.relLower.endsWith(q) ? 0 : 1;
		} else {
			if (!f.nameLower.includes(q)) continue;
			score = f.nameLower === q ? 0 : f.nameLower.startsWith(q) ? 1 : 2;
		}
		scored.push({ rel: f.rel, score });
	}
	scored.sort((a, b) => a.score - b.score || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel));
	return { matches: scored.slice(0, options.limit).map((s) => s.rel), total: scored.length };
}
