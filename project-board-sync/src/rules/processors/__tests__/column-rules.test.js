const { test } = require('node:test');
const assert = require('node:assert/strict');
const { processColumnRules } = require('../column-rules');

test('processColumnRules', async (t) => {
    await t.test('sets PR column to Active when no column set', () => {
        const pr = {
            __typename: 'PullRequest',
            projectItems: {
                nodes: [{
                    fieldValues: {
                        nodes: [] // No column set
                    }
                }]
            }
        };

        const actions = processColumnRules(pr);
        
        assert.equal(actions.length, 1, 'should set column');
        assert.equal(actions[0].action, 'set_column: Active', 'should set to Active');
        assert.equal(actions[0].params.item, pr, 'should include PR in params');
    });

    await t.test('sets PR column to Active when in New column', () => {
        const pr = {
            __typename: 'PullRequest',
            projectItems: {
                nodes: [{
                    fieldValues: {
                        nodes: [{
                            field: { name: 'Status' },
                            name: 'New'
                        }]
                    }
                }]
            }
        };

        const actions = processColumnRules(pr);
        
        assert.equal(actions.length, 1, 'should set column');
        assert.equal(actions[0].action, 'set_column: Active', 'should set to Active');
        assert.equal(actions[0].params.item, pr, 'should include PR in params');
    });

    await t.test('sets Issue column to New when no column set', () => {
        const issue = {
            __typename: 'Issue',
            projectItems: {
                nodes: [{
                    fieldValues: {
                        nodes: [] // No column set
                    }
                }]
            }
        };

        const actions = processColumnRules(issue);
        
        assert.equal(actions.length, 1, 'should set column');
        assert.equal(actions[0].action, 'set_column: New', 'should set to New');
        assert.equal(actions[0].params.item, issue, 'should include Issue in params');
    });

    await t.test('skips PR when column is already set except New', () => {
        const pr = {
            __typename: 'PullRequest',
            projectItems: {
                nodes: [{
                    fieldValues: {
                        nodes: [{
                            field: { name: 'Status' },
                            name: 'Active'
                        }]
                    }
                }]
            }
        };

        const actions = processColumnRules(pr);
        
        assert.equal(actions.length, 0, 'should skip when column already set');
    });

    await t.test('skips Issue when column is already set', () => {
        const issue = {
            __typename: 'Issue',
            projectItems: {
                nodes: [{
                    fieldValues: {
                        nodes: [{
                            field: { name: 'Status' },
                            name: 'New'
                        }]
                    }
                }]
            }
        };

        const actions = processColumnRules(issue);
        
        assert.equal(actions.length, 0, 'should skip when column already set');
    });
});
