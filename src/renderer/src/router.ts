import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./pages/HomePage.vue'), meta: { title: '首页' } },
    { path: '/accounts', name: 'accounts', component: () => import('./pages/AccountsPage.vue'), meta: { title: '账号管理' } },
    { path: '/publish', name: 'publish', component: () => import('./pages/PublishPage.vue'), meta: { title: '发布图文' } },
    { path: '/records', name: 'records', component: () => import('./pages/RecordsPage.vue'), meta: { title: '发布记录' } },
    { path: '/topics', name: 'topics', component: () => import('./pages/TopicsPage.vue'), meta: { title: '话题合集' } },
  ],
})
