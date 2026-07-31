'use strict';
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || 'data/2026-07-31_板块资金流向.v3.json';
const d = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
console.log('Top keys:', Object.keys(d));
console.log('schemaVersion:', d.schemaVersion);
console.log('交易日期:', d['交易日期']);
const ik = d['行业板块资金流向'] || [];
const ck = d['概念板块资金流向'] || [];
console.log('行业板块数:', ik.length, '概念板块数:', ck.length);
const dict = d['股票字典'];
console.log('股票字典条数:', Object.keys(dict).length);
const firstKey = Object.keys(dict)[0];
console.log('字典示例:', JSON.stringify(dict[firstKey]));
if (ik[0]) {
    const row = { ...ik[0] };
    if (row.股票键) row.股票键 = row.股票键.slice(0, 3);
    console.log('行业板块示例:', JSON.stringify(row));
}
