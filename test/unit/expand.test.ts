/**
 * Unit: filesystem expansion of `@path` imports.
 *
 * Each case mirrors a behavior verified against Claude Code 2.1.287: DFS
 * order, the four-hop limit, global dedup, extension and size limits, and the
 * user/project split driven by the Pi agent directory.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ContextFile } from "../../src/expand.ts";
import { expandContextFiles } from "../../src/expand.ts";

/** Creates a temp project directory from `relative path -> content` pairs. */
function project(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "pi-import-"));
	for (const [relative, content] of Object.entries(files)) {
		const full = join(root, relative);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
	}
	return root;
}

function contextFile(path: string, content: string): ContextFile {
	return { path, content };
}

test("expands imports in DFS pre-order with dedup across parents", () => {
	const root = project({
		"AGENTS.md": "# Parent\n\n@x.md\n@y.md\n",
		"x.md": "X\n\n@z.md\n",
		"y.md": "Y\n@z.md\n",
		"z.md": "Z\n",
	});
	const result = expandContextFiles(
		[contextFile(join(root, "AGENTS.md"), "# Parent\n\n@x.md\n@y.md\n")],
		join(root, "agent"),
	);
	assert.deepEqual(
		result.entries.map((entry) => entry.path),
		[join(root, "AGENTS.md"), join(root, "x.md"), join(root, "z.md"), join(root, "y.md")],
	);
	assert.equal(result.importCount, 3);
});

test("stops after four hops below the context file", () => {
	const root = project({
		"AGENTS.md": "@a.md\n",
		"a.md": "@b.md\n",
		"b.md": "@c.md\n",
		"c.md": "@d.md\n",
		"d.md": "@e.md\n",
		"e.md": "E\n",
	});
	const result = expandContextFiles([contextFile(join(root, "AGENTS.md"), "@a.md\n")], join(root, "agent"));
	assert.deepEqual(
		result.entries.map((entry) => entry.path),
		[join(root, "AGENTS.md"), join(root, "a.md"), join(root, "b.md"), join(root, "c.md"), join(root, "d.md")],
	);
	assert.equal(result.importCount, 4);
});

test("stops cycles and repeated references", () => {
	const root = project({
		"AGENTS.md": "@a.md\n@a.md\n",
		"a.md": "@AGENTS.md\n",
	});
	const result = expandContextFiles([contextFile(join(root, "AGENTS.md"), "@a.md\n@a.md\n")], join(root, "agent"));
	assert.deepEqual(
		result.entries.map((entry) => entry.path),
		[join(root, "AGENTS.md"), join(root, "a.md")],
	);
	assert.equal(result.importCount, 1);
});

test("resolves nested imports from the imported file's directory", () => {
	const root = project({
		"AGENTS.md": "@d/a.md\n",
		"d/a.md": "@b.md\n",
		"d/b.md": "nested\n",
	});
	const result = expandContextFiles([contextFile(join(root, "AGENTS.md"), "@d/a.md\n")], join(root, "agent"));
	assert.deepEqual(
		result.entries.map((entry) => entry.path),
		[join(root, "AGENTS.md"), join(root, "d/a.md"), join(root, "d/b.md")],
	);
});

test("skips non-text extensions and accepts extensionless files", () => {
	const root = project({
		"AGENTS.md": "@child.png\n@logo.svg\n@Makefile\n",
		"child.png": "png\n",
		"logo.svg": "svg\n",
		Makefile: "build:\n",
	});
	const result = expandContextFiles(
		[contextFile(join(root, "AGENTS.md"), "@child.png\n@logo.svg\n@Makefile\n")],
		join(root, "agent"),
	);
	assert.deepEqual(
		result.entries.map((entry) => entry.path),
		[join(root, "AGENTS.md"), join(root, "Makefile")],
	);
	assert.equal(result.importCount, 1);
});

test("skips missing files, directories, and empty files", () => {
	const root = project({
		"AGENTS.md": "@missing.md\n@adir\n@empty.md\n@child.md\n",
		"empty.md": "",
		"child.md": "ok\n",
	});
	mkdirSync(join(root, "adir"));
	const result = expandContextFiles(
		[contextFile(join(root, "AGENTS.md"), "@missing.md\n@adir\n@empty.md\n@child.md\n")],
		join(root, "agent"),
	);
	assert.deepEqual(
		result.entries.map((entry) => entry.path),
		[join(root, "AGENTS.md"), join(root, "child.md")],
	);
	assert.equal(result.importCount, 1);
});

test("skips files above the four mebibyte cap", () => {
	const root = project({ "AGENTS.md": "@big.md\n@small.md\n", "small.md": "small\n" });
	writeFileSync(join(root, "big.md"), "x".repeat(4 * 1024 * 1024 + 1));
	const result = expandContextFiles(
		[contextFile(join(root, "AGENTS.md"), "@big.md\n@small.md\n")],
		join(root, "agent"),
	);
	assert.deepEqual(
		result.entries.map((entry) => entry.path),
		[join(root, "AGENTS.md"), join(root, "small.md")],
	);
	assert.equal(result.importCount, 1);
});

test("classifies the agent directory file as user and inherits its type", () => {
	const root = project({
		"agent/AGENTS.md": "user prefs\n@child.md\n",
		"agent/child.md": "shared\n",
		"AGENTS.md": "project\n",
	});
	const result = expandContextFiles(
		[
			contextFile(join(root, "agent/AGENTS.md"), "user prefs\n@child.md\n"),
			contextFile(join(root, "AGENTS.md"), "project\n"),
		],
		join(root, "agent"),
	);
	assert.deepEqual(
		result.entries.map((entry) => ({ path: entry.path, type: entry.type })),
		[
			{ path: join(root, "agent/AGENTS.md"), type: "user" },
			{ path: join(root, "agent/child.md"), type: "user" },
			{ path: join(root, "AGENTS.md"), type: "project" },
		],
	);
	assert.equal(result.importCount, 1);
});

test("deduplicates the same context file and deduplicates symlinks by real path", () => {
	const root = project({
		"AGENTS.md": "@target.md\n@link.md\n",
		"target.md": "target\n",
	});
	symlinkSync(join(root, "target.md"), join(root, "link.md"));
	const file = contextFile(join(root, "AGENTS.md"), "@target.md\n@link.md\n");
	const result = expandContextFiles([file, file], join(root, "agent"));
	assert.deepEqual(
		result.entries.map((entry) => entry.path),
		[join(root, "AGENTS.md"), join(root, "target.md")],
	);
	assert.equal(result.importCount, 1);
});

test("strips frontmatter and block comments from injected bodies", () => {
	const root = project({
		"AGENTS.md": "---\ntitle: x\n---\n@child.md\n",
		"child.md": "---\ntitle: y\n---\n<!-- note -->\nbody\n",
	});
	const result = expandContextFiles(
		[contextFile(join(root, "AGENTS.md"), "---\ntitle: x\n---\n@child.md\n")],
		join(root, "agent"),
	);
	assert.deepEqual(
		result.entries.map((entry) => entry.content),
		["@child.md", "body"],
	);
});

test("returns nothing for empty input", () => {
	assert.deepEqual(expandContextFiles([], "/agent"), { entries: [], importCount: 0 });
});
