<script setup lang="ts">
import { resolvePost, validatePost, type Account, type PlatformId, type Post } from '@maxiaoer/core'
import {
  NAlert, NButton, NCard, NCheckbox, NCheckboxGroup, NDatePicker, NDynamicTags, NEmpty, NForm, NFormItem, NImage,
  NInput, NSpace, NSwitch, NTag, useMessage,
} from 'naive-ui'
import { computed, reactive, ref, toRaw } from 'vue'
import { useRouter } from 'vue-router'
import AccountAvatar from '../components/AccountAvatar.vue'
import { localFileUrl, platformMeta } from '../platforms'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const message = useMessage()
const router = useRouter()

const newPost = (): Post => ({
  id: crypto.randomUUID(),
  title: '',
  content: '',
  images: [],
  topics: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
})
const post = reactive<Post>(newPost())
const selected = ref<string[]>([])
const scheduled = ref(false)
const scheduledAt = ref<number | null>(null)
const publishing = ref(false)

const accountsByPlatform = computed(() => {
  const groups = new Map<PlatformId, Account[]>()
  for (const a of store.accounts) groups.set(a.platform, [...(groups.get(a.platform) ?? []), a])
  return [...groups.entries()]
})

/** 只对选中账号所在的平台做校验，对应蚁小二右侧的“平台要求”提示 */
const issues = computed(() => {
  const platforms = new Set(store.accounts.filter((a) => selected.value.includes(a.id)).map((a) => a.platform))
  return [...platforms].map((id) => {
    const limits = store.platforms.find((p) => p.id === id)!.limits
    return { id, errors: validatePost(resolvePost(post, id), limits) }
  })
})
const blocked = computed(() => !selected.value.length || issues.value.some((i) => i.errors.length))

async function pickImages() {
  const paths = await window.maxiaoer.posts.pickImages()
  post.images.push(...paths.map((path) => ({ path })))
}

async function publish() {
  publishing.value = true
  try {
    // IPC 只能传可结构化克隆的对象，先去掉响应式代理
    const plain: Post = JSON.parse(JSON.stringify({ ...toRaw(post), updatedAt: Date.now() }))
    await window.maxiaoer.publish.start(plain, [...selected.value], scheduled.value ? scheduledAt.value ?? undefined : undefined)
    message.success(scheduled.value ? '已加入定时发布' : '已开始发布')
    void router.push('/records')
  } finally {
    publishing.value = false
  }
}
</script>

<template>
  <div class="publish">
    <NCard title="编辑内容" class="editor">
      <NForm label-placement="top">
        <NFormItem label="图片">
          <NSpace>
            <div v-for="(img, i) in post.images" :key="img.path" class="thumb">
              <NImage :src="localFileUrl(img.path)" width="96" height="96" object-fit="cover" />
              <NButton size="tiny" circle class="remove" @click="post.images.splice(i, 1)">×</NButton>
            </div>
            <NButton dashed class="add-img" @click="pickImages">+ 添加图片</NButton>
          </NSpace>
        </NFormItem>
        <NFormItem label="标题">
          <NInput v-model:value="post.title" placeholder="填写标题，小红书最多 20 字" show-count />
        </NFormItem>
        <NFormItem label="正文">
          <NInput v-model:value="post.content" type="textarea" :autosize="{ minRows: 8 }" placeholder="填写正文" show-count />
        </NFormItem>
        <NFormItem label="话题">
          <NDynamicTags v-model:value="post.topics" />
        </NFormItem>
      </NForm>
    </NCard>

    <div class="side">
      <NCard title="选择账号">
        <NEmpty v-if="!store.accounts.length" description="还没有账号">
          <template #extra><NButton size="small" @click="router.push('/accounts')">去添加</NButton></template>
        </NEmpty>
        <NCheckboxGroup v-model:value="selected">
          <div v-for="[platform, accounts] in accountsByPlatform" :key="platform" class="group">
            <div class="group-title">{{ platformMeta[platform].name }}</div>
            <NSpace>
              <NCheckbox v-for="a in accounts" :key="a.id" :value="a.id" :disabled="a.status === 'expired'">
                <NSpace :size="6" align="center"><AccountAvatar :account="a" :size="24" />{{ a.nickname }}</NSpace>
              </NCheckbox>
            </NSpace>
          </div>
        </NCheckboxGroup>
      </NCard>

      <NCard title="平台要求" v-if="issues.length">
        <NSpace vertical>
          <div v-for="i in issues" :key="i.id">
            <NTag :type="i.errors.length ? 'error' : 'success'" size="small">{{ platformMeta[i.id].name }}</NTag>
            <span v-if="!i.errors.length" class="ok">符合要求</span>
            <NAlert v-else type="error" :show-icon="false" style="margin-top: 6px">{{ i.errors.join('；') }}</NAlert>
          </div>
        </NSpace>
      </NCard>

      <NCard>
        <NSpace vertical>
          <NSpace align="center">定时发布 <NSwitch v-model:value="scheduled" /></NSpace>
          <NDatePicker v-if="scheduled" v-model:value="scheduledAt" type="datetime" :is-date-disabled="(t: number) => t < Date.now() - 864e5" />
          <NButton type="primary" block size="large" :disabled="blocked" :loading="publishing" @click="publish">
            一键发布（{{ selected.length }} 个账号）
          </NButton>
        </NSpace>
      </NCard>
    </div>
  </div>
</template>

<style scoped>
.publish { display: grid; grid-template-columns: 1fr 360px; gap: 16px; align-items: start; }
.side { display: flex; flex-direction: column; gap: 16px; }
.thumb { position: relative; }
.thumb .remove { position: absolute; top: -6px; right: -6px; }
.add-img { width: 96px; height: 96px; }
.group + .group { margin-top: 12px; }
.group-title { font-size: 12px; color: #888; margin-bottom: 6px; }
.ok { margin-left: 8px; color: #18a058; font-size: 12px; }
</style>
