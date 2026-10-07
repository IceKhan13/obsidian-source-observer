import { debounce, ItemView, Menu, Notice, Scope, setIcon, WorkspaceLeaf } from 'obsidian';
import * as path from 'path';
import type SourceObserverPlugin from '../main';
import { addRecentFolder, clamp, DEFAULT_SETTINGS, setBaseBranch, SIDEBAR_WIDTH_RANGE } from '../settings';
import { ChangeEntry, ChangeKind, primaryKind } from '../git/status';
import { COPY_FORMATS, CopyFormat, describeLocation, formatForCopy, LineRange, SourceLocation } from '../links/sourceLink';
import { compareWithBase } from '../services/BaseComparison';
import { RepoSnapshot, RepoState } from '../services/RepoState';
import { RepoWatcher } from '../services/RepoWatcher';
import { equivalentFolder, loadWorktreeSummaries } from '../services/Worktrees';
import { LatestRequest } from '../utils/latest';
import { isDirectory, isFile, normalizeFolderInput } from '../utils/paths';
import { copyToClipboard } from '../utils/system';
import { FileMenuItem, showFileMenu } from './fileMenu';
import { showBaseMenu } from './baseMenu';
import { promptForFolder, showFolderMenu } from './folderPicker';
import { showWorktreeMenu } from './worktreeMenu';
import { ContentPane } from './pane/ContentPane';
import { ChangesSection } from './sidebar/ChangesSection';
import { FilesSection } from './sidebar/FilesSection';
import { HistorySection } from './sidebar/HistorySection';
import { SearchSection } from './sidebar/SearchSection';

export const VIEW_TYPE = 'source-observer';

/** Delay before reloading the open file or diff after a change, in ms. */
const PANE_RELOAD_DEBOUNCE_MS = 250;
/** Sidebar width change per arrow-key press on the resize handle, in px. */
const RESIZE_KEY_STEP = 16;

const COPIED_NOTICE: Record<CopyFormat, string> = {
	link: 'Copied link to',
	embed: 'Copied embed of',
	code: 'Copied code block from',
};

/**
 * Two-column layout: Files and Changes sections on the left, the content
 * pane on the right. The view only wires components together; git state
 * lives in `RepoState`, change detection in `RepoWatcher`, and the right
 * pane in `ContentPane`.
 */
export class SourceObserverView extends ItemView {
	private state = new RepoState();
	private pane!: ContentPane;
	private files!: FilesSection;
	private search!: SearchSection;
	private changes!: ChangesSection;
	private history!: HistorySection;
	private watcher!: RepoWatcher;
	private openLabel!: HTMLElement;
	private folder = '';
	private watchKey: string | null = null;
	/** Common git dir whose worktree count is shown, so it is read once per repository. */
	private worktreeKey: string | null = null;
	private baseRequest = new LatestRequest();
	/** Repository and base branch of the comparison on screen, to avoid flashing "Comparing…". */
	private baseKey: string | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: SourceObserverPlugin) {
		super(leaf);
		// Active while this view is focused, so Mod+F works without first
		// clicking into the editor.
		this.scope = new Scope(this.app.scope);
		this.scope.register(['Mod'], 'F', () => (this.findInFile() ? false : undefined));
		this.scope.register(['Mod', 'Shift'], 'F', () => {
			this.searchInFiles();
			return false;
		});
	}

	getViewType() { return VIEW_TYPE; }
	getDisplayText() { return 'Source observer'; }
	getIcon() { return 'code-2'; }

	onOpen(): Promise<void> {
		const settings = this.plugin.settings;
		const root = this.contentEl;
		root.empty();
		root.addClass('so-root');
		this.setSidebarWidth(settings.sidebarWidth);

		// ── Sidebar ───────────────────────────────────────────────────
		const sidebar = root.createDiv({ cls: 'so-sidebar' });
		const openBtn = sidebar.createEl('button', { cls: 'so-open-btn', attr: { 'aria-label': 'Open folder' } });
		setIcon(openBtn.createSpan({ cls: 'so-open-icon' }), 'folder-open');
		this.openLabel = openBtn.createSpan({ cls: 'so-open-label', text: 'Open folder…' });
		setIcon(openBtn.createSpan({ cls: 'so-open-chevron' }), 'chevron-down');
		this.registerDomEvent(openBtn, 'click', (evt) => {
			showFolderMenu(this.app, evt, {
				recent: this.plugin.settings.recentFolders,
				current: this.folder,
				onChoose: (dir) => { void this.openFolder(dir, true); },
				onClearRecent: () => {
					this.plugin.settings.recentFolders = [];
					void this.plugin.saveSettings();
				},
			});
		});

		this.files = this.addChild(new FilesSection(sidebar, {
			showHidden: settings.showHidden,
			onOpenFile: (absPath, label) => { void this.pane.showFile(absPath, label); },
			onContextMenu: (evt, absPath, relPath, isDir) => {
				const extra = isDir ? [] : [this.fileLinkItems(absPath)];
				showFileMenu(evt, { absPath, relPath, isDir, exists: true }, extra);
			},
		}));
		this.search = this.addChild(new SearchSection(sidebar, {
			index: this.files.index,
			showHidden: settings.showHidden,
			onOpenMatch: (absPath, rel, line) => {
				this.files.select(absPath);
				void this.pane.showFile(absPath, rel, { from: line, to: line });
			},
			onContextMenu: (evt, absPath, relPath) => {
				showFileMenu(evt, { absPath, relPath, isDir: false, exists: true }, [this.fileLinkItems(absPath)]);
			},
		}));
		this.changes = this.addChild(new ChangesSection(sidebar, {
			onOpenDiff: (entry) => {
				if (this.state.snapshot.kind !== 'repo') return;
				const repo = this.state.snapshot.repo;
				void this.pane.showDiff(repo, entry, repo.toFolderRelative(entry.file.path));
			},
			onRefresh: () => this.refreshAll(),
			onContextMenu: (evt, entry) => this.showChangeMenu(evt, entry),
			onBranchClick: (anchor) => { void this.showWorktrees(anchor); },
			onToggleBase: () => this.toggleBaseComparison(),
			onBaseClick: (anchor) => { void this.chooseBase(anchor); },
		}));
		this.history = this.addChild(new HistorySection(sidebar, {
			onOpenCommit: (repo, commit, absPath, label) => { void this.pane.showCommit(repo, commit, absPath, label); },
		}));

		// ── Resize handle and content pane ───────────────────────────
		this.buildResizer(root.createDiv({
			cls: 'so-resizer',
			attr: { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize sidebar', tabindex: '0' },
		}), sidebar);
		const main = root.createDiv({ cls: 'so-main' });
		this.pane = this.addChild(new ContentPane(main, {
			fontSize: settings.fontSize,
			wordWrap: settings.wordWrap,
			diffLayout: settings.diffLayout,
			onDiffLayoutChange: (layout) => {
				this.plugin.settings.diffLayout = layout;
				void this.plugin.saveSettings();
			},
			onLinkMenu: (evt) => this.showLinkMenu(evt),
			getRepo: () => (this.state.snapshot.kind === 'repo' ? this.state.snapshot.repo : null),
			onShowHistory: () => this.showFileHistory(),
			onShow: (target) => {
				if (target.type === 'commit') this.history.selectCommit(target.commit.hash);
				else this.history.setFile(this.pane.currentPath());
			},
		}));

		// ── Change detection ─────────────────────────────────────────
		const reloadPane = debounce(() => this.pane.reload(), PANE_RELOAD_DEBOUNCE_MS, true);
		this.register(() => reloadPane.cancel());
		this.watcher = this.addChild(new RepoWatcher({
			isVisible: () => this.contentEl.isShown(),
			onGitChange: () => {
				void this.state.refresh();
				this.history.refresh();
				reloadPane();
			},
			onTreeChange: () => {
				this.files.refresh();
				reloadPane();
			},
		}));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.watcher.resume()));
		this.registerEvent(this.app.workspace.on('layout-change', () => this.watcher.resume()));

		this.register(this.state.onChange((snapshot) => this.applySnapshot(snapshot)));
		this.register(() => this.state.dispose());

		const settingsRef = this.plugin.settingsEvents.on('changed', () => {
			const s = this.plugin.settings;
			this.pane.setFontSize(s.fontSize);
			this.pane.setWordWrap(s.wordWrap);
			this.pane.setDiffLayout(s.diffLayout);
			this.files.setShowHidden(s.showHidden);
			this.search.setShowHidden(s.showHidden);
		});
		this.register(() => this.plugin.settingsEvents.offref(settingsRef));

		// Load the last folder without blocking the workspace.
		if (settings.lastOpenedPath) void this.openFolder(settings.lastOpenedPath, false);
		return Promise.resolve();
	}

	/** Asks for a folder path and opens it. */
	promptForFolder() {
		promptForFolder(this.app, this.folder, (dir) => { void this.openFolder(dir, true); });
	}

	/** True when a file or diff is shown, so find and go-to-line apply. */
	hasEditor(): boolean {
		return this.pane.hasEditor();
	}

	/** Opens the find panel in the shown file or diff; false if nothing is shown. */
	findInFile(): boolean {
		return this.pane.openSearch();
	}

	/** Opens the go-to-line prompt in the shown file or diff; false if nothing is shown. */
	goToLine(): boolean {
		return this.pane.goToLine();
	}

	/** Focuses search in files, filled with the selected text when it is on one line. */
	searchInFiles() {
		const selected = this.pane.selectedText();
		this.search.focus(selected && !selected.includes('\n') ? selected : '');
	}

	/** True when the pane shows a file in a git repository, so its history applies. */
	canShowHistory(): boolean {
		const current = this.pane.currentPath();
		return this.state.snapshot.kind === 'repo' && !!current && !!this.state.snapshot.repo.repoPath(current);
	}

	/** Expands the History section for the file in the pane. */
	showFileHistory() {
		this.history.setFile(this.pane.currentPath());
		this.history.expand();
	}

	/** True when the opened folder is in a git repository, so it has worktrees. */
	hasRepo(): boolean {
		return this.state.snapshot.kind === 'repo';
	}

	/**
	 * Lists the repository's worktrees in a menu below `anchor` (the branch
	 * line, or the top of the view) and opens the one chosen.
	 */
	async showWorktrees(anchor: HTMLElement | null = this.changes.branchAnchor()) {
		if (this.state.snapshot.kind !== 'repo') return;
		const repo = this.state.snapshot.repo;
		let worktrees;
		try {
			worktrees = await loadWorktreeSummaries(repo);
		} catch (err) {
			new Notice(`Cannot list worktrees: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}
		if (this.state.snapshot.kind !== 'repo' || this.state.snapshot.repo !== repo) return;
		this.changes.setWorktreeCount(worktrees.length);
		const rect = (anchor ?? this.contentEl).getBoundingClientRect();
		showWorktreeMenu(this.contentEl.doc, { x: rect.left, y: anchor ? rect.bottom : rect.top + 40 }, worktrees, (wt) => {
			void this.switchWorktree(wt.path, repo.prefix);
		});
	}

	/**
	 * Opens the worktree at `target`, keeping the same subfolder and, when it
	 * exists there, the same file open, so versions are easy to compare.
	 */
	async switchWorktree(target: string, prefix: string) {
		const current = this.pane.currentPath();
		const rel = current ? path.relative(this.folder, current) : '';
		const folder = await equivalentFolder(target, prefix);
		await this.openFolder(folder, true);
		if (this.folder !== folder || !rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
		const absPath = path.join(folder, rel);
		if (!(await isFile(absPath))) return;
		this.files.select(absPath);
		await this.pane.showFile(absPath, rel);
	}

	/** Switches Changes between uncommitted changes and changes against the base branch. */
	toggleBaseComparison() {
		this.plugin.settings.compareWithBase = !this.plugin.settings.compareWithBase;
		void this.plugin.saveSettings();
		void this.refreshBase();
	}

	/** Lets the user pick the base branch for this repository. */
	private async chooseBase(anchor: HTMLElement) {
		if (this.state.snapshot.kind !== 'repo') return;
		const repo = this.state.snapshot.repo;
		let branches: string[];
		try {
			branches = await repo.branches();
		} catch (err) {
			new Notice(`Cannot list branches: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}
		const current = this.plugin.settings.baseBranches[repo.commonDir] ?? (await repo.defaultBase());
		const rect = anchor.getBoundingClientRect();
		showBaseMenu(this.contentEl.doc, { x: rect.left, y: rect.bottom }, branches, current, (branch) => {
			const settings = this.plugin.settings;
			settings.baseBranches = setBaseBranch(settings.baseBranches, repo.commonDir, branch);
			void this.plugin.saveSettings();
			void this.refreshBase();
		});
	}

	/** Recomputes the base comparison for the current snapshot, when base mode is on. */
	private async refreshBase() {
		const snapshot = this.state.snapshot;
		if (!this.plugin.settings.compareWithBase || snapshot.kind !== 'repo') {
			this.baseRequest.cancel();
			this.baseKey = null;
			this.changes.setBase(null);
			return;
		}
		const token = this.baseRequest.next();
		const repo = snapshot.repo;
		const ref = this.plugin.settings.baseBranches[repo.commonDir] ?? (await repo.defaultBase());
		if (!this.baseRequest.isCurrent(token)) return;
		const key = `${repo.gitDir}\0${repo.folder}\0${ref ?? ''}`;
		if (key !== this.baseKey) this.changes.setBase({ kind: 'loading', ref });
		const result = await compareWithBase(repo, ref, snapshot.status).catch((err: unknown) => ({
			kind: 'error' as const,
			ref,
			message: err instanceof Error ? err.message : String(err),
		}));
		if (!this.baseRequest.isCurrent(token)) return;
		this.baseKey = key;
		this.changes.setBase(result);
	}

	/** True when a file in a git repository is shown as code. */
	canToggleBlame(): boolean {
		return this.pane.canBlame();
	}

	/** Shows or hides the blame gutter in the code view. */
	toggleBlame() {
		this.pane.toggleBlame();
	}

	/** True when a file is shown as code, so a link to it or its selection can be copied. */
	canCopyLink(): boolean {
		return !!this.folder && !!this.pane.currentFile();
	}

	/** Copies a link, embed or code block for the shown file, limited to the selected lines. */
	copyFromEditor(format: CopyFormat) {
		const file = this.pane.currentFile();
		if (!file || !this.folder) return;
		const loc = this.locationFor(file.absPath, file.selection.lines);
		void copyToClipboard(formatForCopy(format, loc, file.selection.text), `${COPIED_NOTICE[format]} ${describeLocation(loc)}`);
	}

	/** Opens a file from a link or embed, switching to its folder first if needed. */
	async openLocation(loc: SourceLocation) {
		const folder = normalizeFolderInput(loc.folder);
		if (folder !== this.folder) {
			await this.openFolder(folder, true);
			if (this.folder !== folder) return; // not found; openFolder showed a notice
		}
		const absPath = path.resolve(folder, loc.file);
		this.files.select(absPath);
		await this.pane.showFile(absPath, path.relative(folder, absPath) || path.basename(absPath), loc.lines);
	}

	/** Opens `input` as the browsed folder; `remember` stores it as last/recent. */
	async openFolder(input: string, remember: boolean) {
		const folder = normalizeFolderInput(input);
		if (remember) {
			if (!(await isDirectory(folder))) {
				new Notice(`Folder not found: ${folder}`);
				return;
			}
			const settings = this.plugin.settings;
			settings.lastOpenedPath = folder;
			settings.recentFolders = addRecentFolder(settings.recentFolders, folder);
			await this.plugin.saveSettings();
		}

		this.folder = folder;
		this.watchKey = null;
		this.openLabel.setText(path.basename(folder) || folder);
		this.openLabel.parentElement?.setAttr('aria-label', `Open folder (current: ${folder})`);
		this.pane.showPlaceholder();
		this.history.setFile(null);
		this.files.setFolder(folder);
		this.search.setFolder(folder);
		await this.state.open(folder);
	}

	private showChangeMenu(evt: MouseEvent, entry: ChangeEntry) {
		if (this.state.snapshot.kind !== 'repo') return;
		const repo = this.state.snapshot.repo;
		const relPath = repo.toFolderRelative(entry.file.path);
		const absPath = repo.absPath(entry.file.path);
		const exists = entry.kind !== 'deleted';
		const extra = exists
			? [
				[{ title: 'Open file', icon: 'file-text', run: () => { void this.pane.showFile(absPath, relPath); } }],
				this.fileLinkItems(absPath),
			]
			: [];
		showFileMenu(evt, { absPath, relPath, isDir: false, exists }, extra);
	}

	/** A location in the opened folder, with a '/'-separated relative path. */
	private locationFor(absPath: string, lines: LineRange | null): SourceLocation {
		return { folder: this.folder, file: path.relative(this.folder, absPath).split(path.sep).join('/'), lines };
	}

	/** "Copy link" and "Copy embed" for a whole file, for the sidebar context menus. */
	private fileLinkItems(absPath: string): FileMenuItem[] {
		const loc = this.locationFor(absPath, null);
		return COPY_FORMATS.filter((f) => f.format !== 'code').map(({ format, title, icon }) => ({
			title,
			icon,
			run: () => { void copyToClipboard(formatForCopy(format, loc), `${COPIED_NOTICE[format]} ${loc.file}`); },
		}));
	}

	/** The header's link button: copy the shown file or selection in each format. */
	private showLinkMenu(evt: MouseEvent) {
		const menu = new Menu();
		for (const { format, title, icon } of COPY_FORMATS) {
			menu.addItem((item) => item.setTitle(title).setIcon(icon).onClick(() => this.copyFromEditor(format)));
		}
		menu.showAtMouseEvent(evt);
	}

	private refreshAll() {
		void this.state.refresh();
		this.files.refresh();
		this.pane.reload();
	}

	private applySnapshot(snapshot: RepoSnapshot) {
		this.changes.update(snapshot);
		void this.refreshBase();

		const repo = snapshot.kind === 'repo' ? snapshot.repo : null;
		this.files.setRepo(repo);
		this.search.setRepo(repo);
		this.history.setRepo(repo);

		const kinds = new Map<string, ChangeKind>();
		const dirty = new Set<string>();
		if (snapshot.kind === 'repo') {
			for (const file of snapshot.status.files) {
				const abs = snapshot.repo.absPath(file.path);
				kinds.set(abs, primaryKind(file));
				// Mark every folder between the file and the opened root.
				for (let dir = path.dirname(abs); ; dir = path.dirname(dir)) {
					const rel = path.relative(this.folder, dir);
					if (rel.startsWith('..') || path.isAbsolute(rel)) break;
					dirty.add(dir);
					if (!rel) break;
				}
			}
		}
		this.files.setDecorations(kinds, dirty);

		if (repo && repo.commonDir !== this.worktreeKey) {
			this.worktreeKey = repo.commonDir;
			void repo.worktrees().then(
				(list) => { if (this.worktreeKey === repo.commonDir) this.changes.setWorktreeCount(list.length); },
				() => undefined,
			);
		} else if (!repo) {
			this.worktreeKey = null;
		}

		const watchFolder = snapshot.kind === 'none' || snapshot.kind === 'missing-folder' ? '' : snapshot.folder;
		const key = `${watchFolder}\0${repo?.gitDir ?? ''}`;
		if (key !== this.watchKey) {
			this.watchKey = key;
			this.watcher.watch(watchFolder, repo);
		}
	}

	private setSidebarWidth(width: number) {
		const w = clamp(width, SIDEBAR_WIDTH_RANGE.min, SIDEBAR_WIDTH_RANGE.max);
		this.contentEl.setCssProps({ '--so-sidebar-width': `${w}px` });
		return w;
	}

	private buildResizer(handle: HTMLElement, sidebar: HTMLElement) {
		const settings = this.plugin.settings;
		const persist = (width: number) => {
			settings.sidebarWidth = width;
			void this.plugin.saveSettings();
		};

		this.registerDomEvent(handle, 'pointerdown', (e: PointerEvent) => {
			if (e.button !== 0) return;
			e.preventDefault();
			handle.setPointerCapture(e.pointerId);
			handle.addClass('is-dragging');
			const startX = e.clientX;
			const startWidth = sidebar.getBoundingClientRect().width;
			let width = startWidth;
			const onMove = (ev: PointerEvent) => { width = this.setSidebarWidth(startWidth + ev.clientX - startX); };
			const onUp = () => {
				handle.removeEventListener('pointermove', onMove);
				handle.removeEventListener('pointerup', onUp);
				handle.removeEventListener('pointercancel', onUp);
				handle.removeClass('is-dragging');
				if (width !== startWidth) persist(width);
			};
			handle.addEventListener('pointermove', onMove);
			handle.addEventListener('pointerup', onUp);
			handle.addEventListener('pointercancel', onUp);
		});
		this.registerDomEvent(handle, 'dblclick', () => persist(this.setSidebarWidth(DEFAULT_SETTINGS.sidebarWidth)));
		this.registerDomEvent(handle, 'keydown', (e) => {
			const delta = e.key === 'ArrowLeft' ? -RESIZE_KEY_STEP : e.key === 'ArrowRight' ? RESIZE_KEY_STEP : 0;
			if (!delta) return;
			e.preventDefault();
			persist(this.setSidebarWidth(settings.sidebarWidth + delta));
		});
	}
}
