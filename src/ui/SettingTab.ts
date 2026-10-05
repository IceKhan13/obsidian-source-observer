import { App, PluginSettingTab, Setting } from 'obsidian';
import type SourceObserverPlugin from '../main';
import { FONT_SIZE_RANGE } from '../settings';

/** Obsidian settings tab for Source Observer. */
export class SourceObserverSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: SourceObserverPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.plugin.settings;

		new Setting(containerEl)
			.setName('Font size')
			.setDesc('Font size of the code and diff viewer, in pixels.')
			.addSlider((slider) =>
				slider
					.setLimits(FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, 1)
					.setValue(settings.fontSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						settings.fontSize = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Show hidden files')
			.setDesc('Show files and folders whose names start with a dot.')
			.addToggle((toggle) =>
				toggle
					.setValue(settings.showHidden)
					.onChange(async (value) => {
						settings.showHidden = value;
						await this.plugin.saveSettings();
					}),
			);

		const count = settings.recentFolders.length;
		new Setting(containerEl)
			.setName('Recent folders')
			.setDesc(count ? `${count} folder${count === 1 ? '' : 's'} remembered.` : 'No folders remembered.')
			.addButton((btn) =>
				btn
					.setButtonText('Clear')
					.setDisabled(count === 0)
					.onClick(async () => {
						settings.recentFolders = [];
						await this.plugin.saveSettings();
						this.display();
					}),
			);
	}
}
