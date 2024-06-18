const { createLogger, format, transports } = require('winston')
const path = require('path')
const fs = require('fs')

const logDir = '/opt/cypress/logs' // directory path for logs

if (!fs.existsSync(logDir)) {
  // eslint-disable-next-line no-restricted-syntax
  fs.mkdirSync(logDir)
}

const {
  combine, timestamp, json, errors, colorize,
} = format

const timezoned = () => new Date().toISOString()

const logger = createLogger({
  format: combine(errors({ stack: true }), timestamp({ format: timezoned }), json(), colorize()),
  defaultMeta: { service: 'Cypress' },
  transports: [
    //
    // - Write all logs with importance level of `error` or less to `error.log`
    // - Write all logs with importance level of `info` or less to `combined.log`
    //
    new transports.Console(),
    new transports.File({ filename: path.join(logDir, '/error.log'), level: 'error' }),
    new transports.File({ filename: path.join(logDir, '/debug.log'), level: 'debug' }),
  ],
})

module.exports = logger
