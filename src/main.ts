import { Events, Plugin, WorkspaceLeaf } from 'obsidian';
import { sanitizeSettings, SourceObserverSettings } from './settings';
import { SourceObserverSettingTab } from './ui/SettingTab';
import { SourceObserverView, VIEW_TYPE } from './ui/SourceObserverView';

/** Root plugin class — registers the view, ribbon icon, commands, and settings tab. */
export default class SourceObserverPlugin extends Plugin {
	settings!: SourceObserverSettings;
	/** Fires 'changed' after settings are persisted so open views can re-render. */
	settingsEvents = new Events();

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE, (leaf) => new SourceObserverView(leaf, this));

		this.addRibbonIcon('code-2', 'Source observer', () => { void this.activateView(); });

		this.addCommand({
			id: 'open',
			name: 'Open',
			callback: () => { void this.activateView(); },
		});

		this.addCommand({
			id: 'open-folder',
			name: 'Open folder…',
			callback: () => {
				void this.activateView().then((view) => view?.promptForFolder());
			},
		});

		this.addCommand({
			id: 'find-in-file',
			name: 'Find in file',
			checkCallback: (checking) => this.withEditor(checking, (view) => view.findInFile()),
		});

		this.addCommand({
			id: 'go-to-line',
			name: 'Go to line',
			checkCallback: (checking) => this.withEditor(checking, (view) => view.goToLine()),
		});

		this.addSettingTab(new SourceObserverSettingTab(this.app, this));
	}

	/** Opens the Source Observer tab, reusing an existing leaf if one is already open. */
	async activateView(): Promise<SourceObserverView | null> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | undefined = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
		return leaf.view instanceof SourceObserverView ? leaf.view : null;
	}

	/** Runs `action` on the active view when it shows a file or diff; for `checkCallback`. */
	private withEditor(checking: boolean, action: (view: SourceObserverView) => void): boolean {
		const view = this.app.workspace.getActiveViewOfType(SourceObserverView);
		if (!view?.hasEditor()) return false;
		if (!checking) action(view);
		return true;
	}

	async loadSettings() {
		this.settings = sanitizeSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.settingsEvents.trigger('changed');
	}
}
