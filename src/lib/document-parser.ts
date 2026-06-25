/* ============================================================
   DocumentParser — 文档解析工具
   混合方案：
   - .txt  → 直接读取
   - .docx  → mammoth.js 提取
   - PDF 文本型 → pdf.js 文本提取
   - PDF 扫描型 → pdf.js Canvas → Base64 图片（供 LLM Vision）

   Worker 加载策略：
   1. Vite dev/prod: 通过 ?url import → Vite 统一处理
   2. Fallback: CDN URL（若 import 失败）
   ============================================================ */

import * as pdfjsLib from 'pdfjs-dist';

// Vite 原生 worker URL 导入 — dev 和 prod 模式下均正确
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// 设置 Worker 源
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
} catch {
  // 极端异常时使用 CDN fallback
  const version = '6.0.227';
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.mjs`;
  console.warn('[DocumentParser] Worker import failed, using CDN fallback');
}

import mammoth from 'mammoth';

// ============================================================
// 类型定义
// ============================================================

/** 解析来源 */
export type ParseSource = 'txt' | 'docx' | 'pdf_text' | 'pdf_scanned';

/** 文档解析结果 */
export interface ParsedDocument {
  /** 提取的纯文本 */
  text: string;
  /** 解析来源 */
  source: ParseSource;
  /** 是否为扫描版（需要 Vision 进一步处理） */
  isScanned: boolean;
  /** Markdown 渲染用文件名 */
  fileName: string;
  /** 扫描版 PDF 的页面图片 Base64 数组（仅 isScanned=true 时有内容） */
  pageImages?: string[];
  /** 总页数 */
  pageCount: number;
}

/** PDF 页面渲染为图片的结果 */
export interface PdfPageImage {
  pageNumber: number;
  /** Base64 data URL (image/jpeg) */
  dataUrl: string;
}

// ============================================================
// 主入口：自动识别并解析
// ============================================================

/**
 * 根据文件类型自动选择合适的解析策略
 */
export async function extractDocumentText(file: File): Promise<ParsedDocument> {
  const extension = file.name.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'txt':
      return extractTxt(file);

    case 'docx':
      return extractDocx(file);

    case 'pdf':
      return extractPdf(file);

    default:
      return {
        text: `无法解析的文件格式：.${extension}，请上传 PDF、Word 或 TXT 格式的简历文件。`,
        source: 'txt',
        isScanned: false,
        fileName: file.name,
        pageCount: 0,
      };
  }
}

// ============================================================
// TXT 解析
// ============================================================

async function extractTxt(file: File): Promise<ParsedDocument> {
  const text = await file.text();
  return {
    text,
    source: 'txt',
    isScanned: false,
    fileName: file.name,
    pageCount: 1,
  };
}

// ============================================================
// DOCX 解析（mammoth.js）
// ============================================================

async function extractDocx(file: File): Promise<ParsedDocument> {
  const buffer = await file.arrayBuffer();

  try {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    const text = result.value.trim();

    if (!text || text.length < 5) {
      return {
        text: `文件「${file.name}」解析后内容过短，可能是空白文档或内容为纯图片。请尝试粘贴简历文本。`,
        source: 'docx',
        isScanned: false,
        fileName: file.name,
        pageCount: 1,
      };
    }

    return {
      text,
      source: 'docx',
      isScanned: false,
      fileName: file.name,
      pageCount: 1,
    };
  } catch (err) {
    console.error('DOCX parse error:', err);
    return {
      text: `解析 Word 文档「${file.name}」时出错：${err instanceof Error ? err.message : '未知错误'}。请尝试粘贴简历文本。`,
      source: 'docx',
      isScanned: false,
      fileName: file.name,
      pageCount: 1,
    };
  }
}

// ============================================================
// PDF 解析（pdf.js：文本提取 → 检测扫描件 → Canvas 渲染）
// ============================================================

async function extractPdf(file: File): Promise<ParsedDocument> {
  const buffer = await file.arrayBuffer();

  try {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const totalPages = pdf.numPages;

    // 第一步：尝试文本提取
    const pageTexts: string[] = [];
    for (let i = 1; i <= totalPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const rawText = content.items
          .map((item: { str?: string }) => item.str || '')
          .join('');
        // 后处理：清理 PDF 常见的问题
        pageTexts.push(normalizePdfText(rawText));
      } catch {
        pageTexts.push('');
      }
    }

    const fullText = pageTexts.join('\n\n').trim();

    // ===== 诊断日志 =====
    console.log('[DocumentParser.extractPdf] === PDF 文本提取完成 ===');
    console.log('[DocumentParser.extractPdf] 总页数:', totalPages);
    console.log('[DocumentParser.extractPdf] 提取文本长度:', fullText.length);
    console.log('[DocumentParser.extractPdf] 前300字符预览:', fullText.slice(0, 300));

    // 第二步：检测是否为扫描版 PDF（改进版阈值）
    if (isScannedPdf(fullText, totalPages)) {
      console.log(`[DocumentParser] 检测到扫描版 PDF（${totalPages}页），渲染为图片供 Vision 使用`);

      // 渲染所有页面为 Base64 图片
      const images: string[] = [];
      for (let i = 1; i <= totalPages; i++) {
        try {
          const page = await pdf.getPage(i);
          const image = await renderPageToImage(page, i);
          images.push(image.dataUrl);
        } catch (err) {
          console.error(`[DocumentParser] 第${i}页渲染失败:`, err);
        }
      }

      return {
        text: `[扫描版PDF] ${file.name}，共 ${totalPages} 页，已将页面转为图片供 AI 识读`,
        source: 'pdf_scanned',
        isScanned: true,
        fileName: file.name,
        pageImages: images,
        pageCount: totalPages,
      };
    }

    // 文本型 PDF：直接返回提取的文本
    if (!fullText || fullText.length < 10) {
      return {
        text: `PDF 文件「${file.name}」未能提取到有效文本内容，可能是扫描版或加密文档。`,
        source: 'pdf_text',
        isScanned: false,
        fileName: file.name,
        pageCount: totalPages,
      };
    }

    return {
      text: fullText,
      source: 'pdf_text',
      isScanned: false,
      fileName: file.name,
      pageCount: totalPages,
    };
  } catch (err) {
    console.error('PDF parse error:', err);
    return {
      text: `解析 PDF 文件「${file.name}」时出错：${err instanceof Error ? err.message : '未知错误'}。请尝试粘贴简历文本。`,
      source: 'pdf_text',
      isScanned: false,
      fileName: file.name,
      pageCount: 0,
    };
  }
}

// ============================================================
// PDF 文本规范化
// ============================================================

/**
 * 清理 PDF 文本提取的常见问题：
 * 1. CJK 字符间多余空格："姓 名" → "姓名"
 * 2. 多余换行和空白
 * 3. 全角/半角标点统一
 */
function normalizePdfText(text: string): string {
  let cleaned = text;

  // 1. 移除 CJK 字符之间的多余空格
  //    中文/日文/韩文字符后面紧跟空格再接 CJK → 移除该空格
  cleaned = cleaned.replace(/([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af])\s+([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af])/g, '$1$2');

  // 2. 中文冒号/逗号前的不必要空格
  cleaned = cleaned.replace(/\s+([：；，。！？、])/g, '$1');

  // 3. 无意义的多余换行（保留段落间双换行）
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // 4. PDF 常出现的零宽字符
  cleaned = cleaned.replace(/[\u200b\u200c\u200d\u200e\u200f\ufeff]/g, '');

  // 5. 多余空格（> 2 个连续空格 → 1 个）
  cleaned = cleaned.replace(/ {3,}/g, '  ').trim();

  return cleaned;
}

// ============================================================
// 检测扫描版 PDF（改进版）
// ============================================================

/**
 * 判断是否为扫描版 PDF
 * 多维度检测策略：
 *   1. 文本完全为空 → 扫描版
 *   2. 每页平均 CJK 字符 < 8 → 扫描版
 *   3. 文本严重碎片化（大量单字符行） → 可能是扫描版但 pdf.js 勉强提取到
 */
function isScannedPdf(text: string, totalPages: number): boolean {
  if (!text) return true;

  // 去除规范化后剩余的空白再统计
  const compactText = text.replace(/\s+/g, '');
  if (compactText.length < 10) return true; // 几乎无内容

  const chineseCharCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWordCount = text.split(/\s+/).filter(w => w.length > 1).length;
  const totalContent = chineseCharCount + englishWordCount;

  // 平均每页 CJK 字符 < 8 → 扫描版（正常文本 PDF 至少几十个/页）
  const avgPerPage = totalContent / Math.max(totalPages, 1);
  if (avgPerPage < 8) return true;

  // 检测碎片化：单独成行的单字符过多 → 可能是扫描版弱提取
  const lines = text.split('\n').filter(l => l.trim().length === 1);
  if (lines.length > 10 && lines.length > text.split('\n').length * 0.3) return true;

  return false;
}

// ============================================================
// PDF 页面 → Canvas → Base64
// ============================================================

/**
 * 将 PDF 页面渲染为 Base64 JPEG
 * @param page pdf.js Page 对象
 * @param pageNumber 页码（仅用于日志）
 * @returns 图片数据
 */
async function renderPageToImage(
  page: pdfjsLib.PDFPageProxy,
  pageNumber: number
): Promise<PdfPageImage> {
  const scale = 2.0; // 2x 分辨率确保 OCR 精度
  const viewport = page.getViewport({ scale });

  // 使用 OffscreenCanvas 避免 DOM 依赖（Vite 构建时可能走 SSR）
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(viewport.width, viewport.height)
    : document.createElement('canvas');

  if (canvas instanceof HTMLCanvasElement) {
    canvas.width = viewport.width;
    canvas.height = viewport.height;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error(`第${pageNumber}页：无法获取 Canvas 渲染上下文`);
  }

  await page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;

  // OffscreenCanvas → Blob → Base64
  const blob = canvas instanceof OffscreenCanvas
    ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    : await new Promise<Blob>((resolve) =>
        (canvas as HTMLCanvasElement).toBlob(r => resolve(r!), 'image/jpeg', 0.85)
      );

  const dataUrl = await blobToDataUrl(blob);

  return { pageNumber, dataUrl };
}

/** Blob → Base64 data URL */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Blob 转 Base64 失败'));
    reader.readAsDataURL(blob);
  });
}
