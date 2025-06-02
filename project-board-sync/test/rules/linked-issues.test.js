const { test } = require('node:test');
const assert = require('node:assert');
const { processLinkedIssues } = require('../../src/rules/linked-issues');

// Set up minimal API mocks
const api = require('../../src/github/api');

api.getFieldId = async () => 'field-123';
api.setItemColumn = async () => {};
api.setItemAssignees = async () => {};
api.octokit = { graphql: async () => ({}) };

// Silence logging
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

test('skips closed but unmerged PR', async (t) => {
  const pr = {
    id: 'pr-1',
    number: 123,
    repository: { nameWithOwner: 'test/repo' },
    state: 'CLOSED',
    merged: false,
    linkedIssues: {
      nodes: [{
        id: 'issue-1',
        number: 456,
        repository: { nameWithOwner: 'test/repo' }
      }]
    }
  };

  const result = await processLinkedIssues(pr, 'pr-1', 'project-1', 'In Progress');

  assert.strictEqual(result.changed, false, 'should indicate no changes made');
  assert.strictEqual(result.reason, 'PR is closed but not merged', 'should indicate reason');
});
