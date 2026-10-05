import { Events, Plugin, WorkspaceLeaf } from 'obsidian';
import { registerCommands } from './commands';
import { registerLinks } from './links/register';
import type { SourceLocation } from './links/sourceLink';
import { sanitizeSettings, SourceObserverSettings } from './settings';
import { SourceObserverSettingTab } from './ui/SettingTab';
import { SourceObserverView, VIEW_TYPE } from './ui/SourceObserverView';

/** Root plugin class — registers the view, ribbon icon, commands, links, and settings tab. */
export default class SourceObserverPlugin extends Plugin {
	settings!: SourceObserverSettings;
	/** Fires 'changed' after settings are persisted so open views can re-render. */
	settingsEvents = new Events();

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE, (leaf) => new SourceObserverView(leaf, this));

		this.addRibbonIcon('code-2', 'Source observer', () => { void this.activateView(); });

		registerCommands(this);
		registerLinks(this);

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

	/** Opens a file (and lines) from a link or embed, switching folders if needed. */
	async openLocation(loc: SourceLocation) {
		const view = await this.activateView();
		await view?.openLocation(loc);
	}

	async loadSettings() {
		this.settings = sanitizeSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.settingsEvents.trigger('changed');
	}
}
