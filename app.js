// ===== 入口：Excel 上传与初始化 =====

window.onload = function() {
    loadAllJsonFiles();
};

// ==================== 解析数据 ====================

function parseExcelFile() {
    document.getElementById('excelFileInput').click();
}

async function handleExcelFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const statusDiv = document.getElementById('loadStatus');
    statusDiv.textContent = '⏳ 正在上传并解析Excel文件...';

    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/parse', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || '服务器解析失败');
        }

        const result = await response.json();
        statusDiv.textContent = `✅ 解析完成：${result.industries} 个行业，${result.concepts} 个概念`;

        // 刷新数据
        await loadAllJsonFiles();

    } catch (err) {
        console.error('解析失败:', err);
        statusDiv.textContent = '❌ 解析失败: ' + err.message;
    } finally {
        event.target.value = '';
    }
}
