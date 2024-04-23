import type { Readable } from 'stream'
import type { Request, Response } from 'express'
import type { ResourceType } from '@packages/net-stubbing'
import type { BackendRoute } from '@packages/net-stubbing/lib/server/types'

/**
 * An incoming request to the Cypress web server.
 */
export type CypressIncomingRequest = Request & {
  proxiedUrl: string
  abort: () => void
  requestId: string
  body?: string
  responseTimeout?: number
  followRedirect?: boolean
  isAUTFrame: boolean
  credentialsLevel?: RequestCredentialLevel
  isFromExtraTarget: boolean
  resourceType: ResourceType
  /**
   * Stack-ordered list of `cy.intercept()`s matching this request.
   */
  matchingRoutes?: BackendRoute[]
}

export type RequestCredentialLevel = 'same-origin' | 'include' | 'omit' | boolean

export type CypressWantsInjection = 'full' | 'fullCrossOrigin' | 'partial' | false

/**
 * An outgoing response to an incoming request to the Cypress web server.
 */
export type CypressOutgoingResponse = Response & {
  injectionNonce?: string
  isInitial: null | boolean
  wantsInjection: CypressWantsInjection
  wantsSecurityRemoved: null | boolean
  body?: string | Readable
}

export { ErrorMiddleware } from './http/error-middleware'

export { RequestMiddleware } from './http/request-middleware'

export { ResponseMiddleware } from './http/response-middleware'

export { ResourceType }

/**
 * Notification that the browser has received a response for a request for which a pre-request may have been emitted.
 */
export type BrowserResponseReceived = {
  requestId: string
  status: number | undefined
  headers: { [key: string]: string | string[] | undefined }
}

export type RequestError = {
  requestId: string
  error: any
}
