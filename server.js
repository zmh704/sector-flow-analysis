'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { buildAnalysisResult: defaultBuildAnalysisResult } = require('./analyze.js');
const { createManifest, parseTradingDate } = require('./lib/manifest.js');
const { writeJsonAtomic } = require('./lib/file-utils.js');
const { toSchemaV3 } = require('./lib/schema-v3.js');
const { performance } = require('node:perf_hooks');

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

function send(res, statusCode, body, contentType = 'text/plain; charset=utf-8', headers = {}) {
    if (res.writableEnded || res.destroyed) return false;
    res.writeHead(statusCode, { 'Content-Type': contentType, ...headers });
    res.end(body);
    return true;
}

function sendJson(res, statusCode, value, headers = {}) {
    return send(res, statusCode, JSON.stringify(value), 'application/json; charset=utf-8', headers);
}

function createEtag(data) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    return `"${crypto.createHash('sha1').update(buffer).digest('base64url')}"`;
}

function acceptsEncoding(header, encoding) {
    return String(header || '').split(',').some(token => {
        const [name, ...params] = token.trim().toLowerCase().split(';');
        if (name !== encoding && name !== '*') return false;
        const quality = params.find(param => param.trim().startsWith('q='));
        return !quality || Number(quality.trim().slice(2)) > 0;
    });
}

function sendCacheable(req, res, statusCode, body, contentType, options = {}) {
    const source = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    const etag = options.etag || createEtag(source);
    const headers = {
        'Cache-Control': options.cacheControl || 'no-cache',
        'ETag': etag,
        'Vary': 'Accept-Encoding',
        ...options.headers,
    };
    if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        res.end();
        return true;
    }
    if (req.method === 'HEAD') return send(res, statusCode, '', contentType, headers);

    const compressible = options.compress !== false && source.length >= 1024;
    if (compressible && acceptsEncoding(req.headers['accept-encoding'], 'br')) {
        headers['Content-Encoding'] = 'br';
        return send(res, statusCode, zlib.brotliCompressSync(source), contentType, headers);
    }
    if (compressible && acceptsEncoding(req.headers['accept-encoding'], 'gzip')) {
        headers['Content-Encoding'] = 'gzip';
        return send(res, statusCode, zlib.gzipSync(source), contentType, headers);
    }
    return send(res, statusCode, source, contentType, headers);
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

function getDirectoryFingerprint(dataDir) {
    try {
        return fs.readdirSync(dataDir)
            .filter(name => /板块资金流向.*\.json$/i.test(name) && !name.includes('.bak_'))
            .sort((a, b) => a.localeCompare(b, 'zh-CN'))
            .map(name => {
                const stat = fs.statSync(path.join(dataDir, name));
                return `${name}:${stat.size}:${stat.mtimeMs}`;
            })
            .join('|');
    } catch (error) {
        if (error.code === 'ENOENT') return '';
        throw error;
    }
}

function createManifestCache({ rootDir, dataDir, nowProvider }) {
    let fingerprint = null;
    let manifest = null;
    let builds = 0;
    return {
        get() {
            const nextFingerprint = getDirectoryFingerprint(dataDir);
            if (!manifest || nextFingerprint !== fingerprint) {
                manifest = createManifest({ rootDir, dataDir, now: nowProvider() });
                fingerprint = nextFingerprint;
                builds++;
            }
            return manifest;
        },
        invalidate() {
            fingerprint = null;
            manifest = null;
        },
        getBuildCount() { return builds; }
    };
}

function createServer(options = {}) {
    const rootDir = path.resolve(options.rootDir || ROOT);
    const dataDir = path.resolve(options.dataDir || path.join(rootDir, 'data'));
    const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
    const buildAnalysisResult = options.buildAnalysisResult || defaultBuildAnalysisResult;
    const nowProvider = options.now || (() => new Date());
    const manifestCache = options.manifestCache || createManifestCache({ rootDir, dataDir, nowProvider });

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
            const manifest = manifestCache.get();
            sendCacheable(req, res, 200, JSON.stringify(manifest), 'application/json; charset=utf-8', {
                cacheControl: 'no-cache'
            });
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
                    const startedAt = performance.now();
                    const readStartedAt = performance.now();
                    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
                    const readMs = performance.now() - readStartedAt;
                    const analyzeStartedAt = performance.now();
                    const result = buildAnalysisResult(workbook, filename);
                    const analyzeMs = performance.now() - analyzeStartedAt;
                    const tradingDate = resolveUploadTradingDate(result, nowProvider());
                    const jsonFilename = `${tradingDate}_板块资金流向.v3.json`;
                    const writeStartedAt = performance.now();
                    const storedResult = toSchemaV3(result);
                    writeJsonAtomic(path.join(dataDir, jsonFilename), storedResult);
                    const writeMs = performance.now() - writeStartedAt;
                    manifestCache.invalidate();
                    const performanceMetrics = {
                        fileBytes: fileBuffer.length,
                        rows: result['解析诊断']?.totalRows ?? null,
                        readMs: Number(readMs.toFixed(2)),
                        analyzeMs: Number(analyzeMs.toFixed(2)),
                        writeMs: Number(writeMs.toFixed(2)),
                        totalMs: Number((performance.now() - startedAt).toFixed(2))
                    };
                    console.log('[解析性能]', JSON.stringify({ filename, ...performanceMetrics }));

                    const industryRows = result['行业板块资金流向'] || [];
                    const conceptRows = result['概念板块资金流向'] || [];
                    const responsePayload = {
                        success: true,
                        industries: industryRows.length,
                        concepts: conceptRows.length,
                        file: jsonFilename,
                        performance: performanceMetrics,
                    };
                    if (result['解析诊断']) responsePayload.diagnostics = result['解析诊断'];
                    sendJson(res, 200, responsePayload);
                } catch (error) {
                    console.error('[解析错误]', error.message);
                    sendJson(res, 400, {
                        success: false,
                        error: error.message,
                        code: error.code || 'PARSE_ERROR',
                        diagnostics: error.diagnostics || null,
                    });
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
            const extension = path.extname(filePath).toLowerCase();
            const immutable = /\.[0-9a-f]{8,}\./i.test(path.basename(filePath));
            const cacheControl = extension === '.json'
                ? 'public, max-age=300, must-revalidate'
                : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
            sendCacheable(req, res, 200, data, MIME[extension] || 'application/octet-stream', {
                cacheControl,
                compress: ['.html', '.js', '.json', '.css'].includes(extension)
            });
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
    createEtag,
    acceptsEncoding,
    sendCacheable,
    getDirectoryFingerprint,
    createManifestCache,
    writeJsonAtomic,
    DEFAULT_MAX_REQUEST_BYTES,
    DEFAULT_PORT,
    DEFAULT_HOST,
    ROOT,
    DATA_DIR,
};
