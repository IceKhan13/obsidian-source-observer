import { Component, setIcon } from 'obsidian';
import { Compartment, EditorState, Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, lineNumbers } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { unifiedMergeView } from '@codemirror/merge';
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
}

function baseEditorExtensions(): Extension[] {
	return [
		EditorState.readOnly.of(true),
		EditorView.editable.of(false),
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
 * Unified, syntax-highlighted diff of two documents using
 * `@codemirror/merge`. Unchanged stretches are collapsed.
 */
export class DiffRenderer extends PaneRenderer {
	private view: EditorView | null = null;
	private font = new Compartment();

	constructor(
		parent: HTMLElement,
		private fontSize: number,
		private original: string,
		private modified: string,
		private fileName: string,
	) {
		super(parent, 'so-diff-view');
	}

	onload() {
		this.view = new EditorView({
			parent: this.el,
			state: EditorState.create({
				doc: this.modified,
				extensions: [
					...baseEditorExtensions(),
					languageFor(this.fileName),
					this.font.of(fontTheme(this.fontSize)),
					unifiedMergeView({
						original: this.original,
						mergeControls: false,
						highlightChanges: true,
						gutter: true,
						collapseUnchanged: { margin: 3, minSize: 6 },
					}),
					diffTheme,
				],
			}),
		});
	}

	onunload() {
		this.view?.destroy();
		this.view = null;
		super.onunload();
	}

	/** Number of added and removed lines across all changed chunks. */
	stats(): DiffStats {
		return diffStats(this.original, this.modified);
	}

	setFontSize(fontSize: number) {
		if (this.fontSize === fontSize) return;
		this.fontSize = fontSize;
		this.view?.dispatch({ effects: this.font.reconfigure(fontTheme(fontSize)) });
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
