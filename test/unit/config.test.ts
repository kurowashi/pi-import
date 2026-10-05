/**
 * Unit: config discovery, merging, and validation.
 *
 * A broken or hostile config must never break a session: every invalid value
 * falls back to a default and produces one warning.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { agentDir, DEFAULT_CONFIG, loadImportConfig, projectConfigPath } from "../../src/config.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-import-config-"));
}

function writeJson(file: string, content: string): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
}

function withAgentDir(dir: string, run: () => void): void {
	const previous = process.env["PI_CODING_AGENT_DIR"];
	process.env["PI_CODING_AGENT_DIR"] = dir;
	try {
		run();
	} finally {
		if (previous === undefined) delete process.env["PI_CODING_AGENT_DIR"];
		else process.env["PI_CODING_AGENT_DIR"] = previous;
	}
}

test("uses the defaults when no config file exists", () => {
	const agent = tempDir();
	const cwd = tempDir();
	withAgentDir(agent, () => {
		const loaded = loadImportConfig(cwd, true);
		assert.deepEqual(loaded.config, DEFAULT_CONFIG);
		assert.deepEqual(loaded.warnings, []);
		assert.equal(loaded.globalFile, join(agent, "pi-import.json"));
		assert.equal(loaded.projectFile, projectConfigPath(cwd));
	});
});

test("reads the global file", () => {
	const agent = tempDir();
	writeJson(join(agent, "pi-import.json"), '{"enabled": false, "wrapper": "none"}');
	withAgentDir(agent, () => {
		const loaded = loadImportConfig(tempDir(), true);
		assert.deepEqual(loaded.config, { enabled: false, wrapper: "none" });
		assert.deepEqual(loaded.warnings, []);
	});
});

test("lets the trusted project file override individual fields", () => {
	const agent = tempDir();
	const cwd = tempDir();
	writeJson(join(agent, "pi-import.json"), '{"enabled": false, "wrapper": "none"}');
	writeJson(projectConfigPath(cwd), '{"enabled": true}');
	withAgentDir(agent, () => {
		assert.deepEqual(loadImportConfig(cwd, true).config, { enabled: true, wrapper: "none" });
	});
});

test("ignores the project file and warns when the project is not trusted", () => {
	const agent = tempDir();
	const cwd = tempDir();
	writeJson(projectConfigPath(cwd), '{"wrapper": "none"}');
	withAgentDir(agent, () => {
		const loaded = loadImportConfig(cwd, false);
		assert.deepEqual(loaded.config, DEFAULT_CONFIG);
		assert.equal(loaded.warnings.length, 1);
		assert.match(loaded.warnings[0] ?? "", /not trusted/);
	});
});

test("falls back to defaults and warns on invalid JSON", () => {
	const agent = tempDir();
	writeJson(join(agent, "pi-import.json"), "{ not json");
	withAgentDir(agent, () => {
		const loaded = loadImportConfig(tempDir(), true);
		assert.deepEqual(loaded.config, DEFAULT_CONFIG);
		assert.equal(loaded.warnings.length, 1);
	});
});

test("falls back to defaults and warns on a non-object config", () => {
	const agent = tempDir();
	writeJson(join(agent, "pi-import.json"), "[]");
	withAgentDir(agent, () => {
		const loaded = loadImportConfig(tempDir(), true);
		assert.deepEqual(loaded.config, DEFAULT_CONFIG);
		assert.equal(loaded.warnings.length, 1);
	});
});

test("falls back to the default wrapper and warns on an unknown value", () => {
	const agent = tempDir();
	const cwd = tempDir();
	writeJson(join(agent, "pi-import.json"), '{"wrapper": "wrapped", "future": 1}');
	withAgentDir(agent, () => {
		const loaded = loadImportConfig(cwd, true);
		assert.deepEqual(loaded.config, DEFAULT_CONFIG);
		assert.equal(loaded.warnings.length, 1);
		assert.match(loaded.warnings[0] ?? "", /wrapper/);
	});
});

test("resolves the agent directory from the env override or the home fallback", () => {
	const override = tempDir();
	withAgentDir(override, () => assert.equal(agentDir(), override));
	const previous = process.env["PI_CODING_AGENT_DIR"];
	delete process.env["PI_CODING_AGENT_DIR"];
	try {
		assert.equal(agentDir(), join(homedir(), ".pi", "agent"));
	} finally {
		if (previous !== undefined) process.env["PI_CODING_AGENT_DIR"] = previous;
	}
});
