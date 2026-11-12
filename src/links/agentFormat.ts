import { fenceFor, fenceLanguage, formatLines, LineRange } from './sourceLink';

/**
 * Code cited for a coding agent, such as Claude Code, running in a terminal.
 * Agents resolve paths against their working directory, usually the
 * repository root, so `path` is repository-relative (or absolute outside a
 * repository) rather than relative to the folder opened in the viewer.
 */
export interface AgentCitation {
	path: string;
	lines: LineRange | null;
	/** Which version the lines come from when it is not the file on disk, e.g. `@ a1b2c3d`. */
	revision: string | null;
}

/** Ways to copy code for an agent: just where it is, or where it is plus the code. */
export type AgentFormat = 'reference' | 'snippet';

export const AGENT_FORMATS: { format: AgentFormat; title: string; icon: string }[] = [
	{ format: 'reference', title: 'Copy reference', icon: 'at-sign' },
	{ format: 'snippet', title: 'Copy for agent', icon: 'terminal' },
];

/** `src/a.ts:10-20`, followed by the revision when there is one. */
export function agentReference(citation: AgentCitation): string {
	const location = citation.lines ? `${citation.path}:${formatLines(citation.lines)}` : citation.path;
	return citation.revision ? `${location} ${citation.revision}` : location;
}

/** The reference on its own line, then `text` as a fenced code block. */
export function agentSnippet(citation: AgentCitation, text: string): string {
	const fence = fenceFor(text);
	const body = text.endsWith('\n') ? text.slice(0, -1) : text;
	return `${agentReference(citation)}\n${fence}${fenceLanguage(citation.path)}\n${body}\n${fence}`;
}

export function formatForAgent(format: AgentFormat, citation: AgentCitation, text: string): string {
	return format === 'reference' ? agentReference(citation) : agentSnippet(citation, text);
}

/** One `path:line` per line, e.g. for search results. */
export function referenceList(refs: { path: string; line: number }[]): string {
	return refs.map((r) => `${r.path}:${r.line}`).join('\n');
}
