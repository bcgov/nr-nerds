const { loadBoardRules } = require('../../config/board-rules');
const { RuleValidation } = require('./validation');

const validator = new RuleValidation();

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

            // Check each trigger
            for (const trigger of rule.triggers) {
                if (validator.validateItemCondition(item, trigger)) {
                    actions.push({
                        action: `set_sprint: ${rule.targetSprint}`,
                        params: { item }
                    });
                }
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
