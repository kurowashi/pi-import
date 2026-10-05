/**
 * Context file expansion: turn Pi's loaded context files into Claude Code's
 * memory entries by resolving their `@path` references.
 *
 * The rules mirror `processMemoryFile` in Claude Code 2.1.287: imports resolve
 * relative to the importing file, at most four hops, every path is processed
 * once per call (which also stops cycles), non-text and oversized files are
 * skipped silently, and includes inherit the including file's memory type.
 */

import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, resolve } from "node:path";
import type { MemoryEntry, MemoryType } from "./format.ts";
import { scanImports, stripForInjection } from "./scan.ts";

/** One context file as loaded by Pi (`systemPromptOptions.contextFiles`). */
export interface ContextFile {
	path: string;
	content: string;
}

export interface ExpandResult {
	/** Memory entries in DFS pre-order: parent first, then its imports. */
	entries: MemoryEntry[];
	/** Number of imported files that resolved; 0 means "leave Pi alone". */
	importCount: number;
}

interface Pending {
	path: string;
	content: string;
}

/** Claude Code allows at most four hops below the context file (depth 0). */
const MAX_DEPTH = 4;

/** Claude Code refuses files above 4 MiB (`vQ` in the bundled code). */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Claude Code's allowed import extensions; extensionless files pass too. */
const TEXT_EXTENSIONS = new Set(
	(
		".md .txt .text .json .yaml .yml .toml .xml .csv .html .htm .css .scss .sass .less " +
		".js .ts .tsx .jsx .mjs .cjs .mts .cts .py .pyi .pyw .rb .erb .rake .go .rs .java .kt .kts .scala " +
		".c .cpp .cc .cxx .h .hpp .hxx .cs .swift .sh .bash .zsh .fish .ps1 .bat .cmd .env .ini .cfg .conf " +
		".config .properties .sql .graphql .gql .proto .vue .svelte .astro .ejs .hbs .pug .jade .php .pl .pm " +
		".lua .r .dart .ex .exs .erl .hrl .clj .cljs .cljc .edn .hs .lhs .elm .ml .mli .f .f90 .f95 .for " +
		".cmake .make .makefile .gradle .sbt .rst .adoc .asciidoc .org .tex .latex .lock .log .diff .patch"
	).split(" "),
);

/** Expands every context file and returns the entries Claude Code would inject. */
export function expandContextFiles(contextFiles: readonly ContextFile[], agentDir: string): ExpandResult {
	const agentRoot = resolve(agentDir);
	const entries: MemoryEntry[] = [];
	const processed = new Set<string>();
	let importCount = 0;

	const readImport = (candidate: string, baseDir: string): Pending | undefined => {
		const absolute = resolveImportPath(candidate, baseDir);
		if (!isTextFile(absolute)) return undefined;
		const key = canonicalKey(absolute);
		if (processed.has(key)) return undefined;
		processed.add(key);
		const content = readTextFile(absolute);
		if (content === undefined || content.trim() === "") return undefined;
		return { path: absolute, content };
	};

	const visit = (path: string, content: string, type: MemoryType, depth: number): void => {
		const body = stripForInjection(content).trim();
		if (body === "") return;
		entries.push({ path, content: body, type });
		if (depth >= MAX_DEPTH) return;
		for (const candidate of scanImports(content)) {
			const imported = readImport(candidate, dirname(path));
			if (imported === undefined) continue;
			importCount += 1;
			visit(imported.path, imported.content, type, depth + 1);
		}
	};

	for (const file of contextFiles) {
		const key = canonicalKey(file.path);
		if (processed.has(key)) continue;
		processed.add(key);
		visit(file.path, file.content, typeOf(file.path, agentRoot), 0);
	}
	return { entries, importCount };
}

/** The agent directory's own context file is "user"; everything else is project. */
function typeOf(path: string, agentRoot: string): MemoryType {
	return dirname(path) === agentRoot ? "user" : "project";
}

/** `~/x` goes to the home directory; everything else resolves against the importer. */
function resolveImportPath(candidate: string, baseDir: string): string {
	if (candidate.startsWith("~/")) return resolve(homedir(), candidate.slice(2));
	return resolve(baseDir, candidate);
}

function isTextFile(path: string): boolean {
	const extension = extname(path).toLowerCase();
	return extension === "" || TEXT_EXTENSIONS.has(extension);
}

/** Dedup and cycle key: the real path when it exists, the absolute path otherwise. */
function canonicalKey(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

/** Reads a regular text file under the size cap; anything else is skipped. */
function readTextFile(path: string): string | undefined {
	try {
		const stats = statSync(path);
		if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return undefined;
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}
