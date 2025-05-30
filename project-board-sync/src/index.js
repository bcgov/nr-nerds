const { getRecentItems } = require('./github/api');
const Logger = require('./utils/log').Logger;
const log = new Logger();
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
  const required = ['GH_TOKEN', 'GITHUB_AUTHOR'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
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
    for (const item of addedItems) {
      try {
        const itemRef = `${item.type} #${item.number}`;

        // Set initial column
        const columnResult = await processColumnAssignment(item, item.projectItemId, context.projectId);
        if (columnResult.changed) {
          log.info(`Set column for ${itemRef} to ${columnResult.newStatus}`);
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
        }

        // Handle assignees
        const assigneeResult = await processAssignees(item, context.projectId, item.projectItemId);
        if (assigneeResult.changed) {
          log.info(`Updated assignees for ${itemRef}: ${assigneeResult.assignees.join(', ')}`);
        }

        // Process linked issues if it's a PR and has required properties
        if (item.type === 'PullRequest' && item.repository && item.repository.nameWithOwner) {
          const linkedResult = await processLinkedIssues(
            {
              ...item,
              __typename: 'PullRequest',
              repository: { 
                nameWithOwner: item.repo || item.repository.nameWithOwner 
              },
              projectItemId: item.projectItemId // Ensure project item ID is passed
            }, 
            context.projectId,
            columnResult.newStatus,
            sprintResult.newSprint
          );
          if (linkedResult.processed > 0) {
            log.info(`Processed ${linkedResult.processed} linked issues for ${itemRef}`);
          }
          if (linkedResult.errors > 0) {
            log.warn(`Failed to process ${linkedResult.errors} linked issues for ${itemRef}`);
          }
        }

      } catch (error) {
        log.error(`Failed to process ${item.type} #${item.number}: ${error.message}`);
      }
    }

    log.info('Project Board Sync completed successfully.');
    log.printSummary();

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
