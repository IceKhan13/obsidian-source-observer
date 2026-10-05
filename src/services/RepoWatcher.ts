import { Component, debounce } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type { GitRepo } from '../git/GitRepo';

/** Poll tick, in ms. Polling catches anything the watchers miss. */
const POLL_MS = 5000;
/** With a working-tree watcher active, poll only every Nth tick. */
const POLL_TICKS_WITH_WATCHER = 3;
/** Quiet period before acting on bursts of file-system events, in ms. */
const EVENT_DEBOUNCE_MS = 400;

/** Files in the git dir whose changes affect `git status` or branch info. */
const GIT_FILES = new Set([
	'index', 'HEAD', 'ORIG_HEAD', 'FETCH_HEAD', 'MERGE_HEAD',
	'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'packed-refs',
]);

/**
 * Recursive `fs.watch` is native on macOS and Windows. On Linux, Node
 * emulates it with one inotify watch per directory, which is too costly for
 * large trees, so Linux relies on polling for working-tree changes.
 */
const NATIVE_RECURSIVE = process.platform === 'darwin' || process.platform === 'win32';

export interface RepoWatcherOptions {
	isVisible: () => boolean;
	/** Git metadata or working-tree content changed: refresh status. */
	onGitChange: () => void;
	/** Files were created, deleted or edited: refresh the tree and index. */
	onTreeChange: () => void;
}

/**
 * Watches the git dir and working tree for changes and polls as a fallback.
 * Directories are watched rather than files: git replaces `.git/index` by
 * renaming a new file over it, which silently kills a watch on the file
 * itself. Nothing fires while the view is hidden; missed changes are
 * delivered by `resume()` when it becomes visible again.
 */
export class RepoWatcher extends Component {
	private watchers: fs.FSWatcher[] = [];
	private hasTreeWatcher = false;
	private tick = 0;
	private missedGit = false;
	private missedTree = false;
	private fireGit = debounce(() => this.emitGit(), EVENT_DEBOUNCE_MS, true);
	private fireTree = debounce(() => this.emitTree(), EVENT_DEBOUNCE_MS, true);

	constructor(private opts: RepoWatcherOptions) {
		super();
	}

	onload() {
		this.registerInterval(window.setInterval(() => this.poll(), POLL_MS));
	}

	onunload() {
		this.stop();
		this.fireGit.cancel();
		this.fireTree.cancel();
	}

	/** (Re)starts watching `folder` and, when present, its repository. */
	watch(folder: string, repo: GitRepo | null) {
		this.stop();
		if (!folder) return;

		this.hasTreeWatcher = NATIVE_RECURSIVE && this.add(folder, true, (file) => {
			// Git's own churn is handled by the git-dir watchers below.
			if (file && (file === '.git' || file.startsWith(`.git${path.sep}`))) return;
			this.fireTree();
			this.fireGit();
		});

		if (!repo) return;
		const onGitFile = (file: string | null) => {
			if (!file || GIT_FILES.has(file)) this.fireGit();
		};
		this.add(repo.gitDir, false, onGitFile);
		if (repo.commonDir !== repo.gitDir) this.add(repo.commonDir, false, onGitFile);
		const refs = path.join(repo.commonDir, 'refs');
		if (NATIVE_RECURSIVE) this.add(refs, true, () => this.fireGit());
		else this.add(path.join(refs, 'heads'), false, () => this.fireGit());
	}

	/** Delivers changes that happened while the view was hidden. */
	resume() {
		if (!this.opts.isVisible()) return;
		if (this.missedGit) this.emitGit();
		if (this.missedTree) this.emitTree();
	}

	private add(target: string, recursive: boolean, onEvent: (file: string | null) => void): boolean {
		try {
			const w = fs.watch(target, { recursive, persistent: false }, (_event, file) => {
				onEvent(file ? file.toString() : null);
			});
			// Unhandled 'error' events would surface as uncaught exceptions.
			w.on('error', () => { /* watched path removed or unreadable */ });
			this.watchers.push(w);
			return true;
		} catch {
			return false;
		}
	}

	private stop() {
		for (const w of this.watchers) {
			try { w.close(); } catch { /* already closed */ }
		}
		this.watchers = [];
		this.hasTreeWatcher = false;
	}

	private poll() {
		this.tick++;
		if (this.hasTreeWatcher && this.tick % POLL_TICKS_WITH_WATCHER !== 0) return;
		this.emitGit();
		// Without a working-tree watcher, polling is the only way to see new files.
		if (!this.hasTreeWatcher) this.emitTree();
	}

	private emitGit() {
		if (!this.opts.isVisible()) {
			this.missedGit = true;
			return;
		}
		this.missedGit = false;
		this.opts.onGitChange();
	}

	private emitTree() {
		if (!this.opts.isVisible()) {
			this.missedTree = true;
			return;
		}
		this.missedTree = false;
		this.opts.onTreeChange();
	}
}
