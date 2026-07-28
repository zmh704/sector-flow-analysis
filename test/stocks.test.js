const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeStockCode,
    getStockMarket,
    getTradingViewSymbol,
    getStockKey,
    parseAmountToYi,
    parseVolumeToWanShou,
    parseStocks,
    getSectorStocks
} = require('../stock-utils.js');

test('股票代码规范化并生成稳定主键', () => {
    assert.equal(normalizeStockCode('1'), '000001');
    assert.equal(normalizeStockCode('600000.0'), '600000');
    assert.equal(normalizeStockCode('abc'), '');
    assert.equal(getStockMarket('688001'), 'SH');
    assert.equal(getStockMarket('300001'), 'SZ');
    assert.equal(getStockMarket('430001'), 'BJ');
    assert.equal(getStockKey('000001', '平安银行'), 'SZ:000001');
    assert.equal(getStockKey('', ' 平安银行 '), 'legacy:name:平安银行');
});

test('TradingView 符号使用供应商专用交易所代码', () => {
    assert.equal(getTradingViewSymbol('600000'), 'SSE:600000');
    assert.equal(getTradingViewSymbol('688019'), 'SSE:688019');
    assert.equal(getTradingViewSymbol('688019.SH'), 'SSE:688019');
    assert.equal(getTradingViewSymbol('000001'), 'SZSE:000001');
    assert.equal(getTradingViewSymbol('300001'), 'SZSE:300001');
    assert.equal(getTradingViewSymbol('430047'), '');
    assert.equal(getTradingViewSymbol('invalid'), '');
});

test('金额和成交量统一为业务单位', () => {
    assert.equal(parseAmountToYi('60.17亿'), 60.17);
    assert.equal(parseAmountToYi('9000万'), 0.9);
    assert.equal(parseAmountToYi('12,000元'), 0.00012);
    assert.equal(parseVolumeToWanShou('2990万手'), 2990);
    assert.equal(parseVolumeToWanShou('12000手'), 1.2);
    assert.equal(parseAmountToYi('abc'), null);
});

test('兼容旧 4/5 段和新 8/9 段股票字符串', () => {
    const stocks = parseStocks([
        '旧四段(000001|1.00亿|+5000万|120万手)',
        '旧五段(600000|2.00亿|-1.00亿|-2.00%|80万手)',
        '新八段(300001|3.00亿|+2.00亿|70万手|10|9|8|9.5)',
        '新九段(688001|4.00亿|+3.00亿|+5.00%|60万手|20|18|17|19)'
    ].join(', '));
    assert.equal(stocks.length, 4);
    assert.equal(stocks[0].change, '');
    assert.equal(stocks[0].volume, '120万手');
    assert.equal(stocks[1].changePct, -2);
    assert.equal(stocks[2].high, 10);
    assert.equal(stocks[3].stockKey, 'SH:688001');
});

test('结构化股票明细优先于旧文本', () => {
    const stocks = getSectorStocks({
        股票明细: [{ name: '结构化', code: '000001', amountYi: 1, netYi: 0.2 }],
        涉及股票: '旧文本(600000|2亿|+1亿|+1%|10万手)'
    });
    assert.equal(stocks.length, 1);
    assert.equal(stocks[0].name, '结构化');
    assert.equal(stocks[0].stockKey, 'SZ:000001');
});

test('已水合的股票缓存优先于结构化字段和字典', () => {
    const cached = [{ name: '缓存股票', stockKey: 'SZ:000001' }];
    const stocks = getSectorStocks({
        _parsedStocks: cached,
        股票明细: [{ name: '结构化', code: '600000' }],
        股票键: ['SH:600000']
    }, { 'SH:600000': { name: '字典股票', code: '600000' } });
    assert.equal(stocks, cached);
});
