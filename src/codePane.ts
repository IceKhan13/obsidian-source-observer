import * as fs from 'fs';
import * as path from 'path';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';

const EXT_LANG: Record<string, () => ReturnType<typeof javascript>> = {
	js:   () => javascript(),
	jsx:  () => javascript({ jsx: true }),
	ts:   () => javascript({ typescript: true }),
	tsx:  () => javascript({ jsx: true, typescript: true }),
	mjs:  () => javascript(),
	cjs:  () => javascript(),
	py:   () => python(),
	rs:   () => rust(),
	css:  () => css(),
	html: () => html(),
	htm:  () => html(),
	json: () => json(),
	jsonc:() => json(),
	md:   () => markdown(),
	mdx:  () => markdown(),
};

// Highlight style built entirely from Obsidian's CSS variables so it
// adapts to any theme (light, dark, custom) automatically.
const obsidianHighlight = HighlightStyle.define([
	{ tag: t.keyword,                color: 'var(--code-keyword)' },
	{ tag: [t.name, t.deleted, t.character, t.macroName],
	                                 color: 'var(--code-normal)' },
	{ tag: [t.propertyName, t.labelName],
	                                 color: 'var(--code-property)' },
	{ tag: [t.color, t.constant(t.name), t.standard(t.name)],
	                                 color: 'var(--code-value)' },
	{ tag: [t.definition(t.name), t.separator],
	                                 color: 'var(--code-normal)' },
	{ tag: [t.typeName, t.className, t.number, t.changed, t.annotation,
	        t.modifier, t.self, t.namespace],
	                                 color: 'var(--code-tag)' },
	{ tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp,
	        t.link, t.special(t.string)],
	                                 color: 'var(--code-operator)' },
	{ tag: [t.meta, t.comment],      color: 'var(--code-comment)', fontStyle: 'italic' },
	{ tag: t.strong,                 fontWeight: 'bold' },
	{ tag: t.emphasis,               fontStyle: 'italic' },
	{ tag: t.strikethrough,          textDecoration: 'line-through' },
	{ tag: t.link,                   color: 'var(--code-value)', textDecoration: 'underline' },
	{ tag: t.heading,                fontWeight: 'bold', color: 'var(--code-tag)' },
	{ tag: [t.atom, t.bool, t.special(t.variableName)],
	                                 color: 'var(--code-value)' },
	{ tag: [t.processingInstruction, t.string, t.inserted],
	                                 color: 'var(--code-string)' },
	{ tag: t.invalid,                color: 'var(--text-error)' },
]);

// Base editor theme using Obsidian CSS vars — no hardcoded colours.
const obsidianTheme = EditorView.theme({
	'&': {
		fontSize: 'inherit',
		height: '100%',
		background: 'var(--code-background)',
		color: 'var(--code-normal)',
	},
	'.cm-scroller': {
		overflow: 'auto',
		fontFamily: 'var(--font-monospace)',
		lineHeight: '1.6',
	},
	'.cm-content': { caretColor: 'var(--text-normal)' },
	'.cm-cursor': { borderLeftColor: 'var(--text-normal)' },
	'.cm-activeLine': { background: 'var(--background-modifier-hover)' },
	'.cm-gutters': {
		background: 'var(--code-background)',
		color: 'var(--text-faint)',
		border: 'none',
		borderRight: '1px solid var(--background-modifier-border)',
	},
	'.cm-activeLineGutter': { background: 'var(--background-modifier-hover)' },
	'.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 6px', minWidth: '2ch' },
	'.cm-selectionBackground, ::selection': { background: 'var(--text-selection)' },
	'&.cm-focused .cm-selectionBackground': { background: 'var(--text-selection)' },
});

/** Read-only CodeMirror 6 editor pane that syntax-highlights files using Obsidian CSS variables. */
export class CodePane {
	private container: HTMLElement;
	private view: EditorView | null = null;
	private fontSize: number;

	constructor(container: HTMLElement, fontSize: number) {
		this.container = container;
		this.fontSize = fontSize;
	}

	/** Loads `filePath` into the editor, replacing any previously open file. */
	open(filePath: string) {
		let content: string;
		try {
			content = fs.readFileSync(filePath, 'utf-8');
		} catch {
			content = '(cannot read file)';
		}

		const ext = path.extname(filePath).slice(1).toLowerCase();
		const langExtension = EXT_LANG[ext]?.() ?? [];

		this.view?.destroy();

		const state = EditorState.create({
			doc: content,
			extensions: [
				EditorState.readOnly.of(true),
				lineNumbers(),
				highlightActiveLine(),
				syntaxHighlighting(obsidianHighlight),
				obsidianTheme,
				langExtension,
				EditorView.theme({ '&': { fontSize: `${this.fontSize}px` } }),
			],
		});

		this.view = new EditorView({ state, parent: this.container });
	}

	/** Destroys the CodeMirror instance and frees its DOM nodes. */
	destroy() {
		this.view?.destroy();
		this.view = null;
	}
}
