/**
 * PDF.js 资源地址配置
 * ------------------
 * 解决阅读器部署到站点子目录后，写死的根路径（/pdfjs/...）全部 404 的问题。
 *
 * 地址解析规则：
 *   1. 自动模式（默认）：依据页面/入口脚本的实际 URL 推断部署基路径，
 *      再拼出 pdf.js、worker、cmaps、标准字体地址 —— 根目录与子目录都无需配置。
 *   2. 覆盖模式：在「资源设置」中为任意一项填入地址，立即生效并持久化到
 *      localStorage（按 部署源 + 基路径 分别保存，互不影响）。
 *
 * 设置即时生效：应用方 watch configVersion，脚本地址变化会重新加载 PDF.js，
 * cMap/字体地址变化会作用于之后打开的文档；已打开的文档继续沿用旧地址，
 * 不受影响（见 pdf-engine.ts）。
 */
import { reactive, computed, readonly } from 'vue'

/* ------------------------------------------------------------------ */
/*  类型定义                                                            */
/* ------------------------------------------------------------------ */

export type ResourceKey = 'scriptUrl' | 'workerUrl' | 'cMapUrl' | 'standardFontDataUrl'

/** 可覆盖的资源项元信息 */
export interface ResourceMeta {
  key: ResourceKey
  label: string
  /** 自动模式下相对部署基路径的默认位置 */
  defaultPath: string
  /** 设置面板中的说明 */
  hint: string
  /** 目录类资源的探活哨兵文件（目录本身通常不允许列目录） */
  probeFile?: string
}

export const RESOURCE_META: ResourceMeta[] = [
  {
    key: 'scriptUrl',
    label: 'PDF.js 脚本地址',
    defaultPath: 'pdfjs/pdf.js',
    hint: '页面加载的第一个核心脚本，失败时整个阅读器无法启动',
  },
  {
    key: 'workerUrl',
    label: 'PDF.js Worker 地址',
    defaultPath: 'pdfjs/pdf.worker.js',
    hint: 'PDF 解析在 worker 线程中执行，由脚本地址自动配套',
  },
  {
    key: 'cMapUrl',
    label: 'CMap 字符集目录',
    defaultPath: 'pdfjs/cmaps/',
    hint: '中文等 CJK 文档必需，地址需指向 cmaps 目录并以 / 结尾',
    probeFile: 'GBKp-EUC-H.bcmap',
  },
  {
    key: 'standardFontDataUrl',
    label: '标准字体目录',
    defaultPath: 'pdfjs/standard_fonts/',
    hint: 'PDF 标准字体数据目录，需以 / 结尾',
    probeFile: 'FoxitFixed.pfb',
  },
]

export type ResourceStatus = 'unknown' | 'checking' | 'ok' | 'fail'

export interface ResourceState {
  /** 当前生效地址（自动推断或覆盖值） */
  effective: string
  /** 探活状态，用于区分"设置未生效"与"地址本身取不到" */
  status: ResourceStatus
  /** 探活失败时的说明（HTTP 状态 / 网络错误） */
  message: string
  /** 最近一次探活时间戳 */
  checkedAt: number
}

/** 用户覆盖配置，空字符串表示"自动" */
export type ResourceOverrides = Record<ResourceKey, string>

interface PersistShape {
  v: 1
  overrides: Partial<Record<ResourceKey, string>>
}

/* ------------------------------------------------------------------ */
/*  部署基路径自动推断                                                    */
/* ------------------------------------------------------------------ */

const STORAGE_PREFIX = 'pdf-viewer:resource-config:'

/**
 * 推断应用部署基路径（origin 之后的目录，以 / 结尾）。
 * 根目录部署得到 '/'，子目录（如 /viewer/）得到 '/viewer/'。
 *
 * 优先用当前模块脚本自身的 URL（生产构建在 assets/ 下、开发时在 src/ 下，
 * Vite 以相对 base 构建后该 URL 天然带上部署前缀），
 * 拿不到时回退到 document.baseURI / 当前页面路径。
 */
export function detectBasePath(): string {
  try {
    const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[]
    for (const s of scripts) {
      const url = new URL(s.src, window.location.href)
      if (url.origin !== window.location.origin) continue
      const p = url.pathname
      // /viewer/assets/index-xxx.js → /viewer/
      // /viewer/src/main.ts → /viewer/
      const m = p.match(/^(.*?)\/(?:assets|src)\//)
      if (m) {
        const dir = m[1]
        return dir === '' ? '/' : `${dir}/`
      }
    }
  } catch { /* fall through */ }

  try {
    const baseUri = new URL(document.baseURI || window.location.href)
    if (baseUri.origin === window.location.origin && baseUri.pathname.endsWith('/')) {
      return baseUri.pathname
    }
  } catch { /* fall through */ }

  // 兜底：用当前页面所在目录（hash 路由不影响 pathname）
  const path = window.location.pathname
  const idx = path.lastIndexOf('/')
  return idx >= 0 ? `${path.slice(0, idx)}/` : '/'
}

/**
 * 将配置值解析为绝对路径（以 / 开头）或完整 URL。
 * - http(s)://、// 开头：原样返回
 * - / 开头的绝对路径：原样返回（相对于站点根）
 * - 其它：相对部署基路径拼接；以 ~/ 开头表示相对站点根
 */
export function resolvePath(value: string, basePath: string): string {
  const v = value.trim()
  if (/^https?:\/\//i.test(v) || v.startsWith('//')) return v
  if (v.startsWith('/')) return v
  if (v.startsWith('~/')) return v.slice(1)
  if (basePath.endsWith('/')) return basePath + v
  return `${basePath}/${v}`
}

/* ------------------------------------------------------------------ */
/*  响应式配置状态                                                        */
/* ------------------------------------------------------------------ */

const basePath = detectBasePath()
const storageKey = STORAGE_PREFIX + `${window.location.origin}${basePath}`

const state = reactive({
  /** 当前部署基路径 */
  basePath,
  /** 已保存并生效的覆盖值（'' 表示自动） */
  overrides: {
    scriptUrl: '',
    workerUrl: '',
    cMapUrl: '',
    standardFontDataUrl: '',
  } as ResourceOverrides,
  /** 各资源当前生效地址与探活状态 */
  resources: {} as Record<ResourceKey, ResourceState>,
  /** 配置版本号：保存/重置后自增，应用方 watch 它来即时响应 */
  configVersion: 0,
})

/** 资源当前生效地址（computed，覆盖优先，否则基路径 + 默认路径） */
const effectiveUrls = computed<Record<ResourceKey, string>>(() => {
  const result = {} as Record<ResourceKey, string>
  for (const meta of RESOURCE_META) {
    const override = state.overrides[meta.key].trim()
    const value = override || meta.defaultPath
    result[meta.key] = resolvePath(value, state.basePath)
  }
  return result
})

for (const meta of RESOURCE_META) {
  state.resources[meta.key] = {
    effective: effectiveUrls.value[meta.key],
    status: 'unknown',
    message: '',
    checkedAt: 0,
  }
}

/* ------------------------------------------------------------------ */
/*  持久化                                                              */
/* ------------------------------------------------------------------ */

function loadPersisted(): Partial<Record<ResourceKey, string>> {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}
    const data = JSON.parse(raw) as PersistShape
    if (data.v !== 1 || !data.overrides) return {}
    return data.overrides
  } catch {
    return {}
  }
}

function persist() {
  const overrides: Partial<Record<ResourceKey, string>> = {}
  let hasAny = false
  for (const meta of RESOURCE_META) {
    const v = state.overrides[meta.key].trim()
    if (v) { overrides[meta.key] = v; hasAny = true }
  }
  try {
    if (hasAny) {
      window.localStorage.setItem(storageKey, JSON.stringify({ v: 1, overrides } satisfies PersistShape))
    } else {
      window.localStorage.removeItem(storageKey)
    }
  } catch { /* 隐私模式等场景下持久化失败不影响运行 */ }
}

/* ------------------------------------------------------------------ */
/*  对外操作                                                             */
/* ------------------------------------------------------------------ */

/** 初始化：读取持久化覆盖值，同步一次生效地址 */
function init() {
  const saved = loadPersisted()
  for (const meta of RESOURCE_META) {
    state.overrides[meta.key] = saved[meta.key] ?? ''
  }
  syncEffective()
}

function syncEffective() {
  for (const meta of RESOURCE_META) {
    state.resources[meta.key].effective = effectiveUrls.value[meta.key]
  }
}

/**
 * 保存覆盖配置并立即生效：
 * 未改动时返回 false；改动后同步生效地址、重置探活状态、自增版本号。
 */
function applyOverrides(next: ResourceOverrides): boolean {
  let changed = false
  for (const meta of RESOURCE_META) {
    const v = (next[meta.key] ?? '').trim()
    if (v !== state.overrides[meta.key].trim()) changed = true
    state.overrides[meta.key] = v
  }
  if (!changed) return false

  persist()
  syncEffective()
  // 地址变了，旧的探活结果不再说明问题
  for (const meta of RESOURCE_META) {
    state.resources[meta.key].status = 'unknown'
    state.resources[meta.key].message = ''
  }
  state.configVersion++
  return changed
}

/** 恢复全部自动默认（清空当前部署位置的覆盖），立即生效 */
function resetOverrides(): boolean {
  const cleared = applyOverrides({ scriptUrl: '', workerUrl: '', cMapUrl: '', standardFontDataUrl: '' })
  return cleared
}

/** 设置资源探活结果（由 pdf-engine / 探活逻辑回填） */
function setResourceStatus(key: ResourceKey, status: ResourceStatus, message = '') {
  const r = state.resources[key]
  r.status = status
  r.message = message
  r.checkedAt = Date.now()
}

/**
 * 探测某个地址是否可访问：
 * fetch HEAD/GET，要求响应 ok 且内容不是 HTML（目录配置错误常被 SPA 回退到 index.html）。
 */
async function probeUrl(url: string, signal?: AbortSignal): Promise<{ ok: boolean; message: string }> {
  try {
    const resp = await fetch(url, { method: 'GET', signal })
    if (!resp.ok) {
      return { ok: false, message: `HTTP ${resp.status} ${resp.statusText}` }
    }
    const ctype = (resp.headers.get('content-type') || '').toLowerCase()
    if (ctype.includes('text/html')) {
      return { ok: false, message: '返回了 HTML 页面（地址可能指向了页面而非资源，或被回退到 index.html）' }
    }
    // 不消费大文件正文
    try { await resp.body?.cancel() } catch { /* ignore */ }
    return { ok: true, message: ctype ? `可访问（${ctype}）` : '可访问' }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { ok: false, message: '探测超时' }
    }
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** 探活单个资源，回填状态，返回是否可用 */
async function checkResource(key: ResourceKey): Promise<boolean> {
  const r = state.resources[key]
  const meta = RESOURCE_META.find((m) => m.key === key)
  // 目录类资源探测哨兵文件，避免对目录本身的请求 403/404 误判
  const probeTarget =
    meta?.probeFile
      ? `${r.effective.endsWith('/') ? r.effective : r.effective + '/'}${meta.probeFile}`
      : r.effective
  r.status = 'checking'
  r.message = ''
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  const result = await probeUrl(probeTarget, controller.signal)
  clearTimeout(timer)
  r.status = result.ok ? 'ok' : 'fail'
  r.message = result.ok
    ? (meta?.probeFile ? `可访问（哨兵文件 ${meta.probeFile}）` : result.message)
    : result.message
  r.checkedAt = Date.now()
  return result.ok
}

/** 一次性探活 worker/cmaps/fonts 等静态资源（脚本本身由加载流程负责验证） */
async function checkStaticResources(keys: ResourceKey[] = ['workerUrl', 'cMapUrl', 'standardFontDataUrl']) {
  await Promise.all(keys.map((k) => checkResource(k)))
}

init()

export function usePdfResourceConfig() {
  return {
    state: readonly(state),
    basePath,
    overrides: computed(() => ({ ...state.overrides })),
    effectiveUrls,
    resourceMeta: RESOURCE_META,
    applyOverrides,
    resetOverrides,
    checkResource,
    checkStaticResources,
    setResourceStatus,
  }
}

/** 非 Composition API 场景（pdf-engine.ts）直接取用 */
export const pdfResourceConfig = {
  state,
  get effectiveUrls() { return effectiveUrls.value },
  applyOverrides,
  resetOverrides,
  checkResource,
  checkStaticResources,
  setResourceStatus,
}
