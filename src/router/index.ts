import { createRouter, createWebHistory } from 'vue-router'

// App does not use <router-view>, but we still define a root route to avoid warnings.
const Home = { template: '<div></div>' }

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: Home },
  ],
})

export default router
