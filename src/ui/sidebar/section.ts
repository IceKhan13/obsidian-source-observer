import { Component, setIcon } from 'obsidian';

export interface Section {
	body: HTMLElement;
	searchInput: HTMLInputElement;
	headerRight: HTMLElement;
}

/**
 * Builds a collapsible sidebar section with a title, a slot for header
 * controls and a toggleable search input. Listeners are registered on
 * `owner` so they are removed when it unloads.
 */
export function createSection(owner: Component, parent: HTMLElement, title: string): Section {
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
	const searchBtn = headerRight.createEl('button', {
		cls: 'clickable-icon so-icon-btn',
		attr: { 'aria-label': `Search ${title.toLowerCase()}` },
	});
	setIcon(searchBtn, 'search');

	const body = section.createDiv({ cls: 'so-section-body' });
	const searchInput = body.createEl('input', {
		cls: 'so-search-input so-hidden',
		attr: { type: 'search', placeholder: `Search ${title.toLowerCase()}…`, spellcheck: 'false' },
	});

	const setCollapsed = (collapsed: boolean) => {
		section.toggleClass('so-section-collapsed', collapsed);
		toggle.setAttr('aria-expanded', String(!collapsed));
	};

	owner.registerDomEvent(toggle, 'click', () => setCollapsed(!section.hasClass('so-section-collapsed')));
	owner.registerDomEvent(toggle, 'keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			setCollapsed(!section.hasClass('so-section-collapsed'));
		}
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
