/**
 * @fileoverview Input validation and type checking utilities
 */
const { log } = require('./log');

class ValidationError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'ValidationError';
    this.context = context;
    this.recoverySteps = context.recoverySteps || [];
    this.validationPath = context.field ? [context.field] : [];
  }

  addValidationContext(field) {
    this.validationPath.unshift(field);
    return this;
  }

  getDetailedMessage() {
    let msg = this.message;
    if (this.validationPath.length > 0) {
      msg += `\nValidation Path: ${this.validationPath.join('.')}`;
    }
    if (this.recoverySteps.length > 0) {
      msg += '\nRecovery Steps:\n' + this.recoverySteps.map(step => `- ${step}`).join('\n');
    }
    return msg;
  }
}

function validateRequired(value, name, context = {}) {
  if (value === undefined || value === null) {
    throw new ValidationError(`Required value missing: ${name}`, { ...context, field: name });
  }
}

function validateType(value, type, name, context = {}) {
  if (value === undefined || value === null) return;

  const actualType = Array.isArray(value) ? 'array' : typeof value;
  if (actualType !== type) {
    throw new ValidationError(
      `Invalid type for ${name}: expected ${type}, got ${actualType}`,
      { ...context, field: name, expectedType: type, actualType }
    );
  }
}

function validateEnum(value, allowedValues, name, context = {}) {
  if (value === undefined || value === null) return;

  if (!allowedValues.includes(value)) {
    throw new ValidationError(
      `Invalid value for ${name}: "${value}". Must be one of: ${allowedValues.join(', ')}`,
      {
        ...context,
        field: name,
        allowedValues,
        actualValue: value,
        recoverySteps: [
          `Check if "${value}" is a typo`,
          `Verify that ${name} is using an up-to-date value from the allowed list`,
          `Update configurations if the value should be added to allowed values`
        ]
      }
    );
  }
}

function validateState(state, rules, context = {}) {
  try {
    // Validate column enum values
    if (state.column) {
      validateEnum(
        state.column, 
        rules.columns.map(r => r.name),
        'column',
        context
      );
    }

    // Validate sprint values  
    if (state.sprint) {
      validateEnum(
        state.sprint,
        ['None', 'current', ...rules.sprints.map(r => r.name)],
        'sprint',
        context
      );
    }

    // Validate assignees with enhanced error context
    if (state.assignees) {
      validateType(state.assignees, 'array', 'assignees', {
        ...context,
        recoverySteps: [
          'Ensure assignees is provided as an array of usernames',
          'Convert single assignee string to array if needed'
        ]
      });
      
      state.assignees.forEach((assignee, index) => {
        validateType(assignee, 'string', `assignees[${index}]`, {
          ...context,
          recoverySteps: [
            'Verify assignee username is a string',
            'Check if username exists in the organization'
          ]
        });
      });
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      error.addValidationContext('state');
    }
    throw error;
  }
}

function validateRules(rules) {
  validateRequired(rules, 'rules');
  validateType(rules, 'object', 'rules');

  // Validate required rule sections
  const requiredSections = Object.keys(rules);
  requiredSections.forEach(section => {
    validateRequired(rules[section], `rules.${section}`);
    validateType(rules[section], 'array', `rules.${section}`);
  });

  // Validate column rules structure
  rules.columns.forEach((rule, index) => {
    validateRequired(rule.name, `rules.columns[${index}].name`);
    validateType(rule.name, 'string', `rules.columns[${index}].name`);
    
    if (rule.validTransitions) {
      validateType(rule.validTransitions, 'array', `rules.columns[${index}].validTransitions`);
      rule.validTransitions.forEach((transition, tIndex) => {
        validateRequired(transition.from, `rules.columns[${index}].validTransitions[${tIndex}].from`);
        validateRequired(transition.to, `rules.columns[${index}].validTransitions[${tIndex}].to`);
      });
    }
  });
}

module.exports = {
  ValidationError,
  validateRequired,
  validateType,
  validateEnum,
  validateState,
  validateRules
};
