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
  if (!sprintField) {
    throw new Error('Sprint field not found in project configuration.');
  }
  const today = new Date();
  for (const opt of sprintField.options) {
    const match = opt.name.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|–|—|-)\s*(\d{4}-\d{2}-\d{2})/);
    if (match) {
      const start = new Date(match[1]);
      const end = new Date(match[2]);
      if (today >= start && today <= end) {
        return opt.id;
      }
    }
  }
  throw new Error(`No Sprint option with a date range including today (${today.toISOString().slice(0,10)}). Available options: [${sprintField.options.map(o => `'${o.name}'`).join(', ')}]`);
}

// --- Helper: Get managed repos from requirements.md ---}' for today (${today.toISOString().slice(0,10)}).\nAll available options:\n${debugLog.join('\n')}`);
function getManagedRepos() {
  // Read requirements.md and extract the Managed Repositories sectionrent.id;
  const reqText = fs.readFileSync("project-sync/requirements.md", "utf8");
  const lines = reqText.split("\n");
  const startIdx = lines.findIndex(l => l.trim().startsWith('## 3. Managed Repositories'));Get managed repos from requirements.md ---
  if (startIdx === -1) return [];unction getManagedRepos() {
  const repos = [];  // Read requirements.md and extract the Managed Repositories section
  let inList = false;ts.md", "utf8");
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('(')) continue;
    if (line.startsWith('- ')) {s = [];
      // Only add if the line is a valid repo name (letters, numbers, dashes, underscores) let inList = false;
      const repo = line.replace('- ', '').trim();  for (let i = startIdx + 1; i < lines.length; i++) {
      if (/^[a-zA-Z0-9._-]+$/.test(repo)) {
        repos.push(repo);tartsWith('(')) continue;
      }'- ')) {
      inList = true; is a valid repo name (letters, numbers, dashes, underscores)
    } else if (inList && !line.startsWith('- ')) {
      // Stop if we've left the list   if (/^[a-zA-Z0-9._-]+$/.test(repo)) {
      break;
    }     }
  }      inList = true;
  return repos;h('- ')) {
}
reak;
// --- Helper: Parse repo full name from URL or object ---
function getRepoFullName(issueOrPr) {
  if (issueOrPr.repository && issueOrPr.repository.full_name) return issueOrPr.repository.full_name;
  if (issueOrPr.repository_url) return issueOrPr.repository_url.split('/').slice(-2).join('/');
  return '';
} ---
getRepoFullName(issueOrPr) {
// --- Helper: Deduplicate items by nodeId ---itory && issueOrPr.repository.full_name) return issueOrPr.repository.full_name;
function dedupeItems(items) {l.split('/').slice(-2).join('/');
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.nodeId)) map.set(item.nodeId, item);
  }ms by nodeId ---
  return Array.from(map.values());
}
ems) {
// --- Add or update item in project ---p.has(item.nodeId)) map.set(item.nodeId, item);
async function addOrUpdateProjectItem({ nodeId, type, number, repoName, statusOption, sprintField, diagnostics, reopenIfClosed }) {
  try {n Array.from(map.values());
    // Optionally reopen closed issues if moving to Active
    if (type === 'issue' && statusOption === STATUS_OPTIONS.active && reopenIfClosed) {
      // Check if the issue is closedproject ---
      const issueRes = await octokit.graphql(`eProjectItem({ nodeId, type, number, repoName, statusOption, sprintField, diagnostics, reopenIfClosed }) {
        query($nodeId:ID!) {
          node(id: $nodeId) { ... on Issue { state } }ptionally reopen closed issues if moving to Active
        }=== STATUS_OPTIONS.active && reopenIfClosed) {
      `, { nodeId });
      if (issueRes.node && issueRes.node.state === 'CLOSED') {okit.graphql(`
        // Reopen the issue
        const repoParts = repoName.split('/');te } }
        await octokit.issues.update({
          owner: repoParts[0],
          repo: repoParts[1],Res.node && issueRes.node.state === 'CLOSED') {
          issue_number: number,open the issue
          state: 'open'st repoParts = repoName.split('/');
        });wait octokit.issues.update({
        diagnostics.infos.push(`Reopened issue #${number} in ${repoName} because it was moved to Active.`);
      }
    }
    // Find or add item to projectopen'
    let projectItemId = null;
    let endCursor = null;nfos.push(`Reopened issue #${number} in ${repoName} because it was moved to Active.`);
    let found = false;
    do {
      const res = await octokit.graphql(`
        query($projectId:ID!, $after:String) {null;
          node(id: $projectId) { = null;
            ... on ProjectV2 {
              items(first: 100, after: $after) {
                nodes { id content { ... on PullRequest { id } ... on Issue { id } } }
                pageInfo { hasNextPage endCursor }d:ID!, $after:String) {
              }ode(id: $projectId) {
            }   ... on ProjectV2 {
          }
        }} ... on Issue { id } } }
      `, { projectId: PROJECT_ID, after: endCursor });           pageInfo { hasNextPage endCursor }
      const items = res.node.items.nodes;
      const match = items.find(item => item.content && item.content.id === nodeId);
      if (match) {
        projectItemId = match.id;
        found = true;, after: endCursor });
        break;de.items.nodes;
      }nd(item => item.content && item.content.id === nodeId);
      endCursor = res.node.items.pageInfo.endCursor;
    } while (endCursor);
    if (!found) { found = true;
      const addResult = await octokit.graphql(`break;
        mutation($projectId:ID!, $contentId:ID!) {
          addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {tems.pageInfo.endCursor;
            item { id }
          }
        }onst addResult = await octokit.graphql(`
      `, { projectId: PROJECT_ID, contentId: nodeId });
      projectItemId = addResult.addProjectV2ItemById.item.id; $projectId, contentId: $contentId}) {
    }
    // Set status
    await octokit.graphql(`
      mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {, { projectId: PROJECT_ID, contentId: nodeId });
        updateProjectV2ItemFieldValue(input: {sult.addProjectV2ItemById.item.id;
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { singleSelectOptionId: $optionId }:ID!, $optionId:String!) {
        }) { projectV2Item { id } }input: {
      }
    `, {
      projectId: PROJECT_ID,
      itemId: projectItemId,$optionId }
      fieldId: 'PVTSSF_lADOAA37OM4AFuzgzgDTYuA', // Status fieldIdprojectV2Item { id } }
      optionId: statusOption
    });
    // Only assign to Sprint if moving to Active or Done
    if (statusOption === STATUS_OPTIONS.active) {
      let sprintOptionId = sprintField;uzgzgDTYuA', // Status fieldId
      if (!sprintOptionId) {d: statusOption
        sprintOptionId = await getCurrentSprintOptionId();
      }
      if (sprintOptionId) {tatusOption === STATUS_OPTIONS.active) {
        try {ntOptionId = sprintField;
          await octokit.graphql(`
            mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) { sprintOptionId = await getCurrentSprintOptionId();
              updateProjectV2ItemFieldValue(input: { }
                projectId: $projectId,
                itemId: $itemId,
                fieldId: $fieldId,
                value: { singleSelectOptionId: $optionId }ieldId:ID!, $optionId:String!) {
              }) { projectV2Item { id } }input: {
            }ectId,
          `, {d,
            projectId: PROJECT_ID,,
            itemId: projectItemId,ionId: $optionId }
            fieldId: SPRINT_FIELD_ID,tV2Item { id } }
            optionId: sprintOptionId
          });
        } catch (err) {
          diagnostics.warnings.push(`Warning: Failed to assign Sprint for ${type} #${number} in ${repoName}: ${err.message}`);jectItemId,
        }ELD_ID,
      } else { sprintOptionId
        diagnostics.warnings.push(`Warning: No current Sprint option found for ${type} #${number} in ${repoName}`);
      }err) {
    }ostics.warnings.push(`Warning: Failed to assign Sprint for ${type} #${number} in ${repoName}: ${err.message}`);
    // Always check for Sprint assignment if item is in Done
    if (statusOption === STATUS_OPTIONS.done) {e {
      // Always check for Sprint field value for this item (issue or PR)iagnostics.warnings.push(`Warning: No current Sprint option found for ${type} #${number} in ${repoName}`);
      const sprintFieldRes = await octokit.graphql(`
        query($projectId:ID!, $itemId:ID!) {
          node(id: $projectId) {ignment if item is in Done
            ... on ProjectV2 {
              item(id: $itemId) {
                fieldValues(first: 50) {onst sprintFieldRes = await octokit.graphql(`
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue { {
                      field {
                        ... on ProjectV2SingleSelectField { id }) {
                      }
                      optionId         nodes {
                    }ojectV2ItemFieldSingleSelectValue {
                  }       field {
                }ectV2SingleSelectField { id }
              }
            }
          }
        }
      `, { projectId: PROJECT_ID, itemId: projectItemId });
      // Find the Sprint field value
      let sprintFieldValue = null;
      if (sprintFieldRes.node && sprintFieldRes.node.item && sprintFieldRes.node.item.fieldValues) {
        sprintFieldValue = sprintFieldRes.node.item.fieldValues.nodes.find(fv => fv.field && fv.field.id === SPRINT_FIELD_ID) || null;
      }emId: projectItemId });
      const alreadyHasSprint = sprintFieldValue && sprintFieldValue.optionId;
      if (!alreadyHasSprint) {
        let sprintOptionId = sprintField;tFieldRes.node.item && sprintFieldRes.node.item.fieldValues) {
        if (!sprintOptionId) {ieldValue = sprintFieldRes.node.item.fieldValues.nodes.find(fv => fv.field && fv.field.id === SPRINT_FIELD_ID) || null;
          sprintOptionId = await getCurrentSprintOptionId();
        }
        if (sprintOptionId) {alreadyHasSprint) {
          try {ntOptionId = sprintField;
            await octokit.graphql(`
              mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) { sprintOptionId = await getCurrentSprintOptionId();
                updateProjectV2ItemFieldValue(input: { }
                  projectId: $projectId,   if (sprintOptionId) {
                  itemId: $itemId,
                  fieldId: $fieldId,
                  value: { singleSelectOptionId: $optionId }           mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
                }) { projectV2Item { id } }               updateProjectV2ItemFieldValue(input: {
              }                  projectId: $projectId,
            `, {
              projectId: PROJECT_ID,
              itemId: projectItemId,ctOptionId: $optionId }
              fieldId: SPRINT_FIELD_ID,jectV2Item { id } }
              optionId: sprintOptionId
            });
          } catch (err) {JECT_ID,
            diagnostics.warnings.push(`Warning: Failed to assign Sprint for ${type} #${number} in ${repoName} (Done): ${err.message}`);
          }         fieldId: SPRINT_FIELD_ID,
            diagnostics.warnings.push(`Warning: Failed to assign Sprint for ${type} #${number} in ${repoName} (Done): ${err.message}`);
          }         fieldId: SPRINT_FIELD_ID,
        } else {             optionId: sprintOptionId
          diagnostics.warnings.push(`Warning: No current Sprint option found for ${type} #${number} in ${repoName} (Done)`);            });
        }
      }rnings.push(`Warning: Failed to assign Sprint for ${type} #${number} in ${repoName} (Done): ${err.message}`);
    }
  } catch (err) {
    diagnostics.errors.push(`Error adding/updating ${type} #${number} in project: ${err.message}`);arnings.push(`Warning: No current Sprint option found for ${type} #${number} in ${repoName} (Done)`);
  }
}   }
   }
// --- Wrapper: Add or update item and log to summary.changed if changed ---  } catch (err) {
async function addOrUpdateProjectItemWithSummary(item) {ing/updating ${type} #${number} in project: ${err.message}`);
  await addOrUpdateProjectItem(item);
  summary.changed.push({
    type: item.type,
    number: item.number,--- Wrapper: Add or update item and log to summary.changed if changed ---
    repoName: item.repoName,mWithSummary(item) {
    action: `moved to ${Object.keys(STATUS_OPTIONS).find(k => STATUS_OPTIONS[k] === item.statusOption) || 'updated'}`(item);
  });
} type: item.type,

// --- DiagnosticsContext helper ---e,
class DiagnosticsContext {find(k => STATUS_OPTIONS[k] === item.statusOption) || 'updated'}`
  constructor() {);
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
  if (diagnostics.warnings.length) {unction logDiagnostics(diagnostics) {
    console.warn('Warnings:');  if (diagnostics.errors.length) {
    diagnostics.warnings.forEach(w => console.warn(w));
  }
  if (diagnostics.infos.length) {
    console.info('Info:');cs.warnings.length) {
    diagnostics.infos.forEach(i => console.info(i));s:');
  }s.forEach(w => console.warn(w));
}

// --- Helper: Throttle async operations in batches ---
async function processInBatches(items, batchSize, delayMs, fn) {i));
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(fn));
    if (i + batchSize < items.length) {tle async operations in batches ---
      await new Promise(res => setTimeout(res, delayMs));essInBatches(items, batchSize, delayMs, fn) {
    }
  }i, i + batchSize);
}mise.allSettled(batch.map(fn));

// --- Helper: Fetch all open issues and PRs for a repo using GraphQL --- new Promise(res => setTimeout(res, delayMs));
async function fetchOpenIssuesAndPRsGraphQL(owner, repo) {
  let issues = [];
  let prs = [];
  let hasNextPage = true;
  let endCursor = null;h all open issues and PRs for a repo using GraphQL ---
  while (hasNextPage) {o) {
    const res = await octokit.graphql(`
      query($owner: String!, $repo: String!, $after: String) {];
        repository(owner: $owner, name: $repo) {
          issues(first: 50, states: OPEN, after: $after) {rsor = null;
            nodes {hasNextPage) {
              idst res = await octokit.graphql(`
              number!, $after: String) {
              titleme: $repo) {
              assignees(first: 10) { nodes { login } }after) {
              author { login }
            }
            pageInfo { hasNextPage endCursor }
          }           title
          pullRequests(first: 50, states: OPEN, after: $after) {irst: 10) { nodes { login } }
            nodes {             author { login }
              id            }
              number
              title
              assignees(first: 10) { nodes { login } }ests(first: 50, states: OPEN, after: $after) {
              author { login }es {
            }
            pageInfo { hasNextPage endCursor }
          }
        }des { login } }
      }
    `, { owner, repo, after: endCursor });
    const repoData = res.repository;
    issues = issues.concat(repoData.issues.nodes);
    prs = prs.concat(repoData.pullRequests.nodes);
    hasNextPage = repoData.issues.pageInfo.hasNextPage || repoData.pullRequests.pageInfo.hasNextPage;
    endCursor = repoData.issues.pageInfo.endCursor || repoData.pullRequests.pageInfo.endCursor;o, after: endCursor });
  }
  return { issues, prs };oData.issues.nodes);
}t(repoData.pullRequests.nodes);
ata.issues.pageInfo.hasNextPage || repoData.pullRequests.pageInfo.hasNextPage;
// --- Helper: Fetch all issues and PRs (open and closed) for a repo using GraphQL --- = repoData.issues.pageInfo.endCursor || repoData.pullRequests.pageInfo.endCursor;
async function fetchRecentIssuesAndPRsGraphQL(owner, repo, sinceIso) {
  let issues = [];issues, prs };
  let prs = [];
  let hasNextPage = true;
  let endCursor = null;etch all issues and PRs (open and closed) for a repo using GraphQL ---
  while (hasNextPage) {RecentIssuesAndPRsGraphQL(owner, repo, sinceIso) {
    const res = await octokit.graphql(`
      query($owner: String!, $repo: String!, $after: String) {
        repository(owner: $owner, name: $repo) {
          issues(first: 50, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {ull;
            nodes {
              id = await octokit.graphql(`
              numberafter: String) {
              titleository(owner: $owner, name: $repo) {
              assignees(first: 10) { nodes { login } } issues(first: 50, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
              author { login }     nodes {
              state
              updatedAt
            }
            pageInfo { hasNextPage endCursor }
          }
          pullRequests(first: 50, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              id         }
              numbersNextPage endCursor }
              title         }
              assignees(first: 10) { nodes { login } }          pullRequests(first: 50, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
              author { login }
              stateid
              updatedAt
            }
            pageInfo { hasNextPage endCursor }t: 10) { nodes { login } }
          }
        }
      }edAt
    `, { owner, repo, after: endCursor });
    const repoData = res.repository;
    // Only include issues/PRs updated in the last two days      }
    issues = issues.concat(repoData.issues.nodes.filter(i => i.updatedAt && i.updatedAt >= sinceIso));        }
    prs = prs.concat(repoData.pullRequests.nodes.filter(pr => pr.updatedAt && pr.updatedAt >= sinceIso));
    hasNextPage = repoData.issues.pageInfo.hasNextPage || repoData.pullRequests.pageInfo.hasNextPage;
    endCursor = repoData.issues.pageInfo.endCursor || repoData.pullRequests.pageInfo.endCursor;ository;
  }sues/PRs updated in the last two days
  return { issues, prs };(repoData.issues.nodes.filter(i => i.updatedAt && i.updatedAt >= sinceIso));
}pullRequests.nodes.filter(pr => pr.updatedAt && pr.updatedAt >= sinceIso));
ge = repoData.issues.pageInfo.hasNextPage || repoData.pullRequests.pageInfo.hasNextPage;
// --- Main logic ---r = repoData.issues.pageInfo.endCursor || repoData.pullRequests.pageInfo.endCursor;
(async () => {
  const diagnostics = new DiagnosticsContext();eturn { issues, prs };
  const managedRepos = getManagedRepos();}
  const itemsToProcess = [];
  const seenNodeIds = new Set();
  const projectItemNodeIds = new Set(); // Track items already in project(async () => {
  const summary = {
    processed: [], // {type, number, repoName, action, reason}Repos = getManagedRepos();
    changed: []    // {type, number, repoName, action}rocess = [];
  };
ck items already in project
  // Helper to add to summary.processed with reason
  function logProcessed(item, action, reason) {, // {type, number, repoName, action, reason}
    summary.processed.push({e, number, repoName, action}
      type: item.type,
      number: item.number,
      repoName: item.repoName,th reason
      action,
      reasonush({
    });tem.type,
  }r: item.number,

  // Calculate date string for two days ago (YYYY-MM-DD)ion,
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);eason

  // 1. Any issue assigned to me in any bcgov repo goes to "New" (updated in last 2 days)
  let page = 1;
  while (true) {
    const res = await octokit.graphql(`
      query($login: String!, $after: String) {
        search(query: $login, type: ISSUE, first: 50, after: $after) { Any issue assigned to me in any bcgov repo goes to "New" (updated in last 2 days)
          nodes {
            ... on Issue {
              idwait octokit.graphql(`
              numberuery($login: String!, $after: String) {
              repository { nameWithOwner }pe: ISSUE, first: 50, after: $after) {
              assignees(first: 10) { nodes { login } }
              updatedAt
            }
          }
          pageInfo { hasNextPage endCursor }meWithOwner }
        }n } }
      }
    `, { login: `assignee:${GITHUB_AUTHOR} user:bcgov is:issue is:open updated:>=${twoDaysAgo}`, after: page > 1 ? endCursor : null });
    const issues = res.search.nodes;
    for (const issue of issues) { pageInfo { hasNextPage endCursor }
      if (!issue.repository.nameWithOwner.startsWith('bcgov/')) {   }
        logProcessed({type: 'issue', number: issue.number, repoName: issue.repository.nameWithOwner}, 'skipped', 'Not a bcgov repo');
        continue;gin: `assignee:${GITHUB_AUTHOR} user:bcgov is:issue is:open updated:>=${twoDaysAgo}`, after: page > 1 ? endCursor : null });
      } const issues = res.search.nodes;
      if (seenNodeIds.has(issue.id)) {    for (const issue of issues) {
        logProcessed({type: 'issue', number: issue.number, repoName: issue.repository.nameWithOwner}, 'skipped', 'Already processed');
        continue;Processed({type: 'issue', number: issue.number, repoName: issue.repository.nameWithOwner}, 'skipped', 'Not a bcgov repo');
      };
      seenNodeIds.add(issue.id);
      logProcessed({type: 'issue', number: issue.number, repoName: issue.repository.nameWithOwner}, 'to be added/updated', 'Assigned to user');
      itemsToProcess.push({ssue.repository.nameWithOwner}, 'skipped', 'Already processed');
        nodeId: issue.id,
        type: 'issue',
        number: issue.number,s.add(issue.id);
        repoName: issue.repository.nameWithOwner,type: 'issue', number: issue.number, repoName: issue.repository.nameWithOwner}, 'to be added/updated', 'Assigned to user');
        statusOption: STATUS_OPTIONS.new,
        sprintField: null,
        diagnostics
      });r: issue.number,
    }oName: issue.repository.nameWithOwner,
    if (!res.search.pageInfo.hasNextPage) break;
    page++;printField: null,
  } diagnostics

  // 1b. Any PR assigned to me in any bcgov repo goes to "Active" (updated in last 2 days)
  page = 1;o.hasNextPage) break;
  while (true) {
    const res = await octokit.graphql(`
      query($login: String!, $after: String) {
        search(query: $login, type: ISSUE, first: 50, after: $after) {. Any PR assigned to me in any bcgov repo goes to "Active" (updated in last 2 days)
          nodes {
            ... on PullRequest {
              idwait octokit.graphql(`
              numberuery($login: String!, $after: String) {
              repository { nameWithOwner } type: ISSUE, first: 50, after: $after) {
              assignees(first: 10) { nodes { login } }
              updatedAtest {
            }
          }r
          pageInfo { hasNextPage endCursor } nameWithOwner }
        }ogin } }
      }
    `, { login: `assignee:${GITHUB_AUTHOR} user:bcgov is:pr is:open updated:>=${twoDaysAgo}`, after: page > 1 ? endCursor : null });
    const prs = res.search.nodes;
    for (const pr of prs) { pageInfo { hasNextPage endCursor }
      if (!pr.repository.nameWithOwner.startsWith('bcgov/')) {   }
        logProcessed({type: 'pr', number: pr.number, repoName: pr.repository.nameWithOwner}, 'skipped', 'Not a bcgov repo');
        continue;gin: `assignee:${GITHUB_AUTHOR} user:bcgov is:pr is:open updated:>=${twoDaysAgo}`, after: page > 1 ? endCursor : null });
      } const prs = res.search.nodes;
      if (seenNodeIds.has(pr.id)) {    for (const pr of prs) {
        logProcessed({type: 'pr', number: pr.number, repoName: pr.repository.nameWithOwner}, 'skipped', 'Already processed');
        continue;Processed({type: 'pr', number: pr.number, repoName: pr.repository.nameWithOwner}, 'skipped', 'Not a bcgov repo');
      };
      seenNodeIds.add(pr.id);
      logProcessed({type: 'pr', number: pr.number, repoName: pr.repository.nameWithOwner}, 'to be added/updated', 'Assigned to user');
      itemsToProcess.push({sitory.nameWithOwner}, 'skipped', 'Already processed');
        nodeId: pr.id,
        type: 'pr',
        number: pr.number,s.add(pr.id);
        repoName: pr.repository.nameWithOwner,type: 'pr', number: pr.number, repoName: pr.repository.nameWithOwner}, 'to be added/updated', 'Assigned to user');
        statusOption: STATUS_OPTIONS.active,
        sprintField: null,
        diagnostics
      });r: pr.number,
    }oName: pr.repository.nameWithOwner,
    if (!res.search.pageInfo.hasNextPage) break;
    page++;printField: null,
  } diagnostics

  // 2. Any PR authored by me in any bcgov repo goes to "Active" (and linked issues, updated in last 2 days)
  page = 1;o.hasNextPage) break;
  while (true) {
    const res = await octokit.graphql(`
      query($login: String!, $after: String) {
        search(query: $login, type: ISSUE, first: 50, after: $after) { Any PR authored by me in any bcgov repo goes to "Active" (and linked issues, updated in last 2 days)
          nodes {
            ... on PullRequest {
              idwait octokit.graphql(`
              numberuery($login: String!, $after: String) {
              repository { nameWithOwner } type: ISSUE, first: 50, after: $after) {
              author { login }
              closingIssuesReferences(first: 10) { nodes { id number repository { nameWithOwner updatedAt } } }est {
            }
          }r
          pageInfo { hasNextPage endCursor } nameWithOwner }
        }
      } 10) { nodes { id number repository { nameWithOwner updatedAt } } }
    `, { login: `author:${GITHUB_AUTHOR} user:bcgov is:pr is:open updated:>=${twoDaysAgo}`, after: page > 1 ? endCursor : null });
    const prs = res.search.nodes;
    for (const pr of prs) { pageInfo { hasNextPage endCursor }
      if (!pr.repository.nameWithOwner.startsWith('bcgov/')) {
        logProcessed({type: 'pr', number: pr.number, repoName: pr.repository.nameWithOwner}, 'skipped', 'Not a bcgov repo');
        continue;ated:>=${twoDaysAgo}`, after: page > 1 ? endCursor : null });
      }
      if (seenNodeIds.has(pr.id)) {
        logProcessed({type: 'pr', number: pr.number, repoName: pr.repository.nameWithOwner}, 'skipped', 'Already processed');
        continue;.number, repoName: pr.repository.nameWithOwner}, 'skipped', 'Not a bcgov repo');
      }
      seenNodeIds.add(pr.id);
      logProcessed({type: 'pr', number: pr.number, repoName: pr.repository.nameWithOwner}, 'to be added/updated', 'Authored by user');
      itemsToProcess.push({'pr', number: pr.number, repoName: pr.repository.nameWithOwner}, 'skipped', 'Already processed');
        nodeId: pr.id,
        type: 'pr',
        number: pr.number,
        repoName: pr.repository.nameWithOwner,number: pr.number, repoName: pr.repository.nameWithOwner}, 'to be added/updated', 'Authored by user');
        statusOption: STATUS_OPTIONS.active,{
        sprintField: null,
        diagnosticspr',
      });ber: pr.number,
      // Linked issues (closingIssuesReferences) go to Active if updated in last 2 days
      if (pr.closingIssuesReferences && pr.closingIssuesReferences.nodes) {   sprintField: null,
        for (const linkedIssue of pr.closingIssuesReferences.nodes) {   if (!linkedIssue.repository.nameWithOwner.startsWith('bcgov/')) continue;
          if (seenNodeIds.has(linkedIssue.id)) continue;
          if (linkedIssue.updatedAt && linkedIssue.updatedAt >= twoDaysAgo) {   // Linked issues (closingIssuesReferences) go to Active if updated in last 2 days
            seenNodeIds.add(linkedIssue.id);      if (pr.closingIssuesReferences && pr.closingIssuesReferences.nodes) {
            logProcessed({type: 'issue', number: linkedIssue.number, repoName: linkedIssue.repository.nameWithOwner}, 'to be added/updated', 'Linked to PR authored by user');
            itemsToProcess.push({ continue;
              nodeId: linkedIssue.id,
              type: 'issue',
              number: linkedIssue.number,dIssue.id);
              repoName: linkedIssue.repository.nameWithOwner,r: linkedIssue.number, repoName: linkedIssue.repository.nameWithOwner}, 'to be added/updated', 'Linked to PR authored by user');
              statusOption: STATUS_OPTIONS.active,{
              sprintField: null,
              diagnostics,,
              reopenIfClosed: truekedIssue.number,
            });: linkedIssue.repository.nameWithOwner,
          }TATUS_OPTIONS.active,
        }intField: null,
      }
    }ed: true
    if (!res.search.pageInfo.hasNextPage) break;
    page++; }
  }   }

  // 3. Any issue or PR in my repos that is not in the project goes to "New" (updated in last 2 days)
  const myRepos = managedRepos.filter(repo => repo.startsWith('bcgov/'));hasNextPage) break;
  await processInBatches(myRepos, 5, 2000, async repoName => {
    const { issues, prs } = await fetchRecentIssuesAndPRsGraphQL('bcgov', repoName, twoDaysAgo);
    for (const issue of issues) {
      if (seenNodeIds.has(issue.id)) continue;r PR in my repos that is not in the project goes to "New" (updated in last 2 days)
      seenNodeIds.add(issue.id);epos.filter(repo => repo.startsWith('bcgov/'));
      logProcessed({type: 'issue', number: issue.number, repoName}, 'to be added/updated', 'Not in project');Batches(myRepos, 5, 2000, async repoName => {
      itemsToProcess.push({tIssuesAndPRsGraphQL('bcgov', repoName, twoDaysAgo);
        nodeId: issue.id,sues) {
        type: 'issue',ds.has(issue.id)) continue;
        number: issue.number,nNodeIds.add(issue.id);
        repoName, logProcessed({type: 'issue', number: issue.number, repoName}, 'to be added/updated', 'Not in project');
        statusOption: STATUS_OPTIONS.new, itemsToProcess.push({
        sprintField: null,        nodeId: issue.id,
        diagnostics
      });
    }
    for (const pr of prs) {   statusOption: STATUS_OPTIONS.new,
      if (seenNodeIds.has(pr.id)) continue;        sprintField: null,
      seenNodeIds.add(pr.id);
      logProcessed({type: 'pr', number: pr.number, repoName}, 'to be added/updated', 'Not in project');
      itemsToProcess.push({    }
        nodeId: pr.id,f prs) {
        type: 'pr',
        number: pr.number, seenNodeIds.add(pr.id);
        repoName,      logProcessed({type: 'pr', number: pr.number, repoName}, 'to be added/updated', 'Not in project');



















})();  console.log(JSON.stringify(summary, null, 2));  // Output summary  logDiagnostics(diagnostics);  // Log diagnostics  });    await addOrUpdateProjectItemWithSummary(item);  await processInBatches(itemsToProcess, 5, 2000, async item => {  // 4. Add or update all items in project  });    }      });        diagnostics        sprintField: null,        statusOption: STATUS_OPTIONS.active,      itemsToProcess.push({
        nodeId: pr.id,
        type: 'pr',
        number: pr.number,
        repoName,
        statusOption: STATUS_OPTIONS.active,
        sprintField: null,
        diagnostics
      });
    }
  });

  // 4. Add or update all items in project
  await processInBatches(itemsToProcess, 5, 2000, async item => {
    await addOrUpdateProjectItemWithSummary(item);
  });

  // Log diagnostics
  logDiagnostics(diagnostics);

  // Output summary
  console.log(JSON.stringify(summary, null, 2));
})();
