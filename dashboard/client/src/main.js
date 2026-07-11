import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router/index.js'
import axios from 'axios'
import './style.css'

axios.defaults.withCredentials = true

let csrfToken = null
let csrfTokenRequest = null
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

async function getCsrfToken() {
  if (csrfToken) return csrfToken
  if (!csrfTokenRequest) {
    csrfTokenRequest = axios.get('/api/csrf-token').then((response) => {
      csrfToken = response.data.csrfToken
      return csrfToken
    }).finally(() => {
      csrfTokenRequest = null
    })
  }
  return csrfTokenRequest
}

axios.interceptors.request.use(async (request) => {
  const method = (request.method || 'GET').toUpperCase()
  if (unsafeMethods.has(method)) {
    request.headers['X-CSRF-Token'] = await getCsrfToken()
  }
  return request
})

axios.interceptors.response.use(undefined, (error) => {
  if (error.response?.data?.code === 'INVALID_CSRF_TOKEN') csrfToken = null
  return Promise.reject(error)
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
