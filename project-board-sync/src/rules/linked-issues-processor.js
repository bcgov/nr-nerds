/**
 * @fileoverview Linked issues processor using rule-based system
 * 
 * @directive Always run tests after modifying this file:
 * ```bash
 * npm test -- linked-issues-processor.test.js
 * ```
 * Changes here can affect how linked issues are processed.
 */

const { octokit } = require('../github/api');
const { log } = require('../utils/log');
const { getItemColumn, setItemColumn } = require('../github/api');
const { getItemAssignees, setItemAssignees } = require('./assignees');
const { processLinkedIssueRules } = require('./processors/unified-rule-processor');

/**
 * Process linked issues using rule-based system
 * @param {Object} pullRequest The pull request object
 * @param {string} projectId The project ID
 * @param {string} currentColumn The current column
 * @param {string} currentSprint The current sprint
 * @returns {Object} Processing result
 */
async function processLinkedIssues(pullRequest, projectId, currentColumn, currentSprint) {
    const { id: pullRequestId, number: pullRequestNumber, repository: { nameWithOwner: repositoryName }, state, merged } = pullRequest;
    const linkedIssueNodes = pullRequest.linkedIssues?.nodes || [];

    let changed = false;
    let reason = '';
    const linkedIssueResults = [];

    log.info(`Processing linked issues for PR #${pullRequestNumber} in ${repositoryName}`);
    
    if (linkedIssueNodes.length === 0) {
        reason = 'No linked issues';
        log.info(`No linked issues found for PR #${pullRequestNumber}`);
        return { changed, reason, linkedIssues: linkedIssueResults };
    }

    // Process rules for this PR
    const ruleActions = processLinkedIssueRules(pullRequest);
    
    if (ruleActions.length === 0) {
        reason = 'No linked issue rules triggered';
        log.info(`No linked issue rules triggered for PR #${pullRequestNumber}`);
        return { changed, reason, linkedIssues: linkedIssueResults };
    }

    // Process each linked issue
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

            // Apply rule actions
            for (const ruleAction of ruleActions) {
                const { action, params } = ruleAction;
                
                switch (action) {
                    case 'inherit_column':
                        if (currentColumn && currentColumn !== initialColumn) {
                            await setItemColumn(projectId, linkedIssueId, currentColumn);
                            log.info(`Set linked issue #${linkedIssueNumber} column to ${currentColumn}`);
                            changed = true;
                        }
                        break;
                        
                    case 'inherit_assignees':
                        const prAssignees = pullRequest.assignees?.nodes?.map(a => a.login) || [];
                        if (prAssignees.length > 0) {
                            await setItemAssignees(projectId, linkedIssueId, prAssignees);
                            log.info(`Set linked issue #${linkedIssueNumber} assignees to: ${prAssignees.join(', ')}`);
                            changed = true;
                        }
                        break;
                        
                    default:
                        log.warn(`Unknown linked issue action: ${action}`);
                }
            }

            // Log final state
            const finalColumn = await getItemColumn(projectId, linkedIssueId);
            const finalAssignees = await getItemAssignees(projectId, linkedIssueId);
            
            log.logState(linkedIssueId, 'Issue Final', {
                column: finalColumn,
                assignees: finalAssignees
            });

            linkedIssueResults.push({
                id: linkedIssueId,
                number: linkedIssueNumber,
                column: finalColumn,
                assignees: finalAssignees
            });

        } catch (error) {
            log.error(`Error updating linked issue ${linkedIssueNumber} in repository ${linkedIssueRepositoryName}: ${error.message}`);
            throw error;
        }
    }

    // Print state change summary
    log.printStateSummary();

    return { 
        changed, 
        reason: changed ? 'Linked issues updated' : 'No changes needed',
        linkedIssues: linkedIssueResults,
        processed: linkedIssueResults.length
    };
}

module.exports = {
    processLinkedIssues
}; 
