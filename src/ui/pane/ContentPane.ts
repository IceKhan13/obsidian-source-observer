import { Component, setIcon } from 'obsidian';
import * as path from 'path';
import type { GitRepo } from '../../git/GitRepo';
import type { ChangeEntry, ChangeGroup } from '../../git/status';
import { loadDiffSides } from '../../git/diffSources';
import { formatBytes, LoadedContent, readViewableFile } from '../../utils/content';
import { LatestRequest } from '../../utils/latest';
import type { LineRange } from '../../links/sourceLink';
import type { DiffLayout } from '../../settings';
import { CodeRenderer, DiffRenderer, EditorSelectionInfo, MessageRenderer, PaneRenderer } from './renderers';

export type PaneTarget =
	| { type: 'file'; absPath: string; label: string; lines: LineRange | null }
	| { type: 'diff'; repo: GitRepo; entry: ChangeEntry; label: string };

interface PaneAction { icon: string; label: string; run: (evt: MouseEvent) => void }

export interface ContentPaneOptions {
	fontSize: number;
	diffLayout?: DiffLayout;
	/** Called when the user switches the diff layout from the header. */
	onDiffLayoutChange?: (layout: DiffLayout) => void;
	/** Shows the copy-link menu for the open file; the header button is hidden without it. */
	onLinkMenu?: (evt: MouseEvent) => void;
}

const GROUP_LABEL: Record<ChangeGroup, string> = {
	staged: 'staged',
	unstaged: 'working tree',
	conflicts: 'conflict',
};

/** What to render once a target's data has loaded. */
type Plan =
	| { kind: 'code'; text: string; fileName: string }
	| { kind: 'diff'; original: string; modified: string; fileName: string; worktreePath: string | null }
	| { kind: 'message'; icon: string; text: string; detail?: string };

/** Turns a non-text load result into a message, or returns null for text/missing. */
function contentProblem(content: LoadedContent, what: string): Plan | null {
	switch (content.kind) {
		case 'binary':
			return { kind: 'message', icon: 'file-x', text: `Binary ${what}`, detail: formatBytes(content.size) };
		case 'too-large':
			return { kind: 'message', icon: 'file-warning', text: `${what} is too large to display`, detail: formatBytes(content.size) };
		case 'error':
			return { kind: 'message', icon: 'alert-triangle', text: `Cannot read ${what}`, detail: content.message };
		default:
			return null;
	}
}

function textOf(content: LoadedContent): string {
	return content.kind === 'text' ? content.text : '';
}

/**
 * Owns the right-hand pane: a header (path, stats, actions) and exactly one
 * renderer below it. Every load goes through a single "latest wins" token,
 * so a slow file or diff can never overwrite a newer selection, and the
 * header is only updated together with the content it describes.
 */
export class ContentPane extends Component {
	private headerEl: HTMLElement;
	private labelEl: HTMLElement;
	private statsEl: HTMLElement;
	private actionsEl: HTMLElement;
	private bodyEl: HTMLElement;
	private current: PaneRenderer | null = null;
	private target: PaneTarget | null = null;
	/** Loaded data for `target`, kept so a layout change can re-render without reloading. */
	private plan: Plan | null = null;
	private latest = new LatestRequest();
	/** Identity of what is currently rendered, used to skip no-op reloads. */
	private signature = '';

	private fontSize: number;
	private diffLayout: DiffLayout;

	constructor(parent: HTMLElement, private opts: ContentPaneOptions) {
		super();
		this.fontSize = opts.fontSize;
		this.diffLayout = opts.diffLayout ?? 'unified';
		this.headerEl = parent.createDiv({ cls: 'so-pane-header' });
		this.labelEl = this.headerEl.createDiv({ cls: 'so-path-label' });
		this.statsEl = this.headerEl.createDiv({ cls: 'so-pane-stats' });
		this.actionsEl = this.headerEl.createDiv({ cls: 'so-pane-actions' });
		this.bodyEl = parent.createDiv({ cls: 'so-pane' });
	}

	onload() {
		this.showPlaceholder();
	}

	/** Shows the "nothing selected" state and cancels pending loads. */
	showPlaceholder(text = 'Select a file or change to view it') {
		this.latest.cancel();
		this.target = null;
		this.plan = null;
		this.signature = '';
		this.headerEl.removeClass('so-pane-loading');
		this.setHeader('', null, []);
		this.mount(new MessageRenderer(this.bodyEl, 'code-2', text));
	}

	/** Shows a file, highlighting and scrolling to `lines` if given. */
	showFile(absPath: string, label: string, lines: LineRange | null = null) {
		return this.show({ type: 'file', absPath, label, lines });
	}

	/** The file shown as code (not a diff) and its selection, for links. */
	currentFile(): { absPath: string; selection: EditorSelectionInfo } | null {
		if (this.target?.type !== 'file' || !(this.current instanceof CodeRenderer)) return null;
		const selection = this.current.selection();
		return selection ? { absPath: this.target.absPath, selection } : null;
	}

	showDiff(repo: GitRepo, entry: ChangeEntry, label: string) {
		return this.show({ type: 'diff', repo, entry, label });
	}

	/** Re-loads whatever is currently shown, e.g. after the file changed on disk. */
	reload() {
		if (this.target) void this.show(this.target, true);
	}

	setFontSize(fontSize: number) {
		this.fontSize = fontSize;
		this.current?.setFontSize(fontSize);
	}

	/** Switches between unified and side-by-side diffs, re-rendering an open diff. */
	setDiffLayout(layout: DiffLayout) {
		if (this.diffLayout === layout) return;
		this.diffLayout = layout;
		if (this.target && this.plan?.kind === 'diff') {
			this.signature = '';
			this.render(this.target, this.plan, false);
		}
	}

	/** True when a file or diff is shown, so find and go-to-line apply. */
	hasEditor(): boolean {
		return !!this.current?.editor();
	}

	/** Opens the find panel in the shown file or diff. */
	openSearch(): boolean {
		return this.current?.openSearch() ?? false;
	}

	/** Opens the go-to-line prompt in the shown file or diff. */
	goToLine(): boolean {
		return this.current?.goToLine() ?? false;
	}

	private async show(target: PaneTarget, keepScroll = false) {
		const token = this.latest.next();
		this.target = target;
		if (!keepScroll) this.headerEl.addClass('so-pane-loading');
		let plan: Plan;
		try {
			plan = await this.loadPlan(target);
		} catch (err) {
			plan = { kind: 'message', icon: 'alert-triangle', text: 'Failed to load', detail: String(err) };
		}
		if (!this.latest.isCurrent(token)) return;
		this.headerEl.removeClass('so-pane-loading');
		this.render(target, plan, keepScroll);
	}

	private async loadPlan(target: PaneTarget): Promise<Plan> {
		const fileName = path.basename(target.type === 'file' ? target.absPath : target.entry.file.path);

		if (target.type === 'file') {
			const content = await readViewableFile(target.absPath);
			if (content.kind === 'missing') return { kind: 'message', icon: 'file-question', text: 'File not found' };
			return contentProblem(content, 'file') ?? { kind: 'code', text: textOf(content), fileName };
		}

		const { repo, entry } = target;
		const { original, modified } = await loadDiffSides(repo, entry);
		const problem = contentProblem(original, 'file') ?? contentProblem(modified, 'file');
		if (problem) return problem;
		const before = textOf(original);
		const after = textOf(modified);
		if (before === after) {
			return { kind: 'message', icon: 'check', text: 'No textual changes', detail: 'Both versions have identical content' };
		}
		const worktreePath = entry.group !== 'staged' && modified.kind === 'text' ? repo.absPath(entry.file.path) : null;
		return { kind: 'diff', original: before, modified: after, fileName, worktreePath };
	}

	private render(target: PaneTarget, plan: Plan, keepScroll: boolean) {
		const suffix = target.type === 'diff' ? ` (${GROUP_LABEL[target.entry.group]})` : '';
		const label = target.label + suffix;

		// Background reloads are frequent; leave the view untouched if nothing changed.
		const signature = [label, ...Object.values(plan).map(String)].join('\0');
		if (keepScroll && signature === this.signature) return;
		this.signature = signature;
		this.plan = plan;

		const find: PaneAction = { icon: 'search', label: 'Find in file', run: () => { this.openSearch(); } };

		if (plan.kind === 'code') {
			const actions: PaneAction[] = [];
			const onLinkMenu = this.opts.onLinkMenu;
			if (onLinkMenu) actions.push({ icon: 'link', label: 'Copy link', run: onLinkMenu });
			actions.push(find);
			this.setHeader(label, null, actions);
			const lines = target.type === 'file' ? target.lines : null;
			// Reuse the editor between files instead of rebuilding it.
			if (this.current instanceof CodeRenderer) {
				this.current.setDocument(plan.text, plan.fileName, keepScroll, lines);
			} else {
				const code = new CodeRenderer(this.bodyEl, this.fontSize);
				this.mount(code);
				code.setDocument(plan.text, plan.fileName, false, lines);
			}
			return;
		}

		if (plan.kind === 'diff') {
			const layout = this.diffLayout;
			const diff = new DiffRenderer(this.bodyEl, this.fontSize, plan.original, plan.modified, plan.fileName, layout);
			this.mount(diff);
			const next: DiffLayout = layout === 'split' ? 'unified' : 'split';
			const actions: PaneAction[] = [
				{
					icon: next === 'split' ? 'columns-2' : 'rows-2',
					label: next === 'split' ? 'Show side by side' : 'Show unified',
					run: () => {
						this.setDiffLayout(next);
						this.opts.onDiffLayoutChange?.(next);
					},
				},
				find,
			];
			const worktreePath = plan.worktreePath;
			if (worktreePath && target.type === 'diff') {
				actions.push({
					icon: 'file-text',
					label: 'Open file',
					run: () => { void this.showFile(worktreePath, target.label); },
				});
			}
			this.setHeader(label, diff.stats(), actions);
			return;
		}

		this.setHeader(label, null, []);
		this.mount(new MessageRenderer(this.bodyEl, plan.icon, plan.text, plan.detail));
	}

	/**
	 * Replaces the current renderer. Unloading the old one removes its element
	 * and frees its editor; the new renderer has already attached its own.
	 */
	private mount(renderer: PaneRenderer) {
		if (this.current) this.removeChild(this.current);
		this.current = this.addChild(renderer);
	}

	private setHeader(
		label: string,
		stats: { added: number; removed: number } | null,
		actions: PaneAction[],
	) {
		this.labelEl.setText(label);
		this.labelEl.title = label;
		this.statsEl.empty();
		if (stats) {
			this.statsEl.createSpan({ cls: 'so-stat-added', text: `+${stats.added}` });
			this.statsEl.createSpan({ cls: 'so-stat-removed', text: `−${stats.removed}` });
		}
		this.actionsEl.empty();
		for (const action of actions) {
			const btn = this.actionsEl.createEl('button', {
				cls: 'clickable-icon so-pane-action',
				attr: { 'aria-label': action.label },
			});
			setIcon(btn, action.icon);
			btn.addEventListener('click', (evt) => action.run(evt));
		}
	}
}
