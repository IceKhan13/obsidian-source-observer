/** How diffs are laid out: one interleaved column, or old and new side by side. */
export type DiffLayout = 'unified' | 'split';

/** Persisted plugin settings stored in `data.json`. */
export interface SourceObserverSettings {
	lastOpenedPath: string;
	fontSize: number;
	showHidden: boolean;
	/** Most recently opened folders, newest first. */
	recentFolders: string[];
	/** Sidebar width in px. */
	sidebarWidth: number;
	diffLayout: DiffLayout;
	/** Wrap long lines in the viewer instead of scrolling sideways. */
	wordWrap: boolean;
	/** Show changes against a base branch instead of uncommitted changes. */
	compareWithBase: boolean;
	/** Base branch chosen per repository, keyed by its common git dir. */
	baseBranches: Record<string, string>;
}

export const DEFAULT_SETTINGS: SourceObserverSettings = {
	lastOpenedPath: '',
	fontSize: 13,
	showHidden: true,
	recentFolders: [],
	sidebarWidth: 240,
	diffLayout: 'unified',
	wordWrap: false,
	compareWithBase: false,
	baseBranches: {},
};

export const FONT_SIZE_RANGE = { min: 10, max: 20 } as const;
export const SIDEBAR_WIDTH_RANGE = { min: 160, max: 600 } as const;
export const MAX_RECENT_FOLDERS = 8;
/** Repositories whose base branch choice is remembered. */
export const MAX_BASE_BRANCHES = 50;

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * Builds valid settings from whatever was stored on disk, falling back to
 * defaults for missing or malformed values.
 */
export function sanitizeSettings(raw: unknown): SourceObserverSettings {
	const data = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof SourceObserverSettings, unknown>>;
	const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

	const lastOpenedPath = typeof data.lastOpenedPath === 'string' ? data.lastOpenedPath : DEFAULT_SETTINGS.lastOpenedPath;
	let recentFolders = Array.isArray(data.recentFolders)
		? data.recentFolders.filter((p): p is string => typeof p === 'string' && p.length > 0)
		: [];
	// Seed the list for users upgrading from versions without recent folders.
	if (recentFolders.length === 0 && lastOpenedPath) recentFolders = [lastOpenedPath];

	return {
		lastOpenedPath,
		fontSize: clamp(Math.round(num(data.fontSize, DEFAULT_SETTINGS.fontSize)), FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max),
		showHidden: typeof data.showHidden === 'boolean' ? data.showHidden : DEFAULT_SETTINGS.showHidden,
		recentFolders: [...new Set(recentFolders)].slice(0, MAX_RECENT_FOLDERS),
		sidebarWidth: clamp(num(data.sidebarWidth, DEFAULT_SETTINGS.sidebarWidth), SIDEBAR_WIDTH_RANGE.min, SIDEBAR_WIDTH_RANGE.max),
		diffLayout: data.diffLayout === 'split' ? 'split' : 'unified',
		wordWrap: data.wordWrap === true,
		compareWithBase: data.compareWithBase === true,
		baseBranches: sanitizeBaseBranches(data.baseBranches),
	};
}

function sanitizeBaseBranches(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const entries = Object.entries(raw as Record<string, unknown>)
		.filter((e): e is [string, string] => typeof e[1] === 'string' && e[0].length > 0 && e[1].length > 0);
	return Object.fromEntries(entries.slice(-MAX_BASE_BRANCHES));
}

/** Records `branch` as the base for the repository `key`, keeping the map bounded. */
export function setBaseBranch(map: Record<string, string>, key: string, branch: string): Record<string, string> {
	const entries: [string, string][] = [...Object.entries(map).filter(([k]) => k !== key), [key, branch]];
	return Object.fromEntries(entries.slice(-MAX_BASE_BRANCHES));
}

/** Moves `folder` to the front of the recent list, dropping duplicates and overflow. */
export function addRecentFolder(recent: string[], folder: string): string[] {
	return [folder, ...recent.filter((p) => p !== folder)].slice(0, MAX_RECENT_FOLDERS);
}
