export interface ValidationResult {
  valid: boolean;
  error?: string;
  segments?: string[];
}

/**
 * Parses command string into segments split by |, ||, &&, ;, respecting single and double quotes.
 */
function splitCommandSegments(command: string): { segments?: string[]; error?: string } {
  const segments: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let isEscaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (isEscaped) {
      current += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      isEscaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === ";") {
        if (current.trim()) segments.push(current.trim());
        current = "";
        continue;
      }
      if (char === "|" && command[i + 1] === "|") {
        if (current.trim()) segments.push(current.trim());
        current = "";
        i++;
        continue;
      }
      if (char === "|") {
        if (current.trim()) segments.push(current.trim());
        current = "";
        continue;
      }
      if (char === "&" && command[i + 1] === "&") {
        if (current.trim()) segments.push(current.trim());
        current = "";
        i++;
        continue;
      }
      if (char === "&" && (command[i + 1] === ">" || command[i + 1] === "1" || command[i + 1] === "2")) {
        // e.g. &>/dev/null or >&1
      } else if (i > 0 && command[i - 1] === ">") {
        // e.g. 2>&1
      } else if (char === "&") {
        return { error: "Background execution ('&') is forbidden in search commands." };
      }
      if (char === ">") {
        let nextIndex = i + 1;
        if (command[nextIndex] === ">") nextIndex++;
        while (nextIndex < command.length && /\s/.test(command[nextIndex])) nextIndex++;
        const target = command.slice(nextIndex);
        const isSafeNull = target.startsWith("/dev/null");
        const isSafeFd = target.startsWith("&1") || target.startsWith("&2");
        if (!isSafeNull && !isSafeFd) {
          return { error: "File write redirections ('>' or '>>') are forbidden in search commands." };
        }
      }
    }

    current += char;
  }

  if (inSingleQuote || inDoubleQuote) {
    return { error: "Unmatched quote in command." };
  }

  if (current.trim()) {
    segments.push(current.trim());
  }

  return { segments };
}

/**
 * Normalizes a regex pattern by automatically prefixing `^\s*` if it does not start with `^`
 * and appending `(?:\b.*|$)` if it does not end with `$`.
 */
export function normalizePattern(pattern: string): string {
  const trimmed = pattern.trim();
  if (!trimmed) return trimmed;

  const hasStart = trimmed.startsWith("^");
  const hasEnd = trimmed.endsWith("$");

  if (hasStart && hasEnd) {
    return trimmed;
  }

  const prefix = hasStart ? "" : "^\\s*";
  const suffix = hasEnd ? "" : "(?:\\b.*|$)";
  return `${prefix}(?:${trimmed})${suffix}`;
}

/**
 * Validates that a terminal command is safe for synchronous search execution:
 * 1. Blocks write/append redirections (`>`, `>>`) and command substitutions (`$()`, \`\`).
 * 2. Splits the command across pipeline (`|`) and chaining (`&&`, `||`, `;`) operators (quote-aware).
 * 3. Asserts that every individual command segment matches at least one configured regex whitelist pattern.
 */
export function validateSearchCommand(
  command: string,
  allowedPatterns: string[],
): ValidationResult {
  const trimmed = command.trim();
  if (!trimmed) {
    return { valid: false, error: "Command cannot be empty." };
  }

  // Disallow command substitutions: `$(...)` or backticks
  if (/\$\([^)]*\)/.test(trimmed) || /`[^`]*`/.test(trimmed)) {
    return {
      valid: false,
      error: "Command substitutions ('$()' or backticks) are forbidden in search commands.",
    };
  }

  const splitResult = splitCommandSegments(trimmed);
  if (splitResult.error) {
    return { valid: false, error: splitResult.error };
  }

  const segments = splitResult.segments ?? [];
  if (segments.length === 0) {
    return { valid: false, error: "No executable command segments found." };
  }

  const compiledRegexes: RegExp[] = [];
  for (const pattern of allowedPatterns) {
    try {
      const normalized = normalizePattern(pattern);
      compiledRegexes.push(new RegExp(normalized));
    } catch {
      // Invalid user regex — skip safely to avoid crashing
    }
  }

  if (compiledRegexes.length === 0) {
    return {
      valid: false,
      error: "No valid allowed command patterns configured in settings.",
    };
  }

  for (const segment of segments) {
    const isAllowed = compiledRegexes.some((regex) => regex.test(segment));
    if (!isAllowed) {
      return {
        valid: false,
        error: `Command segment '${segment}' does not match any allowed search pattern in settings.`,
      };
    }
  }

  return { valid: true, segments };
}
