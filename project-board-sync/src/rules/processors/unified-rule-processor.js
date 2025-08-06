/**
 * @fileoverview Unified processor for all rule types
 * 
 * @directive Always run tests after modifying this file:
 * ```bash
 * npm test -- processors/unified-rule-processor.test.js
 * npm test -- processors/real-scenarios.test.js
 * ```
 * Changes here can affect all rule processing logic.
 */

const { loadBoardRules } = require('../../config/board-rules');
const { validator } = require('./shared-validator');
const { log } = require('../../utils/log');

/**
 * Process all rules for an item
 * @param {Object} item PR or Issue to process
 * @returns {Promise<Array<{action: string, params: Object}>>} List of actions to take
 */
async function processAllRules(item) {
    try {
        const config = loadBoardRules();
        const actions = [];
        validator.steps.markStepComplete('RULE_CONFIG_LOADED');

        // Process all rule types
        const ruleTypes = ['board_items', 'columns', 'sprints', 'assignees', 'linked_issues'];
        
        for (const ruleType of ruleTypes) {
            if (!config.rules || !Array.isArray(config.rules[ruleType])) {
                continue;
            }

            for (const rule of config.rules[ruleType]) {
                try {
                    // Skip rule if conditions not met
                    if (rule.skip_if && validator.validateSkipRule(item, rule.skip_if)) {
                        continue;
                    }

                    // Check trigger conditions
                    if (validator.validateItemCondition(item, rule.trigger)) {
                        const action = createAction(rule, item);
                        if (action) {
                            actions.push(action);
                            log.info(`Rule triggered: ${rule.name} (${ruleType})`);
                        }
                    }
                } catch (error) {
                    log.error(`Error processing ${ruleType} rule: ${error.message}`, {
                        rule: rule.name || 'unnamed',
                        item: item.__typename + '#' + item.number
                    });
                }
            }
        }

        return actions;
    } catch (error) {
        log.error(`Failed to process rules: ${error.message}`);
        throw error;
    }
}

/**
 * Create action based on rule type and action
 * @param {Object} rule The rule to process
 * @param {Object} item The item being processed
 * @returns {Object|null} Action object or null if no action
 */
function createAction(rule, item) {
    const action = rule.action;
    
    // Handle array of actions
    if (Array.isArray(action)) {
        return action.map(singleAction => createSingleAction(singleAction, rule, item));
    }
    
    return createSingleAction(action, rule, item);
}

/**
 * Create a single action
 * @param {string} action The action string
 * @param {Object} rule The rule being processed
 * @param {Object} item The item being processed
 * @returns {Object} Action object
 */
function createSingleAction(action, rule, item) {
    switch (action) {
        case 'add_to_board':
            return {
                action: 'add_to_board',
                params: { item }
            };
            
        case 'set_column':
            return {
                action: `set_column: ${rule.value}`,
                params: { item }
            };
            
        case 'set_sprint':
            return {
                action: `set_sprint: ${rule.value}`,
                params: { item }
            };
            
        case 'add_assignee':
            return {
                action: `add_assignee: ${rule.value}`,
                params: { item, assignee: rule.value }
            };
            
        case 'inherit_column':
        case 'inherit_assignees':
            return {
                action: action,
                params: { item, rule: rule.name }
            };
            
        default:
            log.warn(`Unknown action: ${action}`);
            return null;
    }
}

/**
 * Process specific rule type (for backward compatibility)
 * @param {Object} item PR or Issue to process
 * @param {string} ruleType The type of rules to process
 * @returns {Promise<Array<{action: string, params: Object}>>} List of actions to take
 */
async function processRuleType(item, ruleType) {
    try {
        const config = loadBoardRules();
        const actions = [];

        if (!config.rules || !Array.isArray(config.rules[ruleType])) {
            return actions;
        }

        for (const rule of config.rules[ruleType]) {
            try {
                // Skip rule if conditions not met
                if (rule.skip_if && validator.validateSkipRule(item, rule.skip_if)) {
                    continue;
                }

                // Check trigger conditions
                if (validator.validateItemCondition(item, rule.trigger)) {
                    const action = createAction(rule, item);
                    if (action) {
                        if (Array.isArray(action)) {
                            actions.push(...action);
                        } else {
                            actions.push(action);
                        }
                    }
                }
            } catch (error) {
                log.error(`Error processing ${ruleType} rule: ${error.message}`);
            }
        }

        return actions;
    } catch (error) {
        log.error(`Failed to process ${ruleType} rules: ${error.message}`);
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
    // Backward compatibility exports
    processBoardItemRules,
    processColumnRules,
    processSprintRules,
    processAssigneeRules,
    processLinkedIssueRules
}; 
