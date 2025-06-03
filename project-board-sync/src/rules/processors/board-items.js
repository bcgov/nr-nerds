const { loadBoardRules } = require('../../config/board-rules');

/**
 * Process rules for adding items to the project board
 * @param {Object} item PR or Issue to process
 * @returns {Array<{action: string, params: Object}>} List of actions to take
 */
function processBoardItemRules(item) {
    const config = loadBoardRules();
    const rules = config.rules.board_items;
    const actions = [];

    for (const rule of rules) {
        if (matchesCondition(item, rule.trigger, config) && !skipRule(item, rule.skip_if)) {
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
function matchesCondition(item, trigger, ruleConfig) {
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
    switch (trigger.condition) {
        case 'author = monitored_user':
            return item.author?.login === process.env.GITHUB_AUTHOR;
        case 'assignee = monitored_user':
            return item.assignees?.nodes?.some(a => a.login === process.env.GITHUB_AUTHOR);
        case 'repository in monitored_repos':
            const repoName = item.repository?.nameWithOwner?.split('/')[1];
            if (!repoName) return false;
            return ruleConfig.project.repositories.includes(repoName);
        default:
            throw new Error(`Unknown condition: ${trigger.condition}`);
    }
}

/**
 * Check if a rule should be skipped
 * @private
 */
function skipRule(item, skipIf) {
    switch (skipIf) {
        case 'already_in_project':
            return item.projectItems?.nodes?.length > 0;
        default:
            throw new Error(`Unknown skip condition: ${skipIf}`);
    }
}

module.exports = {
    processBoardItemRules
};
