import { describe, expect, it } from 'vitest';
import { diffStats as stats } from '../src/ui/editor/diffStats';
import { languageFor } from '../src/ui/editor/languages';

describe('diffStats', () => {
	it('counts whole lines like git, not partially matched characters', () => {
		const lines = Array.from({ length: 60 }, (_, i) => `export const value${i} = ${i};`);
		const m = [...lines];
		m[5] = 'export const value5 = 500; // changed';
		m.splice(40, 2);
		m.push('export function added() { return "new"; }');
		// git diff --stat: 1 replaced line, 2 deleted, 1 appended.
		expect(stats(lines.join('\n') + '\n', m.join('\n') + '\n')).toEqual({ added: 2, removed: 3 });
	});

	it('counts added, removed and replaced lines', () => {
		expect(stats('a\nb\nc\n', 'a\nb\nc\nd\n')).toEqual({ added: 1, removed: 0 });
		expect(stats('a\nb\nc\n', 'a\nc\n')).toEqual({ added: 0, removed: 1 });
		expect(stats('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ added: 1, removed: 1 });
	});

	it('handles changes at the end of a file without a trailing newline', () => {
		expect(stats('a\nb', 'a\nc')).toEqual({ added: 1, removed: 1 });
	});

	it('treats a new file as all additions', () => {
		expect(stats('', 'x\ny\nz\n')).toEqual({ added: 3, removed: 0 });
	});

	it('treats a deleted file as all removals', () => {
		expect(stats('x\ny\n', '')).toEqual({ added: 0, removed: 2 });
	});

	it('reports nothing for identical documents', () => {
		expect(stats('same\n', 'same\n')).toEqual({ added: 0, removed: 0 });
	});
});

describe('languageFor', () => {
	it('returns a language for known extensions and special file names', () => {
		for (const name of ['a.ts', 'b.go', 'c.rb', 'D.java', 'e.yml', 'f.toml', 'g.sh', 'Dockerfile', 'h.sql']) {
			const ext = languageFor(name);
			expect(Array.isArray(ext) && ext.length === 0, name).toBe(false);
		}
	});

	it('returns no extension for unknown files', () => {
		expect(languageFor('notes.unknownext')).toEqual([]);
	});
});
