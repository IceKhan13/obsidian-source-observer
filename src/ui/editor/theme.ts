import { EditorView } from '@codemirror/view';
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Highlight style built entirely from Obsidian's CSS variables so it
// adapts to any theme (light, dark, custom) automatically.
export const obsidianHighlight = HighlightStyle.define([
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
export const obsidianTheme = EditorView.theme({
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
	'&.cm-focused': { outline: 'none' },
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
	'.cm-searchMatch': { background: 'rgba(var(--color-yellow-rgb), 0.3)' },
	'.cm-searchMatch.cm-searchMatch-selected': { background: 'rgba(var(--color-orange-rgb), 0.5)' },
	'.cm-selectionMatch': { background: 'var(--text-highlight-bg)' },
	// Lines a link or embed pointed to.
	'.so-linked-line': { background: 'rgba(var(--color-yellow-rgb), 0.15)' },
	// Find and go-to-line panels, styled like Obsidian's own inputs.
	'.cm-panels': {
		background: 'var(--background-secondary)',
		color: 'var(--text-normal)',
		fontFamily: 'var(--font-interface)',
		fontSize: 'var(--font-ui-small)',
	},
	'.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--background-modifier-border)' },
	// `.cm-gotoLine` in older @codemirror/search versions, `.cm-dialog` in newer ones.
	'.cm-panel.cm-search, .cm-panel.cm-gotoLine, .cm-panel.cm-dialog': {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'center',
		gap: '4px 8px',
		padding: '6px 28px 6px 8px',
	},
	'.cm-panel.cm-search br': { display: 'none' },
	'.cm-panel .cm-textfield': { fontSize: 'var(--font-ui-small)', padding: '2px 6px', margin: '0' },
	'.cm-panel .cm-button': {
		backgroundImage: 'none',
		background: 'var(--interactive-normal)',
		color: 'var(--text-normal)',
		border: 'none',
		borderRadius: 'var(--button-radius)',
		boxShadow: 'var(--input-shadow)',
		fontSize: 'var(--font-ui-smaller)',
		padding: '2px 8px',
		margin: '0',
	},
	'.cm-panel .cm-button:hover': { background: 'var(--interactive-hover)' },
	'.cm-panel label': { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 'var(--font-ui-smaller)' },
	'.cm-panel [name=close], .cm-panel .cm-dialog-close': { color: 'var(--text-muted)', top: '6px', right: '6px' },
	'.cm-panel.cm-dialog form': { display: 'flex', alignItems: 'center', gap: '8px' },
});

/**
 * Diff colours for `@codemirror/merge`. The unified view and the new side of
 * the split view are `.cm-merge-b`; the old side is `.cm-merge-a`. Selectors
 * repeat those classes so they out-rank the library's base theme.
 */
export const diffTheme = EditorView.theme({
	'&.cm-merge-b .cm-changedLine': { background: 'rgba(var(--color-green-rgb), 0.12)' },
	'&.cm-merge-b .cm-changedText': { background: 'rgba(var(--color-green-rgb), 0.3)' },
	'&.cm-merge-b .cm-deletedChunk': {
		background: 'rgba(var(--color-red-rgb), 0.12)',
		paddingLeft: '0',
	},
	'&.cm-merge-b .cm-deletedChunk .cm-deletedText': { background: 'rgba(var(--color-red-rgb), 0.3)' },
	'&.cm-merge-b .cm-deletedText': { background: 'rgba(var(--color-red-rgb), 0.3)' },
	'&.cm-merge-b .cm-changedLineGutter': { background: 'var(--color-green)' },
	'&.cm-merge-b .cm-deletedLineGutter': { background: 'var(--color-red)' },
	'&.cm-merge-a .cm-changedLine': { background: 'rgba(var(--color-red-rgb), 0.12)' },
	'&.cm-merge-a .cm-changedText': { background: 'rgba(var(--color-red-rgb), 0.3)' },
	'&.cm-merge-a .cm-changedLineGutter': { background: 'var(--color-red)' },
	'&.cm-merge-a .cm-collapsedLines, &.cm-merge-b .cm-collapsedLines': {
		color: 'var(--text-muted)',
		background: 'var(--background-secondary)',
		fontFamily: 'var(--font-interface)',
		fontSize: 'var(--font-ui-smaller)',
	},
});

export function fontTheme(fontSize: number) {
	return EditorView.theme({ '&': { fontSize: `${fontSize}px` } });
}
