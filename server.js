const http = require('http');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { buildAnalysisResult } = require('./analyze.js');

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
        // 按文件修改时间排序（比解析月日更可靠，且能正确处理跨年场景）
        return matched
            .map(f => ({ name: 'data/' + f, mtime: fs.statSync(path.join(DATA_DIR, f)).mtimeMs }))
            .sort((a, b) => a.mtime - b.mtime)
            .map(item => item.name);
    } catch (err) {
        console.error('[扫描] 错误:', err.message);
        return [];
    }
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
                const result = buildAnalysisResult(workbook, filename);

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

                // 写 JSON
                const jsonFilename = `${datePart}_板块资金流向.json`;
                const jsonPath = path.join(DATA_DIR, jsonFilename);

                fs.mkdirSync(DATA_DIR, { recursive: true });
                fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');
                console.log('[解析] JSON 已生成:', jsonFilename);

                const industryRows = result.行业板块资金流向 || [];
                const conceptRows = result.概念板块资金流向 || [];
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
