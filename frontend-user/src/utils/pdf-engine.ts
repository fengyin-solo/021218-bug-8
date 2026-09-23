/**
 * PDF 渲染引擎 — 基于 PDF.js 2.10.377
 * PDF.js 不再由 index.html 写死 <script src="/pdfjs/pdf.js"> 引入，
 * 而是在下方按 pdf-config 解析出的地址动态注入：
 *   - 自动跟随部署目录（根目录 / 子目录均可）
 *   - 可在「资源设置」中覆盖，改完立即重新加载
 *   - 加载失败暴露明确错误与重试入口，不再无限等待
 * 2.x UMD 版本无 private class fields，彻底避免 Vite 兼容性问题
 */
import { reactive, watch } from 'vue'
import { pdfResourceConfig } from './pdf-config'

/* ------------------------------------------------------------------ */
/*  PDF.js 2.x 类型定义（无需 @types/pdfjs-dist，手动声明核心接口）       */
/* ------------------------------------------------------------------ */

/** PDF.js Viewport（getViewport 返回值） */
export interface PdfjsViewport {
  width: number
  height: number
  scale: number
  rotation: number
  transform: number[]
  clone(params?: { scale?: number; rotation?: number; dontFlip?: boolean }): PdfjsViewport
}

/** PDF.js 单页对象 */
export interface PdfjsPage {
  pageNumber: number
  getViewport(params: { scale: number; rotation?: number }): PdfjsViewport
  getTextContent(): Promise<PdfjsTextContent>
  getAnnotations(): Promise<PdfjsAnnotation[]>
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfjsViewport }): { promise: Promise<void> }
}

/** PDF.js 文档对象 */
export interface PdfjsDocument {
  numPages: number
  getPage(pageNumber: number): Promise<PdfjsPage>
  destroy(): void
}

/** PDF.js TextContent */
export interface PdfjsTextContent {
  items: Array<{ str: string; dir: string; transform: number[]; width: number; height: number }>
  styles: Record<string, { fontFamily: string; ascent: number; descent: number; vertical: boolean }>
}

/** PDF.js Annotation（简化） */
export interface PdfjsAnnotation {
  annotationType: number
  id: string
  rect: number[]
  url?: string
  dest?: string | unknown[]
}

/** 匹配项在单个文本项中的片段信息 */
interface MatchFragment {
  itemIndex: number
  charStart: number
  charEnd: number
  transform: number[]
  width: number
  height: number
  itemStr: string
}

/** 单个搜索匹配结果 */
export interface SearchMatch {
  pageNumber: number
  matchIndex: number
  text: string
  startOffset: number
  endOffset: number
  transform: number[]
  width: number
  height: number
  fragments: MatchFragment[]
}

/** 单页搜索结果 */
export interface PageSearchResult {
  pageNumber: number
  matches: SearchMatch[]
  pageText: string
}

/** 全文搜索结果 */
export interface SearchResult {
  keyword: string
  totalMatches: number
  totalPages: number
  pages: PageSearchResult[]
}

/** PDF.js 链接服务接口 */
interface PdfjsLinkService {
  getDestinationHash: (dest: string) => string
  getAnchorUrl: (hash: string) => string
  addLinkAttributes: (link: HTMLAnchorElement, url: string) => void
  externalLinkEnabled: boolean
  externalLinkRel: string
  externalLinkTarget: number
  isInPresentationMode: boolean
}

/** PDF.js UMD 全局库（2.10.377） */
export interface PdfjsLib {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument(params: Record<string, unknown>): { promise: Promise<PdfjsDocument> }
  renderTextLayer(params: {
    textContent: PdfjsTextContent
    container: HTMLDivElement
    viewport: PdfjsViewport
    enhanceTextSelection?: boolean
  }): void
  AnnotationLayer: {
    render(params: {
      annotations: PdfjsAnnotation[]
      div: HTMLDivElement
      page: PdfjsPage
      viewport: PdfjsViewport
      linkService: PdfjsLinkService
    }): void
  }
}

declare global {
  interface Window {
    pdfjsLib?: PdfjsLib
  }
}

/* ------------------------------------------------------------------ */
/*  PDF.js 动态加载（跟随部署位置 / 可被设置覆盖 / 失败可重试）             */
/* ------------------------------------------------------------------ */

export type EnginePhase = 'idle' | 'loading' | 'ready' | 'error'

interface EngineState {
  phase: EnginePhase
  /** 当前生效的脚本地址 */
  scriptUrl: string
  /** 失败说明（phase === 'error' 时） */
  errorMsg: string
  /** 加载序号，丢弃过期的加载结果 */
  loadSeq: number
}

const engine = reactive<EngineState>({
  phase: 'idle',
  scriptUrl: pdfResourceConfig.effectiveUrls.scriptUrl,
  errorMsg: '',
  loadSeq: 0,
})

export const engineState: Readonly<EngineState> = engine

/**
 * 已打开页面与其加载时所用的 PDF.js 版本的绑定。
 * 设置里更换脚本地址后会重新注入 PDF.js，旧文档的页面仍用旧 lib 渲染，
 * 保证「已经打开的文档不受影响」。
 */
const pageLibs = new WeakMap<PdfjsPage, PdfjsLib>()

let activeLib: PdfjsLib | undefined

function describeError(e: unknown): string {
  if (e instanceof Event) return '脚本加载失败（网络错误或地址 404）'
  if (e instanceof Error) {
    if (e.message === 'PDFJS_SCRIPT_TIMEOUT') {
      return '脚本加载超时：地址不可达或响应过慢，请检查"PDF.js 脚本地址"'
    }
    if (e.message === 'PDFJS_SCRIPT_INVALID') {
      return '脚本已下载但不是有效的 PDF.js（地址可能返回了 HTML 页面），请检查"PDF.js 脚本地址"'
    }
    return e.message
  }
  return String(e)
}

/** 注入并加载指定地址的 PDF.js 脚本 */
function injectPdfjsScript(url: string, previous?: PdfjsLib): Promise<PdfjsLib> {
  return new Promise((resolve, reject) => {
    // 重新加载时移除旧的 <script>，避免重复与全局残留造成误判
    document.querySelectorAll('script[data-pdfjs-lib]').forEach((el) => el.remove())

    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.dataset.pdfjsLib = 'true'

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('PDFJS_SCRIPT_TIMEOUT'))
    }, 15000)

    function cleanup() {
      clearTimeout(timer)
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
    }
    function onLoad() {
      cleanup()
      const lib = window.pdfjsLib
      if (!lib || typeof lib.getDocument !== 'function') {
        reject(new Error('PDFJS_SCRIPT_INVALID'))
        return
      }
      // UMD 每次执行都会赋一个全新对象；若拿到的还是旧引用，
      // 说明下载的不是 PDF.js（例如 SPA 回退返回的 HTML 之外的普通 JS）
      if (previous && lib === previous) {
        reject(new Error('PDFJS_SCRIPT_INVALID'))
        return
      }
      resolve(lib)
    }
    function onError() {
      cleanup()
      reject(new Event('error'))
    }

    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    document.head.appendChild(script)
  })
}

let currentLoad: Promise<void> = Promise.resolve()

/**
 * 按当前配置加载（或重新加载）PDF.js。
 */
function loadPdfjs(): Promise<void> {
  const seq = ++engine.loadSeq
  const urls = pdfResourceConfig.effectiveUrls
  engine.scriptUrl = urls.scriptUrl
  engine.phase = 'loading'
  engine.errorMsg = ''

  // 保住旧 lib：脚本地址切换失败时，已打开的文档仍可继续使用
  const oldLib = window.pdfjsLib

  const load = (async () => {
    let lib: PdfjsLib
    try {
      lib = await injectPdfjsScript(urls.scriptUrl, oldLib)
    } catch (e) {
      if (seq !== engine.loadSeq) return
      const msg = describeError(e)
      engine.phase = 'error'
      engine.errorMsg = msg
      pdfResourceConfig.setResourceStatus('scriptUrl', 'fail', msg)
      // 失败回退：热更新前已打开的文档继续用旧 lib，不受坏地址影响
      if (oldLib) window.pdfjsLib = oldLib
      return
    }
    if (seq !== engine.loadSeq) return

    lib.GlobalWorkerOptions.workerSrc = urls.workerUrl
    activeLib = lib
    window.pdfjsLib = lib

    engine.phase = 'ready'
    engine.errorMsg = ''
    pdfResourceConfig.setResourceStatus('scriptUrl', 'ok', '脚本加载成功')
    // worker / cmaps / 字体为静态文件，后台探活以在设置面板标注是否真的可取到
    void pdfResourceConfig.checkStaticResources()
  })()

  currentLoad = load
  return load
}

/** 设置面板点击"重试" */
export function retryLoadPdfjs(): Promise<void> {
  return loadPdfjs()
}

async function ensureReady(): Promise<PdfjsLib> {
  await currentLoad
  if (engine.phase === 'loading') {
    // currentLoad 已 settle 但仍处于 loading 不会发生；保险等待下一帧轮询
    await new Promise((r) => setTimeout(r, 0))
    return ensureReady()
  }
  const lib = window.pdfjsLib
  if (engine.phase !== 'ready' || !lib) {
    throw new Error(engine.errorMsg || 'PDF.js 未就绪，请检查资源设置后重试')
  }
  return lib
}

function getPdfjs(): PdfjsLib {
  const lib = window.pdfjsLib
  if (!lib) throw new Error('PDF.js not loaded')
  return lib
}

/** 取文档/页面绑定的 lib（热更新前打开的文档继续走旧版本） */
function libForPage(page: PdfjsPage): PdfjsLib {
  return pageLibs.get(page) || activeLib || getPdfjs()
}

// 监听配置变化：保存设置后立即生效
watch(
  () => pdfResourceConfig.state.configVersion,
  async () => {
    const urls = pdfResourceConfig.effectiveUrls
    const currentScript = engine.scriptUrl

    if (urls.scriptUrl === currentScript && engine.phase === 'ready') {
      // 脚本未变：worker 地址立即切换（旧文档的在途任务不受影响）
      const lib = window.pdfjsLib
      if (lib) lib.GlobalWorkerOptions.workerSrc = urls.workerUrl
      // cMap/字体地址在 loadPdfDocument 时实时读取，天然对新文档生效
      void pdfResourceConfig.checkStaticResources()
      return
    }

    if (urls.scriptUrl === currentScript) {
      // 脚本地址未变但引擎处于失败态：重新注入同一脚本（等价于重试）
      await loadPdfjs()
      return
    }

    // 脚本地址变了：重新注入；失败会自动回退旧 lib，已打开文档照常工作
    await loadPdfjs()
  },
)

// 启动即按部署位置自动加载
void loadPdfjs()

/* ------------------------------------------------------------------ */
/*  导出接口                                                            */
/* ------------------------------------------------------------------ */

export interface PageRenderResult {
  page: PdfjsPage
  pageNumber: number
  viewport: PdfjsViewport
}

/** 预加载（等待 PDF.js 就绪）；失败时抛错由界面展示并提供重试 */
export async function preloadPdfjs(): Promise<void> {
  await ensureReady()
}

/** 加载 PDF 文档（cMap / 标准字体地址实时取自资源配置，设置改变后对新文档立即生效） */
export async function loadPdfDocument(url: string): Promise<PdfjsDocument> {
  const pdfjs = await ensureReady()
  const urls = pdfResourceConfig.effectiveUrls
  const doc = await pdfjs.getDocument({
    url,
    cMapUrl: urls.cMapUrl,
    cMapPacked: true,
    standardFontDataUrl: urls.standardFontDataUrl,
  }).promise

  // 绑定本次加载所用的 lib：之后即便脚本地址被改掉、PDF.js 被重新注入，
  // 这份文档的页面仍用旧 lib 渲染文本/注释层，已打开文档不受影响。
  const rawGetPage = doc.getPage.bind(doc)
  doc.getPage = async (pageNumber: number) => {
    const page = await rawGetPage(pageNumber)
    if (!pageLibs.has(page)) pageLibs.set(page, pdfjs)
    return page
  }
  return doc
}

/** 渲染单页到 Canvas */
export async function renderPageToCanvas(
  page: PdfjsPage, canvas: HTMLCanvasElement, scale: number,
): Promise<PageRenderResult> {
  const viewport = page.getViewport({ scale })
  const ctx = canvas.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(viewport.width * dpr)
  canvas.height = Math.floor(viewport.height * dpr)
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`
  ctx.scale(dpr, dpr)
  await page.render({ canvasContext: ctx, viewport }).promise
  return { page, pageNumber: page.pageNumber, viewport }
}

/**
 * 构建 Text Layer — 核心：精确文字定位
 * 2.x API: pdfjsLib.renderTextLayer({ textContent, container, viewport, enhanceTextSelection })
 */
export async function buildTextLayer(
  page: PdfjsPage, container: HTMLDivElement, viewport: PdfjsViewport,
): Promise<void> {
  const pdfjs = libForPage(page)
  const textContent = await page.getTextContent()
  container.innerHTML = ''
  container.style.width = `${viewport.width}px`
  container.style.height = `${viewport.height}px`
  pdfjs.renderTextLayer({
    textContent,
    container,
    viewport,
    enhanceTextSelection: true,
  })
}

/**
 * 构建 Annotation Layer
 * 2.x API: AnnotationLayer.render({ annotations, div, page, viewport, linkService })
 */
export async function buildAnnotationLayer(
  page: PdfjsPage, container: HTMLDivElement, viewport: PdfjsViewport,
): Promise<void> {
  const pdfjs = libForPage(page)
  const annotations = await page.getAnnotations()
  if (!annotations.length) return
  container.innerHTML = ''
  container.style.width = `${viewport.width}px`
  container.style.height = `${viewport.height}px`
  try {
    pdfjs.AnnotationLayer.render({
      annotations,
      div: container,
      page,
      viewport: viewport.clone({ dontFlip: true }),
      linkService: {
        getDestinationHash: () => '#',
        getAnchorUrl: () => '#',
        addLinkAttributes: (link: HTMLAnchorElement, url: string) => {
          link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'
        },
        externalLinkEnabled: true,
        externalLinkRel: 'noopener noreferrer',
        externalLinkTarget: 2,
        isInPresentationMode: false,
      },
    })
  } catch { /* 注释层失败不影响核心功能 */ }
}

/**
 * 获取每页的原始尺寸（未缩放，scale=1）
 * 用于精确预计算不同尺寸页面的布局
 */
export async function getPageBaseDimensions(
  doc: PdfjsDocument,
): Promise<Map<number, { baseWidth: number; baseHeight: number }>> {
  const result = new Map<number, { baseWidth: number; baseHeight: number }>()
  // 并发获取所有页面尺寸，每批 10 页避免过多并发
  const batchSize = 10
  for (let start = 1; start <= doc.numPages; start += batchSize) {
    const end = Math.min(start + batchSize - 1, doc.numPages)
    const promises: Promise<void>[] = []
    for (let i = start; i <= end; i++) {
      promises.push(
        doc.getPage(i).then((page) => {
          const vp = page.getViewport({ scale: 1 })
          result.set(i, { baseWidth: vp.width, baseHeight: vp.height })
        })
      )
    }
    await Promise.all(promises)
  }
  return result
}

/* ------------------------------------------------------------------ */
/*  全文搜索                                                            */
/* ------------------------------------------------------------------ */

interface TextItemWithOffset {
  str: string
  dir: string
  transform: number[]
  width: number
  height: number
  startOffset: number
  endOffset: number
}

/**
 * 获取单页完整文本及每个文本项的位置信息
 */
export async function getPageTextWithOffsets(
  page: PdfjsPage,
): Promise<{ pageText: string; items: TextItemWithOffset[] }> {
  const textContent = await page.getTextContent()
  let fullText = ''
  const items: TextItemWithOffset[] = []

  for (const item of textContent.items) {
    const str = item.str
    if (str) {
      const startOffset = fullText.length
      fullText += str
      const endOffset = fullText.length
      items.push({
        ...item,
        startOffset,
        endOffset,
      })
    }
    fullText += ' '
  }

  return { pageText: fullText.trim(), items }
}

/**
 * 在单页中搜索关键词，返回所有匹配项
 */
export async function searchPage(
  page: PdfjsPage,
  keyword: string,
  caseSensitive = false,
): Promise<PageSearchResult> {
  const { pageText, items } = await getPageTextWithOffsets(page)
  const matches: SearchMatch[] = []

  if (!keyword.trim() || !pageText) {
    return { pageNumber: page.pageNumber, matches, pageText }
  }

  const flags = caseSensitive ? 'g' : 'gi'
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escapedKeyword, flags)

  let match: RegExpExecArray | null
  let matchIndex = 0
  while ((match = regex.exec(pageText)) !== null) {
    const startOffset = match.index
    const endOffset = startOffset + match[0].length

    const overlappingItems = items.filter(
      (item) => item.endOffset > startOffset && item.startOffset < endOffset,
    )

    if (overlappingItems.length > 0) {
      const firstItem = overlappingItems[0]
      const lastItem = overlappingItems[overlappingItems.length - 1]

      const fragments: MatchFragment[] = []
      for (const item of overlappingItems) {
        const itemStart = item.startOffset
        const itemEnd = item.endOffset
        const fragCharStart = Math.max(0, startOffset - itemStart)
        const fragCharEnd = Math.min(item.str.length, endOffset - itemStart)

        const charWidth = item.width / item.str.length
        const fragWidth = (fragCharEnd - fragCharStart) * charWidth
        const fragXOffset = fragCharStart * charWidth

        const fragTransform = [...item.transform]
        fragTransform[4] += fragXOffset

        fragments.push({
          itemIndex: items.indexOf(item),
          charStart: fragCharStart,
          charEnd: fragCharEnd,
          transform: fragTransform,
          width: fragWidth,
          height: item.height,
          itemStr: item.str,
        })
      }

      const totalWidth = (lastItem.transform[4] + lastItem.width) - firstItem.transform[4]
      matches.push({
        pageNumber: page.pageNumber,
        matchIndex: matchIndex++,
        text: match[0],
        startOffset,
        endOffset,
        transform: [...firstItem.transform],
        width: Math.max(totalWidth, firstItem.width),
        height: Math.max(...overlappingItems.map((i) => i.height)),
        fragments,
      })
    }

    if (match.index === regex.lastIndex) {
      regex.lastIndex++
    }
  }

  return { pageNumber: page.pageNumber, matches, pageText }
}

/**
 * 全文搜索：逐页检索，支持取消
 */
export async function searchDocument(
  doc: PdfjsDocument,
  keyword: string,
  caseSensitive = false,
  onProgress?: (pageNumber: number, totalPages: number) => void,
  shouldCancel?: () => boolean,
): Promise<SearchResult> {
  const result: SearchResult = {
    keyword,
    totalMatches: 0,
    totalPages: doc.numPages,
    pages: [],
  }

  if (!keyword.trim()) return result

  for (let i = 1; i <= doc.numPages; i++) {
    if (shouldCancel?.()) break

    const page = await doc.getPage(i)
    const pageResult = await searchPage(page, keyword, caseSensitive)

    if (pageResult.matches.length > 0) {
      result.pages.push(pageResult)
      result.totalMatches += pageResult.matches.length
    }

    onProgress?.(i, doc.numPages)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return result
}

/**
 * 构建高亮层 — 根据搜索结果在页面上绘制高亮矩形
 * 高亮层使用与 PDF.js text layer 完全相同的坐标系统，确保缩放后精确对齐
 */
export function buildHighlightLayer(
  container: HTMLDivElement,
  matches: SearchMatch[],
  viewport: PdfjsViewport,
  currentMatchIndex?: number,
): void {
  container.innerHTML = ''
  container.style.position = 'absolute'
  container.style.top = '0'
  container.style.left = '0'
  container.style.width = `${viewport.width}px`
  container.style.height = `${viewport.height}px`
  container.style.pointerEvents = 'none'
  container.style.zIndex = '4'

  for (const match of matches) {
    const isActive = match.matchIndex === currentMatchIndex

    for (const fragment of match.fragments) {
      const highlight = document.createElement('div')
      highlight.className = 'search-highlight'
      if (isActive) {
        highlight.classList.add('search-highlight--active')
      }

      const [scaleX, skewX, skewY, scaleY, translateX, translateY] = fragment.transform

      const scaledTransform = [
        scaleX * viewport.scale,
        skewX * viewport.scale,
        skewY * viewport.scale,
        scaleY * viewport.scale,
        translateX * viewport.scale,
        translateY * viewport.scale,
      ]

      const width = fragment.width * viewport.scale
      const height = fragment.height * viewport.scale

      highlight.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        width: ${width}px;
        height: ${height}px;
        transform: matrix(${scaledTransform.join(',')});
        transform-origin: 0% 0%;
        background: rgba(255, 235, 59, 0.55);
        border-radius: 2px;
        pointer-events: none;
      `

      container.appendChild(highlight)
    }
  }
}

/**
 * 清除高亮层
 */
export function clearHighlightLayer(container: HTMLDivElement): void {
  container.innerHTML = ''
}
