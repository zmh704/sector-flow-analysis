'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_SCHEMA_VERSION = 2;
const DATA_FILE_PATTERN = /板块资金流向.*\.json$/i;
const FULL_DATE_FILENAME_PATTERN = /(?:^|[^\d])(\d{4})[-年](\d{1,2})[-月](\d{1,2})(?:日|[^\d]|$)/;
const ISO_FILENAME_PATTERN = /(?:^|[^\d])\d{4}-\d{1,2}-\d{1,2}(?:[^\d]|$)/;
const CHINESE_DATE_PATTERN = /(?:^|[^\d])(\d{1,2})月(\d{1,2})日/;
const PRICE_KEYS = ['最高价', '开盘价', '最低价', '收盘价'];

function pad2(value) {
    return String(value).padStart(2, '0');
}

function formatTradingDate(year, month, day) {
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;

    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
        return null;
    }
    return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

function parseFullDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return formatTradingDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    if (typeof value !== 'string' && typeof value !== 'number') return null;

    const text = String(value).trim();
    let match = text.match(/(?:^|\D)(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:\D|$)/);
    if (!match) {
        match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
    }
    return match ? formatTradingDate(match[1], match[2], match[3]) : null;
}

function inferYear(month, day, now = new Date()) {
    const currentYear = now.getFullYear();
    const today = new Date(currentYear, now.getMonth(), now.getDate());
    const candidate = new Date(currentYear, month - 1, day);
    if (Number.isNaN(candidate.getTime())) return null;

    // A yearless filename near New Year may refer to the previous year. Do not use mtime.
    const futureToleranceMs = 31 * 24 * 60 * 60 * 1000;
    return candidate.getTime() - today.getTime() > futureToleranceMs ? currentYear - 1 : currentYear;
}

function parseTradingDate(value, options = {}) {
    const fullDate = parseFullDate(value);
    if (fullDate) return fullDate;
    if (typeof value !== 'string') return null;

    const match = value.match(CHINESE_DATE_PATTERN);
    if (!match) return null;
    const month = Number(match[1]);
    const day = Number(match[2]);
    const now = options.now instanceof Date ? options.now : new Date();
    const year = Number.isInteger(options.year) ? options.year : inferYear(month, day, now);
    return year === null ? null : formatTradingDate(year, month, day);
}

function extractTradingDate(data, filename, options = {}) {
    const fromJson = data && parseTradingDate(data['交易日期'], options);
    if (fromJson) return fromJson;

    const basename = path.basename(filename || '');
    const fullDateMatch = basename.match(FULL_DATE_FILENAME_PATTERN);
    if (fullDateMatch) return formatTradingDate(fullDateMatch[1], fullDateMatch[2], fullDateMatch[3]);
    return parseTradingDate(basename, options);
}

function normalizeSchemaVersion(data) {
    const value = Number(data && (data.schemaVersion ?? data['schemaVersion']));
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

function hasOwnPriceFields(value) {
    return value && typeof value === 'object' && PRICE_KEYS.some(key => {
        const field = value[key];
        return field !== undefined && field !== null && field !== '';
    });
}

function looksLikePriceEncodedStock(value) {
    if (typeof value !== 'string') return false;
    const groups = value.match(/\([^()]*(?:\|[^()]*){8,}\)/g);
    if (!groups) return false;
    return groups.some(group => {
        const fields = group.slice(1, -1).split('|');
        return fields.slice(-4).some(field => field.trim() !== '' && Number.isFinite(Number(field)));
    });
}

function hasStructuredPrices(detail) {
    if (!detail || typeof detail !== 'object') return false;
    return ['high', 'open', 'low', 'close'].some(key => {
        const field = detail[key];
        return field !== undefined && field !== null && field !== '';
    });
}

function containsPriceData(value, seen = new Set()) {
    if (looksLikePriceEncodedStock(value)) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    if (hasOwnPriceFields(value) || hasStructuredPrices(value)) return true;
    if (Array.isArray(value)) return value.some(item => containsPriceData(item, seen));
    return Object.values(value).some(item => containsPriceData(item, seen));
}

function getHasPriceData(data) {
    if (typeof data?.hasPriceData === 'boolean') return data.hasPriceData;
    return containsPriceData(data);
}

function isIsoFilename(filePath) {
    return ISO_FILENAME_PATTERN.test(path.basename(filePath));
}

function comparePreferred(a, b) {
    return (b.schemaVersion - a.schemaVersion)
        || (Number(b.hasPriceData) - Number(a.hasPriceData))
        || (Number(isIsoFilename(b.path)) - Number(isIsoFilename(a.path)))
        || a.path.localeCompare(b.path, 'zh-CN');
}

function compareManifestEntries(a, b) {
    return a.tradingDate.localeCompare(b.tradingDate) || a.path.localeCompare(b.path, 'zh-CN');
}

function toPosixPath(value) {
    return value.split(path.sep).join('/');
}

function readManifestEntry(absolutePath, publicPath, options = {}) {
    let data;
    try {
        data = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    } catch (error) {
        if (options.onError) options.onError(error, absolutePath);
        return null;
    }

    const tradingDate = extractTradingDate(data, publicPath, options);
    if (!tradingDate) return null;
    return {
        path: toPosixPath(publicPath),
        tradingDate,
        schemaVersion: normalizeSchemaVersion(data),
        hasPriceData: getHasPriceData(data),
    };
}

function scanManifestFiles(options = {}) {
    const rootDir = path.resolve(options.rootDir || path.join(__dirname, '..'));
    const dataDir = path.resolve(options.dataDir || path.join(rootDir, 'data'));
    const scanDir = fs.existsSync(dataDir) ? dataDir : rootDir;
    const prefix = scanDir === rootDir ? '' : `${path.relative(rootDir, scanDir)}${path.sep}`;
    let names;
    try {
        names = fs.readdirSync(scanDir);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }

    const entries = names
        .filter(name => DATA_FILE_PATTERN.test(name) && !name.includes('.bak_') && name !== 'list.json')
        .map(name => readManifestEntry(path.join(scanDir, name), prefix + name, options))
        .filter(Boolean);

    const byDate = new Map();
    for (const entry of entries) {
        const current = byDate.get(entry.tradingDate);
        if (!current || comparePreferred(entry, current) < 0) byDate.set(entry.tradingDate, entry);
    }
    return [...byDate.values()].sort(compareManifestEntries);
}

function createManifest(options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    return {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        generatedAt: now.toISOString(),
        files: scanManifestFiles({ ...options, now }),
    };
}

module.exports = {
    MANIFEST_SCHEMA_VERSION,
    createManifest,
    scanManifestFiles,
    readManifestEntry,
    extractTradingDate,
    parseTradingDate,
    normalizeSchemaVersion,
    getHasPriceData,
    comparePreferred,
    compareManifestEntries,
    isIsoFilename,
};
