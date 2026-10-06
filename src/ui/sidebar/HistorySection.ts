import { Component, setIcon } from 'obsidian';
import * as path from 'path';
import type { GitRepo } from '../../git/GitRepo';
import type { FileCommit } from '../../git/history';
import { fileIcon } from '../../utils/fileIcons';
import { LatestRequest } from '../../utils/latest';
import { formatDateTime, formatRelativeTime } from '../../utils/time';
import { attachListNav, markRow } from './keyboardNav';
import { createSectionShell } from './section';

/** Maximum number of commits listed for a file. */
export const HISTORY_LIMIT = 300;

export interface HistorySectionOptions {
	/** Opens the change `commit` made to the file at `absPath`, labelled `label`. */
	onOpenCommit: (repo: GitRepo, commit: FileCommit, absPath: string, label: string) => void;
}

/**
 * The "History" sidebar section: commits that changed the file shown in the
 * content pane, newest first. It follows the pane and only runs `git log`
 * while expanded.
 */
export class HistorySection extends Component {
	private fileEl: HTMLElement;
	private listEl: HTMLElement;
	private setCollapsed: (collapsed: boolean) => void;
	private isCollapsed: () => boolean;
	private repo: GitRepo | null = null;
	private absPath: string | null = null;
	/** Commits for the current file, or null until loaded. */
	private commits: FileCommit[] | null = null;
	private selectedHash: string | null = null;
	private latest = new LatestRequest();
	/** Identity of the list on screen, so refreshes that change nothing are skipped. */
	private shownKey = '';

	constructor(parent: HTMLElement, private opts: HistorySectionOptions) {
		super();
		const shell = createSectionShell(this, parent, 'History', {
			collapsed: true,
			onToggle: (collapsed) => { if (!collapsed) void this.loadHistory(); },
		});
		this.setCollapsed = shell.setCollapsed;
		this.isCollapsed = shell.isCollapsed;
		this.fileEl = shell.body.createDiv({ cls: 'so-history-file so-hidden' });
		this.listEl = shell.body.createDiv({ cls: 'so-changes so-scroll so-history' });
		attachListNav(this, this.listEl, {
			rows: () => Array.from(this.listEl.querySelectorAll<HTMLElement>('[data-so-row]')),
			onActivate: (row) => row.click(),
		});
		this.renderList();
	}

	/** Expands the section, showing the history of the current file. */
	expand() {
		this.setCollapsed(false);
	}

	setRepo(repo: GitRepo | null) {
		if ((repo?.gitDir ?? '') === (this.repo?.gitDir ?? '') && repo?.folder === this.repo?.folder) return;
		this.repo = repo;
		void this.loadHistory();
	}

	/** Follows the file shown in the pane; null clears the list. */
	setFile(absPath: string | null) {
		if (absPath === this.absPath) return;
		this.absPath = absPath;
		this.selectedHash = null;
		this.commits = null;
		void this.loadHistory();
	}

	/** Highlights the commit with `hash` if it is listed. */
	selectCommit(hash: string) {
		this.selectedHash = hash;
		for (const row of Array.from(this.listEl.querySelectorAll<HTMLElement>('[data-hash]'))) {
			row.toggleClass('is-active', row.dataset.hash === hash);
		}
	}

	/** Re-reads the history, e.g. after a commit; a no-op while collapsed. */
	refresh() {
		void this.loadHistory();
	}

	private relPath(): string {
		if (!this.repo || !this.absPath) return '';
		return path.relative(this.repo.folder, this.absPath).split(path.sep).join('/');
	}

	private async loadHistory() {
		const token = this.latest.next();
		this.renderFile();
		const repo = this.repo;
		const repoPath = repo && this.absPath ? repo.repoPath(this.absPath) : null;
		if (this.isCollapsed() && repoPath) {
			// Load when expanded; meanwhile the old list is stale.
			this.commits = null;
			this.renderList();
			return;
		}
		const commits = repo && repoPath ? await repo.fileHistory(repoPath, HISTORY_LIMIT) : [];
		if (!this.latest.isCurrent(token)) return;
		this.commits = commits;
		this.renderList();
	}

	private renderFile() {
		this.fileEl.empty();
		const rel = this.relPath();
		this.fileEl.toggleClass('so-hidden', !rel);
		if (!rel) return;
		const name = rel.slice(rel.lastIndexOf('/') + 1);
		const iconEl = this.fileEl.createSpan({ cls: 'so-tree-icon' });
		const [icon, cls] = fileIcon(name);
		setIcon(iconEl, icon);
		iconEl.addClass(cls);
		this.fileEl.createSpan({ cls: 'so-history-file-name', text: name });
		this.fileEl.title = rel;
	}

	private renderList() {
		const repo = this.repo;
		const commits = this.commits;
		const key = JSON.stringify([repo?.gitDir ?? '', this.absPath, commits?.map((c) => c.hash) ?? null]);
		if (key === this.shownKey) return;
		this.shownKey = key;
		const scrollTop = this.listEl.scrollTop;
		this.listEl.empty();

		if (!repo || !this.absPath) {
			const text = !this.absPath ? 'Open a file to see its history' : 'Not a git repository';
			this.listEl.createDiv({ cls: 'so-empty', text });
			return;
		}
		if (!commits) return;
		if (commits.length === 0) {
			this.listEl.createDiv({ cls: 'so-empty', text: 'No commits for this file' });
			return;
		}
		const now = Date.now() / 1000;
		for (const commit of commits) this.renderRow(repo, commit, now);
		if (commits.length >= HISTORY_LIMIT) {
			this.listEl.createDiv({ cls: 'so-hint', text: `Showing the latest ${HISTORY_LIMIT} commits` });
		}
		this.listEl.scrollTop = scrollTop;
	}

	private renderRow(repo: GitRepo, commit: FileCommit, now: number) {
		const absPath = this.absPath ?? '';
		const label = this.relPath();
		const row = this.listEl.createDiv({ cls: 'so-change-row so-commit-row' });
		markRow(row);
		row.dataset.hash = commit.hash;
		if (commit.hash === this.selectedHash) row.addClass('is-active');
		row.createDiv({ cls: 'so-commit-subject', text: commit.subject || '(no message)' });
		const meta = row.createDiv({ cls: 'so-commit-meta' });
		meta.createSpan({ cls: 'so-commit-hash', text: commit.short });
		meta.createSpan({ text: ` · ${commit.author} · ${formatRelativeTime(commit.time, now)}` });
		const renamed = commit.origPath ? `\nRenamed from ${commit.origPath}` : '';
		row.title = `${commit.subject}\n${commit.short} · ${commit.author} <${commit.email}> · ${formatDateTime(commit.time)}${renamed}`;
		row.addEventListener('click', () => {
			this.selectCommit(commit.hash);
			this.opts.onOpenCommit(repo, commit, absPath, label);
		});
	}
}
