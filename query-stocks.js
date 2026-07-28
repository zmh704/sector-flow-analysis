#!/usr/bin/env node

/**
 * 通用股票查询脚本
 *
 * 通过 JSON 配置文件定义任意条件，从板块资金流向数据中查询符合条件的所有股票。
 *
 * 用法: node query-stocks.js <配置文件.json>
 * 示例: node query-stocks.js query.json
 */

const fs = require('fs');
const path = require('path');
const { getSectorStocks } = require('./stock-utils.js');

// ===================== 配置读取 =====================

function loadConfig(configPath) {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);

    if (!Array.isArray(config.files) || config.files.length === 0) {
        console.error('错误: 配置中必须包含 files 数组，指定至少一个数据文件路径');
        process.exit(1);
    }
    if (!Array.isArray(config.conditions) || config.conditions.length === 0) {
        console.error('错误: 配置中必须包含 conditions 数组，指定至少一个过滤条件');
        process.exit(1);
    }
    if (config.combine && !['intersection', 'union'].includes(config.combine)) {
        console.error('错误: combine 必须是 "intersection" 或 "union"');
        process.exit(1);
    }

    return {
        files: config.files,
        combine: config.combine || 'intersection',
        conditions: config.conditions.map(c => ({
            date: c.date != null ? String(c.date) : null,
            field: c.field,
            operator: c.operator,
            value: c.value,
            refDate: c.refDate != null ? String(c.refDate) : null,
            refField: c.refField || null
        }))
    };
}

// ===================== 数据加载 =====================

const VALID_FIELDS = new Set([
    'netYi', 'changePct', 'amountYi', 'volumeWanShou',
    'high', 'open', 'low', 'close', 'date'
]);

const FIELD_LABELS = {
    netYi: '主力净额(亿)',
    changePct: '涨跌幅(%)',
    amountYi: '成交额(亿)',
    volumeWanShou: '成交量(万手)',
    high: '最高价',
    open: '开盘价',
    low: '最低价',
    close: '收盘价',
    date: '日期'
};

function formatFieldValue(field, value) {
    if (value == null) return '--';
    if (field === 'netYi' || field === 'amountYi') {
        return (value >= 0 ? '+' : '') + value.toFixed(2) + '亿';
    }
    if (field === 'changePct') {
        return (value >= 0 ? '+' : '') + value.toFixed(2) + '%';
    }
    if (field === 'volumeWanShou') {
        return value.toFixed(0) + '万手';
    }
    if (['high', 'open', 'low', 'close', 'price'].includes(field)) {
        return value.toFixed(2);
    }
    return String(value);
}

/**
 * 从文件名中提取日期标识。
 * 例如: "data/7月24日_板块资金流向.json" -> "7月24日"
 */
function extractDateKey(filePath) {
    const basename = path.basename(filePath, '.json');
    // 尝试匹配 "7月24日_板块资金流向" 这种格式
    const match = basename.match(/^(\d+月\d+日)/);
    if (match) return match[1];
    // 尝试匹配 "2026-07-24_板块资金流向" 这种格式
    const dateMatch = basename.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) return dateMatch[1];
    return basename;
}

/**
 * 加载一个 JSON 数据文件，解析所有板块的股票。
 * @returns {Map<string, {stock: object, sectors: string[], dateKey: string}>}
 *   key: stockKey, value: 股票详情及所在板块
 */
function loadDataFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const dateKey = extractDateKey(filePath);

    const stockMap = new Map();

    // 处理行业板块和概念板块
    const sectorGroups = ['行业板块资金流向', '概念板块资金流向'];
    for (const groupKey of sectorGroups) {
        const sectors = data[groupKey];
        if (!Array.isArray(sectors)) continue;
        for (const sector of sectors) {
            const sectorName = sector['板块'];
            const stocks = getSectorStocks(sector, data['股票字典']);
            for (const stock of stocks) {
                if (!stock.name) continue;
                const key = stock.stockKey;
                if (!stockMap.has(key)) {
                    stockMap.set(key, { stock, sectors: [], dateKey });
                }
                if (!stockMap.get(key).sectors.includes(sectorName)) {
                    stockMap.get(key).sectors.push(sectorName);
                }
            }
        }
    }

    return { stockMap, dateKey };
}

/**
 * 加载所有数据文件，构建跨日期的股票索引。
 * @returns {Map<string, Map<string, {stock: object, sectors: string[]}>>}
 *   外层 key: stockKey, 内层 key: dateKey
 */
function loadAllData(config) {
    const allStocks = new Map(); // stockKey -> Map<dateKey, {stock, sectors}>

    for (const filePath of config.files) {
        const { stockMap, dateKey } = loadDataFile(filePath);

        for (const [stockKey, entry] of stockMap) {
            if (!allStocks.has(stockKey)) {
                allStocks.set(stockKey, new Map());
            }
            allStocks.get(stockKey).set(dateKey, entry);
        }
    }

    return allStocks;
}

// ===================== 条件过滤 =====================

function getStockFieldValue(stock, field) {
    if (field === 'date') return null; // date 由外部传入
    const value = stock[field];
    return value != null && typeof value === 'number' ? value : null;
}

function compareValues(actualValue, operator, targetValue) {
    if (actualValue == null) return false;
    switch (operator) {
        case '>':  return actualValue > targetValue;
        case '>=': return actualValue >= targetValue;
        case '<':  return actualValue < targetValue;
        case '<=': return actualValue <= targetValue;
        case '==': return actualValue === targetValue;
        case '!=': return actualValue !== targetValue;
        default:
            console.error(`错误: 不支持的运算符 "${operator}"`);
            process.exit(1);
    }
}

function checkCondition(stockEntry, condition, dateEntries) {
    const { stock } = stockEntry;
    const { field, operator, value, refDate, refField } = condition;

    if (!VALID_FIELDS.has(field)) {
        console.error(`错误: 不支持的字段 "${field}"。支持的字段: ${[...VALID_FIELDS].join(', ')}`);
        process.exit(1);
    }

    if (field === 'date') {
        // 日期字段比较: 与 dateKey 比较
        const dateStr = stockEntry.dateKey || '';
        return compareValues(dateStr, operator, String(value));
    }

    // 跨日期字段比较: 如 7月27日最高价 > 7月24日最高价
    if (refDate != null && refField != null) {
        if (!VALID_FIELDS.has(refField)) {
            console.error(`错误: 不支持的参考字段 "${refField}"。支持的字段: ${[...VALID_FIELDS].join(', ')}`);
            process.exit(1);
        }
        const refEntry = dateEntries ? dateEntries.get(refDate) : null;
        if (!refEntry) return false;
        const actualValue = getStockFieldValue(stock, field);
        const refValue = getStockFieldValue(refEntry.stock, refField);
        if (actualValue == null || refValue == null) return false;
        return compareValues(actualValue, operator, refValue);
    }

    const actualValue = getStockFieldValue(stock, field);
    return compareValues(actualValue, operator, value);
}

function evaluateConditionForStock(condition, dateEntries) {
    if (condition.date != null) {
        const entry = dateEntries.get(condition.date);
        return !!entry && checkCondition({ ...entry, dateKey: condition.date }, condition, dateEntries);
    }

    // 未指定日期：任意一个已有日期满足该条件即可。
    for (const [dateKey, entry] of dateEntries) {
        if (checkCondition({ ...entry, dateKey }, condition, dateEntries)) return true;
    }
    return false;
}

function filterStocks(allStocks, config) {
    const results = [];
    const combine = config.combine || 'intersection';

    for (const [stockKey, dateEntries] of allStocks) {
        const conditionResults = config.conditions.map(condition =>
            evaluateConditionForStock(condition, dateEntries)
        );
        const passed = combine === 'union'
            ? conditionResults.some(Boolean)
            : conditionResults.every(Boolean);

        if (passed) results.push({ stockKey, dateEntries });
    }

    return results;
}

// ===================== 输出 =====================

function formatResults(results, config) {
    if (results.length === 0) {
        console.log('未找到符合条件的股票。');
        return;
    }

    // 收集所有涉及到的日期
    const allDateKeys = new Set();
    for (const condition of config.conditions) {
        if (condition.date != null) allDateKeys.add(condition.date);
    }
    // 如果条件没指定日期，从结果中收集
    if (allDateKeys.size === 0) {
        for (const { dateEntries } of results) {
            for (const dateKey of dateEntries.keys()) {
                allDateKeys.add(dateKey);
            }
        }
    }
    const sortedDates = [...allDateKeys].sort();

    // 收集所有涉及到的字段（从条件中提取）
    const displayFields = [...new Set(config.conditions.map(c => c.field))].filter(f => f !== 'date');
    // 确保 date 在最前面
    const orderedFields = ['date', ...displayFields.filter(f => f !== 'date')];

    // 构建表头
    const header = ['股票名称', '股票代码', '所属板块'];
    for (const dateKey of sortedDates) {
        for (const field of orderedFields) {
            if (field === 'date') continue;
            header.push(`${dateKey} ${FIELD_LABELS[field] || field}`);
        }
    }

    // 构建数据行
    const rows = results.map(({ stockKey, dateEntries }) => {
        // 取第一个有数据的日期作为基本信息
        const firstEntry = dateEntries.values().next().value;
        const stock = firstEntry.stock;
        const sectors = firstEntry.sectors.join(', ');

        const row = [stock.name, stock.code || '--', sectors || '--'];

        for (const dateKey of sortedDates) {
            const entry = dateEntries.get(dateKey);
            for (const field of orderedFields) {
                if (field === 'date') continue;
                if (entry) {
                    const value = getStockFieldValue(entry.stock, field);
                    row.push(value != null ? formatFieldValue(field, value) : '--');
                } else {
                    row.push('--');
                }
            }
        }

        return row;
    });

    // 计算列宽
    const colWidths = header.map((h, i) => {
        const dataWidths = rows.map(r => (r[i] || '').length);
        return Math.max(h.length, ...dataWidths);
    });

    // 输出表头
    const headerLine = header.map((h, i) => h.padEnd(colWidths[i])).join('  ');
    const separator = colWidths.map(w => '─'.repeat(w)).join('──');

    console.log(`\n查询结果: 共 ${results.length} 只股票\n`);
    console.log(headerLine);
    console.log(separator);

    for (const row of rows) {
        console.log(row.map((cell, i) => (cell || '').padEnd(colWidths[i])).join('  '));
    }

    console.log(`\n条件说明:`);
    for (const condition of config.conditions) {
        const dateStr = condition.date ? `[${condition.date}] ` : '';
        if (condition.refDate != null && condition.refField != null) {
            console.log(`  ${dateStr}${FIELD_LABELS[condition.field] || condition.field} ${condition.operator} [${condition.refDate}] ${FIELD_LABELS[condition.refField] || condition.refField}`);
        } else {
            console.log(`  ${dateStr}${FIELD_LABELS[condition.field] || condition.field} ${condition.operator} ${condition.value}`);
        }
    }
    console.log(`  组合方式: ${config.combine === 'intersection' ? '数据同时存在(交集)' : '数据任一存在(并集)'}`);
    console.log();
}

// ===================== 主函数 =====================

function main() {
    const configPath = process.argv[2];
    if (!configPath) {
        console.log('用法: node query-stocks.js <配置文件.json>');
        console.log('示例: node query-stocks.js query.json');
        process.exit(1);
    }

    if (!fs.existsSync(configPath)) {
        console.error(`错误: 配置文件 "${configPath}" 不存在`);
        process.exit(1);
    }

    const config = loadConfig(configPath);

    // 验证所有文件存在
    for (const filePath of config.files) {
        if (!fs.existsSync(filePath)) {
            console.error(`错误: 数据文件 "${filePath}" 不存在`);
            process.exit(1);
        }
    }

    // 验证字段名
    for (const condition of config.conditions) {
        if (!VALID_FIELDS.has(condition.field)) {
            console.error(`错误: 不支持的字段 "${condition.field}"。支持的字段: ${[...VALID_FIELDS].join(', ')}`);
            process.exit(1);
        }
    }

    console.log(`加载 ${config.files.length} 个数据文件...`);
    const allStocks = loadAllData(config);
    console.log(`共加载 ${allStocks.size} 只不同股票\n`);

    const results = filterStocks(allStocks, config);
    formatResults(results, config);
}

if (require.main === module) main();

module.exports = {
    VALID_FIELDS,
    loadConfig,
    loadDataFile,
    loadAllData,
    compareValues,
    checkCondition,
    evaluateConditionForStock,
    filterStocks,
    formatResults,
    extractDateKey
};