import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type SourceObserverPlugin from './main';
import { FileTree } from './fileTree';
import { CodePane } from './codePane';
import { getChangedFiles, getFileDiff, isGitRepo, renderDiff, ChangedFile } from './gitDiff';

export const VIEW_TYPE = 'source-observer';

/** Debounce delay for the file-tree search input, in ms. */
const SEARCH_DEBOUNCE_MS = 200;
/** Interval for polling `git status` when fs.watch is unavailable, in ms. */
const GIT_POLL_MS = 5000;

interface ElectronRemote {
	dialog: {
		showOpenDialog(opts: Record<string, unknown>): Promise<{ canceled: boolean; filePaths: string[] }>;
	};
}

/**
 * Main plugin view — two-column layout with a file/changes sidebar on the left
 * and a code or diff pane on the right. Watches `.git/index` and `.git/refs`
 * with `fs.watch`, falling back to polling `git status` on an interval.
 */
export class SourceObserverView extends ItemView {
	plugin: SourceObserverPlugin;
	private fileTree!: FileTree;
	private codePane!: CodePane;
	private rightPane!: HTMLElement;
	private changesContainer!: HTMLElement;
	private changesCounts!: HTMLElement;
	private pathLabel!: HTMLElement;
	private repoPath = '';
	private isRepo = false;
	private allChanges: ChangedFile[] = [];
	private changesQuery = '';
	private watchers: fs.FSWatcher[] = [];
	private pollTimer: number | null = null;
	private refreshTimer: number | null = null;
	private treeSearchTimer: number | null = null;
	private diffRequestId = 0;

	constructor(leaf: WorkspaceLeaf, plugin: SourceObserverPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return VIEW_TYPE; }
	getDisplayText() { return 'Source observer'; }
	getIcon() { return 'code-2'; }

	async onOpen() {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass('so-root');

		// ── Left sidebar ──────────────────────────────────────────────
		const sidebar = root.createDiv({ cls: 'so-sidebar' });
		const openBtn = sidebar.createEl('button', { cls: 'so-open-btn', text: 'Open folder…' });

		const { body: treeBody, searchInput: treeSearch } = this.buildSection(sidebar, 'Files');
		const treeContainer = treeBody.createDiv({ cls: 'so-tree' });

		const { body: changesBody, searchInput: changesSearch, headerRight: changesHeaderRight } =
			this.buildSection(sidebar, 'Changes');

		const refreshBtn = changesHeaderRight.createEl('button', {
			cls: 'so-search-icon-btn',
			attr: { 'aria-label': 'Refresh changes' },
		});
		setIcon(refreshBtn, 'refresh-cw');
		this.registerDomEvent(refreshBtn, 'click', (e) => {
			e.stopPropagation();
			void this.refreshChanges();
		});

		this.changesCounts = changesHeaderRight.createDiv({ cls: 'so-section-counts' });
		this.changesContainer = changesBody.createDiv({ cls: 'so-changes' });

		// ── Right pane ────────────────────────────────────────────────
		const main = root.createDiv({ cls: 'so-main' });
		this.pathLabel = main.createDiv({ cls: 'so-path-label' });
		this.rightPane = main.createDiv({ cls: 'so-pane' });

		this.codePane = new CodePane(this.rightPane, this.plugin.settings.fontSize);

		this.fileTree = new FileTree(
			treeContainer,
			this.plugin.settings.showHidden,
			(filePath) => {
				this.pathLabel.setText(filePath);
				void this.codePane.open(filePath);
			},
		);

		this.registerDomEvent(treeSearch, 'input', () => {
			if (this.treeSearchTimer) window.clearTimeout(this.treeSearchTimer);
			this.treeSearchTimer = window.setTimeout(
				() => { void this.fileTree.search(treeSearch.value); },
				SEARCH_DEBOUNCE_MS,
			);
		});
		this.registerDomEvent(changesSearch, 'input', () => {
			this.changesQuery = changesSearch.value;
			this.renderChanges(this.changesQuery);
		});

		// Re-render when font size or hidden-file settings change.
		const settingsRef = this.plugin.settingsEvents.on('changed', () => {
			this.codePane.setFontSize(this.plugin.settings.fontSize);
			this.fileTree.setShowHidden(this.plugin.settings.showHidden);
		});
		this.register(() => this.plugin.settingsEvents.offref(settingsRef));

		if (this.plugin.settings.lastOpenedPath) {
			await this.openFolder(this.plugin.settings.lastOpenedPath);
		}

		this.registerDomEvent(openBtn, 'click', () => {
			void (async () => {
				const { remote } = window.require('electron') as { remote: ElectronRemote };
				const result = await remote.dialog.showOpenDialog({ properties: ['openDirectory'] });
				const [dir] = result.filePaths;
				if (result.canceled || !dir) return;
				this.plugin.settings.lastOpenedPath = dir;
				await this.plugin.saveSettings();
				await this.openFolder(dir);
			})();
		});
	}

	private async openFolder(dir: string) {
		this.repoPath = dir;
		this.isRepo = await isGitRepo(dir);
		await this.fileTree.loadPath(dir);
		await this.refreshChanges();
		this.startWatching();
		// Interval-based poll covers anything fs.watch misses (untracked
		// files, platforms without reliable recursive watching).
		if (this.pollTimer === null) {
			this.pollTimer = this.registerInterval(
				window.setInterval(() => { void this.refreshChanges(); }, GIT_POLL_MS),
			);
		}
	}

	// Watch .git/index (staged changes) and .git/refs (branch/commit updates).
	// Both share a debounce so rapid saves don't hammer git.
	private startWatching() {
		this.stopWatching();
		if (!this.isRepo) return;

		const schedule = () => {
			if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
			this.refreshTimer = window.setTimeout(() => { void this.refreshChanges(); }, 800);
		};

		const watch = (target: string) => {
			try {
				// 'error' must be handled: unhandled watcher errors throw as
				// uncaught exceptions on the EventEmitter.
				const w = fs.watch(target, schedule);
				w.on('error', () => { /* watched path removed or unreadable */ });
				this.watchers.push(w);
			} catch { /* not a git repo */ }
		};

		watch(path.join(this.repoPath, '.git', 'index'));
		watch(path.join(this.repoPath, '.git', 'refs'));
	}

	private stopWatching() {
		if (this.refreshTimer) { window.clearTimeout(this.refreshTimer); this.refreshTimer = null; }
		for (const w of this.watchers) { try { w.close(); } catch { /* ignore */ } }
		this.watchers = [];
	}

	private buildSection(parent: HTMLElement, title: string) {
		const section = parent.createDiv({ cls: 'so-section' });
		const header = section.createDiv({ cls: 'so-section-header' });

		const toggle = header.createDiv({ cls: 'so-section-toggle' });
		const chevron = toggle.createSpan({ cls: 'so-section-chevron', text: '▾' });
		toggle.createSpan({ cls: 'so-section-title', text: title });

		const headerRight = header.createDiv({ cls: 'so-section-header-right' });
		const searchBtn = headerRight.createEl('button', { cls: 'so-search-icon-btn' });
		setIcon(searchBtn, 'search');

		const body = section.createDiv({ cls: 'so-section-body' });
		const searchInput = body.createEl('input', {
			cls: 'so-search-input so-search-input-hidden',
			attr: { type: 'text', placeholder: `Search ${title.toLowerCase()}…` },
		});

		this.registerDomEvent(toggle, 'click', () => {
			const isOpen = !body.hasClass('so-section-body-hidden');
			body.toggleClass('so-section-body-hidden', isOpen);
			chevron.setText(isOpen ? '▸' : '▾');
		});

		this.registerDomEvent(searchBtn, 'click', (e) => {
			e.stopPropagation();
			const hidden = searchInput.hasClass('so-search-input-hidden');
			searchInput.toggleClass('so-search-input-hidden', !hidden);
			if (hidden) {
				body.removeClass('so-section-body-hidden');
				chevron.setText('▾');
				searchInput.focus();
			} else {
				searchInput.value = '';
				searchInput.dispatchEvent(new Event('input'));
			}
		});

		return { section, body, searchInput, headerRight };
	}

	private async refreshChanges() {
		if (!this.repoPath) return;
		this.isRepo = await isGitRepo(this.repoPath);
		this.allChanges = this.isRepo ? await getChangedFiles(this.repoPath) : [];
		this.updateChangeCounts();
		this.renderChanges(this.changesQuery);
	}

	private updateChangeCounts() {
		this.changesCounts.empty();
		const newCount = this.allChanges.filter((cf) => cf.code.includes('A') || cf.code.includes('?')).length;
		const modCount = this.allChanges.filter((cf) => cf.code.includes('M')).length;
		const delCount = this.allChanges.filter((cf) => cf.code.includes('D')).length;
		if (newCount > 0) this.changesCounts.createSpan({ cls: 'so-count-badge so-count-new', text: String(newCount) });
		if (modCount > 0) this.changesCounts.createSpan({ cls: 'so-count-badge so-count-modified', text: String(modCount) });
		if (delCount > 0) this.changesCounts.createSpan({ cls: 'so-count-badge so-count-deleted', text: String(delCount) });
	}

	private renderChanges(query: string) {
		this.changesContainer.empty();
		const filtered = query.trim()
			? this.allChanges.filter((cf) => cf.file.toLowerCase().includes(query.toLowerCase()))
			: this.allChanges;

		if (filtered.length === 0) {
			const text = query
				? 'No results'
				: this.isRepo
					? 'No changes'
					: 'Not a git repository';
			this.changesContainer.createEl('span', { cls: 'so-changes-empty', text });
			return;
		}
		for (const cf of filtered) this.renderChangeRow(cf);
	}

	private renderChangeRow(cf: ChangedFile) {
		const row = this.changesContainer.createDiv({ cls: 'so-change-row' });

		const badge = row.createSpan({ cls: 'so-change-badge' });
		badge.setText(cf.code.trim());
		if (cf.code.includes('M')) badge.addClass('so-badge-modified');
		else if (cf.code.includes('A') || cf.code.includes('?')) badge.addClass('so-badge-added');
		else if (cf.code.includes('D')) badge.addClass('so-badge-deleted');

		const label = row.createSpan({ cls: 'so-change-file', text: path.basename(cf.file) });
		// Basenames collide across directories — show the relative dir as context.
		const dir = path.dirname(cf.file);
		if (dir && dir !== '.') label.createSpan({ cls: 'so-change-dir', text: ` ${dir}/` });
		row.title = cf.file;

		row.addEventListener('click', () => {
			void (async () => {
				// Guard against races: only the most recent click may render.
				const requestId = ++this.diffRequestId;
				this.changesContainer.querySelectorAll('.so-change-row-active').forEach((el) =>
					el.removeClass('so-change-row-active'),
				);
				row.addClass('so-change-row-active');
				const absPath = path.isAbsolute(cf.file) ? cf.file : path.join(this.repoPath, cf.file);
				this.pathLabel.setText(cf.file + ' (diff)');
				const diff = await getFileDiff(this.repoPath, absPath);
				if (requestId !== this.diffRequestId) return;
				// Destroy the editor before emptying the pane, otherwise its
				// DOM is orphaned without running CodeMirror cleanup.
				this.codePane.destroy();
				renderDiff(this.rightPane, diff);
			})();
		});
	}

	async onClose() {
		this.stopWatching();
		if (this.treeSearchTimer) { window.clearTimeout(this.treeSearchTimer); this.treeSearchTimer = null; }
		this.codePane?.destroy();
	}
}
