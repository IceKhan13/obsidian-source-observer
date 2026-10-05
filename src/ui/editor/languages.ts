import type { Extension } from '@codemirror/state';
import { StreamLanguage, StreamParser } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { php } from '@codemirror/lang-php';
import { go } from '@codemirror/legacy-modes/mode/go';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { c, cpp, csharp, java, kotlin, scala } from '@codemirror/legacy-modes/mode/clike';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { standardSQL } from '@codemirror/legacy-modes/mode/sql';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { extensionOf } from '../../utils/fileIcons';

type LanguageFactory = () => Extension;

/** Wraps a CodeMirror 5-style stream parser; the language is built on first use. */
function legacy(parser: StreamParser<unknown>): LanguageFactory {
	let lang: StreamLanguage<unknown> | null = null;
	return () => (lang ??= StreamLanguage.define(parser));
}

const EXT_LANG: Record<string, LanguageFactory> = {
	js:    () => javascript(),
	jsx:   () => javascript({ jsx: true }),
	ts:    () => javascript({ typescript: true }),
	tsx:   () => javascript({ jsx: true, typescript: true }),
	mjs:   () => javascript(),
	cjs:   () => javascript(),
	py:    () => python(),
	rs:    () => rust(),
	css:   () => css(),
	scss:  () => css(),
	less:  () => css(),
	html:  () => html(),
	htm:   () => html(),
	vue:   () => html(),
	svelte:() => html(),
	json:  () => json(),
	jsonc: () => json(),
	md:    () => markdown(),
	mdx:   () => markdown(),
	php:   () => php(),
	go:    legacy(go),
	rb:    legacy(ruby),
	c:     legacy(c),
	h:     legacy(c),
	cpp:   legacy(cpp),
	cc:    legacy(cpp),
	hpp:   legacy(cpp),
	cs:    legacy(csharp),
	java:  legacy(java),
	kt:    legacy(kotlin),
	kts:   legacy(kotlin),
	scala: legacy(scala),
	sh:    legacy(shell),
	bash:  legacy(shell),
	zsh:   legacy(shell),
	yaml:  legacy(yaml),
	yml:   legacy(yaml),
	toml:  legacy(toml),
	swift: legacy(swift),
	lua:   legacy(lua),
	sql:   legacy(standardSQL),
};

/** Languages for files identified by their whole name rather than an extension. */
const NAME_LANG: Record<string, LanguageFactory> = {
	dockerfile: legacy(dockerFile),
	'.bashrc':  legacy(shell),
	'.zshrc':   legacy(shell),
	'.profile': legacy(shell),
};

/** Returns the syntax-highlighting extension for `fileName`, or none. */
export function languageFor(fileName: string): Extension {
	const name = fileName.toLowerCase();
	const factory = NAME_LANG[name] ?? EXT_LANG[extensionOf(name)];
	return factory ? factory() : [];
}
