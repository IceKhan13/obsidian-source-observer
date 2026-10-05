import { Component, setIcon } from 'obsidian';
import { Compartment, EditorState, Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { gotoLine, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import type { DiffLayout } from '../../settings';
import { diffStats, DiffStats } from '../editor/diffStats';
import { languageFor } from '../editor/languages';
import { diffTheme, fontTheme, obsidianHighlight, obsidianTheme } from '../editor/theme';

/**
 * Something shown in the content pane. Renderers own a wrapper element and
 * remove it when unloaded, so swapping renderers never leaks DOM, editors or
 * listeners.
 */
export abstract class PaneRenderer extends Component {
	protected el: HTMLElement;

	constructor(parent: HTMLElement, cls: string) {
		super();
		this.el = parent.createDiv({ cls: `so-renderer ${cls}` });
	}

	onunload() {
		this.el.remove();
	}

	setFontSize(_fontSize: number) { /* optional */ }

	/** The editor that find and go-to-line act on, if this renderer has one. */
	editor(): EditorView | null { return null; }

	/** Opens the find panel; returns false when there is nothing to search. */
	openSearch(): boolean {
		const view = this.editor();
		if (!view) return false;
		openSearchPanel(view);
		return true;
	}

	/** Opens the go-to-line prompt; returns false when there is no editor. */
	goToLine(): boolean {
		const view = this.editor();
		if (!view) return false;
		gotoLine(view);
		return true;
	}
}

function baseEditorExtensions(): Extension[] {
	return [
		EditorState.readOnly.of(true),
		EditorView.editable.of(false),
		// Read-only content is not focusable by default; without focus the
		// find and go-to-line keys would never reach the editor.
		EditorView.contentAttributes.of({ tabindex: '0' }),
		search({ top: true }),
		highlightSelectionMatches(),
		keymap.of(searchKeymap),
		lineNumbers(),
		highlightActiveLine(),
		syntaxHighlighting(obsidianHighlight),
		obsidianTheme,
	];
}

/**
 * Read-only, syntax-highlighted file view. The CodeMirror instance is reused
 * across files; language and font size are swapped via compartments.
 */
export class CodeRenderer extends PaneRenderer {
	private view: EditorView | null = null;
	private language = new Compartment();
	private font = new Compartment();

	constructor(parent: HTMLElement, private fontSize: number) {
		super(parent, 'so-code-view');
	}

	onload() {
		this.view = new EditorView({
			parent: this.el,
			state: EditorState.create({
				extensions: [
					...baseEditorExtensions(),
					this.language.of([]),
					this.font.of(fontTheme(this.fontSize)),
				],
			}),
		});
	}

	onunload() {
		this.view?.destroy();
		this.view = null;
		super.onunload();
	}

	editor() { return this.view; }

	/** Replaces the document in place; scrolls back to the top unless `keepScroll`. */
	setDocument(text: string, fileName: string, keepScroll: boolean) {
		const view = this.view;
		if (!view) return;
		const { scrollTop, scrollLeft } = view.scrollDOM;
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: text },
			effects: this.language.reconfigure(languageFor(fileName)),
			selection: { anchor: 0 },
		});
		view.scrollDOM.scrollTop = keepScroll ? scrollTop : 0;
		view.scrollDOM.scrollLeft = keepScroll ? scrollLeft : 0;
	}

	setFontSize(fontSize: number) {
		if (this.fontSize === fontSize) return;
		this.fontSize = fontSize;
		this.view?.dispatch({ effects: this.font.reconfigure(fontTheme(fontSize)) });
	}
}

/**
 * Syntax-highlighted diff of two documents using `@codemirror/merge`,
 * either unified (one editor) or split (old and new side by side).
 * Unchanged stretches are collapsed in both layouts.
 */
export class DiffRenderer extends PaneRenderer {
	private unified: EditorView | null = null;
	private split: MergeView | null = null;
	/** Side of the split layout that last had focus. */
	private focusedSide: 'a' | 'b' = 'b';
	private font = new Compartment();

	constructor(
		parent: HTMLElement,
		private fontSize: number,
		private original: string,
		private modified: string,
		private fileName: string,
		readonly layout: DiffLayout,
	) {
		super(parent, `so-diff-view so-diff-${layout}`);
	}

	onload() {
		const extensions = [
			...baseEditorExtensions(),
			languageFor(this.fileName),
			this.font.of(fontTheme(this.fontSize)),
			diffTheme,
		];
		const collapseUnchanged = { margin: 3, minSize: 6 };

		if (this.layout === 'split') {
			this.split = new MergeView({
				parent: this.el,
				a: { doc: this.original, extensions },
				b: { doc: this.modified, extensions },
				highlightChanges: true,
				gutter: true,
				collapseUnchanged,
			});
			this.registerDomEvent(this.split.a.dom, 'focusin', () => { this.focusedSide = 'a'; });
			this.registerDomEvent(this.split.b.dom, 'focusin', () => { this.focusedSide = 'b'; });
			return;
		}

		this.unified = new EditorView({
			parent: this.el,
			state: EditorState.create({
				doc: this.modified,
				extensions: [
					...extensions,
					unifiedMergeView({
						original: this.original,
						mergeControls: false,
						highlightChanges: true,
						gutter: true,
						collapseUnchanged,
					}),
				],
			}),
		});
	}

	onunload() {
		this.unified?.destroy();
		this.split?.destroy();
		this.unified = null;
		this.split = null;
		super.onunload();
	}

	/** In the split layout, the side that last had focus, defaulting to the new version. */
	editor() {
		if (this.split) return this.split[this.focusedSide];
		return this.unified;
	}

	/** Number of added and removed lines across all changed chunks. */
	stats(): DiffStats {
		return diffStats(this.original, this.modified);
	}

	setFontSize(fontSize: number) {
		if (this.fontSize === fontSize) return;
		this.fontSize = fontSize;
		const effects = this.font.reconfigure(fontTheme(fontSize));
		for (const view of this.views()) view.dispatch({ effects });
	}

	private views(): EditorView[] {
		if (this.split) return [this.split.a, this.split.b];
		return this.unified ? [this.unified] : [];
	}
}

/** Centered icon + message, used for empty, binary, oversized and error states. */
export class MessageRenderer extends PaneRenderer {
	constructor(parent: HTMLElement, private icon: string, private message: string, private detail?: string) {
		super(parent, 'so-message');
	}

	onload() {
		const iconEl = this.el.createDiv({ cls: 'so-message-icon' });
		setIcon(iconEl, this.icon);
		this.el.createDiv({ cls: 'so-message-text', text: this.message });
		if (this.detail) this.el.createDiv({ cls: 'so-message-detail', text: this.detail });
	}
}
