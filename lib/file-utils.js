'use strict';

const fs = require('fs');
const path = require('path');

function writeJsonAtomic(targetPath, value) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const temporaryPath = path.join(
        path.dirname(targetPath),
        `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
    );
    try {
        fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
        fs.renameSync(temporaryPath, targetPath);
    } catch (error) {
        try { fs.unlinkSync(temporaryPath); } catch (unlinkError) {
            if (unlinkError.code !== 'ENOENT') console.error('[临时文件清理错误]', unlinkError.message);
        }
        throw error;
    }
}

module.exports = { writeJsonAtomic };
