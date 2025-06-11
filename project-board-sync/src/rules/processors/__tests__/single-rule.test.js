const { test } = require('node:test');
const assert = require('node:assert/strict');
const { processBoardItemRules } = require('../board-items');

// Mock the board rules to match requirements exactly
jest.mock('../../../config/board-rules', () => ({
    loadBoardRules: () => ({
        rules: {
            board_items: [{
                name: "PullRequest by Author",
                description: "Add pull requests authored by monitored user",
                trigger: {
                    type: "PullRequest",
                    condition: "item.author === monitored.user"
                },
                action: "add_to_board",
                skip_if: "item.inProject"
            }]
        }
    })
}));

// Mock console for logging assertions
const logMessages = [];
jest.mock('../../../utils/log', () => ({
    log: {
        info: (msg) => logMessages.push(msg),
        debug: (msg) => logMessages.push(msg)
    }
}));

// Test environment setup
process.env.GITHUB_AUTHOR = 'testUser';

test('PR authored by monitored user rule', async (t) => {
    // Clear logs before each test
    logMessages.length = 0;

    await t.test('adds PR to board when authored by monitored user', async () => {
        const pr = {
            __typename: 'PullRequest',
            number: 123,
            author: { login: 'testUser' },
            projectItems: { nodes: [] }  // Not in project
        };

        const actions = await processBoardItemRules(pr);
        
        // Verify actions
        assert.equal(actions.length, 1, 'should add PR to board');
        assert.equal(actions[0].action, 'add_to_board', 'action should be add_to_board');
        assert.deepEqual(actions[0].params, { item: pr }, 'should include PR in params');

        // Verify logging
        assert.ok(logMessages.some(msg => msg.includes('Adding PullRequest #123 to board')), 
            'should log board addition');
    });

    await t.test('skips PR when already in project', async () => {
        logMessages.length = 0;
        const pr = {
            __typename: 'PullRequest',
            number: 123,
            author: { login: 'testUser' },
            projectItems: { nodes: [{ id: 'some-id' }] }  // Already in project
        };

        const actions = await processBoardItemRules(pr);
        
        // Verify actions
        assert.equal(actions.length, 0, 'should skip PR already in project');

        // Verify logging
        assert.ok(logMessages.some(msg => msg.includes('Skipping PullRequest #123 - Already in project')),
            'should log skip reason');
    });

    await t.test('skips PR when author is not monitored user', async () => {
        logMessages.length = 0;
        const pr = {
            __typename: 'PullRequest',
            number: 123,
            author: { login: 'otherUser' },
            projectItems: { nodes: [] }
        };

        const actions = await processBoardItemRules(pr);
        
        // Verify actions
        assert.equal(actions.length, 0, 'should skip PR from non-monitored author');

        // Verify no add_to_board action logged
        assert.ok(!logMessages.some(msg => msg.includes('Adding PullRequest #123 to board')),
            'should not log board addition');
    });
});
