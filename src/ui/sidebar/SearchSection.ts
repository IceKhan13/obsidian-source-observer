import { Component, debounce, setIcon } from 'obsidian';
import * as path from 'path';
import type { GitRepo } from '../../git/GitRepo';
import { ContentSearch, FileMatches, MatchLine, SearchQuery, SearchResults } from '../../services/ContentSearch';
import type { FileIndex } from '../../services/FileIndex';
import { fileIcon } from '../../utils/fileIcons';
import { attachListNav, markRow } from './keyboardNav';
import { createSectionShell } from './section';

/** Debounce delay for the search input, in ms. */
const SEARCH_DEBOUNCE_MS = 300;

type QueryOption = 'caseSensitive' | 'wholeWord' | 'regex';

const OPTIONS: { key: QueryOption; text: string; label: string }[] = [
	{ key: 'caseSensitive', text: 'Aa', label: 'Match case' },
	{ key: 'wholeWord', text: 'ab', label: 'Match whole word' },
	{ key: 'regex', text: '.*', label: 'Use regular expression' },
];

export interface SearchSectionOptions {
	index: FileIndex;
	showHidden: boolean;
	/** Opens `absPath` at `line`; `rel` is relative to the opened folder. */
	onOpenMatch: (absPath: string, rel: string, line: number) => void;
	onContextMenu?: (evt: MouseEvent, absPath: string, relPath: string) => void;
}

/**
 * The "Search" sidebar section: full-text search across the opened folder,
 * with results grouped by file. Selecting a line opens the file there.
 */
export class SearchSection extends Component {
	private input: HTMLInputElement;
	private summaryEl: HTMLElement;
	private resultsEl: HTMLElement;
	private setCollapsed: (collapsed: boolean) => void;
	private search: ContentSearch;
	private options: Record<QueryOption, boolean> = { caseSensitive: false, wholeWord: false, regex: false };
	private folder = '';
	private repo: GitRepo | null = null;
	/** False until `setRepo` reports whether the folder is a repository. */
	private repoKnown = false;
	private showHidden: boolean;
	private abort: AbortController | null = null;
	/** Query of the results on screen, so unchanged searches are not re-run. */
	private shownKey = '';
	private runDebounced: ReturnType<typeof debounce>;

	constructor(parent: HTMLElement, private opts: SearchSectionOptions) {
		super();
		this.showHidden = opts.showHidden;
		this.search = new ContentSearch(opts.index);
		const shell = createSectionShell(this, parent, 'Search', { collapsed: true });
		this.setCollapsed = shell.setCollapsed;
		const { body, headerRight } = shell;

		const refreshBtn = headerRight.createEl('button', {
			cls: 'clickable-icon so-icon-btn',
			attr: { 'aria-label': 'Search again' },
		});
		setIcon(refreshBtn, 'refresh-cw');
		this.registerDomEvent(refreshBtn, 'click', (e) => {
			e.stopPropagation();
			this.run(true);
		});

		const row = body.createDiv({ cls: 'so-search-row' });
		this.input = row.createEl('input', {
			cls: 'so-search-input',
			attr: { type: 'search', placeholder: 'Search in files…', spellcheck: 'false', 'aria-label': 'Search in files' },
		});
		const toggles = row.createDiv({ cls: 'so-search-options' });
		for (const { key, text, label } of OPTIONS) {
			const btn = toggles.createEl('button', {
				cls: 'clickable-icon so-search-option',
				text,
				attr: { 'aria-label': label, 'aria-pressed': 'false' },
			});
			this.registerDomEvent(btn, 'click', () => {
				this.options[key] = !this.options[key];
				btn.toggleClass('is-active', this.options[key]);
				btn.setAttr('aria-pressed', String(this.options[key]));
				this.run(true);
			});
		}

		this.summaryEl = body.createDiv({ cls: 'so-hint so-search-summary so-hidden' });
		this.resultsEl = body.createDiv({ cls: 'so-tree so-scroll so-search-results' });

		attachListNav(this, this.resultsEl, {
			rows: () => Array.from(this.resultsEl.querySelectorAll<HTMLElement>('[data-so-row]'))
				.filter((r) => !r.closest('.so-search-file.is-collapsed .so-search-lines')),
			onActivate: (r) => r.click(),
			onCollapse: (r) => this.toggleFile(r, true),
			onExpand: (r) => this.toggleFile(r, false),
		});

		this.runDebounced = debounce(() => this.run(false), SEARCH_DEBOUNCE_MS, true);
		this.register(() => {
			this.runDebounced.cancel();
			this.abort?.abort();
		});
		this.registerDomEvent(this.input, 'input', () => {
			if (!this.input.value) this.run(false);
			else this.runDebounced();
		});
		this.registerDomEvent(this.input, 'keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.runDebounced.cancel();
				this.run(true);
			} else if (e.key === 'ArrowDown') {
				e.preventDefault();
				this.resultsEl.focus();
			} else if (e.key === 'Escape' && this.input.value) {
				e.preventDefault();
				this.input.value = '';
				this.run(false);
			}
		});
	}

	/** Expands the section and focuses the input, optionally filling it with `text`. */
	focus(text = '') {
		this.setCollapsed(false);
		if (text && text !== this.input.value) {
			this.input.value = text;
			this.run(true);
		}
		this.input.focus();
		this.input.select();
	}

	/** Clears results for a newly opened folder. */
	setFolder(folder: string) {
		this.folder = folder;
		this.repo = null;
		this.repoKnown = false;
		this.run(true);
	}

	/**
	 * Sets the repository (or null) of the opened folder. Searching waits for
	 * this, so a large repository is never scanned file by file meanwhile.
	 */
	setRepo(repo: GitRepo | null) {
		if (this.repoKnown && (repo?.gitDir ?? '') === (this.repo?.gitDir ?? '')) return;
		this.repo = repo;
		this.repoKnown = true;
		this.run(true);
	}

	setShowHidden(showHidden: boolean) {
		if (this.showHidden === showHidden) return;
		this.showHidden = showHidden;
		this.run(true);
	}

	private query(): SearchQuery {
		return { text: this.input.value, ...this.options };
	}

	/** Starts a search for the current input; `force` re-runs an unchanged query. */
	private run(force: boolean) {
		const query = this.query();
		const key = JSON.stringify([this.folder, this.repo?.gitDir ?? '', this.showHidden, query]);
		if (!force && key === this.shownKey) return;
		this.shownKey = key;
		this.abort?.abort();
		this.abort = null;

		if (!query.text || !this.folder || !this.repoKnown) {
			this.showSummary('');
			this.resultsEl.empty();
			return;
		}
		const abort = new AbortController();
		this.abort = abort;
		this.resultsEl.addClass('so-loading');
		void this.search.run(this.folder, this.repo, query, { showHidden: this.showHidden, signal: abort.signal })
			.then((results) => {
				if (abort.signal.aborted) return;
				this.render(results);
			}, (err: unknown) => {
				if (abort.signal.aborted) return;
				this.resultsEl.empty();
				const message = err instanceof Error ? err.message : String(err);
				this.showSummary(err instanceof SyntaxError ? `Invalid regular expression: ${message}` : message, true);
			})
			.finally(() => {
				if (this.abort === abort) {
					this.abort = null;
					this.resultsEl.removeClass('so-loading');
				}
			});
	}

	private showSummary(text: string, isError = false) {
		this.summaryEl.setText(text);
		this.summaryEl.toggleClass('so-hidden', !text);
		this.summaryEl.toggleClass('so-search-error', isError);
	}

	private render(results: SearchResults) {
		const scrollTop = this.resultsEl.scrollTop;
		this.resultsEl.empty();
		const { files, matchCount, truncated } = results;
		if (matchCount === 0) {
			this.showSummary('No results');
			return;
		}
		const lines = matchCount === 1 ? 'result' : 'results';
		const inFiles = files.length === 1 ? '1 file' : `${files.length} files`;
		this.showSummary(truncated
			? `Showing the first ${matchCount.toLocaleString()} ${lines} in ${inFiles} — refine your search`
			: `${matchCount.toLocaleString()} ${lines} in ${inFiles}`);
		for (const file of files) this.renderFile(file);
		this.resultsEl.scrollTop = scrollTop;
	}

	private renderFile(file: FileMatches) {
		const absPath = path.join(this.folder, file.rel);
		const group = this.resultsEl.createDiv({ cls: 'so-search-file' });
		const header = group.createDiv({ cls: 'so-tree-row so-search-file-row' });
		markRow(header);
		header.title = file.rel;
		const chevron = header.createSpan({ cls: 'so-search-chevron' });
		setIcon(chevron, 'chevron-down');
		const iconEl = header.createSpan({ cls: 'so-tree-icon' });
		const name = file.rel.slice(file.rel.lastIndexOf('/') + 1);
		const [icon, cls] = fileIcon(name);
		setIcon(iconEl, icon);
		iconEl.addClass(cls);
		const label = header.createSpan({ cls: 'so-tree-label', text: name });
		const dir = file.rel.slice(0, Math.max(0, file.rel.lastIndexOf('/')));
		if (dir) label.createSpan({ cls: 'so-row-context', text: ` ${dir}` });
		header.createSpan({ cls: 'so-search-count', text: String(file.lines.length) });
		header.addEventListener('click', () => { group.toggleClass('is-collapsed', !group.hasClass('is-collapsed')); });
		header.addEventListener('contextmenu', (evt) => this.opts.onContextMenu?.(evt, absPath, file.rel));

		const list = group.createDiv({ cls: 'so-search-lines' });
		for (const match of file.lines) this.renderLine(list, absPath, file.rel, match);
	}

	private renderLine(list: HTMLElement, absPath: string, rel: string, match: MatchLine) {
		const row = list.createDiv({ cls: 'so-tree-row so-search-line' });
		markRow(row);
		row.title = `${rel}:${match.line}`;
		row.createSpan({ cls: 'so-search-line-number', text: String(match.line) });
		const text = row.createSpan({ cls: 'so-search-line-text' });
		let pos = 0;
		for (const [from, to] of match.ranges) {
			if (from < pos) continue;
			if (from > pos) text.appendText(match.preview.slice(pos, from));
			text.createEl('mark', { cls: 'so-search-match', text: match.preview.slice(from, to) });
			pos = to;
		}
		if (pos < match.preview.length) text.appendText(match.preview.slice(pos));
		row.addEventListener('click', () => {
			this.resultsEl.querySelectorAll('.is-active').forEach((el) => el.removeClass('is-active'));
			row.addClass('is-active');
			this.opts.onOpenMatch(absPath, rel, match.line);
		});
		row.addEventListener('contextmenu', (evt) => this.opts.onContextMenu?.(evt, absPath, rel));
	}

	/** Left/Right on a result: collapse or expand its file, focusing the file row. */
	private toggleFile(row: HTMLElement, collapse: boolean): HTMLElement | null {
		const group = row.closest<HTMLElement>('.so-search-file');
		const header = group?.querySelector<HTMLElement>('.so-search-file-row');
		if (!group || !header) return null;
		if (row !== header) return collapse ? header : null;
		group.toggleClass('is-collapsed', collapse);
		return header;
	}
}
