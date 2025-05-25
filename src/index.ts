import 'axios'

// 2) déclarer l’augmentation
declare module 'axios' {
  export interface AxiosRequestConfig {
    /** Si true, on jette l’erreur brute */
    raw?: boolean
    /** Si true, on supprime la notification */
    silent?: boolean
  }
}

import { isAxiosError, AxiosError } from 'axios'

/**
 * Represents an error thrown by the API.
 */
export class ApiError extends Error {
  constructor(message: string) {
    super(message) // restore prototype chain
    this.name = 'ApiError'
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError)
    } else {
      Object.setPrototypeOf(this, new.target.prototype)
    }
  }
}

/**
 * Describes the configuration for an error handler.
 */
export interface ErrorHandlerObject {
  /** Message to display or include in the thrown error. */
  message: string
  /** Function to run before handling the error. */
  before?: (error: unknown, options: ErrorHandlerObject) => void
  /** Function to run after handling the error. */
  after?: (error: unknown, options: ErrorHandlerObject) => void
  /** If true, suppress notification. */
  silent?: boolean
  /** Options to pass to the notifier. */
  notify?: Record<string, any>
}

/**
 * Custom error handler function type.
 * Can return an ErrorHandlerObject to trigger handleErrorObject.
 */
export type ErrorHandlerFunction = (error: unknown) => ErrorHandlerObject | void | boolean

/** Accepted types for a registered handler. */
export type ErrorHandler = string | ErrorHandlerFunction | ErrorHandlerObject

/** Options passed to the notifier. */
export interface NotifierOptions {
  /** Notification type (e.g., 'negative', 'warning'). */
  type: string
  /** Notification message. */
  message: string
  [key: string]: any
}

/** Signature of a notification function. */
export type Notifier = (options: NotifierOptions) => void

/**
 * Type guard for ErrorHandlerObject.
 */
export function isErrorHandlerObject(value: unknown): value is ErrorHandlerObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return ['message', 'after', 'before', 'silent', 'notify'].some(
      (key) => key in (value as object),
    )
  }
  return false
}

/** Default notification implementation: uses window.alert in browser, console.error otherwise. */
function defaultNotifier({ message, type }: NotifierOptions): void {
  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(`[${type}] ${message}`)
  } else {
    console.error(`[${type}] ${message}`)
  }
}

/**
 * Manages registration and invocation of error handlers.
 */
export default class ErrorHandlerRegistry {
  private handlers: Map<string, ErrorHandler>
  private parent: ErrorHandlerRegistry | null
  private notifier: Notifier

  /**
   * @param parent Optional parent registry to delegate unhandled errors.
   * @param input Optional initial handlers mapping.
   * @param notifier Optional custom notifier function.
   */
  constructor(
    parent?: ErrorHandlerRegistry | null,
    input?: Record<string, ErrorHandler>,
    notifier?: Notifier,
  ) {
    this.handlers = new Map<string, ErrorHandler>()
    this.parent = parent ?? null
    this.notifier = typeof notifier === 'function' ? notifier : defaultNotifier

    if (input) {
      this.registerMany(input)
    }
  }

  /** Overrides the notifier function. */
  public setNotifier(fn: Notifier): this {
    if (typeof fn === 'function') {
      this.notifier = fn
    }
    return this
  }

  /** Registers a handler under the specified key. */
  public register(key: string, handler: ErrorHandler): this {
    this.handlers.set(key, handler)
    return this
  }

  /** Unregisters the handler for the specified key. */
  public unregister(key: string): this {
    this.handlers.delete(key)
    return this
  }

  /** Finds a handler by key, falling back to parent if not found. */
  public find(seek: string): ErrorHandler | undefined {
    const handler = this.handlers.get(seek)
    if (handler) return handler
    return this.parent?.find(seek)
  }

  /** Registers multiple handlers at once. */
  public registerMany(input: Record<string, ErrorHandler>): this {
    for (const [key, value] of Object.entries(input)) {
      this.register(key, value)
    }
    return this
  }

  /**
   * Attempts to handle an error based on the provided key(s).
   * @returns true if a handler was found and executed.
   */
  public handleError(seek: string | Array<string | undefined>, error: unknown): boolean {
    if (Array.isArray(seek)) {
      return seek.some((key) => key !== undefined && this.handleError(String(key), error))
    }

    // const handler = this.handlers.get(String(seek))
    const handler = this.find(String(seek))
    if (!handler) {
      return false
    } else if (typeof handler === 'string') {
      this.handleErrorObject(error, { message: handler })
      return true
    } else if (typeof handler === 'function') {
      const result = handler(error)
      if (isErrorHandlerObject(result)) {
        this.handleErrorObject(error, result)
        return true
      }
      return false
    } else if (isErrorHandlerObject(handler)) {
      this.handleErrorObject(error, handler)
      return true
    }
    return false
  }

  /** Runs before/after hooks, issues notification, then throws ApiError. */
  private handleErrorObject(error: unknown, options: ErrorHandlerObject): never {
    options.before?.(error, options)

    if (!options.silent) {
      this.notifier({
        type: 'negative',
        message: options.message,
        ...(options.notify ?? {}),
      })
    }

    options.after?.(error, options)

    throw new ApiError(options.message)
  }

  /** Main entry point for handling errors in a .catch(). */
  public responseErrorHandler(error: unknown, direct = false): unknown {
    if (error === null) {
      throw new Error('Unrecoverable error: error is null')
    }

    if (isAxiosError(error)) {
      return this.handleAxiosError(error as AxiosError, direct)
    } else if (error instanceof Error) {
      this.handleError(error.name, error)
    }

    throw error
  }

  /** Specific handling for Axios errors. */
  private handleAxiosError(error: AxiosError, direct: boolean): unknown {
    const response = error.response
    const config = error.config as Record<string, any>

    const data = response?.data as Record<string, any>
    const silent = config?.silent as boolean

    if (!direct && config?.raw) {
      throw error
    }

    if (data?.message && typeof data.message === 'string') {
      return this.handleErrorObject(error, { message: data.message, silent })
    }

    const seekers = [
      data?.code,
      error.code,
      error.name,
      data?.status ? String(data.status) : undefined,
      response?.status ? String(response.status) : undefined,
    ]

    const handled = this.handleError(seekers, error)
    if (!handled) {
      if (
        (data?.message && typeof data.message === 'string') ||
        (data?.description && typeof data.description === 'string') ||
        error.message
      ) {
        return this.handleErrorObject(error, {
          message: data?.message ?? data?.description ?? error.message,
          silent,
        })
      }
    }
  }
}

/**
 * Factory to create a `dealWith` function usable in a `.catch()`.
 * @param globalHandlers - The shared ErrorHandlerRegistry instance.
 * @param notifier - Optional custom Notifier function.
 * @returns A `dealWith` function accepting local solutions and ignoreGlobal flag.
 */
export function createDealWith(
  globalHandlers: ErrorHandlerRegistry,
  notifier?: Notifier,
): (
  solutions: Record<string, ErrorHandler>,
  ignoreGlobal?: boolean,
) => (error: unknown) => unknown {
  return function dealWith(solutions: Record<string, ErrorHandler>, ignoreGlobal = false) {
    const parent = ignoreGlobal ? undefined : globalHandlers
    const local = new ErrorHandlerRegistry(parent, solutions, notifier)
    return (error: unknown) => local.responseErrorHandler(error, true)
  }
}
