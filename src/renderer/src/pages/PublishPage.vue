<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { commonLimits, platformLimits, resetOverride, setOverride } from '../../../shared/content'
import { CONTENT_FIELDS, contentFor, withLastSettings, type Account, type ContentField, type PlatformId, type Post, type PostContent, type SettingValues } from '../../../shared/types'
import { imageProblem, skippedText, splitImages } from '../../../shared/images'
import { validatePost } from '../../../shared/validate'
import AccountAvatar from '../components/AccountAvatar.vue'
import AccountSettings from '../components/AccountSettings.vue'
import ContentEditor from '../components/ContentEditor.vue'
import { errorText, plain, useAppState } from '../composables/useAppState'

const { platforms, platformMap, accounts } = useAppState()
const toast = useToast()
const router = useRouter()

const post = reactive<Post>({
  id: crypto.randomUUID(),
  title: '',
  content: '',
  images: [],
  topics: [],
  overrides: {},
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
  return withLastSettings(platformMap.value[a.platform].settings, useLast[a.id] !== false ? lastSettings.value[a.id] : undefined)
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

/** 选中账号所在的平台，按平台列表顺序 */
const selectedPlatforms = computed(() => platforms.value.filter((p) => selectedAccounts.value.some((a) => a.platform === p.id)))

/** 按每个平台实际要发的内容（单独设置优先）校验；超出限制的图片发布时跳过，不算进张数 */
const issues = computed(() =>
  selectedPlatforms.value.map((p) => {
    const content = contentFor(post, p.id)
    const { kept, skipped } = splitImages(content.images, p.limits)
    return { platform: p, errors: validatePost({ ...content, images: kept }, p.limits), warning: skippedText(skipped) }
  }),
)
const blocked = computed(() => !selected.value.length || issues.value.some((i) => i.errors.length) || (scheduled.value && !scheduledAt.value))

// 内容编辑：“通用”页是所有平台共用的稿子，平台页沿用通用内容，改了哪项哪项就只对这个平台生效
const tab = ref<'common' | PlatformId>('common')
watch(selectedPlatforms, (list) => {
  if (tab.value !== 'common' && !list.some((p) => p.id === tab.value)) tab.value = 'common'
})
const tabs = computed(() => [
  { label: '通用', value: 'common', icon: 'i-lucide-files' },
  ...issues.value.map(({ platform, errors, warning }) => ({
    label: platform.name,
    value: platform.id,
    badge: errors.length
      ? { label: String(errors.length), color: 'error' as const, variant: 'solid' as const }
      : warning
        ? { label: '!', color: 'warning' as const, variant: 'solid' as const }
        : post.overrides[platform.id]
        ? { label: '单独', color: 'primary' as const, variant: 'subtle' as const }
        : undefined,
  })),
])
const editing = computed<PostContent>(() => (tab.value === 'common' ? post : contentFor(post, tab.value)))
const editingLimits = computed(() =>
  tab.value === 'common' ? commonLimits(post, selectedPlatforms.value) : platformLimits(platformMap.value[tab.value].limits),
)
/** 当前标签页里超出限制的图片 -> 提示。通用页列出沿用通用图片、会跳过它的平台 */
const imageWarnings = computed(() => {
  const targets = tab.value === 'common' ? selectedPlatforms.value.filter((p) => !post.overrides[p.id]?.images) : [platformMap.value[tab.value]]
  const out: Record<string, string> = {}
  for (const img of editing.value.images) {
    const hits = targets.flatMap((p) => {
      const reason = imageProblem(img, p.limits)
      return reason ? [`${p.name}：${reason}`] : []
    })
    if (hits.length) out[img.path] = `超出平台限制，发布时跳过。${hits.join('；')}`
  }
  return out
})
const overridden = computed(() => {
  if (tab.value === 'common') return undefined
  const o = post.overrides[tab.value] ?? {}
  return Object.fromEntries(CONTENT_FIELDS.map((f) => [f, o[f] !== undefined])) as Record<ContentField, boolean>
})
function updateField(field: ContentField, value: PostContent[ContentField]) {
  if (tab.value === 'common') (post as PostContent)[field] = value as never
  else setOverride(post, tab.value, field, value)
}
function resetField(field: ContentField) {
  if (tab.value !== 'common') resetOverride(post, tab.value, field)
}

async function publish() {
  publishing.value = true
  try {
    const payload = plain({ ...post, updatedAt: Date.now() })
    // 只保留选中账号的配置和选中平台的单独设置
    payload.settings = Object.fromEntries(selected.value.map((id) => [id, payload.settings[id]]))
    payload.overrides = Object.fromEntries(selectedPlatforms.value.filter((p) => payload.overrides[p.id]).map((p) => [p.id, payload.overrides[p.id]]))
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
    <UCard :ui="{ header: 'p-0 sm:px-0', body: 'space-y-5' }">
      <template #header>
        <UTabs v-model="tab" :items="tabs" :content="false" variant="link" class="px-4" />
      </template>
      <p v-if="tab === 'common'" class="text-sm text-muted">
        所有平台共用这份内容。某个平台要不一样（字数、话题、图片），切到它的标签页修改，只对这个平台生效。
      </p>
      <p v-else class="text-sm text-muted">
        {{ platformMap[tab].name }}：没有单独设置的项沿用通用内容；在这里修改的项只发到{{ platformMap[tab].name }}。
      </p>
      <ContentEditor
        :value="editing"
        :limits="editingLimits"
        :overridden="overridden"
        :image-warnings="imageWarnings"
        @update="updateField"
        @reset="resetField"
      />
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
        <div
          v-for="i in issues"
          :key="i.platform.id"
          class="flex items-start gap-2 text-sm cursor-pointer rounded hover:bg-elevated -mx-1 px-1"
          @click="tab = i.platform.id"
        >
          <UIcon
            :name="i.errors.length ? 'i-lucide-circle-x' : i.warning ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check'"
            :class="i.errors.length ? 'text-error' : i.warning ? 'text-warning' : 'text-success'"
            class="size-4 mt-0.5 shrink-0"
          />
          <span class="font-medium shrink-0">{{ i.platform.name }}</span>
          <span class="space-y-0.5">
            <span v-if="i.errors.length" class="block text-error">{{ i.errors.join('；') }}</span>
            <span v-if="i.warning" class="block text-warning">{{ i.warning }}</span>
            <span v-if="!i.errors.length && !i.warning" class="block text-muted">符合要求</span>
          </span>
          <UBadge v-if="post.overrides[i.platform.id]" label="单独设置" size="sm" variant="subtle" class="ml-auto shrink-0" />
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
