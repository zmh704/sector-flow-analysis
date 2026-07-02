// ===== 股票解析、连续天数计算、关注板块判定 =====

/** HTML 转义，防止 innerHTML 拼接时股票名等含特殊字符导致 XSS */
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** 解析涉及股票字符串为结构化数组 */
function parseStocks(stockStr) {
    if (!stockStr) return [];
    return stockStr.split(',').map(s => {
        const m = s.trim().match(/^(.+?)\(([^)]+)\)$/);
        if (m) {
            if (!m[1] || m[1] === '股票简称') return null;
            const parts = m[2].split('|');
            return {
                name: m[1],
                code: parts[0] || '',
                amount: parts[1] || '',
                net: parts[2] || '',
                change: parts[3] || '',
                volume: parts[4] || ''
            };
        }
        const nameOnly = s.trim().match(/^(.+?)\(/);
        if (nameOnly && nameOnly[1] === '股票简称') return null;
        return nameOnly ? { name: nameOnly[1], code: '', amount: '', net: '', change: '', volume: '' } : null;
    }).filter(Boolean);
}

// 点击股票 → 打开东方财富个股详情页
function openStockQuote(stockName, stockCode) {
    if (!stockCode) {
        alert('未找到股票「' + stockName + '」的代码');
        return;
    }
    // A股市场判断：6开头 → sh(上海)，其余 → sz(深圳)
    const exchange = stockCode.startsWith('6') ? 'sh' : 'sz';
    const url = 'https://quote.eastmoney.com/' + exchange + stockCode + '.html';
    window.open(url, '_blank');
}

/** 计算每只股票从当天往前连续主力净额>0的天数（带缓存） */
function calcStockConsecutiveDays() {
    if (_stockDaysCache) return _stockDaysCache;

    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    if (currentIdx < 0) { _stockDaysCache = new Map(); return _stockDaysCache; }

    // 预处理：每日期所有股票及其净额状态
    const dateStockMaps = [];
    for (let i = 0; i <= currentIdx; i++) {
        const dayData = allDataByDate[sorted[i]]?.data;
        const dayMap = new Map();
        if (dayData) {
            const allSectors = [
                ...(dayData.行业板块资金流向 || []),
                ...(dayData.概念板块资金流向 || [])
            ];
            for (const sector of allSectors) {
                const stocks = sector._parsedStocks || parseStocks(sector.涉及股票);
                for (const stock of stocks) {
                    if (!dayMap.has(stock.name)) {
                        const netNum = parseFloat(stock.net);
                        dayMap.set(stock.name, !isNaN(netNum) && netNum > 0);
                    }
                }
            }
        }
        dateStockMaps.push(dayMap);
    }

    // 从当天往前查连续天数
    const stockDays = new Map();
    const allNames = new Set();
    for (const dayMap of dateStockMaps) {
        for (const name of dayMap.keys()) allNames.add(name);
    }
    for (const name of allNames) {
        let count = 0;
        for (let i = currentIdx; i >= 0; i--) {
            const netPositive = dateStockMaps[i].get(name);
            if (netPositive === true) {
                count++;
            } else {
                break;
            }
        }
        stockDays.set(name, count);
    }

    _stockDaysCache = stockDays;
    return stockDays;
}

/** 判断某股票当日成交量是否小于近 VOLUME_WINDOW 日内（不含当日）的最大成交量 */
function isStockVolumeDecreased(stockName) {
    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    if (currentIdx <= 0) return true;

    const startIdx = Math.max(0, currentIdx - (VOLUME_WINDOW - 1));
    const perDate = (_stockFieldIndex && _stockFieldIndex[stockName]) || {};

    let maxPrev = -Infinity;
    let current = null;
    for (let i = startIdx; i <= currentIdx; i++) {
        const v = perDate[sorted[i]]?.volume;
        if (v == null) continue;  // 当天无该股票或无 volume 字段 → 跳过
        if (i === currentIdx) {
            current = v;
        } else if (v > maxPrev) {
            maxPrev = v;
        }
    }

    // 当日无数据，或前几日无有效数据可比较 → 视为通过
    if (current == null || maxPrev === -Infinity) return true;
    return current < maxPrev;
}

/** 判断某股票当日成交额是否 > 前一日成交额 * 0.9（防止缩量过快） */
function isStockTurnoverNotTooLow(stockName) {
    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    if (currentIdx <= 0) return true;

    const perDate = (_stockFieldIndex && _stockFieldIndex[stockName]) || {};
    const prev = perDate[sorted[currentIdx - 1]]?.amount;
    const curr = perDate[sorted[currentIdx]]?.amount;
    if (curr == null || prev == null) return true;

    const currNum = parseFloat(curr);
    const prevNum = parseFloat(prev);
    if (isNaN(currNum) || isNaN(prevNum)) return true;

    return currNum > prevNum * 0.9;
}

/** 判断股票当日成交额是否 < 前一日成交额 * 1.5（防止放量过快） */
function isStockAmountNotTooHigh(stockName) {
    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    if (currentIdx <= 0) return true;

    const perDate = (_stockFieldIndex && _stockFieldIndex[stockName]) || {};
    const prev = perDate[sorted[currentIdx - 1]]?.amount;
    const curr = perDate[sorted[currentIdx]]?.amount;
    if (curr == null || prev == null) return true;

    const currNum = parseFloat(curr);
    const prevNum = parseFloat(prev);
    if (isNaN(currNum) || isNaN(prevNum)) return true;

    return currNum < prevNum * 1.5;
}

/** 计算板块从当天往前连续主力净额>0的天数（带缓存） */
function calcConsecutiveInflow(sectorName, type) {
    if (dateFileList.length < 2) return 0;
    if (!currentDateFile) return 0;

    if (!_consecutiveInflowCache) _consecutiveInflowCache = new Map();
    const key = sectorName + '|' + type;
    if (_consecutiveInflowCache.has(key)) return _consecutiveInflowCache.get(key);

    const sorted = sortDateFileList();
    const idx = sorted.indexOf(currentDateFile);
    if (idx < 0) return 0;

    let count = 0;
    for (let i = idx; i >= 0; i--) {
        const dayData = allDataByDate[sorted[i]]?.data;
        if (!dayData) break;

        const sectorList = dayData[type] || [];
        const sector = sectorList.find(s => s.板块 === sectorName);

        if (!sector || Number(sector.主力净额) <= 0) {
            break;
        }
        count++;
    }

    _consecutiveInflowCache.set(key, count);
    return count;
}

/** 计算关注板块集合（净额>0 且 连续流入>=FOCUS_MIN_DAYS；概念另需股票数>1） */
function getFocusSectors(activeData) {
    const industryList = activeData.行业板块资金流向 || [];
    const conceptList = activeData.概念板块资金流向 || [];
    const set = new Set();
    for (const sector of industryList) {
        if (sector.板块 === '所属行业' || sector.板块 === '所属概念') continue;
        if (Number(sector.主力净额) > 0 &&
            calcConsecutiveInflow(sector.板块, '行业板块资金流向') >= FOCUS_MIN_DAYS &&
            // isSectorTurnoverDecreased(sector.板块, '行业板块资金流向') &&
            isSectorTurnoverNotTooLow(sector.板块, '行业板块资金流向')) {
            set.add(sector.板块);
        }
    }
    for (const sector of conceptList) {
        if (sector.板块 === '所属行业' || sector.板块 === '所属概念') continue;
        if (Number(sector.主力净额) > 0 && Number(sector.股票数量) > 1 &&
            calcConsecutiveInflow(sector.板块, '概念板块资金流向') >= FOCUS_MIN_DAYS &&
            // isSectorTurnoverDecreased(sector.板块, '概念板块资金流向') &&
            isSectorTurnoverNotTooLow(sector.板块, '概念板块资金流向')) {
            set.add(sector.板块);
        }
    }
    return set;
}

/** 判断板块当日成交额是否 < 前一日成交额 * 1.5（防止放量过快） */
function isSectorTurnoverDecreased(sectorName, type) {
    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    if (currentIdx <= 0) return true;

    const prevData = allDataByDate[sorted[currentIdx - 1]]?.data;
    if (!prevData) return true;

    const currSectorList = (getCurrentData()?.data || {})[type] || [];
    const prevSectorList = prevData[type] || [];
    const curr = currSectorList.find(s => s.板块 === sectorName);
    const prev = prevSectorList.find(s => s.板块 === sectorName);
    if (!curr || !prev) return true;

    return Number(curr.成交额) < Number(prev.成交额) * 1.5;
}

/** 判断板块当日成交额是否 > 前一日成交额 * 0.85（防止缩量过快） */
function isSectorTurnoverNotTooLow(sectorName, type) {
    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    if (currentIdx <= 0) return true;

    const prevData = allDataByDate[sorted[currentIdx - 1]]?.data;
    if (!prevData) return true;

    const currSectorList = (getCurrentData()?.data || {})[type] || [];
    const prevSectorList = prevData[type] || [];
    const curr = currSectorList.find(s => s.板块 === sectorName);
    const prev = prevSectorList.find(s => s.板块 === sectorName);
    if (!curr || !prev) return true;

    return Number(curr.成交额) > Number(prev.成交额) * 0.85;
}
