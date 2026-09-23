<template>
  <div class="pdf-viewer">
    <header class="toolbar">
      <div class="toolbar__left">
        <button
          v-for="s in sampleFiles" :key="s.name"
          class="toolbar__sample-btn"
          :class="{ 'toolbar__sample-btn--active': fileName === s.name }"
          :disabled="loading || engineError"
          @click="loadSample(s.name)"
        >{{ s.label }}</button>
        <div class="toolbar__divider" v-if="totalPages > 0" />
        <span class="toolbar__info" v-if="totalPages > 0">第 {{ currentVisiblePage }} / {{ totalPages }} 页</span>
      </div>
      <div class="toolbar__center">
        <div class="toolbar__search">
          <svg class="toolbar__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref="searchInputRef"
            v-model="searchKeyword"
            type="text"
            class="toolbar__search-input"
            placeholder="搜索关键词..."
            :disabled="!pdfDoc || searching"
            @keyup.enter="startSearch"
          />
          <button
            v-if="searchKeyword"
            class="toolbar__search-clear"
            :disabled="searching"
            @click="clearSearch"
            title="清除搜索"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <button
            class="toolbar__btn toolbar__search-btn"
            :disabled="!pdfDoc || !searchKeyword.trim() || searching"
            @click="startSearch"
            title="搜索"
          >
            <svg v-if="!searching" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <div v-else class="toolbar__search-spinner"/>
          </button>
        </div>
        <span v-if="searchResult.totalMatches > 0" class="toolbar__search-count">
          {{ currentMatchIndex + 1 }} / {{ searchResult.totalMatches }}
        </span>
        <button
          v-if="searchResult.totalMatches > 0"
          class="toolbar__btn"
          :disabled="currentMatchIndex <= 0"
          @click="prevMatch"
          title="上一个匹配"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
        </button>
        <button
          v-if="searchResult.totalMatches > 0"
          class="toolbar__btn"
          :disabled="currentMatchIndex >= searchResult.totalMatches - 1"
          @click="nextMatch"
          title="下一个匹配"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div class="toolbar__divider" />
        <button class="toolbar__btn" :disabled="scale <= 0.25" @click="zoomOut" title="缩小">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <span class="toolbar__zoom-value">{{ Math.round(scale * 100) }}%</span>
        <button class="toolbar__btn" :disabled="scale >= 5" @click="zoomIn" title="放大">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <button class="toolbar__btn" @click="fitWidth" title="适合宽度">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
        </button>
      </div>
      <div class="toolbar__right">
        <span class="toolbar__hint" v-if="totalPages > 0">可直接选中文字复制</span>
        <button
          class="toolbar__btn toolbar__settings-btn"
          @click="showSettings = true"
          title="资源设置（脚本 / Worker / 字符集 / 字体地址）"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span v-if="resourceHasIssue" class="toolbar__settings-dot" />
        </button>
      </div>
    </header>

    <main class="pdf-main">
      <aside class="search-panel" v-if="showSearchPanel && searchResult.totalMatches > 0">
        <div class="search-panel__header">
          <span class="search-panel__title">搜索结果</span>
          <span class="search-panel__count">共 {{ searchResult.totalMatches }} 处</span>
          <button class="search-panel__close" @click="showSearchPanel = false" title="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="search-panel__content">
          <div v-for="pageResult in searchResult.pages" :key="pageResult.pageNumber" class="search-panel__page-group">
            <div class="search-panel__page-header" @click="togglePageGroup(pageResult.pageNumber)">
              <svg class="search-panel__expand-icon" :class="{ 'search-panel__expand-icon--expanded': expandedPages.has(pageResult.pageNumber) }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
              <span class="search-panel__page-title">第 {{ pageResult.pageNumber }} 页</span>
              <span class="search-panel__page-count">{{ pageResult.matches.length }} 处</span>
            </div>
            <div v-show="expandedPages.has(pageResult.pageNumber)" class="search-panel__matches">
              <div
                v-for="(match, idx) in pageResult.matches"
                :key="idx"
                class="search-panel__match"
                :class="{ 'search-panel__match--active': isCurrentMatch(match) }"
                @click="jumpToMatch(match)"
              >
                <span class="search-panel__match-text" v-html="highlightMatchText(match, pageResult.pageText)"></span>
              </div>
            </div>
          </div>
        </div>
      </aside>
      <div class="pdf-container" ref="containerRef" @scroll="onScroll">
        <div class="pdf-boot" v-if="engineLoading && !pdfDoc">
          <div class="pdf-boot__spinner"/>
          <p class="pdf-boot__text">正在加载 PDF.js 脚本…</p>
          <p class="pdf-boot__sub">{{ engineState.scriptUrl }}</p>
        </div>
        <div class="pdf-boot" v-else-if="engineError && !pdfDoc">
          <div class="pdf-boot__card">
            <svg class="pdf-boot__icon" viewBox="0 0 24 24" fill="none" stroke="#ff4d4f" stroke-width="2" width="40" height="40">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p class="pdf-boot__title">PDF.js 脚本加载失败</p>
            <p class="pdf-boot__msg">{{ engineState.errorMsg }}</p>
            <p class="pdf-boot__url">请求地址：<code>{{ engineState.scriptUrl }}</code></p>
            <p class="pdf-boot__hint">
              部署到子目录时地址需随部署位置变化。可在「资源设置」中检查并覆盖脚本地址，
              地址旁的状态标记可区分"设置尚未生效"与"地址本身取不到"。
            </p>
            <div class="pdf-boot__actions">
              <button class="pdf-boot__btn pdf-boot__btn--primary" @click="retryEngine">重试加载</button>
              <button class="pdf-boot__btn" @click="showSettings = true">打开资源设置</button>
            </div>
          </div>
        </div>
        <template v-else>
        <div class="pdf-empty" v-if="!pdfDoc && !loading">
          <label class="pdf-empty__card pdf-empty__card--clickable">
            <svg class="pdf-empty__icon" viewBox="0 0 64 64" fill="none">
              <rect x="12" y="4" width="40" height="56" rx="4" stroke="#d9d9d9" stroke-width="2"/>
              <path d="M28 4V20H12" stroke="#d9d9d9" stroke-width="2"/>
              <text x="32" y="44" text-anchor="middle" fill="#bfbfbf" font-size="12" font-family="Arial">PDF</text>
            </svg>
            <p class="pdf-empty__text">点击上传 PDF 文件</p>
            <p class="pdf-empty__sub">点击上方示例按钮，或拖拽本地 PDF 文件到此处</p>
            <input type="file" accept=".pdf" class="pdf-empty__input" @change="onFileChange" />
          </label>
        </div>
        <div class="pdf-loading" v-if="loading">
          <div class="pdf-loading__spinner"/>
          <p class="pdf-loading__text">正在解析 PDF 文档...</p>
        </div>
        <div class="pdf-searching" v-if="searching">
          <div class="pdf-searching__spinner"/>
          <p class="pdf-searching__text">正在搜索：{{ searchKeyword }}</p>
          <p class="pdf-searching__progress">{{ searchProgress.current }} / {{ searchProgress.total }} 页</p>
        </div>
        <div class="pdf-error" v-if="errorMsg">
          <div class="pdf-error__card">
            <p class="pdf-error__text">{{ errorMsg }}</p>
            <button class="pdf-error__btn" @click="errorMsg = ''">关闭</button>
          </div>
        </div>
        <div class="pdf-pages" v-show="pdfDoc && !loading">
          <div v-for="pageNum in totalPages" :key="pageNum" class="pdf-page-wrapper"
            :data-page="pageNum" :ref="(el) => setPageRef(el as HTMLElement, pageNum)">
            <div class="pdf-page" :style="getPageStyle(pageNum)">
              <canvas :ref="(el) => setCanvasRef(el as HTMLCanvasElement, pageNum)"/>
              <div class="pdf-page__text-layer textLayer"
                :ref="(el) => setTextLayerRef(el as HTMLDivElement, pageNum)"/>
              <div class="pdf-page__annotation-layer annotationLayer"
                :ref="(el) => setAnnotationLayerRef(el as HTMLDivElement, pageNum)"/>
              <div class="pdf-page__highlight-layer"
                :ref="(el) => setHighlightLayerRef(el as HTMLDivElement, pageNum)"/>
            </div>
            <div class="pdf-page__number">{{ pageNum }}</div>
          </div>
        </div>
        </template>
      </div>
    </main>
    <ResourceSettings v-model="showSettings" />
    <Transition name="toast">
      <div class="toast" v-if="toastMsg" :class="`toast--${toastType}`">{{ toastMsg }}</div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import {
  loadPdfDocument, renderPageToCanvas, buildTextLayer,
  buildAnnotationLayer, preloadPdfjs, getPageBaseDimensions,
  searchDocument, buildHighlightLayer, clearHighlightLayer,
  retryLoadPdfjs, engineState,
  type PdfjsDocument, type PdfjsPage, type PdfjsViewport,
  type SearchResult, type SearchMatch, type PageSearchResult,
} from '@/utils/pdf-engine'
import { usePdfResourceConfig, resolvePath } from '@/utils/pdf-config'
import ResourceSettings from '@/components/ResourceSettings.vue'

const { state: resourceState } = usePdfResourceConfig()

const sampleFiles = [
  { name: 'sample.pdf', label: '示例一：学术论文' },
  { name: 'test.pdf', label: '示例二：200页压测' },
  { name: 'document.pdf', label: '示例三：图文混排' },
]

/* ---- 响应式状态 ---- */
const pdfDoc = ref<PdfjsDocument | null>(null)
const totalPages = ref(0)
const scale = ref(1.5)
const loading = ref(false)
const errorMsg = ref('')
const fileName = ref('')
const currentVisiblePage = ref(1)
const toastMsg = ref('')
const toastType = ref<'success' | 'error' | 'info'>('info')
const showSettings = ref(false)

/* ---- PDF.js 引擎启动状态（脚本加载失败时给说明与重试，而不是一直转圈） ---- */
const engineLoading = computed(() => engineState.phase === 'loading' || engineState.phase === 'idle')
const engineError = computed(() => engineState.phase === 'error')
function retryEngine() {
  retryLoadPdfjs()
}
/** 任一资源探活失败或脚本处于错误态 —— 工具栏设置按钮给出红点提示 */
const resourceHasIssue = computed(() => {
  if (engineState.phase === 'error') return true
  return Object.values(resourceState.resources).some((r) => r.status === 'fail')
})

// 引擎状态变化时给出即时反馈（设置保存后立刻能看出是否生效）
watch(() => engineState.phase, (phase, old) => {
  if (phase === 'ready' && (old === 'loading' || old === 'error' || old === 'idle')) {
    showToast('PDF.js 已就绪，新地址已生效', 'success')
  } else if (phase === 'error') {
    showToast('PDF.js 脚本加载失败，请检查资源设置', 'error')
  }
})

const containerRef = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)

/* ---- 搜索相关状态 ---- */
const searchKeyword = ref('')
const searching = ref(false)
const searchCancelled = ref(false)
const searchProgress = reactive({ current: 0, total: 0 })
const searchResult = reactive<SearchResult>({
  keyword: '',
  totalMatches: 0,
  totalPages: 0,
  pages: [],
})
const currentMatchIndex = ref(-1)
const showSearchPanel = ref(false)
const expandedPages = reactive(new Set<number>())
const allMatches = computed<SearchMatch[]>(() => {
  return searchResult.pages.flatMap((p) => p.matches)
})

/**
 * 每页的基础尺寸（scale=1 时的宽高），用于精确计算不同尺寸页面的布局。
 * 使用 reactive(Map) 确保 set/delete 操作触发视图更新。
 */
const pageBaseDims = reactive(new Map<number, { baseWidth: number; baseHeight: number }>())

/**
 * 每页在当前 scale 下的实际像素尺寸（响应式）。
 * getPageStyle() 依赖此 Map 驱动 template 中 .pdf-page 的宽高。
 */
const pageDimensions = reactive(new Map<number, { width: number; height: number }>())

/* ---- 非响应式内部状态（不驱动 template，无需 reactive） ---- */
const canvasRefs = new Map<number, HTMLCanvasElement>()
const textLayerRefs = new Map<number, HTMLDivElement>()
const annotationLayerRefs = new Map<number, HTMLDivElement>()
const highlightLayerRefs = new Map<number, HTMLDivElement>()
const pageWrapperRefs = new Map<number, HTMLElement>()
const renderedPages = new Set<string>()
const renderedPageOrder: number[] = []
const MAX_RENDERED = 15
let toastTimer: ReturnType<typeof setTimeout> | null = null
let renderVersion = 0
let scrollRafId: number | null = null
let highlightVersion = 0

/* ---- Ref 绑定 ---- */
function setCanvasRef(el: HTMLCanvasElement | null, n: number) { if (el) canvasRefs.set(n, el) }
function setTextLayerRef(el: HTMLDivElement | null, n: number) { if (el) textLayerRefs.set(n, el) }
function setAnnotationLayerRef(el: HTMLDivElement | null, n: number) { if (el) annotationLayerRefs.set(n, el) }
function setHighlightLayerRef(el: HTMLDivElement | null, n: number) { if (el) highlightLayerRefs.set(n, el) }
function setPageRef(el: HTMLElement | null, n: number) { if (el) pageWrapperRefs.set(n, el) }

/* ---- Toast ---- */
function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  toastMsg.value = msg; toastType.value = type
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMsg.value = '' }, 3000)
}

/* ---- 搜索功能 ---- */
async function startSearch() {
  const keyword = searchKeyword.value.trim()
  if (!keyword || !pdfDoc.value) return

  searching.value = true
  searchCancelled.value = false
  searchProgress.current = 0
  searchProgress.total = pdfDoc.value.numPages
  currentMatchIndex.value = -1

  Object.assign(searchResult, {
    keyword,
    totalMatches: 0,
    totalPages: pdfDoc.value.numPages,
    pages: [],
  })

  clearAllHighlights()

  try {
    const result = await searchDocument(
      pdfDoc.value,
      keyword,
      false,
      (page, total) => {
        searchProgress.current = page
        searchProgress.total = total
      },
      () => searchCancelled.value,
    )

    if (!searchCancelled.value) {
      Object.assign(searchResult, result)
      expandedPages.clear()
      result.pages.forEach((p) => expandedPages.add(p.pageNumber))

      if (result.totalMatches > 0) {
        showSearchPanel.value = true
        currentMatchIndex.value = -1
        showToast(`找到 ${result.totalMatches} 处匹配`, 'success')
        refreshHighlights()
      } else {
        showToast('未找到匹配内容', 'info')
      }
    }
  } catch (e) {
    console.error('搜索失败:', e)
    showToast('搜索失败', 'error')
  } finally {
    searching.value = false
  }
}

function clearSearch() {
  searchCancelled.value = true
  searching.value = false
  searchKeyword.value = ''
  currentMatchIndex.value = -1
  showSearchPanel.value = false
  Object.assign(searchResult, {
    keyword: '',
    totalMatches: 0,
    totalPages: 0,
    pages: [],
  })
  expandedPages.clear()
  clearAllHighlights()
}

function clearAllHighlights() {
  highlightVersion++
  for (const container of highlightLayerRefs.values()) {
    clearHighlightLayer(container)
  }
}

function refreshHighlights() {
  const ver = ++highlightVersion
  const matchesByPage = new Map<number, SearchMatch[]>()
  for (const match of allMatches.value) {
    if (!matchesByPage.has(match.pageNumber)) {
      matchesByPage.set(match.pageNumber, [])
    }
    matchesByPage.get(match.pageNumber)!.push(match)
  }

  for (const [pageNum, matches] of matchesByPage) {
    const container = highlightLayerRefs.get(pageNum)
    if (!container) continue

    const base = pageBaseDims.get(pageNum)
    if (!base) continue

    const viewport = {
      width: base.baseWidth * scale.value,
      height: base.baseHeight * scale.value,
      scale: scale.value,
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      clone: () => ({ /* 简化的 clone，实际高亮层不需要完整 viewport */ }),
    } as unknown as PdfjsViewport

    let pageCurrentIdx: number | undefined
    if (currentMatchIndex.value >= 0 && currentMatchIndex.value < allMatches.value.length) {
      const currentMatch = allMatches.value[currentMatchIndex.value]
      if (currentMatch && currentMatch.pageNumber === pageNum) {
        pageCurrentIdx = currentMatch.matchIndex
      }
    }

    buildHighlightLayer(container, matches, viewport, pageCurrentIdx)
  }
}

function getCurrentMatch(): SearchMatch | null {
  if (currentMatchIndex.value < 0 || currentMatchIndex.value >= allMatches.value.length) {
    return null
  }
  return allMatches.value[currentMatchIndex.value] || null
}

function isCurrentMatch(match: SearchMatch): boolean {
  const current = getCurrentMatch()
  return current !== null &&
    current.pageNumber === match.pageNumber &&
    current.matchIndex === match.matchIndex
}

function nextMatch() {
  if (allMatches.value.length === 0) return
  currentMatchIndex.value = Math.min(
    currentMatchIndex.value + 1,
    allMatches.value.length - 1,
  )
  const match = getCurrentMatch()
  if (match) {
    jumpToMatch(match)
    refreshHighlights()
  }
}

function prevMatch() {
  if (allMatches.value.length === 0) return
  currentMatchIndex.value = Math.max(currentMatchIndex.value - 1, 0)
  const match = getCurrentMatch()
  if (match) {
    jumpToMatch(match)
    refreshHighlights()
  }
}

function jumpToMatch(match: SearchMatch) {
  const idx = allMatches.value.findIndex(
    (m) => m.pageNumber === match.pageNumber && m.matchIndex === match.matchIndex,
  )
  if (idx !== -1) {
    currentMatchIndex.value = idx
  }

  const wrapper = pageWrapperRefs.get(match.pageNumber)
  if (!wrapper || !containerRef.value) return

  const containerTop = containerRef.value.scrollTop
  const containerHeight = containerRef.value.clientHeight
  const wrapperTop = wrapper.offsetTop
  const wrapperHeight = wrapper.offsetHeight

  const matchTop = match.transform[5] * scale.value
  const targetTop = wrapperTop + matchTop - containerHeight / 2

  containerRef.value.scrollTo({
    top: targetTop,
    behavior: 'smooth',
  })

  refreshHighlights()
}

function togglePageGroup(pageNumber: number) {
  if (expandedPages.has(pageNumber)) {
    expandedPages.delete(pageNumber)
  } else {
    expandedPages.add(pageNumber)
  }
}

function highlightMatchText(match: SearchMatch, pageText: string): string {
  const contextLength = 30
  const start = Math.max(0, match.startOffset - contextLength)
  const end = Math.min(pageText.length, match.endOffset + contextLength)

  const before = start > 0 ? '...' : ''
  const after = end < pageText.length ? '...' : ''
  const prefix = pageText.substring(start, match.startOffset)
  const matched = pageText.substring(match.startOffset, match.endOffset)
  const suffix = pageText.substring(match.endOffset, end)

  const escapeHtml = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return `${before}${escapeHtml(prefix)}<mark class="search-panel__match-mark">${escapeHtml(matched)}</mark>${escapeHtml(suffix)}${after}`
}

/* ---- 缩放 ---- */
function zoomIn() { if (scale.value < 5) scale.value = Math.min(5, +(scale.value + 0.25).toFixed(2)) }
function zoomOut() { if (scale.value > 0.25) scale.value = Math.max(0.25, +(scale.value - 0.25).toFixed(2)) }
function fitWidth() {
  if (!containerRef.value || !pdfDoc.value) return
  const containerWidth = containerRef.value.clientWidth - 64
  // 使用第一页的基础宽度（scale=1）计算适合宽度的缩放比
  const base = pageBaseDims.get(1)
  if (!base) return
  scale.value = +(containerWidth / base.baseWidth).toFixed(2)
}

/* ---- 页面尺寸 ---- */
function getPageStyle(n: number) {
  const d = pageDimensions.get(n)
  return d ? { width: `${d.width}px`, height: `${d.height}px` } : {}
}

/** 根据 pageBaseDims 和当前 scale 重新计算所有页面的像素尺寸 */
function recomputeScaledDimensions() {
  const s = scale.value
  for (const [n, base] of pageBaseDims) {
    pageDimensions.set(n, {
      width: base.baseWidth * s,
      height: base.baseHeight * s,
    })
  }
}

/**
 * 预计算所有页面的基础尺寸（scale=1）。
 * 逐页获取 viewport，正确处理混合页面大小（纵向/横向/不同尺寸）。
 */
async function precomputePageDimensions() {
  const doc = pdfDoc.value
  if (!doc) return
  const baseDims = await getPageBaseDimensions(doc)
  pageBaseDims.clear()
  for (const [n, dim] of baseDims) {
    pageBaseDims.set(n, dim)
  }
  recomputeScaledDimensions()
}

/* ---- 页面回收（LRU） ---- */
function recyclePage(n: number) {
  const key = `${n}-${scale.value}`
  if (!renderedPages.has(key)) return
  const c = canvasRefs.get(n)
  if (c) { c.width = 0; c.height = 0 }
  const t = textLayerRefs.get(n)
  if (t) t.innerHTML = ''
  const a = annotationLayerRefs.get(n)
  if (a) a.innerHTML = ''
  const h = highlightLayerRefs.get(n)
  if (h) h.innerHTML = ''
  renderedPages.delete(key)
  const idx = renderedPageOrder.indexOf(n)
  if (idx !== -1) renderedPageOrder.splice(idx, 1)
}

function evictExcess(visible: number[]) {
  const vs = new Set(visible)
  while (renderedPageOrder.length > MAX_RENDERED) {
    const c = renderedPageOrder.find(p => !vs.has(p))
    if (c === undefined) break
    recyclePage(c)
  }
}

/* ---- 渲染队列 ---- */
let renderQueue: number[] = []
let isRendering = false

async function renderPage(n: number, ver: number) {
  const key = `${n}-${scale.value}`
  if (renderedPages.has(key) || ver !== renderVersion) return
  const doc = pdfDoc.value
  if (!doc) return

  const page: PdfjsPage = await doc.getPage(n)
  if (ver !== renderVersion) return

  const canvas = canvasRefs.get(n)
  const textDiv = textLayerRefs.get(n)
  const annoDiv = annotationLayerRefs.get(n)
  if (!canvas || !textDiv) return

  const { viewport } = await renderPageToCanvas(page, canvas, scale.value)
  if (ver !== renderVersion) return

  // 渲染后用实际 viewport 修正尺寸（响应式更新 template）
  pageDimensions.set(n, { width: viewport.width, height: viewport.height })

  await buildTextLayer(page, textDiv, viewport)
  if (ver !== renderVersion) return

  if (annoDiv) await buildAnnotationLayer(page, annoDiv, viewport)

  renderedPages.add(key)
  const idx = renderedPageOrder.indexOf(n)
  if (idx !== -1) renderedPageOrder.splice(idx, 1)
  renderedPageOrder.push(n)
}

async function processQueue() {
  if (isRendering) return
  isRendering = true
  const ver = renderVersion
  while (renderQueue.length > 0) {
    if (ver !== renderVersion) break
    const n = renderQueue.shift()!
    try { await renderPage(n, ver) } catch (e) { console.error(`渲染第${n}页失败:`, e) }
  }
  isRendering = false
}

/* ---- 可见页面检测 ---- */
function getVisiblePages(): number[] {
  const c = containerRef.value
  if (!c) return []
  const st = c.scrollTop, sb = st + c.clientHeight, buf = c.clientHeight
  const vis: number[] = []
  for (const [n, w] of pageWrapperRefs) {
    const top = w.offsetTop, bot = top + w.offsetHeight
    if (bot >= st - buf && top <= sb + buf) vis.push(n)
  }
  return vis.sort((a, b) => a - b)
}

function scheduleRender() {
  const visible = getVisiblePages()
  const c = containerRef.value
  if (c) {
    const center = c.scrollTop + c.clientHeight / 2
    visible.sort((a, b) => {
      const wa = pageWrapperRefs.get(a), wb = pageWrapperRefs.get(b)
      if (!wa || !wb) return 0
      return Math.abs(wa.offsetTop + wa.offsetHeight / 2 - center) -
             Math.abs(wb.offsetTop + wb.offsetHeight / 2 - center)
    })
  }
  renderQueue = visible.filter(p => !renderedPages.has(`${p}-${scale.value}`))
  evictExcess(visible)
  if (renderQueue.length > 0) processQueue()
  updateCurrentPage()
}

function updateCurrentPage() {
  const c = containerRef.value
  if (!c) return
  const center = c.scrollTop + c.clientHeight / 2
  let closest = 1, minD = Infinity
  for (const [n, w] of pageWrapperRefs) {
    const d = Math.abs(w.offsetTop + w.offsetHeight / 2 - center)
    if (d < minD) { minD = d; closest = n }
  }
  currentVisiblePage.value = closest
}

function onScroll() {
  if (scrollRafId) return
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null
    updateCurrentPage()
    scheduleRender()
  })
}

/* ---- 缩放 watcher ---- */
watch(scale, async () => {
  if (!pdfDoc.value) return
  renderVersion++; renderQueue = []
  renderedPages.clear(); renderedPageOrder.length = 0
  recomputeScaledDimensions()
  await nextTick()
  scheduleRender()
  if (searchResult.totalMatches > 0) {
    refreshHighlights()
  }
})

/* ---- 加载 PDF ---- */
async function loadPdf(url: string) {
  loading.value = true; errorMsg.value = ''
  renderVersion++; renderQueue = []
  renderedPages.clear(); renderedPageOrder.length = 0
  pageDimensions.clear(); pageBaseDims.clear()
  canvasRefs.clear(); textLayerRefs.clear()
  annotationLayerRefs.clear(); highlightLayerRefs.clear()
  pageWrapperRefs.clear()

  searchCancelled.value = true
  searching.value = false
  searchKeyword.value = ''
  currentMatchIndex.value = -1
  showSearchPanel.value = false
  Object.assign(searchResult, {
    keyword: '',
    totalMatches: 0,
    totalPages: 0,
    pages: [],
  })
  expandedPages.clear()

  try {
    const doc = await loadPdfDocument(url)
    pdfDoc.value = doc
    totalPages.value = doc.numPages
    currentVisiblePage.value = 1
    await precomputePageDimensions()
    loading.value = false
    showToast(`加载成功，共 ${doc.numPages} 页`, 'success')
    await nextTick()
    setTimeout(scheduleRender, 50)
  } catch (e: unknown) {
    loading.value = false
    const msg = e instanceof Error ? e.message : String(e)
    if (engineError.value) {
      // 引擎本身没起来：由启动失败卡片展示说明与重试入口，不再只弹个 toast
      errorMsg.value = ''
      showToast('PDF.js 未就绪，请先在资源设置中修正脚本地址', 'error')
    } else {
      errorMsg.value = `PDF 加载失败: ${msg}`
      showToast('加载失败', 'error')
    }
    console.error('PDF 加载失败:', e)
  }
}

function loadSample(name: string) {
  fileName.value = name
  // 示例 PDF 同样跟随部署位置（子目录下不再请求站点根）
  loadPdf(resolvePath(name, resourceState.basePath))
}

function onFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  if (f.type !== 'application/pdf') { showToast('请选择 PDF 文件', 'error'); return }
  fileName.value = f.name
  loadPdf(URL.createObjectURL(f))
}

function onDragOver(e: DragEvent) { e.preventDefault(); e.stopPropagation() }
function onDrop(e: DragEvent) {
  e.preventDefault(); e.stopPropagation()
  const f = e.dataTransfer?.files?.[0]
  if (!f || f.type !== 'application/pdf') { showToast('请拖入 PDF 文件', 'error'); return }
  fileName.value = f.name
  loadPdf(URL.createObjectURL(f))
}

onMounted(() => {
  document.addEventListener('dragover', onDragOver)
  document.addEventListener('drop', onDrop)
  preloadPdfjs().catch(() => {})
})

onUnmounted(() => {
  document.removeEventListener('dragover', onDragOver)
  document.removeEventListener('drop', onDrop)
  if (toastTimer) clearTimeout(toastTimer)
  if (scrollRafId) cancelAnimationFrame(scrollRafId)
  searchCancelled.value = true
  renderVersion++
  pdfDoc.value?.destroy()
})
</script>

<style lang="scss">
.textLayer {
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  overflow: hidden; opacity: 0.25; line-height: 1;
  text-size-adjust: none; forced-color-adjust: none; z-index: 2;
  ::selection { background: rgba(22,119,255,0.3); }
  br { &::selection { background: transparent; } }
  span, br {
    color: transparent; position: absolute; white-space: pre;
    cursor: text; transform-origin: 0% 0%;
  }
  span::selection { background: rgba(22,119,255,0.4); color: transparent; }
  .endOfContent {
    display: block; position: absolute; left: 0; top: 100%; right: 0; bottom: 0;
    z-index: -1; cursor: default; user-select: none;
    &.active { top: 0; }
  }
}
.annotationLayer {
  position: absolute; top: 0; left: 0; z-index: 3; pointer-events: none;
  section { position: absolute; pointer-events: auto; }
  a { color: var(--primary-color); &:hover { opacity: 0.8; } }
}
.search-highlight {
  position: absolute;
  background: rgba(255, 235, 59, 0.55);
  border-radius: 2px;
  pointer-events: none;
  transition: background 0.2s;
  &--active {
    background: rgba(255, 152, 0, 0.7);
    box-shadow: 0 0 0 2px rgba(255, 152, 0, 0.4);
  }
}
</style>

<style lang="scss" scoped>
.pdf-viewer { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

.toolbar {
  display: flex; align-items: center; justify-content: space-between;
  height: 56px; padding: 0 16px; background: var(--card-bg);
  border-bottom: 1px solid var(--border-color); box-shadow: var(--shadow-sm);
  flex-shrink: 0; z-index: 10; gap: 8px;
  &__left, &__center, &__right { display: flex; align-items: center; gap: 8px; }
  &__left { flex: 1; flex-wrap: wrap; }
  &__right { flex-shrink: 0; }
  &__sample-btn {
    padding: 4px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    background: var(--card-bg); color: var(--text-secondary); cursor: pointer;
    font-size: var(--font-size-sm); transition: all 0.2s; white-space: nowrap;
    &:hover:not(:disabled) { border-color: var(--primary-color); color: var(--primary-color); }
    &--active { border-color: var(--primary-color); color: var(--primary-color); background: #e6f4ff; }
    &:disabled { opacity: 0.5; cursor: not-allowed; }
  }
  &__divider { width: 1px; height: 24px; background: var(--border-color); }
  &__info { font-size: var(--font-size-sm); color: var(--text-secondary); white-space: nowrap; }
  &__btn {
    display: flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; border: 1px solid var(--border-color);
    border-radius: var(--radius-sm); background: var(--card-bg);
    color: var(--text-primary); cursor: pointer; transition: all 0.2s;
    &:hover:not(:disabled) { border-color: var(--primary-color); color: var(--primary-color); }
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  }
  &__zoom-value {
    font-size: var(--font-size-sm); color: var(--text-secondary);
    min-width: 44px; text-align: center; font-variant-numeric: tabular-nums;
  }
  &__hint { font-size: var(--font-size-sm); color: var(--text-tertiary); }
}

.pdf-container { flex: 1; overflow: auto; background: var(--bg-color); will-change: scroll-position; }
.pdf-pages { display: flex; flex-direction: column; align-items: center; padding: 24px 0; gap: 16px; contain: layout style; }
.pdf-page-wrapper { display: flex; flex-direction: column; align-items: center; gap: 4px; contain: layout style; }
.pdf-page {
  position: relative; background: #fff; box-shadow: var(--shadow-md);
  border-radius: 2px; overflow: hidden; will-change: contents;
  canvas { display: block; }
}
.pdf-page__number { font-size: var(--font-size-sm); color: var(--text-tertiary); }

.pdf-empty {
  display: flex; align-items: center; justify-content: center; height: 100%; padding: 48px;
  &__card {
    display: flex; flex-direction: column; align-items: center; gap: 16px;
    padding: 48px 64px; background: var(--card-bg); border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md); border: 2px dashed var(--border-color); text-align: center;
    &--clickable { cursor: pointer; transition: all 0.2s;
      &:hover { border-color: var(--primary-color); box-shadow: var(--shadow-lg); }
    }
  }
  &__input { display: none; }
  &__icon { width: 64px; height: 64px; opacity: 0.6; }
  &__text { font-size: var(--font-size-lg); color: var(--text-primary); }
  &__sub { font-size: var(--font-size-sm); color: var(--text-tertiary); }
}
/* ---- 启动加载 / 失败 ---- */
.pdf-boot {
  display: flex; align-items: center; justify-content: center; height: 100%; padding: 48px;
  &__spinner {
    width: 40px; height: 40px; border: 3px solid var(--border-color);
    border-top-color: var(--primary-color); border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  &__text { margin-top: 16px; color: var(--text-secondary); }
  &__sub {
    margin-top: 6px; font-size: var(--font-size-sm); color: var(--text-tertiary);
    max-width: 560px; word-break: break-all; text-align: center;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  &__card {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    padding: 32px 48px; max-width: 560px;
    background: var(--card-bg); border: 1px solid #ffccc7; border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md); text-align: center;
  }
  &__icon { flex-shrink: 0; }
  &__title { font-size: var(--font-size-lg); font-weight: 600; color: #cf1322; }
  &__msg { color: #cf1322; font-size: var(--font-size-base); }
  &__url {
    font-size: var(--font-size-sm); color: var(--text-secondary);
    code {
      padding: 1px 6px; background: var(--bg-color); border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all;
    }
  }
  &__hint { font-size: var(--font-size-sm); color: var(--text-tertiary); line-height: 1.7; }
  &__actions { display: flex; gap: 12px; margin-top: 8px; }
  &__btn {
    padding: 7px 20px; background: var(--card-bg); border: 1px solid var(--border-color);
    border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-base);
    color: var(--text-secondary); transition: all 0.2s;
    &:hover { border-color: var(--primary-color); color: var(--primary-color); }
    &--primary { background: var(--primary-color); border-color: var(--primary-color); color: #fff;
      &:hover { background: var(--primary-hover); border-color: var(--primary-hover); } }
  }
}

/* ---- 工具栏设置按钮 ---- */
.toolbar__settings-btn { position: relative; }
.toolbar__settings-dot {
  position: absolute; top: 5px; right: 5px;
  width: 7px; height: 7px; border-radius: 50%;
  background: #ff4d4f; border: 1.5px solid var(--card-bg);
}

.pdf-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 16px;
  &__spinner {
    width: 40px; height: 40px; border: 3px solid var(--border-color);
    border-top-color: var(--primary-color); border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  &__text { color: var(--text-secondary); }
}
@keyframes spin { to { transform: rotate(360deg); } }
.pdf-error {
  display: flex; align-items: center; justify-content: center; padding: 48px;
  &__card {
    display: flex; flex-direction: column; align-items: center; gap: 16px;
    padding: 32px 48px; background: #fff2f0; border: 1px solid #ffccc7; border-radius: var(--radius-md);
  }
  &__text { color: #cf1322; }
  &__btn {
    padding: 6px 24px; background: var(--card-bg); border: 1px solid var(--border-color);
    border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s;
    &:hover { border-color: var(--primary-color); color: var(--primary-color); }
  }
}
.toast {
  position: fixed; top: 72px; left: 50%; transform: translateX(-50%);
  padding: 10px 24px; border-radius: var(--radius-md); box-shadow: var(--shadow-lg);
  z-index: 1000; pointer-events: none;
  &--success { background: #f6ffed; border: 1px solid #b7eb8f; color: #389e0d; }
  &--error { background: #fff2f0; border: 1px solid #ffccc7; color: #cf1322; }
  &--info { background: #e6f4ff; border: 1px solid #91caff; color: #0958d9; }
}
.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(-12px); }

/* ---- 主区域布局 ---- */
.pdf-main { display: flex; flex: 1; overflow: hidden; }

/* ---- 工具栏搜索 ---- */
.toolbar {
  &__search {
    display: flex; align-items: center;
    height: 34px; padding: 0 8px;
    border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    background: var(--card-bg);
    transition: border-color 0.2s;
    &:focus-within { border-color: var(--primary-color); }
    &-icon { color: var(--text-tertiary); flex-shrink: 0; }
    &-input {
      flex: 1; height: 100%;
      border: none; outline: none; background: transparent;
      padding: 0 8px; font-size: var(--font-size-sm);
      color: var(--text-primary);
      &::placeholder { color: var(--text-tertiary); }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }
    &-clear {
      display: flex; align-items: center; justify-content: center;
      width: 18px; height: 18px;
      border: none; background: transparent;
      color: var(--text-tertiary); cursor: pointer;
      border-radius: 50%; transition: all 0.2s;
      &:hover:not(:disabled) { background: var(--border-color); color: var(--text-primary); }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }
    &-btn {
      margin-left: 4px;
      width: 30px !important; height: 30px !important;
    }
    &-spinner {
      width: 14px; height: 14px;
      border: 2px solid var(--border-color);
      border-top-color: var(--primary-color);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
  }
  &__search-count {
    font-size: var(--font-size-sm); color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    min-width: 56px; text-align: center;
  }
}

/* ---- 搜索面板 ---- */
.search-panel {
  width: 320px; flex-shrink: 0;
  background: var(--card-bg);
  border-right: 1px solid var(--border-color);
  display: flex; flex-direction: column;
  &__header {
    display: flex; align-items: center; gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }
  &__title { font-weight: 600; color: var(--text-primary); flex: 1; }
  &__count { font-size: var(--font-size-sm); color: var(--text-secondary); }
  &__close {
    display: flex; align-items: center; justify-content: center;
    width: 24px; height: 24px;
    border: none; background: transparent;
    color: var(--text-tertiary); cursor: pointer;
    border-radius: var(--radius-sm); transition: all 0.2s;
    &:hover { background: var(--bg-color); color: var(--text-primary); }
  }
  &__content {
    flex: 1; overflow-y: auto;
    padding: 8px 0;
  }
  &__page-group {
    margin-bottom: 4px;
  }
  &__page-header {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 16px;
    cursor: pointer;
    transition: background 0.2s;
    &:hover { background: var(--bg-color); }
  }
  &__expand-icon {
    transition: transform 0.2s;
    color: var(--text-tertiary);
    &--expanded { transform: rotate(90deg); }
  }
  &__page-title {
    flex: 1; font-size: var(--font-size-sm); font-weight: 500;
    color: var(--text-primary);
  }
  &__page-count {
    font-size: var(--font-size-sm); color: var(--text-tertiary);
    background: var(--bg-color);
    padding: 2px 8px; border-radius: 10px;
  }
  &__matches {
    padding: 4px 0;
  }
  &__match {
    padding: 8px 16px 8px 36px;
    cursor: pointer;
    transition: background 0.2s;
    border-left: 2px solid transparent;
    &:hover { background: var(--bg-color); }
    &--active {
      background: #e6f4ff;
      border-left-color: var(--primary-color);
    }
  }
  &__match-text {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    line-height: 1.5;
    word-break: break-word;
  }
  &__match-mark {
    background: rgba(255, 235, 59, 0.6);
    color: var(--text-primary);
    padding: 0 2px; border-radius: 2px;
    font-weight: 500;
  }
}

/* ---- 搜索中状态 ---- */
.pdf-searching {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 100%; gap: 12px;
  &__spinner {
    width: 36px; height: 36px;
    border: 3px solid var(--border-color);
    border-top-color: var(--primary-color);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  &__text { color: var(--text-secondary); font-weight: 500; }
  &__progress { color: var(--text-tertiary); font-size: var(--font-size-sm); }
}

/* ---- 高亮层 ---- */
.pdf-page__highlight-layer {
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  pointer-events: none; z-index: 4;
}
</style>
