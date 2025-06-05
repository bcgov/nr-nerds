const { log } = require('./log');
const { StateChangeTracker } = require('./state-changes');

class StateTransitionValidator {
  constructor() {
    this.tracker = new StateChangeTracker();
    this.columnRules = new Map();
  }

  /**
   * Add a rule for valid column transitions
   * @param {string|string[]} from - Source column(s)
   * @param {string} to - Target column
   * @param {string[]} conditions - Required conditions for the transition
   */
  addColumnTransitionRule(from, to, conditions = []) {
    const sources = Array.isArray(from) ? from : [from];
    for (const source of sources) {
      const sourceLower = source.toLowerCase();
      if (!this.columnRules.has(sourceLower)) {
        this.columnRules.set(sourceLower, []);
      }
      this.columnRules.get(sourceLower).push({ to, conditions });
    }
  }

  /**
   * Check if a column transition is valid
   * @param {string} from - Source column
   * @param {string} to - Target column
   * @param {Object} context - Additional context for evaluating conditions
   * @returns {{ valid: boolean, reason?: string }}
   */
  validateColumnTransition(from, to, context = {}) {
    // Allow initial column setting
    if (!from || from === 'None') {
      return { valid: true };
    }

    // Normalize column names for comparison
    const normalizedFrom = from.toLowerCase();
    const normalizedTo = to.toLowerCase();

    // No change
    if (normalizedFrom === normalizedTo) {
      return { valid: true };
    }

    // Check if source column has any rules
    const rules = this.columnRules.get(normalizedFrom);
    if (!rules) {
      return {
        valid: false,
        reason: `No transitions defined from column "${from}"`
      };
    }

    // Find matching rule
    const matchingRule = rules.find(rule => {
      const ruleToLower = Array.isArray(rule.to) ? rule.to.map(t => t.toLowerCase()) : rule.to.toLowerCase();
      if (Array.isArray(ruleToLower)) {
        return ruleToLower.includes(normalizedTo);
      }
      return ruleToLower === normalizedTo;
    });

    if (!matchingRule) {
      return {
        valid: false,
        reason: `Transition from "${from}" to "${to}" is not allowed`
      };
    }

    // Check conditions if any
    if (matchingRule.conditions.length > 0) {
      const failedConditions = matchingRule.conditions.filter(condition => {
        try {
          // Simple condition evaluation with context object
          return !this.evaluateCondition(condition, context);
        } catch (error) {
          log.error(`Error evaluating condition "${condition}": ${error.message}`);
          return true;
        }
      });

      if (failedConditions.length > 0) {
        return {
          valid: false,
          reason: `Failed conditions for transition: ${failedConditions.join(', ')}`
        };
      }
    }

    return { valid: true };
  }

  /**
   * Safely evaluate a condition using the provided context
   * @param {string} condition - The condition to evaluate
   * @param {Object} context - The context object with variables
   * @returns {boolean}
   */
  evaluateCondition(condition, context) {
    // Simple condition evaluation based on context properties
    try {
      // Convert dot notation to actual object access
      // e.g., "item.hasReviewers" checks context.item.hasReviewers
      let value;

      // First check if it's a simple context property
      if (context.hasOwnProperty(condition)) {
        value = context[condition];
      } else {
        // Handle dot notation for nested properties
        const properties = condition.split('.');
        value = properties.reduce((obj, prop) => {
          if (!obj || typeof obj !== 'object') return undefined;
          return obj[prop];
        }, context);
      }

      // Truthy check (allows boolean true, non-empty arrays, non-empty strings, etc.)
      return Boolean(value);
    } catch (error) {
      log.error(`Invalid condition "${condition}": ${error.message}`);
      return false;
    }
  }

  /**
   * Validate a complete state transition
   * @param {Object} item - The item being modified
   * @param {Object} currentState - Current state of the item
   * @param {Object} newState - Proposed new state
   * @param {Object} context - Additional context for validation
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateStateTransition(item, currentState, newState, context = {}) {
    const errors = [];

    // Check column transition if changing
    if (newState.column && newState.column !== currentState.column) {
      const result = this.validateColumnTransition(
        currentState.column,
        newState.column,
        { ...context, item }
      );
      if (!result.valid) {
        errors.push(result.reason);
      }
    }

    // Validate assignee changes
    if (newState.assignees) {
      const currentSet = new Set(currentState.assignees || []);
      const newSet = new Set(newState.assignees);
      
      // Check for invalid removals
      const removedAssignees = Array.from(currentSet).filter(a => !newSet.has(a));
      if (removedAssignees.length > 0) {
        errors.push(`Cannot remove assignees "${removedAssignees.join(', ')}" without explicit removal action`);
      }

      // Check maximum assignees (if configured)
      if (context.maxAssignees && newSet.size > context.maxAssignees) {
        errors.push(`Maximum of ${context.maxAssignees} assignees allowed`);
      }
    }

    // Track the transition attempt
    this.tracker.recordChange(
      item,
      'State Transition',
      currentState,
      newState,
      errors.length === 0 ? 1 : 0
    );

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Print validation statistics
   */
  printStats() {
    this.tracker.printSummary();
  }
}

module.exports = { StateTransitionValidator };
