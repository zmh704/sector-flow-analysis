#!/usr/bin/env node

/**
 * 自动扫描并生成 list.json 文件
 * 用法：node generate-list.js
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE = __dirname;
const DATA_DIR = path.join(WORKSPACE, 'data');
const JSON_PATTERN = /板块资金流向.*\.json$/i;

function generateFileList() {
    try {
        // 优先读取 data 目录
        let files = [];
        if (fs.existsSync(DATA_DIR)) {
            files = fs.readdirSync(DATA_DIR)
                .filter(file => JSON_PATTERN.test(file) && !file.includes('.bak_'))
                .map(file => 'data/' + file); // 添加 data/ 前缀，用正斜杠
        } else {
            // 回退：扫描当前目录
            files = fs.readdirSync(WORKSPACE)
                .filter(file => JSON_PATTERN.test(file) && !file.includes('list.json'));
        }

        // 按文件修改时间排序（比解析月日更可靠，且能正确处理跨年场景）
        files.sort((a, b) => {
            const aPath = path.isAbsolute(a) ? a : path.join(WORKSPACE, a);
            const bPath = path.isAbsolute(b) ? b : path.join(WORKSPACE, b);
            const mtimeA = fs.statSync(aPath).mtimeMs;
            const mtimeB = fs.statSync(bPath).mtimeMs;
            return mtimeA - mtimeB;
        });

        const listJsonPath = path.join(WORKSPACE, 'list.json');
        fs.writeFileSync(listJsonPath, JSON.stringify(files, null, 2), 'utf8');

        console.log(`✅ 已生成 list.json，包含 ${files.length} 个文件：`);
        files.forEach(f => console.log(`   - ${f}`));
        console.log(`\n📁 列表文件位置：${listJsonPath}`);
    } catch (error) {
        console.error('❌ 生成失败:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    generateFileList();
}

module.exports = { generateFileList };
