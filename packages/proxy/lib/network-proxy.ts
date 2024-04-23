import { telemetry } from '@packages/telemetry'
import { Http, ServerCtx } from './http'

export class NetworkProxy {
  http: Http

  constructor (opts: ServerCtx) {
    this.http = new Http(opts)
  }

  handleHttpRequest (req, res) {
    const span = telemetry.startSpan({
      name: 'network:proxy:handleHttpRequest',
      opts: {
        attributes: {
          'network:proxy:url': req.proxiedUrl,
          'network:proxy:contentType': req.get('content-type'),
        },
      },
      isVerbose: true,
    })

    this.http.handleHttpRequest(req, res, span).finally(() => {
      span?.end()
    })
  }

  handleSourceMapRequest (req, res) {
    this.http.handleSourceMapRequest(req, res)
  }

  setHttpBuffer (buffer) {
    this.http.setBuffer(buffer)
  }

  reset () {
    this.http.reset()
  }

  setProtocolManager (protocolManager) {
    this.http.setProtocolManager(protocolManager)
  }
}
