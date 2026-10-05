import type { Component } from 'obsidian';

export interface ListNavOptions {
	/** Rows currently visible, in display order. */
	rows: () => HTMLElement[];
	/** Enter / Space on a row. */
	onActivate: (row: HTMLElement) => void;
	/** ArrowRight; return the row to focus next, or null to do nothing. */
	onExpand?: (row: HTMLElement) => HTMLElement | null;
	/** ArrowLeft; return the row to focus next, or null to do nothing. */
	onCollapse?: (row: HTMLElement) => HTMLElement | null;
}

/**
 * Arrow-key navigation over a list of rows using a roving tabindex: the
 * container is a single tab stop and arrow keys move focus between rows.
 */
export function attachListNav(owner: Component, container: HTMLElement, opts: ListNavOptions) {
	container.tabIndex = 0;

	const focusRow = (row: HTMLElement | null | undefined) => {
		if (!row) return;
		for (const r of opts.rows()) r.tabIndex = -1;
		row.tabIndex = 0;
		row.focus();
		row.scrollIntoView({ block: 'nearest' });
	};

	// Forward focus from the container to the active (or first) row.
	owner.registerDomEvent(container, 'focus', (e) => {
		if (e.target !== container) return;
		const rows = opts.rows();
		focusRow(rows.find((r) => r.hasClass('is-active')) ?? rows[0]);
	});

	owner.registerDomEvent(container, 'keydown', (e) => {
		const rows = opts.rows();
		if (rows.length === 0) return;
		const current = (e.target as HTMLElement).closest<HTMLElement>('[data-so-row]');
		const idx = current ? rows.indexOf(current) : -1;
		let handled = true;
		switch (e.key) {
			case 'ArrowDown': focusRow(rows[Math.min(idx + 1, rows.length - 1)]); break;
			case 'ArrowUp': focusRow(rows[Math.max(idx - 1, 0)]); break;
			case 'Home': focusRow(rows[0]); break;
			case 'End': focusRow(rows[rows.length - 1]); break;
			case 'Enter':
			case ' ':
				if (current) opts.onActivate(current);
				break;
			case 'ArrowRight':
				if (current && opts.onExpand) focusRow(opts.onExpand(current));
				break;
			case 'ArrowLeft':
				if (current && opts.onCollapse) focusRow(opts.onCollapse(current));
				break;
			default:
				handled = false;
		}
		if (handled) e.preventDefault();
	});
}

/** Marks an element as a navigable row. */
export function markRow(row: HTMLElement) {
	row.dataset.soRow = '';
	row.tabIndex = -1;
}
