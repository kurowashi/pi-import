/**
 * Claude Code's memory prompt formatting.
 *
 * These strings match Claude Code 2.1.287 exactly. They were verified from the
 * bundled JavaScript of the installed binary and from a captured API request,
 * and the tests pin them as golden values.
 */

export type MemoryType = "project" | "user";

/** How the memory text is delimited before it reaches the model. */
export type Wrapper = "system-reminder" | "none";

export interface MemoryEntry {
	path: string;
	content: string;
	type: MemoryType;
}

/** The fixed preamble Claude Code puts in front of every memory text. */
export const MEMORY_PROMPT =
	"Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.";

const DESCRIPTION: Record<MemoryType, string> = {
	project: " (project instructions, checked into the codebase)",
	user: " (user's private global instructions for all projects)",
};

/**
 * Formats memory entries exactly as Claude Code does, without the wrapper.
 * Entries are joined by a blank line; the text has no trailing newline.
 */
export function formatMemory(entries: readonly MemoryEntry[]): string {
	const blocks = entries.map(
		(entry) => `Contents of ${entry.path}${DESCRIPTION[entry.type]}:\n\n${entry.content.trim()}`,
	);
	if (blocks.length === 0) return "";
	return `${MEMORY_PROMPT}\n\n${blocks.join("\n\n")}`;
}

/** Applies the configured wrapper around a non-empty memory text. */
export function wrapMemory(text: string, wrapper: Wrapper): string {
	return wrapper === "system-reminder" ? `<system-reminder>\n${text}\n</system-reminder>` : text;
}
