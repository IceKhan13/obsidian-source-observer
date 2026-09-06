import { promises as fsp } from 'fs';
import * as path from 'path';
import { setIcon } from 'obsidian';

interface TreeNode {
	name: string;
	fullPath: string;
	isDir: boolean;
	children?: TreeNode[];
	expanded?: boolean;
}

/** Maximum number of search results before showing a "more results" hint. */
export const SEARCH_RESULTS_CAP = 200;

// [lucide icon name, css colour class]
const EXT_ICON: Record<string, [string, string]> = {
	ts:    ['file-code-2', 'so-icon-ts'],
	tsx:   ['file-code-2', 'so-icon-ts'],
	js:    ['file-code-2', 'so-icon-js'],
	jsx:   ['file-code-2', 'so-icon-js'],
	mjs:   ['file-code-2', 'so-icon-js'],
	cjs:   ['file-code-2', 'so-icon-js'],
	py:    ['file-code-2', 'so-icon-py'],
	rs:    ['file-code-2', 'so-icon-rs'],
	go:    ['file-code-2', 'so-icon-go'],
	rb:    ['file-code-2', 'so-icon-rb'],
	java:  ['file-code-2', 'so-icon-java'],
	c:     ['file-code-2', 'so-icon-c'],
	cpp:   ['file-code-2', 'so-icon-c'],
	cs:    ['file-code-2', 'so-icon-c'],
	css:   ['paintbrush',  'so-icon-css'],
	scss:  ['paintbrush',  'so-icon-css'],
	less:  ['paintbrush',  'so-icon-css'],
	html:  ['code',        'so-icon-html'],
	htm:   ['code',        'so-icon-html'],
	xml:   ['code',        'so-icon-html'],
	vue:   ['code',        'so-icon-vue'],
	svelte:['code',        'so-icon-svelte'],
	json:  ['braces',      'so-icon-json'],
	jsonc: ['braces',      'so-icon-json'],
	yaml:  ['braces',      'so-icon-json'],
	yml:   ['braces',      'so-icon-json'],
	toml:  ['braces',      'so-icon-json'],
	md:    ['file-text',   'so-icon-md'],
	mdx:   ['file-text',   'so-icon-md'],
	txt:   ['file-text',   'so-icon-txt'],
	sh:    ['terminal',    'so-icon-sh'],
	bash:  ['terminal',    'so-icon-sh'],
	zsh:   ['terminal',    'so-icon-sh'],
	fish:  ['terminal',    'so-icon-sh'],
	env:   ['lock',        'so-icon-env'],
	png:   ['image',       'so-icon-img'],
	jpg:   ['image',       'so-icon-img'],
	jpeg:  ['image',       'so-icon-img'],
	gif:   ['image',       'so-icon-img'],
	svg:   ['image',       'so-icon-img'],
	webp:  ['image',       'so-icon-img'],
	ico:   ['image',       'so-icon-img'],
	php:   ['file-code-2', 'so-icon-php'],
};

function fileIcon(name: string): [string, string] {
	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	return EXT_ICON[ext] ?? ['file', 'so-icon-default'];
}

/** Renders a lazy-expanding directory tree and notifies the caller when a file is selected. */
export class FileTree {
	private container: HTMLElement;
	private showHidden: boolean;
	private onSelect: (filePath: string) => void;
	private rootPath = '';
	private treeRoot: TreeNode | null = null;
	private searchSeq = 0;

	constructor(
		container: HTMLElement,
		showHidden: boolean,
		onSelect: (filePath: string) => void,
	) {
		this.container = container;
		this.showHidden = showHidden;
		this.onSelect = onSelect;
	}

	/** Updates hidden-file visibility and re-renders if the value changed. */
	setShowHidden(showHidden: boolean) {
		if (this.showHidden === showHidden) return;
		this.showHidden = showHidden;
		this.treeRoot = null;
		if (this.rootPath) void this.loadPath(this.rootPath);
	}

	/** Loads `dirPath` as the new root and re-renders the tree. */
	async loadPath(dirPath: string) {
		this.rootPath = dirPath;
		this.treeRoot = await this.buildNode(dirPath, true);
		this.renderTree();
	}

	/** Filters the tree to files whose name contains `query`; clears filter when query is empty. */
	async search(query: string) {
		const seq = ++this.searchSeq;
		this.container.empty();
		if (!query.trim()) {
			if (this.treeRoot) this.renderNode(this.treeRoot, this.container, 0);
			return;
		}
		const { matches, truncated } = await this.findFiles(
			this.rootPath, query.toLowerCase(), [], { count: 0 },
		);
		// A newer keystroke already replaced the list — drop stale results.
		if (seq !== this.searchSeq) return;
		this.container.empty();
		if (matches.length === 0) {
			this.container.createEl('span', { cls: 'so-search-empty', text: 'No results' });
			return;
		}
		for (const fullPath of matches) {
			const rel = path.relative(this.rootPath, fullPath);
			const row = this.container.createDiv({ cls: 'so-tree-row so-tree-file' });
			row.setCssProps({ '--so-indent': '6px' });
			const iconEl = row.createSpan({ cls: 'so-tree-icon' });
			const [icon, cls] = fileIcon(path.basename(fullPath));
			setIcon(iconEl, icon);
			iconEl.addClass(cls);
			row.createSpan({ cls: 'so-tree-label', text: rel });
			row.title = fullPath;
			row.addEventListener('click', () => {
				this.container.querySelectorAll('.so-tree-row-active').forEach((el) =>
					el.removeClass('so-tree-row-active'),
				);
				row.addClass('so-tree-row-active');
				this.onSelect(fullPath);
			});
		}
		if (truncated) {
			this.container.createEl('span', {
				cls: 'so-search-more',
				text: `More than ${SEARCH_RESULTS_CAP} results — refine your search…`,
			});
		}
	}

	private async findFiles(
		dir: string,
		query: string,
		results: string[],
		state: { count: number },
	): Promise<{ matches: string[]; truncated: boolean }> {
		if (state.count >= SEARCH_RESULTS_CAP) return { matches: results, truncated: true };
		let entries: string[];
		try { entries = await fsp.readdir(dir); } catch { return { matches: results, truncated: false }; }
		if (!this.showHidden) entries = entries.filter((e) => !e.startsWith('.'));
		for (const name of entries) {
			if (state.count >= SEARCH_RESULTS_CAP) return { matches: results, truncated: true };
			const full = path.join(dir, name);
			let isDir = false;
			try { isDir = (await fsp.stat(full)).isDirectory(); } catch { continue; }
			if (isDir) {
				const sub = await this.findFiles(full, query, results, state);
				if (sub.truncated) return sub;
			} else if (name.toLowerCase().includes(query)) {
				results.push(full);
				state.count++;
			}
		}
		return { matches: results, truncated: false };
	}

	private renderTree() {
		this.container.empty();
		if (this.treeRoot) this.renderNode(this.treeRoot, this.container, 0);
	}

	private async buildNode(fullPath: string, expanded = false): Promise<TreeNode> {
		const name = path.basename(fullPath) || fullPath;
		let isDir = false;
		try { isDir = (await fsp.stat(fullPath)).isDirectory(); } catch { return { name, fullPath, isDir: false }; }
		const node: TreeNode = { name, fullPath, isDir, expanded };
		if (isDir && expanded) node.children = await this.readDir(fullPath);
		return node;
	}

	private async readDir(dirPath: string): Promise<TreeNode[]> {
		let entries: string[];
		try { entries = await fsp.readdir(dirPath); } catch { return []; }
		if (!this.showHidden) entries = entries.filter((e) => !e.startsWith('.'));
		const nodes = await Promise.all(entries.map((name) => this.buildNode(path.join(dirPath, name))));
		return nodes.sort((a, b) => {
			if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
	}

	private renderNode(node: TreeNode, parent: HTMLElement, depth: number) {
		const row = parent.createDiv({ cls: 'so-tree-row' });
		row.setCssProps({ '--so-indent': `${depth * 14 + 6}px` });

		const iconEl = row.createSpan({ cls: 'so-tree-icon' });

		if (node.isDir) {
			row.addClass('so-tree-dir');
			setIcon(iconEl, node.expanded ? 'folder-open' : 'folder');
			iconEl.addClass('so-icon-folder');
			row.createSpan({ cls: 'so-tree-label', text: node.name });

			const childContainer = parent.createDiv({ cls: 'so-tree-children' });
			if (!node.expanded) childContainer.addClass('so-tree-children-hidden');
			if (node.expanded && node.children) {
				for (const child of node.children) this.renderNode(child, childContainer, depth + 1);
			}

			row.addEventListener('click', () => {
				node.expanded = !node.expanded;
				iconEl.empty();
				setIcon(iconEl, node.expanded ? 'folder-open' : 'folder');
				if (node.expanded) {
					childContainer.removeClass('so-tree-children-hidden');
					if (!node.children) {
						void this.readDir(node.fullPath).then((children) => {
							node.children = children;
							childContainer.empty();
							for (const child of children) this.renderNode(child, childContainer, depth + 1);
						});
						return;
					}
					childContainer.empty();
					for (const child of node.children) this.renderNode(child, childContainer, depth + 1);
				} else {
					childContainer.addClass('so-tree-children-hidden');
				}
			});
		} else {
			row.addClass('so-tree-file');
			const [icon, cls] = fileIcon(node.name);
			setIcon(iconEl, icon);
			iconEl.addClass(cls);
			row.createSpan({ cls: 'so-tree-label', text: node.name });
			row.addEventListener('click', () => {
				this.container.querySelectorAll('.so-tree-row-active').forEach((el) =>
					el.removeClass('so-tree-row-active'),
				);
				row.addClass('so-tree-row-active');
				this.onSelect(node.fullPath);
			});
		}
	}
}
