'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { buildAnalysisResult: defaultBuildAnalysisResult } = require('./analyze.js');
const { createManifest, parseTradingDate } = require('./lib/manifest.js');
const { writeJsonAtomic } = require('./lib/file-utils.js');

const DEFAULT_PORT = 3001;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_MAX_REQUEST_BYTES = 20 * 1024 * 1024;
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

function scanDataFiles(options = {}) {
    return createManifest({
        rootDir: options.rootDir || ROOT,
        dataDir: options.dataDir,
        now: options.now,
        onError: options.onError,
    }).files;
}

function parseBoundary(contentType) {
    if (typeof contentType !== 'string') return null;
    const match = contentType.match(/(?:^|;)\s*boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
    const boundary = match && (match[1] || match[2]);
    if (!boundary || /[\r\n]/.test(boundary) || boundary.length > 200) return null;
    return boundary;
}

function safeFilename(value) {
    if (!value) return 'upload.xlsx';
    const normalized = String(value).replace(/\\/g, '/');
    const basename = path.posix.basename(normalized)
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[<>:"|?*]/g, '_')
        .trim();
    return basename && basename !== '.' && basename !== '..' ? basename : 'upload.xlsx';
}

function parseHeaderParameters(value) {
    const parameters = {};
    const pattern = /;\s*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\s*=\s*(?:"((?:\\.|[^"])*)"|([^;]*))/g;
    let match;
    while ((match = pattern.exec(value)) !== null) {
        parameters[match[1].toLowerCase()] = match[2] !== undefined
            ? match[2].replace(/\\(["\\])/g, '$1')
            : match[3].trim();
    }
    return parameters;
}

/** Parse multipart/form-data and return the form field named "file". */
function parseMultipart(buffer, contentType) {
    if (!Buffer.isBuffer(buffer)) throw new TypeError('multipart 内容必须是 Buffer');
    const boundary = parseBoundary(contentType);
    if (!boundary) throw new Error('无法解析 multipart boundary');

    const delimiter = Buffer.from(`--${boundary}`);
    const crlf = Buffer.from('\r\n');
    const finalMarker = Buffer.from('--');
    const headerSeparator = Buffer.from('\r\n\r\n');
    let cursor = buffer.indexOf(delimiter);
    while (cursor !== -1) {
        cursor += delimiter.length;
        if (buffer.subarray(cursor, cursor + 2).equals(finalMarker)) break;
        if (!buffer.subarray(cursor, cursor + 2).equals(crlf)) {
            cursor = buffer.indexOf(delimiter, cursor);
            continue;
        }

        const partStart = cursor + 2;
        const nextDelimiter = buffer.indexOf(delimiter, partStart);
        if (nextDelimiter === -1) break;
        const partEnd = nextDelimiter >= 2
            && buffer[nextDelimiter - 2] === 13
            && buffer[nextDelimiter - 1] === 10
            ? nextDelimiter - 2
            : nextDelimiter;
        const part = buffer.subarray(partStart, partEnd);
        const relativeHeaderEnd = part.indexOf(headerSeparator);
        if (relativeHeaderEnd !== -1) {
            const headers = part.subarray(0, relativeHeaderEnd).toString('utf8').split('\r\n');
            const dispositionLine = headers.find(line => /^content-disposition\s*:/i.test(line));
            if (dispositionLine) {
                const disposition = dispositionLine.slice(dispositionLine.indexOf(':') + 1);
                const parameters = parseHeaderParameters(disposition);
                if (parameters.name === 'file') {
                    return {
                        buffer: part.subarray(relativeHeaderEnd + headerSeparator.length),
                        filename: safeFilename(parameters.filename),
                    };
                }
            }
        }
        cursor = nextDelimiter;
    }
    throw new Error('未找到上传文件');
}

function send(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
    if (res.writableEnded || res.destroyed) return false;
    res.writeHead(statusCode, { 'Content-Type': contentType });
    res.end(body);
    return true;
}

function sendJson(res, statusCode, value) {
    return send(res, statusCode, JSON.stringify(value), 'application/json; charset=utf-8');
}

function readRequestBody(req, res, maxRequestBytes, onComplete) {
    const contentLengthHeader = req.headers['content-length'];
    if (contentLengthHeader !== undefined) {
        const contentLength = Number(contentLengthHeader);
        if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
            send(res, 400, '无效的 Content-Length');
            req.resume();
            return;
        }
        if (contentLength > maxRequestBytes) {
            send(res, 413, '请求体超过大小限制');
            req.resume();
            return;
        }
    }

    const chunks = [];
    let received = 0;
    let settled = false;
    let tooLarge = false;

    const finish = (callback) => {
        if (settled) return;
        settled = true;
        callback();
    };

    req.on('data', chunk => {
        if (settled) return;
        received += chunk.length;
        if (received > maxRequestBytes) {
            tooLarge = true;
            finish(() => send(res, 413, '请求体超过大小限制'));
            req.resume();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => {
        if (tooLarge) return;
        finish(() => onComplete(Buffer.concat(chunks, received)));
    });
    req.on('aborted', () => {
        finish(() => {
            if (!res.writableEnded) res.destroy();
        });
    });
    req.on('error', error => {
        finish(() => {
            console.error('[请求错误]', error.message);
            if (!res.headersSent) send(res, 400, '请求读取失败');
            else if (!res.writableEnded) res.destroy(error);
        });
    });
    req.on('close', () => {
        if (!req.complete) {
            finish(() => {
                if (!res.writableEnded) res.destroy();
            });
        }
    });
}

function formatDateUtc(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function resolveUploadTradingDate(result, now) {
    return parseTradingDate(result && result['交易日期'], { now }) || formatDateUtc(now);
}

function createServer(options = {}) {
    const rootDir = path.resolve(options.rootDir || ROOT);
    const dataDir = path.resolve(options.dataDir || path.join(rootDir, 'data'));
    const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
    const buildAnalysisResult = options.buildAnalysisResult || defaultBuildAnalysisResult;
    const nowProvider = options.now || (() => new Date());

    if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 0) {
        throw new TypeError('maxRequestBytes 必须是非负安全整数');
    }

    return http.createServer((req, res) => {
        let pathname;
        try {
            const url = new URL(req.url, 'http://localhost');
            pathname = decodeURIComponent(url.pathname);
        } catch (_error) {
            send(res, 400, 'Bad Request');
            return;
        }

        if (pathname === '/api/list') {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                send(res, 405, 'Method Not Allowed');
                return;
            }
            const manifest = createManifest({ rootDir, dataDir, now: nowProvider() });
            if (req.method === 'HEAD') send(res, 200, '', 'application/json; charset=utf-8');
            else sendJson(res, 200, manifest);
            return;
        }

        if (pathname === '/api/parse' && req.method === 'POST') {
            const contentType = req.headers['content-type'] || '';
            if (!/^multipart\/form-data(?:\s*;|$)/i.test(contentType) || !parseBoundary(contentType)) {
                send(res, 400, '需要 multipart/form-data 格式上传');
                req.resume();
                return;
            }

            readRequestBody(req, res, maxRequestBytes, body => {
                try {
                    const { buffer: fileBuffer, filename } = parseMultipart(body, contentType);
                    if (!/\.(xlsx|xls)$/i.test(filename)) {
                        send(res, 415, '仅支持 .xlsx 或 .xls 文件');
                        return;
                    }
                    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
                    const result = buildAnalysisResult(workbook, filename);
                    const tradingDate = resolveUploadTradingDate(result, nowProvider());
                    const jsonFilename = `${tradingDate}_板块资金流向.json`;
                    writeJsonAtomic(path.join(dataDir, jsonFilename), result);

                    const industryRows = result['行业板块资金流向'] || [];
                    const conceptRows = result['概念板块资金流向'] || [];
                    sendJson(res, 200, {
                        success: true,
                        industries: industryRows.length,
                        concepts: conceptRows.length,
                        file: jsonFilename,
                    });
                } catch (error) {
                    console.error('[解析错误]', error.message);
                    send(res, 400, error.message);
                }
            });
            return;
        }

        if (pathname.startsWith('/api/')) {
            send(res, 404, '404 Not Found: ' + pathname);
            return;
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            send(res, 405, 'Method Not Allowed');
            return;
        }
        if (pathname === '/') pathname = '/index.html';
        const relativePath = pathname.replace(/^\/+/, '');
        const filePath = path.resolve(rootDir, relativePath);
        const relative = path.relative(rootDir, filePath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            send(res, 403, 'Forbidden');
            return;
        }

        fs.readFile(filePath, (error, data) => {
            if (error) {
                send(res, error.code === 'EACCES' ? 403 : 404, '404 Not Found: ' + pathname);
                return;
            }
            if (req.method === 'HEAD') send(res, 200, '', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
            else send(res, 200, data, MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
        });
    });
}

if (require.main === module) {
    const port = process.env.PORT === undefined ? DEFAULT_PORT : Number(process.env.PORT);
    const host = process.env.HOST || DEFAULT_HOST;
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        console.error('无效的 PORT:', process.env.PORT);
        process.exitCode = 1;
    } else {
        const server = createServer();
        server.listen(port, host, () => {
            const address = server.address();
            const actualPort = typeof address === 'object' && address ? address.port : port;
            console.log(`A股板块资金流向分析已启动: http://${host}:${actualPort}`);
        });
    }
}

module.exports = {
    createServer,
    parseMultipart,
    parseBoundary,
    safeFilename,
    scanDataFiles,
    readRequestBody,
    resolveUploadTradingDate,
    writeJsonAtomic,
    DEFAULT_MAX_REQUEST_BYTES,
    DEFAULT_PORT,
    DEFAULT_HOST,
    ROOT,
    DATA_DIR,
};
