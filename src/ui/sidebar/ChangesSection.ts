import { Component, setIcon } from 'obsidian';
import type { BaseComparison } from '../../services/BaseComparison';
import type { RepoSnapshot } from '../../services/RepoState';
import {
	badgeFor,
	BranchInfo,
	ChangeEntry,
	ChangeGroup,
	countChanges,
	countKinds,
	groupChanges,
} from '../../git/status';
import { attachListNav, markRow } from './keyboardNav';
import { createSection } from './section';

export interface ChangesSectionOptions {
	onOpenDiff: (entry: ChangeEntry) => void;
	onRefresh: () => void;
	onContextMenu?: (evt: MouseEvent, entry: ChangeEntry) => void;
	/** Selecting the branch line, e.g. to switch worktrees; the line is inert without it. */
	onBranchClick?: (anchor: HTMLElement) => void;
	/** Switches between uncommitted changes and changes against a base branch; no toggle without it. */
	onToggleBase?: () => void;
	/** Selecting the base line, to choose another base branch. */
	onBaseClick?: (anchor: HTMLElement) => void;
}

/** What the section shows in base mode: a comparison, or one being computed. */
export type BaseView = BaseComparison | { kind: 'loading'; ref: string | null };

const GROUPS: { group: ChangeGroup; title: string }[] = [
	{ group: 'conflicts', title: 'Merge conflicts' },
	{ group: 'staged', title: 'Staged' },
	{ group: 'unstaged', title: 'Changes' },
];

function entryKey(entry: ChangeEntry): string {
	return `${entry.group}\0${entry.file.path}`;
}

/**
 * The "Changes" sidebar section. It is rebuilt from each repository
 * snapshot, but selection, keyboard focus and scroll position are keyed by
 * path and restored, so periodic refreshes are invisible to the user.
 */
export class ChangesSection extends Component {
	private listEl: HTMLElement;
	private branchEl: HTMLElement;
	private countsEl: HTMLElement;
	private searchInput: HTMLInputElement;
	private snapshot: RepoSnapshot = { kind: 'none' };
	private selectedKey: string | null = null;
	/** Worktrees of the repository; a badge is shown when there is more than one. */
	private worktreeCount = 0;
	private baseEl: HTMLElement;
	private baseToggle: HTMLElement | null = null;
	/** Base mode state, or null when showing uncommitted changes. */
	private base: BaseView | null = null;

	constructor(parent: HTMLElement, private opts: ChangesSectionOptions) {
		super();
		const { body, searchInput, headerRight } = createSection(this, parent, 'Changes');
		this.searchInput = searchInput;

		this.countsEl = headerRight.createDiv({ cls: 'so-section-counts' });
		headerRight.prepend(this.countsEl);
		const onToggleBase = opts.onToggleBase;
		if (onToggleBase) {
			const toggle = headerRight.createEl('button', { cls: 'clickable-icon so-icon-btn so-base-toggle' });
			setIcon(toggle, 'git-compare');
			this.registerDomEvent(toggle, 'click', (e) => {
				e.stopPropagation();
				onToggleBase();
			});
			this.baseToggle = toggle;
		}
		const refreshBtn = headerRight.createEl('button', {
			cls: 'clickable-icon so-icon-btn',
			attr: { 'aria-label': 'Refresh' },
		});
		setIcon(refreshBtn, 'refresh-cw');
		this.registerDomEvent(refreshBtn, 'click', (e) => {
			e.stopPropagation();
			opts.onRefresh();
		});

		this.branchEl = body.createDiv({ cls: 'so-branch so-hidden' });
		const onBranchClick = opts.onBranchClick;
		if (onBranchClick) {
			this.branchEl.addClass('so-branch-clickable');
			this.branchEl.setAttr('role', 'button');
			this.branchEl.setAttr('tabindex', '0');
			this.branchEl.setAttr('aria-haspopup', 'menu');
			this.registerDomEvent(this.branchEl, 'click', () => onBranchClick(this.branchEl));
			this.registerDomEvent(this.branchEl, 'keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onBranchClick(this.branchEl);
				}
			});
		}
		this.baseEl = body.createDiv({ cls: 'so-branch so-base so-hidden' });
		const onBaseClick = opts.onBaseClick;
		if (onBaseClick) {
			this.baseEl.addClass('so-branch-clickable');
			this.baseEl.setAttr('role', 'button');
			this.baseEl.setAttr('tabindex', '0');
			this.baseEl.setAttr('aria-haspopup', 'menu');
			this.registerDomEvent(this.baseEl, 'click', () => onBaseClick(this.baseEl));
			this.registerDomEvent(this.baseEl, 'keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onBaseClick(this.baseEl);
				}
			});
		}
		this.listEl = body.createDiv({ cls: 'so-changes so-scroll' });

		attachListNav(this, this.listEl, {
			rows: () => Array.from(this.listEl.querySelectorAll<HTMLElement>('[data-so-row]')),
			onActivate: (row) => row.click(),
		});
		this.registerDomEvent(searchInput, 'input', () => this.render());
	}

	/** The branch line, used to position the worktree menu; null while it is hidden. */
	branchAnchor(): HTMLElement | null {
		return this.branchEl.isShown() ? this.branchEl : null;
	}

	/** Shows how many worktrees the repository has next to the branch name. */
	setWorktreeCount(count: number) {
		if (count === this.worktreeCount) return;
		this.worktreeCount = count;
		this.renderBranch(this.snapshot.kind === 'repo' ? this.snapshot.status.branch : null);
	}

	/** Shows changes against a base branch, or uncommitted changes for null. */
	setBase(base: BaseView | null) {
		if (!base !== !this.base) this.selectedKey = null;
		this.base = base;
		this.render();
	}

	update(snapshot: RepoSnapshot) {
		const folderOf = (s: RepoSnapshot) => (s.kind === 'none' ? '' : s.folder);
		// A selection only makes sense within the folder it was made in.
		if (folderOf(snapshot) !== folderOf(this.snapshot)) {
			this.selectedKey = null;
			this.worktreeCount = 0;
		}
		this.snapshot = snapshot;
		this.render();
	}

	private render() {
		const snapshot = this.snapshot;
		const base = snapshot.kind === 'repo' ? this.base : null;
		this.renderBranch(snapshot.kind === 'repo' ? snapshot.status.branch : null);
		this.renderBase(base);
		this.renderCounts(snapshot, base);

		// Remember what to restore after rebuilding.
		const scrollTop = this.listEl.scrollTop;
		const active = this.listEl.doc.activeElement as HTMLElement | null;
		const focusedKey = active?.closest<HTMLElement>('[data-so-row]')?.dataset.key;
		const hadFocus = !!focusedKey && this.listEl.contains(active);

		this.listEl.empty();

		if (snapshot.kind !== 'repo') {
			const text = {
				'none': 'Open a folder to see changes',
				'missing-folder': 'Folder not found',
				'no-git': 'Git is not installed or not on PATH',
				'not-repo': 'Not a git repository',
			}[snapshot.kind];
			this.listEl.createDiv({ cls: 'so-empty', text });
			return;
		}

		if (base && base.kind !== 'ok') {
			const text = base.kind === 'loading' ? 'Comparing…' : base.message;
			this.listEl.createDiv({ cls: base.kind === 'error' ? 'so-empty so-base-error' : 'so-empty', text });
			return;
		}

		const query = this.searchInput.value.trim().toLowerCase();
		const entries = (base ? base.entries : groupChanges(snapshot.status.files))
			.filter((e) => !query || e.file.path.toLowerCase().includes(query));

		if (entries.length === 0) {
			const none = base ? `No changes against ${base.ref}` : 'No changes';
			this.listEl.createDiv({ cls: 'so-empty', text: query ? 'No results' : none });
			return;
		}

		const repo = snapshot.repo;
		if (base) {
			for (const entry of entries) this.renderRow(entry, repo.toFolderRelative(entry.file.path));
		}
		for (const { group, title } of base ? [] : GROUPS) {
			const inGroup = entries.filter((e) => e.group === group);
			if (inGroup.length === 0) continue;
			const header = this.listEl.createDiv({ cls: 'so-group-header' });
			header.createSpan({ text: title });
			header.createSpan({ cls: 'so-group-count', text: String(inGroup.length) });
			for (const entry of inGroup) this.renderRow(entry, repo.toFolderRelative(entry.file.path));
		}

		this.listEl.scrollTop = scrollTop;
		if (hadFocus && focusedKey) {
			const row = this.listEl.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusedKey)}"]`);
			if (row) {
				row.tabIndex = 0;
				row.focus({ preventScroll: true });
			}
		}
	}

	private renderRow(entry: ChangeEntry, relPath: string) {
		const key = entryKey(entry);
		const row = this.listEl.createDiv({ cls: 'so-change-row' });
		markRow(row);
		row.dataset.key = key;
		if (key === this.selectedKey) row.addClass('is-active');

		row.createSpan({ cls: `so-change-badge so-kind-${entry.kind}`, text: badgeFor(entry.kind) });
		const slash = relPath.lastIndexOf('/');
		const label = row.createSpan({ cls: 'so-change-file', text: relPath.slice(slash + 1) });
		if (slash > 0) label.createSpan({ cls: 'so-row-context', text: ` ${relPath.slice(0, slash)}` });
		if (entry.kind === 'deleted') label.addClass('so-change-file-deleted');

		row.title = entry.file.origPath ? `${entry.file.origPath} → ${entry.file.path}` : entry.file.path;

		row.addEventListener('click', () => {
			this.selectedKey = key;
			this.listEl.querySelectorAll('.is-active').forEach((el) => el.removeClass('is-active'));
			row.addClass('is-active');
			this.opts.onOpenDiff(entry);
		});
		row.addEventListener('contextmenu', (evt) => this.opts.onContextMenu?.(evt, entry));
	}

	private renderBranch(branch: BranchInfo | null) {
		this.branchEl.empty();
		this.branchEl.toggleClass('so-hidden', !branch);
		if (!branch) return;
		const icon = this.branchEl.createSpan({ cls: 'so-branch-icon' });
		setIcon(icon, 'git-branch');
		const name = branch.head ?? (branch.oid ? `detached at ${branch.oid.slice(0, 7)}` : 'no commits yet');
		this.branchEl.createSpan({ cls: 'so-branch-name', text: name });
		if (branch.upstream) {
			if (branch.ahead) this.branchEl.createSpan({ cls: 'so-branch-ab', text: `↑${branch.ahead}` });
			if (branch.behind) this.branchEl.createSpan({ cls: 'so-branch-ab', text: `↓${branch.behind}` });
			this.branchEl.title = `${name} → ${branch.upstream}` +
				(branch.ahead || branch.behind ? ` (${branch.ahead} ahead, ${branch.behind} behind)` : ' (up to date)');
		} else {
			this.branchEl.title = branch.head ? `${name} (no upstream)` : name;
		}
		if (!this.opts.onBranchClick) return;
		if (this.worktreeCount > 1) {
			const badge = this.branchEl.createSpan({
				cls: 'so-branch-worktrees',
				attr: { 'aria-label': `${this.worktreeCount} worktrees` },
			});
			setIcon(badge.createSpan({ cls: 'so-branch-worktrees-icon' }), 'git-fork');
			badge.createSpan({ text: String(this.worktreeCount) });
		}
		setIcon(this.branchEl.createSpan({ cls: 'so-branch-chevron' }), 'chevron-down');
		this.branchEl.title += this.worktreeCount > 1
			? `\n${this.worktreeCount} worktrees — select to switch`
			: '\nSelect to show worktrees';
	}

	/** The "Against <branch> · N commits" line shown in base mode. */
	private renderBase(base: BaseView | null) {
		const on = !!base;
		if (this.baseToggle) {
			this.baseToggle.toggleClass('is-active', on);
			this.baseToggle.setAttr('aria-pressed', String(on));
			this.baseToggle.setAttr('aria-label', on ? 'Show uncommitted changes' : 'Compare with base branch');
		}
		this.baseEl.empty();
		this.baseEl.toggleClass('so-hidden', !base);
		if (!base) return;
		setIcon(this.baseEl.createSpan({ cls: 'so-branch-icon' }), 'git-compare');
		this.baseEl.createSpan({ cls: 'so-base-label', text: 'Against' });
		this.baseEl.createSpan({ cls: 'so-branch-name', text: base.ref ?? 'no base branch' });
		if (base.kind === 'ok') {
			const commits = base.ahead === 1 ? '1 commit' : `${base.ahead} commits`;
			this.baseEl.createSpan({ cls: 'so-base-ahead', text: commits });
			this.baseEl.title = `Changes since ${base.ref} at ${base.commit.slice(0, 7)}: ${commits} plus uncommitted changes`;
		} else {
			this.baseEl.title = base.ref ?? '';
		}
		if (this.opts.onBaseClick) {
			setIcon(this.baseEl.createSpan({ cls: 'so-branch-chevron' }), 'chevron-down');
			this.baseEl.title += '\nSelect to choose another base branch';
		}
	}

	private renderCounts(snapshot: RepoSnapshot, base: BaseView | null) {
		this.countsEl.empty();
		if (snapshot.kind !== 'repo') return;
		const counts = base ? countKinds(base.kind === 'ok' ? base.entries.map((e) => e.kind) : []) : countChanges(snapshot.status.files);
		const badge = (n: number, cls: string, label: string) => {
			if (n > 0) this.countsEl.createSpan({ cls: `so-count-badge ${cls}`, text: String(n), attr: { 'aria-label': label } });
		};
		badge(counts.conflicted, 'so-kind-conflicted', 'Conflicts');
		badge(counts.added, 'so-kind-added', 'New');
		badge(counts.modified, 'so-kind-modified', 'Modified');
		badge(counts.deleted, 'so-kind-deleted', 'Deleted');
	}
}
