const { test } = require('node:test');
const assert = require('node:assert/strict');
const { processBoardItemRules } = require('../board-items');
const { processColumnRules } = require('../column-rules');
const { processSprintRules } = require('../sprint-rules');
const { setupTestEnvironment } = require('../../../../test/setup');

test('real scenarios', async (t) => {
    // Setup test environment
    setupTestEnvironment();
    
    await t.test('PR 98: authored by DerekRoberts, no column or assignee', async () => {
        const pr = {
            __typename: 'PullRequest',
            author: { login: 'DerekRoberts' },
            repository: { nameWithOwner: 'bcgov/nr-nerds' },
            column: null,
            sprint: null,
            projectItems: { nodes: [] }, // Not in project yet
            assignees: { nodes: [] } // No assignees
        };

        // Process through board-items rules
        const boardActions = await processBoardItemRules(pr);
        assert.equal(boardActions.length, 2, 'should add PR to board (matches author and repo rules)');
        assert.equal(boardActions[0].action, 'add_to_board', 'should add to board');
        assert.equal(boardActions[1].action, 'add_to_board', 'should add to board');

        // Process through column rules
        const columnActions = processColumnRules(pr);
        assert.equal(columnActions.length, 1, 'should set column');
        assert.equal(columnActions[0].action, 'set_column: Active', 'should set to Active');

        // Once in Active column, should get sprint assignment
        const prWithColumn = {
            ...pr,
            column: 'Active'
        };
        const sprintActions = processSprintRules(prWithColumn);
        assert.equal(sprintActions.length, 1, 'should set sprint');
        assert.equal(sprintActions[0].action, 'set_sprint: current', 'should set current sprint');
    });
});
