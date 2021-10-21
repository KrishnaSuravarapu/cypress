const _ = require('lodash')
const Promise = require('bluebird')
const { fs } = require('./util/fs')
const appData = require('./util/app_data')
const FileUtil = require('./util/file')
const logger = require('./logger')

const fileUtil = new FileUtil({
  path: appData.path('cache'),
})

const convertProjectsToArray = function (obj) {
  // if our project structure is not
  // an array then its legacy and we
  // need to convert it
  if (!_.isArray(obj.PROJECTS)) {
    obj.PROJECTS = _.chain(obj.PROJECTS).values().map('PATH').compact().value()

    return obj
  }
}

const renameSessionToken = function (obj) {
  let st

  if (obj.USER && (st = obj.USER.session_token)) {
    delete obj.USER.session_token
    obj.USER.sessionToken = st

    return obj
  }
}

module.exports = {
  path: fileUtil.path,

  defaults () {
    return {
      USER: {},
      PROJECTS: [],
      PROJECT_PREFERENCES: {},
      PROJECTS_CONFIG: {},
    }
  },

  _applyRewriteRules (obj = {}) {
    return _.reduce([convertProjectsToArray, renameSessionToken], (memo, fn) => {
      let ret

      ret = fn(memo)

      if (ret) {
        return ret
      }

      return memo
    }
    , _.cloneDeep(obj))
  },

  read () {
    return fileUtil.get().then((contents) => {
      return _.defaults(contents, this.defaults())
    })
  },

  write (obj = {}) {
    logger.info('writing to .cy cache', { cache: obj })

    return fileUtil.set(obj).return(obj)
  },

  _getProjects (tx) {
    return tx.get('PROJECTS', [])
  },

  _removeProjects (tx, projects, paths) {
    // normalize paths in array
    projects = _.without(projects, ...[].concat(paths))

    return tx.set({ PROJECTS: projects })
  },

  getProjectRoots () {
    return fileUtil.transaction((tx) => {
      return this._getProjects(tx).then((projects) => {
        const pathsToRemove = Promise.reduce(projects, (memo, path) => {
          return fs.statAsync(path)
          .catch(() => {
            return memo.push(path)
          }).return(memo)
        }
        , [])

        return pathsToRemove.then((removedPaths) => {
          return this._removeProjects(tx, projects, removedPaths)
        }).then(() => {
          return this._getProjects(tx)
        })
      })
    })
  },

  removeProject (path) {
    return fileUtil.transaction((tx) => {
      return this._getProjects(tx).then((projects) => {
        return this._removeProjects(tx, projects, path)
      })
    })
  },

  insertProject (path) {
    return fileUtil.transaction((tx) => {
      return this._getProjects(tx).then((projects) => {
        // projects are sorted by most recently used, so add a project to
        // the start or move it to the start if it already exists
        const existingIndex = _.findIndex(projects, (project) => {
          return project === path
        })

        if (existingIndex > -1) {
          projects.splice(existingIndex, 1)
        }

        projects.unshift(path)

        return tx.set('PROJECTS', projects)
      })
    })
  },

  getUser () {
    logger.info('getting user')

    return fileUtil.get('USER', {})
  },

  setUser (user) {
    logger.info('setting user', { user })

    return fileUtil.set({ USER: user })
  },

  removeUser () {
    return fileUtil.set({ USER: {} })
  },

  // We may need to set this value every time the config file is read, or updated
  // having it on the cache, will help us preventing to read the file on a cp
  // to get the projectId
  setProjectConfig (projectRoot, config) {
    return fileUtil.set({ PROJECTS_CONFIG: { [projectRoot]: config } })
  },

  getProjectConfig (projectRoot) {
    return fileUtil.get('PROJECTS_CONFIG').then((projects) => {
      return projects && projects[projectRoot] ? projects[projectRoot] : null
    })
  },

  removeLatestProjects () {
    return fileUtil.set({ PROJECTS: [] })
  },

  getProjectPreferences () {
    return fileUtil.get('PROJECT_PREFERENCES', {})
  },

  insertProjectPreferences (projectTitle, projectPreferences) {
    return fileUtil.transaction((tx) => {
      return tx.get('PROJECT_PREFERENCES', {}).then((preferences) => {
        return tx.set('PROJECT_PREFERENCES', {
          ...preferences,
          [projectTitle]: {
            ...preferences[projectTitle],
            ...projectPreferences,
          },
        })
      })
    })
  },

  removeAllProjectPreferences () {
    return fileUtil.set({ PROJECT_PREFERENCES: {} })
  },

  removeProjectPreferences (projectTitle) {
    const preferences = fileUtil.get('PROJECT_PREFERENCES', {})

    const updatedPreferences = {
      ...preferences.PROJECT_PREFERENCES,
      [projectTitle]: null,
    }

    return fileUtil.set({ PROJECT_PREFERENCES: updatedPreferences })
  },

  remove () {
    return fileUtil.remove()
  },

  // for testing purposes

  __get: fileUtil.get.bind(fileUtil),

  __removeSync () {
    fileUtil._cache = {}

    return fs.removeSync(this.path)
  },
}
