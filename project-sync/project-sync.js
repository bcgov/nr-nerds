// Minimal script: assign all open/closed PRs by GITHUB_AUTHOR to GITHUB_AUTHOR using REST API
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const yaml = require("js-yaml");

const GH_TOKEN = process.env.GH_TOKEN;
const GITHUB_AUTHOR = process.env.GITHUB_AUTHOR || "DerekRoberts";
const octokit = new Octokit({ auth: GH_TOKEN });

const repos = yaml.load(fs.readFileSync("project-sync/repos.yml")).repos;

async function assignPRsInRepo(repo) {
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
        ) &&
        (!pr.assignees || pr.assignees.length === 0)
      ) {
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
          // Get the node_id for the PR
          const prDetails = await octokit.pulls.get({ owner, repo: name, pull_number: pr.number });
          const prNodeId = prDetails.data.node_id;
          // Add PR to project and get the project item id
          const addPrResult = await octokit.graphql(`
            mutation($projectId:ID!, $contentId:ID!) {
              addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
                item { id }
              }
            }
          `, {
            projectId: 'PVT_kwDOAA37OM4AFuzg',
            contentId: prNodeId
          });
          const prProjectItemId = addPrResult.addProjectV2ItemById.item.id;
          // Set Status to Active using the project item id
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
            itemId: prProjectItemId,
            fieldId: 'PVTSSF_lADOAA37OM4AFuzgzgDTYuA',
            optionId: 'c66ba2dd'
          });
          console.log(`  Added PR #${pr.number} to project and set status to Active`);
        } catch (err) {
          if (err.message && err.message.includes('A project item already exists for this content')) {
            // Already in project, skip
          } else {
            console.error(`  Error adding PR #${pr.number} to project:`, err.message);
          }
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
          // Only assign if not already assigned
          if (!event.source.issue.assignees || event.source.issue.assignees.length === 0) {
            await octokit.issues.addAssignees({
              owner,
              repo: name,
              issue_number: issueNum,
              assignees: [GITHUB_AUTHOR]
            });
            console.log(`  Assigned linked issue #${issueNum} to ${GITHUB_AUTHOR}`);
          }
          // Add linked issue to GitHub Projects v2 and set Status to Active
          try {
            // Get the node_id for the issue
            const issueDetails = await octokit.issues.get({ owner, repo: name, issue_number: issueNum });
            const issueNodeId = issueDetails.data.node_id;
            // Add issue to project and get the project item id
            const addIssueResult = await octokit.graphql(`
              mutation($projectId:ID!, $contentId:ID!) {
                addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
                  item { id }
                }
              }
            `, {
              projectId: 'PVT_kwDOAA37OM4AFuzg',
              contentId: issueNodeId
            });
            const issueProjectItemId = addIssueResult.addProjectV2ItemById.item.id;
            // Set Status to Active using the project item id
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
              itemId: issueProjectItemId,
              fieldId: 'PVTSSF_lADOAA37OM4AFuzgzgDTYuA',
              optionId: 'c66ba2dd'
            });
            console.log(`    Added issue #${issueNum} to project and set status to Active`);
          } catch (err) {
            if (err.message && err.message.includes('A project item already exists for this content')) {
              // Already in project, skip
            } else {
              console.error(`    Error adding issue #${issueNum} to project:`, err.message);
            }
          }
        }
      }
    }
    page++;
  }
  if (found === 0) console.log(`No matching PRs by ${GITHUB_AUTHOR} found in ${repo}`);
}

(async () => {
  for (const repo of repos) {
    try {
      const fullRepo = repo.includes("/") ? repo : `bcgov/${repo}`;
      await assignPRsInRepo(fullRepo);
    } catch (e) {
      console.error(`Error processing ${repo}:`, e.message);
    }
  }
})();
