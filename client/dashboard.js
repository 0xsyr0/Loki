const { ipcRenderer } = require('electron');
const path = require('path');
//const fs = require('fs'); // Use synchronous fs module for createWriteStream
const { log } = require('console');
const { getAppDataDir } = require('./common');
const directories       = getAppDataDir();
let tableinit = false;

function log(message) 
{
    const timestamp = new Date().toISOString();
    log(`[${timestamp}] ${message}`);
}

function timeDifference(oldTimestamp) {
    const now = Date.now();
    let diff = now - oldTimestamp;

    // Calculate the differences in various units
    const msInSecond = 1000;
    const msInMinute = msInSecond * 60;
    const msInHour = msInMinute * 60;
    const msInDay = msInHour * 24;

    const days = Math.floor(diff / msInDay);
    diff %= msInDay;
    const hours = Math.floor(diff / msInHour);
    diff %= msInHour;
    const minutes = Math.floor(diff / msInMinute);
    diff %= msInMinute;
    const seconds = Math.floor(diff / msInSecond);

    // Build the result string
    let result = '';
    if (days > 0) result += `${days}d, `;
    if (hours > 0) result += `${hours}h, `;
    if (minutes > 0) result += `${minutes}m, `;
    if (seconds > 0 || result === '') result += `${seconds}s`;

    return result.trim().replace(/,\s*$/, ''); // Remove trailing comma and space
}

window.addEventListener('DOMContentLoaded', () => {
    let sortState = { column: null, order: 'none' };

    document.querySelectorAll('th').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.getAttribute('data-column');
            if (sortState.column === column) {
                sortState.order = sortState.order === 'none' ? 'asc' : sortState.order === 'asc' ? 'desc' : 'none';
            } else {
                sortState.column = column;
                sortState.order = 'asc';
            }
            log(`${sortState['column']} column sort set to ${sortState['order']}`);
            updateTableSort();
        });
    });

    const table = document.getElementById('containerTable');
    if (!table) return;

    // **Fix: Remove existing event listener before adding**
    table.removeEventListener('contextmenu', handleContextMenu);
    table.addEventListener('contextmenu', handleContextMenu);
});

// **Ensure the event fires only once**
function handleContextMenu(event) {
    event.preventDefault();
    log("Right-click detected on table row");
	if(tableinit === true)
	{
		let row = event.target.closest("tr");
		log(`row : ${JSON.stringify(row)}`);
		if (!row || row.rowIndex === 0) return;

		let agentData = {
			agentid: row.cells[0]?.textContent || '',
			containerid: row.cells[1]?.textContent || '',
			hostname: row.cells[2]?.textContent || '',
			username: row.cells[3]?.textContent || '',
			fileName: row.cells[4]?.textContent || '',
			PID: row.cells[5]?.textContent || '',
			IP: row.cells[6]?.textContent || '',
			arch: row.cells[7]?.textContent || '',
			platform: row.cells[8]?.textContent || ''
		};
		log(`agentData : ${JSON.stringify(agentData)}`);

		ipcRenderer.send('show-row-context-menu', JSON.stringify(agentData));
	}
}


window.addEventListener('DOMContentLoaded', async () => {
    //const containerTable = document.getElementById('containerTable').getElementsByTagName('tbody')[0];
    let sortState = {
        column: null,
        order: 'none' // 'asc', 'desc', 'none'
    };
    document.querySelectorAll('th').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.getAttribute('data-column');
            if (sortState.column === column) {
                if (sortState.order === 'none') {
                    sortState.order = 'asc';
                } else if (sortState.order === 'asc') {
                    sortState.order = 'desc';
                } else {
                    sortState.order = 'none';
                }
            } else {
                sortState.column = column;
                sortState.order = 'asc';
            }
            log(`${sortState['column']} column sort set to ${sortState['order']}`);
            updateTableSort();
        });


    });
    const table = document.getElementById('containerTable');
    if (!table) return;

    // **Fix: Remove existing event listener before adding**
    table.removeEventListener('contextmenu', handleContextMenu);
    log("Adding event listener context menu");
	table.addEventListener('contextmenu', handleContextMenu);
	
    async function initTable() {
        try {
            //log("sent IPC for get-containers");
            let agentinit = null;
            while(agentinit == null)
            {
                agentinit = await ipcRenderer.invoke('preload-agents');
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            //console.log(`agentinit : ${agentinit}`);
            let agents = JSON.parse(agentinit);

            agents.forEach(agent => {
            let thisrow = updateOrAddRow(agent);
            thisrow.cells[0].textContent = agent.agentid;
            thisrow.cells[1].textContent = agent.containerid;
            thisrow.cells[2].textContent = '';
            thisrow.cells[3].textContent = '';
            thisrow.cells[4].textContent = '';
            thisrow.cells[5].textContent = '';
            thisrow.cells[6].textContent = '';
            thisrow.cells[7].textContent = '';
            thisrow.cells[8].textContent = '';
        });
        //log('Table updated with init agent data');
        } catch (error) {
            log(`Error in index.js initTable() updating table: ${error} ${error.stack}`);
        }
    }

    async function updateTable() {
        try {
            let agentcheckins;
            agentcheckins = await ipcRenderer.invoke('get-containers');
            //log(`updateTable() : agentcheckins : ${agentcheckins}`);

            const table = document.getElementById('containerTable'); // Ensure this matches your table ID
            //log(`table : ${table.innerText}`);
            //log(`agentcheckins : ${agentcheckins}`);

            if (agentcheckins == 0) {
                //log(`updateTable() : agentcheckins == 0; agentcheckins : ${agentcheckins}`);
                // Clear all rows from the table
                // while (table.rows.length > 1) { // Keeps the header row if it exists
                //     table.deleteRow(1);
                // }

                //log("Table cleared since there are no agents present.");
            } else {
                //log(`updateTable() : agentcheckins != 0; agentcheckins : ${agentcheckins}`);
                const agents = JSON.parse(agentcheckins);

                // Clear the existing rows before updating
                // while (table.rows.length > 1) {
                //     table.deleteRow(1);
                // }
                let agent_index = 0;
                agents.forEach(agent => {
                    //log(`agent ${agent_index}: ${JSON.stringify(agent)}`);
                    agent_index++;
                    if (agent != 0)
                    {
                        let thisrow = updateOrAddRow(agent);
                        let isnewrow = false;
        
                        if (thisrow.cells[2].textContent == '-' || !thisrow.cells[0].textContent) {
                            //log("this is a new row.");
                            isnewrow = true;
                        }
        
                        // Get the process base name from absolute path
                        const filePath = agent.Process.trim(); // Ensure the string is clean
                        //log(`Original Path: ${filePath}`);
                        let fileName;
                        // Detect which type of path is present and use the appropriate method
                        if (filePath.includes("\\") && !filePath.includes("/")) {
                            // Windows-style path (only backslashes)
                            fileName = path.win32.basename(filePath);
                        } else if (filePath.includes("/") && !filePath.includes("\\")) {
                            // macOS/Linux-style path (only forward slashes)
                            fileName = path.posix.basename(filePath);
                        } else {
                            // Mixed slashes case (or unknown)
                            fileName = filePath.split(/[/\\]/).pop(); // Manually extract filename
                        }
                        //log(`Extracted File Name: ${fileName}`);
                        let platformName = agent.platform; // Default to the original value

                        if (agent.platform === "darwin") {
                            platformName = "macOS";
                        } else if (agent.platform === "win32") {
                            platformName = "Windows";
                        } else if (agent.platform === "linux") {
                            platformName = "Linux";
                        } 
                        thisrow.cells[0].textContent = agent.agentid;
                        thisrow.cells[1].textContent = agent.container;
                        thisrow.cells[2].textContent = agent.hostname;
                        thisrow.cells[3].textContent = agent.username;
                        thisrow.cells[4].textContent = fileName;
                        thisrow.cells[5].textContent = agent.PID;
                        thisrow.cells[6].textContent = agent.IP;
                        thisrow.cells[7].textContent = agent.arch;
                        thisrow.cells[8].textContent = platformName; // Set formatted platform name
                        thisrow.cells[9].textContent = timeDifference(agent.checkin);
        
                        // if (isnewrow) {
                        // thisrow.addEventListener('click', () => {
                        //     ipcRenderer.send('open-container-window', JSON.stringify(agent));
                        // }, { once: true });
                        thisrow.replaceWith(thisrow.cloneNode(true)); // Remove previous listeners
                        //thisrow = document.querySelector("#yourRowId"); // Re-select the element
                        let table = document.getElementById('containerTable').getElementsByTagName('tbody')[0];
                        //log(`Attempting to find match in table for agent ${agent.agentid}`);
            
                        for (let row of table.rows) {
                            //log(`row.cells[0].textContent ${row.cells[0].textContent} =? ${agent.agentid}`);
                            if (row.cells[0].textContent == agent.agentid) {
                                thisrow = row;
                                break;
                            }
                        }

                        thisrow.addEventListener('click', () => {
                            console.log("Row clicked!"); // Debugging: Check if it logs multiple times
                            ipcRenderer.send('open-container-window', agent.agentid);
                        }, { once: true }); // Ensures it only triggers once per element

                            
                        // }
                    }
                });
                updateTableSort();
				tableinit = true;
            }
        }catch (error) {
            log(`Error in index.js updateTable() updating table: ${error} ${error.stack}`);
        }
    }

    function updateOrAddRow(agent) {
        try
        {
            let rowExists = false;
            let thisRow;
            let table = document.getElementById('containerTable').getElementsByTagName('tbody')[0];
            //log(`Attempting to find match in table for agent ${agent.agentid}`);

            for (let row of table.rows) {
                //log(`row.cells[0].textContent ${row.cells[0].textContent} =? ${agent.agentid}`);
                if (row.cells[0].textContent == agent.agentid) {
                    thisRow = row;
                    rowExists = true;
                    //log(`Matched row for agent ${agent.agentid}`);
                    break;
                }
            }
            if(!rowExists)
            { 
                //log(`Failed to match row for agent ${agent.agentid}`);
                thisRow = table.insertRow();
                thisRow.insertCell(0);
                thisRow.insertCell(1);
                thisRow.insertCell(2);
                thisRow.insertCell(3);
                thisRow.insertCell(4);
                thisRow.insertCell(5);
                thisRow.insertCell(6);
                thisRow.insertCell(7);
                thisRow.insertCell(8);
                thisRow.insertCell(9);
            }
            return thisRow;
        }catch(error)
        {
            log(`Error in updateOrAddRow() : ${error} ${error.stack}`);
        }
    }

    function updateTableSort() {
        const tbody = document.querySelector('#containerTable tbody');
        const rows = Array.from(tbody.rows);

        if (sortState.order === 'none') {
            rows.sort((a, b) => a.rowIndex - b.rowIndex);
        } else {
            rows.sort((a, b) => {
                const aText = a.querySelector(`td:nth-child(${getColumnIndex(sortState.column)})`).textContent.trim();
                const bText = b.querySelector(`td:nth-child(${getColumnIndex(sortState.column)})`).textContent.trim();
                return sortState.order === 'asc' ? aText.localeCompare(bText) : bText.localeCompare(aText);
            });
        }

        rows.forEach(row => tbody.appendChild(row));
        updateArrows();
    }

    function getColumnIndex(column) {
        return Array.from(document.querySelectorAll('th')).findIndex(th => th.getAttribute('data-column') === column) + 1;
    }

    function updateArrows() {
        document.querySelectorAll('.arrow').forEach(arrow => {
            arrow.textContent = '';
        });
        if (sortState.order !== 'none') {
            const arrow = document.querySelector(`#${sortState.column}Arrow`);
            arrow.textContent = sortState.order === 'asc' ? '▲' : '▼';
        }
    }

    // Initial table update
    await initTable();
    await updateTable();

    // Update the table every second
    setInterval(updateTable, 2000);
});

ipcRenderer.on('remove-table-row', (event, agentId) => {
    log(`Removing row for agent ID: ${agentId}`);
    let table = document.getElementById('containerTable').getElementsByTagName('tbody')[0];
    for (let row of table.rows) {
        if (row.cells[0].textContent.trim() === agentId.trim()) {
            row.remove(); // Remove the row from the table
            log(`Row for agent ${agentId} removed.`);
            break;
        }
    }
});

ipcRenderer.on('make-web-request', async (event, requestOptions) => {
    try {
        const { url, method = 'GET', headers = {}, body, requestId } = requestOptions;
        const defaultHeaders = {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        };
        const fetchOptions = {
            method,
            headers: { ...defaultHeaders, ...headers }
        };
        if (body !== undefined) {
            fetchOptions.body = body;
        }
        const response = await fetch(url, fetchOptions);
        let data = "";
        const contentType = response.headers.get('content-type');
        if (contentType && (
            contentType.includes('application/octet-stream') ||
            contentType.includes('application/x-binary') ||
            contentType.includes('application/x-msdownload') ||
            contentType.includes('application/zip') ||
            contentType.includes('application/pdf') ||
            contentType.includes('image/') ||
            contentType.includes('video/') ||
            contentType.includes('audio/')
        )) {
            const arrayBuffer = await response.arrayBuffer();
            data = Buffer.from(arrayBuffer);
        } else {
            data = await response.text();
        }
        ipcRenderer.send(`web-request-response-${requestId}`, {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            data: data
        });
    } catch (error) {
        ipcRenderer.send(`web-request-response-${requestId}`, {
            error: error.message
        });
    }
});
