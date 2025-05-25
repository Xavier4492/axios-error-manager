// __tests__/errorHandlerRegistry.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ErrorHandlerRegistry, { ApiError, isErrorHandlerObject, createDealWith } from '../src/index'
import { AxiosError } from 'axios'

describe('ApiError', () => {
  it('est une instance d’Error avec le bon nom et message', () => {
    const err = new ApiError('échec')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.name).toBe('ApiError')
    expect(err.message).toBe('échec')
  })
})

describe('isErrorHandlerObject', () => {
  it('reconnaît un ErrorHandlerObject valide', () => {
    const obj = { message: 'oops', silent: true }
    expect(isErrorHandlerObject(obj)).toBe(true)
  })
  it('rejette un objet vide ou incompatible', () => {
    expect(isErrorHandlerObject({})).toBe(false)
    expect(isErrorHandlerObject(null)).toBe(false)
    expect(isErrorHandlerObject('string')).toBe(false)
  })
})

describe('ErrorHandlerRegistry – enregistrement et recherche', () => {
  let registry: ErrorHandlerRegistry

  beforeEach(() => {
    registry = new ErrorHandlerRegistry()
  })

  it('enregistre et trouve un handler par clé', () => {
    const fn = () => {}
    registry.register('clé', fn)
    expect(registry.find('clé')).toBe(fn)
  })

  it('désenregistre un handler', () => {
    registry.register('x', 'msg').unregister('x')
    expect(registry.find('x')).toBeUndefined()
  })

  it('registre plusieurs handlers avec registerMany', () => {
    registry.registerMany({ a: '1', b: () => {} })
    expect(registry.find('a')).toBe('1')
    expect(typeof registry.find('b')).toBe('function')
  })
})

describe('ErrorHandlerRegistry.handleError (fonctionnalités)', () => {
  let notifier: ReturnType<typeof vi.fn>
  let registry: ErrorHandlerRegistry
  const sampleError = new Error('test')

  beforeEach(() => {
    notifier = vi.fn()
    registry = new ErrorHandlerRegistry(undefined, undefined, notifier)
  })

  it('string handler déclenche notification et jette ApiError', () => {
    registry.register('E1', 'erreur 1')
    expect(() => registry.handleError('E1', sampleError)).toThrow(ApiError)
    expect(notifier).toHaveBeenCalledWith({
      type: 'negative',
      message: 'erreur 1',
    })
  })

  it('ErrorHandlerObject avec before/after/silent/notify', () => {
    const before = vi.fn()
    const after = vi.fn()
    registry.register('E2', {
      message: 'erreur 2',
      before,
      after,
      silent: false,
      notify: { extra: 42 },
    })
    expect(() => registry.handleError('E2', sampleError)).toThrow(ApiError)
    expect(before).toHaveBeenCalledWith(sampleError, expect.any(Object))
    expect(notifier).toHaveBeenCalledWith({
      type: 'negative',
      message: 'erreur 2',
      extra: 42,
    })
    expect(after).toHaveBeenCalledWith(sampleError, expect.any(Object))
  })

  it('ErrorHandlerObject silent supprime la notification', () => {
    registry.register('E3', { message: 'erreur 3', silent: true })
    expect(() => registry.handleError('E3', sampleError)).toThrow(ApiError)
    expect(notifier).not.toHaveBeenCalled()
  })

  it('function handler retournant void ne gère pas l’erreur', () => {
    registry.register('E4', () => {
      /* rien */
    })
    expect(registry.handleError('E4', sampleError)).toBe(false)
  })

  it('function handler retournant ErrorHandlerObject gère l’erreur', () => {
    registry.register('E5', () => ({ message: 'erreur 5' }))
    expect(() => registry.handleError('E5', sampleError)).toThrow(ApiError)
    expect(notifier).toHaveBeenCalledWith({
      type: 'negative',
      message: 'erreur 5',
    })
  })

  it('tableau de clés tente plusieurs et s’arrête à la première valide', () => {
    registry.register('good', 'ok')
    expect(() => registry.handleError(['bad', 'good'], sampleError)).toThrow(ApiError)
    expect(notifier).toHaveBeenCalledWith({
      type: 'negative',
      message: 'ok',
    })
  })
})

describe('ErrorHandlerRegistry.responseErrorHandler', () => {
  let registry: ErrorHandlerRegistry
  let notifier: ReturnType<typeof vi.fn>

  beforeEach(() => {
    notifier = vi.fn()
    registry = new ErrorHandlerRegistry(undefined, undefined, notifier)
  })

  it('null lance une erreur critique', () => {
    expect(() => registry.responseErrorHandler(null)).toThrow('Unrecoverable error: error is null')
  })

  it('Error simple sans handler relaye l’erreur', () => {
    expect(() => registry.responseErrorHandler(new Error('boom'))).toThrow(Error)
  })

  it('AxiosError avec config.raw=true et direct=false rejette l’erreur originale', () => {
    const axiosErr = new AxiosError('axios')
    axiosErr.config = { raw: true } as any
    axiosErr.response = { data: {}, status: 500 } as any
    expect(() => registry.responseErrorHandler(axiosErr)).toThrow(axiosErr)
  })

  it('AxiosError avec data.message ressort en ApiError et notifie', () => {
    const axiosErr = new AxiosError('axios')
    axiosErr.config = { silent: false } as any
    axiosErr.response = { data: { message: 'msg API' }, status: 400 } as any
    expect(() => registry.responseErrorHandler(axiosErr)).toThrow(ApiError)
    expect(notifier).toHaveBeenCalledWith({
      type: 'negative',
      message: 'msg API',
    })
  })

  it('AxiosError silent supprime la notification', () => {
    const axiosErr = new AxiosError('axios')
    axiosErr.config = { silent: true } as any
    axiosErr.response = { data: { message: 'msg API' } } as any
    expect(() => registry.responseErrorHandler(axiosErr)).toThrow(ApiError)
    expect(notifier).not.toHaveBeenCalled()
  })
})

describe('ErrorHandlerRegistry.responseErrorHandler – cas avancés AxiosError', () => {
  let registry: ErrorHandlerRegistry
  let notifier: ReturnType<typeof vi.fn>

  beforeEach(() => {
    notifier = vi.fn()
    registry = new ErrorHandlerRegistry(undefined, undefined, notifier)
  })

  it('function handler retournant true ne gère pas l’erreur', () => {
    registry.register('E_bool', () => true)
    expect(registry.handleError('E_bool', new Error('test'))).toBe(false)
  })

  it('raw=true + direct=true ignore raw et gère data.message', () => {
    const axiosErr = new AxiosError('foo', 'CODE')
    axiosErr.config = { raw: true, silent: false } as any
    axiosErr.response = { data: { message: 'bar' } } as any

    expect(() => registry.responseErrorHandler(axiosErr, true)).toThrow(ApiError)
    expect(notifier).toHaveBeenCalledWith({
      type: 'negative',
      message: 'bar',
    })
  })

  it('data.description sans data.message utilise description', () => {
    const axiosErr = new AxiosError('ignored', 'CODE2')
    axiosErr.config = { silent: false } as any
    axiosErr.response = { data: { description: 'desc API' } } as any

    expect(() => registry.responseErrorHandler(axiosErr)).toThrow(ApiError)
    expect(notifier).toHaveBeenCalledWith({
      type: 'negative',
      message: 'desc API',
    })
  })

  it('fallback sur error.message quand pas de message ni handler', () => {
    const axiosErr = new AxiosError('boom message', 'CODE3')
    axiosErr.config = { silent: false } as any
    axiosErr.response = { data: {}, status: 500 } as any

    expect(() => registry.responseErrorHandler(axiosErr)).toThrow(ApiError)
    expect(notifier).toHaveBeenCalledWith({
      type: 'negative',
      message: 'boom message',
    })
  })
})

describe('createDealWith', () => {
  it('utilise handlers globaux et locaux selon ignoreGlobal', () => {
    const globalNotifier = vi.fn()
    const global = new ErrorHandlerRegistry()
    global.registerMany({ TEST: 'global' })
    global.setNotifier(globalNotifier)

    const localNotifier = vi.fn()
    const dealWith = createDealWith(global, localNotifier)

    const axiosError = new AxiosError('Error Message', 'TEST')
    const axiosError2 = new AxiosError('notExist', 'NOT_EXIST')

    // Should send the local message handler
    expect(() => dealWith({ TEST: 'local' }, true)(axiosError)).toThrow(ApiError)
    expect(localNotifier).toHaveBeenCalledWith({ type: 'negative', message: 'local' })
    expect(() => dealWith({ TEST: 'local' }, false)(axiosError)).toThrow(ApiError)
    expect(localNotifier).toHaveBeenCalledWith({ type: 'negative', message: 'local' })

    // Should ignore global and send the error message beacuse no local handler match the error code
    expect(() => dealWith({}, true)(axiosError)).toThrow(ApiError)
    expect(localNotifier).toHaveBeenCalledWith({ type: 'negative', message: 'Error Message' })
    expect(globalNotifier).toHaveBeenCalledTimes(0)

    // // Send error code when no local handler found
    expect(() => dealWith({}, false)(axiosError2)).toThrow(ApiError)
    expect(localNotifier).toHaveBeenCalledWith({ type: 'negative', message: 'notExist' })
    expect(globalNotifier).toHaveBeenCalledTimes(0)

    // Should send global message handler
    expect(() => dealWith({}, false)(axiosError)).toThrow(ApiError)
    expect(localNotifier).toHaveBeenCalledWith({ type: 'negative', message: 'global' })
    expect(() => dealWith({ TESTB: 'local' }, false)(axiosError)).toThrow(ApiError)
    expect(localNotifier).toHaveBeenCalledWith({ type: 'negative', message: 'global' })
  })
})
