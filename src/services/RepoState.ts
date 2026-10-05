import { GitRepo } from '../git/GitRepo';
import type { RepoStatus } from '../git/status';
import { isDirectory } from '../utils/paths';

export type RepoSnapshot =
	| { kind: 'none' }
	| { kind: 'missing-folder'; folder: string }
	| { kind: 'no-git'; folder: string }
	| { kind: 'not-repo'; folder: string }
	| { kind: 'repo'; folder: string; repo: GitRepo; status: RepoStatus };

type Listener = (snapshot: RepoSnapshot) => void;

/**
 * Holds the git state of the opened folder and refreshes it on demand.
 *
 * Refreshes are single-flight: a refresh requested while one is running
 * marks the state dirty and runs exactly once more afterwards. Results from
 * a folder that has since been replaced are dropped via a generation check.
 */
export class RepoState {
	snapshot: RepoSnapshot = { kind: 'none' };
	private folder = '';
	private repo: GitRepo | null = null;
	private generation = 0;
	private inFlight: Promise<void> | null = null;
	private dirty = false;
	private listeners = new Set<Listener>();
	private lastStatusJson = '';

	/** Subscribes to snapshot changes; returns an unsubscribe function. */
	onChange(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	/** Switches to `folder` and loads its state. */
	open(folder: string): Promise<void> {
		this.folder = folder;
		this.repo = null;
		this.generation++;
		this.lastStatusJson = '';
		return this.refresh();
	}

	/** Re-reads git status. Concurrent calls coalesce into one extra run. */
	refresh(): Promise<void> {
		if (this.inFlight) {
			this.dirty = true;
			return this.inFlight;
		}
		this.inFlight = this.run().finally(() => { this.inFlight = null; });
		return this.inFlight;
	}

	/** Drops listeners and invalidates any in-flight refresh. */
	dispose() {
		this.generation++;
		this.listeners.clear();
	}

	private async run() {
		do {
			this.dirty = false;
			await this.loadOnce();
		} while (this.dirty);
	}

	private async loadOnce() {
		const gen = this.generation;
		const folder = this.folder;
		if (!folder) return this.publish(gen, { kind: 'none' });

		if (!(await isDirectory(folder))) {
			this.repo = null;
			return this.publish(gen, { kind: 'missing-folder', folder });
		}

		let repo = this.repo;
		if (!repo) {
			const opened = await GitRepo.open(folder);
			if (gen !== this.generation) return;
			if (opened.kind !== 'repo') return this.publish(gen, { kind: opened.kind, folder });
			repo = this.repo = opened.repo;
		}

		let status: RepoStatus;
		try {
			status = await repo.status();
		} catch {
			// The repository disappeared (e.g. `.git` removed); re-detect next time.
			if (gen === this.generation) this.repo = null;
			return this.publish(gen, { kind: 'not-repo', folder });
		}
		this.publish(gen, { kind: 'repo', folder, repo, status });
	}

	private publish(gen: number, snapshot: RepoSnapshot) {
		if (gen !== this.generation) return;
		// Skip notifying when nothing changed, so periodic polls are free.
		const json = JSON.stringify(
			snapshot.kind === 'repo' ? [snapshot.folder, snapshot.repo.gitDir, snapshot.status] : snapshot,
		);
		if (json === this.lastStatusJson) return;
		this.lastStatusJson = json;
		this.snapshot = snapshot;
		for (const listener of this.listeners) listener(snapshot);
	}
}
