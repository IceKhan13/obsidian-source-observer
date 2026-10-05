import { Menu, Platform } from 'obsidian';
import { copyToClipboard, openInDefaultApp, revealInSystem } from '../utils/system';

/** A file or folder that was right-clicked in the sidebar. */
export interface FileMenuTarget {
	absPath: string;
	/** Path relative to the opened folder, '/'-separated. */
	relPath: string;
	isDir: boolean;
	/** False for deleted files, whose path can be copied but not opened. */
	exists: boolean;
}

export interface FileMenuItem {
	title: string;
	icon: string;
	run: () => void;
}

/**
 * Builds the menu as groups of items, separated in the rendered menu.
 * `extra` items, e.g. "Open file" for a change, form the first group.
 */
export function fileMenuGroups(target: FileMenuTarget, extra: FileMenuItem[] = []): FileMenuItem[][] {
	const copy: FileMenuItem[] = [
		{ title: 'Copy path', icon: 'copy', run: () => { void copyToClipboard(target.absPath); } },
		{ title: 'Copy relative path', icon: 'copy', run: () => { void copyToClipboard(target.relPath); } },
	];
	const system: FileMenuItem[] = [];
	if (target.exists) {
		system.push({
			title: Platform.isMacOS ? 'Reveal in Finder' : 'Show in system explorer',
			icon: 'folder-open',
			run: () => revealInSystem(target.absPath),
		});
		if (!target.isDir) {
			system.push({
				title: 'Open in default app',
				icon: 'arrow-up-right',
				run: () => { void openInDefaultApp(target.absPath); },
			});
		}
	}
	return [extra, copy, system].filter((group) => group.length > 0);
}

/** Shows the context menu for `target` at the mouse position. */
export function showFileMenu(evt: MouseEvent, target: FileMenuTarget, extra: FileMenuItem[] = []) {
	evt.preventDefault();
	const menu = new Menu();
	fileMenuGroups(target, extra).forEach((group, i) => {
		if (i > 0) menu.addSeparator();
		for (const item of group) {
			menu.addItem((mi) => mi.setTitle(item.title).setIcon(item.icon).onClick(item.run));
		}
	});
	menu.showAtMouseEvent(evt);
}
