/**
 * Hard numerical limits and timeouts for agent tool discovery and preview operations.
 * Bounded limits prevent runaway disk traversal, memory exhaustion, and slow startup.
 */

export const MAX_PREVIEW_BYTES = 256_000;
export const MAX_RESOURCE_ITEMS = 100;
export const MAX_MCP_SERVERS = 100;
export const MAX_SESSIONS_PER_TOOL = 50;
export const PROBE_TIMEOUT_MS = 2500;
