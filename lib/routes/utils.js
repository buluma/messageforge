const fs = require('fs');
const path = require('path');

function dirSizeBytes(dir) {
    try {
        if (!fs.existsSync(dir)) return 0;
        let total = 0;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) total += dirSizeBytes(full);
            else if (entry.isFile()) total += fs.statSync(full).size;
        }
        return total;
    } catch {
        return null;
    }
}

module.exports = {
    dirSizeBytes,
};
