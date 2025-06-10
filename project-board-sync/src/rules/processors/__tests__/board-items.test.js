const { test } = require('node:test');
const assert = require('node:assert/strict');

// Simple mock for board rules - just one rule to start with
const mockRules = {
    boardItems: [{
        triggers: ['item.author.login === process.env.GITHUB_AUTHOR']
    }]
};

// Override the board rules module before requiring the module under test
require('../../../config/board-rules').loadBoardRules = async () => mockRules;

// Now require the module under test
const { processBoardItemRules } = require('../board-items');

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
