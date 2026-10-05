import { Component, setIcon } from 'obsidian';
import type { RepoSnapshot } from '../../services/RepoState';
import {
	badgeFor,
	BranchInfo,
	ChangeEntry,
	ChangeGroup,
	countChanges,
	groupChanges,
} from '../../git/status';
import { attachListNav, markRow } from './keyboardNav';
import { createSection } from './section';

export interface ChangesSectionOptions {
	onOpenDiff: (entry: ChangeEntry) => void;
	onRefresh: () => void;
	onContextMenu?: (evt: MouseEvent, entry: ChangeEntry) => void;
}

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

	constructor(parent: HTMLElement, private opts: ChangesSectionOptions) {
		super();
		const { body, searchInput, headerRight } = createSection(this, parent, 'Changes');
		this.searchInput = searchInput;

		this.countsEl = headerRight.createDiv({ cls: 'so-section-counts' });
		headerRight.prepend(this.countsEl);
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
		this.listEl = body.createDiv({ cls: 'so-changes so-scroll' });

		attachListNav(this, this.listEl, {
			rows: () => Array.from(this.listEl.querySelectorAll<HTMLElement>('[data-so-row]')),
			onActivate: (row) => row.click(),
		});
		this.registerDomEvent(searchInput, 'input', () => this.render());
	}

	update(snapshot: RepoSnapshot) {
		const folderOf = (s: RepoSnapshot) => (s.kind === 'none' ? '' : s.folder);
		// A selection only makes sense within the folder it was made in.
		if (folderOf(snapshot) !== folderOf(this.snapshot)) this.selectedKey = null;
		this.snapshot = snapshot;
		this.render();
	}

	private render() {
		const snapshot = this.snapshot;
		this.renderBranch(snapshot.kind === 'repo' ? snapshot.status.branch : null);
		this.renderCounts(snapshot);

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

		const query = this.searchInput.value.trim().toLowerCase();
		const entries = groupChanges(snapshot.status.files)
			.filter((e) => !query || e.file.path.toLowerCase().includes(query));

		if (entries.length === 0) {
			this.listEl.createDiv({ cls: 'so-empty', text: query ? 'No results' : 'No changes' });
			return;
		}

		const repo = snapshot.repo;
		for (const { group, title } of GROUPS) {
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
	}

	private renderCounts(snapshot: RepoSnapshot) {
		this.countsEl.empty();
		if (snapshot.kind !== 'repo') return;
		const counts = countChanges(snapshot.status.files);
		const badge = (n: number, cls: string, label: string) => {
			if (n > 0) this.countsEl.createSpan({ cls: `so-count-badge ${cls}`, text: String(n), attr: { 'aria-label': label } });
		};
		badge(counts.conflicted, 'so-kind-conflicted', 'Conflicts');
		badge(counts.added, 'so-kind-added', 'New');
		badge(counts.modified, 'so-kind-modified', 'Modified');
		badge(counts.deleted, 'so-kind-deleted', 'Deleted');
	}
}
