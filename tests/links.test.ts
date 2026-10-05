import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
	buildUri,
	codeBlock,
	embedBlock,
	fenceLanguage,
	locationFromParams,
	markdownLink,
	parseEmbed,
	parseLines,
	SourceLocation,
} from '../src/links/sourceLink';

const loc: SourceLocation = { folder: '/Users/me/My Repo', file: 'src/a b.ts', lines: { from: 10, to: 20 } };

describe('parseLines', () => {
	it('accepts a line or a range, normalising reversed ranges', () => {
		expect(parseLines('7')).toEqual({ from: 7, to: 7 });
		expect(parseLines(' 10 - 20 ')).toEqual({ from: 10, to: 20 });
		expect(parseLines('20-10')).toEqual({ from: 10, to: 20 });
	});

	it('rejects anything else', () => {
		for (const bad of ['', '0', 'abc', '1-', '-3', '1,2', undefined]) expect(parseLines(bad)).toBeNull();
	});
});

describe('links', () => {
	it('round-trips a location through the URI, encoding spaces and separators', () => {
		const uri = buildUri(loc);
		expect(uri).toBe('obsidian://source-observer?folder=%2FUsers%2Fme%2FMy%20Repo&file=src%2Fa%20b.ts&lines=10-20');
		const params = Object.fromEntries(new URL(uri).searchParams);
		expect(locationFromParams(params)).toEqual(loc);
	});

	it('omits lines for whole-file links and needs folder and file to open', () => {
		expect(buildUri({ ...loc, lines: null })).not.toContain('lines=');
		expect(locationFromParams({ action: 'source-observer', file: 'a.ts' })).toBeNull();
	});

	it('labels Markdown links with the path and lines, escaping brackets', () => {
		expect(markdownLink(loc)).toMatch(/^\[src\/a b\.ts:10-20\]\(obsidian:\/\/source-observer\?/);
		expect(markdownLink({ ...loc, file: 'pages/[id].tsx', lines: null })).toMatch(/^\[pages\/\\\[id\\\]\.tsx\]\(/);
	});
});

describe('code blocks and embeds', () => {
	it('writes an embed block the parser reads back', () => {
		const block = embedBlock(loc);
		expect(block).toBe('```source-observer\nfolder: /Users/me/My Repo\nfile: src/a b.ts\nlines: 10-20\n```');
		const body = block.split('\n').slice(1, -1).join('\n');
		expect(parseEmbed(body)).toEqual({ absPath: path.resolve('/Users/me/My Repo', 'src/a b.ts'), location: loc });
	});

	it('uses a fence longer than any backticks in the code, and the file language', () => {
		const md = codeBlock('const s = ```;\n', { ...loc, file: 'x.ts' });
		expect(md.split('\n')).toEqual(['````ts', 'const s = ```;', '````', expect.stringMatching(/^\[x\.ts:10-20\]\(/) as string]);
	});

	it('maps file names to fence languages', () => {
		expect(fenceLanguage('src/main.py')).toBe('py');
		expect(fenceLanguage('Dockerfile')).toBe('dockerfile');
		expect(fenceLanguage('README')).toBe('');
	});
});

describe('parseEmbed', () => {
	it('accepts an absolute file without a folder, opening its directory', () => {
		const spec = parseEmbed('file: /repo/src/a.ts');
		expect(spec).toEqual({ absPath: path.resolve('/repo/src/a.ts'), location: { folder: path.resolve('/repo/src'), file: 'a.ts', lines: null } });
	});

	it('expands ~ through the resolver', () => {
		const spec = parseEmbed('file: ~/x.ts', (p) => p.replace('~', '/home/me'));
		expect('absPath' in spec && spec.absPath).toBe('/home/me/x.ts');
	});

	it('explains what is wrong', () => {
		expect(parseEmbed('lines: 3')).toEqual({ error: expect.stringContaining('Missing "file:"') as string });
		expect(parseEmbed('file: src/a.ts')).toEqual({ error: expect.stringContaining('needs a "folder:"') as string });
		expect(parseEmbed('file: /a.ts\nlines: ten')).toEqual({ error: expect.stringContaining('Invalid "lines: ten"') as string });
	});
});
