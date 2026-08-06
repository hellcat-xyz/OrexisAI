'use strict';

(() => {
    const root = document.getElementById('businessDataImport');
    if (!root) return;

    const datasetSelect = document.getElementById('inventoryDatasetType');
    const fileInput = document.getElementById('inventoryCsvFile');
    const importButton = document.getElementById('inventoryImportButton');
    const templateButton = document.getElementById('inventoryTemplateButton');
    const refreshButton = document.getElementById('inventoryDataRefreshButton');
    const demoButton = document.getElementById('inventoryDemoButton');
    const removeDemoButton = document.getElementById('inventoryDemoRemoveButton');
    const status = document.getElementById('inventoryImportStatus');
    const summary = document.getElementById('inventoryDataSummary');

    const DATASETS = Object.freeze({
        suppliers: template(['externalId', 'name', 'contactName', 'email', 'phone', 'countryCode', 'defaultLeadTimeDays', 'reliabilityScore', 'active']),
        warehouses: template(['externalId', 'name', 'region', 'countryCode', 'capacityUnits', 'active']),
        products: template(['externalId', 'name', 'sku', 'barcode', 'brand', 'categoryName', 'subcategoryName', 'supplierExternalId', 'manufacturer', 'currency', 'priceMinor', 'costMinor', 'weightGrams', 'dimensions', 'shelfLifeDays', 'storageRequirements', 'currentStock', 'safetyStock', 'reorderPoint', 'reorderQuantity', 'leadTimeDays', 'reorderBufferDays', 'defaultWarehouseExternalId', 'active']),
        customers: template(['externalId', 'name', 'email', 'status', 'firstSeenAt', 'lastActivityAt', 'customerSegment', 'purchaseFrequency', 'region']),
        inventoryPositions: template(['productExternalId', 'warehouseExternalId', 'currentStock', 'reservedStock', 'incomingStock', 'damagedStock', 'returnedStock', 'stockValueMinor', 'countedAt']),
        orders: template(['externalId', 'customerExternalId', 'status', 'currency', 'totalAmountMinor', 'refundedAmountMinor', 'orderedAt', 'sourceName', 'shippingCountryCode', 'couponCode']),
        orderItems: template(['orderExternalId', 'externalId', 'productExternalId', 'quantity', 'unitPriceMinor', 'totalAmountMinor']),
        purchaseOrders: template(['externalId', 'supplierExternalId', 'warehouseExternalId', 'status', 'currency', 'orderDate', 'expectedDeliveryDate', 'actualDeliveryDate', 'shippingDelayDays', 'transitTimeDays', 'totalAmountMinor']),
        purchaseOrderItems: template(['purchaseOrderExternalId', 'externalId', 'productExternalId', 'quantityOrdered', 'quantityReceived', 'unitCostMinor']),
        stockMovements: template(['externalId', 'productExternalId', 'warehouseExternalId', 'movementType', 'quantity', 'occurredAt', 'referenceType', 'referenceExternalId', 'unitCostMinor']),
        promotions: template(['externalId', 'name', 'discountPercentage', 'startsAt', 'endsAt', 'salesChannel', 'active']),
        promotionProducts: template(['promotionExternalId', 'productExternalId']),
        seasonalEvents: template(['externalId', 'name', 'eventType', 'countryCode', 'startsOn', 'endsOn', 'demandMultiplier', 'categoryName']),
        weatherDaily: template(['weatherDate', 'region', 'temperatureC', 'rainfallMm', 'humidityPercentage', 'weatherCondition', 'sourceName', 'observedAt']),
        productDailyMetrics: template(['productExternalId', 'metricDate', 'salesChannel', 'productViews', 'wishlistAdds', 'cartAdds', 'conversions', 'conversionRate'])
    });

    const NUMBER_FIELDS = new Set([
        'defaultLeadTimeDays', 'reliabilityScore', 'capacityUnits', 'priceMinor', 'costMinor', 'weightGrams',
        'shelfLifeDays', 'currentStock', 'safetyStock', 'reorderPoint', 'reorderQuantity', 'leadTimeDays',
        'reorderBufferDays', 'reservedStock', 'incomingStock', 'damagedStock', 'returnedStock', 'stockValueMinor',
        'totalAmountMinor', 'refundedAmountMinor', 'quantity', 'unitPriceMinor', 'shippingDelayDays', 'transitTimeDays',
        'quantityOrdered', 'quantityReceived', 'unitCostMinor', 'discountPercentage', 'demandMultiplier', 'temperatureC',
        'rainfallMm', 'humidityPercentage', 'productViews', 'wishlistAdds', 'cartAdds', 'conversions', 'conversionRate'
    ]);
    const BOOLEAN_FIELDS = new Set(['active']);
    const JSON_FIELDS = new Set(['dimensions', 'metadata']);

    templateButton?.addEventListener('click', downloadTemplate);
    importButton?.addEventListener('click', importCsv);
    refreshButton?.addEventListener('click', () => loadSummary(true));
    demoButton?.addEventListener('click', loadDemoData);
    removeDemoButton?.addEventListener('click', removeDemoData);
    datasetSelect?.addEventListener('change', () => {
        fileInput.value = '';
        setStatus(`Choose a ${humanize(datasetSelect.value)} CSV file.`, 'neutral');
    });

    loadSummary(false);

    function template(columns) {
        return Object.freeze({ columns });
    }

    async function importCsv() {
        const dataset = datasetSelect?.value;
        const definition = DATASETS[dataset];
        const file = fileInput?.files?.[0];
        if (!definition || !file) {
            setStatus('Choose a data type and CSV file first.', 'error');
            return;
        }
        setBusy(importButton, true, 'Importing…');
        try {
            if (file.size > 12 * 1024 * 1024) throw new Error('CSV files cannot exceed 12 MB. Split the import into smaller files.');
            const text = await file.text();
            const records = parseCsv(text);
            if (records.length === 0) throw new Error('The CSV contains no data rows.');
            if (records.length > 10_000) throw new Error('A single import cannot exceed 10,000 records. Split the CSV.');
            const rows = records.map((record, index) => normalizeRecord(record, definition.columns, index));
            const response = await fetch('/api/business/data/import', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ [dataset]: rows })
            });
            const payload = await readJson(response);
            if (!response.ok) throw new Error(payload.error || 'The data could not be imported.');
            const count = Number(payload.import?.counts?.[dataset] || rows.length);
            setStatus(`${count.toLocaleString()} ${humanize(dataset)} records imported.`, 'success');
            fileInput.value = '';
            await loadSummary(true);
        } catch (error) {
            setStatus(error.message || 'The CSV could not be imported.', 'error');
        } finally {
            setBusy(importButton, false, 'Import CSV');
        }
    }

    function normalizeRecord(record, expectedColumns, index) {
        const output = {};
        expectedColumns.forEach((column) => {
            const raw = record[column];
            if (raw === undefined || raw === '') return;
            if (NUMBER_FIELDS.has(column)) {
                const value = Number(raw);
                if (!Number.isFinite(value)) throw new Error(`Row ${index + 2}: ${column} must be a number.`);
                output[column] = value;
                return;
            }
            if (BOOLEAN_FIELDS.has(column)) {
                const value = String(raw).trim().toLowerCase();
                if (!['true', 'false', '1', '0', 'yes', 'no'].includes(value)) throw new Error(`Row ${index + 2}: ${column} must be true or false.`);
                output[column] = ['true', '1', 'yes'].includes(value);
                return;
            }
            if (JSON_FIELDS.has(column)) {
                try {
                    output[column] = JSON.parse(raw);
                } catch {
                    throw new Error(`Row ${index + 2}: ${column} must contain valid JSON.`);
                }
                return;
            }
            output[column] = String(raw).trim();
        });
        return output;
    }

    function parseCsv(text) {
        const rows = [];
        let row = [];
        let field = '';
        let quoted = false;
        const source = String(text || '').replace(/^\uFEFF/, '');
        for (let index = 0; index < source.length; index += 1) {
            const character = source[index];
            if (quoted) {
                if (character === '"' && source[index + 1] === '"') {
                    field += '"';
                    index += 1;
                } else if (character === '"') {
                    quoted = false;
                } else {
                    field += character;
                }
                continue;
            }
            if (character === '"') quoted = true;
            else if (character === ',') {
                row.push(field);
                field = '';
            } else if (character === '\n') {
                row.push(field.replace(/\r$/, ''));
                rows.push(row);
                row = [];
                field = '';
            } else {
                field += character;
            }
        }
        if (field || row.length) {
            row.push(field.replace(/\r$/, ''));
            rows.push(row);
        }
        const nonEmpty = rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ''));
        if (nonEmpty.length < 2) return [];
        const headers = nonEmpty[0].map((header) => String(header).trim());
        const duplicate = headers.find((header, index) => header && headers.indexOf(header) !== index);
        if (duplicate) throw new Error(`The CSV header ${duplicate} appears more than once.`);
        return nonEmpty.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
    }

    function downloadTemplate() {
        const dataset = datasetSelect?.value;
        const definition = DATASETS[dataset];
        if (!definition) return;
        const example = definition.columns.map((column) => exampleValue(column));
        const csv = `${definition.columns.join(',')}\n${example.map(csvCell).join(',')}\n`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `orexisai-${dataset}-template.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    async function loadSummary(announce) {
        try {
            const response = await fetch('/api/business/inventory-data/summary', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            const payload = await readJson(response);
            if (!response.ok) throw new Error(payload.error || 'Inventory data status could not be loaded.');
            renderSummary(payload.summary || {});
            if (announce) setStatus('Inventory data status refreshed.', 'success');
        } catch (error) {
            summary.innerHTML = '<span class="inventory-data-empty">Data status unavailable.</span>';
            if (announce) setStatus(error.message, 'error');
        }
    }

    function renderSummary(data) {
        const metrics = [
            ['Products', data.products],
            ['Warehouses', data.warehouses],
            ['Suppliers', data.suppliers],
            ['Inventory rows', data.inventory_positions],
            ['Sales orders', data.orders],
            ['Order items', data.order_items],
            ['Purchase orders', data.purchase_orders],
            ['Stock movements', data.stock_movements],
            ['Weather days', data.weather_days],
            ['Product metrics', data.product_metrics]
        ];
        summary.replaceChildren(...metrics.map(([label, value]) => {
            const item = document.createElement('div');
            item.className = 'inventory-data-summary-item';
            const strong = document.createElement('strong');
            strong.textContent = Number(value || 0).toLocaleString();
            const span = document.createElement('span');
            span.textContent = label;
            item.append(strong, span);
            return item;
        }));
        root.dataset.demoLoaded = data.demo_loaded ? 'true' : 'false';
        if (demoButton) demoButton.hidden = Boolean(data.demo_loaded);
        if (removeDemoButton) removeDemoButton.hidden = !data.demo_loaded;
        const coverage = document.getElementById('inventoryCoverageText');
        if (coverage) {
            coverage.textContent = data.sales_from
                ? `Sales coverage: ${new Date(data.sales_from).toLocaleDateString()} – ${new Date(data.sales_to).toLocaleDateString()}`
                : 'No product-linked sales history has been imported yet.';
        }
    }

    async function loadDemoData() {
        if (!window.confirm('Load a clearly marked two-year inventory demo dataset? It is blocked when real orders exist and can be removed later.')) return;
        setBusy(demoButton, true, 'Building two years…');
        try {
            const response = await fetch('/api/business/inventory-data/demo', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}' });
            const payload = await readJson(response);
            if (!response.ok) throw new Error(payload.error || 'The demo inventory dataset could not be loaded.');
            setStatus(payload.demo?.alreadyLoaded ? 'The inventory demo dataset is already loaded.' : 'Two-year inventory demo data loaded.', 'success');
            await loadSummary(false);
        } catch (error) {
            setStatus(error.message, 'error');
        } finally {
            setBusy(demoButton, false, 'Load two-year demo data');
        }
    }

    async function removeDemoData() {
        if (!window.confirm('Remove every record from the marked OrexisAI inventory demo dataset?')) return;
        setBusy(removeDemoButton, true, 'Removing…');
        try {
            const response = await fetch('/api/business/inventory-data/demo', { method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json' } });
            const payload = await readJson(response);
            if (!response.ok) throw new Error(payload.error || 'The demo dataset could not be removed.');
            setStatus('Inventory demo data removed.', 'success');
            await loadSummary(false);
        } catch (error) {
            setStatus(error.message, 'error');
        } finally {
            setBusy(removeDemoButton, false, 'Remove demo data');
        }
    }

    function setStatus(message, state) {
        if (!status) return;
        status.textContent = message;
        status.dataset.state = state;
    }

    function setBusy(button, busy, label) {
        if (!button) return;
        button.disabled = busy;
        button.dataset.originalLabel ||= button.textContent;
        button.textContent = busy ? label : button.dataset.originalLabel;
    }

    function readJson(response) {
        return response.json().catch(() => ({}));
    }

    function humanize(value) {
        return String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
    }

    function csvCell(value) {
        const text = String(value ?? '');
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function exampleValue(column) {
        const examples = {
            externalId: 'external-001', productExternalId: 'product-001', warehouseExternalId: 'warehouse-main',
            supplierExternalId: 'supplier-001', purchaseOrderExternalId: 'po-001', promotionExternalId: 'promo-001',
            name: 'Example record', status: 'fulfilled', currency: 'INR', countryCode: 'IN', active: 'true',
            orderDate: '2026-08-01', expectedDeliveryDate: '2026-08-08', actualDeliveryDate: '2026-08-08',
            orderedAt: '2026-08-01T10:00:00.000Z', occurredAt: '2026-08-01T10:00:00.000Z',
            startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-08-08T00:00:00.000Z',
            startsOn: '2026-08-01', endsOn: '2026-08-08', weatherDate: '2026-08-01', metricDate: '2026-08-01',
            dimensions: '{"lengthCm":20,"widthCm":10,"heightCm":5}', movementType: 'stock_in', quantity: '10'
        };
        if (column in examples) return examples[column];
        if (BOOLEAN_FIELDS.has(column)) return 'true';
        if (NUMBER_FIELDS.has(column)) return '10';
        return '';
    }
})();
