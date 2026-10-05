import { Component, setIcon } from 'obsidian';
import { promises as fsp } from 'fs';
import * as path from 'path';
import type { ChangeKind } from '../../git/status';
import { fileIcon } from '../../utils/fileIcons';
import { LatestRequest } from '../../utils/latest';
import { attachListNav, markRow } from './keyboardNav';

interface TreeNode {
	name: string;
	fullPath: string;
	isDir: boolean;
	parent: TreeNode | null;
	expanded: boolean;
	/** Loaded children; undefined until the directory is first expanded. */
	children?: TreeNode[];
	row?: HTMLElement;
	iconEl?: HTMLElement;
	childEl?: HTMLElement;
}

interface Entry { name: string; isDir: boolean }

const INDENT_STEP = 14;
const INDENT_BASE = 6;

/**
 * Lazily expanding directory tree. Refreshing re-reads only directories that
 * have been loaded, keeps expansion state, and re-renders a directory only
 * when its listing actually changed.
 */
export class FileTree {
	private root: TreeNode | null = null;
	private rowNode = new WeakMap<HTMLElement, TreeNode>();
	private byPath = new Map<string, TreeNode>();
	private kinds = new Map<string, ChangeKind>();
	private dirtyDirs = new Set<string>();
	private selectedPath: string | null = null;
	private loadToken = new LatestRequest();

	constructor(
		owner: Component,
		private container: HTMLElement,
		private showHidden: boolean,
		private onSelect: (absPath: string) => void,
		private onContextMenu?: (evt: MouseEvent, absPath: string, isDir: boolean) => void,
	) {
		attachListNav(owner, container, {
			rows: () => this.visibleRows(),
			onActivate: (row) => this.activate(row),
			onExpand: (row) => {
				const node = this.rowNode.get(row);
				if (!node?.isDir) return null;
				if (!node.expanded) {
					void this.toggle(node);
					return row;
				}
				return node.children?.[0]?.row ?? null;
			},
			onCollapse: (row) => {
				const node = this.rowNode.get(row);
				if (!node) return null;
				if (node.isDir && node.expanded) {
					void this.toggle(node);
					return row;
				}
				return node.parent?.row ?? null;
			},
		});
	}

	/** Loads `rootPath` as the new root. */
	async load(rootPath: string) {
		const token = this.loadToken.next();
		this.byPath.clear();
		this.selectedPath = null;
		const entries = await this.readEntries(rootPath);
		if (!this.loadToken.isCurrent(token)) return;
		this.container.empty();
		if (!entries) {
			this.root = null;
			this.container.createDiv({ cls: 'so-empty', text: 'Folder not found' });
			return;
		}
		const root: TreeNode = {
			name: path.basename(rootPath) || rootPath,
			fullPath: rootPath,
			isDir: true,
			parent: null,
			expanded: true,
		};
		root.children = entries.map((e) => this.makeNode(e, root));
		this.root = root;
		this.renderNode(root, this.container, 0);
	}

	/** Re-reads every loaded directory, preserving expansion and selection. */
	async refresh() {
		if (!this.root) return;
		const token = this.loadToken.next();
		await this.refreshNode(this.root, token);
		if (this.loadToken.isCurrent(token)) this.pruneDetached();
	}

	setShowHidden(showHidden: boolean) {
		if (this.showHidden === showHidden) return;
		this.showHidden = showHidden;
		void this.refresh();
	}

	/** Colours files by git status and marks directories containing changes. */
	setDecorations(kinds: Map<string, ChangeKind>, dirtyDirs: Set<string>) {
		this.kinds = kinds;
		this.dirtyDirs = dirtyDirs;
		for (const node of this.byPath.values()) this.decorate(node);
	}

	/** Highlights `absPath` if it is rendered. */
	select(absPath: string | null) {
		if (this.selectedPath) this.byPath.get(this.selectedPath)?.row?.removeClass('is-active');
		this.selectedPath = absPath;
		if (absPath) this.byPath.get(absPath)?.row?.addClass('is-active');
	}

	private makeNode(entry: Entry, parent: TreeNode): TreeNode {
		return {
			name: entry.name,
			fullPath: path.join(parent.fullPath, entry.name),
			isDir: entry.isDir,
			parent,
			expanded: false,
		};
	}

	/** Lists a directory, sorted folders-first; null when it cannot be read. */
	private async readEntries(dirPath: string): Promise<Entry[] | null> {
		let dirents;
		try {
			dirents = await fsp.readdir(dirPath, { withFileTypes: true });
		} catch {
			return null;
		}
		const entries = await Promise.all(
			dirents
				.filter((d) => this.showHidden || !d.name.startsWith('.'))
				.map(async (d): Promise<Entry> => {
					let isDir = d.isDirectory();
					if (d.isSymbolicLink()) {
						try { isDir = (await fsp.stat(path.join(dirPath, d.name))).isDirectory(); } catch { /* dangling link */ }
					}
					return { name: d.name, isDir };
				}),
		);
		return entries.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
	}

	private async refreshNode(node: TreeNode, token: number): Promise<void> {
		if (!node.isDir || !node.children) return;
		const entries = await this.readEntries(node.fullPath);
		if (!this.loadToken.isCurrent(token)) return;
		const fresh = entries ?? [];
		const old = new Map(node.children.map((c) => [`${c.isDir ? 'd' : 'f'}:${c.name}`, c]));
		const next = fresh.map((e) => old.get(`${e.isDir ? 'd' : 'f'}:${e.name}`) ?? this.makeNode(e, node));
		const changed = next.length !== node.children.length || next.some((c, i) => c !== node.children?.[i]);
		node.children = next;
		if (changed && node.childEl) this.renderChildren(node);
		// Collapsed-but-loaded folders are refreshed too, so re-expanding never shows stale entries.
		await Promise.all(next.filter((c) => c.children).map((c) => this.refreshNode(c, token)));
	}

	private renderChildren(node: TreeNode) {
		const el = node.childEl;
		if (!el) return;
		el.empty();
		const depth = this.depthOf(node) + 1;
		for (const child of node.children ?? []) this.renderNode(child, el, depth);
	}

	private depthOf(node: TreeNode): number {
		let depth = 0;
		for (let p = node.parent; p; p = p.parent) depth++;
		return depth;
	}

	private renderNode(node: TreeNode, parent: HTMLElement, depth: number) {
		const row = parent.createDiv({ cls: 'so-tree-row' });
		markRow(row);
		row.setCssProps({ '--so-indent': `${depth * INDENT_STEP + INDENT_BASE}px` });
		row.title = node.fullPath;
		node.row = row;
		this.rowNode.set(row, node);
		this.byPath.set(node.fullPath, node);

		const iconEl = row.createSpan({ cls: 'so-tree-icon' });
		node.iconEl = iconEl;
		row.createSpan({ cls: 'so-tree-label', text: node.name });

		if (node.isDir) {
			row.addClass('so-tree-dir');
			row.setAttr('aria-expanded', String(node.expanded));
			setIcon(iconEl, node.expanded ? 'folder-open' : 'folder');
			iconEl.addClass('so-icon-folder');
			const childEl = parent.createDiv({ cls: 'so-tree-children' });
			childEl.toggleClass('so-hidden', !node.expanded);
			node.childEl = childEl;
			if (node.expanded && node.children) this.renderChildren(node);
		} else {
			row.addClass('so-tree-file');
			const [icon, cls] = fileIcon(node.name);
			setIcon(iconEl, icon);
			iconEl.addClass(cls);
			if (node.fullPath === this.selectedPath) row.addClass('is-active');
		}

		row.addEventListener('click', () => this.activate(row));
		row.addEventListener('contextmenu', (evt) => this.onContextMenu?.(evt, node.fullPath, node.isDir));
		this.decorate(node);
	}

	private decorate(node: TreeNode) {
		const row = node.row;
		if (!row) return;
		row.removeClasses(['so-git-added', 'so-git-modified', 'so-git-deleted', 'so-git-renamed', 'so-git-untracked', 'so-git-conflicted', 'so-git-dirty']);
		if (node.isDir) {
			if (this.dirtyDirs.has(node.fullPath)) row.addClass('so-git-dirty');
		} else {
			const kind = this.kinds.get(node.fullPath);
			if (kind) row.addClass(`so-git-${kind}`);
		}
	}

	private activate(row: HTMLElement) {
		const node = this.rowNode.get(row);
		if (!node) return;
		if (node.isDir) {
			void this.toggle(node);
		} else {
			this.select(node.fullPath);
			this.onSelect(node.fullPath);
		}
	}

	private async toggle(node: TreeNode) {
		node.expanded = !node.expanded;
		node.row?.setAttr('aria-expanded', String(node.expanded));
		if (node.iconEl) setIcon(node.iconEl, node.expanded ? 'folder-open' : 'folder');
		node.childEl?.toggleClass('so-hidden', !node.expanded);
		if (node.expanded && !node.children) {
			const entries = await this.readEntries(node.fullPath);
			if (node.children) return; // a concurrent toggle already loaded it
			node.children = (entries ?? []).map((e) => this.makeNode(e, node));
			this.renderChildren(node);
		}
	}

	private visibleRows(): HTMLElement[] {
		return Array.from(this.container.querySelectorAll<HTMLElement>('[data-so-row]')).filter((r) => r.isShown());
	}

	/** Drops path entries whose rows were removed by a re-render. */
	private pruneDetached() {
		for (const [p, node] of this.byPath) {
			if (!node.row?.isConnected) this.byPath.delete(p);
		}
	}
}
