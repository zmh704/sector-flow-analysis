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
                .filter(file => JSON_PATTERN.test(file))
                .map(file => 'data/' + file); // 添加 data/ 前缀，用正斜杠
        } else {
            // 回退：扫描当前目录
            files = fs.readdirSync(WORKSPACE)
                .filter(file => JSON_PATTERN.test(file) && !file.includes('list.json'));
        }

        files.sort((a, b) => {
            // 尝试按日期排序（如果文件名包含日期）
            const dateMatchA = a.match(/(\d+)月(\d+)日/);
            const dateMatchB = b.match(/(\d+)月(\d+)日/);
            if (dateMatchA && dateMatchB) {
                const monthA = parseInt(dateMatchA[1]);
                const dayA = parseInt(dateMatchA[2]);
                const monthB = parseInt(dateMatchB[1]);
                const dayB = parseInt(dateMatchB[2]);
                if (monthA !== monthB) return monthA - monthB;
                return dayA - dayB;
            }
            return a.localeCompare(b);
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
