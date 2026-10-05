import { promises as fsp } from 'fs';

/** Files larger than this are not loaded into the viewer, in bytes. */
export const MAX_VIEW_BYTES = 2 * 1024 * 1024;

/** Bytes inspected when sniffing for binary content. */
const SNIFF_BYTES = 8000;

export type LoadedContent =
	| { kind: 'text'; text: string }
	| { kind: 'binary'; size: number }
	| { kind: 'too-large'; size: number }
	| { kind: 'missing' }
	| { kind: 'error'; message: string };

/** Same heuristic git uses: a NUL byte near the start means binary. */
export function looksBinary(buf: Uint8Array): boolean {
	const end = Math.min(buf.length, SNIFF_BYTES);
	for (let i = 0; i < end; i++) if (buf[i] === 0) return true;
	return false;
}

/** Classifies a buffer that has already been size-checked. */
export function decodeContent(buf: Buffer): LoadedContent {
	if (looksBinary(buf)) return { kind: 'binary', size: buf.length };
	return { kind: 'text', text: buf.toString('utf-8') };
}

/** Reads a file from disk, refusing binary and oversized files. */
export async function readViewableFile(filePath: string, maxBytes = MAX_VIEW_BYTES): Promise<LoadedContent> {
	try {
		const stat = await fsp.stat(filePath);
		if (stat.isDirectory()) return { kind: 'error', message: 'Is a directory' };
		if (stat.size > maxBytes) return { kind: 'too-large', size: stat.size };
		return decodeContent(await fsp.readFile(filePath));
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
		return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
	}
}

/** Formats a byte count for display, e.g. "1.4 MB". */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
