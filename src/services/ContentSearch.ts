import * as path from 'path';
import { GitError, GitRepo } from '../git/GitRepo';
import { GrepHit, GrepSyntax, isPcreUnsupported, MAX_GREP_LINE_CHARS } from '../git/grep';
import { readViewableFile } from '../utils/content';
import { FileIndex, isHiddenPath } from './FileIndex';

/** Maximum number of matching lines collected per search. */
export const MAX_SEARCH_MATCHES = 2000;
/** Characters of a matching line shown in a result. */
export const PREVIEW_CHARS = 160;
/** Characters of context kept before the first match when a preview is cut. */
const PREVIEW_LEAD = 24;
/** Files read in parallel when searching a folder that is not a repository. */
const READ_CONCURRENCY = 8;

export interface SearchQuery {
	text: string;
	caseSensitive: boolean;
	wholeWord: boolean;
	regex: boolean;
}

export interface MatchLine {
	/** 1-based line number. */
	line: number;
	/** The line, trimmed to a window around the first match. */
	preview: string;
	/** Match ranges within `preview`, as [from, to) offsets. */
	ranges: [number, number][];
}

export interface FileMatches {
	/** Path relative to the opened folder, '/'-separated. */
	rel: string;
	lines: MatchLine[];
}

export interface SearchResults {
	files: FileMatches[];
	/** Number of matching lines. */
	matchCount: number;
	/** True when the search stopped at `MAX_SEARCH_MATCHES`. */
	truncated: boolean;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compiles a query to a global JS regular expression; throws SyntaxError for an invalid regex. */
export function compileQuery(query: SearchQuery): RegExp {
	let source = query.regex ? query.text : escapeRegExp(query.text);
	if (query.wholeWord) source = `(?<![\\w])(?:${source})(?![\\w])`;
	return new RegExp(source, query.caseSensitive ? 'g' : 'gi');
}

/** All non-empty matches of `re` (which must be global) in `text`. */
export function matchRanges(re: RegExp, text: string): [number, number][] {
	const ranges: [number, number][] = [];
	re.lastIndex = 0;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		if (m[0].length === 0) {
			re.lastIndex++;
			continue;
		}
		ranges.push([m.index, m.index + m[0].length]);
	}
	return ranges;
}

/**
 * Cuts `text` to at most `max` characters around its first match, dropping
 * leading indentation, and shifts `ranges` to match.
 */
export function makePreview(line: number, text: string, ranges: [number, number][], max = PREVIEW_CHARS): MatchLine {
	const indent = text.length - text.trimStart().length;
	const first = ranges[0]?.[0] ?? indent;
	let start = Math.max(indent, Math.min(first - PREVIEW_LEAD, text.length - max));
	if (first < start) start = first;
	start = Math.max(0, start);
	const end = Math.min(text.length, start + max);
	const prefix = start > indent ? '…' : '';
	const suffix = end < text.length ? '…' : '';
	const shift = prefix.length - start;
	return {
		line,
		preview: prefix + text.slice(start, end).trimEnd() + suffix,
		ranges: ranges
			.filter(([from]) => from >= start && from < end)
			.map(([from, to]) => [from + shift, Math.min(to, end) + shift]),
	};
}

/** Groups hits by file, keeping their order. */
function groupHits(hits: { rel: string; match: MatchLine }[], truncated: boolean): SearchResults {
	const byFile = new Map<string, MatchLine[]>();
	for (const { rel, match } of hits) {
		let lines = byFile.get(rel);
		if (!lines) byFile.set(rel, (lines = []));
		lines.push(match);
	}
	return {
		files: [...byFile].map(([rel, lines]) => ({ rel, lines })),
		matchCount: hits.length,
		truncated,
	};
}

/**
 * Searches file contents under the opened folder. In a git repository this
 * runs `git grep` (fast, honours .gitignore, skips binary files); elsewhere
 * it reads the files from the shared `FileIndex`. Match ranges for display
 * are always computed with the JS regular expression.
 */
export class ContentSearch {
	/** Set once git reports it was built without PCRE, so regexes use `-E`. */
	private pcreUnavailable = false;

	constructor(private index: FileIndex) {}

	/** Runs `query`; rejects with SyntaxError for an invalid regex, or GitError. */
	async run(
		folder: string,
		repo: GitRepo | null,
		query: SearchQuery,
		opts: { showHidden: boolean; signal?: AbortSignal },
	): Promise<SearchResults> {
		const re = compileQuery(query);
		const include = (rel: string) => opts.showHidden || !isHiddenPath(rel);
		if (repo) return this.runGit(repo, query, re, include, opts.signal);
		return this.runFiles(folder, re, include, opts.signal);
	}

	private async runGit(
		repo: GitRepo,
		query: SearchQuery,
		re: RegExp,
		include: (rel: string) => boolean,
		signal?: AbortSignal,
	): Promise<SearchResults> {
		let syntax: GrepSyntax = !query.regex ? 'fixed' : this.pcreUnavailable ? 'extended' : 'perl';
		const grep = (s: GrepSyntax) => repo.grep(
			{ pattern: query.text, syntax: s, caseSensitive: query.caseSensitive, wholeWord: query.wholeWord },
			MAX_SEARCH_MATCHES,
			signal,
		);
		let result: { hits: GrepHit[]; truncated: boolean };
		try {
			result = await grep(syntax);
		} catch (err) {
			if (syntax !== 'perl' || !(err instanceof GitError) || !isPcreUnsupported(err.message)) throw err;
			this.pcreUnavailable = true;
			syntax = 'extended';
			result = await grep(syntax);
		}
		const hits: { rel: string; match: MatchLine }[] = [];
		for (const hit of result.hits) {
			const rel = repo.toFolderRelative(hit.path);
			if (!include(rel)) continue;
			hits.push({ rel, match: makePreview(hit.line, hit.text, matchRanges(re, hit.text)) });
		}
		return groupHits(hits, result.truncated);
	}

	private async runFiles(
		folder: string,
		re: RegExp,
		include: (rel: string) => boolean,
		signal?: AbortSignal,
	): Promise<SearchResults> {
		const { files } = await this.index.list();
		const rels = files.map((f) => f.rel).filter(include);
		// Results per file index, so output order does not depend on read timing.
		const perFile: { rel: string; match: MatchLine }[][] = [];
		let count = 0;
		let next = 0;

		const worker = async () => {
			while (next < rels.length && count < MAX_SEARCH_MATCHES && !signal?.aborted) {
				const i = next++;
				const rel = rels[i] ?? '';
				const content = await readViewableFile(path.join(folder, rel));
				if (content.kind !== 'text') continue;
				const found: { rel: string; match: MatchLine }[] = [];
				const lines = content.text.split(/\r\n?|\n/);
				for (let n = 0; n < lines.length && count < MAX_SEARCH_MATCHES; n++) {
					const text = (lines[n] ?? '').slice(0, MAX_GREP_LINE_CHARS);
					const ranges = matchRanges(re, text);
					if (ranges.length === 0) continue;
					found.push({ rel, match: makePreview(n + 1, text, ranges) });
					count++;
				}
				perFile[i] = found;
			}
		};
		await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));
		if (signal?.aborted) throw new GitError('Search cancelled');
		return groupHits(perFile.flat(), count >= MAX_SEARCH_MATCHES);
	}
}
