<template>
  <Teleport to="body">
    <div class="settings-mask" @click.self="$emit('close')">
      <div class="settings-dialog" role="dialog" aria-modal="true" aria-label="阅读器部署设置">
        <header class="settings-dialog__header">
          <h2 class="settings-dialog__title">部署与资源设置</h2>
          <button class="settings-dialog__close" @click="$emit('close')" title="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div class="settings-dialog__body">
          <!-- 基础路径 -->
          <section class="settings-section">
            <h3 class="settings-section__title">资源基础路径</h3>
            <p class="settings-section__desc">
              PDF.js 脚本、Worker、字符集（CMap）与标准字体都从该路径下的
              <code>pdfjs/</code> 目录加载。默认按页面部署位置自动取值，无需手动填写。
            </p>

            <div class="settings-field">
              <label class="settings-field__label">自动检测到的部署位置</label>
              <div class="settings-field__readonly" :title="detectedBase">{{ detectedBase }}</div>
            </div>

            <div class="settings-field">
              <label class="settings-field__label" for="base-input">自定义基础路径（留空则使用自动检测值）</label>
              <div class="settings-input-row">
                <input
                  id="base-input"
                  v-model="draft"
                  class="settings-input"
                  :class="{ 'settings-input--error': draftError }"
                  type="text"
                  spellcheck="false"
                  placeholder="例如：/pdf-viewer/ 或 https://cdn.example.com/pdfjs-host/"
                  @keydown.enter.prevent="commitDraft"
                  @blur="commitDraft"
                />
                <button class="settings-btn" @click="resetToAuto" :disabled="!isOverridden">
                  重置为自动
                </button>
              </div>
              <p v-if="draftError" class="settings-field__error">{{ draftError }}</p>
            </div>

            <div class="settings-effective">
              <span class="settings-effective__label">当前生效：</span>
              <span
                class="settings-effective__tag"
                :class="isOverridden ? 'settings-effective__tag--custom' : 'settings-effective__tag--auto'"
              >{{ isOverridden ? '自定义' : '自动检测' }}</span>
              <span class="settings-effective__url" :title="effectiveBase">{{ effectiveBase }}</span>
              <span
                v-if="savedButNotEffective"
                class="settings-effective__warn"
                title="输入框中的值与实际生效值不一致"
              >⚠ 输入尚未生效（等待输入完成后自动应用）</span>
            </div>
          </section>

          <!-- PDF.js 运行状态 -->
          <section class="settings-section">
            <h3 class="settings-section__title">PDF.js 运行状态</h3>
            <div class="settings-status">
              <span class="status-dot" :class="`status-dot--${status}`" />
              <span class="settings-status__text">{{ statusText }}</span>
              <button v-if="status === 'error'" class="settings-btn settings-btn--primary" @click="retryPdfjs">
                重新加载
              </button>
            </div>
            <p v-if="status === 'loading'" class="settings-section__hint">
              正在请求脚本：<a :href="urls.script" target="_blank" rel="noopener">{{ urls.script }}</a>
              <span v-if="attempts > 1">（第 {{ attempts }} 次尝试）</span>
            </p>
            <p v-else-if="status === 'error'" class="settings-section__hint settings-section__hint--error">
              {{ bootError }}
            </p>
            <p v-else class="settings-section__hint settings-section__hint--ok">
              脚本加载成功；修改基础路径后已打开的文档不受影响，新打开的文档立即使用新地址。
            </p>
          </section>

          <!-- 资源地址与连通性 -->
          <section class="settings-section">
            <div class="settings-section__title-row">
              <h3 class="settings-section__title">资源地址与连通性</h3>
              <button class="settings-btn" :disabled="probing" @click="probeAll">
                {{ probing ? '检测中...' : '检测连接' }}
              </button>
            </div>
            <ul class="resource-list">
              <li v-for="r in resourceRows" :key="r.key" class="resource-item">
                <div class="resource-item__head">
                  <span class="resource-item__name">{{ r.label }}</span>
                  <span class="resource-item__result" :class="resultClass(probeResults[r.key])">
                    {{ resultText(probeResults[r.key]) }}
                  </span>
                </div>
                <div class="resource-item__url" :title="r.target">{{ r.target }}</div>
                <div v-if="probeError(probeResults[r.key])" class="resource-item__detail">
                  {{ probeError(probeResults[r.key]) }}
                </div>
              </li>
            </ul>
            <p class="settings-section__hint">
              连通性可帮助区分问题原因：状态为「无法访问（404）」说明设置已生效但地址与实际部署位置对不上；
              脚本状态为加载失败且地址仍旧，说明设置未生效或尚未保存。
            </p>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRuntimeConfig, type ProbeResult } from '@/utils/runtime-config'

defineEmits<{ (e: 'close'): void }>()

const {
  status, detectedBase, overrideInput, isOverridden, effectiveBase,
  bootError, attempts, urls,
  applyBaseOverride, resetBaseOverride, retryPdfjs, probeUrl,
} = useRuntimeConfig()

const draft = ref(overrideInput.value)
const draftError = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let lastApplied = overrideInput.value.trim()

const statusText = computed(() => {
  if (status.value === 'ready') return '已就绪'
  if (status.value === 'loading') return '加载中'
  return '加载失败'
})

/** 输入框中的值与生效值不同（且不是正在加载）时提示「尚未生效」 */
const savedButNotEffective = computed(() => {
  const d = draft.value.trim()
  if (!d) return false
  if (draftError.value) return false
  if (status.value === 'loading') return false
  return d !== lastApplied
})

function commitDraft() {
  const value = draft.value.trim()
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
  if (value === lastApplied) { draftError.value = ''; return }
  try {
    applyBaseOverride(value)
    lastApplied = value
    draftError.value = ''
  } catch (e) {
    draftError.value = e instanceof Error ? e.message : String(e)
  }
}

function onDraftChange() {
  draftError.value = ''
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(commitDraft, 450)
}

watch(draft, onDraftChange)

function resetToAuto() {
  resetBaseOverride()
  draft.value = ''
  lastApplied = ''
  draftError.value = ''
}

/* 外部状态变化（如重试后成功）时同步输入框 */
watch(overrideInput, (v) => {
  if (!draft.value.trim()) draft.value = v
  lastApplied = v.trim()
})

/* ---- 资源连通性探测 ---- */

/* 目录类资源探测目录内的代表性文件，避免对目录本身的请求行为在不同服务器上不一致 */
const PROBE_FILES: Record<string, string> = {
  cmap: '78-EUC-H.bcmap',
  font: 'FoxitFixed.pfb',
}

const resourceRows = computed(() => {
  const u = urls.value
  return [
    { key: 'script', label: 'PDF.js 脚本', target: u.script },
    { key: 'worker', label: 'PDF.js Worker', target: u.worker },
    { key: 'cmap', label: '字符集 CMap 目录', target: u.cmap + PROBE_FILES.cmap },
    { key: 'font', label: '标准字体目录', target: u.font + PROBE_FILES.font },
  ]
})

const probeResults = reactive<Record<string, ProbeResult | null>>({
  script: null,
  worker: null,
  cmap: null,
  font: null,
})
const probing = ref(false)

async function probeAll() {
  probing.value = true
  await Promise.all(resourceRows.value.map(async (r) => {
    probeResults[r.key] = await probeUrl(r.target)
  }))
  probing.value = false
}

function resultText(r: ProbeResult | null): string {
  if (!r) return '未检测'
  if (r.type === 'timeout') return '请求超时'
  if (r.type === 'opaque') return '可访问（跨域不可读）'
  if (r.ok) return '可访问'
  if (r.status > 0) return `无法访问（HTTP ${r.status}）`
  return '无法访问（网络错误）'
}

function resultClass(r: ProbeResult | null): string {
  if (!r) return 'resource-item__result--idle'
  if (r.ok || r.type === 'opaque') return 'resource-item__result--ok'
  return 'resource-item__result--fail'
}

function probeError(r: ProbeResult | null): string {
  if (!r || r.ok || r.type === 'opaque') return ''
  return r.message || (r.status > 0 ? `服务器返回 ${r.status}，请检查该地址是否与部署位置一致` : '')
}

/* 生效地址变化后：清空旧结果并自动重新探测，立刻反映“是否生效/地址是否对得上” */
watch(
  () => resourceRows.value.map((r) => r.target).join('|'),
  (newSig, oldSig) => {
    for (const k of Object.keys(probeResults)) probeResults[k] = null
    /* 首次挂载由 onMounted 处理，避免重复探测 */
    if (oldSig && newSig !== oldSig) probeAll()
  },
)

onMounted(() => { probeAll() })
onUnmounted(() => { if (debounceTimer) clearTimeout(debounceTimer) })
</script>

<style lang="scss" scoped>
.settings-mask {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.settings-dialog {
  width: 640px; max-width: 100%; max-height: 86vh;
  display: flex; flex-direction: column;
  background: var(--card-bg, #fff);
  border-radius: 8px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  &__header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; border-bottom: 1px solid var(--border-color, #e5e7eb);
  }
  &__title { margin: 0; font-size: 16px; font-weight: 600; }
  &__close {
    display: flex; border: none; background: transparent; cursor: pointer;
    color: var(--text-tertiary, #999); padding: 4px; border-radius: 4px;
    &:hover { background: var(--bg-color, #f5f5f5); color: inherit; }
  }
  &__body { padding: 8px 20px 20px; overflow-y: auto; }
}

.settings-section {
  padding: 16px 0; border-bottom: 1px solid var(--border-color, #f0f0f0);
  &:last-child { border-bottom: none; }
  &__title { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
  &__title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
    .settings-section__title { margin: 0; }
  }
  &__desc { margin: 0 0 12px; font-size: 13px; color: var(--text-secondary, #666); line-height: 1.6;
    code {
      background: var(--bg-color, #f5f5f5); padding: 1px 6px; border-radius: 3px;
      font-size: 12px;
    }
  }
  &__hint {
    margin: 8px 0 0; font-size: 12px; color: var(--text-tertiary, #999);
    line-height: 1.6; word-break: break-all;
    a { color: var(--primary-color, #1677ff); }
    &--error { color: #cf1322; }
    &--ok { color: #389e0d; }
  }
}

.settings-field {
  margin-bottom: 12px;
  &__label { display: block; font-size: 13px; color: var(--text-secondary, #666); margin-bottom: 6px; }
  &__readonly {
    padding: 7px 10px; font-size: 13px; background: var(--bg-color, #f5f5f5);
    border: 1px solid var(--border-color, #e5e7eb); border-radius: 4px;
    color: var(--text-primary, #333); word-break: break-all;
  }
  &__error { margin: 6px 0 0; font-size: 12px; color: #cf1322; }
}

.settings-input-row { display: flex; gap: 8px; }
.settings-input {
  flex: 1; min-width: 0; padding: 7px 10px; font-size: 13px;
  border: 1px solid var(--border-color, #d9d9d9); border-radius: 4px;
  background: var(--card-bg, #fff); color: inherit;
  &:focus { outline: none; border-color: var(--primary-color, #1677ff); }
  &--error { border-color: #ff4d4f; }
}

.settings-btn {
  padding: 6px 14px; font-size: 13px; white-space: nowrap;
  border: 1px solid var(--border-color, #d9d9d9); border-radius: 4px;
  background: var(--card-bg, #fff); color: inherit; cursor: pointer;
  transition: all 0.2s;
  &:hover:not(:disabled) { border-color: var(--primary-color, #1677ff); color: var(--primary-color, #1677ff); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &--primary { background: var(--primary-color, #1677ff); border-color: var(--primary-color, #1677ff); color: #fff;
    &:hover:not(:disabled) { opacity: 0.85; color: #fff; }
  }
}

.settings-effective {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 12px;
  &__label { color: var(--text-secondary, #666); }
  &__tag {
    padding: 1px 8px; border-radius: 10px; font-size: 12px;
    &--auto { background: #f6ffed; color: #389e0d; border: 1px solid #b7eb8f; }
    &--custom { background: #fff7e6; color: #d46b08; border: 1px solid #ffd591; }
  }
  &__url { color: var(--text-secondary, #666); word-break: break-all; }
  &__warn { color: #d46b08; }
}

.settings-status { display: flex; align-items: center; gap: 10px; }
.status-dot {
  width: 10px; height: 10px; border-radius: 50%;
  &--ready { background: #52c41a; }
  &--loading { background: #faad14; animation: status-pulse 1s ease-in-out infinite; }
  &--error { background: #ff4d4f; }
}
@keyframes status-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.settings-status__text { font-size: 13px; font-weight: 500; }

.resource-list { list-style: none; margin: 0; padding: 0; }
.resource-item {
  padding: 8px 10px; border: 1px solid var(--border-color, #f0f0f0);
  border-radius: 4px; margin-bottom: 6px;
  &__head { display: flex; align-items: center; justify-content: space-between; }
  &__name { font-size: 13px; font-weight: 500; }
  &__url { font-size: 12px; color: var(--text-tertiary, #999); word-break: break-all; margin-top: 2px; }
  &__detail { font-size: 12px; color: #cf1322; margin-top: 2px; }
  &__result {
    font-size: 12px; padding: 1px 8px; border-radius: 10px;
    &--idle { color: var(--text-tertiary, #999); }
    &--ok { color: #389e0d; background: #f6ffed; }
    &--fail { color: #cf1322; background: #fff2f0; }
  }
}
</style>
