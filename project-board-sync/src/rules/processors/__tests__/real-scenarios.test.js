const { test } = require('node:test');
const assert = require('node:assert/strict');
const { processBoardItemRules } = require('../unified-rule-processor');
const { processColumnRules } = require('../unified-rule-processor');
const { processSprintRules } = require('../unified-rule-processor');
const { setupTestEnvironment } = require('../../../../test/setup');

test('real scenarios', async (t) => {
    // Setup test environment
    setupTestEnvironment();
    
    await t.test('PR 98: authored by DerekRoberts, no column or assignee', async () => {
        const pr = {
            __typename: 'PullRequest',
            number: 98,
            author: { login: 'DerekRoberts' },
            column: null,
            assignees: { nodes: [] },
            projectItems: { nodes: [] }
        };

        const boardActions = await processBoardItemRules(pr);
        const columnActions = await processColumnRules(pr);
        const sprintActions = await processSprintRules(pr);

        assert.equal(boardActions.length, 1, 'should add to board');
        assert.equal(columnActions.length, 1, 'should set column');
        assert.equal(sprintActions.length, 0, 'should not set sprint (no column yet)');
    });
});
