import { App, Menu, Modal, Setting } from 'obsidian';
import * as path from 'path';

interface ElectronDialog {
	showOpenDialog(opts: Record<string, unknown>): Promise<{ canceled: boolean; filePaths: string[] }>;
}

/** Electron's folder dialog, or null when this Obsidian build does not expose it. */
function electronDialog(): ElectronDialog | null {
	try {
		const electron = window.require('electron') as { remote?: { dialog?: ElectronDialog } } | undefined;
		return electron?.remote?.dialog ?? null;
	} catch {
		return null;
	}
}

/** Prompts for a folder path; used when the system dialog is unavailable or preferred. */
class FolderPathModal extends Modal {
	private value = '';

	constructor(app: App, private initial: string, private onSubmit: (value: string) => void) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText('Open folder');
		this.value = this.initial;
		const submit = () => {
			const value = this.value.trim();
			if (!value) return;
			this.close();
			this.onSubmit(value);
		};
		new Setting(this.contentEl)
			.setName('Folder path')
			.setDesc('Absolute path; a leading ~ means your home folder.')
			.addText((text) => {
				text.setPlaceholder('~/projects/my-app').setValue(this.initial).onChange((v) => { this.value = v; });
				text.inputEl.addClass('so-path-input');
				text.inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						submit();
					}
				});
				window.setTimeout(() => text.inputEl.select(), 0);
			});
		new Setting(this.contentEl).addButton((btn) => btn.setButtonText('Open').setCta().onClick(submit));
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Opens the folder-path prompt directly (used by the command palette). */
export function promptForFolder(app: App, current: string, onChoose: (folder: string) => void) {
	new FolderPathModal(app, current, onChoose).open();
}

export interface FolderMenuOptions {
	recent: string[];
	current: string;
	onChoose: (folder: string) => void;
	onClearRecent: () => void;
}

/** Shows the "Open folder" menu: browse, type a path, or pick a recent folder. */
export function showFolderMenu(app: App, evt: MouseEvent, opts: FolderMenuOptions) {
	const menu = new Menu();
	const dialog = electronDialog();

	if (dialog) {
		menu.addItem((item) =>
			item.setTitle('Browse…').setIcon('folder-open').onClick(async () => {
				try {
					const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
					const [dir] = result.filePaths;
					if (!result.canceled && dir) opts.onChoose(dir);
				} catch {
					new FolderPathModal(app, opts.current, opts.onChoose).open();
				}
			}),
		);
	}
	menu.addItem((item) =>
		item.setTitle('Enter path…').setIcon('text-cursor-input').onClick(() => {
			new FolderPathModal(app, opts.current, opts.onChoose).open();
		}),
	);

	const recent = opts.recent.filter((p) => p !== opts.current);
	if (recent.length > 0) {
		menu.addSeparator();
		for (const folder of recent) {
			menu.addItem((item) =>
				item
					.setTitle(`${path.basename(folder) || folder} — ${path.dirname(folder)}`)
					.setIcon('history')
					.onClick(() => opts.onChoose(folder)),
			);
		}
		menu.addItem((item) => item.setTitle('Clear recent folders').setIcon('trash').onClick(opts.onClearRecent));
	}

	menu.showAtMouseEvent(evt);
}
