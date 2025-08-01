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
        
        // Simple steps tracking for validation
        this.steps = {
            markStepComplete: (step) => {
                // Simple step tracking for validation
            }
        };
    }

    /**
     * Validate item condition based on rule requirements
     */
    validateItemCondition(item, condition) {
        try {
            // Type validation
            if (condition.type) {
                if (Array.isArray(condition.type)) {
                    // Handle array of types (e.g., ["PullRequest", "Issue"])
                    if (!condition.type.includes(item.__typename)) {
                        log.debug(`Type mismatch: ${item.__typename} not in ${JSON.stringify(condition.type)}`);
                        return false;
                    }
                } else {
                    // Handle single type (e.g., "PullRequest")
                    if (item.__typename !== condition.type) {
                        log.debug(`Type mismatch: ${item.__typename} !== ${condition.type}`);
                        return false;
                    }
                }
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

            // Specific column checks
            if (condition.condition === "item.column === 'New'" || 
                condition.condition === "item.column === \"New\"") {
                const result = item.column === 'New';
                log.debug(`Column check (New): ${item.column} === 'New' -> ${result}`);
                return result;
            }

            if (condition.condition === "item.column === 'Next' || item.column === 'Active'" || 
                condition.condition === "item.column === \"Next\" || item.column === \"Active\"") {
                const result = item.column === 'Next' || item.column === 'Active';
                log.debug(`Column check (Next/Active): ${item.column} in ['Next', 'Active'] -> ${result}`);
                return result;
            }

            if (condition.condition === "item.column === 'Done'" || 
                condition.condition === "item.column === \"Done\"") {
                const result = item.column === 'Done';
                log.debug(`Column check (Done): ${item.column} === 'Done' -> ${result}`);
                return result;
            }

            if (condition.condition === "item.column === 'Waiting'" || 
                condition.condition === "item.column === \"Waiting\"") {
                const result = item.column === 'Waiting';
                log.debug(`Column check (Waiting): ${item.column} === 'Waiting' -> ${result}`);
                return result;
            }

            // Sprint conditions
            if (condition.condition === "item.sprint === 'current'") {
                const result = item.sprint === 'current';
                log.debug(`Sprint check (current): ${item.sprint} === 'current' -> ${result}`);
                return result;
            }

            // Linked issue conditions
            if (condition.condition === "!item.pr.closed || item.pr.merged") {
                const result = !item.pr?.closed || item.pr?.merged;
                log.debug(`Linked PR check: !${item.pr?.closed} || ${item.pr?.merged} -> ${result}`);
                return result;
            }

            // Column inheritance conditions
            if (condition.condition === "item.column === item.pr.column && item.assignees === item.pr.assignees") {
                const result = item.column === item.pr?.column && 
                              JSON.stringify(item.assignees) === JSON.stringify(item.pr?.assignees);
                log.debug(`Column/assignee inheritance check: ${result}`);
                return result;
            }

            // Assignee inheritance conditions
            if (condition.condition === "item.assignees.includes(item.author)") {
                const result = item.assignees?.nodes?.some(a => a.login === item.author?.login) || false;
                log.debug(`Author assignee check: ${item.assignees?.nodes?.map(a => a.login).join(', ')} includes ${item.author?.login} -> ${result}`);
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
        try {
            // Project membership check
            if (skipIf === "item.inProject") {
                const result = item.projectItems?.nodes?.length > 0;
                log.debug(`Skip check (in project): ${result}`);
                return result;
            }

            // Column-based skip conditions
            if (skipIf === "item.column !== 'New'") {
                const result = item.column !== 'New';
                log.debug(`Skip check (not New column): ${item.column} !== 'New' -> ${result}`);
                return result;
            }

            if (skipIf === "item.column") {
                const result = item.column && item.column !== 'None';
                log.debug(`Skip check (has column): ${item.column} exists -> ${result}`);
                return result;
            }

            // Sprint-based skip conditions
            if (skipIf === "item.sprint === 'current'" || 
                skipIf === "item.sprint === \"current\"") {
                const result = item.sprint === 'current';
                log.debug(`Skip check (current sprint): ${item.sprint} === 'current' -> ${result}`);
                return result;
            }

            // Assignee-based skip conditions
            if (skipIf === "item.assignees.includes(item.author)") {
                const result = item.assignees?.nodes?.some(a => a.login === item.author?.login) || false;
                log.debug(`Skip check (author assigned): ${item.assignees?.nodes?.map(a => a.login).join(', ')} includes ${item.author?.login} -> ${result}`);
                return result;
            }

            return false;
        } catch (error) {
            log.error(`Error validating skip condition: ${error.message}`, { skipIf });
            return false;
        }
    }
}

module.exports = { RuleValidation };
