const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	['year', 365 * 24 * 3600],
	['month', 30 * 24 * 3600],
	['week', 7 * 24 * 3600],
	['day', 24 * 3600],
	['hour', 3600],
	['minute', 60],
];

/** "3 days ago", "last month", "just now" for a time in seconds since the epoch. */
export function formatRelativeTime(seconds: number, now = Date.now() / 1000): string {
	const elapsed = now - seconds;
	if (elapsed < 60) return 'just now';
	const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	for (const [unit, size] of UNITS) {
		if (elapsed >= size) return format.format(-Math.floor(elapsed / size), unit);
	}
	return 'just now';
}

/** Locale date and time for tooltips, e.g. "5 Oct 2026, 14:03". */
export function formatDateTime(seconds: number): string {
	return new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
