const { test } = require('node:test');
const assert = require('node:assert/strict');
const { processBoardItemRules } = require('../board-items');

// Mock environment variable
process.env.GITHUB_AUTHOR = 'test-user';

test('processBoardItemRules', async (t) => {
    await t.test('processes PR authored by monitored user', () => {
        const pr = {
            __typename: 'PullRequest',
            author: { login: 'test-user' },
            projectItems: { nodes: [] },
            repository: { nameWithOwner: 'bcgov/other-repo' }
        };

        const actions = processBoardItemRules(pr);
        
        assert.equal(actions.length, 1, 'should add PR to board');
        assert.equal(actions[0].action, 'add_to_board', 'should add to board');
        assert.equal(actions[0].params.item, pr, 'should include PR in params');
    });

    await t.test('skips PR already in project', () => {
        const pr = {
            __typename: 'PullRequest',
            author: { login: 'test-user' },
            projectItems: { nodes: [{ id: 'test' }] },
            repository: { nameWithOwner: 'bcgov/other-repo' }
        };

        const actions = processBoardItemRules(pr);
        
        assert.equal(actions.length, 0, 'should skip PR already in project');
    });
});
