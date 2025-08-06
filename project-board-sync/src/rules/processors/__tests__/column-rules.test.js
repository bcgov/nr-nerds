const { test } = require('node:test');
const assert = require('node:assert/strict');
const { processColumnRules } = require('../column-rules');
const { setupTestEnvironment } = require('../../../../test/setup');
const { loadBoardRules } = require('../../../config/board-rules');

test('processColumnRules', async (t) => {
    // Setup test environment
    setupTestEnvironment();
    const config = await loadBoardRules();
    const monitoredUser = config.monitoredUser;

    await t.test('sets PR column to Active when no column set', () => {
        const pr = {
            __typename: 'PullRequest',
            author: { login: monitoredUser },
            column: null, // No column set
            projectItems: {
                nodes: []
            }
        };

        const actions = processColumnRules(pr);

        assert.equal(actions.length, 1, 'should set column');
        assert.equal(actions[ 0 ].action, 'set_column: Active', 'should set to Active');
        assert.equal(actions[ 0 ].params.item, pr, 'should include PR in params');
    });

    await t.test('sets PR column to Active when in New column', () => {
        const pr = {
            __typename: 'PullRequest',
            author: { login: monitoredUser },
            column: 'New', // In New column
            projectItems: {
                nodes: []
            }
        };

        const actions = processColumnRules(pr);

        assert.equal(actions.length, 1, 'should set column');
        assert.equal(actions[ 0 ].action, 'set_column: Active', 'should set to Active');
        assert.equal(actions[ 0 ].params.item, pr, 'should include PR in params');
    });

    await t.test('sets Issue column to New when no column set', () => {
        const issue = {
            __typename: 'Issue',
            author: { login: monitoredUser },
            column: null, // No column set
            projectItems: {
                nodes: []
            }
        };

        const actions = processColumnRules(issue);

        assert.equal(actions.length, 1, 'should set column');
        assert.equal(actions[ 0 ].action, 'set_column: New', 'should set to New');
        assert.equal(actions[ 0 ].params.item, issue, 'should include Issue in params');
    });

    await t.test('skips PR when column is already set except New', () => {
        const pr = {
            __typename: 'PullRequest',
            author: { login: monitoredUser },
            column: 'Active', // Already set to Active
            projectItems: {
                nodes: []
            }
        };

        const actions = processColumnRules(pr);

        assert.equal(actions.length, 0, 'should skip when column already set');
    });

    await t.test('skips Issue when column is already set', () => {
        const issue = {
            __typename: 'Issue',
            author: { login: monitoredUser },
            column: 'New', // Already set to New
            projectItems: {
                nodes: []
            }
        };

        const actions = processColumnRules(issue);

        assert.equal(actions.length, 0, 'should skip when column already set');
    });
});
