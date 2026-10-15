import { computed, ref } from 'vue'
import type { MaterialPreview } from '../../../shared/api'
import { errorText } from './useAppState'

/** 页面与选图弹窗共用加载和搜索逻辑，各自保留独立状态。 */
export function useMaterials() {
  const materials = ref<MaterialPreview[]>([])
  const loading = ref(false)
  const error = ref('')
  const search = ref('')
  const filtered = computed(() => {
    const term = search.value.trim().toLowerCase()
    return materials.value.filter((m) => !term || m.name.toLowerCase().includes(term) || m.id.toLowerCase().includes(term))
  })

  async function refresh() {
    loading.value = true
    error.value = ''
    try {
      materials.value = await window.maxiaoer.materials.list()
    } catch (e) {
      error.value = errorText(e)
    } finally {
      loading.value = false
    }
  }

  return { materials, loading, error, search, filtered, refresh }
}
