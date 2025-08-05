/**
 * @fileoverview Central state verification and management system
 * @see /src/index.js for project conventions and architecture
 * 
 * Module Conventions:
 * - Stateful verification with retry mechanism
 * - Comprehensive state tracking across operations
 * - Progress monitoring for all verifications
 * - Transition validation integration
 * 
 * Documentation Update Guidelines:
 * Update this documentation when:
 * - Adding new verification types
 * - Modifying retry mechanisms
 * - Changing state tracking integration
 * - Adding new validation rules
 * 
 * Maintain Stability:
 * - Keep retry logic consistent
 * - Document state verification flows
 * - Preserve error tracking format
 * - Test all verification paths
 */

const { log, Logger } = require('./log');
// Initialize logger
const verifierLog = new Logger();
const { getItemColumn, isItemInProject } = require('../github/api');
const { getItemSprint } = require('../rules/sprints');
const { getItemAssignees, setItemAssignees, getItemDetails } = require('../rules/assignees');
const { StateChangeTracker } = require('./state-changes');
const { VerificationProgress } = require('./verification-progress');
const { StateTransitionValidator } = require('./state-transition-validator');
const { StepVerification } = require('./verification-steps');
const { validateRequired, validateState, ValidationError } = require('./validation');

class StateVerifierError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'StateVerifierError';
    this.context = context;
    this.recoverySteps = context.recoverySteps || [];
    this.retryable = context.isRetryable || false;
  }

  addRecoveryStep(step) {
    this.recoverySteps.push(step);
    return this;
  }

  getDetailedMessage() {
    let msg = this.message;
    if (this.context.itemType && this.context.itemNumber) {
      msg = `${this.context.itemType} #${this.context.itemNumber}: ${msg}`;
    }
    if (this.recoverySteps.length > 0) {
      msg += '\nRecovery Steps:\n' + this.recoverySteps.map(step => `- ${step}`).join('\n');
    }
    return msg;
  }
}

class StateVerifier {
  static tracker = new StateChangeTracker();
  static progress = new VerificationProgress();
  static stateMap = new Map();
  static transitionValidator = null;

  // Enhanced step verification with validation dependencies
  static steps = new StepVerification([
    'STATE_TRACKING_INITIALIZED',
    'VERIFICATION_PROGRESS_SETUP',
    'TRANSITION_VALIDATOR_CONFIGURED',
    'RULES_INITIALIZED',
    'STATE_VALIDATED',
    'DEPENDENCIES_VERIFIED',
    'STATE_VERIFIED'
  ]);

  static {
    // Enhanced step dependencies with validation requirements
    StateVerifier.steps.addStepDependencies('VERIFICATION_PROGRESS_SETUP', [ 'STATE_TRACKING_INITIALIZED' ]);
    StateVerifier.steps.addStepDependencies('RULES_INITIALIZED', [ 'TRANSITION_VALIDATOR_CONFIGURED' ]);
    StateVerifier.steps.addStepDependencies('STATE_VALIDATED', [ 'RULES_INITIALIZED', 'DEPENDENCIES_VERIFIED' ]);
    StateVerifier.steps.addStepDependencies('STATE_VERIFIED', [ 'STATE_VALIDATED' ]);
  }

  static getTransitionValidator() {
    if (!this.transitionValidator) {
      this.transitionValidator = new StateTransitionValidator();
      this.steps.markStepComplete('TRANSITION_VALIDATOR_CONFIGURED');
    }
    return this.transitionValidator;
  }

  static initializeTransitionRules(rules) {
    try {
      validateRequired(rules, 'rules');
      this.steps.validateStepCompleted('TRANSITION_VALIDATOR_CONFIGURED');

      if (!rules.columns) return;

      for (const rule of rules.columns) {
        if (rule.validTransitions) {
          for (const transition of rule.validTransitions) {
            this.getTransitionValidator().addColumnTransitionRule(
              transition.from,
              transition.to,
              transition.conditions
            );
          }
        }
      }

      this.steps.markStepComplete('RULES_INITIALIZED');
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new StateVerifierError('Failed to initialize rules: Invalid configuration', {
          originalError: error,
          rules
        });
      }
      throw error;
    }
  }

  static validateState(item, state, rules) {
    try {
      validateRequired(item, 'item');
      validateRequired(state, 'state');
      validateRequired(rules, 'rules');

      // Validate state with enhanced error context
      validateState(state, rules, {
        itemType: item.type,
        itemNumber: item.number,
        recoverySteps: [
          'Verify state values match allowed values in rules',
          'Check for typos in column names and sprint names',
          'Ensure assignee usernames are correct'
        ]
      });

      this.steps.markStepComplete('STATE_VALIDATED');
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new StateVerifierError('Invalid state', {
          originalError: error,
          item,
          state,
          recoverySteps: error.recoverySteps
        });
      }
      throw error;
    }
  }

  static getState(item) {
    const key = `${item.type}#${item.number}`;
    if (!this.stateMap.has(key)) {
      this.stateMap.set(key, {
        inProject: item.projectItems?.nodes?.length > 0,
        projectItemId: item.projectItems?.nodes?.[ 0 ]?.id || null,
        assignees: [],
        column: 'None',
        sprint: 'None'
      });
      this.steps.markStepComplete('STATE_TRACKING_INITIALIZED');
    }
    return this.stateMap.get(key);
  }

  static updateState(item, newValues) {
    const key = `${item.type}#${item.number}`;
    const currentState = this.getState(item);
    const updatedState = { ...currentState, ...newValues };
    this.stateMap.set(key, updatedState);
    return updatedState;
  }

  static async verifyAddition(item, projectId) {
    this.tracker.startTracking(item);
    const beforeState = this.getState(item);

    return this.retryWithTracking(
      item,
      'Project Addition',
      async (attempt) => {
        // Add exponential backoff delay between retries
        if (attempt > 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          log.info(`Retry ${attempt}: Waiting ${delay}ms before checking project status...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const { isInProject, projectItemId } = await isItemInProject(item.id, projectId);
        const afterState = this.updateState(item, {
          inProject: true,
          projectItemId
        });

        this.tracker.recordChange(
          item,
          'Project Addition',
          beforeState,
          afterState,
          attempt
        );

        if (!isInProject) {
          const error = new Error(`Item ${item.type} #${item.number} was not added to project`);
          error.isRetryable = true; // Mark as retryable for eventual consistency
          throw error;
        }

        log.info(`✓ ${item.type} #${item.number} verified in project (attempt ${attempt}/3)`);
        return afterState;
      },
      `project addition for ${item.type} #${item.number}`
    );
  }

  static async verifyColumn(item, projectId, expectedColumn) {
    const beforeState = this.getState(item);

    // Validate the transition before attempting it
    const validationResult = this.getTransitionValidator().validateColumnTransition(
      beforeState.column,
      expectedColumn,
      { item }
    );

    if (!validationResult.valid) {
      throw new Error(`Invalid column transition: ${validationResult.reason}`);
    }

    return this.retryWithTracking(
      item,
      'Column Verification',
      async (attempt) => {
        const currentColumn = await getItemColumn(projectId, item.projectItemId);
        const afterState = this.updateState(item, { column: currentColumn });

        this.tracker.recordChange(
          item,
          'Column Verification',
          beforeState,
          afterState,
          attempt
        );

        if (currentColumn?.toLowerCase() !== expectedColumn?.toLowerCase()) {
          throw new Error(`Column mismatch for ${item.type} #${item.number}:
Expected: "${expectedColumn}"
Current: "${currentColumn}"`);
        }

        verifierLog.info(`✓ Column verified: "${expectedColumn}" (attempt ${attempt}/3)`);
        return afterState;
      },
      `column state for ${item.type} #${item.number}`
    );
  }

  static async verifyAssignees(item, projectId, expectedAssignees) {
    const beforeState = this.getState(item);

    return this.retryWithTracking(
      item,
      'Assignee Verification',
      async (attempt) => {
        // Get assignees from both project board and Issue/PR
        const projectAssignees = await getItemAssignees(projectId, item.projectItemId);
        const itemDetails = await getItemDetails(item.projectItemId);

        if (!itemDetails || !itemDetails.content) {
          verifierLog.error(`Could not get details for item ${item.projectItemId}`);
          throw new Error(`Could not get details for item ${item.projectItemId}`);
        }

        // Get Issue/PR assignees via REST API
        const { repository, number } = itemDetails.content;
        const [ owner, repo ] = repository.nameWithOwner.split('/');
        const issueOrPrData = itemDetails.type === 'PullRequest'
          ? await octokit.rest.pulls.get({ owner, repo, pull_number: number })
          : await octokit.rest.issues.get({ owner, repo, issue_number: number });

        const repoAssignees = issueOrPrData.data.assignees.map(a => a.login);

        // Verify both are in sync
        const afterState = this.updateState(item, { assignees: projectAssignees });
        this.tracker.recordChange(
          item,
          'Assignee Verification',
          beforeState,
          afterState,
          attempt
        );

        // Compare project board assignees with expected
        const missingInProject = expectedAssignees.filter(a => !projectAssignees.includes(a));
        const extraInProject = projectAssignees.filter(a => !expectedAssignees.includes(a));

        // Compare Issue/PR assignees with expected
        const missingInRepo = expectedAssignees.filter(a => !repoAssignees.includes(a));
        const extraInRepo = repoAssignees.filter(a => !expectedAssignees.includes(a)); if (missingInProject.length > 0 || extraInProject.length > 0 ||
          missingInRepo.length > 0 || extraInRepo.length > 0) {
          throw new Error(`Assignee mismatch for ${item.type} #${item.number}:
${missingInProject.length > 0 ? `Missing in project board: ${missingInProject.join(', ')}\n` : ''}${extraInProject.length > 0 ? `Extra in project board: ${extraInProject.join(', ')}\n` : ''}${missingInRepo.length > 0 ? `Missing in Issue/PR: ${missingInRepo.join(', ')}\n` : ''}${extraInRepo.length > 0 ? `Extra in Issue/PR: ${extraInRepo.join(', ')}` : ''}`);
        }

        verifierLog.info(`✓ Assignees verified for ${item.type} #${item.number} (attempt ${attempt}/3)`);
        return afterState;
      },
      `assignee state for ${item.type} #${item.number}`
    );
  }

  static async verifyCompleteState(item, projectId, expectedState) {
    // Validate required steps
    this.steps.validateStepCompleted('RULES_INITIALIZED');

    const itemRef = `${item.type}#${item.number}`;
    const totalSteps = Object.keys(expectedState).length;
    this.progress.startOperation('Complete Verification', itemRef, totalSteps);

    const beforeState = this.getState(item);

    // Enhanced state transition validation
    const validationResult = this.getTransitionValidator().validateStateTransition(
      item,
      beforeState,
      expectedState,
      { maxAssignees: 5 }
    );

    if (!validationResult.valid) {
      const error = new StateVerifierError(
        `Invalid state transition:\n${validationResult.errors.map(e => `  - ${e}`).join('\n')}`,
        {
          item,
          currentState: beforeState,
          expectedState,
          isRetryable: false,
          recoverySteps: validationResult.errors
            .filter(e => e.recovery)
            .map(e => e.recovery)
        }
      );
      throw error;
    }

    const result = await this.retryWithTracking(
      item,
      'Complete State Verification',
      async (attempt) => {
        // Get current state with error handling
        const apiStart = Date.now();
        try {
          const currentState = {
            inProject: true,
            projectItemId: item.projectItemId,
            column: await getItemColumn(projectId, item.projectItemId) || 'None',
            sprint: (await getItemSprint(projectId, item.projectItemId))?.sprintId || 'None',
            assignees: await getItemAssignees(projectId, item.projectItemId) || []
          };

          const afterState = this.updateState(item, currentState);
          this.progress.recordApiTiming('getItemState', Date.now() - apiStart);

          // Enhanced state verification with detailed error messages
          const mismatches = [];
          [ 'column', 'sprint', 'assignees' ].forEach(aspect => {
            if (expectedState[ aspect ]) {
              const success = this.verifyStateAspect(aspect, expectedState[ aspect ], afterState[ aspect ]);
              this.progress.recordStep('Complete Verification', itemRef,
                `Verify ${aspect}: ${JSON.stringify(expectedState[ aspect ])}`, success);

              if (!success) {
                const mismatchMessage = this.getStateAspectMismatchMessage(
                  aspect,
                  expectedState[ aspect ],
                  afterState[ aspect ]
                );
                mismatches.push({
                  aspect,
                  message: mismatchMessage,
                  recovery: this.getRecoverySteps(aspect, expectedState[ aspect ], afterState[ aspect ])
                });
              }
            }
          });

          if (mismatches.length > 0) {
            throw new StateVerifierError(
              'State verification failed:\n' +
              mismatches.map(m => `  - ${m.message}`).join('\n'),
              {
                itemType: item.type,
                itemNumber: item.number,
                isRetryable: true,
                recoverySteps: mismatches.flatMap(m => m.recovery)
              }
            );
          }

          this.tracker.recordChange(
            item,
            'Complete State Verification',
            beforeState,
            afterState,
            attempt
          );

          log.info(`✓ Complete state verified for ${itemRef} (attempt ${attempt}/3)`);

          this.steps.markStepComplete('STATE_VERIFIED');
          return afterState;
        } catch (error) {
          if (!error.isRetryable) {
            if (error instanceof StateVerifierError) {
              error.addRecoveryStep('Check API access and permissions');
              error.addRecoveryStep('Verify project board configuration');
            }
          }
          throw error;
        }
      },
      `complete state for ${item.type} #${item.number}`
    );

    return result;
  }

  /**
   * Verify a specific aspect of state
   * @private
   */
  static verifyStateAspect(aspect, expected, actual) {
    try {
      switch (aspect) {
        case 'column':
          return actual?.toLowerCase() === expected?.toLowerCase();
        case 'sprint':
          return actual === expected;
        case 'assignees':
          const expectedSet = new Set(expected);
          const actualSet = new Set(actual);
          return expected.length === actual.length &&
            expected.every(a => actualSet.has(a)) &&
            actual.every(a => expectedSet.has(a));
        default: verifierLog.warning(`Unknown state aspect: ${aspect}`);
          return false;
      }
    } catch (error) {
      verifierLog.error(`Error verifying ${aspect}: ${error.message}`);
      return false;
    }
  }

  static getRecoverySteps(aspect, expected, actual) {
    switch (aspect) {
      case 'column':
        return [
          `Verify column "${expected}" exists in project board`,
          `Check column transition rules allow moving to "${expected}"`,
          `Ensure required conditions are met for column transition`
        ];
      case 'sprint':
        return [
          `Verify sprint "${expected}" exists and is active`,
          `Check if sprint dates are valid`,
          `Ensure sprint is available for assignment`
        ];
      case 'assignees':
        const missing = expected.filter(a => !actual.includes(a));
        const extra = actual.filter(a => !expected.includes(a));
        const steps = [];
        if (missing.length > 0) {
          steps.push(`Add missing assignees: ${missing.join(', ')}`);
        }
        if (extra.length > 0) {
          steps.push(`Remove extra assignees: ${extra.join(', ')}`);
        }
        return steps;
      default:
        return [ `Verify ${aspect} configuration and permissions` ];
    }
  }

  static getStateAspectMismatchMessage(aspect, expected, actual) {
    switch (aspect) {
      case 'column':
        return `Column mismatch: expected "${expected}" but got "${actual}"`;
      case 'sprint':
        return `Sprint mismatch: expected "${expected}" but got "${actual}"`;
      case 'assignees':
        const expectedSet = new Set(expected);
        const actualSet = new Set(actual);
        const missing = expected.filter(a => !actualSet.has(a));
        const extra = actual.filter(a => !expectedSet.has(a));
        let message = 'Assignee mismatch:';
        if (missing.length > 0) {
          message += ` missing ${missing.join(', ')}`;
        }
        if (extra.length > 0) {
          message += ` extra ${extra.join(', ')}`;
        }
        return message;
      default:
        return `${aspect} mismatch: expected "${expected}" but got "${actual}"`;
    }
  }

  static async retryWithTracking(item, type, operation, description) {
    const MAX_RETRIES = 3;
    let lastError;
    let lastState = this.getState(item);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await operation(attempt, lastState);
        lastState = {
          ...lastState,
          ...(typeof result === 'object' ? result : {})
        };
        return result;
      } catch (error) {
        lastError = error;
        this.tracker.recordError(item, type, error, attempt);

        // Only retry if error is marked as retryable
        if (attempt < MAX_RETRIES && (error.retryable || error.isRetryable)) {
          const delay = Math.min(Math.pow(2, attempt - 1) * 1000, 5000);
          log.info(`
⌛ ${type} verification attempt ${attempt}/${MAX_RETRIES}
   Item: ${item.type} #${item.number}
   Current State: ${JSON.stringify(lastState, null, 2)}
   Error: ${error.message}
   Recovery Steps:\n${error.recoverySteps?.map(s => `   - ${s}`).join('\n') || '   None provided'}
   Retrying in ${delay / 1000}s...`);
          await sleep(delay);
          continue;
        }
        throw error;
      }
    }

    throw new StateVerifierError(
      `Failed to verify ${description} after ${MAX_RETRIES} attempts: ${lastError.message}`,
      {
        itemType: item.type,
        itemNumber: item.number,
        lastError,
        lastState
      }
    );
  }

  static printReports() {
    if (this.tracker) {
      this.tracker.printSummary();
      console.log('\nValidation Steps Status:');
      this.steps.printStepStatus();
    }
    if (this.progress) {
      this.progress.printProgressReport();
    }
    if (this.transitionValidator) {
      console.log('\nTransition Validation Stats:');
      this.getTransitionValidator().printStats();
    }
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { StateVerifier };
