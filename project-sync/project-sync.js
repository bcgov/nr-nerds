// Minimal script: assign all open/closed PRs by GITHUB_AUTHOR to GITHUB_AUTHOR using REST API
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const yaml = require("js-yaml");

const GH_TOKEN = process.env.GH_TOKEN;
const GITHUB_AUTHOR = process.env.GITHUB_AUTHOR || "DerekRoberts";
const octokit = new Octokit({ auth: GH_TOKEN });

const repos = yaml.load(fs.readFileSync("project-sync/repos.yml")).repos;

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

// Helper to get the most recent Monday (including today if today is Monday)
function getMostRecentMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7; // 0 if Monday, 1 if Tuesday, ...
  d.setDate(d.getDate() - diff);
  d.setHours(0,0,0,0);
  return d;
}

// Helper to format date as YYYY-MM-DD
function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

// Helper to ensure a current sprint exists (today is within a sprint window)
async function ensureCurrentSprintExists(sprintField) {
  if (!sprintField || !sprintField.configuration) return;
  const iterations = sprintField.configuration.iterations;
  const currentSprintId = getCurrentSprintIterationId(iterations);
  if (!currentSprintId) {
    console.error('\nERROR: No current sprint is available. Please create a sprint in the GitHub UI that includes today.');
    process.exit(1);
  }
}

// Helper to add an item (PR or issue) to project and set status and sprint
async function addItemToProjectAndSetStatus(nodeId, type, number, sprintField, logPrefix = '') {
  try {
    // Fetch project items and check if this nodeId is already present
    const existingItemQuery = await octokit.graphql(`
      query($projectId:ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100) {
              nodes { id content { ... on PullRequest { id } ... on Issue { id } } }
            }
          }
        }
      }
    `, {
      projectId: 'PVT_kwDOAA37OM4AFuzg'
    });
    let projectItemId = null;
    const items = existingItemQuery.node.items.nodes;
    if (items && items.some(item => item.content && item.content.id === nodeId)) {
      projectItemId = items.find(item => item.content && item.content.id === nodeId).id;
      // Already in project, skip add
      // But still update status/sprint below
    } else {
      // Not in project, add it
      const addResult = await octokit.graphql(`
        mutation($projectId:ID!, $contentId:ID!) {
          addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
            item { id }
          }
        }
      `, {
        projectId: 'PVT_kwDOAA37OM4AFuzg',
        contentId: nodeId
      });
      projectItemId = addResult.addProjectV2ItemById.item.id;
    }
    // Set Status to Active
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
      projectId: 'PVT_kwDOAA37OM4AFuzg',
      itemId: projectItemId,
      fieldId: 'PVTSSF_lADOAA37OM4AFuzgzgDTYuA',
      optionId: 'c66ba2dd'
    });
    // Get Sprint field iterations
    if (sprintField && sprintField.configuration) {
      await ensureCurrentSprintExists(sprintField);
      const refreshed = await octokit.graphql(`
        query($projectId:ID!) {
          node(id: $projectId) {
            ... on ProjectV2 {
              fields(first: 20) {
                nodes {
                  ... on ProjectV2IterationField {
                    id
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
      `, { projectId: 'PVT_kwDOAA37OM4AFuzg' });
      const refreshedSprintField = refreshed.node.fields.nodes.find(f => f.id === sprintField.id);
      const iterations = refreshedSprintField.configuration.iterations;
      const currentSprintId = getCurrentSprintIterationId(iterations);
      if (currentSprintId) {
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
          projectId: 'PVT_kwDOAA37OM4AFuzg',
          itemId: projectItemId,
          fieldId: sprintField.id,
          iterationId: currentSprintId
        });
        console.log(`${logPrefix}Added/updated ${type} #${number} in project, set status to Active, and set Sprint to current sprint`);
      } else {
        console.log(`${logPrefix}Added/updated ${type} #${number} in project, set status to Active, but could not find current sprint`);
      }
    } else {
      console.log(`${logPrefix}Added/updated ${type} #${number} in project, set status to Active, but could not find Sprint field or configuration`);
    }
  } catch (err) {
    console.error(`${logPrefix}Error adding/updating ${type} #${number} in project:`, err.message);
  }
}

async function assignPRsInRepo(repo, sprintField) {
  const [owner, name] = repo.split("/");
  let page = 1;
  let found = 0;
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
        console.log(`Assigned PR #${pr.number} to ${GITHUB_AUTHOR}`);
        found++;
        // Add PR to GitHub Projects v2 and set Status to Active
        try {
          const prDetails = await octokit.pulls.get({ owner, repo: name, pull_number: pr.number });
          const prNodeId = prDetails.data.node_id;
          await addItemToProjectAndSetStatus(prNodeId, 'PR', pr.number, sprintField, '  ');
        } catch (err) {
          console.error(`  Error preparing PR #${pr.number} for project:`, err.message);
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
          console.log(`  Assigned linked issue #${issueNum} to ${GITHUB_AUTHOR}`);
          // Add linked issue to GitHub Projects v2 and set Status to Active
          try {
            const issueDetails = await octokit.issues.get({ owner, repo: name, issue_number: issueNum });
            const issueNodeId = issueDetails.data.node_id;
            await addItemToProjectAndSetStatus(issueNodeId, 'issue', issueNum, sprintField, '    ');
          } catch (err) {
            console.error(`    Error preparing issue #${issueNum} for project:`, err.message);
          }
        }
      }
    }
    page++;
  }
  if (found === 0) console.log(`No matching PRs by ${GITHUB_AUTHOR} found in ${repo}`);
}

(async () => {
  // Fetch project fields to get sprintField
  let sprintField = null;
  try {
    console.log('Fetching project fields for sprintField...');
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
    `, { projectId: 'PVT_kwDOAA37OM4AFuzg' });
    // Clean output: only print summary of fields
    const fields = projectFields.node.fields.nodes;
    console.log('Project fields:', fields.map(f => ({ id: f.id, name: f.name, dataType: f.dataType })));
    sprintField = fields.find(f => f.name && f.name.toLowerCase().includes('sprint') && f.dataType === 'ITERATION');
    if (!sprintField) {
      console.error('No sprint field found in project fields!');
    } else if (sprintField && typeof sprintField.configuration === 'string') {
      sprintField.configuration = JSON.parse(sprintField.configuration);
    }
    await ensureCurrentSprintExists(sprintField);
  } catch (e) {
    console.error('Error fetching/ensuring sprints:', e.message);
    if (e.errors) {
      for (const err of e.errors) {
        console.error('GraphQL error:', err);
      }
    }
    if (e.response) {
      console.error('GraphQL response:', JSON.stringify(e.response, null, 2));
    }
  }
  for (const repo of repos) {
    try {
      const fullRepo = repo.includes("/") ? repo : `bcgov/${repo}`;
      await assignPRsInRepo(fullRepo, sprintField);
    } catch (e) {
      console.error(`Error processing ${repo}:`, e.message);
    }
  }
})();
