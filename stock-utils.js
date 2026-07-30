(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StockUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function normalizeStockName(name) {
        return String(name == null ? '' : name).normalize('NFKC').trim().replace(/\s+/g, ' ');
    }

    function normalizeStockCode(value) {
        if (value == null || value === '') return '';
        if (typeof value === 'number') {
            return Number.isInteger(value) && value >= 0 && value <= 999999
                ? String(value).padStart(6, '0') : '';
        }
        let code = String(value).normalize('NFKC').trim().toUpperCase();
        code = code.replace(/^['’]/, '').replace(/\.0+$/, '');
        const decorated = code.match(/^(?:(?:SH|SZ|BJ)[.\s-]?)?(\d{1,6})(?:[.\s-]?(?:SH|SZ|BJ))?$/);
        if (!decorated) return '';
        code = decorated[1].padStart(6, '0');
        return /^(?:6\d{5}|0\d{5}|3\d{5}|4\d{5}|8\d{5})$/.test(code) ? code : '';
    }

    function getStockMarket(code) {
        const normalized = normalizeStockCode(code);
        if (!normalized) return '';
        if (normalized.startsWith('6')) return 'SH';
        if (normalized.startsWith('0') || normalized.startsWith('3')) return 'SZ';
        return 'BJ';
    }

    function resolveStockQuote(value) {
        const code = normalizeStockCode(value);
        const market = getStockMarket(code);
        return code && market ? { code, market } : null;
    }

    /** TradingView 使用独立的交易所代码，不能复用内部 SH/SZ/BJ 市场码。 */
    function getTradingViewSymbol(value) {
        const quote = resolveStockQuote(value);
        if (!quote) return '';
        const exchangeByMarket = {
            SH: 'SSE',
            SZ: 'SZSE'
        };
        const exchange = exchangeByMarket[quote.market];
        return exchange ? exchange + ':' + quote.code : '';
    }

    function getStockKey(code, name) {
        const normalized = normalizeStockCode(code);
        if (normalized) return getStockMarket(normalized) + ':' + normalized;
        return 'legacy:name:' + normalizeStockName(name);
    }

    function parseUnitNumber(value, units) {
        if (value == null || value === '') return null;
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        const text = String(value).trim().replace(/,/g, '');
        const match = text.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*([^\d\s]*)$/);
        if (!match) return null;
        const number = Number(match[1]);
        if (!Number.isFinite(number)) return null;
        const unit = match[2];
        if (!(unit in units)) return null;
        return number * units[unit];
    }

    function parseAmountToYi(value) {
        return parseUnitNumber(value, { '': 1e-8, '元': 1e-8, '万': 1e-4, '万元': 1e-4, '亿': 1, '亿元': 1 });
    }

    function parseVolumeToWanShou(value) {
        return parseUnitNumber(value, { '': 1e-4, '手': 1e-4, '万手': 1, '亿手': 1e4 });
    }

    function parsePercent(value) {
        return parseUnitNumber(value, { '': 1, '%': 1 });
    }

    function formatAmountYi(value) {
        if (value == null || !Number.isFinite(value)) return '';
        if (Math.abs(value) >= 1) return (value >= 0 ? '+' : '') + value.toFixed(2) + '亿';
        return (value >= 0 ? '+' : '') + (value * 10000).toFixed(2) + '万';
    }

    function normalizeStock(stock) {
        const name = normalizeStockName(stock.name);
        const code = normalizeStockCode(stock.code);
        const amountValue = stock.amountText ?? stock.amount;
        const netValue = stock.netText ?? stock.net;
        const volumeValue = stock.volumeText ?? stock.volume;
        const changeValue = stock.changeText ?? stock.change;
        // 结构化字段中的 amount/net 约定为基础单位（元），文本字段才带展示单位。
        const amountYi = stock.amountYi != null ? Number(stock.amountYi)
            : stock.amountText == null && typeof stock.amount === 'number' ? stock.amount / 1e8 : parseAmountToYi(amountValue);
        const netYi = stock.netYi != null ? Number(stock.netYi)
            : stock.netText == null && typeof stock.net === 'number' ? stock.net / 1e8 : parseAmountToYi(netValue);
        const volumeWanShou = stock.volumeWanShou != null ? Number(stock.volumeWanShou)
            : stock.volumeText == null && typeof stock.volume === 'number' ? stock.volume / 1e4 : parseVolumeToWanShou(volumeValue);
        const changePct = stock.changePct != null ? Number(stock.changePct) : parsePercent(changeValue);
        const parsePrice = value => {
            if (value == null || value === '') return null;
            const number = Number(value);
            return Number.isFinite(number) ? number : null;
        };
        return {
            name,
            code,
            stockKey: stock.stockKey || getStockKey(code, name),
            amount: stock.amountText ?? stock.amount ?? '',
            net: stock.netText ?? stock.net ?? '',
            change: stock.changeText ?? stock.change ?? '',
            volume: stock.volumeText ?? stock.volume ?? '',
            amountYi: Number.isFinite(amountYi) ? amountYi : null,
            netYi: Number.isFinite(netYi) ? netYi : null,
            changePct: Number.isFinite(changePct) ? changePct : null,
            volumeWanShou: Number.isFinite(volumeWanShou) ? volumeWanShou : null,
            high: parsePrice(stock.high),
            open: parsePrice(stock.open),
            low: parsePrice(stock.low),
            close: parsePrice(stock.close),
            avg5: parsePrice(stock.avg5),
            avg10: parsePrice(stock.avg10)
        };
    }

    function parseStocks(stockStr) {
        if (!stockStr) return [];
        return String(stockStr).split(/,\s*(?=[^,()]+\()/).map(part => {
            const match = part.trim().match(/^(.+?)\(([^)]*)\)$/);
            if (!match || !match[1] || match[1] === '股票简称') return null;
            const fields = match[2].split('|').map(value => value.trim());
            const isNewFormat = fields.length >= 8;
            const hasChange = fields.length === 5 || fields.length >= 9;
            return normalizeStock({
                name: match[1],
                code: fields[0] || '',
                amount: fields[1] || '',
                net: fields[2] || '',
                change: hasChange ? fields[3] || '' : '',
                volume: hasChange ? fields[4] || '' : fields[3] || '',
                high: isNewFormat ? (hasChange ? fields[5] : fields[4]) : '',
                open: isNewFormat ? (hasChange ? fields[6] : fields[5]) : '',
                low: isNewFormat ? (hasChange ? fields[7] : fields[6]) : '',
                close: isNewFormat ? (hasChange ? fields[8] : fields[7]) : ''
            });
        }).filter(Boolean);
    }

    function getSectorStocks(sector, stockDictionary) {
        if (!sector) return [];
        if (Array.isArray(sector._parsedStocks)) return sector._parsedStocks;
        if (Array.isArray(sector.股票明细)) return sector.股票明细.map(normalizeStock).filter(stock => stock.name);
        if (Array.isArray(sector.股票键) && stockDictionary && typeof stockDictionary === 'object') {
            return sector.股票键
                .map(stockKey => stockDictionary[stockKey])
                .filter(Boolean)
                .map(normalizeStock)
                .filter(stock => stock.name);
        }
        return parseStocks(sector.涉及股票);
    }

    return {
        normalizeStockName,
        normalizeStockCode,
        getStockMarket,
        resolveStockQuote,
        getTradingViewSymbol,
        getStockKey,
        parseAmountToYi,
        parseVolumeToWanShou,
        parsePercent,
        formatAmountYi,
        normalizeStock,
        parseStocks,
        getSectorStocks
    };
});
