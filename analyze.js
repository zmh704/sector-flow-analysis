const XLSX = require('xlsx');
const {
    normalizeStockName,
    normalizeStockCode,
    getStockMarket,
    getStockKey
} = require('./stock-utils.js');
const { parseTradingDate } = require('./lib/manifest.js');

const EMPTY_VALUES = new Set(['', '--', 'None', 'none', 'nan', 'NaN', 'null', 'NULL', 'N/A', 'n/a']);
const NUMERIC_UNIT_FACTORS = Object.freeze({
    '': 1,
    '元': 1,
    '手': 1,
    '万': 1e4,
    '万元': 1e4,
    '万手': 1e4,
    '亿': 1e8,
    '亿元': 1e8,
    '亿手': 1e8,
    '%': 1,
    '％': 1
});
const AMOUNT_UNITS = new Set(['', '元', '万', '万元', '亿', '亿元']);
const PERCENT_UNITS = new Set(['', '%', '％']);
const VOLUME_UNITS = new Set(['', '手', '万', '万手', '亿', '亿手']);

/** 格式化金额：亿/万。 */
function formatCurrency(num) {
    if (Math.abs(num) >= 1e8) return (num / 1e8).toFixed(2) + '亿';
    if (Math.abs(num) >= 1e4) return (num / 1e4).toFixed(2) + '万';
    return num.toFixed(2);
}

/** 解析板块字符串（行业/概念可能多个，用换行/分号/逗号分隔）。 */
function parseSectors(raw) {
    const text = raw == null ? '' : String(raw).trim();
    if (!text || ['--', 'None', 'nan'].includes(text)) return [];
    return text.replace(/\n/g, ',').replace(/;/g, ',').replace(/，/g, ',')
        .split(',').map(s => s.trim())
        .filter(s => s && !['--', 'None', 'nan', '所属行业', '所属概念'].includes(s));
}

function isEmptyValue(value) {
    return value == null || (typeof value === 'string' && EMPTY_VALUES.has(value.trim()));
}

/**
 * 严格解析数值。支持 number、合法千分位、元/万/亿、手及百分比。
 * 金额和数量统一换算为基础单位；百分比保留百分数（例如 12.5% -> 12.5）。
 */
function parseNumericToken(value) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError(`无效数值: ${String(value)}`);
        return { value, unit: '', hasExplicitUnit: false };
    }
    if (typeof value !== 'string' || isEmptyValue(value)) {
        throw new TypeError(`无效数值: ${value == null ? String(value) : JSON.stringify(value)}`);
    }

    const text = value.trim();
    const match = text.match(/^([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+))\s*(亿元|万元|亿手|万手|元|亿|万|手|%|％)?$/);
    if (!match) throw new TypeError(`无效数值: ${JSON.stringify(value)}`);

    const numericPart = match[1].replace(/,/g, '');
    const unit = match[2] || '';
    const parsed = Number(numericPart);
    const result = parsed * NUMERIC_UNIT_FACTORS[unit];
    if (!Number.isFinite(parsed) || !Number.isFinite(result)) {
        throw new TypeError(`无效数值: ${JSON.stringify(value)}`);
    }
    return { value: result, unit, hasExplicitUnit: !!match[2] };
}

function parseNumericValue(value) {
    return parseNumericToken(value).value;
}

function inferColumnMultiplier(columnName, kind) {
    const name = String(columnName || '');
    if (kind === 'amount') {
        if (/亿(?:元)?/.test(name)) return 1e8;
        if (/万(?:元)?/.test(name)) return 1e4;
    } else if (kind === 'volume') {
        if (/亿(?:手)?/.test(name)) return 1e8;
        if (/万(?:手)?/.test(name)) return 1e4;
    }
    return 1;
}

function numericError(rowNumber, columnName, value, reason = '数值无效') {
    const shown = typeof value === 'string' ? JSON.stringify(value) : String(value);
    return new Error(`Excel 第 ${rowNumber} 行「${columnName}」列${reason}: ${shown}`);
}

function parseCellNumber(value, { rowNumber, columnName, kind, required }) {
    if (isEmptyValue(value)) {
        if (required) throw numericError(rowNumber, columnName, value);
        return null;
    }

    try {
        const token = parseNumericToken(value);
        const allowedUnits = kind === 'amount' ? AMOUNT_UNITS
            : kind === 'change' || kind === 'price' ? PERCENT_UNITS
                : kind === 'volume' ? VOLUME_UNITS : new Set(['']);
        if (!allowedUnits.has(token.unit) || (kind === 'price' && token.unit)) {
            throw numericError(rowNumber, columnName, value, `单位“${token.unit}”不适用`);
        }
        return token.value * (token.hasExplicitUnit ? 1 : inferColumnMultiplier(columnName, kind));
    } catch (error) {
        if (error && /^Excel 第 /.test(error.message)) throw error;
        throw numericError(rowNumber, columnName, value);
    }
}

function buildStockKey(codeValue, nameValue) {
    return getStockKey(codeValue, nameValue);
}

/** 自动识别 Excel 列名。 */
function detectColumns(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return {};
    const colMap = {};
    const candidates = {
        name: ['股票简称', '简称', 'stock_name', 'name', '证券简称'],
        code: ['股票代码', '代码', 'stock_code', 'code', '证券代码'],
        industry: ['行业板块', '所属行业', '行业', 'industry'],
        concept: ['概念板块', '所属概念', '概念', 'concept'],
        net: ['主力净额', '主力资金净额', '主力净买入', 'main_net'],
        turnover: ['成交额', '总成交额', '成交金额', '成交额(元)'],
        change: ['涨跌幅', '涨跌幅(%)', '涨跌幅度', 'change_pct'],
        volume: ['成交量(手)', '成交量', '成交股数', 'vol'],
        high: ['最高价', '最高价.前复权', '最高'],
        open: ['开盘价', '开盘价.前复权', '开盘'],
        low: ['最低价', '最低价.前复权', '最低'],
        close: ['收盘价', '收盘价.前复权', '收盘']
    };
    const cols = Object.keys(rows[0]);
    for (const [key, names] of Object.entries(candidates)) {
        let found = cols.find(c => names.includes(String(c).trim()));
        if (!found) found = cols.find(c => names.some(n => String(c).includes(n) || n.includes(String(c))));
        if (found) colMap[key] = found;
    }
    return colMap;
}

function getExcelRowNumber(row, index) {
    return Number.isInteger(row && row.__rowNum__) ? row.__rowNum__ + 1 : index + 2;
}

function formatSignedCurrency(value) {
    return (value >= 0 ? '+' : '') + formatCurrency(value);
}

function formatChange(value) {
    return value == null ? '' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatVolume(value) {
    return value == null ? '' : `${(value / 1e4).toFixed(0)}万手`;
}

function formatLegacyOptional(value) {
    return value == null ? '' : String(value);
}

function makeStockString(detail, includeChange, includePrices) {
    const parts = [detail.code, detail.amountText, detail.netText];
    if (includeChange) parts.push(detail.changeText);
    parts.push(detail.volumeText);
    if (includePrices) {
        parts.push(detail.high, detail.open, detail.low, detail.close);
    }
    return `${detail.name}(${parts.map(formatLegacyOptional).join('|')})`;
}

function differingDetailFields(left, right) {
    return Object.keys(left).filter(key => !Object.is(left[key], right[key]));
}

function addStockToSector(stats, sectorName, stock, rowNumber, turnover, net) {
    let sector = stats[sectorName];
    if (!sector) {
        sector = stats[sectorName] = {
            totalNet: 0,
            totalTurnover: 0,
            stocks: [],
            details: [],
            stockByKey: new Map()
        };
    }

    const existing = sector.stockByKey.get(stock.detail.stockKey);
    if (existing) {
        const conflictFields = differingDetailFields(existing.detail, stock.detail);
        if (conflictFields.length === 0) return;
        const stockLabel = stock.detail.code
            ? `${stock.detail.name}(${stock.detail.code})`
            : stock.detail.name;
        throw new Error(
            `板块“${sectorName}”内股票“${stockLabel}”数据冲突：原行号 ${existing.rowNumber}，` +
            `冲突行号 ${rowNumber}；冲突字段: ${conflictFields.join(', ')}`
        );
    }

    sector.stockByKey.set(stock.detail.stockKey, { detail: stock.detail, rowNumber });
    sector.totalNet += net;
    sector.totalTurnover += turnover;
    sector.stocks.push(stock.legacyText);
    sector.details.push(stock.detail);
}

/**
 * 分析资金流向，返回行业/概念板块统计行。
 * 同一板块按 stockKey 去重；重复数据仅聚合一次，冲突数据明确报错。
 */
function analyzeFundFlow(workbook) {
    if (!workbook || !Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
        throw new Error('Excel 文件为空');
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (rows.length === 0) throw new Error('Excel 文件为空');

    const colMap = detectColumns(rows);
    const required = ['name', 'industry', 'concept', 'net', 'turnover'];
    const missing = required.filter(key => !colMap[key]);
    if (missing.length > 0) {
        throw new Error('无法找到必要列: ' + missing.join(', ') + '。可用列: ' + Object.keys(rows[0]).join(', '));
    }

    const industryStats = Object.create(null);
    const conceptStats = Object.create(null);
    const hasChange = !!colMap.change;
    const hasPrices = ['high', 'open', 'low', 'close'].some(key => !!colMap[key]);

    rows.forEach((row, index) => {
        const name = normalizeStockName(row[colMap.name]);
        if (!name) return;
        const rowNumber = getExcelRowNumber(row, index);
        const code = colMap.code ? normalizeStockCode(row[colMap.code]) : '';
        const stockKey = buildStockKey(colMap.code ? row[colMap.code] : '', name);
        const turnover = parseCellNumber(row[colMap.turnover], {
            rowNumber, columnName: colMap.turnover, kind: 'amount', required: true
        });
        const net = parseCellNumber(row[colMap.net], {
            rowNumber, columnName: colMap.net, kind: 'amount', required: true
        });
        const change = colMap.change ? parseCellNumber(row[colMap.change], {
            rowNumber, columnName: colMap.change, kind: 'change', required: false
        }) : null;
        const volume = colMap.volume ? parseCellNumber(row[colMap.volume], {
            rowNumber, columnName: colMap.volume, kind: 'volume', required: false
        }) : null;
        const readPrice = key => colMap[key] ? parseCellNumber(row[colMap[key]], {
            rowNumber, columnName: colMap[key], kind: 'price', required: false
        }) : null;
        const high = readPrice('high');
        const open = readPrice('open');
        const low = readPrice('low');
        const close = readPrice('close');

        const detail = {
            stockKey,
            name,
            code,
            amountText: formatCurrency(turnover),
            netText: formatSignedCurrency(net),
            changeText: formatChange(change),
            volumeText: formatVolume(volume),
            amountYi: turnover / 1e8,
            netYi: net / 1e8,
            changePct: change,
            volumeWanShou: volume == null ? null : volume / 1e4,
            high,
            open,
            low,
            close
        };
        const stock = {
            detail,
            legacyText: makeStockString(detail, hasChange, hasPrices)
        };

        for (const industry of new Set(parseSectors(row[colMap.industry]))) {
            addStockToSector(industryStats, industry, stock, rowNumber, turnover, net);
        }
        for (const concept of new Set(parseSectors(row[colMap.concept]))) {
            addStockToSector(conceptStats, concept, stock, rowNumber, turnover, net);
        }
    });

    const makeRows = stats => Object.entries(stats).map(([name, data]) => ({
        '板块': name,
        '成交额': data.totalTurnover,
        '主力净额': data.totalNet,
        '股票数量': data.details.length,
        '涉及股票': data.stocks.join(', '),
        '股票明细': data.details
    })).sort((a, b) => b['主力净额'] - a['主力净额']);

    return { industryRows: makeRows(industryStats), conceptRows: makeRows(conceptStats) };
}

/** 从来源名称提取 ISO 交易日期。 */
function extractTradeDate(sourceName, options = {}) {
    return parseTradingDate(sourceName, {
        year: options.referenceYear == null ? undefined : Number(options.referenceYear)
    });
}

/** 构建完整结果对象。第三个 options 参数为新增参数，旧的两参数调用保持兼容。 */
function buildAnalysisResult(workbook, sourceName, options = {}) {
    const { industryRows, conceptRows } = analyzeFundFlow(workbook);
    return {
        schemaVersion: 2,
        '交易日期': extractTradeDate(sourceName, options),
        '生成时间': new Date().toLocaleString('zh-CN', { hour12: false }),
        '数据来源': sourceName,
        '行业板块资金流向': industryRows,
        '概念板块资金流向': conceptRows,
        '分析总结': {
            '净流入最多行业': industryRows[0] || null,
            '净流出最多行业': industryRows.length > 0 && industryRows[industryRows.length - 1]['主力净额'] < 0
                ? industryRows[industryRows.length - 1] : null,
            '净流入最多概念': conceptRows[0] || null,
            '净流出最多概念': conceptRows.length > 0 && conceptRows[conceptRows.length - 1]['主力净额'] < 0
                ? conceptRows[conceptRows.length - 1] : null
        }
    };
}

module.exports = {
    analyzeFundFlow,
    buildAnalysisResult,
    formatCurrency,
    parseSectors,
    detectColumns,
    parseNumericValue,
    normalizeStockName,
    normalizeStockCode,
    getStockMarket,
    buildStockKey,
    extractTradeDate
};
