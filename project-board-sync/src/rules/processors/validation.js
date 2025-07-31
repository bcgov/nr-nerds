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
    constructor() {
        // Initialize monitored repositories for repository-based conditions
        this.monitoredRepos = new Set([
            'bcgov/action-builder-ghcr',
            'bcgov/nr-nerds', 
            'bcgov/quickstart-openshift',
            'bcgov/quickstart-openshift-backends',
            'bcgov/quickstart-openshift-helpers'
        ]);
    }

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

            // Repository condition - NEW
            if (condition.condition === "monitored.repos.includes(item.repository)") {
                const result = this.monitoredRepos.has(item.repository?.nameWithOwner);
                log.debug(`Repository check: ${item.repository?.nameWithOwner} in monitored repos -> ${result}`);
                return result;
            }

            // Assignee condition - NEW
            if (condition.condition === "item.assignees.includes(monitored.user)") {
                const monitoredUser = process.env.GITHUB_AUTHOR;
                const result = item.assignees?.nodes?.some(a => a.login === monitoredUser) || false;
                log.debug(`Assignee check: ${item.assignees?.nodes?.map(a => a.login).join(', ')} includes ${monitoredUser} -> ${result}`);
                return result;
            }

            // Column condition - NEW
            if (condition.condition === "!item.column") {
                const result = !item.column || item.column === 'None';
                log.debug(`No column check: ${item.column} -> ${result}`);
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
