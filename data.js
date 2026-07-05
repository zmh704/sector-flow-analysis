// ===== 数据存储、日期排序、加载与日期按钮 =====

function extractDateLabel(filename) {
    const m1 = filename.match(/(\d{1,2}月\d{1,2}日)/);
    if (m1) return m1[1];

    const m2 = filename.match(/(\d{4}[-年]\d{1,2}[-月]\d{1,2}日?)/);
    if (m2) return m2[1];

    return filename.replace(/_.*$/, '');
}

/**
 * 将日期标签转为可排序的数字。
 * 文件名仅含「月日」无年份，故用「生成时间」所在年份推断；
 * 若文件月份比处理月份早半年以上，视为上一年数据（处理年末、次年初场景）。
 * 例：处理时间 2026/1/5 + 文件「12月20日」→ 20251220。
 */
function toDateNum(label, genTime) {
    const m = label.match(/(\d{1,2})月(\d{1,2})日/);
    if (!m) return 0;
    const fileMonth = Number(m[1]);
    let year = new Date().getFullYear();
    if (genTime) {
        const gt = new Date(genTime);
        if (!isNaN(gt.getTime())) {
            year = gt.getFullYear();
            const procMonth = gt.getMonth() + 1;
            if (fileMonth - procMonth >= 6) year = year - 1;
        }
    }
    return year * 10000 + fileMonth * 100 + Number(m[2]);
}

/** 按日期标签排序 dateFileList，返回排序后的新数组（带缓存） */
function sortDateFileList() {
    if (_sortedDateFileList) return _sortedDateFileList;
    _sortedDateFileList = [...dateFileList].sort((a, b) => {
        const entryA = allDataByDate[a];
        const entryB = allDataByDate[b];
        const labelA = entryA?.dateLabel || a;
        const labelB = entryB?.dateLabel || b;
        return toDateNum(labelA, entryA?.data?.生成时间) - toDateNum(labelB, entryB?.data?.生成时间);
    });
    return _sortedDateFileList;
}

/**
 * 存储单个日期的数据，并预解析股票、构建字段索引。
 * @param {string} filename
 * @param {Object} data
 * @param {{skipInvalidate?: boolean}} [opts] - 批量加载时传 skipInvalidate:true，
 *        由调用方在全部加载完成后统一调用一次 invalidateDateCaches()
 */
function storeDataForDate(filename, data, opts) {
    const key = filename;
    allDataByDate[key] = {
        filename: filename,
        dateLabel: extractDateLabel(filename),
        data: data
    };

    if (!dateFileList.includes(key)) {
        dateFileList.push(key);
        _sortedDateFileList = null;
    }

    // 预解析涉及股票并缓存
    const industryList = data.行业板块资金流向 || [];
    const conceptList = data.概念板块资金流向 || [];
    for (const item of [...industryList, ...conceptList]) {
        if (item.涉及股票) {
            item._parsedStocks = parseStocks(item.涉及股票);
        }
    }

    // 构建股票字段索引（供 isStockVolumeDecreased 等 O(1) 查询）
    _stockFieldIndex = _stockFieldIndex || {};

    // 清除该日期在索引中的旧条目，确保增量加载时数据一致
    for (const stockName of Object.keys(_stockFieldIndex)) {
        if (key in _stockFieldIndex[stockName]) {
            delete _stockFieldIndex[stockName][key];
        }
        if (Object.keys(_stockFieldIndex[stockName]).length === 0) {
            delete _stockFieldIndex[stockName];
        }
    }

    for (const item of [...industryList, ...conceptList]) {
        const stocks = item._parsedStocks || parseStocks(item.涉及股票);
        for (const stock of stocks) {
            if (!_stockFieldIndex[stock.name]) _stockFieldIndex[stock.name] = {};
            // 同一股票同一天可能在行业/概念重复出现，仅首次记录
            if (!_stockFieldIndex[stock.name][key]) {
                const vol = parseFloat(stock.volume);
                const netNum = parseFloat(stock.net);
                _stockFieldIndex[stock.name][key] = {
                    volume: isNaN(vol) ? null : vol,
                    net: isNaN(netNum) ? null : netNum,
                    amount: stock.amount,
                    change: stock.change,
                    code: stock.code
                };
            }
        }
    }
    // 新数据加入后，日期依赖的缓存失效（批量加载时跳过，由调用方统一失效一次）
    if (!opts || !opts.skipInvalidate) {
        invalidateDateCaches();
    }
}

function getCurrentData() {
    return currentDateFile ? allDataByDate[currentDateFile] : null;
}

/** 切换当前选中日期，并失效依赖于该日期的缓存 */
function setCurrentDateFile(filename) {
    if (currentDateFile === filename) return;
    currentDateFile = filename;
    invalidateDateCaches();
}

function getActiveData() {
    return getCurrentData()?.data || {
        行业板块资金流向: [],
        概念板块资金流向: [],
        分析总结: null
    };
}

function updateActiveDataMeta() {
    const current = getCurrentData();
    const data = current?.data || {};
    const label = current ? `${current.dateLabel}｜${current.filename}` : '未选择数据';

    if (data.生成时间) {
        document.getElementById('generateTime').textContent = data.生成时间;
        document.getElementById('dataDate').textContent = `当前显示：${label}｜数据生成时间：${data.生成时间}`;
    } else {
        document.getElementById('generateTime').textContent = '-';
        document.getElementById('dataDate').textContent = `当前显示：${label}`;
    }
}

function renderDateButtons() {
    const container = document.getElementById('dateButtons');
    container.innerHTML = '';

    if (dateFileList.length === 0) {
        container.innerHTML = renderEmptyState('📅', '暂无数据', '请点击「加载数据」');
        return;
    }

    const sorted = sortDateFileList();

    sorted.forEach(filename => {
        container.appendChild(createDateButton(filename));
    });

    if (!currentDateFile && dateFileList.length > 0) {
        setCurrentDateFile(sorted[sorted.length - 1]);
        const btns = container.querySelectorAll('.date-btn');
        if (btns.length > 0) {
            btns[btns.length - 1].classList.add('active');
        }
    }
}

/** 创建日期切换按钮（事件由 app.js 中的事件委托处理） */
function createDateButton(filename) {
    const item = allDataByDate[filename];
    const btn = document.createElement('button');
    btn.className = 'date-btn';
    btn.textContent = item?.dateLabel || filename;
    btn.dataset.datefile = filename;
    if (filename === currentDateFile) {
        btn.classList.add('active');
    }
    return btn;
}

function resetLoadedData() {
    allDataByDate = {};
    dateFileList = [];
    currentDateFile = null;
    invalidateAllCaches();
}

async function loadAllJsonFiles() {
    showLoadingStatus('正在扫描并加载数据文件...');

    resetLoadedData();

    let fileList = [];
    try {
        const response = await fetch('/api/list?' + Date.now());
        if (response.ok) {
            fileList = await response.json();
        } else {
            throw new Error('服务器 API 不可用，状态码: ' + response.status);
        }
    } catch (_error) {
        // 本地服务器不可用时，回退到 list.json（GitHub Pages 模式）
        showWarningStatus('本地服务器不可用，尝试通过静态列表加载...');
        try {
            const fallbackResp = await fetch('list.json?t=' + Date.now());
            if (fallbackResp.ok) {
                fileList = await fallbackResp.json();
            } else {
                throw new Error('list.json 加载失败');
            }
        } catch (_fallbackError) {
            showWarningStatus('数据加载失败：本地服务器和静态列表均不可用。请确保已启动服务器（双击 start.cmd）或部署到 GitHub Pages');
            return;
        }
    }

    if (fileList.length === 0) {
        showWarningStatus('data/ 目录下没有找到板块资金流向 JSON 文件');
        return;
    }

    let loadedCount = 0;
    const totalFiles = fileList.length;
    const nowTs = Date.now();
    const BATCH_SIZE = 6; // 分批并发，避免一次性发出过多请求

    showLoadingProgress(`正在加载 0/${totalFiles}...`, 0, totalFiles);

    for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
        const batch = fileList.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(async filename => {
            try {
                const response = await fetch(filename + '?t=' + nowTs);
                if (!response.ok) return null;
                const data = await response.json();
                return { filename, data };
            } catch (error) {
                console.error(`加载文件 ${filename} 失败:`, error);
                return null;
            }
        }));

        // Promise.all 保证 batch 内顺序，按序存储（渲染顺序由 sortDateFileList 决定）
        for (const result of results) {
            if (result) {
                storeDataForDate(result.filename, result.data, { skipInvalidate: true });
                loadedCount++;
            }
        }
        const done = Math.min(i + BATCH_SIZE, totalFiles);
        showLoadingProgress(`正在加载 ${done}/${totalFiles}...`, done, totalFiles);
    }

    // 批量加载完成后统一失效一次日期依赖缓存
    invalidateDateCaches();

    renderDateButtons();

    try {
        updateCharts();
        showSuccessStatus(`已加载 ${loadedCount} 个文件`);
    } catch (error) {
        console.error('❌ 渲染图表失败:', error);
        showWarningStatus('数据加载成功，但渲染失败: ' + error.message);
    }
}
