// Minimal script: assign all open/closed PRs by GITHUB_AUTHOR to GITHUB_AUTHOR using REST API
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const yaml = require("js-yaml");

const GH_TOKEN = process.env.GH_TOKEN;
const GITHUB_AUTHOR = process.env.GITHUB_AUTHOR || "DerekRoberts";
const octokit = new Octokit({ auth: GH_TOKEN });

const PROJECT_ID = 'PVT_kwDOAA37OM4AFuzg';
const repos = yaml.load(fs.readFileSync("project-sync/repos.yml")).repos;

// === CONFIGURATION ===
const VERBOSE = process.argv.includes('--verbose');
// REMINDER: Consider TypeScript and more unit tests in future for maintainability and safety.

class DiagnosticsContext {
  constructor() {
    this.errors = [];
    this.summary = [];
  }
}

// Helper to get the current sprint iteration ID (the one whose startDate is closest to today but not in the future)
function getCurrentSprintIterationId(iterations) {
  const today = new Date();
  let current = null;
  for (const iter of iterations) {
    const start = new Date(iter.startDate);
    const end = new Date(start);
    end.setDate(start.getDate() + iter.duration);
    if (start <= today && today < end) {
      current = iter.id;
      break;
    }
  }
  return current;
}

// Helper to ensure a current sprint exists (today is within a sprint window)
let cachedCurrentSprintId = null;
async function ensureCurrentSprintExists(sprintField) {
  if (!sprintField || !sprintField.configuration) return;
  const iterations = sprintField.configuration.iterations;
  if (cachedCurrentSprintId === null) {
    cachedCurrentSprintId = getCurrentSprintIterationId(iterations);
  }
  if (!cachedCurrentSprintId) {
    console.error('\nERROR: No current sprint is available. Please create a sprint in the GitHub UI that includes today.');
    process.exit(1);
  }
}

// Helper to add an item (PR or issue) to project and set status and sprint
async function addItemToProjectAndSetStatus(nodeId, type, number, sprintField, logPrefix = '', repoName = '', prState = null, prMerged = false, diagnostics, isLinkedIssue = false, statusFieldOptions = null) {
  try {
    // Paginate through project items to check if this nodeId is already present
    let projectItemId = null;
    let endCursor = null;
    let found = false;
    do {
      const existingItemQuery = await octokit.graphql(`
        query($projectId:ID!, $after:String) {
          node(id: $projectId) {
            ... on ProjectV2 {
              items(first: 100, after: $after) {
                nodes { id content { ... on PullRequest { id } ... on Issue { id } } }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }
      `, {
        projectId: PROJECT_ID,
        after: endCursor
      });
      const items = existingItemQuery.node.items.nodes;
      const match = items.find(item => item.content && item.content.id === nodeId);
      if (match) {
        projectItemId = match.id;
        found = true;
        break;
      }
      endCursor = existingItemQuery.node.items.pageInfo.endCursor;
    } while (endCursor);
    let added = false;
    if (!found) {
      // Not in project, add it
      const addResult = await octokit.graphql(`
        mutation($projectId:ID!, $contentId:ID!) {
          addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
            item { id }
          }
        }
      `, {
        projectId: PROJECT_ID,
        contentId: nodeId
      });
      projectItemId = addResult.addProjectV2ItemById.item.id;
      added = true;
    }
    // Only set Status to Active for open PRs/issues, and to Done for closed unmerged PRs
    let statusMsg = '';
    if (!statusFieldOptions) throw new Error('Status field options not provided');
    if (type === 'PR' && prState === 'closed') {
      if (prMerged) {
        statusMsg = ', status=UNCHANGED (merged PR)';
      } else {
        await octokit.graphql(`
          mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
            updateProjectV2ItemFieldValue(input: {
              projectId: $projectId,
              itemId: $itemId,
              fieldId: $fieldId,
              value: { singleSelectOptionId: $optionId }
            }) { projectV2Item { id } }
          }
        `, {
          projectId: PROJECT_ID,
          itemId: projectItemId,
          fieldId: statusFieldOptions.fieldId,
          optionId: statusFieldOptions.done
        });
        statusMsg = ', status=Done (closed unmerged PR)';
      }
    } else if (type === 'issue' && prState === 'closed') {
      // For closed issues (e.g., linked issues after PR merge), set to Done
      await octokit.graphql(`
        mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId,
            itemId: $itemId,
            fieldId: $fieldId,
            value: { singleSelectOptionId: $optionId }
          }) { projectV2Item { id } }
        }
      `, {
        projectId: PROJECT_ID,
        itemId: projectItemId,
        fieldId: statusFieldOptions.fieldId,
        optionId: statusFieldOptions.done
      });
      statusMsg = ', status=Done (closed/linked issue)';
    } else {
      await octokit.graphql(`
        mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId,
            itemId: $itemId,
            fieldId: $fieldId,
            value: { singleSelectOptionId: $optionId }
          }) { projectV2Item { id } }
        }
      `, {
        projectId: PROJECT_ID,
        itemId: projectItemId,
        fieldId: statusFieldOptions.fieldId,
        optionId: statusFieldOptions.active
      });
      statusMsg = ', status=Active';
    }
    // Get Sprint field iterations
    // Use cachedCurrentSprintId for sprint assignment
    let sprintMsg = '';
    if (sprintField && sprintField.configuration) {
      await ensureCurrentSprintExists(sprintField);
      const iterations = sprintField.configuration.iterations;
      const currentSprintId = cachedCurrentSprintId;
      const currentSprint = iterations.find(i => i.id === currentSprintId);
      if (currentSprintId && currentSprint) {
        await octokit.graphql(`
          mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $iterationId:String!) {
            updateProjectV2ItemFieldValue(input: {
              projectId: $projectId,
              itemId: $itemId,
              fieldId: $fieldId,
              value: { iterationId: $iterationId }
            }) { projectV2Item { id } }
          }
        `, {
          projectId: PROJECT_ID,
          itemId: projectItemId,
          fieldId: sprintField.id,
          iterationId: currentSprintId
        });
        sprintMsg = `, sprint='${currentSprint.title}'`;
      } else {
        sprintMsg = ', sprint=NOT FOUND (check sprint setup in project!)';
      }
    } else {
      sprintMsg = ', sprint=NOT FOUND (no sprint field)';
    }
    const action = added ? 'added to' : 'updated in';
    if (VERBOSE) {
      console.log(`[${repoName}] ${type} #${number}: ${action} project${statusMsg}${sprintMsg}`);
    } else if (statusMsg.includes('Active') || statusMsg.includes('Done')) {
      console.log(`[${repoName}] ${type} #${number}: ${action} project${statusMsg}${sprintMsg}`);
    }
  } catch (err) {
    console.error(`${logPrefix}[${repoName}] Error adding/updating ${type} #${number} in project:`, err.message);
    diagnostics.errors.push(`Error adding/updating ${type} #${number} in project: ${err.message}`);
  }
}

// Helper to add assigned issues to project board in 'New' column if not already set
async function addAssignedIssuesToProject(sprintField, diagnostics, statusFieldOptions) {
  try {
    for (const repoEntry of reposConfig) {
      let repo = repoEntry.name;
      let autoAddMode = repoEntry.auto_add;
      let owner, name;
      let repoFull = repo.includes("/") ? repo : `bcgov/${repo}`;
      [owner, name] = repoFull.split("/");
      if (!owner || !name) {
        diagnostics.errors.push(`Invalid repo format in repos.yml: '${repo}'. Expected 'owner/repo' or repo name. Skipping.`);
        if (VERBOSE) {
          console.error(`Invalid repo format in repos.yml: '${repo}'. Skipping.`);
        }
        continue;
      }
      let page = 1;
      while (true) {
        // Use autoAddMode to determine which issues to fetch
        let issuesQuery = {
          owner,
          repo: name,
          state: "open",
          per_page: 50,
          page
        };
        if (autoAddMode === 'assigned') {
          issuesQuery.assignee = GITHUB_AUTHOR;
        }
        const { data: issues } = await octokit.issues.listForRepo(issuesQuery);
        if (issues.length === 0) break;
        for (const issue of issues) {
          // Skip PRs
          if (issue.pull_request) continue;
          try {
            const issueNodeId = issue.node_id;
            // Check if already in project and has a status set
            let projectItemId = null;
            let statusAlreadySet = false;
            let endCursor = null;
            do {
              const existingItemQuery = await octokit.graphql(`
                query($projectId:ID!, $after:String) {
                  node(id: $projectId) {
                    ... on ProjectV2 {
                      items(first: 100, after: $after) {
                        nodes {
                          id
                          content { ... on Issue { id } }
                          fieldValues(first: 10) {
                            nodes {
                              ... on ProjectV2ItemFieldSingleSelectValue {
                                field {
                                  ... on ProjectV2FieldCommon { id name }
                                }
                                optionId
                              }
                            }
                          }
                        }
                        pageInfo { hasNextPage endCursor }
                      }
                    }
                  }
                }
              `, {
                projectId: PROJECT_ID,
                after: endCursor
              });
              const items = existingItemQuery.node.items.nodes;
              const match = items.find(item => item.content && item.content.id === issueNodeId);
              if (match) {
                projectItemId = match.id;
                // Check if status field is set
                const statusField = match.fieldValues.nodes.find(fv => fv.field && fv.field.name && fv.field.name.toLowerCase() === 'status');
                if (statusField && statusField.optionId) {
                  statusAlreadySet = true;
                }
                break;
              }
              endCursor = existingItemQuery.node.items.pageInfo.endCursor;
            } while (endCursor);
            if (!projectItemId) {
              // Not in project, add it and set status to 'New'
              const addResult = await octokit.graphql(`
                mutation($projectId:ID!, $contentId:ID!) {
                  addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
                    item { id }
                  }
                }
              `, {
                projectId: PROJECT_ID,
                contentId: issueNodeId
              });
              projectItemId = addResult.addProjectV2ItemById.item.id;
              await octokit.graphql(`
                mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
                  updateProjectV2ItemFieldValue(input: {
                    projectId: $projectId,
                    itemId: $itemId,
                    fieldId: $fieldId,
                    value: { singleSelectOptionId: $optionId }
                  }) { projectV2Item { id } }
                }
              `, {
                projectId: PROJECT_ID,
                itemId: projectItemId,
                fieldId: statusFieldOptions.fieldId,
                optionId: statusFieldOptions.new
              });
              if (VERBOSE) {
                console.log(`[${owner}/${name}] Issue #${issue.number}: added to project, status=New`);
              }
            } else if (!statusAlreadySet) {
              // In project but no status set, set to 'New'
              await octokit.graphql(`
                mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
                  updateProjectV2ItemFieldValue(input: {
                    projectId: $projectId,
                    itemId: $itemId,
                    fieldId: $fieldId,
                    value: { singleSelectOptionId: $optionId }
                  }) { projectV2Item { id } }
                }
              `, {
                projectId: PROJECT_ID,
                itemId: projectItemId,
                fieldId: statusFieldOptions.fieldId,
                optionId: statusFieldOptions.new
              });
              if (VERBOSE) {
                console.log(`[${owner}/${name}] Issue #${issue.number}: status set to New`);
              }
            } else {
              if (VERBOSE) {
                console.log(`[${owner}/${name}] Issue #${issue.number}: already has status set, skipping`);
              }
            }
          } catch (err) {
            diagnostics.errors.push(`[${owner}/${name}] Error processing assigned issue #${issue.number}: ${err.message}`);
            if (VERBOSE) {
              console.error(`[${owner}/${name}] Error processing assigned issue #${issue.number}:`, err);
            }
          }
        }
        page++;
      }
    }
  } catch (e) {
    diagnostics.errors.push(`Error in addAssignedIssuesToProject: ${e.message}`);
    if (VERBOSE) {
      console.error('Error in addAssignedIssuesToProject:', e);
    }
  }
}

// Add all issues assigned to the authenticated user, from any repo, to the project board
async function addAllAssignedIssuesToProject(sprintField, diagnostics, statusFieldOptions) {
  let page = 1;
  while (true) {
    const { data: issues } = await octokit.issues.listForAuthenticatedUser({
      filter: 'assigned',
      state: 'open',
      per_page: 50,
      page
    });
    if (issues.length === 0) break;
    for (const issue of issues) {
      // Skip PRs
      if (issue.pull_request) continue;
      try {
        const owner = issue.repository.owner.login;
        const name = issue.repository.name;
        const issueNodeId = issue.node_id;
        // Check if already in project and has a status set
        let projectItemId = null;
        let statusAlreadySet = false;
        let endCursor = null;
        do {
          const existingItemQuery = await octokit.graphql(`
            query($projectId:ID!, $after:String) {
              node(id: $projectId) {
                ... on ProjectV2 {
                  items(first: 100, after: $after) {
                    nodes {
                      id
                      content { ... on Issue { id } }
                      fieldValues(first: 10) {
                        nodes {
                          ... on ProjectV2ItemFieldSingleSelectValue {
                            field {
                              ... on ProjectV2FieldCommon { id name }
                            }
                            optionId
                          }
                        }
                      }
                    }
                    pageInfo { hasNextPage endCursor }
                  }
                }
              }
            }
          `, {
            projectId: PROJECT_ID,
            after: endCursor
          });
          const items = existingItemQuery.node.items.nodes;
          const match = items.find(item => item.content && item.content.id === issueNodeId);
          if (match) {
            projectItemId = match.id;
            // Check if status field is set
            const statusField = match.fieldValues.nodes.find(fv => fv.field && fv.field.name && fv.field.name.toLowerCase() === 'status');
            if (statusField && statusField.optionId) {
              statusAlreadySet = true;
            }
            break;
          }
          endCursor = existingItemQuery.node.items.pageInfo.endCursor;
        } while (endCursor);
        if (!projectItemId) {
          // Not in project, add it and set status to 'New'
          const addResult = await octokit.graphql(`
            mutation($projectId:ID!, $contentId:ID!) {
              addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
                item { id }
              }
            }
          `, {
            projectId: PROJECT_ID,
            contentId: issueNodeId
          });
          projectItemId = addResult.addProjectV2ItemById.item.id;
          await octokit.graphql(`
            mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
              updateProjectV2ItemFieldValue(input: {
                projectId: $projectId,
                itemId: $itemId,
                fieldId: $fieldId,
                value: { singleSelectOptionId: $optionId }
              }) { projectV2Item { id } }
            }
          `, {
            projectId: PROJECT_ID,
            itemId: projectItemId,
            fieldId: statusFieldOptions.fieldId,
            optionId: statusFieldOptions.new
          });
          if (VERBOSE) {
            console.log(`[${owner}/${name}] Issue #${issue.number}: added to project, status=New (from global assigned)`);
          }
        } else if (!statusAlreadySet) {
          // In project but no status set, set to 'New'
          await octokit.graphql(`
            mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
              updateProjectV2ItemFieldValue(input: {
                projectId: $projectId,
                itemId: $itemId,
                fieldId: $fieldId,
                value: { singleSelectOptionId: $optionId }
              }) { projectV2Item { id } }
            }
          `, {
            projectId: PROJECT_ID,
            itemId: projectItemId,
            fieldId: statusFieldOptions.fieldId,
            optionId: statusFieldOptions.new
          });
          if (VERBOSE) {
            console.log(`[${owner}/${name}] Issue #${issue.number}: status set to New (from global assigned)`);
          }
        } else {
          if (VERBOSE) {
            console.log(`[${owner}/${name}] Issue #${issue.number}: already has status set, skipping (from global assigned)`);
          }
        }
      } catch (err) {
        diagnostics.errors.push(`[${issue.repository.full_name}] Error processing globally assigned issue #${issue.number}: ${err.message}`);
        if (VERBOSE) {
          console.error(`[${issue.repository.full_name}] Error processing globally assigned issue #${issue.number}:`, err);
        }
      }
    }
    page++;
  }
}

// Add all PRs created by the authenticated user, from any repo, to the project board
async function addAllAuthoredPRsToProject(sprintField, diagnostics, statusFieldOptions) {
  let page = 1;
  while (true) {
    const { data: prs } = await octokit.search.issuesAndPullRequests({
      q: `is:pr author:${GITHUB_AUTHOR} is:open`,
      per_page: 50,
      page
    });
    if (prs.items.length === 0) break;
    for (const pr of prs.items) {
      // Only process PRs
      if (!pr.pull_request) continue;
      try {
        const owner = pr.repository_url.split('/').slice(-2)[0];
        const name = pr.repository_url.split('/').slice(-1)[0];
        // Get PR details for node_id and merged/closed state
        const prDetails = await octokit.pulls.get({ owner, repo: name, pull_number: pr.number });
        const prNodeId = prDetails.data.node_id;
        const prState = prDetails.data.state;
        const prMerged = prDetails.data.merged_at !== null;
        await addItemToProjectAndSetStatus(prNodeId, 'PR', pr.number, sprintField, '  ', `${owner}/${name}`, prState, prMerged, diagnostics, false, statusFieldOptions);
      } catch (err) {
        diagnostics.errors.push(`[${pr.repository_url}] Error processing globally authored PR #${pr.number}: ${err.message}`);
        if (VERBOSE) {
          console.error(`[${pr.repository_url}] Error processing globally authored PR #${pr.number}:`, err);
        }
      }
    }
    page++;
  }
}

async function assignPRsInRepo(repo, sprintField, diagnostics, statusFieldOptions) {
  const [owner, name] = repo.split("/");
  let page = 1;
  let found = 0;
  let summary = { assigned: 0, project: 0, issues: 0 };
  const sinceDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
  while (true) {
    const { data: prs } = await octokit.pulls.list({
      owner,
      repo: name,
      state: "all",
      per_page: 50,
      page
    });
    if (prs.length === 0) break;
    for (const pr of prs) {
      if (
        pr.user && pr.user.login === GITHUB_AUTHOR &&
        (
          pr.state === "open" ||
          (pr.state === "closed" && pr.merged_at && new Date(pr.merged_at) >= sinceDate)
        )
      ) {
        // Always (re)assign to GITHUB_AUTHOR for consistency
        await octokit.issues.addAssignees({
          owner,
          repo: name,
          issue_number: pr.number,
          assignees: [GITHUB_AUTHOR]
        });
        summary.assigned++;
        // Add PR to GitHub Projects v2 and set Status to Active
        try {
          const prDetails = await octokit.pulls.get({ owner, repo: name, pull_number: pr.number });
          const prNodeId = prDetails.data.node_id;
          await addItemToProjectAndSetStatus(prNodeId, 'PR', pr.number, sprintField, '  ', `${owner}/${name}`, pr.state, pr.merged_at !== null, diagnostics, false, statusFieldOptions);
          summary.project++;
        } catch (err) {
          console.error(`  [${owner}/${name}] Error preparing PR #${pr.number} for project:`, err.message);
          diagnostics.errors.push(`Error preparing PR #${pr.number} for project: ${err.message}`);
        }
        // Fetch linked issues for this PR (only those in the same repository and in the development box)
        const { data: timeline } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/timeline', {
          owner,
          repo: name,
          issue_number: pr.number,
          mediaType: { previews: ['mockingbird'] }
        });
        // Only consider cross-referenced events where the linked issue is in the same repo, is not a PR, and is referenced from the PR body (not a comment)
        const linkedIssues = timeline.filter(event =>
          event.event === 'cross-referenced' &&
          event.source &&
          event.source.issue &&
          event.source.issue.pull_request === undefined &&
          !event.source.comment &&
          event.source.issue.repository &&
          event.source.issue.repository.full_name === `${owner}/${name}`
        );
        for (const event of linkedIssues) {
          const issueNum = event.source.issue.number;
          await octokit.issues.addAssignees({
            owner,
            repo: name,
            issue_number: issueNum,
            assignees: [GITHUB_AUTHOR]
          });
          summary.issues++;
          // Add linked issue to GitHub Projects v2 and set Status to Active or Done as appropriate
          try {
            const issueDetails = await octokit.issues.get({ owner, repo: name, issue_number: issueNum });
            const issueNodeId = issueDetails.data.node_id;
            // If PR is merged, move linked issue to Done and close if open
            if (pr.state === 'closed' && pr.merged_at) {
              // Move to Done in project
              await addItemToProjectAndSetStatus(issueNodeId, 'issue', issueNum, sprintField, '    ', `${owner}/${name}`, 'closed', false, diagnostics, true, statusFieldOptions);
              // Close the issue if open
              if (issueDetails.data.state === 'open') {
                try {
                  await octokit.issues.update({ owner, repo: name, issue_number: issueNum, state: 'closed' });
                  if (VERBOSE) {
                    console.log(`    [${owner}/${name}] Issue #${issueNum}: auto-closed (linked to merged PR)`);
                  }
                } catch (closeErr) {
                  diagnostics.errors.push(`Error auto-closing linked issue #${issueNum}: ${closeErr.message}`);
                  if (VERBOSE) {
                    console.error(`    [${owner}/${name}] Error auto-closing issue #${issueNum}:`, closeErr);
                  }
                }
              }
            } else {
              // Not a merged PR, set to Active as before
              await addItemToProjectAndSetStatus(issueNodeId, 'issue', issueNum, sprintField, '    ', `${owner}/${name}`, undefined, undefined, diagnostics, false, statusFieldOptions);
            }
          } catch (err) {
            console.error(`    [${owner}/${name}] Error preparing issue #${issueNum} for project:`, err.message);
            diagnostics.errors.push(`Error preparing issue #${issueNum} for project: ${err.message}`);
          }
        }
      }
    }
    page++;
  }
  if (summary.assigned === 0) {
    const msg = `[${owner}/${name}] No matching PRs by ${GITHUB_AUTHOR} found.`;
    console.log(msg);
    diagnostics.summary.push(msg);
  } else {
    const msg = `[${owner}/${name}] Summary: PRs assigned: ${summary.assigned}, PRs added/updated in project: ${summary.project}, linked issues assigned: ${summary.issues}`;
    console.log(msg);
    diagnostics.summary.push(msg);
  }
}

// Parse repos config to support per-repo auto_add mode
function getReposConfig(rawRepos) {
  return rawRepos.map(entry => {
    if (typeof entry === 'string') {
      return { name: entry, auto_add: 'all' };
    }
    // Only use object format for special cases (e.g., auto_add: assigned)
    return { name: entry.name, auto_add: entry.auto_add || 'all' };
  });
}
const reposConfig = getReposConfig(repos);

// Helper to fetch Status field and its option IDs
async function getStatusFieldOptions(projectId) {
  const result = await octokit.graphql(`
    query($projectId:ID!){
      node(id:$projectId){
        ... on ProjectV2 {
          fields(first:50){
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
            }
          }
        }
      }
    }
  `, { projectId });
  const fields = result.node.fields.nodes;
  const statusField = fields.find(f => f.name && f.name.toLowerCase() === 'status');
  if (!statusField) throw new Error('No Status field found in project');
  const options = {};
  for (const opt of statusField.options) {
    if (opt.name.toLowerCase() === 'active') options.active = opt.id;
    if (opt.name.toLowerCase() === 'done') options.done = opt.id;
    if (opt.name.toLowerCase() === 'new') options.new = opt.id;
  }
  if (!options.active || !options.done || !options.new) {
    throw new Error('Could not find all required Status options (Active, Done, New)');
  }
  return { fieldId: statusField.id, ...options };
}

/**
 * Logs diagnostic information about errors and summary details.
 *
 * @param {DiagnosticsContext} diagnostics - The diagnostics context containing errors and summary arrays.
 *
 * `diagnostics.errors` is an array of strings, where each string represents an error message.
 * Example: ["Error fetching PRs from repo1", "Failed to assign PR in repo2"]
 *
 * `diagnostics.summary` is an array of strings, where each string summarizes actions taken for a repository.
 * Example: ["[repo1] Summary: PRs assigned: 2, PRs added/updated in project: 1, linked issues assigned: 0"]
 *
 * @returns {void} This function does not return a value.
 */
function logDiagnostics(diagnostics) {
  if (diagnostics.errors.length > 0) {
    console.error("\n=== Errors ===");
    diagnostics.errors.forEach((error, index) => {
      console.error(`${index + 1}. ${error}`);
    });
  } else {
    console.log("\nNo errors encountered.");
  }
  if (diagnostics.summary.length > 0) {
    console.log("\n=== Summary ===");
    diagnostics.summary.forEach((summary, index) => {
      console.log(`${index + 1}. ${summary}`);
    });
  } else {
    console.log("\nNo summary information available.");
  }
}

// Utility to sanitize GraphQL error responses before logging
function sanitizeGraphQLResponse(response) {
  // Deep clone to avoid mutating the original
  const clone = JSON.parse(JSON.stringify(response));
  // Redact common sensitive fields
  const redactKeys = ['token', 'access_token', 'authorization', 'email', 'login', 'node_id'];
  function redact(obj) {
    if (Array.isArray(obj)) {
      obj.forEach(redact);
    } else if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        if (redactKeys.includes(key.toLowerCase())) {
          obj[key] = '[REDACTED]';
        } else {
          redact(obj[key]);
        }
      }
    }
  }
  redact(clone);
  return clone;
}

(async () => {
  // Fetch project fields to get sprintField and statusField
  let sprintField = null;
  let statusFieldOptions = null;
  const diagnostics = new DiagnosticsContext();
  try {
    if (VERBOSE) {
      console.log('Fetching project fields for sprintField and statusField...');
    }
    const projectFields = await octokit.graphql(`
      query($projectId:ID!){
        node(id:$projectId){
          ... on ProjectV2 {
            fields(first:20){
              nodes {
                ... on ProjectV2FieldCommon {
                  id
                  name
                  dataType
                }
                ... on ProjectV2IterationField {
                  configuration {
                    ... on ProjectV2IterationFieldConfiguration {
                      iterations { id title startDate duration }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `, { projectId: PROJECT_ID });
    // Clean output: only print summary of fields
    const fields = projectFields.node.fields.nodes;
    if (VERBOSE) {
      console.log('Project fields:', fields.map(f => ({ id: f.id, name: f.name, dataType: f.dataType })));
    }
    sprintField = fields.find(f => f.name && f.name.toLowerCase().includes('sprint') && f.dataType === 'ITERATION');
    if (!sprintField) {
      console.error('No sprint field found in project fields!');
    } else if (sprintField && typeof sprintField.configuration === 'string') {
      sprintField.configuration = JSON.parse(sprintField.configuration);
    }
    await ensureCurrentSprintExists(sprintField);
    // Fetch status field options
    statusFieldOptions = await getStatusFieldOptions(PROJECT_ID);
  } catch (e) {
    const errMsg = 'Error fetching/ensuring sprints or status field: ' + e.message;
    diagnostics.errors.push(errMsg);
    console.error(errMsg);
    if (e.errors) {
      for (const err of e.errors) {
        diagnostics.errors.push('GraphQL error: ' + JSON.stringify(err));
        console.error('GraphQL error:', err);
      }
    }
    if (e.response) {
      const sanitizedResponse = sanitizeGraphQLResponse(e.response);
      diagnostics.errors.push('GraphQL response: ' + JSON.stringify(sanitizedResponse, null, 2));
      console.error('GraphQL response:', JSON.stringify(sanitizedResponse, null, 2));
    }
  }
  // Add assigned issues to project board in 'New' column if not already set (per-repo config)
  await addAssignedIssuesToProject(sprintField, diagnostics, statusFieldOptions);
  // Add all globally assigned issues (from any repo) to the project board
  await addAllAssignedIssuesToProject(sprintField, diagnostics, statusFieldOptions);
  // Add all globally authored PRs (from any repo) to the project board
  await addAllAuthoredPRsToProject(sprintField, diagnostics, statusFieldOptions);
  // Handle linked issues for all PRs assigned to the user (not just authored), but skip PRs where user is only a reviewer
  await handleLinkedIssuesForAssignedPRs(sprintField, diagnostics, statusFieldOptions);
  // Only use repos.yml for auto-adding all open issues (not for PRs or assigned issues)
  // (assignPRsInRepo and per-repo logic is now only for explicit auto-add-all-issues behavior)
  for (const repo of repos) {
    const fullRepo = repo.includes("/") ? repo : `bcgov/${repo}`;
    try {
      await assignPRsInRepo(fullRepo, sprintField, diagnostics, statusFieldOptions);
    } catch (e) {
      const errMsg = `Error processing ${fullRepo}: ${e.message}`;
      diagnostics.errors.push(errMsg);
      console.error(errMsg);
    }
  }
  // Log diagnostics at the end
  logDiagnostics(diagnostics);
})();

/**
 * For all PRs assigned to the user, handle linked issues, but skip PRs where user is only a reviewer.
 */
async function handleLinkedIssuesForAssignedPRs(sprintField, diagnostics, statusFieldOptions) {
  let page = 1;
  while (true) {
    // Get PRs assigned to the user
    const { data: prs } = await octokit.search.issuesAndPullRequests({
      q: `is:pr assignee:${GITHUB_AUTHOR} is:open`,
      per_page: 50,
      page
    });
    if (prs.items.length === 0) break;
    for (const pr of prs.items) {
      if (!pr.pull_request) continue;
      // Get PR details for author and reviewers
      const owner = pr.repository_url.split('/').slice(-2)[0];
      const name = pr.repository_url.split('/').slice(-1)[0];
      let prDetails;
      try {
        prDetails = await octokit.pulls.get({ owner, repo: name, pull_number: pr.number });
      } catch (err) {
        diagnostics.errors.push(`[${owner}/${name}] Error fetching PR #${pr.number} details: ${err.message}`);
        continue;
      }
      // Skip if user is only a reviewer (not author or assignee)
      const isAuthor = prDetails.data.user && prDetails.data.user.login === GITHUB_AUTHOR;
      const isAssignee = (prDetails.data.assignees || []).some(a => a.login === GITHUB_AUTHOR);
      if (!isAuthor && !isAssignee) continue;
      // ---
      // Fetch timeline for linked issues
      let timeline;
      try {
        const resp = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/timeline', {
          owner,
          repo: name,
          issue_number: pr.number,
          mediaType: { previews: ['mockingbird'] }
        });
        timeline = resp.data;
      } catch (err) {
        diagnostics.errors.push(`[${owner}/${name}] Error fetching timeline for PR #${pr.number}: ${err.message}`);
        continue;
      }
      const linkedIssues = timeline.filter(event =>
        event.event === 'cross-referenced' &&
        event.source &&
        event.source.issue &&
        event.source.issue.pull_request === undefined &&
        !event.source.comment &&
        event.source.issue.repository &&
        event.source.issue.repository.full_name === `${owner}/${name}`
      );
      for (const event of linkedIssues) {
        const issueNum = event.source.issue.number;
        try {
          await octokit.issues.addAssignees({
            owner,
            repo: name,
            issue_number: issueNum,
            assignees: [GITHUB_AUTHOR]
          });
          // Add linked issue to project and set status
          const issueDetails = await octokit.issues.get({ owner, repo: name, issue_number: issueNum });
          const issueNodeId = issueDetails.data.node_id;
          await addItemToProjectAndSetStatus(issueNodeId, 'issue', issueNum, sprintField, '    ', `${owner}/${name}`, undefined, undefined, diagnostics, false, statusFieldOptions);
        } catch (err) {
          diagnostics.errors.push(`[${owner}/${name}] Error handling linked issue #${issueNum} for PR #${pr.number}: ${err.message}`);
        }
      }
    }
    page++;
  }
}
