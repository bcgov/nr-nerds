const { loadBoardRules } = require('../../config/board-rules');

/**
 * Process rules for managing item sprints in the project board
 * @param {Object} item PR or Issue to process
 * @returns {Array<{action: string, params: Object}>} List of actions to take
 */
function processSprintRules(item) {
    const config = loadBoardRules();
    const rules = config.rules.sprints;
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
    const expectedTypes = Array.isArray(trigger.type) ? trigger.type : [trigger.type];
    const expectedItemTypes = expectedTypes.map(t => typeMap[t] || t);
    if (!expectedItemTypes.includes(item.__typename)) {
        return false;
    }

    // Parse and evaluate condition
    const column = item.projectItems?.nodes?.[0]?.fieldValues?.nodes?.find(f => f.field.name === 'Status')?.name;
    
    if (trigger.condition.startsWith('column in')) {
        const allowedColumns = trigger.condition
            .replace('column in [', '')
            .replace(']', '')
            .split(',')
            .map(c => c.trim());
        return allowedColumns.includes(column);
    }
    
    if (trigger.condition.startsWith('column =')) {
        const expectedColumn = trigger.condition.split('=')[1].trim();
        return column === expectedColumn;
    }

    throw new Error(`Unknown condition: ${trigger.condition}`);
}

/**
 * Check if a rule should be skipped
 * @private
 */
function skipRule(item, skipIf) {
    const sprint = item.projectItems?.nodes?.[0]?.fieldValues?.nodes?.find(f => f.field.name === 'Sprint')?.name;

    switch (skipIf) {
        case 'sprint = current':
            return sprint === 'current';
        case 'sprint != None':
            return sprint !== null && sprint !== undefined;
        default:
            throw new Error(`Unknown skip condition: ${skipIf}`);
    }
}

module.exports = {
    processSprintRules
};