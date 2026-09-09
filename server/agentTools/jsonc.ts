/**
 * Safe parser for JSON with comments (JSONC) and trailing commas.
 * Uses json5 to support single-line and multi-line comments in configuration files
 * such as OpenCode opencode.json and Claude Desktop claude_desktop_config.json.
 */

import { parse as parseJson5 } from "json5";

export function parseJsonc(content: string): unknown {
  try {
    return parseJson5(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`JSONC parse error: ${message}`);
  }
}

export function safeParseJsonc(
  content: string
): { ok: true; data: unknown } | { ok: false; error: string } {
  try {
    const data = parseJson5(content);
    return { ok: true, data };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}
