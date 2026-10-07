import { Menu } from 'obsidian';

/** Branches listed in the base menu; local branches come first. */
const MAX_BRANCHES = 100;

/** Lists branches to compare against at `position`, with `current` checked. */
export function showBaseMenu(
	doc: Document,
	position: { x: number; y: number },
	branches: string[],
	current: string | null,
	onChoose: (branch: string) => void,
): Menu {
	const menu = new Menu();
	for (const branch of branches.slice(0, MAX_BRANCHES)) {
		menu.addItem((item) => item
			.setTitle(branch)
			.setIcon('git-branch')
			.setChecked(branch === current)
			.onClick(() => { if (branch !== current) onChoose(branch); }));
	}
	if (branches.length === 0) menu.addItem((item) => item.setTitle('No branches').setDisabled(true));
	menu.showAtPosition(position, doc);
	return menu;
}
