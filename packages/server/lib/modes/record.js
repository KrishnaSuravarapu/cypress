const _ = require('lodash')
const path = require('path')
const la = require('lazy-ass')
const check = require('check-more-types')
const debug = require('debug')('cypress:server:record')
const debugCiInfo = require('debug')('cypress:server:record:ci-info')
const Promise = require('bluebird')
const isForkPr = require('is-fork-pr')
const commitInfo = require('@cypress/commit-info')
const { telemetry } = require('@packages/telemetry')

const { hideKeys } = require('@packages/config')

const api = require('../cloud/api').default
const exception = require('../cloud/exception')

const errors = require('../errors')
const capture = require('../capture')
const Config = require('../config')
const env = require('../util/env')
const ciProvider = require('../util/ci_provider')

const testsUtils = require('../util/tests_utils')
const specWriter = require('../util/spec_writer')

const { uploadArtifacts } = require('../cloud/artifacts/upload_artifacts')

// dont yell about any errors either
const runningInternalTests = () => {
  return env.get('CYPRESS_INTERNAL_SYSTEM_TESTS') === '1'
}

const haveProjectIdAndKeyButNoRecordOption = (projectId, options) => {
  // if we have a project id and we have a key
  // and record hasn't been set to true or false
  return (projectId && options.key) && (
    _.isUndefined(options.record)
  )
}

const warnIfProjectIdButNoRecordOption = (projectId, options) => {
  if (haveProjectIdAndKeyButNoRecordOption(projectId, options)) {
    // log a warning telling the user
    // that they either need to provide us
    // with a RECORD_KEY or turn off
    // record mode
    return errors.warning('PROJECT_ID_AND_KEY_BUT_MISSING_RECORD_OPTION', projectId)
  }
}

const throwCloudCannotProceed = ({ parallel, ciBuildId, group, err }) => {
  const errMsg = parallel ? 'CLOUD_CANNOT_PROCEED_IN_PARALLEL' : 'CLOUD_CANNOT_PROCEED_IN_SERIAL'

  const errToThrow = errors.get(errMsg, {
    response: err,
    flags: {
      group,
      ciBuildId,
    },
  })

  // tells error handler to exit immediately without running anymore specs
  errToThrow.isFatalApiErr = true

  throw errToThrow
}

const throwIfIndeterminateCiBuildId = (ciBuildId, parallel, group) => {
  if ((!ciBuildId && !ciProvider.provider()) && (parallel || group)) {
    errors.throwErr(
      'INDETERMINATE_CI_BUILD_ID',
      {
        group,
        parallel,
      },
      ciProvider.detectableCiBuildIdProviders(),
    )
  }
}

const throwIfRecordParamsWithoutRecording = (record, ciBuildId, parallel, group, tag, autoCancelAfterFailures) => {
  if (!record && _.some([ciBuildId, parallel, group, tag, autoCancelAfterFailures !== undefined])) {
    errors.throwErr('RECORD_PARAMS_WITHOUT_RECORDING', {
      ciBuildId,
      tag,
      group,
      parallel,
      autoCancelAfterFailures,
    })
  }
}

const throwIfIncorrectCiBuildIdUsage = (ciBuildId, parallel, group) => {
  // we've been given an explicit ciBuildId
  // but no parallel or group flag
  if (ciBuildId && (!parallel && !group)) {
    errors.throwErr('INCORRECT_CI_BUILD_ID_USAGE', { ciBuildId })
  }
}

const throwIfNoProjectId = (projectId, configFile) => {
  if (!projectId) {
    errors.throwErr('CANNOT_RECORD_NO_PROJECT_ID', configFile)
  }
}

const getSpecRelativePath = (spec) => {
  return _.get(spec, 'relative', null)
}

/*
artifacts : [
  {
    reportKey: 'protocol' | 'screenshots' | 'video',
    uploadUrl: string,
    filePath?: string,
    url: string,
    fileSize?: number | bigint,
    payload?: Buffer,
    message?: string,
  }
]

returns:
[
  {
    success: boolean,
    error?: string,
    url: artifact.uploadUrl,
    pathToFile: artifact.filePath,
    fileSize: artifact.fileSize,
    key: artifact.reportKey,
  },
  ...
]
*/

const updateInstanceStdout = async (options = {}) => {
  const { runId, instanceId, captured } = options

  const stdout = captured.toString()

  return api.updateInstanceStdout({
    runId,
    stdout,
    instanceId,
  }).catch((err) => {
    debug('failed updating instance stdout %o', {
      stack: err.stack,
    })

    errors.warning('CLOUD_CANNOT_CREATE_RUN_OR_INSTANCE', err)

    // dont log exceptions if we have a 503 status code
    if (err.statusCode !== 503) {
      return exception.create(err)
    }
  }).finally(capture.restore)
}

const postInstanceResults = (options = {}) => {
  const { runId, instanceId, results, group, parallel, ciBuildId, metadata } = options
  let { stats, tests, video, screenshots, reporterStats, error } = results

  video = Boolean(video)

  // get rid of the path property
  screenshots = _.map(screenshots, (screenshot) => {
    return _.omit(screenshot, 'path')
  })

  tests = tests && _.map(tests, (test) => {
    return _.omit({
      clientId: test.testId,
      ...test,
    }, 'title', 'body', 'testId')
  })

  return api.postInstanceResults({
    runId,
    instanceId,
    stats,
    tests,
    exception: error,
    video,
    reporterStats,
    screenshots,
    metadata,
  })
  .catch((err) => {
    debug('failed updating instance %o', {
      stack: err.stack,
    })

    throwCloudCannotProceed({ parallel, ciBuildId, group, err })
  })
}

const getCommitFromGitOrCi = (git) => {
  la(check.object(git), 'expected git information object', git)

  return ciProvider.commitDefaults({
    sha: git.sha,
    branch: git.branch,
    authorName: git.author,
    authorEmail: git.email,
    message: git.message,
    remoteOrigin: git.remote,
    defaultBranch: null,
  })
}

const billingLink = (orgId) => {
  if (orgId) {
    return `https://on.cypress.io/dashboard/organizations/${orgId}/billing`
  }

  return 'https://on.cypress.io/set-up-billing'
}

const gracePeriodMessage = (gracePeriodEnds) => {
  return gracePeriodEnds || 'the grace period ends'
}

const createRun = Promise.method((options = {}) => {
  _.defaults(options, {
    group: null,
    tags: null,
    parallel: null,
    ciBuildId: null,
  })

  let { projectRoot, projectId, recordKey, platform, git, specPattern, specs, parallel, ciBuildId, group, tags, testingType, autoCancelAfterFailures, project } = options

  if (recordKey == null) {
    recordKey = env.get('CYPRESS_RECORD_KEY')
  }

  if (!recordKey) {
    // are we a forked pull request (forked PR) and are we NOT running our own internal
    // e2e tests? currently some e2e tests fail when a user submits
    // a PR because this logic triggers unintended here
    if (isForkPr.isForkPr() && !runningInternalTests()) {
      // bail with a warning
      return errors.warning('RECORDING_FROM_FORK_PR')
    }

    // else throw
    errors.throwErr('RECORD_KEY_MISSING')
  }

  // go back to being a string
  if (Array.isArray(specPattern)) {
    specPattern = specPattern.join(',')
  }

  if (ciBuildId) {
    // stringify
    ciBuildId = String(ciBuildId)
  }

  specs = _.map(specs, getSpecRelativePath)

  const commit = getCommitFromGitOrCi(git)
  const ci = {
    params: ciProvider.ciParams(),
    provider: ciProvider.provider(),
  }

  // write git commit and CI provider information
  // in its own log source to expose separately
  debugCiInfo('commit information %o', commit)
  debugCiInfo('CI provider information %o', ci)

  return api.createRun({
    projectRoot,
    specs,
    group,
    tags,
    parallel,
    platform,
    ciBuildId,
    projectId,
    recordKey,
    specPattern,
    testingType,
    ci,
    commit,
    autoCancelAfterFailures,
    project,
  })
  .tap((response) => {
    if (!(response && response.warnings && response.warnings.length)) {
      return
    }

    return _.each(response.warnings, (warning) => {
      switch (warning.code) {
        case 'FREE_PLAN_IN_GRACE_PERIOD_EXCEEDS_MONTHLY_PRIVATE_TESTS':
          return errors.warning('FREE_PLAN_IN_GRACE_PERIOD_EXCEEDS_MONTHLY_PRIVATE_TESTS', {
            limit: warning.limit,
            usedTestsMessage: 'private test',
            gracePeriodMessage: gracePeriodMessage(warning.gracePeriodEnds),
            link: billingLink(warning.orgId),
          })
        case 'FREE_PLAN_IN_GRACE_PERIOD_EXCEEDS_MONTHLY_TESTS':
          return errors.warning('FREE_PLAN_IN_GRACE_PERIOD_EXCEEDS_MONTHLY_TESTS', {
            limit: warning.limit,
            usedTestsMessage: 'test',
            gracePeriodMessage: gracePeriodMessage(warning.gracePeriodEnds),
            link: billingLink(warning.orgId),
          })
        case 'FREE_PLAN_IN_GRACE_PERIOD_PARALLEL_FEATURE':
          return errors.warning('FREE_PLAN_IN_GRACE_PERIOD_PARALLEL_FEATURE', {
            gracePeriodMessage: gracePeriodMessage(warning.gracePeriodEnds),
            link: billingLink(warning.orgId),
          })
        case 'FREE_PLAN_EXCEEDS_MONTHLY_TESTS_V2':
          return errors.warning('PLAN_EXCEEDS_MONTHLY_TESTS', {
            planType: 'free',
            limit: warning.limit,
            usedTestsMessage: 'test',
            link: billingLink(warning.orgId),
          })
        case 'PAID_PLAN_EXCEEDS_MONTHLY_PRIVATE_TESTS':
          return errors.warning('PLAN_EXCEEDS_MONTHLY_TESTS', {
            planType: 'current',
            limit: warning.limit,
            usedTestsMessage: 'private test',
            link: billingLink(warning.orgId),
          })
        case 'PAID_PLAN_EXCEEDS_MONTHLY_TESTS':
          return errors.warning('PLAN_EXCEEDS_MONTHLY_TESTS', {
            planType: 'current',
            limit: warning.limit,
            usedTestsMessage: 'test',
            link: billingLink(warning.orgId),
          })
        case 'PLAN_IN_GRACE_PERIOD_RUN_GROUPING_FEATURE_USED':
          return errors.warning('PLAN_IN_GRACE_PERIOD_RUN_GROUPING_FEATURE_USED', {
            gracePeriodMessage: gracePeriodMessage(warning.gracePeriodEnds),
            link: billingLink(warning.orgId),
          })
        default:
          return errors.warning('CLOUD_UNKNOWN_CREATE_RUN_WARNING', {
            message: warning.message,
            props: _.omit(warning, 'message'),
          })
      }
    })
  }).catch((err) => {
    debug('failed creating run with status %o',
      _.pick(err, ['name', 'message', 'statusCode', 'stack']))

    switch (err.statusCode) {
      case 401:
        recordKey = hideKeys(recordKey)
        if (!recordKey) {
          // make sure the key is defined, otherwise the error
          // printing logic substitutes the default value {}
          // leading to "[object Object]" :)
          recordKey = 'undefined'
        }

        return errors.warning('CLOUD_RECORD_KEY_NOT_VALID', { recordKey, projectId })
      case 402: {
        const { code, payload } = err.error

        const limit = _.get(payload, 'limit')
        const orgId = _.get(payload, 'orgId')

        switch (code) {
          case 'FREE_PLAN_EXCEEDS_MONTHLY_PRIVATE_TESTS':
            return errors.throwErr('FREE_PLAN_EXCEEDS_MONTHLY_PRIVATE_TESTS', {
              limit,
              usedTestsMessage: 'private test',
              link: billingLink(orgId),
            })
          case 'FREE_PLAN_EXCEEDS_MONTHLY_TESTS':
            return errors.throwErr('FREE_PLAN_EXCEEDS_MONTHLY_TESTS', {
              limit,
              usedTestsMessage: 'test',
              link: billingLink(orgId),
            })
          case 'PARALLEL_FEATURE_NOT_AVAILABLE_IN_PLAN':
            return errors.throwErr('PARALLEL_FEATURE_NOT_AVAILABLE_IN_PLAN', {
              link: billingLink(orgId),
            })
          case 'RUN_GROUPING_FEATURE_NOT_AVAILABLE_IN_PLAN':
            return errors.throwErr('RUN_GROUPING_FEATURE_NOT_AVAILABLE_IN_PLAN', {
              link: billingLink(orgId),
            })
          case 'AUTO_CANCEL_NOT_AVAILABLE_IN_PLAN':
            return errors.throwErr('CLOUD_AUTO_CANCEL_NOT_AVAILABLE_IN_PLAN', {
              link: billingLink(orgId),
            })
          default:
            return errors.throwErr('CLOUD_UNKNOWN_INVALID_REQUEST', {
              response: err,
              flags: {
                group,
                tags,
                parallel,
                ciBuildId,
              },
            })
        }
      }
      case 404:
        return errors.throwErr('CLOUD_PROJECT_NOT_FOUND', projectId, path.basename(options.configFile))
      case 412:
        return errors.throwErr('CLOUD_INVALID_RUN_REQUEST', err.error)
      case 422: {
        const { code, payload } = err.error

        const runUrl = _.get(payload, 'runUrl')

        switch (code) {
          case 'RUN_GROUP_NAME_NOT_UNIQUE':
            return errors.throwErr('CLOUD_RUN_GROUP_NAME_NOT_UNIQUE', {
              group,
              runUrl,
              ciBuildId,
            })
          case 'PARALLEL_GROUP_PARAMS_MISMATCH': {
            const { browserName, browserVersion, osName, osVersion } = platform

            return errors.throwErr('CLOUD_PARALLEL_GROUP_PARAMS_MISMATCH', {
              group,
              runUrl,
              ciBuildId,
              parameters: {
                osName,
                osVersion,
                browserName,
                browserVersion,
                specs,
              },
              payload,
            })
          }
          case 'PARALLEL_DISALLOWED':
            return errors.throwErr('CLOUD_PARALLEL_DISALLOWED', {
              tags,
              group,
              runUrl,
              ciBuildId,
            })
          case 'PARALLEL_REQUIRED':
            return errors.throwErr('CLOUD_PARALLEL_REQUIRED', {
              tags,
              group,
              runUrl,
              ciBuildId,
            })
          case 'ALREADY_COMPLETE':
            return errors.throwErr('CLOUD_ALREADY_COMPLETE', {
              runUrl,
              tags,
              group,
              parallel,
              ciBuildId,
            })
          case 'STALE_RUN':
            return errors.throwErr('CLOUD_STALE_RUN', {
              runUrl,
              tags,
              group,
              parallel,
              ciBuildId,
            })
          case 'AUTO_CANCEL_MISMATCH':
            return errors.throwErr('CLOUD_AUTO_CANCEL_MISMATCH', {
              runUrl,
              tags,
              group,
              parallel,
              ciBuildId,
              autoCancelAfterFailures,
            })
          default:
            return errors.throwErr('CLOUD_UNKNOWN_INVALID_REQUEST', {
              response: err,
              flags: {
                tags,
                group,
                parallel,
                ciBuildId,
              },
            })
        }
      }
      default:
        throwCloudCannotProceed({ parallel, ciBuildId, group, err })
    }
  })
})

const createInstance = (options = {}) => {
  let { runId, group, groupId, parallel, machineId, ciBuildId, platform, spec } = options

  spec = getSpecRelativePath(spec)

  return api.createInstance({
    spec,
    runId,
    groupId,
    platform,
    machineId,
  })
  .catch((err) => {
    debug('failed creating instance %o', {
      stack: err.stack,
    })

    throwCloudCannotProceed({
      err,
      group,
      ciBuildId,
      parallel,
    })
  })
}

const _postInstanceTests = ({
  runId,
  instanceId,
  config,
  tests,
  hooks,
  parallel,
  ciBuildId,
  group,
}) => {
  return api.postInstanceTests({
    runId,
    instanceId,
    config,
    tests,
    hooks,
  })
  .catch((err) => {
    throwCloudCannotProceed({ parallel, ciBuildId, group, err })
  })
}

const createRunAndRecordSpecs = (options = {}) => {
  const { specPattern,
    specs,
    sys,
    browser,
    projectId,
    config,
    projectRoot,
    runAllSpecs,
    parallel,
    ciBuildId,
    group,
    project,
    onError,
    testingType,
    quiet,
    autoCancelAfterFailures,
  } = options
  const recordKey = options.key

  // we want to normalize this to an array to send to API
  const tags = _.split(options.tag, ',')

  return commitInfo.commitInfo(projectRoot)
  .then((git) => {
    debugCiInfo('found the following git information')
    debugCiInfo(git)

    const platform = {
      osCpus: sys.osCpus,
      osName: sys.osName,
      osMemory: sys.osMemory,
      osVersion: sys.osVersion,
      browserName: browser.displayName,
      browserVersion: browser.version,
    }

    telemetry.startSpan({ name: 'record:createRun' })

    return createRun({
      projectRoot,
      git,
      specs,
      group,
      tags,
      parallel,
      platform,
      recordKey,
      ciBuildId,
      projectId,
      specPattern,
      testingType,
      configFile: config ? config.configFile : null,
      autoCancelAfterFailures,
      project,
    })
    .then((resp) => {
      telemetry.getSpan('record:createRun')?.end()
      if (!resp) {
        // if a forked run, can't record and can't be parallel
        // because the necessary env variables aren't present
        return runAllSpecs({
          parallel: false,
        })
      }

      const { runUrl, runId, machineId, groupId } = resp
      const protocolCaptureMeta = resp.capture || {}

      let captured = null
      let instanceId = null

      const beforeSpecRun = (spec) => {
        telemetry.startSpan({ name: 'record:beforeSpecRun' })
        project.setOnTestsReceived(onTestsReceived)
        capture.restore()

        captured = capture.stdout()

        return createInstance({
          spec,
          runId,
          group,
          groupId,
          platform,
          parallel,
          ciBuildId,
          machineId,
        })
        .then((resp = {}) => {
          instanceId = resp.instanceId

          // pull off only what we need
          const result = _
          .chain(resp)
          .pick('spec', 'claimedInstances', 'totalInstances')
          .extend({
            estimated: resp.estimatedWallClockDuration,
            instanceId,
          })
          .value()

          telemetry.getSpan('record:beforeSpecRun')?.end()

          return result
        })
      }

      const afterSpecRun = (spec, results, config) => {
        // don't do anything if we failed to
        // create the instance
        if (!instanceId || results.skippedSpec) {
          return
        }

        telemetry.startSpan({ name: 'record:afterSpecRun' })

        debug('after spec run %o', { spec })

        return specWriter.countStudioUsage(spec.absolute)
        .then((metadata) => {
          return postInstanceResults({
            group,
            config,
            results,
            parallel,
            ciBuildId,
            instanceId,
            metadata,
          })
        })
        .then((resp) => {
          debug('[createRunAndRecordSpecs] in afterspecrun')
          debug('postInstanceResults resp %O', resp)
          const { video, screenshots } = results

          if (!resp || Object.keys(resp).length === 0) {
            resp = {
              videoUploadUrl: 'https://grid.browserstack.com',
              captureUploadUrl: '',
              screenshotUploadUrls: [],
            }

            screenshots.forEach((screenshot) => {
              screenshotUploadUrls.push({ screenshotId: screenshot.screenshotId, uploadUrl: 'https://grid.browserstack.com' })
            })
          }

          debug('postInstanceResults resp2 is %O', resp)

          const { videoUploadUrl, captureUploadUrl, screenshotUploadUrls } = resp

          return uploadArtifacts({
            runId,
            instanceId,
            video,
            screenshots,
            videoUploadUrl,
            captureUploadUrl,
            platform,
            projectId,
            spec,
            protocolCaptureMeta,
            protocolManager: project.protocolManager,
            screenshotUploadUrls,
            quiet,
          })
          .finally(() => {
            // always attempt to upload stdout
            // even if uploading failed
            debug(`[createRunAndRecordSpecs] in finally of afterSpecRun`)

            return updateInstanceStdout({
              captured,
              instanceId,
            }).finally(() => {
              telemetry.getSpan('record:afterSpecRun')?.end()
            })
          })
        })
      }

      const onTestsReceived = (async (runnables, cb) => {
        // we failed createInstance earlier, nothing to do
        if (!instanceId) {
          return cb()
        }

        // runnables will be null when there' no tests
        // this also means runtimeConfig will be missing
        runnables = runnables || {}

        const r = testsUtils.flattenSuiteIntoRunnables(runnables)
        const runtimeConfig = runnables.runtimeConfig
        const resolvedRuntimeConfig = Config.getResolvedRuntimeConfig(config, runtimeConfig)

        const tests = _.chain(r[0])
        .uniqBy('id')
        .map((v) => {
          return _.pick({
            ...v,
            clientId: v.id,
            config: v._testConfig?.unverifiedTestConfig || null,
            title: v._titlePath.map((title) => {
              // sanitize the title which may have been altered by a suite-/test-level
              // browser skip to ensure the original title is used so the test recorded
              // to the cloud is correct registered as a pending test
              const BROWSER_SKIP_TITLE = ' (skipped due to browser)'

              return title.replace(BROWSER_SKIP_TITLE, '')
            }),
            hookIds: v.hooks.map((hook) => hook.hookId),
          },
          'clientId', 'body', 'title', 'config', 'hookIds')
        })
        .value()

        const hooks = _.chain(r[1])
        .uniqBy('hookId')
        .map((v) => {
          return _.pick({
            ...v,
            clientId: v.hookId,
            title: [v.title],
            type: v.hookName,
          },
          'clientId',
          'type',
          'title',
          'body')
        })
        .value()

        const responseDidFail = {}
        const response = await _postInstanceTests({
          runId,
          instanceId,
          config: resolvedRuntimeConfig,
          tests,
          hooks,
          parallel,
          ciBuildId,
          group,
        })
        .catch((err) => {
          onError(err)

          return responseDidFail
        })

        if (response === responseDidFail) {
          debug('`responseDidFail` equals `response`, allowing browser to hang until it is killed: Response %o', { responseDidFail })

          // dont call the cb, let the browser hang until it's killed
          return
        }

        if (_.some(response.actions, { type: 'SPEC', action: 'SKIP' })) {
          errors.warning('CLOUD_CANCEL_SKIPPED_SPEC')

          // set a property on the response so the browser runner
          // knows not to start executing tests
          project.emit('end', { skippedSpec: true, stats: {} })

          // dont call the cb, let the browser hang until it's killed
          return
        }

        return cb(response)
      })

      return runAllSpecs({
        runUrl,
        parallel,
        onTestsReceived,
        beforeSpecRun,
        afterSpecRun,
      })
    })
  })
}

module.exports = {
  createRun,

  createInstance,

  postInstanceResults,

  _postInstanceTests,

  updateInstanceStdout,

  uploadArtifacts,

  throwIfNoProjectId,

  throwIfIndeterminateCiBuildId,

  throwIfIncorrectCiBuildIdUsage,

  warnIfProjectIdButNoRecordOption,

  throwIfRecordParamsWithoutRecording,

  createRunAndRecordSpecs,

  getCommitFromGitOrCi,
}
