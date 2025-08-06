const { test } = require('node:test');
const assert = require('node:assert/strict');
const { processSprintRules } = require('../unified-rule-processor');
const { setupTestEnvironment } = require('../../../../test/setup');
const { loadBoardRules } = require('../../../config/board-rules');

test('processSprintRules', async (t) => {
    // Setup test environment
    setupTestEnvironment();
    const config = await loadBoardRules();
    const monitoredUser = config.monitoredUser;
    
    await t.test('sets sprint when PR is in Active column', async () => {
        const pr = {
            __typename: 'PullRequest',
            author: { login: monitoredUser },
            column: 'Active',
            projectItems: { nodes: [] }
        };

        const actions = await processSprintRules(pr);

        assert.equal(actions.length, 1, 'should set sprint');
        assert.equal(actions[0].action, 'set_sprint: current', 'should set to current');
    });

    await t.test('sets sprint when Issue is in Next column', async () => {
        const issue = {
            __typename: 'Issue',
            author: { login: monitoredUser },
            column: 'Next',
            projectItems: { nodes: [] }
        };

        const actions = await processSprintRules(issue);

        assert.equal(actions.length, 1, 'should set sprint');
        assert.equal(actions[0].action, 'set_sprint: current', 'should set to current');
    });

    await t.test('sets sprint when PR is in Done column', async () => {
        const pr = {
            __typename: 'PullRequest',
            author: { login: monitoredUser },
            column: 'Done',
            projectItems: { nodes: [] }
        };

        const actions = await processSprintRules(pr);

        assert.equal(actions.length, 1, 'should set sprint');
        assert.equal(actions[0].action, 'set_sprint: current', 'should set to current');
    });

    await t.test('skips when sprint is already current', async () => {
        const pr = {
            __typename: 'PullRequest',
            author: { login: monitoredUser },
            column: 'Active',
            sprint: 'current',
            projectItems: { nodes: [] }
        };

        const actions = await processSprintRules(pr);

        assert.equal(actions.length, 0, 'should skip when sprint already current');
    });

    await t.test('skips when item has any sprint and is not in Active/Next', async () => {
        const pr = {
            __typename: 'PullRequest',
            author: { login: monitoredUser },
            column: 'Done',
            sprint: 'some-sprint',
            projectItems: { nodes: [] }
        };

        const actions = await processSprintRules(pr);

        assert.equal(actions.length, 0, 'should skip when sprint exists and not in Active/Next');
    });
});
