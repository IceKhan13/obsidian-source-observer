import { Plugin, WorkspaceLeaf } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	SourceObserverSettings,
	SourceObserverSettingTab,
} from './settings';
import { SourceObserverView, VIEW_TYPE } from './view';

export default class SourceObserverPlugin extends Plugin {
	settings!: SourceObserverSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE, (leaf) => new SourceObserverView(leaf, this));

		this.addRibbonIcon('code-2', 'Source observer', () => { void this.activateView(); });

		this.addCommand({
			id: 'open-source-observer',
			name: 'Open',
			callback: () => { void this.activateView(); },
		});

		this.addSettingTab(new SourceObserverSettingTab(this.app, this));
	}

	onunload() {}

	async activateView() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE);

		if (leaves.length > 0) {
			void workspace.revealLeaf(leaves[0] as WorkspaceLeaf);
			return;
		}

		const leaf = workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE, active: true });
		void workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<SourceObserverSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
