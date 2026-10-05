/**
 * "Latest request wins" token. Call `next()` when starting an async load
 * and check `isCurrent()` before applying its result; any newer `next()`
 * makes older results stale.
 */
export class LatestRequest {
	private seq = 0;

	next(): number {
		return ++this.seq;
	}

	isCurrent(token: number): boolean {
		return token === this.seq;
	}

	/** Invalidates every outstanding request. */
	cancel() {
		this.seq++;
	}
}
