const { test } = require('node:test');
const assert = require('node:assert/strict');

// Mock the dependencies
const mockConfig = {
    rules: {
        board_items: [{
            name: "Test Board Rule",
            trigger: {
                type: "PullRequest",
                condition: "monitored.users.includes(item.author)"
            },
            action: "add_to_board",
            skip_if: "item.inProject"
        }],
        columns: [{
            name: "Test Column Rule",
            trigger: {
                type: "PullRequest",
                condition: "!item.column"
            },
            action: "set_column",
            value: "Active",
            skip_if: "item.column"
        }],
        sprints: [{
            name: "Test Sprint Rule",
            trigger: {
                type: "PullRequest",
                condition: "item.column === 'Active'"
            },
            action: "set_sprint",
            value: "current",
            skip_if: "item.sprint === 'current'"
        }]
    },
    monitoredUsers: ['test-user']
};

// Mock the board rules module
require('../../../config/board-rules').loadBoardRules = () => mockConfig;

// Mock the validator
require('../shared-validator').validator = {
    validateItemCondition: (item, trigger) => {
        // Check type first
        const allowedTypes = trigger.type?.split('|') || [];
        if (allowedTypes.length > 0 && !allowedTypes.includes(item.__typename)) {
            return false;
        }
        
        // Then check condition
        if (trigger.condition === "monitored.users.includes(item.author)") {
            return item.author?.login === 'test-user';
        }
        if (trigger.condition === "!item.column") {
            return !item.column;
        }
        if (trigger.condition === "item.column === 'Active'") {
            return item.column === 'Active';
        }
        if (trigger.condition === "!item.pr.closed || item.pr.merged") {
            return !item.pr?.closed || item.pr?.merged;
        }
        return false;
    },
    validateSkipRule: (item, skipIf) => {
        if (skipIf === "item.inProject") {
            return item.projectItems?.nodes?.length > 0;
        }
        if (skipIf === "item.column") {
            return !!item.column;
        }
        if (skipIf === "item.sprint === 'current'") {
            return item.sprint === 'current';
        }
        if (skipIf === "item.assignees.includes(item.author)") {
            return item.assignees?.nodes?.some(a => a.login === item.author?.login);
        }
        if (skipIf === "item.column === item.pr.column && item.assignees === item.pr.assignees") {
            return item.column === item.pr?.column && item.assignees === item.pr?.assignees;
        }
        return false;
    },
    steps: {
        markStepComplete: () => {}
    }
};

// Mock the log
require('../../../utils/log').log = {
    info: () => {},
    debug: () => {},
    error: () => {},
    warn: () => {}
};

// Now require the module under test
const { 
    processRuleType,
    processColumnRules,
    processBoardItemRules,
    processSprintRules
} = require('../unified-rule-processor');

test('Unified Rule Processor - Column, Board, and Sprint Rules', async (t) => {
    await t.test('processRuleType processes column rules correctly', async () => {
        const item = {
            __typename: 'PullRequest',
            number: 123,
            column: null,
            projectItems: { nodes: [] }
        };

        const actions = await processRuleType(item, 'columns');
        
        assert.equal(actions.length, 1, 'Should process one column rule');
        assert.equal(actions[0].action, 'set_column: Active', 'Should have correct action');
        assert.equal(actions[0].params.item, item, 'Should include item in params');
    });

    await t.test('processRuleType processes board_items rules correctly', async () => {
        const item = {
            __typename: 'PullRequest',
            number: 123,
            author: { login: 'test-user' },
            projectItems: { nodes: [] }
        };

        const actions = await processRuleType(item, 'board_items');
        
        assert.equal(actions.length, 1, 'Should process one board_items rule');
        assert.equal(actions[0].action, 'add_to_board', 'Should have correct action');
        assert.equal(actions[0].params.item, item, 'Should include item in params');
    });

    await t.test('processRuleType processes sprint rules correctly', async () => {
        const item = {
            __typename: 'PullRequest',
            number: 123,
            column: 'Active',
            projectItems: { nodes: [] }
        };

        const actions = await processRuleType(item, 'sprints');
        
        assert.equal(actions.length, 1, 'Should process one sprint rule');
        assert.equal(actions[0].action, 'set_sprint: current', 'Should have correct action');
        assert.equal(actions[0].params.item, item, 'Should include item in params');
    });

    await t.test('processColumnRules works as backward compatibility', async () => {
        const item = {
            __typename: 'PullRequest',
            number: 123,
            column: null,
            projectItems: { nodes: [] }
        };

        const actions = await processColumnRules(item);
        
        assert.equal(actions.length, 1, 'Should process one column rule');
        assert.equal(actions[0].action, 'set_column: Active', 'Should have correct action');
    });

    await t.test('processBoardItemRules works as backward compatibility', async () => {
        const item = {
            __typename: 'PullRequest',
            number: 123,
            author: { login: 'test-user' },
            projectItems: { nodes: [] }
        };

        const actions = await processBoardItemRules(item);
        
        assert.equal(actions.length, 1, 'Should process one board_items rule');
        assert.equal(actions[0].action, 'add_to_board', 'Should have correct action');
    });

    await t.test('processSprintRules works as backward compatibility', async () => {
        const item = {
            __typename: 'PullRequest',
            number: 123,
            column: 'Active',
            projectItems: { nodes: [] }
        };

        const actions = await processSprintRules(item);
        
        assert.equal(actions.length, 1, 'Should process one sprint rule');
        assert.equal(actions[0].action, 'set_sprint: current', 'Should have correct action');
    });

    await t.test('skips board_items rules when already in project', async () => {
        const item = {
            __typename: 'PullRequest',
            number: 123,
            author: { login: 'test-user' },
            projectItems: { nodes: [{ id: 'some-id' }] } // Already in project
        };

        const actions = await processRuleType(item, 'board_items');
        
        assert.equal(actions.length, 0, 'Should skip when already in project');
    });

    await t.test('skips rules when skip condition is met', async () => {
        const item = {
            __typename: 'PullRequest',
            number: 123,
            column: 'Active', // Already has column
            projectItems: { nodes: [] }
        };

        const actions = await processRuleType(item, 'columns');
        
        assert.equal(actions.length, 0, 'Should skip when column already set');
    });

    await t.test('skips sprint rules when sprint already set', async () => {
        const item = {
            __typename: 'PullRequest',
            number: 123,
            column: 'Active',
            sprint: 'current', // Already has sprint
            projectItems: { nodes: [] }
        };

        const actions = await processRuleType(item, 'sprints');
        
        assert.equal(actions.length, 0, 'Should skip when sprint already set');
    });

    await t.test('handles empty rule types gracefully', async () => {
        const item = {
            __typename: 'PullRequest',
            number: 123,
            column: null,
            projectItems: { nodes: [] }
        };

        const actions = await processRuleType(item, 'nonexistent_rule_type');
        
        assert.equal(actions.length, 0, 'Should handle empty rule types');
    });
}); 
