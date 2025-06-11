const { loadBoardRules } = require('../../config/board-rules');
const { validator } = require('./shared-validator');
const { log } = require('../../utils/log');

/**
 * Process rules for managing item sprints in the project board
 * @param {Object} item PR or Issue to process
 * @returns {Array<{action: string, params: Object}>} List of actions to take
 */
function processSprintRules(item) {
    const rules = loadBoardRules();
    const actions = [];
    validator.steps.markStepComplete('RULE_CONFIG_LOADED');

    for (const rule of rules.sprints) {
        try {
            // Skip rule if conditions not met
            if (rule.skipIf && validator.validateSkipRule(item, rule.skipIf)) {
                continue;
            }

            // Check trigger conditions
            if (validator.validateItemCondition(item, rule.trigger)) {
                actions.push({
                    action: `set_sprint: ${rule.value}`,
                    params: { item }
                });
            }
        } catch (error) {
            log.error(`Error processing sprint rule: ${error.message}`);
        }
    }

    return actions;
}

module.exports = {
    processSprintRules
};
