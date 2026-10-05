import { Notice } from 'obsidian';
import { shell } from 'electron';

/** Shows `absPath` in Finder or the system file manager. */
export function revealInSystem(absPath: string) {
	shell.showItemInFolder(absPath);
}

/** Opens `absPath` with the app the operating system associates with it. */
export async function openInDefaultApp(absPath: string) {
	const error = await shell.openPath(absPath);
	if (error) new Notice(`Cannot open file: ${error}`);
}

/** Copies `text`, confirming with `notice` if given. */
export async function copyToClipboard(text: string, notice?: string) {
	try {
		await navigator.clipboard.writeText(text);
		if (notice) new Notice(notice);
	} catch {
		new Notice('Cannot copy to the clipboard');
	}
}
