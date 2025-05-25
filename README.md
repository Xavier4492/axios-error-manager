# axios-error-manager

> A lightweight Axios error handler registry for interceptors in Vue 3 applications.

[![CI](https://github.com/Xavier4492/axios-error-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/Xavier4492/axios-error-manager/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/axios-error-manager.svg)](https://www.npmjs.com/package/axios-error-manager)
[![license](https://img.shields.io/npm/l/axios-error-manager.svg)](LICENSE)

Centralize and streamline error handling for all your Axios requests. Define custom handlers by error code or HTTP status, attach hooks, and integrate with your favorite notification system.

## Table of Contents

* [Installation](#installation)
* [Quick Start](#quick-start)

  * [1. Configure Global Handlers](#1-configure-global-handlers)
  * [2. Use in Vue 3 Components](#2-use-in-vue3-components)
  * [3. Scoped Error Handling with `dealWith`](#3-scoped-error-handling-with-dealwith)
* [API Reference](#api-reference)
* [Testing & CI](#testing--ci)
* [Contributing](#contributing)
* [License](#license)

## Installation

Install via npm or yarn:

```bash
npm install axios-error-manager
# or
yarn add axios-error-manager
```

## Quick Start

### 1. Configure Global Handlers

In your `main.ts` or entry file, register global error handlers and set up a notifier (e.g. a toast, snackbar, or console logger).

```ts
// main.ts
import { createApp } from 'vue'
import App from './App.vue'
import ErrorHandlerRegistry, { api } from 'axios-error-manager'

// 1️⃣ Create a registry and define handlers
const globalErrorRegistry = new ErrorHandlerRegistry()

// Optional: replace defaultNotifier with your own
globalErrorRegistry.setNotifier(({ type, message, ...opts }) => {
  // e.g. use your toast library:
  // toast[type](message, opts)
  console.log(`[${type}] ${message}`, opts)
})

// Register handlers by error code, HTTP status, or custom keys
globalErrorRegistry.registerMany({
  ERR_NETWORK: {
    message: 'Network error: please check your connection',
    notify: { timeout: 5000 }
  },
  401: 'Unauthorized: please log in',
  404: 'Resource not found',
  // custom error from API:
  InvalidCredentials: 'Invalid credentials provided'
})

// Boot the registry into Axios interceptors
// (handled automatically upon import of `api`)

// 2️⃣ Create and mount Vue app
const app = createApp(App)
app.provide('api', api)
app.mount('#app')
```

### 2. Use in Vue 3 Components

Leverage the shared `api` instance in your components via `inject`. Errors thrown by failed requests will be handled by your global registry.

```vue
<template>
  <button @click="fetchUser" :disabled="loading">Load Profile</button>
</template>

<script lang="ts">
import { defineComponent, inject, ref } from 'vue'
import type { AxiosInstance } from 'axios'

defineComponent({
  setup() {
    const api = inject<AxiosInstance>('api')!
    const loading = ref(false)

    const fetchUser = async () => {
      loading.value = true
      try {
        const profile = await api.get('/user/profile')
        console.log('User profile:', profile)
      } catch (err) {
        // Errors are handled by your global registry automatically
      } finally {
        loading.value = false
      }
    }

    return { fetchUser, loading }
  }
})
</script>
```

### 3. Scoped Error Handling with `dealWith`

For component‑ or call‑specific handlers, use `dealWith` to define local fallbacks or overrides.

```ts
import { dealWith } from 'axios-error-manager'

async function submitForm(data) {
  try {
    await api.post('/signup', data)
  } catch (err) {
    // Provide local handlers for specific statuses or codes
    dealWith({
      409: 'Email already in use',
      400: { message: 'Invalid input', silent: true }
    })(err)
  }
}
```

The first argument is a map of error keys to handlers, and returns a function you can call in your `catch`. Handlers can be:

* **string**: use as the notification message
* **object**: full `ErrorHandlerObject` with `before`/`after` hooks, `silent`, and custom `notify` options
* **function**: return an `ErrorHandlerObject` or `void` to dynamically decide

## API Reference

| Export                 | Type                                  | Description                                        |
| ---------------------- | ------------------------------------- | -------------------------------------------------- |
| `default`              | `class ErrorHandlerRegistry`          | Registry class to register global/local handlers   |
| `ErrorHandlerRegistry` | class                                 | Alias for the default export                       |
| `ApiError`             | `class`                               | Error thrown by the registry after notification    |
| `dealWith`             | `(solutions, ignoreGlobal?)=>fn(err)` | Factory to create scoped error handling in `catch` |
| `api`                  | `AxiosInstance`                       | Preconfigured Axios instance with interceptors     |

For more details on available options and hooks, see the [API documentation](docs/api).

## Testing & CI

* **Unit tests & coverage** via [Vitest](https://vitest.dev/)
* **Type-checking** with TypeScript
* **Linting** with ESLint + Prettier
* **Continuous Integration** via GitHub Actions

```bash
# Install dependencies
npm ci

# Build & type-check
npm run build
npm run type-check

# Lint
npm run lint

# Run tests & generate coverage
npm run test:ci
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on reporting issues, proposing fixes, and submitting pull requests.

## License

Released under the [MIT License](LICENSE).
