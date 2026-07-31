// ===== 弹窗：查看全部 / 趋势对比 / 今日龙头，及股票表格 =====

// 查看全部弹窗状态
let modalSortState = { key: 'net', asc: false };
let modalDataType = '';
let modalDataCache = [];

// 股票面板表格排序：缓存各面板最后渲染上下文，供点击表头重排（key=panelList.id）
const _stockTableCtx = new Map();
// 关注板块表格排序状态（null=默认按天数降序）
let _focusSortState = null;
// 当前选中项高亮：股票类（涉及股票/今日推荐共用）与板块类（关注板块）
let _selectedStockName = null;
let _selectedFocusKey = null; // 格式 "板块名|数据类型"

/** 高亮指定股票面板中当前选中的行（供不重绘的涉及股票点击即时应用） */
function highlightSelectedStockRow(panelList) {
    if (!panelList) return;
    panelList.querySelectorAll('tr.row-selected').forEach(r => r.classList.remove('row-selected'));
    if (!_selectedStockName) return;
    panelList.querySelectorAll('tr[data-stock-name]').forEach(r => {
        if (r.dataset.stockName === _selectedStockName) r.classList.add('row-selected');
    });
}

// ===== 查看全部弹窗 =====

function renderModalTable() {
    const tbody = document.getElementById('modalBody');
    tbody.innerHTML = '';

    if (modalDataCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;padding:30px;">暂无数据</td></tr>';
        return;
    }

    const filterInvalid = document.getElementById('filterInvalid').checked;
    let filtered = modalDataCache;
    if (filterInvalid && modalDataType === '概念板块资金流向') {
        filtered = modalDataCache.filter(item => Number(item.股票数量) > 1);
    }

    // 搜索过滤（支持板块名称 + 涉及股票名称模糊查询）
    const searchInput = document.getElementById('modalSearchInput');
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (searchTerm) {
        filtered = filtered.filter(item => {
            // 1. 板块名称匹配
            if (item.板块.toLowerCase().includes(searchTerm)) return true;
            // 2. 涉及股票名称匹配
            const stocks = getSectorStocks(item);
            return stocks.some(stock => stock.name.toLowerCase().includes(searchTerm));
        });
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;padding:30px;">过滤后无数据，请取消「过滤无效」</td></tr>';
        return;
    }

    const sorted = [...filtered].sort((a, b) => {
        let va, vb;
        if (modalSortState.key === 'name') {
            va = a.板块;
            vb = b.板块;
            return modalSortState.asc ? va.localeCompare(vb) : vb.localeCompare(va);
        } else if (modalSortState.key === 'net') {
            va = a._val;
            vb = b._val;
        } else if (modalSortState.key === 'turnover') {
            va = a._turnover;
            vb = b._turnover;
        } else if (modalSortState.key === 'days') {
            va = a._days === '-' ? -1 : a._days;
            vb = b._days === '-' ? -1 : b._days;
        } else if (modalSortState.key === 'count') {
            va = a._stockCount;
            vb = b._stockCount;
        }
        return modalSortState.asc ? va - vb : vb - va;
    });

    const fragment = document.createDocumentFragment();
    sorted.forEach(item => {
        const val = item._val;
        const cls = val >= 0 ? 'positive' : 'negative';
        const formattedVal = (val / 100000000).toFixed(2);
        const turnover = (item._turnover / 100000000).toFixed(2);
        const sign = val >= 0 ? '+' : '';

        const sectorStyle = item._highlighted
            ? 'color:#e53935;font-weight:700'
            : '';
        const daysStyle = typeof item._days === 'number' && item._days >= MODAL_DAYS_HIGHLIGHT
            ? 'color:#e53935;font-weight:700'
            : 'color:#555';

        const tr = document.createElement('tr');
        // 添加 data-* 属性，支持点击行弹出板块详情
        tr.dataset.sectorName = item.板块;
        tr.dataset.type = modalDataType;
        tr.dataset.title = (item._highlighted ? '🔥 ' : '') + escapeHtml(item.板块) +
                          (typeof item._days === 'number' ? ` (${item._days}天)` : '');
        tr.style.cursor = 'pointer';

        tr.innerHTML = `
            <td style="${sectorStyle}white-space:nowrap">${escapeHtml(item.板块)}</td>
            <td style="text-align:right;white-space:nowrap">${sign}${formattedVal} 亿</td>
            <td style="text-align:right;white-space:nowrap">${turnover} 亿</td>
            <td style="text-align:center;${daysStyle}white-space:nowrap">${item._days}</td>
            <td style="text-align:right;white-space:nowrap">${item.股票数量}</td>
            <td style="font-size:12px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.涉及股票 || item._parsedStocks.map(stock => stock.name).join(', ') || '-')}</td>
        `;
        fragment.appendChild(tr);
    });

    tbody.replaceChildren(fragment);

    ['name', 'net', 'turnover', 'days', 'count'].forEach(k => {
        const arrow = document.getElementById('sortArrow' + k.charAt(0).toUpperCase() + k.slice(1));
        if (arrow) {
            if (modalSortState.key === k) {
                arrow.textContent = modalSortState.asc ? '▲' : '▼';
                arrow.className = 'sort-arrow active';
            } else {
                arrow.textContent = '';
                arrow.className = 'sort-arrow';
            }
        }
    });
}

function sortModalTable(key) {
    if (modalSortState.key === key) {
        modalSortState.asc = !modalSortState.asc;
    } else {
        modalSortState.key = key;
        modalSortState.asc = key === 'net';
    }
    renderModalTable();
}

function showAllData(type) {
    const activeData = getActiveData();
    const list = activeData[type] || [];
    const title = type === '行业板块资金流向' ? '🏛️ 全部行业板块' : '💡 全部概念板块';

    document.getElementById('modalTitle').textContent = title;

    modalDataType = type;
    const otherType = type === '行业板块资金流向' ? '概念板块资金流向' : '行业板块资金流向';
    const otherList = filterSectors(activeData[otherType] || [], otherType); // 仅关注板块参与配对

    // 第一步：构建缓存，预解析股票
    modalDataCache = list.map(item => {
        const val = Number(item.主力净额);
        let days = '-';
        let highlighted = false;
        if (val > 0) {
            days = calcConsecutiveInflow(item.板块, type);
            highlighted = days >= MODAL_DAYS_HIGHLIGHT;
        }
        return {
            ...item,
            _val: val,
            _turnover: Number(item.成交额),
            _stockCount: Number(item.股票数量),
            _days: days,
            _highlighted: highlighted,
            _parsedStocks: getSectorStocks(item)
        };
    });

    // 第二步：对侧关注板块只构建一次股票 Set，再计算当前全部板块的关联
    const otherIndex = otherList.map(otherItem => ({
        item: otherItem,
        days: calcConsecutiveInflow(otherItem.板块, otherType),
        stocks: new Set(getSectorStocks(otherItem).map(stock => stock.stockKey))
    }));
    modalDataCache.forEach(item => {
        const stocksByKey = new Map(item._parsedStocks.map(stock => [stock.stockKey, stock]));
        const matched = [];
        otherIndex.forEach(other => {
            const common = [...stocksByKey.keys()]
                .filter(stockKey => other.stocks.has(stockKey))
                .map(stockKey => stocksByKey.get(stockKey).name);
            if (common.length > 0) {
                matched.push({
                    name: other.item.板块,
                    days: other.days,
                    commonStocks: common,
                    _dataType: otherType
                });
            }
        });
        item._matched = matched;
    });

    modalSortState = { key: 'days', asc: false };
    renderModalTable();

    document.getElementById('modalOverlay').classList.add('active');
}

function closeModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('modalOverlay').classList.remove('active');
}

// ===== 趋势对比弹窗 =====

function getTrendSeries(sectorName, type) {
    const sorted = sortDateFileList();
    const currentIndex = currentDateFile ? sorted.indexOf(currentDateFile) : -1;
    const available = currentIndex >= 0 ? sorted.slice(0, currentIndex + 1) : sorted;
    const recent = available.slice(-TREND_CHART_DAYS);
    const dates = [];
    const netValues = [];
    const turnoverValues = [];

    for (const filename of recent) {
        const entry = allDataByDate[filename];
        dates.push(entry?.dateLabel || _manifestEntryByPath.get(filename)?.tradingDate || filename);
        const sector = getDailySectorMap(filename, type).get(sectorName);
        netValues.push(sector ? Number(sector.主力净额) / 100000000 : null);
        turnoverValues.push(sector ? Number(sector.成交额) / 100000000 : null);
    }
    return {
        net: { dates, values: netValues },
        turnover: { dates, values: turnoverValues }
    };
}

function updateTrendBarChart(existingChart, ctx, trendData, field) {
    const colors = trendData.values.map(v => {
        if (v == null) return 'rgba(150, 150, 150, 0.5)';
        if (field === 'net') {
            return v >= 0 ? 'rgba(229, 57, 53, 0.8)' : 'rgba(67, 160, 71, 0.8)';
        }
        return 'rgba(229, 57, 53, 0.8)';
    });
    const borderColors = trendData.values.map(v => {
        if (v == null) return 'rgba(150, 150, 150, 0.5)';
        if (field === 'net') {
            return v >= 0 ? 'rgba(229, 57, 53, 1)' : 'rgba(67, 160, 71, 1)';
        }
        return 'rgba(229, 57, 53, 1)';
    });

    const tooltipLabel = field === 'net' ? '主力净额' : '成交额';
    const yAxisTitle = field === 'net' ? '主力净额（亿元）' : '成交额（亿）';

    if (existingChart) {
        existingChart.data.labels = trendData.dates;
        existingChart.data.datasets[0].data = trendData.values;
        existingChart.data.datasets[0].backgroundColor = colors;
        existingChart.data.datasets[0].borderColor = borderColors;
        existingChart.options.scales.y.title.text = yAxisTitle;
        existingChart.$tooltipLabel = tooltipLabel;
        existingChart.update();
        return existingChart;
    }

    const chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: trendData.dates,
            datasets: [{
                data: trendData.values,
                backgroundColor: colors,
                borderColor: borderColors,
                borderWidth: 2,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed.y;
                            const sign = val >= 0 ? '+' : '';
                            return `${context.chart.$tooltipLabel || tooltipLabel}: ${sign}${val.toFixed(2)} 亿`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: '日期',
                        font: { size: 13, weight: 'bold' }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.06)'
                    },
                    ticks: {
                        font: { size: 12 }
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: yAxisTitle,
                        font: { size: 13, weight: 'bold' }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    },
                    ticks: {
                        font: { size: 12 },
                        callback: function(value) {
                            return value.toFixed(1);
                        }
                    }
                }
            }
        }
    });

    chart.$tooltipLabel = tooltipLabel;
    return chart;
}

/** 渲染股票表格（精简：股票名称、主力净额、连续流入天数、操作）
 *  @param {Object|null} sortState - {key:'net'|'days', asc:bool}；null=默认加星置顶分组排序
 */
function renderStockTable(panelList, stocks, bgSet, starSet, stockDaysMap, sortState) {
    panelList.innerHTML = '';
    if (!stocks || stocks.length === 0) {
        panelList.innerHTML = renderEmptyState('📊', '无涉及股票数据');
        return;
    }

    const bs = bgSet || new Set();
    const ss = starSet || bs;
    const sdm = stockDaysMap || new Map();

    // 缓存渲染上下文，供点击表头重排时复用（排序状态除外）
    _stockTableCtx.set(panelList.id, { stocks, bgSet, starSet, stockDaysMap, sortState: sortState || null });

    let sortedStocks;
    if (sortState) {
        // 表头排序：打破分组，全局按列排序（⭐标记与共同股票高亮保留）
        const dir = sortState.asc ? 1 : -1;
        sortedStocks = [...stocks].sort((a, b) => {
            let va, vb;
            if (sortState.key === 'days') {
                va = sdm.get(a.stockKey || resolveStockKey(a.name)) || 0;
                vb = sdm.get(b.stockKey || resolveStockKey(b.name)) || 0;
            } else { // net
                va = a.netYi == null ? -Infinity : a.netYi;
                vb = b.netYi == null ? -Infinity : b.netYi;
            }
            return (va - vb) * dir;
        });
    } else {
        // 单次遍历完成分组，再各自按主力净额排序。
        const groups = [[], [], []];
        for (const stock of stocks) {
            const stockKey = stock.stockKey || resolveStockKey(stock.name);
            const groupIndex = ss.has(stockKey) ? 0 : (bs.has(stock.name) || bs.has(stockKey)) ? 1 : 2;
            groups[groupIndex].push(stock);
        }
        const byNetDesc = (a, b) => (b.netYi ?? -Infinity) - (a.netYi ?? -Infinity);
        for (const group of groups) group.sort(byNetDesc);
        sortedStocks = groups.flat();
    }

    const netArrow = sortState && sortState.key === 'net' ? (sortState.asc ? ' ▲' : ' ▼') : '';
    const daysArrow = sortState && sortState.key === 'days' ? (sortState.asc ? ' ▲' : ' ▼') : '';

    const table = document.createElement('table');
    table.className = 'stock-table';
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr><th>股票名称</th><th class="th-sortable" data-sort="net" style="cursor:pointer;">主力净额<span class="sort-arrow">${netArrow}</span></th><th class="th-sortable" data-sort="days" style="cursor:pointer;">天数<span class="sort-arrow">${daysArrow}</span></th><th class="th-action">操作</th></tr>`;
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    sortedStocks.forEach((stock, i) => {
        const tr = document.createElement('tr');
        const stockIdentity = stock.stockKey || resolveStockKey(stock.name);
        const isBg = bs.has(stock.name) || bs.has(stockIdentity);
        const isStarred = ss.has(stockIdentity);
        if (isBg) tr.classList.add('stock-common');
        if (_selectedStockName && stock.name === _selectedStockName) tr.classList.add('row-selected');
        const changeNum = stock.netYi;
        const changeCls = changeNum != null && changeNum >= 0 ? 'stock-change-positive' : 'stock-change-negative';
        // 涨跌幅拼在股票名称后
        const chgNum = stock.changePct;
        let changeBadge = '';
        if (stock.change && !isNaN(chgNum)) {
            const chgColor = chgNum >= 0 ? '#e53935' : '#43a047';
            changeBadge = ` <span style="color:${chgColor};font-size:11px;">${chgNum >= 0 ? '▲' : '▼'} ${escapeHtml(stock.change)}</span>`;
        }
        const stockDays = sdm.get(stockIdentity) || 0;
        const daysCls = stockDays >= 3 ? 'stock-days-high' : 'stock-days-normal';
        const isPreselected = isStockPreselected(stock.name);
        tr.innerHTML = `
            <td>${isStarred ? '⭐ ' : ''}${escapeHtml(stock.name)}${changeBadge}</td>
            <td class="${changeCls}">${escapeHtml(stock.net)}</td>
            <td class="stock-days ${daysCls}">${stockDays > 0 ? stockDays + '天' : '-'}</td>
            <td><span class="stock-preselect-btn ${isPreselected ? 'preselected' : ''}" data-preselect-stock="${escapeHtml(stock.name)}">${isPreselected ? '取消' : '预选'}</span></td>
        `;
        tr.style.cursor = 'pointer';
        tr.dataset.stockName = stock.name;
        tr.dataset.stockKey = stockIdentity;
        tr.dataset.stockCode = stock.code;
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    panelList.appendChild(table);
}

/** 处理股票表格表头点击排序（涉及股票 / 今日推荐 共用）
 *  同列再次点击翻转升降序；从默认态首次点击时，net→降序、days→降序 */
function sortStockTable(panelList, key) {
    const ctx = _stockTableCtx.get(panelList.id);
    if (!ctx) return;
    const prev = ctx.sortState;
    let asc;
    if (prev && prev.key === key) {
        asc = !prev.asc;
    } else {
        asc = false; // 首次点击默认降序
    }
    renderStockTable(panelList, ctx.stocks, ctx.bgSet, ctx.starSet, ctx.stockDaysMap, { key, asc });
}


function switchStockPanelTab(tab) {
    document.getElementById('stockPanelStocksTabBtn').classList.toggle('active', tab === 'stocks');
    document.getElementById('stockPanelPreselectedTabBtn').classList.toggle('active', tab === 'preselected');
    document.getElementById('stockPanelFocusTabBtn').classList.toggle('active', tab === 'focus');
    document.getElementById('stockPanelAllTabBtn').classList.toggle('active', tab === 'all');
    document.getElementById('stockPanelStocksContent').classList.toggle('active', tab === 'stocks');
    document.getElementById('stockPanelPreselectedContent').classList.toggle('active', tab === 'preselected');
    document.getElementById('stockPanelFocusContent').classList.toggle('active', tab === 'focus');
    document.getElementById('stockPanelAllContent').classList.toggle('active', tab === 'all');
    if (tab === 'preselected') renderPreselectedPanel();
    if (tab === 'focus') renderFocusPanel();
    if (tab === 'all') renderAllStocksPanel();
}

/** 渲染弹窗【今日推荐】页签（与首页今日推荐同一筛选逻辑，保证股票一致） */
function renderLeaderPanel() {
    const panelList = document.getElementById('stockPanelLeaderList');
    if (!panelList) return;

    if (!getCurrentData()) {
        panelList.innerHTML = renderEmptyState('📭', '暂无数据', '请先加载数据文件');
        return;
    }

    const leaders = calcTodayLeaders();
    if (leaders.length === 0) {
        panelList.innerHTML = renderEmptyState('🏆', '暂无符合条件的推荐股票', '尝试调整筛选条件或切换日期');
        return;
    }

    const stockDaysMap = calcStockConsecutiveDays();
    renderStockTable(panelList, leaders, null, null, stockDaysMap);
}

/** 渲染弹窗【我的预选】页签，显示所有已预选股票，点击跳转个股行情 */
function renderPreselectedPanel() {
    const panelList = document.getElementById('stockPanelPreselectedList');
    if (!panelList) return;

    const preselectedKeys = getPreselectedStocks();
    if (preselectedKeys.length === 0) {
        panelList.innerHTML = renderEmptyState('⭐', '暂无预选股票', '在表格中点击「预选」按钮添加');
        return;
    }

    const activeData = getActiveData();
    if (!activeData) {
        panelList.innerHTML = renderEmptyState('📭', '暂无数据', '请先加载数据文件');
        return;
    }

    // 遍历当日所有股票，匹配预选 key
    const stockMap = new Map();
    const allSectors = [...(activeData.行业板块资金流向 || []), ...(activeData.概念板块资金流向 || [])];
    for (const sector of allSectors) {
        if (!condNotPlaceholder(sector)) continue;
        const stocks = getSectorStocks(sector);
        for (const stock of stocks) {
            if (!stock.stockKey || !stock.name) continue;
            if (!stockMap.has(stock.stockKey)) {
                stockMap.set(stock.stockKey, stock);
            }
        }
    }

    // 匹配预选列表中的股票
    const preselectedStocks = [];
    for (const key of preselectedKeys) {
        const resolved = resolveStockKey(key);
        const stock = stockMap.get(resolved) || stockMap.get(key);
        if (stock) preselectedStocks.push(stock);
    }

    if (preselectedStocks.length === 0) {
        panelList.innerHTML = renderEmptyState('⭐', '当日数据中暂无已预选股票', '预选股票可能不在当前日期的成交额排行中');
        return;
    }

    const stockDaysMap = calcStockConsecutiveDays();
    const starSet = calcLeaderStarSet(preselectedStocks, stockDaysMap);
    renderStockTable(panelList, preselectedStocks, null, starSet, stockDaysMap);
}

/** 渲染弹窗【关注板块】页签（与首页关注板块同一数据，点击行同首页点击效果） */
function renderFocusPanel() {
    const panelList = document.getElementById('stockPanelFocusList');
    if (!panelList) return;

    if (!getCurrentData()) {
        panelList.innerHTML = renderEmptyState('📭', '暂无数据', '请先加载数据文件');
        return;
    }

    const { industries, concepts } = calcFocusSectorsData(getActiveData());
    if (industries.length === 0 && concepts.length === 0) {
        panelList.innerHTML = renderEmptyState('📌', '暂无符合条件的关注板块', '尝试切换日期或调整筛选条件');
        return;
    }

    // 合并行业+概念
    const rows = [
        ...industries.map(s => ({ name: s.name, type: '行业', dataType: '行业板块资金流向', days: s.days })),
        ...concepts.map(s => ({ name: s.name, type: '概念', dataType: '概念板块资金流向', days: s.days }))
    ];

    // 排序：默认按天数降序；点击表头后按指定列排序
    if (_focusSortState) {
        const dir = _focusSortState.asc ? 1 : -1;
        rows.sort((a, b) => {
            if (_focusSortState.key === 'type') {
                return a.type.localeCompare(b.type) * dir || b.days - a.days;
            }
            return (a.days - b.days) * dir; // days
        });
    } else {
        rows.sort((a, b) => b.days - a.days);
    }

    const typeArrow = _focusSortState && _focusSortState.key === 'type' ? (_focusSortState.asc ? ' ▲' : ' ▼') : '';
    const daysArrow = _focusSortState && _focusSortState.key === 'days' ? (_focusSortState.asc ? ' ▲' : ' ▼') : '';

    const table = document.createElement('table');
    table.className = 'stock-table';
    table.innerHTML = `<thead><tr><th>板块</th><th class="th-sortable" data-sort="type" style="cursor:pointer;text-align:center;">类型<span class="sort-arrow">${typeArrow}</span></th><th class="th-sortable" data-sort="days" style="cursor:pointer;text-align:center;">净流入天数<span class="sort-arrow">${daysArrow}</span></th></tr></thead>`;
    const tbody = document.createElement('tbody');
    rows.forEach(row => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.dataset.sector = row.name;
        tr.dataset.type = row.dataType;
        if (_selectedFocusKey === row.name + '|' + row.dataType) tr.classList.add('row-selected');
        const typeColor = row.type === '行业' ? '#2563eb' : '#7c3aed';
        const daysColor = row.days >= HIGHLIGHT_MIN_DAYS ? '#dc2626' : '#555';
        tr.innerHTML =
            `<td style="color:${typeColor};font-weight:600;">${escapeHtml(row.name)}</td>` +
            `<td style="text-align:center;color:${typeColor};">${row.type}</td>` +
            `<td style="text-align:center;color:${daysColor};font-weight:700;">${row.days}天</td>`;
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    panelList.innerHTML = '';
    panelList.appendChild(table);
}

/** 渲染弹窗【全部股票】页签，显示当日所有股票，支持7个可勾选筛选条件 */
function renderAllStocksPanel() {
    const panelList = document.getElementById('stockPanelAllList');
    if (!panelList) return;

    const activeData = getActiveData();
    if (!activeData) {
        panelList.innerHTML = renderEmptyState('📭', '暂无数据', '请先加载数据文件');
        return;
    }

    // 收集当日所有去重股票
    const stockMap = new Map();
    const allSectors = [...(activeData.行业板块资金流向 || []), ...(activeData.概念板块资金流向 || [])];
    for (const sector of allSectors) {
        if (!condNotPlaceholder(sector)) continue;
        const stocks = getSectorStocks(sector);
        for (const stock of stocks) {
            if (!stock.stockKey || !stock.name) continue;
            if (!stockMap.has(stock.stockKey)) {
                stockMap.set(stock.stockKey, stock);
            }
        }
    }
    let allStocks = [...stockMap.values()];

    if (allStocks.length === 0) {
        panelList.innerHTML = renderEmptyState('📋', '暂无股票数据', '请切换日期或加载数据');
        return;
    }

    // 读取筛选条件
    const chk = id => { const el = document.getElementById(id); return el ? el.checked : false; };
    const fAvg5 = chk('filterAllAvg5');
    const fInflow = chk('filterAllInflow');
    const fAmount = chk('filterAllAmount');
    const fGap = chk('filterAllGap');
    const fVolChange = chk('filterAllVolChange');
    const fHigh = chk('filterAllHigh');
    const fCloseOpen = chk('filterAllCloseOpen');
    const fPriceAbove5 = chk('filterAllPriceAbove5');

    const anyFilter = fAvg5 || fInflow || fAmount || fGap || fVolChange || fHigh || fCloseOpen || fPriceAbove5;
    if (anyFilter) {
        const stockDaysMap = calcStockConsecutiveDays();
        const stockSectorsMap = buildStockSectorsMap();

        allStocks = allStocks.filter(stock => {
            const identity = stock.stockKey || resolveStockKey(stock.name);

            if (fAvg5 && !isStockAvg5GeAvg10(identity)) return false;
            if (fInflow && !(stock.netYi != null && stock.netYi > 0)) return false;
            if (fAmount && !isStockAmountNotTooHigh(identity)) return false;
            if (fGap) {
                const stockDays = stockDaysMap.get(identity) || 0;
                const sectors = stockSectorsMap.get(identity) || [];
                if (sectors.length === 0) return false;
                const maxSectorDays = Math.max(...sectors.map(s => s.days));
                if (stockDays < maxSectorDays - LEADER_GAP || stockDays > maxSectorDays) return false;
            }
            if (fVolChange && !isStockVolumeUpChangeLimited(identity)) return false;
            if (fHigh && !isStockHighHigherThanPrev(identity)) return false;
            if (fCloseOpen && !isStockCloseOpenRatioOk(identity)) return false;
            if (fPriceAbove5 && !isStockCloseAboveAvg5(identity)) return false;
            return true;
        });
    }

    const stockDaysMap = calcStockConsecutiveDays();
    const starSet = calcLeaderStarSet(allStocks, stockDaysMap);
    renderStockTable(panelList, allStocks, null, starSet, stockDaysMap);
}

/** 处理关注板块表格表头点击排序（同列再次点击翻转升降序） */
function sortFocusTable(key) {
    if (_focusSortState && _focusSortState.key === key) {
        _focusSortState.asc = !_focusSortState.asc;
    } else {
        _focusSortState = { key, asc: false }; // 首次点击默认降序
    }
    renderFocusPanel();
}

function showStocksInPanel(sectorName, type, commonStockNames) {
    const panelList = document.getElementById('stockPanelList');
    const panelTitle = document.getElementById('stockPanelTitle');
    if (!panelList) return;

    if (!getCurrentData()) {
        panelList.innerHTML = renderEmptyState('📭', '暂无数据', '请先加载数据文件');
        return;
    }

    const activeData = getActiveData();
    const sectorList = activeData[type] || [];
    const sector = sectorList.find(s => s.板块 === sectorName);
    if (!sector) {
        panelList.innerHTML = renderEmptyState('🔍', '未找到该板块数据');
        return;
    }

    const stocks = getSectorStocks(sector);

    if (panelTitle) {
        const typeLabel = type === '行业板块资金流向' ? '🏛️' : '💡';
        const panelSectorColor = type === '行业板块资金流向' ? '#2563eb' : '#7c3aed';
        panelTitle.innerHTML = `${typeLabel} <span style="color:${panelSectorColor};">${escapeHtml(sectorName)}</span>`;
    }

    // 加星逻辑：复用今日推荐的完整筛选逻辑（passesLeaderConditions），自动同步条件开关
    const stockDaysMap = calcStockConsecutiveDays();
    const starSet = calcLeaderStarSet(stocks, stockDaysMap);

    renderStockTable(panelList, stocks, commonStockNames, starSet, stockDaysMap);
}

/** 切换趋势弹窗的图表和股票面板到指定板块 */
function switchTrendView(sectorName, type, commonStockNames) {
    // 切换板块时回到板块详情页签
    switchTrendChartTab('chart');
    // 股票面板切回涉及股票页签，展示新板块的股票
    switchStockPanelTab('stocks');

    // 更新图表（复用现有 Chart 实例，减少闪烁和资源分配）
    const trendSeries = getTrendSeries(sectorName, type);
    const netTrend = trendSeries.net;
    const turnoverTrend = trendSeries.turnover;

    const netCtx = document.getElementById('trendNetChart').getContext('2d');
    trendNetChart = updateTrendBarChart(trendNetChart, netCtx, netTrend, 'net');

    const turnoverCtx = document.getElementById('trendTurnoverChart').getContext('2d');
    trendTurnoverChart = updateTrendBarChart(trendTurnoverChart, turnoverCtx, turnoverTrend, 'turnover');

    // 更新股票面板
    showStocksInPanel(sectorName, type, commonStockNames);
}

function showSingleTrendModal(sectorName, type, label, matchedSectors, stocks, commonStockNames) {
    // 无数据时提前返回，避免后续 DOM 操作异常
    if (!getCurrentData()) {
        alert('暂无数据，请先加载数据文件');
        return;
    }

    // 打开新板块视图，重置选中高亮（面板内点击会在调用后按需重设）
    _selectedStockName = null;
    _selectedFocusKey = null;

    // 默认显示板块详情页签
    switchTrendChartTab('chart');
    // 股票面板默认显示涉及股票页签
    switchStockPanelTab('stocks');

    const typeIcon = type === '行业板块资金流向' ? '🏛️' : '💡';
    const sectorColor = type === '行业板块资金流向' ? '#2563eb' : '#7c3aed';
    const sectorDays = calcConsecutiveInflow(sectorName, type);
    const titleEl = document.getElementById('trendModalTitle');
    titleEl.innerHTML = `${typeIcon} <span style="color:${sectorColor};">${escapeHtml(sectorName)}</span> <span class="trend-modal-title-days">${sectorDays}天</span>`;
    titleEl.style.cursor = 'pointer';
    titleEl.title = '切换图表和股票到该板块';
    titleEl.dataset.sector = sectorName;
    titleEl.dataset.type = type;
    titleEl.dataset.common = JSON.stringify(commonStockNames ? [...commonStockNames] : []);

    // 渲染匹配的对面板块列表（可点击）
    const matchedContainer = document.getElementById('trendMatchedSectors');
    if (matchedContainer) {
        matchedContainer.innerHTML = '';
        if (matchedSectors && matchedSectors.length > 0) {
            matchedContainer.style.display = '';
            const otherType = type === '行业板块资金流向' ? '概念' : '行业';
            const otherDataType = type === '行业板块资金流向' ? '概念板块资金流向' : '行业板块资金流向';
            const otherColor = type === '行业板块资金流向' ? '#7c3aed' : '#2563eb';
            const titleSpan = document.createElement('span');
            titleSpan.style.cssText = 'font-weight:600;margin-right:6px;';
            titleSpan.textContent = '相关板块：';
            matchedContainer.appendChild(titleSpan);
            const sortedSectors = matchedSectors.sort((a, b) => b.days - a.days);
            const MAX_VISIBLE = 10;
            const isOverflow = sortedSectors.length > MAX_VISIBLE;

            // 辅助：创建单个相关板块标签
            function createMatchedTag(s) {
                const tag = document.createElement('span');
                tag.className = 'pair clickable';
                const sDaysColor = s.days >= HIGHLIGHT_MIN_DAYS ? '#dc2626' : otherColor;
                tag.innerHTML = `<span style="color:${otherColor};">${escapeHtml(s.name)}</span> <span style="color:${sDaysColor};font-size:11px;">${s.days}天</span>`;
                tag.title = '点击查看涉及股票';
                const sCommonStocks = s.commonStocks || [];
                tag.dataset.sector = s.name;
                tag.dataset.type = s._dataType || otherDataType;
                tag.dataset.common = JSON.stringify(sCommonStocks);
                return tag;
            }

            // 前 MAX_VISIBLE 个放在「不换行」容器中
            const primaryWrap = document.createElement('span');
            primaryWrap.style.cssText = 'white-space:nowrap;display:inline;';
            sortedSectors.slice(0, MAX_VISIBLE).forEach(s => {
                primaryWrap.appendChild(createMatchedTag(s));
            });
            matchedContainer.appendChild(primaryWrap);

            // 多余部分单独容器（显示时可换行）
            let extraWrap = null;
            if (isOverflow) {
                extraWrap = document.createElement('span');
                extraWrap.className = 'matched-extra-wrap';
                extraWrap.style.display = 'none';
                sortedSectors.slice(MAX_VISIBLE).forEach(s => {
                    extraWrap.appendChild(createMatchedTag(s));
                });
                matchedContainer.appendChild(extraWrap);
            }

            // 溢出时添加展开/收起按钮
            if (isOverflow) {
                const toggleBtn = document.createElement('span');
                toggleBtn.className = 'pair';
                toggleBtn.style.cssText = 'cursor:pointer;color:#667eea;font-weight:600;font-size:12px;padding:0 6px;border-radius:4px;';
                toggleBtn.textContent = `展开更多 ${sortedSectors.length - MAX_VISIBLE} 个▼`;
                toggleBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (!extraWrap) return;
                    const isHidden = extraWrap.style.display === 'none';
                    extraWrap.style.display = isHidden ? '' : 'none';
                    this.textContent = isHidden
                        ? '收起▲'
                        : `展开更多 ${sortedSectors.length - MAX_VISIBLE} 个▼`;
                });
                matchedContainer.appendChild(toggleBtn);
            }
        } else {
            matchedContainer.style.display = 'none';
        }
    }

    // 默认显示当前板块的股票（共同股票优先）
    if (stocks && stocks.length > 0) {
        const panelTitle = document.getElementById('stockPanelTitle');
        if (panelTitle) {
            panelTitle.innerHTML = `${typeIcon} <span style="color:${sectorColor};">${escapeHtml(sectorName)}</span>`;
        }
        const panelList = document.getElementById('stockPanelList');
        if (panelList) {
            // 加星逻辑：复用今日推荐的完整筛选逻辑（passesLeaderConditions），自动同步条件开关
            const stockDaysMap = calcStockConsecutiveDays();
            const starSet = calcLeaderStarSet(stocks, stockDaysMap);
            renderStockTable(panelList, stocks, commonStockNames, starSet, stockDaysMap);
        }
    } else {
        showStocksInPanel(sectorName, type);
    }

    // 绘制趋势图（主力净额 + 成交额）
    const trendSeries = getTrendSeries(sectorName, type);
    const netTrend = trendSeries.net;
    const turnoverTrend = trendSeries.turnover;
    const netCtx = document.getElementById('trendNetChart').getContext('2d');
    trendNetChart = updateTrendBarChart(trendNetChart, netCtx, netTrend, 'net');
    const turnoverCtx = document.getElementById('trendTurnoverChart').getContext('2d');
    trendTurnoverChart = updateTrendBarChart(trendTurnoverChart, turnoverCtx, turnoverTrend, 'turnover');

    document.getElementById('trendModalOverlay').classList.add('active');
}

function closeTrendModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('trendModalOverlay').classList.remove('active');
    _stockChartGeneration++;
    disposeTradingViewWidget();

    if (trendNetChart) {
        trendNetChart.destroy();
        trendNetChart = null;
    }
    if (trendTurnoverChart) {
        trendTurnoverChart.destroy();
        trendTurnoverChart = null;
    }
}

// ==================== 今日龙头弹窗 ====================

function showStockLeader(stockName, sectors) {
    // 优先选在关注板块中的板块，再按天数排序
    const focusSectors = getFocusSectors(getActiveData());
    const inFocus = sectors.filter(s => focusSectors.has(s.type + '|' + s.name));
    const candidates = inFocus.length > 0 ? inFocus : sectors;
    const best = [...candidates].sort((a, b) => b.days - a.days)[0];
    if (!best) return;

    const type = best.type === '行业' ? '行业板块资金流向' : '概念板块资金流向';
    if (!getCurrentData()) return;

    const activeData = getActiveData();

    const sectorList = activeData[type] || [];
    const sector = sectorList.find(s => s.板块 === best.name);
    if (!sector) return;

    const stocks = getSectorStocks(sector);

    // 将股票所属的所有其他板块作为匹配板块展示
    const matchedSectors = sectors
        .filter(s => s.name !== best.name)
        .map(s => ({
            name: s.name,
            days: s.days,
            commonStocks: [stockName],
            _dataType: s.type === '行业' ? '行业板块资金流向' : '概念板块资金流向'
        }));

    showSingleTrendModal(
        best.name, type,
        `🐉 ${stockName} → ${best.name}(${best.type})`,
        matchedSectors, stocks,
        new Set([stockName])
    );

    // 从今日推荐进入，直接加载个股详情
    const stockKey = resolveStockKey(stockName);
    const stockCode = _stockFieldIndex[stockKey] && Object.values(_stockFieldIndex[stockKey])[0]?.code;
    if (stockCode) {
        loadTrendStock(stockName, stockCode);
    }
}

/** 切换弹窗内图表区域页签（chart=板块详情, stock=个股详情） */
function switchTrendChartTab(tab) {
    document.querySelectorAll('.trend-tab-btn:not(.source-btn)').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.trend-chart-content').forEach(c => c.classList.remove('active'));

    if (tab === 'stock') {
        document.getElementById('trendStockTabBtn').classList.add('active');
        document.getElementById('trendStockContent').classList.add('active');
    } else {
        document.getElementById('trendChartTabBtn').classList.add('active');
        document.getElementById('trendChartContent').classList.add('active');
    }
}

// 记住当前加载的股票，供切换数据源时重新加载
let _currentStockName = '';
let _currentStockCode = '';
let _tradingViewWidget = null;
let _stockChartGeneration = 0;
let _tradingViewScriptPromise = null;

/** 按需加载 TradingView 脚本，避免第三方 CDN 阻塞主页面首屏渲染。 */
function ensureTradingViewLoaded() {
    if (window.TradingView?.widget) return Promise.resolve(window.TradingView);
    if (_tradingViewScriptPromise) return _tradingViewScriptPromise;

    _tradingViewScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://s3.tradingview.com/tv.js';
        script.async = true;
        script.onload = () => window.TradingView?.widget
            ? resolve(window.TradingView)
            : reject(new Error('TradingView 脚本已加载，但组件不可用'));
        script.onerror = () => reject(new Error('TradingView 脚本加载失败，请检查网络后重试'));
        document.head.appendChild(script);
    }).catch(error => {
        _tradingViewScriptPromise = null;
        throw error;
    });
    return _tradingViewScriptPromise;
}

function disposeTradingViewWidget() {
    if (_tradingViewWidget && typeof _tradingViewWidget.remove === 'function') {
        try { _tradingViewWidget.remove(); } catch (error) { console.warn('清理 TradingView 组件失败:', error); }
    }
    _tradingViewWidget = null;
}

/** 获取当前选中的数据源 */
function getStockChartSource() {
    const active = document.querySelector('.source-btn.active');
    return active ? active.dataset.source : STOCK_CHART_SOURCE;
}

/** 在弹窗个股详情页签中加载股票（支持三种数据源切换） */
function loadTrendStock(stockName, stockCode) {
    const quote = resolveStockQuote(stockCode);
    if (!quote) {
        alert('股票「' + stockName + '」缺少有效的六位 A 股代码');
        return;
    }
    const { code, market } = quote;
    const generation = ++_stockChartGeneration;
    disposeTradingViewWidget();
    _currentStockName = stockName;
    _currentStockCode = code;

    const source = getStockChartSource();
    const container = document.getElementById('trendStockIframe');
    container.innerHTML = '';

    if (source === 'sina_chart') {
        // 新浪图表：根据周期按钮选择显示对应图片
        const symbol = market.toLowerCase() + code;
        const activePeriodBtn = document.querySelector('#sinaPeriodTabs .period-btn.active');
        const period = activePeriodBtn ? activePeriodBtn.dataset.period : 'daily';
        const periods = period === 'all'
            ? [{key: 'min', label: '分时'}, {key: 'daily', label: '日K'}, {key: 'weekly', label: '周K'}, {key: 'monthly', label: '月K'}]
            : [{key: period, label: ''}];
        const isAll = period === 'all';
        const itemStyle = isAll
            ? 'flex:1 1 48%;min-width:280px;text-align:center;'
            : 'width:100%;text-align:center;';
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;height:100%;overflow:auto;padding:4px;';
        periods.forEach(function(p) {
            const item = document.createElement('div');
            item.style.cssText = itemStyle;
            if (isAll) {
                const label = document.createElement('div');
                label.style.cssText = 'font-size:12px;color:#888;margin-bottom:2px;';
                label.textContent = p.label;
                item.appendChild(label);
            }
            const image = document.createElement('img');
            image.src = 'https://image.sinajs.cn/newchart/' + encodeURIComponent(p.key) + '/n/' + encodeURIComponent(symbol) + '.gif';
            image.alt = stockName + (p.label ? ' ' + p.label : '') + '行情图';
            image.style.cssText = 'width:100%;border-radius:4px;';
            item.appendChild(image);
            wrapper.appendChild(item);
        });
        container.appendChild(wrapper);
    } else {
        // TradingView 嵌入（tv.js 组件版，支持 overrides/studies_overrides 改配色为 A 股红涨绿跌）
        const symbol = StockUtils.getTradingViewSymbol(code);
        if (!symbol) {
            const message = document.createElement('div');
            message.style.cssText = 'display:flex;height:100%;align-items:center;justify-content:center;color:#666;text-align:center;padding:24px;box-sizing:border-box;';
            message.textContent = '该股票暂未配置 TradingView 行情，请切换至新浪图表查看。';
            container.appendChild(message);
            switchTrendChartTab('stock');
            return;
        }
        const loading = document.createElement('div');
        loading.style.cssText = 'display:flex;height:100%;align-items:center;justify-content:center;color:#666;text-align:center;padding:24px;box-sizing:border-box;';
        loading.textContent = '正在加载 TradingView 行情组件...';
        container.appendChild(loading);

        ensureTradingViewLoaded().then(TradingView => {
            if (generation !== _stockChartGeneration || !container.isConnected) return;
            container.innerHTML = '';
            const up = '#e53935';   // 涨=红
            const down = '#43a047'; // 跌=绿
            // 用内部子容器承载 widget，避免销毁固定 id 的外层容器（切换股票时可反复重建）
            const inner = document.createElement('div');
            inner.id = 'tvChartInner';
            inner.style.cssText = 'width:100%;height:100%;';
            container.appendChild(inner);
            _tradingViewWidget = new TradingView.widget({
                container_id: 'tvChartInner',
                symbol: symbol,
                interval: 'D',
                timezone: 'Asia/Shanghai',
                theme: 'light',
                style: '1',
                locale: 'zh_CN',
                toolbar_bg: '#f1f3f6',
                enable_publishing: false,
                hide_side_toolbar: false,
                allow_symbol_change: true,
                autosize: true,
                overrides: {
                    'mainSeriesProperties.candleStyle.upColor': up,
                    'mainSeriesProperties.candleStyle.downColor': down,
                    'mainSeriesProperties.candleStyle.borderUpColor': up,
                    'mainSeriesProperties.candleStyle.borderDownColor': down,
                    'mainSeriesProperties.candleStyle.wickUpColor': up,
                    'mainSeriesProperties.candleStyle.wickDownColor': down
                },
                studies_overrides: {
                    'volume.volume.color.0': up,   // 涨=红
                    'volume.volume.color.1': down  // 跌=绿
                }
            });
        }).catch(error => {
            if (generation !== _stockChartGeneration || !container.isConnected) return;
            container.innerHTML = '';
            const message = document.createElement('div');
            message.style.cssText = 'display:flex;height:100%;align-items:center;justify-content:center;color:#666;text-align:center;padding:24px;box-sizing:border-box;';
            message.textContent = error.message + '，请切换至新浪图表查看。';
            container.appendChild(message);
        });
    }
    switchTrendChartTab('stock');
}
