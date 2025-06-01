const { test } = require('node:test');
const assert = require('node:assert');
const { processLinkedIssues } = require('../../src/rules/linked-issues');

// Minimal test setup
require('../../src/utils/log').log = {
  info: () => {},
  warn: () => {},
  error: () => {},
  printSummary: () => {}
};

test('handles PR with no linked issues', async (t) => {
  const pr = {
    id: 'pr-1',
    number: 123,
    repository: { nameWithOwner: 'test/repo' },
    state: 'OPEN',
    merged: false,
    linkedIssues: {
      nodes: []  // No linked issues
    }
  };

  const result = await processLinkedIssues(pr, 'pr-1', 'project-1', 'In Progress');

  assert.strictEqual(result.changed, false, 'should indicate no changes made');
  assert.strictEqual(result.reason, 'No linked issues', 'should indicate reason');
});
