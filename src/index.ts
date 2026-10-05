/**
 * pi-import — Claude Code compatible `@path` imports for Pi context files.
 *
 * Pi loads context files (AGENTS.md, CLAUDE.md, ...) into the
 * `project_context` system prompt section. When one of those files references
 * another file with `@path`, this extension expands the reference and replaces
 * the section with Claude Code's memory text: the context files plus their
 * imports, optionally wrapped in a `<system-reminder>` as Claude Code 2.1.287
 * does. Without a resolved import the extension leaves Pi's prompt alone.
 *
 * Config files: `~/.pi/agent/pi-import.json` (or `$PI_CODING_AGENT_DIR/...`)
 * and `<cwd>/.pi/pi-import.json` for trusted projects. See README.md.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { agentDir, DEFAULT_CONFIG, type ImportConfig, loadImportConfig } from "./config.ts";
import { expandContextFiles } from "./expand.ts";
import { formatMemory, wrapMemory } from "./format.ts";

export default function importExtension(pi: ExtensionAPI): void {
	let config: ImportConfig = DEFAULT_CONFIG;

	const reload = (ctx: ExtensionContext): void => {
		const loaded = loadImportConfig(ctx.cwd, ctx.isProjectTrusted());
		config = loaded.config;
		if (ctx.hasUI) {
			for (const warning of loaded.warnings) ctx.ui.notify(`pi-import: ${warning}`, "warning");
		}
	};

	pi.on("session_start", (_event, ctx) => {
		reload(ctx);
	});

	pi.on("before_agent_start", (event) => {
		if (!config.enabled) return;
		const { entries, importCount } = expandContextFiles(event.systemPromptOptions.contextFiles, agentDir());
		if (importCount === 0) return;
		event.systemPromptOptions.sections["project_context"] = wrapMemory(formatMemory(entries), config.wrapper);
	});
}
