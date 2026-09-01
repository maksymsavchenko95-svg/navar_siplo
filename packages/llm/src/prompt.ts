import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Load a versioned prompt file (`INT-LLM-002` — prompts live in git, not inline, not in the
 * DB). Files are `./prompts/<name>.v<n>.md`; the version string (`<name>.v<n>`) is written
 * into every trace and pinned by the golden tests. A prompt change is a new `.v<n+1>.md`
 * file plus a bumped `loadPrompt(..., n+1)` call — old versions stay for trace history.
 */
export interface LoadedPrompt {
  text: string;
  version: string;
}

export function loadPrompt(name: string, version: number): LoadedPrompt {
  const file = fileURLToPath(new URL(`./prompts/${name}.v${version}.md`, import.meta.url));
  return { text: readFileSync(file, "utf8").trim(), version: `${name}.v${version}` };
}
