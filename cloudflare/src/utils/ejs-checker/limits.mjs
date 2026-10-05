// Shared by browser and server. Reaching a limit is never a successful check.
export const CHECKER_LIMITS = Object.freeze({
  entries: 2000,
  entryCharacters: 300000,
  totalCharacters: 2000000,
  codeUnits: 500,
  javaScriptCharacters: 200000,
  astNodesPerUnit: 40000,
  astNodes: 100000,
  browserTimeoutMs: 30000,
});

export class CheckerLimitError extends Error {
  constructor(message) { super(message); this.name = 'CheckerLimitError'; }
}

export function createParseBudget() { return { nodes: 0, units: 0 }; }
