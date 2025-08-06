const { test } = require('node:test');
const assert = require('node:assert/strict');
const board = require('./test-board');
const { loadBoardRules } = require('../../src/config/board-rules');

let mockBoard;

test('Mock board data', async (t) => {
  await t.test('setup', async () => {
    // Clone board data to avoid modifying the original
    mockBoard = JSON.parse(JSON.stringify(board));
    assert.ok(mockBoard.items.length > 0, 'Should have items');
  });

  await t.test('item structure matches real data', async () => {
    const item = mockBoard.items[0];
    assert.ok(item.type === 'PULL_REQUEST' || item.type === 'ISSUE', 'Should have valid type');
    assert.ok(item.content.title.startsWith('Test '), 'Should have sanitized title');
    assert.ok(item.content.repository.nameWithOwner.startsWith('test-org/'), 'Should have sanitized repo');
    assert.ok(item.id.startsWith('test-'), 'Should have test ID');
  });

  await t.test('field values structure', async () => {
    const item = mockBoard.items[0];
    const fields = item.fieldValues.nodes;
    
    const statusField = fields.find(f => f.field && f.field.name === 'Status');
    assert.ok(statusField, 'Should have Status field');
    assert.ok(['Backlog', 'Active', 'Review', 'Done', 'Next'].includes(statusField.name), 
      'Should have valid status');

    const sprintField = fields.find(f => f.field && f.field.name === 'Sprint');
    if (sprintField) {
      assert.ok(sprintField.name.startsWith('Sprint '), 'Should have valid sprint name');
    }
  });
});
