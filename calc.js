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

const {
    resolveStockQuote,
    getTradingViewSymbol,
    getStockKey,
    parseAmountToYi,
    parseStocks,
    getSectorStocks
} = StockUtils;

// 构建东方财富个股完整行情页 URL（按统一市场映射生成）
function buildEastmoneyUrl(stockCode) {
    const quote = resolveStockQuote(stockCode);
    if (!quote) return '';
    const { code, market } = quote;
    let path;
    if (code.startsWith('688')) {
        path = 'kcb/' + code;
    } else {
        path = market.toLowerCase() + code;
    }
    return 'https://quote.eastmoney.com/' + path + '.html#fullScreenChart';
}

// 点击股票 → 打开个股详情（弹窗已开则在弹窗内加载图表，否则新窗口打开对应网站整页）
function openStockQuote(stockName, stockCode) {
    const quote = resolveStockQuote(stockCode);
    if (!quote) {
        alert('股票「' + stockName + '」缺少有效的六位 A 股代码');
        return;
    }
    const { code, market } = quote;
    // 弹窗已打开：在弹窗内按当前数据源加载图表
    const trendModal = document.getElementById('trendModalOverlay');
    if (trendModal && trendModal.classList.contains('active')) {
        loadTrendStock(stockName, code);
        return;
    }
    // 弹窗未打开：新窗口打开对应网站的完整行情页（TradingView 或新浪财经）
    const source = getStockChartSource();
    let url;
    if (source === 'tradingview') {
        const symbol = getTradingViewSymbol(code);
        url = symbol
            ? 'https://cn.tradingview.com/chart/?symbol=' + encodeURIComponent(symbol)
            : 'https://finance.sina.com.cn/realstock/company/' + market.toLowerCase() + code + '/nc.shtml';
    } else {
        url = 'https://finance.sina.com.cn/realstock/company/' + market.toLowerCase() + code + '/nc.shtml';
    }
    window.open(url, '_blank');
}

/** 计算每只股票从当天往前连续主力净额>0的天数（带缓存，懒加载优化） */
function calcStockConsecutiveDays() {
    if (_stockDaysCache) return _stockDaysCache;

    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    if (currentIdx < 0) { _stockDaysCache = new Map(); return _stockDaysCache; }

    const stockDays = new Map();
    const MAX_CONSECUTIVE = 30; // 上限截断，避免极端值导致无限循环

    // 收集当前日期所有股票名称（从已缓存的 _parsedStocks 中提取，避免重复解析）
    const currData = allDataByDate[sorted[currentIdx]]?.data;
    if (!currData) { _stockDaysCache = stockDays; return stockDays; }

    const allNames = new Set();
    const allSectors = [
        ...(currData.行业板块资金流向 || []),
        ...(currData.概念板块资金流向 || [])
    ];
    for (const sector of allSectors) {
        const stocks = getSectorStocks(sector);
        for (const stock of stocks) {
            allNames.add(stock.stockKey);
        }
    }

    // 懒加载：按需构建每日期股票净额状态 Map，避免一次性全量构建
    const lazyDateMaps = [];

    function getDateMap(i) {
        if (!lazyDateMaps[i]) {
            const dayData = allDataByDate[sorted[i]]?.data;
            const dayMap = new Map();
            if (dayData) {
                const sectors = [
                    ...(dayData.行业板块资金流向 || []),
                    ...(dayData.概念板块资金流向 || [])
                ];
                for (const sector of sectors) {
                    const stocks = getSectorStocks(sector);
                    for (const stock of stocks) {
                        if (!dayMap.has(stock.stockKey)) {
                            dayMap.set(stock.stockKey, stock.netYi != null && stock.netYi > 0);
                        }
                    }
                }
            }
            lazyDateMaps[i] = dayMap;
        }
        return lazyDateMaps[i];
    }

    // 逐股票倒查连续天数（懒加载，零流出的股票仅检查当日）
    for (const stockKey of allNames) {
        let count = 0;
        for (let i = currentIdx; i >= 0; i--) {
            const dayMap = getDateMap(i);
            if (dayMap.get(stockKey) === true) {
                count++;
                if (count >= MAX_CONSECUTIVE) break;
            } else {
                break;
            }
        }
        stockDays.set(stockKey, count);
    }

    _stockDaysCache = stockDays;
    return stockDays;
}

/** 将股票名称或 stockKey 解析为当前索引使用的稳定 key */
function resolveStockKey(stockIdentity) {
    if (typeof stockIdentity === 'string' && (stockIdentity.startsWith('SH:') || stockIdentity.startsWith('SZ:') || stockIdentity.startsWith('BJ:') || stockIdentity.startsWith('legacy:name:'))) {
        return stockIdentity;
    }
    return (_stockNameKeyIndex && _stockNameKeyIndex.get(stockIdentity)) || getStockKey('', stockIdentity);
}

/** 判断某股票当日成交量是否小于近 VOLUME_WINDOW 日内（不含当日）的最大成交量 */
function isStockVolumeDecreased(stockIdentity) {
    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    if (currentIdx <= 0) return true;

    const startIdx = Math.max(0, currentIdx - (VOLUME_WINDOW - 1));
    const perDate = (_stockFieldIndex && _stockFieldIndex[resolveStockKey(stockIdentity)]) || {};

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

/** 判断某股票当日成交额是否 > 前一日成交额 * RATIO_TURNOVER_LOW（防止缩量过快）
 *  无前一天数据时返回 false，避免新进入股票绕过限制 */
function isStockTurnoverNotTooLow(stockIdentity) {
    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    if (currentIdx <= 0) return false;

    const perDate = (_stockFieldIndex && _stockFieldIndex[resolveStockKey(stockIdentity)]) || {};
    const prev = perDate[sorted[currentIdx - 1]]?.amount;
    const curr = perDate[sorted[currentIdx]]?.amount;
    if (curr == null || prev == null) return false;

    return curr > prev * RATIO_TURNOVER_LOW;
}

/** 判断股票当日成交额是否 < 前一日成交额 * RATIO_TURNOVER_HIGH（防止放量过快）
 *  无前一天数据时返回 false，避免新进入股票绕过限制 */
function isStockAmountNotTooHigh(stockIdentity) {
    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    if (currentIdx <= 0) return false;

    const perDate = (_stockFieldIndex && _stockFieldIndex[resolveStockKey(stockIdentity)]) || {};
    const prev = perDate[sorted[currentIdx - 1]]?.amount;
    const curr = perDate[sorted[currentIdx]]?.amount;
    if (curr == null || prev == null) return false;

    return curr < prev * RATIO_TURNOVER_HIGH;
}

/** 判断股票当日最高价是否大于前一日最高价
 *  无前一天数据或价格缺失时返回 false，避免新进入股票绕过限制 */
function isStockHighHigherThanPrev(stockIdentity) {
    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    if (currentIdx <= 0) return false;

    const perDate = (_stockFieldIndex && _stockFieldIndex[resolveStockKey(stockIdentity)]) || {};
    const prev = perDate[sorted[currentIdx - 1]];
    const curr = perDate[sorted[currentIdx]];
    if (!curr || !prev) return false;

    const currHigh = curr.high;
    const prevHigh = prev.high;
    if (!Number.isFinite(currHigh) || !Number.isFinite(prevHigh)) return false;

    return currHigh > prevHigh;
}

/** 判断股票：如果当日成交量 > 昨日成交量，则涨跌幅绝对值必须 < 5%（放量冲高或放量大跌均排除）
 *  无前一天数据或关键字段缺失时返回 false，避免新进入股票绕过限制 */
function isStockVolumeUpChangeLimited(stockIdentity) {
    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    if (currentIdx <= 0) return false;

    const perDate = (_stockFieldIndex && _stockFieldIndex[resolveStockKey(stockIdentity)]) || {};
    const curr = perDate[sorted[currentIdx]];
    const prev = perDate[sorted[currentIdx - 1]];
    if (!curr || !prev) return false;

    const currVol = curr.volume;
    const prevVol = prev.volume;
    if (currVol == null || prevVol == null) return false;

    // 成交量未放大 → 不限制
    if (currVol <= prevVol) return true;

    // 成交量放大 → 检查涨跌幅绝对值 < 5%
    const changeNum = curr.change;
    if (!Number.isFinite(changeNum)) return false;
    return Math.abs(changeNum) < CHANGE_LIMIT_PCT;
}

/** 计算板块从当天往前连续主力净额>0的天数（带缓存） */
function calcConsecutiveInflow(sectorName, type) {
    if (sortDateFileList().length < 2) return 0;
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

/** 计算关注板块集合（净额>0 且 连续流入>=FOCUS_MIN_DAYS）
 *  Set 元素为 '行业|板块名' / '概念|板块名'，带类型前缀避免行业与概念同名板块（如「消费电子」）混淆 */
function getFocusSectors(activeData) {
    const set = new Set();
    for (const sector of filterSectors(activeData.行业板块资金流向 || [], '行业板块资金流向')) {
        set.add('行业|' + sector.板块);
    }
    for (const sector of filterSectors(activeData.概念板块资金流向 || [], '概念板块资金流向')) {
        set.add('概念|' + sector.板块);
    }
    return set;
}

/** 判断板块当日成交额是否 < 前一日成交额 * RATIO_TURNOVER_HIGH（防止放量过快）
 *  @param {Map} currMap - 当日 板块名→板块对象 的 Map
 *  @param {Map} prevMap - 前一日 板块名→板块对象 的 Map */
function isSectorTurnoverDecreased(sectorName, currMap, prevMap) {
    const curr = currMap.get(sectorName);
    const prev = prevMap.get(sectorName);
    // 关注板块需要可验证的跨日数据；缺失任一日期时默认不通过。
    if (!curr || !prev) return false;
    return Number(curr.成交额) < Number(prev.成交额) * RATIO_TURNOVER_HIGH;
}

/** 判断板块当日成交额是否 > 前一日成交额 * RATIO_TURNOVER_LOW（用于今日推荐：高强度板块缩量不严重）
 *  @param {Map} currMap - 当日 板块名→板块对象 的 Map
 *  @param {Map} prevMap - 前一日 板块名→板块对象 的 Map */
function isSectorAbove090(sectorName, currMap, prevMap) {
    const curr = currMap.get(sectorName);
    const prev = prevMap.get(sectorName);
    if (!curr || !prev) return true;
    return Number(curr.成交额) > Number(prev.成交额) * RATIO_TURNOVER_LOW;
}

/** 判断板块当日成交额是否满足成交额趋势条件
 *  前两日连续变小 → 当日 > 前一日 × RATIO_TURNOVER_LOW
 *  前一日变大     → 当日也变大
 *  昨日小于前日且今日大于前日 → 反弹通过
 *  @param {Map} currMap   - 当日板块 Map
 *  @param {Map} prevMap   - 前一日板块 Map
 *  @param {Map|null} prev2Map - 前两日板块 Map
 *  @param {Map|null} prev3Map - 前三日板块 Map */
function isSectorTurnoverNotTooLow(sectorName, currMap, prevMap, prev2Map, prev3Map) {
    const curr = currMap.get(sectorName);
    const prev = prevMap.get(sectorName);
    // 仅缺少昨日对应数据时不通过；更早数据不足则降级为昨日比较。
    if (!curr || !prev) return false;

    const currVal = Number(curr.成交额);
    const prevVal = Number(prev.成交额);
    const prev2 = prev2Map?.get(sectorName);
    const prev3 = prev3Map?.get(sectorName);
    if (!prev2 || !prev3) return currVal > prevVal * RATIO_TURNOVER_LOW;

    const prev2Val = Number(prev2.成交额);
    const prev3Val = Number(prev3.成交额);
    // 条件A：前两日连续变小（昨日<前日<前前日）→ 当日 > 昨日 × RATIO_TURNOVER_LOW
    if (prevVal < prev2Val && prev2Val < prev3Val) {
        return currVal > prevVal * RATIO_TURNOVER_LOW;
    }
    // 条件B：前一日变大（昨日>前日）→ 当日也变大（当日>昨日）
    if (prevVal > prev2Val) {
        return currVal > prevVal;
    }
    // 条件C：昨日小于前日 且 今日大于前日（反弹）
    if (prevVal < prev2Val && currVal > prev2Val) {
        return true;
    }
    // 既不满足A、B也不满足C → 严格按条件4不通过
    return false;
}

// ============================
// 关注板块筛选条件（各条件独立方法，可注释/取消注释来开关）
// ============================

/** 条件①：主力净额 > 0 */
function condNetPositive(sector) {
    return Number(sector.主力净额) > 0;
}

/** 条件②：板块名 ≠ '所属行业' / '所属概念' */
function condNotPlaceholder(sector) {
    return sector.板块 !== '所属行业' && sector.板块 !== '所属概念';
}

/** 条件③：板块成交额 < 昨日成交额 × RATIO_TURNOVER_HIGH（防止放量过快） */
function condAmountNotTooHigh(sectorName, currMap, prevMap) {
    return isSectorTurnoverDecreased(sectorName, currMap, prevMap);
}

/** 条件④：成交额趋势
 *  前两日连续变小 → 当日 > 前一日 × 0.9
 *  前一日变大     → 当日也变大
 *  昨日小于前日且今日大于前日 → 反弹通过
 *  不满足以上任一 → 不通过
 */
function condTurnoverTrend(sectorName, currMap, prevMap, prev2Map, prev3Map) {
    return isSectorTurnoverNotTooLow(sectorName, currMap, prevMap, prev2Map, prev3Map);
}

/** 条件⑤：连续流入天数 >= FOCUS_MIN_DAYS */
function condMinDays(sectorName, type) {
    return calcConsecutiveInflow(sectorName, type) >= FOCUS_MIN_DAYS;
}

/** 构建 板块名→板块对象 的 Map，供 O(1) 查找代替 O(n) find() */
function buildSectorMap(sectorList) {
    const map = new Map();
    for (const s of sectorList) map.set(s.板块, s);
    return map;
}

function getDailySectorMap(filename, type) {
    if (!filename) return new Map();
    const key = filename + '|' + type;
    if (_dailySectorMapCache.has(key)) return _dailySectorMapCache.get(key);
    const map = buildSectorMap(allDataByDate[filename]?.data?.[type] || []);
    _dailySectorMapCache.set(key, map);
    return map;
}

/**
 * 通用板块筛选：对板块列表应用关注板块的全部条件（①~⑤）。
 * 与 getFocusSectors()、updateFocusArea() 共享，保证条件一致。
 * 内部提前构建各日期板块 Map，避免条件函数重复 find()。
 * @param {Array} list  - 板块数据数组
 * @param {string} type - '行业板块资金流向' | '概念板块资金流向'
 * @returns {Array} 通过所有条件的板块项
 */
function filterSectors(list, type) {
    const cacheKey = type;
    if (!_sectorFilterCache) _sectorFilterCache = new Map();
    const cached = _sectorFilterCache.get(cacheKey);
    if (cached && cached.dateFile === currentDateFile && cached.list === list) return cached.value;

    const currMap = getDailySectorMap(currentDateFile, type);

    // 提前构建前几日板块 Map 供条件函数 O(1) 查找
    const sorted = sortDateFileList();
    const currentIdx = sorted.indexOf(currentDateFile);
    const prevMap = currentIdx > 0 ? getDailySectorMap(sorted[currentIdx - 1], type) : new Map();
    const prev2Map = currentIdx >= 2 ? getDailySectorMap(sorted[currentIdx - 2], type) : null;
    const prev3Map = currentIdx >= 3 ? getDailySectorMap(sorted[currentIdx - 3], type) : null;

    const result = list.filter(s =>
        condNotPlaceholder(s) &&
        condNetPositive(s) &&
        condAmountNotTooHigh(s.板块, currMap, prevMap) &&
        condTurnoverTrend(s.板块, currMap, prevMap, prev2Map, prev3Map) &&
        condMinDays(s.板块, type)
    );
    _sectorFilterCache.set(cacheKey, { dateFile: currentDateFile, list, value: result });
    return result;
}

// ============================
// 股票→所属板块映射（供今日推荐、弹窗加星等共享，避免重复计算）
// ============================

let _stockSectorsMap = null;

/** 构建当前日期所有股票→所属板块的映射（含板块天数和类型） */
function buildStockSectorsMap() {
    if (_stockSectorsMap) return _stockSectorsMap;

    const activeData = getActiveData();
    const industryList = activeData.行业板块资金流向 || [];
    const conceptList = activeData.概念板块资金流向 || [];
    const allCurrentSectors = [...industryList, ...conceptList];
    const map = new Map();

    for (const sector of allCurrentSectors) {
        if (!condNotPlaceholder(sector)) continue;
        const isIndustry = industryList.includes(sector);
        const type = isIndustry ? '行业板块资金流向' : '概念板块资金流向';
        const sectorDays = calcConsecutiveInflow(sector.板块, type);
        const stocks = getSectorStocks(sector);
        for (const stock of stocks) {
            if (!map.has(stock.stockKey)) map.set(stock.stockKey, []);
            map.get(stock.stockKey).push({
                name: sector.板块,
                type: isIndustry ? '行业' : '概念',
                days: sectorDays
            });
        }
    }

    _stockSectorsMap = map;
    return map;
}
