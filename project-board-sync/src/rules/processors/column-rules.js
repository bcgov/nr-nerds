const { loadBoardRules } = require('../../config/board-rules');

/**
 * Process rules for managing item columns in the project board
 * @param {Object} item PR or Issue to process
 * @returns {Array<{action: string, params: Object}>} List of actions to take
 */
function processColumnRules(item) {
    const config = loadBoardRules();
    const rules = config.rules.columns;
    const actions = [];

    for (const rule of rules) {
        if (matchesCondition(item, rule.trigger) && !skipRule(item, rule.skip_if)) {
            actions.push({
                action: rule.action,
                params: { item }
            });
        }
    }

    return actions;
}

/**
 * Check if an item matches a rule's trigger condition
 * @private
 */
function matchesCondition(item, trigger) {
    // Type check first
    const typeMap = {
        'PR': 'PullRequest',
        'Issue': 'Issue'
    };
    const expectedType = typeMap[trigger.type] || trigger.type;
    if (item.__typename !== expectedType) {
        return false;
    }

    // Parse and evaluate condition
    if (trigger.condition.startsWith('Column=')) {
        const expectedColumn = trigger.condition.split('=')[1].trim();
        const currentColumn = item.projectItems?.nodes?.[0]?.fieldValues?.nodes?.find(f => f.field.name === 'Status')?.name;
        
        if (expectedColumn === 'None') {
            return !currentColumn;
        }
        return currentColumn === expectedColumn;
    }

    throw new Error(`Unknown condition: ${trigger.condition}`);
}

/**
 * Check if a rule should be skipped
 * @private
 */
function skipRule(item, skipIf) {
    const currentColumn = item.projectItems?.nodes?.[0]?.fieldValues?.nodes?.find(f => f.field.name === 'Status')?.name;

    if (skipIf === 'Column=Any already set') {
        return !!currentColumn;
    }
    if (skipIf === 'Column=Any except New') {
        return currentColumn && currentColumn !== 'New';
    }
    
    throw new Error(`Unknown skip condition: ${skipIf}`);
}

module.exports = {
    processColumnRules
};
