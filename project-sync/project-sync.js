// SCOPE: This script manages issues and PRs across all bcgov repositories and a single GitHub Projects v2 board, strictly following the automation rules defined in requirements.md. All logic is requirements-driven; any changes to automation must be made in requirements.md and reflected here.
// Script to manage GitHub Projects v2: assign issues/PRs to project columns based on rules
const { Octokit } = require("@octokit/rest");
const fs = require("fs");

const GH_TOKEN = process.env.GH_TOKEN;
const GITHUB_AUTHOR = process.env.GITHUB_AUTHOR || "DerekRoberts";
const octokit = new Octokit({ auth: GH_TOKEN });

const PROJECT_ID = 'PVT_kwDOAA37OM4AFuzg';

// --- CONFIGURATION ---
const STATUS_OPTIONS = {
  parked: '5bc8cfd4',    // optionId for 'Parked' column
  new: 'f8e1e5a4',      // optionId for 'New' column
  backlog: 'd8686046',  // optionId for 'Backlog' column
  next: 'ab0fb504',     // optionId for 'Next' column
  active: 'c66ba2dd',   // optionId for 'Active' column
  waiting: 'cd3ebcfd',  // optionId for 'Waiting' column
  done: '46321e20'      // optionId for 'Done' column
};

// Sprint field configuration
const SPRINT_FIELD_ID = 'PVTIF_lADOAA37OM4AFuzgzgDTbhE'; // Correct Sprint (Iteration) fieldId

// Helper: Get current sprint optionId
async function getCurrentSprintOptionId() {
  // Fetch project fields and options
  const res = await octokit.graphql(`
    query($projectId:ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2IterationField {
                id
                name
                configuration {
                  iterations {
                    id
                    title
                    startDate
                    duration
                  }
                }
              }
            }
          }
        }
      }
    }
  `, { projectId: PROJECT_ID });
  const sprintField = res.node.fields.nodes.find(f => f.id === SPRINT_FIELD_ID);
  if (!sprintField) {
    throw new Error('Sprint field not found in project configuration.');
  }
  const today = new Date();
  // Find the iteration (sprint) whose startDate <= today < startDate+duration
  for (const iter of sprintField.configuration.iterations) {
    const start = new Date(iter.startDate);
    const end = new Date(start.getTime() + iter.duration * 24 * 60 * 60 * 1000);
    if (today >= start && today < end) {
      return iter.id;
    }
  }
  throw new Error(`No Sprint iteration with a date range including today (${today.toISOString().slice(0,10)}). Available iterations: [${sprintField.configuration.iterations.map(i => `'${i.title}' (${i.startDate}, ${i.duration}d)`).join(', ')}]`);
}

// --- Helper: Get issue-import repos from requirements.md ---
function getIssueImportRepos() {
  // Read requirements.md and extract the Monitored Repositories section
  const reqText = fs.readFileSync("project-sync/requirements.md", "utf8");
  const lines = reqText.split("\n");
  const startIdx = lines.findIndex(l => l.trim().startsWith('## Monitored Repositories'));
  if (startIdx === -1) return [];
  const repos = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('(') || line.startsWith('_')) continue;
    if (line.startsWith('- ')) {
      // Only add if the line is a valid repo name (letters, numbers, dashes, underscores, dots)
      const repo = line.replace('- ', '').trim();
      if (/^[a-zA-Z0-9._-]+$/.test(repo)) {
        repos.push('bcgov/' + repo);
      }
    } else {
      // Stop if we've left the list
      break;
    }
  }
  return repos;
}

// --- Helper: Parse repo full name from URL or object ---
function getRepoFullName(issueOrPr) {
  if (issueOrPr.repository && issueOrPr.repository.full_name) return issueOrPr.repository.full_name;
  if (issueOrPr.repository_url) return issueOrPr.repository_url.split('/').slice(-2).join('/');
  return '';
}

// --- Helper: Deduplicate items by nodeId ---
function dedupeItems(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.nodeId)) map.set(item.nodeId, item);
  }
  return Array.from(map.values());
}

// --- Add or update item in project ---
async function addOrUpdateProjectItem({ nodeId, type, number, repoName, statusOption, sprintField, diagnostics, reopenIfClosed, forceSprint }) {
  try {
    // If forceSprint is true, assign the item to the current sprint
    if (forceSprint) {
      const currentSprintOptionId = await getCurrentSprintOptionId();
      sprintField = currentSprintOptionId;
      diagnostics.infos.push(`Assigned item to the current sprint due to forceSprint flag.`);
    }
    // Optionally reopen closed issues if moving to Active
    if (type === 'issue' && statusOption === STATUS_OPTIONS.active && reopenIfClosed) {
      // Check if the issue is closed
      const issueRes = await octokit.graphql(`
        query($nodeId:ID!) {
          node(id: $nodeId) { ... on Issue { state } }
        }
      `, { nodeId });
      if (issueRes.node && issueRes.node.state === 'CLOSED') {
        // Reopen the issue
        const repoParts = repoName.split('/');
        await octokit.issues.update({
          owner: repoParts[0],
          repo: repoParts[1],
          issue_number: number,
          state: 'open'
        });
        diagnostics.infos.push(`Reopened issue #${number} in ${repoName} because it was moved to Active.`);
      }
    }
    // Find or add item to project
    let projectItemId = null;
    let endCursor = null;
    let found = false;
    do {
      const res = await octokit.graphql(`
        query($projectId:ID!, $after:String) {
          node(id: $projectId) {
            ... on ProjectV2 {
              items(first: 100, after: $after) {
                nodes { id content { ... on PullRequest { id } ... on Issue { id } } }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }`, { projectId: PROJECT_ID, after: endCursor });
      const items = res.node.items.nodes;
      const match = items.find(item => item.content && item.content.id === nodeId);
      if (match) {
        projectItemId = match.id;
        found = true;
        break;
      }
      endCursor = res.node.items.pageInfo.endCursor;
    } while (endCursor);
    if (!found) {
      const addResult = await octokit.graphql(`
        mutation($projectId:ID!, $contentId:ID!) {
          addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
            item { id }
          }
        }`, { projectId: PROJECT_ID, contentId: nodeId });
      projectItemId = addResult.addProjectV2ItemById.item.id;
    }
    // Set status
    await octokit.graphql(`
      mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { singleSelectOptionId: $optionId }
        }) { projectV2Item { id } }
      }`, {
      projectId: PROJECT_ID,
      itemId: projectItemId,
      fieldId: 'PVTSSF_lADOAA37OM4AFuzgzgDTYuA', // Status fieldId
      optionId: statusOption
    });
    // Assign Sprint for Next/Active regardless of previous value
    if (statusOption === STATUS_OPTIONS.next || statusOption === STATUS_OPTIONS.active) {
      let sprintOptionId = sprintField;
      if (!sprintOptionId) {
        try {
          sprintOptionId = await getCurrentSprintOptionId();
        } catch (err) {
          throw new Error(`Failed to assign Sprint for ${type} #${number} in ${repoName}: ${err.message}`);
        }
      }
      if (sprintOptionId) {
        try {
          await octokit.graphql(`
            mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
              updateProjectV2ItemFieldValue(input: {
                projectId: $projectId,
                itemId: $itemId,
                fieldId: $fieldId,
                value: { iterationId: $optionId }
              }) { projectV2Item { id } }
            }`, {
            projectId: PROJECT_ID,
            itemId: projectItemId,
            fieldId: SPRINT_FIELD_ID,
            optionId: sprintOptionId
          });
        } catch (err) {
          throw new Error(`Failed to assign Sprint for ${type} #${number} in ${repoName}: ${err.message}`);
        }
      } else {
        throw new Error(`No current Sprint option found for ${type} #${number} in ${repoName}`);
      }
    }
    // Only assign Sprint for Done if not already assigned
    if (statusOption === STATUS_OPTIONS.done) {
      const sprintFieldRes = await octokit.graphql(`
        query($projectId:ID!, $itemId:ID!) {
          node(id: $projectId) {
            ... on ProjectV2 {
              item(id: $itemId) {
                fieldValues(first: 50) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      field {
                        ... on ProjectV2SingleSelectField { id }
                      }
                      optionId
                    }
                  }
                }
              }
            }
          }`, { projectId: PROJECT_ID, itemId: projectItemId });
      // Find the Sprint field value
      let sprintFieldValue = null;
      if (sprintFieldRes.node && sprintFieldRes.node.item && sprintFieldRes.node.item.fieldValues) {
        sprintFieldValue = sprintFieldRes.node.item.fieldValues.nodes.find(fv => fv.field && fv.field.id === SPRINT_FIELD_ID) || null;
      }
      const alreadyHasSprint = sprintFieldValue && sprintFieldValue.optionId;
      if (!alreadyHasSprint) {
        let sprintOptionId = sprintField;
        if (!sprintOptionId) {
          try {
            sprintOptionId = await getCurrentSprintOptionId();
          } catch (err) {
            throw new Error(`Failed to assign Sprint for ${type} #${number} in ${repoName} (Done): ${err.message}`);
          }
        }
        if (sprintOptionId) {
          try {
            await octokit.graphql(`
              mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
                updateProjectV2ItemFieldValue(input: {
                  projectId: $projectId,
                  itemId: $itemId,
                  fieldId: $fieldId,
                  value: { iterationId: $optionId }
                }) { projectV2Item { id } }
              }`, {
              projectId: PROJECT_ID,
              itemId: projectItemId,
              fieldId: SPRINT_FIELD_ID,
              optionId: sprintOptionId
            });
          } catch (err) {
            throw new Error(`Failed to assign Sprint for ${type} #${number} in ${repoName} (Done): ${err.message}`);
          }
        } else {
          throw new Error(`No current Sprint option found for ${type} #${number} in ${repoName} (Done)`);
        }
      }
    }
  } catch (err) {
    diagnostics.errors.push(`Error adding/updating ${type} #${number} in project: ${err.message}`);
  }
}

// --- Wrapper: Add or update item and log to summary.changed if changed ---
async function addOrUpdateProjectItemWithSummary(item) {
  await addOrUpdateProjectItem(item);
  summary.changed.push({
    type: item.type,
    number: item.number,
    repoName: item.repoName,
    action: `moved to ${Object.keys(STATUS_OPTIONS).find(k => STATUS_OPTIONS[k] === item.statusOption) || 'updated'}`,
    url: `https://github.com/${item.repoName}/${item.type === 'pr' ? 'pull' : 'issues'}/${item.number}`
  });
}

// --- DiagnosticsContext helper ---
class DiagnosticsContext {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.infos = [];
  }
}

function logDiagnostics(diagnostics) {
  if (diagnostics.errors.length) {
    console.error('Errors:');
    diagnostics.errors.forEach(e => console.error(e));
  }
  if (diagnostics.warnings.length) {
    console.warn('Warnings:');
    diagnostics.warnings.forEach(w => console.warn(w));
  }
  if (diagnostics.infos.length) {
    console.info('Info:');
    diagnostics.infos.forEach(i => console.info(i));
  }
}

// --- Helper: Throttle async operations in batches ---
async function processInBatches(items, batchSize, delayMs, fn) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(fn));
    if (i + batchSize < items.length) {
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
}

// --- Helper: Fetch all open issues and PRs for a repo using GraphQL ---
async function fetchOpenIssuesAndPRsGraphQL(owner, repo) {
  let issues = [];
  let prs = [];
  let hasNextPage = true;
  let endCursor = null;
  // Fetch all open issues and PRs for a repo using GraphQL
  while (hasNextPage) {
    const res = await octokit.graphql(`
      query($owner: String!, $repo: String!, $after: String) {
        repository(owner: $owner, name: $repo) {
          issues(first: 50, states: OPEN, after: $after) {
            nodes {
              id
              number
              title
              assignees(first: 10) { nodes { login } }
              author { login }
            }
            pageInfo { hasNextPage endCursor }
          }
          pullRequests(first: 50, states: OPEN, after: $after) {
            nodes {
              id
              number
              title
              assignees(first: 10) { nodes { login } }
              author { login }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `, { owner, repo, after: endCursor });
    const repoData = res.repository;
    issues = issues.concat(repoData.issues.nodes);
    prs = prs.concat(repoData.pullRequests.nodes);
    hasNextPage = repoData.issues.pageInfo.hasNextPage || repoData.pullRequests.pageInfo.hasNextPage;
    endCursor = repoData.issues.pageInfo.endCursor || repoData.pullRequests.pageInfo.endCursor;
  }
  return { issues, prs };
}

// --- Helper: Fetch all issues and PRs (open and closed) for a repo using GraphQL ---
async function fetchRecentIssuesAndPRsGraphQL(owner, repo, sinceIso) {
  let issues = [];
  let prs = [];
  let hasNextPage = true;
  let endCursor = null;
  // Fetch all issues and PRs (open and closed) for a repo using GraphQL
  while (hasNextPage) {
    const res = await octokit.graphql(`
      query($owner: String!, $repo: String!, $after: String) {
        repository(owner: $owner, name: $repo) {
          issues(first: 50, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              id
              number
              title
              assignees(first: 10) { nodes { login } }
              author { login }
              state
              updatedAt
            }
            pageInfo { hasNextPage endCursor }
          }
          pullRequests(first: 50, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              id
              number
              title
              assignees(first: 10) { nodes { login } }
              author { login }
              state
              updatedAt
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `, { owner, repo, after: endCursor });
    const repoData = res.repository;
    // Only include issues/PRs updated in the last two days
    issues = issues.concat(repoData.issues.nodes.filter(i => i.updatedAt && i.updatedAt >= sinceIso));
    prs = prs.concat(repoData.pullRequests.nodes.filter(pr => pr.updatedAt && pr.updatedAt >= sinceIso));
    hasNextPage = repoData.issues.pageInfo.hasNextPage || repoData.pullRequests.pageInfo.hasNextPage;
    endCursor = repoData.issues.pageInfo.endCursor || repoData.pullRequests.pageInfo.endCursor;
  }
  return { issues, prs };
}

// --- Main logic ---
(async () => {
  const diagnostics = new DiagnosticsContext();
  // Use monitoredRepos for all logic
  const monitoredRepos = getIssueImportRepos();
  // Calculate date string for two days ago (YYYY-MM-DD)
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const itemsToProcess = [];
  const seenNodeIds = new Set();
  const summary = {
    processed: [],
    changed: []
  };

  // 1. Any PR authored by the user
  let endCursor = null;
  while (true) {
    const res = await octokit.graphql(`
      query($login: String!, $after: String) {
        search(query: $login, type: ISSUE, first: 50, after: $after) {
          nodes {
            ... on PullRequest {
              id
              number
              title
              repository { nameWithOwner }
              author { login }
              state
              closingIssuesReferences(first: 10) { nodes { id number repository { nameWithOwner } } }
              updatedAt
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { login: `author:${GITHUB_AUTHOR} user:bcgov is:pr updated:>=${twoDaysAgo}`, after: endCursor });
    const prs = res.search.nodes;
    for (const pr of prs) {
      if (!pr.repository.nameWithOwner.startsWith('bcgov/')) continue;
      if (seenNodeIds.has(pr.id)) continue;
      seenNodeIds.add(pr.id);
      if (pr.state === 'OPEN') {
        // New PR: Move to Active
        itemsToProcess.push({
          nodeId: pr.id,
          type: 'pr',
          number: pr.number,
          repoName: pr.repository.nameWithOwner,
          statusOption: STATUS_OPTIONS.active,
          sprintField: null,
          diagnostics
        });
      } else {
        // PR closed (merged or not): Move to Done
        itemsToProcess.push({
          nodeId: pr.id,
          type: 'pr',
          number: pr.number,
          repoName: pr.repository.nameWithOwner,
          statusOption: STATUS_OPTIONS.done,
          sprintField: null,
          diagnostics
        });
      }
      // Linked issues
      if (pr.closingIssuesReferences && pr.closingIssuesReferences.nodes) {
        for (const linkedIssue of pr.closingIssuesReferences.nodes) {
          if (!linkedIssue.repository.nameWithOwner.startsWith('bcgov/')) continue;
          if (seenNodeIds.has(linkedIssue.id)) continue;
          // Only update linked issues if PR is merged
          if (pr.state === 'MERGED') {
            seenNodeIds.add(linkedIssue.id);
            itemsToProcess.push({
              nodeId: linkedIssue.id,
              type: 'issue',
              number: linkedIssue.number,
              repoName: linkedIssue.repository.nameWithOwner,
              statusOption: STATUS_OPTIONS.done,
              sprintField: null,
              diagnostics
            });
          }
        }
      }
    }
    if (!res.search.pageInfo.hasNextPage) break;
    endCursor = res.search.pageInfo.endCursor;
  }

  // 2. Any open issues in the user's repos
  for (const repo of monitoredRepos) {
    const [owner, name] = repo.split('/');
    const { issues } = await fetchOpenIssuesAndPRsGraphQL(owner, name);
    for (const issue of issues) {
      if (seenNodeIds.has(issue.id)) continue;
      seenNodeIds.add(issue.id);
      itemsToProcess.push({
        nodeId: issue.id,
        type: 'issue',
        number: issue.number,
        repoName: repo,
        statusOption: STATUS_OPTIONS.active,
        sprintField: null,
        diagnostics
      });
    }
  }

  // 3. Any new issue in monitored repos
  const myRepos = monitoredRepos.filter(repo => repo.startsWith('bcgov/'));
  for (const repo of myRepos) {
    const [owner, name] = repo.split('/');
    const { issues } = await fetchOpenIssuesAndPRsGraphQL(owner, name);
    for (const issue of issues) {
      if (seenNodeIds.has(issue.id)) continue;
      seenNodeIds.add(issue.id);
      itemsToProcess.push({
        nodeId: issue.id,
        type: 'issue',
        number: issue.number,
        repoName: repo,
        statusOption: STATUS_OPTIONS.active,
        sprintField: null,
        diagnostics
      });
    }
  }

  // 4. Any closed issues/PRs in the last two days in the user's repos
  const sinceIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  for (const repo of monitoredRepos) {
    const [owner, name] = repo.split('/');
    const { issues, prs } = await fetchRecentIssuesAndPRsGraphQL(owner, name, sinceIso);
    for (const issue of issues) {
      if (seenNodeIds.has(issue.id)) continue;
      seenNodeIds.add(issue.id);
      itemsToProcess.push({
        nodeId: issue.id,
        type: 'issue',
        number: issue.number,
        repoName: repo,
        statusOption: STATUS_OPTIONS.done,
        sprintField: null,
        diagnostics
      });
    }
    for (const pr of prs) {
      if (seenNodeIds.has(pr.id)) continue;
      seenNodeIds.add(pr.id);
      if (pr.state === 'OPEN') {
        itemsToProcess.push({
          nodeId: pr.id,
          type: 'pr',
          number: pr.number,
          repoName: repo,
          statusOption: STATUS_OPTIONS.active,
          sprintField: null,
          diagnostics
        });
      } else {
        itemsToProcess.push({
          nodeId: pr.id,
          type: 'pr',
          number: pr.number,
          repoName: repo,
          statusOption: STATUS_OPTIONS.done,
          sprintField: null,
          diagnostics
        });
      }
    }
  }

  // 5. Any issues/PRs in the parked column for more than 2 days
  const parkedThresholdDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  for (const repo of monitoredRepos) {
    const [owner, name] = repo.split('/');
    const { issues, prs } = await fetchRecentIssuesAndPRsGraphQL(owner, name, parkedThresholdDate);
    for (const issue of issues) {
      if (seenNodeIds.has(issue.id)) continue;
      seenNodeIds.add(issue.id);
      itemsToProcess.push({
        nodeId: issue.id,
        type: 'issue',
        number: issue.number,
        repoName: repo,
        statusOption: STATUS_OPTIONS.backlog,
        sprintField: null,
        diagnostics
      });
    }
    for (const pr of prs) {
      if (seenNodeIds.has(pr.id)) continue;
      seenNodeIds.add(pr.id);
      itemsToProcess.push({
        nodeId: pr.id,
        type: 'pr',
        number: pr.number,
        repoName: repo,
        statusOption: STATUS_OPTIONS.backlog,
        sprintField: null,
        diagnostics
      });
    }
  }

  // 6. Any issues/PRs in the backlog column for more than 2 days
  const backlogThresholdDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  for (const repo of monitoredRepos) {
    const [owner, name] = repo.split('/');
    const { issues, prs } = await fetchRecentIssuesAndPRsGraphQL(owner, name, backlogThresholdDate);
    for (const issue of issues) {
      if (seenNodeIds.has(issue.id)) continue;
      seenNodeIds.add(issue.id);
      itemsToProcess.push({
        nodeId: issue.id,
        type: 'issue',
        number: issue.number,
        repoName: repo,
        statusOption: STATUS_OPTIONS.next,
        sprintField: null,
        diagnostics
      });
    }
    for (const pr of prs) {
      if (seenNodeIds.has(pr.id)) continue;
      seenNodeIds.add(pr.id);
      itemsToProcess.push({
        nodeId: pr.id,
        type: 'pr',
        number: pr.number,
        repoName: repo,
        statusOption: STATUS_OPTIONS.next,
        sprintField: null,
        diagnostics
      });
    }
  }

  // 7. Any issues/PRs in the active column for more than 2 days
  const activeThresholdDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  for (const repo of monitoredRepos) {
    const [owner, name] = repo.split('/');
    const { issues, prs } = await fetchRecentIssuesAndPRsGraphQL(owner, name, activeThresholdDate);
    for (const issue of issues) {
      if (seenNodeIds.has(issue.id)) continue;
      seenNodeIds.add(issue.id);
      itemsToProcess.push({
        nodeId: issue.id,
        type: 'issue',
        number: issue.number,
        repoName: repo,
        statusOption: STATUS_OPTIONS.waiting,
        sprintField: null,
        diagnostics
      });
    }
    for (const pr of prs) {
      if (seenNodeIds.has(pr.id)) continue;
      seenNodeIds.add(pr.id);
      itemsToProcess.push({
        nodeId: pr.id,
        type: 'pr',
        number: pr.number,
        repoName: repo,
        statusOption: STATUS_OPTIONS.waiting,
        sprintField: null,
        diagnostics
      });
    }
  }

  // 8. Any issues/PRs in the waiting column for more than 2 days
  const waitingThresholdDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  for (const repo of monitoredRepos) {
    const [owner, name] = repo.split('/');
    const { issues, prs } = await fetchRecentIssuesAndPRsGraphQL(owner, name, waitingThresholdDate);
    for (const issue of issues) {
      if (seenNodeIds.has(issue.id)) continue;
      seenNodeIds.add(issue.id);
      itemsToProcess.push({
        nodeId: issue.id,
        type: 'issue',
        number: issue.number,
        repoName: repo,
        statusOption: STATUS_OPTIONS.parked,
        sprintField: null,
        diagnostics
      });
    }
    for (const pr of prs) {
      if (seenNodeIds.has(pr.id)) continue;
      seenNodeIds.add(pr.id);
      itemsToProcess.push({
        nodeId: pr.id,
        type: 'pr',
        number: pr.number,
        repoName: repo,
        statusOption: STATUS_OPTIONS.parked,
        sprintField: null,
        diagnostics
      });
    }
  }

  // 9. Any issues/PRs in the done column for more than 2 days
  const doneThresholdDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  for (const repo of monitoredRepos) {
    const [owner, name] = repo.split('/');
    const { issues, prs } = await fetchRecentIssuesAndPRsGraphQL(owner, name, doneThresholdDate);
    for (const issue of issues) {
      if (seenNodeIds.has(issue.id)) continue;
      seenNodeIds.add(issue.id);
      itemsToProcess.push({
        nodeId: issue.id,
        type: 'issue',
        number: issue.number,
        repoName: repo,
        statusOption: STATUS_OPTIONS.parked,
        sprintField: null,
        diagnostics
      });
    }
    for (const pr of prs) {
      if (seenNodeIds.has(pr.id)) continue;
      seenNodeIds.add(pr.id);
      itemsToProcess.push({
        nodeId: pr.id,
        type: 'pr',
        number: pr.number,
        repoName: repo,
        statusOption: STATUS_OPTIONS.parked,
        sprintField: null,
        diagnostics
      });
    }
  }

  // 10. Any issues/PRs not in any project
  for (const repo of monitoredRepos) {
    const [owner, name] = repo.split('/');
    const { issues, prs } = await fetchOpenIssuesAndPRsGraphQL(owner, name);
    for (const issue of issues) {
      if (seenNodeIds.has(issue.id)) continue;
      seenNodeIds.add(issue.id);
      itemsToProcess.push({
        nodeId: issue.id,
        type: 'issue',
        number: issue.number,
        repoName: repo,
        statusOption: STATUS_OPTIONS.parked,
        sprintField: null,
        diagnostics
      });
    }
    for (const pr of prs) {
      if (seenNodeIds.has(pr.id)) continue;
      seenNodeIds.add(pr.id);
      itemsToProcess.push({
        nodeId: pr.id,
        type: 'pr',
        number: pr.number,
        repoName: repo,
        statusOption: STATUS_OPTIONS.parked,
        sprintField: null,
        diagnostics
      });
    }
  }

  // Process all items in parallel
  await processInBatches(itemsToProcess, 10, 1000, async (item) => {
    if (item.type === 'issue') {
      await addOrUpdateProjectItemWithSummary(item);
    } else if (item.type === 'pr') {
      await addOrUpdateProjectItemWithSummary(item);
    }
  });

  // Log diagnostics
  logDiagnostics(diagnostics);

  // Output summary
  console.log(`Processed ${summary.processed.length} items, changed ${summary.changed.length} items.`);
  if (summary.changed.length) {
    console.log('Changed items:');
    summary.changed.forEach(c => console.log(`- ${c.type} #${c.number} in ${c.repoName}: ${c.action} (${c.url})`));
  }
})();
