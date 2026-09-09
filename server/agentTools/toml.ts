/**
 * Clean, robust TOML parser without external runtime dependencies.
 * Parses sections, dotted keys, quoted keys, basic/literal strings, multiline strings,
 * booleans, numbers, arrays, inline tables, and comments.
 *
 * Used for discovering configuration files like Codex config.toml.
 */

export function parseToml(content: string): Record<string, unknown> {
  const parser = new TomlParser(content);
  return parser.parse();
}

export function safeParseToml(
  content: string
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const data = parseToml(content);
    return { ok: true, data };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}

class TomlParser {
  private readonly input: string;
  private pos = 0;

  constructor(input: string) {
    this.input = input;
  }

  public parse(): Record<string, unknown> {
    const root: Record<string, unknown> = {};
    let currentTable: Record<string, unknown> = root;

    while (!this.isEof()) {
      this.skipSpacesAndTabs();
      if (this.isEof()) break;

      const ch = this.peek();
      if (ch === "\r" || ch === "\n") {
        this.next();
        continue;
      }
      if (ch === "#") {
        this.skipComment();
        continue;
      }

      if (ch === "[") {
        if (this.peekAt(1) === "[") {
          // Array of tables [[table.name]]
          this.next();
          this.next();
          this.skipSpacesAndTabs();
          const keys = this.parseKey();
          this.skipSpacesAndTabs();
          if (this.peek() !== "]" || this.peekAt(1) !== "]") {
            throw this.error("Expected ']]' to close array of tables header");
          }
          this.next();
          this.next();
          this.assertEndOfLine("after array table header");
          currentTable = this.getOrCreateArrayTable(root, keys);
        } else {
          // Standard table [table.name]
          this.next();
          this.skipSpacesAndTabs();
          const keys = this.parseKey();
          this.skipSpacesAndTabs();
          if (this.peek() !== "]") {
            throw this.error("Expected ']' to close table header");
          }
          this.next();
          this.assertEndOfLine("after table header");
          currentTable = this.getOrCreateTable(root, keys);
        }
        continue;
      }

      // Key-value pair
      const keys = this.parseKey();
      this.skipSpacesAndTabs();
      if (this.peek() !== "=") {
        throw this.error(`Expected '=' after key '${keys.join(".")}'`);
      }
      this.next();
      this.skipSpacesAndTabs();
      const value = this.parseValue();
      this.setNested(currentTable, keys, value);
      this.skipSpacesAndTabs();
      this.assertEndOfLine(`after value for key '${keys.join(".")}'`);
    }

    return root;
  }

  private isEof(): boolean {
    return this.pos >= this.input.length;
  }

  private peek(): string {
    return this.input[this.pos] ?? "";
  }

  private peekAt(offset: number): string {
    return this.input[this.pos + offset] ?? "";
  }

  private next(): string {
    const ch = this.peek();
    this.pos++;
    return ch;
  }

  private error(message: string): Error {
    let line = 1;
    let lastNewline = -1;
    for (let i = 0; i < this.pos && i < this.input.length; i++) {
      if (this.input[i] === "\n") {
        line++;
        lastNewline = i;
      }
    }
    const col = this.pos - lastNewline;
    return new Error(`TOML parse error at line ${line}, col ${col}: ${message}`);
  }

  private skipSpacesAndTabs(): void {
    while (!this.isEof()) {
      const ch = this.peek();
      if (ch === " " || ch === "\t") {
        this.next();
      } else {
        break;
      }
    }
  }

  private skipComment(): void {
    while (!this.isEof()) {
      const ch = this.next();
      if (ch === "\n") break;
    }
  }

  private skipWhitespaceAndComments(): void {
    while (!this.isEof()) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.next();
      } else if (ch === "#") {
        this.skipComment();
      } else {
        break;
      }
    }
  }

  private assertEndOfLine(context: string): void {
    this.skipSpacesAndTabs();
    if (this.isEof()) return;
    const ch = this.peek();
    if (ch === "#") {
      this.skipComment();
      return;
    }
    if (ch === "\r" || ch === "\n") {
      this.next();
      return;
    }
    throw this.error(`Unexpected token '${ch}' ${context}`);
  }

  private parseKey(): string[] {
    const keys: string[] = [];

    while (true) {
      this.skipSpacesAndTabs();
      const ch = this.peek();
      let keySegment = "";

      if (ch === '"') {
        keySegment = this.parseBasicString();
      } else if (ch === "'") {
        keySegment = this.parseLiteralString();
      } else {
        // Bare key [A-Za-z0-9_-]+
        const start = this.pos;
        while (!this.isEof()) {
          const c = this.peek();
          if (
            (c >= "a" && c <= "z") ||
            (c >= "A" && c <= "Z") ||
            (c >= "0" && c <= "9") ||
            c === "_" ||
            c === "-"
          ) {
            this.next();
          } else {
            break;
          }
        }
        if (this.pos === start) {
          throw this.error(`Expected key name, encountered '${this.peek()}'`);
        }
        keySegment = this.input.slice(start, this.pos);
      }

      keys.push(keySegment);
      this.skipSpacesAndTabs();

      if (this.peek() === ".") {
        this.next();
      } else {
        break;
      }
    }

    return keys;
  }

  private parseValue(): unknown {
    this.skipSpacesAndTabs();
    const ch = this.peek();

    if (ch === '"') {
      if (this.peekAt(1) === '"' && this.peekAt(2) === '"') {
        return this.parseMultilineBasicString();
      }
      return this.parseBasicString();
    }

    if (ch === "'") {
      if (this.peekAt(1) === "'" && this.peekAt(2) === "'") {
        return this.parseMultilineLiteralString();
      }
      return this.parseLiteralString();
    }

    if (ch === "[") {
      return this.parseArray();
    }

    if (ch === "{") {
      return this.parseInlineTable();
    }

    return this.parseLiteralOrNumber();
  }

  private parseBasicString(): string {
    this.next(); // skip opening quote
    let res = "";

    while (!this.isEof()) {
      const ch = this.next();
      if (ch === '"') {
        return res;
      }
      if (ch === "\n" || ch === "\r") {
        throw this.error("Unescaped newline in single-line basic string");
      }
      if (ch === "\\") {
        if (this.isEof()) throw this.error("Unfinished escape sequence in string");
        const esc = this.next();
        switch (esc) {
          case '"':
            res += '"';
            break;
          case "\\":
            res += "\\";
            break;
          case "b":
            res += "\b";
            break;
          case "f":
            res += "\f";
            break;
          case "n":
            res += "\n";
            break;
          case "r":
            res += "\r";
            break;
          case "t":
            res += "\t";
            break;
          case "u": {
            const hex = this.input.slice(this.pos, this.pos + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw this.error(`Invalid \\u escape sequence: \\u${hex}`);
            }
            this.pos += 4;
            res += String.fromCharCode(parseInt(hex, 16));
            break;
          }
          case "U": {
            const hex = this.input.slice(this.pos, this.pos + 8);
            if (!/^[0-9a-fA-F]{8}$/.test(hex)) {
              throw this.error(`Invalid \\U escape sequence: \\U${hex}`);
            }
            this.pos += 8;
            res += String.fromCodePoint(parseInt(hex, 16));
            break;
          }
          default:
            throw this.error(`Unknown escape sequence: \\${esc}`);
        }
      } else {
        res += ch;
      }
    }

    throw this.error("Unterminated basic string");
  }

  private parseMultilineBasicString(): string {
    this.next(); // "
    this.next(); // "
    this.next(); // "

    // TOML spec: a newline immediately following opening quotes is trimmed
    if (this.peek() === "\r") this.next();
    if (this.peek() === "\n") this.next();

    let res = "";

    while (!this.isEof()) {
      if (this.peek() === '"' && this.peekAt(1) === '"' && this.peekAt(2) === '"') {
        this.next();
        this.next();
        this.next();
        return res;
      }

      const ch = this.next();
      if (ch === "\\") {
        if (this.peek() === "\r" || this.peek() === "\n") {
          // Line-ending backslash trims newline and all following whitespace
          if (this.peek() === "\r") this.next();
          if (this.peek() === "\n") this.next();
          while (!this.isEof()) {
            const c = this.peek();
            if (c === " " || c === "\t" || c === "\r" || c === "\n") {
              this.next();
            } else {
              break;
            }
          }
        } else {
          const esc = this.next();
          switch (esc) {
            case '"':
              res += '"';
              break;
            case "\\":
              res += "\\";
              break;
            case "n":
              res += "\n";
              break;
            case "t":
              res += "\t";
              break;
            case "r":
              res += "\r";
              break;
            default:
              res += "\\" + esc;
          }
        }
      } else {
        res += ch;
      }
    }

    throw this.error("Unterminated multiline basic string");
  }

  private parseLiteralString(): string {
    this.next(); // skip '
    let res = "";

    while (!this.isEof()) {
      const ch = this.next();
      if (ch === "'") {
        return res;
      }
      if (ch === "\n" || ch === "\r") {
        throw this.error("Unescaped newline in literal string");
      }
      res += ch;
    }

    throw this.error("Unterminated literal string");
  }

  private parseMultilineLiteralString(): string {
    this.next(); // '
    this.next(); // '
    this.next(); // '

    if (this.peek() === "\r") this.next();
    if (this.peek() === "\n") this.next();

    let res = "";

    while (!this.isEof()) {
      if (this.peek() === "'" && this.peekAt(1) === "'" && this.peekAt(2) === "'") {
        this.next();
        this.next();
        this.next();
        return res;
      }
      res += this.next();
    }

    throw this.error("Unterminated multiline literal string");
  }

  private parseArray(): unknown[] {
    this.next(); // skip [
    const arr: unknown[] = [];

    while (!this.isEof()) {
      this.skipWhitespaceAndComments();
      if (this.peek() === "]") {
        this.next();
        return arr;
      }

      const item = this.parseValue();
      arr.push(item);

      this.skipWhitespaceAndComments();
      if (this.peek() === ",") {
        this.next();
        this.skipWhitespaceAndComments();
        if (this.peek() === "]") {
          this.next();
          return arr;
        }
      } else if (this.peek() === "]") {
        this.next();
        return arr;
      } else {
        throw this.error("Expected ',' or ']' in array");
      }
    }

    throw this.error("Unterminated array");
  }

  private parseInlineTable(): Record<string, unknown> {
    this.next(); // skip {
    const table: Record<string, unknown> = {};

    while (!this.isEof()) {
      this.skipSpacesAndTabs();
      if (this.peek() === "}") {
        this.next();
        return table;
      }

      const keys = this.parseKey();
      this.skipSpacesAndTabs();
      if (this.peek() !== "=") {
        throw this.error(`Expected '=' in inline table for key '${keys.join(".")}'`);
      }
      this.next();
      this.skipSpacesAndTabs();
      const val = this.parseValue();
      this.setNested(table, keys, val);

      this.skipSpacesAndTabs();
      if (this.peek() === ",") {
        this.next();
        this.skipSpacesAndTabs();
        if (this.peek() === "}") {
          this.next();
          return table;
        }
      } else if (this.peek() === "}") {
        this.next();
        return table;
      } else {
        throw this.error("Expected ',' or '}' in inline table");
      }
    }

    throw this.error("Unterminated inline table");
  }

  private parseLiteralOrNumber(): unknown {
    const start = this.pos;
    while (!this.isEof()) {
      const c = this.peek();
      if (
        c === " " ||
        c === "\t" ||
        c === "\r" ||
        c === "\n" ||
        c === "#" ||
        c === "," ||
        c === "]" ||
        c === "}"
      ) {
        break;
      }
      this.next();
    }

    const token = this.input.slice(start, this.pos);
    if (!token) {
      throw this.error(`Expected value, encountered '${this.peek()}'`);
    }

    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "inf" || token === "+inf") return Infinity;
    if (token === "-inf") return -Infinity;
    if (token === "nan" || token === "+nan" || token === "-nan") return NaN;

    // Integer / Float
    const cleanNum = token.replace(/_/g, "");
    if (/^[+-]?(?:0|[1-9]\d*)$/.test(cleanNum)) {
      return parseInt(cleanNum, 10);
    }
    if (/^0x[0-9a-fA-F]+$/.test(cleanNum)) {
      return parseInt(cleanNum.slice(2), 16);
    }
    if (/^0o[0-7]+$/.test(cleanNum)) {
      return parseInt(cleanNum.slice(2), 8);
    }
    if (/^0b[01]+$/.test(cleanNum)) {
      return parseInt(cleanNum.slice(2), 2);
    }
    if (/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(cleanNum)) {
      return parseFloat(cleanNum);
    }

    // Return as string if it looks like an ISO date or timestamp
    if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(token)) {
      return token;
    }

    throw this.error(`Invalid literal or unquoted value: '${token}'`);
  }

  private getOrCreateTable(
    root: Record<string, unknown>,
    keys: string[]
  ): Record<string, unknown> {
    let curr = root;
    for (const key of keys) {
      if (!(key in curr)) {
        curr[key] = {};
      } else if (typeof curr[key] !== "object" || curr[key] === null) {
        throw this.error(
          `Cannot create table '${keys.join(".")}': '${key}' already exists as a primitive`
        );
      } else if (Array.isArray(curr[key])) {
        const arr = curr[key] as Array<Record<string, unknown>>;
        if (arr.length === 0) {
          const newObj: Record<string, unknown> = {};
          arr.push(newObj);
          curr = newObj;
          continue;
        }
        curr = arr[arr.length - 1];
        continue;
      }
      curr = curr[key] as Record<string, unknown>;
    }
    return curr;
  }

  private getOrCreateArrayTable(
    root: Record<string, unknown>,
    keys: string[]
  ): Record<string, unknown> {
    let curr = root;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in curr)) {
        curr[key] = {};
      } else if (Array.isArray(curr[key])) {
        const arr = curr[key] as Array<Record<string, unknown>>;
        curr = arr[arr.length - 1];
        continue;
      }
      curr = curr[key] as Record<string, unknown>;
    }

    const lastKey = keys[keys.length - 1];
    if (!(lastKey in curr)) {
      curr[lastKey] = [];
    } else if (!Array.isArray(curr[lastKey])) {
      throw this.error(
        `Cannot create array table '${keys.join(".")}': '${lastKey}' is not an array`
      );
    }

    const newObj: Record<string, unknown> = {};
    (curr[lastKey] as Array<Record<string, unknown>>).push(newObj);
    return newObj;
  }

  private setNested(
    target: Record<string, unknown>,
    keys: string[],
    value: unknown
  ): void {
    let curr = target;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in curr)) {
        curr[key] = {};
      }
      curr = curr[key] as Record<string, unknown>;
    }
    const lastKey = keys[keys.length - 1];
    curr[lastKey] = value;
  }
}
