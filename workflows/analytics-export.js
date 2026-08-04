'use strict';

const { Buffer } = require('node:buffer');

function createAnalyticsExport({ format, dashboard } = {}) {
    const normalized = String(format || '').trim().toLowerCase();
    const baseName = safeFilename(`${dashboard?.business?.name || 'OrexisAI'}-analytics-${dateStamp(dashboard?.generatedAt)}`);
    if (normalized === 'csv') {
        const body = Buffer.from(buildCsv(dashboard), 'utf8');
        return { body, contentType: 'text/csv; charset=utf-8', filename: `${baseName}.csv` };
    }
    if (normalized === 'excel' || normalized === 'xls') {
        const body = Buffer.from(buildSpreadsheetXml(dashboard), 'utf8');
        return { body, contentType: 'application/vnd.ms-excel; charset=utf-8', filename: `${baseName}.xls` };
    }
    if (normalized === 'pdf') {
        return { body: buildPdf(dashboard), contentType: 'application/pdf', filename: `${baseName}.pdf` };
    }
    const error = new Error('Choose CSV, Excel, or PDF export format.');
    error.code = 'INVALID_ANALYTICS_EXPORT';
    error.publicMessage = error.message;
    error.statusCode = 400;
    throw error;
}

function buildAnalyticsEmail(dashboard) {
    const metrics = dashboard?.executive?.metrics || [];
    const recommendations = dashboard?.decisionEngine?.recommendations || [];
    const subject = `${dashboard?.business?.name || 'OrexisAI'} analytics report · ${dashboard?.period?.label || 'latest period'}`;
    const text = [
        subject,
        '',
        ...metrics.map((metric) => `${metric.label}: ${displayValue(metric, dashboard?.business?.currency)}`),
        '',
        'Recommended actions',
        ...recommendations.slice(0, 6).map((item, index) => `${index + 1}. ${item.title} — ${item.reason}`),
        '',
        `Generated ${new Date(dashboard?.generatedAt || Date.now()).toISOString()} from authenticated business records.`
    ].join('\n');
    const html = `<!doctype html><html><body style="margin:0;background:#090a0f;color:#f8fafc;font-family:Arial,sans-serif;padding:28px 14px">
<div style="max-width:720px;margin:0 auto;background:#12141c;border:1px solid #2a2f3d;border-radius:20px;padding:28px">
<div style="font-size:27px;font-weight:700;margin-bottom:6px">Orexis<span style="color:#818cf8">AI</span></div>
<p style="color:#a5adbd;margin:0 0 24px">${escapeHtml(dashboard?.business?.name || 'Business')} · ${escapeHtml(dashboard?.period?.label || 'Latest period')}</p>
<table role="presentation" style="width:100%;border-collapse:collapse">${metrics.map((metric) => `<tr><td style="padding:12px 0;border-bottom:1px solid #292d39;color:#a5adbd">${escapeHtml(metric.label)}</td><td style="padding:12px 0;border-bottom:1px solid #292d39;text-align:right;font-weight:700">${escapeHtml(displayValue(metric, dashboard?.business?.currency))}</td></tr>`).join('')}</table>
<h2 style="font-size:18px;margin:28px 0 12px">Recommended actions</h2>
${recommendations.slice(0, 6).map((item) => `<div style="margin:0 0 12px;padding:14px;border:1px solid #2a2f3d;border-radius:12px"><strong>${escapeHtml(item.title)}</strong><p style="color:#a5adbd;line-height:1.55;margin:7px 0 0">${escapeHtml(item.reason)}</p></div>`).join('') || '<p style="color:#a5adbd">No urgent actions were detected in the selected period.</p>'}
<p style="font-size:12px;color:#737b8c;margin:24px 0 0">Generated from authenticated business records. Values are recalculated when the report is requested.</p>
</div></body></html>`;
    return { subject, text, html };
}

function buildCsv(dashboard) {
    const rows = [['Section', 'Metric', 'Value', 'Change %', 'Confidence', 'Source']];
    for (const metric of dashboard?.executive?.metrics || []) {
        rows.push(['Executive summary', metric.label, rawValue(metric), nullable(metric.changePercentage), nullable(metric.confidence), metric.source || 'business records']);
    }
    for (const item of dashboard?.products?.top || []) {
        rows.push(['Top products', item.productName, item.revenueMinor, nullable(item.revenueChangePercentage), '', `${item.unitsSold} units`]);
    }
    for (const item of dashboard?.inventory?.risks || []) {
        rows.push(['Inventory risk', item.productName, nullable(item.currentStock), '', nullable(item.confidence), `${nullable(item.daysOfCover)} days cover`]);
    }
    for (const item of dashboard?.decisionEngine?.recommendations || []) {
        rows.push(['Recommendation', item.title, item.reason, '', nullable(item.confidence), item.workflowSlug || 'decision engine']);
    }
    return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function buildSpreadsheetXml(dashboard) {
    const metricRows = (dashboard?.executive?.metrics || []).map((metric) => [metric.label, displayValue(metric, dashboard?.business?.currency), nullable(metric.changePercentage), nullable(metric.confidence), metric.source || 'business records']);
    const recommendationRows = (dashboard?.decisionEngine?.recommendations || []).map((item) => [item.priority, item.title, item.reason, nullable(item.confidence), item.actionLabel || '']);
    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#EDE9FE" ss:Pattern="Solid"/></Style></Styles>
${worksheet('Executive Summary', [['Metric', 'Value', 'Change %', 'Confidence', 'Source'], ...metricRows])}
${worksheet('Recommendations', [['Priority', 'Recommendation', 'Reason', 'Confidence', 'Action'], ...recommendationRows])}
${worksheet('Top Products', [['Product', 'Revenue (minor units)', 'Units', 'Orders', 'Change %'], ...(dashboard?.products?.top || []).map((item) => [item.productName, item.revenueMinor, item.unitsSold, item.orderCount, nullable(item.revenueChangePercentage)])])}
${worksheet('Inventory', [['Product', 'Stock', 'Days of cover', 'Risk', 'Reorder point'], ...(dashboard?.inventory?.risks || []).map((item) => [item.productName, nullable(item.currentStock), nullable(item.daysOfCover), item.stockRisk, nullable(item.reorderPoint)])])}
</Workbook>`;
}

function worksheet(name, rows) {
    return `<Worksheet ss:Name="${xmlEscape(name)}"><Table>${rows.map((row, index) => `<Row>${row.map((value) => `<Cell${index === 0 ? ' ss:StyleID="Header"' : ''}><Data ss:Type="${typeof value === 'number' ? 'Number' : 'String'}">${xmlEscape(value)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet>`;
}

function buildPdf(dashboard) {
    const lines = buildPdfLines(dashboard);
    const pages = [];
    const pageSize = 43;
    for (let index = 0; index < lines.length; index += pageSize) pages.push(lines.slice(index, index + pageSize));
    if (pages.length === 0) pages.push(['OrexisAI Analytics Report', 'No analytics records were available.']);

    const objects = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    const pageObjectNumbers = [];
    let objectNumber = 4;
    pages.forEach((pageLines, pageIndex) => {
        const pageObject = objectNumber;
        const contentObject = objectNumber + 1;
        objectNumber += 2;
        pageObjectNumbers.push(pageObject);
        const stream = pdfPageStream(pageLines, pageIndex === 0);
        objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`;
        objects[contentObject] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
    });
    objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pageObjectNumbers.length} >>`;

    let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [0];
    for (let index = 1; index < objects.length; index += 1) {
        offsets[index] = Buffer.byteLength(pdf, 'latin1');
        pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let index = 1; index < objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, 'latin1');
}

function buildPdfLines(dashboard) {
    const currency = dashboard?.business?.currency || 'USD';
    return [
        'OrexisAI Analytics Report',
        `${dashboard?.business?.name || 'Business'} | ${dashboard?.period?.label || 'Selected period'}`,
        `Generated: ${new Date(dashboard?.generatedAt || Date.now()).toISOString()}`,
        '',
        'EXECUTIVE SUMMARY',
        ...(dashboard?.executive?.metrics || []).map((metric) => `${metric.label}: ${displayValue(metric, currency)}${metric.changePercentage === null || metric.changePercentage === undefined ? '' : ` (${Number(metric.changePercentage).toFixed(1)}%)`}`),
        '',
        'BUSINESS HEALTH',
        `Score: ${dashboard?.businessHealth?.score ?? 'Not available'} / 100`,
        ...(dashboard?.businessHealth?.signals || []).map((signal) => `- ${signal.label}: ${signal.status}`),
        '',
        'RECOMMENDED ACTIONS',
        ...(dashboard?.decisionEngine?.recommendations || []).slice(0, 10).flatMap((item, index) => [`${index + 1}. ${item.title}`, `   ${item.reason}`]),
        '',
        'DATA QUALITY',
        ...(dashboard?.dataQuality?.checks || []).map((check) => `- ${check.label}: ${check.status}`)
    ].map((line) => latin1Text(line));
}

function pdfPageStream(lines, firstPage) {
    const commands = ['BT', `/F1 ${firstPage ? 11 : 10} Tf`, '48 748 Td', '14 TL'];
    lines.forEach((line, index) => {
        if (index === 0 && firstPage) commands.push('/F1 18 Tf');
        commands.push(`(${pdfEscape(line)}) Tj`);
        if (index === 0 && firstPage) commands.push('/F1 10 Tf');
        commands.push('T*');
    });
    commands.push('ET');
    return commands.join('\n');
}

function displayValue(metric, currency = 'USD') {
    if (!metric || metric.value === null || metric.value === undefined) return 'Not available yet';
    if (metric.unit === 'minor-currency') {
        try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(metric.value) / 100); } catch { return `${currency} ${(Number(metric.value) / 100).toFixed(2)}`; }
    }
    if (metric.unit === 'percentage') return `${Number(metric.value).toFixed(1)}%`;
    if (metric.unit === 'ratio') return `${Number(metric.value).toFixed(2)}x`;
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(metric.value));
}

function rawValue(metric) {
    return metric?.value === null || metric?.value === undefined ? '' : metric.value;
}

function csvCell(value) {
    const text = String(value ?? '');
    return `"${text.replaceAll('"', '""')}"`;
}

function nullable(value) {
    return value === null || value === undefined ? '' : value;
}

function dateStamp(value) {
    const date = new Date(value || Date.now());
    return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function safeFilename(value) {
    return String(value || 'analytics-report').replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'analytics-report';
}

function latin1Text(value) {
    return String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '?').slice(0, 170);
}

function pdfEscape(value) {
    return latin1Text(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function xmlEscape(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

module.exports = {
    buildAnalyticsEmail,
    createAnalyticsExport
};
