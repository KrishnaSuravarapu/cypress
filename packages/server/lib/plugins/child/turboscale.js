const _ = require('lodash')
const Promise = require('bluebird')

const request = require('../../request')()
const debug = require('debug')('cypress:server:turboscale')
const UNDEFINED_SERIALIZED = '__cypress_undefined__'

const serializeError = (err) => {
  const obj = _.pick(err,
    'name', 'message', 'stack', 'code', 'annotated', 'type',
    'details', 'isCypressErr', 'messageMarkdown',
    'originalError',
    // Location of the error when a TSError or a esbuild error occurs (parse error from ts-node or esbuild)
    'compilerErrorLocation')

  if (obj.originalError) {
    obj.originalError = serializeError(obj.originalError)
  }

  return obj
}

const handleHook = async (hook, result) => {
  try {
    let options = {
      method: 'POST',
      uri: 'http://localhost:8000/cypress/',
      body: {
        result,
        hook,
      },
      json: true,
    }

    debug(`[${hook}]: Sending ${JSON.stringify(result)} to ${options.uri}`)
    await request.rp(options)
  } catch (err) {
    debug(`[${hook}]: Error in sending ${JSON.stringify(result)}. Error: ${err.message}: ${err.stack}`)
  }
}

module.exports = {
  wrapChildPromiseTurboscale (ipc, invoke, ids, args = [], event) {
    return Promise.try(() => {
      return invoke(ids.eventId, args)
    })
    .then(async (value) => {
      // undefined is coerced into null when sent over ipc, but we need
      // to differentiate between them for 'task' event
      if (value === undefined) {
        value = UNDEFINED_SERIALIZED
      }

      await handleHook(value)

      return ipc.send(`promise:fulfilled:${ids.invocationId}`, null, value)
    }).catch((err) => {
      return ipc.send(`promise:fulfilled:${ids.invocationId}`, serializeError(err))
    })
  },
}
