const { dialog } = require('electron');
const XLSX = require('xlsx');

async function exportToExcel(window, config) {
    const { filename, sheetName, headers, data } = config;

    const { canceled, filePath } = await dialog.showSaveDialog(window, {
        title: 'Export to Excel',
        defaultPath: filename,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
    });

    if (canceled || !filePath) return { canceled: true };

    try {
        const wb = XLSX.utils.book_new();
        const wsData = [headers, ...data];
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        const colWidths = headers.map((header, colIndex) => {
            let maxLen = header.toString().length;
            data.forEach(row => {
                const cellVal = row[colIndex] ? row[colIndex].toString() : "";
                if (cellVal.length > maxLen) maxLen = cellVal.length;
            });
            return { wch: Math.min(maxLen + 2, 50) };
        });
        ws['!cols'] = colWidths;
        ws['!views'] = [{ state: 'frozen', ySplit: 1 }];

        XLSX.utils.book_append_sheet(wb, ws, sheetName || "Export");
        XLSX.writeFile(wb, filePath);

        return { canceled: false, filePath };
    } catch (error) {
        throw new Error("Failed to generate Excel file: " + error.message);
    }
}

// NEW: Advanced export handling for Analytics Reports
async function exportAnalyticsExcel(window, config) {
    const { filename, sheetName, reportTitle, filtersUsed, generatedDate, summary, headers, data } = config;

    const { canceled, filePath } = await dialog.showSaveDialog(window, {
        title: 'Export Analytics to Excel',
        defaultPath: filename,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
    });

    if (canceled || !filePath) return { canceled: true };

    try {
        const wsData = [];
        
        wsData.push([reportTitle]);
        wsData.push(["Generated At:", generatedDate]);
        wsData.push([]);
        
        wsData.push(["--- FILTERS USED ---"]);
        for (const [k, v] of Object.entries(filtersUsed)) {
            wsData.push([k, v]);
        }
        wsData.push([]);
        
        wsData.push(["--- SUMMARY ---"]);
        for (const [k, v] of Object.entries(summary)) {
            wsData.push([k, v]);
        }
        wsData.push([]);
        
        const headerRowIndex = wsData.length;
        wsData.push(headers);
        wsData.push(...data);

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        const colWidths = headers.map((header, colIndex) => {
            let maxLen = header.toString().length;
            data.forEach(row => {
                const cellVal = row[colIndex] ? row[colIndex].toString() : "";
                if (cellVal.length > maxLen) maxLen = cellVal.length;
            });
            return { wch: Math.min(Math.max(maxLen + 2, 12), 50) };
        });
        ws['!cols'] = colWidths;
        
        // Freeze pan specifically at the table header row
        ws['!views'] = [{ state: 'frozen', ySplit: headerRowIndex + 1 }];

        XLSX.utils.book_append_sheet(wb, ws, sheetName || "Analytics");
        XLSX.writeFile(wb, filePath);

        return { canceled: false, filePath };
    } catch (error) {
        throw new Error("Failed to generate Analytics Excel file: " + error.message);
    }
}

module.exports = { exportToExcel, exportAnalyticsExcel };