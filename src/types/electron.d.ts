/**
 * The small part of Electron's API this plugin uses. Obsidian provides
 * `electron` at runtime on desktop; it is not a build dependency.
 */
declare module 'electron' {
	export const shell: {
		showItemInFolder(fullPath: string): void;
		/** Resolves to an error message, or '' on success. */
		openPath(fullPath: string): Promise<string>;
	};
}
