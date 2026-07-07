// ===== 弹窗：查看全部 / 趋势对比 / 今日龙头，及股票表格 =====

// 查看全部弹窗状态
let modalSortState = { key: 'net', asc: false };
let modalDataType = '';
let modalDataCache = [];

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
            const stocks = item._parsedStocks || parseStocks(item.涉及股票);
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
            <td style="font-size:12px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.涉及股票 || '-')}</td>
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
            _parsedStocks: item._parsedStocks || parseStocks(item.涉及股票)
        };
    });

    // 第二步：预计算配对信息（行业↔概念 共同股票）
    modalDataCache.forEach(item => {
        const itemStocks = new Set(item._parsedStocks.map(s => s.name));
        const matched = [];
        otherList.forEach(otherItem => {
            const otherStocks = new Set((otherItem._parsedStocks || parseStocks(otherItem.涉及股票)).map(s => s.name));
            const common = [...itemStocks].filter(s => otherStocks.has(s));
            if (common.length > 0) {
                matched.push({
                    name: otherItem.板块,
                    days: calcConsecutiveInflow(otherItem.板块, otherType),
                    commonStocks: common,
                    _dataType: otherType // 用于标记数据类型
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

function getTrendData(sectorName, type, field) {
    const sorted = sortDateFileList();

    let available = sorted;
    if (currentDateFile) {
        const idx = sorted.indexOf(currentDateFile);
        if (idx >= 0) {
            available = sorted.slice(0, idx + 1);
        }
    }

    const recent = available.slice(-TREND_CHART_DAYS);

    const dates = [];
    const values = [];

    for (const filename of recent) {
        const entry = allDataByDate[filename];
        dates.push(entry?.dateLabel || filename);

        const dayData = entry?.data;
        if (!dayData) {
            values.push(null);
            continue;
        }

        const sectorList = dayData[type] || [];
        const sectorMap = new Map();
        for (const s of sectorList) {
            sectorMap.set(s.板块, s);
        }
        const sector = sectorMap.get(sectorName);
        if (sector) {
            if (field === 'net') {
                values.push(Number(sector.主力净额) / 100000000);
            } else {
                values.push(Number(sector.成交额) / 100000000);
            }
        } else {
            values.push(null);
        }
    }

    return { dates, values };
}

function createBarChart(ctx, trendData, existingChart, field) {
    if (existingChart) {
        existingChart.destroy();
    }

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
    const valueSuffix = field === 'net' ? '' : '';

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
                            return `${tooltipLabel}: ${sign}${val.toFixed(2)} 亿`;
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

    return chart;
}

/** 渲染股票表格（精简：股票名称、主力净额、连续流入天数、操作） */
function renderStockTable(panelList, stocks, bgSet, starSet, stockDaysMap) {
    panelList.innerHTML = '';
    if (!stocks || stocks.length === 0) {
        panelList.innerHTML = renderEmptyState('📊', '无涉及股票数据');
        return;
    }

    const bs = bgSet || new Set();
    const ss = starSet || bs;
    const sdm = stockDaysMap || new Map();

    // 排序：加星股票始终在最上面，其次共同股票，其余在后，各自按主力净额降序
    const starred = stocks.filter(s => ss.has(s.name))
        .sort((a, b) => (parseFloat(b.net) || -999) - (parseFloat(a.net) || -999));
    const commonOnly = stocks.filter(s => !ss.has(s.name) && bs.has(s.name))
        .sort((a, b) => (parseFloat(b.net) || -999) - (parseFloat(a.net) || -999));
    const otherStocks = stocks.filter(s => !ss.has(s.name) && !bs.has(s.name))
        .sort((a, b) => (parseFloat(b.net) || -999) - (parseFloat(a.net) || -999));
    const sortedStocks = [...starred, ...commonOnly, ...otherStocks];

    const table = document.createElement('table');
    table.className = 'stock-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>股票名称</th><th>主力净额</th><th>天数</th><th class="th-action">操作</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    sortedStocks.forEach((stock, i) => {
        const tr = document.createElement('tr');
        const isBg = bs.has(stock.name);
        const isStarred = ss.has(stock.name);
        if (isBg) tr.classList.add('stock-common');
        const changeNum = parseFloat(stock.net);
        const changeCls = changeNum >= 0 ? 'stock-change-positive' : 'stock-change-negative';
        // 涨跌幅拼在股票名称后
        const chgNum = parseFloat(stock.change);
        let changeBadge = '';
        if (stock.change && !isNaN(chgNum)) {
            const chgColor = chgNum >= 0 ? '#e53935' : '#43a047';
            changeBadge = ` <span style="color:${chgColor};font-size:11px;">${chgNum >= 0 ? '▲' : '▼'} ${escapeHtml(stock.change)}</span>`;
        }
        const stockDays = sdm.get(stock.name) || 0;
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
        tr.dataset.stockCode = stock.code;
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    panelList.appendChild(table);
}

/** 切换股票面板页签（stocks=涉及股票, leaders=今日推荐） */
function switchStockPanelTab(tab) {
    const isLeaders = tab === 'leaders';
    document.getElementById('stockPanelStocksTabBtn').classList.toggle('active', !isLeaders);
    document.getElementById('stockPanelLeaderTabBtn').classList.toggle('active', isLeaders);
    document.getElementById('stockPanelStocksContent').classList.toggle('active', !isLeaders);
    document.getElementById('stockPanelLeaderContent').classList.toggle('active', isLeaders);
    if (isLeaders) renderLeaderPanel();
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

    const stocks = sector._parsedStocks || parseStocks(sector.涉及股票);

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

    // 更新图表
    if (trendNetChart) { trendNetChart.destroy(); trendNetChart = null; }
    if (trendTurnoverChart) { trendTurnoverChart.destroy(); trendTurnoverChart = null; }

    const netTrend = getTrendData(sectorName, type, 'net');
    const turnoverTrend = getTrendData(sectorName, type, 'turnover');

    const netCtx = document.getElementById('trendNetChart').getContext('2d');
    trendNetChart = createBarChart(netCtx, netTrend, trendNetChart, 'net');

    const turnoverCtx = document.getElementById('trendTurnoverChart').getContext('2d');
    trendTurnoverChart = createBarChart(turnoverCtx, turnoverTrend, trendTurnoverChart, 'turnover');

    // 更新股票面板
    showStocksInPanel(sectorName, type, commonStockNames);
}

function showSingleTrendModal(sectorName, type, label, matchedSectors, stocks, commonStockNames) {
    // 无数据时提前返回，避免后续 DOM 操作异常
    if (!getCurrentData()) {
        alert('暂无数据，请先加载数据文件');
        return;
    }

    // 默认显示板块详情页签
    switchTrendChartTab('chart');
    // 股票面板默认显示涉及股票页签
    switchStockPanelTab('stocks');

    if (trendNetChart) { trendNetChart.destroy(); trendNetChart = null; }
    if (trendTurnoverChart) { trendTurnoverChart.destroy(); trendTurnoverChart = null; }

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
    const netTrend = getTrendData(sectorName, type, 'net');
    const turnoverTrend = getTrendData(sectorName, type, 'turnover');
    const netCtx = document.getElementById('trendNetChart').getContext('2d');
    trendNetChart = createBarChart(netCtx, netTrend, trendNetChart, 'net');
    const turnoverCtx = document.getElementById('trendTurnoverChart').getContext('2d');
    trendTurnoverChart = createBarChart(turnoverCtx, turnoverTrend, trendTurnoverChart, 'turnover');

    document.getElementById('trendModalOverlay').classList.add('active');
}

function closeTrendModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('trendModalOverlay').classList.remove('active');

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
    const inFocus = sectors.filter(s => focusSectors.has(s.name));
    const candidates = inFocus.length > 0 ? inFocus : sectors;
    const best = [...candidates].sort((a, b) => b.days - a.days)[0];
    if (!best) return;

    const type = best.type === '行业' ? '行业板块资金流向' : '概念板块资金流向';
    if (!getCurrentData()) return;

    const activeData = getActiveData();

    const sectorList = activeData[type] || [];
    const sector = sectorList.find(s => s.板块 === best.name);
    if (!sector) return;

    const stocks = sector._parsedStocks || parseStocks(sector.涉及股票);

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
    const stockCode = _stockFieldIndex[stockName] && Object.values(_stockFieldIndex[stockName])[0]?.code;
    if (stockCode) {
        loadTrendStock(stockName, stockCode);
    }
}

/** 切换弹窗内图表区域页签（chart=板块详情, stock=个股详情） */
function switchTrendChartTab(tab) {
    document.querySelectorAll('.trend-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.trend-chart-content').forEach(c => c.classList.remove('active'));

    if (tab === 'stock') {
        document.getElementById('trendStockTabBtn').classList.add('active');
        document.getElementById('trendStockContent').classList.add('active');
    } else {
        document.getElementById('trendChartTabBtn').classList.add('active');
        document.getElementById('trendChartContent').classList.add('active');
    }
}

/** 在弹窗个股详情页签中加载股票（TradingView Widget，不会封 IP） */
function loadTrendStock(stockName, stockCode) {
    if (!stockCode) {
        alert('未找到股票「' + stockName + '」的代码');
        return;
    }
    const exchange = stockCode.startsWith('6') ? 'SSE' : 'SZSE';
    const symbol = exchange + ':' + stockCode;

    // 清空容器后创建 TradingView Widget（容器 id 固定，可反复调用）
    const container = document.getElementById('trendStockIframe');
    container.innerHTML = '';
    new TradingView.widget({
        container_id: 'trendStockIframe',
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
        autosize: true
    });
    switchTrendChartTab('stock');
}
