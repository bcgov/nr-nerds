const { test } = require('node:test');
const assert = require('node:assert/strict');

// Mock the dependencies
const mockConfig = {
    rules: {
        columns: [{
            name: "Test Column Rule",
            trigger: {
                type: "PullRequest",
                condition: "!item.column"
            },
            action: "set_column",
            value: "Active",
            skip_if: "item.column"
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
        if (trigger.condition === "!item.column") {
            return !item.column;
        }
        return false;
    },
    validateSkipRule: (item, skipIf) => {
        if (skipIf === "item.column") {
            return !!item.column;
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
    processColumnRules
} = require('../unified-rule-processor');

test('Unified Rule Processor - Column Rules', async (t) => {
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
