<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { defaultSettings, type Account, type PlatformId, type Post, type SettingValues } from '../../../shared/types'
import { validatePost } from '../../../shared/validate'
import AccountAvatar from '../components/AccountAvatar.vue'
import AccountSettings from '../components/AccountSettings.vue'
import TopicInput from '../components/TopicInput.vue'
import { errorText, localFileUrl, plain, useAppState } from '../composables/useAppState'

const { platforms, platformMap, accounts } = useAppState()
const toast = useToast()
const router = useRouter()

const post = reactive<Post>({
  id: crypto.randomUUID(),
  title: '',
  content: '',
  images: [],
  topics: [],
  settings: {},
  createdAt: Date.now(),
  updatedAt: Date.now(),
})
const selected = ref<string[]>([])
const scheduled = ref(false)
const scheduledAt = ref('')
const publishing = ref(false)

// 上次配置 & 每个账号的“使用上次选择”开关（默认开）
const lastSettings = ref<Record<string, SettingValues>>({})
const useLast = reactive<Record<string, boolean>>({})
onMounted(async () => {
  lastSettings.value = await window.maxiaoer.prefs.lastSettings()
  Object.assign(useLast, await window.maxiaoer.prefs.useLast())
})

const groups = computed(() =>
  platforms.value
    .map((p) => ({ platform: p, accounts: accounts.value.filter((a) => a.platform === p.id) }))
    .filter((g) => g.accounts.length),
)
const selectedAccounts = computed(() => accounts.value.filter((a) => selected.value.includes(a.id)))

function initialSettings(a: Account): SettingValues {
  const defaults = defaultSettings(platformMap.value[a.platform].settings)
  const last = lastSettings.value[a.id]
  return useLast[a.id] !== false && last ? { ...defaults, ...last } : defaults
}

// 勾选账号时生成它的配置
watch(selectedAccounts, (list) => {
  for (const a of list) post.settings[a.id] ??= initialSettings(a)
})

function toggle(id: string) {
  selected.value = selected.value.includes(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id]
}

async function setUseLast(a: Account, value: boolean) {
  useLast[a.id] = value
  await window.maxiaoer.prefs.setUseLast(a.id, value)
}
function applyLast(a: Account) {
  post.settings[a.id] = initialSettings(a)
}

/** 按选中账号所在的平台校验 */
const issues = computed(() => {
  const ids = [...new Set(selectedAccounts.value.map((a) => a.platform))] as PlatformId[]
  return ids.map((id) => ({ platform: platformMap.value[id], errors: validatePost(post, platformMap.value[id].limits) }))
})
const blocked = computed(() => !selected.value.length || issues.value.some((i) => i.errors.length) || (scheduled.value && !scheduledAt.value))
const titleMax = computed(() => Math.min(...issues.value.map((i) => i.platform.limits.titleMax ?? Infinity), 64))
const maxTopics = computed(() => Math.min(...issues.value.map((i) => i.platform.limits.maxTopics ?? Infinity), 30))

async function pickImages() {
  const paths = await window.maxiaoer.posts.pickImages()
  post.images.push(...paths.filter((p) => !post.images.some((i) => i.path === p)).map((path) => ({ path })))
}

async function publish() {
  publishing.value = true
  try {
    const payload = plain({ ...post, updatedAt: Date.now() })
    // 只保留选中账号的配置
    payload.settings = Object.fromEntries(selected.value.map((id) => [id, payload.settings[id]]))
    await window.maxiaoer.publish.start(payload, [...selected.value], scheduled.value ? new Date(scheduledAt.value).getTime() : undefined)
    toast.add({ title: scheduled.value ? '已加入定时发布' : '已开始发布', color: 'success', icon: 'i-lucide-check' })
    void router.push('/records')
  } catch (e) {
    toast.add({ title: '发布失败', description: errorText(e), color: 'error' })
  } finally {
    publishing.value = false
  }
}
</script>

<template>
  <div class="grid grid-cols-[1fr_400px] gap-4 items-start">
    <UCard :ui="{ body: 'space-y-5' }">
      <UFormField label="图片" :help="`已选 ${post.images.length} 张，第一张为封面`">
        <div class="flex flex-wrap gap-2">
          <div v-for="(img, i) in post.images" :key="img.path" class="relative group">
            <img :src="localFileUrl(img.path)" class="size-24 rounded-md object-cover ring ring-default" />
            <UBadge v-if="i === 0" label="封面" size="sm" class="absolute left-1 top-1" />
            <UButton
              icon="i-lucide-x"
              size="xs"
              color="neutral"
              class="absolute -right-2 -top-2 rounded-full opacity-0 group-hover:opacity-100"
              @click="post.images.splice(i, 1)"
            />
          </div>
          <button
            class="size-24 rounded-md border border-dashed border-accented flex flex-col items-center justify-center gap-1 text-muted text-sm hover:border-primary hover:text-primary"
            @click="pickImages"
          >
            <UIcon name="i-lucide-image-plus" class="size-6" />
            添加图片
          </button>
        </div>
      </UFormField>

      <UFormField label="标题">
        <UInput v-model="post.title" placeholder="填写标题" :maxlength="titleMax" class="w-full" :ui="{ trailing: 'pointer-events-none' }">
          <template #trailing>
            <span class="text-xs text-muted tabular-nums">{{ [...post.title].length }}/{{ titleMax }}</span>
          </template>
        </UInput>
      </UFormField>

      <UFormField label="正文">
        <UTextarea v-model="post.content" placeholder="填写正文" :rows="10" autoresize class="w-full" />
        <template #hint>
          <span class="tabular-nums">{{ [...post.content].length }} 字</span>
        </template>
      </UFormField>

      <UFormField label="话题" :hint="`${post.topics.length}/${maxTopics}`">
        <TopicInput v-model="post.topics" :max="maxTopics" />
      </UFormField>
    </UCard>

    <div class="space-y-4">
      <UCard :ui="{ header: 'p-3 sm:px-4', body: 'p-3 sm:p-4 space-y-4' }">
        <template #header>
          <div class="flex justify-between items-center">
            <span class="font-medium">选择账号</span>
            <span class="text-xs text-muted">已选 {{ selected.length }}</span>
          </div>
        </template>
        <UEmpty v-if="!accounts.length" icon="i-lucide-user-plus" title="还没有账号" :actions="[{ label: '去添加', to: '/accounts' }]" />
        <div v-for="g in groups" :key="g.platform.id">
          <div class="text-xs text-muted mb-2">{{ g.platform.name }}</div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="a in g.accounts"
              :key="a.id"
              :disabled="a.status === 'expired'"
              class="flex items-center gap-2 rounded-lg px-2 py-1.5 ring text-sm transition disabled:opacity-40"
              :class="selected.includes(a.id) ? 'ring-primary bg-primary/10' : 'ring-default hover:bg-elevated'"
              @click="toggle(a.id)"
            >
              <AccountAvatar :account="a" size="xs" />
              {{ a.nickname }}
            </button>
          </div>
        </div>
      </UCard>

      <UCard v-if="issues.length" :ui="{ body: 'p-3 sm:p-4 space-y-2' }">
        <div v-for="i in issues" :key="i.platform.id" class="flex items-start gap-2 text-sm">
          <UIcon
            :name="i.errors.length ? 'i-lucide-circle-x' : 'i-lucide-circle-check'"
            :class="i.errors.length ? 'text-error' : 'text-success'"
            class="size-4 mt-0.5 shrink-0"
          />
          <span class="font-medium shrink-0">{{ i.platform.name }}</span>
          <span :class="i.errors.length ? 'text-error' : 'text-muted'">{{ i.errors.join('；') || '符合要求' }}</span>
        </div>
      </UCard>

      <AccountSettings
        v-for="a in selectedAccounts.filter((a) => post.settings[a.id])"
        :key="a.id"
        v-model="post.settings[a.id]"
        :use-last="useLast[a.id] !== false"
        :has-last="!!lastSettings[a.id]"
        :account="a"
        @update:use-last="setUseLast(a, $event)"
        @apply-last="applyLast(a)"
      />

      <UCard :ui="{ body: 'p-3 sm:p-4 space-y-3' }">
        <USwitch v-model="scheduled" label="定时发布" />
        <UInput v-if="scheduled" v-model="scheduledAt" type="datetime-local" class="w-full" />
        <UButton block size="lg" icon="i-lucide-send" :disabled="blocked" :loading="publishing" @click="publish">
          一键发布（{{ selected.length }} 个账号）
        </UButton>
      </UCard>
    </div>
  </div>
</template>
