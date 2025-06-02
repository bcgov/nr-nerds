const { octokit } = require('../github/api');
const { log, Logger } = require('../utils/log');
const { getItemColumn, setItemColumn } = require('../github/api');
const { processSprintAssignment } = require('./sprints');
const { getItemAssignees, setItemAssignees } = require('./assignees');

async function processLinkedIssues(pullRequest, projectItemId, projectId, currentColumn) {
  const { id: pullRequestId, number: pullRequestNumber, repository: { nameWithOwner: repositoryName }, state, merged } = pullRequest;
  // Handle optional properties safely
  const assigneeNodes = pullRequest.assignees?.nodes || [];
  const linkedIssueNodes = pullRequest.linkedIssues?.nodes || [];

  let changed = false;
  let reason = '';
  const linkedIssueResults = [];

  log.info(`Processing linked issues for PR #${pullRequestNumber} in ${repositoryName}`);
  
  // Log PR initial state
  const prState = {
    column: currentColumn,
    assignees: assigneeNodes.map(a => a.login),
    status: state,
    merged
  };
  log.logState(pullRequestId, 'PR Initial', prState);

  if (linkedIssueNodes.length === 0) {
    reason = 'No linked issues';
    log.info(`No linked issues found for PR #${pullRequestNumber}`);
    log.logState(pullRequestId, 'PR Final - No Linked Issues', prState);
    log.printStateSummary();
    return { changed, reason, linkedIssues: linkedIssueResults };
  }

  if (state === 'CLOSED' && !merged) {
    reason = 'PR is closed but not merged';
    log.info(`Skipping closed but unmerged PR #${pullRequestNumber}`);
    log.logState(pullRequestId, 'PR Final - Not Merged', prState);
    log.printStateSummary();
    return { changed, reason, linkedIssues: linkedIssueResults };
  }

  for (const linkedIssue of linkedIssueNodes) {
    const { id: linkedIssueId, number: linkedIssueNumber, repository: { nameWithOwner: linkedIssueRepositoryName } } = linkedIssue;

    try {
      // Log initial state
      const initialColumn = await getItemColumn(projectId, linkedIssueId);
      const initialAssignees = await getItemAssignees(projectId, linkedIssueId);
      log.logState(linkedIssueId, 'Issue Initial', {
        column: initialColumn,
        assignees: initialAssignees
      });

      // Sync column
      if (currentColumn) {
        await setItemColumn(projectId, linkedIssueId, currentColumn);
        log.info(`Set linked issue #${linkedIssueNumber} column to ${currentColumn}`);
      }

      // Sync assignees
      const prAssignees = assigneeNodes.map(a => a.login);
      if (prAssignees.length > 0) {
        await setItemAssignees(projectId, linkedIssueId, prAssignees);
        log.info(`Set linked issue #${linkedIssueNumber} assignees to: ${prAssignees.join(', ')}`);
      }

      // Log final state
      log.logState(linkedIssueId, 'Issue Final', {
        column: currentColumn,
        assignees: prAssignees
      });

      linkedIssueResults.push({
        id: linkedIssueId,
        number: linkedIssueNumber,
        column: currentColumn,
        assignees: prAssignees
      });

      changed = true;
      } catch (error) {
        log.error(`Error updating linked issue ${linkedIssueNumber} in repository ${linkedIssueRepositoryName}: ${error.message}`);
        throw error;
      }
  }

  // Print state change summary
  log.printStateSummary();

  return { changed, reason, linkedIssues: linkedIssueResults };
}

module.exports = {
  processLinkedIssues
};
