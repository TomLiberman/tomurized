// Client-side text extraction from uploaded study-material files (PDF / DOCX / text).

import { t } from '../i18n';

export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.pdf')) {
    const pdfjs: any = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const data = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data }).promise;
    let out = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      out += content.items.map((it: any) => (it && typeof it.str === 'string' ? it.str : '')).join(' ') + '\n';
    }
    return out.replace(/[ \t]+\n/g, '\n').trim();
  }

  if (name.endsWith('.docx')) {
    const mod: any = await import('mammoth');
    const mammoth = mod.default ?? mod;
    const data = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: data });
    return (result?.value || '').trim();
  }

  if (name.endsWith('.doc')) {
    throw new Error(t('err_doc_unsupported'));
  }

  // Plain-text formats: txt, md, csv, json, rtf, etc.
  return (await file.text()).trim();
}
