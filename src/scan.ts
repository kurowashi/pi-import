/**
 * Markdown scanning for Claude Code compatible `@path` imports.
 *
 * Claude Code lexes a memory file with marked and extracts `@path` references
 * from text tokens only: code spans, fenced code blocks, and HTML comments are
 * skipped, and YAML frontmatter is removed before both scanning and injection.
 * This module reproduces that behavior with small line-based rules instead of a
 * Markdown parser dependency.
 *
 * Known divergences from marked, documented in DESIGN.md:
 * - An `@` after emphasis delimiters (`**@file**`) is not extracted because the
 *   character before `@` is not whitespace.
 * - Indented code blocks (4 spaces) are not excluded; only fenced blocks are.
 * - Inline code spans and unclosed `<!--` comments that span lines are not
 *   handled; multi-line block comments are.
 */

/** Claude Code's frontmatter rule (`parseFrontmatter`). */
const FRONTMATTER = /^---\s*\n([\s\S]*?)---\s*\n?/;

/** Claude Code's include rule, applied to text outside code and comments. */
const IMPORT = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;

const COMMENT_SPAN = /<!--[\s\S]*?-->/g;

const BLOCK_COMMENT = /^[ \t]*<!--[\s\S]*?-->/gm;

const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})/;

const CODE_SPAN = /(`+)[\s\S]*?\1/g;

/**
 * The `@path` references Claude Code would expand from this markdown, in
 * document order, with `#fragment` removed and `\ ` unescaped.
 *
 * Duplicates are not removed here; expansion deduplicates by resolved path.
 */
export function scanImports(content: string): string[] {
	if (!content.includes("@")) return [];
	const body = removeFencedBlocks(removeCommentSpans(stripFrontmatter(content)));
	const paths: string[] = [];
	for (const line of body.split("\n")) {
		paths.push(...extractCandidates(line.replace(CODE_SPAN, " ")));
	}
	return paths;
}

/**
 * The content Claude Code injects for a file: frontmatter and block-level HTML
 * comments removed, everything else left as written.
 */
export function stripForInjection(content: string): string {
	return stripFrontmatter(content).replace(BLOCK_COMMENT, "");
}

/** Removes YAML frontmatter, matching `parseFrontmatter` in Claude Code. */
function stripFrontmatter(content: string): string {
	return content.replace(FRONTMATTER, "");
}

/**
 * Removes every closed comment span before scanning. Unclosed spans are left
 * as written, so a stray `<!--` cannot swallow the rest of the file.
 */
function removeCommentSpans(text: string): string {
	if (!text.includes("<!--")) return text;
	return text.replace(COMMENT_SPAN, " ");
}

/** Drops fenced code blocks, including the fence lines themselves. */
function removeFencedBlocks(body: string): string {
	if (!body.includes("```") && !body.includes("~~~")) return body;
	const kept: string[] = [];
	let fence: string | undefined;
	for (const line of body.split("\n")) {
		const marker = line.match(OPENING_FENCE)?.[1];
		if (fence === undefined) {
			if (marker !== undefined) fence = marker;
			else kept.push(line);
			continue;
		}
		if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
	}
	return kept.join("\n");
}

/**
 * True for the path shapes Claude Code accepts: `./x`, `~/x`, `/x`, or a bare
 * path starting with a letter, digit, dot, underscore, or hyphen.
 */
function isValidImportPath(path: string): boolean {
	if (path.startsWith("./") || path.startsWith("~/")) return true;
	if (path.startsWith("/") && path !== "/") return true;
	return !path.startsWith("@") && !/^[#%^&*()]+/.test(path) && /^[a-zA-Z0-9._-]/.test(path);
}

function extractCandidates(text: string): string[] {
	const paths: string[] = [];
	for (const match of text.matchAll(new RegExp(IMPORT.source, "g"))) {
		let path = match[1] ?? "";
		path = path.split("#", 1)[0] ?? "";
		path = path.replaceAll("\\ ", " ");
		if (path !== "" && isValidImportPath(path)) paths.push(path);
	}
	return paths;
}
