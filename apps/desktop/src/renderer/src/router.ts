import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue'), meta: { title: '首页' } },
    { path: '/accounts', name: 'accounts', component: () => import('./views/AccountsView.vue'), meta: { title: '账号管理' } },
    { path: '/publish', name: 'publish', component: () => import('./views/PublishView.vue'), meta: { title: '发布图文' } },
    { path: '/records', name: 'records', component: () => import('./views/RecordsView.vue'), meta: { title: '发布记录' } },
  ],
})
