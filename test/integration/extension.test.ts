/**
 * Integration: extension wiring over a fake Pi API.
 *
 * The harness loads the shipped entry point through the same `on()` calls Pi
 * makes, then drives `session_start` and `before_agent_start` against a real
 * temp project and asserts on the section Pi would render.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import importExtension from "../../src/index.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

interface ContextFile {
	path: string;
	content: string;
}

interface FakePi {
	emit(event: string, data: unknown): void;
	notifications: string[];
}

interface TurnResult {
	sections: Record<string, string>;
	notifications: string[];
}

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-import-integration-"));
}

function writeProject(files: Record<string, string>): string {
	const root = tempDir();
	for (const [relative, content] of Object.entries(files)) {
		const full = join(root, relative);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
	}
	return root;
}

/** The smallest ExtensionAPI pi-import needs: `on()` plus an emit driver. */
function fakePi(cwd: string, trusted = true): FakePi {
	const handlers = new Map<string, Handler[]>();
	const notifications: string[] = [];
	const api = {
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd,
		hasUI: true,
		isProjectTrusted: () => trusted,
		ui: { notify: (message: string) => notifications.push(message) },
	} as unknown as ExtensionContext;
	importExtension(api);
	return {
		emit(event, data) {
			for (const handler of handlers.get(event) ?? []) handler(data, ctx);
		},
		notifications,
	};
}

function withAgentDir<T>(dir: string, run: () => T): T {
	const previous = process.env["PI_CODING_AGENT_DIR"];
	process.env["PI_CODING_AGENT_DIR"] = dir;
	try {
		return run();
	} finally {
		if (previous === undefined) delete process.env["PI_CODING_AGENT_DIR"];
		else process.env["PI_CODING_AGENT_DIR"] = previous;
	}
}

/** Runs one session_start + before_agent_start cycle and returns the result. */
function turn(cwd: string, agent: string, contextFiles: ContextFile[]): TurnResult {
	const pi = fakePi(cwd);
	const sections: Record<string, string> = {};
	withAgentDir(agent, () => {
		pi.emit("session_start", {});
		pi.emit("before_agent_start", { systemPromptOptions: { contextFiles, sections } });
	});
	return { sections, notifications: pi.notifications };
}

test("replaces project_context with the Claude Code memory text when an import resolves", () => {
	const root = writeProject({ "AGENTS.md": "@child.md\n", "child.md": "child\n" });
	const { sections } = turn(root, tempDir(), [{ path: join(root, "AGENTS.md"), content: "@child.md\n" }]);
	const text = sections["project_context"] ?? "";
	assert.ok(text.startsWith("<system-reminder>\nCodebase and user instructions are shown below."));
	assert.ok(text.endsWith("\n</system-reminder>"));
	const parent = text.indexOf(
		`Contents of ${join(root, "AGENTS.md")} (project instructions, checked into the codebase):`,
	);
	const child = text.indexOf(
		`Contents of ${join(root, "child.md")} (project instructions, checked into the codebase):`,
	);
	assert.ok(parent > -1 && child > parent);
});

test("leaves project_context untouched when no import resolves", () => {
	const root = writeProject({ "AGENTS.md": "plain instructions\n" });
	const { sections } = turn(root, tempDir(), [{ path: join(root, "AGENTS.md"), content: "plain instructions\n" }]);
	assert.deepEqual(sections, {});
});

test("honors wrapper none from the global config", () => {
	const agent = tempDir();
	writeFileSync(join(agent, "pi-import.json"), '{"wrapper": "none"}');
	const root = writeProject({ "AGENTS.md": "@child.md\n", "child.md": "child\n" });
	const { sections } = turn(root, agent, [{ path: join(root, "AGENTS.md"), content: "@child.md\n" }]);
	const text = sections["project_context"] ?? "";
	assert.ok(text.startsWith("Codebase and user instructions are shown below."));
	assert.ok(!text.includes("<system-reminder>"));
});

test("does nothing when disabled", () => {
	const agent = tempDir();
	writeFileSync(join(agent, "pi-import.json"), '{"enabled": false}');
	const root = writeProject({ "AGENTS.md": "@child.md\n", "child.md": "child\n" });
	const { sections } = turn(root, agent, [{ path: join(root, "AGENTS.md"), content: "@child.md\n" }]);
	assert.deepEqual(sections, {});
});

test("classifies the agent directory file as user", () => {
	const agent = writeProject({ "AGENTS.md": "prefs\n@child.md\n", "child.md": "shared\n" });
	const { sections } = turn(tempDir(), agent, [{ path: join(agent, "AGENTS.md"), content: "prefs\n@child.md\n" }]);
	const text = sections["project_context"] ?? "";
	assert.ok(
		text.includes(`Contents of ${join(agent, "AGENTS.md")} (user's private global instructions for all projects):`),
	);
	assert.ok(
		text.includes(`Contents of ${join(agent, "child.md")} (user's private global instructions for all projects):`),
	);
});

test("notifies config warnings on session_start", () => {
	const agent = tempDir();
	writeFileSync(join(agent, "pi-import.json"), "{ not json");
	const { notifications } = turn(tempDir(), agent, []);
	assert.equal(notifications.length, 1);
	assert.match(notifications[0] ?? "", /^pi-import: /);
});
