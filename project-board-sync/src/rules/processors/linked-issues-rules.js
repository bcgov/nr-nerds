/**
 * @fileoverview Processor for linked issue management rules
 *
 * @directive Always run tests after modifying this file:
 * ```bash
 * npm test -- processors/linked-issues-rules.test.js
 * npm test -- processors/real-scenarios.test.js
 * ```
 * Changes here can affect how linked issues are managed.
 */

const { loadBoardRules } = require('../../config/board-rules');
const { validator } = require('./shared-validator');
const { log } = require('../../utils/log');

/**
 * Process rules for managing linked issues in the project board
 * @param {Object} item PR or Issue to process
 * @returns {Array<{action: string, params: Object}>} List of actions to take
 */
function processLinkedIssueRules(item) {
    const config = loadBoardRules();
    const actions = [];
    validator.steps.markStepComplete('RULE_CONFIG_LOADED');

    // Validate config structure before processing
    if (!config.rules || !Array.isArray(config.rules.linked_issues)) {
        log.warn('Linked issue rules configuration missing or not an array; skipping linked issue processing.');
        return actions;
    }

    for (const rule of config.rules.linked_issues) {
        try {
            // Skip rule if conditions not met
            if (rule.skip_if && validator.validateSkipRule(item, rule.skip_if)) {
                continue;
            }

            // Check trigger conditions
            if (validator.validateItemCondition(item, rule.trigger)) {
                // Handle array of actions
                const ruleActions = Array.isArray(rule.action) ? rule.action : [rule.action];
                
                for (const action of ruleActions) {
                    actions.push({
                        action: action,
                        params: { 
                            item, 
                            rule: rule.name,
                            actions: ruleActions 
                        }
                    });
                }
            }
        } catch (error) {
            log.error(`Error processing linked issue rule: ${error.message}`);
        }
    }

    return actions;
}

module.exports = {
    processLinkedIssueRules
}; 
