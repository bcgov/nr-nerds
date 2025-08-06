/**
 * @fileoverview Project Board Sync - Central Development Reference
 * @centralReference Source of truth for project conventions
 * 
 * Development Conventions:
 * 1. Services and Major Components:
 *    - GitHub API integration (@see github/api.js)
 *    - Project Board State Management (@see utils/state-verifier.js)
 *    - Rules Processing (@see rules/*)
 * 
 * 2. Code Organization:
 *    - Business Rules: src/rules/ - Core rule implementations
 *    - Utils: src/utils/ - Common utilities and helpers
 *    - Config: src/config/ - Configuration and schema
 *    - GitHub: src/github/ - API wrappers and types
 * 
 * 3. Coding Standards:
 *    - Every rule module must implement state verification
 *    - Use state tracking for all board changes
 *    - Log all state changes via Logger class
 *    - Document public APIs with JSDoc
 * 
 * Documentation Maintenance:
 * 1. Requirements Sources:
 *    - config/rules.yml: Core business rules
 *    - CONTRIBUTING.md: Development guidelines
 *    - TECHNICAL.md: Implementation details
 *    - FUTURE-IDEAS.md: Planned enhancements
 * 
 * 2. Documentation Updates:
 *    - Update JSDoc when changing interfaces or behaviors
 *    - Keep module conventions in sync with implementations
 *    - Test cases must reflect documented requirements
 *    - Reference source requirements in major changes
 * 
 * 3. Stability Practices:
 *    - Follow module-specific update guidelines
 *    - Maintain consistent error handling
 *    - Preserve state tracking behaviors
 *    - Test all documented scenarios
 * 
 * @see rules.yml - Core business rules and configuration
 */

const { getRecentItems } = require('./github/api');
const Logger = require('./utils/log').Logger;
const log = new Logger();
const { StateVerifier } = require('./utils/state-verifier');
const { processAddItems } = require('./rules/add-items');
const { processColumnAssignment } = require('./rules/columns');
const { processSprintAssignment } = require('./rules/sprints');
const { processAssignees } = require('./rules/assignees');
const { processLinkedIssues } = require('./rules/linked-issues-processor');
const { StepVerification } = require('./utils/verification-steps');
const { EnvironmentValidator } = require('./utils/environment-validator');

// Initialize environment validation steps
const envValidator = new StepVerification([
  'TOKEN_CONFIGURED',
  'PROJECT_CONFIGURED',
  'LABELS_CONFIGURED'
]);

envValidator.addStepDependencies('PROJECT_CONFIGURED', [ 'TOKEN_CONFIGURED' ]);
envValidator.addStepDependencies('LABELS_CONFIGURED', [ 'PROJECT_CONFIGURED' ]);

// Static reference to allow access from other modules
StepVerification.envValidator = envValidator;

/**
 * Validate required environment variables and return configuration
 * 
 * @async
 * @returns {Promise<Object>} A configuration object containing validated environment settings
 * @throws {Error} If any required variables are missing or validation fails
 */
async function validateEnvironment() {
  const { StateVerifier } = require('./utils/state-verifier');

  // Initialize base state tracking
  StateVerifier.steps.markStepComplete('STATE_TRACKING_INITIALIZED');
  StateVerifier.steps.markStepComplete('VERIFICATION_PROGRESS_SETUP');

  // Initialize validator
  StateVerifier.getTransitionValidator(); // This marks TRANSITION_VALIDATOR_CONFIGURED

  try {
    // Use centralized environment validation
    const envConfig = await EnvironmentValidator.validateAll();
    
    // Mark validation steps as complete
    envValidator.markStepComplete('TOKEN_CONFIGURED');
    StateVerifier.steps.markStepComplete('TOKEN_CONFIGURED');
    
    envValidator.markStepComplete('PROJECT_CONFIGURED');
    StateVerifier.steps.markStepComplete('PROJECT_CONFIGURED');
    
    envValidator.markStepComplete('LABELS_CONFIGURED');
    StateVerifier.steps.markStepComplete('LABELS_CONFIGURED');

    // Complete state validation setup after environment is confirmed valid
    StateVerifier.steps.markStepComplete('RULES_INITIALIZED');
    StateVerifier.steps.markStepComplete('DEPENDENCIES_VERIFIED');
    StateVerifier.steps.markStepComplete('STATE_VALIDATED');
    StateVerifier.steps.markStepComplete('STATE_VERIFIED');
    
    return envConfig;
  } catch (error) {
    // Re-throw with enhanced context
    throw new Error(
      `Environment validation failed:\n${error.message}\n\n` +
      `Please check your environment variables and try again.`
    );
  }
}

/**
 * Project Board Sync Main Function
 * Implements all five rule sets from rules.yml:
 * 1. Which Items are Added (Board Addition Rules)
 * 2. Which Columns Items Go To (Column Rules)
 * 3. Sprint Assignment Rules
 * 4. Linked Issue Rules
 * 5. Assignee Rules
 */
async function main() {
  try {
    // Validate environment and get configuration
    const envConfig = await validateEnvironment();

    // Initialize context with validated environment config
    const context = {
      org: 'bcgov',
      repos: [
        'action-builder-ghcr',
        'nr-nerds',
        'quickstart-openshift',
        'quickstart-openshift-backends',
        'quickstart-openshift-helpers'
      ],
      monitoredUser: process.env.GITHUB_AUTHOR,
      projectId: envConfig.projectId,
      verbose: envConfig.verbose,
      strictMode: envConfig.strictMode
    };

    log.info('Starting Project Board Sync...');
    log.info(`User: ${context.monitoredUser}`);
    log.info(`Project: ${context.projectId}`);

    // Initialize state tracking
    if (context.verbose) {
      log.info('State tracking enabled');
    }
    const startTime = new Date();
    log.info('Monitored Repos: ' + context.repos.map(r => `${context.org}/${r}`).join(', '));

    // Process items according to our enhanced rules
    const { addedItems, skippedItems } = await processAddItems({
      org: context.org,
      repos: context.repos,
      monitoredUser: context.monitoredUser,
      projectId: context.projectId
    });

    // Process additional rules for added items
    const errors = [];
    for (const item of addedItems) {
      try {
        const itemRef = `${item.type} #${item.number}`;

        // First verify the item was added successfully
        await StateVerifier.verifyAddition(item, context.projectId);

        // Set initial column
        const columnResult = await processColumnAssignment(item, item.projectItemId, context.projectId);
        if (columnResult.changed) {
          log.info(`Set column for ${itemRef} to ${columnResult.newStatus}`);
          await StateVerifier.verifyColumn(item, context.projectId, columnResult.newStatus);
        }

        // Assign sprint if needed
        const sprintResult = await processSprintAssignment(
          item,
          item.projectItemId,
          context.projectId,
          columnResult.newStatus || columnResult.currentStatus
        );
        if (sprintResult.changed) {
          log.info(`Set sprint for ${itemRef} to ${sprintResult.newSprint}`);
        }

        // Handle assignees
        const assigneeResult = await processAssignees(item, context.projectId, item.projectItemId);
        if (assigneeResult.changed) {
          log.info(`Updated assignees for ${itemRef}: ${assigneeResult.assignees.join(', ')}`);
          await StateVerifier.verifyAssignees(item, context.projectId, assigneeResult.assignees);
        }

        // Process linked issues if it's a PR and has required properties
        if (item.type === 'PullRequest' && item.repository && item.repository.nameWithOwner) {
          log.info(`[Main] Processing linked issues for ${item.type} #${item.number} [${item.repository.nameWithOwner}]`);
          log.info(`[Main] PR projectItemId: ${item.projectItemId || 'MISSING'}`);
          log.info(`[Main] PR column: ${columnResult.newStatus || columnResult.currentStatus || 'MISSING'}`);
          log.info(`[Main] Calling processLinkedIssues for PR #${item.number} (${item.repository.nameWithOwner})`);
          const targetColumn = columnResult.newStatus || columnResult.currentStatus;
          const targetSprint = sprintResult.newSprint;

          const linkedResult = await processLinkedIssues(
            {
              ...item,
              __typename: 'PullRequest',
              repository: {
                nameWithOwner: item.repo || item.repository.nameWithOwner
              },
              projectItemId: item.projectItemId
            },
            context.projectId,
            targetColumn,
            targetSprint
          );

          if (linkedResult.processed > 0) {
            log.info(`[Main] Processed ${linkedResult.processed} linked issues for ${item.type} #${item.number}`);
            // Verify linked issues are in the correct state
            await StateVerifier.verifyLinkedIssues(
              item,
              context.projectId,
              linkedResult.processedIssues || [],
              targetColumn,
              targetSprint
            );
          }
        }

        // Finally verify the complete state of the item
        await StateVerifier.verifyCompleteState(item, context.projectId, {
          column: columnResult.newStatus || columnResult.currentStatus,
          sprint: sprintResult.changed ? undefined : sprintResult.newSprint, // Skip sprint verification if assignment was successful
          assignees: assigneeResult.changed ? assigneeResult.assignees : undefined
        });

      } catch (error) {
        errors.push(error);
        log.error(`Failed to process ${item.type} #${item.number}: ${error.message}`);
      }
    }

    // Print final status and handle errors
    const endTime = new Date();
    const duration = (endTime - startTime) / 1000;

    if (errors.length > 0) {
      log.error('Project Board Sync completed with errors');
    } else {
      log.info('Project Board Sync completed successfully');
    }

    // Always print summary and optional verbose output
    log.printSummary();
    if (process.env.VERBOSE) {
      log.info(`\nCompleted in ${duration}s`);
      log.printStateSummary();
      StateVerifier.printReports();
    }

    // Exit with error code if any errors occurred
    if (errors.length > 0) {
      process.exit(1);
    }

  } catch (error) {
    log.error(error);
    log.printSummary();
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    log.error('Unhandled error:', err);
    process.exit(1);
  });
}

module.exports = {
  main,
  validateEnvironment
};
