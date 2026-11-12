import type { Extension } from '@codemirror/state';
import { EditorView, gutter, GutterMarker } from '@codemirror/view';
import { setIcon } from 'obsidian';

const LABEL = 'Copy change';

/** A copy button on the line where a hunk's first change is shown. */
class CopyMarker extends GutterMarker {
	constructor(readonly index: number, private onCopy: (index: number) => void) {
		super();
	}

	eq(other: CopyMarker) {
		return other.index === this.index;
	}

	toDOM(view: EditorView) {
		const el = view.dom.ownerDocument.createElement('div');
		el.className = 'so-hunk-copy';
		el.setAttr('aria-label', LABEL);
		el.setAttr('role', 'button');
		setIcon(el, 'copy');
		// Handled on the button: the gutter's own handlers find the line by height.
		el.addEventListener('mousedown', (e) => e.preventDefault());
		el.addEventListener('click', (e) => {
			e.preventDefault();
			this.onCopy(this.index);
		});
		return el;
	}
}

/** Keeps the gutter's width on lines without a button. */
const spacer = new (class extends GutterMarker {
	toDOM(view: EditorView) {
		const el = view.dom.ownerDocument.createElement('div');
		el.className = 'so-hunk-copy';
		return el;
	}
})();

/**
 * A gutter with a copy button on line `anchors[i]` (1-based) for each hunk
 * of a diff; selecting it calls `onCopy(i)`.
 */
export function hunkCopyGutter(anchors: number[], onCopy: (index: number) => void): Extension {
	const byLine = new Map<number, CopyMarker>();
	anchors.forEach((line, i) => {
		if (!byLine.has(line)) byLine.set(line, new CopyMarker(i, onCopy));
	});
	return gutter({
		class: 'so-hunk-gutter',
		initialSpacer: () => spacer,
		lineMarker: (view, block) => byLine.get(view.state.doc.lineAt(block.from).number) ?? null,
	});
}
