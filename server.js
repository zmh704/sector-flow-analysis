const http = require('http');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const PORT = 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

function scanDataFiles() {
    const pattern = /板块资金流向.*\.json$/i;
    try {
        if (!fs.existsSync(DATA_DIR)) {
            console.log('[扫描] data/ 目录不存在:', DATA_DIR);
            return [];
        }
        const allFiles = fs.readdirSync(DATA_DIR);
        console.log('[扫描] data/ 目录下文件:', allFiles);
        const matched = allFiles.filter(f => pattern.test(f) && !f.includes('.bak_'));
        console.log('[扫描] 匹配到的文件:', matched);
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
        .filter(s => s && !['--', 'None', 'nan', '', '所属行业', '所属概念'].includes(s));
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

/** 解析 multipart/form-data，提取文件 buffer */
function parseMultipart(buffer, contentType) {
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) throw new Error('无法解析 multipart boundary');
    const boundary = '--' + boundaryMatch[1];

    const boundaryBuf = Buffer.from(boundary);
    let start = 0;
    while (true) {
        const idx = buffer.indexOf(boundaryBuf, start);
        if (idx === -1) break;
        const partEnd = buffer.indexOf(Buffer.from('\r\n'), idx + boundaryBuf.length);
        if (partEnd === -1) break;
        const partStart = partEnd + 2;
        const nextBoundary = buffer.indexOf(boundaryBuf, partStart);
        if (nextBoundary === -1) break;
        const partContent = buffer.subarray(partStart, nextBoundary - 2);
        const headerEnd = partContent.indexOf(Buffer.from('\r\n\r\n'));
        if (headerEnd === -1) { start = nextBoundary; continue; }
        const headerStr = partContent.subarray(0, headerEnd).toString('utf-8');
        const fileData = partContent.subarray(headerEnd + 4);

        if (headerStr.includes('name="file"')) {
            const filenameMatch = headerStr.match(/filename="(.+)"/);
            const filename = filenameMatch ? filenameMatch[1] : 'upload.xlsx';
            return { buffer: fileData, filename };
        }
        start = nextBoundary;
    }
    throw new Error('未找到上传文件');
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);

    console.log('[请求]', req.method, url.pathname, '->', pathname);

    // API: 返回 data 目录下所有 JSON 文件列表
    if (pathname === '/api/list') {
        const files = scanDataFiles();
        const json = JSON.stringify(files);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(json);
        console.log('[响应] /api/list ->', files.length, '个文件');
        return;
    }

    // API: 解析上传的 Excel 文件
    if (pathname === '/api/parse' && req.method === 'POST') {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('multipart/form-data')) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('需要 multipart/form-data 格式上传');
            return;
        }

        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            try {
                const buffer = Buffer.concat(chunks);
                const { buffer: fileBuf, filename } = parseMultipart(buffer, contentType);

                const workbook = XLSX.read(fileBuf, { type: 'buffer' });
                const { industryRows, conceptRows } = analyzeFundFlow(workbook);

                // 从文件名提取日期
                const baseName = path.basename(filename, path.extname(filename));
                let datePart = '';
                const utf8Match = baseName.match(/(\d{1,2}月\d{1,2}日)/);
                if (utf8Match) {
                    datePart = utf8Match[1];
                } else {
                    const d = new Date();
                    datePart = `${d.getMonth() + 1}月${d.getDate()}日`;
                }

                const genTime = new Date();
                const result = {
                    '生成时间': genTime.toLocaleString('zh-CN', { hour12: false }),
                    '数据来源': filename,
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

                // 写 JSON
                const jsonFilename = `${datePart}_板块资金流向.json`;
                const jsonPath = path.join(DATA_DIR, jsonFilename);

                fs.mkdirSync(DATA_DIR, { recursive: true });
                fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');
                console.log('[解析] JSON 已生成:', jsonFilename);

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    industries: industryRows.length,
                    concepts: conceptRows.length,
                    file: jsonFilename
                }));
            } catch (err) {
                console.error('[解析错误]', err.message);
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(err.message);
            }
        });
        return;
    }

    // 提供静态文件服务
    if (pathname === '/') pathname = '/index.html';
    const filePath = path.join(ROOT, pathname);

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.log('[404]', pathname);
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found: ' + pathname);
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log('');
    console.log('====================================');
    console.log(' A股板块资金流向分析 - 启动成功');
    console.log('====================================');
    console.log('');
    console.log(' ROOT:', ROOT);
    console.log(' DATA_DIR:', DATA_DIR);
    console.log('');
    console.log(` 访问地址: http://localhost:${PORT}`);
    console.log('');
    console.log(' 按 Ctrl+C 停止服务器');
    console.log('');
});
