const { test } = require('node:test');
const assert = require('node:assert/strict');
const { processSprintRules } = require('../sprint-rules');
const { setupTestEnvironment } = require('../../../../test/setup');

test('processSprintRules', async (t) => {
    // Setup test environment
    setupTestEnvironment();
    
    await t.test('sets sprint when PR is in Active column', () => {
        const pr = {
            __typename: 'PullRequest',
            author: { login: 'DerekRoberts' },
            column: 'Active',
            sprint: null,
            projectItems: {
                nodes: []
            }
        };

        const actions = processSprintRules(pr);
        
        assert.equal(actions.length, 1, 'should set sprint');
        assert.equal(actions[0].action, 'set_sprint: current', 'should set to current sprint');
        assert.equal(actions[0].params.item, pr, 'should include PR in params');
    });

    await t.test('sets sprint when Issue is in Next column', () => {
        const issue = {
            __typename: 'Issue',
            author: { login: 'DerekRoberts' },
            column: 'Next',
            sprint: null,
            projectItems: {
                nodes: []
            }
        };

        const actions = processSprintRules(issue);
        
        assert.equal(actions.length, 1, 'should set sprint');
        assert.equal(actions[0].action, 'set_sprint: current', 'should set to current sprint');
        assert.equal(actions[0].params.item, issue, 'should include Issue in params');
    });

    await t.test('sets sprint when PR is in Done column', () => {
        const pr = {
            __typename: 'PullRequest',
            author: { login: 'DerekRoberts' },
            column: 'Done',
            sprint: null,
            projectItems: {
                nodes: []
            }
        };

        const actions = processSprintRules(pr);
        
        assert.equal(actions.length, 1, 'should set sprint');
        assert.equal(actions[0].action, 'set_sprint: current', 'should set to current sprint');
        assert.equal(actions[0].params.item, pr, 'should include PR in params');
    });

    await t.test('skips when sprint is already current', () => {
        const pr = {
            __typename: 'PullRequest',
            author: { login: 'DerekRoberts' },
            column: 'Active',
            sprint: 'current',
            projectItems: {
                nodes: []
            }
        };

        const actions = processSprintRules(pr);
        
        assert.equal(actions.length, 0, 'should skip when sprint already current');
    });

    await t.test('skips when item has any sprint and is not in Active/Next', () => {
        const pr = {
            __typename: 'PullRequest',
            author: { login: 'DerekRoberts' },
            column: 'Backlog',
            sprint: 'previous-sprint',
            projectItems: {
                nodes: []
            }
        };

        const actions = processSprintRules(pr);
        
        assert.equal(actions.length, 0, 'should skip when sprint exists and not in Active/Next');
    });
});
