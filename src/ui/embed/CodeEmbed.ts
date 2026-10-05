import { debounce, MarkdownRenderChild, setIcon } from 'obsidian';
import { FSWatcher, watch } from 'fs';
import * as path from 'path';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { describeLocation, EmbedSpec, formatLines, SourceLocation } from '../../links/sourceLink';
import { formatBytes, readViewableFile } from '../../utils/content';
import { fileIcon } from '../../utils/fileIcons';
import { LatestRequest } from '../../utils/latest';
import { languageFor } from '../editor/languages';
import { obsidianHighlight, obsidianTheme } from '../editor/theme';

/** Delay before re-reading an embedded file after it changed, in ms. */
const RELOAD_DEBOUNCE_MS = 200;

const embedTheme = Prec.highest(EditorView.theme({
	'&': { height: 'auto', maxHeight: '480px', fontSize: 'var(--code-size)' },
	'.cm-scroller': { overflow: 'auto' },
}));

/** Lines `from`–`to` (1-based, inclusive) of `text`, or null if `from` is past the end. */
export function sliceLines(text: string, from: number, to: number): { text: string; to: number } | null {
	const lines = text.split(/\r\n?|\n/);
	// A trailing newline does not start another line.
	if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
	if (from > lines.length) return null;
	const end = Math.min(to, lines.length);
	return { text: lines.slice(from - 1, end).join('\n'), to: end };
}

/**
 * A live, read-only excerpt of a file inside a note, rendered for
 * ```source-observer blocks. It re-reads the file when it changes on disk;
 * the header opens the location in Source Observer.
 */
export class CodeEmbed extends MarkdownRenderChild {
	private bodyEl: HTMLElement;
	private view: EditorView | null = null;
	private watcher: FSWatcher | null = null;
	private latest = new LatestRequest();

	constructor(containerEl: HTMLElement, private spec: EmbedSpec, private onOpen: (loc: SourceLocation) => void) {
		super(containerEl);
		containerEl.addClass('so-embed');
		const header = containerEl.createDiv({ cls: 'so-embed-header', attr: { role: 'link', tabindex: '0' } });
		const [icon, cls] = fileIcon(path.basename(spec.absPath));
		setIcon(header.createSpan({ cls: `so-embed-icon ${cls}` }), icon);
		header.createSpan({ cls: 'so-embed-label', text: describeLocation(spec.location) });
		header.title = `Open ${spec.absPath} in Source Observer`;
		this.bodyEl = containerEl.createDiv({ cls: 'so-embed-body' });

		const open = (evt: Event) => {
			// In live preview, a click would otherwise move the cursor into the block's source.
			evt.preventDefault();
			evt.stopPropagation();
			this.onOpen(this.spec.location);
		};
		this.registerDomEvent(header, 'click', open);
		this.registerDomEvent(header, 'keydown', (evt) => {
			if (evt.key === 'Enter' || evt.key === ' ') open(evt);
		});
	}

	onload() {
		void this.render();
		this.watchFile();
	}

	onunload() {
		this.latest.cancel();
		this.watcher?.close();
		this.watcher = null;
		this.destroyEditor();
	}

	/** Re-reads the file and replaces the excerpt. */
	async render() {
		const token = this.latest.next();
		const content = await readViewableFile(this.spec.absPath);
		if (!this.latest.isCurrent(token)) return;
		this.destroyEditor();
		this.bodyEl.empty();

		switch (content.kind) {
			case 'missing':
				return this.message(`File not found: ${this.spec.absPath}`);
			case 'binary':
				return this.message(`Binary file (${formatBytes(content.size)})`);
			case 'too-large':
				return this.message(`File is too large to embed (${formatBytes(content.size)})`);
			case 'error':
				return this.message(`Cannot read file: ${content.message}`);
		}

		const lines = this.spec.location.lines;
		let text = content.text;
		let first = 1;
		if (lines) {
			const slice = sliceLines(text, lines.from, lines.to);
			if (!slice) return this.message(`Lines ${formatLines(lines)} are past the end of the file`);
			text = slice.text;
			first = lines.from;
		}

		this.view = new EditorView({
			parent: this.bodyEl,
			state: EditorState.create({
				doc: text,
				extensions: [
					EditorState.readOnly.of(true),
					EditorView.editable.of(false),
					lineNumbers({ formatNumber: (n) => String(n + first - 1) }),
					syntaxHighlighting(obsidianHighlight),
					languageFor(path.basename(this.spec.absPath)),
					obsidianTheme,
					embedTheme,
				],
			}),
		});
	}

	private message(text: string) {
		this.bodyEl.createDiv({ cls: 'so-embed-message', text });
	}

	private destroyEditor() {
		this.view?.destroy();
		this.view = null;
	}

	/**
	 * Watches the file's folder rather than the file, so editors that save by
	 * replacing the file (rename over it) keep triggering updates.
	 */
	private watchFile() {
		const reload = debounce(() => { void this.render(); }, RELOAD_DEBOUNCE_MS, true);
		this.register(() => reload.cancel());
		const name = path.basename(this.spec.absPath);
		try {
			this.watcher = watch(path.dirname(this.spec.absPath), (_event, changed) => {
				if (!changed || changed.toString() === name) reload();
			});
			// A folder that disappears simply stops updating the embed.
			this.watcher.on('error', () => {
				this.watcher?.close();
				this.watcher = null;
			});
		} catch {
			// Missing folder: the embed shows "File not found" and stays static.
		}
	}
}
