import { App, PluginSettingTab, Setting } from 'obsidian';
import type SourceObserverPlugin from './main';

export interface SourceObserverSettings {
	lastOpenedPath: string;
	fontSize: number;
	showHidden: boolean;
}

export const DEFAULT_SETTINGS: SourceObserverSettings = {
	lastOpenedPath: '',
	fontSize: 13,
	showHidden: true,
};

export class SourceObserverSettingTab extends PluginSettingTab {
	plugin: SourceObserverPlugin;

	constructor(app: App, plugin: SourceObserverPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Font size')
			.setDesc('Code viewer font size in px')
			.addSlider((slider) =>
				slider
					.setLimits(10, 20, 1)
					.setValue(this.plugin.settings.fontSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.fontSize = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Show hidden files')
			.setDesc('Show files and folders starting with a dot')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showHidden)
					.onChange(async (value) => {
						this.plugin.settings.showHidden = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
