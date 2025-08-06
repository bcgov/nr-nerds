/**
 * @fileoverview Unified processor for all rule types
 * 
 * @directive Always run tests after modifying this file:
 * ```bash
 * npm test -- processors/unified-rule-processor.test.js
 * npm test -- processors/column-rules.test.js
 * npm test -- processors/real-scenarios.test.js
 * ```
 * Changes here can affect all rule processing logic.
 */

const { loadBoardRules } = require('../../config/board-rules');
const { validator } = require('./shared-validator');
const { log } = require('../../utils/log');

/**
 * Process rules for a specific rule type
 * @param {Object} item PR or Issue to process
 * @param {string} ruleType The type of rules to process (e.g., 'columns', 'board_items')
 * @returns {Promise<Array<{action: string, params: Object}>>} List of actions to take
 */
async function processRuleType(item, ruleType) {
    try {
        const config = loadBoardRules();
        const actions = [];
        validator.steps.markStepComplete('RULE_CONFIG_LOADED');

        const rules = config.rules[ruleType] || [];
        
        for (const rule of rules) {
            try {
                // Special handling for board_items rules
                if (ruleType === 'board_items') {
                    // Skip if already in project (skip condition)
                    if (item.projectItems?.nodes?.length > 0) {
                        log.info(`Skipping ${item.__typename} #${item.number} - Already in project`);
                        continue;
                    }
                }

                // Skip rule if conditions not met (backward compatibility for skipIf/skip_if)
                const skipCondition = rule.skip_if ?? rule.skipIf;
                if (skipCondition && validator.validateSkipRule(item, skipCondition)) {
                    continue;
                }

                // Check trigger conditions
                if (validator.validateItemCondition(item, rule.trigger)) {
                    const action = formatAction(rule, ruleType);
                    const params = { item };
                    
                    // Special handling for assignee rules
                    if (ruleType === 'assignees') {
                        params.assignee = rule.value;
                    }
                    
                    // Special handling for linked issues rules
                    if (ruleType === 'linked_issues') {
                        const ruleActions = Array.isArray(rule.action) ? rule.action : [rule.action];
                        params.rule = rule.name;
                        params.actions = ruleActions;
                        
                        // Create separate action for each rule action
                        for (const actionItem of ruleActions) {
                            actions.push({
                                action: actionItem,
                                params
                            });
                        }
                        continue; // Skip the default action push below
                    }
                    
                    actions.push({
                        action,
                        params
                    });
                    log.info(`Rule ${rule.name} triggered for ${item.__typename} #${item.number}`);
                }
            } catch (error) {
                log.error(`Error processing ${ruleType} rule: ${error.message}`, {
                    rule: rule.name || 'unnamed',
                    item: item.__typename + '#' + item.number
                });
            }
        }

        return actions;
    } catch (error) {
        log.error(`Failed to process ${ruleType} rules: ${error.message}`);
        throw error;
    }
}

/**
 * Format action based on rule type and rule configuration
 * @param {Object} rule The rule configuration
 * @param {string} ruleType The type of rule being processed
 * @returns {string} The formatted action string
 */
function formatAction(rule, ruleType) {
    switch (ruleType) {
        case 'columns':
            return `set_column: ${rule.value}`;
        case 'sprints':
            return `set_sprint: ${rule.value}`;
        case 'board_items':
            return 'add_to_board';
        case 'assignees':
            return `add_assignee: ${rule.value}`;
        case 'linked_issues':
            return rule.action || 'link_issue';
        default:
            return rule.action || 'unknown_action';
    }
}

/**
 * Process all rules for an item
 * @param {Object} item PR or Issue to process
 * @returns {Promise<Array<{action: string, params: Object}>>} List of actions to take
 */
async function processAllRules(item) {
    try {
        const actions = [];
        validator.steps.markStepComplete('RULE_CONFIG_LOADED');

        // Process all rule types dynamically from configuration
        const config = loadBoardRules();
        const ruleTypes = Object.keys(config.rules || {});
        
        for (const ruleType of ruleTypes) {
            const ruleActions = await processRuleType(item, ruleType);
            actions.push(...ruleActions);
        }

        return actions;
    } catch (error) {
        log.error(`Failed to process all rules: ${error.message}`);
        throw error;
    }
}

// Backward compatibility functions
async function processBoardItemRules(item) {
    return await processRuleType(item, 'board_items');
}

async function processColumnRules(item) {
    return await processRuleType(item, 'columns');
}

async function processSprintRules(item) {
    return await processRuleType(item, 'sprints');
}

async function processAssigneeRules(item) {
    return await processRuleType(item, 'assignees');
}

async function processLinkedIssueRules(item) {
    return await processRuleType(item, 'linked_issues');
}

module.exports = {
    processAllRules,
    processRuleType,
    processBoardItemRules,
    processColumnRules,
    processSprintRules,
    processAssigneeRules,
    processLinkedIssueRules
}; 
