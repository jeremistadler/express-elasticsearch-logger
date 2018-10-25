/*!
 * express-elasticsearch-logger
 * https://github.com/alexmingoia/express-elasticsearch-logger
 */

'use strict'

const elasticsearch = require('elasticsearch')
const os = require('os')
const onFinished = require('on-finished')

/**
 * @module express-elasticsearch-logger
 * @alias logger
 */

/**
 * Returns Express middleware configured according to given `options`.
 *
 * Middleware must be mounted before all other middleware to ensure accurate
 * capture of requests. The error handler must be mounted before other error
 * handler middleware.
 *
 * @example
 *
 * ```javascript
 * const express = require('express');
 * const logger = require('express-elasticsearch-logger');
 *
 * const app = express();
 *
 * app
 *   .use(logger.requestHandler({
 *     host: 'http://localhost:9200'
 *   })
 *   .get('/', function (req, res, next) {
 *     res.sendStatus(204);
 *   })
 *   .use(logger.errorHandler);
 * ```
 *
 * @param {Object} config elasticsearch configuration
 * @param {String=} config.index elasticsearch index (default: log_YEAR_MONTH)
 * @param {String=} config.type elasticsearch request type (default: request)
 * @param {Object} config.whitelist
 * @param {Array.<String>} config.whitelist.request request properties to log
 * @param {Array.<String>} config.whitelist.response response properties to log
 * @param {Array.<String>} config.censor list of request body properties to censor
 * @param {elasticsearch.Client=} client elasticsearch client
 * @returns {elasticsearchLoggerMiddleware} express middleware
 */
exports.requestHandler = function(config, client) {
  client = client || new elasticsearch.Client(config)
  config = deepMerge(
    {
      index: 'log_' + new Date().toISOString().substr(0, 7),
      type: 'request',
      whitelist: {
        request: [
          'httpVersion',
          'headers',
          'method',
          'originalUrl',
          'path',
          'query',
          'ip',
          'params',
        ],
        response: ['statusCode', 'took'],
      },
      censor: [],
      debug: false,
      backendSessionId: generateRandomId(),
    },
    config || {}
  )

  return function elasticsearchLoggerMiddleware(req, res, next) {
    function logRequest() {
      const logItem = generateLogMessage(req, res, config)
      if (config.debug) console.log(logItem)

      try {
        if (
          typeof config.shouldSkip === 'function' &&
          config.shouldSkip(req, res)
        )
          return
      } catch (e) {}

      log(logItem, config, client)
    }

    req._es_start = process.hrtime()
    req._es_startDate = new Date()
    onFinished(res, logRequest)
    next()
  }
}

/**
 * Error handler middleware exposes error to `Response#end`
 *
 * This middleware is used in combination with
 * {@link module:express-elasticsearch-logger.requestHandler} to capture request
 * errors.
 *
 * @param {Error} err
 * @param {express.Request} req
 * @param {express.Response} res
 * @param {express.Request.next} next
 */
exports.errorHandler = function(err, req, res, next) {
  res.error = err
  next(err)
}

function log(item, config, client) {
  client.index(
    {
      index: config.index,
      type: config.type,
      body: item,
    },
    function(error, response) {
      if (error) {
        console.error(error)
      }
    }
  )
}

function getOSInfo() {
  try {
    return {
      totalmem: os.totalmem(), // bytes
      freemem: os.freemem(), // bytes
      loadavg5min: os.loadavg()[0], // array of 5, 10, and 15 min averages
    }
  } catch (ex) {
    return {
      error: ex != null && typeof ex === 'object' ? ex.message : ex,
    }
  }
}

function generateLogMessage(req, res, config) {
  const endTime = process.hrtime()
  const duration = !req._es_start
    ? null
    : (endTime[0] - req._startAt[0]) * 1e3 +
      (endTime[1] - req._startAt[1]) * 1e-6

  const item = {
    '@timestamp': (req._es_startDate || new Date()).toISOString(),
    duration,
    request: {},
    response: {},
    backend: {
      env: process.env.NODE_ENV || 'development',
      stage: process.env.STAGE_ENV || 'dev',
      sessionId: config.backendSessionId,
    },
    os: getOSInfo(),
    process: {
      memory: process.memoryUsage(), // bytes
    },
  }

  config.whitelist.request.forEach(key => {
    if (typeof req[key] === 'object') {
      item.request[key] = Object.assign({}, req[key])
    } else {
      item.request[key] = req[key]
    }
  })

  config.whitelist.response.forEach(key => {
    if (typeof res[key] === 'object') {
      item.response[key] = Object.assign({}, res[key])
    } else {
      item.response[key] = res[key]
    }
  })

  if (item.request.body) {
    config.censor.forEach(key => {
      if (typeof item.request.body[key] !== 'undefined')
        item.request.body[key] = '**CENSORED**'
    })
  }

  if (req.route && req.route.path) {
    item.request.path = req.route.path
  }

  if (res.error) {
    item.error = {}
    Object.getOwnPropertyNames(res.error).forEach(key => {
      item.error[key] = res.error[key]
    })
  }

  return item
}

function deepMerge(a, b) {
  Object.keys(b).forEach(function(key) {
    if (typeof b[key] === 'object') {
      a[key] = deepMerge(b[key], typeof a[key] === 'object' ? a[key] : {})
    } else {
      a[key] = b[key]
    }
  })
  return a
}

function generateRandomId() {
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'

  let text = ''

  for (var i = 0; i < 10; i++)
    text += possible.charAt(Math.floor(Math.random() * possible.length))

  return text
}
