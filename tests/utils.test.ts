import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { addRecentFolder, MAX_RECENT_FOLDERS, sanitizeSettings } from '../src/settings';
import { formatBytes, looksBinary, readViewableFile } from '../src/utils/content';
import { fileIcon } from '../src/utils/fileIcons';
import { LatestRequest } from '../src/utils/latest';
import { normalizeFolderInput } from '../src/utils/paths';
import { remove, tempDir, write } from './helpers';

const cleanup: string[] = [];
afterEach(() => { while (cleanup.length) remove(cleanup.pop() ?? ''); });

describe('readViewableFile', () => {
	it('classifies text, binary, oversized and missing files', async () => {
		const dir = tempDir();
		cleanup.push(dir);
		write(dir, 'a.txt', 'hello');
		write(dir, 'b.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]));
		write(dir, 'big.txt', 'x'.repeat(100));

		expect(await readViewableFile(path.join(dir, 'a.txt'))).toEqual({ kind: 'text', text: 'hello' });
		expect((await readViewableFile(path.join(dir, 'b.png'))).kind).toBe('binary');
		expect(await readViewableFile(path.join(dir, 'big.txt'), 50)).toEqual({ kind: 'too-large', size: 100 });
		expect((await readViewableFile(path.join(dir, 'missing.txt'))).kind).toBe('missing');
		expect((await readViewableFile(dir)).kind).toBe('error');
	});

	it('sniffs binary content by NUL bytes', () => {
		expect(looksBinary(Buffer.from('plain text'))).toBe(false);
		expect(looksBinary(Buffer.from([65, 0, 66]))).toBe(true);
	});

	it('formats sizes', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(2048)).toBe('2.0 KB');
		expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
	});
});

describe('sanitizeSettings', () => {
	it('fills defaults and clamps out-of-range values', () => {
		const s = sanitizeSettings({ fontSize: 99, sidebarWidth: 5, showHidden: 'yes', recentFolders: [1, '/a', '/a', ''] });
		expect(s.fontSize).toBe(20);
		expect(s.sidebarWidth).toBe(160);
		expect(s.showHidden).toBe(true);
		expect(s.recentFolders).toEqual(['/a']);
	});

	it('seeds recent folders from the last opened path when upgrading', () => {
		expect(sanitizeSettings({ lastOpenedPath: '/repo' }).recentFolders).toEqual(['/repo']);
	});

	it('survives missing or corrupt data', () => {
		expect(sanitizeSettings(null).fontSize).toBe(13);
		expect(sanitizeSettings('junk').recentFolders).toEqual([]);
	});

	it('keeps recent folders unique, newest first, and bounded', () => {
		let recent: string[] = [];
		for (let i = 0; i < MAX_RECENT_FOLDERS + 3; i++) recent = addRecentFolder(recent, `/f${i}`);
		recent = addRecentFolder(recent, '/f5');
		expect(recent[0]).toBe('/f5');
		expect(recent).toHaveLength(MAX_RECENT_FOLDERS);
		expect(new Set(recent).size).toBe(recent.length);
	});
});

describe('normalizeFolderInput', () => {
	it('expands ~ and strips quotes', () => {
		expect(normalizeFolderInput('~')).toBe(os.homedir());
		expect(normalizeFolderInput('~/code')).toBe(path.join(os.homedir(), 'code'));
		expect(normalizeFolderInput('"/tmp/x y"')).toBe(path.resolve('/tmp/x y'));
		expect(normalizeFolderInput('  /a/b/  ')).toBe(path.resolve('/a/b'));
	});
});

describe('small utilities', () => {
	it('picks icons by extension and for dotfiles', () => {
		expect(fileIcon('main.TS')[1]).toBe('so-icon-ts');
		expect(fileIcon('.env')[0]).toBe('lock');
		expect(fileIcon('Makefile')[1]).toBe('so-icon-default');
	});

	it('LatestRequest invalidates older tokens', () => {
		const latest = new LatestRequest();
		const a = latest.next();
		const b = latest.next();
		expect(latest.isCurrent(a)).toBe(false);
		expect(latest.isCurrent(b)).toBe(true);
		latest.cancel();
		expect(latest.isCurrent(b)).toBe(false);
	});
});
