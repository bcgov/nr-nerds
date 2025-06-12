/**
 * @fileoverview Shared validation utilities for rule processors
 * 
 * @directive Always run the full test suite after making changes to validation rules:
 * ```bash
 * npm test
 * ```
 * This ensures that changes don't break existing rule validation logic.
 */

const { log } = require('../../utils/log');

class RuleValidation {
    /**
     * Validate item condition based on rule requirements
     */
    validateItemCondition(item, condition) {
        try {
            // Type validation
            if (condition.type && item.__typename !== condition.type) {
                log.debug(`Type mismatch: ${item.__typename} !== ${condition.type}`);
                return false;
            }

            // Author condition
            if (condition.condition === "item.author === monitored.user") {
                const monitoredUser = process.env.GITHUB_AUTHOR;
                const result = item.author?.login === monitoredUser;
                log.debug(`Author check: ${item.author?.login} === ${monitoredUser} -> ${result}`);
                return result;
            }

            return false;
        } catch (error) {
            log.error(`Error validating condition: ${error.message}`, { condition });
            return false;
        }
    }

    /**
     * Validate skip conditions
     */
    validateSkipRule(item, skipIf) {
        if (skipIf === "item.inProject") {
            const result = item.projectItems?.nodes?.length > 0;
            log.debug(`Skip check (in project): ${result}`);
            return result;
        }
        return false;
    }
}

module.exports = { RuleValidation };
