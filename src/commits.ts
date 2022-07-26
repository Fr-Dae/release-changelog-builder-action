import * as core from '@actions/core'
import {Octokit, RestEndpointMethodTypes} from '@octokit/rest'
import moment from 'moment'

export interface DiffInfo {
  changedFiles: number
  additions: number
  deletions: number
  changes: number
  commits: number
  commitInfo: CommitInfo[]
}

export const DefaultDiffInfo: DiffInfo = {
  changedFiles: 0,
  additions: 0,
  deletions: 0,
  changes: 0,
  commits: 0,
  commitInfo: []
}

export interface CommitInfo {
  sha: string
  summary: string
  message: string
  author: string
  date: moment.Moment
}

export class Commits {
  constructor(private octokit: Octokit) {}

  async getDiff(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<DiffInfo> {
    const diff: DiffInfo = await this.getDiffRemote(owner, repo, base, head)
    diff.commitInfo = this.sortCommits(diff.commitInfo)
    return diff
  }

  private async getDiffRemote(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<DiffInfo> {
    let changedFilesCount = 0
    let additionCount = 0
    let deletionCount = 0
    let changeCount = 0
    let commitCount = 0

    // Fetch comparisons recursively until we don't find any commits
    // This is because the GitHub API limits the number of commits returned in a single response.
    let commits: RestEndpointMethodTypes['repos']['compareCommits']['response']['data']['commits'] =
      []
    let compareHead = head
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const compareResult = await this.octokit.repos.compareCommits({
        owner,
        repo,
        base,
        head: compareHead
      })
      if (compareResult.data.total_commits === 0) {
        break
      }
      changedFilesCount += compareResult.data.files?.length ?? 0
      const files = compareResult.data.files
      if (files !== undefined) {
        for (const file of files) {
          additionCount += file.additions
          deletionCount += file.deletions
          changeCount += file.changes
        }
      }
      commitCount += compareResult.data.commits.length
      commits = compareResult.data.commits.concat(commits)
      compareHead = `${commits[0].sha}^`
    }

    core.info(
      `ℹ️ Found ${commits.length} commits from the GitHub API for ${owner}/${repo}`
    )

    return {
      changedFiles: changedFilesCount,
      additions: additionCount,
      deletions: deletionCount,
      changes: changeCount,
      commits: commitCount,
      commitInfo: commits
        .filter(commit => commit.sha)
        .map(commit => ({
          sha: commit.sha || '',
          summary: commit.commit.message.split('\n')[0],
          message: commit.commit.message,
          date: moment(commit.commit.committer?.date),
          author: commit.commit.author?.name || '',
          prNumber: undefined
        }))
    }
  }

  private sortCommits(commits: CommitInfo[]): CommitInfo[] {
    const commitsResult = []
    const shas: {[key: string]: boolean} = {}

    for (const commit of commits) {
      if (shas[commit.sha]) {
        continue
      }
      shas[commit.sha] = true
      commitsResult.push(commit)
    }

    commitsResult.sort((a, b) => {
      if (a.date.isBefore(b.date)) {
        return -1
      } else if (b.date.isBefore(a.date)) {
        return 1
      }
      return 0
    })

    return commitsResult
  }
}

/**
 * Filters out all commits which match the exclude pattern
 */
export function filterCommits(
  commits: CommitInfo[],
  excludeMergeBranches: string[]
): CommitInfo[] {
  const filteredCommits = []

  for (const commit of commits) {
    if (excludeMergeBranches) {
      let matched = false
      for (const excludeMergeBranch of excludeMergeBranches) {
        if (commit.summary.includes(excludeMergeBranch)) {
          matched = true
          break
        }
      }
      if (matched) {
        continue
      }
    }
    filteredCommits.push(commit)
  }

  return filteredCommits
}
