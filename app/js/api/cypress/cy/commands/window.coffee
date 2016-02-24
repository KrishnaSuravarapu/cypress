$Cypress.register "Window", (Cypress, _, $) ->

  ## hold a global reference to defaults
  viewportDefaults = null

  viewports = {
    "macbook-15" : "1440x900"
    "macbook-13" : "1280x800"
    "macbook-11" : "1366x768"
    "ipad-2"     : "768x1024"
    "ipad-mini"  : "768x1024"
    "iphone-6+"  : "414x736"
    "iphone-6"   : "375x667"
    "iphone-5"   : "320x568"
    "iphone-4"   : "320x480"
    "iphone-3"   : "320x480"
  }

  validOrientations = ["landscape", "portrait"]

  Cypress.on "test:before:hooks", ->
    ## if we have viewportDefaults it means
    ## something has changed the default and we
    ## need to restore prior to running the next test
    ## after which we simply null and wait for the
    ## next viewport change
    if d = viewportDefaults
      triggerAndSetViewport.call(@, d.viewportWidth, d.viewportHeight)
      viewportDefaults = null

  triggerAndSetViewport = (width, height) ->
    @Cypress.config("viewportWidth", width)
    @Cypress.config("viewportHeight", height)

    viewport = {viewportWidth: width, viewportHeight: height}

    ## force our UI to change to the viewport
    Cypress.trigger "viewport", viewport

    return viewport

  Cypress.addParentCommand
    title: (options = {}) ->
      _.defaults options, {log: true}

      if options.log
        options._log = Cypress.Log.command()

      do resolveTitle = =>
        @execute("get", "title", {
          log: false
          verify: false
        })
        .then ($el) =>
          ## set the $el in the options which
          ## is what the verification uses to
          ## ensure the element exists
          options.$el = $el.filter("head title")
          options.$el.selector = $el.selector

          @verifyUpcomingAssertions(options.$el.text(), options, {
            onRetry: resolveTitle
          })

    window: (options = {}) ->
      _.defaults options, {log: true}

      if options.log
        options._log = Cypress.Log.command()

      getWindow = =>
        window = @private("window")
        @throwErr("The remote iframe is undefined!", options._log) if not window

        return window

      ## wrap retrying into its own
      ## separate function
      retryWindow = =>
        Promise
        .try(getWindow)
        .catch (err) =>
          options.error = err
          @_retry(retryWindow, options)

      do verifyAssertions = =>
        Promise.try(retryWindow).then (win) =>
          @verifyUpcomingAssertions(win, options, {
            onRetry: verifyAssertions
          })

    document: (options = {}) ->
      _.defaults options, {log: true}

      if options.log
        options._log = Cypress.Log.command()

      getDocument = =>
        win = @private("window")
        @throwErr "The remote iframe's document is undefined!" if not win?.document

        return win.document

      ## wrap retrying into its own
      ## separate function
      retryDocument = =>
        Promise
          .try(getDocument)
          .catch (err) =>
            options.error = err
            @_retry(retryDocument, options)

      do verifyAssertions = =>
        Promise.try(retryDocument).then (doc) =>
          @verifyUpcomingAssertions(doc, options, {
            onRetry: verifyAssertions
          })

    doc: -> @sync.document()

    viewport: (presetOrWidth, heightOrOrientation, options = {}) ->
      if _.isObject(heightOrOrientation)
        options = heightOrOrientation

      _.defaults options, {log: true}

      if options.log
        options._log = Cypress.Log.command
          onConsole: ->
            obj = {}
            obj.Preset = preset if preset
            obj.Width  = width
            obj.Height = height
            obj

      throwErrBadArgs = =>
        @throwErr "cy.viewport can only accept a string preset or a width and height as numbers.", options._log

      widthAndHeightAreValidNumbers = (width, height) ->
        _.all [width, height], (val) ->
          _.isNumber(val) and _.isFinite(val)

      widthAndHeightAreWithinBounds = (width, height) ->
        _.all [width, height], (val) ->
          val > 200 and val < 3000

      switch
        when _.isString(presetOrWidth) and _.isBlank(presetOrWidth)
          @throwErr "cy.viewport cannot be passed an empty string.", options._log

        when _.isString(presetOrWidth)
          getPresetDimensions = (preset) =>
            try
              _(viewports[presetOrWidth].split("x")).map(Number)
            catch e
              presets = _.keys(viewports).join(", ")
              @throwErr "cy.viewport could not find a preset for: '#{preset}'. Available presets are: #{presets}", options._log

          orientationIsValidAndLandscape = (orientation) =>
            if orientation not in validOrientations
              all = validOrientations.join("' or '")
              @throwErr "cy.viewport can only accept '#{all}' as valid orientations. Your orientation was: '#{orientation}'", options._log

            orientation is "landscape"

          preset      = presetOrWidth
          orientation = heightOrOrientation

          ## get preset, split by x, convert to a number
          dimensions = getPresetDimensions(preset)

          if _.isString(orientation)
            if orientationIsValidAndLandscape(orientation)
              dimensions.reverse()

          [width, height] = dimensions

        when widthAndHeightAreValidNumbers(presetOrWidth, heightOrOrientation)
          width = presetOrWidth
          height = heightOrOrientation

          if not widthAndHeightAreWithinBounds(width, height)
            @throwErr "cy.viewport width and height must be between 200px and 3000px.", options._log

        else
          throwErrBadArgs()

      ## backup the previous viewport defaults
      ## if they dont already exist!
      if not viewportDefaults
        viewportDefaults = _.pick(@Cypress.config(), "viewportWidth", "viewportHeight")

      viewport = triggerAndSetViewport.call(@, width, height)

      if options._log
        options._log.set(viewport)

      return null