import { Component, debounce, setIcon } from 'obsidian';
import * as path from 'path';
import type { GitRepo } from '../../git/GitRepo';
import type { ChangeKind } from '../../git/status';
import { FileIndex, rankMatches } from '../../services/FileIndex';
import { fileIcon } from '../../utils/fileIcons';
import { LatestRequest } from '../../utils/latest';
import { FileTree } from './FileTree';
import { attachListNav, markRow } from './keyboardNav';
import { createSection } from './section';

/** Debounce delay for the search input, in ms. */
const SEARCH_DEBOUNCE_MS = 150;
/** Maximum number of search results rendered. */
export const SEARCH_RESULTS_CAP = 200;

export interface FilesSectionOptions {
	showHidden: boolean;
	onOpenFile: (absPath: string, label: string) => void;
	/** Right-click on a file or folder; `relPath` is relative to the opened folder. */
	onContextMenu?: (evt: MouseEvent, absPath: string, relPath: string, isDir: boolean) => void;
}

/** The "Files" sidebar section: a directory tree plus file-name search. */
export class FilesSection extends Component {
	private tree: FileTree;
	private treeEl: HTMLElement;
	private resultsEl: HTMLElement;
	private searchInput: HTMLInputElement;
	/** Shared with content search, which reads files from it outside git repositories. */
	readonly index = new FileIndex();
	private searchToken = new LatestRequest();
	private folder = '';
	private repoKey = '';
	private showHidden: boolean;

	constructor(parent: HTMLElement, private opts: FilesSectionOptions) {
		super();
		this.showHidden = opts.showHidden;
		const { body, searchInput } = createSection(this, parent, 'Files');
		this.searchInput = searchInput;
		this.treeEl = body.createDiv({ cls: 'so-tree so-scroll' });
		this.resultsEl = body.createDiv({ cls: 'so-tree so-scroll so-hidden' });

		this.tree = new FileTree(this, this.treeEl, this.showHidden, (abs) => this.open(abs), (evt, abs, isDir) => {
			opts.onContextMenu?.(evt, abs, this.relative(abs), isDir);
		});

		attachListNav(this, this.resultsEl, {
			rows: () => Array.from(this.resultsEl.querySelectorAll<HTMLElement>('[data-so-row]')),
			onActivate: (row) => row.click(),
		});

		const runSearch = debounce(() => { void this.search(); }, SEARCH_DEBOUNCE_MS, true);
		this.register(() => runSearch.cancel());
		this.registerDomEvent(searchInput, 'input', () => {
			// Clearing is instant; typing is debounced.
			if (!searchInput.value.trim()) {
				runSearch.cancel();
				void this.search();
			} else {
				runSearch();
			}
		});
		this.registerDomEvent(searchInput, 'keydown', (e) => {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				this.resultsEl.focus();
			}
		});
	}

	/** Shows a new folder; the git repository (if any) is supplied later via `setRepo`. */
	setFolder(folder: string) {
		this.folder = folder;
		this.repoKey = '';
		this.index.reset(folder, null);
		void this.tree.load(folder);
		void this.search();
	}

	/** Switches the search index to `git ls-files` once the repository is known. */
	setRepo(repo: GitRepo | null) {
		const key = repo ? repo.gitDir : '';
		if (key === this.repoKey) return;
		this.repoKey = key;
		this.index.reset(this.folder, repo);
		if (this.query()) void this.search();
	}

	/** Re-reads the tree and search index after files changed on disk. */
	refresh() {
		this.index.invalidate();
		void this.tree.refresh();
		if (this.query()) void this.search();
	}

	setShowHidden(showHidden: boolean) {
		if (this.showHidden === showHidden) return;
		this.showHidden = showHidden;
		this.tree.setShowHidden(showHidden);
		if (this.query()) void this.search();
	}

	/** Highlights `absPath` in the tree if it is rendered. */
	select(absPath: string) {
		this.tree.select(absPath);
	}

	setDecorations(kinds: Map<string, ChangeKind>, dirtyDirs: Set<string>) {
		this.tree.setDecorations(kinds, dirtyDirs);
	}

	private query(): string {
		return this.searchInput.value.trim();
	}

	/** Path relative to the opened folder, '/'-separated on every platform. */
	private relative(absPath: string): string {
		return path.relative(this.folder, absPath).split(path.sep).join('/');
	}

	private open(absPath: string) {
		this.tree.select(absPath);
		this.opts.onOpenFile(absPath, path.relative(this.folder, absPath) || path.basename(absPath));
	}

	private async search() {
		const token = this.searchToken.next();
		const query = this.query();
		if (!query || !this.folder) {
			this.resultsEl.addClass('so-hidden');
			this.treeEl.removeClass('so-hidden');
			this.resultsEl.empty();
			return;
		}

		const { files, truncated } = await this.index.list();
		if (!this.searchToken.isCurrent(token)) return;
		const { matches, total } = rankMatches(files, query, { showHidden: this.showHidden, limit: SEARCH_RESULTS_CAP });

		this.treeEl.addClass('so-hidden');
		this.resultsEl.removeClass('so-hidden');
		this.resultsEl.empty();
		if (matches.length === 0) {
			this.resultsEl.createDiv({ cls: 'so-empty', text: 'No results' });
		}
		for (const rel of matches) this.renderResult(rel);
		if (total > matches.length) {
			this.resultsEl.createDiv({
				cls: 'so-hint',
				text: `Showing ${matches.length} of ${total} results — refine your search`,
			});
		}
		if (truncated) {
			this.resultsEl.createDiv({ cls: 'so-hint', text: 'Only the first 50,000 files were indexed' });
		}
	}

	private renderResult(rel: string) {
		const absPath = path.join(this.folder, rel);
		const row = this.resultsEl.createDiv({ cls: 'so-tree-row so-tree-file so-search-result' });
		markRow(row);
		row.title = rel;
		const iconEl = row.createSpan({ cls: 'so-tree-icon' });
		const name = rel.slice(rel.lastIndexOf('/') + 1);
		const [icon, cls] = fileIcon(name);
		setIcon(iconEl, icon);
		iconEl.addClass(cls);
		const label = row.createSpan({ cls: 'so-tree-label', text: name });
		const dir = rel.slice(0, Math.max(0, rel.lastIndexOf('/')));
		if (dir) label.createSpan({ cls: 'so-row-context', text: ` ${dir}` });
		row.addEventListener('click', () => {
			this.resultsEl.querySelectorAll('.is-active').forEach((el) => el.removeClass('is-active'));
			row.addClass('is-active');
			this.open(absPath);
		});
		row.addEventListener('contextmenu', (evt) => this.opts.onContextMenu?.(evt, absPath, rel, false));
	}
}
