import * as fs from 'fs';
import * as path from 'path';
import { setIcon } from 'obsidian';

interface TreeNode {
	name: string;
	fullPath: string;
	isDir: boolean;
	children?: TreeNode[];
	expanded?: boolean;
}

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

	constructor(
		container: HTMLElement,
		showHidden: boolean,
		onSelect: (filePath: string) => void,
	) {
		this.container = container;
		this.showHidden = showHidden;
		this.onSelect = onSelect;
	}

	/** Loads `dirPath` as the new root and re-renders the tree. */
	async loadPath(dirPath: string) {
		this.rootPath = dirPath;
		this.treeRoot = this.buildNode(dirPath, true);
		this.renderTree();
	}

	/** Filters the tree to files whose name contains `query`; clears filter when query is empty. */
	search(query: string) {
		this.container.empty();
		if (!query.trim()) {
			if (this.treeRoot) this.renderNode(this.treeRoot, this.container, 0);
			return;
		}
		const matches = this.findFiles(this.rootPath, query.toLowerCase());
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
	}

	private findFiles(dir: string, query: string, results: string[] = []): string[] {
		let entries: string[];
		try { entries = fs.readdirSync(dir); } catch { return results; }
		if (!this.showHidden) entries = entries.filter((e) => !e.startsWith('.'));
		for (const name of entries) {
			const full = path.join(dir, name);
			let stat: fs.Stats;
			try { stat = fs.statSync(full); } catch { continue; }
			if (stat.isDirectory()) {
				this.findFiles(full, query, results);
			} else if (name.toLowerCase().includes(query)) {
				results.push(full);
			}
		}
		return results;
	}

	private renderTree() {
		this.container.empty();
		if (this.treeRoot) this.renderNode(this.treeRoot, this.container, 0);
	}

	private buildNode(fullPath: string, expanded = false): TreeNode {
		const name = path.basename(fullPath) || fullPath;
		let stat: fs.Stats;
		try { stat = fs.statSync(fullPath); } catch { return { name, fullPath, isDir: false }; }
		const isDir = stat.isDirectory();
		const node: TreeNode = { name, fullPath, isDir, expanded };
		if (isDir && expanded) node.children = this.readDir(fullPath);
		return node;
	}

	private readDir(dirPath: string): TreeNode[] {
		let entries: string[];
		try { entries = fs.readdirSync(dirPath); } catch { return []; }
		if (!this.showHidden) entries = entries.filter((e) => !e.startsWith('.'));
		return entries
			.map((name) => this.buildNode(path.join(dirPath, name)))
			.sort((a, b) => {
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
					if (!node.children) node.children = this.readDir(node.fullPath);
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
