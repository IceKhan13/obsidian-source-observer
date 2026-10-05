/** Stand-in for Electron's `shell`, recording calls instead of touching the OS. */
export const shell = {
	calls: [] as [string, string][],
	showItemInFolder(fullPath: string) { this.calls.push(['reveal', fullPath]); },
	openPath(fullPath: string) {
		this.calls.push(['open', fullPath]);
		return Promise.resolve('');
	},
};
