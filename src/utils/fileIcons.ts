/** [lucide icon name, css colour class] */
export type FileIconSpec = [string, string];

const CODE = 'file-code-2';

const EXT_ICON: Record<string, FileIconSpec> = {
	ts:    [CODE, 'so-icon-ts'],
	tsx:   [CODE, 'so-icon-ts'],
	js:    [CODE, 'so-icon-js'],
	jsx:   [CODE, 'so-icon-js'],
	mjs:   [CODE, 'so-icon-js'],
	cjs:   [CODE, 'so-icon-js'],
	py:    [CODE, 'so-icon-py'],
	rs:    [CODE, 'so-icon-rs'],
	go:    [CODE, 'so-icon-go'],
	rb:    [CODE, 'so-icon-rb'],
	java:  [CODE, 'so-icon-java'],
	kt:    [CODE, 'so-icon-java'],
	kts:   [CODE, 'so-icon-java'],
	scala: [CODE, 'so-icon-java'],
	swift: [CODE, 'so-icon-rs'],
	c:     [CODE, 'so-icon-c'],
	h:     [CODE, 'so-icon-c'],
	cpp:   [CODE, 'so-icon-c'],
	cc:    [CODE, 'so-icon-c'],
	hpp:   [CODE, 'so-icon-c'],
	cs:    [CODE, 'so-icon-c'],
	lua:   [CODE, 'so-icon-c'],
	php:   [CODE, 'so-icon-php'],
	sql:   ['database',    'so-icon-json'],
	css:   ['paintbrush',  'so-icon-css'],
	scss:  ['paintbrush',  'so-icon-css'],
	less:  ['paintbrush',  'so-icon-css'],
	html:  ['code',        'so-icon-html'],
	htm:   ['code',        'so-icon-html'],
	xml:   ['code',        'so-icon-html'],
	vue:   ['code',        'so-icon-vue'],
	svelte:['code',        'so-icon-svelte'],
	json:  ['braces',      'so-icon-json'],
	jsonc: ['braces',      'so-icon-json'],
	yaml:  ['braces',      'so-icon-json'],
	yml:   ['braces',      'so-icon-json'],
	toml:  ['braces',      'so-icon-json'],
	md:    ['file-text',   'so-icon-md'],
	mdx:   ['file-text',   'so-icon-md'],
	txt:   ['file-text',   'so-icon-txt'],
	sh:    ['terminal',    'so-icon-sh'],
	bash:  ['terminal',    'so-icon-sh'],
	zsh:   ['terminal',    'so-icon-sh'],
	fish:  ['terminal',    'so-icon-sh'],
	env:   ['lock',        'so-icon-env'],
	png:   ['image',       'so-icon-img'],
	jpg:   ['image',       'so-icon-img'],
	jpeg:  ['image',       'so-icon-img'],
	gif:   ['image',       'so-icon-img'],
	svg:   ['image',       'so-icon-img'],
	webp:  ['image',       'so-icon-img'],
	ico:   ['image',       'so-icon-img'],
};

const DEFAULT_ICON: FileIconSpec = ['file', 'so-icon-default'];

/** Returns the lowercase extension of `name`, or '' when it has none. */
export function extensionOf(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Icon and colour class for a file name. Dotfiles like `.env` use their name as the extension. */
export function fileIcon(name: string): FileIconSpec {
	const ext = extensionOf(name) || (name.startsWith('.') ? name.slice(1).toLowerCase() : '');
	return EXT_ICON[ext] ?? DEFAULT_ICON;
}
