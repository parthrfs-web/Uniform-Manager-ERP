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

        // Auto Column Width Calculation
        const colWidths = headers.map((header, colIndex) => {
            let maxLen = header.toString().length;
            data.forEach(row => {
                const cellVal = row[colIndex] ? row[colIndex].toString() : "";
                if (cellVal.length > maxLen) maxLen = cellVal.length;
            });
            return { wch: Math.min(maxLen + 2, 50) }; // Cap width at 50 chars
        });
        ws['!cols'] = colWidths;

        // Freeze the first row (Header)
        ws['!views'] = [{ state: 'frozen', ySplit: 1 }];

        XLSX.utils.book_append_sheet(wb, ws, sheetName || "Export");
        XLSX.writeFile(wb, filePath);

        return { canceled: false, filePath };
    } catch (error) {
        throw new Error("Failed to generate Excel file: " + error.message);
    }
}

module.exports = { exportToExcel };