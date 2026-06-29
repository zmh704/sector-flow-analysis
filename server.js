const http = require('http');
const fs = require('fs');
const path = require('path');

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
        const matched = allFiles.filter(f => pattern.test(f));
        console.log('[扫描] 匹配到的文件:', matched);
        return matched.map(f => 'data/' + f).sort();
    } catch (err) {
        console.error('[扫描] 错误:', err.message);
        return [];
    }
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
