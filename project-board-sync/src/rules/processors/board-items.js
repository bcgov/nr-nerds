const { loadBoardRules } = require('../../config/board-rules');
const { log } = require('../../utils/log');

/**
 * Process rules for adding items to the project board
 * @param {Object} item PR or Issue to process
 * @returns {Promise<Array<{action: string, params: Object}>>} List of actions to take
 */
async function processBoardItemRules(item, context = {}) {
    const config = await loadBoardRules(context);
    const rules = config.rules.board_items;
    const actions = [];
    
    log.info(`\nProcessing rules for ${item.__typename} #${item.number}:`, true);
    log.info(`  • Author: ${item.author?.login || 'unknown'}`, true);
    log.info(`  • Repository: ${item.repository?.nameWithOwner}`, true);
    log.info(`  • Monitored user: ${context.monitoredUser}`, true);

    for (const rule of rules) {
        log.info(`\n  Checking rule: ${rule.name}`, true);
        log.info(`    • Trigger: ${rule.trigger.type} with condition "${rule.trigger.condition}"`, true);
        
        const matches = matchesCondition(item, rule.trigger, config);        
        log.info(`    • Matches condition? ${matches ? '✓ Yes' : '✗ No'}`, true);

        if (matches) {
            // Handle both single actions and action arrays
            const ruleActions = Array.isArray(rule.action) ? rule.action : [rule.action];
            log.info(`    • Actions to process: ${JSON.stringify(ruleActions)}`, true);
            
            for (const action of ruleActions) {
                if (typeof action === 'string') {
                    const [actionName, actionParam] = action.split(': ');
                    log.info(`      Processing action: ${actionName} with param ${actionParam}`, true);

                    // Only skip add_to_board action if already in project
                    if (actionName === 'add_to_board' && skipRule(item, rule.skip_if)) {
                        log.info(`      ⚠ Skipping add_to_board action - already in project`, true);
                        continue;
                    }

                    actions.push({
                        action: actionName,
                        params: { 
                            item,
                            [actionName === 'set_assignee' ? 'assignee' : 'param']: actionParam
                        }
                    });
                } else {
                    // For non-string actions (just add_to_board), apply skip rule
                    if (action === 'add_to_board' && skipRule(item, rule.skip_if)) {
                        log.info(`      ⚠ Skipping add_to_board action - already in project`, true);
                        continue;
                    }

                    log.info(`      Processing action: ${action}`, true);
                    actions.push({
                        action: action,
                        params: { item }
                    });
                }
            }
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
            return item.author?.login === ruleConfig.monitoredUser;
        case 'assignee = monitored_user':
            return item.assignees?.nodes?.some(a => a.login === ruleConfig.monitoredUser);
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
