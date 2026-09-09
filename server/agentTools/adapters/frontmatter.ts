export interface ParsedFrontmatter {
  name?: string;
  description?: string;
  model?: string;
  permission?: string[];
  body: string;
}

export function extractFirstParagraph(content: string): string | undefined {
  const lines = content.split(/\r?\n/);
  const paraLines: string[] = [];

  for (const line of lines) {
    const l = line.trim();
    if (!l) {
      if (paraLines.length > 0) break;
      continue;
    }
    // Skip headings, comments, blockquotes, code blocks, or horizontal rules
    if (
      l.startsWith("#") ||
      l.startsWith("<!--") ||
      l.startsWith("```") ||
      l.startsWith("---") ||
      l.startsWith("===") ||
      l.startsWith(">")
    ) {
      continue;
    }
    paraLines.push(l);
  }

  if (paraLines.length === 0) return undefined;
  const combined = paraLines.join(" ");
  return combined.length > 240 ? `${combined.slice(0, 237)}…` : combined;
}

function cleanYamlValue(val: string): string {
  const trimmed = val.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parsePermissionsList(raw: string): string[] {
  let trimmed = raw.trim();
  trimmed = cleanYamlValue(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((s) => cleanYamlValue(s))
      .filter((s) => s.length > 0);
  }
  if (trimmed.includes(",")) {
    return trimmed
      .split(",")
      .map((s) => cleanYamlValue(s))
      .filter((s) => s.length > 0);
  }
  const clean = cleanYamlValue(trimmed);
  return clean ? [clean] : [];
}

export function parseFrontmatter(rawContent: string): ParsedFrontmatter {
  const trimmed = rawContent.trim();
  if (!trimmed.startsWith("---")) {
    return {
      body: rawContent,
      description: extractFirstParagraph(rawContent),
    };
  }

  const endIdx = trimmed.indexOf("\n---", 3);
  if (endIdx === -1) {
    return {
      body: rawContent,
      description: extractFirstParagraph(rawContent),
    };
  }

  const frontmatterText = trimmed.slice(3, endIdx);
  const body = trimmed.slice(endIdx + 4).trim();

  let name: string | undefined;
  let description: string | undefined;
  let model: string | undefined;
  let permission: string[] | undefined;

  const lines = frontmatterText.split(/\r?\n/);
  let currentKey: "name" | "description" | "model" | "permission" | null = null;
  let listAccumulator: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Check if line is a list item under current key
    if (trimmedLine.startsWith("-") && currentKey === "permission") {
      const item = cleanYamlValue(trimmedLine.slice(1).trim());
      if (item) listAccumulator.push(item);
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }

    // Flush previous list accumulator if switching key
    if (currentKey === "permission" && listAccumulator.length > 0) {
      permission = [...listAccumulator];
      listAccumulator = [];
    }

    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const rawVal = line.slice(colonIdx + 1).trim();

    if (key === "name" || key === "title") {
      currentKey = "name";
      name = cleanYamlValue(rawVal);
    } else if (key === "description") {
      currentKey = "description";
      description = cleanYamlValue(rawVal);
    } else if (key === "model" || key === "modelrestriction") {
      currentKey = "model";
      model = cleanYamlValue(rawVal);
    } else if (
      key === "permission" ||
      key === "permissions" ||
      key === "toolrestrictions" ||
      key === "tools"
    ) {
      currentKey = "permission";
      if (rawVal) {
        permission = parsePermissionsList(rawVal);
      } else {
        listAccumulator = [];
      }
    } else {
      currentKey = null;
    }
  }

  if (currentKey === "permission" && listAccumulator.length > 0) {
    permission = [...listAccumulator];
  }

  if (!description && body) {
    description = extractFirstParagraph(body);
  }

  return {
    name,
    description,
    model,
    permission,
    body,
  };
}
