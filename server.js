const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const PORT = 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');

// ==================== SQLite 初始化 ====================

let db = null;
const initSqlJs = require('sql.js');
const DB_PATH = path.join(ROOT, 'data.db');

async function initDatabase() {
    const SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
        console.log('[DB] 从文件加载已有数据库');
    } else {
        db = new SQL.Database();
        console.log('[DB] 创建新数据库');
    }

    db.run(`CREATE TABLE IF NOT EXISTS data_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL UNIQUE,
        date_label TEXT NOT NULL,
        generated_at TEXT,
        source_file TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL REFERENCES data_files(id),
        type TEXT NOT NULL CHECK(type IN ('industry','concept')),
        name TEXT NOT NULL,
        turnover REAL DEFAULT 0,
        net_amount REAL DEFAULT 0,
        stock_count INTEGER DEFAULT 0,
        raw_stocks TEXT DEFAULT ''
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS stocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sector_id INTEGER NOT NULL REFERENCES sectors(id),
        name TEXT NOT NULL,
        code TEXT DEFAULT '',
        amount TEXT DEFAULT '',
        net TEXT DEFAULT '',
        change_pct TEXT DEFAULT ''
    )`);

    db.run('CREATE INDEX IF NOT EXISTS idx_sectors_file_type ON sectors(file_id, type)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sectors_name ON sectors(name)');
    db.run('CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector_id)');

    saveDatabase();
}

function saveDatabase() {
    try {
        const data = db.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (err) {
        console.error('[DB] 保存失败:', err.message);
    }
}

// ==================== 原有函数 ====================

function scanDataFiles() {
    const pattern = /板块资金流向.*\.json$/i;
    try {
        if (!fs.existsSync(DATA_DIR)) {
            console.log('[扫描] data/ 目录不存在:', DATA_DIR);
            return [];
        }
        const allFiles = fs.readdirSync(DATA_DIR);
        const matched = allFiles.filter(f => pattern.test(f) && !f.includes('.bak_'));
        return matched.map(f => 'data/' + f).sort();
    } catch (err) {
        console.error('[扫描] 错误:', err.message);
        return [];
    }
}

function formatCurrency(num) {
    if (Math.abs(num) >= 1e8) return (num / 1e8).toFixed(2) + '亿';
    if (Math.abs(num) >= 1e4) return (num / 1e4).toFixed(2) + '万';
    return num.toFixed(2);
}

function parseSectors(raw) {
    if (!raw || ['--', 'None', 'nan', ''].includes(raw.trim())) return [];
    return raw
        .replace(/\n/g, ',').replace(/;/g, ',').replace(/，/g, ',')
        .split(',')
        .map(s => s.trim())
        .filter(s => s && !['--', 'None', 'nan', ''].includes(s));
}

function analyzeFundFlow(workbook) {
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
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
        if (!found) {
            found = cols.find(c => names.some(n => String(c).includes(n) || n.includes(String(c))));
        }
        if (found) colMap[key] = found;
    }

    const required = ['name', 'industry', 'concept', 'net', 'turnover'];
    const missing = required.filter(k => !colMap[k]);
    if (missing.length > 0) {
        throw new Error('无法找到必要列: ' + missing.join(', ') + '。可用列: ' + cols.join(', '));
    }

    const industryStats = {};
    const conceptStats = {};

    function getOrInit(map, key) {
        if (!map[key]) map[key] = { totalNet: 0, totalTurnover: 0, count: 0, stocks: [] };
        return map[key];
    }

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
        const stockStr = change !== null
            ? `${name}(${code}|${volStr}|${netStr}|${changeStr})`
            : `${name}(${code}|${volStr}|${netStr})`;

        const inds = parseSectors(String(row[colMap.industry]));
        for (const ind of inds) {
            const s = getOrInit(industryStats, ind);
            s.totalNet += net;
            s.totalTurnover += turnover;
            s.count++;
            s.stocks.push(stockStr);
        }

        const cons = parseSectors(String(row[colMap.concept]));
        for (const con of cons) {
            const s = getOrInit(conceptStats, con);
            s.totalNet += net;
            s.totalTurnover += turnover;
            s.count++;
            s.stocks.push(stockStr);
        }
    }

    const industryRows = Object.entries(industryStats)
        .map(([name, data]) => ({
            '板块': name,
            '成交额': data.totalTurnover,
            '主力净额': data.totalNet,
            '股票数量': data.count,
            '涉及股票': data.stocks.join(', ')
        }))
        .sort((a, b) => b['主力净额'] - a['主力净额']);

    const conceptRows = Object.entries(conceptStats)
        .map(([name, data]) => ({
            '板块': name,
            '成交额': data.totalTurnover,
            '主力净额': data.totalNet,
            '股票数量': data.count,
            '涉及股票': data.stocks.join(', ')
        }))
        .sort((a, b) => b['主力净额'] - a['主力净额']);

    return { industryRows, conceptRows };
}

/** 解析涉及股票字符串为结构化数组 */
function parseStockStr(stockStr) {
    if (!stockStr) return [];
    return stockStr.split(',').map(s => {
        const m = s.trim().match(/^(.+?)\(([^)]+)\)$/);
        if (!m) return null;
        const parts = m[2].split('|');
        return {
            name: m[1],
            code: parts[0] || '',
            amount: parts[1] || '',
            net: parts[2] || '',
            change: parts[3] || ''
        };
    }).filter(Boolean);
}

// ==================== 写入 SQLite ====================

function writeToSQLite(filename, datePart, result) {
    if (!db) return;

    const dateLabel = datePart;
    const generatedAt = result.生成时间;

    db.run('BEGIN TRANSACTION');
    try {
        // 删除同日期旧数据（用于重写覆盖）
        const existing = db.exec(`SELECT id FROM data_files WHERE date_label = ?`, [dateLabel]);
        if (existing.length > 0 && existing[0].values.length > 0) {
            const oldId = existing[0].values[0][0];
            db.run(`DELETE FROM stocks WHERE sector_id IN (SELECT id FROM sectors WHERE file_id = ?)`, [oldId]);
            db.run(`DELETE FROM sectors WHERE file_id = ?`, [oldId]);
            db.run(`DELETE FROM data_files WHERE id = ?`, [oldId]);
            console.log(`[DB] 已删除旧数据: ${dateLabel} (file_id=${oldId})`);
        }

        // 插入 data_files
        db.run(`INSERT INTO data_files (filename, date_label, generated_at, source_file) VALUES (?, ?, ?, ?)`,
            [filename, dateLabel, generatedAt, result.数据来源]);
        const fileId = db.exec(`SELECT last_insert_rowid()`)[0].values[0][0];

        // 插入行业板块
        for (const row of result.行业板块资金流向 || []) {
            db.run(`INSERT INTO sectors (file_id, type, name, turnover, net_amount, stock_count, raw_stocks) VALUES (?, 'industry', ?, ?, ?, ?, ?)`,
                [fileId, row['板块'], row['成交额'], row['主力净额'], row['股票数量'], row['涉及股票']]);
            const sectorId = db.exec(`SELECT last_insert_rowid()`)[0].values[0][0];
            const parsedStocks = parseStockStr(row['涉及股票']);
            for (const stk of parsedStocks) {
                db.run(`INSERT INTO stocks (sector_id, name, code, amount, net, change_pct) VALUES (?, ?, ?, ?, ?, ?)`,
                    [sectorId, stk.name, stk.code, stk.amount, stk.net, stk.change]);
            }
        }

        // 插入概念板块
        for (const row of result.概念板块资金流向 || []) {
            db.run(`INSERT INTO sectors (file_id, type, name, turnover, net_amount, stock_count, raw_stocks) VALUES (?, 'concept', ?, ?, ?, ?, ?)`,
                [fileId, row['板块'], row['成交额'], row['主力净额'], row['股票数量'], row['涉及股票']]);
            const sectorId = db.exec(`SELECT last_insert_rowid()`)[0].values[0][0];
            const parsedStocks = parseStockStr(row['涉及股票']);
            for (const stk of parsedStocks) {
                db.run(`INSERT INTO stocks (sector_id, name, code, amount, net, change_pct) VALUES (?, ?, ?, ?, ?, ?)`,
                    [sectorId, stk.name, stk.code, stk.amount, stk.net, stk.change]);
            }
        }

        db.run('COMMIT');
        saveDatabase();
        console.log(`[DB] 已写入: ${dateLabel} (${(result.行业板块资金流向 || []).length}行业, ${(result.概念板块资金流向 || []).length}概念)`);
    } catch (err) {
        db.run('ROLLBACK');
        console.error(`[DB] 写入失败 ${dateLabel}:`, err.message);
    }
}

// ==================== Express 应用 ====================

const app = express();
const upload = multer({ dest: path.join(ROOT, 'uploads/') });

// 静态文件
app.use(express.static(ROOT));

// API: 文件列表
app.get('/api/list', (req, res) => {
    const files = scanDataFiles();
    res.json(files);
});

// API: 从 SQLite 获取板块数据（预留，前端尚未使用）
app.get('/api/sectors', (req, res) => {
    const { date, type } = req.query;
    if (!date) return res.status(400).json({ error: '缺少 date 参数' });

    const rows = db.exec(`
        SELECT s.* FROM sectors s
        JOIN data_files f ON s.file_id = f.id
        WHERE f.date_label = ? AND s.type = ?
        ORDER BY s.net_amount DESC
    `, [date, type || 'industry']);

    if (rows.length === 0 || rows[0].values.length === 0) {
        return res.json([]);
    }

    const columns = rows[0].columns;
    const result = rows[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => { obj[col] = row[i]; });
        return obj;
    });
    res.json(result);
});

// API: 趋势数据（预留，前端尚未使用）
app.get('/api/trend', (req, res) => {
    const { name, type } = req.query;
    if (!name) return res.status(400).json({ error: '缺少 name 参数' });

    const rows = db.exec(`
        SELECT f.date_label, s.net_amount
        FROM sectors s
        JOIN data_files f ON s.file_id = f.id
        WHERE s.name = ? AND s.type = ?
        ORDER BY f.id ASC
    `, [name, type || 'industry']);

    if (rows.length === 0 || rows[0].values.length === 0) {
        return res.json([]);
    }

    const columns = rows[0].columns;
    const result = rows[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => { obj[col] = row[i]; });
        return obj;
    });
    res.json(result);
});

// API: 写入验证（预留，查询数据行数）
app.get('/api/dbstats', (req, res) => {
    const files = db.exec(`SELECT COUNT(*) as c FROM data_files`)[0].values[0][0];
    const sectors = db.exec(`SELECT COUNT(*) as c FROM sectors`)[0].values[0][0];
    const stocks = db.exec(`SELECT COUNT(*) as c FROM stocks`)[0].values[0][0];
    res.json({ data_files: files, sectors, stocks });
});

// API: 解析上传的 Excel 文件
app.post('/api/parse', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('请上传 Excel 文件');
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname;

    try {
        const workbook = XLSX.readFile(filePath);

        const { industryRows, conceptRows } = analyzeFundFlow(workbook);

        // 从文件名提取日期
        const baseName = path.basename(originalName, path.extname(originalName));
        let datePart = '';
        const utf8Match = baseName.match(/(\d{1,2}月\d{1,2}日)/);
        if (utf8Match) {
            datePart = utf8Match[1];
        } else {
            const d = new Date();
            datePart = `${d.getMonth() + 1}月${d.getDate()}日`;
        }

        const genTime = new Date();
        const genTimeStr = genTime.toLocaleString('zh-CN', { hour12: false });

        const result = {
            '生成时间': genTimeStr,
            '数据来源': originalName,
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

        // === 阶段1: 双写 ===

        // 1. 写 JSON（保持前端兼容）
        const jsonFilename = `${datePart}_板块资金流向.json`;
        const jsonPath = path.join(DATA_DIR, jsonFilename);

        if (fs.existsSync(jsonPath)) {
            const bakPath = jsonPath.replace(/\.json$/, `.bak_${Date.now()}.json`);
            fs.copyFileSync(jsonPath, bakPath);
            console.log('[解析] 原文件已备份:', path.basename(bakPath));
        }

        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');
        console.log('[解析] JSON 已生成:', jsonFilename);

        // 2. 写 SQLite
        writeToSQLite(jsonFilename, datePart, result);

        res.json({
            success: true,
            industries: industryRows.length,
            concepts: conceptRows.length,
            file: jsonFilename
        });

    } catch (err) {
        console.error('[解析错误]', err.message);
        res.status(500).send(err.message);
    } finally {
        // 清理上传的临时文件
        try { fs.unlinkSync(filePath); } catch (_) {}
    }
});

// 404
app.use((req, res) => {
    if (!req.path.startsWith('/api/')) {
        res.status(404).type('text/plain; charset=utf-8').send('404 Not Found: ' + req.path);
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// ==================== 启动 ====================

async function start() {
    await initDatabase();
    app.listen(PORT, () => {
        console.log('');
        console.log('====================================');
        console.log(' A股板块资金流向分析 - 启动成功');
        console.log('====================================');
        console.log('');
        console.log(' ROOT:', ROOT);
        console.log(' DATA_DIR:', DATA_DIR);
        console.log(' DB:', DB_PATH);
        console.log('');
        console.log(` 访问地址: http://localhost:${PORT}`);
        console.log('');
        console.log(' 按 Ctrl+C 停止服务器');
        console.log('');
    });
}

start().catch(err => {
    console.error('启动失败:', err);
    process.exit(1);
});