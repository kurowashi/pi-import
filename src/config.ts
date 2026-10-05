/**
 * Config discovery for pi-import.
 *
 * The global file is `<agent dir>/pi-import.json`; the project file is
 * `<cwd>/.pi/pi-import.json` and is only read when the project is trusted.
 * The project file overrides the global one field by field.
 *
 * Invalid JSON or invalid values fall back to the default with a warning, so a
 * broken config never breaks a session. Unknown keys are ignored.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Wrapper } from "./format.ts";

export interface ImportConfig {
	/** Master switch. When false the extension leaves Pi's prompt untouched. */
	enabled: boolean;
	/** `system-reminder` matches Claude Code 2.1.287; `none` injects the text alone. */
	wrapper: Wrapper;
}

export const DEFAULT_CONFIG: ImportConfig = {
	enabled: true,
	wrapper: "system-reminder",
};

export interface LoadedImportConfig {
	config: ImportConfig;
	warnings: string[];
	globalFile: string;
	projectFile: string;
}

const CONFIG_FILE_NAME = "pi-import.json";
const PROJECT_CONFIG_DIR = ".pi";

/**
 * The Pi agent directory. Mirrors `getAgentDir()` in Pi so the extension can
 * stay free of runtime imports from the host package.
 */
export function agentDir(): string {
	const override = process.env["PI_CODING_AGENT_DIR"]?.trim();
	return override !== undefined && override !== "" ? override : join(homedir(), ".pi", "agent");
}

function globalConfigPath(): string {
	return join(agentDir(), CONFIG_FILE_NAME);
}

export function projectConfigPath(cwd: string): string {
	return join(cwd, PROJECT_CONFIG_DIR, CONFIG_FILE_NAME);
}

/** Loads and merges the global and (trusted) project config. */
export function loadImportConfig(cwd: string, trusted: boolean): LoadedImportConfig {
	const globalFile = globalConfigPath();
	const projectFile = projectConfigPath(cwd);
	const warnings: string[] = [];
	const raws: Record<string, unknown>[] = [];

	const globalRead = readConfigFile(globalFile);
	if (globalRead.warning !== undefined) warnings.push(globalRead.warning);
	if (globalRead.value !== undefined) raws.push(globalRead.value);

	if (existsSync(projectFile)) {
		if (trusted) {
			const projectRead = readConfigFile(projectFile);
			if (projectRead.warning !== undefined) warnings.push(projectRead.warning);
			if (projectRead.value !== undefined) raws.push(projectRead.value);
		} else {
			warnings.push(`ignoring ${projectFile}: project is not trusted`);
		}
	}

	return { config: resolveConfig(raws, warnings), warnings, globalFile, projectFile };
}

/** Validates raw config objects (lowest precedence first) into a full config. */
function resolveConfig(raws: readonly Record<string, unknown>[], warnings: string[]): ImportConfig {
	const raw: Record<string, unknown> = Object.assign({}, ...raws);
	return {
		enabled: booleanOr(raw["enabled"], "enabled", DEFAULT_CONFIG.enabled, warnings),
		wrapper: wrapperOr(raw["wrapper"], warnings),
	};
}

function booleanOr(value: unknown, key: string, fallback: boolean, warnings: string[]): boolean {
	if (value === undefined) return fallback;
	if (typeof value === "boolean") return value;
	warnings.push(`${key} must be a boolean; using ${fallback}`);
	return fallback;
}

function wrapperOr(value: unknown, warnings: string[]): Wrapper {
	if (value === undefined) return DEFAULT_CONFIG.wrapper;
	if (value === "system-reminder" || value === "none") return value;
	warnings.push(`wrapper must be "system-reminder" or "none"; using ${DEFAULT_CONFIG.wrapper}`);
	return DEFAULT_CONFIG.wrapper;
}

function readConfigFile(file: string): { value?: Record<string, unknown>; warning?: string } {
	if (!existsSync(file)) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		return { warning: `cannot read or parse ${file}: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { warning: `${file} must contain a JSON object` };
	}
	return { value: parsed as Record<string, unknown> };
}
