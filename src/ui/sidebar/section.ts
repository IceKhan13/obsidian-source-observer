import { Component, setIcon } from 'obsidian';

export interface Section {
	body: HTMLElement;
	searchInput: HTMLInputElement;
	headerRight: HTMLElement;
}

export interface SectionShell {
	section: HTMLElement;
	body: HTMLElement;
	headerRight: HTMLElement;
	setCollapsed: (collapsed: boolean) => void;
	isCollapsed: () => boolean;
}

export interface SectionShellOptions {
	/** Start collapsed. */
	collapsed?: boolean;
	/** Called after the section is collapsed or expanded. */
	onToggle?: (collapsed: boolean) => void;
}

/**
 * Builds a collapsible sidebar section with a title and a slot for header
 * controls. Listeners are registered on `owner` so they are removed when it
 * unloads.
 */
export function createSectionShell(
	owner: Component,
	parent: HTMLElement,
	title: string,
	opts: SectionShellOptions = {},
): SectionShell {
	const section = parent.createDiv({ cls: 'so-section' });
	const header = section.createDiv({ cls: 'so-section-header' });

	const toggle = header.createDiv({
		cls: 'so-section-toggle',
		attr: { role: 'button', tabindex: '0', 'aria-expanded': 'true' },
	});
	const chevron = toggle.createSpan({ cls: 'so-section-chevron' });
	setIcon(chevron, 'chevron-down');
	toggle.createSpan({ cls: 'so-section-title', text: title });

	const headerRight = header.createDiv({ cls: 'so-section-header-right' });
	const body = section.createDiv({ cls: 'so-section-body' });

	const isCollapsed = () => section.hasClass('so-section-collapsed');
	const setCollapsed = (collapsed: boolean) => {
		if (collapsed === isCollapsed()) return;
		section.toggleClass('so-section-collapsed', collapsed);
		toggle.setAttr('aria-expanded', String(!collapsed));
		opts.onToggle?.(collapsed);
	};
	if (opts.collapsed) {
		section.addClass('so-section-collapsed');
		toggle.setAttr('aria-expanded', 'false');
	}

	owner.registerDomEvent(toggle, 'click', () => setCollapsed(!isCollapsed()));
	owner.registerDomEvent(toggle, 'keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			setCollapsed(!isCollapsed());
		}
	});

	return { section, body, headerRight, setCollapsed, isCollapsed };
}

/**
 * A section shell plus a search button in the header that toggles a filter
 * input at the top of the body.
 */
export function createSection(owner: Component, parent: HTMLElement, title: string): Section {
	const { body, headerRight, setCollapsed } = createSectionShell(owner, parent, title);
	const searchBtn = headerRight.createEl('button', {
		cls: 'clickable-icon so-icon-btn',
		attr: { 'aria-label': `Search ${title.toLowerCase()}` },
	});
	setIcon(searchBtn, 'search');

	const searchInput = body.createEl('input', {
		cls: 'so-search-input so-hidden',
		attr: { type: 'search', placeholder: `Search ${title.toLowerCase()}…`, spellcheck: 'false' },
	});

	const closeSearch = () => {
		searchInput.addClass('so-hidden');
		if (searchInput.value) {
			searchInput.value = '';
			searchInput.dispatchEvent(new Event('input'));
		}
	};

	owner.registerDomEvent(searchBtn, 'click', (e) => {
		e.stopPropagation();
		if (searchInput.hasClass('so-hidden')) {
			searchInput.removeClass('so-hidden');
			setCollapsed(false);
			searchInput.focus();
		} else {
			closeSearch();
		}
	});
	owner.registerDomEvent(searchInput, 'keydown', (e) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeSearch();
		}
	});

	return { body, searchInput, headerRight };
}
