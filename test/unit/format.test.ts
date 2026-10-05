/**
 * Unit: the memory text matches Claude Code 2.1.287 byte for byte.
 *
 * A change here is a change to what the model sees. The golden strings below
 * were taken from a captured API request and the bundled Claude Code binary.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { formatMemory, MEMORY_PROMPT, wrapMemory } from "../../src/format.ts";

test("keeps the fixed preamble identical to Claude Code", () => {
	assert.equal(
		MEMORY_PROMPT,
		"Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.",
	);
});

test("formats one project file with the project description", () => {
	const text = formatMemory([{ path: "/repo/AGENTS.md", content: "# Parent\n", type: "project" }]);
	assert.equal(
		text,
		`${MEMORY_PROMPT}\n\nContents of /repo/AGENTS.md (project instructions, checked into the codebase):\n\n# Parent`,
	);
});

test("formats one user file with the user description", () => {
	const text = formatMemory([{ path: "/home/me/.pi/agent/AGENTS.md", content: "prefs", type: "user" }]);
	assert.equal(
		text,
		`${MEMORY_PROMPT}\n\nContents of /home/me/.pi/agent/AGENTS.md (user's private global instructions for all projects):\n\nprefs`,
	);
});

test("joins entries with a blank line in the given order and trims bodies", () => {
	const text = formatMemory([
		{ path: "/repo/AGENTS.md", content: "parent\n\n", type: "project" },
		{ path: "/repo/child.md", content: "\nchild", type: "project" },
	]);
	assert.equal(
		text,
		[
			MEMORY_PROMPT,
			"",
			"Contents of /repo/AGENTS.md (project instructions, checked into the codebase):",
			"",
			"parent",
			"",
			"Contents of /repo/child.md (project instructions, checked into the codebase):",
			"",
			"child",
		].join("\n"),
	);
});

test("returns an empty string for no entries", () => {
	assert.equal(formatMemory([]), "");
});

test("wraps with system-reminder on demand and leaves none untouched", () => {
	assert.equal(wrapMemory("body", "system-reminder"), "<system-reminder>\nbody\n</system-reminder>");
	assert.equal(wrapMemory("body", "none"), "body");
});
