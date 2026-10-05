import type SourceObserverPlugin from '../main';
import { CodeEmbed } from '../ui/embed/CodeEmbed';
import { normalizeFolderInput } from '../utils/paths';
import { EMBED_LANGUAGE, LINK_ACTION, locationFromParams, parseEmbed } from './sourceLink';

/** Registers `obsidian://source-observer` links and ```source-observer embeds. */
export function registerLinks(plugin: SourceObserverPlugin) {
	plugin.registerObsidianProtocolHandler(LINK_ACTION, (params) => {
		const loc = locationFromParams(params);
		if (loc) void plugin.openLocation(loc);
	});

	plugin.registerMarkdownCodeBlockProcessor(EMBED_LANGUAGE, (source, el, ctx) => {
		const spec = parseEmbed(source, normalizeFolderInput);
		if ('error' in spec) {
			el.createDiv({ cls: 'so-embed so-embed-message so-embed-error', text: spec.error });
			return;
		}
		ctx.addChild(new CodeEmbed(el, spec, (loc) => { void plugin.openLocation(loc); }));
	});
}
