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

const SHORT_UNITS: [string, number][] = [
	['y', 365 * 24 * 3600],
	['mo', 30 * 24 * 3600],
	['w', 7 * 24 * 3600],
	['d', 24 * 3600],
	['h', 3600],
	['m', 60],
];

/** Compact age for narrow columns: "now", "5m", "3h", "2d", "3w", "4mo", "2y". */
export function formatShortAge(seconds: number, now = Date.now() / 1000): string {
	const elapsed = now - seconds;
	for (const [unit, size] of SHORT_UNITS) {
		if (elapsed >= size) return `${Math.floor(elapsed / size)}${unit}`;
	}
	return 'now';
}

/** Locale date and time for tooltips, e.g. "5 Oct 2026, 14:03". */
export function formatDateTime(seconds: number): string {
	return new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
