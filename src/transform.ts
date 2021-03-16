import {PullRequestInfo, sortPullRequests} from './pullRequests'
import * as core from '@actions/core'
import {ReleaseNotesOptions} from './releaseNotes'
import {
  Extractor,
  Category,
  Configuration,
  Transformer,
  DefaultConfiguration
} from './configuration'

export function buildChangelog(
  prs: PullRequestInfo[],
  config: Configuration,
  options: ReleaseNotesOptions
): string {
  // sort to target order
  const sort = config.sort || DefaultConfiguration.sort
  const sortAsc = sort.toUpperCase() === 'ASC'
  prs = sortPullRequests(prs, sortAsc)
  core.info(`ℹ️ Sorted all pull requests ascending: ${sort}`)

  // extract additional labels from the commit message
  const labelExtractors = validateTransfomers(config.label_extractor)
  for (const extractor of labelExtractors) {
    if (extractor.pattern != null) {
      for (const pr of prs) {
        let label
        if (extractor.onProperty !== undefined) {
          let value: string = pr[extractor.onProperty]
          if (value === undefined) {
            core.warning(
              `⚠️ the provided property '${extractor.onProperty}' for \`label_extractor\` is not valid`
            )
            value = pr['body']
          }
          label = value.replace(extractor.pattern, extractor.target)
        } else {
          label = pr.body.replace(extractor.pattern, extractor.target)
        }
        if (label !== '') {
          pr.labels.push(label)
        }
      }
    }
  }

  const validatedTransformers = validateTransfomers(config.transformers)
  const transformedMap = new Map<PullRequestInfo, string>()
  // convert PRs to their text representation
  for (const pr of prs) {
    transformedMap.set(
      pr,
      transform(
        fillTemplate(
          pr,
          config.pr_template || DefaultConfiguration.pr_template
        ),
        validatedTransformers
      )
    )
  }
  core.info(
    `ℹ️ Used ${validateTransfomers.length} transformers to adjust message`
  )
  core.info(`✒️ Wrote messages for ${prs.length} pull requests`)

  // bring PRs into the order of categories
  const categorized = new Map<Category, string[]>()
  const categories = config.categories || DefaultConfiguration.categories
  const ignoredLabels =
    config.ignore_labels || DefaultConfiguration.ignore_labels

  for (const category of categories) {
    categorized.set(category, [])
  }

  const categorizedPrs: string[] = []
  const ignoredPrs: string[] = []
  const uncategorizedPrs: string[] = []

  // bring elements in order
  for (const [pr, body] of transformedMap) {
    if (haveCommonElements(ignoredLabels, pr.labels)) {
      ignoredPrs.push(body)
      continue
    }

    let matched = false
    for (const [category, pullRequests] of categorized) {
      if (haveCommonElements(category.labels, pr.labels)) {
        pullRequests.push(body)
        matched = true
      }
    }

    if (!matched) {
      // we allow to have pull requests included in an "uncategorized" category
      for (const [category, pullRequests] of categorized) {
        if (category.labels.length === 0) {
          pullRequests.push(body)
          break
        }
      }

      uncategorizedPrs.push(body)
    } else {
      categorizedPrs.push(body)
    }
  }
  core.info(`ℹ️ Ordered all pull requests into ${categories.length} categories`)

  // construct final changelog
  let changelog = ''
  for (const [category, pullRequests] of categorized) {
    if (pullRequests.length > 0) {
      changelog = `${changelog + category.title}\n\n`

      for (const pr of pullRequests) {
        changelog = `${changelog + pr}\n`
      }

      // add space between
      changelog = `${changelog}\n`
    }
  }
  core.info(`✒️ Wrote ${categorizedPrs.length} categorized pull requests down`)

  let changelogUncategorized = ''
  for (const pr of uncategorizedPrs) {
    changelogUncategorized = `${changelogUncategorized + pr}\n`
  }
  core.info(
    `✒️ Wrote ${uncategorizedPrs.length} non categorized pull requests down`
  )

  let changelogIgnored = ''
  for (const pr of ignoredPrs) {
    changelogIgnored = `${changelogIgnored + pr}\n`
  }
  core.info(`✒️ Wrote ${ignoredPrs.length} ignored pull requests down`)

  // fill template
  let transformedChangelog = config.template || DefaultConfiguration.template
  transformedChangelog = transformedChangelog.replace(
    /\${{CHANGELOG}}/g,
    changelog
  )
  transformedChangelog = transformedChangelog.replace(
    /\${{UNCATEGORIZED}}/g,
    changelogUncategorized
  )
  transformedChangelog = transformedChangelog.replace(
    /\${{IGNORED}}/g,
    changelogIgnored
  )

  // fill other placeholders
  transformedChangelog = transformedChangelog.replace(
    /\${{CATEGORIZED_COUNT}}/g,
    categorizedPrs.length.toString()
  )
  transformedChangelog = transformedChangelog.replace(
    /\${{UNCATEGORIZED_COUNT}}/g,
    uncategorizedPrs.length.toString()
  )
  transformedChangelog = transformedChangelog.replace(
    /\${{IGNORED_COUNT}}/g,
    ignoredPrs.length.toString()
  )
  transformedChangelog = fillAdditionalPlaceholders(
    transformedChangelog,
    options
  )

  core.info(`ℹ️ Filled template`)
  return transformedChangelog
}

export function fillAdditionalPlaceholders(
  text: string,
  options: ReleaseNotesOptions
): string {
  let transformed = text
  transformed = transformed.replace(/\${{OWNER}}/g, options.owner)
  transformed = transformed.replace(/\${{REPO}}/g, options.repo)
  transformed = transformed.replace(/\${{FROM_TAG}}/g, options.fromTag)
  transformed = transformed.replace(/\${{TO_TAG}}/g, options.toTag)
  return transformed
}

function haveCommonElements(arr1: string[], arr2: string[]): Boolean {
  return arr1.some(item => arr2.includes(item))
}

function fillTemplate(pr: PullRequestInfo, template: string): string {
  let transformed = template
  transformed = transformed.replace(/\${{NUMBER}}/g, pr.number.toString())
  transformed = transformed.replace(/\${{TITLE}}/g, pr.title)
  transformed = transformed.replace(/\${{URL}}/g, pr.htmlURL)
  transformed = transformed.replace(
    /\${{MERGED_AT}}/g,
    pr.mergedAt.toISOString()
  )
  transformed = transformed.replace(/\${{AUTHOR}}/g, pr.author)
  transformed = transformed.replace(
    /\${{LABELS}}/g,
    pr.labels?.join(', ') || ''
  )
  transformed = transformed.replace(/\${{MILESTONE}}/g, pr.milestone || '')
  transformed = transformed.replace(/\${{BODY}}/g, pr.body)
  transformed = transformed.replace(
    /\${{ASSIGNEES}}/g,
    pr.assignees?.join(', ') || ''
  )
  transformed = transformed.replace(
    /\${{REVIEWERS}}/g,
    pr.requestedReviewers?.join(', ') || ''
  )
  return transformed
}

function transform(filled: string, transformers: RegexTransformer[]): string {
  if (transformers.length === 0) {
    return filled
  }
  let transformed = filled
  for (const {target, pattern} of transformers) {
    if (pattern) {
      transformed = transformed.replace(pattern, target)
    }
  }
  return transformed
}

function validateTransfomers(
  specifiedTransformers: Transformer[]
): RegexTransformer[] {
  const transformers =
    specifiedTransformers || DefaultConfiguration.transformers
  return transformers
    .map(transformer => {
      try {
        let onProperty = undefined
        if (transformer.hasOwnProperty('on_property')) {
          onProperty = (transformer as Extractor).on_property
        }

        return {
          pattern: new RegExp(transformer.pattern.replace('\\\\', '\\'), 'gu'),
          target: transformer.target,
          onProperty
        }
      } catch (e) {
        core.warning(`⚠️ Bad replacer regex: ${transformer.pattern}`)
        return {
          pattern: null,
          target: '',
          onProperty: undefined
        }
      }
    })
    .filter(transformer => transformer.pattern != null)
}

interface RegexTransformer {
  pattern: RegExp | null
  target: string
  onProperty: 'title' | 'author' | 'milestone' | 'body' | undefined
}
