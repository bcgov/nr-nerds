/**
 * @fileoverview Processor for assignee management rules
 * 
 * @directive Always run tests after modifying this file:
 * ```bash
 * npm test -- processors/assignee-rules.test.js
 * npm test -- processors/real-scenarios.test.js
 * ```
 * Changes here can affect how assignees are managed.
 */

const { loadBoardRules } = require('../../config/board-rules');
const { validator } = require('./shared-validator');
const { log } = require('../../utils/log');

/**
 * Process rules for managing item assignees in the project board
 * @param {Object} item PR or Issue to process
 * @returns {Array<{action: string, params: Object}>} List of actions to take
 */
function processAssigneeRules(item) {
    const config = loadBoardRules();
    const actions = [];
    validator.steps.markStepComplete('RULE_CONFIG_LOADED');

    for (const rule of config.rules.assignees) {
        try {
            // Skip rule if conditions not met
            if (rule.skipIf && validator.validateSkipRule(item, rule.skipIf)) {
                continue;
            }

            // Check trigger conditions
            if (validator.validateItemCondition(item, rule.trigger)) {
                actions.push({
                    action: `add_assignee: ${rule.value}`,
                    params: { item, assignee: rule.value }
                });
            }
        } catch (error) {
            log.error(`Error processing assignee rule: ${error.message}`);
        }
    }

    return actions;
}

module.exports = {
    processAssigneeRules
};
