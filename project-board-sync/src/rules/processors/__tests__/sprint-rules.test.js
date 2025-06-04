const { test } = require('node:test');
const assert = require('node:assert/strict');
const { processSprintRules } = require('../sprint-rules');

test('processSprintRules', async (t) => {
    await t.test('sets sprint when PR is in Active column', () => {
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

        const actions = processSprintRules(pr);
        
        assert.equal(actions.length, 1, 'should set sprint');
        assert.equal(actions[0].action, 'set_sprint: current', 'should set current sprint');
        assert.equal(actions[0].params.item, pr, 'should include PR in params');
    });

    await t.test('sets sprint when Issue is in Next column', () => {
        const issue = {
            __typename: 'Issue',
            projectItems: {
                nodes: [{
                    fieldValues: {
                        nodes: [{
                            field: { name: 'Status' },
                            name: 'Next'
                        }]
                    }
                }]
            }
        };

        const actions = processSprintRules(issue);
        
        assert.equal(actions.length, 1, 'should set sprint');
        assert.equal(actions[0].action, 'set_sprint: current', 'should set current sprint');
        assert.equal(actions[0].params.item, issue, 'should include Issue in params');
    });

    await t.test('sets sprint when PR is in Done column', () => {
        const pr = {
            __typename: 'PullRequest',
            projectItems: {
                nodes: [{
                    fieldValues: {
                        nodes: [{
                            field: { name: 'Status' },
                            name: 'Done'
                        }]
                    }
                }]
            }
        };

        const actions = processSprintRules(pr);
        
        assert.equal(actions.length, 1, 'should set sprint');
        assert.equal(actions[0].action, 'set_sprint: current', 'should set current sprint');
        assert.equal(actions[0].params.item, pr, 'should include PR in params');
    });

    await t.test('skips when sprint is already current', () => {
        const pr = {
            __typename: 'PullRequest',
            projectItems: {
                nodes: [{
                    fieldValues: {
                        nodes: [
                            {
                                field: { name: 'Status' },
                                name: 'Active'
                            },
                            {
                                field: { name: 'Sprint' },
                                name: 'current'
                            }
                        ]
                    }
                }]
            }
        };

        const actions = processSprintRules(pr);
        
        assert.equal(actions.length, 0, 'should skip when sprint already current');
    });

    await t.test('skips when item has any sprint and is not in Active/Next', () => {
        const pr = {
            __typename: 'PullRequest',
            projectItems: {
                nodes: [{
                    fieldValues: {
                        nodes: [
                            {
                                field: { name: 'Status' },
                                name: 'Done'
                            },
                            {
                                field: { name: 'Sprint' },
                                name: 'sprint-1'
                            }
                        ]
                    }
                }]
            }
        };

        const actions = processSprintRules(pr);
        
        assert.equal(actions.length, 0, 'should skip when already has a sprint');
    });
});
