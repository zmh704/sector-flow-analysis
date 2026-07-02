/**
 * 批量重解析所有源数据Excel文件，覆盖data/中的JSON
 * 用法: node reprocess.js
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const SRC_DIR = path.join(DATA_DIR, '源数据');

function formatCurrency(num) {
    if (Math.abs(num) >= 1e8) return (num / 1e8).toFixed(2) + '亿';
    if (Math.abs(num) >= 1e4) return (num / 1e4).toFixed(2) + '万';
    return num.toFixed(2);
}

function parseSectors(raw) {
    if (!raw || ['--', 'None', 'nan', ''].includes(raw.trim())) return [];
    return raw.replace(/\n/g, ',').replace(/;/g, ',').replace(/，/g, ',')
        .split(',').map(s => s.trim()).filter(s => s && !['--', 'None', 'nan', '', '所属行业', '所属概念'].includes(s));
}

function analyzeFundFlow(workbook) {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (rows.length === 0) throw new Error('Excel 文件为空');

    const colMap = {};
    const candidates = {
        name: ['股票简称', '简称', 'stock_name', 'name', '证券简称'],
        code: ['股票代码', '代码', 'stock_code', 'code'],
        industry: ['行业板块', '所属行业', '行业', 'industry'],
        concept: ['概念板块', '所属概念', '概念', 'concept'],
        net: ['主力净额', '主力资金净额', '主力净买入', 'main_net'],
        turnover: ['成交额', '总成交额', '成交金额', '成交额(元)', 'volume'],
        change: ['涨跌幅', '涨跌幅(%)', '涨跌幅度', 'change_pct']
    };
    const cols = Object.keys(rows[0]);
    for (const [key, names] of Object.entries(candidates)) {
        let found = cols.find(c => names.includes(String(c).trim()));
        if (!found) found = cols.find(c => names.some(n => String(c).includes(n) || n.includes(String(c))));
        if (found) colMap[key] = found;
    }
    const required = ['name', 'industry', 'concept', 'net', 'turnover'];
    const missing = required.filter(k => !colMap[k]);
    if (missing.length > 0) throw new Error('无法找到必要列: ' + missing.join(', ') + '。可用列: ' + cols.join(', '));

    const industryStats = {}, conceptStats = {};
    function getOrInit(map, key) { if (!map[key]) map[key] = { totalNet: 0, totalTurnover: 0, count: 0, stocks: [], stockSet: new Set() }; return map[key]; }
    const hasChange = !!colMap.change;

    for (const row of rows) {
        const name = String(row[colMap.name]).trim();
        const code = colMap.code ? String(row[colMap.code]).trim() : '';
        const net = parseFloat(row[colMap.net]) || 0;
        const turnover = parseFloat(row[colMap.turnover]) || 0;
        const change = hasChange ? parseFloat(row[colMap.change]) || 0 : null;
        if (!name) continue;
        const volStr = formatCurrency(turnover);
        const netStr = (net >= 0 ? '+' : '') + formatCurrency(net);
        const changeStr = change !== null ? (change >= 0 ? '+' : '') + change.toFixed(2) + '%' : '';
        const stockStr = change !== null ? `${name}(${code}|${volStr}|${netStr}|${changeStr})` : `${name}(${code}|${volStr}|${netStr})`;

        for (const ind of parseSectors(String(row[colMap.industry]))) {
            const s = getOrInit(industryStats, ind);
            s.totalNet += net; s.totalTurnover += turnover; s.count++;
            if (!s.stockSet.has(stockStr)) { s.stockSet.add(stockStr); s.stocks.push(stockStr); }
        }
        for (const con of parseSectors(String(row[colMap.concept]))) {
            const s = getOrInit(conceptStats, con);
            s.totalNet += net; s.totalTurnover += turnover; s.count++;
            if (!s.stockSet.has(stockStr)) { s.stockSet.add(stockStr); s.stocks.push(stockStr); }
        }
    }

    const makeRows = stats => Object.entries(stats).map(([name, data]) => ({
        '板块': name, '成交额': data.totalTurnover, '主力净额': data.totalNet,
        '股票数量': data.count, '涉及股票': data.stocks.join(', ')
    })).sort((a, b) => b['主力净额'] - a['主力净额']);

    return { industryRows: makeRows(industryStats), conceptRows: makeRows(conceptStats) };
}

// 处理所有源数据文件
const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.xlsx'));
let count = 0;
for (const file of files) {
    try {
        const filePath = path.join(SRC_DIR, file);
        const workbook = XLSX.readFile(filePath);
        const { industryRows, conceptRows } = analyzeFundFlow(workbook);
        const baseName = path.basename(file, path.extname(file));
        const dateMatch = baseName.match(/(\d{1,2}月\d{1,2}日)/);
        const datePart = dateMatch ? dateMatch[1] : '';

        if (!datePart) {
            console.log(`跳过(无日期): ${file}`);
            continue;
        }

        const result = {
            '生成时间': new Date().toLocaleString('zh-CN', { hour12: false }),
            '数据来源': file,
            '行业板块资金流向': industryRows,
            '概念板块资金流向': conceptRows,
            '分析总结': {
                '净流入最多行业': industryRows[0] || null,
                '净流出最多行业': industryRows.length > 0 && industryRows[industryRows.length - 1]['主力净额'] < 0 ? industryRows[industryRows.length - 1] : null,
                '净流入最多概念': conceptRows[0] || null,
                '净流出最多概念': conceptRows.length > 0 && conceptRows[conceptRows.length - 1]['主力净额'] < 0 ? conceptRows[conceptRows.length - 1] : null
            }
        };

        const jsonFile = `${datePart}_板块资金流向.json`;
        const jsonPath = path.join(DATA_DIR, jsonFile);
        fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');
        console.log(`✅ ${jsonFile} (${industryRows.length}行业, ${conceptRows.length}概念)`);
        count++;
    } catch (err) {
        console.error(`❌ ${file}: ${err.message}`);
    }
}
console.log(`\n已完成 ${count}/${files.length} 个文件`);