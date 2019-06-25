<div align="center">
    <!-- <img src="docs/readme-logo.png"> -->
    <h1>Cypress Developer ESLint Plugin</h1>
    <a href="https://www.npmjs.com/package/@cypress/eslint-plugin-dev"><img src="https://img.shields.io/npm/v/@cypress/eslint-plugin-dev.svg?style=flat"></a>
    <a href="https://www.npmjs.com/package/@cypress/eslint-plugin-dev"><img src="https://img.shields.io/npm/dm/@cypress/eslint-plugin-dev.svg"></a>
    <a href="https://github.com/cypress-io/cypress-eslint-plugin-dev/blob/master/LICENSE.md"><img src="https://img.shields.io/github/license/cypress-io/cypress-eslint-plugin-dev.svg"></a>

<p>Common ESLint rules shared by Cypress packages.</p>

</div>
 


**Note that this is meant for packages that are part of Cypress and not necessarily for a project that uses Cypress.**

## Installation

```
npm install --save-dev @cypress/eslint-plugin-dev
```

## Usage

Add this plugin to your .eslintrc:

```js
// .eslintrc.json
{
  "plugins": [
    "@cypress/dev"
  ]
}
```

Extend one or more of the presets depending on the nature of the package:

```js
// .eslintrc.json
{
  "plugins": [
    "@cypress/dev"
  ]
  "extends": [
    "plugin:@cypress/dev/general",
    "plugin:@cypress/dev/tests",
    "plugin:@cypress/dev/react"
  ]
}
```

You can relax rules

```js
// .eslintrc.json
{
  "extends": [
    "plugin:@cypress/dev/general"
  ],
  "rules": {
    "comma-dangle": "off",
    "no-debugger": "warn"
  },
  "env": {
    "node": true
  }
}
```

## Presets

### general

The majority of the rules concerning JavaScript. Should usually be used at the root of the package.

**you must install the following as devDependencies yourself**:
```sh
@typescript-eslint/parser
@typescript-eslint/eslint-plugin
@cypress/eslint-plugin-json
```

### tests

Test-specific configuration and rules. Should be used within the `test` directory.

**you must install the following as devDependencies yourself**:
```sh
eslint-plugin-mocha
```
### react

React and JSX-specific configuration and rules.

**you must install the following as devDependencies yourself**:
```sh
babel-eslint
eslint-plugin-react
```

## Dependencies

Due to a limitation in how ESLint plugins work, your package needs to install the ESLint plugins that this plugin depends on:

If using the `tests` preset:

```bash
npm install --save-dev eslint-plugin-mocha
```

If using the `react` preset:

```bash
npm install --save-dev babel-eslint eslint-plugin-react
```

## Editors

### VSCode

Use plugin [ESLint by Dirk Baeumer](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) to lint and auto fix JS files using ESLint. This repository includes example [.vscode/settings.json](.vscode/settings.json) file.

### Atom

Install package [linter-eslint](https://atom.io/packages/linter-eslint)
(and its dependencies) to enable linting. Go into the settings for this package
and enable "Fix on save" option to auto-fix white space issues and other things.

### Sublime Text

Install [ESLint-Formatter](https://packagecontrol.io/packages/ESLint-Formatter),
then set the following settings:

```json
{
  "format_on_save": true,
  "debug": true
}
```

## License

This project is licensed under the terms of the [MIT license](/LICENSE.md).
