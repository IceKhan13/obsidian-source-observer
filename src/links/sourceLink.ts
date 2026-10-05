import * as path from 'path';

/** Protocol action and code block language registered by the plugin. */
export const LINK_ACTION = 'source-observer';
export const EMBED_LANGUAGE = 'source-observer';

/** Inclusive, 1-based line range. */
export interface LineRange { from: number; to: number }

/** A file, and optionally lines in it, within a folder opened in Source Observer. */
export interface SourceLocation {
	/** Absolute folder to open in the viewer. */
	folder: string;
	/** File relative to `folder`, '/'-separated. */
	file: string;
	lines: LineRange | null;
}

/** Parses `12` or `12-30`; returns null for anything else. */
export function parseLines(input: string | undefined): LineRange | null {
	const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(input ?? '');
	if (!m) return null;
	const a = Number(m[1]);
	const b = m[2] === undefined ? a : Number(m[2]);
	if (a < 1 || b < 1) return null;
	return { from: Math.min(a, b), to: Math.max(a, b) };
}

export function formatLines(lines: LineRange): string {
	return lines.from === lines.to ? String(lines.from) : `${lines.from}-${lines.to}`;
}

/** `src/a.ts:10-20`, or just the path when no lines are given. */
export function describeLocation(loc: SourceLocation): string {
	return loc.lines ? `${loc.file}:${formatLines(loc.lines)}` : loc.file;
}

/** `obsidian://source-observer?folder=…&file=…&lines=…` */
export function buildUri(loc: SourceLocation): string {
	const params = [`folder=${encodeURIComponent(loc.folder)}`, `file=${encodeURIComponent(loc.file)}`];
	if (loc.lines) params.push(`lines=${formatLines(loc.lines)}`);
	return `obsidian://${LINK_ACTION}?${params.join('&')}`;
}

/** Reads a location from protocol handler parameters, which arrive decoded. */
export function locationFromParams(params: Record<string, string>): SourceLocation | null {
	const { folder, file } = params;
	if (!folder || !file) return null;
	return { folder, file, lines: parseLines(params.lines) };
}

export function markdownLink(loc: SourceLocation): string {
	// Brackets in the label would end the link text early.
	const label = describeLocation(loc).replace(/[[\]]/g, '\\$&');
	return `[${label}](${buildUri(loc)})`;
}

/** A fence longer than any run of backticks in `text`, so the text cannot close it. */
function fenceFor(text: string): string {
	const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
	return '`'.repeat(Math.max(3, longest + 1));
}

/** A live embed of the location, rendered by the plugin's code block processor. */
export function embedBlock(loc: SourceLocation): string {
	const body = [`folder: ${loc.folder}`, `file: ${loc.file}`];
	if (loc.lines) body.push(`lines: ${formatLines(loc.lines)}`);
	return ['```' + EMBED_LANGUAGE, ...body, '```'].join('\n');
}

/** Markdown language tag for a file name, as understood by Obsidian's highlighter. */
export function fenceLanguage(fileName: string): string {
	const base = path.basename(fileName).toLowerCase();
	if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
	if (base === 'makefile') return 'makefile';
	const ext = path.extname(base).slice(1);
	return /^[a-z0-9+#-]+$/.test(ext) ? ext : '';
}

/** A static copy of `text` as a fenced code block, followed by a link back to the source. */
export function codeBlock(text: string, loc: SourceLocation): string {
	const fence = fenceFor(text);
	const body = text.endsWith('\n') ? text.slice(0, -1) : text;
	return `${fence}${fenceLanguage(loc.file)}\n${body}\n${fence}\n${markdownLink(loc)}`;
}

/** Ways to copy a location: a link, a live embed, or a static code block. */
export type CopyFormat = 'link' | 'embed' | 'code';

export const COPY_FORMATS: { format: CopyFormat; title: string; icon: string }[] = [
	{ format: 'link', title: 'Copy link', icon: 'link' },
	{ format: 'embed', title: 'Copy embed', icon: 'file-code' },
	{ format: 'code', title: 'Copy as code block', icon: 'code' },
];

/** Markdown for `loc`; `text` is the code for the `code` format. */
export function formatForCopy(format: CopyFormat, loc: SourceLocation, text = ''): string {
	switch (format) {
		case 'link': return markdownLink(loc);
		case 'embed': return embedBlock(loc);
		case 'code': return codeBlock(text, loc);
	}
}

export interface EmbedSpec {
	/** Absolute path of the embedded file. */
	absPath: string;
	location: SourceLocation;
}

/**
 * Parses the body of an embed block: `key: value` lines with `file`
 * (required; absolute, or relative to `folder`), `folder` and `lines`.
 */
export function parseEmbed(source: string, resolve: (p: string) => string = (p) => path.resolve(p)): EmbedSpec | { error: string } {
	const fields = new Map<string, string>();
	for (const line of source.split('\n')) {
		const m = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(line);
		if (m?.[1] && m[2] !== undefined) fields.set(m[1].toLowerCase(), m[2]);
	}

	const file = fields.get('file');
	if (!file) return { error: 'Missing "file:" — the path of the file to embed.' };
	const folderField = fields.get('folder');
	if (!folderField && !path.isAbsolute(file) && !file.startsWith('~')) {
		return { error: 'A relative "file:" needs a "folder:" to resolve against.' };
	}

	const linesField = fields.get('lines');
	const lines = linesField ? parseLines(linesField) : null;
	if (linesField && !lines) return { error: `Invalid "lines: ${linesField}" — use a line number or a range such as 10-20.` };

	const folder = folderField ? resolve(folderField) : null;
	const absPath = folder && !file.startsWith('~') ? path.resolve(folder, file) : resolve(file);
	const base = folder ?? path.dirname(absPath);
	return {
		absPath,
		location: { folder: base, file: path.relative(base, absPath).split(path.sep).join('/'), lines },
	};
}
