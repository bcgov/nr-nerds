const { test } = require('node:test');
const assert = require('node:assert/strict');

// Mock rules to match the structure in rules.yml
const mockRules = {
    rules: {
        board_items: [{
            name: "PullRequest by Author",
            description: "Add pull requests authored by monitored user",
            trigger: {
                type: "PullRequest",
                condition: "monitored.users.includes(item.author)"
            },
            action: "add_to_board",
            skip_if: "item.inProject"
        }]
    },
    monitoredUsers: ['test-user']
};

// Override the board rules module before requiring the module under test
require('../../../config/board-rules').loadBoardRules = () => mockRules;

// Now require the module under test
const { processBoardItemRules } = require('../unified-rule-processor');

// Set up test env
process.env.GITHUB_AUTHOR = 'test-user';

test('processBoardItemRules adds PR to board when author matches', async (t) => {
    // Test fixture: Simple PR with minimal required fields
    const pr = {
        __typename: 'PullRequest',
        author: { login: 'test-user' },
        repository: { nameWithOwner: 'bcgov/test-repo' }
    };

    const actions = await processBoardItemRules(pr);
    
    // Assert we get exactly one action to add the PR
    assert.equal(actions.length, 1, 
        'Should generate one action for matching author');
    assert.equal(actions[0].action, 'add_to_board',
        'Action should be add_to_board');
    assert.equal(actions[0].params.item, pr,
        'Action params should include the PR');
});
