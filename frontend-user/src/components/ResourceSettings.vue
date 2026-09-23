<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="settings-mask" @click.self="onClose">
        <div class="settings-dialog" role="dialog" aria-modal="true" aria-label="PDF.js 资源设置">
          <header class="settings-dialog__header">
            <div class="settings-dialog__titles">
              <h2 class="settings-dialog__title">资源设置</h2>
              <p class="settings-dialog__sub">
                部署位置自动识别为 <code>{{ state.basePath }}</code>，留空即按该位置自动取值
              </p>
            </div>
            <button class="settings-dialog__close" @click="onClose" title="关闭">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </header>

          <div class="settings-dialog__body">
            <div class="settings-tip">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <span>
                支持完整 URL（<code>https://…</code>）、站点根路径（<code>/pdfjs/…</code>）和相对部署目录的路径；
                保存后<strong>立即生效</strong>，已打开的文档不受影响。
              </span>
            </div>

            <div v-if="engineState.phase === 'error'" class="settings-engine-error">
              <div class="settings-engine-error__row">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <div class="settings-engine-error__body">
                  <p class="settings-engine-error__title">PDF.js 当前加载失败：{{ engineState.errorMsg }}</p>
                  <p class="settings-engine-error__url">生效地址：<code>{{ state.resources.scriptUrl.effective }}</code></p>
                </div>
              </div>
              <button class="settings-btn settings-btn--primary settings-engine-error__retry"
                      @click="retryLoadPdfjs">重试加载</button>
            </div>
            <div v-else-if="engineState.phase === 'loading'" class="settings-engine-info">
              <div class="settings-engine-info__spinner" />
              <span>正在按新地址加载 PDF.js…</span>
            </div>

            <div v-for="meta in resourceMeta" :key="meta.key" class="settings-item">
              <div class="settings-item__label-row">
                <label class="settings-item__label" :for="`cfg-${meta.key}`">{{ meta.label }}</label>
                <span class="status-tag" :class="`status-tag--${state.resources[meta.key].status}`">
                  {{ statusText[state.resources[meta.key].status] }}
                </span>
              </div>
              <input
                :id="`cfg-${meta.key}`"
                v-model="drafts[meta.key]"
                type="text"
                class="settings-item__input"
                :placeholder="`自动：${meta.defaultPath}`"
                spellcheck="false"
              />
              <div class="settings-item__meta">
                <span class="settings-item__hint">{{ meta.hint }}</span>
              </div>
              <div class="settings-item__effective">
                <span class="settings-item__effective-label">当前生效：</span>
                <code :class="{ 'settings-item__effective-code--pending': isPending(meta.key) }">
                  {{ state.resources[meta.key].effective }}
                </code>
                <span v-if="isPending(meta.key)" class="settings-item__pending">（待保存，尚未生效）</span>
              </div>
              <div
                v-if="state.resources[meta.key].status === 'fail'"
                class="settings-item__error"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span>取不到：{{ state.resources[meta.key].message }}</span>
              </div>
            </div>
          </div>

          <footer class="settings-dialog__footer">
            <button class="settings-btn settings-btn--ghost" @click="checkAll" :disabled="checking">
              {{ checking ? '检测中…' : '检测地址' }}
            </button>
            <button class="settings-btn settings-btn--ghost" @click="onReset">恢复默认</button>
            <div class="settings-dialog__spacer" />
            <button class="settings-btn settings-btn--primary settings-dialog__apply" @click="onApply" :disabled="!dirty">
              保存并生效
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue'
import { usePdfResourceConfig, type ResourceKey, type ResourceStatus } from '@/utils/pdf-config'
import { retryLoadPdfjs, engineState } from '@/utils/pdf-engine'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { state, overrides, effectiveUrls, resourceMeta, applyOverrides, resetOverrides, checkResource } =
  usePdfResourceConfig()

const drafts = reactive<Record<ResourceKey, string>>({
  scriptUrl: '',
  workerUrl: '',
  cMapUrl: '',
  standardFontDataUrl: '',
})

const checking = ref(false)

function syncDrafts() {
  const cur = overrides.value
  drafts.scriptUrl = cur.scriptUrl
  drafts.workerUrl = cur.workerUrl
  drafts.cMapUrl = cur.cMapUrl
  drafts.standardFontDataUrl = cur.standardFontDataUrl
}

watch(() => props.modelValue, (open) => {
  if (open) syncDrafts()
}, { immediate: true })

const dirty = computed(() => resourceMeta.some((m) =>
  drafts[m.key].trim() !== overrides.value[m.key].trim(),
))

/** 草稿与当前生效地址不同 —— 用于标注"设置已改但还没生效" */
function isPending(key: ResourceKey): boolean {
  return dirty.value && drafts[key].trim() !== overrides.value[key].trim()
}

function onClose() {
  emit('update:modelValue', false)
}

function onApply() {
  // 保存后 pdf-engine 的配置监听会立即响应：
  // 脚本地址变化（或引擎处于失败态）→ 重新注入；其余项 → 更新 worker/新文档地址
  applyOverrides({ ...drafts })
  syncDrafts()
}

function onReset() {
  resetOverrides()
  syncDrafts()
}

async function checkAll() {
  checking.value = true
  try {
    for (const meta of resourceMeta) {
      // 草稿未保存时先提示差异：检测的是"当前生效"地址
      await checkResource(meta.key)
    }
  } finally {
    checking.value = false
  }
}

const statusText: Record<ResourceStatus, string> = {
  unknown: '未检测',
  checking: '检测中',
  ok: '可访问',
  fail: '取不到',
}
</script>

<style lang="scss" scoped>
.settings-mask {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.settings-dialog {
  width: min(640px, 100%);
  max-height: min(86vh, 720px);
  display: flex; flex-direction: column;
  background: var(--card-bg); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg); overflow: hidden;
  &__header {
    display: flex; align-items: flex-start; justify-content: space-between;
    padding: 18px 20px 14px; border-bottom: 1px solid var(--border-color);
  }
  &__title { font-size: var(--font-size-xl); font-weight: 600; }
  &__sub {
    margin-top: 4px; font-size: var(--font-size-sm); color: var(--text-secondary);
    code {
      padding: 1px 6px; background: var(--bg-color); border-radius: 4px;
      color: var(--primary-active); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
  }
  &__close {
    display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; border: none; background: transparent;
    color: var(--text-tertiary); cursor: pointer; border-radius: var(--radius-sm);
    &:hover { background: var(--bg-color); color: var(--text-primary); }
  }
  &__body { flex: 1; overflow-y: auto; padding: 16px 20px; }
  &__footer {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 20px; border-top: 1px solid var(--border-color);
  }
  &__spacer { flex: 1; }
}

.settings-tip {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; margin-bottom: 16px;
  background: #e6f4ff; border: 1px solid #91caff; border-radius: var(--radius-sm);
  color: #0958d9; font-size: var(--font-size-sm); line-height: 1.6;
  svg { margin-top: 2px; flex-shrink: 0; }
  code {
    padding: 0 4px; background: rgba(255,255,255,0.7); border-radius: 3px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  strong { font-weight: 600; }
}

.settings-engine-error {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 12px; margin-bottom: 16px;
  background: #fff2f0; border: 1px solid #ffccc7; border-radius: var(--radius-sm);
  color: #cf1322;
  &__row { display: flex; align-items: flex-start; gap: 8px; flex: 1; }
  &__body { min-width: 0; }
  &__title { font-size: var(--font-size-sm); font-weight: 500; line-height: 1.5; }
  &__url {
    margin-top: 2px; font-size: var(--font-size-sm);
    code {
      padding: 0 4px; border-radius: 3px; background: rgba(255,255,255,0.7);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all;
    }
  }
  &__retry { flex-shrink: 0; }
}
.settings-engine-info {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; margin-bottom: 16px;
  background: #e6f4ff; border: 1px solid #91caff; border-radius: var(--radius-sm);
  color: #0958d9; font-size: var(--font-size-sm);
  &__spinner {
    width: 14px; height: 14px; border: 2px solid rgba(9,88,217,0.25);
    border-top-color: #0958d9; border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0;
  }
}
@keyframes spin { to { transform: rotate(360deg); } }

.settings-item {
  padding: 12px 0; border-bottom: 1px dashed var(--border-color);
  &:last-child { border-bottom: none; }
  &__label-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  &__label { font-size: var(--font-size-base); font-weight: 500; color: var(--text-primary); }
  &__input {
    width: 100%; height: 34px; padding: 0 10px;
    border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    font-size: var(--font-size-sm); color: var(--text-primary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    outline: none; transition: border-color 0.2s;
    &:focus { border-color: var(--primary-color); }
    &::placeholder { color: var(--text-tertiary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  }
  &__meta { display: flex; justify-content: space-between; margin-top: 4px; }
  &__hint { font-size: var(--font-size-sm); color: var(--text-tertiary); }
  &__effective {
    margin-top: 6px; font-size: var(--font-size-sm); color: var(--text-secondary);
    display: flex; align-items: center; flex-wrap: wrap; gap: 2px;
  }
  &__effective-label { color: var(--text-tertiary); }
  &__effective-code {
    padding: 1px 6px; background: var(--bg-color); border-radius: 4px;
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    word-break: break-all;
    &--pending { color: #d48806; background: #fffbe6; }
  }
  &__pending { color: #d48806; }
  &__error {
    display: flex; align-items: flex-start; gap: 6px;
    margin-top: 6px; padding: 6px 10px;
    background: #fff2f0; border: 1px solid #ffccc7; border-radius: var(--radius-sm);
    color: #cf1322; font-size: var(--font-size-sm); line-height: 1.5;
    svg { margin-top: 3px; flex-shrink: 0; }
  }
}

.status-tag {
  display: inline-flex; align-items: center;
  padding: 1px 8px; border-radius: 10px;
  font-size: var(--font-size-sm); line-height: 18px;
  &--unknown { background: var(--bg-color); color: var(--text-tertiary); }
  &--checking { background: #e6f4ff; color: #0958d9; }
  &--ok { background: #f6ffed; color: #389e0d; }
  &--fail { background: #fff2f0; color: #cf1322; }
}

.settings-btn {
  height: 32px; padding: 0 16px; border-radius: var(--radius-sm);
  font-size: var(--font-size-base); cursor: pointer; transition: all 0.2s;
  &--ghost {
    background: var(--card-bg); border: 1px solid var(--border-color); color: var(--text-secondary);
    &:hover:not(:disabled) { border-color: var(--primary-color); color: var(--primary-color); }
  }
  &--primary {
    background: var(--primary-color); border: 1px solid var(--primary-color); color: #fff;
    &:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); }
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
