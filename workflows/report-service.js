'use strict';

const zlib = require('node:zlib');

function createMarketingReportService() {
    return {
        async generate({ business, report, images = [], generatedAt = new Date().toISOString() }) {
            const normalized = normalizeReport(report);
            const safeName = slugify(business.name || 'business');
            const date = generatedAt.slice(0, 10);
            const imageInventory = images
                .filter((item) => item && (item.id || item.title))
                .map((item) => ({ title: item.title || 'Marketing creative', filename: item.filename || null, artifactId: item.id || null }));
            const reportWithImages = { ...normalized, generatedImages: imageInventory };
            return [
                {
                    artifactType: 'report',
                    sectionKey: 'weekly-report',
                    title: 'Weekly Marketing Report (PDF)',
                    filename: `${safeName}-weekly-marketing-${date}.pdf`,
                    mimeType: 'application/pdf',
                    binary: createPdfBuffer({ business, report: reportWithImages, generatedAt }),
                    metadata: { format: 'pdf', generatedAt, generatedImageCount: imageInventory.length }
                },
                {
                    artifactType: 'report',
                    sectionKey: 'weekly-report',
                    title: 'Weekly Marketing Report (DOCX)',
                    filename: `${safeName}-weekly-marketing-${date}.docx`,
                    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    binary: createDocxBuffer({ business, report: reportWithImages, images, generatedAt }),
                    metadata: { format: 'docx', generatedAt, generatedImageCount: imageInventory.length }
                }
            ];
        }
    };
}

function createPdfBuffer({ business, report, generatedAt }) {
    const lines = buildReportLines({ business, report, generatedAt });
    const pages = paginate(lines, 54);
    const objects = [];
    const add = (body) => { objects.push(body); return objects.length; };
    const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const boldFontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const pagesId = add('');
    const pageIds = [];

    for (const page of pages) {
        let y = 790;
        const commands = ['BT'];
        for (const line of page) {
            const font = line.kind === 'title' || line.kind === 'heading' ? 'F2' : 'F1';
            const size = line.kind === 'title' ? 20 : line.kind === 'heading' ? 13 : 9.5;
            const leading = line.kind === 'title' ? 28 : line.kind === 'heading' ? 20 : 13;
            commands.push(`/${font} ${size} Tf`, `1 0 0 1 54 ${y} Tm`, `(${escapePdf(line.text)}) Tj`);
            y -= leading;
        }
        commands.push('ET');
        const stream = commands.join('\n');
        const contentId = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
        const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
        pageIds.push(pageId);
    }
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    const infoId = add(`<< /Title (${escapePdf(`${business.name} Weekly Marketing Report`)}) /Author (OrexisAI) /CreationDate (D:${pdfDate(generatedAt)}) >>`);

    let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(body, 'binary'));
        body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(body, 'binary');
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(body, 'binary');
}

function createDocxBuffer({ business, report, images, generatedAt }) {
    const paragraphs = buildReportLines({ business, report, generatedAt });
    const usableImages = (Array.isArray(images) ? images : []).filter((item) => Buffer.isBuffer(item.binary) && item.binary.length > 0).slice(0, 12);
    const relations = usableImages.map((item, index) => ({
        id: `rId${index + 2}`,
        target: `media/image${index + 1}.${imageExtension(item.mimeType)}`,
        item
    }));
    const bodyXml = paragraphs.map((line) => paragraphXml(line.text, line.kind)).join('')
        + (relations.length ? paragraphXml('Generated Images', 'heading') : '')
        + relations.flatMap((relation, index) => [
            paragraphXml(relation.item.title || `Marketing creative ${index + 1}`, 'body'),
            imageParagraphXml(relation.id, relation.item.title || 'Marketing creative', index + 1)
        ]).join('');
    const documentXml = xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
    const relsXml = xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${relations.map((relation) => `<Relationship Id="${relation.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${relation.target}"/>`).join('')}</Relationships>`);
    const imageTypes = [...new Set(relations.map((relation) => imageExtension(relation.item.mimeType)))];
    const entries = [
        ['[Content_Types].xml', xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageTypes.map((ext) => `<Default Extension="${ext}" ContentType="${imageMime(ext)}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`)],
        ['_rels/.rels', xml('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')],
        ['word/document.xml', documentXml],
        ['word/styles.xml', stylesXml()],
        ['word/_rels/document.xml.rels', relsXml],
        ...relations.map((relation) => [`word/${relation.target}`, relation.item.binary])
    ];
    return createZip(entries);
}

function buildReportLines({ business, report, generatedAt }) {
    const lines = [
        { kind: 'title', text: `${business.name} Weekly Marketing Report` },
        { kind: 'body', text: `Generated ${formatDate(generatedAt)} | ${business.industry || business.business_type || 'Business'}` }
    ];
    const sections = [
        ['Executive Summary', report.summary], ['SWOT Analysis', report.swotAnalysis],
        ['Competitor Report', report.competitorReport], ['Market Trends', report.marketTrends],
        ['Market Opportunities', report.marketOpportunities], ['Customer Pain Points', report.customerPainPoints],
        ['Product Positioning', report.productPositioning], ['AI Recommendations', report.aiRecommendations],
        ['Recommended Marketing Strategy', report.marketingStrategy], ['Marketing Assets', report.marketingAssets],
        ['SEO Report', report.seoReport], ['Performance Suggestions', report.performanceSuggestions],
        ['Generated Images', report.generatedImages], ['Data Availability and Limitations', report.dataLimitations]
    ];
    for (const [title, value] of sections) {
        const content = flattenContent(value);
        if (!content.length) continue;
        lines.push({ kind: 'heading', text: title });
        for (const item of content) {
            const prefix = item.kind === 'bullet' ? '- ' : '';
            for (const text of wrapText(`${prefix}${item.text}`, 92)) lines.push({ kind: 'body', text });
        }
    }
    return lines;
}

function paragraphXml(text, kind = 'body') {
    const style = kind === 'title' ? '<w:pStyle w:val="Title"/>' : kind === 'heading' ? '<w:pStyle w:val="Heading1"/>' : '';
    return `<w:p><w:pPr>${style}</w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function imageParagraphXml(relationId, name, id) {
    return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="5486400" cy="3086100"/><wp:docPr id="${id}" name="${escapeXml(name)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function stylesXml() {
    return xml('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="21"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style></w:styles>');
}

function createZip(entries) {
    const local = [];
    const central = [];
    let offset = 0;
    for (const [name, raw] of entries) {
        const nameBuffer = Buffer.from(name);
        const data = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
        const compressed = zlib.deflateRawSync(data, { level: 6 });
        const crc = crc32(data);
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0, 6);
        header.writeUInt16LE(8, 8); header.writeUInt16LE(0, 10); header.writeUInt16LE(0, 12);
        header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22);
        header.writeUInt16LE(nameBuffer.length, 26); header.writeUInt16LE(0, 28);
        local.push(header, nameBuffer, compressed);
        const record = Buffer.alloc(46);
        record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
        record.writeUInt16LE(0, 8); record.writeUInt16LE(8, 10); record.writeUInt16LE(0, 12); record.writeUInt16LE(0, 14);
        record.writeUInt32LE(crc, 16); record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(data.length, 24);
        record.writeUInt16LE(nameBuffer.length, 28); record.writeUInt16LE(0, 30); record.writeUInt16LE(0, 32);
        record.writeUInt16LE(0, 34); record.writeUInt16LE(0, 36); record.writeUInt32LE(0, 38); record.writeUInt32LE(offset, 42);
        central.push(record, nameBuffer);
        offset += header.length + nameBuffer.length + compressed.length;
    }
    const centralBuffer = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
    return Buffer.concat([...local, centralBuffer, end]);
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function flattenContent(value, label = '') {
    if (value === null || value === undefined || value === '') return [];
    if (['string', 'number', 'boolean'].includes(typeof value)) return [{ kind: label ? 'bullet' : 'text', text: label ? `${humanize(label)}: ${String(value)}` : String(value) }];
    if (Array.isArray(value)) return value.flatMap((item) => ['string', 'number'].includes(typeof item) ? [{ kind: 'bullet', text: String(item) }] : flattenContent(item));
    if (typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => {
        if (Array.isArray(item) || (item && typeof item === 'object')) return [{ kind: 'label', text: humanize(key) }, ...flattenContent(item)];
        return flattenContent(item, key);
    });
    return [];
}

function normalizeReport(report) {
    const source = report && typeof report === 'object' ? report : {};
    return {
        summary: source.summary || source.executiveSummary || '', swotAnalysis: source.swotAnalysis || source.swot || {},
        competitorReport: source.competitorReport || source.competitorAnalysis || '', marketTrends: source.marketTrends || '',
        marketOpportunities: source.marketOpportunities || source.opportunities || [], customerPainPoints: source.customerPainPoints || [],
        productPositioning: source.productPositioning || '', aiRecommendations: source.aiRecommendations || source.recommendations || [],
        marketingStrategy: source.marketingStrategy || source.recommendedMarketingStrategy || '', marketingAssets: source.marketingAssets || {},
        seoReport: source.seoReport || source.seo || {}, performanceSuggestions: source.performanceSuggestions || [], dataLimitations: source.dataLimitations || []
    };
}

function paginate(lines, maxLines) { const pages = []; for (let i = 0; i < lines.length; i += maxLines) pages.push(lines.slice(i, i + maxLines)); return pages.length ? pages : [[{ kind: 'body', text: 'No report content available.' }]]; }
function wrapText(value, width) { const words = String(value || '').split(/\s+/); const lines = []; let line = ''; for (const word of words) { if ((line + ' ' + word).trim().length > width && line) { lines.push(line); line = word; } else line = (line + ' ' + word).trim(); } if (line) lines.push(line); return lines; }
function escapePdf(value) { return String(value || '').replace(/[^\x20-\x7E]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function escapeXml(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function xml(value) { return Buffer.from(value, 'utf8'); }
function humanize(value) { return String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()); }
function slugify(value) { return String(value || 'business').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'business'; }
function formatDate(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : String(value || ''); }
function pdfDate(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z' : ''; }
function imageExtension(mimeType) { return String(mimeType || '').toLowerCase().includes('jpeg') ? 'jpg' : String(mimeType || '').toLowerCase().includes('gif') ? 'gif' : 'png'; }
function imageMime(extension) { return extension === 'jpg' ? 'image/jpeg' : extension === 'gif' ? 'image/gif' : 'image/png'; }

module.exports = { createMarketingReportService, flattenContent, normalizeReport };
