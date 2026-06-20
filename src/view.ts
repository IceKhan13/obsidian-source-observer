import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type SourceObserverPlugin from './main';
import { FileTree } from './fileTree';
import { CodePane } from './codePane';
import { getChangedFiles, getFileDiff, renderDiff, ChangedFile } from './gitDiff';

export const VIEW_TYPE = 'source-observer';

interface ElectronRemote {
	dialog: {
		showOpenDialog(opts: Record<string, unknown>): Promise<{ canceled: boolean; filePaths: string[] }>;
	};
}

type ElectronWindow = typeof window & {
	require: (module: 'electron') => { remote: ElectronRemote };
};

export class SourceObserverView extends ItemView {
	plugin: SourceObserverPlugin;
	private fileTree!: FileTree;
	private codePane!: CodePane;
	private rightPane!: HTMLElement;
	private changesContainer!: HTMLElement;
	private changesCounts!: HTMLElement;
	private pathLabel!: HTMLElement;
	private repoPath = '';
	private allChanges: ChangedFile[] = [];
	private watchers: fs.FSWatcher[] = [];
	private refreshTimer: number | null = null;

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
				this.rightPane.empty();
				this.codePane = new CodePane(this.rightPane, this.plugin.settings.fontSize);
				this.codePane.open(filePath);
			},
		);

		treeSearch.addEventListener('input', () => { this.fileTree.search(treeSearch.value); });
		changesSearch.addEventListener('input', () => { this.renderChanges(changesSearch.value); });

		if (this.plugin.settings.lastOpenedPath) {
			this.repoPath = this.plugin.settings.lastOpenedPath;
			await this.fileTree.loadPath(this.repoPath);
			await this.refreshChanges();
			this.startWatching();
		}

		openBtn.addEventListener('click', () => {
			void (async () => {
				const { remote } = (window as ElectronWindow).require('electron');
				const result = await remote.dialog.showOpenDialog({ properties: ['openDirectory'] });
				if (result.canceled || result.filePaths.length === 0) return;
				const dir = result.filePaths[0] as string;
				this.repoPath = dir;
				this.plugin.settings.lastOpenedPath = dir;
				await this.plugin.saveSettings();
				await this.fileTree.loadPath(dir);
				await this.refreshChanges();
				this.startWatching();
			})();
		});
	}

	// Watch .git/index (staged changes) and the repo root (untracked files).
	// Both use a shared debounce so rapid saves don't hammer git.
	private startWatching() {
		this.stopWatching();

		const schedule = () => {
			if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
			this.refreshTimer = window.setTimeout(() => { void this.refreshChanges(); }, 800);
		};

		const gitIndex = path.join(this.repoPath, '.git', 'index');
		try { this.watchers.push(fs.watch(gitIndex, schedule)); } catch { /* not a git repo */ }
		try { this.watchers.push(fs.watch(this.repoPath, schedule)); } catch { /* ignore */ }
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

		toggle.addEventListener('click', () => {
			const isOpen = !body.hasClass('so-section-body-hidden');
			body.toggleClass('so-section-body-hidden', isOpen);
			chevron.setText(isOpen ? '▸' : '▾');
		});

		searchBtn.addEventListener('click', (e) => {
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
		this.allChanges = await getChangedFiles(this.repoPath);
		this.updateChangeCounts();
		this.renderChanges('');
	}

	private updateChangeCounts() {
		this.changesCounts.empty();
		const newCount = this.allChanges.filter((cf) => cf.code.includes('A') || cf.code.includes('?')).length;
		const modCount = this.allChanges.filter((cf) => cf.code.includes('M')).length;
		if (newCount > 0) this.changesCounts.createSpan({ cls: 'so-count-badge so-count-new', text: String(newCount) });
		if (modCount > 0) this.changesCounts.createSpan({ cls: 'so-count-badge so-count-modified', text: String(modCount) });
	}

	private renderChanges(query: string) {
		this.changesContainer.empty();
		const filtered = query.trim()
			? this.allChanges.filter((cf) => cf.file.toLowerCase().includes(query.toLowerCase()))
			: this.allChanges;

		if (filtered.length === 0) {
			this.changesContainer.createEl('span', {
				cls: 'so-changes-empty',
				text: query ? 'No results' : 'No changes',
			});
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

		row.createSpan({ cls: 'so-change-file', text: path.basename(cf.file) });
		row.title = cf.file;

		row.addEventListener('click', () => {
			void (async () => {
				this.changesContainer.querySelectorAll('.so-change-row-active').forEach((el) =>
					el.removeClass('so-change-row-active'),
				);
				row.addClass('so-change-row-active');
				const absPath = path.isAbsolute(cf.file) ? cf.file : path.join(this.repoPath, cf.file);
				this.pathLabel.setText(cf.file + ' (diff)');
				this.rightPane.empty();
				const diff = await getFileDiff(this.repoPath, absPath);
				renderDiff(this.rightPane, diff);
			})();
		});
	}

	async onClose() {
		this.stopWatching();
		this.codePane?.destroy();
	}
}
