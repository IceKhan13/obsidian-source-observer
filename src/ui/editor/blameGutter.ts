import type { Extension } from '@codemirror/state';
import { EditorView, gutter, GutterMarker } from '@codemirror/view';
import type { BlameCommit } from '../../git/blame';
import { formatDateTime, formatRelativeTime, formatShortAge } from '../../utils/time';

/**
 * Shows the author and age on the first line of each run of lines from the
 * same commit; following lines of the run get an empty marker so the run
 * reads as one block.
 */
class BlameMarker extends GutterMarker {
	constructor(readonly commit: BlameCommit, readonly first: boolean, readonly now: number) {
		super();
	}

	eq(other: BlameMarker) {
		return other.commit === this.commit && other.first === this.first;
	}

	toDOM(view: EditorView) {
		const el = view.dom.ownerDocument.createElement('div');
		el.className = 'so-blame-entry';
		if (!this.first) return el;
		el.addClass('so-blame-start');
		const { commit } = this;
		if (commit.uncommitted) {
			el.addClass('so-blame-uncommitted');
			el.setText('Not committed yet');
			el.title = 'Changed in the working tree or index';
			return el;
		}
		el.createSpan({ cls: 'so-blame-author', text: commit.author });
		// A fixed-width age column gives every author name the same room.
		el.createSpan({ cls: 'so-blame-age', text: formatShortAge(commit.time, this.now) });
		el.title = `${commit.hash.slice(0, 7)} · ${commit.author} · ${formatRelativeTime(commit.time, this.now)}, ${formatDateTime(commit.time)}\n${commit.summary}`;
		return el;
	}
}

/** Keeps the gutter at its full width while blame is loading or empty. */
const spacer = new (class extends GutterMarker {
	toDOM(view: EditorView) {
		const el = view.dom.ownerDocument.createElement('div');
		el.className = 'so-blame-entry';
		return el;
	}
})();

/**
 * A blame gutter for a document whose line `n` was blamed to `lines[n - 1]`.
 * Pass an empty list for a placeholder of the same width. Clicking a
 * committed line calls `onOpen` with its commit.
 */
export function blameGutter(lines: BlameCommit[], onOpen?: (commit: BlameCommit) => void): Extension {
	const now = Date.now() / 1000;
	const markers = lines.map((commit, i) => new BlameMarker(commit, i === 0 || lines[i - 1] !== commit, now));
	return gutter({
		class: 'so-blame-gutter',
		initialSpacer: () => spacer,
		lineMarker: (view, block) => markers[view.state.doc.lineAt(block.from).number - 1] ?? null,
		domEventHandlers: {
			click: (view, block) => {
				const commit = lines[view.state.doc.lineAt(block.from).number - 1];
				if (!commit || commit.uncommitted || !onOpen) return false;
				onOpen(commit);
				return true;
			},
		},
	});
}
