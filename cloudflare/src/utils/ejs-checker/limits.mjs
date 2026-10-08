// The full checker runs on creator/reviewer devices. Plain text, HTML, and CSS
// do not need a character-count gate; executable code retains parser budgets.
// The authoritative Worker upload-byte limit is defined separately.
export const CHECKER_LIMITS = Object.freeze({
  entries: 2000,
  codeUnits: 500,
  javaScriptCharacters: 200000,
  astNodesPerUnit: 40000,
  astNodes: 100000,
  browserTimeoutMs: 120000,
});

export class CheckerLimitError extends Error {
  constructor(message) { super(message); this.name = 'CheckerLimitError'; }
}

export function createParseBudget() { return { nodes: 0, units: 0 }; }
