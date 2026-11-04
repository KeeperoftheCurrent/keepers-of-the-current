import {formattedDocx} from './docx-format.js';
self.onmessage = async ({data: file}) => {
  try {
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['txt', 'md', 'docx'].includes(extension)) throw new Error('Choose a Word (.docx), plain text (.txt), or Markdown (.md) file. Export other documents to one of these formats first.');
    if (file.size > 5 * 1024 * 1024) throw new Error('Choose a document under 5 MB. Remove embedded pictures if needed; your portrait is uploaded separately.');
    const formatted = extension === 'docx' ? await formattedDocx(await file.arrayBuffer()) : null;
    const raw = formatted ? formatted.text : await file.text();
    const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
    if (!text || text.includes('\0')) throw new Error('No readable story text was found. Try exporting your document as Word (.docx) or plain text (.txt).');
    if (text.length > 500000) throw new Error('This story exceeds 500,000 characters. Please shorten it or import a smaller document. Nothing has been changed.');
    self.postMessage({text,document:formatted?.document,warnings:formatted?.warnings||[]});
  } catch (e) { self.postMessage({error: e.message || 'This document could not be read. Try exporting a new Word or text copy.'}); }
};
