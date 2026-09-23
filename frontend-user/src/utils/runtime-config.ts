/**
 * 运行时资源配置 —— 桥接 index.html 中的 PDF.js 引导脚本（window.__PDF_VIEWER_BOOT__）。
 *
 * - 默认基础路径由引导脚本按当前部署位置自动计算（document 所在目录）；
 * - 用户可在设置面板覆盖基础路径，立即保存并生效（PDF.js 未就绪时立即重载脚本）；
 * - 已打开的文档不受设置变化影响（cmap/字体地址在下次 getDocument 时读取）。
 */
import { ref, computed, readonly } from 'vue'

export type BootStatus = 'loading' | 'ready' | 'error'

export interface BootState {
  status: BootStatus
  detectedBase: string
  overrideBase: string
  overrideInput: string
  overrideError: string
  effectiveBase: string
  scriptUrl: string
  workerUrl: string
  error: string
  attempts: number
}

export interface ResourceUrls {
  script: string
  worker: string
  cmap: string
  font: string
}

export type ProbeResult = {
  url: string
  ok: boolean
  status: number
  type: string
  redirected?: boolean
  message?: string
}

interface BootApi {
  state: BootState
  urls(): ResourceUrls
  retry(): void
  applyOverride(input: string): string
  clearOverride(): string
  normalizeBase(input: string): string
  probe(url: string): Promise<ProbeResult>
}

function getBoot(): BootApi {
  const boot = (window as unknown as { __PDF_VIEWER_BOOT__?: BootApi }).__PDF_VIEWER_BOOT__
  if (!boot) throw new Error('PDF.js 引导脚本未执行（index.html 中的内联脚本缺失）')
  return boot
}

const boot = getBoot()

/* ---- 响应式状态：初始值取自引导脚本，之后通过事件同步 ---- */
const status = ref<BootStatus>(boot.state.status)
const detectedBase = ref(boot.state.detectedBase)
const overrideInput = ref(boot.state.overrideInput)
const overrideBase = ref(boot.state.overrideBase)
const overrideError = ref(boot.state.overrideError)
const effectiveBase = ref(boot.state.effectiveBase)
const bootError = ref(boot.state.error)
const attempts = ref(boot.state.attempts)

function syncFromBoot() {
  const s = boot.state
  status.value = s.status
  detectedBase.value = s.detectedBase
  overrideInput.value = s.overrideInput
  overrideBase.value = s.overrideBase
  overrideError.value = s.overrideError
  effectiveBase.value = s.effectiveBase
  bootError.value = s.error
  attempts.value = s.attempts
}

window.addEventListener('pdf-boot-change', syncFromBoot)

/* ---- 资源地址：始终跟随当前生效的基础路径实时计算 ---- */
const urls = computed<ResourceUrls>(() => boot.urls())

const isOverridden = computed(() => overrideBase.value !== '')
const isAutoDetected = computed(() => !isOverridden.value)

/* ---- ready Promise：每次进入 loading 时重新挂接 ---- */
let readyResolvers: { resolve: () => void; reject: (e: Error) => void } | null = null
let readyPromise: Promise<void> = createReadyPromise()

function createReadyPromise(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    readyResolvers = { resolve, reject }
  })
}

window.addEventListener('pdf-boot-change', () => {
  if (status.value === 'loading') {
    /* 每次进入 loading 都换一个全新 promise：失败后重试时，旧的已 reject promise 不能残留 */
    if (!readyResolvers) readyPromise = createReadyPromise()
  } else if (readyResolvers) {
    const r = readyResolvers
    readyResolvers = null
    if (status.value === 'ready') r.resolve()
    else r.reject(new Error(bootError.value || 'PDF.js 加载失败'))
  }
})

/** 等待 PDF.js 就绪；加载失败时 reject（绝不无限挂起，避免界面一直转圈） */
export function whenPdfjsReady(): Promise<void> {
  if (status.value === 'ready') return Promise.resolve()
  if (status.value === 'error') {
    return Promise.reject(new Error(bootError.value || 'PDF.js 加载失败'))
  }
  return readyPromise
}

/** 已就绪时同步取 pdfjsLib，否则抛出带当前错误信息的异常 */
export function getPdfjsLib<T>(): T {
  const lib = (window as unknown as { pdfjsLib?: T }).pdfjsLib
  if (!lib) {
    throw new Error(
      status.value === 'error'
        ? `PDF.js 未加载：${bootError.value || '未知错误'}`
        : 'PDF.js 尚未加载完成',
    )
  }
  return lib
}

/* ---- 设置覆盖 ---- */

/** 校验并应用基础路径；非法输入抛错且不改变现状 */
export function applyBaseOverride(input: string): string {
  return boot.applyOverride(input)
}

/** 清除覆盖，恢复按部署位置自动取值 */
export function resetBaseOverride(): string {
  return boot.clearOverride()
}

/** 仅校验输入，返回规范化地址或抛出异常（供输入框即时提示） */
export function validateBase(input: string): string {
  return boot.normalizeBase(input)
}

/** 立即按当前生效配置重新加载 PDF.js（错误界面的“重试”入口） */
export function retryPdfjs(): void {
  boot.retry()
}

/** 取当前生效的全部资源地址（每次调用实时计算，设置改动后即时反映） */
export function resourceUrls(): ResourceUrls {
  return boot.urls()
}

/** 解析 public 目录下的文件地址（示例 PDF 等），跟随当前生效的基础路径 */
export function publicAssetUrl(name: string): string {
  return new URL(name.replace(/^\/+/, ''), boot.state.effectiveBase).href
}

/** 探测单个资源地址的连通性（设置面板用来区分“设置没生效”与“地址对不上”） */
export function probeUrl(url: string): Promise<ProbeResult> {
  return boot.probe(url)
}

export function useRuntimeConfig() {
  return {
    status: readonly(status),
    detectedBase: readonly(detectedBase),
    overrideInput: readonly(overrideInput),
    overrideBase: readonly(overrideBase),
    overrideError: readonly(overrideError),
    effectiveBase: readonly(effectiveBase),
    bootError: readonly(bootError),
    attempts: readonly(attempts),
    urls,
    isOverridden,
    isAutoDetected,
    applyBaseOverride,
    resetBaseOverride,
    validateBase,
    retryPdfjs,
    probeUrl,
    resourceUrls,
    publicAssetUrl,
    whenPdfjsReady,
  }
}
