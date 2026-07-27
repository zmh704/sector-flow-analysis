#!/usr/bin/env node
'use strict';

/** Generate the static v2 data manifest used outside the local server. */

const path = require('path');
const { createManifest } = require('./lib/manifest.js');
const { writeJsonAtomic } = require('./lib/file-utils.js');

const WORKSPACE = __dirname;
const DATA_DIR = path.join(WORKSPACE, 'data');

function generateFileList(options = {}) {
    const rootDir = path.resolve(options.rootDir || WORKSPACE);
    const dataDir = path.resolve(options.dataDir || path.join(rootDir, 'data'));
    const outputPath = path.resolve(options.outputPath || path.join(rootDir, 'list.json'));
    const manifest = createManifest({ rootDir, dataDir, now: options.now, onError: options.onError });
    writeJsonAtomic(outputPath, manifest);

    if (!options.quiet) {
        console.log(`已生成 v2 list.json，包含 ${manifest.files.length} 个文件：`);
        manifest.files.forEach(file => console.log(`   - ${file.path} (${file.tradingDate})`));
        console.log(`\n列表文件位置：${outputPath}`);
    }
    return manifest;
}

if (require.main === module) {
    try {
        generateFileList({ rootDir: WORKSPACE, dataDir: DATA_DIR });
    } catch (error) {
        console.error('生成失败:', error.message);
        process.exitCode = 1;
    }
}

module.exports = { generateFileList };
