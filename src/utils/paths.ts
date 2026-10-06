import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Expands a leading `~` and resolves to an absolute path. */
export function normalizeFolderInput(input: string): string {
	let p = input.trim();
	// Strip quotes added by "Copy as path" on Windows or shells.
	if (p.length >= 2 && ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'")))) {
		p = p.slice(1, -1);
	}
	if (p === '~') p = os.homedir();
	else if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(2));
	return path.resolve(p);
}

export async function isDirectory(p: string): Promise<boolean> {
	try {
		return (await fsp.stat(p)).isDirectory();
	} catch {
		return false;
	}
}

export async function isFile(p: string): Promise<boolean> {
	try {
		return (await fsp.stat(p)).isFile();
	} catch {
		return false;
	}
}
