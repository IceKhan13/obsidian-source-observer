import type SourceObserverPlugin from './main';
import { COPY_FORMATS, CopyFormat } from './links/sourceLink';
import { SourceObserverView } from './ui/SourceObserverView';

const COPY_COMMANDS: Record<CopyFormat, { id: string; name: string }> = {
	link: { id: 'copy-link', name: 'Copy link to file or selection' },
	embed: { id: 'copy-embed', name: 'Copy embed of file or selection' },
	code: { id: 'copy-code-block', name: 'Copy file or selection as code block' },
};

/** Registers the command palette commands. IDs are stable; do not rename them. */
export function registerCommands(plugin: SourceObserverPlugin) {
	/** For `checkCallback`: runs `action` on the active view when `applies` holds. */
	const onActiveView = (
		checking: boolean,
		applies: (view: SourceObserverView) => boolean,
		action: (view: SourceObserverView) => void,
	): boolean => {
		const view = plugin.app.workspace.getActiveViewOfType(SourceObserverView);
		if (!view || !applies(view)) return false;
		if (!checking) action(view);
		return true;
	};

	plugin.addCommand({
		id: 'open',
		name: 'Open',
		callback: () => { void plugin.activateView(); },
	});

	plugin.addCommand({
		id: 'open-folder',
		name: 'Open folder…',
		callback: () => {
			void plugin.activateView().then((view) => view?.promptForFolder());
		},
	});

	plugin.addCommand({
		id: 'find-in-file',
		name: 'Find in file',
		checkCallback: (checking) => onActiveView(checking, (v) => v.hasEditor(), (v) => v.findInFile()),
	});

	plugin.addCommand({
		id: 'go-to-line',
		name: 'Go to line',
		checkCallback: (checking) => onActiveView(checking, (v) => v.hasEditor(), (v) => v.goToLine()),
	});

	for (const { format } of COPY_FORMATS) {
		plugin.addCommand({
			...COPY_COMMANDS[format],
			checkCallback: (checking) => onActiveView(checking, (v) => v.canCopyLink(), (v) => v.copyFromEditor(format)),
		});
	}
}
