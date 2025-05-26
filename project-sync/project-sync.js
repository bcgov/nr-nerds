// Script to manage GitHub Projects v2: assign issues/PRs to project columns based on rules
const { Octokit } = require("@octokit/rest");
const fs = require("fs");

const GH_TOKEN = process.env.GH_TOKEN;
const GITHUB_AUTHOR = process.env.GITHUB_AUTHOR || "DerekRoberts";
const octokit = new Octokit({ auth: GH_TOKEN });

const PROJECT_ID = 'PVT_kwDOAA37OM4AFuzg';

// --- CONFIGURATION ---
const STATUS_OPTIONS = {
  new: 'f8e1e5a4',      // optionId for 'New' column
  active: 'c66ba2dd',   // optionId for 'Active' column
  done: '46321e20'      // optionId for 'Done' column
};

// Sprint field configuration
const SPRINT_FIELD_ID = 'PVTSSF_lADOAA37OM4AFuzgzgDTYuB'; // Replace with your actual Sprint fieldId

// Helper: Get current sprint optionId
async function getCurrentSprintOptionId() {
  // Fetch project fields and options
  const res = await octokit.graphql(`
    query($projectId:ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 20) {
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
  `, { projectId: PROJECT_ID });
  const sprintField = res.node.fields.nodes.find(f => f.id === SPRINT_FIELD_ID);
  if (!sprintField) return null;
  // Find the option with 'current' or similar in the name (customize as needed)
  const current = sprintField.options.find(opt => /current/i.test(opt.name));
  return current ? current.id : null;
}

// --- Helper: Get managed repos from requirements.md ---
function getManagedRepos() {
  // Read requirements.md and extract the Managed Repositories section
  const reqText = fs.readFileSync("project-sync/requirements.md", "utf8");
  const match = reqText.match(/## 3. Managed Repositories[\s\S]*?- ([^\n]+)/g);
  if (!match) return [];
  // Find all lines that start with '  - '
  const lines = reqText.split("\n");
  const startIdx = lines.findIndex(l => l.trim() === '## 3. Managed Repositories');
  if (startIdx === -1) return [];
  const repos = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('- ')) {
      let repo = line.replace('- ', '').trim();
      if (repo && !repo.startsWith('(')) repos.push(`bcgov/${repo}`);
    } else if (line === '' || line.startsWith('(')) {
      continue;
    } else if (line.startsWith('## ')) {
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
async function addOrUpdateProjectItem({ nodeId, type, number, repoName, statusOption, sprintField, diagnostics }) {
  try {
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
        }
      `, { projectId: PROJECT_ID, after: endCursor });
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
        }
      `, { projectId: PROJECT_ID, contentId: nodeId });
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
      }
    `, {
      projectId: PROJECT_ID,
      itemId: projectItemId,
      fieldId: 'PVTSSF_lADOAA37OM4AFuzgzgDTYuA', // Status fieldId
      optionId: statusOption
    });
    // If moving to Active, always assign to current Sprint
    if (statusOption === STATUS_OPTIONS.active) {
      let sprintOptionId = sprintField;
      if (!sprintOptionId) {
        sprintOptionId = await getCurrentSprintOptionId();
      }
      if (sprintOptionId) {
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
          fieldId: SPRINT_FIELD_ID,
          optionId: sprintOptionId
        });
      }
    }
    // If moving to Done, only assign to current Sprint if not already set
    if (statusOption === STATUS_OPTIONS.done) {
      // Fetch current Sprint field value for this item
      const sprintFieldRes = await octokit.graphql(`
        query($projectId:ID!, $itemId:ID!) {
          node(id: $projectId) {
            ... on ProjectV2 {
              item(id: $itemId) {
                fieldValues(first: 20) {
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
          }
        }
      `, { projectId: PROJECT_ID, itemId: projectItemId });
      const sprintFieldValue = sprintFieldRes.node.items ? null : (sprintFieldRes.node.item.fieldValues.nodes.find(fv => fv.field && fv.field.id === SPRINT_FIELD_ID) || null);
      const alreadyHasSprint = sprintFieldValue && sprintFieldValue.optionId;
      if (!alreadyHasSprint) {
        let sprintOptionId = sprintField;
        if (!sprintOptionId) {
          sprintOptionId = await getCurrentSprintOptionId();
        }
        if (sprintOptionId) {
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
            fieldId: SPRINT_FIELD_ID,
            optionId: sprintOptionId
          });
        }
      }
    }
  } catch (err) {
    diagnostics.errors.push(`Error adding/updating ${type} #${number} in project: ${err.message}`);
  }
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

// --- Main logic ---
(async () => {
  const diagnostics = new DiagnosticsContext();
  const managedRepos = getManagedRepos();
  const itemsToProcess = [];
  const seenNodeIds = new Set();

  // Calculate date string for two days ago (YYYY-MM-DD)
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // 1. Any issue assigned to me in any bcgov repo goes to "New" (updated in last 2 days)
  let page = 1;
  while (true) {
    const res = await octokit.graphql(`
      query($login: String!, $after: String) {
        search(query: $login, type: ISSUE, first: 50, after: $after) {
          nodes {
            ... on Issue {
              id
              number
              repository { nameWithOwner }
              assignees(first: 10) { nodes { login } }
              updatedAt
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { login: `assignee:${GITHUB_AUTHOR} user:bcgov is:issue is:open updated:>=${twoDaysAgo}`, after: page > 1 ? endCursor : null });
    const issues = res.search.nodes;
    for (const issue of issues) {
      if (!issue.repository.nameWithOwner.startsWith('bcgov/')) continue;
      if (seenNodeIds.has(issue.id)) continue;
      seenNodeIds.add(issue.id);
      itemsToProcess.push({
        nodeId: issue.id,
        type: 'issue',
        number: issue.number,
        repoName: issue.repository.nameWithOwner,
        statusOption: STATUS_OPTIONS.new,
        sprintField: null,
        diagnostics
      });
    }
    if (!res.search.pageInfo.hasNextPage) break;
    page++;
  }

  // 2. Any PR authored by me in any bcgov repo goes to "Active" (and linked issues, updated in last 2 days)
  page = 1;
  while (true) {
    const res = await octokit.graphql(`
      query($login: String!, $after: String) {
        search(query: $login, type: ISSUE, first: 50, after: $after) {
          nodes {
            ... on PullRequest {
              id
              number
              repository { nameWithOwner }
              author { login }
              closingIssuesReferences(first: 10) { nodes { id number repository { nameWithOwner updatedAt } } }
              updatedAt
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { login: `author:${GITHUB_AUTHOR} user:bcgov is:pr is:open updated:>=${twoDaysAgo}`, after: page > 1 ? endCursor : null });
    const prs = res.search.nodes;
    for (const pr of prs) {
      if (!pr.repository.nameWithOwner.startsWith('bcgov/')) continue;
      if (seenNodeIds.has(pr.id)) continue;
      seenNodeIds.add(pr.id);
      itemsToProcess.push({
        nodeId: pr.id,
        type: 'pr',
        number: pr.number,
        repoName: pr.repository.nameWithOwner,
        statusOption: STATUS_OPTIONS.active,
        sprintField: null,
        diagnostics
      });
      // Linked issues (only if updated in last 2 days)
      for (const linked of pr.closingIssuesReferences.nodes) {
        if (seenNodeIds.has(linked.id)) continue;
        if (linked.updatedAt && linked.updatedAt < twoDaysAgo) continue;
        seenNodeIds.add(linked.id);
        itemsToProcess.push({
          nodeId: linked.id,
          type: 'issue',
          number: linked.number,
          repoName: linked.repository.nameWithOwner,
          statusOption: STATUS_OPTIONS.active,
          sprintField: null,
          diagnostics
        });
      }
    }
    if (!res.search.pageInfo.hasNextPage) break;
    page++;
  }

  // 3. For managed repos, any new issue is added to "New" (updated in last 2 days)
  for (const repoFullName of managedRepos) {
    const [owner, repo] = repoFullName.split('/');
    let hasNextPage = true;
    let endCursor = null;
    while (hasNextPage) {
      const res = await octokit.graphql(`
        query($owner: String!, $repo: String!, $after: String) {
          repository(owner: $owner, name: $repo) {
            issues(first: 50, states: OPEN, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
              nodes { id number updatedAt }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      `, { owner, repo, after: endCursor });
      const issues = res.repository.issues.nodes;
      for (const issue of issues) {
        if (seenNodeIds.has(issue.id)) continue;
        if (issue.updatedAt < twoDaysAgo) continue;
        seenNodeIds.add(issue.id);
        itemsToProcess.push({
          nodeId: issue.id,
          type: 'issue',
          number: issue.number,
          repoName: repoFullName,
          statusOption: STATUS_OPTIONS.new,
          sprintField: null,
          diagnostics
        });
      }
      hasNextPage = res.repository.issues.pageInfo.hasNextPage;
      endCursor = res.repository.issues.pageInfo.endCursor;
    }
  }

  // Deduplicate and process all items in batches to avoid rate limits
  await processInBatches(itemsToProcess, 5, 2000, item => addOrUpdateProjectItem(item));
  logDiagnostics(diagnostics);
})();
