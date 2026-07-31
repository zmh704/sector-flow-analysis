'use strict';
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync('data')
    .filter(f => f.endsWith('.v3.json'))
    .sort();

for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join('data', f), 'utf8'));
    const stocks = Object.values(d['股票字典']);
    const hasNet = stocks.filter(s => s.netYi != null && Number.isFinite(s.netYi));
    const hasChange = stocks.filter(s => s.changePct != null && Number.isFinite(s.changePct));
    const hasAmount = stocks.filter(s => s.amountYi != null && Number.isFinite(s.amountYi));
    const hasClose = stocks.filter(s => s.close != null && Number.isFinite(s.close));
    const hasAvg5 = stocks.filter(s => s.avg5 != null && Number.isFinite(s.avg5));
    console.log(
        d['交易日期'],
        '总' + stocks.length,
        'netYi:' + hasNet.length,
        'changePct:' + hasChange.length,
        'amountYi:' + hasAmount.length,
        'close:' + hasClose.length,
        'avg5:' + hasAvg5.length
    );
}
