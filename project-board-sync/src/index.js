const { getRecentItems } = require('./github/api');
const Logger = require('./utils/log').Logger;
const log = new Logger();
const { StateVerifier } = require('./utils/state-verifier');
const { processAddItems } = require('./rules/add-items');
const { processColumnAssignment } = require('./rules/columns');
const { processSprintAssignment } = require('./rules/sprints');
const { processAssignees } = require('./rules/assignees');
const { processLinkedIssues } = require('./rules/linked-issues');

/**
 * Validate required environment variables
 * @throws {Error} If any required variables are missing
 */
function validateEnvironment() {
  // Environment variables are injected by container or user
  return;
}

/**
 * Project Board Sync Main Function
 * Implements all five rule sets from requirements.md:
 * 1. Which Items are Added (Board Addition Rules)
 * 2. Which Columns Items Go To (Column Rules)
 * 3. Sprint Assignment Rules
 * 4. Linked Issue Rules
 * 5. Assignee Rules
 */
async function main() {
  try {
    validateEnvironment();

    // Initialize context
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
      projectId: process.env.PROJECT_ID || 'PVT_kwDOAA37OM4AFuzg'
    };

    log.info('Starting Project Board Sync...');
    log.info(`User: ${context.monitoredUser}`);
    
    // Initialize state tracking
    process.env.VERBOSE && log.info('State tracking enabled');
    const startTime = new Date();
    log.info(`Project: ${context.projectId}`);
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
          columnResult.newStatus
        );
        if (sprintResult.changed) {
          log.info(`Set sprint for ${itemRef} to ${sprintResult.newSprint}`);
          await StateVerifier.verifySprint(item, context.projectId, sprintResult.newSprint);
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
          sprint: sprintResult.newSprint,
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

module.exports = { main };
